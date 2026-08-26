"use node";
// ^ REQUIRED. This module imports `runSpecialistTurn` from `llm.ts` and `traced` from
// `lib/foglamp.ts`, and foglamp reaches `node:async_hooks`. A default-runtime module importing
// either fails to BUNDLE — a deploy error, not a caught exception (see lib/foglamp.ts). It also
// means this file may hold ONLY actions; every query it needs lives in a V8 module.

// The workflow-pack BINDING (Phase 27, PACK-02/PACK-03).
//
// THIS IS NOT A RUNTIME, AND THE FILE NAME WAS CHOSEN TO SAY SO. `runSpecialistTurn` (`llm.ts`)
// ALREADY IS the swappable `(skill body, tool-set)` seam: it loads the section-5 registry body
// itself (fail-closed on NO_ACTIVE_SKILL / NO_SUCH_SKILL_VERSION) and `runAgentLoop` already
// filters the built tool record to the exact `toolNames`. Everything here is the map from a closed
// pack id to `{ skillName, toolNames, prompt, planId }`, plus the governed gate, the preflight, the
// trace binding and the event terminals. There is NO second agent loop, NO router and NO second
// store in this file, and `workflowPackBinding.test.ts` asserts that structurally.
//
// A PACK IS A LEAF AGENT, BY CONSTRUCTION (owner decision B, 2026-08-23). `runAgentLoop` derives
// `grantDispatch: toolNames === undefined` and `grantSkillAuthoring: toolNames === undefined`, and
// a pack ALWAYS supplies an array — so specialist dispatch, skill authoring and the paid image door
// are never BUILT for a pack, let alone withheld by wording. Campaign Plan therefore PRODUCES A
// PLAN; it does not orchestrate the work in the plan. Do not try to re-grant dispatch here: reading
// `toolNames.includes(...)` at that gate would let an allow-list ask for the capability by name.
//
// `runId` IS THE CORRELATION ID, and that is what makes cost and latency joinable without this
// plane ever re-emitting them. It is passed as `turnId`, which `runAgentLoop` uses as the
// `spendEvents.correlationId` and as the `agentSteps.turnId` for the whole run.
// `workflowPackOutcomes.ts` joins on exactly that. See `PACK_DERIVED_METRIC_SOURCES` in @pikar/core.

import {
  MISSING_SOURCE_UNLOCK,
  PACK_SOURCE_LABEL,
  type PackOutcome,
  type PackPreflight,
  packPreflight,
  resolveWorkflowPack,
  toolsForWorkflowPack,
  type WorkflowPackId,
} from "@pikar/core";
import { scanText } from "@pikar/pii";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { traced } from "./lib/foglamp";
import { runSpecialistTurn, saveMarkdownDocument } from "./llm";

/** A governed stop RETURNS; only bugs throw. The `DispatchResult` posture, one lane over. */
export type PackRunResult =
  | { ok: false; reason: "unknown_pack" }
  | {
      ok: true;
      runId: string;
      packId: WorkflowPackId;
      reply: string;
      outcome: PackOutcome;
      costUsd: number;
      skillVersion?: number;
      blocked?: "kill_switch" | "daily_budget_exhausted" | "deployment_budget_exhausted";
    };

/** The paused reply for a governed stop — `llm.ts`'s `PAUSED_REPLY` contract, one lane over. */
const PACK_PAUSED_REPLY =
  "I've paused for a moment — I'm briefly unavailable. Please try that again shortly.";

// `probeSources` USED TO LIVE HERE, as a private function, and that was the reason the browser had
// no way to ask the same question: this module is `"use node"` and may hold only actions. 27-09
// moved it to `workflowPackDiscovery.ts` (a V8 module) so the preflight a user is SHOWN before a run
// and the preflight the model is TOLD during it are one resolution rather than two that agree until
// one is edited. The behaviour here is unchanged — the call is the same, one hop further out.

/**
 * The code-owned preflight paragraph. Built from `PACK_SOURCE_LABEL` and `MISSING_SOURCE_UNLOCK` so
 * six bodies cannot each name a source differently, and placed ABOVE the user's request so the
 * untrusted text stays the FINAL line (the `buildTurnPrompt` convention).
 */
