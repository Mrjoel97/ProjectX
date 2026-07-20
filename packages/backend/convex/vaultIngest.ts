// The durable knowledge-vault ingest pipeline (VALT-01).
//
// One `@convex-dev/workflow` per accepted searchable document, mirroring deliverApprovedPlan:
// store (the row already exists at status:processing when this starts) → embed → extract →
// upsertGraph → recordSpend → ready. `vault.ts`'s ingest mutations are this workflow's SOLE
// starters (the vault plane's zero-embed-before-accept invariant, mirroring executePlan).
//
// GOVERNANCE (reuses the guardrails/rate-limiter triad VERBATIM — no new guard path): a
// `preCall` gate runs BEFORE any spend; a governed stop (kill switch / daily budget) marks the
// row `failed` and RETURNS — it is NEVER a DLQ throw (a governed stop is not a failure;
// 03-RESEARCH anti-pattern 1). `recordSpend` consumes the actual embed + extract cost after.
//
// step.runAction (workpool default retries), NOT retrier.run — a workflow handler has no
// scheduler ctx (deliverApprovedPlan note). The extract/embed actions carry their own SMOKE::
// offline seams so convex-test drives the whole pipeline without a model/embedding network call.
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { workflow } from "./index";

/**
 * The SOLE way to start an ingest workflow. Wraps `workflow.start` with the `onComplete` that marks
 * the doc `failed` if the run dies — so a stranded ingest can NEVER sit at "processing" forever (the
 * bug: five start sites, none passed onComplete, so a step failure left the row spinning with no
 * error). Every caller (vault.ts × 4, voice.ts × 1) routes through here; a new call site cannot
 * reintroduce the omission. `context` carries refs only (§4).
 */
export async function startIngest(
  ctx: MutationCtx,
  {
    vaultDocId,
    tenantId,
    correlationId,
  }: { vaultDocId: Id<"vaultDocuments">; tenantId: string; correlationId: string },
): Promise<void> {
  await workflow.start(
    ctx,
    internal.vaultIngest.ingestDoc,
    { vaultDocId, tenantId, correlationId },
    {
      onComplete: internal.vaultIngest.onIngestComplete,
      context: { tenantId, vaultDocId, correlationId },
    },
  );
}

/**
 * Ingest workflow terminal hook. Success needs nothing (the `markReady` step already ran). A
 * failed/canceled run — a step that exhausted its retries, or a backend interruption — MUST NOT
 * leave the doc at "processing": mark it `failed` so the UI stops spinning and a retry can be
 * offered. Idempotent: only flips a doc still in "processing" (a success that raced here is
 * untouched). The reason is a refs-only code label — the full error stays in the workflow log (§4).
 */
export const onIngestComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({
      tenantId: v.string(),
      vaultDocId: v.id("vaultDocuments"),
      correlationId: v.string(),
    }),
  },
  handler: async (ctx, { result, context }): Promise<null> => {
    if (result.kind === "success") return null;
    const doc = await ctx.db.get(context.vaultDocId);
    if (doc?.status !== "processing") return null; // gone / already terminal — never re-flip
    await ctx.runMutation(internal.vault.markFailed, {
      vaultDocId: context.vaultDocId,
      reason: result.kind === "failed" ? "ingest_failed" : "ingest_canceled",
    });
    return null;
  },
});

/**
 * Recover docs stranded at "processing" with no embedded entry — an ingest whose run died before
 * this failure-handling existed (or was interrupted). Re-starts ingest for each; the fresh run's
 * onComplete now marks it `failed` if it dies again, so nothing strands twice. `olderThanMs` skips
 * docs whose ingest may still be legitimately in flight. Operational recovery + the retry primitive.
 * ponytail: full table scan (no by_status index) — fine for an occasional ops sweep, not a hot path.
 */
export const retryStuckIngests = internalMutation({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, { olderThanMs }): Promise<{ requeued: number }> => {
    const cutoff = Date.now() - (olderThanMs ?? 60_000);
    const docs = await ctx.db.query("vaultDocuments").collect();
    let requeued = 0;
    for (const d of docs) {
      if (d.status !== "processing" || d.ragEntryId || d.createdAt > cutoff) continue;
      await startIngest(ctx, {
        vaultDocId: d._id,
        tenantId: d.tenantId,
        correlationId: crypto.randomUUID(),
      });
      requeued++;
    }
    return { requeued };
  },
});

export const ingestDoc = workflow.define({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    tenantId: v.string(),
    correlationId: v.string(),
  },
  handler: async (step, { vaultDocId, tenantId }): Promise<null> => {
    // (1) Governed gate BEFORE any spend. A kill-switch / daily-budget stop marks the row failed
    // and returns — the governed stop halts ingest, never a DLQ throw (kill switch stops it).
    const gate = await step.runMutation(internal.guardrails.preCall, {});
    if (!gate.ok) {
      await step.runMutation(internal.vault.markFailed, { vaultDocId, reason: gate.reason });
      return null;
    }

    // (2) Embed the redacted text (rag.add, hash-dedup) → entryId + cost.
    const embed = await step.runAction(internal.vaultRag.embedDoc, { vaultDocId, tenantId });

    // (3) Extract typed entities + relationships from the redacted text (redact-then-extract, §4).
    const graph = await step.runAction(internal.vaultLlm.extractGraph, { vaultDocId, tenantId });

    // (4) Upsert the graph with cross-doc dedup + degree bookkeeping (sourceDocId = this doc).
    await step.runMutation(internal.vaultGraph.upsertGraph, {
      tenantId,
      sourceDocId: vaultDocId,
      nodes: graph.nodes,
      edges: graph.edges,
    });

    // (5) Consume the ACTUAL spend against the global daily window (embed + extract).
    await step.runMutation(internal.guardrails.recordSpend, {
      costUsd: embed.costUsd + graph.costUsd,
    });

    // (6) Terminal: the doc is embedded + extracted → groundable.
    await step.runMutation(internal.vault.markReady, { vaultDocId, ragEntryId: embed.entryId });
    return null;
  },
});
