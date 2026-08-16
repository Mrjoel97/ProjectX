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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INCOMPLETE_MARKER, serializeProfile } from "@pikar/core";
import { CHEAP_MODEL, DEFAULT_MODEL, RESEARCH_FALLBACK_MODEL, RESEARCH_MODEL } from "@pikar/cost";
import { APICallError } from "ai";
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
// The dispatcher's lineage audits hit the auditCounts aggregate and its envelope reads/spends hit
// the rate-limiter's daily-spend window. Register both (relative imports — the packages block the
// deep specifier) so the REAL paths run under convex-test instead of throwing "component not
// registered". The evaluations.test.ts / runCockpitAgent.test.ts idiom, verbatim.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildSpecialistPrompt, type DispatchResult } from "./dispatch";
import { contentHash } from "./lib/hash";
import { buildCockpitTools, runSpecialistTurn } from "./llm";
import schema from "./schema";

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

// The loop-driving tests import `ai` + `@ai-sdk/openai` through the "use node" llm.ts inside
// convex-test's lazy module loader; on a cold checkout that first import alone exceeds the 5s
// default (15-01 hit the same wall in runCockpitAgent.test.ts). Raise the file's budget rather
// than shipping a test that is red once per fresh clone.
vi.setConfig({ testTimeout: 30_000 });

