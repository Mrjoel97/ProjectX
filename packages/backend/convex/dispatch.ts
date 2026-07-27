"use node";

// Lane A's exclusive property after Wave 0. The governed sub-agent dispatcher (DISP-01):
// depth cap, cycle refusal, shared root-request envelope, refs-only lineage. It calls the ONE
// loop — there is no `generateText` in this file, ever (dispatchGuard.test.ts asserts it).
//
// "use node": `runSpecialistTurn` lives in the `"use node"` llm.ts (it pulls in `ai` +
// `@ai-sdk/openai` + node:crypto), and a Convex-runtime module cannot import a node one. This
// file holds ONLY internalActions, which is what a node module is allowed to hold. Every
// exported handler carries an EXPLICIT return type — an inferred one resolves through
// `internal` → api.d.ts → back here, and TypeScript silently degrades the WHOLE generated API
// to `any` (13-01 shipped 90 apps/web errors that way).
//
// Nothing here is a second mechanism: the loop is llm.runSpecialistTurn, the budget rail is
// guardrails.dailySpendCents, the lineage is the insert-only audit table's by_correlation index,
// and the progress indicator is the CKPT-05 agentSteps trace.
import {
  PRESET_SKILL,
  resolveSpecialist,
  SPECIALIST_ROUTES,
  SPECIALISTS,
  tierBriefing,
  wouldCycle,
} from "@pikar/core";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { runSpecialistTurn } from "./llm";

/** Depth 1 = executive → specialist. A specialist can never dispatch anything, which makes
 *  "no agents spawning agents" literal and cycles structurally impossible. Cycle refusal still
 *  ships (SC #2 names it) so the guarantee is already there and already tested the day this
 *  rises — raising it later is a one-constant change, because `ancestry` already travels. */
const MAX_DEPTH = 1;

/** One sub-agent tree may draw down at most this share of what is left of the day. Not a magic
 *  constant on its own — it is a FRACTION of the live rail, so a nearly-drained day yields a
 *  small envelope and a fresh day a large one.
 *  ponytail: `dailySpendCents` is a KEYLESS window (guardrails.ts:23-28), so this is the
 *  DEPLOYMENT's remaining budget, not the tenant's — matching the "fixed constants for the
 *  single-owner beta; per-tenant policy is the upgrade path" comment already at guardrails.ts:19-20.
 *  Upgrade path: key the limit by tenantId; not required by any Phase-15 success criterion. */
const ENVELOPE_FRACTION = 0.25;

// ── The four refusal replies ──────────────────────────────────────────────────────────────────
//
// Every governed stop RETURNS a discriminated result with a calm conversational sentence and
// writes NO deadLetters row (the PAUSED_REPLY precedent, llm.ts:1588 + guardrails.ts:1-5): a
// governed stop is a paused conversation, not a system failure, and the cockpit has never DLQ'd a
// user-facing turn. These are driver-plane synthetic strings, NOT agent prompts, so §5 does not
// apply (the RESOLUTION_CONTINUE precedent, cockpit.ts:169-172). None of them names an internal
// reason code to the user.
const UNKNOWN_ROUTE_REPLY =
  "I don't have a specialist for that, so I've left the next step as a written plan instead.";
const DEPTH_EXCEEDED_REPLY =
  "I keep this to a single hand-off, so I've written the next step up myself rather than passing it on again.";
const CYCLE_REFUSED_REPLY =
  "We've already been round that one on this request, so I've written the next step up instead of repeating it.";
const BUDGET_EXHAUSTED_REPLY =
  "This request has used up the budget I set aside for it. Here's where things stand — ask me to carry on and I'll pick it back up.";

// ── The prompt the specialist receives ────────────────────────────────────────────────────────
//
// Built from the PERSISTED evaluation snapshot (internal.evaluations.lastForThread), which is why
// the specialist needs no `evaluateBusiness` tool: that tool WRITES (it persists an evaluations
// row + an audit row per call and re-enters the diagnostic engine mid-dispatch), so it is
// deliberately absent from the code-owned grant (ADR-007). Driver-plane synthetic string, not a
// skill — §5 does not apply; the system prompt is still the registry row runSpecialistTurn loads.
const TASK_LINE =
  "Work only from the grounded facts above. Produce the concrete next step for that one " +
  "constraint. Say plainly where the data is thin — never invent a figure.";
