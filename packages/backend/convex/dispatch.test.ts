// @vitest-environment node
//
// The governed sub-agent dispatcher (DISP-01).
//
// Wave 0 (15-01) shipped ONE assertion here — the anti-silent-failure literal guard below. 15-03
// appends the real suite: depth cap, cycle refusal, the shared root-request envelope, the
// refs-only lineage, and two-tenant isolation over `rootRequestId`.
//
// `node` environment (the runCockpitAgent.test.ts idiom): `dispatch.ts` imports
// `runSpecialistTurn` from the `"use node"` llm.ts, and the mock-model loop wants the node runtime.
import { serializeProfile } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// The dispatcher's lineage audits hit the auditCounts aggregate and its envelope reads/spends hit
// the rate-limiter's daily-spend window. Register both (relative imports — the packages block the
// deep specifier) so the REAL paths run under convex-test instead of throwing "component not
// registered". The evaluations.test.ts / runCockpitAgent.test.ts idiom, verbatim.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildSpecialistPrompt, type DispatchResult } from "./dispatch";
import { stableTenant } from "./lib/functions";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

// The loop-driving tests import `ai` + `@ai-sdk/openai` through the "use node" llm.ts inside
// convex-test's lazy module loader; on a cold checkout that first import alone exceeds the 5s
// default (15-01 hit the same wall in runCockpitAgent.test.ts). Raise the file's budget rather
// than shipping a test that is red once per fresh clone.
vi.setConfig({ testTimeout: 30_000 });

// ── Wave 0 (15-01): the anti-silent-failure guard ─────────────────────────────────────────────
//
// WHY this one assertion earns its place: the `agentSteps.tool` union is CLOSED, and the step row
// is inserted from inside an SDK tool callback. A missing literal throws there — and the SDK
// SWALLOWS it. Prod gets a blank activity card while every other test in this repo stays green
// (the searchVault / evaluateBusiness comments in schema.ts warn about exactly this). The only
// thing that catches it is an insert of each literal against the REAL schema.
const DISPATCH_STEP_TOOLS = [
  "dispatchOfferArchitect",
  "dispatchMoneyModelDesigner",
  "dispatchLeadEngine",
] as const;

test.each(DISPATCH_STEP_TOOLS)("agentSteps accepts the %s literal", async (tool) => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) =>
    ctx.db.insert("agentSteps", {
      tenantId: "tenant_a",
      threadId: "th",
      turnId: "turn",
      stepKey: `k_${tool}`,
      tool,
      phase: "running",
      startedAt: Date.now(),
    }),
  );
  // The insert not throwing IS the assertion; read it back so the test cannot pass vacuously
  // if `insert` ever stops validating.
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ tool, phase: "running" });
});

// ── 15-03: the real dispatch suite ────────────────────────────────────────────────────────────

// Instantiated with the REAL schema, not the bare `ReturnType<typeof convexTest>` the other
// suites use: without the generic, `ctx.db` inside `t.run` degrades to SystemIndexes only and
// `withIndex("by_correlation")` stops typechecking — and by_correlation IS the SC#3 mechanism.
type T = TestConvex<typeof schema>;

const TENANT = "tenant_a";
const TENANT_B = "tenant_b";
const THREAD = "thread_1";
const ROOT = "root-req-1";
/** Distinctive scripted specialist output — the §4 leak scan searches every payload for its words. */
const REPLY = "Ziggurat pricing ladder: bundle onboarding with the quarterly retainer.";

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await t.mutation(internal.skills.seedSkills, {}); // the 3 specialist rubrics seed v1 ACTIVE
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT,
    threadId: THREAD,
  });
  return { t, planId };
}

// ── Scripted mock doGenerate results (LanguageModelV4 provider shape; runCockpitAgent.test.ts) ──
const provUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const toolStep = (toolName: string, input: unknown) => ({
  content: [
    { type: "tool-call", toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage: provUsage(0, 0),
  warnings: [],
});
const textStep = (text: string, input = 0, output = 0) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: provUsage(input, output),
  warnings: [],
});

/** DEFAULT_MODEL is $0.15/$0.60 per MTok, so 100k/100k ≈ $0.075 → 8 cents (Math.ceil). */
const SPEND_8_CENTS = provUsage(100_000, 100_000);
const REPLY_STEP = { ...textStep(REPLY), usage: SPEND_8_CENTS };

/** Every arg except `planId` + the script — call sites spread this and override one field. */
const BASE = {
  tenantId: TENANT,
  threadId: THREAD,
  gapIndex: 0,
  route: "offer-architect",
  rootRequestId: ROOT,
  parentAgentId: "executive",
  depth: 1,
  ancestry: [] as string[],
  envelopeCents: 0,
  spentCents: 0,
};

