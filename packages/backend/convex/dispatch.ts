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
  RESEARCH_STALE_AFTER_MS,
  resolveSpecialist,
  SPECIALIST_ROUTES,
  SPECIALISTS,
  tierBriefing,
  wouldCycle,
} from "@pikar/core";
import {
  type BriefFields,
  type DeckContract,
  deckRefusalClause,
  narrationChars,
  type ParsedDeck,
  type ParsedSceneDeck,
  type ParsedVariations,
  parseArtDirection,
  parseBlockDeck,
  parseBrief,
  parseSceneDeck,
  parseScript,
  parseVariations,
  type Scene,
  sceneNarrationChars,
  TARGET_DURATIONS,
} from "@pikar/core/storyboard";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  DISPATCH_ARGS,
  ENVELOPE_FRACTION,
  MEDIA_FAILED_MEMO,
  RESEARCH_FAILED_MEMO,
} from "./lib/dispatchShared";
import { traced } from "./lib/foglamp";
import { contentHash } from "./lib/hash";
import { runSpecialistTurn } from "./llm";

/** Depth 1 = executive → specialist. A specialist can never dispatch anything, which makes
 *  "no agents spawning agents" literal and cycles structurally impossible. Cycle refusal still
 *  ships (SC #2 names it) so the guarantee is already there and already tested the day this
 *  rises — raising it later is a one-constant change, because `ancestry` already travels. */
const MAX_DEPTH = 1;

/** `ENVELOPE_FRACTION` moved to `lib/dispatchShared.ts` in 42-03 (ADR-038) and is imported above.
 *  The fan-out mint site derives the ROOT envelope with the same fraction this function uses, and a
 *  second copy is how the divided envelope and the envelope it was divided from drift apart. The
 *  derivation below is otherwise byte-identical and must stay that way — ADR-037 Decision 6 and
 *  ADR-038 Decision 5 both require `governedDispatch` to be untouched. */

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
// "Work ONLY from the grounded facts above" used to be the first clause, and it CONTRADICTED every
// specialist body it is concatenated with — all three open with "Before you assert anything about
// this business, search the vault" (offer-architect.md / money-model-designer.md / lead-engine.md).
// A driver-plane string must not countermand the §5 registry row it wraps. It still forbids the
// only thing it ever meant to forbid — inventing what neither source states.
// SEQUENCED, not merely permissive: across both paid runs 0 of 4 gap dispatches called
// `searchVault` at all, so "work from … what searchVault returns" was read as an option rather
// than a first step and every memo landed `evalgrd:false`. Says WHEN to search; deliberately does
// NOT re-teach "cite the document title" — the three v2 specialist bodies own that (§5), and
// duplicating registry teaching into a code-owned string is the second mechanism this repo forbids.
const TASK_LINE =
  "Search the vault first, then work from what it returns plus the grounded facts above — those " +
  "two are your only sources. Produce the concrete next step for that one constraint. Say plainly " +
  "where the data is thin — never invent a figure.";
const NO_SNAPSHOT = "There is no evaluation on file for this conversation yet.";

/** The legal reel lengths, from the SAME constant the parser validates against, so this sentence
 *  can never name a set `parseSceneDeck` would refuse. The `adjustmentNotes` idiom. */
const LEGAL_DURATIONS = TARGET_DURATIONS.join(", ").replace(/, (\d+)$/, " or $1");
/** What a brief that names no length gets. A member of `TARGET_DURATIONS` BY CONSTRUCTION rather
 *  than by a literal that could drift out of the set — and it is the length every deck ever
 *  persisted in production actually used. */
const DEFAULT_TARGET_DURATION = TARGET_DURATIONS[1];

/**
 * THE MEDIA TASK LINE — the third prompt shape the question branch's `ponytail:` note anticipated.
 *
 * A brief is a SUBJECT, not a task. The question branch was written for RESEARCH, where the
 * question genuinely is the task ("what do competitors charge?" needs no further instruction), and
 * `runMedia` reused it — so a media specialist's whole user turn was the executive's free-text
 * brief and nothing else. The 20k-character registry body teaches the FORMAT; only a user turn can
 * say DO IT NOW, and no user turn ever did.
 *
 * Measured in production 2026-08-18, which is why this exists rather than being a tidier prompt:
 * the identical brief ("Create a short video ad for my business.") produced a 5-shot deck on one
 * run and 1,270 characters of prose with ZERO deck tokens on another — same skill version 5, same
 * body hash, `incomplete: false` both times. That is what "no task line" looks like from outside:
 * a coin flip. It also explains two symptoms nobody had connected to it — `bad_target_duration` on
 * a 6,331-character deck that never wrote the line, and `variations: 1` on EVERY deck ever
 * persisted live, meaning the A/B contract had never once been honoured in production.
 *
 * DRIVER-PLANE, not a skill (§5 does not apply) — the same standing `TASK_LINE` has above, and for
 * the same reason: the SYSTEM prompt is still the registry row `runSpecialistTurn` loads. It must
 * not re-teach anything `media-director.md` owns (the deck's columns, the citation rule, the
 * narration budget). It says only WHEN and WHETHER — produce it now, produce both, declare the
 * length — because those are the three things a system prompt structurally cannot compel.
 *
 * Assembled from SHORT pieces: `skills.test.ts` refuses any inline string over 200 characters
 * anywhere in `convex/` (§5, no hardcoded prompts), the same reason the refusal bodies below are
 * concatenated.
 */
export const MEDIA_TASK_LINE = [
  "Write the storyboard now. Do not ask questions and do not describe what you would make —",
  "the only useful answer is the deck itself.",
  "Produce BOTH proposals in full: VARIATION A and VARIATION B, each a complete storyboard",
  "with its own SCENE DECK.",
  `Declare \`Target duration:\` on each, in seconds — ${LEGAL_DURATIONS} —`,
  `using the length the brief asks for, or ${DEFAULT_TARGET_DURATION} when it does not say.`,
].join(" ");
/**
 * 33.1-06 — CLOSE THE RETRY LOOP. When the thread's plan row carries a `proposalRefusal`, the
 * specialist is about to write the SAME brief again, and until now it was told nothing about why
 * the last one failed — so it failed the same way (9 of 17 outright refusals and 8 of 10 lost
 * variations in the audit log were one code). One line, driver-plane like `MEDIA_TASK_LINE`: the
 * clause is `deckRefusalClause`'s — the exact words the owner just read on the canvas — so the
 * model is corrected in the vocabulary the skill body already teaches, not re-taught anything.
 * Short pieces, for the §5 inline-string scan.
 */