const NO_SNAPSHOT = "There is no evaluation on file for this conversation yet.";
/** Cap the injected snapshot the way evaluateBusiness caps its synopsis: a large evaluation
 *  must not blow the specialist's context (and the loop's cost) on carried prose. */
const MAX_FINDINGS = 8;
const MAX_LABEL_CHARS = 160;
/** The research QUESTION originates from the MODEL, so this cap is a trust-boundary control, not
 *  cosmetics (§8: never lazy about input validation at a trust boundary). Truncate rather than
 *  reject — a long question is a verbose model, not an attack, and refusing it would cost the user
 *  their run. */
const MAX_QUESTION_CHARS = 500;
const cap = (s: string, limit = MAX_LABEL_CHARS): string =>
  s.length > limit ? `${s.slice(0, limit)}…` : s;

export type DispatchRefusal =
  | "unknown_route"
  | "depth_exceeded"
  | "cycle_refused"
  | "budget_exhausted";

export type DispatchResult =
  | {
      ok: true;
      route: string;
      body: string;
      incomplete: boolean;
      /** D11's three-way marker: WHY it stopped early. The loop's own stop reason wins over the
       *  cost condition when both are true — it is what actually stopped the run. Absent ⇒ the run
       *  finished inside every budget. */
      incompleteReason?: "cost" | "steps" | "clock";
      costUsd: number;
      /** the tree's running total AFTER this hop — thread it to the next one */
      spentCents: number;
      /** the tree's ONE ceiling (derived at the root) — thread it to the next hop UNCHANGED */
      envelopeCents: number;
      skillVersion: number;
      /** CONTENT-PLANE (§4): these feed 16-07's vault document. `sources` may NEVER reach an
       *  `audit`/`telemetry` payload — those carry `sourceCount` and `retrievedAt` (a number). */
      sources: readonly { url: string; title: string }[];
      retrievedAt: number;
      /** 16-07: the vault document the findings landed in. Present ONLY on a research run whose
       *  persist succeeded — absent on the gap path (which persists nothing here) and absent when
       *  the persist failed, which costs groundability and not the findings: the plan card landed
       *  before the persist ran and already carries them. */
      vaultDocId?: string;
      /** The models that actually BILLED this hop. On the return because a dispatch exposes no
       *  other observable of the route's model pin, and 16-05's research ternary has to be
       *  assertable on the value that priced the run rather than on source text. */
      modelId: string;
      fallbackModelId: string;
    }
  | { ok: false; reason: DispatchRefusal; reply: string };

/** ADR-008: lineage + limit state travels as validator-checked call args, never as DB state. */
type DispatchArgs = {
  tenantId: string;
  threadId: string;
  planId: Id<"plans">;
  gapIndex: number;
  route: string;
  rootRequestId: string;
  parentAgentId: string;
  depth: number;
  ancestry: readonly string[];
  envelopeCents: number;
  spentCents: number;
  /** 16-06: the executive's research question. Present ⇒ buildSpecialistPrompt takes the question
   *  branch instead of the evaluation snapshot. */
  question?: string;
};

/** The Convex validators for the above — shared by BOTH entry points so neither can drift. */
const dispatchArgs = {
  tenantId: v.string(),
  threadId: v.string(),
  planId: v.id("plans"),
  gapIndex: v.number(),
  // v.string(), not a union: `gaps[].route` persists as v.string() (schema.ts:350) including
  // diagnose()'s deliberate "", so the RUNTIME resolveSpecialist branch is the real guard.
  route: v.string(),
  rootRequestId: v.string(),
  parentAgentId: v.string(),
  depth: v.number(),
  ancestry: v.array(v.string()),
  envelopeCents: v.number(),
  spentCents: v.number(),
  question: v.optional(v.string()),
};

/** Compile-time bind: every registered specialist's `stepTool` is a real agentSteps.tool literal.
 *  A registration naming a step tool the schema does not have would otherwise throw INSIDE an SDK
 *  callback, which the SDK swallows — a blank activity card in prod with every test green. */
const _stepTools: readonly Doc<"agentSteps">["tool"][] = SPECIALIST_ROUTES.map(
  (r) => SPECIALISTS[r].stepTool,
);

/** The ONE loop, injected. Production closes it over llm.runSpecialistTurn; the offline twin
 *  closes it over the same function with a mock script. Both share every guard below. */
