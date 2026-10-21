// @vitest-environment node

import { NO_GRANTS } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
