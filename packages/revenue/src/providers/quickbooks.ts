/**
 * QuickBooks Online — the PURE normalizer (CLAUDE.md §1). No Convex, no network, no LLM.
 *
 * Everything here is a total function over a raw Intuit JSON value. It builds the query text a
 * read will send, walks one response page, and turns vendor rows into the phase's normalized
 * vocabulary. It computes NO business arithmetic: aging, cash timelines, lag and confidence are
 * `finance.ts`'s job and re-deriving any of them here would give the repo a second, divergent
 * definition of a number the owner acts on.
 *
 * THREE PROPERTIES THIS MODULE IS RESPONSIBLE FOR.
 *
 *  1. NO REQUEST METHOD, EVER. There is not a verb, a URL or a header in this file. It emits a
 *     `query` STRING and nothing else; `connectorFetch` owns the origin, the path allow-list and
 *     the hardcoded GET. `com.intuit.quickbooks.accounting` is the only Accounting-API scope Intuit
 *     publishes and it grants WRITES — the allow-list is the whole containment story, so this
 *     module must not grow anything that could relocate a request
 *     (docs/connectors/quickbooks-suitability.md, carried-forward item 1).
 *  2. THE QUERY TEXT IS CODE-OWNED. Entity names come from a closed set and dates are re-rendered
 *     from a timestamp, so no caller-supplied string ever reaches the query. Intuit's query
 *     language has no parameter binding; the only safe answer is that there is nothing to bind.
 *  3. A ROW THAT WILL NOT NORMALIZE IS REPORTED, NOT DROPPED. `normalizeAll` returns a reject COUNT
 *     alongside the rows so the projection can go `partial`. Silently skipping a malformed invoice
 *     understates what a tenant is owed, which is the phase's most expensive possible bug.
 *
 * REPORTS ARE DELIBERATELY ABSENT. `/v3/company/{}/reports/{}` is on the allow-list and this module
 * parses none of them: on 2026-08-27 the Reports API reference could not be read (Intuit's JSON
 * store returns 403 and the docs site is a client-rendered SPA), so a report parser would be
 * written against a GUESSED response shape. Every field `finance.ts` consumes is available from the
 * documented query endpoint instead. `ponytail:` upgrade path — read the Reports reference in a
 * real browser, then add ONE named report mapped to named fields, with a captured fixture.
 */
import { err, ok, type Result } from "@pikar/core/result";
import {
  CAPS,
  type Currency,
  type Invoice,
  type Money,
  type Obligation,
  type Payment,
  type SourceRef,
  validateSourceRef,
} from "../contracts";
import { moneyFromNumber, normalizeCurrency } from "../money";

const DAY_MS = 86_400_000;

// ── The closed set of things this lane may read ───────────────────────────────────────────

/**
 * Every QuickBooks entity this repo reads, and the normalized shape each becomes. Adding a member
 * is a security change with the same review as an allow-list edit: it widens what a stolen token
 * is used FOR, even though it cannot widen what the token can DO.
 *
 * `JournalEntry` is absent and must stay absent — it is the accounting write this lane exists to
 * be incapable of, and reading it would put its shape one edit away from being written.
 */
export const QB_ENTITIES = ["Invoice", "Payment", "Bill", "Account"] as const;
export type QbEntity = (typeof QB_ENTITIES)[number];

export const isQbEntity = (v: unknown): v is QbEntity =>
  typeof v === "string" && (QB_ENTITIES as readonly string[]).includes(v);

/** The `SourceRef.kind` each entity terminates in. Lowercase record classes, never labels. */
const REF_KIND: Record<QbEntity, string> = {
  Invoice: "invoice",
  Payment: "payment",
  Bill: "bill",
  Account: "account",
};

/**
 * Rows requested per page. Intuit caps a query response at 1000 entities; 200 keeps a single page
 * far inside `CAPS.maxBytes` for wide invoice rows and makes the repeated-cursor guard in
 * `connectorFetch` meaningful rather than theoretical.
 */
export const QB_PAGE_SIZE = 200;

/**
 * The default read window, in days.
 *
 * THE WIDELY-CITED "INTUIT RECOMMENDS SIX MONTHS FOR REPORT REQUESTS" FIGURE IS UNSOURCED. It could
 * not be found in primary vendor documentation on 2026-08-27 — only in an Intuit Developer Medium
 * post and a client-rendered KB article, neither admissible
 * (docs/connectors/quickbooks-suitability.md, "Could NOT verify"). 180 days is THIS REPO'S choice,
 * bounded because an unbounded accounting read is a cost and a cap risk, not because Intuit said
 * so. Do not re-describe it as a vendor recommendation.
 */
