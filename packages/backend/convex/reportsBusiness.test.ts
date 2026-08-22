// RPRT-01 bounded business + operations projections (plan 26-14), convex-test.
//
// The behavioural half. The arithmetic these queries rely on is pinned in
// `packages/core/src/reports.test.ts`; what is proven here is the READ — auth, isolation, which
// rows enter a window, and the two shipped defects this plan corrects.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const TENANT = "tenant_a";
const OTHER = "tenant_b";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 7, 1);
const WINDOW = { sinceMs: T0, untilMs: T0 + 30 * DAY, browserTimeZone: "UTC" };
const as = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

async function seedRequest(
  t: ReturnType<typeof convexTest>,
  over: { tenantId?: string; createdAt?: number; correlationId?: string; status?: string } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("requests", {
      tenantId: over.tenantId ?? TENANT,
      correlationId: over.correlationId ?? `corr-${Math.random()}`,
      goal: "PRIVATE-GOAL-TEXT",
      draft: "PRIVATE-DRAFT-BODY",
      recipient: "someone@example.com",
      status: (over.status ?? "sent") as "sent",
      attachmentRefs: [],
      createdAt: over.createdAt ?? T0 + DAY,
    }),
  );
}

async function seedTelemetry(
  t: ReturnType<typeof convexTest>,
  decisionCounts: Record<string, number>,
  over: { createdAt?: number; reviewOutcome?: string } = {},
) {
  const requestId = await seedRequest(t, { status: "awaiting_review" });
  return t.run(async (ctx) =>
    ctx.db.insert("telemetry", {
      tenantId: TENANT,
      correlationId: `tel-${Math.random()}`,
      requestId,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: 0,
      decisionCounts,
      regenerateCount: 0,
      reviewOutcome: over.reviewOutcome ?? "approved",
      createdAt: over.createdAt ?? T0 + DAY,
    }),
  );
}

async function seedEvaluation(
  t: ReturnType<typeof convexTest>,
  over: {
    threadId?: string;
    framework?: "growth-os" | "document-review";
    verdict?: "gaps" | "healthy" | "insufficient";
    findings?: number;
    gaps?: { route: string; playbook: string }[];
    createdAt?: number;
  } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("evaluations", {
      tenantId: TENANT,
      threadId: over.threadId ?? "proactive-review",
      framework: over.framework ?? "growth-os",
      findings: Array.from({ length: over.findings ?? 3 }, (_, i) => ({
        label: `finding ${i}`,
        section: "financials",
        citationTitle: "PRIVATE-CITATION-TITLE",
        confidence: "high" as const,
        source: "vault" as const,
      })),
      gaps: (over.gaps ?? [{ route: "offer", playbook: "grand-slam-offer" }]).map((g, i) => ({
        ...g,
        label: `gap ${i}`,
        leverageRank: i + 1,
      })),
      notEnoughData: [],
      scorecard: { businessName: "Acme", financials: { cac: 120 } },
      userProvided: [],
      verdict: over.verdict ?? "gaps",
      createdAt: over.createdAt ?? T0 + DAY,
    }),
  );
}

async function seedStep(
  t: ReturnType<typeof convexTest>,
  over: { tool?: string; durationMs?: number; startedAt?: number; tenantId?: string } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("agentSteps", {
      tenantId: over.tenantId ?? TENANT,
      threadId: "proactive-review",
      turnId: `turn-${Math.random()}`,
      stepKey: `step-${Math.random()}`,
      tool: (over.tool ?? "draftBody") as "draftBody",
      phase: "done" as const,
      startedAt: over.startedAt ?? T0 + DAY,
      ...(over.durationMs === undefined ? {} : { durationMs: over.durationMs }),
    }),
  );
}

