/**
 * PayPal — the PURE normalizer (CLAUDE.md §1). No Convex, no network, no LLM.
 *
 * Total functions over raw PayPal JSON. It names the two paths a read may use, walks one page of
 * Transaction Search, and turns vendor rows into the phase's normalized vocabulary. It computes NO
 * business arithmetic: aging, cash timelines, reconciliation and confidence are `finance.ts`'s job.
 *
 * ═══ THE ONE BUG THIS MODULE EXISTS TO NOT HAVE: FLOAT MONEY ═══
 *
 * PayPal sends every amount as a DECIMAL STRING plus a currency code — `{"currency_code": "USD",
 * "value": "19.99"}`. `parseMoney` is the door, and it is BigInt/string arithmetic: `"0.29"` USD is
 * exactly `29`, where `0.29 * 100` in IEEE 754 is `28.999999999999996`. `moneyFromNumber` and any
 * hand-rolled `* 100` must never appear in this file, and a currency's own exponent decides the
 * scale — `"5000"` JPY is `5000` minor units, not `500000`.
 *
 * ═══ THE READ SURFACE IS TWO PATHS, AND THE THIRD ONE IS A RECORDED GAP ═══
 *
 * `/v1/reporting/transactions` and `/v1/reporting/balances` are everything PayPal publishes for this
 * data. The third-party surface — the one that would read a TENANT'S merchant rather than the app
 * owner's own account — is the `partner-transactions` resource, which the published spec NAMES in
 * its tag list and for which it publishes NO OPERATION. So `PAYPAL_PARTNER_TRANSACTIONS_PATH` is
 * `null` rather than a guess. Nothing here may invent it, and no fixture may assert a response it
 * has never seen. `docs/connectors/paypal-suitability.md` carries the evidence; 28-25 owes the
 * resolution.
 *
 * NO REQUEST METHOD, EVER. There is not a verb, an origin or a header in this file. `connectorFetch`
 * owns the origin, the compile-time allow-list and the hardcoded GET. Both PayPal paths are reads
 * with no write sibling on the same path, but the allow-list is still the boundary that stops a
 * stolen token reaching `/v2/checkout`-shaped routes.
 *
 * ═══ THE NUMBERS BELOW ARE TWO DIFFERENT KINDS OF FACT ═══
 *
 * PayPal's own hard constraints (31-day maximum range, three-hour listing latency, three-year
 * history) are quoted from its Transaction Search documentation. The page size and page cap are
 * THIS REPOSITORY'S conservative choices: PayPal's rate-limit page renders no content to a non-JS
 * fetch, so no numeric limit could be sourced, and attributing an invented figure to PayPal would be
 * worse than bounding the read ourselves and saying so.
 */
import { err, ok, type Result } from "@pikar/core/result";
import { type Money, type Payment, type SourceRef, validateSourceRef } from "../contracts";
import { parseMoney } from "../money";
import { boundedWindow, type ReadWindow } from "./shared";

// ── The closed set of things this lane may read ───────────────────────────────────────────

/**
 * Every PayPal entity this repo reads. Adding a member is a security change with the same review as
 * an allow-list edit, and it must arrive with its normalizer.
 *
 * INVOICES ARE DELIBERATELY ABSENT, not forgotten. The phase's approved read surface names them,
 * but PayPal's Partner Referrals feature enum has no read-only invoice member: the only feature that
 * reaches an invoice is `INVOICE_READ_WRITE`, which also grants invoice dispatch — a write
 * 28-CONTEXT explicitly defers. So the invoice half is dropped rather than bought with a write
 * permission. `ponytail:` upgrade path — if PayPal ever ships a read-only invoice feature, add the
 * entity, its path, its normalizer and a captured fixture in one change.
 */
export const PAYPAL_ENTITIES = ["transactions", "balances"] as const;
export type PayPalEntity = (typeof PAYPAL_ENTITIES)[number];

export const isPayPalEntity = (v: unknown): v is PayPalEntity =>
  typeof v === "string" && (PAYPAL_ENTITIES as readonly string[]).includes(v);