export function mediaRetryLine(refusal: {
  reason: string;
  contract: string;
  variation?: string;
}): string {
  const contract: DeckContract = refusal.contract === "block" ? "block" : "scene";
  const where = refusal.variation ? ` — variation ${refusal.variation.toUpperCase()}` : "";
  return [
    `Your previous storyboard for this brief was refused${where}:`,
    `${deckRefusalClause(contract, refusal.reason)}.`,
    "Fix exactly that in this attempt and keep the rest of the direction.",
  ].join(" ");
}
/** Cap the injected snapshot the way evaluateBusiness caps its synopsis: a large evaluation
 *  must not blow the specialist's context (and the loop's cost) on carried prose. */
const MAX_FINDINGS = 8;
const MAX_LABEL_CHARS = 160;
/** The research QUESTION originates from the MODEL, so this cap is a trust-boundary control, not
 *  cosmetics (§8: never lazy about input validation at a trust boundary). Truncate rather than
 *  reject — a long question is a verbose model, not an attack, and refusing it would cost the user
 *  their run. */
const MAX_QUESTION_CHARS = 500;
/** 33.2 (PRD L5): how long research findings for the SAME brief on the SAME tenant are reused
 *  before `groundMediaBrief` buys them again. A day: long enough that every "Try again" and every
 *  re-ask in a fresh chat reuses, short enough that a brief revisited next week gets fresh figures. */
// Phase 39: ONE window, shared with the memo card's stamp — see RESEARCH_STALE_AFTER_MS in core.
const FINDINGS_REUSE_MS = RESEARCH_STALE_AFTER_MS;
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
      /** A COUNT (§4-clean), unlike `sources` — the hosted-search calls this hop billed for. It
       *  rides the result because 22.1's evidence verdict needs "did it search?" alongside "did it
       *  find anything?", and it was previously audited and then dropped one function short of the
       *  document that states the verdict. */
      webSearchCalls: number;
      /** 22.1b: did the specialist CALL `declareUnsupported`? A BOOLEAN (§4-clean — never the
       *  `claim` prose it was called with, which nothing in this codebase captures). It rides the
       *  result for the same reason `webSearchCalls` does: `evidenceVerdict` needs "did what you
       *  found actually SUPPORT it?" alongside "did you search?" and "did you find anything?" —
       *  and a diligent search of a nonexistent entity always returns near-misses, so the two
       *  counters alone can never reach the insufficient-evidence verdict. */
      declaredUnsupported: boolean;
      /** 42.1: the model's RAW bit, BEFORE the `sources.length === 0` conjunction that makes
       *  `declaredUnsupported` above. Instrumentation only: nothing branches on it. */
      declaredQuestionScope: boolean;
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
  /** 16-09: the eval harness's --skill pins. Without this the specialist silently ran the ACTIVE
   *  row (v1) while the evidence row claimed v2 — a pin that certifies a body that never executed. */
  skillVersions?: Record<string, number>;
  /** 21-03 (SKILL-01): the harness's EXACT tenant-candidate pins, name → `tenantSkills` row id.
   *  The same defect 16-09 fixed, one scope down: without it a `--tenant-skill <id>` run would
   *  evaluate the tenant's ACTIVE (or the global) body and then write evidence onto the candidate.
   *  Absent on the production `actOnGap` path, which must keep running the effective row. */
  tenantSkillIds?: Record<string, Id<"tenantSkills">>;
};

/** The Convex validators for the above now live in `lib/dispatchShared.ts` as `DISPATCH_ARGS`
 *  (42-02, a pure move). They had to leave this file: `dispatchRun.ts` holds the `workflow.define`
 *  that steps into these actions, a `workflow.define` is a RegisteredMutation and so cannot live in
 *  a `"use node"` module, and a non-node module cannot import this one. Re-declaring them there
 *  would have been a validator free to drift — and a drifted door is refused at RUNTIME with
 *  `ArgumentValidationError`, after the caller has already committed (the 21-03 incident).
 *  `dispatchArgs` stays as a local alias so every `args:` below reads exactly as it always did. */
