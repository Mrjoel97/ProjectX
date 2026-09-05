import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { PACK_EVENT_PAGE_MAX } from "./workflowPackEventLog";
import { PACK_RUN_JOIN_MAX } from "./workflowPackOutcomes";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "user_a";
const OTHER = "user_b";

// Fixed reference instant + an explicit window so every case is deterministic
// (the handler's Date.now() default is exercised only when sinceMs is omitted).
const NOW = 1_800_000_000_000;
const SINCE = NOW - 7 * 24 * 60 * 60 * 1000;

type T = ReturnType<typeof convexTest>;

/** Seed one requests row (telemetry.requestId must reference a real row). */
async function seedRequest(t: T, tenantId: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("requests", {
      tenantId,
      correlationId: `cid-${crypto.randomUUID()}`,
      goal: "goal",
      recipient: "r@example.com",
      status: "sent",
      attachmentRefs: [],
      createdAt: NOW,
    }),
  );
}

/** Seed a telemetry row (raw db.insert — bypasses the write path, audit.test.ts precedent). */
async function seedTelemetry(
  t: T,
  tenantId: string,
  requestId: Awaited<ReturnType<typeof seedRequest>>,
  over: Partial<{
    decisionCounts: Record<string, number>;
    regenerateCount: number;
    costUsd: number;
    reviewOutcome: string;
    createdAt: number;
  }> = {},
) {
  await t.run(async (ctx) =>
    ctx.db.insert("telemetry", {
      tenantId,
      correlationId: `cid-${crypto.randomUUID()}`,
      requestId,
      tokensIn: 10,
      tokensOut: 20,
      durationMs: 50,
      decisionCounts: {},
      regenerateCount: 0,
      costUsd: 0,
      reviewOutcome: "sent",
      createdAt: NOW,
      ...over,
    }),
  );
}

async function seedAudit(t: T, tenantId: string, eventType: string, ts: number) {
  await t.run(async (ctx) =>
    ctx.db.insert("audit", {
      tenantId,
      correlationId: `cid-${crypto.randomUUID()}`,
      eventType,
      actor: "system",
      payload: { ref: "refs-only" },
      ts,
    }),
  );
}

async function seedDeadLetter(
  t: T,
  tenantId: string,
  status: "new" | "replayed" | "resolved",
  createdAt: number,
) {
  await t.run(async (ctx) =>
    ctx.db.insert("deadLetters", {
      tenantId,
      correlationId: `cid-${crypto.randomUUID()}`,
      workflowId: `wf-${crypto.randomUUID()}`,
      payload: { requestId: "ref-only" },
      error: "boom",
      status,
      createdAt,
    }),
  );
}

/** The plan's canonical tenant-A seed: 3 pipeline-style + 1 cockpit-style telemetry rows. */
async function seedTelemetryFixture(t: T) {
  const requestId = await seedRequest(t, TENANT);
  await seedTelemetry(t, TENANT, requestId, {
    decisionCounts: { approve: 1 },
    costUsd: 0.02,
    reviewOutcome: "sent",
  });
  await seedTelemetry(t, TENANT, requestId, {
    // 26-14: the REAL literal. This fixture seeded `edit`, which `review.ts`'s validator does
    // not contain and `pipeline.ts` therefore never writes — so the test proved only that the
    // fold sums whatever you hand it, while the shipped card silently dropped every real
    // edit-with-changes decision and rendered a permanent `edit: 0` as truth.
    decisionCounts: { edit_text: 1 },
    costUsd: 0.02,
    reviewOutcome: "sent",
  });
  await seedTelemetry(t, TENANT, requestId, {
    decisionCounts: { reject: 1, regenerate: 2 },
    regenerateCount: 2,
    costUsd: 0.02,
    reviewOutcome: "rejected",
  });
  // Cockpit-style row: empty decisionCounts, zero cost — reviewOutcome still real.
  await seedTelemetry(t, TENANT, requestId, {
    decisionCounts: {},
    costUsd: 0,
    reviewOutcome: "sent",
  });
}