/**
 * The one path each entity reads. Compared against `connectorFetch.PROVIDER_READ_PATHS.paypal` by
 * `paypalConnector.test.ts` in BOTH directions, so the pure module and the transport allow-list
 * cannot drift apart.
 */
export const PAYPAL_READ_PATHS: Record<PayPalEntity, string> = {
  transactions: "/v1/reporting/transactions",
  balances: "/v1/reporting/balances",
};

/**
 * THE GAP, as a value rather than as prose.
 *
 * `null` because PayPal's published spec declares a `partner-transactions` tag with no published
 * operation. A string here would be an invented endpoint; a caller that found one would build a
 * request nobody has ever seen answered, and a fixture written against it would be fiction.
 */
export const PAYPAL_PARTNER_TRANSACTIONS_PATH: string | null = null;

/** PayPal's Transaction Search paginates by PAGE NUMBER, from 1 — not by an opaque cursor. */
export const PAYPAL_CURSOR_PARAM = "page";

/**
 * Rows per page. THIS REPOSITORY'S number: PayPal's documented maximum is larger, and its
 * rate-limit page could not be read at all, so a smaller page is the conservative answer rather
 * than a figure attributed to PayPal.
 */
export const PAYPAL_PAGE_SIZE = 100;

/** Pages per entity read. Five x 100 is 500 transactions a poll — again this repo's bound. */
export const PAYPAL_MAX_PAGES = 5;

/**
 * PAYPAL'S OWN HARD LIMIT, quoted: "The maximum supported range is 31 days." Asking for more is
 * refused here rather than silently truncated by PayPal, because a truncated answer that looked
 * complete would understate a period.
 */
export const PAYPAL_MAX_WINDOW_DAYS = 31;

/** The default read window. The provider's maximum, since it is already short. */
export const PAYPAL_DEFAULT_WINDOW_DAYS = 31;

/**
 * PAYPAL'S OWN HARD LIMIT, quoted: "It takes a maximum of three hours for executed transactions to
 * appear in the list transactions call."
 *
 * So a read's coverage window ENDS three hours back. Reading up to `now` would claim coverage of a
 * period PayPal has not finished populating — an under-count presented as a total, which is exactly
 * the failure mode this phase spends its caps preventing. Pulling the end back makes the claimed
 * coverage TRUE, rather than making every single read permanently `partial`.
 */
export const PAYPAL_TRANSACTION_LATENCY_MS = 3 * 60 * 60 * 1000;

/** PayPal's own: "This call lists transaction for the previous three years." */
export const PAYPAL_HISTORY_YEARS = 3;

// ── Primitives ────────────────────────────────────────────────────────────────────────────

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * PayPal's date-time strings, as an instant in millis — or `null`.
 *
 * PayPal writes the offset BOTH ways (`+0000` and `+05:30`), and `Date.parse` on the compact form is
 * implementation-defined rather than specified, so this parses explicitly instead of trusting the
 * host. `null` rather than a throw or a guess: an unreadable date is unknown, and coercing one puts
 * a transaction inside a coverage window nobody proved it belongs to.
 */
const PAYPAL_DATE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:?\d{2})$/;

export function paypalTime(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = PAYPAL_DATE.exec(raw);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const ms = Number((frac ?? "").padEnd(3, "0") || "0");
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  if (!Number.isFinite(base)) return null;
  if (zone === "Z") return base;
  const sign = (zone ?? "").startsWith("-") ? -1 : 1;
  const digits = (zone ?? "").slice(1).replace(":", "");
  const offsetMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
  // The wall clock is `offset` ahead of UTC, so the instant is the clock reading MINUS the offset.
  return base - sign * offsetMinutes * 60_000;
}

/** An opaque PayPal id. Never an object, never an empty string. */
const asId = (raw: unknown): string | null =>
  typeof raw === "string" && raw.trim() !== "" ? raw : null;

