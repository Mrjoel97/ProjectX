// BILL-03 billing ledger — the durable seam every money-in outcome is recorded through.
//
// A MIRROR of `spendLedger.ts`, symbol for symbol, over a DIFFERENT table. The shape is copied
// because the law is identical (insert-if-absent coverage, (tenant, correlation, phase) identity,
// bounded reads, unknown-never-zero); the table is separate because the SUBJECT is opposite.
// `spendEvents` is what Pikar SPENDS and Phase 26 Finance renders it as exactly that, across three
// hard-coded rails. Money-in in that structure is a wrong number on a live screen — owner decision
// 2026-08-28, and `billing.test.ts` holds it with an `aggregateSpend` equality.
//
// APPEND-ONLY (CLAUDE.md §3, `audit_immutable` in `packages/core/src/tenantData.ts`). This module
// exposes insert and read functions and NOTHING that mutates a recorded movement;
// `billingLedger.test.ts` scans this source and fails the build if a `patch`/`replace`/`delete`
// appears. A correction is a new `refunded` or `adjustment` row, never an overwrite.
//
// WHAT A MOVEMENT MEANS is not decided here. `@pikar/billing`'s `reconcileEvent` is pure and owns
// the Stripe-signal → phase mapping (CLAUDE.md §1); this adapter only WRITES what it returns. In
// particular the central law — `invoice.paid` on a bank transfer is NOT cash in hand — lives there
// and must never be re-derived in `convex/`.
import { REF_TOKEN } from "@pikar/billing/reconcile";
import { normalizeCurrency } from "@pikar/revenue/money";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** `SPEND_PHASES` verbatim. Not imported as a value so this list matches the schema literal it
 *  must agree with; `billingLedger.test.ts` and `dashboardSchema.test.ts` pin both ends. */
const PHASES = ["estimated", "reserved", "actual", "refunded", "adjustment"] as const;
export type BillingPhase = (typeof PHASES)[number];

/** One correlation carries at most one row per phase, so a handful bounds the idempotence read. */
const CORRELATION_SCAN_LIMIT = 32;
const EVENT_PAGE_LIMIT = 500;

/** Stripe's `taxability_reason` vocabulary is lowercase and underscored. Anything else is refused
 *  rather than stored: this row lives forever in an `audit_immutable` table, so an unbounded
 *  string field is the one way customer prose could reach it (CLAUDE.md §4). */
const TAXABILITY_TOKEN = /^[a-z_]{1,64}$/;

function requireToken(value: string, name: string, maxLength: number): void {
  if (!value || value.length > maxLength || !REF_TOKEN.test(value)) {
    throw new Error(`${name} must be a code-owned token of 1-${maxLength} ref-safe characters`);
  }
}

/**
 * Insert-if-absent coverage start. Returns the EXISTING start when there is one — a later call
 * must never move it forward, or every window before the new start silently becomes unknown.
 *
 * `spendLedger.ensureCoverage`'s note about opening coverage at a GATE rather than at a movement
 * does NOT transfer: there is no billing gate. Nothing in this deployment can observe that a
 * tenant definitely earned Pikar nothing — only Stripe knows that — so the first recorded movement
 * is genuinely the first moment this ledger can see anything.
 */
export async function ensureBillingCoverage(
  ctx: MutationCtx,
  tenantId: string,
  nowMs: number,
): Promise<number> {
  const existing = await ctx.db
    .query("billingCoverage")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  if (existing) return existing.coverageStartedAt;
  await ctx.db.insert("billingCoverage", { tenantId, coverageStartedAt: nowMs });
  return nowMs;
}

export interface BillingMovementArgs {
  tenantId: string;
  phase: BillingPhase;
  /** POSITIVE integer minor units. Direction lives in the phase, never in the sign. */
  amountMinor: number;
  /** ISO 4217 alpha-3. Canonicalised uppercase before it reaches a row. */
  currency: string;
  /** `billing/<stripe id>` — built by `reconcileEvent` from an id and nothing else. */
  correlationId: string;
  /** Code-owned token naming which Stripe signal produced this. Never caller-supplied. */
  kind: string;
  stripeObjectId?: string;
  taxabilityReason?: string;
  createdAt: number;
}

/**
 * Record one billing movement, exactly once.
 *
 * IDENTITY IS (tenantId, correlationId, phase) — NOT correlationId alone. `spendLedger.ts:92-99`
 * verbatim, and here it is load-bearing on a live path rather than in theory: a bank transfer
 * ARRIVING (`reserved`) and the same money being COLLECTED (`actual`) share one correlation on
 * purpose, so a correlation-only guard would swallow every collection this merchant ever makes.
 *
 * A replay returns the id already stored and IGNORES the replayed amount: a retry reporting a
 * different number is a bug upstream, and letting it through would rewrite recorded money.
 *
 * This is the PLAIN-FUNCTION half, for a caller ALREADY INSIDE a mutation — which is
 * `billingWebhook.receiveAndApply`, because the whole point is that the Stripe dedupe row and the
 * ledger row commit or fail together. A `ctx.runMutation` would be a second transaction and could
 * leave the delivery recorded as seen with no money booked, which Stripe's retry would then
 * suppress. (The `reserveFolderInner`/`reserveFolder` split in `guardrails.ts`, verbatim.)
 *
 * IT THROWS on an untrusted value rather than coercing. Every caller today comes through
 * `reconcileEvent`, which has already refused a malformed amount or currency at the HTTP boundary,
 * so a throw here means a programming error and not a Stripe payload — the same posture, and the
 * same 500-on-defect failure mode, as `spendLedger.recordMovement`.
 */
