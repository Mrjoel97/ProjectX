"use node";

import type { DataProfile } from "@pikar/core/dataProfile";
// Native leaf binding: registry body, existing loop, code-owned tools, existing artifact writer.
import {
  toolsForVerticalWorkflow,
  VERTICAL_IDS,
  VERTICAL_PACKS,
  type VerticalId,
} from "@pikar/core/verticalPacks";
import { scanText } from "@pikar/pii";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import type { EvalContext, ImageInput } from "./lib/evalBudgetModel";
import { traced } from "./lib/foglamp";
import { contentHash } from "./lib/hash";
import { runSpecialistTurn, saveMarkdownDocument } from "./llm";
import { outcomeFor } from "./workflowPackBinding";

const runArgs = {
  tenantId: v.string(),
  verticalId: v.union(...VERTICAL_IDS.map((id) => v.literal(id))),
  threadId: v.string(),
  planId: v.id("plans"),
  text: v.string(),
  runId: v.string(),
  previewVersion: v.optional(v.number()),
  sourceDocId: v.optional(v.id("vaultDocuments")),
};
type RunArgs = {
  tenantId: string;
  verticalId: VerticalId;
  threadId: string;
  planId: Id<"plans">;
  text: string;
  runId: string;
  previewVersion?: number;
  sourceDocId?: Id<"vaultDocuments">;
};
export type VerticalRunResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      reply: string;
      outcome: "useful" | "partial";
      version: number;
      artifactId?: Id<"vaultDocuments">;
      facts: VerticalRunFacts;
    };

/** Internal observations, not a semantic score or a release receipt. No model/source content. */
export type VerticalRunFacts = {
  schemaVersion: 1;
  runHash: string;
  inputSha256: string;
  planId: Id<"plans">;
  candidateId: string;
  candidateVersion: number;
  candidateBodySha256: string;
  execution: "scripted" | "model";
  configuredModelId: string;
  configuredFallbackModelId: string;
  actualModelId: string;
  modelCostUsd: number;
  costScope:
    | "returned_model_cost_excludes_unobserved_tool_subcalls"
    | "reserved_fixed_source_model_calls";
  attemptedAllowedTools: Record<string, number>;
  completedAllowedTools: Record<string, number>;
  ungrantedToolAttemptCount: number;
  truncated: boolean;
  grounding: "deterministic_dataset" | "owned_image_input" | "vault_excerpt" | "none";
  visualSource?: { docId: Id<"vaultDocuments">; sha256: string };
  dataSource?: { docId: Id<"vaultDocuments">; sha256: string };
  artifactId?: Id<"vaultDocuments">;
  artifactContentSha256?: string;
};

export function verticalToolFacts(
  allowed: readonly string[],
  attempted: readonly string[],
  completed: readonly { tool: string }[],
) {
  return {
    attemptedAllowedTools: Object.fromEntries(
      allowed.map((tool) => [tool, attempted.filter((name) => name === tool).length]),
    ),
    completedAllowedTools: Object.fromEntries(
      allowed.map((tool) => [tool, completed.filter((result) => result.tool === tool).length]),
    ),
    // Unknown model-authored names stay out of the refs/counts-only result.
    ungrantedToolAttemptCount: attempted.filter((name) => !allowed.includes(name)).length,
  };
}

/** Inspect the trusted tool result, not the model's claim that it consulted a source. */
export function hasRetrievedVerticalSource(
  outputs: readonly { tool: string; output: unknown }[],
): boolean {
  return outputs.some(({ tool, output }) => {
    if (tool !== "searchVault" || typeof output !== "string") return false;
    const context = /^<vault_context [^>]+>\n([\s\S]*?)\n<\/vault_context>/.exec(output)?.[1];
    return (
      context !== undefined &&
      /\]\n\S/.test(context) &&
      /Grounded in [1-9]\d* document\(s\)/.test(output)
    );
  });
}

export function verticalOutcomeFor(
  result: Parameters<typeof outcomeFor>[0] & { artifactSaved: boolean },
): "useful" | "partial" {
  return result.artifactSaved && outcomeFor(result) === "useful" ? "useful" : "partial";
}

