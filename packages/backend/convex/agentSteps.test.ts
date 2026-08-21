// The agent activity-trace content plane (03.9-01): tenant isolation + latest-turn semantics.
//
// `agentSteps` is the surface the agent loop writes to and the browser subscribes to. It is UI
// state, not an audit trail — and it is §4-safe STRUCTURALLY: the row has no field that can hold
// text, so there is nothing here to redact. What these tests guard is the other half: that a
// step reaches a terminal phase (a running row must never spin forever), that the newest turn is
// readable with NO threadId (the first-turn window — on message #1 the browser has no threadId
// until the wait is already over), and that tenant B can never read tenant A's trace.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";
const OTHER = "tenant_b";
const THREAD = "thread_1";
const TURN = "turn_1";
const NOW = 1_800_000_000_000;

type T = ReturnType<typeof convexTest>;

/** Record one step through the real internal writer (never a raw db.insert). */
function record(
  t: T,
  over: {
    tenantId?: string;
    threadId?: string;
    turnId?: string;
    stepKey?: string;
    tool?: "thinking" | "listInbox" | "draftBody";
    startedAt?: number;
  } = {},
) {
  return t.mutation(internal.agentSteps.record, {
    tenantId: over.tenantId ?? TENANT,
    threadId: over.threadId ?? THREAD,
    turnId: over.turnId ?? TURN,
    stepKey: over.stepKey ?? "thinking",
    tool: over.tool ?? "thinking",
    startedAt: over.startedAt ?? NOW,
  });
}

/** Read the tenant's newest turn the way the browser does. */
function latestTurn(t: T, tenantId = TENANT) {
  return t.withIdentity({ subject: tenantId }).query(api.agentSteps.latestTurn, {});
}

describe("agentSteps.record / finish (the step lifecycle)", () => {
  test("record inserts a running row with no endedAt", async () => {
    const t = convexTest(schema, modules);
    await record(t, { stepKey: "call_1", tool: "listInbox", startedAt: NOW });
    const turn = await latestTurn(t);
    expect(turn?.threadId).toBe(THREAD);
    expect(turn?.steps).toHaveLength(1);
    expect(turn?.steps[0]).toMatchObject({
      stepKey: "call_1",
      tool: "listInbox",
      phase: "running",
      startedAt: NOW,
    });
    expect(turn?.steps[0]?.durationMs).toBeUndefined();
  });

  test("finish patches the matching (tenantId, turnId, stepKey) row terminal, leaving startedAt alone", async () => {
    const t = convexTest(schema, modules);
    await record(t, { stepKey: "call_1", tool: "draftBody", startedAt: NOW });
    await t.mutation(internal.agentSteps.finish, {
      tenantId: TENANT,
      turnId: TURN,
      stepKey: "call_1",
      phase: "done",
      durationMs: 1234,
      endedAt: NOW + 1234,
    });
    const turn = await latestTurn(t);
    expect(turn?.steps[0]).toMatchObject({
      stepKey: "call_1",
      phase: "done",
      durationMs: 1234,
      startedAt: NOW, // unchanged — finish patches, never rewrites the start
    });
  });

  test("finish with phase 'error' patches to error (the tool-error path)", async () => {
    const t = convexTest(schema, modules);
    await record(t, { stepKey: "call_1", tool: "draftBody" });
    await t.mutation(internal.agentSteps.finish, {
      tenantId: TENANT,
      turnId: TURN,
      stepKey: "call_1",
      phase: "error",
      endedAt: NOW + 10,
    });
    const turn = await latestTurn(t);
    expect(turn?.steps[0]?.phase).toBe("error");
  });

  test("finish on a stepKey that was never recorded is a NO-OP, not a throw", async () => {
    const t = convexTest(schema, modules);
    await record(t, { stepKey: "call_1", tool: "draftBody" });
    // An out-of-order or duplicate finish must not blow up the mutation. (The SDK swallows
    // callback throws anyway — so a throw here would fail SILENTLY in production, which is worse.)
    await expect(
      t.mutation(internal.agentSteps.finish, {
        tenantId: TENANT,
        turnId: TURN,
        stepKey: "never_recorded",
        phase: "done",
        endedAt: NOW + 10,
      }),
    ).resolves.not.toThrow();
    const turn = await latestTurn(t);
    expect(turn?.steps, "the no-op must not have inserted a row").toHaveLength(1);
    expect(turn?.steps[0]?.phase).toBe("running");
  });

  test("finish is tenant-scoped — tenant B cannot terminalize tenant A's step", async () => {
    const t = convexTest(schema, modules);
    await record(t, { stepKey: "call_1", tool: "draftBody" });
    await t.mutation(internal.agentSteps.finish, {
      tenantId: OTHER, // same turnId + stepKey, different tenant
      turnId: TURN,
      stepKey: "call_1",
      phase: "done",
      endedAt: NOW + 10,
    });
    const turn = await latestTurn(t);
    expect(turn?.steps[0]?.phase, "tenant_b patched tenant_a's step row").toBe("running");
  });
});

