// The workflow-pack DISCOVERY plane (Phase 27, PACK-02/PACK-04) — what the workspace may offer, and
// what each offer can honestly see before it is taken.
//
// A DEFAULT-RUNTIME (V8) module on purpose. `workflowPackBinding.ts` is `"use node"` and may hold
// only actions, so the source probe used to be a private function inside it and the browser had no
// way to ask the same question. 27-09 moved the probe HERE and left the binding calling it, so the
// preflight a user is shown before a run and the preflight the model is told during it are the same
// resolution — not two implementations that agree until one of them is edited.
//
// ACTIVE-ONLY, ALWAYS. `listPacks` returns a pack only when its registry row is `active`. A
// candidate is invisible to ordinary discovery by construction, which is what keeps the pilot dark
// while it is being evaluated: the OWNER's preview path is `startWorkflowPack`'s `previewVersion`,
// checked server-side, and it never widens what this query returns.

import {
  DRIVE_READONLY_SCOPE,
  hasScope,
  MISSING_SOURCE_UNLOCK,
  PACK_SOURCE_LABEL,
  type PackSource,
  packPreflight,
  type ReachablePackSource,
  type SourceState,
  WORKFLOW_PACK_IDS,
  WORKFLOW_PACKS,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { ownerQuery, tenantQuery } from "./lib/functions";

/**
 * Resolve, IN CODE, which of this tenant's connection-gated planes can answer.
 *
 * ONLY the connection-gated planes are probed, deliberately. `vault` and `web` need no tenant grant
 * — an empty vault, or a search that finds nothing, is a result the tool itself reports and the body
 * already has to state honestly, so a second "is it empty" probe here would duplicate that at the
 * cost of a read on every run. What preflight is FOR is the gap a tool cannot report gracefully: a
 * mailbox, a Drive or a calendar that was never connected, which otherwise surfaces mid-run as a
 * tool error after the money is spent.
 *
 * `partial` means "the plane answered, with nothing in it". `packPreflight` counts only
 * `unavailable` as missing, so an empty calendar is not reported as a capability gap.
 *
 * The states this can return are declared in `PACK_SOURCE_PROBE_STATES` (@pikar/core) and
 * `workflowPacks.test.ts` scans this function to keep the two in step — a fixture or a UI that
 * expects a state this cannot produce is a whole class of assertion that could only ever fail.
 */
export async function probeSourcesFor(
  ctx: QueryCtx,
  tenantId: string,
): Promise<Partial<Record<ReachablePackSource, SourceState>>> {
  const [gmailConnected, token, calendarEvents, financeLine] = await Promise.all([
    ctx.runQuery(internal.gmailAuth.hasGmailConnection, { tenantId }),
    ctx.runQuery(internal.gmailAuth.getTokens, { tenantId }),
    ctx.runQuery(internal.calendarEvents.listManageable, { tenantId }),
    ctx.runQuery(internal.cash.financeSpineFor, { tenantId }),
  ]);
  // The SAME ordering `vaultDrive.ts` uses and for the same reason: a grant issued before the Drive
  // scope widening refreshes perfectly happily, so `connected` alone would report Drive readable to
  // a tenant every Drive call will 403.
  const driveReady = token !== null && hasScope(token.scope, DRIVE_READONLY_SCOPE);
  return {
    // No tenant grant gates either of these; emptiness is the tool's own honest answer.
    vault: "available",
    web: "available",
    inbox: gmailConnected ? "available" : "unavailable",
    drive: driveReady ? "available" : "unavailable",
    calendar: calendarEvents.events.length > 0 ? "available" : "partial",
    "finance-inputs": financeLine === null ? "unavailable" : "available",
  };
}

/** The binding's door to the probe. `internalQuery`, so a tenantId can never arrive from a client. */
export const probeSources = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => probeSourcesFor(ctx, tenantId),
});

/** One source, as the workspace renders it: what it IS, how it answered, and what would open it. */
export type PackSourceView = {
  source: PackSource;
  label: string;
  state: SourceState;
  /** Present only for a MATRIX-missing source — a runtime gap is a connection, not a capability. */
  unlock: string | null;
};

/**
 * The packs this tenant may start, each with the preflight the run will actually resolve.
 *
 * IT RETURNS THE PREFLIGHT, NOT A PROMISE. Every pack in this pilot has at least one matrix-missing
 * source (owner decision A), so a quick start that showed only a title would be offering work while
 * hiding the thing the user most needs to know about it. Showing the gap BEFORE the run is the
 * honest-partial contract's first half; the body saying it again in the output is the second.
 *
 * The probe runs ONCE for the whole list rather than per pack — the six specs read the same six
 * planes, and six identical probes would be six times the reads for one answer.
 */
