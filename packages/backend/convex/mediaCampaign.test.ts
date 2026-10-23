// @vitest-environment node

import { NO_GRANTS } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DEPLOYMENT_MEDIA_BUDGET_CENTS, MEDIA_DAILY_BUDGET_CENTS, rateLimiter } from "./guardrails";
import { newestRoot, ROOT_SCAN, threadRoots } from "./lib/planRow";
import { buildCockpitTools } from "./llm";
import * as media from "./media";
import { stageCampaignInner } from "./mediaCampaign";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
type T = TestConvex<typeof schema>;
const tenantId = "campaign_a";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}
const asA = (t: T) => t.withIdentity({ subject: tenantId });
async function stage(t: T, count = 3) {
  return t.mutation(internal.mediaCampaign.stage, {
    tenantId,
    threadId: "campaign_thread",
    title: "Owned product campaign",
    maxCostCents: 1000,
    items: Array.from({ length: count }, (_, index) => ({
      kind: "image" as const,
      label: `Image ${index + 1}`,
      prompt: `Owned product ${index + 1}`,
    })),
  });
}
async function row(t: T, id: Id<"mediaCampaigns">) {
  const value = await t.run((ctx) => ctx.db.get(id));
  if (!value) throw new Error("missing campaign fixture");
  return value;
}
async function approve(t: T, id: Id<"mediaCampaigns">) {
  const campaign = await row(t, id);
  const review = (await asA(t).query(api.mediaCampaign.list, { threadId: campaign.threadId })).find(
    (item) => item.id === id,
  );
  if (!review) throw new Error("missing campaign review");
  return asA(t).mutation(api.mediaCampaign.approve, {
    campaignId: id,
    expectedUpdatedAt: campaign.updatedAt,
    expectedReviewHash: review.reviewHash,
    maxCostCents: 1000,
  });
}
async function advance(t: T, id: Id<"mediaCampaigns">) {
  const campaign = await row(t, id);
  await t.mutation(internal.mediaCampaign.advance, {
    tenantId,
    campaignId: id,
    expectedUpdatedAt: campaign.updatedAt,
  });
}
async function finish(t: T, id: Id<"mediaCampaigns">, index: number, failure?: string) {
  const campaign = await row(t, id);
  const item = campaign.items[index];
  if (!item?.batchId) throw new Error("missing item fixture");
  const batchId = item.batchId;
  await t.run(async (ctx) => {
    const job = await ctx.db
      .query("mediaJobs")
      .withIndex("by_batch", (q) => q.eq("tenantId", tenantId).eq("batchId", batchId))
      .first();
    if (!job) throw new Error("missing media fixture");
    if (failure) await ctx.db.patch(job._id, { status: "failed", failureReason: failure });
    else {
      const storageId = await ctx.storage.store(new Blob(["owned-image"], { type: "image/png" }));
      await ctx.db.patch(job._id, { status: "succeeded", assetStorageId: storageId });
    }
  });
}

