// What the DISPATCH DOOR and the DURABLE RUNNER must agree on, declared once (42-02).
//
// `dispatch.ts` is `"use node"` — it pulls in `ai` + `@ai-sdk/openai` — and a Convex-runtime module
// cannot import a node one. `dispatchRun.ts` holds the `workflow.define` (a RegisteredMutation, so
// it cannot live in a node module) and its `onComplete` mutation, and both need the same argument
// validator and the same honest fallback bodies. Neither may re-declare them: a validator that
// drifts between the door and the runner is refused at RUNTIME with `ArgumentValidationError`,
// after the caller has already committed.
//
// This is the `lib/toolContextArgs.ts` pattern verbatim — function-free, no `"use node"`, imported
// by node and non-node modules alike. Everything here is a PURE MOVE out of `dispatch.ts`; nothing
// in this file is new behaviour.
import { v } from "convex/values";
import { TOOL_CONTEXT_ARGS } from "./toolContextArgs";

/** The Convex validators for a dispatch — shared by every entry point so none can drift.
 *  Moved out of `dispatch.ts` byte-identically in 42-02. */
export const DISPATCH_ARGS = {
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
  /** Stage 3: an explicitly requested research output. Absent preserves the shipped memo-only
   *  behavior. The request id that binds it is the code-owned `rootRequestId` above; the model
   *  never supplies a second identity alongside this presentation choice. */
  researchDeliverable: v.optional(v.union(v.literal("memo"), v.literal("pdf"))),
  // 16-09 / 21-03: `skillVersions` + `tenantSkillIds`, the pins every agent door accepts — ONE
  // shared validator (Phase 38), so this door and `runCockpitAgent` cannot drift from each other.
  ...TOOL_CONTEXT_ARGS,
};

/** One sub-agent tree may draw down at most this share of what is left of the day. Not a magic
 *  constant on its own — it is a FRACTION of the live rail, so a nearly-drained day yields a small
 *  envelope and a fresh day a large one.
 *
 *  Moved here from `dispatch.ts` in 42-03 (ADR-038) so the FAN-OUT MINT SITE and `governedDispatch`
 *  derive the root envelope from ONE constant. Two copies of this fraction is how a divided
 *  envelope and the envelope it was divided from stop being the same number.
 *
 *  ponytail: `dailySpendCents` is a KEYLESS window, so this is the DEPLOYMENT's remaining budget,
 *  not the tenant's — matching the "fixed constants for the single-owner beta; per-tenant policy is
 *  the upgrade path" comment already in guardrails.ts. */
export const ENVELOPE_FRACTION = 0.25;

/** The most workers ONE question may be fanned out to (ADR-040; was 5 under ADR-037, depth 1 is
 *  unchanged). An upper bound only — ADR-038 makes the rail a second, lower bound, so the number
 *  that actually runs is `min(assignments, MAX_FAN_OUT, rootEnvelope)` and is not a fixed figure.
 *  A test that pins a worker count without seeding the rail is pinning the wrong thing.
 *
 *  WHY RAISING THIS ALONE WOULD HAVE BEEN A NO-OP, recorded because it is the whole reason
 *  ADR-040 exists: while a child was A ROUTE, `SPECIALIST_ROUTES` was the binding constraint,
 *  not this number. Six members, `media` refused at the door, deduped by route — five distinct
 *  workers, and the cap happened to equal five. A child is now an ASSIGNMENT (a route AND its
 *  own sub-question), deduped on the PAIR, so this number binds for the first time.
 *
 *  IT IS A MONEY CEILING. A child is dispatched with `spentCents: 0`, and `governedDispatch`
 *  refuses only on `spent >= envelope` — which is false at the start of every child. So the
 *  envelope bounds RECURSION, not the first turn, and this constant is the real bound on how
 *  many paid turns one Approve can buy. `narrowFanOut` capping `n` by `rootEnvelope` is what
 *  keeps a thin rail from starting all of them. */
export const MAX_FAN_OUT = 15;

