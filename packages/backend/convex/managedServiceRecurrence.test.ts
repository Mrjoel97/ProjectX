import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { confirmServiceKnowledgeFixture } from "../__fixtures__/serviceKnowledge";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { rateLimiter } from "./guardrails";
import { contentHash } from "./lib/hash";
import {
  claimStandingOccurrence,
  configureStandingService,
  settleStandingOccurrence,
  suspendStandingService,
  tickStandingService,
} from "./managedServiceRecurrence";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const now = Date.parse("2026-11-01T05:30:00Z");
beforeEach(() => {
  vi.stubEnv("FOUNDATION_ONBOARDING_ENABLED", "1");
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "rateLimiter",
    rateLimiterSchema,
    import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts"),
  );
  t.registerComponent(
    "auditCounts",
    aggregateSchema,
    import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts"),
  );
  const body = "Synthetic exact registry instructions";
  const bodyHash = await contentHash(body);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("users", {});
    const skillId = await ctx.db.insert("skills", {
      name: "cockpit-agent",
      version: 1,
      body,
      status: "active",
      createdAt: now,
      evidence: JSON.stringify({ pass: true, skillVersions: { "cockpit-agent": 1 } }),
    });
    const accountId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const accounts = [
      {
        provider: "buffer" as const,
        connectionId: "connection",
        accountId,
        connectionRevision: 1,
      },
    ];
    const skills = [{ skillId, name: "cockpit-agent", version: 1, bodyHash, tenantId: null }];
    const connectionId = await ctx.db.insert("bufferConnections", {
      tenantId,
      connectionId: "connection",
      revision: 1,
      grantRevision: 1,
      status: "connected",
      keyVersion: "v1",
      ciphertextB64: "synthetic-not-a-token",
      ivB64: "synthetic",
      expiresAt: now + 86400_000,
      updatedAt: now,
      organizationId: "org",
      channels: [{ id: accountId, name: "Synthetic", service: "instagram", available: true }],
      selectedChannelIds: [accountId],
      dailyReports: false,
      nextReportAt: 0,
    });
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId,
      serviceId: "social-marketing",
      revision: 1,
      controlRevision: 1,
      controlState: "active",
      goal: "Prepare synthetic content",
      operationIds: ["social.prepare"],
      accounts,
      skills,
      budgetLimitCents: 40,
      createdAt: now,
      updatedAt: now,
    });
    const approvalId = await ctx.db.insert("managedServiceStandingApprovals", {
      tenantId,
      serviceId,
      revision: 1,
      configRevision: 1,
      expiresAtMs: now + 7 * 86400_000,
      terms: {
        goalHash: await contentHash("Prepare synthetic content"),
        operationIds: ["social.prepare"],
        skillPins: skills,
        recipientRefs: [],
        accountPins: accounts,
        budgetLimitCents: 40,
        schedule: {
          cadence: "daily",
          weekday: null,
          hour: 1,
          minute: 30,
          timeZone: "America/New_York",
        },
      },
      createdAt: now,
    });
    return { tenantId, serviceId, approvalId, connectionId, skillId };
  });
  await confirmServiceKnowledgeFixture(t, ids.tenantId);
  const args = {
    tenantId: ids.tenantId,
    approvalId: ids.approvalId,
    expectedControlRevision: 1,
    localDate: "2026-11-01",
    requestedLocalTime: "01:30",
    timeZone: "America/New_York",
    dueAtMs: now,
  };
  // Explicit future-capability fixture, only inside native local test transactions. The callable
  // endpoint has no admitted argument and remains hard false without any environment override.
  const claim = (overrides: Partial<typeof args> = {}) =>
    t.run((ctx) => claimStandingOccurrence(ctx, { ...args, ...overrides }, { admitted: true }));
  const rows = () => t.run((ctx) => ctx.db.query("managedServiceOccurrences").collect());
  const ledger = () => t.run((ctx) => ctx.db.query("spendEvents").collect());
  return { t, ...ids, args, claim, rows, ledger };
}

