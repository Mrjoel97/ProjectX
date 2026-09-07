// ADR-037 — how a thread's plan rows are read now that a thread may hold more than one.
//
// Plain functions over a database reader (the `lib/agenda.ts` convention) so `plans.ts`,
// `cockpit.ts` and `evaluations.ts` can all import this without importing each other. Every read
// is `by_thread` with the tenantId the CALLER validated — the index PREFIX is the tenant boundary.
//
// Nothing here is a second mechanism: `by_thread` is the index that has always existed, and Convex
// appends `_creationTime, _id` as the implicit tail of every index, so `by_thread` already IS a
// descending-by-creation scan within a thread. The only new thing is the ROOT filter.
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * How far back a root scan looks. `smoke.ts:893-898` is the shipped idiom this copies —
 * `.order("desc").take(20)` then `find(...)` — and the number matches it rather than inventing one.
 *
 * WHY A BOUND IS SAFE HERE. A fan-out's children are minted in one mutation immediately after
 * their root (ADR-037 Decision 6), so a descending scan meets a root after at most `C_max + 1`
 * rows: 6 for a G6 fan-out (≤5 workers), 11 for a G10 batch (2-10 deliverables). A window of 20
 * carries headroom for the largest batch plus its root plus a second batch's worth of drift.
 *
 * WHAT HAPPENS IF IT IS EVER EXCEEDED. `newestRoot` returns null and the caller throws
 * ("cockpit: plan row missing for thread") — LOUDLY, not silently, which is the property ADR-037
 * Decision 8 deliberately preserves now that `.unique()`'s throw is gone. A silent wrong row is
 * the one outcome this must never produce.
 */
export const ROOT_SCAN = 20;

/** A row with NO `parentPlanId` is a ROOT: its own artifact, its own approval card. A row WITH one
 *  is a fan-out child and is never the answer to "what is the plan for this thread". */
export const isRoot = (p: Doc<"plans">): boolean => p.parentPlanId === undefined;

/**
 * The thread's newest roots, newest first, bounded by `ROOT_SCAN`. Callers that need to reason
 * about CONCURRENCY (is any reel still rendering on this thread?) need the whole window, not just
 * the newest row — under ADR-037 a live root can sit behind a newer one.
 */
export async function threadRoots(
  ctx: QueryCtx,
  tenantId: string,
  threadId: string,
): Promise<Doc<"plans">[]> {
  const rows = await ctx.db
    .query("plans")
    .withIndex("by_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
    .order("desc")
    .take(ROOT_SCAN);
  return rows.filter(isRoot);
}

/**
 * "The plan for this thread" — the NEWEST ROOT. This is what replaced `.unique()` at every site
 * that asked the question "which row does this thread's card show".
 *
 * Unambiguous because of ADR-037 Decision 3, not because of this function: at most one root per
 * thread is `collecting`, so the newest root and "the draft the user is typing into" cannot
 * diverge. Without that invariant a staged reel would move every subsequent cockpit tool write
 * onto the media row and strand a half-composed email where no query reaches it.
 */
export async function newestRoot(
  ctx: QueryCtx,
  tenantId: string,
  threadId: string,
): Promise<Doc<"plans"> | null> {
  const roots = await threadRoots(ctx, tenantId, threadId);
  return roots[0] ?? null;
}

/**
 * Is this root OPEN — i.e. does it still own the thread's composing slot? `collecting` is the only
 * status that means "unfinished work the user or a dispatch is still filling in"; every other
 * status is an artifact that has left the composer, and ADR-037 removed the LIFETIME ceilings that
 * used to make one of those block the next piece of work.
 *
 * This is deliberately NOT `!RECYCLABLE_STATUS.has(status)`. `proposed` and `canceled` used to
 * recycle; under ADR-037 they are finished artifacts that a new root is staged BESIDE, which is
 * also what stops an un-acted-on proposal being silently destroyed (the `image_proposal_pending`
 * defect, `plans.ts`, recorded there in full).
 */
export const isOpenRoot = (p: Doc<"plans">): boolean => p.status === "collecting";