/** Synthetic completed refs only: no reservations, scheduling or provider calls. */
async function downloadFixture(t: T) {
  const { campaignId } = await t.mutation(internal.mediaCampaign.stage, {
    tenantId,
    threadId: "campaign_thread",
    title: "Download collection",
    maxCostCents: 100,
    items: [
      { kind: "image", label: "Product still", prompt: "Owned product" },
      { kind: "video", label: "Captioned story", brief: "Owned story" },
      { kind: "image", label: "Failed still", prompt: "Owned detail" },
    ],
  });
  const campaign = await row(t, campaignId);
  const image = campaign.items[0],
    video = campaign.items[1],
    failed = campaign.items[2];
  if (!image || !video || !failed) throw new Error("missing download fixture");
  const assets = await t.run(async (ctx) => {
    const imageId = await ctx.storage.store(new Blob(["original-image"], { type: "image/png" }));
    const videoId = await ctx.storage.store(new Blob(["captioned-final"], { type: "video/mp4" }));
    const sidecarId = await ctx.storage.store(new Blob(["governed-sidecar"]));
    const imageJobId = await ctx.db.insert("mediaJobs", {
      tenantId,
      planId: image.planId,
      batchId: "manifest-image",
      blockIndex: 0,
      provider: "openai",
      kind: "image",
      model: "gpt-image-2",
      spec: { kind: "image", width: 1024, height: 1536 },
      promptHash: "fixture-hash",
      status: "succeeded",
      assetStorageId: imageId,
      estUsd: 0,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await ctx.db.patch(video.planId, {
      renderStatus: "rendered",
      renderStorageId: videoId,
      sidecarStorageId: sidecarId,
      renderSummary: { durationS: 30, sceneCount: 6, gates: [] },
      captionStatus: "captioned",
      musicCredit: {
        title: "Licensed bed",
        creator: "Fixture composer",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourceUrl: "https://example.com/licensed-bed",
        attribution: "Licensed bed — Fixture composer (CC BY 4.0)",
      },
    });
    await ctx.db.patch(campaignId, {
      status: "partial",
      items: [
        { ...image, status: "succeeded", batchId: "manifest-image" },
        { ...video, status: "succeeded", batchId: "manifest-video" },
        { ...failed, status: "failed", failureReason: "provider_failed" },
      ],
    });
    return { imageId, videoId, sidecarId, imageJobId };
  });
  return { campaignId, image, video, failed, ...assets };
}

test("download manifest snapshots ready current originals and captioned final with credits, omitting unfinished siblings", async () => {
  const t = harness();
  const f = await downloadFixture(t);
  const result = await asA(t).query(api.mediaCampaign.downloadManifest, {
    campaignId: f.campaignId,
    threadId: "campaign_thread",
  });
  expect(result).toMatchObject({
    campaignId: f.campaignId,
    threadId: "campaign_thread",
    title: "Download collection",
    total: 3,
    entries: [
      { index: 0, label: "Product still", kind: "image", captioned: false, musicCredit: null },
      {
        index: 1,
        label: "Captioned story",
        kind: "video",
        captioned: true,
        musicCredit: "Licensed bed — Fixture composer (CC BY 4.0)",
      },
    ],
    omitted: [{ index: 2, label: "Failed still", status: "failed", reason: "not_ready" }],
  });
  expect(result?.entries[0]?.url).toBe(
    await asA(t).query(api.mediaCampaign.download, { campaignId: f.campaignId, itemIndex: 0 }),
  );
  expect(result?.entries[1]?.url).toBe(await t.run((ctx) => ctx.storage.getUrl(f.videoId)));
  expect(JSON.stringify(result?.omitted)).not.toContain("http");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("spendEvents").collect()).toHaveLength(0);
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(0);
  });
});

test("download manifest rejects anonymous, foreign, wrong-thread and deleted campaigns", async () => {
  const t = harness();
  const f = await downloadFixture(t);
  const args = { campaignId: f.campaignId, threadId: "campaign_thread" };
  await expect(t.query(api.mediaCampaign.downloadManifest, args)).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  expect(
    await t.withIdentity({ subject: "campaign_b" }).query(api.mediaCampaign.downloadManifest, args),
  ).toBeNull();
  expect(
    await asA(t).query(api.mediaCampaign.downloadManifest, { ...args, threadId: "wrong_thread" }),
  ).toBeNull();
  await t.run((ctx) => ctx.db.delete(f.campaignId));
  expect(await asA(t).query(api.mediaCampaign.downloadManifest, args)).toBeNull();
});

test.each([
  "foreign",
  "wrong_thread",
  "wrong_campaign",
  "wrong_kind",
  "deleted",
] as const)("download manifest refuses %s child membership even on an unfinished sibling", async (change) => {
  const t = harness();
  const f = await downloadFixture(t);
  const other = await stage(t, 1);
  await t.run(async (ctx) => {
    if (change === "deleted") await ctx.db.delete(f.failed.planId);
    else {
      const patch: Partial<Doc<"plans">> =
        change === "foreign"
          ? { tenantId: "campaign_b" }
          : change === "wrong_thread"
            ? { threadId: "wrong_thread" }
            : change === "wrong_campaign"
              ? { mediaCampaignId: other.campaignId }
              : { mediaMode: "reel" };
      await ctx.db.patch(f.failed.planId, patch);
    }
  });
  expect(
    await asA(t).query(api.mediaCampaign.downloadManifest, {
      campaignId: f.campaignId,
      threadId: "campaign_thread",
    }),
  ).toBeNull();
});