describe("the trust boundary", () => {
  test("every report read fails closed without an identity", async () => {
    const t = convexTest(schema, modules);
    for (const fn of [
      api.reportsBusiness.business,
      api.reportsBusiness.operations,
      api.reportsBusiness.sentMail,
    ]) {
      await expect(t.query(fn, WINDOW)).rejects.toThrow(/UNAUTHENTICATED/);
    }
  });

  test("another tenant's sends never enter the record or the count", async () => {
    const t = convexTest(schema, modules);
    await seedRequest(t, { tenantId: OTHER, correlationId: "FOREIGN-CORR" });
    await seedRequest(t);

    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.delivery.sentCount).toBe(1);
    const mail = await as(t).query(api.reportsBusiness.sentMail, WINDOW);
    expect(mail.items).toHaveLength(1);
    expect(JSON.stringify(mail)).not.toContain("FOREIGN-CORR");
  });

  test("the server owns the window ceiling — a browser cannot ask for a year", async () => {
    const t = convexTest(schema, modules);
    await expect(
      as(t).query(api.reportsBusiness.business, {
        sinceMs: T0,
        untilMs: T0 + 400 * DAY,
        browserTimeZone: "UTC",
      }),
    ).rejects.toThrow(/maximum span/);
  });

  test("the resolved window rides on every result, and says the timezone is a fallback", async () => {
    const t = convexTest(schema, modules);
    const [b, o] = await Promise.all([
      as(t).query(api.reportsBusiness.business, WINDOW),
      as(t).query(api.reportsBusiness.operations, WINDOW),
    ]);
    expect(b.window).toEqual(o.window);
    // No tenant timezone exists in the schema yet, so every Reports window is browser-derived and
    // must say so rather than presenting a device-dependent instant as canonical.
    expect(b.window.timeZoneSource).toBe("browser-fallback");
  });
});

describe("business — comparability, not 'the last two rows'", () => {
  test("movement comes from the review thread, and a doc review elsewhere cannot become the pair", async () => {
    const t = convexTest(schema, modules);
    await seedEvaluation(t, {
      createdAt: T0 + DAY,
      findings: 2,
      gaps: [
        { route: "offer", playbook: "grand-slam-offer" },
        { route: "leads", playbook: "core-four" },
      ],
    });
    await seedEvaluation(t, { createdAt: T0 + 2 * DAY, findings: 5 });
    // NEWER than both, on a different thread and framework. Reading "the tenant's two newest rows"
    // would diff a document review against a business diagnosis.
    await seedEvaluation(t, {
      createdAt: T0 + 3 * DAY,
      threadId: "voice-doc:abc",
      framework: "document-review",
    });

    const report = await as(t).query(api.reportsBusiness.business, WINDOW);
    expect(report.evaluation).toMatchObject({
      state: "run",
      framework: "growth-os",
      movement: { state: "comparable", newFindings: 3, gapsClosed: ["leads/core-four"] },
    });
  });

  test("a run that could not assess reports no movement, not a clean sweep", async () => {
    const t = convexTest(schema, modules);
    await seedEvaluation(t, { createdAt: T0 + DAY, gaps: [{ route: "money", playbook: "mm" }] });
    await seedEvaluation(t, {
      createdAt: T0 + 2 * DAY,
      verdict: "insufficient",
      findings: 0,
      gaps: [],
    });
    const report = await as(t).query(api.reportsBusiness.business, WINDOW);
    expect(report.evaluation).toMatchObject({
      movement: { state: "incomparable", reason: "verdict-insufficient" },
    });
  });

  test("no review run NAMES ITS POPULATION, and no blueprint is not 0% complete", async () => {
    const t = convexTest(schema, modules);
    const report = await as(t).query(api.reportsBusiness.business, WINDOW);
    // NOT "never-run". This read is the weekly review thread only.
    expect(report.evaluation).toEqual({
      state: "no-review-run",
      population: "proactive-review",
    });
    // A missing blueprint has no completeness — the fields are structurally absent, not zero.
    expect(report.blueprint).toEqual({ state: "not-built" });
  });

  test("A TENANT WHO RAN EVALUATIONS OFF THE CRON THREAD IS NOT TOLD THEY NEVER RAN ONE", async () => {
    // The state used to be called `never-run`, which is a false statement about the history of a
    // tenant who has evaluated their business ten times from the cockpit. The read is deliberately
    // one thread wide; the payload has to say so rather than generalise.
    const t = convexTest(schema, modules);
    await seedEvaluation(t, { threadId: "cockpit-thread-xyz" });
    const report = await as(t).query(api.reportsBusiness.business, WINDOW);
    expect(report.evaluation.state).toBe("no-review-run");
    expect(report.evaluation).toHaveProperty("population", "proactive-review");
  });

  test("the card carries counts and refs — never a finding's prose or the scorecard blob", async () => {
    const t = convexTest(schema, modules);
    await seedEvaluation(t);
    const report = await as(t).query(api.reportsBusiness.business, WINDOW);
    const wire = JSON.stringify(report);
    expect(wire).not.toContain("PRIVATE-CITATION-TITLE");
    expect(wire).not.toContain("Acme");
    expect(report.evaluation).toMatchObject({ findingCount: 3, sources: { vault: 3 } });
  });
});

