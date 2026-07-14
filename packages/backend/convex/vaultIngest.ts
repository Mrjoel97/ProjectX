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
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { workflow } from "./index";

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
