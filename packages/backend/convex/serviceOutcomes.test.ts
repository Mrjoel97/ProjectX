import { emptyFoundationProfile } from "@pikar/core/foundation";
import { deletableTables, exportableTables } from "@pikar/core/tenantData";
import type { ZernioReport } from "@pikar/core/zernio";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const accountId = "a".repeat(24);
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const now = Date.now();
  const refs = await t.run(async (ctx) => {
    const goalId = await ctx.db.insert("goals", {
      tenantId: "a",
      segmentId: "leads",
      text: "More qualified enquiries",
      status: "active",
      createdAt: now,
      statusChangedAt: now,
    });
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId: "a",
      serviceId: "social-marketing",
      revision: 1,
      controlRevision: 1,
      controlState: "active",
      goal: "Prepare a campaign",
      operationIds: ["social.report"],
      accounts: [{ provider: "zernio", connectionId: "conn", accountId, connectionRevision: 1 }],
      skills: [],
      budgetLimitCents: 100,
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("managedServiceRuns", {
      tenantId: "a",
      serviceId,
      goalId,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: 100,
      requestKey: "one",
      state: "completed",
      createdAt: now,
      updatedAt: now,
    });
    const connection = await ctx.db.insert("zernioConnections", {
      tenantId: "a",
      connectionId: "conn",
      profileId: "b".repeat(24),
      revision: 1,
      status: "connected",
      keyVersion: "v1",
      channels: [{ id: accountId, name: "Business", platform: "instagram", available: true }],
      selectedAccountIds: [accountId],
      dailyReports: false,
      nextReportAt: now,
      nextRefreshAt: now,
      updatedAt: now,
      lease: "lease",
    });
    return { goalId, serviceId, runId, connection };
  });
  return {
    t,
    ...refs,
    a: t.withIdentity({ subject: "a|s" }),
    b: t.withIdentity({ subject: "b|s" }),
  };
}
function report(likes: number, fetchedAt = Date.now()): ZernioReport {
  return {
    fromDate: "2026-08-01",
    toDate: "2026-10-23",
    fetchedAt,
    accounts: [
      {
        accountId,
        platform: "instagram",
        posts: [
          {
            postId: "c".repeat(24),
            source: "external",
            updatedAt: new Date(fetchedAt).toISOString(),
            metrics: { likes },
          },
        ],
      },
    ],
  };
}
async function complete(h: Awaited<ReturnType<typeof setup>>, value: ZernioReport, revision = 1) {
  await h.t.run((ctx) => ctx.db.patch(h.connection, { lease: "lease" }));
  return h.t.mutation(internal.zernio.finishReport, {
    tenantId: "a",
    connectionId: "conn",
    revision,
    lease: "lease",
    report: value,
  });
}
test("trusted completion captures history, retrieval-only deduplicates, genuine reversion stays historical", async () => {
  const h = await setup(),
    first = report(0);
  expect(await complete(h, first)).toBe(true);
  expect(await complete(h, { ...first, fetchedAt: first.fetchedAt + 1 })).toBe(true);
  expect(await h.t.run((ctx) => ctx.db.query("serviceOutcomeObservations").collect())).toHaveLength(
    1,
  );
  expect(await complete(h, report(3))).toBe(true);
  expect(await complete(h, first)).toBe(true);
  expect(await h.t.run((ctx) => ctx.db.query("serviceOutcomeObservations").collect())).toHaveLength(
    3,
  );
  const result = await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId });
  expect(result).toMatchObject({
    operational: "completed",
    usefulness: "unreviewed",
    businessImprovement: "not_established",
    goal: { goalId: h.goalId, status: "active" },
  });
});