const readPlan = (t: T, planId: Id<"plans">) => t.run((ctx) => ctx.db.get(planId));
const readSteps = (t: T) => t.run((ctx) => ctx.db.query("agentSteps").collect());
const readDeadLetters = (t: T) => t.run((ctx) => ctx.db.query("deadLetters").collect());
const readLineage = (t: T, correlationId = ROOT) =>
  t.run((ctx) =>
    ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect(),
  );
const remaining = (t: T) => t.query(internal.guardrails.remainingDailyCents, {});

/** Drive the twin, tolerating a throw: a withheld tool name may propagate out of generateText. */
async function runTolerant(t: T, args: Record<string, unknown>): Promise<void> {
  try {
    await t.action(internal.dispatch.__runSpecialistWithScript, args as never);
  } catch {
    /* the assertion is the ABSENCE of the side effect, not the error */
  }
}

function ok(res: DispatchResult): Extract<DispatchResult, { ok: true }> {
  if (!res.ok) throw new Error(`expected a specialist run, got refusal "${res.reason}"`);
  return res;
}

describe("SC#1 — a named specialist runs in THE governed loop", () => {
  test("the happy path returns the specialist's body under the registry's ACTIVE skill row", async () => {
    const { t, planId } = await setup();
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
      }),
    );

    expect(res.route).toBe("offer-architect");
    expect(res.body).toBe(REPLY);
    // The system prompt WAS the registry row: the returned version is the ACTIVE one (§5).
    const active = await t.query(internal.skills.getActiveSkill, { name: "offer-architect" });
    expect(res.skillVersion).toBe(active.version);
    expect(res.costUsd).toBeGreaterThan(0);
    // The trace terminalizes: one dispatch step, ended `done`, none left running.
    const steps = await readSteps(t);
    const dispatchStep = steps.find((s) => s.tool === "dispatchOfferArchitect");
    expect(dispatchStep?.phase).toBe("done");
    expect(steps.filter((s) => s.phase === "running")).toEqual([]);
  });

  test("only the granted tool is callable — a withheld write tool never moves the plan row", async () => {
    const { t, planId } = await setup();
    // `setSubject` is a write tool with an independently observable slot. (The plan named
    // `proposePlan`; it refuses an empty plan, so that fixture cannot discriminate — 15-02
    // hit the same wall and switched for the same reason.)
    await runTolerant(t, {
      ...BASE,
      planId,
      primary: [toolStep("setSubject", { subject: "Hijacked" }), textStep("done")],
    });

    expect(
      (await readPlan(t, planId))?.subject,
      "a withheld write tool moved the plan row",
    ).toBeFalsy();
    expect(
      (await readSteps(t)).map((s) => s.tool),
      "a withheld tool emitted an activity step — it was reachable",
    ).not.toContain("setSubject");
  });

  test("non-vacuity: the GRANTED searchVault tool does run inside the specialist turn", async () => {
    const { t, planId } = await setup();
    await runTolerant(t, {
      ...BASE,
      planId,
      // `SMOKE::` rides vaultGround's offline seam — no embedding call, no network.
      primary: [toolStep("searchVault", { query: "SMOKE::" }), textStep("done")],
    });

    // Without this, the withholding test above would pass against a filter that returned {}.
    expect(
      (await readSteps(t)).map((s) => s.tool),
      "the GRANTED tool was filtered out too — the allow-list is inverted",
    ).toContain("searchVault");
  });
});