const dispatchArgs = DISPATCH_ARGS;

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
  //
  // THE THIRD SHAPE ARRIVED — as a suffix, not a table. `media` shares this branch's INPUT (a
  // free-text string that replaces the snapshot) and differs only in whether that string is the
  // task or merely the subject, so one appended sentence is the whole difference. A
  // `Record<route, builder>` here would be two nearly identical builders to keep in step. Upgrade
  // path unchanged: a route needing a genuinely different SHAPE gets the table.
  //
  // The CAP is applied to the brief ALONE and the instruction appended after. Capping the joined
  // string would truncate the instruction away on exactly the long briefs that most need it —
  // `dispatch.test.ts` pins that ordering.
  if (a.question !== undefined) {
    const brief = cap(a.question, MAX_QUESTION_CHARS);
    if (a.route !== "media") return withBriefing(brief);
    // 33.1-06: a retry on this thread carries the last refusal on its plan row — say so.
    const refusal = await ctx.runQuery(internal.plans.refusalForThread, {
      tenantId: a.tenantId,
      threadId: a.threadId,
    });
    const retry = refusal ? `\n\n${mediaRetryLine(refusal)}` : "";
    return withBriefing(`${brief}\n\n${MEDIA_TASK_LINE}${retry}`);
  }

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
          (await ctx.runQuery(internal.guardrails.remainingDailyCents, { tenantId })) *
            ENVELOPE_FRACTION,
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
        // 21-03 (SKILL-01): the FULL registry attribution for this use, on the EXISTING
        // `subagent.completed` row. Deliberately not a new event type and not a new table: the
        // question "which body did this specialist actually run" is a property of the run that is
        // already logged here, and `audit.by_correlation` already reconstructs the tree.
        // REFS ONLY — scope, row id, name and a SHA-256 of the body. The body, the tenant's
        // authored adaptation and the global prompt never enter an audit payload (CLAUDE.md §4);
        // the hash is what makes "this exact body ran" checkable without storing it.
        skillScope: turn.skillScope,
        skillId: turn.skillId,
        skillName: turn.skillName,
        skillBodyHash: turn.skillBodyHash,
        costUsd: turn.costUsd,
        spentCents: spentAfter,
        envelopeCents,
        incomplete,
        // A COUNT (§4 clean) — the hosted-search calls this hop billed for. NEVER `sources`: an
        // array of URLs would type-check against AuditPayload, which is exactly the trap.
        webSearchCalls: turn.webSearchCalls,
        // 22.1b: a BOOLEAN, never the `claim` string the tool was called with (§4).
        declaredUnsupported: turn.declaredUnsupported,
        // 42.1: the RAW model bit beside the verdict-facing one, on the row the eval
        // harness already reads. `declaredUnsupported` is ANDed with `sources.length ===
        // 0` upstream, so when the two DISAGREE the specialist declared and the counter
        // overrode it. That is the measurement three body rewrites could not see.
        // ("overrode", never the one-word past tense of "over"+"rule": routines.test.ts scans
        // this namespace for ten banned tokens by case-insensitive SUBSTRING and does not strip
        // comments, and one of those tokens is a substring of that word.)
        declaredQuestionScope: turn.declaredQuestionScope,
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
      webSearchCalls: turn.webSearchCalls,
      declaredUnsupported: turn.declaredUnsupported,
      declaredQuestionScope: turn.declaredQuestionScope,
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
  | {
      body: string;
      incomplete: boolean;
      incompleteReason?: "cost" | "steps" | "clock";
      /** 25.1-05 (D11): the pages this turn retrieved, travelling with the body they support.
       *  CONTENT PLANE — they ride the landing mutation and the plan row, never a payload (§4). */
      sources?: { title: string; url: string; retrievedAt: number }[];
    }
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
      ? {
          body: result.body,
          incomplete: result.incomplete,
          ...(result.incompleteReason === undefined
            ? {}
            : { incompleteReason: result.incompleteReason }),
          // 25.1-05 (D11). Omitted rather than sent empty: the card renders its references block on
          // PRESENCE, and an empty array would be a "Sources" heading over nothing. `retrievedAt`
          // is the landing stamp the turn already computed — per-source because the shape can then
          // absorb a real per-result time later without a migration.
          ...(result.sources.length === 0
            ? {}
            : {
                sources: result.sources.map((s) => ({
                  title: s.title,
                  url: s.url,
                  retrievedAt: result.retrievedAt,
                })),
              }),
        }
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
      traced(
        {
          agentName: "growth-specialist",
          workflowName: "sub-agent-dispatch",
          workflowRunId: args.rootRequestId,
          sessionId: args.threadId,
          metadata: { route: args.route },
        },
        () =>
          runSpecialistTurn(ctx, {
            // `...a` FIRST, explicit fields last. With the spread last, a `tenantId` key present-but-
            // undefined on `a` (it is read as `a.tenantId` elsewhere in this file) silently CLOBBERS
            // the good value, and the failure surfaces far away as `guardrails:recordSpend` rejecting
            // `{costUsd: 0.0021}` for a missing tenantId — mid-dispatch, after the model was billed.
            ...a,
            tenantId: args.tenantId,
            planId: args.planId,
            skillVersions: args.skillVersions,
            tenantSkillIds: args.tenantSkillIds,
          }),
      ),
    ),
});

/** `RESEARCH_FAILED_MEMO` and `MEDIA_FAILED_MEMO` moved to `lib/dispatchShared.ts` in 42-02 and are
 *  imported at the top of this file. The durable runner's `onComplete` terminal has to land the
 *  SAME sentence this file's own `finally` lands, and two copies of an honest fallback body is
 *  exactly how one of them stops being honest. */

/**
 * What a media run lands when it produced PROSE but no usable deck. One sentence per lever, so the
 * user is told which knob to turn — never a bare "parse failed", and never an empty canvas.
 *
 * `narration_too_long` / `narration_too_short` carry the block and the character count. That is a
 * REF and a COUNT (§4), not content: the narration text itself never leaves the plan row.
 */
function deckRefusalBody(bad: Extract<ParsedDeck, { ok: false }>): string {
  const where =
    "blockIndex" in bad ? ` Block ${bad.blockIndex + 1} is ${bad.chars} characters.` : "";
  // Assembled from SHORT pieces rather than one template literal: `skills.test.ts` refuses any
  // inline string over 200 characters anywhere in `convex/` (§5, no hardcoded prompts), and a
  // single-literal version of this sentence is 206. The sibling driver-plane strings above are
  // concatenated for the same reason.
  const lede = "# Reel\n\nI drafted this, but I couldn't turn it into a usable deck";
  const tail = " Ask me to redo the block deck and I'll keep the direction below.";
  return `${lede} — ${deckRefusalClause("block", bad.reason)}.${where}${tail}\n\n_Reason: ${bad.reason}._`;
}

/** The SCENE contract's twin (20.2). A separate function rather than an extra branch in the one
 *  above: the two refusal vocabularies share only `no_deck` and `empty_deck`, and threading two
 *  unions through one `why` table is how a reason ends up rendering the wrong sentence — which is
 *  why `deckRefusalClause` (33-13, `@pikar/core`) takes the CONTRACT from the caller that knows it. */
function sceneRefusalBody(bad: Extract<ParsedSceneDeck, { ok: false }>): string {
  const where =
    "sceneIndex" in bad
      ? ` Scene ${bad.sceneIndex + 1}${"chars" in bad ? ` is ${bad.chars} characters` : ""}.`
      : "";
  // Assembled from SHORT pieces for the same reason as its sibling above: `skills.test.ts` refuses
  // any inline string over 200 characters anywhere in `convex/` (§5, no hardcoded prompts).
  const lede = "# Reel\n\nI drafted this, but I couldn't turn it into a usable deck";
  const tail = " Ask me to redo the scene deck and I'll keep the direction below.";
  return `${lede} — ${deckRefusalClause("scene", bad.reason)}.${where}${tail}\n\n_Reason: ${bad.reason}._`;
}

/** 33-03: a refusing VARIATION refuses the WHOLE proposal — this card says which one and why, in
 *  the same vocabulary as the single-deck card. Never a silent one-deck fallback. */