test("stored provider permalink receipts link only current owned publishing and analytics scope", async () => {
  const h = await setup(),
    now = Date.now(),
    channelId = "d".repeat(24);
  const nativePostUrl = "https://www.instagram.com/p/ActualCode/";
  const bufferConnection = await h.t.run(async (ctx) => {
    const service = await ctx.db.get(h.serviceId);
    if (!service) throw new Error("service fixture missing");
    await ctx.db.patch(h.serviceId, {
      accounts: [
        ...service.accounts,
        {
          provider: "buffer",
          connectionId: "buffer-conn",
          accountId: channelId,
          connectionRevision: 1,
        },
      ],
    });
    const connectionId = await ctx.db.insert("bufferConnections", {
      tenantId: "a",
      connectionId: "buffer-conn",
      revision: 1,
      status: "connected",
      keyVersion: "v1",
      organizationId: "e".repeat(24),
      expiresAt: now + 3600000,
      updatedAt: now,
      channels: [
        {
          id: channelId,
          name: "Owned account",
          service: "instagram",
          nativeAccountId: "native-owner",
          available: true,
        },
      ],
      selectedChannelIds: [channelId],
      dailyReports: false,
      nextReportAt: 0,
    });
    await ctx.db.insert("bufferPosts", {
      tenantId: "a",
      managedServiceRunId: h.runId,
      platform: "instagram",
      connectionId: "buffer-conn",
      organizationId: "e".repeat(24),
      campaign: "Synthetic native linkage",
      channelId,
      text: "Synthetic approved content",
      mode: "addToQueue",
      revision: 2,
      status: "sent",
      bufferPostId: "f".repeat(24),
      approvedAt: now - 3000,
      createdAt: now - 4000,
      updatedAt: now,
      publicationReceipt: {
        source: "buffer-status-v1",
        bufferPostId: "f".repeat(24),
        channelId,
        platform: "instagram",
        nativeAccountId: "native-owner",
        nativePostId: null,
        nativePostUrl,
        draftRevision: 2,
        approvedAt: now - 3000,
        sentAt: now - 2000,
        observedAt: now - 1000,
      },
    });
    return connectionId;
  });
  const value = report(0, now),
    nativePost = value.accounts[0]?.posts[0];
  if (!nativePost) throw new Error("post fixture missing");
  nativePost.nativePostUrl = nativePostUrl;
  expect(await complete(h, value)).toBe(true);
  const linked = await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId });
  expect(linked.social[0]?.publisherAttribution).toBe("buffer_receipt_linked");
  expect(linked.social[0]?.evidence?.metrics.likes).toBe(0);
  await h.t.run((ctx) => ctx.db.patch(bufferConnection, { selectedChannelIds: [] }));
  const withdrawn = await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId });
  expect(withdrawn.social[0]?.publisherAttribution).toBe("unverified");
  expect(withdrawn.social[0]?.evidence).toBeNull();
});
test("stale completion and duplicate native accounts cannot invent accepted history", async () => {
  const h = await setup();
  expect(await complete(h, report(1), 2)).toBe(false);
  const malformed = report(1);
  const duplicateAccount = malformed.accounts[0];
  if (!duplicateAccount) throw new Error("missing fixture account");
  malformed.accounts.push(duplicateAccount);
  await expect(complete(h, malformed)).rejects.toThrow();
  expect(await h.t.run((ctx) => ctx.db.query("serviceOutcomeObservations").collect())).toHaveLength(
    0,
  );
});
test("goal binding is user-scoped CAS, fences old execution and never achieves a goal", async () => {
  const h = await setup();
  const args = {
    serviceId: h.serviceId,
    goalId: h.goalId,
    expectedRevision: 1,
    expectedControlRevision: 1,
  };
  await expect(h.b.mutation(api.serviceOutcomes.bindGoal, args)).rejects.toThrow(
    "SERVICE_GOAL_UNAVAILABLE",
  );
  expect(await h.a.mutation(api.serviceOutcomes.bindGoal, args)).toEqual({
    revision: 2,
    controlRevision: 2,
  });
  await expect(h.a.mutation(api.serviceOutcomes.bindGoal, args)).rejects.toThrow(
    "SERVICE_CONFIGURATION_STALE",
  );
  expect(await h.t.run((ctx) => ctx.db.get(h.goalId))).toMatchObject({ status: "active" });
  expect(
    (await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId })).reporting.state,
  ).toBe("unavailable");
});
test("only user feedback distinguishes usefulness, foreign and unresolved runs refuse", async () => {
  const h = await setup();
  await expect(h.b.query(api.serviceOutcomes.runOutcome, { runId: h.runId })).rejects.toThrow();
  await expect(
    h.b.mutation(api.serviceOutcomes.recordUsefulness, { runId: h.runId, usefulness: "accepted" }),
  ).rejects.toThrow();
  await h.a.mutation(api.serviceOutcomes.recordUsefulness, {
    runId: h.runId,
    usefulness: "accepted",
  });
  expect((await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId })).usefulness).toBe(
    "accepted",
  );
  await h.t.run((ctx) => ctx.db.patch(h.runId, { state: "unknown" }));
  await expect(
    h.a.mutation(api.serviceOutcomes.recordUsefulness, { runId: h.runId, usefulness: "rejected" }),
  ).rejects.toThrow("SERVICE_RESULT_UNRESOLVED");
});
test("history is retained to30, cursor paged, exportable/erasable, and source withdrawal invalidates reads", async () => {
  const h = await setup();
  for (let n = 0; n < 32; n++) await complete(h, report(n));
  expect(await h.t.run((ctx) => ctx.db.query("serviceOutcomeObservations").collect())).toHaveLength(
    30,
  );
  const page = await h.a.query(api.serviceOutcomes.historyPage, {
    connectionId: "conn",
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(page.page).toHaveLength(2);
  expect(page.isDone).toBe(false);
  const next = await h.a.query(api.serviceOutcomes.historyPage, {
    connectionId: "conn",
    paginationOpts: { numItems: 2, cursor: page.continueCursor },
  });
  expect(next.page[0]?._id).not.toBe(page.page[0]?._id);
  await expect(
    h.b.query(api.serviceOutcomes.historyPage, {
      connectionId: "conn",
      paginationOpts: { numItems: 2, cursor: null },
    }),
  ).rejects.toThrow();
  expect(exportableTables()).toContain("serviceOutcomeObservations");
  expect(deletableTables()).toContain("serviceOutcomeObservations");
  await h.t.run((ctx) => ctx.db.patch(h.connection, { status: "disconnected" }));
  expect(
    (await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId })).reporting.state,
  ).toBe("unavailable");
  await expect(
    h.a.query(api.serviceOutcomes.historyPage, {
      connectionId: "conn",
      paginationOpts: { numItems: 2, cursor: null },
    }),
  ).rejects.toThrow("SERVICE_SOURCE_UNAVAILABLE");
});