export function preflightPrompt(pre: PackPreflight, request: string): string {
  const lines = pre.sources.map(({ source, state }) => `- ${PACK_SOURCE_LABEL[source]}: ${state}`);
  const unlocks = pre.missingKnown.map(
    (s) => `- ${PACK_SOURCE_LABEL[s]} — would need ${MISSING_SOURCE_UNLOCK[s]}`,
  );
  return [
    "Source availability for this run, resolved in code. This is the truth about what you can see;",
    "do not contradict it, and never claim a source listed as unavailable answered.",
    // THIS BLOCK IS PREPENDED TO EVERY TURN, WHICH MAKES IT THE ANTECEDENT OF THE USER'S PRONOUNS.
    // Measured on `pack-sales-call-prep` case 01, whose turn 2 is "Save that so I can read it in
    // the car": while packs held `createDocument`, four runs out of four saved a document whose
    // entire body was THIS PARAGRAPH — "that" binds to the nearest preceding text, which is this,
    // not the prep written a turn earlier — and the eval scored `artifactCreated: true` and passed.
    // A disclaimer sentence here ("never the content of anything you save") was tried and did NOT
    // move it. The fix was structural: `saveAsDocument` gives the model no content argument at all,
    // so there is no longer anything for a pronoun to be resolved INTO. Do not re-add one.
    ...lines,
    ...(unlocks.length > 0 ? ["", "Unreadable in this workflow at all:", ...unlocks] : []),
    "",
    "The user asks:",
    request,
  ].join("\n");
}

/**
 * Terminal outcome, DERIVED from what actually happened rather than judged from the prose.
 *
 * `useful` is the pilot's headline measure (`timeToFirstUsefulOutcome`), so it is deliberately the
 * NARROWEST arm: the run finished, said something, was not truncated, did not declare its evidence
 * insufficient, and every plane it could have read did answer. Anything short of that is `partial`,
 * which is an honest outcome and not a failure — many pilot runs are partial by construction.
 */
export function outcomeFor(res: {
  reply: string;
  truncated: boolean;
  declaredUnsupported: boolean;
  runtimeMissing: number;
}): PackOutcome {
  if (res.reply.trim().length === 0) return "no_findings";
  if (res.truncated || res.declaredUnsupported || res.runtimeMissing > 0) return "partial";
  return "useful";
}

/**
 * The ids this run added to the thread's cumulative created-artifact card. A pre-existing document
 * is NOT this run's artifact — crediting one would let a single created document be re-counted by
 * every later pack run on the same thread, which is the direction that quietly inflates the pilot's
 * headline numbers. Exported because it is the whole rule, and it is testable without a model.
 */
export function newArtifactIds<T>(before: readonly T[], after: readonly T[]): T[] {
  const seen = new Set(before);
  return after.filter((id) => !seen.has(id));
}

const packArgs = {
  tenantId: v.string(),
  /** Deliberately `v.string()`, NOT a closed union: `resolveWorkflowPack` is the fail-closed door,
   *  and an id it refuses must be REACHABLE from the caller or the refusal is untestable. */
  packId: v.string(),
  threadId: v.string(),
  planId: v.id("plans"),
  text: v.string(),
  /** Server-minted per run, and the correlation id for cost and latency (see the header). */
  runId: v.optional(v.string()),
  /** Pairs a run back to the recommendation that offered it (27-09's discovery surface). */
  recommendationId: v.optional(v.string()),
  /** 27-08: the eval runner MUST be able to pin the exact candidate, or a run certifies the ACTIVE
   *  body while the evidence row names the candidate. `internalAction` ⇒ never model-supplied. */
  skillVersions: v.optional(v.record(v.string(), v.number())),
};

type PackTurnArgs = {
  tenantId: string;
  packId: string;
  threadId: string;
  planId: Id<"plans">;
  text: string;
  runId?: string;
  recommendationId?: string;
  skillVersions?: Record<string, number>;
};

/**
 * ONE pack turn, end to end. Shared by the production entry point and the offline shim below, so a
 * test drives THIS path — the gate, the preflight, the trace, the events and the outcome — rather
 * than a twin of it (the `__runSpecialistWithScript` precedent in dispatch.ts).
 */