describe("agentSteps.latestTurn (the first-turn window)", () => {
  test("returns ONLY the newest turn's rows, plus its threadId", async () => {
    const t = convexTest(schema, modules);
    await record(t, {
      turnId: "turn_old",
      threadId: "thread_old",
      stepKey: "old_1",
      startedAt: NOW,
    });
    await record(t, {
      turnId: "turn_new",
      threadId: "thread_new",
      stepKey: "new_1",
      startedAt: NOW + 1000,
    });
    await record(t, {
      turnId: "turn_new",
      threadId: "thread_new",
      stepKey: "new_2",
      tool: "listInbox",
      startedAt: NOW + 2000,
    });
    const turn = await latestTurn(t);
    expect(turn?.threadId).toBe("thread_new");
    expect(turn?.steps.map((s) => s.stepKey)).toEqual(["new_1", "new_2"]);
  });

  test("steps come back ascending by startedAt (the order they happened)", async () => {
    const t = convexTest(schema, modules);
    await record(t, { stepKey: "second", startedAt: NOW + 5000 });
    await record(t, { stepKey: "first", tool: "listInbox", startedAt: NOW });
    const turn = await latestTurn(t);
    expect(turn?.steps.map((s) => s.stepKey)).toEqual(["first", "second"]);
  });

  test("returns null when the tenant has no rows at all", async () => {
    const t = convexTest(schema, modules);
    expect(await latestTurn(t)).toBeNull();
  });

  test("CROSS-TENANT: tenant B's latestTurn returns null for tenant A's turn", async () => {
    const t = convexTest(schema, modules);
    await record(t); // owned by TENANT
    expect(await latestTurn(t, OTHER), "tenant_b read tenant_a's activity trace").toBeNull();
  });

  test("never returns more than 12 rows (bounded read — never .collect())", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 15; i++) {
      await record(t, { stepKey: `call_${i}`, tool: "listInbox", startedAt: NOW + i });
    }
    const turn = await latestTurn(t);
    expect(turn?.steps.length).toBeLessThanOrEqual(12);
  });
});

// ── 20-12: the eval harness's media observable reads THIS table, and two actors write to it ──
//
// `smoke:mediaDispatchCountForThread` answers "how many times did the AGENT call dispatchMedia".
// The trap is that `dispatch.ts` records the SPECIALIST RUN it schedules with the SAME tool name
// (`resolved.spec.stepTool`) on the SAME thread, under a `dispatch:<rootRequestId>` stepKey. A
// count that does not exclude it reads 2 for one call — which is exactly how fixture 38 failed its
// first paid gate run: the agent had behaved correctly and the observable was wrong. That cost a
// real eval run to discover, so it is pinned here where it costs nothing.
describe("mediaDispatchCountForThread — the AGENT's calls, not the specialist's run", () => {
  const mediaStep = (t: T, over: { stepKey: string; threadId?: string; tenantId?: string }) =>
    t.mutation(internal.agentSteps.record, {
      tenantId: over.tenantId ?? TENANT,
      threadId: over.threadId ?? THREAD,
      turnId: TURN,
      stepKey: over.stepKey,
      tool: "dispatchMedia",
      startedAt: NOW,
    });
  const count = (t: T, threadId = THREAD, tenantId = TENANT) =>
    t.query(internal.smoke.mediaDispatchCountForThread, { tenantId, threadId });

  test("ONE agent call plus its specialist run counts as ONE", async () => {
    const t = convexTest(schema, modules);
    await mediaStep(t, { stepKey: "call_abc" }); // the cockpit's tool call
    await mediaStep(t, { stepKey: "dispatch:root-1" }); // dispatch.ts's specialist run
    expect(await count(t)).toBe(1);
  });

  test("a genuine SECOND dispatch is still visible — the filter must not hide the defect", async () => {
    const t = convexTest(schema, modules);
    await mediaStep(t, { stepKey: "call_abc" });
    await mediaStep(t, { stepKey: "dispatch:root-1" });
    await mediaStep(t, { stepKey: "call_def" });
    expect(await count(t)).toBe(2);
  });

  test("a prose-only turn counts ZERO, and another thread's calls never leak in", async () => {
    const t = convexTest(schema, modules);
    await mediaStep(t, { stepKey: "call_abc", threadId: "other_thread" });
    await mediaStep(t, { stepKey: "call_xyz", tenantId: OTHER });
    expect(await count(t)).toBe(0);
  });
});