async function runVertical(
  ctx: ActionCtx,
  args: RunArgs,
  mockScript?: { primary: unknown[] },
  evalContext?: EvalContext,
  evalProof?: { bodyHash: string; source?: { docId: Id<"vaultDocuments">; hash: string } },
): Promise<VerticalRunResult> {
  const plan = await ctx.runQuery(internal.plans.getById, { planId: args.planId });
  if (!plan || plan.tenantId !== args.tenantId || plan.threadId !== args.threadId)
    return { ok: false, reason: "not-found" };
  // Recheck at the actual start, including exact-version preview: a disable after the UI query wins.
  const ready = await ctx.runQuery(internal.verticalPacks.prepare, {
    tenantId: args.tenantId,
    verticalId: args.verticalId,
    previewVersion: args.previewVersion,
  });
  if (!ready.ok) return ready;
  const eventBase = {
    tenantId: args.tenantId,
    verticalId: args.verticalId,
    candidateId: ready.skillId,
    preview: args.previewVersion !== undefined,
  };
  let profile: DataProfile | undefined;
  let visualInput: ImageInput | undefined;
  let visualSource: VerticalRunFacts["visualSource"];
  if (args.verticalId === "design") {
    const sourceDocId = evalProof
      ? evalProof.source?.docId
      : (args.sourceDocId ?? ready.visualSourceId);
    if (!sourceDocId) return { ok: false, reason: "missing-source" };
    try {
      const source = await ctx.runAction(internal.verticalVisual.readOwnedScreenshot, {
        tenantId: args.tenantId,
        sourceDocId,
        ...(evalProof?.source ? { expectedSha256: evalProof.source.hash } : {}),
      });
      visualInput = { bytes: source.bytes, mimeType: source.mimeType };
      visualSource = { docId: source.sourceDocId, sha256: source.sha256 };
    } catch {
      if (evalProof) throw new Error("VERTICAL_EVAL_SOURCE_UNAVAILABLE");
      return { ok: false, reason: "missing-source" };
    }
  }
  if (args.verticalId === "data") {
    const sourceDocId = evalProof
      ? evalProof.source?.docId
      : (args.sourceDocId ?? ready.dataSourceId);
    if (!sourceDocId) return { ok: false, reason: "missing-source" };
    try {
      profile = await ctx.runAction(internal.verticalData.profileOwnedDataset, {
        tenantId: args.tenantId,
        sourceDocId,
      });
      if (evalProof?.source && profile.source.contentHash !== evalProof.source.hash)
        throw new Error("VERTICAL_EVAL_SOURCE_CHANGED");
    } catch {
      if (evalProof) throw new Error("VERTICAL_EVAL_SOURCE_UNAVAILABLE");
      await ctx.runMutation(internal.verticalPackTelemetry.record, {
        ...eventBase,
        event: "blocked",
        reason: "missing_source",
      });
      return { ok: false, reason: "missing-source" };
    }
  }
  const budget = await ctx.runMutation(internal.guardrails.preCall, { tenantId: args.tenantId });
  if (!budget.ok) return { ok: false, reason: "budget-paused" };
  const startedAt = Date.now();
  const allowedTools = toolsForVerticalWorkflow(VERTICAL_PACKS[args.verticalId].workflowId);
  try {
    const res = await traced(
      {
        agentName: "vertical-pack",
        workflowName: "vertical-pack-run",
        workflowRunId: args.runId,
        sessionId: args.threadId,
      },
      () =>
        runSpecialistTurn(ctx, {
          tenantId: args.tenantId,
          planId: args.planId,
          threadId: args.threadId,
          turnId: args.runId,
          skillName: ready.name,
          skillVersions: { [ready.name]: ready.version },
          toolNames: [...allowedTools],
          prompt: [
            profile === undefined
              ? ""
              : `Deterministic dataset profile (only source for numeric claims):\n${JSON.stringify(profile)}`,
            ready.playbookText
              ? `<tenant_legal_playbook informational="true">\n${ready.playbookText}\n</tenant_legal_playbook>`
              : "",
            "User request:",
            args.text,
          ]
            .filter(Boolean)
            .join("\n\n"),
          ...(mockScript ? { mockScript } : {}),
          ...(evalContext ? { evalContext } : {}),
          ...(evalProof ? { expectedSkillBodyHash: evalProof.bodyHash } : {}),
          ...(visualInput ? { visualInput } : {}),
        }),
    );
    let artifactId: Id<"vaultDocuments"> | undefined;
    if (res.saveRequest && res.reply.trim()) {
      const title = scanText(res.saveRequest.title);
      artifactId = await saveMarkdownDocument(ctx, {
        tenantId: args.tenantId,
        threadId: args.threadId,
        planId: args.planId,
        title: (title.ok ? title.value.safeText.trim() : "") || "Workflow draft",
        markdown: res.reply,
      });
      await ctx.runMutation(internal.verticalPackTelemetry.record, {
        ...eventBase,
        event: "artifact_created",
        artifactId,
      });
    }
    const grounded =
      profile !== undefined ||
      visualSource !== undefined ||
      hasRetrievedVerticalSource(res.toolOutputs);
    const outcome = verticalOutcomeFor({
      ...res,
      runtimeMissing: grounded ? 0 : 1,
      artifactSaved: artifactId !== undefined,
    });
    await ctx.runMutation(internal.verticalPackTelemetry.record, {
      ...eventBase,
      event: "run_completed",
      outcome,
      ...(artifactId ? { artifactId } : {}),
      costBucket:
        res.costUsd === 0
          ? "zero"
          : res.costUsd < 1
            ? "under_one_dollar"
            : res.costUsd <= 5
              ? "one_to_five_dollars"
              : "over_five_dollars",
      latencyBucket:
        Date.now() - startedAt < 60_000
          ? "under_minute"
          : Date.now() - startedAt < 300_000
            ? "one_to_five_minutes"
            : "over_five_minutes",
    });
    return {
      ok: true,
      reply: res.reply,
      outcome,
      version: ready.version,
      ...(artifactId ? { artifactId } : {}),
      facts: {
        schemaVersion: 1,
        runHash: await contentHash(args.runId),
        inputSha256: await contentHash(args.text),
        planId: args.planId,
        candidateId: res.skillId,
        candidateVersion: res.skillVersion,
        candidateBodySha256: res.skillBodyHash,
        execution: mockScript ? "scripted" : "model",
        configuredModelId: res.modelId,
        configuredFallbackModelId: res.fallbackModelId,
        actualModelId: res.actualModelId,
        modelCostUsd: res.costUsd,
        costScope: evalContext
          ? "reserved_fixed_source_model_calls"
          : "returned_model_cost_excludes_unobserved_tool_subcalls",
        ...verticalToolFacts(allowedTools, res.toolTrace, res.toolOutputs),
        truncated: res.truncated,
        grounding:
          profile !== undefined
            ? "deterministic_dataset"
            : visualSource
              ? "owned_image_input"
              : grounded
                ? "vault_excerpt"
                : "none",
        ...(visualSource ? { visualSource } : {}),
        ...(profile
          ? {
              dataSource: {
                docId: profile.source.fileId as Id<"vaultDocuments">,
                sha256: profile.source.contentHash,
              },
            }
          : {}),
        ...(artifactId ? { artifactId, artifactContentSha256: await contentHash(res.reply) } : {}),
      },
    };
  } catch (error) {
    await ctx.runMutation(internal.verticalPackTelemetry.record, {
      ...eventBase,
      event: "run_completed",
      outcome: "failed",
    });
    throw error;
  }
}