test("the native endpoint remains inert even with persisted future-capability fixtures", async () => {
  const f = await fixture();
  expect(await f.t.mutation(internal.managedServiceRecurrence.claim, f.args)).toEqual({
    decision: "admission_deferred",
    occurrenceId: null,
  });
  expect(await f.rows()).toHaveLength(0);
  expect(await f.ledger()).toHaveLength(0);
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
});

async function configured(f: Awaited<ReturnType<typeof fixture>>, expiresAtMs = now + 86400_000) {
  const previous = await f.t.run((ctx) =>
    ctx.db
      .query("managedServiceStandingApprovals")
      .withIndex("by_service_revision", (q) =>
        q.eq("tenantId", f.tenantId).eq("serviceId", f.serviceId),
      )
      .order("desc")
      .first(),
  );
  return f.t.run((ctx) =>
    configureStandingService(
      ctx,
      {
        tenantId: f.tenantId,
        serviceId: "social-marketing",
        expectedRevision: 1,
        expectedControlRevision: 1,
        expectedApprovalRevision: previous?.revision ?? 0,
        schedule: {
          cadence: "daily",
          weekday: null,
          hour: 1,
          minute: 31,
          timeZone: "America/New_York",
        },
        expiresAtMs,
      },
      { admitted: true },
    ),
  );
}

test("explicit approval snapshots exact scope, arms once, and remains tenant-scoped", async () => {
  const f = await fixture();
  const approval = await configured(f);
  expect(approval).toMatchObject({
    revision: 2,
    enabled: true,
    configRevision: 1,
    controlRevision: 1,
    budgetLimitCents: 40,
    nextDueAtMs: now + 60_000,
  });
  const persisted = await f.t.run((ctx) => ctx.db.get(approval.approvalId));
  expect(persisted?.terms.recipientRefs).toEqual([]);
  expect(persisted?.terms.operationIds).toEqual(["social.prepare"]);
  const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.filter((row) => row.state.kind === "pending")).toHaveLength(1);
  expect(await f.ledger()).toHaveLength(0);
  await expect(
    f.t.run((ctx) =>
      configureStandingService(
        ctx,
        {
          tenantId: "foreign",
          serviceId: "social-marketing",
          expectedRevision: 1,
          expectedControlRevision: 1,
          schedule: approval.schedule,
          expiresAtMs: now + 86400_000,
        },
        { admitted: true },
      ),
    ),
  ).rejects.toThrow("STANDING_SERVICE_UNAVAILABLE");
});

test("atomic due tick claims one full envelope, one linked native run and the next local day", async () => {
  const f = await fixture();
  const approval = await configured(f, now + 3 * 86400_000);
  vi.setSystemTime(now + 60_000);
  const args = {
    tenantId: f.tenantId,
    approvalId: approval.approvalId,
    expectedApprovalRevision: approval.revision,
    expectedControlRevision: 1,
    expectedDueAtMs: now + 60_000,
  };
  const [a, b] = await Promise.all([
    f.t.run((ctx) => tickStandingService(ctx, args, { admitted: true })),
    f.t.run((ctx) => tickStandingService(ctx, args, { admitted: true })),
  ]);
  expect([a.decision, b.decision].sort()).toEqual(["claimable", "stale_callback"]);
  const runs = await f.t.run((ctx) => ctx.db.query("managedServiceRuns").collect());
  const occurrences = await f.rows();
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    state: "claimed",
    knowledgeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    standingOccurrenceId: occurrences[0]?._id,
    standingApprovalId: approval.approvalId,
  });
  expect(occurrences).toHaveLength(1);
  expect(occurrences[0]?.runId).toBe(runs[0]?._id);
  expect((await f.ledger()).filter((row) => row.phase === "reserved")).toHaveLength(1);
  const next = await f.t.run((ctx) => ctx.db.get(approval.approvalId));
  // Fall-back's second 01:31 never gets another run. The following local day is25 elapsed hours.
  expect(next?.nextDueAtMs).toBe(Date.parse("2026-11-02T06:31:00Z"));
});

