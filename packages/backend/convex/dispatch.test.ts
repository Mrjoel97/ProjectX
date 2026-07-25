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
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// The dispatcher's lineage audits hit the auditCounts aggregate and its envelope reads/spends hit
// the rate-limiter's daily-spend window. Register both (relative imports — the packages block the
// deep specifier) so the REAL paths run under convex-test instead of throwing "component not
// registered". The evaluations.test.ts / runCockpitAgent.test.ts idiom, verbatim.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DispatchResult } from "./dispatch";
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
