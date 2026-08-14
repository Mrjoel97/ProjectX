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
