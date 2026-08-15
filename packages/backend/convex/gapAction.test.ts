// Gap → approvable next-step MEMO (BEVL-02, 12-05) — convex-test over the SMOKE:: grounding seam.
//
// The two transitions this plan ships, asserted end to end with zero network:
//   1. actOnGap turns a surfaced gap into a PROPOSED memo-plan (no recipients) through the pinned
//      collecting→proposed spine — no new proposal store.
//   2. Approving that memo-plan takes the MEMO TERMINAL: the body persists as a `next_step_memo`
//      vault doc and the plan goes terminal WITHOUT seeding a single `requests` row (i.e. it never
//      enters the gmail fan-out — deliverApprovedPlan/gmail.send are structurally unreachable).
import { serializeProfile } from "@pikar/core";
import {
  DOC_GAP_PLAYBOOK,
  DOC_GAP_ROUTE,
  DOC_REVIEW_FRAMEWORK,
  voiceDocThreadId,
} from "@pikar/voice";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Fake timers — the `vault.test.ts` / `vaultExtract.test.ts` guard, applied here for the same
// reason (2026-08-04). Anything that reaches `startIngest` schedules the WORKFLOW component's
// workpool functions; under real timers they fire after this file finishes and retry-loop against a
// torn-down module runner, throwing `crypto is not defined` / `process is not defined` inside
// whichever file the worker runs next. These tests assert synchronous effects, so the timers never
// need to advance.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// The memo terminal ingests the doc through the SAME startIngest spine persistBrief uses, so the
// workflow components have to be registered (the cockpit.test.ts idiom).
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const THREAD = "thread_1";

function newTest(): TestConvex<typeof schema> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

/** A profile with direct labeled figures → growth-os auto-pick and exactly one money-model gap. */
function profileDocText(): string {
  const md = serializeProfile({
    name: "Acme Dog Training",
    oneLineDescription: "In-home dog training for busy urban owners.",
    persona: "solopreneur",
    stage: "early-revenue",
    offering: "6-week private obedience program",
    targetCustomer: "urban dog owners with new puppies",
    primaryGoals: ["more clients"],
    knownConstraints: [],
  });
  return `${md}\n\nCAC: $150\nLTGP: $4500\n30-day cash: $200\n`;
}

async function seedDoc(t: TestConvex<typeof schema>, text: string): Promise<Id<"vaultDocuments">> {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Business profile",
      kind: "brief",
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: text.length,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
}

/**
 * Run a grounded evaluation that surfaces exactly one leverage-ranked gap, then re-point that gap
 * at a route NO specialist is registered for.
 *
 * 15-04 (DISP-01): `actOnGap` now has two terminals. A gap routed at a REGISTERED specialist stages
 * `collecting` and schedules the dispatch — that branch, and its end-to-end approve, are asserted
 * in `evaluations.test.ts`, which owns them. This file characterizes the OTHER terminal, unchanged
 * since 12-05: no specialist to run ⇒ the deterministic `buildMemo` template lands `proposed`
 * immediately, and Approve persists it. `"scale"` is `diagnose()`'s own healthy-branch route and is
 * deliberately not a specialist, so this is a real emission rather than a contrived string.
 */
async function evaluateWithGap(t: TestConvex<typeof schema>): Promise<void> {
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t, profileDocText());
  await t.action(internal.evaluations.runEvaluation, {
    tenantId: TENANT,
    threadId: THREAD,
    query: `SMOKE::${docId}`,
  });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", TENANT).eq("threadId", THREAD))
      .order("desc")
      .first();
    if (row) await ctx.db.patch(row._id, { gaps: row.gaps.map((g) => ({ ...g, route: "scale" })) });
  });
}

describe("actOnGap (BEVL-02 — a tapped gap becomes a PROPOSED memo-plan)", () => {
  test("a surfaced gap crosses into the plan spine as a proposed memo with NO recipients", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await evaluateWithGap(t);

    const row = await asT.query(api.evaluations.byThread, { threadId: THREAD });
    expect(row?.gaps.length).toBeGreaterThanOrEqual(1);
    const gap = row?.gaps[0];

    const res = await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    expect(res.ok).toBe(true);

    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(plan?.status).toBe("proposed"); // through the pinned collecting→proposed spine
    expect(plan?.kind).toBe("memo"); // the discriminator the terminal branches on
    expect(plan?.recipients ?? []).toHaveLength(0); // a memo has NO recipients — it is not an email
    // The body IS the memo: it names the target specialist skill and cites the playbook by name.
    expect(plan?.body).toContain(gap?.label ?? "");
    expect(plan?.body).toContain(gap?.route ?? "");
    expect(plan?.body).toContain(gap?.playbook ?? "");
  });

  test("a healthy/thin evaluation exposes no gap to act on — nothing crosses the gate", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await t.mutation(internal.skills.seedSkills, {});
    // No seed docs → zero grounded findings → gaps suppressed (SC #1).
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: "SMOKE::",
    });

    const row = await asT.query(api.evaluations.byThread, { threadId: THREAD });
    expect(row?.gaps).toHaveLength(0);

    const res = await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    expect(res).toEqual({ ok: false, reason: "gap_not_found" });
    // Nothing crossed the gate: no plan row was proposed.
    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(plan?.status ?? "none").not.toBe("proposed");
  });
});