function variationRefusalBody(bad: Extract<ParsedVariations, { kind: "refused" }>): string {
  const lede = "# Reel\n\nI drafted two variations, but variation ";
  const tail = " Ask me to redo the variations and I'll keep the direction below.";
  const cause = deckRefusalClause("scene", bad.reason);
  return `${lede}${bad.variation.toUpperCase()} couldn't become a usable deck — ${cause}.${tail}\n\n_Reason: ${bad.reason}._`;
}

/**
 * Why a deck refusal happened, as COUNTS — §4 holds: never the body, never a line of it, never a
 * narration cell. Only how long the answer was and how many times each structural token appeared.
 *
 * `no_deck` has TWO causes that were indistinguishable after the fact, and the difference is the
 * whole diagnosis: the specialist wrote no deck at all, or it wrote one under a heading the parser
 * did not recognise. The raw body is never persisted on this path — `landStoryboardRefusal` stores
 * the COMPOSED refusal, not the model's prose — so every `no_deck` was unexplainable once the run
 * was over. That is what left the owner's 2026-08-17 failure a coin-flip between two very different
 * bugs. A NON-ZERO token count beside `reason: "no_deck"` now says it plainly: the deck was there
 * and the heading is what failed.
 *
 * Narrowed 2026-08-17: `no_deck` no longer also means "the heading was there and the TABLE could
 * not be read" — that is `unreadable_deck` now, with its own sentence. So `no_deck` beside a
 * non-zero `sceneDeckTokens` is a much sharper signal than it was: the token is in the body and
 * `headingAt` still did not match it.
 *
 * `bad_target_duration` has the SAME two-cause problem, and the first fix missed it: the specialist
 * never declared a target, or it declared one this file could not read. `targetDurationTokens`
 * separates them — non-zero means the line was written and the VALUE or its decoration is what
 * failed, zero means no target was declared at all. It was added after the 2026-08-17 reel refused
 * twice with `bad_target_duration` and the audit row could not say which.
 *
 * Exported ONLY so `dispatch.test.ts` can prove the claim rather than trust the name: every value
 * it returns is a finite number, and no value is a substring of the body it was given.
 *
 * ALWAYS call it into a `const` and spread THAT — never inline into a payload literal. The §4 scan
 * in `llmRedaction.test.ts` forbids the token `body` inside a payload literal on purpose, and that
 * rule is worth keeping sharp: the guarantee here comes from this function's return type, and the
 * scan stays able to catch the next person who reaches for `res.body` directly.
 */
export const deckTokenCounts = (body: string) => ({
  bodyChars: body.length,
  sceneDeckTokens: (body.match(/SCENE DECK/gi) ?? []).length,
  blockDeckTokens: (body.match(/BLOCK DECK/gi) ?? []).length,
  variationTokens: (body.match(/VARIATION [AB]\b/gi) ?? []).length,
  targetDurationTokens: (body.match(/Target duration/gi) ?? []).length,
});

/**
 * The storyboard terminal (MEDIA-01), bolted onto a media dispatch AFTER `dispatchAndLand` has
 * returned — `persistResearchFindings`' ordering argument verbatim: the memo card is already landed
 * by the time this runs, so the user has the specialist's prose whatever happens here.
 *
 * It writes through `ctx.db.patch` on an internal mutation rather than `patchPlan`, and that is
 * deliberate: `patchPlan` has NO deck args and NO render args, and **that absence is the guarantee**
 * (20-02, the `calendarEventId`/`calendarRunId` rule). Nothing reachable from the MODEL may write a
 * block prompt or a narration line that later becomes a paid generation.
 *
 * **It NEVER writes `shots: []`.** An empty deck that says `kind: "media"` is an empty canvas
 * wearing a successful proposal's clothes — the user approves it, the reservation prices zero
 * blocks, and nothing ever explains why. A body that does not parse lands as a MEMO with the lever
 * named instead.
 */
/**
 * The SCENE arm of the storyboard terminal (20.2).
 *
 * Structurally identical to the block arm below — same refusal-lands-as-a-memo shape, same
 * refs-and-counts-only audit, same never-writes-an-empty-deck rule — because those properties are
 * the terminal's, not the contract's. What differs is the vocabulary and the numbers worth being
 * able to reconcile later.
 *
 * `type` is deliberately NOT written, and `visual` is. See the schema comment: an absent `type`
 * makes `media.deckOf` fail closed on a scene row, where a legacy-equivalent token would let it be
 * priced at a uniform `clipSeconds` it was never written against.
 */
/** A parsed Scene[] as `persistDeck` shot elements — ONE mapping for the picked deck and the
 *  alternate, so the two arrays cannot drift field-by-field. The 33-01 citation fields ride each
 *  element; `confirmedAt` does not exist on `Scene` and the persist validator refuses it anyway. */
const sceneShots = (scenes: readonly Scene[]) =>
  scenes.map((s) => ({
    index: s.index,
    visual: s.visual,
    seconds: s.durationMs / 1000,
    windowStartMs: s.startMs,
    description: s.description,
    ...(s.overlay === undefined ? {} : { overlay: s.overlay }),
    ...(s.asset === undefined ? {} : { asset: s.asset }),
    prompt: s.prompt,
    narration: s.narration,
    ...(s.source === undefined ? {} : { source: s.source }),
    ...(s.needsConfirmation === undefined ? {} : { needsConfirmation: s.needsConfirmation }),
  }));

