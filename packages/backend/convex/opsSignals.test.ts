import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

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
    decisionCounts: { edit: 1 },
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
    expect(s.decisionCounts).toEqual({ approve: 1, edit: 1, reject: 1, regenerate: 2 });
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
    expect(s.decisionCounts).toEqual({ approve: 0, edit: 0, reject: 0, regenerate: 0 });
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
