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
const cap = (s: string): string =>
  s.length > MAX_LABEL_CHARS ? `${s.slice(0, MAX_LABEL_CHARS)}…` : s;

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
      costUsd: number;
      /** the tree's running total AFTER this hop — thread it to the next one */
      spentCents: number;
      /** the tree's ONE ceiling (derived at the root) — thread it to the next hop UNCHANGED */
      envelopeCents: number;
      skillVersion: number;
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
}) => Promise<{ reply: string; costUsd: number; skillVersion: number }>;

type Ctx = GenericActionCtx<DataModel>;

/**
 * Exported ONLY so `dispatch.test.ts` can assert the tier briefing it assembles (SC#5a) — driving
 * it through `__runSpecialistWithScript` would not work, because the mock model swallows the prompt
 * and the assertion would be about nothing. In production this is still called from exactly ONE
 * place: `governedDispatch`, below.
 */
export async function buildSpecialistPrompt(
  ctx: Ctx,
  a: { tenantId: string; threadId: string; gapIndex: number; route: string },
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
    const incomplete = spentAfter >= envelopeCents;
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
      },
    });
    return {
      ok: true,
      route: resolved.route,
      body: turn.reply,
      incomplete,
      costUsd: turn.costUsd,
      spentCents: spentAfter,
      envelopeCents,
      skillVersion: turn.skillVersion,
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
): Promise<DispatchResult> {
  // Pre-seeded for the throw path, which never reaches the assignment below.
  let landing: Landing = { incomplete: false, fallbackReason: "error" };
  try {
    const result = await governedDispatch(ctx, args, run);
    landing = result.ok
      ? { body: result.body, incomplete: result.incomplete }
      : // A governed refusal is a paused conversation, not an error — the user still gets the
        // deterministic memo, worded honestly for THIS reason (never the code itself).
        { incomplete: false, fallbackReason: result.reason };
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

/**
 * The OFFLINE twin (the __runCockpitAgentWithScript precedent, llm.ts:2116). A LanguageModel is
 * not Convex-serializable, so the mock is built inside runSpecialistTurn from a script. It calls
 * the SAME governedDispatch — test-support surface, never a second code path.
 */
export const __runSpecialistWithScript = internalAction({
  args: { ...dispatchArgs, primary: v.array(v.any()), fallback: v.optional(v.array(v.any())) },
  handler: async (ctx, args): Promise<DispatchResult> =>
    dispatchAndLand(ctx, args, (a) =>
      runSpecialistTurn(ctx, {
        tenantId: args.tenantId,
        planId: args.planId,
        ...a,
        mockScript: { primary: args.primary, fallback: args.fallback },
      }),
    ),
});
