// SC4 mutation-level invariants (convex-test): the executePlan approve-gate is idempotent
// (double-approve → one workflow), never seeds/starts on a non-proposed status (zero sends
// before Approve), rejects a cross-tenant approve, and refuses when no mailbox is connected.
//
// The deterministic FSM parser (parseAnswer/toIntentState) was DELETED in 03.2.1-05 (the cockpit
// reasons via the agent tool-loop now) — its tests went with it. The guard tests below RETURN
// before workflow.start; the attachment fan-out tests (CKPT-02, Plan 05) DO drive the successful
// proposed→delivering path by registering the workflow + workflow/workpool components (the same
// pattern cockpitTools.test.ts uses for the aggregate). smoke:fanout remains the live coverage.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
// Register the delivery components so executePlan can reach workflow.start under convex-test
// (workpool is a test-only devDep pinned to the version @convex-dev/workflow already resolves).
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");

const TENANT = "tenant_a";

/** A convex-test instance wired to run executePlan's successful (workflow.start) path. */
function withDelivery() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

/** A mailbox has to exist for executePlan to proceed past the gmail pre-check. */
const seedMailbox = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.run((ctx) =>
    ctx.db.insert("gmailTokens", { tenantId, refreshToken: "r", scope: "s", updatedAt: Date.now() }),
  );

/** Seed a plans row at a given status (raw insert — bypasses the guided conversation). */
async function seedPlan(
  t: ReturnType<typeof convexTest>,
  status: "collecting" | "proposed" | "approved" | "delivering" | "done",
  tenantId = TENANT,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_1",
      status,
      recipients: ["a@example.com", "b@example.com"],
      mode: "individual",
      subject: "Q3 update",
      body: "Here is the Q3 update.",
      createdAt: Date.now(),
    }),
  );
}

const countRequests = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("requests").collect());

describe("executePlan approve-gate (SC4)", () => {
  test("idempotent: a non-proposed (already-approved) plan no-ops — double-approve sends once", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "delivering"); // as if the FIRST approve already ran
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: true, alreadyStarted: true });
    // No SECOND set of rows seeded, status untouched → no second workflow.
    expect(await countRequests(t)).toHaveLength(0);
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
  });

  test("zero sends before approve: a still-collecting plan never seeds or starts", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting");
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: true, alreadyStarted: true });
    expect(await countRequests(t)).toHaveLength(0);
  });

  test("no mailbox connected: a proposed plan refuses and seeds nothing (stop before delivery)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed"); // ready to approve, but no gmailTokens row
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: false, reason: "gmail_not_connected" });
    expect(await countRequests(t)).toHaveLength(0);
    // The CAS did NOT advance past proposed (nothing sent).
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
  });

  test("tenant guard: another tenant's plan is not found (no cross-tenant approve)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed", "tenant_b");
    const asT = t.withIdentity({ subject: TENANT }); // tenant_a approving tenant_b's plan

    await expect(asT.mutation(api.cockpit.executePlan, { planId })).rejects.toThrow(/plan not found/);
  });
});

describe("executePlan attachment fan-out (CKPT-02 — one byte set shared across recipients)", () => {
  test("propagates the SAME generated attachment ref to every recipient's request row", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // One generated document (real bytes in storage) referenced inline on the plan (pre-approval).
    const blobId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["pdf-bytes"], { type: "application/pdf" })),
    );
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com"], // 2 recipients → 2 request rows
        mode: "individual",
        subject: "Q3 update",
        body: "Here is the Q3 update.",
        attachments: [{ storageId: blobId, filename: "q3.pdf", mimeType: "application/pdf", size: 9 }],
        createdAt: Date.now(),
      }),
    );

    const res = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(2);
    // Every recipient carries a non-empty ref set...
    for (const r of reqs) expect(r.attachmentRefs.length).toBe(1);
    // ...and it is the SAME id across recipients (one shared row, no per-recipient duplication).
    const [ref0, ref1] = reqs.map((r) => r.attachmentRefs[0] as Id<"attachments">);
    expect(ref0).toBe(ref1);
    // Exactly ONE attachments row materialized (shared), resolving to the plan's generated document.
    const atts = await t.run((ctx) => ctx.db.query("attachments").collect());
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ filename: "q3.pdf", storageId: blobId, tenantId: TENANT });
  });

  test("a zero-attachment plan still seeds attachmentRefs: [] (unchanged path)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedPlan(t, "proposed"); // no attachments field

    const res = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.attachmentRefs).toEqual([]);
    // No attachments rows materialized when the plan carries none.
    expect(await t.run((ctx) => ctx.db.query("attachments").collect())).toHaveLength(0);
  });
});

describe("executePlan per-recipient personalization (CKPT-03 — distinct bodies, shared subject)", () => {
  test("each recipient's draft is its tailored override; a non-personalized recipient falls back to the shared body; the goal (subject) is shared", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // 3 recipients, 2 tailored + 1 without an override; an ORPHAN key (z@) no longer in recipients
    // is simply never looked up (no error, no extra row). Keyed by the RAW recipients[i] value —
    // the same value the seed loop iterates from plan.recipients (Wave 2 write/read alignment).
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com", "c@example.com"],
        mode: "individual",
        subject: "Q3 update", // SHARED goal for every row
        body: "Here is the Q3 update.", // the shared fallback body
        recipientBodies: {
          "a@example.com": "Dear A, your Q3 numbers.",
          "b@example.com": "Yo B, quick Q3 hit.",
          "z@example.com": "orphaned — not in recipients", // ignored harmlessly at seed
        },
        createdAt: Date.now(),
      }),
    );

    const res = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(3); // one row per recipient — the orphan key adds nothing
    const byRecipient = Object.fromEntries(reqs.map((r) => [r.recipient, r]));

    // Distinct tailored bodies land in their OWN request row...
    expect(byRecipient["a@example.com"]?.draft).toBe("Dear A, your Q3 numbers.");
    expect(byRecipient["b@example.com"]?.draft).toBe("Yo B, quick Q3 hit.");
    // ...and the non-personalized recipient falls back to the shared body (no error, no duplication).
    expect(byRecipient["c@example.com"]?.draft).toBe("Here is the Q3 update.");
    // The subject (goal) is SHARED across every recipient regardless of body tailoring.
    for (const r of reqs) expect(r.goal).toBe("Q3 update");
  });
});
