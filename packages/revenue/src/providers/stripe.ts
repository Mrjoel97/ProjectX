/**
 * Stripe — the PURE normalizer (CLAUDE.md §1). No Convex, no network, no LLM.
 *
 * Everything here is a total function over a raw Stripe JSON value. It names the paths a read may
 * use, walks one list page, and turns vendor rows into the phase's normalized vocabulary. It
 * computes NO business arithmetic: aging, cash timelines, reconciliation and confidence are
 * `finance.ts`'s job, and re-deriving any of them here would give the repo a second, divergent
 * definition of a number the owner acts on.
 *
 * ═══ THE ONE BUG THIS MODULE EXISTS TO NOT HAVE: DOUBLE-CONVERTED MONEY ═══
 *
 * Stripe is natively integer MINOR units. `amount: 1999` in `usd` is $19.99, and `amount: 5000` in
 * `jpy` is ¥5000 — not ¥50. So every amount goes through `moneyFromMinor`, and `moneyFromNumber`
 * (the decimal-string door QuickBooks uses) must never appear in this file. A rail that ran
 * Stripe's integers through a decimal parser would report a hundred times the truth and nothing
 * downstream could tell.
 *
 * ═══ THE READ SURFACE IS FIVE PATHS, AND EVERY ONE HAS A PARSER ═══
 *
 * `payment_intents` and `balance_transactions` are DELIBERATELY ABSENT, not forgotten:
 *
 *  • `payment_intents` reports the same business activity as `charges` from one step earlier. Both
 *    on the allow-list means a projection that lists an intent AND its charge counts one payment
 *    twice, and `finance.reconcilePayments` cannot see that — it de-duplicates across AUTHORITIES,
 *    and these would be the same authority.
 *  • `balance_transactions` is the fee-level ledger. Nothing in this phase consumes fees, and an
 *    allow-listed path with no parser is a widened surface bought for nothing.
 *
 * `ponytail:` upgrade path for either — add the path, the normalizer and a captured fixture in the
 * same change, and say in `docs/connectors/stripe-suitability.md` which figure needs it.
 *
 * NO REQUEST METHOD, EVER. There is not a verb, an origin or a header in this file. `connectorFetch`
 * owns the origin, the compile-time allow-list and the hardcoded GET. Unlike the QuickBooks lane —
 * where a write-capable scope makes that allow-list the whole containment story — a Stripe App
 * declaring only `*_read` manifest permissions cannot express a write AT THE VENDOR. The allow-list
 * is the second boundary here, not the only one.
 */
import { err, ok, type Result } from "@pikar/core/result";
import {
  type Invoice,
  type Money,
  type Payment,
  type SourceRef,
  validateSourceRef,
} from "../contracts";
import { moneyFromMinor, normalizeCurrency, subMoney } from "../money";

// ── The closed set of things this lane may read ───────────────────────────────────────────

/**
 * Every Stripe entity this repo reads. Adding a member is a security change with the same review as
 * an allow-list edit, and it must arrive with its normalizer.
 */
export const STRIPE_ENTITIES = ["balance", "charges", "invoices", "payouts", "disputes"] as const;
export type StripeEntity = (typeof STRIPE_ENTITIES)[number];

export const isStripeEntity = (v: unknown): v is StripeEntity =>
  typeof v === "string" && (STRIPE_ENTITIES as readonly string[]).includes(v);

/**
 * The one path each entity reads. Compared against `connectorFetch.PROVIDER_READ_PATHS.stripe` by
 * `stripeConnector.test.ts` in BOTH directions, so the pure module and the transport allow-list
 * cannot drift apart.
 *
 * Every Stripe write shares a path with its read and differs only by HTTP verb, which is why the
 * transport hardcodes GET and takes no method parameter. There is no `/v1/refunds`, no
 * `/v1/transfers` and no per-object action path here, and there must never be.
 */
export const STRIPE_READ_PATHS: Record<StripeEntity, string> = {
  balance: "/v1/balance",
  charges: "/v1/charges",
  invoices: "/v1/invoices",
  payouts: "/v1/payouts",
  disputes: "/v1/disputes",
};

/** Stripe's own list pagination parameter: the id of the last object on the previous page. */
export const STRIPE_CURSOR_PARAM = "starting_after";

/** Stripe's documented maximum `limit`. */
export const STRIPE_PAGE_SIZE = 100;