/**
 * A PayPal money object, `{currency_code, value}`, through the ONE decimal door.
 *
 * `parseMoney` and nothing else. `value` must be a STRING: a JSON number here would mean PayPal
 * changed shape, and routing it through a number parser would quietly accept a float that has
 * already lost precision before this code ever saw it.
 */
function amountOf(raw: unknown): Result<Money, string> {
  const row = asRecord(raw);
  if (row === null) return err("A PayPal amount must be an object.");
  return parseMoney(row.value, row.currency_code);
}

// ── One page of Transaction Search ────────────────────────────────────────────────────────

export type PayPalPage = { rows: readonly Record<string, unknown>[]; cursor: string | null };

/**
 * Extract one page of a Transaction Search response.
 *
 * An EMPTY `transaction_details` array is a normal end, not a failure — but a response that is not a
 * transaction list THROWS, because "no transactions" and "we could not read the answer" are
 * different sentences and reporting the second as the first states zero revenue as a fact.
 *
 * The cursor is the NEXT page number. Anything that makes the counters untrustworthy — a
 * non-integer, a page below 1, a page at or past the last one — ends the walk. Handing back a
 * cursor we cannot trust would spin to the page cap and report `partial` from a cap when the truth
 * is a broken response.
 */
export function parseTransactionsPage(raw: unknown): PayPalPage {
  const body = asRecord(raw);
  if (body === null) throw new Error("A PayPal transaction response must be an object.");
  if (!Array.isArray(body.transaction_details)) {
    throw new Error("A PayPal transaction response has no transaction_details array.");
  }
  const rows: Record<string, unknown>[] = [];
  for (const item of body.transaction_details) {
    const row = asRecord(item);
    if (row !== null) rows.push(row);
  }
  const page = body.page;
  const totalPages = body.total_pages;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(totalPages))
    return { rows, cursor: null };
  const current = page as number;
  if (current < 1 || current >= (totalPages as number)) return { rows, cursor: null };
  return { rows, cursor: String(current + 1) };
}

// ── The window ────────────────────────────────────────────────────────────────────────────

/**
 * A bounded coverage window for a PayPal read, ending `PAYPAL_TRANSACTION_LATENCY_MS` before
 * `asOfMs`.
 *
 * Built on the shared `boundedWindow` so the phase-wide cap still applies, then narrowed to
 * PayPal's own 31-day maximum. Two caps, both enforced, neither restated: a window this repo would
 * allow but PayPal would truncate must be refused HERE, or the projection claims a period the
 * provider never returned.
 */
export function paypalReadWindow(asOfMs: number, days: number): Result<ReadWindow, string> {
  if (!Number.isSafeInteger(days) || days < 1 || days > PAYPAL_MAX_WINDOW_DAYS) {
    return err(`A PayPal read window must be 1..${PAYPAL_MAX_WINDOW_DAYS} whole days.`);
  }
  if (!Number.isFinite(asOfMs)) return err("A read window needs a valid as-of time.");
  return boundedWindow(asOfMs - PAYPAL_TRANSACTION_LATENCY_MS, days);
}

/**
 * The Transaction Search parameters for one bounded window.
 *
 * `fields=transaction_info` is a PRIVACY bound, not an optimisation: the other blocks
 * (`payer_info`, `cart_info`, `shipping_info`) carry a customer's name, email and address, and this
 * repository must not receive them at all, let alone store them (CLAUDE.md §4). Narrowing the
 * request is the only place that content can be stopped before it crosses the wire.
 *
 * `transaction_status=S` asks only for successful transactions. Pending may yet fail and denied
 * never happened; neither is a receipt, and `normalizeTransaction` refuses them independently.
 */
export function paypalWindowParams(window: ReadWindow): URLSearchParams {
  return new URLSearchParams({
    start_date: new Date(window.startMs).toISOString(),
    end_date: new Date(window.endMs).toISOString(),
    fields: "transaction_info",
    transaction_status: "S",
    page_size: String(PAYPAL_PAGE_SIZE),
    page: "1",
  });
}

