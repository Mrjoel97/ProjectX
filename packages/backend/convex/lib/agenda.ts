// Goal Engine v0 (Phase 34, ADR-033) — the agenda's DB helpers. Plain functions over a MutationCtx
// so `evaluations.ts` (which owns `applyActOnGap`) and `agenda.ts` (which calls it unprompted) can
// both import this without importing each other.
//
// Every read is by `by_tenant` / `by_tenant_key` with the tenantId the CALLER validated — these run
// from the cron path, where there is no ctx.auth (the proactiveReview convention).
import {
  type AgendaStatus,
  agendaStatusFromPlan,
  gapKey,
  nextAgendaStatus,
  REVIEW_THREAD_ID,
} from "@pikar/core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Statuses the weekly review may stage unprompted. `proposed` is waiting; `dismissed` is the user's word. */
const STAGEABLE: ReadonlySet<AgendaStatus> = new Set(["open", "recurring"]);

const rowsFor = (ctx: MutationCtx, tenantId: string) =>
  ctx.db
    .query("agenda")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();

/**
 * Fold the latest review into the agenda. Returns the gapIndex the review should stage — the
 * lowest-rank gap whose row is open or recurring — or null when nothing may be staged.
 *
 * `previousAt` is the createdAt of the review BEFORE `latest` (null on a first review). A row last
 * seen before that instant was absent for at least one review — which is what "came back" means.
 */
export async function syncAgenda(
  ctx: MutationCtx,
  tenantId: string,
  latest: Doc<"evaluations">,
  previousAt: number | null,
): Promise<number | null> {
  const rows = await rowsFor(ctx, tenantId);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const now = Date.now();
  // 1. What the plan row says about a pending proposal: approved → acted, discarded → dismissed.
  for (const row of rows) {
    if (row.status !== "proposed" || !row.planId) continue;
    const plan = await ctx.db.get(row.planId);
    const settled = plan ? agendaStatusFromPlan(plan.status) : null;
    if (settled) {
      await ctx.db.patch(row._id, { status: settled, statusChangedAt: now });
      row.status = settled;
    }
  }
  // 2. Every gap the latest review lists: insert or transition, and pick the one to stage.
  let stage: { gapIndex: number; leverageRank: number } | null = null;
  for (const [gapIndex, gap] of latest.gaps.entries()) {
    const key = gapKey(gap);
    const prev = byKey.get(key);
    const cameBack = prev !== undefined && previousAt !== null && prev.lastSeenAt < previousAt;
    const status = nextAgendaStatus(prev?.status ?? null, cameBack);
    if (prev) {
      await ctx.db.patch(prev._id, {
        status,
        gapIndex,
        label: gap.label,
        leverageRank: gap.leverageRank,
        lastSeenAt: latest.createdAt,
        ...(status === prev.status ? {} : { statusChangedAt: now }),
      });
    } else {
      await ctx.db.insert("agenda", {
        tenantId,
        key,
        label: gap.label,
        route: gap.route,
        playbook: gap.playbook,
        leverageRank: gap.leverageRank,
        status,
        gapIndex,
        firstSeenAt: now,
        lastSeenAt: latest.createdAt,
        statusChangedAt: now,
      });
    }
    if (STAGEABLE.has(status) && (stage === null || gap.leverageRank < stage.leverageRank))
      stage = { gapIndex, leverageRank: gap.leverageRank };
  }
  return stage?.gapIndex ?? null;
}

/**
 * A gap on the REVIEW thread was just staged (by the cron, the review card's "Act on this", or
 * the Command Center) — record it as `proposed` under its plan. Off the review thread there is no
 * agenda, so this is a no-op. Upserts, because "Act on this" can run before any Monday sync has
 * created the row.
 *
 * The demotion loop below was written when the review thread had ONE plan row that `applyActOnGap`
 * recycled: any OTHER agenda row still `proposed` under the same planId had lost its memo the
 * moment this one was staged, so it went back to `open` rather than claiming a proposal that no
 * longer existed. ADR-037 gives each staged gap its OWN root, so two agenda rows can no longer
 * collide on one planId and the branch stops firing in practice. It is KEPT rather than deleted:
 * it is the correct answer for any planId that IS reused (a recycled open composer still is), and
 * a demotion that never fires costs one comparison per row.
 */
export async function markAgendaProposed(
  ctx: MutationCtx,
  tenantId: string,
  threadId: string,
  review: Doc<"evaluations">,
  gapIndex: number,
  planId: Id<"plans">,
): Promise<void> {
  if (threadId !== REVIEW_THREAD_ID) return;
  const gap = review.gaps[gapIndex];
  if (!gap) return;
  const key = gapKey(gap);
  const now = Date.now();
  let found = false;
  for (const row of await rowsFor(ctx, tenantId)) {
    if (row.key === key) {
      found = true;
      if (row.status !== "proposed" || row.planId !== planId)
        await ctx.db.patch(row._id, { status: "proposed", planId, statusChangedAt: now });
    } else if (row.status === "proposed" && row.planId === planId) {
      await ctx.db.patch(row._id, { status: "open", planId: undefined, statusChangedAt: now });
    }
  }
  if (!found)
    await ctx.db.insert("agenda", {
      tenantId,
      key,
      label: gap.label,
      route: gap.route,
      playbook: gap.playbook,
      leverageRank: gap.leverageRank,
      status: "proposed",
      gapIndex,
      planId,
      firstSeenAt: now,
      lastSeenAt: review.createdAt,
      statusChangedAt: now,
    });
}
