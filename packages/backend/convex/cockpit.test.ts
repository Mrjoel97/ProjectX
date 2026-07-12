// SC4 mutation-level invariants (convex-test): the executePlan approve-gate is idempotent
// (double-approve → one workflow), never seeds/starts on a non-proposed status (zero sends
// before Approve), rejects a cross-tenant approve, and refuses when no mailbox is connected.
// Plus the pure free-text→Answer parser (the one new bit of domain logic in cockpit.ts).
//
// Scope: convex-test does not load the workflow component in this repo (see guardrails.test.ts),
// so NO test drives the successful proposed→delivering path — that reaches workflow.start and is
// covered by smoke:fanout (plan 04). Every branch here RETURNS before workflow.start.
import { applyAnswer, emptyIntent } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { parseAnswer } from "./cockpit";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";

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

describe("parseAnswer free-text → Answer (pure)", () => {
  test("recipients split on comma AND whitespace", () => {
    expect(parseAnswer({ kind: "ask_recipients" }, "a@x.com, b@y.com  c@z.com")).toEqual({
      slot: "recipients",
      value: ["a@x.com", "b@y.com", "c@z.com"],
    });
  });

  test("mixed valid/invalid recipients: only valids stored, the invalid bounces (via applyAnswer)", () => {
    const answer = parseAnswer({ kind: "ask_recipients" }, "good@x.com not-an-email");
    const result = applyAnswer(emptyIntent, answer!);
    expect(result.ok).toBe(false);
    expect(result.state.recipients).toEqual(["good@x.com"]);
    if (!result.ok) expect(result.rejected.invalid).toEqual(["not-an-email"]);
  });

  test('mode parse: "separately" → individual, "one group thread" → group', () => {
    expect(parseAnswer({ kind: "ask_mode" }, "send them separately")).toEqual({
      slot: "mode",
      value: "individual",
    });
    expect(parseAnswer({ kind: "ask_mode" }, "as one group thread please")).toEqual({
      slot: "mode",
      value: "group",
    });
  });

  test("ready returns null (nothing to fold in)", () => {
    expect(parseAnswer({ kind: "ready" }, "anything")).toBeNull();
  });
});