describe("SC#1/#2 — every refusal is conversational, costs nothing, and DLQs nothing", () => {
  const REFUSALS: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ["an unknown route", { route: "does-not-exist" }, "unknown_route"],
    // diagnose()'s not-enough-data ask branch emits "" and it persists as v.string().
    ["an empty route", { route: "" }, "unknown_route"],
    ["depth > 1", { depth: 2 }, "depth_exceeded"],
    [
      "a repeated specialist",
      { depth: 1, ancestry: ["offer-architect"], route: "offer-architect" },
      "cycle_refused",
    ],
    [
      "an A->B->A chain",
      { depth: 1, ancestry: ["offer-architect", "lead-engine"], route: "offer-architect" },
      "cycle_refused",
    ],
  ];

  test.each(REFUSALS)("%s refuses with %s", async (_name, over, reason) => {
    const { t, planId } = await setup();
    const before = await remaining(t);

    const res = await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...BASE,
      planId,
      primary: [REPLY_STEP],
      ...over,
    } as never);

    expect(res.ok, "a refusal returned a specialist run").toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe(reason);
    // A calm conversational sentence that never names the internal reason code (the PAUSED_REPLY
    // precedent: a governed stop is a paused conversation, not a system failure).
    expect(res.reply.length).toBeGreaterThan(20);
    expect(res.reply).not.toContain(reason);
    // NO model call: the daily-spend window is untouched (recordSpend never ran).
    expect(await remaining(t), "a refusal still spent model budget").toBe(before);
    // Never a DLQ — the cockpit has never dead-lettered a user-facing turn.
    expect(await readDeadLetters(t)).toEqual([]);
    // A refused dispatch never STARTED, so it must not paint a running step.
    expect(await readSteps(t), "a refused dispatch painted an activity step").toEqual([]);
    // The refusal IS on the lineage — a governed stop is recorded, refs + a CODE, never prose.
    const lineage = await readLineage(t);
    expect(lineage.map((r) => r.eventType)).toEqual(["subagent.refused"]);
    expect(lineage[0]?.payload).toMatchObject({ rootRequestId: ROOT, reason });
  });

  test("refusals RETURN — none of them rejects", async () => {
    const { t, planId } = await setup();
    for (const [, over] of REFUSALS) {
      await expect(
        t.action(internal.dispatch.__runSpecialistWithScript, {
          ...BASE,
          planId,
          primary: [REPLY_STEP],
          ...over,
        } as never),
      ).resolves.toMatchObject({ ok: false });
    }
  });
});

// ── The shared root-request envelope + the refs-only lineage ──────────────────────────────────

/** The lineage rows, in the order they were written. `by_correlation` is a (correlationId,
 *  _creationTime) index, so `.collect()` already yields insertion order; the `ts` sort makes the
 *  "ordered by ts" reconstruction SC#3 names explicit rather than incidental. */
const orderedLineage = async (t: T, correlationId = ROOT) =>
  (await readLineage(t, correlationId)).sort(
    (a, b) => a.ts - b.ts || a._creationTime - b._creationTime,
  );
const completedRows = <R extends { eventType: string }>(rows: readonly R[]) =>
  rows.filter((r) => r.eventType === "subagent.completed");

/** Hop 2 of a tree: a DIFFERENT specialist, parented on hop 1, threading its envelope + spend. */
const secondHop = (hop1: Extract<DispatchResult, { ok: true }>, planId: Id<"plans">) => ({
  ...BASE,
  planId,
  primary: [REPLY_STEP],
  route: "lead-engine",
  parentAgentId: "offer-architect",
  ancestry: ["offer-architect"],
  envelopeCents: hop1.envelopeCents, // carried UNCHANGED — ONE envelope for the whole tree
  spentCents: hop1.spentCents, // …drawn down as the tree runs
});

