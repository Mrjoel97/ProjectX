// 27-07 Task 2 (PACK-04). The bounded outcome projection.
//
// Three properties are asserted here and nowhere else:
//
//   ISOLATION — the tenant-derived read cannot reach another tenant's events, cost or latency,
//   proven with two real users and PAIRED assertions (a one-sided "B sees nothing" passes just as
//   happily against an empty table).
//   PRIVACY — the report structurally cannot carry raw content. Asserted over the WHOLE returned
//   object, recursively, against the words a leak would actually be made of.
//   NON-VACUITY — one complete journey, driven through the real terminals, whose counters are
//   non-zero and internally consistent. A projection over an empty table returns a full report of
//   zeroes and `not_applicable`s, so a suite that only ever reads an empty table asserts nothing.
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { packCustomerComplaintSkillBody } from "@pikar/contracts/skills/packCustomerComplaint";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
// The approve terminal really does start the delivery workflow — the journey below drives the
// PRODUCTION `executePlan`, not a stub, so its components have to exist.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { PACK_RUN_JOIN_MAX } from "./workflowPackOutcomes";

// @vitest-environment node
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;

const THREAD = "thread_outcomes";
const REPLY = "Drafted an apology and a replacement offer for the customer.";

function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const provUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const textStep = (text: string) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: provUsage(4000, 900),
  warnings: [],
});
const toolStep = (toolName: string, input: unknown) => ({
  content: [
    { type: "tool-call", toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage: provUsage(0, 0),
  warnings: [],
});

/** Every leaf value the report returns, flattened — the privacy scan reads this, not a key list. */
function leaves(value: unknown, path = "$"): { path: string; value: unknown }[] {
  if (value === null || typeof value !== "object") return [{ path, value }];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, `${path}.${k}`),
  );
}

/**
 * ONE complete journey through the REAL terminals: a recommendation is shown, accepted, the pack
 * runs and stages a reply, the human approves it. Returns the tenant id the journey belongs to.
 */
async function completeJourney(t: T, userId: string): Promise<{ planId: Id<"plans"> }> {
  await t.run(async (ctx) => {
    await ctx.db.insert("skills", {
      name: "pack-customer-complaint",
      version: 1,
      body: packCustomerComplaintSkillBody,
      status: "active" as const,
      createdAt: Date.now(),
    });
    await ctx.db.insert("skills", {
      name: COCKPIT_AGENT_SKILL,
      version: 1,
      body: "Executive agent.",
      status: "active" as const,
      createdAt: Date.now(),
    });
    // Onboarding's completion stamp — `timeToFirstUsefulOutcome`'s origin. Backdated so the useful
    // outcome lands AFTER it (a useful run that predates onboarding is reported as a broken clock).
    await ctx.db.insert("vaultDocuments", {
      tenantId: userId,
      title: "Business profile",
      kind: "business_profile",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 10,
      contentHash: "hash-profile",
      status: "ready",
      createdAt: Date.now() - 60_000,
    });
    // CAN-SPAM: `executePlan` refuses an email plan with no postal address, at the human gate.
    // Without this the approve returns a governed refusal and `plan_approved` correctly never
    // fires — which would make this whole journey silently assert nothing.
    await ctx.db.insert("tenantProfiles", {
      tenantId: userId,
      tier: "solopreneur" as const,
      tierSource: "derived" as const,
      derivedAt: Date.now(),
      postalAddress: "1 Test Way",
    });
    // The mailbox grant, so the run is not `partial` purely for want of an inbox.
    await ctx.db.insert("gmailTokens", {
      tenantId: userId,
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
      scope: "https://www.googleapis.com/auth/gmail.send",
      updatedAt: Date.now(),
    });
  });
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: userId,
    threadId: THREAD,
  });
  // The plan is brought to a proposable state the way an email plan reaches one; the pack's own
  // `proposePlan` call below is what actually stages it.
  await t.run((ctx) =>
    ctx.db.patch(planId, {
      recipients: ["customer@example.test"],
      subject: "Re: your order",
      body: "We are sorry.",
    }),
  );

  // The discovery surface's half of the pair (27-09 renders the card; this is the row it writes).
  await t.mutation(internal.workflowPackEventLog.record, {
    tenantId: userId,
    packId: "customer-complaint",
    runId: "run-journey",
    event: "recommendation_shown",
    recommendationId: "rec-journey",
  });
  await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
    tenantId: userId,
    packId: "customer-complaint",
    threadId: THREAD,
    planId,
    text: "This customer is furious about a late delivery.",
    runId: "run-journey",
    recommendationId: "rec-journey",
    primary: [toolStep("proposePlan", {}), textStep(REPLY)],
    fallback: [toolStep("proposePlan", {}), textStep(REPLY)],
  });
  // The human gate — a `tenantMutation`, reached with the tenant's own identity.
  const approved = await t
    .withIdentity({ subject: `${userId}|session_a` })
    .mutation(api.cockpit.executePlan, { planId });
  // Asserted HERE: every governed refusal above returns `ok: false` and skips the CAS, so a journey
  // that quietly stopped at one would produce a report of zeroes that still "passed".
  expect(approved.ok, `approve was refused: ${JSON.stringify(approved)}`).toBe(true);
  return { planId };
}

