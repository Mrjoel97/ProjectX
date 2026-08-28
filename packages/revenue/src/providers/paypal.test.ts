// The PayPal normalizer, proven offline. $0 — no network, no PayPal, no model.
//
// ═══ THE FIXTURES ARE PUBLISHED SHAPES ONLY ═══
//
// Every payload below is a `GET /v1/reporting/transactions` or `GET /v1/reporting/balances`
// response — the two operations PayPal actually publishes. NOTHING here asserts a
// `partner-transactions` response: that resource is named in the spec with no published operation,
// so a fixture for it would be a claim about bytes the real API may never produce.
//
// ═══ MONEY IS THE EXPENSIVE ONE ═══
//
// PayPal sends DECIMAL STRINGS plus a currency code. Everything goes through `parseMoney`, which is
// BigInt/string arithmetic — no float ever holds an amount. `"0.29"` USD is exactly `29`, not
// `28.999999999999996`, and `"5000"` JPY is `5000` minor units rather than `500000`, because JPY's
// ISO exponent is 0. Both boundaries are asserted, because a rounding error here misstates a
// business's revenue and every downstream figure inherits it silently.
import { describe, expect, test } from "vitest";
import { CAPS } from "../contracts";
import {
  isPayPalEntity,
  normalizeTransaction,
  PAYPAL_CURSOR_PARAM,
  PAYPAL_DEFAULT_WINDOW_DAYS,
  PAYPAL_ENTITIES,
  PAYPAL_MAX_PAGES,
  PAYPAL_MAX_WINDOW_DAYS,
  PAYPAL_PAGE_SIZE,
  PAYPAL_PARTNER_TRANSACTIONS_PATH,
  PAYPAL_READ_PATHS,
  PAYPAL_TRANSACTION_LATENCY_MS,
  parseBalances,
  parseTransactionsPage,
  paypalReadWindow,
  paypalTime,
  paypalWindowParams,
} from "./paypal";

const txn = (over: Record<string, unknown> = {}, outer: Record<string, unknown> = {}) => ({
  transaction_info: {
    transaction_id: "5TY05013RG002845M",
    transaction_event_code: "T0006",
    transaction_initiation_date: "2026-08-20T10:15:00+0000",
    transaction_updated_date: "2026-08-20T10:15:00+0000",
    transaction_amount: { currency_code: "USD", value: "19.99" },
    fee_amount: { currency_code: "USD", value: "-0.88" },
    transaction_status: "S",
    invoice_id: "INV-2026-0042",
    ...over,
  },
  ...outer,
});

const page = (details: unknown[], over: Record<string, unknown> = {}) => ({
  transaction_details: details,
  account_number: "PIKARPARTNER01",
  start_date: "2026-08-01T00:00:00+0000",
  end_date: "2026-08-28T00:00:00+0000",
  last_refreshed_datetime: "2026-08-28T00:00:00+0000",
  page: 1,
  total_items: details.length,
  total_pages: 1,
  ...over,
});

// ── The read surface ──────────────────────────────────────────────────────────────────────

describe("the read surface is two published paths and nothing else", () => {
  test("the entity set is closed and each member has exactly one path", () => {
    expect([...PAYPAL_ENTITIES]).toEqual(["transactions", "balances"]);
    expect(Object.keys(PAYPAL_READ_PATHS).sort()).toEqual([...PAYPAL_ENTITIES].sort());
    expect(Object.values(PAYPAL_READ_PATHS).sort()).toEqual([
      "/v1/reporting/balances",
      "/v1/reporting/transactions",
    ]);
  });

  test("isPayPalEntity refuses anything outside the closed set", () => {
    expect(isPayPalEntity("transactions")).toBe(true);
    expect(isPayPalEntity("invoices")).toBe(false);
    expect(isPayPalEntity("partner-transactions")).toBe(false);
    expect(isPayPalEntity(undefined)).toBe(false);
  });

  test("the partner surface is NULL — recorded as a gap, never guessed at", () => {
    // A partner-only resource is named in the published spec with no published operation. A string
    // here would be an invented endpoint, and every fixture written against it would be fiction.
    expect(PAYPAL_PARTNER_TRANSACTIONS_PATH).toBeNull();
  });
});

// ── Time ──────────────────────────────────────────────────────────────────────────────────