type SpecialistRunner = (a: {
  skillName: string;
  toolNames: readonly string[];
  prompt: string;
  turnId: string;
  threadId: string;
  // The FULL loop return, derived rather than re-listed: `runSpecialistTurn` is the only
  // implementation, so a hand-copied shape here would just be something to drift.
}) => Promise<Awaited<ReturnType<typeof runSpecialistTurn>>>;

type Ctx = GenericActionCtx<DataModel>;

/**
 * Exported ONLY so `dispatch.test.ts` can assert the tier briefing it assembles (SC#5a) — driving
 * it through `__runSpecialistWithScript` would not work, because the mock model swallows the prompt
 * and the assertion would be about nothing. In production this is still called from exactly ONE
 * place: `governedDispatch`, below.
 */
export async function buildSpecialistPrompt(
  ctx: Ctx,
  a: {
    tenantId: string;
    threadId: string;
    gapIndex: number;
    route: string;
    /** 16-06: the executive's research QUESTION. Present ⇒ the question IS the task and the
     *  evaluation snapshot is not read at all — a research dispatch may run on a thread that has
     *  no evaluation. Absent ⇒ the shipped gap-briefing path, byte-identical. */
    question?: string;
  },
): Promise<string> {
  // The tier reaches the loop as prompt context assembled by the CALLER (ADR-009) — never as a read
  // inside `runSpecialistTurn`. `llm.ts` is byte-unchanged by this plan, deliberately.
  const tp = await ctx.runQuery(internal.tenantProfile.forTenant, { tenantId: a.tenantId });
  let styleDirective: string | undefined;
  if (tp?.behaviorPreset) {
    try {
      styleDirective = (
        await ctx.runQuery(internal.skills.getActiveSkill, {
          name: PRESET_SKILL[tp.behaviorPreset],
        })
      ).body;
    } catch {
      // Fail OPEN, on purpose. §5's fail-CLOSED rule guards the SYSTEM prompt — the specialist's
      // own body, loaded in runSpecialistTurn, which still throws NO_ACTIVE_SKILL and must keep
      // doing so. This is an ADDITIVE overlay on the user-turn prompt: losing it degrades VOICE,
      // not governance, and a tenant must not lose their dispatch because a style row is unseeded.
    }
  }
  const briefing = tierBriefing({
    tier: tp?.tier,
    agentName: tp?.agentName,
    styleDirective,
  });
  /** Both return paths carry the briefing: a tenant with no evaluation snapshot still has a tier. */
  const withBriefing = (rest: string): string => (briefing ? `${briefing}\n\n${rest}` : rest);

  // The QUESTION branch (16-06). §5 stays intact: the question is the PROMPT, the research skill
  // body is the SYSTEM prompt (loaded in runSpecialistTurn) — a model-supplied string is never
  // concatenated ahead of a system prompt. The tier briefing still rides it: a research turn is
  // still a tenant's turn (ADR-009).
  // ponytail: an `if`, not a per-route prompt-builder table. There are exactly TWO prompt shapes
  // and a table keyed on route for two entries is the abstraction §8 forbids. Upgrade path: at a
  // THIRD shape, a `Record<route, builder>` table.
  if (a.question !== undefined) return withBriefing(cap(a.question, MAX_QUESTION_CHARS));

  const evaluation = await ctx.runQuery(internal.evaluations.lastForThread, {
    tenantId: a.tenantId,
    threadId: a.threadId,
  });
  if (!evaluation) return withBriefing(`${NO_SNAPSHOT}\n\n${TASK_LINE}`);

  // The gap this dispatch is FOR: by index (what the user tapped), falling back to the first gap
  // routed at this specialist — a re-ranked evaluation must not silently brief the wrong gap.
  const gap = evaluation.gaps[a.gapIndex] ?? evaluation.gaps.find((g) => g.route === a.route);
  const lines: string[] = [`Framework: ${evaluation.framework}`, `Verdict: ${evaluation.verdict}`];
  if (gap) {
    lines.push(`Binding constraint: ${cap(gap.label)}`);
    lines.push(`Playbook: ${gap.playbook}`);
    if (gap.reason) lines.push(`Why it binds first: ${cap(gap.reason)}`);
    if (gap.proofMetric) lines.push(`Proof it is fixed: ${cap(gap.proofMetric)}`);
  }
  const findings = evaluation.findings
    .slice(0, MAX_FINDINGS)
    .map((f) => `- ${cap(f.label)} [${f.citationTitle}; ${f.confidence} confidence]`);
  if (findings.length > 0) lines.push("Grounded findings:", ...findings);
  return withBriefing(`${lines.join("\n")}\n\n${TASK_LINE}`);
}