const report = (t: T, userId: string) =>
  t.withIdentity({ subject: `${userId}|session_a` }).query(api.workflowPackOutcomes.forTenant, {});

describe("one complete journey produces non-zero, internally consistent counters", () => {
  test("the whole pilot report fills in from real terminals", async () => {
    const t = harness();
    const userId = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await completeJourney(t, userId);
    const out = await report(t, userId);

    // The run happened, and every one of its events shares the one run id.
    expect(out.runCount).toBe(1);
    expect(out.eventCount).toBeGreaterThan(3);

    // The recommendation was shown once and accepted once — a paired ratio, not a bare count.
    expect(out.recommendationAcceptance).toEqual({
      kind: "ratio",
      numerator: 1,
      denominator: 1,
      value: 1,
    });

    // The plan the pack staged was approved by the human gate, and nothing else was decided.
    expect(out.planDecisions).toEqual({ approved: 1, edited: 0, rejected: 0 });

    // Exactly one terminal, and it is the derived outcome — not a judgement about the prose.
    const terminals = Object.values(out.completionOutcomes).reduce((a, b) => a + b, 0);
    expect(terminals).toBe(1);
    expect(out.completionOutcomes.useful).toBe(1);
    // Every outcome in the closed enum is reported, including the ones that never happened.
    expect(Object.keys(out.completionOutcomes).sort()).toEqual(
      ["blocked", "failed", "no_findings", "partial", "refused", "useful"].sort(),
    );

    // The headline measure resolves to a real duration rather than one of its three unknowns.
    expect(out.timeToFirstUsefulOutcome.kind).toBe("known");
    if (out.timeToFirstUsefulOutcome.kind === "known") {
      expect(out.timeToFirstUsefulOutcome.ms).toBeGreaterThan(0);
    }

    // Cost is JOINED from the ledger, never re-emitted: the run billed, so the join found it.
    expect(out.cost.runsPriced).toBe(1);
    expect(out.cost.totalCents).toBeGreaterThan(0);
    // Read the ledger INDEPENDENTLY of the projection's own join helper — a full-table read filtered
    // by the run id, so a projection that joined on the wrong correlation id cannot agree with it.
    const ledger = (await t.run((ctx) => ctx.db.query("spendEvents").collect())).filter((r) =>
      r.correlationId.includes("run-journey"),
    );
    expect(
      ledger.length,
      "the loop billed nothing — the journey never reached the model",
    ).toBeGreaterThan(0);
    // The projection's number IS the ledger's number — that is the whole point of joining.
    expect(out.cost.totalCents).toBe(
      ledger.filter((r) => r.rail === "reasoning").reduce((sum, r) => sum + r.amountCents, 0),
    );

    // The claim measures have no emitter yet (27-08's eval runner is the only plane that grades a
    // body's claims), so an honest report says so instead of inventing a perfect score.
    expect(out.citationCoverage).toEqual({ kind: "not_applicable", reason: "no_data" });
    expect(out.unsupportedClaimRate).toEqual({ kind: "not_applicable", reason: "no_data" });
  });

  // The other half of the plan-decision pair, and the one that proves the emission is not simply
  // "every approve counts": a discard records a rejection, and an unrelated plan records neither.
  test("a discarded pack plan records a rejection", async () => {
    const t = harness();
    const userId = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await t.run(async (ctx) => {
      await ctx.db.insert("skills", {
        name: "pack-customer-complaint",
        version: 1,
        body: packCustomerComplaintSkillBody,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.insert("skills", {
        name: COCKPIT_AGENT_SKILL,
        version: 1,
        body: "Executive agent.",
        status: "active" as const,
        createdAt: Date.now(),
      });
    });
    const planId = await t.mutation(internal.plans.insertPlan, {
      tenantId: userId,
      threadId: THREAD,
    });
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        recipients: ["customer@example.test"],
        subject: "Re: your order",
        body: "We are sorry.",
      }),
    );
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      tenantId: userId,
      packId: "customer-complaint",
      threadId: THREAD,
      planId,
      text: "Angry customer.",
      runId: "run-discard",
      primary: [toolStep("proposePlan", {}), textStep(REPLY)],
      fallback: [toolStep("proposePlan", {}), textStep(REPLY)],
    });
    await t
      .withIdentity({ subject: `${userId}|session_a` })
      .mutation(api.cockpit.discardPlan, { planId });
    expect((await report(t, userId)).planDecisions).toEqual({
      approved: 0,
      edited: 0,
      rejected: 1,
    });
  });

  // ATTRIBUTION. A plan the Executive Agent staged on a thread that ONCE ran a pack must not be
  // credited to that pack — the plan row is per-thread and shared, so "this plan was approved" is
  // not by itself evidence a pack produced it.
  // MUTATION that must turn this RED: attribute on the newest pack event instead of on the
  // `plan_proposed` one in `recordPackPlanDecision`.
  test("an executive plan on the same thread is credited to nobody", async () => {
    const t = harness();
    const userId = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await t.run(async (ctx) => {
      await ctx.db.insert("skills", {
        name: "pack-business-pulse",
        version: 1,
        body: "Business pulse.",
        status: "active" as const,
        createdAt: Date.now(),
      });
      // The approve must REACH the CAS flip, or this test proves nothing: `executePlan` returns
      // `gmail_not_connected` / `no_postal_address` before it, and a refused approve emits nothing
      // whatever the attribution rule is.
      await ctx.db.insert("gmailTokens", {
        tenantId: userId,
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 3_600_000,
        scope: "https://www.googleapis.com/auth/gmail.send",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("tenantProfiles", {
        tenantId: userId,
        tier: "solopreneur" as const,
        tierSource: "derived" as const,
        derivedAt: Date.now(),
        postalAddress: "1 Test Way",
      });
    });
    const planId = await t.mutation(internal.plans.insertPlan, {
      tenantId: userId,
      threadId: THREAD,
    });
    // An analysis-only pack runs on the thread and stages nothing.
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      tenantId: userId,
      packId: "business-pulse",
      threadId: THREAD,
      planId,
      text: "How are we doing?",
      runId: "run-analysis",
      primary: [textStep("Here is your pulse.")],
    });
    // …then the Executive Agent proposes and the human approves an ordinary email on the SAME row.
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        recipients: ["someone@example.test"],
        subject: "Hello",
        body: "Hi.",
      }),
    );
    await t.mutation(internal.cockpit.proposeEmailPlan, {
      planId,
      recipients: ["someone@example.test"],
      mode: "individual",
      subject: "Hello",
      body: "Hi.",
    });
    const approved = await t
      .withIdentity({ subject: `${userId}|session_a` })
      .mutation(api.cockpit.executePlan, { planId });
    // The approve SUCCEEDED — so "no decision recorded" is about attribution, not about a refusal.
    expect(approved.ok, `approve was refused: ${JSON.stringify(approved)}`).toBe(true);

    const out = await report(t, userId);
    // The run itself is counted; the plan decision is not attributed to it.
    expect(out.runCount).toBe(1);
    expect(out.planDecisions).toEqual({ approved: 0, edited: 0, rejected: 0 });
    // …and the executive's propose was not credited either. `planDecisions` does not count
    // `plan_proposed`, so this has to be read off the rows.
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows.map((r) => r.event)).not.toContain("plan_proposed");
  });
});