async function persistSceneDeck(
  ctx: Ctx,
  args: DispatchArgs,
  // The BODY, not the `DispatchResult`: the caller has already narrowed to the success arm, and
  // taking the union back here would re-widen it for no reason. Returns void — the caller owns
  // what it hands back.
  //
  // 33-03: for a two-variation proposal this is variation A's OWN slice (script/art direction
  // parse per-variation, no cross-contamination), and `extra` carries the parked alternate and
  // the brief parsed off the FULL body.
  body: string,
  scene: ParsedSceneDeck,
  extra: {
    alt?: { scenes: readonly Scene[]; targetDurationSeconds: number };
    brief?: BriefFields | null;
    /** 33-11: set ONLY on a salvaged proposal — the sibling that could not be built. */
    lost?: { variation: "a" | "b"; reason: string };
  } = {},
): Promise<void> {
  if (!scene.ok) {
    const shape = deckTokenCounts(body); // counts only — see the helper, and §4's scan
    await ctx.runMutation(internal.plans.landStoryboardRefusal, {
      tenantId: args.tenantId,
      planId: args.planId,
      body: sceneRefusalBody(scene),
      // 33-13: the CODE beside the prose, so the canvas can draw a failure card with a retry
      // instead of a memo card with Approve/Save over a reel that does not exist.
      reason: scene.reason,
      contract: "scene",
      // The raw output, on the PLAN row only — the counts below say whether a deck was written,
      // this says what was written instead. Never forwarded to the audit payload (§4).
      specialistBody: body,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "media.deck_refused",
      actor: "system",
      // Refs and COUNTS only (§4): the reason CODE, the scene INDEX, the character COUNT and the
      // seconds the rows summed to. Never the narration, never the prompt, never the body.
      payload: {
        ...lineageRefs(args),
        reason: scene.reason,
        ...("sceneIndex" in scene ? { sceneIndex: scene.sceneIndex } : {}),
        ...("chars" in scene ? { chars: scene.chars } : {}),
        ...("totalSeconds" in scene ? { totalSeconds: scene.totalSeconds } : {}),
        ...shape,
      },
    });
    return;
  }

  const artDirection = parseArtDirection(body);
  await ctx.runMutation(internal.plans.persistDeck, {
    tenantId: args.tenantId,
    planId: args.planId,
    script: parseScript(body),
    artDirection,
    targetDurationSeconds: scene.targetDurationSeconds,
    // `clipSeconds` is a REQUIRED arg and a scene deck has no single one. The longest scene is
    // written, never an average or a first-row value: every consumer that still reads it treats it
    // as a per-block ceiling, so the longest is the only choice that cannot under-state one.
    // It is inert for scene rows — `targetDurationSeconds` is what wave 4 onward reads.
    clipSeconds: Math.max(...scene.scenes.map((s) => s.durationMs)) / 1000,
    shots: sceneShots(scene.scenes),
    // 33-03: the parked alternate — or undefined, which persistDeck CLEARS (a single-deck
    // revision replaces the picked deck; the alternate is stale by definition).
    ...(extra.alt === undefined
      ? {}
      : {
          altShots: sceneShots(extra.alt.scenes),
          altTargetDurationSeconds: extra.alt.targetDurationSeconds,
        }),
    ...(extra.brief == null ? {} : { brief: extra.brief }),
    // Undefined on every ordinary proposal, which CLEARS a previous salvage note (whole-deck-write).
    lostVariation: extra.lost,
    // 33-12: the seconds the parser moved to get the clips onto the provider's grid. Empty on a
    // deck the model got right, and undefined-on-empty so a clean proposal clears a stale note.
    deckAdjustments: scene.adjustments.length === 0 ? undefined : [...scene.adjustments],
  });
  await ctx.runMutation(internal.audit.log, {
    tenantId: args.tenantId,
    correlationId: args.rootRequestId,
    eventType: "media.deck_persisted",
    actor: "system",
    // COUNTS only, and the same three the block arm records plus the declared length — these are
    // what a later `mediaJobs` batch has to reconcile against. 33-03 adds three more counts:
    // how many decks were proposed, and the PICKED deck's cited / owner-must-confirm scenes.
    // Never a doc title, never a claim — refs and counts (§4).
    payload: {
      ...lineageRefs(args),
      blocks: scene.scenes.length,
      targetDurationSeconds: scene.targetDurationSeconds,
      narrationChars: sceneNarrationChars(scene.scenes),
      hasArtDirection: artDirection !== null,
      variations: extra.alt === undefined ? 1 : 2,
      citedScenes: scene.scenes.filter((s) => s.source !== undefined).length,
      unverifiedScenes: scene.scenes.filter((s) => s.needsConfirmation === true).length,
    },
  });
}