/**
 * HOW MANY WORKERS A FAN-OUT ACTUALLY STARTS, AND WHAT EACH ONE IS GIVEN (ADR-038).
 *
 * Pure, and extracted for exactly that reason: this arithmetic is the whole money rule, and the
 * version of it in ADR-037 Decision 6 was WRONG in a way no integration test would have caught.
 * That decision reasoned about the single point `rootEnvelope === 0` and concluded a zero share is
 * refused fail-closed. But `Math.floor(rootEnvelope / n)` is 0 across the whole interval
 * `rootEnvelope < n`, and a child handed `envelopeCents: 0` is NOT refused — `governedDispatch`
 * reads `args.envelopeCents > 0 ? args.envelopeCents : derive`, so a zero child takes the DERIVE
 * branch and receives the FULL rail share. Five workers on a 4-cent envelope would each have been
 * granted 4 cents, five times the budget the fan-out was dividing.
 *
 * The fix is to cap the WORKER COUNT by the envelope rather than to floor the share:
 * `n = min(routeCount, MAX_FAN_OUT, rootEnvelopeCents)` makes `share >= 1` a theorem, because for
 * integers with `1 <= n <= rootEnvelope`, `floor(rootEnvelope / n) >= 1`. `Math.max(1, …)` stays
 * forbidden — it funds n workers at a penny each and the division stops being one.
 *
 * `workerCount === 0` means the rail cannot fund even one worker. The caller refuses the whole
 * fan-out before inserting a row; it is the one case where fail-closed is still the only answer.
 */
export function narrowFanOut(
  routeCount: number,
  rootEnvelopeCents: number,
): { workerCount: number; shareCents: number } {
  const workerCount = Math.max(0, Math.min(routeCount, MAX_FAN_OUT, rootEnvelopeCents));
  return {
    workerCount,
    shareCents: workerCount === 0 ? 0 : Math.floor(rootEnvelopeCents / workerCount),
  };
}

/** Which of the three specialist entry points a run is for. A CODE-OWNED literal: it selects the
 *  action the durable step calls and the fallback body its terminal lands, and the model never
 *  supplies it (ADR-008). */
export const DISPATCH_KIND = v.union(
  v.literal("specialist"),
  v.literal("research"),
  v.literal("media"),
);

/** The honest one sentence a FAILED research run lands as its memo body. It replaces
 *  LOST_CONTEXT_MEMO's "the evaluation it was based on is no longer on file", which is false for a
 *  run that was never based on an evaluation — a user told to re-run an assessment they never
 *  started has been given a dead end wearing an explanation's clothes. Driver-plane synthetic
 *  string, not a skill (§5 n/a — dispatch.ts's four refusal replies are the precedent). */
export const RESEARCH_FAILED_MEMO =
  "# Research\n\nI couldn't finish that piece of research — the run stopped before it produced" +
  " anything. Ask me to look into it again and I'll start it over.";

/** The same, for a media run. Same class of driver-plane string, same reason. */
export const MEDIA_FAILED_MEMO =
  "# Reel\n\nI couldn't put that reel proposal together — the run stopped before it produced" +
  " anything. Ask me to plan it again and I'll start over. Nothing was generated and nothing was" +
  " charged.";

/** The fallback body a run of this kind lands when it produced nothing at all. `specialist` gets
 *  `undefined` so the gap path keeps its `buildMemo(evaluationRow, gap, …)` terminal byte-identical
 *  — it HAS an evaluation to fall back to, which is exactly what the two strings above do not. */
export const failedMemoFor = (kind: "specialist" | "research" | "media"): string | undefined =>
  kind === "research" ? RESEARCH_FAILED_MEMO : kind === "media" ? MEDIA_FAILED_MEMO : undefined;

/** 43-04: the honest sentence a CONTENT VARIANT lands when its draft did not come back. A sibling
 *  of the two above and NOT a `failedMemoFor` member: a variant is not a dispatch `kind`, it never
 *  enters `TARGET`, and widening that union would put a fourth arm on a switch nothing routes to. */
export const VARIANT_FAILED_MEMO =
  "This version didn't come back. Nothing was saved for it and nothing was charged — the other" +
  " versions are unaffected. Ask me to try this one again.";