/**
 * THE governance function. Guard ORDER is load-bearing — resolve → depth → cycle → envelope →
 * run — and both Convex entry points below call THIS, so a guard cannot be true in tests and
 * absent in production.
 *
 * Lineage: three `internal.audit.log` inserts, all with `correlationId: rootRequestId`. That IS
 * the whole SC #3 mechanism — `audit.by_correlation` already exists, so the call tree
 * reconstructs with zero new tables and zero new indexes and cost attribution to the root is a
 * sum over those rows. Three deliberate NON-decisions, so a reviewer does not read them as
 * oversights:
 *   - **No new `subAgentRuns` table.** A second log plane beside an insert-only audit is exactly
 *     the anti-pattern; SC #3 only needs the tree reconstructed, which by_correlation already does.
 *   - **No telemetry mirror.** `telemetry.requestId` is `v.id("requests")` (schema.ts:493-509) and
 *     a specialist run seeds ZERO `requests` rows by design (12-05). Inventing one to obtain a
 *     telemetry row would re-enter the delivery spine — the exact property 12-05 bought.
 *   - **Nothing goes on `agentSteps`.** Its own header says it writes no log-plane row; a second,
 *     less-governed shadow log there would be a §4 regression.
 *
 * Payloads are a FLAT map of ids/counts ONLY (AuditPayload cannot represent nesting anyway).
 * NO reply, NO body, no finding text, no citation titles — a specialist's output is grounded
 * business prose and the audit log must never become a PII honeypot (CLAUDE.md §4).
 */
const lineageRefs = (a: DispatchArgs) => ({
  rootRequestId: a.rootRequestId,
  parentAgentId: a.parentAgentId,
  specialist: a.route,
  depth: a.depth,
  ancestryDepth: a.ancestry.length,
  planId: String(a.planId),
});