test("withdrawn confirmed knowledge stops a due callback before run creation or whole-budget reservation", async () => {
  const f = await fixture();
  const approval = await configured(f);
  await f.t.run(async (ctx) => {
    const interview = await ctx.db
      .query("foundationInterviews")
      .withIndex("by_tenant", (q) => q.eq("tenantId", f.tenantId))
      .unique();
    if (!interview) throw new Error("fixture knowledge missing");
    await ctx.db.patch(interview._id, { answers: [] });
  });
  vi.setSystemTime(now + 60_000);
  expect(
    await f.t.run((ctx) =>
      tickStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          approvalId: approval.approvalId,
          expectedApprovalRevision: approval.revision,
          expectedControlRevision: 1,
          expectedDueAtMs: now + 60_000,
        },
        { admitted: true },
      ),
    ),
  ).toEqual({ decision: "approval_stale", runId: null });
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({ enabled: false });
  expect(await f.t.run((ctx) => ctx.db.query("managedServiceRuns").collect())).toHaveLength(0);
  expect(await f.rows()).toHaveLength(0);
  expect(await f.ledger()).toHaveLength(0);
});

test("late callbacks persist a missed occurrence and skip forward without a catch-up burst", async () => {
  const f = await fixture();
  const approval = await configured(f, now + 7 * 86400_000);
  vi.setSystemTime(now + 2 * 86400_000);
  expect(
    await f.t.run((ctx) =>
      tickStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          approvalId: approval.approvalId,
          expectedApprovalRevision: approval.revision,
          expectedControlRevision: 1,
          expectedDueAtMs: now + 60_000,
        },
        { admitted: true },
      ),
    ),
  ).toMatchObject({ decision: "skipped_missed", runId: null });
  expect(await f.ledger()).toHaveLength(0);
  expect(await f.rows()).toMatchObject([{ state: "skipped_missed" }]);
  expect((await f.t.run((ctx) => ctx.db.get(approval.approvalId)))?.nextDueAtMs).toBeGreaterThan(
    Date.now(),
  );
});

test("suspension cancels the pending callback; reconnect cannot revive the old approval", async () => {
  const f = await fixture();
  const approval = await configured(f);
  await f.t.run((ctx) =>
    suspendStandingService(ctx, {
      tenantId: f.tenantId,
      serviceId: f.serviceId,
      reason: "authorization_required",
    }),
  );
  await f.t.run((ctx) => ctx.db.patch(f.connectionId, { status: "connected" }));
  vi.setSystemTime(now + 60_000);
  expect(
    await f.t.run((ctx) =>
      tickStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          approvalId: approval.approvalId,
          expectedApprovalRevision: approval.revision,
          expectedControlRevision: 1,
          expectedDueAtMs: now + 60_000,
        },
        { admitted: true },
      ),
    ),
  ).toMatchObject({ decision: "stale_callback" });
  expect(await f.rows()).toHaveLength(0);
  expect(await f.ledger()).toHaveLength(0);
  const next = await configured(f, now + 3 * 86400_000);
  expect(next.revision).toBe(approval.revision + 1);
  expect(next.approvalId).not.toBe(approval.approvalId);
});

test("final occurrence remains authorized until actual expiry; no due work is armed beyond it", async () => {
  const f = await fixture();
  const approval = await configured(f, now + 2 * 60_000);
  vi.setSystemTime(now + 60_000);
  expect(
    await f.t.run((ctx) =>
      tickStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          approvalId: approval.approvalId,
          expectedApprovalRevision: approval.revision,
          expectedControlRevision: 1,
          expectedDueAtMs: now + 60_000,
        },
        { admitted: true },
      ),
    ),
  ).toMatchObject({ decision: "claimable" });
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({ enabled: true });
  expect((await f.t.run((ctx) => ctx.db.get(approval.approvalId)))?.nextDueAtMs).toBeUndefined();
  vi.setSystemTime(now + 2 * 60_000);
  await f.t.mutation(internal.managedServiceRecurrence.expire, {
    tenantId: f.tenantId,
    approvalId: approval.approvalId,
    expectedApprovalRevision: approval.revision,
  });
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({
    enabled: false,
    suspensionReason: "expired",
  });
});