async function runPackTurn(
  ctx: GenericActionCtx<DataModel>,
  args: PackTurnArgs,
  mockScript?: { primary: unknown[]; fallback?: unknown[] },
): Promise<PackRunResult> {
  const resolved = resolveWorkflowPack(args.packId);
  // Refused BEFORE anything is recorded, and NOTHING is recorded for it: `workflowPackEvents.packId`
  // is a closed union, so an unknown id structurally cannot be written to the plane. That is the
  // honest state — there is no pack to attribute the refusal to.
  if (!resolved.ok) return { ok: false, reason: "unknown_pack" };
  const { packId, spec } = resolved;
  const { tenantId, threadId, planId } = args;
  const runId = args.runId ?? crypto.randomUUID();

  // The acceptance lands BEFORE the run: it is a fact about the offer the user answered, and it must
  // survive a run that then fails. `recommendation_shown` is emitted by the discovery surface that
  // renders the card (27-09) — emitting it from HERE would pair every impression with its own
  // acceptance and make `recommendationAcceptance` a constant 100%.
  if (args.recommendationId !== undefined) {
    await ctx.runMutation(internal.workflowPackEventLog.record, {
      tenantId,
      packId,
      runId,
      event: "recommendation_accepted",
      recommendationId: args.recommendationId,
      threadId,
    });
  }
  await ctx.runMutation(internal.workflowPackEventLog.record, {
    tenantId,
    packId,
    runId,
    event: "run_started",
    threadId,
    planId,
  });

  // The SAME governed gate the Executive Agent takes (`llm.ts` step 1). Without it a pack run is the
  // one paid model path that ignores the kill switch and the daily budget.
  const pre = await ctx.runMutation(internal.guardrails.preCall, { tenantId });
  if (!pre.ok) {
    await ctx.runMutation(internal.workflowPackEventLog.record, {
      tenantId,
      packId,
      runId,
      event: "run_failed",
      outcome: "blocked",
      threadId,
    });
    return {
      ok: true,
      runId,
      packId,
      reply: PACK_PAUSED_REPLY,
      outcome: "blocked",
      costUsd: 0,
      blocked: pre.reason,
    };
  }

  const flight = packPreflight(
    packId,
    await ctx.runQuery(internal.workflowPackDiscovery.probeSources, { tenantId }),
  );
  await ctx.runMutation(internal.workflowPackEventLog.record, {
    tenantId,
    packId,
    runId,
    event: "preflight_completed",
    threadId,
    sourceExpectedCount: flight.sources.length,
    sourceAvailableCount: flight.sources.filter((s) => s.state !== "unavailable").length,
    // The two counts `missingSourceSurprise` compares, emitted on EXACTLY ONE event kind: it counts
    // one run per event carrying both, so repeating them on the terminal row would double every run.
    preflightMissingCount: flight.missingKnown.length,
    runtimeMissingCount: flight.missingRuntime.length,
  });
  // ONE row per run that hit a TENANT-specific gap, not one per missing source. A matrix-missing
  // source is announced up front and carried by the body — that is the honest-partial contract
  // working, not an incident — and the table has no field to say WHICH source anyway (CLAUDE.md
  // section 4), so a row per source would be an uncountable pile. The detail is in the counts above.
  if (flight.missingRuntime.length > 0) {
    await ctx.runMutation(internal.workflowPackEventLog.record, {
      tenantId,
      packId,
      runId,
      event: "capability_missing",
      threadId,
    });
  }

  // Artifacts are observed at the seam that already exists rather than by editing `createDocument`:
  // `vaultSources` carries ONE cumulative card per thread, so the ids this run added are exactly the
  // difference between the card before and the card after. `llm.ts` stays byte-unchanged.
  const before =
    (await ctx.runQuery(internal.vaultSources.latestCreated, { tenantId, threadId }))?.docIds ?? [];

  try {
    const res = await traced(
      {
        agentName: "workflow-pack",
        workflowName: "workflow-pack-run",
        workflowRunId: runId,
        sessionId: threadId,
      },
      () =>
        runSpecialistTurn(ctx, {
          tenantId,
          planId,
          skillName: spec.skillName,
          // THE grant, derived from 27-02's operation matrix. Never hand-typed, never widened here.
          toolNames: toolsForWorkflowPack(packId),
          prompt: preflightPrompt(flight, args.text),
          // `turnId` IS `runId` — the join key for spend and steps (see the header).
          turnId: runId,
          threadId,
          ...(args.skillVersions === undefined ? {} : { skillVersions: args.skillVersions }),
          ...(mockScript === undefined ? {} : { mockScript }),
        }),
    );

    // 27-10. THE SAVE, and the reason it lives here rather than in a tool: the deliverable is the
    // REPLY, and no tool can read a reply that has not been written yet. `saveAsDocument` carries
    // the model's decision (there is something to hand over) and its title; the content is taken
    // from the run, never re-typed by the model. See `buildSaveAsDocumentTool` for the eleven runs
    // that made this the mechanism instead of `createDocument`.
    //
    // BEFORE the artifact diff below, deliberately — this write appends to the same `vaultSources`
    // card `newArtifactIds` reads, so ordering it here is what makes the `artifact_created` row
    // appear for it with no second observation path.
    //
    // An empty reply saves NOTHING even when asked: `outcomeFor` calls that run `no_findings`, and
    // a document containing nothing is not an artifact, it is litter in the owner's vault.
    if (res.saveRequest !== undefined && res.reply.trim() !== "") {
      // The title is the one model-authored value on this path, and it lands in a stored row and on
      // a rendered card — so it takes the same redaction gate as every other model string that is
      // stored (§4). A title that cannot be scanned is replaced by the pack's own code-owned title
      // rather than dropped: the document is the deliverable and must not be lost over its label.
      const scan = scanText(res.saveRequest.title);
      await saveMarkdownDocument(ctx, {
        tenantId,
        planId,
        threadId,
        title: (scan.ok ? scan.value.safeText.trim() : "") || spec.title,
        markdown: res.reply,
      });
    }

    const after = await ctx.runQuery(internal.vaultSources.latestCreated, { tenantId, threadId });
    for (const artifactId of newArtifactIds(before, after?.docIds ?? [])) {
      await ctx.runMutation(internal.workflowPackEventLog.record, {
        tenantId,
        packId,
        runId,
        event: "artifact_created",
        skillVersion: res.skillVersion,
        threadId,
        artifactId,
      });
    }

    const outcome = outcomeFor({
      reply: res.reply,
      truncated: res.truncated,
      declaredUnsupported: res.declaredUnsupported,
      runtimeMissing: flight.missingRuntime.length,
    });
    await ctx.runMutation(internal.workflowPackEventLog.record, {
      tenantId,
      packId,
      runId,
      event: "run_completed",
      outcome,
      skillVersion: res.skillVersion,
      threadId,
      planId,
    });
    return {
      ok: true,
      runId,
      packId,
      reply: res.reply,
      outcome,
      costUsd: res.costUsd,
      skillVersion: res.skillVersion,
    };
  } catch (err) {
    // The terminal lands on EVERY exit — a run that started and never terminated is a hole in every
    // denominator. Then RETHROW: the driver owns the conversational error turn, and swallowing a bug
    // here would hide it behind a tidy `failed` row.
    await ctx.runMutation(internal.workflowPackEventLog.record, {
      tenantId,
      packId,
      runId,
      event: "run_failed",
      outcome: "failed",
      threadId,
    });
    throw err;
  }
}

/**
 * PRODUCTION entry point. `internalAction`, so the model can never supply the tenant, the plan or a
 * version pin (the `runSpecialist` precedent, ADR-008). The public door is
 * `cockpit.startWorkflowPack`, which owns the thread, the plan row and the reply turn.
 */
export const runWorkflowPack = internalAction({
  args: packArgs,
  handler: async (ctx, args): Promise<PackRunResult> => runPackTurn(ctx, args),
});

/**
 * The offline twin. A `LanguageModel` is not Convex-serializable, so the production action can never
 * be driven offline; this shim swaps ONLY the model and shares every other line above.
 */
export const __runWorkflowPackWithScript = internalAction({
  args: { ...packArgs, primary: v.array(v.any()), fallback: v.optional(v.array(v.any())) },
  handler: async (ctx, args): Promise<PackRunResult> =>
    runPackTurn(ctx, args, {
      primary: args.primary,
      ...(args.fallback === undefined ? {} : { fallback: args.fallback }),
    }),
});