// 16-06: the executive-turn tests SCHEDULE a real `internal.dispatch.runResearch`, and convex-test
// RUNS scheduled functions rather than merely queueing them. Without a key that run dies harmlessly
// on LoadAPIKeyError (logged to stderr, asserted on by nothing); WITH one — every dev box that runs
// the live evals has it exported — a unit test would fire a genuine, BILLED, hosted-web-search
// research run. Stub it off for this file rather than relying on the box being unconfigured.
vi.stubEnv("OPENAI_API_KEY", "");

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
  "dispatchResearch",
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
const toolStep = (toolName: string, input: unknown, callId = `c-${toolName}`) => ({
  content: [{ type: "tool-call", toolCallId: callId, toolName, input: JSON.stringify(input) }],
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
/** URLs the stubbed Tavily endpoint returns for the next run. Set by `searchedSteps`. */
let stubbedSearchUrls: readonly string[] = [];

/**
 * A web search, as a LOCAL tool (rewritten 2026-08-07 — it used to fake the provider-executed
 * `web_search` shape the 16-02 probe observed).
 *
 * TWO STEPS, and that is the point rather than an inconvenience. A hosted search happened INSIDE one
 * model step, so the old helper could fabricate the tool-call, the tool-result and the `source`
 * parts together. A local tool cannot be faked that way: the model emits a tool-call, the SDK runs
 * OUR `execute`, and only then does the model speak. So these tests now drive the real
 * `buildWebResearchTool` execute path against a stubbed HTTP endpoint — the tool-result part and
 * every source come from `parseWebResults` for real, not from a fixture asserting on itself.
 * That is the anti-vacuity rule this repo learned twice in 15.3: a stub answers with whatever it was
 * told to answer, so put the stub at the NETWORK edge and let our own code run.
 */
const searchedSteps = (text: string, urls: readonly string[]) => {
  stubbedSearchUrls = urls;
  return [
    {
      content: [
        {
          type: "tool-call",
          toolCallId: "ws-1",
          toolName: "webResearch",
          input: JSON.stringify({ query: "urban dog training pricing" }),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: provUsage(12_000, 800),
      warnings: [],
    },
    textStep(text),
  ];
};

// The Tavily edge, stubbed. Anything that is not Tavily falls through to the real fetch so no other
// outbound path is silently changed by this file.
const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.stubEnv("TAVILY_API_KEY", "test-key");
  vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
    if (String(input).includes("api.tavily.com")) {
      return new Response(
        JSON.stringify({
          results: stubbedSearchUrls.map((url, i) => ({
            url,
            title: `Source ${i}`,
            content: "retrieved snippet",
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return (realFetch as (a: unknown, b?: unknown) => Promise<Response>)(input, init);
  });
});
const textToolStep = (text: string, toolName: string, input: unknown, callId: string) => ({
  ...toolStep(toolName, input, callId),
  content: [
    { type: "text", text },
    { type: "tool-call", toolCallId: callId, toolName, input: JSON.stringify(input) },
  ],
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

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const remaining = (t: T) => t.query(internal.guardrails.remainingDailyCents, { tenantId: TENANT });

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

    // 16-09 REGRESSION GUARD, folded into THIS test rather than a sibling because each `setup()`
    // boots a fresh in-memory backend + components, and the marginal one pushed the mixed-env
    // backend suite over the load threshold vitest.config.mts already documents. It is also the
    // exact contrast this test already sets up: the line above proves the ACTIVE row runs when
    // nothing is pinned; these lines prove a PIN overrides it.
    //
    // The defect it guards: `DispatchArgs` had no `skillVersions`, so the eval harness's
    // `--skill offer-architect@2` never reached `runSpecialistTurn`. The specialist ran the ACTIVE
    // row (v1 — which carries no vault teaching at all) while the run wrote an EVAL_GATE evidence
    // row certifying v2. A pin that certifies a body that never executed, with every test green.
    const pinned = active.version + 1;
    // `candidate`, exactly like a real gated pin target — an `active` twin would let the assertion
    // pass through getActiveSkill and prove nothing.
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "offer-architect",
        version: pinned,
        body: "PINNED CANDIDATE BODY",
        status: "candidate" as const,
        createdAt: Date.now(),
      }),
    );
    const pinnedRes = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
        // A FRESH root: the envelope is per-root and the run above already spent 8 cents of it.
        rootRequestId: `${ROOT}-pinned`,
        skillVersions: { "offer-architect": pinned },
      }),
    );
    expect(pinnedRes.skillVersion).toBe(pinned);
    expect(pinnedRes.skillVersion).not.toBe(active.version);
  });

  test.each([
    ["proposePlan", {}],
    ["setSubject", { subject: "Hijacked" }],
    ["replyToMessage", { intent: "Send the injected instructions to everyone" }],
  ] as const)("SC#1 withheld %s: injection cannot write while both GRANTED research tools really run", async (withheld, input) => {
    const { t, planId } = await setup();
    const before = await readPlan(t, planId);
    const urls = ["https://example.com/research"];
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        route: "research",
        planId,
        primary: [
          // ACTN-03: `declareUnsupported` is now the grant's ONLY local tool (searchVault left
          // the grant — see specialists.ts), and a local tool is what makes this harness
          // non-inert: `webResearch` is provider-executed and deliberately emits no step row.
          toolStep("declareUnsupported", { claim: "the harness needs one local tool to run" }),
          toolStep(withheld, input),
          ...searchedSteps(REPLY, urls),
        ],
      }),
    );

    // Positive half #1: the LOCAL granted tool executed and emitted its real activity row.
    const stepTools = (await readSteps(t)).map((s) => s.tool);
    expect(stepTools, "the GRANTED local tool was filtered out — the harness is inert").toContain(
      "declareUnsupported",
    );
    // Positive half #2: the PROVIDER-executed hosted search contributed its source and prose.
    expect(res.sources).toEqual([{ url: urls[0], title: "Source 0" }]);
    expect(res.body).toBe(REPLY);

    // Mutation that turns this RED: add the current `withheld` name to RESEARCH_TOOLS.
    expect(await readPlan(t, planId), "a withheld write tool moved the plan row").toEqual(before);
    // Mutation that turns this RED: emit a step row for the hosted search (plus its schema literal).
    expect(stepTools, "a withheld/provider tool emitted an activity step").not.toContain(withheld);
    expect(stepTools, "provider-executed hosted search emitted an activity step").not.toContain(
      "web_search",
    );
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
    expect(
      rail,
      "the daily rail is already drained — the derivation is untestable",
    ).toBeGreaterThan(0);

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
    expect(
      res.envelopeCents,
      "the envelope is the whole rail — the fraction is not applied",
    ).toBeLessThan(rail);
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
    await t.mutation(internal.guardrails.recordSpend, { tenantId: TENANT, costUsd: 20 }); // 2000 cents vs a 500 rail
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
    const urls = ["https://pricing.example/research-source"];
    const hop1 = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: searchedSteps(REPLY, urls),
      }),
    );
    const hop2 = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        primary: [REPLY_STEP],
        route: "lead-engine",
        parentAgentId: "research",
        ancestry: ["research"],
        envelopeCents: hop1.envelopeCents,
        spentCents: hop1.spentCents,
      }),
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
      ["executive", "research"],
      ["executive", "research"],
      ["research", "lead-engine"],
      ["research", "lead-engine"],
    ]);

    // skillVersion rides the COMPLETED rows only — `subagent.dispatched` is written BEFORE the
    // loop, and the §5 loader resolves the active version inside runSpecialistTurn.
    const done = completedRows(lineage);
    const active = await t.query(internal.skills.getActiveSkill, { name: "research-specialist" });
    expect(done[0]?.payload.skillVersion).toBe(active.version);
    for (const r of done) expect(r.payload.skillVersion).toBeGreaterThan(0);

    // Cost attribution to the ROOT is a SUM over these rows — no new table, no new index.
    const total = done.reduce((s, r) => s + (r.payload.costUsd as number), 0);
    const rootTotal = hop1.costUsd + hop2.costUsd;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeCloseTo(rootTotal, 10);
  });

  test("§4 — NO research audit payload value carries the question, sources, http, or prose", async () => {
    const { t, planId } = await setup();
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    const urls = [
      "https://pricing.example/chicago-session-rates",
      "https://market.example/trainer-benchmarks",
    ];
    await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...RESEARCH,
      planId,
      primary: searchedSteps(REPLY, urls),
      research: true,
    });

    // EVERY audit row written during the run, not just the lineage ones — and every VALUE of
    // every payload recursively, so a future nested object or string[] cannot leak unnoticed.
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows.length, "no audit rows were written — the scan is vacuous").toBeGreaterThan(0);
    const persisted = rows.find((row) => row.eventType === "research.persisted");
    expect(persisted, "the research terminal audit was never written").toBeDefined();
    expect(persisted?.payload).toMatchObject({
      queryHash: await contentHash(QUESTION),
      sourceCount: urls.length,
    });

    const words = REPLY.split(/\W+/).filter((w) => w.length >= 5);
    expect(words.length, "the scripted reply has too few distinctive words").toBeGreaterThan(3);
    const stringsIn = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.flatMap(stringsIn);
      if (value !== null && typeof value === "object") {
        return Object.values(value).flatMap(stringsIn);
      }
      return [];
    };

    for (const row of rows) {
      for (const text of stringsIn(row.payload ?? {})) {
        // Mutation that turns every absence below RED: add `question`, `sourceUrls` and
        // `specialistProse` to research.ts's research.persisted payload.
        expect(text, `audit ${row.eventType} carries the research question`).not.toContain(
          QUESTION,
        );
        for (const url of urls) {
          expect(text, `audit ${row.eventType} carries source URL ${url}`).not.toContain(url);
        }
        expect(text.toLowerCase(), `audit ${row.eventType} carries an http fragment`).not.toContain(
          "http",
        );
        for (const word of words) {
          expect(
            text,
            `audit ${row.eventType} carries "${word}" from the specialist's output`,
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
    // TENANT/TENANT_B carry no `|sessionId` suffix, so the tenantId the wrapper injects is
    // the constant itself — the old stableTenant() wrapping here was a no-op.
    const a = lineage.filter((r) => r.tenantId === TENANT);
    const b = lineage.filter((r) => r.tenantId === TENANT_B);

    // NON-EMPTY on both sides first — a partition of size zero passes a naive "no leakage" check
    // vacuously, and every assertion below would then be true of nothing.
    expect(
      a.length,
      "tenant A wrote no lineage rows — the isolation check is vacuous",
    ).toBeGreaterThan(0);
    expect(
      b.length,
      "tenant B wrote no lineage rows — the isolation check is vacuous",
    ).toBeGreaterThan(0);
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
  const gap = (await t.run((ctx) => ctx.db.query("evaluations").order("desc").first()))?.gaps[0];
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

  test.each(
    REFUSAL_CASES,
  )("REFUSAL (%s): the control falls back to the deterministic memo, never a dead end", async (_name, over) => {
    const { t, planId } = await setupDispatched();
    const res = await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...BASE,
      planId,
      primary: [REPLY_STEP],
      ...over,
    } as never);
    expect(res.ok).toBe(false);

    const plan = await readPlan(t, planId);
    expect(plan?.status, "a refused dispatch left the plan stuck at `collecting`").toBe("proposed");
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
  });

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
  const seedTier = (t: T, row: { tier: string; agentName?: string; behaviorPreset?: string }) =>
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

// ── 16-06: the ASYNC research dispatch (DISP-02, D9-REVISED) ──────────────────────────────────
//
// The executive asks for research mid-turn; the tool STAGES a memo plan row, SCHEDULES the
// governed run and RETURNS. Nothing here is a second spine — `runResearch` calls the same
// `dispatchAndLand` the gap path calls, so every guard below is INHERITED, not re-implemented.

const QUESTION = "What do competing in-home dog trainers charge per session in Chicago?";
const RESEARCH = { ...BASE, route: "research", question: QUESTION };
const LOST_CONTEXT_PHRASE = "no longer on file";
const BUDGET_EXHAUSTED_REPLY =
  "This request has used up the budget I set aside for it. Here's where things stand — ask me to carry on and I'll pick it back up.";

const scheduledResearch = async (t: T) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((s) =>
    s.name.includes("runResearch"),
  );

describe("the question-prompt seam (16-06 Task 1)", () => {
  const promptWith = (t: T, question?: string) =>
    t.run(async (ctx) =>
      buildSpecialistPrompt(ctx as never, {
        tenantId: TENANT,
        threadId: THREAD,
        gapIndex: 0,
        route: "research",
        question,
      }),
    );

  test("a question REPLACES the evaluation snapshot and still carries the tier briefing", async () => {
    const { t } = await setupDispatched();
    await t.run((ctx) =>
      ctx.db.insert("tenantProfiles", {
        tenantId: TENANT,
        tierSource: "derived",
        derivedAt: Date.now(),
        tier: "solopreneur",
      } as never),
    );

    const out = await promptWith(t, QUESTION);
    expect(out).toContain(QUESTION);
    expect(
      out,
      "the tier briefing was dropped — a research turn is still a tenant's turn",
    ).toContain("solopreneur");
    expect(out).not.toContain("Framework:");
    expect(out).not.toContain("Binding constraint:");
    // Non-vacuity: the SAME thread without a question still gets the whole snapshot, so the
    // absences above are the question branch, not an empty fixture.
    expect(await promptWith(t)).toContain("Binding constraint:");
  });

  test("an over-long question is TRUNCATED, never rejected and never passed whole", async () => {
    const { t } = await setupDispatched();
    const long = `${"x".repeat(900)}END`;

    const out = await promptWith(t, long);
    expect(out, "the question was rejected rather than capped").not.toBe("");
    expect(out).not.toContain(long);
    expect(out).not.toContain("END");
    expect(out).toContain("…");
  });
});

describe("runResearch — the scheduled entry point inherits every guard (16-06 Task 1)", () => {
  test("search call errors: retryable failures fall back, non-retryable failures propagate", async () => {
    const { t, planId } = await setup();
    const ctxBackedTurn = (
      primary: unknown,
      fallback: unknown = [textStep("Recovered on the research fallback.")],
    ) => {
      const ctx = {
        runQuery: t.query.bind(t),
        runMutation: t.mutation.bind(t),
        runAction: t.action.bind(t),
      } as unknown as Parameters<typeof runSpecialistTurn>[0];
      return runSpecialistTurn(ctx, {
        tenantId: TENANT,
        planId,
        skillName: "research-specialist",
        toolNames: ["webResearch", "declareUnsupported"],
        prompt: QUESTION,
        mockScript: {
          primary: primary as never,
          fallback: fallback as never,
        },
      });
    };
    const providerError = (statusCode: number, isRetryable: boolean) =>
      new APICallError({
        message: `scripted provider ${statusCode}`,
        url: "https://provider.invalid",
        requestBodyValues: {},
        statusCode,
        isRetryable,
      });

    const recovered = await ctxBackedTurn(async () => {
      throw providerError(503, true);
    });
    expect(recovered.reply).toBe("Recovered on the research fallback.");
    expect(recovered.fallbackModelId).toBe(RESEARCH_FALLBACK_MODEL);

    await expect(
      ctxBackedTurn(async () => {
        throw providerError(400, false);
      }),
    ).rejects.toMatchObject({ statusCode: 400, isRetryable: false });
  });

  test("a cycling ancestry REFUSES conversationally rather than throwing", async () => {
    const { t, planId } = await setup();
    const res = await t.action(internal.dispatch.runResearch, {
      ...RESEARCH,
      planId,
      ancestry: ["research"],
    });

    expect(res.ok, "a cycle ran the specialist anyway").toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("cycle_refused");
    expect(res.reply).not.toContain("cycle_refused");
    expect(await readSteps(t), "a refused research dispatch painted an activity step").toEqual([]);
  });

  test("a REFUSED run lands an HONEST memo — never the gap path's lost-evaluation wording", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) => ctx.db.patch(planId, { kind: "memo", status: "collecting", body: "" }));

    // depth 2 > MAX_DEPTH. There is no evaluation row on this thread, so the shipped landing would
    // have written LOST_CONTEXT_MEMO — "the evaluation it was based on is no longer on file. Ask me
    // to run the assessment again" — for a run that was never based on an evaluation.
    await t.action(internal.dispatch.runResearch, { ...RESEARCH, planId, depth: 2 });

    const plan = await readPlan(t, planId);
    expect(plan?.status, "a refused research run left the plan stuck at `collecting`").toBe(
      "proposed",
    );
    expect(plan?.body, "the research run inherited the gap path's false wording").not.toContain(
      LOST_CONTEXT_PHRASE,
    );
    expect(plan?.body).not.toContain("run the assessment again");
    expect((plan?.body ?? "").length).toBeGreaterThan(20);
  });

  test("fallbackBody is used ONLY where LOST_CONTEXT_MEMO was — the gap path is byte-identical", async () => {
    const { t, planId } = await setup();
    const staged = async (): Promise<Id<"plans">> => {
      const id = await t.mutation(internal.plans.insertPlan, {
        tenantId: TENANT,
        threadId: `th_${Math.random().toString(36).slice(2)}`,
      });
      await t.run((ctx) => ctx.db.patch(id, { kind: "memo", status: "collecting", body: "" }));
      return id;
    };
    const land = (id: Id<"plans">, fallbackBody?: string) =>
      t.mutation(internal.evaluations.landSpecialistResult, {
        tenantId: TENANT,
        threadId: THREAD,
        planId: id,
        gapIndex: 0,
        route: "research",
        incomplete: false,
        fallbackReason: "error",
        ...(fallbackBody === undefined ? {} : { fallbackBody }),
      });

    const withBody = await staged();
    await land(withBody, "HONEST-SENTENCE");
    expect((await readPlan(t, withBody))?.body).toBe("HONEST-SENTENCE");

    // The gap path passes nothing → the shipped memo, unchanged.
    await t.run((ctx) => ctx.db.patch(planId, { kind: "memo", status: "collecting", body: "" }));
    await land(planId);
    expect((await readPlan(t, planId))?.body).toContain(LOST_CONTEXT_PHRASE);
  });

  // The scripted twin (`__runSpecialistWithScript`) drives the SAME `dispatchAndLand` runResearch
  // does — a LanguageModel is not Convex-serializable, so a mock cannot ride through runResearch's
  // own args. The happy path and the clock row are asserted through it for that reason.
  test("the happy path returns the findings, the sources and a retrieval stamp", async () => {
    const { t, planId } = await setup();
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [REPLY_STEP],
      }),
    );

    expect(res.route).toBe("research");
    expect(res.body).toBe(REPLY);
    expect(res.incomplete).toBe(false);
    expect(res.incompleteReason).toBeUndefined();
    expect(res.sources).toEqual([]); // the mock retrieves none — the FIELD travels, which is the point
    expect(res.retrievedAt).toBeGreaterThan(0);
    expect(res.spentCents).toBeGreaterThan(0);
    expect((await readSteps(t)).map((s) => s.tool)).toContain("dispatchResearch");
  });

  // 22.1: the search COUNT was computed, billed against and audited, then dropped one function
  // short of the verdict — so the stored document could not tell "searched and found nothing" from
  // "never searched". MUTATION that turns this RED: drop `webSearchCalls` from the ok-branch return
  // (i.e. re-introduce the exact defect) — `persistFindings` then loses its required arg.
  test("the hosted-search COUNT rides the result through to the findings terminal", async () => {
    const { t, planId } = await setup();
    // The persist runs `startIngest`, which needs the workflow component (the §4 test's idiom).
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    const searched = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: searchedSteps(REPLY, ["https://example.com/a"]),
        research: true,
      }),
    );
    expect(searched.webSearchCalls).toBe(1);

    // The count reached the persist, not just the return: `research.persisted` is written by
    // `persistFindings` from the arg bag `persistResearchFindings` handed it.
    const persisted = (await t.run((ctx) => ctx.db.query("audit").collect())).find(
      (r) => r.eventType === "research.persisted",
    );
    expect(persisted?.payload).toMatchObject({ webSearchCalls: 1, evidenceVerdict: "sourced" });

    // …and a run that never searched is carried as such, not as an empty search.
    //
    // 16-09 CHANGED HOW, NOT WHETHER. This half used to assert a `research.persisted` row carrying
    // `evidenceVerdict: "not_researched"` — persist-and-label. The structural floor in
    // `persistResearchFindings` now refuses the VAULT DOCUMENT outright on `webSearchCalls === 0`,
    // because the vault is a RETRIEVAL surface: `vaultSearch` returns arbitrary chunks, and a chunk
    // sliced out of the body carries neither the label (which sits BEFORE the fence) nor the fence,
    // so a never-searched model-memory answer could be cited by the Phase-12 engine as a grounded
    // fact. The distinction this test exists to protect — "never searched" is not "searched and
    // found nothing" — is therefore now carried by a DIFFERENT row, and is still asserted here.
    // The memo card is untouched either way (it lands before the persist seam), so nothing the
    // user can see is withheld. See `research.test.ts` for the paired non-vacuity case.
    const { t: t2, planId: planId2 } = await setup();
    t2.registerComponent("workflow", workflowSchema, workflowModules);
    t2.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    const skipped = ok(
      await t2.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId: planId2,
        primary: [REPLY_STEP],
        research: true,
      }),
    );
    expect(skipped.webSearchCalls).toBe(0);
    const rows2 = await t2.run((ctx) => ctx.db.query("audit").collect());
    // No document, and therefore no `research.persisted` row at all.
    expect(rows2.find((r) => r.eventType === "research.persisted")).toBeUndefined();
    expect(skipped.vaultDocId).toBeUndefined();
    // The refusal is recorded by CODE, with refs and counts only (§4).
    expect(rows2.find((r) => r.eventType === "research.persist_skipped")?.payload).toMatchObject({
      webSearchCalls: 0,
      reason: "not_researched",
    });
  });

  // 22.1b: the WHOLE mechanism, end to end, in one scripted run. It is the check the
  // `dispatchResearch` defect never had — that tool was built, wired, scheduled and persisted, and
  // never once CALLED, because nothing asserted its presence in the runtime tool record.
  //
  // Assertion (a) proves THREE things at once, which is why it is worth a trace read: a stripped
  // `declareUnsupported` key raises NoSuchToolError (construction + the toolNames allow-list), and
  // a missing `schema.ts` literal drops the row inside a callback the AI SDK swallows (the
  // searchVault/evaluateBusiness pitfall). Assertion (b) is the verdict itself — the label fires
  // DESPITE `sourceCount === 1`, which no counter-based rule could ever produce.
  // MUTATION that turns this RED: drop `declareUnsupportedTool` from the grantWebResearch spread,
  // or drop the `|| a.declaredUnsupported` disjunct in evidenceVerdict.
  // ACTN-03 REVERSAL, recorded deliberately — this test's ORIGINAL premise no longer holds and the
  // change is a real loss, not a free win. 22.1b asserted that a declaration made while holding a
  // NEAR-MISS source (sourceCount 1) still reads `insufficient_evidence`: "a near-miss is a source,
  // not support". That semantic requires a specialist that declares JUDICIOUSLY. Measured across
  // three probes it does not exist: the model declared on 5/5 dispatches at v6 (0,3,4,6,8 sources)
  // and, once given an explicit enum, passed `scope: "question"` on 5/5 at v7 (6,10,0,9,8 sources)
  // — including after three searches over ten sources. An always-on bit carries no information, so
  // the near-miss distinction was never actually being delivered; gating it on `sourceCount === 0`
  // gives up a capability that has never worked, in exchange for a verdict that is true.
  // WHAT IS LOST, stated plainly so a future reader can price it: a genuinely honest refusal that
  // DID retrieve a near-miss now reads `sourced`. If the specialist ever becomes judicious (a
  // stronger RESEARCH_MODEL is the likely route), revisit this — the enum is already in place to
  // carry the semantic half on its own.
  test("a DECLARED evidence gap reaches the stored verdict — when the run came back EMPTY", async () => {
    const { t, planId } = await setup();
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [
          toolStep("declareUnsupported", {
            claim: "no independent source names this entity",
            scope: "question",
          }),
          // A run that searched and genuinely retrieved NOTHING — fixture 33's measured shape
          // (every one of its dispatches across v2-v7 came back with sourceCount 0).
          ...searchedSteps(REPLY, []),
        ],
        research: true,
      }),
    );
    expect(res.declaredUnsupported).toBe(true);
    expect(res.webSearchCalls).toBe(1);
    expect(res.sources).toHaveLength(0);

    // (a) the tool was really BUILT, really allowed, and really has its schema literal.
    expect((await readSteps(t)).map((s) => s.tool)).toContain("declareUnsupported");

    // (b) the verdict carries the declaration through to the stored findings.
    const persisted = (await t.run((ctx) => ctx.db.query("audit").collect())).find(
      (r) => r.eventType === "research.persisted",
    );
    expect(persisted?.payload).toMatchObject({
      declaredUnsupported: true,
      sourceCount: 0,
      evidenceVerdict: "insufficient_evidence",
    });
  });

  // The reversal above, pinned as its own assertion so it can never regress silently: the ONLY
  // thing that now separates this from the test above is the retrieved source.
  // MUTATION that turns this RED: drop `&& sources.length === 0` in llm.ts.
  test("a question-scope declaration made while HOLDING sources does not mark findings unsupported", async () => {
    const { t, planId } = await setup();
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [
          toolStep("declareUnsupported", { claim: "reflex", scope: "question" }),
          ...searchedSteps(REPLY, ["https://example.com/a", "https://example.com/b"]),
        ],
        research: true,
      }),
    );
    expect(res.sources).toHaveLength(2);
    expect(res.declaredUnsupported, "the reflex must not outvote the retrieved sources").toBe(
      false,
    );
    const persisted = (await t.run((ctx) => ctx.db.query("audit").collect())).find(
      (r) => r.eventType === "research.persisted",
    );
    expect(persisted?.payload).toMatchObject({ sourceCount: 2, evidenceVerdict: "sourced" });
  });

  // ACTN-03: the OTHER half of the scoped declaration, and the whole reason the enum exists.
  // MEASURED (probe 7faf396c): the specialist called `declareUnsupported` on 5 of 5 dispatches
  // while holding 0, 3, 4, 6 and 8 sources — a reflex, not a judgement — so an unscoped bit
  // reported "we found nothing" about runs that plainly found something, and reddened fixtures 32
  // and 34 no matter how the skill body was worded (three rewrites failed). A `sub-question` scope
  // is a note to the reader: the findings STAND.
  // MUTATION that turns this RED: drop the `?.scope === "question"` check in llm.ts and go back to
  // `toolCalls.some((p) => p.toolName === "declareUnsupported")`.
  test("a SUB-QUESTION declaration leaves the findings standing — the verdict stays sourced", async () => {
    const { t, planId } = await setup();
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [
          toolStep("declareUnsupported", {
            claim: "one vendor's freshness-filter behaviour was not documented anywhere",
            scope: "sub-question",
          }),
          ...searchedSteps(REPLY, ["https://example.com/answered"]),
        ],
        research: true,
      }),
    );
    expect(res.declaredUnsupported, "a sub-question note must not read as a refusal").toBe(false);

    // Non-vacuity: the call really happened and really traced — this is not passing because the
    // tool was absent, which is the trap the 22.1b sibling test above exists to catch.
    expect((await readSteps(t)).map((s) => s.tool)).toContain("declareUnsupported");

    const persisted = (await t.run((ctx) => ctx.db.query("audit").collect())).find(
      (r) => r.eventType === "research.persisted",
    );
    expect(persisted?.payload).toMatchObject({
      declaredUnsupported: false,
      sourceCount: 1,
      evidenceVerdict: "sourced",
    });
  });

  test("wall clock: partial findings return and land with the distinct clock marker", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) => ctx.db.patch(planId, { kind: "memo", status: "collecting", body: "" }));
    // `softCutoffMs: 0` fires on the FIRST evaluation, so the loop stops cleanly BETWEEN steps and
    // keeps what it has. Deliberately not a shrunken HARD budget: that would make AbortSignal race
    // the mock and throw agent_timeout — the discard-the-work outcome D11's row exists to disprove.
    const clock = ok(
      await t
        .action(internal.dispatch.__runSpecialistWithScript, {
          ...RESEARCH,
          planId,
          primary: [
            textToolStep(
              "Partial findings from four good sources.",
              "declareUnsupported",
              { claim: "partial" },
              "clock-local",
            ),
            REPLY_STEP,
          ],
          softCutoffMs: 0,
        })
        .catch((cause) => {
          throw new Error("wall clock discarded partial findings by throwing agent_timeout", {
            cause,
          });
        }),
    );
    expect(clock.incomplete).toBe(true);
    expect(clock.incompleteReason).toBe("clock");
    expect(clock.body).toContain("Partial findings");
    const card = (await readPlan(t, planId))?.body ?? "";
    expect(card).toContain(INCOMPLETE_MARKER.clock.trim());
    // Mutation that turns this RED: collapse the clock marker onto cost or steps.
    expect(card).not.toContain(INCOMPLETE_MARKER.cost.trim());
    expect(card).not.toContain(INCOMPLETE_MARKER.steps.trim());

    // Non-vacuity: the granted local tool ran before the clock stopped.
    expect((await readSteps(t)).map((s) => s.tool)).toContain("declareUnsupported");
  });

  test("cost ceiling: partial output lands, then the exhausted envelope refuses exactly", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) => ctx.db.patch(planId, { kind: "memo", status: "collecting", body: "" }));
    const cost = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [REPLY_STEP],
        research: true,
        envelopeCents: 5,
        spentCents: 0,
      }),
    );
    expect(cost.incomplete).toBe(true);
    expect(cost.incompleteReason).toBe("cost");
    expect(cost.body).toBe(REPLY);
    const card = (await readPlan(t, planId))?.body ?? "";
    expect(card).toContain(INCOMPLETE_MARKER.cost.trim());
    // Mutation that turns this RED: collapse the cost marker onto steps or clock.
    expect(card).not.toContain(INCOMPLETE_MARKER.steps.trim());
    expect(card).not.toContain(INCOMPLETE_MARKER.clock.trim());

    // A second HARNESS dispatch starts with the exhausted envelope. Resetting the landing fixture
    // is not `stageResearchPlan` and not a second dispatchResearch tool call; it only makes the
    // governed refusal's existing fallbackBody observable on the card.
    await t.run((ctx) => ctx.db.patch(planId, { status: "collecting", body: "" }));
    const refused = await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...RESEARCH,
      planId,
      primary: [REPLY_STEP],
      research: true,
      envelopeCents: cost.envelopeCents,
      spentCents: cost.spentCents,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reply).toBe(BUDGET_EXHAUSTED_REPLY);
    expect((await readPlan(t, planId))?.body).toBe(BUDGET_EXHAUSTED_REPLY);
  });

  test("step budget: partial findings land with the distinct steps marker", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) => ctx.db.patch(planId, { kind: "memo", status: "collecting", body: "" }));
    const steps = Array.from({ length: 12 }, (_, i) =>
      textToolStep(
        `Partial angle ${i + 1}.`,
        "declareUnsupported",
        { claim: `angle ${i + 1}` },
        `step-cap-${i}`,
      ),
    );

    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: steps,
      }),
    );
    expect(res.incomplete).toBe(true);
    expect(res.incompleteReason).toBe("steps");
    expect(res.body).toContain("Partial angle");
    const card = (await readPlan(t, planId))?.body ?? "";
    expect(card).toContain(INCOMPLETE_MARKER.steps.trim());
    // Mutation that turns this RED: collapse the steps marker onto cost or clock.
    expect(card).not.toContain(INCOMPLETE_MARKER.cost.trim());
    expect(card).not.toContain(INCOMPLETE_MARKER.clock.trim());
  });

  test("three-way marker distinctness: cost, steps and clock differ on the plan card", async () => {
    expect(INCOMPLETE_MARKER.cost).not.toBe(INCOMPLETE_MARKER.steps);
    expect(INCOMPLETE_MARKER.cost).not.toBe(INCOMPLETE_MARKER.clock);
    expect(INCOMPLETE_MARKER.steps).not.toBe(INCOMPLETE_MARKER.clock);
  });

  test("ONE literal, not two: hosted search emits no step while a local tool does", async () => {
    const { t, planId } = await setup();
    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [
          toolStep("declareUnsupported", { claim: "local" }, "one-literal-local"),
          ...searchedSteps(REPLY, ["https://example.com/hosted"]),
        ],
      }),
    );
    expect(res.sources).toHaveLength(1);
    const tools = (await readSteps(t)).map((s) => s.tool);
    expect(tools).toContain("declareUnsupported");
    // Mutation that turns this RED: emit a hosted-search row and add its schema literal.
    expect(tools).not.toContain("web_search");
  });
});

