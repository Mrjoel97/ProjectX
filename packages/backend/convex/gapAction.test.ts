// Gap → approvable next-step MEMO (BEVL-02, 12-05) — convex-test over the SMOKE:: grounding seam.
//
// The two transitions this plan ships, asserted end to end with zero network:
//   1. actOnGap turns a surfaced gap into a PROPOSED memo-plan (no recipients) through the pinned
//      collecting→proposed spine — no new proposal store.
//   2. Approving that memo-plan takes the MEMO TERMINAL: the body persists as a `next_step_memo`
//      vault doc and the plan goes terminal WITHOUT seeding a single `requests` row (i.e. it never
//      enters the gmail fan-out — deliverApprovedPlan/gmail.send are structurally unreachable).
import { serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// The memo terminal ingests the doc through the SAME startIngest spine persistBrief uses, so the
// workflow components have to be registered (the cockpit.test.ts idiom).
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const THREAD = "thread_1";

function newTest(): ReturnType<typeof convexTest> {
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

async function seedDoc(t: ReturnType<typeof convexTest>, text: string): Promise<Id<"vaultDocuments">> {
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

/** Run a grounded evaluation that surfaces exactly one leverage-ranked gap. */
async function evaluateWithGap(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t, profileDocText());
  await t.action(internal.evaluations.runEvaluation, {
    tenantId: TENANT,
    threadId: THREAD,
    query: `SMOKE::${docId}`,
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
    // NOTE: no gmailTokens row is seeded — an email plan would refuse with gmail_not_connected
    // here, so a passing approve proves the memo branch runs BEFORE the mailbox pre-check.
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
});