test("release qualification and maximum approval expiry refuse before arming", async () => {
  const f = await fixture();
  await expect(
    f.t.run((ctx) =>
      configureStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          serviceId: "social-marketing",
          expectedRevision: 1,
          expectedControlRevision: 1,
          schedule: {
            cadence: "daily",
            weekday: null,
            hour: 1,
            minute: 31,
            timeZone: "America/New_York",
          },
          expiresAtMs: now + 86400_000,
        },
        { admitted: false },
      ),
    ),
  ).rejects.toThrow("STANDING_SERVICE_QUALIFICATION_REQUIRED");
  await expect(configured(f, now + 31 * 86400_000)).rejects.toThrow(
    "STANDING_SERVICE_EXPIRY_INVALID",
  );
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
});

test("stale configuration cannot replace a newer approval or cancel its timer", async () => {
  const f = await fixture();
  const approval = await configured(f);
  await expect(
    f.t.run((ctx) =>
      configureStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          serviceId: "social-marketing",
          expectedRevision: 1,
          expectedControlRevision: 1,
          expectedApprovalRevision: approval.revision - 1,
          schedule: approval.schedule,
          expiresAtMs: now + 86400_000,
        },
        { admitted: true },
      ),
    ),
  ).rejects.toThrow("STANDING_SERVICE_APPROVAL_CHANGED");
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({
    enabled: true,
    revision: approval.revision,
  });
  const pending = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(pending.filter((row) => row.state.kind === "pending")).toHaveLength(1);
  expect(await f.ledger()).toHaveLength(0);
});

test("binding a new business goal disables the old approval and its scheduled callback", async () => {
  const f = await fixture();
  const approval = await configured(f);
  const goalId = await f.t.run((ctx) =>
    ctx.db.insert("goals", {
      tenantId: f.tenantId,
      segmentId: "leads",
      text: "More qualified enquiries",
      status: "active",
      createdAt: now,
      statusChangedAt: now,
    }),
  );
  await f.t
    .withIdentity({ subject: `${f.tenantId}|fixture` })
    .mutation(api.serviceOutcomes.bindGoal, {
      serviceId: f.serviceId,
      goalId,
      expectedRevision: 1,
      expectedControlRevision: 1,
    });
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({
    enabled: false,
    suspensionReason: "approval_stale",
    revision: approval.revision,
    configRevision: 1,
    controlRevision: 1,
  });
  vi.setSystemTime(now + 60_000);
  expect(
    await f.t.run((ctx) =>
      tickStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          approvalId: approval.approvalId,
          expectedApprovalRevision: approval.revision,
          expectedControlRevision: 1,
          expectedDueAtMs: now + 60_000,
        },
        { admitted: true },
      ),
    ),
  ).toEqual({ decision: "stale_callback", runId: null });
  expect(await f.rows()).toHaveLength(0);
  expect(await f.ledger()).toHaveLength(0);
  const pending = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(pending.filter((row) => row.state.kind === "pending")).toHaveLength(0);
});