// The sibling read, added 2026-08-17 with the `imageProposalCount` eval key it serves. It has NO
// `dispatch:` filter and that asymmetry is deliberate rather than an omission: `proposeImage` is
// not a specialist route (no `stepTool` in SPECIALISTS), so `dispatch.ts` never writes this tool
// name and the second writer its sibling must exclude does not exist here. Pinned so a future
// reader does not "fix" the asymmetry by cargo-culting the filter across.
describe("imageProposalCountForThread — the still-image door", () => {
  const imageStep = (t: T, over: { stepKey: string; threadId?: string; tenantId?: string }) =>
    t.mutation(internal.agentSteps.record, {
      tenantId: over.tenantId ?? TENANT,
      threadId: over.threadId ?? THREAD,
      turnId: TURN,
      stepKey: over.stepKey,
      tool: "proposeImage",
      startedAt: NOW,
    });
  const count = (t: T, threadId = THREAD, tenantId = TENANT) =>
    t.query(internal.smoke.imageProposalCountForThread, { tenantId, threadId });

  test("one proposeImage call counts ONE", async () => {
    const t = convexTest(schema, modules);
    await imageStep(t, { stepKey: "call_img" });
    expect(await count(t)).toBe(1);
  });

  test("a SECOND proposal is visible — stageImagePlan recycles the one by_thread row", async () => {
    const t = convexTest(schema, modules);
    await imageStep(t, { stepKey: "call_img" });
    await imageStep(t, { stepKey: "call_img2" });
    expect(await count(t)).toBe(2);
  });

  test("a prose-only turn counts ZERO, and no other thread or tenant leaks in", async () => {
    const t = convexTest(schema, modules);
    await imageStep(t, { stepKey: "call_img", threadId: "other_thread" });
    await imageStep(t, { stepKey: "call_img", tenantId: OTHER });
    expect(await count(t)).toBe(0);
  });

  test("a dispatchMedia turn does NOT count as an image — the routing defect, offline", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentSteps.record, {
      tenantId: TENANT,
      threadId: THREAD,
      turnId: TURN,
      stepKey: "call_reel",
      tool: "dispatchMedia",
      startedAt: NOW,
    });
    expect(await count(t)).toBe(0);
  });
});

// ── The called-vs-never-called read (2026-08-16) ──────────────────────────────────────────────
//
// `mediaDispatchCountForThread` above answers ONE hardcoded tool, and `driveReadCountForThread`
// answers a hardcoded pair. Neither generalises, and that gap has a measured price: fixture
// `37-finance-update` failed the production gate three times, and across three sessions nobody
// could say whether `stageFinanceWrite` had been CALLED AND REFUSED or NEVER CALLED — the two
// have identical plan rows (`financeClaims` absent either way) and no reply assertion can tell
// them apart. The answer was in `agentSteps` the whole time; there was simply no read that could
// ask an arbitrary tool name.
//
// `toolCallsForThread` is that read: the whole per-tool breakdown for one thread, so the next
// "the agent did not do X" failure is one free query instead of a bisect.
describe("toolCallsForThread — which tools the AGENT called on this thread", () => {
  const step = (
    t: T,
    over: { tool: string; stepKey: string; threadId?: string; tenantId?: string },
  ) =>
    t.mutation(internal.agentSteps.record, {
      tenantId: over.tenantId ?? TENANT,
      threadId: over.threadId ?? THREAD,
      turnId: TURN,
      stepKey: over.stepKey,
      // biome-ignore lint/suspicious/noExplicitAny: the closed tool union is the schema's, not the test's
      tool: over.tool as any,
      startedAt: NOW,
    });
  const calls = (t: T, threadId = THREAD, tenantId = TENANT) =>
    t.query(internal.smoke.toolCallsForThread, { tenantId, threadId });

  // THE ONE THIS EXISTS FOR. "Never called" must be expressible, and it must be DISTINCT from
  // "called and refused" — a refused call still writes its step row, so it still appears here.
  test("a tool the agent never called is ABSENT, while one that ran is present", async () => {
    const t = convexTest(schema, modules);
    await step(t, { tool: "searchVault", stepKey: "call_a" });
    const seen = await calls(t);
    expect(seen.calls.searchVault).toBe(1);
    expect(seen.calls.stageFinanceWrite).toBeUndefined();
  });

  test("the specialist's dispatch run does not inflate the agent's count", async () => {
    const t = convexTest(schema, modules);
    await step(t, { tool: "dispatchMedia", stepKey: "call_abc" });
    await step(t, { tool: "dispatchMedia", stepKey: "dispatch:root-1" });
    expect((await calls(t)).calls.dispatchMedia).toBe(1);
  });

  test("another thread's and another tenant's calls never leak in", async () => {
    const t = convexTest(schema, modules);
    await step(t, { tool: "searchVault", stepKey: "call_a", threadId: "other_thread" });
    await step(t, { tool: "searchVault", stepKey: "call_b", tenantId: OTHER });
    expect((await calls(t)).calls).toEqual({});
  });
});