describe("paypalTime", () => {
  test("reads an offset date-time at the right instant", () => {
    expect(paypalTime("2026-08-20T10:15:00+0000")).toBe(Date.UTC(2026, 7, 20, 10, 15, 0));
    expect(paypalTime("2026-08-20T10:15:00Z")).toBe(Date.UTC(2026, 7, 20, 10, 15, 0));
    // -0700 means the wall clock is seven hours BEHIND UTC, so the instant is 17:15 UTC. The sign
    // going the other way would move every transaction fourteen hours and quietly reshuffle which
    // ones fall inside a coverage window.
    expect(paypalTime("2026-08-20T10:15:00-0700")).toBe(Date.UTC(2026, 7, 20, 17, 15, 0));
    expect(paypalTime("2026-08-20T10:15:00+05:30")).toBe(Date.UTC(2026, 7, 20, 4, 45, 0));
  });

  test("milliseconds are kept, not truncated to the second", () => {
    expect(paypalTime("2026-08-20T10:15:00.250Z")).toBe(Date.UTC(2026, 7, 20, 10, 15, 0, 250));
  });

  test("anything that is not a PayPal date-time is null, never a guess", () => {
    // `null` rather than `Date.now()` or `0`: an unreadable date is unknown, and coercing it puts a
    // transaction inside a window nobody proved it belongs to.
    for (const bad of [
      "2026-08-20",
      "2026-08-20T10:15:00",
      "yesterday",
      "",
      1_700_000_000,
      null,
      undefined,
      {},
    ]) {
      expect(paypalTime(bad)).toBeNull();
    }
  });
});

// ── The window ────────────────────────────────────────────────────────────────────────────

