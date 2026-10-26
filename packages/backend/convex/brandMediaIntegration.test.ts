// @vitest-environment node

import { renderBrandKit } from "@pikar/core/brandKit";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const kit = {
  name: "FORMA",
  tagline: "Everyday form",
  audience: "Design lovers",
  positioning: "Thoughtful daily objects",
  voice: ["Clear"],
  palette: [
    { name: "Ink", hex: "#111111" },
    { name: "Paper", hex: "#FFFFFF" },
  ],
  typography: { heading: "Arial", body: "Arial" },
  logoDirection: "Wordmark",
  imagery: "Golden-hour product photography",
  motion: "Slow upward camera rise",
  examples: ["Meet FORMA"],
  prohibitedClaims: ["Unverified sustainability"],
};
function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  return t;
}
async function seed(t: ReturnType<typeof setup>, tenantId = "brand_a") {
  return t.run(async (ctx) => {
    const text = renderBrandKit(kit, 1),
      hash = await contentHash(text);
    const docId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "FORMA kit",
      kind: "brand_kit",
      category: "business",
      source: "brand_kit",
      mimeType: "text/markdown",
      size: text.length,
      text,
      contentHash: hash,
      status: "ready",
      createdAt: 1,
    });
    await ctx.db.insert("brandKits", {
      tenantId,
      revision: 2,
      active: {
        revision: 1,
        kit: JSON.stringify(kit),
        docId,
        contentHash: hash,
        reviewHash: "review",
        approvedAt: 1,
      },
      draft: {
        revision: 2,
        kit: JSON.stringify({ ...kit, name: "UNAPPROVED" }),
        reviewHash: "draft",
      },
    });
    return { docId, revision: 1, contentHash: hash };
  });
}
test("single image pins approved identity and high quality; existing unspecified quality retains low pricing", async () => {
  const t = setup(),
    ref = await seed(t),
    a = t.withIdentity({ subject: "brand_a" });
  const result = await t.mutation(internal.plans.stageImagePlan, {
    tenantId: "brand_a",
    threadId: "single",
    prompt: "A black bottle on stone",
  });
  if (!result.ok) throw new Error(result.reason);
  const plan = await t.run((ctx) => ctx.db.get(result.planId));
  expect(plan?.brandKitRef).toEqual(ref);
  expect(plan?.mediaImageQuality).toBe("high");
  expect(plan?.imagePrompt).toContain("A black bottle on stone");
  expect(plan?.imagePrompt).toContain("Approved brand: FORMA");
  expect(plan?.imagePrompt).toContain("Golden-hour");
  expect(plan?.imagePrompt).not.toContain("UNAPPROVED");
  const high = await a.query(api.media.imageEstimate, { planId: result.planId });
  expect(high).toMatchObject({ quality: "high", refusal: null });
  const oldId = await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: "brand_a",
      threadId: "old",
      kind: "media",
      mediaMode: "image",
      imagePrompt: "Historical image",
      status: "proposed",
      createdAt: 0,
    }),
  );
  const low = await a.query(api.media.imageEstimate, { planId: oldId });
  expect(low).toMatchObject({ quality: "low", refusal: null });
  expect(high.totalCents).toBeGreaterThan(low.totalCents);
  expect((await t.run((ctx) => ctx.db.get(oldId)))?.mediaImageQuality).toBeUndefined();
  const other = await t.mutation(internal.plans.stageImagePlan, {
    tenantId: "other",
    threadId: "single",
    prompt: "A red jar",
  });
  if (!other.ok) throw new Error(other.reason);
  const otherPlan = await t.run((ctx) => ctx.db.get(other.planId));
  expect(otherPlan?.brandKitRef).toBeUndefined();
  expect(otherPlan?.imagePrompt).toBe("A red jar");
});
test("batch images share approved brand snapshot without mixing item prompts and stay pinned after later activation", async () => {
  const t = setup(),
    ref = await seed(t);
  const staged = await t.mutation(internal.mediaCampaign.stage, {
    tenantId: "brand_a",
    threadId: "batch",
    title: "Launch images",
    maxCostCents: 1000,
    items: [
      { kind: "image", label: "Bottle", prompt: "Black bottle close-up" },
      { kind: "image", label: "Jar", prompt: "White jar overhead" },
    ],
  });
  const campaign = await t.run((ctx) => ctx.db.get(staged.campaignId));
  expect(campaign?.items).toHaveLength(2);
  const plans = await t.run(async (ctx) =>
    Promise.all((campaign?.items ?? []).map((item) => ctx.db.get(item.planId))),
  );
  for (const plan of plans) {
    expect(plan?.brandKitRef).toEqual(ref);
    expect(plan?.mediaImageQuality).toBe("high");
    expect(plan?.imagePrompt).toContain("Approved brand: FORMA");
    expect(plan?.imagePrompt).not.toContain("UNAPPROVED");
  }
  expect(plans[0]?.imagePrompt).toContain("Black bottle close-up");
  expect(plans[0]?.imagePrompt).not.toContain("White jar overhead");
  expect(plans[1]?.imagePrompt).toContain("White jar overhead");
  expect(plans[1]?.imagePrompt).not.toContain("Black bottle close-up");
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("brandKits")
      .withIndex("by_tenant", (q) => q.eq("tenantId", "brand_a"))
      .unique();
    if (row) await ctx.db.patch(row._id, { active: undefined });
  });
  const persisted = await t.run(async (ctx) =>
    Promise.all((campaign?.items ?? []).map((item) => ctx.db.get(item.planId))),
  );
  expect(persisted.map((p) => p?.brandKitRef)).toEqual([ref, ref]);
  const review = await t
    .withIdentity({ subject: "brand_a" })
    .query(api.mediaCampaign.byId, { campaignId: staged.campaignId, threadId: "batch" });
  expect(review?.items.every((item) => item.refusal === null && item.estimateCents > 0)).toBe(true);
});

test("creative grounding reads the immutable pinned revision and fails closed on tampering or tenant mismatch", async () => {
  const t = setup(),
    ref = await seed(t);
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "brand_a",
    threadId: "film",
  });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("brandKits")
      .withIndex("by_tenant", (q) => q.eq("tenantId", "brand_a"))
      .unique();
    if (row) await ctx.db.patch(row._id, { active: undefined });
  });
  const pinned = await t.query(internal.brandKits.pinnedSpineForPlan, {
    tenantId: "brand_a",
    planId,
  });
  expect(pinned).toContain("PLAN-PINNED");
  expect(pinned).toContain('"name": "FORMA"');
  expect(pinned).not.toContain("UNAPPROVED");
  const unbranded = await t.mutation(internal.plans.insertPlan, {
    tenantId: "brand_a",
    threadId: "plain",
  });
  expect(
    await t.query(internal.brandKits.pinnedSpineForPlan, {
      tenantId: "brand_a",
      planId: unbranded,
    }),
  ).toBeNull();
  await expect(
    t.query(internal.brandKits.pinnedSpineForPlan, { tenantId: "other", planId }),
  ).rejects.toThrow("BRAND_PLAN_NOT_FOUND");
  await t.run((ctx) => ctx.db.patch(ref.docId, { text: "tampered" }));
  await expect(
    t.query(internal.brandKits.pinnedSpineForPlan, { tenantId: "brand_a", planId }),
  ).rejects.toThrow("PINNED_BRAND_UNAVAILABLE");
});