test("unknown run or occurrence blocks fresh approval until recovery closes, then requires explicit configure", async () => {
  const f = await fixture();
  const approval = await configured(f);
  await f.t.run((ctx) =>
    suspendStandingService(ctx, {
      tenantId: f.tenantId,
      serviceId: f.serviceId,
      reason: "reconciliation_required",
    }),
  );
  const runId = await f.t.run((ctx) =>
    ctx.db.insert("managedServiceRuns", {
      tenantId: f.tenantId,
      serviceId: f.serviceId,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: 40,
      requestKey: "unknown-admission-fixture",
      state: "unknown",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const pendingCount = () =>
    f.t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (row) => row.state.kind === "pending",
        ).length,
    );
  await expect(configured(f)).rejects.toThrow("STANDING_SERVICE_RECONCILIATION_REQUIRED");
  expect(await pendingCount()).toBe(0);
  // Supply a definitively stopped attended-run fixture; native recovery semantics are covered
  // separately by managedServiceRecovery.test.ts. This test owns schedule admission only.
  await f.t.run((ctx) => ctx.db.patch(runId, { state: "stopped" }));
  const { occurrenceId } = await f.claim();
  if (!occurrenceId) throw new Error("fixture claim failed");
  const reconcile = (effectsKnown: boolean) =>
    f.t.run((ctx) =>
      settleStandingOccurrence(ctx, {
        tenantId: f.tenantId,
        occurrenceId,
        knownSpentCents: 0,
        unknownHoldCents: 0,
        outcome: "execution_uncertain",
        effectsKnown,
      }),
    );
  expect(await reconcile(false)).toMatchObject({ state: "unknown" });
  await expect(configured(f)).rejects.toThrow("STANDING_SERVICE_RECONCILIATION_REQUIRED");
  expect(await pendingCount()).toBe(0);
  expect(await reconcile(true)).toMatchObject({ state: "terminal" });
  expect(await pendingCount()).toBe(0);
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({
    enabled: false,
    revision: approval.revision,
  });
  const fresh = await configured(f);
  expect(fresh.revision).toBe(approval.revision + 1);
  expect(fresh.approvalId).not.toBe(approval.approvalId);
  expect(fresh.enabled).toBe(true);
  expect(await pendingCount()).toBe(1);
});

test("withdrawing release admission suspends a previously armed callback before any spend", async () => {
  const f = await fixture();
  const approval = await configured(f);
  vi.setSystemTime(now + 60_000);
  expect(
    await f.t.run((ctx) =>
      tickStandingService(
        ctx,
        {
          tenantId: f.tenantId,
          approvalId: approval.approvalId,
          expectedApprovalRevision: approval.revision,
          expectedControlRevision: 1,
          expectedDueAtMs: now + 60_000,
        },
        { admitted: false },
      ),
    ),
  ).toEqual({ decision: "admission_deferred", runId: null });
  expect(await f.t.run((ctx) => ctx.db.get(approval.approvalId))).toMatchObject({
    enabled: false,
    suspensionReason: "qualification_required",
  });
  expect(await f.rows()).toHaveLength(0);
  expect(await f.ledger()).toHaveLength(0);
});

test("concurrent claims and both DST fold instants persist one occurrence and one whole-run hold", async () => {
  const f = await fixture();
  const results = await Promise.all([f.claim(), f.claim()]);
  expect(results.map((r) => r.decision).sort()).toEqual(["claimable", "duplicate"]);
  expect(results[0].occurrenceId).toBe(results[1].occurrenceId);
  vi.setSystemTime(now + 3600_000);
  expect(await f.claim({ dueAtMs: now + 3600_000 })).toMatchObject({ decision: "duplicate" });
  expect(await f.rows()).toHaveLength(1);
  expect(await f.ledger()).toMatchObject([
    { phase: "reserved", amountCents: 40, kind: "standing_service" },
  ]);
  expect(
    await f.t.run((ctx) => rateLimiter.getValue(ctx, "dailySpendCents", { key: f.tenantId })),
  ).toMatchObject({ value: 460 });
});

test("missed and overlapping occurrences persist skip receipts without reserving or bursting", async () => {
  const f = await fixture();
  expect(await f.claim({ localDate: "2026-10-31", dueAtMs: now - 86400_000 })).toMatchObject({
    decision: "skipped_missed",
  });
  expect(await f.claim()).toMatchObject({ decision: "claimable" });
  vi.setSystemTime(now + 86400_000);
  expect(await f.claim({ localDate: "2026-11-02", dueAtMs: now + 86400_000 })).toMatchObject({
    decision: "skipped_overlap",
  });
  expect((await f.rows()).map((r) => r.state).sort()).toEqual([
    "claimed",
    "skipped_missed",
    "skipped_overlap",
  ]);
  expect(await f.ledger()).toHaveLength(1);
});

test("native material, skill, tenant and control fences reject before a reservation", async () => {
  for (const changed of ["goal", "budget", "skill", "control", "tenant", "revision"] as const) {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      if (changed === "goal") await ctx.db.patch(f.serviceId, { goal: "Changed instructions" });
      if (changed === "budget") await ctx.db.patch(f.serviceId, { budgetLimitCents: 50 });
      if (changed === "skill") await ctx.db.patch(f.skillId, { body: "Changed registry body" });
      if (changed === "control") await ctx.db.patch(f.serviceId, { controlRevision: 2 });
      if (changed === "tenant") await ctx.db.patch(f.serviceId, { tenantId: "other" });
      if (changed === "revision") await ctx.db.patch(f.serviceId, { revision: 2 });
    });
    if (changed === "tenant")
      await expect(f.claim()).rejects.toThrow("STANDING_SERVICE_UNAVAILABLE");
    else
      expect(await f.claim()).toMatchObject({
        decision: changed === "control" ? "control_changed" : "approval_stale",
      });
    expect(await f.ledger()).toHaveLength(0);
    expect(await f.rows()).toHaveLength(0);
  }
});