// ── Transactions ──────────────────────────────────────────────────────────────────────────

/**
 * One PayPal transaction as a payment-rail receipt.
 *
 * A NEGATIVE AMOUNT IS KEPT, and that is the opposite of the Stripe lane's rule for a reason.
 * PayPal reports a refund, reversal or chargeback as its OWN transaction with a negative amount and
 * status `S`; the gross charge stays where it is. Refusing the negative row would leave the charge
 * standing alone and report money the business gave back as money it kept. (Stripe instead nets the
 * refund into the charge row, which is why a negative there means a broken row rather than a real
 * reversal.)
 *
 * `fee_amount` is deliberately NOT subtracted. It is a different fact — what PayPal charged — and
 * this phase consumes no fee figure; netting it in here would make "received" quietly mean
 * "received after fees" in one rail and not the other, and `finance.reconcilePayments` compares
 * across rails.
 *
 * Nothing free-text survives: no `transaction_subject`, no `transaction_note`, no payer block. The
 * output has five fields and every one is a ref, an id, a time or a Money.
 */
export function normalizeTransaction(raw: unknown): Result<Payment, string> {
  const row = asRecord(raw);
  if (row === null) return err("A PayPal transaction must be an object.");
  const info = asRecord(row.transaction_info);
  if (info === null) return err("A PayPal transaction needs a transaction_info block.");

  const id = asId(info.transaction_id);
  if (id === null) return err("A PayPal transaction needs an id.");
  const ref: SourceRef = { provider: "paypal", kind: "transaction", id };
  const valid = validateSourceRef(ref);
  if (!valid.ok) return valid;

  // `S` is PayPal's success code. `P` (pending) may yet fail, `V` (reversed) and `D` (denied) are
  // not receipts, and recording any of them at zero would be indistinguishable from a genuine zero.
  if (info.transaction_status !== "S")
    return err("Only a successful PayPal transaction is a receipt.");

  const amount = amountOf(info.transaction_amount);
  if (!amount.ok) return amount;

  const paidAt = paypalTime(info.transaction_initiation_date);
  if (paidAt === null) return err("A PayPal transaction needs an initiation date.");

  return ok({
    ref,
    // The rail, not the books. `finance.reconcilePayments` uses exactly this to refuse counting the
    // same business activity twice when QuickBooks reports it from the accounting side.
    authority: "payment_rail",
    invoiceId: asId(info.invoice_id),
    paidAt,
    amount: amount.value,
  });
}

// ── Balances ──────────────────────────────────────────────────────────────────────────────

/**
 * The merchant's balance, per currency, with available and total kept APART.
 *
 * They are different facts: `available` is spendable now, `total` includes what is withheld or
 * unsettled. Reporting the total as spendable would show money the business cannot use as if it
 * could. Currencies are never combined — there is no FX rate here and inventing one is not a thing
 * `money.ts` will do.
 *
 * The response's `account_id` is DROPPED. It is the business's own PayPal identifier and nothing
 * downstream needs it.
 */
export type PayPalBalances = {
  available: readonly Money[];
  total: readonly Money[];
};

export function parseBalances(raw: unknown): Result<PayPalBalances, string> {
  const body = asRecord(raw);
  if (body === null) return err("A PayPal balance response must be an object.");
  if (!Array.isArray(body.balances))
    return err("A PayPal balance response needs a balances array.");
  const available: Money[] = [];
  const total: Money[] = [];
  for (const entry of body.balances) {
    const row = asRecord(entry);
    if (row === null) return err("A PayPal balance entry must be an object.");
    // The WHOLE response is refused on one bad entry rather than dropping that currency: a silently
    // missing ledger understates the money on hand and nothing downstream could tell it from an
    // account that simply holds no euros.
    const av = amountOf(row.available_balance);
    if (!av.ok) return av;
    const tot = amountOf(row.total_balance);
    if (!tot.ok) return tot;
    available.push(av.value);
    total.push(tot.value);
  }
  return ok({ available, total });
}