async function persistStoryboard(
  ctx: Ctx,
  args: DispatchArgs,
  res: DispatchResult,
): Promise<DispatchResult> {
  // SUCCESS PATH ONLY. A governed refusal is a paused conversation, not a proposal — its reply is
  // already on the card via `fallbackBody`.
  if (!res.ok) return res;

  /* 20.2 — TWO CONTRACTS, ONE TERMINAL, and the ORDER is the whole design.
   *
   * `media-director.md` teaches the SCENE deck as of 20.2 wave 8, but the BLOCK shape does not go
   * away with it: `parseSceneDeck` still accepts the legacy visual names, plans proposed before the
   * body changed are still on screen, and a registry row is a database write that can be rolled
   * back to v1 without a deploy. So both shapes arrive here, and this function must read whichever
   * it is handed rather than the one we wish it were.
   *
   * A SCENE deck wins when the body contains one. The fallback is guarded on `no_deck` ALONE —
   * "this body has no SCENE DECK heading at all" — and never on any other scene refusal. A scene
   * deck whose durations do not sum, or whose visual kind is unknown, must be REFUSED as a scene
   * deck; falling through to `parseBlockDeck` there would read its rows under the uniform contract
   * and quietly propose a reel nobody wrote.
   *
   * That sentence was TRUE OF THE INTENT AND FALSE OF THE CODE until 2026-08-17: `parseSceneDeck`
   * returned `no_deck` from THREE places — heading absent, no table header row, and a missing
   * required column — and only the first is "no scene deck at all". Splitting the latter two out
   * as `unreadable_deck` is what makes this guard mean what it says. If you add a new early return
   * to either parser, ask which of the two it is; a reason code read by a branch is a contract.
   *
   * 33-03 — VARIATIONS PARSE FIRST, above both contracts, and the same refusal-over-fallback rule
   * one level up: a body that DECLARED two variations and delivered a broken one refuses the whole
   * proposal — quietly landing the surviving deck would propose "the" reel when the specialist
   * wrote a choice. `kind: "one"` means no VARIATION headings at all, and the body flows into the
   * existing two-contract read byte-for-byte unchanged.
   */
  const variations = parseVariations(res.body);
  const shape = deckTokenCounts(res.body); // counts only — see the helper, and §4's scan
  if (variations.kind === "refused") {
    await ctx.runMutation(internal.plans.landStoryboardRefusal, {
      tenantId: args.tenantId,
      planId: args.planId,
      body: variationRefusalBody(variations),
      reason: variations.reason,
      contract: "scene",
      variation: variations.variation,
      specialistBody: res.body,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "media.deck_refused",
      actor: "system",
      // Refs and COUNTS only (§4): the inner reason CODE and WHICH variation carried it.
      payload: {
        ...lineageRefs(args),
        reason: variations.reason,
        variation: variations.variation,
        ...shape,
      },
    });
    return res;
  }
  if (variations.kind === "salvaged") {
    // 33-11: one deck parsed, the other did not. Propose the survivor ALONE rather than throwing
    // away a storyboard the model really wrote — the failure the owner hit twice on 2026-08-16,
    // where a good deck died because its sibling carried an off-grid clip length.
    //
    // NO `alt`: there is no second deck, and inventing one is the thing `persistStoryboard` has
    // always refused. `lostVariation` is what stops this being the SILENT fallback 33-01 banned.
    await persistSceneDeck(ctx, args, variations.kept.body, variations.kept.deck, {
      brief: parseBrief(res.body),
      lost: { variation: variations.lostVariation, reason: variations.reason },
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "media.variation_salvaged",
      actor: "system",
      // Refs and CODES only (§4): which deck was kept, which was lost, and the lost one's reason.
      payload: {
        ...lineageRefs(args),
        kept: variations.keptVariation,
        lost: variations.lostVariation,
        reason: variations.reason,
      },
    });
    return res;
  }
  if (variations.kind === "two") {
    // Deck A is the picked deck, deck B the parked alternate. Script and art direction come off
    // A's OWN slice (no cross-contamination); the BRIEF sits above the headings, so it parses off
    // the full body.
    await persistSceneDeck(ctx, args, variations.a.body, variations.a.deck, {
      brief: parseBrief(res.body),
      alt: {
        scenes: variations.b.deck.scenes,
        targetDurationSeconds: variations.b.deck.targetDurationSeconds,
      },
    });
    return res;
  }

  const scene = parseSceneDeck(res.body);
  // `no_deck` NOW MEANS WHAT THIS GUARD ALWAYS CLAIMED IT MEANT: the SCENE DECK heading is absent.
  // Until 2026-08-17 the same code also came back when the heading WAS there and only its table
  // could not be read (no header row, or a renamed required column). Those bodies fell through to
  // `parseBlockDeck`, which found no BLOCK DECK heading either, and the owner was told "it never
  // wrote a block deck" about a scene deck sitting fully written in the response. They are
  // `unreadable_deck` now and REFUSE here, as every other non-`no_deck` scene refusal already did.
  if (scene.ok || scene.reason !== "no_deck") {
    await persistSceneDeck(ctx, args, res.body, scene, { brief: parseBrief(res.body) });
    return res;
  }

  const deck = parseBlockDeck(res.body);
  if (!deck.ok) {
    await ctx.runMutation(internal.plans.landStoryboardRefusal, {
      tenantId: args.tenantId,
      planId: args.planId,
      body: deckRefusalBody(deck),
      reason: deck.reason,
      contract: "block",
      // The branch the owner hit live on 2026-08-18 — both parsers returned `no_deck` on a body
      // that was 1,270 characters of something. This is the only place that something survives.
      specialistBody: res.body,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "media.deck_refused",
      actor: "system",
      // Refs and COUNTS only (§4): the reason CODE, the block INDEX and the character COUNT. Never
      // the narration, never the prompt, never the body.
      payload: {
        ...lineageRefs(args),
        reason: deck.reason,
        ...("blockIndex" in deck ? { blockIndex: deck.blockIndex, chars: deck.chars } : {}),
        // The branch the owner hit: BOTH parsers returned `no_deck`. These counts are what say
        // whether the specialist wrote nothing or wrote a deck this file failed to recognise.
        ...shape,
      },
    });
    return res;
  }

  // `null` when the nine fields are not all there. The plan still gets its deck — an art direction
  // is how the clips LOOK, and a missing one is a worse reel, not an unusable one.
  const artDirection = parseArtDirection(res.body);
  await ctx.runMutation(internal.plans.persistDeck, {
    tenantId: args.tenantId,
    planId: args.planId,
    script: parseScript(res.body),
    artDirection,
    clipSeconds: deck.clipSeconds,
    shots: deck.blocks.map((b) => ({
      index: b.index,
      type: b.type,
      seconds: b.seconds,
      windowStartMs: b.windowStartMs,
      description: b.description,
      ...(b.overlay === undefined ? {} : { overlay: b.overlay }),
      prompt: b.prompt,
      narration: b.narration,
    })),
  });
  await ctx.runMutation(internal.audit.log, {
    tenantId: args.tenantId,
    correlationId: args.rootRequestId,
    eventType: "media.deck_persisted",
    actor: "system",
    // COUNTS only. `blocks` and `narrationChars` are what the reservation will price, so they are
    // the two numbers worth being able to reconcile against a later `mediaJobs` batch.
    payload: {
      ...lineageRefs(args),
      blocks: deck.blocks.length,
      clipSeconds: deck.clipSeconds,
      narrationChars: narrationChars(deck.blocks),
      hasArtDirection: artDirection !== null,
    },
  });
  return res;
}

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
 * spine). It is also not the only consumer of `sources` any more: 25.1-05 (D11) threads them
 * through `landSpecialistResult` as well, so the CARD can attribute its own findings without
 * waiting on this terminal — which is skipped entirely on a zero-search run and swallowed on a
 * persist failure. Same URLs, two content-plane destinations, still no audit payload (§4).
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
  // STRUCTURAL FLOOR (16-09): a run that never searched is not research, so it does not earn a
  // RETRIEVABLE artifact. `evidenceVerdict` already reads `webSearchCalls === 0` as
  // `not_researched` and `researchFindingsFence` already stamps NOT_RESEARCHED_LABEL on the stored
  // body — that labelling is deliberate and stays exactly as it is ON THE MEMO CARD, which is
  // landed by `dispatchAndLand` BEFORE this function runs. So the user still reads the findings
  // and still reads the label; nothing visible is withheld. What is withheld is the VAULT
  // DOCUMENT, and only because the vault is a RETRIEVAL surface: `vaultSearch` returns arbitrary
  // CHUNKS, and a chunk sliced out of the body carries neither the label (which sits BEFORE the
  // fence) nor the fence itself, so a never-searched model-memory answer could re-enter a model
  // context stripped of every warning and be cited by the Phase-12 engine as a grounded market
  // fact. The label contains it for a HUMAN reader of the card; only not-writing-it contains it
  // for a RETRIEVAL reader.
  //
  // Measured, not speculative: run 56bff5b8 fixture 34 declared the question unsupported having
  // made ZERO searches, and run eval-f795ede0 logged webSearchCalls of 1,1,1,0,0,4 across six
  // dispatches — the prose mandate ("every run searches the web, without exception") was violated
  // twice in six attempts, which is why this is code and not another sentence in the body.
  //
  // This does NOT force a search and cannot make a `webSearchCallsAtLeast` fixture pass — it only
  // stops the bad artifact. Forcing the first tool call is a separate, unmade decision (it would
  // edit llm.ts, which carries a zero-edit pin from 17.1-07).
  //
  // ponytail: refusal only, no retry. A re-dispatch on 0 searches would raise the search rate but
  // costs a second wall clock against DISPATCH_TIMEOUT_MS (210s) — and clock exhaustion is already
  // a live failure mode (run 56bff5b8 fixture 34 attempt 1 returned `incomplete: true`). Upgrade
  // path if the zero-search rate stays material: retry ONCE inside the existing soft-cutoff budget.
  if (res.webSearchCalls === 0) {
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "research.persist_skipped",
      actor: "system",
      // Refs and COUNTS only (§4) — never the body, never the question.
      payload: { ...lineageRefs(args), reason: "not_researched", webSearchCalls: 0 },
    });
    return res;
  }
  try {
    const vaultDocId = await ctx.runMutation(internal.research.persistFindings, {
      tenantId: args.tenantId,
      question: args.question ?? "",
      body: res.body,
      // Copied to a mutable array: `sources` is readonly on the result, and a validator arg is not.
      sources: res.sources.map((s) => ({ url: s.url, title: s.title })),
      webSearchCalls: res.webSearchCalls,
      declaredUnsupported: res.declaredUnsupported,
      retrievedAt: res.retrievedAt,
      // 26-11 (CONT-01): the THREAD and PLAN, not `rootRequestId` (which stays the correlation key).
      sourceThreadId: args.threadId,
      sourcePlanId: args.planId,
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
        (a) =>
          traced(
            {
              agentName: "research-specialist",
              workflowName: "sub-agent-dispatch",
              workflowRunId: args.rootRequestId,
              sessionId: args.threadId,
            },
            () =>
              runSpecialistTurn(ctx, {
                // `...a` FIRST — see the gap-dispatch runner above. This is the RESEARCH path, where
                // the clobber was actually observed (run 3a1e37f3, fixture 34).
                ...a,
                tenantId: args.tenantId,
                planId: args.planId,
                skillVersions: args.skillVersions,
                tenantSkillIds: args.tenantSkillIds,
              }),
          ),
        RESEARCH_FAILED_MEMO,
      ),
    ),
});