test("single and batch downloads reject a ready child whose plan moved to another thread", async () => {
  const t = harness();
  const f = await downloadFixture(t);
  await t.run((ctx) => ctx.db.patch(f.image.planId, { threadId: "moved_thread" }));
  await expect(
    asA(t).query(api.mediaCampaign.download, { campaignId: f.campaignId, itemIndex: 0 }),
  ).rejects.toThrow("CAMPAIGN_PLAN_NOT_OWNED");
  expect(
    await asA(t).query(api.mediaCampaign.downloadManifest, {
      campaignId: f.campaignId,
      threadId: "campaign_thread",
    }),
  ).toBeNull();
});

test("an image retry does not export the preceding succeeded batch", async () => {
  const t = harness();
  const f = await downloadFixture(t);
  await t.run(async (ctx) => {
    const original = await ctx.db.get(f.imageJobId);
    if (!original) throw new Error("missing image fixture");
    const { _id, _creationTime, assetStorageId, ...job } = original;
    await ctx.db.insert("mediaJobs", {
      ...job,
      batchId: "new-current-batch",
      status: "queued",
      createdAt: 1001,
    });
  });
  const result = await asA(t).query(api.mediaCampaign.downloadManifest, {
    campaignId: f.campaignId,
    threadId: "campaign_thread",
  });
  expect(result?.entries.map((entry) => entry.index)).toEqual([1]);
  expect(result?.omitted).toContainEqual({
    index: 0,
    label: "Product still",
    status: "succeeded",
    reason: "final_unavailable",
  });
  expect(
    await asA(t).query(api.mediaCampaign.download, { campaignId: f.campaignId, itemIndex: 0 }),
  ).toBeNull();
});

test.each([
  "pending",
  "rendering",
  "failed",
] as const)("a %s render does not export its retained prior final", async (renderStatus) => {
  const t = harness();
  const f = await downloadFixture(t);
  await t.run((ctx) => ctx.db.patch(f.video.planId, { renderStatus }));
  const result = await asA(t).query(api.mediaCampaign.downloadManifest, {
    campaignId: f.campaignId,
    threadId: "campaign_thread",
  });
  expect(result?.entries.map((entry) => entry.index)).toEqual([0]);
  expect(result?.omitted).toContainEqual({
    index: 1,
    label: "Captioned story",
    status: "succeeded",
    reason: "final_unavailable",
  });
});

test("missing governed final or active captions stay unavailable, failed captions preserve current uncaptioned final", async () => {
  const t = harness();
  const f = await downloadFixture(t);
  const args = { campaignId: f.campaignId, threadId: "campaign_thread" };
  for (const patch of [
    { sidecarStorageId: undefined },
    { sidecarStorageId: f.sidecarId, renderSummary: undefined },
    {
      renderSummary: { durationS: 30, sceneCount: 6, gates: [] },
      captionStatus: "burning" as const,
    },
  ]) {
    await t.run((ctx) => ctx.db.patch(f.video.planId, patch));
    expect(
      (await asA(t).query(api.mediaCampaign.downloadManifest, args))?.entries.map(
        (entry) => entry.index,
      ),
    ).toEqual([0]);
  }
  await t.run((ctx) => ctx.db.patch(f.video.planId, { captionStatus: "failed" }));
  const degraded = await asA(t).query(api.mediaCampaign.downloadManifest, args);
  expect(degraded?.entries.find((entry) => entry.index === 1)).toMatchObject({
    captioned: false,
    musicCredit: "Licensed bed — Fixture composer (CC BY 4.0)",
  });
});