test("brain view preserves publication confirmation time, rejects agent relabeling, and invalidates withdrawn evidence", async () => {
  const h = await setup();
  const initial = await h.a.query(api.serviceOutcomes.serviceBrainView, {
    serviceId: "social-marketing",
  });
  expect(initial?.nextActions).toContain("provide_business_profile");
  expect(
    await h.b.query(api.serviceOutcomes.serviceBrainView, { serviceId: "social-marketing" }),
  ).toBeNull();
  const text = "User reviewed foundation snapshot",
    confirmedAt = Date.now() - 40 * 86400000;
  const docId = await h.t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "a",
      kind: "business_profile",
      category: "workspace-docs",
      source: "agent",
      title: "Profile",
      text,
      contentHash: await contentHash(text),
      mimeType: "text/markdown",
      size: text.length,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  let view = await h.a.query(api.serviceOutcomes.serviceBrainView, {
    serviceId: "social-marketing",
  });
  expect(view?.profile).toMatchObject({
    authority: "source_only",
    confirmedAt: null,
    freshness: "unknown",
  });
  await h.t.run(async (ctx) =>
    ctx.db.insert("foundationRevisions", {
      tenantId: "a",
      revision: 1,
      profile: emptyFoundationProfile(),
      slots: {},
      answers: [],
      docIds: [docId],
      documents: [{ section: "essentials", title: "Profile", kind: "business_profile", text }],
      createdAt: confirmedAt,
    }),
  );
  view = await h.a.query(api.serviceOutcomes.serviceBrainView, { serviceId: "social-marketing" });
  expect(view?.profile).toMatchObject({
    authority: "user_published_snapshot",
    confirmedAt,
    freshness: "stale",
    sourceObservedAt: null,
  });
  expect(view?.nextActions).toContain("refresh_business_profile");
  await h.t.run((ctx) =>
    ctx.db.patch(docId, { text: "Agent rewrote it", contentHash: "f".repeat(64) }),
  );
  expect(
    (await h.a.query(api.serviceOutcomes.serviceBrainView, { serviceId: "social-marketing" }))
      ?.profile?.authority,
  ).toBe("source_only");
  await h.t.run((ctx) => ctx.db.delete(docId));
  expect(
    (await h.a.query(api.serviceOutcomes.serviceBrainView, { serviceId: "social-marketing" }))
      ?.profile,
  ).toBeNull();
});