/**
 * Pages per entity read — and this number is sized against the READ ALLOCATION, not the rate limit.
 *
 * Stripe allows an average of 500 read requests per transaction with a FLOOR of 10,000 per month,
 * aggregated across a platform's connected accounts, over a rolling 30 days. The 100 req/s rate
 * limit is irrelevant to a polling revenue pack; the monthly allocation is the real ceiling.
 *
 * Five entities x five pages is at most 25 requests for a complete poll, so a connected account on
 * the 10,000/month floor can be polled roughly 400 times a month — about every two hours — before
 * the allocation is the binding constraint. Raising either number spends that budget.
 */
export const STRIPE_MAX_PAGES = 5;

/**
 * The default read window, in days. THIS REPO'S choice, not a Stripe recommendation: an unbounded
 * list walk is a cost and a cap risk. A quarter covers a full aging ladder plus settlement lag.
 */
export const STRIPE_DEFAULT_WINDOW_DAYS = 90;

/**
 * Invoice statuses this lane treats as receivable, as a closed set.
 *
 * `draft` is not owed by anyone yet; `void` was cancelled; `uncollectible` was written off. Aging
 * any of the three would overstate what a tenant is owed, which is this phase's most expensive
 * possible bug. `paid` survives because a settled invoice is still a real receivable row with a
 * zero balance, and `agingReport` handles it.
 */
const RECEIVABLE_INVOICE_STATUSES = ["open", "paid"] as const;