describe("stageResearchPlan — the collecting interlock (16-06 Task 2)", () => {
  const stage = (t: T, threadId = THREAD) =>
    t.mutation(internal.plans.stageResearchPlan, {
      tenantId: TENANT,
      threadId,
      subject: "Research: pricing",
    });

  test("no plan row: one is inserted, memo-shaped, parked at `collecting` with no body", async () => {
    const t = convexTest(schema, modules);
    const res = await stage(t as T);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await (t as T).run((ctx) => ctx.db.get(res.planId))).toMatchObject({
      kind: "memo",
      status: "collecting",
      subject: "Research: pricing",
      body: "",
      recipients: [],
    });
  });

  test("a `collecting` MEMO row is a run IN FLIGHT — refused, and the row is untouched", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        kind: "memo",
        status: "collecting",
        subject: "Research: first",
        body: "",
      }),
    );
    const before = await readPlan(t, planId);

    expect(await stage(t)).toEqual({ ok: false, reason: "research_in_flight" });
    // The WHOLE row, not just its status: a recycle that raced the in-flight run would discard
    // findings already paid for.
    expect(await readPlan(t, planId)).toEqual(before);
  });

  test("a `proposed` EMAIL draft is the USER's work — refused, and it survives intact", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        status: "proposed",
        recipients: ["someone@example.com"],
        subject: "Quarterly update",
        body: "Half-composed prose the user typed.",
      }),
    );
    const before = await readPlan(t, planId);

    expect(await stage(t)).toEqual({ ok: false, reason: "draft_in_progress" });
    expect(await readPlan(t, planId)).toEqual(before);
  });

  test("a `collecting` EMAIL draft with content is refused too — the composing row is user work", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) => ctx.db.patch(planId, { recipients: ["a@b.com"], subject: "Draft" }));

    expect(await stage(t)).toEqual({ ok: false, reason: "draft_in_progress" });
  });

  test("the POSITIVE half: an EMPTY composing row, a proposed MEMO and a canceled row all recycle", async () => {
    // Without this the refusals above would pass against a mutation that refuses everything — and
    // the empty-composing case is the PRIMARY path: cockpit.ts inserts every thread's plan row at
    // `collecting` and it stays there for the whole composition.
    const cases: readonly (readonly [string, Record<string, unknown>])[] = [
      ["an empty composing row", {}],
      ["a proposed memo", { kind: "memo", status: "proposed", body: "previous findings" }],
      ["a canceled row", { status: "canceled", subject: "abandoned", body: "abandoned" }],
    ];
    for (const [name, patch] of cases) {
      const { t, planId } = await setup();
      if (Object.keys(patch).length > 0) await t.run((ctx) => ctx.db.patch(planId, patch));

      const res = await stage(t);
      expect(res.ok, `${name} was refused — research can never start`).toBe(true);
      // resetPlan, not patchPlan: a previous memo's subject must not survive onto this one.
      expect(await readPlan(t, planId)).toMatchObject({
        kind: "memo",
        status: "collecting",
        subject: "Research: pricing",
        body: "",
      });
    }
  });
});

