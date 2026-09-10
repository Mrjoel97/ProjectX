// FIN-01 spend ledger — the durable accounting seam every rail writes through.
//
// APPEND-ONLY, like `audit` (CLAUDE.md §3). This module exposes insert and read functions and
// NOTHING that mutates a recorded movement; `spendLedger.test.ts` scans this source for
// `db.patch`/`db.replace`/`db.delete` and fails the build if one appears. A correction is a new
// `adjustment` or `refunded` movement, never an overwrite — money history that can be edited is
// not history.
//
// The rate limiter remains ENFORCEMENT truth (may this spend happen?). This table is
// REPORTING/RECONCILIATION truth (what happened?). If the Finance UI is ever rolled back, these
// writers MUST keep running: an append-only history has no backfill, so a dark window is a
// permanent hole.
//
// Arithmetic and trust-boundary validation live in `@pikar/core` (`spend.ts`) so they are
// testable without Convex (CLAUDE.md §1). Only storage decisions live here.
import { validateSpendMovement } from "@pikar/core";
import { type ObjectType, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const railValidator = v.union(v.literal("reasoning"), v.literal("media"), v.literal("ingest"));
const phaseValidator = v.union(
  v.literal("estimated"),
  v.literal("reserved"),
  v.literal("actual"),
  v.literal("refunded"),
  v.literal("adjustment"),
);

/** One correlation carries at most one row per phase, so a handful bounds the idempotence read. */
const CORRELATION_SCAN_LIMIT = 32;
const EVENT_PAGE_LIMIT = 500;

/**
 * Insert-if-absent coverage start. Returns the EXISTING start when there is one — a later call
 * must never move it forward, or every window before the new start silently becomes unknown.
 *
 * **CALL THIS AT A SPEND GATE, NOT ONLY AT A MOVEMENT.** Coverage answers "from when does this
 * ledger see everything for this tenant", and the answer is "from when we started watching" — not
 * "from when money first moved". Opening it only on the first recorded movement inverts the very
 * lie the field exists to prevent: instead of a fake zero it reports fake ignorance, so a tenant we
 * have been gating all week reads as `unknown` when the truth is a confident nothing. A REFUSED
 * gate is positive knowledge that no money moved, so it opens coverage too.
 */
export async function ensureCoverage(
  ctx: MutationCtx,
  tenantId: string,
  nowMs: number,
): Promise<number> {
  const existing = await ctx.db
    .query("spendCoverage")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  if (existing) return existing.coverageStartedAt;
  await ctx.db.insert("spendCoverage", { tenantId, coverageStartedAt: nowMs });
  return nowMs;
}

/**
 * Open coverage for a tenant without recording a movement. This is what makes a zero honest:
 * a tenant with coverage and no events spent nothing; a tenant with no coverage row is UNKNOWN.
 */
export const startCoverage = internalMutation({
  args: { tenantId: v.string(), nowMs: v.number() },
  handler: (ctx, args) => ensureCoverage(ctx, args.tenantId, args.nowMs),
});

const movementArgs = {
  tenantId: v.string(),
  rail: railValidator,
  phase: phaseValidator,
  amountCents: v.number(),
  correlationId: v.string(),
  createdAt: v.number(),
  planId: v.optional(v.id("plans")),
  requestId: v.optional(v.id("requests")),
  folderId: v.optional(v.id("vaultFolders")),
  mediaJobId: v.optional(v.id("mediaJobs")),
  model: v.optional(v.string()),
  kind: v.optional(v.string()),
  evalBudgetId: v.optional(v.id("spendEvents")),
  evalEnvelope: v.optional(v.object({ tenantIds: v.array(v.string()), expiresAt: v.number() })),
  evalActualUsd: v.optional(v.number()),
  evalBreach: v.optional(v.boolean()),
};

export type SpendMovementArgs = ObjectType<typeof movementArgs>;

/**
 * Record one money movement, exactly once.
 *
 * IDENTITY IS (tenantId, correlationId, phase) — NOT correlationId alone. A reservation and its
 * later actual charge share one correlation on purpose (that is what makes them reconcilable),
 * so a correlation-only guard would swallow the actual as a duplicate of the reserve. The phase
 * is what keeps them distinct while a retry of EITHER stays a no-op.
 *
 * A replay returns the id already stored and ignores the replayed amount: a retry reporting a
 * different number is a bug upstream, and letting it through would rewrite recorded money.
 *
 * This is the PLAIN-FUNCTION half, for a caller ALREADY INSIDE a mutation — which is every
 * instrumented money movement, because the point is that the limiter movement and its ledger row
 * commit or fail together. `guardrails.recordSpend` consumes this directly; a separate
 * `ctx.runMutation` would be a second transaction and could leave the limiter moved with no row.
 * (The `reserveFolderInner`/`reserveFolder` split in guardrails.ts, verbatim.)
 */
export async function recordMovement(
  ctx: MutationCtx,
  args: SpendMovementArgs,
): Promise<Id<"spendEvents">> {
  // Validate BEFORE coverage is opened, so a rejected movement leaves nothing behind.
  validateSpendMovement({
    rail: args.rail,
    phase: args.phase,
    amountCents: args.amountCents,
    correlationId: args.correlationId,
    model: args.model,
    kind: args.kind,
  });

  const existing = await ctx.db
    .query("spendEvents")
    .withIndex("by_correlation", (q) => q.eq("correlationId", args.correlationId))
    .take(CORRELATION_SCAN_LIMIT);
  // `by_correlation` is not tenant-scoped, so the tenant check is part of the identity here.
  const already = existing.find(
    (row) => row.tenantId === args.tenantId && row.phase === args.phase,
  );
  if (already) return already._id;

  await ensureCoverage(ctx, args.tenantId, args.createdAt);
  return await ctx.db.insert("spendEvents", args);
}

export const record = internalMutation({
  args: movementArgs,
  handler: (ctx, args) => recordMovement(ctx, args),
});

/**
 * The tenant's coverage start, or null when instrumentation never began (unknown, not zero).
 *
 * The plain-function half exists because `finance.ts` reads this from a `tenantQuery`, and a Convex
 * query cannot `runQuery`. Same split, same reason, as `reserveFolderInner`/`reserveFolder`: the
 * cap and the index live HERE, once, so a reader cannot re-derive its own bounded read.
 */
export async function coverageFor(ctx: QueryCtx, tenantId: string): Promise<number | null> {
  const row = await ctx.db
    .query("spendCoverage")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  return row?.coverageStartedAt ?? null;
}

export const coverage = internalQuery({
  args: { tenantId: v.string() },
  handler: (ctx, args) => coverageFor(ctx, args.tenantId),
});

/**
 * Bounded, tenant-scoped, half-open [sinceMs, untilMs) read, optionally narrowed to one rail.
 * Every caller gets a cap whether or not it asked for one — a Finance page must not be able to
 * ask a long-lived tenant for its whole history in one query.
 */
export interface ListEventsArgs {
  tenantId: string;
  sinceMs: number;
  untilMs: number;
  rail?: "reasoning" | "media" | "ingest";
  limit?: number;
}

/** The cap every caller gets, asked for or not. Exported so a reader can say WHY it is partial. */
export const SPEND_EVENT_PAGE_LIMIT = EVENT_PAGE_LIMIT;

/** The plain-function half of `listEvents`, for a `tenantQuery` — see `coverageFor`. */
export async function listEventsFor(
  ctx: QueryCtx,
  args: ListEventsArgs,
): Promise<Doc<"spendEvents">[]> {
  const limit = Math.max(1, Math.min(EVENT_PAGE_LIMIT, Math.floor(args.limit ?? EVENT_PAGE_LIMIT)));
  const rail = args.rail;
  if (rail === undefined) {
    return await ctx.db
      .query("spendEvents")
      .withIndex("by_tenant_createdAt", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .gte("createdAt", args.sinceMs)
          .lt("createdAt", args.untilMs),
      )
      .take(limit);
  }
  return await ctx.db
    .query("spendEvents")
    .withIndex("by_tenant_rail_createdAt", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("rail", rail)
        .gte("createdAt", args.sinceMs)
        .lt("createdAt", args.untilMs),
    )
    .take(limit);
}

export const listEvents = internalQuery({
  args: {
    tenantId: v.string(),
    sinceMs: v.number(),
    untilMs: v.number(),
    rail: v.optional(railValidator),
    limit: v.optional(v.number()),
  },
  handler: (ctx, args): Promise<Doc<"spendEvents">[]> => listEventsFor(ctx, args),
});
