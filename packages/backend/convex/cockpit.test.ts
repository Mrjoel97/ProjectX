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
import { parseAnswer, toIntentState } from "./cockpit";
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
  // Recipients now segment on comma / "and" ONLY — intra-segment spaces are preserved so a
  // multi-word NAME ("Sarah Chen") stays one segment for Gmail resolution (03.2-04).
  test("recipients split on comma and the word 'and' (not on bare whitespace)", () => {
    expect(parseAnswer({ kind: "ask_recipients" }, "a@x.com, b@y.com, c@z.com")).toEqual({
      slot: "recipients",
      value: ["a@x.com", "b@y.com", "c@z.com"],
    });
    // Double-space remainder is ONE segment now (no whitespace split — only comma split).
    expect(parseAnswer({ kind: "ask_recipients" }, "a@x.com, b@y.com  c@z.com")).toEqual({
      slot: "recipients",
      value: ["a@x.com", "b@y.com  c@z.com"],
    });
  });

  test("comma / 'and' segmentation: names stay whole, 'and' separates", () => {
    expect(parseAnswer({ kind: "ask_recipients" }, "Sarah, john@x.com")).toEqual({
      slot: "recipients",
      value: ["Sarah", "john@x.com"],
    });
    expect(parseAnswer({ kind: "ask_recipients" }, "Sarah and Bob")).toEqual({
      slot: "recipients",
      value: ["Sarah", "Bob"],
    });
    // A multi-word name is ONE segment — intra-segment spaces preserved.
    expect(parseAnswer({ kind: "ask_recipients" }, "Sarah Chen")).toEqual({
      slot: "recipients",
      value: ["Sarah Chen"],
    });
    expect(parseAnswer({ kind: "ask_recipients" }, "a@b.com, c@d.com")).toEqual({
      slot: "recipients",
      value: ["a@b.com", "c@d.com"],
    });
  });

  // REGRESSION (Pitfall 3, accepted behavior break): space-separated emails are now ONE
  // malformed segment that bounces to the existing re-ask — documented, not silent.
  test("space-separated emails collapse to ONE malformed segment (accepted break)", () => {
    const answer = parseAnswer({ kind: "ask_recipients" }, "a@b.com c@d.com");
    expect(answer).toEqual({ slot: "recipients", value: ["a@b.com c@d.com"] });
    // applyAnswer treats the single compound token as one address → has '@' but invalid.
    const result = applyAnswer(emptyIntent, answer!);
    expect(result.ok).toBe(false);
    expect(result.state.recipients).toEqual([]);
    if (!result.ok) expect(result.rejected.invalid).toEqual(["a@b.com c@d.com"]);
  });

  // NOTE: the invalid token must contain '@' — a no-'@' token ("not-an-email") is now a NAME to
  // resolve (Plan 01 classification), NOT an invalid. A malformed has-'@' token ("bad@") is the
  // genuine invalid that bounces, preserving the mixed valid/invalid coverage intent.
  test("comma-based mixed valid/invalid: only valids stored, the malformed '@' bounces (via applyAnswer)", () => {
    const answer = parseAnswer({ kind: "ask_recipients" }, "good@x.com, bad@");
    const result = applyAnswer(emptyIntent, answer!);
    expect(result.ok).toBe(false);
    expect(result.state.recipients).toEqual(["good@x.com"]);
    if (!result.ok) expect(result.rejected.invalid).toEqual(["bad@"]);
  });

  // A space-joined valid+invalid ("good@x.com not-an-email") is now ONE compound segment (no
  // whitespace split) → applyAnswer bounces the whole token, storing nothing.
  test("space-joined valid+invalid is ONE compound segment that bounces whole", () => {
    const answer = parseAnswer({ kind: "ask_recipients" }, "good@x.com not-an-email");
    const result = applyAnswer(emptyIntent, answer!);
    expect(result.ok).toBe(false);
    expect(result.state.recipients).toEqual([]);
    if (!result.ok) expect(result.rejected.invalid).toEqual(["good@x.com not-an-email"]);
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

describe("toIntentState projection (transient resolution fields survive across turns)", () => {
  test("candidates → pendingResolution names, pendingValid → pendingValid, greetingName carried", () => {
    const state = toIntentState({
      recipients: ["a@x.com"],
      subject: "Hi",
      pendingValid: ["b@y.com"],
      greetingName: "Sarah",
      candidates: [
        { name: "Sarah", matches: [{ address: "sarah@x.com", count: 2 }] },
        { name: "Bob", matches: [{ address: "bob@y.com", count: 1 }] },
      ],
    });
    // A resolution card persists: nextQuestion keeps returning resolve_recipients until the pick.
    expect(state.pendingResolution).toEqual([{ name: "Sarah" }, { name: "Bob" }]);
    expect(state.pendingValid).toEqual(["b@y.com"]);
    expect(state.greetingName).toBe("Sarah");
  });

  test("no candidates → no pendingResolution (a normal turn is unaffected)", () => {
    const state = toIntentState({ recipients: ["a@x.com"], subject: "Hi" });
    expect(state.pendingResolution).toBeUndefined();
    expect(state.pendingValid).toBeUndefined();
  });
});