describe("the dispatchResearch tool — stage, schedule, return (16-06 Task 3)", () => {
  const TURN = { turnId: "turn-exec-1", threadId: THREAD };
  const runExec = (t: T, planId: Id<"plans">, primary: unknown[]) =>
    t.action(internal.llm.__runCockpitAgentWithScript, {
      tenantId: TENANT,
      planId,
      ...TURN,
      primary: primary as never,
    });

  test("the executive's turn SCHEDULES the run and comes back without waiting for it", async () => {
    const { t, planId } = await setup();
    const res = await runExec(t, planId, [
      toolStep("dispatchResearch", { question: QUESTION }),
      textStep("I've started looking into that."),
    ]);

    // The turn COMPLETED — it was not held for the length of a multi-search research run.
    expect(res.reply).toContain("started looking into that");
    const queued = await scheduledResearch(t);
    expect(queued, "the research run was not scheduled").toHaveLength(1);

    const plan = await readPlan(t, planId);
    expect(plan?.kind).toBe("memo");
    expect(plan?.status).toBe("collecting");
    expect(plan?.body).toBe("");
    expect(plan?.subject).toContain("Research:");
  });

  test("THE INTERLOCK: a second dispatch in the same turn is refused, and schedules NOTHING more", async () => {
    const { t, planId } = await setup();
    await runExec(t, planId, [
      toolStep("dispatchResearch", { question: QUESTION }, "c-first"),
      toolStep("dispatchResearch", { question: "a second question" }, "c-second"),
      textStep("Both handled."),
    ]);

    // Non-vacuity in the SAME test: exactly ONE was scheduled, not zero.
    expect(
      await scheduledResearch(t),
      "the interlock let a second run race the first",
    ).toHaveLength(1);
    // The refusal is CONVERSATIONAL: a throw would terminalize the step as `error`.
    const steps = (await readSteps(t)).filter((s) => s.tool === "dispatchResearch");
    expect(steps).toHaveLength(2);
    for (const s of steps)
      expect(s.phase, "the in-flight refusal threw instead of returning").toBe("done");
  });

  test("a SPECIALIST turn never CONSTRUCTS dispatchResearch — unreachable, not merely filtered", () => {
    const stubCtx = {} as Parameters<typeof buildCockpitTools>[0];
    const build = (agentContext: Record<string, unknown>) =>
      Object.keys(
        buildCockpitTools(
          stubCtx,
          TENANT,
          "plan_stub" as Id<"plans">,
          undefined,
          undefined,
          undefined,
          agentContext as never,
        ),
      );

    const specialist = build({
      grantWebResearch: true,
      grantDispatch: false,
      threadId: THREAD,
      rootRequestId: ROOT,
    });
    // POSITIVE half first, so this cannot pass against an empty record.
    expect(specialist).toContain("webResearch");
    expect(specialist).toContain("declareUnsupported");
    // NOTE: no `not.toContain("searchVault")` here. `buildCockpitTools` CONSTRUCTS the full record
    // for every caller; research's web-only grant (ACTN-03) is enforced one layer up by the
    // `toolNames` allow-list off RESEARCH_TOOLS — asserted as an equality in
    // packages/core/src/specialists.test.ts. Asserting it here would test the wrong layer and fail.
    // A withheld-but-constructed closure would still be reachable via invokeTool, and this tool
    // hardcodes depth 1 / ancestry [] — a re-entry there would bypass MAX_DEPTH and wouldCycle.
    expect(specialist, "a specialist can construct a dispatch").not.toContain("dispatchResearch");
    expect(specialist, "a specialist can construct an image proposal").not.toContain(
      "proposeImage",
    );

    const executive = build({ grantDispatch: true, threadId: THREAD, rootRequestId: ROOT });
    expect(executive).toContain("dispatchResearch");
    expect(executive).toContain("proposeImage");
    // No turn identity ⇒ no lineage to dispatch under ⇒ structurally absent.
    expect(build({ grantDispatch: true })).not.toContain("dispatchResearch");
  });

  test("THE MODEL PIN: research bills its own pair, every other route the default", async () => {
    const { t, planId } = await setup();

    // 1. RESEARCH — its own pair since 16-05.
    const research = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...RESEARCH,
        planId,
        primary: [REPLY_STEP],
      }),
    );
    expect(research.modelId).toBe(RESEARCH_MODEL);
    expect(research.fallbackModelId).toBe(RESEARCH_FALLBACK_MODEL);

    // 2. EVERYTHING ELSE — `media` must take the repo defaults byte-identically. Without a genuine
    // default case the lookup could pin EVERY route and stay green.
    const other = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        route: "media",
        planId,
        primary: [REPLY_STEP],
      }),
    );
    expect(other.modelId).toBe(DEFAULT_MODEL);
    expect(other.fallbackModelId).toBe(CHEAP_MODEL);

    // ── The non-vacuity anchor ──
    //
    // History, because it has been rebuilt twice and the reasoning matters more than the line:
    // it began as `expect(RESEARCH_FALLBACK_MODEL).not.toBe(CHEAP_MODEL)`, which PROVED the route
    // branch ran only while those constants could never coincide. They coincided the moment
    // CHEAP_MODEL moved vendors, making every value comparison above satisfiable with the branch
    // deleted. Restoring inequality by moving a pin would be inventing behaviour to satisfy a test.
    //
    // It is now STRUCTURAL — assert the branch exists in the source (the dispatchGuard.test.ts idiom
    // for when runtime values stop discriminating). The three runtime cases above are the semantic
    // half; this is the guard against all three collapsing to one constant that happens to match.
    // MUTATION that turns this RED: collapse the route lookup in llm.ts to a single pair.
    const llmSrc = readFileSync(join(__dirname, "llm.ts"), "utf8");
    expect(llmSrc).toContain("[RESEARCH_MODEL, RESEARCH_FALLBACK_MODEL]");
    expect(llmSrc).toContain("[DEFAULT_MODEL, CHEAP_MODEL]");
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