describe("the shared root-request cost envelope", () => {
  test("ONE envelope derives from the LIVE daily rail at the root of the tree", async () => {
    const { t, planId } = await setup();
    const rail = await remaining(t);
    expect(rail, "the daily rail is already drained — the derivation is untestable").toBeGreaterThan(
      0,
    );

    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
      }),
    );

    expect(res.envelopeCents).toBeGreaterThan(0);
    expect(res.envelopeCents).toBeLessThanOrEqual(rail);
    // A FRACTION of the rail, not the rail itself: one sub-agent tree can never drain the day.
    expect(res.envelopeCents, "the envelope is the whole rail — the fraction is not applied").toBeLessThan(rail);
    // Non-vacuity companion for the `incomplete` assertions below: a hop well inside its
    // envelope is NOT labelled incomplete, so `incomplete: true` means something.
    expect(res.incomplete, "a hop well inside the envelope was labelled incomplete").toBe(false);
    expect(res.spentCents).toBe(Math.ceil(res.costUsd * 100));
  });

  test("the envelope is drawn down ACROSS hops — the second starts where the first stopped", async () => {
    const { t, planId } = await setup();
    const hop1 = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
      }),
    );
    expect(hop1.spentCents).toBeGreaterThan(0);

    const hop2 = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, secondHop(hop1, planId)),
    );

    // A non-zero incoming envelope is carried through UNCHANGED — that is what makes it ONE
    // envelope for the tree rather than a fresh allowance per hop.
    expect(hop2.envelopeCents, "hop 2 re-derived its own envelope").toBe(hop1.envelopeCents);
    expect(hop2.spentCents).toBe(hop1.spentCents + Math.ceil(hop2.costUsd * 100));

    // OBSERVABLE, not inferred: the drawdown is on the lineage rows themselves.
    const done = completedRows(await orderedLineage(t));
    expect(done.map((r) => r.payload.spentCents)).toEqual([hop1.spentCents, hop2.spentCents]);
    expect(done.map((r) => r.payload.envelopeCents)).toEqual([
      hop1.envelopeCents,
      hop1.envelopeCents,
    ]);
  });

  test("a DRAINED envelope refuses conversationally mid-tree — no model call, no DLQ, no step", async () => {
    const { t, planId } = await setup();
    const before = await remaining(t);

    const res = await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...BASE,
      planId,
      primary: [REPLY_STEP],
      envelopeCents: 10,
      spentCents: 10, // the tree has already spent its whole allowance
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("budget_exhausted");
    expect(res.reply.length).toBeGreaterThan(20);
    expect(res.reply).not.toContain("budget_exhausted");
    expect(await remaining(t), "an exhausted envelope still spent model budget").toBe(before);
    expect(await readDeadLetters(t)).toEqual([]);
    expect(await readSteps(t)).toEqual([]);
    expect((await readLineage(t)).map((r) => r.eventType)).toEqual(["subagent.refused"]);
  });

  test("an OVERRUNNING hop keeps its output and is labelled incomplete", async () => {
    const { t, planId } = await setup();
    // 5 cents left, an 8-cent turn: the guard passes (0 < 5), the call overruns. Stop AFTER the
    // call that overran — never discard work already paid for.
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
        envelopeCents: 5,
        spentCents: 0,
      }),
    );

    expect(res.body, "the overrunning hop's output was discarded").toBe(REPLY);
    expect(res.incomplete).toBe(true);
    expect(res.spentCents).toBeGreaterThanOrEqual(5);
    expect(completedRows(await orderedLineage(t))[0]?.payload).toMatchObject({ incomplete: true });
  });

  test("a rail driven NEGATIVE clamps to a ZERO envelope — never a negative ceiling", async () => {
    const { t, planId } = await setup();
    // recordSpend consumes with `reserve: true`, so the window goes NEGATIVE on purpose
    // (guardrails.ts:166-173). remainingDailyCents clamps that to 0.
    await t.mutation(internal.guardrails.recordSpend, { costUsd: 20 }); // 2000 cents vs a 500 rail
    expect(await remaining(t)).toBe(0);

    const res = await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...BASE,
      planId,
      primary: [REPLY_STEP],
      envelopeCents: 0, // derive at the root — off a rail that is underwater
    });

    expect(res.ok, "a negative rail computed a runnable envelope").toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("budget_exhausted");
    expect(await readSteps(t)).toEqual([]);
  });
});

describe("SC#3 — the call tree reconstructs from audit.by_correlation(rootRequestId)", () => {
  test("every lineage row carries the refs, the edges rebuild, and the costs sum to the root", async () => {
    const { t, planId } = await setup();
    const hop1 = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
      }),
    );
    const hop2 = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, secondHop(hop1, planId)),
    );

    const lineage = await orderedLineage(t);
    expect(lineage.map((r) => r.eventType)).toEqual([
      "subagent.dispatched",
      "subagent.completed",
      "subagent.dispatched",
      "subagent.completed",
    ]);

    for (const row of lineage) {
      expect(row.correlationId).toBe(ROOT);
      expect(row.actor).toBe("system");
      expect(row.payload, `${row.eventType} is missing a lineage ref`).toMatchObject({
        rootRequestId: ROOT,
        planId: String(planId),
      });
      expect(typeof row.payload.parentAgentId).toBe("string");
      expect(typeof row.payload.specialist).toBe("string");
      expect(typeof row.payload.depth).toBe("number");
      expect(typeof row.payload.ancestryDepth).toBe("number");
    }

    // parentAgentId is what rebuilds the EDGES: hop 2 hangs off hop 1's specialist.
    expect(lineage.map((r) => [r.payload.parentAgentId, r.payload.specialist])).toEqual([
      ["executive", "offer-architect"],
      ["executive", "offer-architect"],
      ["offer-architect", "lead-engine"],
      ["offer-architect", "lead-engine"],
    ]);

    // skillVersion rides the COMPLETED rows only — `subagent.dispatched` is written BEFORE the
    // loop, and the §5 loader resolves the active version inside runSpecialistTurn.
    const done = completedRows(lineage);
    const active = await t.query(internal.skills.getActiveSkill, { name: "offer-architect" });
    expect(done[0]?.payload.skillVersion).toBe(active.version);
    for (const r of done) expect(r.payload.skillVersion).toBeGreaterThan(0);

    // Cost attribution to the ROOT is a SUM over these rows — no new table, no new index.
    const total = done.reduce((s, r) => s + (r.payload.costUsd as number), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeCloseTo(hop1.costUsd + hop2.costUsd, 10);
  });

  test("§4 — NO audit payload value carries any of the specialist's output", async () => {
    const { t, planId } = await setup();
    await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...BASE,
      planId,
      primary: [REPLY_STEP],
    });

    // EVERY audit row written during the run, not just the lineage ones — and every VALUE of
    // every payload, so a future field addition cannot leak without failing here.
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows.length, "no audit rows were written — the scan is vacuous").toBeGreaterThan(0);
    const words = REPLY.split(/\W+/).filter((w) => w.length >= 5);
    expect(words.length, "the scripted reply has too few distinctive words").toBeGreaterThan(3);

    for (const row of rows) {
      for (const [key, value] of Object.entries(row.payload ?? {})) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        expect(text, `audit ${row.eventType}.${key} carries the specialist's reply`).not.toContain(
          REPLY,
        );
        for (const word of words) {
          expect(
            text,
            `audit ${row.eventType}.${key} carries "${word}" from the specialist's output`,
          ).not.toContain(word);
        }
      }
    }
  });
});