async function governedDispatch(
  ctx: Ctx,
  args: DispatchArgs,
  run: SpecialistRunner,
): Promise<DispatchResult> {
  const { tenantId, threadId, route, rootRequestId, depth, ancestry } = args;
  const refs = lineageRefs(args);
  const refuse = async (reason: DispatchRefusal, reply: string): Promise<DispatchResult> => {
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: rootRequestId,
      eventType: "subagent.refused",
      actor: "system",
      payload: { ...refs, reason },
    });
    return { ok: false, reason, reply };
  };

  // 1. Resolve. The RUNTIME branch is mandatory, not belt-and-braces: `gaps[].route` persists as
  //    v.string(), so rows written before the union reach here un-narrowed, including the "".
  const resolved = resolveSpecialist(route);
  if (!resolved.ok) return refuse("unknown_route", UNKNOWN_ROUTE_REPLY);

  // 2. Depth cap.
  if (depth > MAX_DEPTH) return refuse("depth_exceeded", DEPTH_EXCEEDED_REPLY);

  // 3. Cycle. Call the SHARED predicate (@pikar/core) — re-deriving `ancestry.includes` inline
  //    would let the unit-tested guarantee and the shipped one drift.
  if (wouldCycle(ancestry, resolved.route)) return refuse("cycle_refused", CYCLE_REFUSED_REPLY);

  // 4. Envelope. Derived ONLY at the root (envelopeCents === 0); a non-zero incoming value is
  //    carried through UNCHANGED, which is what makes it ONE envelope for the whole tree rather
  //    than a fresh allowance per hop. remainingDailyCents is already clamped >= 0, so a rail
  //    driven negative by recordSpend's `reserve: true` yields 0 here, never a negative ceiling.
  //    NOT guardrails.preCall: that checks `{ count: 1 }` — "is there ANY budget left", not
  //    "is there enough for this call".
  const envelopeCents =
    args.envelopeCents > 0
      ? args.envelopeCents
      : Math.floor(
          (await ctx.runQuery(internal.guardrails.remainingDailyCents, {})) * ENVELOPE_FRACTION,
        );
  if (args.spentCents >= envelopeCents) return refuse("budget_exhausted", BUDGET_EXHAUSTED_REPLY);

  // 5. Run. Mint the turn, record the step, call the ONE loop, finish the step in a `finally`.
  const prompt = await buildSpecialistPrompt(ctx, {
    tenantId,
    threadId,
    gapIndex: args.gapIndex,
    route: resolved.route,
    question: args.question,
  });
  const turnId = crypto.randomUUID(); // the evaluations.ts:174 mint-your-own-turnId precedent
  const stepKey = `dispatch:${rootRequestId}`;
  const startedAt = Date.now();

  await ctx.runMutation(internal.audit.log, {
    tenantId,
    correlationId: rootRequestId,
    eventType: "subagent.dispatched",
    actor: "system",
    payload: { ...refs, envelopeCents, spentCents: args.spentCents },
  });
  await ctx.runMutation(internal.agentSteps.record, {
    tenantId,
    threadId,
    turnId,
    stepKey,
    tool: resolved.spec.stepTool,
    startedAt,
  });

  // A started step must ALWAYS end. `finally` is the only construct that terminalizes on success,
  // on a caught throw, AND on a governed stop that returns as data (cockpit.ts:140-152).
  let phase: "done" | "error" = "error";
  try {
    const turn = await run({
      skillName: resolved.spec.skillName,
      toolNames: resolved.spec.tools,
      prompt,
      turnId,
      threadId,
    });
    // Stop AFTER the call that overran; never discard work already paid for. runAgentLoop's
    // costUsd accumulator already spans BOTH the primary attempt and the fallback retry
    // (llm.ts:1678-1680), so this needs no second accounting. The global rail is drawn down
    // independently by recordSpend inside the loop — the envelope is a TREE-LOCAL SECOND ceiling.
    const spentAfter = args.spentCents + Math.ceil(turn.costUsd * 100);
    const overCost = spentAfter >= envelopeCents;
    // Three causes, one boolean (no existing consumer changes) plus a REASON. The loop's own stop
    // reason wins over the cost condition when both are true: it is what actually stopped the run.
    const incomplete = overCost || turn.truncated;
    const incompleteReason = turn.truncatedReason ?? (overCost ? ("cost" as const) : undefined);
    phase = "done";
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: rootRequestId,
      eventType: "subagent.completed",
      actor: "system",
      payload: {
        ...refs,
        skillVersion: turn.skillVersion,
        costUsd: turn.costUsd,
        spentCents: spentAfter,
        envelopeCents,
        incomplete,
        // A COUNT (§4 clean) — the hosted-search calls this hop billed for. NEVER `sources`: an
        // array of URLs would type-check against AuditPayload, which is exactly the trap.
        webSearchCalls: turn.webSearchCalls,
      },
    });
    return {
      ok: true,
      route: resolved.route,
      body: turn.reply,
      incomplete,
      incompleteReason,
      costUsd: turn.costUsd,
      spentCents: spentAfter,
      envelopeCents,
      skillVersion: turn.skillVersion,
      sources: turn.sources,
      retrievedAt: Date.now(),
      modelId: turn.modelId,
      fallbackModelId: turn.fallbackModelId,
    };
  } finally {
    await ctx.runMutation(internal.agentSteps.finish, {
      tenantId,
      turnId,
      stepKey,
      phase,
      durationMs: Date.now() - startedAt,
      endedAt: Date.now(),
    });
  }
}

/** What `landSpecialistResult` needs to know: either the specialist PRODUCED something, or it did
 *  not and the memo falls back — never both, never neither. */
type Landing =
  | { body: string; incomplete: boolean }
  | { incomplete: boolean; fallbackReason: string };

/**
 * The dispatch, plus the ONE thing every outcome owes the user: the plan row must LEAVE
 * `collecting` (15-04). `actOnGap` parks it there with no body and schedules this; if nothing ever
 * lands, the control the user tapped silently did nothing — `PlanCard` renders only at `proposed`
 * (cards.tsx:1624), so there would be no card, no error, and no way back.
 *
 * The landing sits in a `finally` for the same reason the `agentSteps` row's does: it is the only
 * construct that runs on success, on a governed stop that RETURNS as data, and on a throw. "The
 * plan always leaves collecting" is therefore as unconditional as "a started step always ends".
 *
 * Both entry points below call THIS, never `governedDispatch` directly — the 15-03 rule that a
 * behaviour cannot be true in tests and absent in production applies to the landing too.
 */