describe("memo terminal (approving a memo SAVES it — it is never an email)", () => {
  test("approve persists a next_step_memo vault doc and seeds ZERO requests rows (no gmail path)", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await evaluateWithGap(t);
    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });

    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
    const memoBody = plan?.body ?? "";
    // 15-05 ACTN-01: the ARM is selected BEFORE the mailbox pre-check, and that ordering is the
    // property — a memo must never require a connected Gmail. Asserted, not noted: with ZERO
    // gmailTokens rows an email plan refuses with gmail_not_connected here, so a passing approve
    // is only possible if the inline arm was chosen first.
    const tokenRows = await t.run((ctx) => ctx.db.query("gmailTokens").collect());
    expect(tokenRows, "the no-mailbox premise must hold or this test proves nothing").toHaveLength(
      0,
    );
    const res = await asT.mutation(api.cockpit.executePlan, { planId: plan?._id as Id<"plans"> });
    expect(res.ok).toBe(true);

    // The terminal is a PERSIST: the memo body is now a tenant-scoped next_step_memo vault doc.
    const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    const memo = docs.find((d) => d.kind === "next_step_memo");
    expect(memo).toBeDefined();
    expect(memo?.tenantId).toBe(TENANT);
    expect(memo?.text).toBe(memoBody);

    // …and NOT an email: zero requests rows seeded ⇒ deliverApprovedPlan/gmail.send unreachable.
    const requests = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(requests).toHaveLength(0);

    const after = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(after?.status).toBe("done"); // terminal, never "delivering"
  });

  test("double-approve is idempotent — exactly ONE memo doc is persisted", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await evaluateWithGap(t);
    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });

    await asT.mutation(api.cockpit.executePlan, { planId: plan?._id as Id<"plans"> });
    await asT.mutation(api.cockpit.executePlan, { planId: plan?._id as Id<"plans"> });

    const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(docs.filter((d) => d.kind === "next_step_memo")).toHaveLength(1);
  });

  // 15-05 ACTN-01: arm selection replaced the `plan.kind === "memo"` if, and it sits in exactly the
  // same place — AFTER the CAS read and the escalated guard, BEFORE the mailbox pre-check. The
  // "before" half is asserted above (no mailbox, still succeeds); this is the "after" half. Moving
  // the dispatch one line earlier would let a fail-closed escalated plan execute an action, which
  // is the failure mode a table-shaped refactor makes easy to introduce silently.
  test("an ESCALATED memo refuses (review_escalated) — the arm never runs, no doc, no requests", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await evaluateWithGap(t);
    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
    const planId = plan?._id as Id<"plans">;
    await t.run((ctx) => ctx.db.patch(planId, { escalated: true })); // REVW-02 fail-closed terminal

    const res = await asT.mutation(api.cockpit.executePlan, { planId });
    expect(res).toEqual({ ok: false, reason: "review_escalated" });

    const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(docs.filter((d) => d.kind === "next_step_memo")).toHaveLength(0); // inline arm never ran
    const requests = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(requests).toHaveLength(0); // …and neither did the workflow arm
    const after = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(after?.status).toBe("proposed"); // no CAS flip, no terminal
  });
});