// ── 20-08: the media route ────────────────────────────────────────────────────────────────────
//
// Driven through `__runSpecialistWithScript` with `media: true` — the twin calls the SAME
// `dispatchAndLand` and the SAME `persistStoryboard` the scheduled `runMedia` does. $0: the model
// is a script.

/** A body in the exact shape the `media-director` skill body asks for. Narration lines sit inside
 *  the 103-140 band a 10-second window admits, or `parseBlockDeck` refuses them before payment. */
const MEDIA_BODY = [
  "## 1. SCRIPT",
  "",
  "Six weeks, start to finish. Nobody believed it could be done that fast.",
  "",
  "## 2. ART DIRECTION",
  "",
  "- **Palette** — `#0B4F4A deep teal`, `#F4F1EA bone`",
  "- **Mood** — Quietly confident, never triumphant.",
  "- **Lighting** — Warm golden light from camera left at 45 degrees.",
  "- **Composition** — Subject off-centre right, camera locked off.",
  "- **Environment** — A working studio, mid-afternoon.",
  "- **Texture** — 35mm film grain over matte paper.",
  "- **References** — Gregory Crewdson; the film Locke",
  "- **Do NOT** — No stock-footage handshakes.",
  "",
  "BLOCK DECK",
  "Clip seconds: 10",
  "",
  "| # | Type | Description | Narration |",
  "|---|------|-------------|-----------|",
  "| 1 | AI | Founder at a desk | Most teams lose a full hour every day to inbox triage, and not one of them ever chose to spend it that way. |",
  "| 2 | AI | Mail icons collapsing | Pikar reads the whole thread once, drafts the reply in your voice, and hands it back before the coffee cools. |",
  "",
  "BLOCK PROMPTS",
  "",
  "Block 1",
  "Prompt: A founder at a desk in warm 45-degree light, 35mm grain",
  "Block 2",
  "Prompt: Abstract mail icons collapsing into a single card, bone background",
].join("\n");

const mediaArgs = (planId: Id<"plans">, over: Record<string, unknown> = {}) => ({
  ...BASE,
  planId,
  route: "media",
  question: "a 20-second reel about the launch",
  media: true,
  primary: [{ ...textStep(MEDIA_BODY), usage: SPEND_8_CENTS }],
  ...over,
});

/** The row a media dispatch actually runs against — staged through `stageMediaPlan`, not a bare
 *  `insertPlan`: `landSpecialistResult`'s CAS refuses anything that is not `collecting` + `memo`. */
async function stagedMediaPlan(t: T): Promise<Id<"plans">> {
  const staged = await t.mutation(internal.plans.stageMediaPlan, {
    tenantId: TENANT,
    threadId: THREAD,
    subject: "Reel",
  });
  if (!staged.ok) throw new Error(`staging refused: ${staged.reason}`);
  return staged.planId;
}

const readJobs = (t: T) => t.run((ctx) => ctx.db.query("mediaJobs").collect());

describe("20-08 — a media dispatch proposes a deck and spends nothing but tokens", () => {
  test("the deck lands on the plan row: script, art direction, blocks with narration", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const res = ok(await t.action(internal.dispatch.__runSpecialistWithScript, mediaArgs(planId)));
    expect(res.route).toBe("media");

    const plan = await readPlan(t, planId);
    expect(plan?.kind).toBe("media");
    expect(plan?.status).toBe("proposed");
    expect(plan?.clipSeconds).toBe(10);
    expect(plan?.script).toContain("Six weeks, start to finish.");
    expect(plan?.artDirection?.palette).toEqual(["#0B4F4A deep teal", "#F4F1EA bone"]);
    expect(plan?.artDirection?.avoid).toContain("stock-footage handshakes");

    expect(plan?.shots).toHaveLength(2);
    expect(plan?.shots?.map((s) => s.index)).toEqual([0, 1]);
    expect(plan?.shots?.map((s) => s.windowStartMs)).toEqual([0, 10_000]);
    // Every block has a narration line — the voiceover has nothing to say without one.
    expect(plan?.shots?.every((s) => s.narration.length > 0)).toBe(true);
    // ...and the per-block PROMPT came from §4, not from a fallback to the description.
    expect(plan?.shots?.[0]?.prompt).toContain("45-degree light");
    expect(plan?.shots?.[1]?.prompt).toContain("bone background");
  });

  test("SC#3: the dispatched run inserts ZERO mediaJobs rows and never sets a render", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const before = await remaining(t);
    await t.action(internal.dispatch.__runSpecialistWithScript, mediaArgs(planId));

    // THE containment, stated as an absence. The specialist's grant is `searchVault` and there is
    // no code path from here to a fal POST or a sandbox — the paid calls fire from cockpit.ts's
    // `EXTERNAL_TARGETS.media` after the human Approve gate, and from nowhere else.
    expect(await readJobs(t)).toHaveLength(0);
    const plan = await readPlan(t, planId);
    expect(plan?.renderStatus).toBeUndefined();
    expect(plan?.renderStorageId).toBeUndefined();
    // Tokens only — and the run DID spend, so the zero above is containment, not an inert run.
    expect(await remaining(t)).toBeLessThan(before);
  });

  test("an unparseable body lands a REFUSAL naming the lever — never an empty deck", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const res = ok(
      await t.action(
        internal.dispatch.__runSpecialistWithScript,
        mediaArgs(planId, {
          primary: [
            { ...textStep("I wrote some prose and forgot the table."), usage: SPEND_8_CENTS },
          ],
        }),
      ),
    );
    expect(res.ok).toBe(true); // the RUN succeeded; only the deck did not parse

    const plan = await readPlan(t, planId);
    // An empty canvas that says `kind: "media"` is the one shape that looks like a successful
    // proposal and is not. The row stays a memo and the body names the lever.
    expect(plan?.kind).not.toBe("media");
    expect(plan?.shots).toBeUndefined();
    expect(plan?.body).toContain("never wrote a block deck");
    expect(plan?.body).toContain("no_deck");

    const audit = (await readLineage(t)).filter((r) => r.eventType === "media.deck_refused");
    expect(audit).toHaveLength(1);
    const payload = audit[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.reason).toBe("no_deck");
  });

  test("an OVER-LENGTH narration is refused with the block and the count, and the text never leaks", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const long = "x".repeat(186);
    const body = MEDIA_BODY.replace(
      "Pikar reads the whole thread once, drafts the reply in your voice, and hands it back before the coffee cools.",
      long,
    );
    await t.action(
      internal.dispatch.__runSpecialistWithScript,
      mediaArgs(planId, { primary: [{ ...textStep(body), usage: SPEND_8_CENTS }] }),
    );

    const plan = await readPlan(t, planId);
    expect(plan?.shots).toBeUndefined();
    expect(plan?.body).toContain("too long");
    expect(plan?.body).toContain("Block 2"); // 1-based for the human, from a 0-based blockIndex

    // Refs and COUNTS only (§4): the reason code, the block index and the character count. The
    // narration text itself must appear NOWHERE in the audit plane.
    const audit = (await readLineage(t)).filter((r) => r.eventType === "media.deck_refused");
    const payload = audit[0]?.payload as Record<string, unknown>;
    expect(payload.reason).toBe("narration_too_long");
    expect(payload.blockIndex).toBe(1);
    expect(payload.chars).toBe(186);
    expect(JSON.stringify(await readLineage(t))).not.toContain(long);
  });

  test("persistDeck REFUSES an empty deck outright — the second lock on the same door", async () => {
    // `dispatch.ts` never calls with an empty deck, and this proves the mutation would refuse one
    // anyway. Without this the no-empty-deck property is only testable through the parser, and a
    // future caller could write `shots: []` with nothing going red.
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const before = await readPlan(t, planId);

    await t.mutation(internal.plans.persistDeck, {
      tenantId: TENANT,
      planId,
      script: "s",
      artDirection: null,
      clipSeconds: 10,
      shots: [],
    });

    expect(await readPlan(t, planId)).toEqual(before); // byte-identical row
    expect((await readPlan(t, planId))?.kind).not.toBe("media");
  });

  test("persistDeck refuses a CROSS-TENANT write", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const before = await readPlan(t, planId);
    await t.mutation(internal.plans.persistDeck, {
      tenantId: "tenant_other",
      planId,
      script: "s",
      artDirection: null,
      clipSeconds: 10,
      shots: [
        {
          index: 0,
          type: "AI",
          seconds: 10,
          windowStartMs: 0,
          description: "d",
          prompt: "p",
          narration: "n",
        },
      ],
    });
    expect(await readPlan(t, planId)).toEqual(before);
  });

  test("a body with no art direction still gets its DECK — a worse reel, not an unusable one", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const body = MEDIA_BODY.replace("- **Texture** — 35mm film grain over matte paper.", "");
    await t.action(
      internal.dispatch.__runSpecialistWithScript,
      mediaArgs(planId, { primary: [{ ...textStep(body), usage: SPEND_8_CENTS }] }),
    );

    const plan = await readPlan(t, planId);
    expect(plan?.shots).toHaveLength(2);
    expect(plan?.artDirection).toBeUndefined();
    const audit = (await readLineage(t)).filter((r) => r.eventType === "media.deck_persisted");
    const payload = audit[0]?.payload as Record<string, unknown>;
    expect(payload.hasArtDirection).toBe(false);
    // COUNTS only — the two numbers a later mediaJobs batch is reconciled against.
    expect(payload.blocks).toBe(2);
    expect(payload.clipSeconds).toBe(10);
  });
});

