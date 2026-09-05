// Goal Engine v0 — "the agenda speaks" (Phase 34, G13, ADR-033).
//
// PROPOSE-ONLY. The weekly review folds its gaps into the agenda and stages the top open one
// through the SAME `applyActOnGap` the review card's "Act on this" button uses, so the proposal
// lands on the same approvals surface behind the same Approve gate. Nothing here sends, schedules
// or recurs beyond the existing Monday cron; the agent still writes no goal (living-map §10).
//
// Thin adapter (CLAUDE.md §1): the lifecycle rules are `@pikar/core`'s `agenda.ts`.
import {
  AGENDA_LIMIT,
  type AgendaStatus,
  agendaStatusFromPlan,
  REVIEW_THREAD_ID,
  segmentForRoute,
} from "@pikar/core";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { applyActOnGap } from "./evaluations";
import { syncAgenda } from "./lib/agenda";
import { tenantMutation, tenantQuery } from "./lib/functions";

/**
 * The cron's hop, called by `proactiveReview.reviewOne` right after the review row is written.
 * Explicit `tenantId` — the cron has no ctx.auth (the recordScorecardAnswerInternal convention).
 * Returns whether ONE proposal was staged, which is what the review's notification says.
 */
export const syncFromReview = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<{ staged: boolean }> => {
    const [latest, previous] = await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", tenantId).eq("threadId", REVIEW_THREAD_ID),
      )
      .order("desc")
      .take(2);
    if (!latest) return { staged: false };
    const gapIndex = await syncAgenda(ctx, tenantId, latest, previous?.createdAt ?? null);
    if (gapIndex === null) return { staged: false };
    // `plan_busy` (a send in flight on the review thread) leaves the row `open`; next Monday retries.
    const res = await applyActOnGap(ctx, tenantId, REVIEW_THREAD_ID, gapIndex);
    return { staged: res.ok };
  },
});

export type AgendaItem = {
  key: string;
  label: string;
  reason: string | null;
  proofMetric: string | null;
  status: AgendaStatus;
  /** Index into the latest review's gaps[] — what `evaluations.actOnGap` takes. */
  gapIndex: number;
  /** Titles of the documents the review grounded itself in — the tenant's own titles. */
  citations: string[];
  /** The active goal this gap blocks, if one is anchored on the gap's segment. The user's own text. */
  goal: string | null;
};
export type AgendaAsk = { section: string; needs: string };
export type AgendaView = { reviewedAt: number; items: AgendaItem[]; asks: AgendaAsk[] };

/**
 * The Command Center's read: at most AGENDA_LIMIT rows — the current review's gaps that are not
 * dismissed (lowest leverage rank first), then the review's own "not enough data" asks to fill the
 * remaining slots (the progressive interview: each ask is a question the cockpit's
 * `recordScorecardAnswer` tool stores with provenance).
 *
 * A `proposed` row reports what its plan row says TODAY (approved on a Tuesday reads "acted", not
 * "awaiting" until Monday's sync persists it). `null` = no weekly review has run yet.
 */
export const current = tenantQuery({
  args: {},
  handler: async (ctx): Promise<AgendaView | null> => {
    const latest = await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("threadId", REVIEW_THREAD_ID),
      )
      .order("desc")
      .first();
    if (!latest) return null;
    const rows = await ctx.db
      .query("agenda")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const goals = await ctx.db
      .query("goals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
      .collect();
    const citations = [...new Set(latest.findings.map((f) => f.citationTitle))].slice(
      0,
      AGENDA_LIMIT,
    );
    const items: AgendaItem[] = [];
    const currentRows = rows
      .filter((r) => r.lastSeenAt === latest.createdAt && r.status !== "dismissed")
      .sort((a, b) => a.leverageRank - b.leverageRank)
      .slice(0, AGENDA_LIMIT);
    for (const row of currentRows) {
      let status: AgendaStatus = row.status;
      if (status === "proposed" && row.planId) {
        const plan = await ctx.db.get(row.planId);
        status = (plan && agendaStatusFromPlan(plan.status)) || status;
      }
      if (status === "dismissed") continue;
      const gap = latest.gaps[row.gapIndex];
      const segment = segmentForRoute(row.route);
      items.push({
        key: row.key,
        label: row.label,
        reason: gap?.reason ?? null,
        proofMetric: gap?.proofMetric ?? null,
        status,
        gapIndex: row.gapIndex,
        citations,
        goal: (segment && goals.find((g) => g.segmentId === segment)?.text) || null,
      });
    }
    const asks = latest.notEnoughData.slice(0, Math.max(0, AGENDA_LIMIT - items.length));
    return { reviewedAt: latest.createdAt, items, asks };
  },
});

/**
 * "Not this one." Holds until the gap closes and comes back (core's `nextAgendaStatus`). A row
 * whose proposal is waiting at the gate is answered THERE — Approve or Discard — never here.
 */
export const dismiss = tenantMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ ok: boolean }> => {
    const row = await ctx.db
      .query("agenda")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", ctx.tenantId).eq("key", key))
      .unique();
    if (!row || row.status === "proposed") return { ok: false };
    await ctx.db.patch(row._id, { status: "dismissed", statusChangedAt: Date.now() });
    return { ok: true };
  },
});