export const run = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<VerticalRunResult> => runVertical(ctx, args),
});
/** Same binding; only the paid model is replaced for offline authority and outcome regression tests. */
export const __runWithScript = internalAction({
  args: { ...runArgs, primary: v.array(v.any()) },
  handler: async (ctx, args): Promise<VerticalRunResult> =>
    runVertical(ctx, args, { primary: args.primary }),
});

const evaluationArgs = {
  runId: v.string(),
  caseId: v.string(),
  caseHash: v.string(),
  verticalId: runArgs.verticalId,
  candidateVersion: v.number(),
  bodyHash: v.string(),
  budgetId: v.id("spendEvents"),
  text: v.string(),
};
type EvaluationArgs = {
  runId: string;
  caseId: string;
  caseHash: string;
  verticalId: VerticalId;
  candidateVersion: number;
  bodyHash: string;
  budgetId: Id<"spendEvents">;
  text: string;
};
export type VerticalEvaluationResult = {
  result: VerticalRunResult;
  caseBinding: {
    tenantId: string;
    threadId: string;
    planId: Id<"plans">;
    candidateId: Id<"skills">;
    candidateVersion: number;
    bodyHash: string;
    requestHash: string;
  };
  caseHash: string;
  inputSha256: string;
  sourceMode: "fixed-owned-fixtures";
  sourceReads: { docId: string; chunkHash: string }[];
  budget: {
    budgetId: Id<"spendEvents">;
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
  releaseEvidenceRecorded: false;
};

async function runEvaluation(
  ctx: ActionCtx,
  args: EvaluationArgs,
  mockScript?: { primary: unknown[] },
): Promise<VerticalEvaluationResult> {
  const { budgetId, text, ...identity } = args;
  const pin = { ...identity, requestHash: await contentHash(text) };
  if (new TextEncoder().encode(text).byteLength > 32 * 1024)
    throw new Error("VERTICAL_EVAL_REQUEST_LIMIT");
  const provision = await ctx.runQuery(internal.verticalEvalSources.verifyCase, pin);
  let primarySource: { docId: Id<"vaultDocuments">; hash: string } | undefined;
  if (args.verticalId === "data" || args.verticalId === "design") {
    for (const source of provision.sourceRefs) {
      const meta = await ctx.runQuery(internal.vault.getDocForExtraction, {
        tenantId: provision.tenantId,
        vaultDocId: source.docId,
      });
      const eligible =
        args.verticalId === "design"
          ? ["image/png", "image/jpeg"].includes(meta.mimeType)
          : [
              "text/csv",
              "application/csv",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ].includes(meta.mimeType);
      if (!eligible) continue;
      if (primarySource) throw new Error("VERTICAL_EVAL_SOURCE_AMBIGUOUS");
      primarySource = { docId: source.docId, hash: source.hash };
    }
  }
  const sourceReads = new Map<string, { docId: string; chunkHash: string }>();
  const evalContext: EvalContext = {
    budgetId,
    retrieveSources: async () => {
      // Revalidate the immutable provision and current tenant/seal/hash state on every tool call.
      const current = await ctx.runQuery(internal.verticalEvalSources.verifyCase, pin);
      const docIds: string[] = [];
      const titles: string[] = [];
      const origins: string[] = [];
      const chunks: string[] = [];
      for (const source of current.sourceRefs) {
        const meta = await ctx.runQuery(internal.vault.getDocForExtraction, {
          tenantId: current.tenantId,
          vaultDocId: source.docId,
        });
        // Dataset bytes and pixels have their own deterministic/multimodal paths, never fake text.
        if (meta.mimeType !== "text/plain") continue;
        const doc = await ctx.runQuery(internal.vault.getDoc, {
          tenantId: current.tenantId,
          vaultDocId: source.docId,
        });
        if ((await contentHash(doc.text)) !== source.hash)
          throw new Error("VERTICAL_EVAL_SOURCE_CHANGED");
        if (!doc.text.trim() || new TextEncoder().encode(doc.text).byteLength > 32 * 1024)
          throw new Error("VERTICAL_EVAL_SOURCE_LIMIT");
        docIds.push(source.docId);
        titles.push(source.ref);
        origins.push("fixed-source-evaluation");
        chunks.push(doc.text);
      }
      return { docIds, titles, origins, chunks };
    },
    onSources: (sources) => {
      for (const source of sources) sourceReads.set(`${source.docId}:${source.chunkHash}`, source);
    },
  };
  const result = await runVertical(
    ctx,
    {
      tenantId: provision.tenantId,
      threadId: provision.threadId,
      planId: provision.planId,
      verticalId: args.verticalId,
      previewVersion: args.candidateVersion,
      runId: args.runId,
      text,
    },
    mockScript,
    evalContext,
    { bodyHash: pin.bodyHash, ...(primarySource ? { source: primarySource } : {}) },
  );
  // A case whose governing candidate or sources changed during execution is not valid evidence.
  await ctx.runQuery(internal.verticalEvalSources.verifyCase, pin);
  return {
    result,
    caseBinding: {
      tenantId: provision.tenantId,
      threadId: provision.threadId,
      planId: provision.planId,
      candidateId: provision.candidateId,
      candidateVersion: pin.candidateVersion,
      bodyHash: pin.bodyHash,
      requestHash: pin.requestHash,
    },
    caseHash: args.caseHash,
    inputSha256: await contentHash(text),
    sourceMode: "fixed-owned-fixtures" as const,
    sourceReads: [...sourceReads.values()],
    budget: await ctx.runQuery(internal.guardrails.evalBudgetStatus, { budgetId }),
    // These runtime facts still require case assertions and semantic review. Nothing records a pass.
    releaseEvidenceRecorded: false as const,
  };
}

export const evaluateCase = internalAction({
  args: evaluationArgs,
  handler: async (ctx, args): Promise<VerticalEvaluationResult> => runEvaluation(ctx, args),
});

export const __evaluateCaseWithScript = internalAction({
  args: { ...evaluationArgs, primary: v.array(v.any()) },
  handler: async (ctx, { primary, ...args }): Promise<VerticalEvaluationResult> =>
    runEvaluation(ctx, args, { primary }),
});
