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
  // 16-09 / 21-03: `skillVersions` + `tenantSkillIds`, the pins every agent door accepts — ONE
  // shared validator (Phase 38), so this door and `runCockpitAgent` cannot drift from each other.
  ...TOOL_CONTEXT_ARGS,
};

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
