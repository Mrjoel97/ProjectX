import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { rateLimiter } from "./guardrails";
import { contentHash } from "./lib/hash";
import { claimStandingOccurrence, settleStandingOccurrence } from "./managedServiceRecurrence";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const now = Date.parse("2026-11-01T05:30:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

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
    const accounts = [
      {
        provider: "buffer" as const,
        connectionId: "connection",
        accountId: "aaaaaaaaaaaaaaaaaaaaaaaa",
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
      channels: [
        { id: accounts[0].accountId, name: "Synthetic", service: "instagram", available: true },
      ],
      selectedChannelIds: [accounts[0].accountId],
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