export const QB_DEFAULT_WINDOW_DAYS = 180;

/** The API version pin. Intuit's `minorversion` is how a response shape stays stable over time. */
export const QB_MINOR_VERSION = "75";

// ── Dates ─────────────────────────────────────────────────────────────────────────────────

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` in UTC. The only date rendering that reaches a query string. */
export function qbDate(ms: number): Result<string, string> {
  if (!Number.isFinite(ms)) return err("A QuickBooks date needs a finite timestamp.");
  let iso: string;
  try {
    iso = new Date(ms).toISOString();
  } catch {
    return err("A QuickBooks date is outside the representable range.");
  }
  const day = iso.slice(0, 10);
  return DATE_TEXT.test(day) ? ok(day) : err("A QuickBooks date could not be rendered.");
}

/**
 * `YYYY-MM-DD` (or a full timestamp) to UTC-midnight millis. Returns `null` rather than throwing or
 * guessing: an absent due date is a real state that `agingBucket` puts in `unknown`, and coercing
 * it to a number would move an undated invoice into `current`.
 */
export function parseQbDate(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const day = raw.slice(0, 10);
  if (!DATE_TEXT.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

export type ReadWindow = { startMs: number; endMs: number };

/**
 * A bounded coverage window ending at `asOfMs`. Refuses anything wider than `CAPS.maxWindowDays`
 * so a caller cannot ask for "since forever" and then present a capped answer as complete.
 */
export function boundedWindow(asOfMs: number, days: number): Result<ReadWindow, string> {
  if (!Number.isFinite(asOfMs)) return err("A read window needs a valid as-of time.");
  if (!Number.isSafeInteger(days) || days < 1 || days > CAPS.maxWindowDays) {
    return err(`A QuickBooks read window must be 1..${CAPS.maxWindowDays} whole days.`);
  }
  return ok({ startMs: asOfMs - days * DAY_MS, endMs: asOfMs });
}

// ── The query text ────────────────────────────────────────────────────────────────────────

/** The date column each entity is windowed on. `Account` is a balance snapshot with no date. */
const WINDOW_COLUMN: Record<QbEntity, string | null> = {
  Invoice: "TxnDate",
  Payment: "TxnDate",
  Bill: "TxnDate",
  Account: null,
};

/**
 * The query text for one entity over one window.
 *
 * Every interpolated fragment is code-owned: the entity name comes from `QB_ENTITIES`, the column
 * from the table above, and the two dates are re-RENDERED from timestamps by `qbDate` rather than
 * passed through. Intuit's query language offers no bind parameters, so "nothing to bind" is the
 * only defence that holds.
 */
export function buildEntityQuery(entity: QbEntity, window: ReadWindow): Result<string, string> {
  if (!isQbEntity(entity)) return err("Unknown QuickBooks entity.");
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) {
    return err("A read window must be a real interval.");
  }
  if (window.endMs < window.startMs) return err("A read window cannot end before it starts.");
  const column = WINDOW_COLUMN[entity];
  if (column === null) {
    // Cash on hand is a snapshot, and only depository accounts hold it. `Active = true` keeps a
    // closed account's stale balance out of a cash figure the owner would act on.
    return ok("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true");
  }
  const from = qbDate(window.startMs);
  if (!from.ok) return from;
  const to = qbDate(window.endMs);
  if (!to.ok) return to;
  return ok(
    `SELECT * FROM ${entity} WHERE ${column} >= '${from.value}' AND ${column} <= '${to.value}'`,
  );
}

/** One page of a query, as Intuit paginates: position and size live INSIDE the query text. */
export function pagedQuery(base: string, startPosition: number): string {
  return `${base} STARTPOSITION ${startPosition} MAXRESULTS ${QB_PAGE_SIZE}`;
}

// ── One response page ─────────────────────────────────────────────────────────────────────

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export type QbPage = { rows: readonly Record<string, unknown>[]; nextQuery: string | null };

/**
 * Extract one page. An EMPTY `QueryResponse` is Intuit's documented "no more rows" and is a normal
 * end, not a failure — throwing there would turn the last page of every read into a provider error.
 *
 * The next cursor is the next QUERY TEXT, because that is where QuickBooks keeps its pagination.
 * `connectorFetch` replaces the `query` search parameter with it, so the transport's
 * repeated-cursor guard still sees a value that changes per page.
 */
export function parseQueryPage(
  entity: QbEntity,
  raw: unknown,
  base: string,
  startPosition: number,
): QbPage {
  const body = asRecord(raw);
  if (body === null) throw new Error("A QuickBooks query response must be an object.");
  const response = asRecord(body.QueryResponse);
  if (response === null) throw new Error("A QuickBooks query response has no QueryResponse.");
  const listed = response[entity];
  const rows: Record<string, unknown>[] = [];
  if (Array.isArray(listed)) {
    for (const item of listed) {
      const row = asRecord(item);
      if (row !== null) rows.push(row);
    }
  }
  const full = rows.length >= QB_PAGE_SIZE;
  return { rows, nextQuery: full ? pagedQuery(base, startPosition + QB_PAGE_SIZE) : null };
}

// ── Row normalization ─────────────────────────────────────────────────────────────────────

const refOf = (entity: QbEntity, row: Record<string, unknown>): Result<SourceRef, string> => {
  const id = row.Id;
  if (typeof id !== "string" || id.trim() === "") return err("A QuickBooks row needs an Id.");
  const ref: SourceRef = { provider: "quickbooks", kind: REF_KIND[entity], id };
  const valid = validateSourceRef(ref);
  return valid.ok ? ok(ref) : valid;
};

/**
 * The row's currency, or the company's home currency.
 *
 * `CurrencyRef` is absent on every row when a company has multicurrency switched OFF, and in that
 * case the home currency IS the row's currency. It is a REQUIRED argument rather than a default, so
 * a caller cannot forget it and have every amount silently become USD.
 */
const currencyOf = (row: Record<string, unknown>, home: Currency): Result<Currency, string> => {
  const ref = asRecord(row.CurrencyRef);
  return ref === null ? normalizeCurrency(home) : normalizeCurrency(ref.value);
};

/** `TotalAmt`/`Balance`/`CurrentBalance` arrive as JSON numbers; `moneyFromNumber` is the one door. */
const amountOf = (
  row: Record<string, unknown>,
  field: string,
  currency: Currency,
): Result<Money, string> => {
  const raw = row[field];
  if (raw === undefined || raw === null) return err(`A QuickBooks row is missing ${field}.`);
  return moneyFromNumber(raw, currency);
};

export function normalizeInvoice(raw: unknown, homeCurrency: Currency): Result<Invoice, string> {
  const row = asRecord(raw);
  if (row === null) return err("A QuickBooks invoice must be an object.");
  const ref = refOf("Invoice", row);
  if (!ref.ok) return ref;
  const currency = currencyOf(row, homeCurrency);
  if (!currency.ok) return currency;
  const total = amountOf(row, "TotalAmt", currency.value);
  if (!total.ok) return total;
  const outstanding = amountOf(row, "Balance", currency.value);
  if (!outstanding.ok) return outstanding;
  // `finance.agingReport` refuses a negative balance because it means a normalization bug. Refusing
  // the ROW here keeps one credit-memo artefact from taking the whole receivables answer down.
  if (outstanding.value.minor < 0) {
    return err("A QuickBooks invoice balance cannot be negative.");
  }
  const issuedAt = parseQbDate(row.TxnDate);
  if (issuedAt === null) return err("A QuickBooks invoice needs a TxnDate.");
  const customer = asRecord(row.CustomerRef)?.value;
  // An opaque id, never `CustomerRef.name` — a customer NAME is content, and names belong to
  // Phase 19's contacts substrate (CLAUDE.md §4).
  if (typeof customer !== "string" || customer.trim() === "") {
    return err("A QuickBooks invoice needs a CustomerRef.");
  }
  return ok({
    ref: ref.value,
    customerRef: customer,
    issuedAt,
    dueAt: parseQbDate(row.DueDate),
    total: total.value,
    outstanding: outstanding.value,
  });
}

/** The linked invoice id, when the payment names exactly one. */
function linkedInvoiceId(row: Record<string, unknown>): string | null {
  const lines = Array.isArray(row.Line) ? row.Line : [];
  const ids: string[] = [];
  for (const line of lines) {
    const linked = asRecord(line)?.LinkedTxn;
    for (const txn of Array.isArray(linked) ? linked : []) {
      const t = asRecord(txn);
      if (t?.TxnType === "Invoice" && typeof t.TxnId === "string" && t.TxnId !== "") {
        if (!ids.includes(t.TxnId)) ids.push(t.TxnId);
      }
    }
  }
  // A payment split across several invoices cannot be attributed to one of them, and picking the
  // first would credit an arbitrary invoice with the whole amount. `null` is the honest answer:
  // `finance.reconcilePayments` still counts the cash, it just cannot match it to a booking.
  return ids.length === 1 ? (ids[0] ?? null) : null;
}

export function normalizePayment(raw: unknown, homeCurrency: Currency): Result<Payment, string> {
  const row = asRecord(raw);
  if (row === null) return err("A QuickBooks payment must be an object.");
  const ref = refOf("Payment", row);
  if (!ref.ok) return ref;
  const currency = currencyOf(row, homeCurrency);
  if (!currency.ok) return currency;
  const amount = amountOf(row, "TotalAmt", currency.value);
  if (!amount.ok) return amount;
  const paidAt = parseQbDate(row.TxnDate);
  if (paidAt === null) return err("A QuickBooks payment needs a TxnDate.");
  return ok({
    ref: ref.value,
    // The books, not the rail. `finance.reconcilePayments` uses exactly this to refuse counting the
    // same business activity twice when Stripe or PayPal reports it from the other side.
    authority: "accounting_authority",
    invoiceId: linkedInvoiceId(row),
    paidAt,
    amount: amount.value,
  });
}

export function normalizeBill(raw: unknown, homeCurrency: Currency): Result<Obligation, string> {
  const row = asRecord(raw);
  if (row === null) return err("A QuickBooks bill must be an object.");
  const ref = refOf("Bill", row);
  if (!ref.ok) return ref;
  const currency = currencyOf(row, homeCurrency);
  if (!currency.ok) return currency;
  const amount = amountOf(row, "Balance", currency.value);
  if (!amount.ok) return amount;
  if (amount.value.minor < 0) return err("A QuickBooks bill balance cannot be negative.");
  // A bill with no due date is payable on demand as far as a cash timeline is concerned; falling
  // back to the transaction date keeps it in the window rather than dropping an obligation.
  const dueAt = parseQbDate(row.DueDate) ?? parseQbDate(row.TxnDate);
  if (dueAt === null) return err("A QuickBooks bill needs a DueDate or a TxnDate.");
  return ok({
    ref: ref.value,
    // ALWAYS `other`, NEVER `payroll`, and this is an invariant rather than a default. QuickBooks
    // Accounting bills are vendor payables; payroll runs live in Intuit's separate payroll product
    // behind scopes this lane does not hold. `finance.payrollGap` answers "unknown" when it has no
    // payroll schedule, and inferring one from a vendor bill would convert that honest gap into a
    // confident and wrong "payroll is covered".
    kind: "other",
    dueAt,
    amount: amount.value,
  });
}

/** A depository account's balance. The only thing this lane offers as cash on hand. */
export function normalizeCashAccount(
  raw: unknown,
  homeCurrency: Currency,
): Result<{ ref: SourceRef; balance: Money }, string> {
  const row = asRecord(raw);
  if (row === null) return err("A QuickBooks account must be an object.");
  const ref = refOf("Account", row);
  if (!ref.ok) return ref;
  if (row.AccountType !== "Bank") return err("Only a Bank account holds cash on hand.");
  const currency = currencyOf(row, homeCurrency);
  if (!currency.ok) return currency;
  const balance = amountOf(row, "CurrentBalance", currency.value);
  if (!balance.ok) return balance;
  return ok({ ref: ref.value, balance: balance.value });
}

// ── Bulk normalization and currency separation ────────────────────────────────────────────

export type Normalized<T> = {
  rows: readonly T[];
  /** How many rows would not normalize. A COUNT, never the row or the reason text (CLAUDE.md §4). */
  rejected: number;
};

/**
 * Normalize a page's worth of rows, counting the ones that refuse.
 *
 * The count is what makes the projection honest: rows that silently vanished would understate a
 * receivables total and there would be nothing to say so.
 */
export function normalizeAll<T>(
  rows: readonly unknown[],
  one: (raw: unknown) => Result<T, string>,
): Normalized<T> {
  const kept: T[] = [];
  let rejected = 0;
  for (const raw of rows) {
    const result = one(raw);
    if (result.ok) kept.push(result.value);
    else rejected += 1;
  }
  return { rows: kept, rejected };
}

/**
 * The "SEPARATE" half of the phase's "reject or separate mixed currency" rule.
 *
 * Rows in the home currency are kept and every other currency is NAMED, so the caller reports a
 * `partial` projection that says which ledgers it could not include. Totalling them together is
 * impossible without an FX rate nobody supplied, and dropping them silently would understate the
 * business — naming them is the only answer that is neither.
 */
export function separateByCurrency<T>(
  rows: readonly T[],
  currencyOfRow: (row: T) => Currency,
  home: Currency,
): { kept: readonly T[]; otherCurrencies: readonly Currency[] } {
  const kept: T[] = [];
  const otherCurrencies: Currency[] = [];
  for (const row of rows) {
    const currency = currencyOfRow(row);
    if (currency === home) kept.push(row);
    else if (!otherCurrencies.includes(currency)) otherCurrencies.push(currency);
  }
  return { kept, otherCurrencies: [...otherCurrencies].sort() };
}