/**
 * The media route's scheduled entry point (20-08). `runResearch`'s shape verbatim — the SAME
 * `dispatchAndLand` spine, the SAME landing, a different terminal.
 *
 * **A dispatched media run spends TOKENS ONLY.** The specialist's grant is `SPECIALIST_TOOLS`
 * (`searchVault`) and there is no code path from here to a fal POST or a sandbox: no `mediaJobs`
 * row is inserted, neither media window moves, and `renderStatus` is never set. The paid calls fire
 * from `cockpit.ts`'s `EXTERNAL_TARGETS.media` after the human Approve gate, and from nowhere else.
 */
/**
 * THE GROUNDING PASS — a reel's claims come from the outside world before the deck is written.
 *
 * The media specialist is granted `searchVault` and nothing else, so a proposal was grounded
 * ONLY in the tenant's own material. For an idea-stage tenant that material is nearly empty, and
 * the body's own words for the outcome are exact: "a reel that could have been about this business
 * and is instead about businesses in general is a failed reel."
 *
 * **WHY THIS RUNS INSIDE `runMedia` RATHER THAN AS ITS OWN DISPATCH.** `plans` is `.unique()`
 * by (tenantId, threadId) — ONE row per thread — and `stageResearchPlan` RECYCLES it. Staging a
 * research card beside a media card would have research overwrite the card the reel is proposed on.
 * So this runs the specialist turn directly and writes only what has no plan row of its own: a
 * vault document, via the same `research.persistFindings` the research route uses.
 *
 * That choice is what makes the rest free. The findings land where `searchVault` already looks, as
 * an ordinary vault doc with a real id, so the deck cites them through the `[doc:...]` slot the
 * scene contract already validates and `renderReel` already ownership-checks. No new source kind,
 * no second citation path, nothing downstream learns a new word.
 *
 * **IT CAN NEVER FAIL THE REEL.** Every outcome — a refusal, a throw, a run that searched nothing —
 * returns quietly and the media turn proceeds on the vault alone. A reel grounded only in the
 * tenant's own material is worse than a researched one and far better than none; and since
 * `statesCheckableClaim` now flags an uncited figure whatever this pass did, a thin grounding pass
 * cannot let an unsourced claim through. The gate is the guarantee; this is the raw material.
 *
 * **THE MEDIA-SPECIFIC ASKS LIVE IN THIS QUESTION, NOT IN THE SKILL BODY.** `research-specialist`
 * is GATED: changing its body needs a recorded passing eval run, and its job is general-purpose
 * fact-finding for the whole cockpit. What a VIDEO needs from research — citable figures, and the
 * objections real customers actually voice — is a property of this route, so it is asked here.
 * That keeps a video concern out of a cockpit-wide skill and costs no eval cycle.
 *
 * ponytail: one research turn per proposal, on the brief as written. The ceiling is that a brief
 * naming several claims gets one pass over all of them rather than one per claim. The upgrade path
 * is decomposing the brief first — which is what the research body ALREADY does internally, so the
 * cheap version is to let it, and only revisit if findings come back thin.
 */
const MEDIA_GROUNDING_QUESTION = [
  "Find published, checkable facts a short marketing video about this could state as true:",
  "figures with their dates, third-party evidence, and named sources.",
  "Also find the objections, questions and misconceptions real customers voice about it",
  "in their own words. Prefer specifics a viewer could look up over general commentary.",
].join(" ");

/** What the grounding pass needs back from a specialist turn. A STRUCTURAL slice of
 *  `runSpecialistTurn`'s return, so the real function satisfies it without this signature
 *  restating forty fields it does not read. */