export const listPacks = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const runtime = await probeSourcesFor(ctx, ctx.tenantId);

    const out = [];
    for (const packId of WORKFLOW_PACK_IDS) {
      const spec = WORKFLOW_PACKS[packId];
      // ACTIVE only. `by_name_status` with an exact status — never "newest row", which would
      // surface a candidate the moment one is published and undo the whole dark pilot.
      const active = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", spec.skillName).eq("status", "active"))
        .unique();
      if (active === null) continue;

      const flight = packPreflight(packId, runtime);
      const missingKnown = new Set<string>(flight.missingKnown);
      out.push({
        packId,
        title: spec.title,
        blurb: spec.blurb,
        // Sent AS THE USER's first message when Start is pressed — code-owned so six cards cannot
        // ask six subtly different questions of the same workflow.
        opener: spec.opener,
        output: spec.output,
        version: active.version,
        sources: flight.sources.map(
          ({ source, state }): PackSourceView => ({
            source,
            label: PACK_SOURCE_LABEL[source],
            state,
            unlock: missingKnown.has(source)
              ? MISSING_SOURCE_UNLOCK[source as keyof typeof MISSING_SOURCE_UNLOCK]
              : null,
          }),
        ),
        /** Unreadable in this workflow at all — announced up front so it can never be a surprise. */
        missingKnownCount: flight.missingKnown.length,
        /** Reachable in principle, not connected for this tenant. The fixable half. */
        missingRuntimeCount: flight.missingRuntime.length,
      });
    }
    return out;
  },
});

/**
 * THE OWNER'S CANDIDATE PREVIEW (27-11). Same shape as `listPacks`, `status: "candidate"` instead of
 * `"active"`, and `ownerQuery` rather than `tenantQuery`.
 *
 * IT EXISTS TO BREAK THE SAME DEADLOCK `startWorkflowPack`'s `previewVersion` was built for, and it
 * is the half that was missing. The pack gate needs browser evidence; browser evidence needs an
 * authenticated person to REACH the pack in a browser; `listPacks` is active-only by design and no
 * pack is active until the gate passes. `previewVersion` let the owner RUN a candidate; nothing let
 * them SEE one, so there was no surface to reach it from and the gate could not be satisfied by
 * anyone. Measured 2026-08-26: six packs with eval evidence, zero with browser evidence.
 *
 * IT DOES NOT WIDEN `listPacks`, DELIBERATELY. The dark pilot's guarantee is that ordinary discovery
 * shows nothing, and a `includeCandidates` argument on the shared query would be one argument away
 * from undoing it — for every tenant, from any caller. A separate owner-only query cannot be reached
 * by a non-owner at all: `ownerQuery` rejects before the handler reads anything.
 *
 * `version` here is the CANDIDATE's version and the caller must pass it back as `previewVersion`, so
 * the run pins the exact row the browser was shown. Without that pin the preview would run whatever
 * the newest row happened to be by the time the click landed.
 */
export const listPackCandidates = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const runtime = await probeSourcesFor(ctx, ctx.tenantId);

    const out = [];
    for (const packId of WORKFLOW_PACK_IDS) {
      const spec = WORKFLOW_PACKS[packId];
      // NEWEST candidate, NOT `.unique()`. `listPacks` can use `.unique()` because exactly one row
      // is ever `active`; a pack accumulates MANY candidate rows (sales-call-prep is on v11), so
      // `.unique()` throws, the query errors, and the section silently renders nothing. Measured —
      // the first browser run skipped every @preview test for exactly this reason.
      const rows = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", spec.skillName).eq("status", "candidate"))
        .collect();
      if (rows.length === 0) continue;
      const candidate = rows.reduce((a, b) => (b.version > a.version ? b : a));

      const flight = packPreflight(packId, runtime);
      const missingKnown = new Set<string>(flight.missingKnown);
      out.push({
        packId,
        title: spec.title,
        blurb: spec.blurb,
        opener: spec.opener,
        output: spec.output,
        version: candidate.version,
        sources: flight.sources.map(
          ({ source, state }): PackSourceView => ({
            source,
            label: PACK_SOURCE_LABEL[source],
            state,
            unlock: missingKnown.has(source)
              ? MISSING_SOURCE_UNLOCK[source as keyof typeof MISSING_SOURCE_UNLOCK]
              : null,
          }),
        ),
        missingKnownCount: flight.missingKnown.length,
        missingRuntimeCount: flight.missingRuntime.length,
      });
    }
    return out;
  },
});
