// The Content library's read plane (CONT-01, plan 26-12).
//
// One bounded, typed shelf over artifacts that ALREADY exist as `vaultDocuments` rows. It adds no
// backing store, copies no blob and duplicates no guard: every number here is derived from rows the
// cockpit, the evaluation engine and the render pipeline already wrote.
//
// **THIS MODULE IS READ-ONLY BY CONSTRUCTION.** Every export is a `tenantQuery`; there is no
// mutation, no scheduler call, no signed-URL minting and no log-plane write anywhere in the file.
// That is the invariant `content.test.ts` scans for, and it is what makes "Reuse opens the cockpit
// and never duplicates, attaches, sends or dispatches" a structural fact rather than a promise a
// handler makes about itself. An absent call site cannot be edited into a leak by accident.
//
// The three terminals stay where they already are, and this module only reports WHETHER to offer
// one and with which ref:
//   • open / download  → `api.vault.vaultDownloadUrl({ vaultDocId })` — ownership-checked, minted
//     on demand, never persisted or logged (the `plans.attachmentUrls` bearer-capability rule).
//   • play a reel      → `api.media.reel({ planId })` — the sidecar URL guarantee (20-10). A `url`
//     comes back non-null ONLY when the assembly record validated, which is the D8 contract.
//   • promote          → `api.vault.promoteToReference({ vaultDocId })` — 26-11's SINGLE guarded
//     promotion surface (owner decision, 2026-08-22). This file reads `origin` to decide what to
//     OFFER; whether to ALLOW stays over there, in one place.
// Re-wrapping any of them in an `api.content.*` function would put a second copy of a guard in the
// tree, which is how one of the two paths ends up unguarded.
import {
  compareDashboardOrder,
  createDashboardBound,
  dashboardCursorFor,
  parseDashboardCursor,
} from "@pikar/core";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

/**
 * THE SHELF IS A POSITIVE WHITELIST, never a set of exclusions.
 *
 * `vaultDocuments.kind` is `v.string()` and grows every phase, so "everything except the ones I
 * thought of" silently admits the next writer's rows. Naming the four kinds that ARE artifacts
 * means a new kind lands outside the shelf until somebody adds it here on purpose — the same
 * reasoning as `promoteToReference`'s positive `origin` check (26-11).
 *
 * What is deliberately absent, and why:
 *   • `web_research` → the Knowledge Vault owns cited grounding material that goes stale, and the
 *     Vault already renders staleness (CONT-01 as amended, 2026-08-22).
 *   • sent mail → Reports owns the record of what happened; `requests` is not read by this module.
 *   • `folder_digest`, `business_profile`, uploads → never "something Pikar made for you to reuse".
 *   • `image` / `video` → media intermediates, not shelf deliverables (the reel is the artifact).
 */
const LANE_BY_KIND = {
  created_document: "document",
  created_content: "document",
  next_step_memo: "memo",
  reel: "reel",
} as const;

type ShelfKind = keyof typeof LANE_BY_KIND;
type Lane = (typeof LANE_BY_KIND)[ShelfKind];

const SHELF_KINDS = Object.keys(LANE_BY_KIND) as ShelfKind[];
const KINDS_BY_LANE: Record<Lane, ShelfKind[]> = {
  document: ["created_document", "created_content"],
  memo: ["next_step_memo"],
  reel: ["reel"],
};

const laneArg = v.union(v.literal("document"), v.literal("memo"), v.literal("reel"));

const PAGE_LIMIT_DEFAULT = 24;
const PAGE_LIMIT_MAX = 48;
/** Per-kind ceiling for the filter-chip counts. Past it the chip says "50+", never a wrong number.
 *  ponytail: a bounded `.take()` over rows that each carry a `text` blob — the same shape (and the
 *  same read-cap ceiling) as `vaultStats`, whose contract is that a count must never be the reason
 *  the page fails to load. Upgrade path when a tenant outgrows it: a maintained counter row, or the
 *  aggregate component — both are write-path obligations, so don't take them until the read hurts. */
const COUNT_CAP = 50;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.floor(limit), 1), PAGE_LIMIT_MAX);
}

const orderKey = (doc: Doc<"vaultDocuments">) => ({ createdAt: doc.createdAt, id: doc._id });

/** The cockpit deep link. Code-owned here so no caller can hand-build a link to somewhere else. */
const threadHref = (threadId: string, view?: "canvas") =>
  `/dashboard/workspace?thread=${encodeURIComponent(threadId)}${view ? `&view=${view}` : ""}`;

/**
 * Whether the shelf offers the promotion control — and NOT whether the mutation will accept it.
 * The verdicts mirror `vault.promoteToReference` (agent ⇒ first promotion; agent_promoted ⇒ done,
 * except that a FAILED ingest is the one re-promotable state), and `content.test.ts` checks each
 * one against the real mutation so the page can never grow a button that always refuses.
 *
 * "not-applicable" is not a refusal: memos and reels are ingested by their own write sites, so they
 * are already reference material and there is nothing to promote.
 */