describe("the read window respects PayPal's own hard bounds", () => {
  const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

  test("PayPal's documented maximum range is 31 days and this repo does not exceed it", () => {
    // A LITERAL, not a reference to the constant: an off-by-one that widened the cap to 32 would
    // still satisfy `expect(cap).toBe(PAYPAL_MAX_WINDOW_DAYS)`.
    expect(PAYPAL_MAX_WINDOW_DAYS).toBe(31);
    expect(PAYPAL_DEFAULT_WINDOW_DAYS).toBeLessThanOrEqual(31);
    // And it is inside the phase-wide cap, so the two bounds cannot contradict each other.
    expect(PAYPAL_MAX_WINDOW_DAYS).toBeLessThanOrEqual(CAPS.maxWindowDays);
  });

  test("a 31-day window is accepted and a 32-day one is refused", () => {
    expect(paypalReadWindow(NOW, 31).ok).toBe(true);
    const tooWide = paypalReadWindow(NOW, 32);
    expect(tooWide.ok).toBe(false);
  });

  test("the window ENDS three hours back, because PayPal takes that long to list a transaction", () => {
    // "It takes a maximum of three hours for executed transactions to appear in the list
    // transactions call." Reading up to `now` and calling it complete would report a coverage
    // window PayPal had not finished populating — an under-count presented as a total. Pulling the
    // end back makes the claimed coverage true instead of making every read permanently partial.
    expect(PAYPAL_TRANSACTION_LATENCY_MS).toBe(3 * 60 * 60 * 1000);
    const w = paypalReadWindow(NOW, 7);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.value.endMs).toBe(NOW - PAYPAL_TRANSACTION_LATENCY_MS);
    expect(w.value.endMs - w.value.startMs).toBe(7 * 86_400_000);
  });

  test("a zero, fractional or negative window is refused", () => {
    for (const days of [0, -1, 1.5, Number.NaN]) {
      expect(paypalReadWindow(NOW, days).ok).toBe(false);
    }
  });

  test("the search parameters are RFC 3339 and carry the page size", () => {
    const w = paypalReadWindow(NOW, 7);
    if (!w.ok) throw new Error("window");
    const params = paypalWindowParams(w.value);
    expect(params.get("start_date")).toBe(new Date(w.value.startMs).toISOString());
    expect(params.get("end_date")).toBe(new Date(w.value.endMs).toISOString());
    expect(params.get("page_size")).toBe(String(PAYPAL_PAGE_SIZE));
    expect(params.get("page")).toBe("1");
    // `fields` narrows the response to the one block this lane parses. `payer_info`, `cart_info`
    // and `shipping_info` carry names, emails and addresses — content this repo must not receive at
    // all, let alone store (CLAUDE.md §4).
    expect(params.get("fields")).toBe("transaction_info");
    expect(params.get("transaction_status")).toBe("S");
  });

  test("the page size and page cap are this repo's conservative numbers, stated as literals", () => {
    // PayPal's rate-limit page renders nothing without JavaScript, so no numeric limit could be
    // sourced. These are bounds this repository chose rather than figures attributed to PayPal.
    expect(PAYPAL_PAGE_SIZE).toBe(100);
    expect(PAYPAL_MAX_PAGES).toBe(5);
    expect(PAYPAL_MAX_PAGES).toBeLessThanOrEqual(CAPS.maxPages);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────────────────

describe("parseTransactionsPage", () => {
  test("the cursor is the NEXT page number, and PayPal pages from 1", () => {
    expect(PAYPAL_CURSOR_PARAM).toBe("page");
    const parsed = parseTransactionsPage(page([txn()], { page: 1, total_pages: 3 }));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.cursor).toBe("2");
  });

  test("the last page ends the walk", () => {
    expect(parseTransactionsPage(page([txn()], { page: 3, total_pages: 3 }).valueOf()).cursor).toBe(
      null,
    );
  });

  test("an empty result set is a normal end, not a failure", () => {
    const parsed = parseTransactionsPage(page([], { total_items: 0, total_pages: 1 }));
    expect(parsed.rows).toEqual([]);
    expect(parsed.cursor).toBeNull();
  });

  test("a nonsensical page counter STOPS the walk rather than spinning", () => {
    // Handing back a cursor we cannot trust would spin to the page cap and report `partial` from a
    // cap when the truth is a broken response. Stopping is the smaller lie.
    for (const over of [
      { page: 0, total_pages: 3 },
      { page: "2", total_pages: 3 },
      { page: 2, total_pages: 1.5 },
      { page: 4, total_pages: 3 },
    ]) {
      expect(parseTransactionsPage(page([txn()], over)).cursor).toBeNull();
    }
  });

  test("a response that is not a transaction list throws rather than reading as empty", () => {
    // Empty and unreadable are different sentences: an empty page is "no transactions", and
    // returning that for a maintenance page would report zero revenue as a fact.
    expect(() => parseTransactionsPage(null)).toThrow();
    expect(() => parseTransactionsPage({ transaction_details: "nope" })).toThrow();
    expect(() => parseTransactionsPage("[]")).toThrow();
  });
});

// ── Transactions ──────────────────────────────────────────────────────────────────────────

describe("normalizeTransaction", () => {
  test("a successful transaction becomes a payment-rail receipt in minor units", () => {
    const result = normalizeTransaction(txn());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      ref: { provider: "paypal", kind: "transaction", id: "5TY05013RG002845M" },
      authority: "payment_rail",
      invoiceId: "INV-2026-0042",
      paidAt: Date.UTC(2026, 7, 20, 10, 15, 0),
      amount: { minor: 1999, currency: "USD" },
    });
  });

  test("THE ROUNDING BOUNDARY: a decimal string never goes through a float", () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE 754. A float path would report 28 minor units after
    // truncation, or 29 by luck after rounding — and the two would disagree per amount.
    const cents = (value: string, currency = "USD") => {
      const r = normalizeTransaction(
        txn({ transaction_amount: { currency_code: currency, value } }),
      );
      return r.ok ? r.value.amount : r;
    };
    expect(cents("0.29")).toEqual({ minor: 29, currency: "USD" });
    expect(cents("0.1")).toEqual({ minor: 10, currency: "USD" });
    expect(cents("1.005")).toMatchObject({ ok: false });
    expect(cents("70.07")).toEqual({ minor: 7007, currency: "USD" });
    expect(cents("8.165")).toMatchObject({ ok: false });
  });

  test("a zero-decimal currency is not scaled by a hundred", () => {
    const r = normalizeTransaction(
      txn({ transaction_amount: { currency_code: "JPY", value: "5000" } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // JPY's ISO minor-unit exponent is 0. Treating it as 2 would report a hundred times the truth.
    expect(r.value.amount).toEqual({ minor: 5000, currency: "JPY" });
  });

  test("a negative amount is KEPT — a reversal is a real row and dropping it overstates receipts", () => {
    // PayPal reports a refund or chargeback as its own transaction with a negative amount and
    // status S. Refusing it would leave the gross charge standing alone and report money the
    // business gave back as money it kept.
    const r = normalizeTransaction(
      txn({
        transaction_id: "0AB12345CD678901E",
        transaction_event_code: "T1107",
        transaction_amount: { currency_code: "USD", value: "-19.99" },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.amount).toEqual({ minor: -1999, currency: "USD" });
  });

  test("only status S is a receipt", () => {
    for (const status of ["P", "V", "D", "s", "", undefined]) {
      const r = normalizeTransaction(txn({ transaction_status: status }));
      expect(`${String(status)}:${r.ok}`).toBe(`${String(status)}:false`);
    }
  });

  test("a transaction with no readable date is refused, never dated to now", () => {
    expect(normalizeTransaction(txn({ transaction_initiation_date: "nope" })).ok).toBe(false);
    expect(normalizeTransaction(txn({ transaction_initiation_date: undefined })).ok).toBe(false);
  });

  test("a missing or malformed amount is refused, never read as zero", () => {
    expect(normalizeTransaction(txn({ transaction_amount: undefined })).ok).toBe(false);
    expect(
      normalizeTransaction(txn({ transaction_amount: { currency_code: "USD", value: 19.99 } })).ok,
    ).toBe(false);
    expect(
      normalizeTransaction(txn({ transaction_amount: { currency_code: "US", value: "1.00" } })).ok,
    ).toBe(false);
  });

  test("an absent invoice id is null, not an empty string", () => {
    const r = normalizeTransaction(txn({ invoice_id: undefined }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.invoiceId).toBeNull();
  });

  test("no free-text or payer field survives normalization", () => {
    // `transaction_subject`, `transaction_note`, `payer_info` and `cart_info` are CONTENT: a memo
    // line, a customer's name, an email, a shipping address. `fields=transaction_info` keeps them
    // off the wire; this keeps them out of the shape even if a response carries them anyway.
    const r = normalizeTransaction(
      txn(
        {
          transaction_subject: "Consulting for Acme's Q3 launch",
          transaction_note: "call me back",
        },
        {
          payer_info: {
            email_address: "someone@example.com",
            payer_name: { alternate_full_name: "A" },
          },
          cart_info: { item_details: [{ item_name: "Widget" }] },
          shipping_info: { name: "A Person", address: { line1: "1 Road" } },
        },
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.value);
    for (const leak of ["Acme", "example.com", "Widget", "A Person", "1 Road", "call me back"]) {
      expect(`${leak}:${serialized.includes(leak)}`).toBe(`${leak}:false`);
    }
    expect(Object.keys(r.value).sort()).toEqual([
      "amount",
      "authority",
      "invoiceId",
      "paidAt",
      "ref",
    ]);
  });

  test("a row with no transaction_info block is refused", () => {
    expect(normalizeTransaction({}).ok).toBe(false);
    expect(normalizeTransaction(null).ok).toBe(false);
    expect(normalizeTransaction(txn({ transaction_id: undefined })).ok).toBe(false);
  });
});

// ── Balances ──────────────────────────────────────────────────────────────────────────────

const balances = (over: Record<string, unknown> = {}) => ({
  balances: [
    {
      currency: "USD",
      primary: true,
      total_balance: { currency_code: "USD", value: "1234.56" },
      available_balance: { currency_code: "USD", value: "1000.00" },
      withheld_balance: { currency_code: "USD", value: "234.56" },
    },
    {
      currency: "EUR",
      primary: false,
      total_balance: { currency_code: "EUR", value: "50.00" },
      available_balance: { currency_code: "EUR", value: "50.00" },
      withheld_balance: { currency_code: "EUR", value: "0.00" },
    },
  ],
  account_id: "PIKARPARTNER01",
  as_of_time: "2026-08-28T00:00:00+0000",
  last_refresh_time: "2026-08-28T00:00:00+0000",
  ...over,
});

describe("parseBalances", () => {
  test("every currency is kept apart, and available is never merged with withheld", () => {
    const r = parseBalances(balances());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.available).toEqual([
      { minor: 100_000, currency: "USD" },
      { minor: 5000, currency: "EUR" },
    ]);
    expect(r.value.total).toEqual([
      { minor: 123_456, currency: "USD" },
      { minor: 5000, currency: "EUR" },
    ]);
  });

  test("the account id never leaves the parser", () => {
    // It is the business's own PayPal identifier. Counts, refs and ids are §4-safe in general, but
    // an account number in a projection is one paste away from a plan file.
    const r = parseBalances(balances());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain("PIKARPARTNER01");
    expect(Object.keys(r.value).sort()).toEqual(["available", "total"]);
  });

  test("an account with no balances is a real, empty answer", () => {
    const r = parseBalances(balances({ balances: [] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ available: [], total: [] });
  });

  test("a malformed balance refuses the whole response rather than dropping a currency", () => {
    // Dropping one currency silently would understate the money on hand, and nothing downstream
    // could tell a missing ledger from an empty one.
    expect(parseBalances(balances({ balances: [{ currency: "USD" }] })).ok).toBe(false);
    expect(
      parseBalances(
        balances({
          balances: [
            {
              available_balance: { currency_code: "USD", value: "x" },
              total_balance: { currency_code: "USD", value: "1.00" },
            },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(parseBalances({ balances: "nope" }).ok).toBe(false);
    expect(parseBalances(null).ok).toBe(false);
  });
});