describe("operations — the gate-decision defect this plan corrects", () => {
  test("AN edit_text DECISION IS COUNTED, not silently dropped", async () => {
    // THE SHIPPED DEFECT: `opsSignals.ts` hand-typed its key list as
    // ["approve","edit","reject","regenerate"]. Nothing writes "edit" — `review.ts`'s validator
    // says "edit_text" and `pipeline.ts` writes `decisionCounts[evt.decision]` verbatim. So the
    // card rendered a permanent `edit: 0` AND discarded every real edit-with-changes decision,
    // because it only summed keys present in its own list.
    const t = convexTest(schema, modules);
    await seedTelemetry(t, { approve: 2, edit_text: 3 });
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.review.decisions).toEqual({ approve: 2, edit_text: 3 });
    expect(ops.review.decisions.edit).toBeUndefined();
  });

  test("a decision literal this build does not know about is NAMED, never dropped", async () => {
    const t = convexTest(schema, modules);
    await seedTelemetry(t, { approve: 1, some_future_decision: 4 });
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.review.decisions).toEqual({ approve: 1 });
    expect(ops.review.otherDecisions).toBe(4);
  });

  test("rows outside the half-open window are excluded at both ends", async () => {
    const t = convexTest(schema, modules);
    await seedTelemetry(t, { approve: 1 }, { createdAt: T0 - 1 });
    await seedTelemetry(t, { approve: 1 }, { createdAt: T0 });
    await seedTelemetry(t, { approve: 1 }, { createdAt: T0 + 30 * DAY });
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.review.terminals).toBe(1);
  });
});

