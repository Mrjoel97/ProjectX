// EXTR-G — the Phase-3.8 backlog self-heal (Lane 3): a one-shot governed sweep over the
// pre-existing `pending_extraction` rows plus the user-facing Retry mutation. DEFAULT runtime.
//
// The sweep is a @convex-dev/migrations migration (OPSG-06: resumable + batched, never an
// ad-hoc backfill) defined against the installed `migrations` instance. It schedules the
// Wave-0-frozen stub NAMES (internal.vaultExtract.extractDoc / internal.vaultTranscribe
// .transcribeDoc) by extractionKindFor — zero imports from the Lane 1/4 modules.
//
// Governance: each scheduled extractDoc/transcribeDoc self-gates via guardrails.preCall
// (kill switch + daily budget) before doing any work, so a large backlog self-throttles to
// the daily budget and the kill switch stops the sweep mid-flight — no separate sweep
// rate-limit config needed.
// ponytail: default batch size 100 — a genuinely huge backlog would burst-schedule one
// batch of actions at once; per-batch runAfter stagger is the upgrade path (beta backlog
// is expected to be tiny).
//
// Operator one-shot (03.8-06 runs this post-merge on main's deployment):
//   npx convex run vaultSweep:runSweep
import { extractionKindFor } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { tenantMutation } from "./lib/functions";
import { migrations } from "./migrations";

/** Sweep every eligible pending_extraction row onto its extraction rail (EXTR-G). */
export const sweepPendingExtraction = migrations.define({
  table: "vaultDocuments",
  migrateOne: async (ctx, doc) => {
    // Guard chain: only pending rows with stored bytes and a recognized extraction kind.
    // Unrecognized formats (e.g. application/zip) stay storage-only; ready/processing/
    // failed/extracting rows are untouched. The row stays pending_extraction here — the
    // action flips it to `extracting` when work actually starts (honest pill).
    if (doc.status !== "pending_extraction" || !doc.storageId) return;
    const kind = extractionKindFor(doc.mimeType, doc.title);
    if (kind === null) return;
    await ctx.scheduler.runAfter(
      0,
      kind === "transcribe"
        ? internal.vaultTranscribe.transcribeDoc
        : internal.vaultExtract.extractDoc,
      { vaultDocId: doc._id, tenantId: doc.tenantId },
    );
  },
});

/** The operator one-shot runner (migrations.ts `run` precedent, bound to this migration). */
export const runSweep = migrations.runner(internal.vaultSweep.sweepPendingExtraction);

/**
 * Manual Retry (the failed-badge affordance, card AND detail panel). Owner tenant only
 * (fail-closed no-op on cross-tenant/missing); only `failed` or stuck `pending_extraction`
 * docs; resets to pending_extraction, clears failureReason + extractionTruncated, and
 * re-schedules the kind-correct action. Returns refs only.
 */
export const retryExtraction = tenantMutation({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }): Promise<{ ok: boolean }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return { ok: false }; // owner guard, fail-closed
    if (doc.status !== "failed" && doc.status !== "pending_extraction") return { ok: false };
    if (!doc.storageId) return { ok: false }; // nothing stored to extract from
    const kind = extractionKindFor(doc.mimeType, doc.title);
    if (kind === null) return { ok: false }; // no rail to schedule
    await ctx.db.patch(vaultDocId, {
      status: "pending_extraction",
      failureReason: undefined,
      extractionTruncated: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      kind === "transcribe"
        ? internal.vaultTranscribe.transcribeDoc
        : internal.vaultExtract.extractDoc,
      { vaultDocId, tenantId: ctx.tenantId },
    );
    return { ok: true };
  },
});