// ── The refusal code (2026-08-16) ─────────────────────────────────────────────────────────────
//
// A REFUSAL IS NOT AN ERROR, and that is why it was invisible. Every cockpit tool returns its
// refusal as a SENTENCE the model can act on rather than throwing (18-06's rule), so
// `onToolExecutionEnd` sees a successful `toolOutput` and closes the step `phase: "done"`. A
// refused call and a satisfied one were byte-identical in this table.
//
// `toolCallsForThread` closed half the gap — it says a tool WAS called. This closes the other
// half: WHICH refusal ended it. `stageFinanceWrite` on fixture 37 is the worked example; the
// answer took a production archaeology dig that this field makes a one-line read.
//
// The code is a CLOSED UNION of code-owned literals, never a message. This table's §4 safety is
// STRUCTURAL — there is no field that can hold text — and a free-form `reason` would have thrown
// that away to save typing an enum.
describe("the refusal code — a refused call is not an error, and must still be visible", () => {
  const open = (t: T, stepKey: string) =>
    t.mutation(internal.agentSteps.record, {
      tenantId: TENANT,
      threadId: THREAD,
      turnId: TURN,
      stepKey,
      tool: "stageFinanceWrite",
      startedAt: NOW,
    });
  const refuse = (t: T, stepKey: string, refusal: string, turnId = TURN) =>
    // biome-ignore lint/suspicious/noExplicitAny: the closed refusal union is the schema's
    t.mutation(internal.agentSteps.refuse, { tenantId: TENANT, turnId, stepKey, refusal } as any);
  const read = (t: T) =>
    t.query(internal.smoke.toolCallsForThread, { tenantId: TENANT, threadId: THREAD });

  test("a refused call reports its code, and still counts as a call", async () => {
    const t = convexTest(schema, modules);
    await open(t, "call_a");
    await refuse(t, "call_a", "invalid_claim");
    const seen = await read(t);
    expect(seen.calls.stageFinanceWrite).toBe(1);
    expect(seen.refusals).toEqual([{ tool: "stageFinanceWrite", refusal: "invalid_claim" }]);
  });

  // The whole point: these two were indistinguishable before, and they mean opposite things.
  test("a SATISFIED call reports no refusal — the two are distinguishable", async () => {
    const t = convexTest(schema, modules);
    await open(t, "call_a");
    const seen = await read(t);
    expect(seen.calls.stageFinanceWrite).toBe(1);
    expect(seen.refusals).toEqual([]);
  });

  // `finish` runs AFTER the tool returns, so a patch that dropped the code would erase it in the
  // one ordering that always happens in production.
  test("finish does not erase the refusal it was recorded before", async () => {
    const t = convexTest(schema, modules);
    await open(t, "call_a");
    await refuse(t, "call_a", "scorecard_field");
    await t.mutation(internal.agentSteps.finish, {
      tenantId: TENANT,
      turnId: TURN,
      stepKey: "call_a",
      phase: "done",
      endedAt: NOW + 5,
    });
    expect((await read(t)).refusals).toEqual([
      { tool: "stageFinanceWrite", refusal: "scorecard_field" },
    ]);
  });

  // Same no-op contract `finish` already holds: an out-of-order or duplicate call must not throw,
  // because the SDK swallows callback exceptions and a throw would fail SILENTLY in production.
  test("an unmatched step is a NO-OP, never a throw", async () => {
    const t = convexTest(schema, modules);
    await open(t, "call_a");
    await expect(refuse(t, "no_such_step", "unknown_field")).resolves.not.toThrow();
    expect((await read(t)).refusals).toEqual([]);
  });
});