function promotion(doc: Doc<"vaultDocuments">) {
  if (doc.origin === "agent") return { state: "eligible" as const };
  if (doc.origin === "agent_promoted") {
    return doc.status === "failed" ? { state: "retry" as const } : { state: "promoted" as const };
  }
  return { state: "not-applicable" as const };
}

const unproved = (reason: "no-plan" | "no-bytes" | "no-sidecar" | "superseded") => ({
  state: "unproved" as const,
  reason,
});

/**
 * The reel block — the one card field that needs a second row read.
 *
 * A reel is offered for playback ONLY when the bytes exist AND the plan still carries the artifact
 * triple (`renderStorageId` + `sidecarStorageId` + `renderSummary`) AND that triple still points at
 * THIS row. All three terms earn their place:
 *   • no bytes            → nothing to play.
 *   • no live sidecar     → `resetPlan` cleared the triple, so the render has no assembly record to
 *     stand on. D8: "a final video without an assembly.json was hand-assembled." `api.media.reel`
 *     would return a null url for exactly this plan, so offering Play would be a dead button.
 *   • pointer moved on    → the thread re-rendered into a DIFFERENT vault doc. The plan's triple is
 *     intact but it describes reel #2, so serving it under reel #1's title is a lie the user can
 *     watch. This is the term a naive "does the plan have a render?" check misses.
 * Unproved is never silent: the reason rides on the card and the canvas link still opens.
 */
async function reelBlock(ctx: QueryCtx & { tenantId: string }, doc: Doc<"vaultDocuments">) {
  const planId: Id<"plans"> | undefined = doc.reelMeta?.planId;
  const plan = planId === undefined ? null : await ctx.db.get(planId);
  if (!plan || plan.tenantId !== ctx.tenantId) {
    return { planId: null, renderStatus: null, canvasHref: null, playback: unproved("no-plan") };
  }
  const base = {
    planId: plan._id,
    renderStatus: plan.renderStatus ?? null,
    canvasHref: threadHref(plan.threadId, "canvas"),
  };
  if (doc.storageId === undefined) return { ...base, playback: unproved("no-bytes") };
  if (!plan.renderStorageId || !plan.sidecarStorageId || !plan.renderSummary) {
    return { ...base, playback: unproved("no-sidecar") };
  }
  if (plan.reelVaultDocId !== doc._id) return { ...base, playback: unproved("superseded") };
  return { ...base, playback: { state: "proved" as const } };
}

/**
 * One artifact card: refs, enums, timestamps and counts only.
 *
 * NO storage id and NO body text cross this boundary. The page holds a `vaultDocId` (and, for a
 * reel, a `planId`) and asks the existing ownership-checked readers for a URL when the user acts —
 * so a bearer capability is never minted for a card nobody clicked, and never sits in a subscription.
 */
async function card(ctx: QueryCtx & { tenantId: string }, doc: Doc<"vaultDocuments">) {
  const lane = LANE_BY_KIND[doc.kind as ShelfKind];
  return {
    vaultDocId: doc._id,
    lane,
    title: doc.title,
    createdAt: doc.createdAt,
    status: doc.status,
    // A code-owned ingest reason (`vaultIngest`), never model prose — the same field the Vault's
    // own projection already shows.
    failureReason: doc.failureReason ?? null,
    sizeBytes: doc.size,
    // What the bytes ARE, when there are any. An agent-authored long document is a markdown row
    // carrying a rendered PDF, so `storedMimeType` is the honest answer and `mimeType` the fallback.
    bytes:
      doc.storageId === undefined
        ? { state: "none" as const }
        : { state: "available" as const, mimeType: doc.storedMimeType ?? doc.mimeType },
    // 26-11 landed the provenance pair at every authoritative write site, so an absent thread is
    // now genuine LEGACY absence — never a missed write. It is reported as unknown, never inferred
    // from a reverse scan.
    provenance:
      doc.sourceThreadId === undefined
        ? { state: "unknown" as const }
        : {
            state: "known" as const,
            threadId: doc.sourceThreadId,
            planId: doc.sourcePlanId ?? null,
          },
    // Reuse is a LINK and nothing else: it opens the conversation that produced the artifact, where
    // every existing approval gate still stands. No copy, no attachment, no send, no dispatch.
    reuse:
      doc.sourceThreadId === undefined
        ? { state: "unavailable" as const, reason: "unknown-thread" as const }
        : { state: "available" as const, href: threadHref(doc.sourceThreadId) },
    promotion: promotion(doc),
    reel: lane === "reel" ? await reelBlock(ctx, doc) : null,
  };
}