async function dispatchAndLand(
  ctx: Ctx,
  args: DispatchArgs,
  run: SpecialistRunner,
  // 16-06, append-only 4th param. `landSpecialistResult`'s no-body branch falls back to
  // `buildMemo(evaluationRow, gap, …)` and, when neither exists, to LOST_CONTEXT_MEMO — whose text
  // says "the evaluation it was based on is no longer on file. Ask me to run the assessment again".
  // A RESEARCH run has no evaluation row and no gap, so it lands in that branch EVERY time, and
  // that sentence is simply false for it. This is the price of reusing the gap path's terminal for
  // a caller that has no gap — paid at the SEAM, once, rather than with a route conditional inside
  // the shared spine. `runSpecialist` omits it, so the gap path is byte-identical.
  fallbackBody?: string,
): Promise<DispatchResult> {
  // Pre-seeded for the throw path, which never reaches the assignment below.
  let landing: Landing = { incomplete: false, fallbackReason: "error" };
  let honestBody = fallbackBody;
  try {
    const result = await governedDispatch(ctx, args, run);
    landing = result.ok
      ? { body: result.body, incomplete: result.incomplete }
      : // A governed refusal is a paused conversation, not an error — the user still gets the
        // deterministic memo, worded honestly for THIS reason (never the code itself).
        { incomplete: false, fallbackReason: result.reason };
    // The four refusal replies are ALREADY written to be read by a user, so a caller that supplied
    // a fallback gets the specific one rather than its generic sentence.
    if (!result.ok && fallbackBody !== undefined) honestBody = result.reply;
    return result;
  } catch (err) {
    // A thrown turn is a real failure (the §5 loader fails closed by throwing, for instance), not a
    // governed stop. Audit it as a refusal with the CODE only — never `err.message`, which can
    // carry prompt or grounded prose (§4) — and do NOT dead-letter: the cockpit has never DLQ'd a
    // user-facing turn, and the `finally` below still returns the user to an approvable row.
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "subagent.refused",
      actor: "system",
      payload: { ...lineageRefs(args), reason: "error" },
    });
    // Rethrown on purpose: `DispatchResult`'s refusal union is the GOVERNED-stop contract (four
    // conversational reasons), and an unexpected throw is not one of them. Dressing it as a
    // refusal would hide a genuine bug from the only place it is visible in production — the
    // scheduled function's own failure state.
    throw err;
  } finally {
    await ctx.runMutation(internal.evaluations.landSpecialistResult, {
      tenantId: args.tenantId,
      threadId: args.threadId,
      planId: args.planId,
      gapIndex: args.gapIndex,
      route: args.route,
      fallbackBody: honestBody,
      ...landing,
    });
  }
}

/**
 * PRODUCTION entry point. `internalAction`, so the model can never supply the lineage or the
 * limits (the runCockpitAgent.skillVersions precedent, llm.ts:1935-1938) — ADR-008.
 */
export const runSpecialist = internalAction({
  args: dispatchArgs,
  handler: async (ctx, args): Promise<DispatchResult> =>
    dispatchAndLand(ctx, args, (a) =>
      runSpecialistTurn(ctx, { tenantId: args.tenantId, planId: args.planId, ...a }),
    ),
});

/** The honest one sentence a FAILED research run lands as its memo body. It replaces
 *  LOST_CONTEXT_MEMO's "the evaluation it was based on is no longer on file", which is false for a
 *  run that was never based on an evaluation — a user told to re-run an assessment they never
 *  started has been given a dead end wearing an explanation's clothes. Driver-plane synthetic
 *  string, not a skill (§5 n/a — the four refusal replies above are the precedent). */
const RESEARCH_FAILED_MEMO =
  "# Research\n\nI couldn't finish that piece of research — the run stopped before it produced" +
  " anything. Ask me to look into it again and I'll start it over.";

/**
 * 16-07's findings terminal (ACTN-03), bolted onto a research dispatch AFTER `dispatchAndLand` has
 * returned. The ordering is the whole error-handling argument and it is structural, not incidental:
 * `dispatchAndLand` lands the memo plan card in its `finally`, so by the time this runs the user
 * already has the findings on an approvable card. A persist failure therefore degrades to a
 * narrower, truthful statement — *the findings are on the card but are not yet groundable* — which
 * is why it is audited and swallowed. NO retry, NO dead-letter, NO compensating write: the cockpit
 * has never DLQ'd a user-facing turn.
 *
 * Deliberately NOT inside `governedDispatch` (that would put a route conditional in the shared
 * spine) and NOT inside `landSpecialistResult` (that would thread `sources`/`retrievedAt` through a
 * mutation with no business knowing about them).
 *
 * It is a MUTATION called from an ACTION: actions cannot write, and each `runMutation` commits
 * immediately — which is what pushes the new document to live `useQuery` subscribers while the
 * action is still running.
 */
