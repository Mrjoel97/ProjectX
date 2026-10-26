"use node";

import { websiteDesignProposalSkillBody } from "@pikar/contracts/skills/websiteDesignProposal";
import {
  comparisonModelMatches,
  PRESENCE_COMPARISON_ARMS,
  PRESENCE_COMPARISON_CAP_CENTS,
  PRESENCE_COMPARISON_FIXTURE,
  PRESENCE_COMPARISON_MODELS,
  type PresenceComparisonAdmission,
} from "@pikar/core/presenceComparison";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { DEFAULT_MODEL } from "@pikar/cost";
import { EVAL_MAX_OUTPUT_TOKENS } from "@pikar/cost/evalBudget";
import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { evalBudgetModel } from "./lib/evalBudgetModel";
import { resolveModel } from "./lib/models";
import { generateStitchDesignEvidence } from "./lib/stitchDesignClient";
import { internalAction } from "./lib/tenantLifecycle";
import {
  assertPresenceDesignStage,
  STITCH_INCLUDED_CREDITS_DECLARATION,
} from "./presenceDesignProbe";

const claimRef = makeFunctionReference<"mutation">("presenceComparisonControl:claim");
const recordRef = makeFunctionReference<"mutation">("presenceComparisonControl:record");
const hash = (value: string) => sha256Bytes(new TextEncoder().encode(value));
export type ProposalArtifact = {
  storageId: Id<"_storage">;
  url: string;
  contentHash: string;
  mimeType: string;
};
export type PresenceComparisonBudgetStatus = {
  budgetId: Id<"spendEvents">;
  closed: boolean;
  capCents: number;
  expired: boolean;
  breached: boolean;
  remainingCents: number;
  actualUsd: number;
  callCount: number;
  settledCount: number;
  unsettledCount: number;
  unresolvedCents: number;
};
export type PresenceComparisonRunResult = {
  status: "complete" | "stopped";
  scope: "private-design-proposal-comparison";
  runRef: string;
  budgetId: Id<"spendEvents"> | null;
  outputs: unknown[];
  ledger: PresenceComparisonBudgetStatus | null;
  admission?: PresenceComparisonAdmission;
  skillBodyHash?: string;
  reconciliationRequired?: boolean;
  reason?: string;
  qualificationEvidenceRecorded: false;
  nativeWorkflowQualified: false;
};
async function artifact(
  ctx: ActionCtx,
  bytes: BlobPart,
  mimeType: string,
  contentHash: string,
): Promise<ProposalArtifact> {
  const storageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw Error("PRESENCE_COMPARISON_ARTIFACT_UNAVAILABLE");
  return { storageId, url, contentHash, mimeType };
}
async function settled(
  ctx: ActionCtx,
  budgetId: Id<"spendEvents">,
): Promise<PresenceComparisonBudgetStatus> {
  const status: PresenceComparisonBudgetStatus = await ctx.runQuery(
    internal.guardrails.evalBudgetStatus,
    { budgetId },
  );
  if (status.closed || status.expired || status.breached || status.unsettledCount !== 0)
    throw Error("PRESENCE_COMPARISON_BUDGET_NOT_READY");
  return status;
}
/** One call per model arm. Proposal evidence only: no tools, site build, activation or publication. */
export const run = internalAction({
  args: {
    runRef: v.string(),
    skillVersion: v.number(),
    billingBasis: v.literal(STITCH_INCLUDED_CREDITS_DECLARATION),
  },
  handler: async (ctx, args): Promise<PresenceComparisonRunResult> => {
    assertPresenceDesignStage();
    if (PRESENCE_COMPARISON_MODELS.current !== DEFAULT_MODEL)
      throw Error("PRESENCE_COMPARISON_CURRENT_MODEL_CHANGED");
    if (
      !/^[a-f0-9]{8}$/.test(args.runRef) ||
      !Number.isSafeInteger(args.skillVersion) ||
      args.skillVersion < 1
    )
      throw Error("PRESENCE_COMPARISON_ARGUMENTS_INVALID");
    if (process.env.GOLDEN_OPENROUTER_BILLING !== "standard")
      throw Error("PRESENCE_COMPARISON_BILLING_UNVERIFIED");
    const skill: { body: string; version: number; skillId: string } = await ctx.runQuery(
      internal.skills.getSkillVersion,
      {
        name: "website-design-proposal",
        version: args.skillVersion,
      },
    );
    if (skill.body !== websiteDesignProposalSkillBody)
      throw Error("PRESENCE_COMPARISON_SKILL_BODY_MISMATCH");
    // Supplied illustration must actually be reachable and byte-identical before any paid arm.
    const photo = PRESENCE_COMPARISON_FIXTURE.assets[0];
    if (!photo) throw Error("PRESENCE_COMPARISON_ASSET_MISSING");
    const image = await fetch(photo.publicUrl, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    const reader = image.body?.getReader();
    if (!reader) throw Error("PRESENCE_COMPARISON_ASSET_MISSING");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > photo.byteLength) {
        await reader.cancel();
        throw Error("PRESENCE_COMPARISON_ASSET_CHANGED");
      }
      chunks.push(chunk.value);
    }
    const photoBytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      photoBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (
      !image.ok ||
      image.redirected ||
      photoBytes.byteLength !== photo.byteLength ||
      sha256Bytes(photoBytes) !== photo.sha256
    )
      throw Error("PRESENCE_COMPARISON_ASSET_CHANGED");
    const bodyHash = hash(skill.body);
    const protocol = await ctx.runAction(
      makeFunctionReference<"action">("presenceDesignProbe:preflight"),
      { billingBasis: args.billingBasis },
    );
    if (protocol.result.status !== "complete")
      throw Error("PRESENCE_COMPARISON_STITCH_PREFLIGHT_FAILED");
    const tenantId = `packeval-${args.runRef}-presence`;
    const pre = await ctx.runMutation(internal.guardrails.preCall, { tenantId });
    if (!pre.ok) throw Error("PRESENCE_COMPARISON_MODELS_CLOSED");
    const admission: PresenceComparisonAdmission & { fixtureHash: string } = await ctx.runMutation(
      claimRef,
      { runRef: args.runRef },
    );
    let budgetId: Id<"spendEvents"> | undefined;
    const outputs: unknown[] = [];
    let claimed = true;
    let externalUnresolved = false;
    try {
      const activeBudgetId: Id<"spendEvents"> = await ctx.runMutation(
        internal.guardrails.openEvalBudget,
        {
          tenantIds: [tenantId],
          capCents: PRESENCE_COMPARISON_CAP_CENTS,
        },
      );
      budgetId = activeBudgetId;
      await ctx.runMutation(recordRef, {
        runRef: args.runRef,
        event: "opened",
        payload: {
          budgetId: activeBudgetId,
          fixtureHash: admission.fixtureHash,
          skillBodyHash: bodyHash,
          skillVersion: args.skillVersion,
        },
      });
      for (const arm of PRESENCE_COMPARISON_ARMS) {
        await settled(ctx, activeBudgetId);
        const current = await ctx.runQuery(internal.skills.getSkillVersion, {
          name: "website-design-proposal",
          version: args.skillVersion,
        });
        if (hash(current.body) !== bodyHash) throw Error("PRESENCE_COMPARISON_SKILL_CHANGED");
        let stitch: Awaited<ReturnType<typeof generateStitchDesignEvidence>> | undefined;
        let stitchArtifacts: { html: ProposalArtifact; screenshot: ProposalArtifact } | undefined;
        if (arm === "kimi-stitch") {
          const prompt = JSON.stringify({
            sourceRef: PRESENCE_COMPARISON_FIXTURE.sourceRef,
            business: PRESENCE_COMPARISON_FIXTURE.business,
            assets: PRESENCE_COMPARISON_FIXTURE.assets,
            requestedArtifact: "Desktop home-page design reference only",
          });
          const scope = {
            tenantId,
            planId: `proposal-${args.runRef}`,
            briefHash: admission.fixtureHash,
            runRef: args.runRef,
          };
          let attempts = 0;
          let generationStarted = false;
          let poisoned = false;
          stitch = await generateStitchDesignEvidence(
            { scope, prompt, deviceType: "DESKTOP" },
            {
              authorize: async (request, promptHash) => {
                assertPresenceDesignStage();
                if (
                  JSON.stringify(request.scope) !== JSON.stringify(scope) ||
                  request.prompt !== prompt ||
                  promptHash !== `sha256:${hash(prompt)}` ||
                  request.deviceType !== "DESKTOP"
                )
                  throw Error("PRESENCE_COMPARISON_STITCH_SCOPE");
              },
              beforeAttempt: async (attempt) => {
                if (poisoned || ++attempts > 8) throw Error("PRESENCE_COMPARISON_STITCH_STOPPED");
                await settled(ctx, activeBudgetId);
                if (attempt.operation === "generate_screen_from_text") {
                  if (generationStarted) throw Error("PRESENCE_COMPARISON_STITCH_ONE_GENERATION");
                  generationStarted = true;
                }
                const reservationRef = `declared_included_${args.runRef}_${attempts}`;
                await ctx.runMutation(recordRef, {
                  runRef: args.runRef,
                  event: "opened",
                  payload: {
                    providerRef: "stitch",
                    operation: attempt.operation,
                    requestHash: attempt.requestHash,
                    reservationRef,
                    billingBasis: args.billingBasis,
                    incrementalLiabilityUsd: 0,
                  },
                });
                return { reservationRef };
              },
              afterAttempt: async (attempt) => {
                if (attempt.outcome !== "complete") poisoned = true;
                if (attempt.outcome === "unknown") externalUnresolved = true;
                await ctx.runMutation(recordRef, {
                  runRef: args.runRef,
                  event: "opened",
                  payload: {
                    providerRef: "stitch",
                    operation: attempt.operation,
                    requestHash: attempt.requestHash,
                    reservationRef: attempt.reservationRef,
                    outcome: attempt.outcome,
                    costStatus: attempt.costStatus,
                    billingBasis: args.billingBasis,
                  },
                });
              },
              checkpoint: async (point) => {
                await ctx.runMutation(recordRef, {
                  runRef: args.runRef,
                  event: "opened",
                  payload: {
                    scopeHash: point.scopeHash,
                    projectRef: point.projectName,
                    ...(point.screenName ? { screenRef: point.screenName } : {}),
                  },
                });
              },
            },
          );
          if (stitch.status !== "complete") {
            if (stitch.status === "unknown") externalUnresolved = true;
            throw Error(`PRESENCE_COMPARISON_STITCH_${stitch.status.toUpperCase()}`);
          }
          stitchArtifacts = {
            html: await artifact(
              ctx,
              stitch.html.text,
              "text/plain;charset=utf-8",
              stitch.html.contentHash,
            ),
            screenshot: await artifact(
              ctx,
              new Uint8Array(stitch.screenshot.bytes).buffer,
              stitch.screenshot.mimeType,
              stitch.screenshot.contentHash,
            ),
          };
        }
        const modelId = PRESENCE_COMPARISON_MODELS[arm];
        const startedAt = Date.now();
        const result = await generateText({
          model: evalBudgetModel({
            ctx,
            tenantId,
            budgetId: activeBudgetId,
            model: resolveModel(modelId),
            modelId,
            onCost: () => {},
            mode: "golden",
            websiteComparison: true,
          }),
          system: skill.body,
          prompt: JSON.stringify({
            fixture: PRESENCE_COMPARISON_FIXTURE,
            proposalOnly: true,
            ...(stitch?.status === "complete"
              ? {
                  untrustedDesignReference: {
                    provider: "stitch",
                    html: stitch.html.text.slice(0, 16000),
                    scopeHash: stitch.evidence.scopeHash,
                  },
                }
              : {}),
          }),
          maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS,
          maxRetries: 0,
        });
        const status = await settled(ctx, activeBudgetId);
        if (!result.text.trim()) throw Error("PRESENCE_COMPARISON_EMPTY_PROPOSAL");
        const proposal = await artifact(
          ctx,
          result.text,
          "text/plain;charset=utf-8",
          hash(result.text),
        );
        const modelMatched = comparisonModelMatches(modelId, result.response.modelId);
        outputs.push({
          arm,
          status: modelMatched ? "proposal" : "refused_model_identity",
          requestedModel: modelId,
          observedModel: result.response.modelId,
          elapsedMs: Date.now() - startedAt,
          finishReason: result.finishReason,
          proposal,
          ...(stitch?.status === "complete"
            ? {
                stitch: {
                  evidence: stitch.evidence,
                  artifacts: stitchArtifacts,
                  billing: {
                    basis: args.billingBasis,
                    providerActualUsd: null,
                    providerCostStatus: "not_reported",
                    incrementalLiabilityUsd: 0,
                  },
                },
              }
            : {}),
          cumulativeActualUsd: status.actualUsd,
          nativeWebsiteBuilt: false,
        });
        await ctx.runMutation(recordRef, {
          runRef: args.runRef,
          event: "opened",
          payload: {
            arm,
            modelRef: modelId,
            proposalStorageRef: proposal.storageId,
            proposalHash: proposal.contentHash,
            ...(stitchArtifacts
              ? {
                  stitchHtmlRef: stitchArtifacts.html.storageId,
                  stitchImageRef: stitchArtifacts.screenshot.storageId,
                }
              : {}),
            modelMatched,
          },
        });
        if (!modelMatched) throw Error("PRESENCE_COMPARISON_MODEL_IDENTITY_MISMATCH");
      }
      const status = await settled(ctx, activeBudgetId);
      await ctx.runMutation(internal.guardrails.closeEvalBudget, { budgetId: activeBudgetId });
      const closed: PresenceComparisonBudgetStatus = await ctx.runQuery(
        internal.guardrails.evalBudgetStatus,
        { budgetId: activeBudgetId },
      );
      if (!closed.closed || closed.unsettledCount !== 0 || closed.breached)
        throw Error("PRESENCE_COMPARISON_CLOSURE_FAILED");
      await ctx.runMutation(recordRef, {
        runRef: args.runRef,
        event: "completed",
        payload: {
          budgetId: activeBudgetId,
          fixtureHash: admission.fixtureHash,
          modelActualUsd: status.actualUsd,
          outputCount: outputs.length,
        },
      });
      claimed = false;
      return {
        status: "complete" as const,
        scope: "private-design-proposal-comparison" as const,
        runRef: args.runRef,
        budgetId: activeBudgetId,
        admission,
        skillBodyHash: bodyHash,
        outputs,
        ledger: closed,
        qualificationEvidenceRecorded: false,
        nativeWorkflowQualified: false,
      };
    } catch (error) {
      let ledger: PresenceComparisonBudgetStatus | null = null;
      try {
        if (budgetId) {
          const failedBudgetId = budgetId;
          const status: PresenceComparisonBudgetStatus = await ctx.runQuery(
            internal.guardrails.evalBudgetStatus,
            { budgetId: failedBudgetId },
          );
          ledger = status;
          if (status.unsettledCount > 0 || status.breached) externalUnresolved = true;
          if (!status.closed && status.unsettledCount === 0 && !status.breached) {
            await ctx.runMutation(internal.guardrails.closeEvalBudget, { budgetId });
            ledger = await ctx.runQuery(internal.guardrails.evalBudgetStatus, {
              budgetId: failedBudgetId,
            });
          }
        }
      } catch {
        externalUnresolved = true;
      }
      try {
        if (claimed)
          await ctx.runMutation(recordRef, {
            runRef: args.runRef,
            event: externalUnresolved ? "opened" : "stopped",
            payload: {
              ...(budgetId ? { budgetId } : {}),
              outputCount: outputs.length,
              reconciliationRequired: externalUnresolved,
            },
          });
      } catch {
        externalUnresolved = true;
      }
      return {
        status: "stopped" as const,
        scope: "private-design-proposal-comparison" as const,
        runRef: args.runRef,
        budgetId: budgetId ?? null,
        outputs,
        ledger,
        reconciliationRequired: externalUnresolved,
        reason:
          error instanceof Error && /^(PRESENCE_COMPARISON_|EVAL_)[A-Z_]+$/.test(error.message)
            ? error.message
            : "PRESENCE_COMPARISON_PROVIDER_ERROR",
        qualificationEvidenceRecorded: false,
        nativeWorkflowQualified: false,
      };
    }
  },
});