test("deleted bytes are omitted and corrupt batch membership refuses the whole snapshot", async () => {
  const t = harness();
  const f = await downloadFixture(t);
  const args = { campaignId: f.campaignId, threadId: "campaign_thread" };
  await t.run((ctx) => ctx.storage.delete(f.imageId));
  expect(
    (await asA(t).query(api.mediaCampaign.downloadManifest, args))?.entries.map(
      (entry) => entry.index,
    ),
  ).toEqual([1]);
  await t.run((ctx) => ctx.db.patch(f.imageJobId, { planId: f.failed.planId }));
  expect(await asA(t).query(api.mediaCampaign.downloadManifest, args)).toBeNull();
});

test.each([
  "empty",
  "duplicate",
  "overflow",
] as const)("malformed %s campaign membership refuses instead of truncating an archive", async (kind) => {
  const t = harness();
  const f = await downloadFixture(t);
  const campaign = await row(t, f.campaignId);
  await t.run(async (ctx) => {
    const items = [...campaign.items];
    const first = items[0];
    if (!first) throw new Error("missing campaign item");
    if (kind === "empty") items.length = 0;
    else if (kind === "duplicate") items.push(first);
    else
      while (items.length < 16) {
        const planId = await ctx.db.insert("plans", {
          tenantId,
          threadId: "campaign_thread",
          mediaCampaignId: f.campaignId,
          mediaMode: "image",
          status: "proposed",
          createdAt: 1000,
        });
        const pending: (typeof items)[number] = { ...first, planId, status: "ready" };
        delete pending.batchId;
        items.push(pending);
      }
    await ctx.db.patch(f.campaignId, { items });
  });
  expect(
    await asA(t).query(api.mediaCampaign.downloadManifest, {
      campaignId: f.campaignId,
      threadId: "campaign_thread",
    }),
  ).toBeNull();
});

test("the full fifteen-member limit returns every omitted status without truncation", async () => {
  const t = harness();
  const { campaignId } = await stage(t, 15);
  const result = await asA(t).query(api.mediaCampaign.downloadManifest, {
    campaignId,
    threadId: "campaign_thread",
  });
  expect(result?.total).toBe(15);
  expect(result?.entries).toEqual([]);
  expect(result?.omitted.map((item) => item.index)).toEqual(
    Array.from({ length: 15 }, (_, index) => index),
  );
  expect(
    result?.omitted.every((item) => item.status === "ready" && item.reason === "not_ready"),
  ).toBe(true);
});

test("one brief stages images and video planning refs without any media purchase", async () => {
  const t = harness();
  const result = await t.mutation(internal.mediaCampaign.stage, {
    tenantId,
    threadId: "campaign_thread",
    title: "Launch",
    maxCostCents: 100,
    items: [
      { kind: "image", label: "Hero", prompt: "Owned product" },
      { kind: "video", label: "Launch reel", brief: "Explain the product using owned facts" },
    ],
  });
  expect(result.videoPlans).toHaveLength(1);
  const videoPlan = result.videoPlans[0];
  if (!videoPlan) throw new Error("missing video fixture");
  const campaign = await row(t, result.campaignId);
  expect(campaign.items.map((item) => item.status)).toEqual(["ready", "proposal"]);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("mediaJobs").collect()).toHaveLength(0);
    expect((await ctx.db.get(videoPlan.planId))?.status).toBe("collecting");
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(0);
  });
});

test("the actual executive campaign tool redacts every item before atomic storage and scheduling", async () => {
  const t = harness();
  const planId = await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "campaign_thread",
      status: "collecting",
      createdAt: Date.now(),
    }),
  );
  const reply = await t.action(async (ctx) => {
    const context = {
      ctx,
      tenantId,
      planId,
      threadId: "campaign_thread",
      rootRequestId: "trusted-tool-turn",
    };
    expect("createMediaCampaign" in buildCockpitTools(context)).toBe(false);
    const execute = buildCockpitTools(context, { ...NO_GRANTS, dispatch: true }).createMediaCampaign
      ?.execute;
    if (!execute) throw new Error("trusted executive campaign tool missing");
    return execute(
      {
        title: "Campaign for kai@example.com",
        maxCostCents: 100,
        items: [
          {
            kind: "image",
            label: "Hero image",
            prompt: "Call +1 (415) 555-0199 or email kai@example.com about the owned product",
          },
          {
            kind: "video",
            label: "Launch video",
            brief: "A product launch story for kai@example.com, phone +1 (415) 555-0199",
          },
        ],
      },
      { toolCallId: "campaign-tool-test", messages: [], context: {} },
    );
  });
  expect(reply).toContain("Prepared 2 media items");
  await t.run(async (ctx) => {
    const campaigns = await ctx.db.query("mediaCampaigns").collect();
    const plans = await ctx.db.query("plans").collect();
    const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
    expect(campaigns).toHaveLength(1);
    expect(plans).toHaveLength(3);
    expect(scheduled).toHaveLength(1);
    expect(await ctx.db.query("mediaJobs").collect()).toHaveLength(0);
    const stored = JSON.stringify({ campaigns, plans, scheduled });
    expect(stored).not.toContain("kai@example.com");
    expect(stored).not.toContain("+1 (415) 555-0199");
    expect(stored).not.toContain("4155550199");
    expect(plans.find((plan) => plan.mediaMode === "image")?.imagePrompt).toContain(
      "owned product",
    );
  });
});