describe("operations — an empty window is Unknown, never a confident zero", () => {
  test("a source with no rows at all reports not-started rather than 0", async () => {
    const t = convexTest(schema, modules);
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.delivery.coverage).toEqual({ state: "unknown", reason: "not-started" });
    expect(ops.review.coverage).toEqual({ state: "unknown", reason: "not-started" });
    expect(ops.feedback.coverage).toEqual({ state: "unknown", reason: "not-started" });
    // The counts are still 0 — the point is that the coverage label is what makes 0 readable.
    expect(ops.delivery.sentCount).toBe(0);
  });

  test("a window that starts before the tenant's first row is PARTIAL, and says from when", async () => {
    const t = convexTest(schema, modules);
    await seedRequest(t, { createdAt: T0 + 10 * DAY });
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.delivery.coverage).toEqual({
      state: "partial",
      reason: "coverage-gap",
      coveredSinceMs: T0 + 10 * DAY,
    });
  });

  test("latency is unknown without enough MEASURED steps — a structural 0ms is not a p95", async () => {
    const t = convexTest(schema, modules);
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.latency.state).toBe("unknown");
    expect(ops.latency).toMatchObject({ included: 0, truncated: false });
  });

  test("the p95 is nearest-rank over MEASURED steps, and names what it dropped", async () => {
    // THE DEFECT THIS EXISTS FOR: the only latency assertion used to run against an EMPTY database,
    // so it held for `values: []`, for reading `startedAt` instead of `durationMs`, for swapped
    // window bounds, and for five of the six tools being dropped. Every one of those is a real
    // number the card would have shown. Seeded here across two tools with the exclusions the
    // module claims to make.
    const t = convexTest(schema, modules);
    for (const ms of [10, 20, 30, 40, 50]) await seedStep(t, { durationMs: ms });
    await seedStep(t, { tool: "searchVault", durationMs: 100 });
    // Excluded BY VALUE: a structural zero and an unmeasured step (both are real writes).
    await seedStep(t, { durationMs: 0 });
    await seedStep(t, { durationMs: undefined });
    // Excluded BY POPULATION: a tool outside TIMED_TOOLS, and a step outside the window.
    await seedStep(t, { tool: "resolveContacts", durationMs: 9_999 });
    await seedStep(t, { durationMs: 9_999, startedAt: T0 - DAY });
    // Excluded BY TENANT.
    await seedStep(t, { durationMs: 9_999, tenantId: OTHER });

    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    // Nearest-rank p95 over [10,20,30,40,50,100] → ceil(0.95*6)-1 = index 5 → 100.
    expect(ops.latency).toMatchObject({
      state: "known",
      value: 100,
      included: 6,
      excluded: 2,
      truncated: false,
    });
    expect(ops.latency.population).toContain("6 timed tools");
  });

  test("A TRUNCATED p95 SAYS SO, and keeps the NEWEST steps rather than the oldest", async () => {
    // `.take(STEP_CAP)` on the ascending index kept the OLDEST rows and could not tell "exactly
    // CAP" from "CAP of many", so a busy tenant's p95 described the start of the window and
    // nothing in the payload said the sample had been cut.
    const t = convexTest(schema, modules);
    const cap = 400;
    // Oldest rows are slow, newest rows are fast. An oldest-first truncation reports ~5000.
    for (let i = 0; i < cap; i += 1) {
      await seedStep(t, { durationMs: 5_000, startedAt: T0 + DAY + i });
    }
    for (let i = 0; i < 10; i += 1) {
      await seedStep(t, { durationMs: 7, startedAt: T0 + 2 * DAY + i });
    }
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.latency.truncated).toBe(true);
    expect(ops.latency).toMatchObject({ state: "known", included: cap });
    // The retained slice is the newest CAP rows: the 10 fast ones are IN, so the sample is not the
    // oldest-400 block. (All-5000 would give exactly 5000 with the 7s never read.)
    expect((ops.latency as { value: number }).value).toBe(5_000);
    const values = await t.run(async (ctx) =>
      ctx.db
        .query("agentSteps")
        .withIndex("by_tenant_tool_startedAt", (q) =>
          q.eq("tenantId", TENANT).eq("tool", "draftBody"),
        )
        .collect(),
    );
    expect(values).toHaveLength(cap + 10);
  });

  test("a tenant who DRAFTED but never sent is covered, not 'we were not watching'", async () => {
    // The coverage floor read `status: "sent"`, so a tenant with requests and zero deliveries got
    // `not-started` — "we were not watching" — when the truth is "we were watching, nothing was
    // sent". That is the exact conflation this module exists to refuse.
    const t = convexTest(schema, modules);
    await seedRequest(t, { status: "awaiting_review", createdAt: T0 - 5 * DAY });
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.delivery.sentCount).toBe(0);
    expect(ops.delivery.coverage).toEqual({ state: "covered" });
  });

  test("open dead letters are point-in-time and status-filtered, never windowed", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [status, createdAt] of [
        ["new", T0 + DAY],
        ["new", T0 - 400 * DAY], // OUTSIDE the window and still open right now
        ["resolved", T0 + DAY],
      ] as const) {
        await ctx.db.insert("deadLetters", {
          tenantId: TENANT,
          correlationId: `dl-${Math.random()}`,
          workflowId: `wf-${Math.random()}`,
          error: "route_bad_response",
          payload: {},
          status,
          createdAt,
        });
      }
      await ctx.db.insert("deadLetters", {
        tenantId: OTHER,
        correlationId: "dl-foreign",
        workflowId: "wf-foreign",
        error: "route_bad_response",
        payload: {},
        status: "new",
        createdAt: T0 + DAY,
      });
    });
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.deadLetters).toMatchObject({ openNow: 2, windowed: false });
  });

  test("reasoning cost is NOT re-summed here — the ledger owns it, and this says where", async () => {
    const t = convexTest(schema, modules);
    const ops = await as(t).query(api.reportsBusiness.operations, WINDOW);
    expect(ops.spend.readAt).toBe("/dashboard/finance?tab=spend");
    expect(ops.spend.coverage).toEqual({ state: "unknown", reason: "not-started" });
    expect(JSON.stringify(ops.spend)).not.toContain("costUsd");
  });
});