describe("two-tenant isolation (SC #5)", () => {
  /** Both forms below run a REAL dispatch first — an isolation assertion over rows that were
   *  never written is the vacuous pass this describe block exists to avoid. */
  const runAs = (t: T, tenantId: string, planId: Id<"plans">) =>
    t.action(internal.dispatch.__runSpecialistWithScript, {
      ...BASE,
      tenantId,
      planId,
      primary: [REPLY_STEP],
    });

  test("the SAME rootRequestId under two tenants partitions cleanly — no row crosses", async () => {
    const { t, planId } = await setup();
    // `plans.by_thread` is (tenantId, threadId), so the SAME threadId under tenant B is a second
    // legitimate row — which makes this the maximal collision: same thread id, same rootRequestId.
    const planB = await t.mutation(internal.plans.insertPlan, {
      tenantId: TENANT_B,
      threadId: THREAD,
    });

    ok(await runAs(t, TENANT, planId));
    // Attacker-shaped, not accidental: tenant B names tenant A's rootRequestId verbatim. The
    // envelope is deployment-wide, so B's hop still runs — that is the point (it WRITES rows).
    ok(await runAs(t, TENANT_B, planB));

    // Read the table DIRECTLY: `audit` has no public tenant-scoped reader, so the plan-level
    // assertion in the next test would prove isolation of the PLAN, not of the LINEAGE rows
    // SC #5 actually names ("a sub-agent run keyed on rootRequestId is still tenant-scoped").
    const lineage = await orderedLineage(t);
    const a = lineage.filter((r) => r.tenantId === stableTenant(TENANT));
    const b = lineage.filter((r) => r.tenantId === stableTenant(TENANT_B));

    // NON-EMPTY on both sides first — a partition of size zero passes a naive "no leakage" check
    // vacuously, and every assertion below would then be true of nothing.
    expect(a.length, "tenant A wrote no lineage rows — the isolation check is vacuous").toBeGreaterThan(0);
    expect(b.length, "tenant B wrote no lineage rows — the isolation check is vacuous").toBeGreaterThan(0);
    expect(a.length + b.length, "a lineage row carries a THIRD tenantId").toBe(lineage.length);

    // …and NO row carries the other tenant's id, despite sharing the correlation key.
    for (const r of a) expect(r.tenantId, `${r.eventType} leaked to tenant B`).not.toBe(TENANT_B);
    for (const r of b) expect(r.tenantId, `${r.eventType} leaked to tenant A`).not.toBe(TENANT);
    // Every row does share the collided key — otherwise the partition above proves nothing about
    // a rootRequestId-keyed read.
    for (const r of lineage) expect(r.correlationId).toBe(ROOT);
  });

  test("the observable surface stays scoped too — tenant B cannot read tenant A's plan", async () => {
    const { t, planId } = await setup();
    ok(await runAs(t, TENANT, planId));

    // The evaluations.test.ts:205-226 shape verbatim: write through the INTERNAL path with an
    // explicit tenantId, read back through the PUBLIC tenant-scoped query under two identities.
    expect(
      await t.withIdentity({ subject: TENANT }).query(api.plans.byThread, { threadId: THREAD }),
    ).not.toBeNull();
    expect(
      await t.withIdentity({ subject: TENANT_B }).query(api.plans.byThread, { threadId: THREAD }),
    ).toBeNull();
  });
});