test("the actual executive video-batch tool refuses a zero AI allowance without staging", async () => {
  const t = harness();
  const planId = await t.run(async (ctx) => {
    const available = await rateLimiter.getValue(ctx, "dailySpendCents", { key: tenantId });
    await rateLimiter.limit(ctx, "dailySpendCents", {
      key: tenantId,
      count: available.value,
      reserve: true,
    });
    return ctx.db.insert("plans", {
      tenantId,
      threadId: "campaign_thread",
      status: "collecting",
      createdAt: Date.now(),
    });
  });
  const reply = await t.action(async (ctx) => {
    const execute = buildCockpitTools(
      { ctx, tenantId, planId, threadId: "campaign_thread", rootRequestId: "trusted-tool-turn" },
      { ...NO_GRANTS, dispatch: true },
    ).createMediaCampaign?.execute;
    if (!execute) throw new Error("trusted executive campaign tool missing");
    return execute(
      {
        title: "Launch",
        maxCostCents: 100,
        items: [{ kind: "video", label: "Story", brief: "Owned product story" }],
      },
      { toolCallId: "campaign-tool-test", messages: [], context: {} },
    );
  });
  expect(reply).toContain("Nothing was saved or generated");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("mediaCampaigns").collect()).toHaveLength(0);
    expect(await ctx.db.query("plans").collect()).toHaveLength(1);
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(0);
  });
});

test("campaign creation replay reuses every private plan and schedules each director only once", async () => {
  const t = harness();
  const args = {
    tenantId,
    threadId: "campaign_thread",
    title: " Launch ",
    maxCostCents: 100,
    items: [
      { kind: "video" as const, label: " Story one ", brief: " First owned story " },
      { kind: "video" as const, label: "Story two", brief: "Second owned story" },
    ],
    directorContext: { rootRequestId: "trusted-turn-id", envelopeCents: 5 },
  };
  const first = await t.mutation(internal.mediaCampaign.stage, args);
  const again = await t.mutation(internal.mediaCampaign.stage, {
    ...args,
    title: "Launch",
    items: args.items.map((item) => ({
      ...item,
      label: item.label.trim(),
      brief: item.brief.trim(),
    })),
  });
  expect(again).toEqual(first);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("mediaCampaigns").collect()).toHaveLength(1);
    expect(await ctx.db.query("plans").collect()).toHaveLength(2);
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(2);
    expect(await ctx.db.query("mediaJobs").collect()).toHaveLength(0);
  });
});

test("a second director schedule failure rolls back the whole campaign and every earlier schedule", async () => {
  const t = harness();
  let calls = 0;
  await expect(
    t.run(async (ctx) =>
      stageCampaignInner(
        {
          ...ctx,
          scheduler: {
            ...ctx.scheduler,
            runAfter: async (delay, reference, ...args) => {
              calls += 1;
              if (calls === 2) throw new Error("synthetic_schedule_failure");
              return ctx.scheduler.runAfter(delay, reference, ...args);
            },
          },
        },
        {
          tenantId,
          threadId: "campaign_thread",
          title: "Launch",
          maxCostCents: 100,
          items: [
            { kind: "video", label: "Story one", brief: "First owned story" },
            { kind: "video", label: "Story two", brief: "Second owned story" },
          ],
          directorContext: { rootRequestId: "trusted-turn-id", envelopeCents: 5 },
        },
      ),
    ),
  ).rejects.toThrow("synthetic_schedule_failure");
  expect(calls).toBe(2);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("mediaCampaigns").collect()).toHaveLength(0);
    expect(await ctx.db.query("plans").collect()).toHaveLength(0);
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(0);
  });
});