test("authorization lapse suspends its approval; reconnecting cannot automatically resume it", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.connectionId, { status: "reauth_required" }));
  expect(await f.claim()).toMatchObject({ decision: "authorization_required" });
  await f.t.run((ctx) => ctx.db.patch(f.connectionId, { status: "connected" }));
  expect(await f.claim()).toMatchObject({ decision: "authorization_required" });
  expect(await f.t.run((ctx) => ctx.db.get(f.approvalId))).toMatchObject({
    suspendedAtMs: now,
    suspensionReason: "authorization_required",
  });
  expect(await f.ledger()).toHaveLength(0);
});

test("settlement after pause retains unknown usage, late reconciliation releases only unused allowance once", async () => {
  const f = await fixture();
  const { occurrenceId } = await f.claim();
  if (!occurrenceId) throw new Error("fixture claim failed");
  await f.t
    .withIdentity({ subject: `${f.tenantId}|fixture` })
    .mutation(api.managedServices.setControl, {
      serviceId: "social-marketing",
      expectedRevision: 1,
      expectedControlRevision: 1,
      action: "pause",
    });
  const settle = (knownSpentCents: number, unknownHoldCents: number) =>
    f.t.run((ctx) =>
      settleStandingOccurrence(ctx, {
        tenantId: f.tenantId,
        occurrenceId,
        knownSpentCents,
        unknownHoldCents,
        outcome: "execution_uncertain",
        effectsKnown: true,
      }),
    );
  expect(await settle(10, 20)).toMatchObject({
    state: "unknown",
    budget: {
      capCents: 40,
      knownSpentCents: 10,
      heldCents: 20,
      releasedCents: 10,
    },
  });
  expect(await settle(10, 20)).toMatchObject({ state: "unknown" });
  await f.t.run((ctx) => ctx.db.patch(f.serviceId, { controlState: "active" }));
  vi.setSystemTime(now + 86400_000);
  expect(
    await f.claim({
      expectedControlRevision: 2,
      localDate: "2026-11-02",
      dueAtMs: now + 86400_000,
    }),
  ).toMatchObject({ decision: "reconciliation_required" });
  expect(await settle(25, 0)).toMatchObject({
    state: "terminal",
    budget: {
      knownSpentCents: 25,
      heldCents: 0,
      releasedCents: 15,
      terminalOutcome: "execution_uncertain",
    },
  });
  expect(await settle(25, 0)).toMatchObject({ state: "terminal" });
  const ledger = await f.ledger();
  expect(ledger.filter((r) => r.phase === "actual").reduce((n, r) => n + r.amountCents, 0)).toBe(
    25,
  );
  expect(ledger.filter((r) => r.phase === "refunded").reduce((n, r) => n + r.amountCents, 0)).toBe(
    15,
  );
  await expect(settle(26, 0)).rejects.toThrow("STANDING_SETTLEMENT_MISMATCH");
  expect(await f.rows()).toHaveLength(1);
});