describe("the report reaches only the calling tenant", () => {
  test("a second user sees none of the first user's outcomes", async () => {
    const t = harness();
    const userA = String(await t.run((ctx) => ctx.db.insert("users", {})));
    const userB = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await completeJourney(t, userA);

    const a = await report(t, userA);
    const b = await report(t, userB);
    // PAIRED: asserting only that B sees nothing would pass against an empty table too.
    expect(a.runCount).toBe(1);
    expect(a.cost.runsPriced).toBe(1);
    expect(b.runCount).toBe(0);
    expect(b.eventCount).toBe(0);
    expect(b.cost).toEqual({ totalCents: 0, runsPriced: 0, runsJoined: 0 });
    expect(b.planDecisions).toEqual({ approved: 0, edited: 0, rejected: 0 });
    // A report with no data says so, in every measure, rather than reporting a perfect zero.
    expect(b.timeToFirstUsefulOutcome).toEqual({
      kind: "unknown",
      reason: "no_onboarding_timestamp",
    });
    expect(b.recommendationAcceptance).toEqual({ kind: "not_applicable", reason: "no_data" });
  });

  test("there is no tenantId argument to poison", async () => {
    const t = harness();
    const userA = String(await t.run((ctx) => ctx.db.insert("users", {})));
    const userB = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await t.mutation(internal.workflowPackEventLog.record, {
      tenantId: userA,
      packId: "brand-review",
      runId: "r1",
      event: "run_started",
    });
    await expect(
      t.withIdentity({ subject: `${userB}|session_a` }).query(api.workflowPackOutcomes.forTenant, {
        // biome-ignore lint/suspicious/noExplicitAny: proving the argument does not exist
        tenantId: userA,
      } as any),
    ).rejects.toThrow();
  });

  test("an unauthenticated caller is refused, not served an empty report", async () => {
    const t = harness();
    await expect(t.query(api.workflowPackOutcomes.forTenant, {})).rejects.toThrow();
  });

  // The cost join reads `spendEvents.by_correlation`, an index keyed on the correlation id ALONE.
  // A run id is a UUID so a real collision is not the worry — a shared correlation id from another
  // plane is, and the tenant check is what makes the join safe rather than the id's shape.
  // MUTATION that must turn this RED: drop the `r.tenantId === tenantId` filter in `costForRun`.
  test("another tenant's ledger row on the same correlation id is not counted", async () => {
    const t = harness();
    const userA = String(await t.run((ctx) => ctx.db.insert("users", {})));
    const userB = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await t.mutation(internal.workflowPackEventLog.record, {
      tenantId: userA,
      packId: "brand-review",
      runId: "shared-correlation",
      event: "run_started",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("spendEvents", {
        tenantId: userB,
        rail: "reasoning",
        phase: "actual",
        amountCents: 99,
        // The id the JOIN actually looks up — `runAgentLoop` charges under
        // `agentloop:<runId>:a<attempt>`, never the bare run id. Seeding the bare id would make this
        // test pass against any implementation, including one with no tenant check at all.
        correlationId: "agentloop:shared-correlation:a0",
        createdAt: Date.now(),
      });
    });
    const a = await report(t, userA);
    expect(a.cost).toEqual({ totalCents: 0, runsPriced: 0, runsJoined: 1 });
  });
});

