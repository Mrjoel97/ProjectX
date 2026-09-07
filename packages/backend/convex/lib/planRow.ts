// ADR-037 — how a thread's plan rows are READ now that a thread may hold more than one, and
// (since 42-03) the ONE place a fan-out's parent is written.
//
// Plain functions over a database ctx (the `lib/agenda.ts` convention) so `plans.ts`, `cockpit.ts`,
// `evaluations.ts` and `reliabilitySweep.ts` can all import this without importing each other.
// Every read is `by_thread` / `by_parent` with the tenantId the CALLER validated — the index PREFIX
// is the tenant boundary.
//
// This module was read-only until 42-03. It gained exactly one writer, `flipParentWhenSiblingsDone`,
// because TWO callers need it and they must not diverge: a child that lands normally
// (`evaluations.landSpecialistResult`) and a child a watchdog resolves
// (`reliabilitySweep.sweepStuckPlans`). Two copies of "is this fan-out finished" is how a dead
// worker leaves a parent stuck for ever while the happy path looks healthy.
//
// Nothing here is a second mechanism: `by_thread` is the index that has always existed, and Convex
// appends `_creationTime, _id` as the implicit tail of every index, so `by_thread` already IS a
// descending-by-creation scan within a thread. The only new thing is the ROOT filter.
import { fanOutMemoBody } from "@pikar/core";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_FAN_OUT } from "./dispatchShared";

/**
 * How far back a root scan looks. `smoke.ts:893-898` is the shipped idiom this copies —
 * `.order("desc").take(20)` then `find(...)` — and the number matches it rather than inventing one.
 *
 * WHY A BOUND IS SAFE HERE. A fan-out's children are minted in one mutation immediately after
 * their root (ADR-037 Decision 6), so a descending scan meets a root after at most `C_max + 1`
 * rows: 6 for a G6 fan-out (≤5 workers), 11 for a G10 batch (2-10 deliverables). A window of 20
 * DERIVED FROM `MAX_FAN_OUT`, NOT A LITERAL, and that is the point of this line.
 *
 * The true bound is `MAX_FAN_OUT + 1`: a fan-out mints its children in ONE mutation right
 * after their root, and `MAX_DEPTH = 1` forbids a grandchild, so a descending scan meets a
 * root after at most one root plus its own children. Nothing older can be in front of it.
 * Doubling that carries a second fan-out's worth of headroom.
 *
 * It was the literal `20` while `MAX_FAN_OUT` was 5, justified in PROSE by the arithmetic
 * `6 for a G6 fan-out, 11 for a G10 batch` (ADR-037 Decision 2). ADR-040 raised the cap to 15
 * and that prose silently became the only thing standing between 16 and 20. A constant whose
 * safety depends on another constant's value, with the dependency recorded in a comment, is
 * the same defect class as `declaredUnsupported`'s expired premise (42.1). So it is code now,
 * and `planRow.test.ts` pins the relationship rather than either number.
 *
 * WHAT HAPPENS IF IT IS EVER EXCEEDED. `newestRoot` returns null and the caller throws
 * ("cockpit: plan row missing for thread") — LOUDLY, not silently, which is the property ADR-037
 * Decision 8 deliberately preserves now that `.unique()`'s throw is gone. A silent wrong row is
 * the one outcome this must never produce.
 */
export const ROOT_SCAN = 2 * (MAX_FAN_OUT + 1);

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

/**
 * THE ONLY PLACE A FAN-OUT BECOMES APPROVABLE (42-03, ADR-037 Decision 4).
 *
 * Called when a child lands. If any sibling is still `collecting`, this does nothing and the run
 * that lands last does the work — no coordinator, no counter, no second table. When none is left,
 * the parent's body becomes the deterministic assembly of its children's memos (owner decision
 * 2026-09-07: an assembly, never a synthesis turn) and the parent flips `collecting → proposed`,
 * which is the single Approve card the whole fan-out earns.
 *
 * Children are ordered by `_creationTime` — the mint order, i.e. the order the model asked its
 * questions in. `by_parent` is `["tenantId", "parentPlanId"]` with Convex's implicit
 * `_creationTime, _id` tail, so an ascending scan already IS mint order and no sort is written.
 *
 * The parent's own CAS is the same one every landing uses: `collecting` + `kind: "memo"`. A parent
 * the user cancelled, or one a watchdog already resolved, is left alone.
 *
 * A child that produced nothing still counts as done and still contributes its section: its body is
 * whatever `landSpecialistResult` decided (an honest failure memo), and dropping it would make the
 * assembled artifact silently narrower than the question that was asked.
 */
export async function flipParentWhenSiblingsDone(
  ctx: MutationCtx,
  tenantId: string,
  parentPlanId: Id<"plans">,
): Promise<void> {
  const children = await ctx.db
    .query("plans")
    .withIndex("by_parent", (q) => q.eq("tenantId", tenantId).eq("parentPlanId", parentPlanId))
    .collect();
  if (children.some((c) => c.status === "collecting")) return; // a worker is still running

  const parent = await ctx.db.get(parentPlanId);
  if (!parent || parent.tenantId !== tenantId) return;
  if (parent.status !== "collecting" || parent.kind !== "memo") return;

  const body = fanOutMemoBody(
    children.map((c) => ({ heading: c.subject ?? "Specialist", body: c.body ?? "" })),
  );
  await ctx.runMutation(internal.plans.patchPlan, {
    planId: parentPlanId,
    body,
    status: "proposed",
  });
  // The children's references, merged and de-duplicated by URL, so the ONE card the owner reads can
  // attribute every finding under it. Direct `ctx.db.patch` for the same reason the single-run path
  // uses one: a source list is a PROVENANCE claim and `patchPlan` is the door the model writes
  // through. These come from the children's own rows, which only `landSpecialistResult` fills.
  const seen = new Set<string>();
  const sources = children
    .flatMap((c) => c.sources ?? [])
    .filter((src) => !seen.has(src.url) && seen.add(src.url));
  if (sources.length > 0) await ctx.db.patch(parentPlanId, { sources });
}