test("whole-run reservation fails atomically when the existing tenant spend rail cannot cover the cap", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    rateLimiter.limit(ctx, "dailySpendCents", { key: f.tenantId, count: 480, reserve: true }),
  );
  await expect(f.claim()).rejects.toThrow("STANDING_SERVICE_BUDGET_UNAVAILABLE");
  expect(await f.rows()).toHaveLength(0);
  expect(await f.ledger()).toHaveLength(0);
});

test("a trusted late overrun remains charged and held without replay or reclaiming released allowance", async () => {
  const f = await fixture();
  const { occurrenceId } = await f.claim();
  if (!occurrenceId) throw new Error("fixture claim failed");
  const settle = (knownSpentCents: number, unknownHoldCents: number) =>
    f.t.run((ctx) =>
      settleStandingOccurrence(ctx, {
        tenantId: f.tenantId,
        occurrenceId,
        knownSpentCents,
        unknownHoldCents,
        outcome: "execution_uncertain",
        effectsKnown: true,
      }),
    );
  expect(await settle(45, 10)).toMatchObject({
    state: "unknown",
    budget: {
      capCents: 40,
      knownSpentCents: 45,
      heldCents: 10,
      releasedCents: 0,
      overrunCents: 15,
    },
  });
  expect(await settle(50, 0)).toMatchObject({
    state: "terminal",
    budget: {
      knownSpentCents: 50,
      heldCents: 0,
      releasedCents: 5,
      overrunCents: 15,
    },
  });
  expect(
    await f.t.run((ctx) => rateLimiter.getValue(ctx, "dailySpendCents", { key: f.tenantId })),
  ).toMatchObject({ value: 450 });
  expect(await f.rows()).toHaveLength(1);
  expect((await f.ledger()).filter((r) => r.phase === "reserved")).toHaveLength(1);
});

test("known zero completion releases the cap once and foreign settlement cannot alter the receipts", async () => {
  const f = await fixture();
  const { occurrenceId } = await f.claim();
  if (!occurrenceId) throw new Error("fixture claim failed");
  const args = {
    tenantId: f.tenantId,
    occurrenceId,
    knownSpentCents: 0,
    unknownHoldCents: 0,
    outcome: "completed" as const,
    effectsKnown: true,
  };
  await expect(
    f.t.run((ctx) => settleStandingOccurrence(ctx, { ...args, tenantId: "foreign" })),
  ).rejects.toThrow("STANDING_SERVICE_UNAVAILABLE");
  expect(await f.t.run((ctx) => settleStandingOccurrence(ctx, args))).toMatchObject({
    state: "terminal",
    budget: { knownSpentCents: 0, releasedCents: 40, heldCents: 0 },
  });
  await f.t.run((ctx) => settleStandingOccurrence(ctx, args));
  expect((await f.ledger()).filter((r) => r.phase === "refunded")).toHaveLength(1);
  expect(
    await f.t.run((ctx) => rateLimiter.getValue(ctx, "dailySpendCents", { key: f.tenantId })),
  ).toMatchObject({ value: 500 });
});

test("known costs do not close uncertain effects or admit a later occurrence until explicit reconciliation", async () => {
  const f = await fixture();
  const { occurrenceId } = await f.claim();
  if (!occurrenceId) throw new Error("fixture claim failed");
  const args = {
    tenantId: f.tenantId,
    occurrenceId,
    knownSpentCents: 5,
    unknownHoldCents: 0,
    outcome: "execution_uncertain" as const,
  };
  expect(
    await f.t.run((ctx) => settleStandingOccurrence(ctx, { ...args, effectsKnown: false })),
  ).toMatchObject({ state: "unknown", budget: { heldCents: 0, knownSpentCents: 5 } });
  vi.setSystemTime(now + 86400_000);
  expect(await f.claim({ localDate: "2026-11-02", dueAtMs: now + 86400_000 })).toMatchObject({
    decision: "reconciliation_required",
  });
  const before = await f.ledger();
  expect(
    await f.t.run((ctx) => settleStandingOccurrence(ctx, { ...args, effectsKnown: true })),
  ).toMatchObject({ state: "terminal" });
  expect(await f.ledger()).toEqual(before);
});