// ── 15-04: where the run LANDS (DISP-01) ──────────────────────────────────────────────────────
//
// `actOnGap` parks the thread's plan row at `collecting` with NO body and schedules this
// dispatcher. `internal.evaluations.landSpecialistResult` is the only writer that gets it out of
// `collecting`, and it must do so on EVERY outcome — success, overrun, all four governed refusals,
// and an unexpected throw. A row stuck at `collecting` is a dead end: `PlanCard` renders only at
// `proposed` (cards.tsx:1624), so the user would be left with a control that did nothing.

/** A grounded evaluation whose gap routes at BASE.route, plus the plan row `actOnGap` stages.
 *  Rides the same SMOKE:: seam (no embedding, no network) evaluations.test.ts / gapAction.test.ts
 *  ride. No offering + no financials ⇒ diagnose() stops at Gate 1 ⇒ `offer-architect`. */
async function setupDispatched(): Promise<{ t: T; planId: Id<"plans"> }> {
  const { t, planId } = await setup();
  const text = serializeProfile({
    name: "Acme Dog Training",
    oneLineDescription: "In-home dog training for busy urban owners.",
    persona: "solopreneur",
    stage: "early-revenue",
    offering: "", // sparse-start: no offer stated ⇒ Gate 1 ⇒ the offer-architect gap
    targetCustomer: "urban dog owners with new puppies",
    primaryGoals: ["more clients"],
    knownConstraints: [],
  });
  const docId = await t.run((ctx) =>
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
  await t.action(internal.evaluations.runEvaluation, {
    tenantId: TENANT,
    threadId: THREAD,
    query: `SMOKE::${docId}`,
  });
  const gap = (
    await t.run((ctx) => ctx.db.query("evaluations").order("desc").first())
  )?.gaps[0];
  expect(gap?.route, "the fixture's gap does not route at BASE.route").toBe("offer-architect");
  // Exactly what actOnGap stages before scheduling: memo-shaped, parked, no body.
  await t.run((ctx) =>
    ctx.db.patch(planId, {
      kind: "memo",
      status: "collecting",
      recipients: [],
      subject: `Next step: ${gap?.label}`.slice(0, 120),
      body: "",
    }),
  );
  return { t, planId };
}

const ATTRIBUTION = "Produced by the **offer-architect** specialist.";
const CEILING_MARKER = "Incomplete — cost ceiling reached.";
/** The 12-05 sentence that becomes a LIE the moment dispatch ships. */
const STALE_CLAIM = "does not execute yet";

describe("landSpecialistResult — every outcome leaves the plan row approvable (DISP-01)", () => {
  test("SUCCESS: the body is the specialist's, under an attribution line naming it", async () => {
    const { t, planId } = await setupDispatched();
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
      }),
    );
    expect(res.incomplete).toBe(false);

    const plan = await readPlan(t, planId);
    expect(plan?.status, "the plan never left `collecting`").toBe("proposed");
    expect(plan?.kind).toBe("memo");
    expect(plan?.body?.startsWith(`> ${ATTRIBUTION}`)).toBe(true);
    expect(plan?.body).toContain(REPLY); // the specialist's own output, not a template
    expect(plan?.body).not.toContain(CEILING_MARKER);
    expect(plan?.body).not.toContain(STALE_CLAIM);
  });

  test("INCOMPLETE: the cost-ceiling marker sits ABOVE the kept partial output", async () => {
    const { t, planId } = await setupDispatched();
    // 5 cents left, an 8-cent turn: the guard passes, the call overruns (the 15-03 fixture).
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
        envelopeCents: 5,
        spentCents: 0,
      }),
    );
    expect(res.incomplete).toBe(true);

    const body = (await readPlan(t, planId))?.body ?? "";
    expect(body).toContain(CEILING_MARKER);
    expect(body, "the overrunning hop's output was discarded at the landing").toContain(REPLY);
    expect(body.indexOf(CEILING_MARKER), "the marker landed BELOW the body").toBeLessThan(
      body.indexOf(REPLY),
    );
    // The marker rides the BODY, at the Approve gate where the human decides — the plan row's
    // status enum is PINNED and gains no "partial" literal (15-02).
    expect((await readPlan(t, planId))?.status).toBe("proposed");
  });

  const REFUSAL_CASES: readonly (readonly [string, Record<string, unknown>])[] = [
    ["an unknown route", { route: "does-not-exist" }],
    ["a depth breach", { depth: 2 }],
    ["a cycle", { ancestry: ["offer-architect"] }],
    ["a drained envelope", { envelopeCents: 10, spentCents: 10 }],
  ];

  test.each(REFUSAL_CASES)(
    "REFUSAL (%s): the control falls back to the deterministic memo, never a dead end",
    async (_name, over) => {
      const { t, planId } = await setupDispatched();
      const res = await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
        ...over,
      } as never);
      expect(res.ok).toBe(false);

      const plan = await readPlan(t, planId);
      expect(plan?.status, "a refused dispatch left the plan stuck at `collecting`").toBe(
        "proposed",
      );
      expect(plan?.kind).toBe("memo");
      const body = plan?.body ?? "";
      expect(body).toContain("# Next step:"); // the buildMemo template
      expect(body).toContain("02-build-offer"); // …grounded in the persisted gap, not invented
      expect(body).not.toContain(`> ${ATTRIBUTION}`); // nothing was produced, so nothing is attributed
      // HONEST wording: the 12-05 sentence is false the moment dispatch ships, and an approved
      // memo must not tell the user something untrue.
      expect(body, "the fallback still claims the specialist cannot run at all").not.toContain(
        STALE_CLAIM,
      );
      // …and it says WHY, without ever surfacing the internal reason code.
      expect(body).toMatch(/specialist/i);
      if (!res.ok) expect(body).not.toContain(res.reason);
      expect(await readDeadLetters(t)).toEqual([]);
    },
  );

  test("a THROWN turn lands the fallback too — no DLQ, and the stop is on the lineage", async () => {
    const { t, planId } = await setupDispatched();
    // An EMPTY script exhausts the mock on its first call → the loop throws.
    await expect(
      t.action(internal.dispatch.__runSpecialistWithScript, { ...BASE, planId, primary: [] }),
    ).rejects.toThrow();

    const plan = await readPlan(t, planId);
    expect(plan?.status, "a thrown specialist turn left the user at a dead end").toBe("proposed");
    expect(plan?.body).toContain("# Next step:");
    expect(plan?.body).not.toContain(STALE_CLAIM);
    expect(await readDeadLetters(t)).toEqual([]);
    // §4: the CODE is audited, never the thrown message.
    const refused = (await readLineage(t)).filter((r) => r.eventType === "subagent.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.payload).toMatchObject({ reason: "error", rootRequestId: ROOT });
  });

  test("CAS: a plan the user moved on from is NEVER clobbered", async () => {
    const { t, planId } = await setupDispatched();
    // The user cancelled while the specialist was running (the mirror of executePlan's CAS).
    await t.run((ctx) => ctx.db.patch(planId, { status: "canceled", body: "user's own draft" }));

    ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
      }),
    );

    const plan = await readPlan(t, planId);
    expect(plan?.status, "a finished dispatch clobbered a canceled plan").toBe("canceled");
    expect(plan?.body).toBe("user's own draft");
  });

  test("cross-tenant: a landing under a foreign tenantId is a no-op", async () => {
    const { t, planId } = await setupDispatched();
    // An explicit-tenantId internal twin carries no live identity (the 12-04
    // recordScorecardAnswerInternal precedent), so the check is MANUAL and must exist.
    await t.mutation(internal.evaluations.landSpecialistResult, {
      tenantId: TENANT_B,
      threadId: THREAD,
      planId,
      gapIndex: 0,
      route: "offer-architect",
      body: "tenant B's specialist output",
      incomplete: false,
    });

    const plan = await readPlan(t, planId);
    expect(plan?.status, "a cross-tenant landing moved the plan row").toBe("collecting");
    expect(plan?.body).toBe("");
  });
});