describe("opsSignals.evalSignals (EVAL-02 read side)", () => {
  test("sums decision counts, review outcomes, cost and delivered rate from telemetry", async () => {
    const t = convexTest(schema, modules);
    await seedTelemetryFixture(t);

    const s = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.evalSignals, { sinceMs: SINCE });

    expect(s.requestCount).toBe(4);
    expect(s.decisionCounts).toEqual({ approve: 1, edit_text: 1, reject: 1, regenerate: 2 });
    expect(s.reviewOutcomes).toEqual({ sent: 3, rejected: 1 });
    expect(s.regenerateTotal).toBe(2);
    expect(s.totalCostUsd).toBeCloseTo(0.06, 10);
    expect(s.deliveredCount).toBe(3);
    expect(s.costPerDeliveredUsd).toBeCloseTo(0.02, 10);
  });

  test("counts llm.fallback audit events windowed and filtered by eventType", async () => {
    const t = convexTest(schema, modules);
    await seedAudit(t, TENANT, "llm.fallback", NOW - 1000);
    await seedAudit(t, TENANT, "llm.fallback", NOW - 2000);
    await seedAudit(t, TENANT, "llm.fallback", SINCE - 1000); // older than the window
    for (let i = 0; i < 5; i++) await seedAudit(t, TENANT, "request.received", NOW - i);

    const s = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.evalSignals, { sinceMs: SINCE });

    expect(s.fallbackCount).toBe(2);
  });

  test("counts DLQ rows in the window (new vs total)", async () => {
    const t = convexTest(schema, modules);
    await seedDeadLetter(t, TENANT, "new", NOW - 1000);
    await seedDeadLetter(t, TENANT, "resolved", NOW - 2000);
    await seedDeadLetter(t, TENANT, "new", SINCE - 1000); // older than the window

    const s = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.evalSignals, { sinceMs: SINCE });

    expect(s.dlqNew).toBe(1);
    expect(s.dlqTotal).toBe(2);
    // requestCount is the rate denominator the card uses — zero telemetry here.
    expect(s.requestCount).toBe(0);
  });

  test("a cross-tenant caller sees all-zero counts (isolation)", async () => {
    const t = convexTest(schema, modules);
    await seedTelemetryFixture(t);
    await seedAudit(t, TENANT, "llm.fallback", NOW - 1000);
    await seedDeadLetter(t, TENANT, "new", NOW - 1000);

    const s = await t
      .withIdentity({ subject: OTHER })
      .query(api.opsSignals.evalSignals, { sinceMs: SINCE });

    expect(s.requestCount).toBe(0);
    expect(s.decisionCounts).toEqual({ approve: 0, edit_text: 0, reject: 0, regenerate: 0 });
    expect(s.reviewOutcomes).toEqual({});
    expect(s.regenerateTotal).toBe(0);
    expect(s.fallbackCount).toBe(0);
    expect(s.dlqNew).toBe(0);
    expect(s.dlqTotal).toBe(0);
    expect(s.totalCostUsd).toBe(0);
    expect(s.deliveredCount).toBe(0);
    // Zero delivered must yield 0, never NaN (division guard).
    expect(s.costPerDeliveredUsd).toBe(0);
    expect(Number.isNaN(s.costPerDeliveredUsd)).toBe(false);
  });

  test("telemetry rows older than sinceMs are excluded (windowing)", async () => {
    const t = convexTest(schema, modules);
    const requestId = await seedRequest(t, TENANT);
    await seedTelemetry(t, TENANT, requestId, { costUsd: 0.01, createdAt: NOW - 1000 });
    await seedTelemetry(t, TENANT, requestId, { costUsd: 0.5, createdAt: SINCE - 1000 });

    const s = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.evalSignals, { sinceMs: SINCE });

    expect(s.requestCount).toBe(1);
    expect(s.totalCostUsd).toBeCloseTo(0.01, 10);
  });

  test("the returned shape is refs/counts only — numbers and records of numbers, no strings", async () => {
    const t = convexTest(schema, modules);
    await seedTelemetryFixture(t);
    await seedAudit(t, TENANT, "llm.fallback", NOW - 1000);
    await seedDeadLetter(t, TENANT, "new", NOW - 1000);

    const s = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.evalSignals, { sinceMs: SINCE });

    for (const [key, value] of Object.entries(s)) {
      if (typeof value === "number") continue;
      // The only non-number values allowed are flat records of numbers.
      expect(typeof value, `field ${key} must be a number or a record of numbers`).toBe("object");
      for (const [innerKey, inner] of Object.entries(value as Record<string, unknown>)) {
        expect(typeof inner, `field ${key}.${innerKey} must be a number`).toBe("number");
      }
    }
  });
});