/** One kind partition, newest-first, optionally resumed at a cursor. */
function branch(
  ctx: QueryCtx & { tenantId: string },
  kind: ShelfKind,
  after: { createdAt: number; id: string } | null,
) {
  return ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_kind", (q) => {
      const scoped = q.eq("tenantId", ctx.tenantId).eq("kind", kind);
      // `lte`, not `lt`: rows sharing the cursor's millisecond are still ahead of it in the total
      // order until the id tiebreak says otherwise, so the filter below decides, not the range.
      return after === null ? scoped : scoped.lte("createdAt", after.createdAt);
    })
    .order("desc");
}

/**
 * The bounded cross-kind union.
 *
 * Four kind partitions merged into ONE newest-first order (`compareDashboardOrder`, id-descending
 * on equal timestamps) so a document, a memo and a reel written seconds apart interleave the way
 * the user saw them happen. A per-lane cursor cannot do this — it re-emits or skips rows the moment
 * the lanes are not in step.
 *
 * The fetch is limit-sized rather than scan-sized: `contacts.ts`'s `pageBounded` names exactly this
 * ("drive the cursor off the index range itself") as its own upgrade path, and the shelf has the
 * index for it, so it starts there.
 *
 * ponytail: a page can skip rows only if MORE THAN `limit` artifacts of ONE kind share a single
 * millisecond — each insert is its own transaction, so that needs 24 writes inside one tick.
 * Upgrade path if it ever happens: widen the per-branch window by the number of boundary ties.
 */
export const listArtifacts = tenantQuery({
  args: {
    lane: v.optional(laneArg),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { lane, limit: requested, cursor }) => {
    const limit = clampLimit(requested);
    // Throws on a forged or oversized cursor — a trust boundary, not a fallback. Silently
    // restarting the page would look like duplicated rows to the caller.
    const after = cursor === undefined ? null : parseDashboardCursor(cursor);
    const kinds = lane === undefined ? SHELF_KINDS : KINDS_BY_LANE[lane];

    const branches = await Promise.all(
      kinds.map((kind) => branch(ctx, kind, after).take(limit + 1)),
    );
    const merged = branches
      .flat()
      .filter((doc) => after === null || compareDashboardOrder(orderKey(doc), after) > 0)
      .sort((a, b) => compareDashboardOrder(orderKey(a), orderKey(b)));

    const items = merged.slice(0, limit);
    const last = items.at(-1);
    // A branch that filled its window may hold more even when the merge did not overflow, so both
    // conditions count. Over-reporting costs one empty follow-up page; under-reporting loses a tail.
    const more = merged.length > limit || branches.some((rows) => rows.length > limit);
    const nextCursor = more && last !== undefined ? dashboardCursorFor(orderKey(last)) : null;

    return {
      items: await Promise.all(items.map((doc) => card(ctx, doc))),
      nextCursor,
      bound: createDashboardBound({
        returned: items.length,
        limit,
        nextCursor,
        partial: nextCursor !== null,
        ...(nextCursor === null ? {} : { partialReason: "row-cap" as const }),
      }),
    };
  },
});

/**
 * The filter-chip counts: per lane, capped, and honest about being capped.
 *
 * `capped` is not decoration — it is the difference between "you have 50 documents" and "you have
 * at least 50". An exact figure that walks the partition is the read-cap fault this table's own
 * schema comments keep pointing at.
 */
export const summary = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await Promise.all(
      SHELF_KINDS.map((kind) => branch(ctx, kind, null).take(COUNT_CAP + 1)),
    );
    const perKind = new Map(SHELF_KINDS.map((kind, i) => [kind, rows[i]?.length ?? 0]));
    const lanes = {} as Record<Lane, { count: number; capped: boolean }>;
    for (const [lane, kinds] of Object.entries(KINDS_BY_LANE) as [Lane, ShelfKind[]][]) {
      const raw = kinds.reduce((sum, kind) => sum + (perKind.get(kind) ?? 0), 0);
      const capped = kinds.some((kind) => (perKind.get(kind) ?? 0) > COUNT_CAP);
      lanes[lane] = { count: Math.min(raw, COUNT_CAP), capped: capped || raw > COUNT_CAP };
    }
    const values = Object.values(lanes);
    return {
      lanes,
      total: {
        count: values.reduce((sum, lane) => sum + lane.count, 0),
        capped: values.some((lane) => lane.capped),
      },
    };
  },
});

/**
 * One artifact by id — the same card the list returns, for a deep link and for re-reading a row
 * after an action (promotion flips `origin` and `status`, and this is where the page sees it).
 *
 * A row this tenant does not own, a row that is not a shelf kind, and a row that does not exist all
 * collapse to the SAME `null`. A throw or a distinct shape would be an existence oracle for another
 * tenant's ids — `promoteToReference`'s rule, applied to the read side.
 */
export const artifactById = tenantQuery({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }) => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return null;
    if (!(doc.kind in LANE_BY_KIND)) return null;
    return await card(ctx, doc);
  },
});