/** Stripe's documented payout statuses. Closed: an unknown one is a shape this code cannot read. */
const PAYOUT_STATUSES = ["paid", "pending", "in_transit", "canceled", "failed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Stripe's documented dispute statuses. */
const DISPUTE_STATUSES = [
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "needs_response",
  "under_review",
  "won",
  "lost",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

// ── Shapes this lane terminates in ────────────────────────────────────────────────────────

/** Money leaving and money at risk. Neither has a home in `contracts.ts`'s three business rows. */
export type StripePayout = {
  ref: SourceRef;
  amount: Money;
  /** When the money reaches the bank — NOT when the payout row was created. */
  arrivesAt: number;
  status: PayoutStatus;
};

export type StripeDispute = {
  ref: SourceRef;
  amount: Money;
  openedAt: number;
  status: DisputeStatus;
  /** The charge under dispute, as an opaque id. Read for CONTEXT — never to respond to one. */
  chargeRef: string | null;
};

export type StripeBalance = {
  available: readonly Money[];
  pending: readonly Money[];
};

// ── Primitives ────────────────────────────────────────────────────────────────────────────

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * A Stripe unix-SECONDS timestamp to millis, or `null`.
 *
 * `null` rather than a throw or a guess: an absent invoice due date is a real state that
 * `agingBucket` puts in `unknown`, and coercing it to a number would move an undated invoice into
 * `current` — reporting it as not-yet-overdue when nobody knows whether it is.
 */
export function stripeTime(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) return null;
  if (raw <= 0) return null;
  return raw * 1000;
}

/**
 * A Stripe object id. Opaque, and NEVER an expanded object: `invoice`, `customer` and `charge` are
 * an id OR a nested object depending on the request's `expand` parameter, and an object stringified
 * into an id field would never match anything — silently defeating
 * `finance.reconcilePayments`'s double-count refusal.
 */
const asId = (raw: unknown): string | null =>
  typeof raw === "string" && raw.trim() !== "" ? raw : null;

const refOf = (kind: string, row: Record<string, unknown>): Result<SourceRef, string> => {
  const id = asId(row.id);
  if (id === null) return err("A Stripe row needs an id.");
  const ref: SourceRef = { provider: "stripe", kind, id };
  const valid = validateSourceRef(ref);
  return valid.ok ? ok(ref) : valid;
};

/**
 * A Stripe amount. `moneyFromMinor` and NOTHING ELSE — Stripe's integers ARE minor units, already
 * scaled to the currency's own exponent. `moneyFromNumber` would treat `1999` as a decimal amount
 * and report a hundred times the truth.
 */
const amountOf = (raw: unknown, currency: unknown): Result<Money, string> => {
  const cur = normalizeCurrency(currency);
  if (!cur.ok) return cur;
  if (typeof raw !== "number") return err("A Stripe amount must be a number of minor units.");
  return moneyFromMinor(raw, cur.value);
};

// ── One list page ─────────────────────────────────────────────────────────────────────────

export type StripePage = { rows: readonly Record<string, unknown>[]; cursor: string | null };

/**
 * Extract one page of a Stripe list.
 *
 * An EMPTY `data` array with `has_more: false` is a normal end, not a failure. The cursor is the
 * LAST ROW'S ID, which is what `starting_after` takes; `has_more: false` ends the walk.
 *
 * A `has_more: true` page whose last row has no usable id ends the walk too. Handing back the
 * previous cursor would spin to the page cap and report a bounded read when the truth is a broken
 * one — `connectorFetch`'s repeated-cursor guard would catch it, but reporting `partial` from a
 * cap is a worse sentence than simply stopping.
 */
export function parseListPage(raw: unknown): StripePage {
  const body = asRecord(raw);
  if (body === null) throw new Error("A Stripe list response must be an object.");
  if (body.object !== "list") throw new Error("A Stripe list response must be a list.");
  if (!Array.isArray(body.data)) throw new Error("A Stripe list response has no data array.");
  const rows: Record<string, unknown>[] = [];
  for (const item of body.data) {
    const row = asRecord(item);
    if (row !== null) rows.push(row);
  }
  if (body.has_more !== true) return { rows, cursor: null };
  const last = rows[rows.length - 1];
  return { rows, cursor: last === undefined ? null : asId(last.id) };
}

/**
 * The Stripe search parameters for one bounded window.
 *
 * Stripe filters on `created` in unix SECONDS, so the window is truncated rather than rounded: an
 * end boundary rounded UP would read a second of data outside the window the projection claims to
 * cover.
 */
export function stripeWindowParams(window: { startMs: number; endMs: number }): URLSearchParams {
  return new URLSearchParams({
    "created[gte]": String(Math.floor(window.startMs / 1000)),
    "created[lte]": String(Math.floor(window.endMs / 1000)),
    limit: String(STRIPE_PAGE_SIZE),
  });
}

// ── Balance ───────────────────────────────────────────────────────────────────────────────

function balanceAmounts(raw: unknown, label: string): Result<Money[], string> {
  if (!Array.isArray(raw)) return err(`A Stripe balance needs an ${label} array.`);
  const out: Money[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (row === null) return err(`A Stripe ${label} entry must be an object.`);
    const money = amountOf(row.amount, row.currency);
    if (!money.ok) return money;
    out.push(money.value);
  }
  return ok(out);
}

/**
 * The account's balance, per currency, with available and pending kept APART.
 *
 * They are different facts: `available` is spendable now, `pending` has not settled. Adding them
 * would report money the business cannot use as if it could. A Stripe account can hold several
 * currencies at once and this returns all of them uncombined — totalling across currencies without
 * an FX rate nobody supplied is not a thing `money.ts` will do.
 */
export function parseBalance(raw: unknown): Result<StripeBalance, string> {
  const body = asRecord(raw);
  if (body === null) return err("A Stripe balance must be an object.");
  if (body.object !== "balance") return err("That Stripe response is not a balance.");
  const available = balanceAmounts(body.available, "available");
  if (!available.ok) return available;
  const pending = balanceAmounts(body.pending, "pending");
  if (!pending.ok) return pending;
  return ok({ available: available.value, pending: pending.value });
}

// ── Charges ───────────────────────────────────────────────────────────────────────────────

/**
 * A succeeded charge as a payment-rail receipt.
 *
 * NET OF REFUNDS, computed by `money.subMoney` rather than here: a gross charge that was later
 * refunded is not cash the business kept, and reporting it as a receipt overstates income. The
 * subtraction is a money-module call, not adapter arithmetic — this file still owns no math.
 *
 * A charge that is not `succeeded` is refused rather than recorded at zero. `pending` may yet
 * succeed and `failed` never will; neither is a receipt, and both would be indistinguishable from a
 * genuine zero once normalized.
 */
export function normalizeCharge(raw: unknown): Result<Payment, string> {
  const row = asRecord(raw);
  if (row === null) return err("A Stripe charge must be an object.");
  const ref = refOf("charge", row);
  if (!ref.ok) return ref;
  if (row.status !== "succeeded") return err("Only a succeeded Stripe charge is a receipt.");

  // `amount_captured` rather than `amount`: an authorized-but-uncaptured charge never moved money.
  const captured = amountOf(row.amount_captured ?? row.amount, row.currency);
  if (!captured.ok) return captured;
  const refunded = amountOf(row.amount_refunded ?? 0, row.currency);
  if (!refunded.ok) return refunded;
  const net = subMoney(captured.value, refunded.value);
  if (!net.ok) return net;
  if (net.value.minor < 0) {
    // More refunded than captured is a normalization bug, not a negative receipt. Refusing the ROW
    // keeps one broken charge from taking the whole receipts answer negative.
    return err("A Stripe charge cannot be refunded beyond what it captured.");
  }

  const paidAt = stripeTime(row.created);
  if (paidAt === null) return err("A Stripe charge needs a created time.");
  return ok({
    ref: ref.value,
    // The rail, not the books. `finance.reconcilePayments` uses exactly this to refuse counting the
    // same business activity twice when QuickBooks reports it from the accounting side.
    authority: "payment_rail",
    invoiceId: asId(row.invoice),
    paidAt,
    amount: net.value,
  });
}

// ── Invoices ──────────────────────────────────────────────────────────────────────────────

/**
 * A Stripe invoice as a receivable.
 *
 * `total` is what was billed and `amount_remaining` is what is still owed — the same split
 * `agingReport` expects. `customer` is carried as an OPAQUE ID and never `customer_name` or
 * `customer_email`: a customer name is content, and names belong to Phase 19's contacts substrate
 * (CLAUDE.md §4).
 */
export function normalizeStripeInvoice(raw: unknown): Result<Invoice, string> {
  const row = asRecord(raw);
  if (row === null) return err("A Stripe invoice must be an object.");
  const ref = refOf("invoice", row);
  if (!ref.ok) return ref;
  if (!(RECEIVABLE_INVOICE_STATUSES as readonly unknown[]).includes(row.status)) {
    return err("Only an open or paid Stripe invoice is a receivable.");
  }
  const total = amountOf(row.total, row.currency);
  if (!total.ok) return total;
  const outstanding = amountOf(row.amount_remaining, row.currency);
  if (!outstanding.ok) return outstanding;
  if (outstanding.value.minor < 0) {
    return err("A Stripe invoice balance cannot be negative.");
  }
  const issuedAt = stripeTime(row.created);
  if (issuedAt === null) return err("A Stripe invoice needs a created time.");
  const customer = asId(row.customer);
  if (customer === null) return err("A Stripe invoice needs a customer id.");
  return ok({
    ref: ref.value,
    customerRef: customer,
    issuedAt,
    dueAt: stripeTime(row.due_date),
    total: total.value,
    outstanding: outstanding.value,
  });
}

// ── Payouts and disputes ──────────────────────────────────────────────────────────────────

/**
 * A payout: money leaving Stripe for the bank.
 *
 * Dated by `arrival_date`, not `created`. A cash timeline built on the creation date would show the
 * money landing days before it does, which is precisely the kind of error a runway answer cannot
 * absorb.
 */
export function normalizePayout(raw: unknown): Result<StripePayout, string> {
  const row = asRecord(raw);
  if (row === null) return err("A Stripe payout must be an object.");
  const ref = refOf("payout", row);
  if (!ref.ok) return ref;
  const amount = amountOf(row.amount, row.currency);
  if (!amount.ok) return amount;
  const arrivesAt = stripeTime(row.arrival_date);
  if (arrivesAt === null) return err("A Stripe payout needs an arrival date.");
  if (!(PAYOUT_STATUSES as readonly unknown[]).includes(row.status)) {
    return err("Unknown Stripe payout status.");
  }
  return {
    ok: true,
    value: { ref: ref.value, amount: amount.value, arrivesAt, status: row.status as PayoutStatus },
  };
}

/**
 * A dispute: money at risk, bound to the charge it contests.
 *
 * READ FOR CONTEXT ONLY. The normalized shape has five fields and none of them is evidence, a
 * submission or a deadline to act on — there is deliberately nothing here that a later change could
 * grow into "and now respond to it". Invariant 1 of `docs/playbooks/connector-stripe.md`.
 */
export function normalizeDispute(raw: unknown): Result<StripeDispute, string> {
  const row = asRecord(raw);
  if (row === null) return err("A Stripe dispute must be an object.");
  const ref = refOf("dispute", row);
  if (!ref.ok) return ref;
  const amount = amountOf(row.amount, row.currency);
  if (!amount.ok) return amount;
  const openedAt = stripeTime(row.created);
  if (openedAt === null) return err("A Stripe dispute needs a created time.");
  if (!(DISPUTE_STATUSES as readonly unknown[]).includes(row.status)) {
    return err("Unknown Stripe dispute status.");
  }
  return {
    ok: true,
    value: {
      ref: ref.value,
      amount: amount.value,
      openedAt,
      status: row.status as DisputeStatus,
      chargeRef: asId(row.charge),
    },
  };
}