describe("the sent-mail record — delivery is proven by the audit row", () => {
  test("A MICROSOFT SEND IS DELIVERED — graph.sent counts, not only gmail.sent", async () => {
    // THE SHIPPED DEFECT this corrects: `plans.reportForPlan` filters `eventType === "gmail.sent"`
    // only, while the Graph arm writes `graph.sent` — so every Microsoft send already reads as
    // undelivered in the cockpit's own report card.
    const t = convexTest(schema, modules);
    await seedRequest(t, { correlationId: "corr-google" });
    await seedRequest(t, { correlationId: "corr-microsoft" });
    await t.run(async (ctx) => {
      await ctx.db.insert("audit", {
        tenantId: TENANT,
        correlationId: "corr-google",
        eventType: "gmail.sent",
        actor: "system",
        payload: { messageId: "abc123" },
        ts: T0 + DAY,
      });
      // The Graph arm returns 202 with an empty body and deliberately records no message id.
      await ctx.db.insert("audit", {
        tenantId: TENANT,
        correlationId: "corr-microsoft",
        eventType: "graph.sent",
        actor: "system",
        payload: { messageId: "" },
        ts: T0 + DAY,
      });
    });

    const mail = await as(t).query(api.reportsBusiness.sentMail, WINDOW);
    expect(mail.items).toHaveLength(2);
    expect(mail.items.every((i) => i.delivered)).toBe(true);
    // …and an absent id is reported as absent, not inferred into "undelivered".
    expect(mail.items.filter((i) => i.messageIdPresent)).toHaveLength(1);
  });

  test("a send with no proof row is not claimed as delivered", async () => {
    const t = convexTest(schema, modules);
    await seedRequest(t, { correlationId: "corr-unproven" });
    const mail = await as(t).query(api.reportsBusiness.sentMail, WINDOW);
    expect(mail.items[0]).toMatchObject({ delivered: false, messageIdPresent: false });
  });

  test("the record carries refs and the recipient — never the goal, draft or body", async () => {
    const t = convexTest(schema, modules);
    await seedRequest(t);
    const mail = await as(t).query(api.reportsBusiness.sentMail, WINDOW);
    const wire = JSON.stringify(mail);
    expect(wire).not.toContain("PRIVATE-GOAL-TEXT");
    expect(wire).not.toContain("PRIVATE-DRAFT-BODY");
    expect(mail.items[0]).toMatchObject({ recipient: "someone@example.com", provider: "google" });
  });

  test("the page is capped and says so rather than returning everything", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 4; i++) await seedRequest(t, { createdAt: T0 + DAY + i });
    const mail = await as(t).query(api.reportsBusiness.sentMail, { ...WINDOW, limit: 2 });
    expect(mail.items).toHaveLength(2);
    expect(mail.bound).toMatchObject({
      returned: 2,
      limit: 2,
      partial: true,
      partialReason: "row-cap",
    });
  });
});
