// EXTR-G — the Phase-3.8 backlog self-heal (Lane 3): a one-shot governed sweep over the
// pre-existing `pending_extraction` rows plus the user-facing Retry mutation. DEFAULT runtime.
//
// The sweep is a @convex-dev/migrations migration (OPSG-06: resumable + batched, never an
// ad-hoc backfill) defined against the installed `migrations` instance. Both sites here route
// through `vault.scheduleExtraction` — the ONE scheduling decision (Phase 15.2) — so neither can
// reintroduce the "unrecognized MIME → schedule nothing" skip that stranded a .xlsm for 20 hours.
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
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { tenantMutation } from "./lib/functions";
import { migrations } from "./migrations";
import { scheduleExtraction } from "./vault";

/** Sweep every eligible pending_extraction row onto its extraction rail (EXTR-G). */
export const sweepPendingExtraction = migrations.define({
  table: "vaultDocuments",
  migrateOne: async (ctx, doc) => {
    // Guard chain: only pending rows with stored bytes. Those two guards SCOPE the sweep and are
    // correct. What was deleted is the third one — "and a recognized extraction kind" — because
    // leaving unrecognized formats storage-only is precisely what stranded the .xlsm, and dropping
    // it is what makes this sweep the recovery mechanism for that row rather than the thing that
    // skips it again. ready/processing/failed/extracting rows are untouched; a swept row stays
    // pending_extraction here — the action flips it to `extracting` when work actually starts.
    if (doc.status !== "pending_extraction" || !doc.storageId) return;
    await scheduleExtraction(ctx, {
      vaultDocId: doc._id,
      tenantId: doc.tenantId,
      mimeType: doc.mimeType,
      title: doc.title,
    });
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
    // NOTE: there is deliberately no "unrecognized mime → { ok: false }" refusal any more. It was
    // the worst of the three skips: the user PRESSED A BUTTON and nothing observable happened.
    // The three refusals above are real (cross-tenant, wrong status, no stored bytes); an unknown
    // format is not a refusal, it is work the action must do and then fail honestly at.
    await ctx.db.patch(vaultDocId, {
      status: "pending_extraction",
      failureReason: undefined,
      extractionTruncated: undefined,
    });
    await scheduleExtraction(ctx, {
      vaultDocId,
      tenantId: ctx.tenantId,
      mimeType: doc.mimeType,
      title: doc.title,
    });
    return { ok: true };
  },
});

/**
 * The never-silent backstop for the two non-terminal statuses that never had one. Armed per
 * attempt by vault.scheduleExtraction at +EXTRACTION_WATCHDOG_MS.
 *
 * Idempotent by construction, exactly like vaultIngest.onIngestComplete: it flips ONLY a doc still
 * sitting in pending_extraction/extracting. A doc that succeeded (processing/ready) or failed for a
 * more specific reason is untouched — so a watchdog that fires one second after a success, or after
 * an honest unsupported_format, changes nothing. `processing` is deliberately NOT covered here:
 * onIngestComplete already guarantees it (the 2026-07-20 stranding fix), and two governors on one
 * status is how you get a flip war.
 *
 * ponytail: a scheduled function per attempt, NOT a cron + table scan. Convex durable scheduling is
 * the native feature (no new code, no timestamp field, no schema change), and it is per-attempt
 * correct where a `createdAt` cutoff is not: createdAt is UPLOAD time, so a Retry on a 20-hour-old
 * row would be killed the instant a createdAt-based cron ran. Upgrade path if pre-existing stranded
 * rows ever need automatic (not operator-triggered) recovery: a cron over runSweep — the sweep is
 * already resumable and batched.
 */
export const watchdogStalled = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }): Promise<null> => {
    const doc = await ctx.db.get(vaultDocId);
    if (doc?.status !== "pending_extraction" && doc?.status !== "extracting") return null;
    await ctx.runMutation(internal.vault.markFailed, { vaultDocId, reason: "extraction_stalled" });
    return null;
  },
});