describe("the report structurally cannot carry raw content (CLAUDE.md §4)", () => {
  // Over the WHOLE object, recursively. A key allow-list would keep passing while a nested field
  // grew a string; this asserts on the VALUES, which is where a leak would actually be.
  test("every leaf is a number, a boolean, or a closed-enum label", async () => {
    const t = harness();
    const userA = String(await t.run((ctx) => ctx.db.insert("users", {})));
    await completeJourney(t, userA);
    const out = await report(t, userA);

    const ALLOWED_STRINGS = new Set([
      "ratio",
      "not_applicable",
      "zero_denominator",
      "no_data",
      "known",
      "unknown",
      "no_onboarding_timestamp",
      "no_useful_outcome",
      "useful_precedes_onboarding",
    ]);
    const found = leaves(out);
    // Non-vacuity: an empty walk would make the loop below assert nothing.
    expect(found.length).toBeGreaterThan(15);
    for (const { path, value } of found) {
      if (typeof value === "number" || typeof value === "boolean" || value === null) continue;
      expect(typeof value, `${path} is not a scalar`).toBe("string");
      expect(ALLOWED_STRINGS.has(value as string), `${path} carries free text: ${value}`).toBe(
        true,
      );
    }
    // …and the words a leak would be made of appear nowhere in the serialized report.
    const serialized = JSON.stringify(out);
    for (const leak of ["furious", "sorry", "customer@example.test", "Re: your order", REPLY]) {
      expect(serialized, `the report leaked ${leak}`).not.toContain(leak);
    }
  });
});

describe("the read is bounded", () => {
  // A metric never needs an unbounded scan, and the cost/latency join multiplies every run by two
  // more indexed reads — so the run join has its OWN cap on top of the event page.
  // MUTATION that must turn this RED: drop the `.slice(0, PACK_RUN_JOIN_MAX)` in `forTenant`.
  test("the cost/latency join stops at PACK_RUN_JOIN_MAX runs", async () => {
    const t = harness();
    const userA = String(await t.run((ctx) => ctx.db.insert("users", {})));
    const runs = PACK_RUN_JOIN_MAX + 7;
    for (let i = 0; i < runs; i++) {
      await t.mutation(internal.workflowPackEventLog.record, {
        tenantId: userA,
        packId: "brand-review",
        runId: `run-${i}`,
        event: "run_completed",
        outcome: "useful",
      });
    }
    const out = await report(t, userA);
    // Every event is still counted — only the JOIN is capped, and the cap is visible in the result
    // rather than silently truncating.
    expect(out.runCount).toBe(runs);
    expect(out.completionOutcomes.useful).toBe(runs);
    expect(out.cost.runsJoined).toBe(PACK_RUN_JOIN_MAX);
  });
});