describe("20-08 — stageMediaPlan refuses rather than destroying an in-flight reel", () => {
  const restage = (t: T) =>
    t.mutation(internal.plans.stageMediaPlan, {
      tenantId: TENANT,
      threadId: THREAD,
      subject: "Reel 2",
    });

  const seedJob = (t: T, planId: Id<"plans">, status: "submitted" | "succeeded") =>
    t.run((ctx) =>
      ctx.db.insert("mediaJobs", {
        tenantId: TENANT,
        planId,
        batchId: "b1",
        blockIndex: 0,
        provider: "wan" as const,
        kind: "video" as const,
        model: "wan2.5-t2v-preview",
        spec: { kind: "video" as const, resolution: "480p", seconds: 10 },
        promptHash: "0".repeat(64),
        status,
        estUsd: 0.5,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

  test("a plan with a LIVE media job is reel_in_flight — those clips are already paid for", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    await t.run((ctx) => ctx.db.patch(planId, { kind: "media" }));
    await seedJob(t, planId, "submitted"); // non-terminal: fal may still call back

    const again = await restage(t);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("reel_in_flight");
  });

  test("a LIVE render is its OWN refusal — every job can be terminal while the sandbox runs", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    // No mediaJobs rows at all: this is exactly the window the second check exists for.
    await t.run((ctx) => ctx.db.patch(planId, { kind: "media", renderStatus: "rendering" }));

    const again = await restage(t);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("render_in_flight");
  });

  test("a FINISHED reel recycles — a terminal job and a rendered reel are not work in progress", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        kind: "media",
        status: "proposed",
        renderStatus: "rendered",
        clipSeconds: 10,
      }),
    );
    await seedJob(t, planId, "succeeded");

    const again = await restage(t);
    expect(again.ok).toBe(true);
    // resetPlan ran: the previous deck AND the previous render plane are gone, either of which
    // surviving would show under a brand-new proposal.
    const plan = await readPlan(t, planId);
    expect(plan?.clipSeconds).toBeUndefined();
    expect(plan?.renderStatus).toBeUndefined();
  });

  // ── THE INTERLOCK (2026-08-14) ────────────────────────────────────────────────────────────
  // Reconstructed from a real transcript in which a SLIDE-DECK conversation lost its staged
  // image proposal to a reel dispatch and then deadlocked.

  test("a dispatch still in flight refuses a second one — the missing copy of research_in_flight", async () => {
    const { t } = await setup();
    // `stageMediaPlan` leaves the row `kind: memo` + `collecting`, which is precisely the shape
    // `stageResearchPlan` refuses as `research_in_flight`. This function is documented as a
    // second copy of that shape and had dropped the check.
    await stagedMediaPlan(t);

    const again = await restage(t);
    expect(again.ok).toBe(false);
    // NOT `draft_in_progress`: that reply tells the user about an email draft they do not have.
    if (!again.ok) expect(again.reason).toBe("dispatch_in_flight");
  });

  test("a STAGED IMAGE PROPOSAL is not a spent deck — a reel may not silently discard it", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    // What `proposeImage` writes: a media-kind row carrying a prompt the user was told to review,
    // with NO job yet because generation needs their click.
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        kind: "media",
        mediaMode: "image",
        imagePrompt: "A modern water-sensor dashboard, cool blues",
        status: "proposed",
      }),
    );

    const again = await restage(t);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("image_proposal_pending");
    // …and the proposal SURVIVED. This is the assertion that matters: the old code returned ok
    // and `resetPlan` wiped `imagePrompt`, so the user never saw the image they were promised.
    const plan = await readPlan(t, planId);
    expect(plan?.imagePrompt).toBe("A modern water-sensor dashboard, cool blues");
    expect(plan?.mediaMode).toBe("image");
  });

  test("a SPENT image proposal recycles — the click already happened", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        kind: "media",
        mediaMode: "image",
        imagePrompt: "x",
        status: "proposed",
      }),
    );
    // One terminal job = the user clicked Generate. The proposal is history, not work in
    // progress, so a reel may take the row. `jobs.length === 0` is what draws that line.
    await seedJob(t, planId, "succeeded");

    expect((await restage(t)).ok).toBe(true);
  });

  test("a reel still replaces a reel — the INTENDED flow is not caught by either interlock", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    // A previously proposed DECK, no image mode, no jobs. Not vacuous: it is the same
    // `kind: media` + `proposed` shape the image case refuses, differing only in mediaMode.
    await t.run((ctx) =>
      ctx.db.patch(planId, { kind: "media", status: "proposed", clipSeconds: 4 }),
    );

    expect((await restage(t)).ok).toBe(true);
  });

  test("a completed refusal memo recycles so the user can retry the reel in the same chat", async () => {
    const { t, planId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        kind: "memo",
        status: "done",
        subject: "Reel: previous attempt",
        body: "The previous deck was refused before generation.",
      }),
    );

    const again = await restage(t);
    expect(again.ok).toBe(true);
    expect(await readPlan(t, planId)).toMatchObject({
      kind: "memo",
      status: "collecting",
      subject: "Reel 2",
      body: "",
    });
  });

  test("the USER'S OWN email draft is protected — the MODEL is deciding here, not the user", async () => {
    // `setup()` already inserts THIS thread's plan row, and `plans.by_thread` is `.unique()` —
    // inserting a second one throws before the assertion can run.
    const { t, planId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(planId, {
        recipients: ["sam@example.test"],
        subject: "Half-written note to a client",
        body: "Hi Sam,",
      }),
    );

    const staged = await t.mutation(internal.plans.stageMediaPlan, {
      tenantId: TENANT,
      threadId: THREAD,
      subject: "Reel",
    });
    expect(staged.ok).toBe(false);
    if (!staged.ok) expect(staged.reason).toBe("draft_in_progress");
  });
});