test("repeated private campaigns cannot hide the ordinary root beyond its scan window", async () => {
  const t = harness();
  const rootId = await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "campaign_thread",
      status: "proposed",
      createdAt: Date.now(),
    }),
  );
  const count = Math.ceil((ROOT_SCAN + 1) / 15);
  for (let index = 0; index < count; index += 1) await stage(t, 15);
  expect(
    await t.run(async (ctx) => (await newestRoot(ctx, tenantId, "campaign_thread"))?._id),
  ).toBe(rootId);
  expect(
    await t.run(async (ctx) =>
      (await threadRoots(ctx, tenantId, "campaign_thread")).map((plan) => plan._id),
    ),
  ).toEqual([rootId]);
});

test("aggregate maximum refuses before any reservation and tenant B cannot approve or read A", async () => {
  const t = harness();
  const { campaignId } = await stage(t);
  const campaign = await row(t, campaignId);
  const review = (await asA(t).query(api.mediaCampaign.list, { threadId: campaign.threadId }))[0];
  if (!review) throw new Error("missing campaign review");
  const result = await asA(t).mutation(api.mediaCampaign.approve, {
    campaignId,
    expectedUpdatedAt: campaign.updatedAt,
    expectedReviewHash: review.reviewHash,
    maxCostCents: 0,
  });
  expect(result).toMatchObject({ ok: false, reason: "campaign_maximum_exceeded" });
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  const other = t.withIdentity({ subject: "campaign_b" });
  expect(await other.query(api.mediaCampaign.list, { threadId: "campaign_thread" })).toEqual([]);
  await expect(
    other.mutation(api.mediaCampaign.approve, {
      campaignId,
      expectedUpdatedAt: campaign.updatedAt,
      expectedReviewHash: review.reviewHash,
      maxCostCents: 1000,
    }),
  ).rejects.toThrow("CAMPAIGN_NOT_FOUND");
});

test("a late child refusal rolls back earlier purchases inside the nested transaction", async () => {
  const t = harness();
  const { campaignId } = await stage(t, 2);
  const original = media.reserveCampaignPlanInner;
  let calls = 0;
  vi.spyOn(media, "reserveCampaignPlanInner").mockImplementation(async (...args) => {
    calls += 1;
    return calls === 2 ? { ok: false, reason: "media_daily_exhausted" } : original(...args);
  });
  expect(await approve(t, campaignId)).toEqual({ ok: false, reason: "media_daily_exhausted" });
  expect(calls).toBe(2);
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  expect((await row(t, campaignId)).status).toBe("draft");
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
});

test("a child edit after review refuses the stale approval before spending", async () => {
  const t = harness();
  const { campaignId } = await stage(t, 1);
  const campaign = await row(t, campaignId);
  const view = (await asA(t).query(api.mediaCampaign.list, { threadId: campaign.threadId }))[0];
  const item = campaign.items[0];
  if (!view || !item) throw new Error("missing campaign fixture");
  await t.run((ctx) =>
    ctx.db.patch(item.planId, { imagePrompt: "Updated owned product placement" }),
  );
  expect(
    await asA(t).mutation(api.mediaCampaign.approve, {
      campaignId,
      expectedUpdatedAt: campaign.updatedAt,
      expectedReviewHash: view.reviewHash,
      maxCostCents: 1000,
    }),
  ).toEqual({ ok: false, reason: "stale_review" });
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
});