test("current source failure/withdrawal and invalid revision fences never become successful business movement", async () => {
  const h = await setup();
  await complete(h, report(0));
  await complete(h, report(1));
  await h.t.run((ctx) => ctx.db.patch(h.connection, { lastFailure: "rate_limited" }));
  const outcome = await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId });
  expect(outcome.reporting).toMatchObject({ state: "stale", sourceFailure: true, movement: null });
  expect(outcome.businessImprovement).toBe("not_established");
  await h.t.run((ctx) =>
    ctx.db.patch(h.connection, { selectedAccountIds: [], lastFailure: undefined }),
  );
  expect(
    (await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId })).reporting.state,
  ).toBe("unavailable");
  expect(
    (
      await h.a.query(api.serviceOutcomes.historyPage, {
        connectionId: "conn",
        paginationOpts: { numItems: 2, cursor: null },
      })
    ).page,
  ).toEqual([]);
  await h.t.run((ctx) => ctx.db.patch(h.serviceId, { revision: Number.MAX_SAFE_INTEGER }));
  await expect(
    h.a.mutation(api.serviceOutcomes.bindGoal, {
      serviceId: h.serviceId,
      goalId: h.goalId,
      expectedRevision: Number.MAX_SAFE_INTEGER,
      expectedControlRevision: 1,
    }),
  ).rejects.toThrow("SERVICE_CONFIGURATION_STALE");
});

test("native run lineage joins owned publication records without inventing a cross-provider mapping", async () => {
  const h = await setup();
  await complete(h, report(0));
  const now = Date.now();
  const draftRef = await h.t.run((ctx) =>
    ctx.db.insert("bufferPosts", {
      tenantId: "a",
      managedServiceRunId: h.runId,
      connectionId: "buffer-conn",
      organizationId: "organization",
      campaign: "Campaign",
      channelId: accountId,
      platform: "instagram",
      text: "Approved copy",
      mode: "addToQueue",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      status: "sent",
      approvedAt: now,
      bufferPostId: "c".repeat(24),
    }),
  );
  const outcome = await h.a.query(api.serviceOutcomes.runOutcome, { runId: h.runId });
  expect(outcome.social).toHaveLength(1);
  expect(outcome.social[0]).toMatchObject({
    draftRef,
    publisherAttribution: "unverified",
    evidence: null,
    businessImprovement: "not_established",
    nextAction: "verify_native_mapping",
  });
  expect(outcome.social[0]?.reporting.reasons).toContain("native_mapping_unavailable");
  await expect(h.b.query(api.serviceOutcomes.runOutcome, { runId: h.runId })).rejects.toThrow(
    "SERVICE_RUN_UNAVAILABLE",
  );
});