// ── 21-03 (SKILL-01): the EXACT tenant candidate reaches the DISPATCHED specialist ────────────
//
// THE question this plan exists to answer, and the one a green suite could easily fake: does the
// body the runner PINNED equal the body the model RAN? A `skillVersion` cannot answer it — two
// tenants can each own version 2 (21-02's collision), and this tenant's own ACTIVE overlay is also
// a version of the same name. So every assertion below is against the ROW ID or the SHA-256 of
// the body that was handed to the provider.
describe("21-03 — an exact tenant candidate id survives the scheduled dispatch", () => {
  const CANDIDATE_NEEDLE = "ZQ7CANDb51f3a0d9";
  const ACTIVE_NEEDLE = "ZQ7ACTIVE8e2c7f14";
  const OTHER_TENANT_NEEDLE = "ZQ7OTHERd0a6b93c";
  const CANDIDATE_BODY = `OFFER ARCHITECT — pinned candidate. ${CANDIDATE_NEEDLE}`;
  const ACTIVE_BODY = `OFFER ARCHITECT — the tenant's live overlay. ${ACTIVE_NEEDLE}`;
  const OTHER_BODY = `OFFER ARCHITECT — another tenant's draft. ${OTHER_TENANT_NEEDLE}`;

  const insertRow = (
    t: T,
    tenantId: string,
    fields: { version: number; body: string; status: "active" | "candidate" | "archived" },
  ) =>
    t.run((ctx) =>
      ctx.db.insert("tenantSkills", {
        tenantId,
        name: "offer-architect",
        authoredBody: "adaptation",
        author: "user",
        basedOnScope: "global",
        basedOnName: "offer-architect",
        basedOnVersion: 1,
        rollbackEligible: false,
        createdAt: fields.version,
        ...fields,
      }),
    );

  /**
   * Three rows that all answer to `offer-architect`, so NOTHING short of the exact id can pick the
   * right one: the tenant's ACTIVE overlay (what an unpinned run loads), the CANDIDATE we pin, and
   * ANOTHER tenant's row at the SAME name and version as the candidate.
   */
  async function threeWayCollision() {
    const { t, planId } = await setup();
    const activeId = await insertRow(t, TENANT, {
      version: 2,
      body: ACTIVE_BODY,
      status: "active",
    });
    const candidateId = await insertRow(t, TENANT, {
      version: 3,
      body: CANDIDATE_BODY,
      status: "candidate",
    });
    const otherId = await insertRow(t, TENANT_B, {
      version: 3,
      body: OTHER_BODY,
      status: "candidate",
    });
    return { t, planId, activeId, candidateId, otherId };
  }

  const actionCtx = (t: T) =>
    ({
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
      runAction: t.action.bind(t),
    }) as unknown as Parameters<typeof runSpecialistTurn>[0];

  test("the pinned candidate's body — not the tenant's ACTIVE overlay — is what the model receives", async () => {
    const { t, planId, activeId, candidateId } = await threeWayCollision();

    // The mock's `doGenerate` is a FUNCTION, so the assertion is about what went IN (the system
    // prompt the provider was handed), not about the canned reply that came back — the 21-02
    // idiom. A LanguageModel is not Convex-serializable, so this reads the loop directly; the
    // scheduled seam's own proof is the audit hash in the third test below.
    const captureTurn = async (pins?: Record<string, unknown>) => {
      let system = "";
      const capture = async (opts: {
        prompt: ReadonlyArray<{ role: string; content: unknown }>;
      }) => {
        system = String(opts.prompt.find((m) => m.role === "system")?.content ?? "");
        return textStep("noted", 0, 0);
      };
      const res = await runSpecialistTurn(actionCtx(t), {
        tenantId: TENANT,
        planId,
        skillName: "offer-architect",
        toolNames: [],
        prompt: "shape my offer",
        mockScript: { primary: capture as never },
        ...pins,
      });
      return { system, res };
    };

    // UNPINNED: the effective (ACTIVE overlay) body. This is the positive witness that makes the
    // pinned assertion below meaningful — and it is exactly what a DROPPED `tenantSkillIds` would
    // silently fall back to.
    const unpinned = await captureTurn();
    expect(unpinned.system).toBe(ACTIVE_BODY);
    expect(unpinned.res.skillScope).toBe("tenant");
    expect(unpinned.res.skillId).toBe(String(activeId));

    // PINNED by exact row id: the candidate body, byte for byte.
    const pinned = await captureTurn({ tenantSkillIds: { "offer-architect": candidateId } });
    expect(pinned.system).toBe(CANDIDATE_BODY);
    expect(pinned.system).toContain(CANDIDATE_NEEDLE);
    expect(pinned.system).not.toContain(ACTIVE_NEEDLE);
    expect(pinned.system).not.toContain(OTHER_TENANT_NEEDLE);
    expect(pinned.res.skillId).toBe(String(candidateId));
    expect(pinned.res.skillVersion).toBe(3);
    expect(pinned.res.skillBodyHash).toBe(await contentHash(CANDIDATE_BODY));
    // …and the two prompts really did differ, so neither equality is trivially the other.
    expect(pinned.system).not.toBe(unpinned.system);
  });

  test("a pin naming a DIFFERENT skill's row refuses before the model is called", async () => {
    const { t, planId } = await threeWayCollision();
    const wrongSkillRow = await t.run((ctx) =>
      ctx.db.insert("tenantSkills", {
        tenantId: TENANT,
        name: "lead-engine",
        version: 2,
        body: "LEAD ENGINE candidate body",
        authoredBody: "adaptation",
        status: "candidate",
        author: "user",
        basedOnScope: "global",
        basedOnName: "lead-engine",
        basedOnVersion: 1,
        rollbackEligible: false,
        createdAt: 0,
      }),
    );
    const before = await remaining(t);
    // A mock that THROWS if reached: the refusal must happen BEFORE generateText, so a mis-wired
    // harness costs $0 rather than a model call plus an evidence row certifying the wrong skill.
    const never = async () => {
      throw new Error("the model was called despite a mismatched pin");
    };
    await expect(
      runSpecialistTurn(actionCtx(t), {
        tenantId: TENANT,
        planId,
        skillName: "offer-architect",
        toolNames: [],
        prompt: "shape my offer",
        tenantSkillIds: { "offer-architect": wrongSkillRow },
        mockScript: { primary: never as never },
      }),
    ).rejects.toThrow(/TENANT_SKILL_PIN_MISMATCH/);
    // Nothing was billed — the refusal really did precede the model call.
    expect(await remaining(t)).toBe(before);
  });

  test("subagent.completed carries EXACT refs-only attribution, readable back through by_correlation", async () => {
    const { t, planId, candidateId, activeId, otherId } = await threeWayCollision();
    const root = `${ROOT}-tenant-pin`;

    const res = ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        rootRequestId: root,
        primary: [REPLY_STEP],
        tenantSkillIds: { "offer-architect": candidateId },
      }),
    );
    expect(res.skillVersion).toBe(3);

    const completed = (await readLineage(t, root)).find(
      (r) => r.eventType === "subagent.completed",
    );
    // MUTATION "drop tenantSkillIds at one handoff" turns THESE red: the fallback body is the
    // tenant's ACTIVE overlay, whose row id and body hash are both different.
    expect(completed?.payload).toMatchObject({
      skillScope: "tenant",
      skillId: String(candidateId),
      skillName: "offer-architect",
      skillVersion: 3,
      skillBodyHash: await contentHash(CANDIDATE_BODY),
    });
    // …and it is neither the live overlay nor the other tenant's row at the same name+version.
    expect(completed?.payload.skillId).not.toBe(String(activeId));
    expect(completed?.payload.skillId).not.toBe(String(otherId));
    expect(completed?.payload.skillBodyHash).not.toBe(await contentHash(ACTIVE_BODY));
    expect(completed?.payload.skillBodyHash).not.toBe(await contentHash(OTHER_BODY));

    // The BOUNDED read-only readback an operator actually runs. Same answer, off the same row.
    const attribution = await t.query(internal.smoke.userSkillRuntimeAttribution, {
      tenantId: TENANT,
      correlationId: root,
    });
    expect(attribution).toEqual({
      skillScope: "tenant",
      skillId: String(candidateId),
      skillName: "offer-architect",
      skillVersion: 3,
      skillBodyHash: await contentHash(CANDIDATE_BODY),
    });
    // The tenant guard on a deliberately CROSS-TENANT index: same correlation, another tenant.
    expect(
      await t.query(internal.smoke.userSkillRuntimeAttribution, {
        tenantId: TENANT_B,
        correlationId: root,
      }),
    ).toBeNull();
    // …and an unknown correlation reads null rather than "the newest dispatch".
    expect(
      await t.query(internal.smoke.userSkillRuntimeAttribution, {
        tenantId: TENANT,
        correlationId: "no-such-correlation",
      }),
    ).toBeNull();

    // §4 PRIVACY: serialize EVERY audit payload on this lineage and scan it. No composed body and
    // no needle from any of the three colliding rows. MUTATION "add the resolved body to the
    // subagent.completed payload" turns these four red.
    const serialized = JSON.stringify((await readLineage(t, root)).map((r) => r.payload ?? {}));
    expect(serialized).not.toContain(CANDIDATE_NEEDLE);
    expect(serialized).not.toContain(ACTIVE_NEEDLE);
    expect(serialized).not.toContain(OTHER_TENANT_NEEDLE);
    expect(serialized).not.toContain(CANDIDATE_BODY);
    // Non-vacuity: the scan really did read the row it is asserting about.
    expect(serialized).toContain(await contentHash(CANDIDATE_BODY));
    expect(serialized).toContain(String(candidateId));
    // The dead-letter plane too — a body must not have escaped sideways.
    expect(JSON.stringify(await readDeadLetters(t))).not.toContain(CANDIDATE_NEEDLE);
  });

  test("an UNPINNED dispatch still attributes itself — the GLOBAL row, by id and hash", async () => {
    const { t, planId } = await setup(); // no tenant overlay at all
    const root = `${ROOT}-global-attr`;
    ok(
      await t.action(internal.dispatch.__runSpecialistWithScript, {
        ...BASE,
        planId,
        rootRequestId: root,
        primary: [REPLY_STEP],
      }),
    );
    const active = await t.query(internal.skills.getActiveSkill, { name: "offer-architect" });
    const completed = (await readLineage(t, root)).find(
      (r) => r.eventType === "subagent.completed",
    );
    expect(completed?.payload).toMatchObject({
      skillScope: "global",
      skillId: String(active.skillId),
      skillName: "offer-architect",
      skillVersion: active.version,
      skillBodyHash: await contentHash(active.body),
    });
    // The attribution is not tenant-shaped just because the fields exist.
    expect(completed?.payload.skillScope).not.toBe("tenant");
  });
});

// ── 33-03 — the variations terminal: brief + two decks + citations land in ONE terminal ─────────
//
// `persistStoryboard` now runs `parseVariations` FIRST. A two-variation body lands deck A as the
// picked deck (`shots`) and deck B as the parked alternate (`altShots`), plus the BRIEF and the
// per-scene Source fields, in one `persistDeck` call. A refusing variation refuses the WHOLE
// proposal — never a silent one-deck fallback. A single-deck body still lands exactly as before,
// EXTENDED to carry brief + citations and to DISCARD any parked alternate (a post-pick chat
// revision replaces the picked deck; the alternate is stale by definition).

/** Deck A: 8 + 22 = 30s. Narration windows: scene 1 has 8s (112 chars), scene 2 has 22s. */
const VAR_A_DECK = [
  "SCENE DECK",
  "Target duration: 30",
  "",
  "| # | Visual | Seconds | Description | Narration | Text overlay | Asset |",
  "|---|--------|---------|-------------|-----------|--------------|-------|",
  "| 1 | generated_video | 8 | Founder at a desk | Most founders lose a full hour a day to inbox triage. | | |",
  "| 2 | animated_image | 22 | Mail icons collapsing | Pikar reads the thread and drafts your reply. | | |",
  "",
  "SCENE PROMPTS",
  "",
  "Scene 1",
  "- Prompt: Founder at a desk, warm light",
  "- Source: The 2025 pricing one-pager [doc:k57abc123]",
  "",
  "Scene 2",
  "- Source: unverified",
  "",
].join("\n");