export type GroundingTurn = {
  reply: string;
  sources: readonly { url: string; title: string }[];
  webSearchCalls: number;
  declaredUnsupported: boolean;
  truncated: boolean;
  truncatedReason?: "steps" | "clock";
};

export async function groundMediaBrief(
  ctx: Ctx,
  args: DispatchArgs,
  // INJECTED, the `dispatchAndLand` idiom in this same file: production closes it over
  // `runSpecialistTurn`, a test closes it over a fake. A LanguageModel is not Convex-serializable,
  // so this is the only way the persist/skip/degrade branches below are reachable at all — and
  // they are the three branches that decide whether a reel gets grounded, silently gets nothing,
  // or breaks.
  runTurn: (prompt: string) => Promise<GroundingTurn>,
): Promise<void> {
  const brief = args.question?.trim();
  if (!brief) return; // nothing to research; the deck path handles a briefless run already
  try {
    // 33.2 (PRD L5): the SAME brief on the SAME tenant inside the window was grounded already. A
    // "Try again" on a refused storyboard used to re-buy ~$0.21 of research for identical findings
    // (and the bake-off runner leans on this so research is a one-time cost per brief). The document
    // is already where `searchVault` looks; nothing downstream needs to know it was reused. Inside
    // the try, so a failing read can never fail the reel — it just researches again.
    const reused = await ctx.runQuery(internal.research.recentFindingsForQuestion, {
      tenantId: args.tenantId,
      questionHash: await contentHash(brief),
      sinceMs: Date.now() - FINDINGS_REUSE_MS,
    });
    if (reused) return;
    // The SAME skill and the SAME grant the research route uses, read off the shared registry
    // rather than restated — a second copy here could drift into granting media a tool the
    // research route does not have, which is the one direction that matters.
    const res = await runTurn(`${cap(brief, MAX_QUESTION_CHARS)}\n\n${MEDIA_GROUNDING_QUESTION}`);
    // THE SAME STRUCTURAL FLOOR the research route applies (16-09): a run that never searched is
    // not research and does not earn a RETRIEVABLE artifact. The reasoning is sharper here — this
    // document exists to be cited by the very next model turn, so a model-memory answer stored now
    // would be laundered into a "grounded" citation inside the same reel.
    if (res.webSearchCalls === 0) return;
    await ctx.runMutation(internal.research.persistFindings, {
      tenantId: args.tenantId,
      question: brief,
      body: res.reply,
      sources: res.sources.map((x) => ({ url: x.url, title: x.title })),
      webSearchCalls: res.webSearchCalls,
      declaredUnsupported: res.declaredUnsupported,
      retrievedAt: Date.now(),
      sourceThreadId: args.threadId,
      sourcePlanId: args.planId,
      rootRequestId: args.rootRequestId,
      incomplete: res.truncated,
      ...(res.truncatedReason === undefined ? {} : { incompleteReason: res.truncatedReason }),
    });
  } catch {
    // ONE audit row with a CODE (§4) — never the error text, which can carry the brief or
    // retrieved prose. The reel proceeds; grounding is an improvement, never a precondition.
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: args.rootRequestId,
      eventType: "media.grounding_failed",
      actor: "system",
      payload: { ...lineageRefs(args), reason: "grounding_error" },
    });
  }
}

export const runMedia = internalAction({
  args: dispatchArgs,
  handler: async (ctx, args): Promise<DispatchResult> => {
    // BEFORE the deck is written, not after: the specialist can only cite what is already in the
    // vault when its turn starts. Awaited rather than scheduled for the same reason.
    //
    // The SAME skill and the SAME tool grant the research route uses, read off the shared registry
    // rather than restated — a second copy could drift into granting the media path a tool the
    // research route does not have, which is the one direction that matters.
    await groundMediaBrief(ctx, args, (prompt) =>
      runSpecialistTurn(ctx, {
        tenantId: args.tenantId,
        planId: args.planId,
        skillName: SPECIALISTS.research.skillName,
        toolNames: SPECIALISTS.research.tools,
        prompt,
        turnId: args.rootRequestId,
        threadId: args.threadId,
        skillVersions: args.skillVersions,
        tenantSkillIds: args.tenantSkillIds,
      }),
    );
    return persistStoryboard(
      ctx,
      args,
      await dispatchAndLand(
        ctx,
        args,
        (a) =>
          traced(
            {
              agentName: "media-director",
              workflowName: "sub-agent-dispatch",
              workflowRunId: args.rootRequestId,
              sessionId: args.threadId,
            },
            () =>
              runSpecialistTurn(ctx, {
                // `...a` FIRST — the clobber lesson the research path records above.
                ...a,
                tenantId: args.tenantId,
                planId: args.planId,
                skillVersions: args.skillVersions,
                tenantSkillIds: args.tenantSkillIds,
              }),
          ),
        MEDIA_FAILED_MEMO,
      ),
    );
  },
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
    // 20-08: the SAME seam for the media terminal, and for the same reason. `runMedia` itself can
    // never be driven offline (a LanguageModel is not Convex-serializable), so without this flag
    // `persistStoryboard` would be wiring no test can reach — and "a dispatched media run stages a
    // proposed deck and ZERO mediaJobs rows" would be an assertion about the parser alone rather
    // than about the dispatch. Absent ⇒ the gap path, byte-identical.
    media: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const res = await dispatchAndLand(
      ctx,
      args,
      (a) =>
        traced({ traceName: "offline-harness" }, () =>
          runSpecialistTurn(ctx, {
            // `...a` FIRST — same reason as the two runners above. `mockScript` stays LAST because
            // this offline twin deliberately overrides it.
            ...a,
            tenantId: args.tenantId,
            planId: args.planId,
            skillVersions: args.skillVersions,
            tenantSkillIds: args.tenantSkillIds,
            mockScript: {
              primary: args.primary,
              fallback: args.fallback,
              softCutoffMs: args.softCutoffMs,
            },
          }),
        ),
      args.research === true
        ? RESEARCH_FAILED_MEMO
        : args.media === true
          ? MEDIA_FAILED_MEMO
          : undefined,
    );
    if (args.research === true) return persistResearchFindings(ctx, args, res);
    if (args.media === true) return persistStoryboard(ctx, args, res);
    return res;
  },
});
