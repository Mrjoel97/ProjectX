/**
 * The QuickBooks normalizer, proven offline. $0 — no network, no provider, no model.
 *
 * What these tests are actually defending, beyond "the parser works":
 *
 *  • MISSING IS NOT ZERO. A row that will not normalize is COUNTED, so a caller can go `partial`.
 *    A test that only checked the happy rows would pass over the exact bug that turns a capped
 *    receivables read into a confident understatement.
 *  • THE ADAPTER DOES NO ARITHMETIC. The aging/lag/timeline assertions here run `finance.ts` over
 *    normalized rows. If someone re-implements a total in the provider module, the reuse it was
 *    supposed to replace is what these tests keep pointing at.
 *  • MIXED CURRENCY IS SEPARATED AND NAMED, never summed and never silently dropped.
 *  • NO REQUEST VERB EXISTS. A source scan, because a type cannot express "this file contains no
 *    way to POST".
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CAPS } from "../contracts";
import { agingReport, cashTimeline, paymentLag, reconcilePayments } from "../finance";
import { moneyFromMinor } from "../money";
import {
  boundedWindow,
  buildEntityQuery,
  isQbEntity,
  normalizeAll,
  normalizeBill,
  normalizeCashAccount,
  normalizeInvoice,
  normalizePayment,
  pagedQuery,
  parseQbDate,
  parseQueryPage,
  QB_DEFAULT_WINDOW_DAYS,
  QB_ENTITIES,
  QB_PAGE_SIZE,
  qbDate,
  separateByCurrency,
} from "./quickbooks";

const moduleSource = readFileSync(new URL("./quickbooks.ts", import.meta.url), "utf8");

const DAY = 86_400_000;
const AS_OF = Date.parse("2026-06-01T12:00:00.000Z");

const invoiceRow = (over: Record<string, unknown> = {}) => ({
  Id: "1042",
  TxnDate: "2026-03-02",
  DueDate: "2026-04-01",
  TotalAmt: 1250.5,
  Balance: 1250.5,
  CustomerRef: { value: "58", name: "Acme Widgets, Inc." },
  ...over,
});

// ── The closed vocabulary ─────────────────────────────────────────────────────────────────

describe("the readable entity set is closed", () => {
  test("only the four normalized entities are members", () => {
    expect([...QB_ENTITIES]).toEqual(["Invoice", "Payment", "Bill", "Account"]);
  });

  // The one entity whose presence would put an accounting WRITE's shape in the tree. A rename
  // mutation on `QB_ENTITIES` is caught by the literal list above; this states the intent.
  test("JournalEntry is not readable", () => {
    expect(isQbEntity("JournalEntry")).toBe(false);
    expect(isQbEntity("Invoice")).toBe(true);
  });
});

describe("the module contains no request verb and no transport", () => {
  const text = moduleSource;

  test("the source was actually loaded", () => {
    expect(text.length).toBeGreaterThan(1000);
  });

  test.each([
    ["a fetch call", "fetch("],
    ["an http origin", "https://"],
    ["a POST verb", "POST"],
    ["a PUT verb", "PUT"],
    ["a DELETE verb", "DELETE"],
    ["an Authorization header", "Authorization"],
  ])("it contains no %s", (_label, marker) => {
    expect(text.includes(marker)).toBe(false);
  });
});

// ── Dates and windows ─────────────────────────────────────────────────────────────────────

describe("dates", () => {
  test("renders UTC YYYY-MM-DD", () => {
    const rendered = qbDate(Date.parse("2026-03-02T23:30:00.000Z"));
    expect(rendered.ok && rendered.value).toBe("2026-03-02");
  });

  test("refuses a non-finite timestamp rather than emitting Invalid Date", () => {
    expect(qbDate(Number.NaN).ok).toBe(false);
    expect(qbDate(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  test("parses a date to UTC midnight, not local", () => {
    expect(parseQbDate("2026-03-02")).toBe(Date.parse("2026-03-02T00:00:00.000Z"));
  });

  test("an absent or malformed due date is null, never a coerced number", () => {
    for (const bad of [undefined, null, "", "03/02/2026", "2026-3-2", 1772409600000, {}]) {
      expect(parseQbDate(bad)).toBeNull();
    }
  });
});

describe("read windows are bounded", () => {
  test("the default window is this repo's choice, and it is inside the cap", () => {
    expect(QB_DEFAULT_WINDOW_DAYS).toBe(180);
    expect(QB_DEFAULT_WINDOW_DAYS).toBeLessThanOrEqual(CAPS.maxWindowDays);
  });

  test("a window wider than the projection cap is refused", () => {
    expect(boundedWindow(AS_OF, CAPS.maxWindowDays).ok).toBe(true);
    expect(boundedWindow(AS_OF, CAPS.maxWindowDays + 1).ok).toBe(false);
  });

  test("a zero, negative or fractional day count is refused", () => {
    for (const days of [0, -1, 1.5]) expect(boundedWindow(AS_OF, days).ok).toBe(false);
  });

  test("the window ends at the as-of instant", () => {
    const w = boundedWindow(AS_OF, 30);
    expect(w.ok && w.value.endMs).toBe(AS_OF);
    expect(w.ok && w.value.startMs).toBe(AS_OF - 30 * DAY);
  });
});

// ── Query text ────────────────────────────────────────────────────────────────────────────

describe("query text is code-owned", () => {
  const window = { startMs: Date.parse("2026-01-01T00:00:00Z"), endMs: AS_OF };

  test("an entity query names the entity and both bounds", () => {
    const q = buildEntityQuery("Invoice", window);
    expect(q.ok && q.value).toBe(
      "SELECT * FROM Invoice WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-06-01'",
    );
  });

  test("cash on hand reads only active depository accounts", () => {
    const q = buildEntityQuery("Account", window);
    expect(q.ok && q.value).toBe(
      "SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true",
    );
  });

  test("an unknown entity is refused rather than interpolated", () => {
    const q = buildEntityQuery("JournalEntry" as never, window);
    expect(q.ok).toBe(false);
  });

  test("an inverted or non-finite window is refused before any date is rendered", () => {
    expect(buildEntityQuery("Invoice", { startMs: AS_OF, endMs: AS_OF - DAY }).ok).toBe(false);
    expect(buildEntityQuery("Invoice", { startMs: Number.NaN, endMs: AS_OF }).ok).toBe(false);
  });

  test("pagination lives inside the query text, per Intuit", () => {
    expect(pagedQuery("SELECT * FROM Invoice", 1)).toBe(
      `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS ${QB_PAGE_SIZE}`,
    );
  });

  test("the page size stays inside Intuit's 1000-entity query cap", () => {
    expect(QB_PAGE_SIZE).toBeGreaterThan(0);
    expect(QB_PAGE_SIZE).toBeLessThanOrEqual(1000);
  });
});

// ── Pages ─────────────────────────────────────────────────────────────────────────────────

describe("one response page", () => {
  const base = "SELECT * FROM Invoice";

  test("a short page ends the read", () => {
    const page = parseQueryPage("Invoice", { QueryResponse: { Invoice: [invoiceRow()] } }, base, 1);
    expect(page.rows).toHaveLength(1);
    expect(page.nextQuery).toBeNull();
  });

  test("a full page asks for the next start position", () => {
    const rows = Array.from({ length: QB_PAGE_SIZE }, (_v, i) =>
      invoiceRow({ Id: String(2000 + i) }),
    );
    const page = parseQueryPage("Invoice", { QueryResponse: { Invoice: rows } }, base, 1);
    expect(page.nextQuery).toBe(pagedQuery(base, 1 + QB_PAGE_SIZE));
  });

  test("an empty QueryResponse is a normal end, not a throw", () => {
    const page = parseQueryPage("Invoice", { QueryResponse: {}, time: "2026-06-01" }, base, 1);
    expect(page.rows).toEqual([]);
    expect(page.nextQuery).toBeNull();
  });

  test("a body with no QueryResponse throws, so the transport reports a provider error", () => {
    expect(() => parseQueryPage("Invoice", { Fault: {} }, base, 1)).toThrow();
    expect(() => parseQueryPage("Invoice", "<html>maintenance</html>", base, 1)).toThrow();
  });

  test("non-object rows are dropped rather than reaching a normalizer", () => {
    const page = parseQueryPage(
      "Invoice",
      { QueryResponse: { Invoice: [invoiceRow(), "nope", 7, null] } },
      base,
      1,
    );
    expect(page.rows).toHaveLength(1);
  });
});

// ── Invoices ──────────────────────────────────────────────────────────────────────────────

describe("invoice normalization", () => {
  test("money lands as integer minor units with an explicit currency", () => {
    const inv = normalizeInvoice(invoiceRow(), "USD");
    expect(inv.ok && inv.value.total).toEqual({ minor: 125050, currency: "USD" });
    expect(inv.ok && inv.value.outstanding).toEqual({ minor: 125050, currency: "USD" });
  });

  test("a float amount does not accumulate float error", () => {
    const inv = normalizeInvoice(invoiceRow({ TotalAmt: 0.1, Balance: 0.2 }), "USD");
    expect(inv.ok && inv.value.total.minor).toBe(10);
    expect(inv.ok && inv.value.outstanding.minor).toBe(20);
  });

  test("the row's own CurrencyRef wins over the home currency", () => {
    const inv = normalizeInvoice(invoiceRow({ CurrencyRef: { value: "eur" } }), "USD");
    expect(inv.ok && inv.value.total.currency).toBe("EUR");
  });

  test("an absent CurrencyRef takes the home currency, never a hardcoded USD", () => {
    const row = invoiceRow();
    delete (row as Record<string, unknown>).CurrencyRef;
    const inv = normalizeInvoice(row, "GBP");
    expect(inv.ok && inv.value.total.currency).toBe("GBP");
  });

  test("a zero-decimal currency parses without a phantom factor of 100", () => {
    const inv = normalizeInvoice(
      invoiceRow({ CurrencyRef: { value: "JPY" }, TotalAmt: 1250, Balance: 1250 }),
      "USD",
    );
    expect(inv.ok && inv.value.total).toEqual({ minor: 1250, currency: "JPY" });
  });

  test("an absent due date is null, and it ages as unknown rather than current", () => {
    const row = invoiceRow();
    delete (row as Record<string, unknown>).DueDate;
    const inv = normalizeInvoice(row, "USD");
    expect(inv.ok && inv.value.dueAt).toBeNull();
    const aged = agingReport(inv.ok ? [inv.value] : [], AS_OF, "USD");
    expect(aged.ok && aged.value.buckets.unknown.count).toBe(1);
    expect(aged.ok && aged.value.buckets.current.count).toBe(0);
  });

  test("the customer is carried as an opaque id, never the name", () => {
    const inv = normalizeInvoice(invoiceRow(), "USD");
    expect(inv.ok && inv.value.customerRef).toBe("58");
    expect(JSON.stringify(inv)).not.toContain("Acme");
  });

  test.each([
    ["no Id", { Id: undefined }],
    ["a non-string Id", { Id: 1042 }],
    ["no TxnDate", { TxnDate: undefined }],
    ["no CustomerRef", { CustomerRef: undefined }],
    ["no TotalAmt", { TotalAmt: undefined }],
    ["no Balance", { Balance: undefined }],
    ["a negative balance", { Balance: -5 }],
    ["a non-numeric amount", { TotalAmt: "1250.50" }],
    ["a bad currency code", { CurrencyRef: { value: "DOLLARS" } }],
  ])("a row with %s is refused, not repaired", (_label, over) => {
    expect(normalizeInvoice(invoiceRow(over), "USD").ok).toBe(false);
  });

  test("a non-object row is refused", () => {
    for (const bad of [null, "x", 7, []]) expect(normalizeInvoice(bad, "USD").ok).toBe(false);
  });
});

// ── Payments ──────────────────────────────────────────────────────────────────────────────

describe("payment normalization", () => {
  const paymentRow = (over: Record<string, unknown> = {}) => ({
    Id: "77",
    TxnDate: "2026-04-10",
    TotalAmt: 1250.5,
    Line: [{ LinkedTxn: [{ TxnId: "1042", TxnType: "Invoice" }] }],
    ...over,
  });

  test("a payment is attributed to the books, not to a rail", () => {
    const p = normalizePayment(paymentRow(), "USD");
    expect(p.ok && p.value.authority).toBe("accounting_authority");
  });

  test("a single linked invoice is carried", () => {
    const p = normalizePayment(paymentRow(), "USD");
    expect(p.ok && p.value.invoiceId).toBe("1042");
  });

  test("a payment split across invoices links to none rather than to an arbitrary one", () => {
    const p = normalizePayment(
      paymentRow({
        Line: [
          { LinkedTxn: [{ TxnId: "1042", TxnType: "Invoice" }] },
          { LinkedTxn: [{ TxnId: "1043", TxnType: "Invoice" }] },
        ],
      }),
      "USD",
    );
    expect(p.ok && p.value.invoiceId).toBeNull();
  });

  test("a non-invoice linked transaction is not treated as an invoice link", () => {
    const p = normalizePayment(
      paymentRow({ Line: [{ LinkedTxn: [{ TxnId: "900", TxnType: "CreditMemo" }] }] }),
      "USD",
    );
    expect(p.ok && p.value.invoiceId).toBeNull();
  });

  test("an unlinked payment still carries its cash", () => {
    const p = normalizePayment(paymentRow({ Line: undefined }), "USD");
    expect(p.ok && p.value.invoiceId).toBeNull();
    expect(p.ok && p.value.amount.minor).toBe(125050);
  });

  test("the books' own payments are never double-counted against themselves", () => {
    const p = normalizePayment(paymentRow(), "USD");
    const reconciled = reconcilePayments([
      {
        authority: "accounting_authority",
        window: { startMs: AS_OF - 180 * DAY, endMs: AS_OF },
        payments: p.ok ? [p.value] : [],
      },
    ]);
    expect(reconciled.included).toHaveLength(1);
    expect(reconciled.excluded).toHaveLength(0);
  });
});

// ── Bills ─────────────────────────────────────────────────────────────────────────────────

describe("bill normalization", () => {
  const billRow = (over: Record<string, unknown> = {}) => ({
    Id: "301",
    TxnDate: "2026-05-01",
    DueDate: "2026-06-15",
    Balance: 900,
    ...over,
  });

  test("a bill is an ordinary obligation and never a payroll run", () => {
    const b = normalizeBill(billRow(), "USD");
    expect(b.ok && b.value.kind).toBe("other");
  });

  // The invariant behind the previous test, stated where a future edit would break it: nothing a
  // vendor bill can say may promote it to `payroll`, because `payrollGap` answers "covered" off
  // that field and QuickBooks Accounting has no payroll schedule in it.
  test.each([
    ["a payroll-looking vendor", { VendorRef: { value: "9", name: "Payroll Services LLC" } }],
    ["a payroll memo", { PrivateNote: "payroll run 2026-06" }],
    ["a literal payroll field", { kind: "payroll" }],
  ])("%s does not make a bill a payroll obligation", (_label, over) => {
    const b = normalizeBill(billRow(over), "USD");
    expect(b.ok && b.value.kind).toBe("other");
  });

  test("a bill with no due date falls back to its transaction date", () => {
    const b = normalizeBill(billRow({ DueDate: undefined }), "USD");
    expect(b.ok && b.value.dueAt).toBe(Date.parse("2026-05-01T00:00:00Z"));
  });

  test("a bill with neither date is refused rather than dated now", () => {
    expect(normalizeBill(billRow({ DueDate: undefined, TxnDate: undefined }), "USD").ok).toBe(
      false,
    );
  });

  test("a negative balance is refused", () => {
    expect(normalizeBill(billRow({ Balance: -1 }), "USD").ok).toBe(false);
  });
});

// ── Cash accounts ─────────────────────────────────────────────────────────────────────────

describe("cash on hand", () => {
  const accountRow = (over: Record<string, unknown> = {}) => ({
    Id: "35",
    AccountType: "Bank",
    CurrentBalance: 4200.75,
    ...over,
  });

  test("a bank account's balance becomes money", () => {
    const a = normalizeCashAccount(accountRow(), "USD");
    expect(a.ok && a.value.balance).toEqual({ minor: 420075, currency: "USD" });
  });

  test.each([
    ["Credit Card"],
    ["Accounts Receivable"],
    ["Other Current Asset"],
    [undefined],
  ])("an account of type %s is not cash on hand", (accountType) => {
    expect(normalizeCashAccount(accountRow({ AccountType: accountType }), "USD").ok).toBe(false);
  });

  test("a missing balance is refused, never read as zero cash", () => {
    expect(normalizeCashAccount(accountRow({ CurrentBalance: undefined }), "USD").ok).toBe(false);
  });
});

// ── Missing is not zero ───────────────────────────────────────────────────────────────────

describe("rows that will not normalize are counted, not dropped silently", () => {
  test("normalizeAll reports the reject count", () => {
    const out = normalizeAll(
      [invoiceRow(), invoiceRow({ Id: undefined }), invoiceRow({ Balance: -3 }), "junk"],
      (raw) => normalizeInvoice(raw, "USD"),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rejected).toBe(3);
  });

  test("a page of entirely bad rows yields zero rows and a non-zero reject count", () => {
    const out = normalizeAll([{}, {}, {}], (raw) => normalizeInvoice(raw, "USD"));
    expect(out.rows).toHaveLength(0);
    // The whole point: an empty `rows` alone would read as "this tenant is owed nothing".
    expect(out.rejected).toBe(3);
  });

  test("the reject count carries no row content", () => {
    const out = normalizeAll([invoiceRow({ Balance: -3 })], (raw) => normalizeInvoice(raw, "USD"));
    expect(JSON.stringify(out)).not.toContain("Acme");
    expect(typeof out.rejected).toBe("number");
  });
});

// ── Mixed currency ────────────────────────────────────────────────────────────────────────

describe("mixed currency is separated and named, never summed", () => {
  const rows = [
    invoiceRow({ Id: "1", CurrencyRef: { value: "USD" } }),
    invoiceRow({ Id: "2", CurrencyRef: { value: "EUR" } }),
    invoiceRow({ Id: "3", CurrencyRef: { value: "JPY" }, TotalAmt: 100, Balance: 100 }),
    invoiceRow({ Id: "4", CurrencyRef: { value: "EUR" } }),
  ];

  test("only the home currency survives, and the others are named once each", () => {
    const normalized = normalizeAll(rows, (raw) => normalizeInvoice(raw, "USD"));
    const split = separateByCurrency(normalized.rows, (i) => i.total.currency, "USD");
    expect(split.kept).toHaveLength(1);
    expect(split.otherCurrencies).toEqual(["EUR", "JPY"]);
  });

  test("finance refuses to age a mixed ledger, so separation is load-bearing", () => {
    const normalized = normalizeAll(rows, (raw) => normalizeInvoice(raw, "USD"));
    expect(agingReport(normalized.rows, AS_OF, "USD").ok).toBe(false);
    const split = separateByCurrency(normalized.rows, (i) => i.total.currency, "USD");
    expect(agingReport(split.kept, AS_OF, "USD").ok).toBe(true);
  });
});

// ── The adapter does no arithmetic of its own ─────────────────────────────────────────────

describe("normalized rows feed the deterministic finance core unchanged", () => {
  const rows = [
    invoiceRow({
      Id: "a",
      TxnDate: "2026-01-05",
      DueDate: "2026-02-05",
      TotalAmt: 100,
      Balance: 100,
    }),
    invoiceRow({
      Id: "b",
      TxnDate: "2026-04-05",
      DueDate: "2026-07-05",
      TotalAmt: 200,
      Balance: 200,
    }),
    invoiceRow({ Id: "c", TxnDate: "2026-03-05", DueDate: "2026-05-05", TotalAmt: 50, Balance: 0 }),
  ];

  test("aging is computed by finance.agingReport over the normalized rows", () => {
    const normalized = normalizeAll(rows, (raw) => normalizeInvoice(raw, "USD"));
    const aged = agingReport(normalized.rows, AS_OF, "USD");
    expect(aged.ok).toBe(true);
    if (!aged.ok) return;
    // 2026-02-05 due, read 2026-06-01 → 116 days overdue.
    expect(aged.value.buckets.d90_plus.count).toBe(1);
    // 2026-07-05 due → not yet due.
    expect(aged.value.buckets.current.count).toBe(1);
    // A settled invoice contributes nothing at all.
    expect(aged.value.outstanding).toEqual({ minor: 30000, currency: "USD" });
  });

  test("payment lag is computed by finance.paymentLag, from the last settlement", () => {
    const invoices = normalizeAll(rows, (raw) => normalizeInvoice(raw, "USD")).rows;
    const payments = normalizeAll(
      [
        {
          Id: "p1",
          TxnDate: "2026-03-20",
          TotalAmt: 25,
          Line: [{ LinkedTxn: [{ TxnId: "c", TxnType: "Invoice" }] }],
        },
        {
          Id: "p2",
          TxnDate: "2026-04-04",
          TotalAmt: 25,
          Line: [{ LinkedTxn: [{ TxnId: "c", TxnType: "Invoice" }] }],
        },
      ],
      (raw) => normalizePayment(raw, "USD"),
    ).rows;
    const lag = paymentLag(invoices, payments);
    expect(lag.ok).toBe(true);
    if (!lag.ok) return;
    // 2026-03-05 issued, last payment 2026-04-04 → 30 days, not the 15 the first payment implies.
    expect(lag.value.medianDays).toMatchObject({ state: "known", value: 30 });
  });

  test("cash on hand feeds finance.cashTimeline; absent cash stays unknown, never zero", () => {
    const account = normalizeCashAccount(
      { Id: "35", AccountType: "Bank", CurrentBalance: 1000 },
      "USD",
    );
    const bills = normalizeAll(
      [{ Id: "b1", TxnDate: "2026-06-02", DueDate: "2026-06-02", Balance: 1500 }],
      (raw) => normalizeBill(raw, "USD"),
    ).rows;
    const outflows = bills.map((b) => ({ atMs: b.dueAt, amount: b.amount }));

    const withCash = cashTimeline({
      openingCash: account.ok ? account.value.balance : null,
      asOfMs: AS_OF,
      horizonDays: 30,
      inflows: [],
      outflows,
    });
    expect(withCash.ok && withCash.value.state).toBe("known");
    if (withCash.ok && withCash.value.state === "known") {
      expect(withCash.value.value.closing).toEqual({ minor: -50000, currency: "USD" });
    }

    const withoutCash = cashTimeline({
      openingCash: null,
      asOfMs: AS_OF,
      horizonDays: 30,
      inflows: [],
      outflows,
    });
    expect(withoutCash.ok && withoutCash.value.state).toBe("unknown");
  });

  test("a money value the adapter produced round-trips through finance untouched", () => {
    const direct = moneyFromMinor(125050, "USD");
    const parsed = normalizeInvoice(invoiceRow(), "USD");
    expect(direct.ok).toBe(true);
    expect(parsed.ok).toBe(true);
    if (!direct.ok || !parsed.ok) return;
    expect(parsed.value.total).toEqual(direct.value);
  });
});