test("fifteen fractional image estimates reserve fifteen conservative cents on both existing rails", async () => {
  const t = harness();
  const { campaignId } = await stage(t, 15);
  expect(await approve(t, campaignId)).toEqual({ ok: true });
  await t.run(async (ctx) => {
    const jobs = await ctx.db.query("mediaJobs").collect();
    expect(jobs).toHaveLength(15);
    expect(jobs.every((job) => job.estUsd === 0.006)).toBe(true);
    expect((await rateLimiter.getValue(ctx, "mediaSpendCents", { key: tenantId })).value).toBe(
      MEDIA_DAILY_BUDGET_CENTS - 15,
    );
    expect((await rateLimiter.getValue(ctx, "deploymentMediaSpendCents")).value).toBe(
      DEPLOYMENT_MEDIA_BUDGET_CENTS - 15,
    );
    const events = await ctx.db.query("spendEvents").collect();
    expect(
      events
        .filter((event) => event.phase === "reserved")
        .reduce((sum, event) => sum + event.amountCents, 0),
    ).toBe(15);
    expect(events.every((event) => event.kind === "media_reserve")).toBe(true);
  });
});

test("aggregate fractional refusal rolls back all child rows and both spend windows", async () => {
  const t = harness();
  const { campaignId } = await stage(t, 15);
  await t.run((ctx) =>
    rateLimiter.limit(ctx, "mediaSpendCents", {
      key: tenantId,
      count: MEDIA_DAILY_BUDGET_CENTS - 8,
      reserve: true,
    }),
  );
  expect(await approve(t, campaignId)).toEqual({ ok: false, reason: "media_daily_exhausted" });
  await t.run(async (ctx) => {
    expect(await ctx.db.query("mediaJobs").collect()).toHaveLength(0);
    expect(await ctx.db.query("spendEvents").collect()).toHaveLength(0);
    expect((await rateLimiter.getValue(ctx, "mediaSpendCents", { key: tenantId })).value).toBe(8);
    expect((await rateLimiter.getValue(ctx, "deploymentMediaSpendCents")).value).toBe(
      DEPLOYMENT_MEDIA_BUDGET_CENTS,
    );
    expect(await ctx.db.query("spendCoverage").collect()).toHaveLength(1);
  });
  expect((await row(t, campaignId)).status).toBe("draft");
});

test("one active campaign per tenant prevents multiple campaigns from multiplying worker concurrency", async () => {
  const t = harness();
  const first = await stage(t, 2);
  const second = await stage(t, 2);
  expect(await approve(t, first.campaignId)).toEqual({ ok: true });
  expect(await approve(t, second.campaignId)).toEqual({
    ok: false,
    reason: "tenant_campaign_in_flight",
  });
  const view = await asA(t).query(api.mediaCampaign.list, { threadId: "campaign_thread" });
  expect(view.find((item) => item.id === second.campaignId)?.tenantBusy).toBe(true);
  await asA(t).mutation(api.mediaCampaign.cancel, { campaignId: first.campaignId });
  expect(await approve(t, second.campaignId)).toEqual({ ok: true });
});

test("durable revision claims cap whole-job starts and ignore duplicate poll callbacks", async () => {
  const t = harness();
  const { campaignId } = await stage(t);
  expect(await approve(t, campaignId)).toEqual({ ok: true });
  const before = await row(t, campaignId);
  await advance(t, campaignId);
  const after = await row(t, campaignId);
  expect(after.items.map((item) => item.status)).toEqual(["running", "running", "reserved"]);
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  await t.mutation(internal.mediaCampaign.advance, {
    tenantId,
    campaignId,
    expectedUpdatedAt: before.updatedAt,
  });
  expect(await row(t, campaignId)).toEqual(after);
  expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual(
    scheduled,
  );
});

test("uncertain paid failures freeze the remaining queue and late completion resumes without rebuying", async () => {
  const t = harness();
  const { campaignId } = await stage(t);
  await approve(t, campaignId);
  await advance(t, campaignId);
  await finish(t, campaignId, 0);
  await finish(t, campaignId, 1, "poll_timeout");
  await advance(t, campaignId);
  expect((await row(t, campaignId)).items.map((item) => item.status)).toEqual([
    "succeeded",
    "needs_reconciliation",
    "reserved",
  ]);
  const before = (await row(t, campaignId)).reservedCents;
  await finish(t, campaignId, 1);
  await asA(t).mutation(api.mediaCampaign.refresh, { campaignId });
  const next = await row(t, campaignId);
  expect(next.items.map((item) => item.status)).toEqual(["succeeded", "succeeded", "running"]);
  expect(next.reservedCents).toBe(before);
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(3);
});