// ── 15.1-05: the tier rides into the specialist's PROMPT (SC#5a, ADR-009) ─────────────────────
//
// ADR-009 is the scope fence: this is PROMPT-SHAPING. The offer SET is unchanged, `diagnose()` is
// not widened, `resolveSpecialist`/`SPECIALISTS` gain no filter, and `llm.ts` is byte-unchanged.
// Everything below asserts the STRING a dispatched specialist is handed.
//
// Driven through `t.run`, whose ctx DOES expose `runQuery` (probed before writing this), so
// `buildSpecialistPrompt` runs against the REAL internal queries — `tenantProfile.forTenant` and
// `skills.getActiveSkill` — rather than a hand-built stub that could drift from them. Deliberately
// NOT driven through `__runSpecialistWithScript`: the mock model swallows the prompt, so the
// assertion would be about nothing.
describe("tier in agent context — the specialist prompt carries it", () => {
  const STYLE_SENTINEL = "XYZZY-STYLE-OVERLAY-SENTINEL";

  const promptFor = (t: T) =>
    t.run(async (ctx) =>
      buildSpecialistPrompt(ctx as never, {
        tenantId: TENANT,
        threadId: THREAD,
        gapIndex: 0,
        route: "offer-architect",
      }),
    );

  /** Seed the tier row AFTER the evaluation exists, so the 15.1-04 rubric pick is untouched and
   *  this suite characterizes the PROMPT only. `forTenant` reads the raw tenantId it is handed. */
  const seedTier = (
    t: T,
    row: { tier: string; agentName?: string; behaviorPreset?: string },
  ) =>
    t.run((ctx) =>
      ctx.db.insert("tenantProfiles", {
        tenantId: TENANT,
        tierSource: "derived",
        derivedAt: Date.now(),
        ...row,
      } as never),
    );

  /** Overwrite a SEEDED active style row's body with a sentinel, so the assertion does not depend
   *  on the overlay's prose (a future body edit must not turn this suite red). */
  const setStyleBody = (t: T, name: string, body: string) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
        .unique();
      if (row) await ctx.db.patch(row._id, { body });
    });

  /** Leave a preset with NO active row — the fail-open fixture. */
  const archiveStyle = (t: T, name: string) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
        .unique();
      if (row) await ctx.db.patch(row._id, { status: "archived" });
    });

  test("tier, sanitized agent name and the registry style directive all reach the prompt", async () => {
    const { t } = await setupDispatched();
    await seedTier(t, { tier: "solopreneur", agentName: "Ada", behaviorPreset: "direct" });
    await setStyleBody(t, "style-direct", STYLE_SENTINEL);

    const out = await promptFor(t);
    expect(out).toContain("solopreneur");
    expect(out).toContain("Ada");
    expect(out).toContain(STYLE_SENTINEL);
    // ADDITIVE, not a replacement: the 15-03 evaluation snapshot is still all there.
    expect(out).toContain("Framework:");
    expect(out).toContain("Binding constraint:");
  });

  // The SC#5a wiring analogue of the core-side distinctness test. Inequality, not "contains sme":
  // the claim is that two tenants get materially different prompts off the SAME diagnosis.
  test("two tiers, same evaluation → two DIFFERENT prompts", async () => {
    const a = await setupDispatched();
    await seedTier(a.t, { tier: "solopreneur" });
    const solo = await promptFor(a.t);

    const b = await setupDispatched();
    await seedTier(b.t, { tier: "sme" });
    const sme = await promptFor(b.t);

    expect(solo).not.toBe(sme);
    expect(solo).toContain("solopreneur");
    expect(sme).toContain("sme");
  });

  // A style overlay is an ADDITIVE layer on the USER-turn prompt. §5's fail-CLOSED rule guards the
  // SYSTEM prompt (the specialist body, loaded in runSpecialistTurn) — losing an overlay degrades
  // voice, not governance, so it must never cost the user their dispatch.
  test("FAIL-OPEN: an unseeded style row still produces a prompt, just without the directive", async () => {
    const { t } = await setupDispatched();
    await seedTier(t, { tier: "sme", behaviorPreset: "coaching" });
    await archiveStyle(t, "style-coaching");

    const out = await promptFor(t);
    expect(out).toContain("sme"); // the tier line survives the missing overlay
    expect(out).toContain("Binding constraint:"); // …and so does the snapshot
    expect(out).not.toContain(STYLE_SENTINEL);
  });

  // A missing row must not become a silent classification — the defect class this phase closes.
  test("no tenantProfiles row at all → a prompt with NO tier claim", async () => {
    const { t } = await setupDispatched();
    const out = await promptFor(t);
    expect(out).not.toContain("Business tier:");
    expect(out).not.toContain("undefined");
    expect(out).toContain("Binding constraint:"); // non-vacuity: a real prompt was still built
  });
});

describe("the activity trace always terminalizes", () => {
  test("a THROWN specialist turn still ends its step in phase `error`", async () => {
    const { t, planId } = await setup();
    // An EMPTY script exhausts the mock on its first call → the loop throws (primary and the
    // fallback both). The `finally` is the only construct that terminalizes here.
    await expect(
      t.action(internal.dispatch.__runSpecialistWithScript, { ...BASE, planId, primary: [] }),
    ).rejects.toThrow();

    const steps = await readSteps(t);
    expect(steps.map((s) => s.tool)).toEqual(["dispatchOfferArchitect"]);
    expect(steps[0]?.phase, "a thrown specialist turn left its step spinning").toBe("error");
  });
});