async function persistResearchFindings(
  ctx: Ctx,
  args: DispatchArgs,
  res: DispatchResult,
): Promise<DispatchResult> {
  // SUCCESS PATH ONLY. A governed refusal is a paused conversation, not a finding — it writes no
  // vault document at all (its reply is already on the card via `fallbackBody`).
  if (!res.ok) return res;
  try {
    const vaultDocId = await ctx.runMutation(internal.research.persistFindings, {
      tenantId: args.tenantId,
      question: args.question ?? "",
      body: res.body,
      // Copied to a mutable array: `sources` is readonly on the result, and a validator arg is not.
      sources: res.sources.map((s) => ({ url: s.url, title: s.title })),
      retrievedAt: res.retrievedAt,
      rootRequestId: args.rootRequestId,
      incomplete: res.incomplete,
      incompleteReason: res.incompleteReason,
    });
    return { ...res, vaultDocId };
  } catch {
    // ONE audit row with the reason CODE — never `err.message`, which can carry prompt or grounded
    // prose (§4). The result is returned UNCHANGED, so the run itself still succeeded.
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "research.persist_failed",
      actor: "system",
      payload: { ...lineageRefs(args), reason: "persist_error" },
    });
    return res;
  }
}

/**
 * D9-REVISED's scheduled entry point (DISP-02). Calls `dispatchAndLand` — the SAME landing path
 * `runSpecialist` uses — so the memo plan card is guaranteed to leave `collecting` on every
 * outcome, including a throw. It is NOT a second spine: the only differences from `runSpecialist`
 * are the honest fallback body and, from 16-07, the vault persist bolted on after a success.
 * Explicit return type (`dispatch.ts` is "use node" — an inferred one degrades the generated API).
 */
export const runResearch = internalAction({
  args: dispatchArgs,
  handler: async (ctx, args): Promise<DispatchResult> =>
    persistResearchFindings(
      ctx,
      args,
      await dispatchAndLand(
        ctx,
        args,
        (a) => runSpecialistTurn(ctx, { tenantId: args.tenantId, planId: args.planId, ...a }),
        RESEARCH_FAILED_MEMO,
      ),
    ),
});

/**
 * The OFFLINE twin (the __runCockpitAgentWithScript precedent, llm.ts:2116). A LanguageModel is
 * not Convex-serializable, so the mock is built inside runSpecialistTurn from a script. It calls
 * the SAME governedDispatch — test-support surface, never a second code path.
 */
export const __runSpecialistWithScript = internalAction({
  args: {
    ...dispatchArgs,
    primary: v.array(v.any()),
    fallback: v.optional(v.array(v.any())),
    // D11's wall-clock row, and the ONLY way it is testable offline. Drives the SOFT stop ONLY —
    // never the hard budget. A test that shrank `AbortSignal.timeout` instead would have the abort
    // RACE the mock loop and throw ConvexError({kind:"agent_timeout"}) (llm.ts), i.e. produce the
    // exact discard-the-work outcome this row exists to disprove. Do not add a `timeoutMs` sibling.
    softCutoffMs: v.optional(v.number()),
    // 16-07: drive `runResearch`'s SEAM — the honest fallback body and the findings terminal — under
    // a scripted model. A LanguageModel is not Convex-serializable, so `runResearch` itself can
    // never be driven offline (16-06 deviation 4); without this flag the vault persist would be
    // wiring no test can reach, and "one web_research document per successful research run" would
    // be an assertion about `persistFindings` alone rather than about the dispatch. Absent ⇒ the gap
    // path, byte-identical. The `softCutoffMs` precedent, same reason.
    research: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const res = await dispatchAndLand(
      ctx,
      args,
      (a) =>
        runSpecialistTurn(ctx, {
          tenantId: args.tenantId,
          planId: args.planId,
          ...a,
          mockScript: {
            primary: args.primary,
            fallback: args.fallback,
            softCutoffMs: args.softCutoffMs,
          },
        }),
      args.research === true ? RESEARCH_FAILED_MEMO : undefined,
    );
    return args.research === true ? persistResearchFindings(ctx, args, res) : res;
  },
});