/** Deck B: 11 + 4 = 15s, genuinely different kinds — the alternate the user can switch to. */
const VAR_B_DECK = [
  "SCENE DECK",
  "Target duration: 15",
  "",
  "| # | Visual | Seconds | Description | Narration | Text overlay | Asset |",
  "|---|--------|---------|-------------|-----------|--------------|-------|",
  "| 1 | animated_image | 11 | A calendar filling itself | Your week, planned before coffee. | | |",
  "| 2 | text_card | 4 | Logo on black | | PIKAR | |",
  "",
].join("\n");

const VAR_BRIEF = [
  "## 1. BRIEF",
  "",
  "Topic: Inbox triage, and what it costs a founder",
  "Duration: 30s",
  "Audience: Solo founders drowning in email (defaulted)",
  "",
].join("\n");

const TWO_UP_BODY = [
  VAR_BRIEF,
  "## VARIATION A",
  "",
  VAR_A_DECK,
  "## VARIATION B",
  "",
  VAR_B_DECK,
].join("\n");

describe("33-03 — the variations terminal: parseVariations runs FIRST", () => {
  test("a two-variation proposal lands deck A picked, deck B parked, brief + citations, in one terminal", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const res = ok(
      await t.action(
        internal.dispatch.__runSpecialistWithScript,
        mediaArgs(planId, { primary: [{ ...textStep(TWO_UP_BODY), usage: SPEND_8_CENTS }] }),
      ),
    );
    expect(res.ok).toBe(true);

    const plan = await readPlan(t, planId);
    expect(plan?.kind).toBe("media");
    expect(plan?.status).toBe("proposed");
    // Deck A IS the picked deck — the money path reads `shots` and never learns B exists.
    expect(plan?.shots).toHaveLength(2);
    expect(plan?.targetDurationSeconds).toBe(30);
    expect(plan?.shots?.map((s) => s.visual)).toEqual(["generated_video", "animated_image"]);
    // Deck B is the parked alternate, with its OWN declared length.
    expect(plan?.altShots).toHaveLength(2);
    expect(plan?.altTargetDurationSeconds).toBe(15);
    expect(plan?.altShots?.map((s) => s.visual)).toEqual(["animated_image", "text_card"]);
    // The brief landed beside the decks, defaulted markers stripped into the array.
    expect(plan?.brief).toMatchObject({
      topic: "Inbox triage, and what it costs a founder",
      durationSeconds: 30,
      audience: "Solo founders drowning in email",
      defaulted: ["audience"],
    });
    // Per-scene citations rode the shots in — the parser's word, verbatim.
    expect(plan?.shots?.[0]?.source).toEqual({
      docId: "k57abc123",
      title: "The 2025 pricing one-pager",
    });
    expect(plan?.shots?.[0]?.needsConfirmation).toBeUndefined();
    expect(plan?.shots?.[1]?.needsConfirmation).toBe(true);
    // NO shot carries a confirmation — parsed model content structurally cannot vouch for itself.
    expect(plan?.shots?.every((s) => s.confirmedAt === undefined)).toBe(true);
    expect(plan?.deckProposedAt).toBeTypeOf("number");
    expect(plan?.deckLockedAt).toBeUndefined();
  });

  test("the deck_persisted audit gains variations/citedScenes/unverifiedScenes COUNTS — and no titles (§4)", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    await t.action(
      internal.dispatch.__runSpecialistWithScript,
      mediaArgs(planId, { primary: [{ ...textStep(TWO_UP_BODY), usage: SPEND_8_CENTS }] }),
    );
    const audit = (await readLineage(t)).filter((r) => r.eventType === "media.deck_persisted");
    expect(audit).toHaveLength(1);
    const payload = audit[0]?.payload as Record<string, unknown>;
    expect(payload.variations).toBe(2);
    expect(payload.citedScenes).toBe(1);
    expect(payload.unverifiedScenes).toBe(1);
    // Refs and COUNTS only: the doc title and the claim text appear NOWHERE in the audit plane.
    expect(JSON.stringify(await readLineage(t))).not.toContain("pricing one-pager");
  });

  test("a refusing variation SALVAGES its good sibling — proposed alone, and disclosed", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    // Variation B declared, no deck inside it. Variation A is whole and usable.
    //
    // 33-11 REVERSED THIS TEST'S EXPECTATION ON PURPOSE. It used to assert the whole proposal
    // died here ("never a silent one-deck fallback"). Live on 2026-08-16 that rule cost the owner
    // two consecutive reels: a good storyboard was discarded because its sibling carried an
    // off-grid clip length, and the refusal landed as a memo card with Approve/Save and no way
    // forward. The rule's REAL protection — never propose a deck nobody wrote — still holds: what
    // lands is variation A exactly as the model wrote it. The fallback is no longer SILENT,
    // which is what `lostVariation` on the row is for.
    const body = [
      VAR_BRIEF,
      "## VARIATION A",
      "",
      VAR_A_DECK,
      "## VARIATION B",
      "",
      "Prose only.",
    ].join("\n");
    await t.action(
      internal.dispatch.__runSpecialistWithScript,
      mediaArgs(planId, { primary: [{ ...textStep(body), usage: SPEND_8_CENTS }] }),
    );

    const plan = await readPlan(t, planId);
    // The survivor IS the proposal: a real media canvas, not a memo.
    expect(plan?.kind).toBe("media");
    expect(plan?.shots?.length).toBeGreaterThan(0);
    // ...and there is no invented alternate. One deck was written, one deck is offered.
    expect(plan?.altShots).toBeUndefined();
    // The loss is ON THE ROW, so the canvas cannot fail to mention it.
    expect(plan?.lostVariation).toMatchObject({ variation: "b", reason: "no_deck" });

    // No refusal was logged, because nothing was refused — a salvage has its own event.
    expect((await readLineage(t)).filter((r) => r.eventType === "media.deck_refused")).toHaveLength(
      0,
    );
    const salvaged = (await readLineage(t)).filter(
      (r) => r.eventType === "media.variation_salvaged",
    );
    expect(salvaged).toHaveLength(1);
    const payload = salvaged[0]?.payload as Record<string, unknown>;
    expect(payload.kept).toBe("a");
    expect(payload.lost).toBe("b");
    expect(payload.reason).toBe("no_deck");
  });

  test("BOTH variations refusing still refuses the whole proposal — nothing to salvage", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const body = [VAR_BRIEF, "## VARIATION A", "", "Prose.", "## VARIATION B", "", "Prose."].join(
      "\n",
    );
    await t.action(
      internal.dispatch.__runSpecialistWithScript,
      mediaArgs(planId, { primary: [{ ...textStep(body), usage: SPEND_8_CENTS }] }),
    );
    const plan = await readPlan(t, planId);
    expect(plan?.kind).not.toBe("media");
    expect(plan?.shots).toBeUndefined();
    expect(plan?.body).toContain("no_deck");
    expect((await readLineage(t)).filter((r) => r.eventType === "media.deck_refused")).toHaveLength(
      1,
    );
  });

  test("a single-deck revision DISCARDS the parked alternate and still lands brief + citations", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    // A previous two-deck proposal parked an alternate (and an old lock, from a generated deck
    // this revision replaces). The revision is a plain single-deck body.
    await t.run(async (ctx) =>
      ctx.db.patch(planId, {
        altShots: [
          {
            index: 0,
            visual: "text_card",
            seconds: 15,
            windowStartMs: 0,
            description: "stale alternate",
            overlay: "OLD",
            prompt: "p",
            narration: "old line",
          },
        ],
        altTargetDurationSeconds: 15,
        deckLockedAt: 123,
      }),
    );
    const singleBody = [VAR_BRIEF, VAR_A_DECK].join("\n");
    await t.action(
      internal.dispatch.__runSpecialistWithScript,
      mediaArgs(planId, { primary: [{ ...textStep(singleBody), usage: SPEND_8_CENTS }] }),
    );

    const plan = await readPlan(t, planId);
    expect(plan?.kind).toBe("media");
    expect(plan?.shots).toHaveLength(2);
    // The alternate is stale by definition — a post-pick revision replaces the picked deck.
    expect(plan?.altShots).toBeUndefined();
    expect(plan?.altTargetDurationSeconds).toBeUndefined();
    // A NEW proposal is a new choice: the old deck's lock does not survive it.
    expect(plan?.deckLockedAt).toBeUndefined();
    expect(plan?.brief?.topic).toBe("Inbox triage, and what it costs a founder");
    expect(plan?.shots?.[0]?.source?.docId).toBe("k57abc123");
    expect(plan?.shots?.[1]?.needsConfirmation).toBe(true);
    expect(plan?.deckProposedAt).toBeTypeOf("number");
  });

  test("the persist validator ACCEPTS source/needsConfirmation and REJECTS confirmedAt — the second door", async () => {
    const { t } = await setup();
    const planId = await stagedMediaPlan(t);
    const shot = {
      index: 0,
      visual: "generated_video",
      seconds: 8,
      windowStartMs: 0,
      description: "d",
      prompt: "p",
      narration: "n",
      source: { docId: "k57abc123", title: "t" },
      needsConfirmation: true,
    };
    // A confirmation is a tenant mutation's word ONLY. The validator has no `confirmedAt` member,
    // so parsed model content STRUCTURALLY cannot carry one into the row.
    await expect(
      t.mutation(internal.plans.persistDeck, {
        tenantId: TENANT,
        planId,
        script: "s",
        artDirection: null,
        clipSeconds: 8,
        targetDurationSeconds: 8,
        shots: [{ ...shot, confirmedAt: 1 } as typeof shot],
      }),
    ).rejects.toThrow(/confirmedAt/);

    // …while the citation fields themselves are accepted, verbatim.
    await t.mutation(internal.plans.persistDeck, {
      tenantId: TENANT,
      planId,
      script: "s",
      artDirection: null,
      clipSeconds: 8,
      targetDurationSeconds: 8,
      shots: [shot],
    });
    const plan = await readPlan(t, planId);
    expect(plan?.shots?.[0]?.source).toEqual({ docId: "k57abc123", title: "t" });
    expect(plan?.shots?.[0]?.needsConfirmation).toBe(true);
    expect(plan?.shots?.[0]?.confirmedAt).toBeUndefined();
  });
});