type RevenueSeed = {
  tenantId?: string;
  runId: string;
  event:
    | "connector_lifecycle"
    | "connector_read"
    | "workflow_completed"
    | "finance_computed"
    | "reminder_staged"
    | "plan_decided"
    | "recovery_observed";
  createdAt: number;
} & Record<string, unknown>;

async function seedRevenueEvent(t: T, seed: RevenueSeed) {
  await t.run(async (ctx) => {
    await ctx.db.insert("workflowPackEvents", {
      tenantId: seed.tenantId ?? TENANT,
      packId: "revenue",
      ...seed,
    });
  });
}

async function seedRevenueDerivedFacts(t: T) {
  await t.run(async (ctx) => {
    for (const [runId, amountCents] of [
      ["rev:wf-1", 15],
      ["rev:wf-2", 5],
    ] as const) {
      await ctx.db.insert("spendEvents", {
        tenantId: TENANT,
        rail: "reasoning",
        phase: "actual",
        amountCents,
        correlationId: `agentloop:${runId}:a0`,
        createdAt: NOW - 1_000,
      });
    }
    await ctx.db.insert("spendEvents", {
      tenantId: OTHER,
      rail: "reasoning",
      phase: "actual",
      amountCents: 999,
      correlationId: "agentloop:rev:wf-1:a0",
      createdAt: NOW - 1_000,
    });
    await ctx.db.insert("agentSteps", {
      tenantId: TENANT,
      threadId: "rev:thread",
      turnId: "rev:wf-1",
      stepKey: "finance",
      tool: "readBusinessFinance",
      phase: "done",
      startedAt: NOW - 2_000,
      endedAt: NOW - 1_900,
      durationMs: 100,
    });
    await ctx.db.insert("agentSteps", {
      tenantId: TENANT,
      threadId: "rev:thread",
      turnId: "rev:wf-2",
      stepKey: "open",
      tool: "dispatchRevenue",
      phase: "running",
      startedAt: NOW - 1_000,
    });
  });
}