test("selected paid retry preserves successful siblings and replay cannot buy twice", async () => {
  const t = harness();
  const { campaignId } = await stage(t, 2);
  await approve(t, campaignId);
  await advance(t, campaignId);
  await finish(t, campaignId, 0, "media_not_configured");
  await finish(t, campaignId, 1);
  await advance(t, campaignId);
  const before = await row(t, campaignId);
  expect(before.status).toBe("partial");
  const args = {
    campaignId,
    expectedUpdatedAt: before.updatedAt,
    expectedReviewHash:
      (await asA(t).query(api.mediaCampaign.list, { threadId: before.threadId }))[0]?.reviewHash ??
      "missing",
    maxCostCents: 1000,
    itemIndexes: [0],
  };
  expect(await asA(t).mutation(api.mediaCampaign.approve, args)).toEqual({ ok: true });
  expect(await asA(t).mutation(api.mediaCampaign.approve, args)).toEqual({
    ok: false,
    reason: "stale_campaign",
  });
  const next = await row(t, campaignId);
  expect(next.items[1]).toEqual(before.items[1]);
  expect(next.items[0]?.batchId).not.toBe(before.items[0]?.batchId);
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(3);
  const manifest = await asA(t).query(api.mediaCampaign.list, { threadId: "campaign_thread" });
  expect(manifest[0]?.items[1]?.downloadable).toBe(true);
  expect(await asA(t).query(api.mediaCampaign.download, { campaignId, itemIndex: 1 })).toBeTruthy();
  expect(await asA(t).query(api.mediaCampaign.download, { campaignId, itemIndex: 0 })).toBeNull();
});

test("cancellation stops unstarted reservations while reporting submitted work truthfully", async () => {
  const t = harness();
  const { campaignId } = await stage(t);
  await approve(t, campaignId);
  await advance(t, campaignId);
  await asA(t).mutation(api.mediaCampaign.cancel, { campaignId });
  const campaign = await row(t, campaignId);
  expect(campaign.status).toBe("running");
  expect(campaign.items.map((item) => item.status)).toEqual(["running", "running", "cancelled"]);
  await finish(t, campaignId, 0);
  await finish(t, campaignId, 1);
  await advance(t, campaignId);
  expect((await row(t, campaignId)).status).toBe("partial");
  expect((await row(t, campaignId)).reservedCents).toBe(campaign.reservedCents);
});

test("cancellation terminalizes owned queued jobs but leaves a submitted batch untouched", async () => {
  const t = harness();
  const { campaignId } = await stage(t);
  await approve(t, campaignId);
  const before = await row(t, campaignId);
  const first = before.items[0];
  if (!first?.batchId) throw new Error("missing reserved fixture");
  const batchId = first.batchId;
  const submitted = await t.run(async (ctx) => {
    const job = await ctx.db
      .query("mediaJobs")
      .withIndex("by_batch", (q) =>
        q.eq("tenantId", tenantId).eq("batchId", batchId),
      )
      .first();
    if (!job) throw new Error("missing reserved job");
    await ctx.db.patch(job._id, { status: "submitted", providerRequestId: "already-submitted" });
    return ctx.db.get(job._id);
  });
  if (!submitted) throw new Error("missing submitted fixture");
  await asA(t).mutation(api.mediaCampaign.cancel, { campaignId });
  expect((await row(t, campaignId)).items.map((item) => item.status)).toEqual([
    "running",
    "cancelled",
    "cancelled",
  ]);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(submitted._id)).toEqual(submitted);
    const jobs = await ctx.db.query("mediaJobs").collect();
    expect(jobs.filter((job) => job._id !== submitted._id)).toHaveLength(2);
    expect(
      jobs
        .filter((job) => job._id !== submitted._id)
        .every((job) => job.status === "failed" && job.failureReason === "campaign_cancelled"),
    ).toBe(true);
  });
});