export async function recordBillingMovement(
  ctx: MutationCtx,
  args: BillingMovementArgs,
): Promise<Id<"billingEvents">> {
  // Validate BEFORE coverage is opened, so a rejected movement leaves NOTHING behind. An opened
  // coverage with no rows is a confident "they paid us nothing", which is a worse answer than
  // "we do not know".
  if (!(PHASES as readonly string[]).includes(args.phase)) {
    throw new Error(`unknown billing phase: ${String(args.phase)}`);
  }
  if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0) {
    throw new Error("a billing amount must be a positive safe integer count of minor units");
  }
  requireToken(args.correlationId, "correlationId", 128);
  requireToken(args.kind, "kind", 64);
  if (args.stripeObjectId !== undefined) requireToken(args.stripeObjectId, "stripeObjectId", 128);
  if (args.taxabilityReason !== undefined && !TAXABILITY_TOKEN.test(args.taxabilityReason)) {
    throw new Error("taxabilityReason must be a lowercase Stripe reason token");
  }
  const currency = normalizeCurrency(args.currency);
  if (!currency.ok) throw new Error(`billing movement: ${currency.error}`);

  const existing = await ctx.db
    .query("billingEvents")
    .withIndex("by_correlation", (q) => q.eq("correlationId", args.correlationId))
    .take(CORRELATION_SCAN_LIMIT);
  // `by_correlation` is not tenant-scoped, so the tenant check is part of the identity here.
  const mine = existing.filter((row) => row.tenantId === args.tenantId);

  // REFUSED, never summed. Two currencies inside one correlation is not a number anybody can add
  // up, and picking a winner would invent an exchange rate (`@pikar/revenue`'s law). Checked
  // BEFORE the replay guard so a retry that changed currency is loud rather than silently a no-op.
  const clash = mine.find((row) => row.currency !== currency.value);
  if (clash) {
    throw new Error("a billing correlation cannot carry two currencies");
  }

  const already = mine.find((row) => row.phase === args.phase);
  if (already) return already._id;

  await ensureBillingCoverage(ctx, args.tenantId, args.createdAt);
  return await ctx.db.insert("billingEvents", {
    tenantId: args.tenantId,
    phase: args.phase,
    amountMinor: args.amountMinor,
    currency: currency.value,
    correlationId: args.correlationId,
    kind: args.kind,
    ...(args.stripeObjectId === undefined ? {} : { stripeObjectId: args.stripeObjectId }),
    ...(args.taxabilityReason === undefined ? {} : { taxabilityReason: args.taxabilityReason }),
    createdAt: args.createdAt,
  });
}

/**
 * The tenant's billing coverage start, or null when this ledger never began watching.
 *
 * NULL IS UNKNOWN, NEVER ZERO. A tenant with no coverage row has no billing history *that we can
 * see*, which is a different claim from "they paid us nothing" — the same discipline as
 * `@pikar/core`'s `CashFigure`, and the reason the return type is nullable rather than a number
 * with a sentinel a caller could add up.
 *
 * The plain-function half exists because `billing.ts` reads this from a `tenantQuery`, and a Convex
 * query cannot `runQuery`.
 */
export async function billingCoverageFor(ctx: QueryCtx, tenantId: string): Promise<number | null> {
  const row = await ctx.db
    .query("billingCoverage")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  return row?.coverageStartedAt ?? null;
}

export interface ListBillingEventsArgs {
  tenantId: string;
  sinceMs: number;
  untilMs: number;
  limit?: number;
}

/** The cap every caller gets, asked for or not. Exported so a reader can say WHY it is partial. */
export const BILLING_EVENT_PAGE_LIMIT = EVENT_PAGE_LIMIT;

/**
 * Bounded, tenant-scoped, half-open [sinceMs, untilMs) read. Every caller gets a cap whether or
 * not it asked for one — a billing page must not be able to ask a long-lived tenant for its whole
 * history in one query.
 */
export async function listBillingEventsFor(
  ctx: QueryCtx,
  args: ListBillingEventsArgs,
): Promise<Doc<"billingEvents">[]> {
  const limit = Math.max(1, Math.min(EVENT_PAGE_LIMIT, Math.floor(args.limit ?? EVENT_PAGE_LIMIT)));
  return await ctx.db
    .query("billingEvents")
    .withIndex("by_tenant_createdAt", (q) =>
      q.eq("tenantId", args.tenantId).gte("createdAt", args.sinceMs).lt("createdAt", args.untilMs),
    )
    .take(limit);
}