async function seedRevenueSignalFixture(t: T) {
  const events: RevenueSeed[] = [
    {
      runId: "rev:life-hubspot",
      event: "connector_lifecycle",
      provider: "hubspot",
      status: "connected",
      createdAt: NOW - 10_000,
    },
    {
      runId: "rev:life-qb",
      event: "connector_lifecycle",
      provider: "quickbooks",
      status: "reauth_required",
      createdAt: NOW - 9_000,
    },
    ...(["ready", "partial", "unavailable"] as const).map((status, index) => ({
      runId: `rev:read-${index}`,
      event: "connector_read" as const,
      provider: "quickbooks",
      status,
      createdAt: NOW - 8_000 + index,
    })),
    {
      runId: "rev:wf-1",
      event: "workflow_completed",
      workflow: "revenue-specialist",
      outcome: "useful",
      createdAt: NOW - 7_000,
    },
    // Raw duplicate proves the projection is independently idempotent.
    {
      runId: "rev:wf-1",
      event: "workflow_completed",
      workflow: "revenue-specialist",
      outcome: "useful",
      createdAt: NOW - 6_999,
    },
    {
      runId: "rev:wf-2",
      event: "workflow_completed",
      workflow: "revenue-specialist",
      outcome: "failed",
      createdAt: NOW - 6_000,
    },
    {
      runId: "rev:follow-up",
      event: "reminder_staged",
      workflow: "revenue-invoice-reminder",
      itemCount: 2,
      createdAt: NOW - 5_000,
    },
    {
      runId: "rev:follow-up",
      event: "plan_decided",
      status: "approved",
      createdAt: NOW - 3_000,
    },
    {
      runId: "rev:recovery-1",
      event: "recovery_observed",
      provider: "stripe",
      status: "paid",
      subjectRef: "rev:item-1",
      observedAt: NOW - 1_000,
      createdAt: NOW - 900,
    },
    // Same item, different read: must not inflate recovery.
    {
      runId: "rev:recovery-duplicate",
      event: "recovery_observed",
      provider: "stripe",
      status: "paid",
      subjectRef: "rev:item-1",
      observedAt: NOW - 800,
      createdAt: NOW - 700,
    },
    // Inserted later but observed before staging: reordered history is not recovery.
    {
      runId: "rev:recovery-reordered",
      event: "recovery_observed",
      provider: "stripe",
      status: "resolved",
      subjectRef: "rev:item-2",
      observedAt: NOW - 6_000,
      createdAt: NOW - 600,
    },
    {
      runId: "rev:finance-1",
      event: "finance_computed",
      workflow: "revenue-cash-flow",
      coverage: "complete",
      confidence: "high",
      hasGap: false,
      unknownCount: 0,
      createdAt: NOW - 500,
    },
    {
      runId: "rev:finance-2",
      event: "finance_computed",
      workflow: "revenue-payroll-confidence",
      coverage: "partial",
      confidence: "low",
      hasGap: true,
      unknownCount: 3,
      createdAt: NOW - 400,
    },
  ];
  for (const event of events) await seedRevenueEvent(t, event);
  await seedRevenueDerivedFacts(t);
}