// ── 14-08: SC3 — the voice-doc gap crosses the SAME Approve gate ──────────────────────────────
//
// Phase 14's whole claim is that the synthetic `voice-doc:<sessionId>` thread is a FIRST-CLASS
// citizen of this existing spine, not a parallel one: no new proposal store, no second gate, no
// forked memo builder. These tests are what make that claim checkable.
//
// Written against the OUTCOME (a `proposed` `kind:"memo"` plan, and no `requests` row) rather than
// against `actOnGap`'s internals, deliberately: Lane A's Phase 15 splits `actOnGap` into two
// terminals, routing gaps whose `route` names a REGISTERED specialist to a dispatch instead of a
// memo. `DOC_GAP_ROUTE` ("document-analyst") is not in that registry, so a voice-doc gap keeps
// taking the memo branch — and asserting the outcome means these tests survive that merge
// regardless of how the branch is implemented.
describe("actOnGap on a voice-doc thread (DOCV-01 / SC3)", () => {
  const DOC_THREAD = voiceDocThreadId("session_voicedoc_1");

  /** A document-review row with one gap, welded exactly as `shapeDocReview` welds it. */
  async function seedDocReview(t: ReturnType<typeof convexTest>): Promise<void> {
    const vaultDocId = await seedDoc(t, "Quarterly report. Churn rose in month two.");
    await t.mutation(internal.evaluations.insertEvaluation, {
      tenantId: TENANT,
      threadId: DOC_THREAD,
      framework: DOC_REVIEW_FRAMEWORK,
      findings: [
        {
          label: "Churn concentrates in month two",
          section: "pattern",
          citationDocId: vaultDocId,
          citationTitle: "Quarterly report",
          citationExcerpt: "Churn rose in month two.",
          confidence: "high",
          // "vault", not "grounded" — the schema union is `vault | user-provided | agent-relayed`,
          // what `shapeDocReview` welds. The fixture must mirror the real writer, not paraphrase it.
          source: "vault",
        },
      ],
      gaps: [
        {
          label: "No owner is named for retention",
          leverageRank: 1,
          route: DOC_GAP_ROUTE,
          playbook: DOC_GAP_PLAYBOOK,
          citationDocId: vaultDocId,
          reason: "The report states the problem but never says who acts on it",
          proofMetric: "A named owner and a review date",
        },
      ],
      notEnoughData: [],
      scorecard: [],
      userProvided: [],
      verdict: "gaps",
    });
  }

  test("a tapped voice-doc gap becomes a PROPOSED memo-plan", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedDocReview(t);

    const res = await asT.mutation(api.evaluations.actOnGap, {
      threadId: DOC_THREAD,
      gapIndex: 0,
    });

    expect(res.ok).toBe(true);
    const plan = await asT.query(api.plans.byThread, { threadId: DOC_THREAD });
    expect(plan?.kind).toBe("memo");
    expect(plan?.status).toBe("proposed");
  });

  test("the Approve gate is INTACT — nothing is executed before the human approves", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedDocReview(t);

    await asT.mutation(api.evaluations.actOnGap, { threadId: DOC_THREAD, gapIndex: 0 });

    const plan = await asT.query(api.plans.byThread, { threadId: DOC_THREAD });
    // Not approved, not delivering — the plan is PARKED at the gate.
    expect(plan?.status).toBe("proposed");
    expect(["approved", "delivering", "delivered"]).not.toContain(plan?.status);
    // And nothing was staged for the delivery fan-out. This is the assertion that would catch a
    // voice-doc gap accidentally being wired to a send path.
    const requests = await t.run(async (ctx) => await ctx.db.query("requests").collect());
    expect(requests).toHaveLength(0);
  });

  test("a second tap REUSES the one plan row, never inserts a second", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedDocReview(t);

    const first = await asT.mutation(api.evaluations.actOnGap, {
      threadId: DOC_THREAD,
      gapIndex: 0,
    });
    const second = await asT.mutation(api.evaluations.actOnGap, {
      threadId: DOC_THREAD,
      gapIndex: 0,
    });

    // A second tap on a still-`proposed` plan SUCCEEDS by recycling that row — correct behaviour:
    // changing your mind about which gap to act on must restage the memo, not be refused. What must
    // never happen is a SECOND row, because `plans.byThread` is a `.unique()` read and a duplicate
    // would make every later read of the thread THROW, not merely show the wrong thing.
    expect(second.ok).toBe(true);
    const plans = await t.run(async (ctx) => await ctx.db.query("plans").collect());
    expect(plans).toHaveLength(1);
    expect(first.ok && second.ok && first.planId === second.planId).toBe(true);
    // Still parked at the gate after the recycle.
    const plan = await asT.query(api.plans.byThread, { threadId: DOC_THREAD });
    expect(plan?.status).toBe("proposed");
  });

  test("an IN-FLIGHT plan is refused — staging a memo never clobbers a send", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedDocReview(t);
    await asT.mutation(api.evaluations.actOnGap, { threadId: DOC_THREAD, gapIndex: 0 });

    // Drive the plan past the gate, as an approval would.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("plans").first();
      if (p) await ctx.db.patch(p._id, { status: "delivering" });
    });

    const res = await asT.mutation(api.evaluations.actOnGap, {
      threadId: DOC_THREAD,
      gapIndex: 0,
    });

    expect(res).toEqual({ ok: false, reason: "plan_busy" });
  });

  test("a cross-tenant caller cannot act on the gap (BETA-05)", async () => {
    const t = newTest();
    await seedDocReview(t);

    const res = await t
      .withIdentity({ subject: "tenant_b" })
      .mutation(api.evaluations.actOnGap, { threadId: DOC_THREAD, gapIndex: 0 });

    // Reads as "no such gap" — the same answer a genuinely missing gap gives, so the response is
    // not an ownership oracle.
    expect(res.ok).toBe(false);
    const plans = await t.run(async (ctx) => await ctx.db.query("plans").collect());
    expect(plans).toHaveLength(0);
  });
});