describe("opsSignals.revenueSignals (Phase 28 bounded projection)", () => {
  test("projects usefulness, recovery, response, finance and canonical cost/latency", async () => {
    const t = convexTest(schema, modules);
    await seedRevenueSignalFixture(t);

    const report = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });

    expect(report.connectorAvailability).toMatchObject({
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(report.connectorReadCompletion).toMatchObject({
      numerator: 2,
      denominator: 3,
      value: 2 / 3,
    });
    expect(report.followUpCompletion).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(report.overdueRecovery).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(report.responseHandling).toEqual({
      eligible: 1,
      measured: 1,
      medianMs: 2_000,
      maxMs: 2_000,
    });
    expect(report.finance).toEqual({
      computations: 2,
      coverage: { complete: 1, partial: 1, unknown: 0 },
      confidence: { high: 1, medium: 0, low: 1, unknown: 0 },
      hasGap: 1,
      unknownTotal: 3,
    });
    expect(report.workflowCost).toEqual({ totalCents: 20, runsPriced: 2, runsJoined: 2 });
    expect(report.workflowLatency).toEqual({
      runsMeasured: 1,
      medianMs: 100,
      maxMs: 100,
      runsJoined: 2,
    });
    expect(report.window.complete).toBe(true);
  });

  test("is tenant-isolated across events, spend and step facts", async () => {
    const t = convexTest(schema, modules);
    await seedRevenueSignalFixture(t);

    const mine = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });
    const other = await t
      .withIdentity({ subject: OTHER })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });

    expect(mine.window.eventCount).toBeGreaterThan(0);
    expect(other.window.eventCount).toBe(0);
    expect(other.workflowCost.totalCents).toBe(0);
    expect(other.workflowLatency.runsMeasured).toBe(0);
    expect(other.connectorAvailability).toEqual({ kind: "not_applicable", reason: "no_data" });
  });

  test("clamps retention and labels the resulting partial window honestly", async () => {
    const t = convexTest(schema, modules);
    await seedRevenueEvent(t, {
      runId: "rev:too-old",
      event: "connector_read",
      provider: "hubspot",
      status: "ready",
      createdAt: NOW - 100 * 24 * 60 * 60 * 1_000,
    });
    await seedRevenueEvent(t, {
      runId: "rev:recent",
      event: "connector_read",
      provider: "hubspot",
      status: "ready",
      createdAt: NOW - 1_000,
    });

    const report = await t.withIdentity({ subject: TENANT }).query(api.opsSignals.revenueSignals, {
      sinceMs: NOW - 180 * 24 * 60 * 60 * 1_000,
      untilMs: NOW,
    });

    expect(report.window).toMatchObject({
      requestedSinceMs: NOW - 180 * 24 * 60 * 60 * 1_000,
      sinceMs: NOW - 90 * 24 * 60 * 60 * 1_000,
      untilMs: NOW,
      eventCount: 1,
      complete: false,
      reasons: ["retention_boundary"],
    });
  });

  test("reports no-data denominators and unknown performance for an empty window", async () => {
    const t = convexTest(schema, modules);
    const report = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });

    expect(report.followUpCompletion).toEqual({ kind: "not_applicable", reason: "no_data" });
    expect(report.overdueRecovery).toEqual({ kind: "not_applicable", reason: "no_data" });
    expect(report.responseHandling).toEqual({
      eligible: 0,
      measured: 0,
      medianMs: null,
      maxMs: null,
    });
    expect(report.workflowCost).toEqual({ totalCents: 0, runsPriced: 0, runsJoined: 0 });
    expect(report.workflowLatency).toEqual({
      runsMeasured: 0,
      medianMs: null,
      maxMs: null,
      runsJoined: 0,
    });
  });

  test("caps event cardinality and labels the partial projection", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < PACK_EVENT_PAGE_MAX + 1; index++) {
        await ctx.db.insert("workflowPackEvents", {
          tenantId: TENANT,
          packId: "revenue",
          runId: `rev:cap-${index}`,
          event: "connector_read",
          provider: "hubspot",
          status: "ready",
          createdAt: SINCE + index,
        });
      }
    });

    const report = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });
    expect(report.window).toMatchObject({
      eventCount: PACK_EVENT_PAGE_MAX,
      complete: false,
      reasons: ["event_cap"],
    });
    expect(report.connectorReadCompletion).toMatchObject({
      numerator: PACK_EVENT_PAGE_MAX,
      denominator: PACK_EVENT_PAGE_MAX,
      value: 1,
    });
  });

  test("caps canonical joins and exposes that incompleteness", async () => {
    const t = convexTest(schema, modules);
    for (let index = 0; index < PACK_RUN_JOIN_MAX + 1; index++) {
      await seedRevenueEvent(t, {
        runId: `rev:join-${index}`,
        event: "workflow_completed",
        workflow: "revenue-specialist",
        outcome: "useful",
        createdAt: SINCE + index,
      });
    }

    const report = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });
    expect(report.window).toMatchObject({ complete: false, reasons: ["join_cap"] });
    expect(report.workflowCost.runsJoined).toBe(PACK_RUN_JOIN_MAX);
    expect(report.workflowLatency.runsJoined).toBe(PACK_RUN_JOIN_MAX);
    expect(report.followUpCompletion).toMatchObject({
      numerator: PACK_RUN_JOIN_MAX + 1,
      denominator: PACK_RUN_JOIN_MAX + 1,
    });
  });

  test("recursively exposes only counts, timestamps and closed labels", async () => {
    const t = convexTest(schema, modules);
    await seedRevenueSignalFixture(t);
    const report = await t
      .withIdentity({ subject: TENANT })
      .query(api.opsSignals.revenueSignals, { sinceMs: SINCE, untilMs: NOW });

    const visit = (value: unknown, path = "$):"): void => {
      if (value === null || typeof value !== "object") {
        if (typeof value === "string")
          expect(
            [
              "ratio",
              "not_applicable",
              "no_data",
              "zero_denominator",
              "retention_boundary",
              "event_cap",
              "join_cap",
            ],
            `unbounded label at ${path}`,
          ).toContain(value);
        return;
      }
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        expect(key, `content-shaped field at ${path}.${key}`).not.toMatch(
          /name|email|message|body|subject|description|currency|token|credential|payload|raw/i,
        );
        visit(nested, `${path}.${key}`);
      }
    };
    visit(report);
  });
});
