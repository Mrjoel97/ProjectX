/**
 * The pure Stripe normalizer. No Convex, no network, no model — total functions over raw JSON.
 *
 * THE ONE BUG THESE TESTS EXIST TO STOP: DOUBLE-CONVERTING MONEY. Stripe is natively integer minor
 * units (`amount: 1999` is $19.99), and every other rail in this phase is not. A normalizer that
 * ran Stripe's integers through a decimal parser would report $1,999.00 and nobody downstream could
 * tell. So the money assertions are exact `minor` counts, and there is a zero-decimal (JPY) and a
 * three-decimal (BHD) case, because "divide by 100" is the shape of that same bug.
 */
import { describe, expect, test } from "vitest";
import { CAPS } from "../contracts";
import { boundedWindow, normalizeAll, separateByCurrency } from "./shared";
import {
  normalizeCharge,
  normalizeDispute,
  normalizePayout,
  normalizeStripeInvoice,
  parseBalance,
  parseListPage,
  STRIPE_CURSOR_PARAM,
  STRIPE_DEFAULT_WINDOW_DAYS,
  STRIPE_ENTITIES,
  STRIPE_MAX_PAGES,
  STRIPE_PAGE_SIZE,
  STRIPE_READ_PATHS,
  stripeWindowParams,
} from "./stripe";

const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch_3PikarTest",
  object: "charge",
  amount: 1999,
  amount_captured: 1999,
  amount_refunded: 0,
  currency: "usd",
  created: 1_700_000_000,
  status: "succeeded",
  paid: true,
  customer: "cus_Test",
  invoice: null,
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "in_1PikarTest",
  object: "invoice",
  currency: "usd",
  total: 250_00,
  amount_remaining: 150_00,
  created: 1_700_000_000,
  due_date: 1_700_600_000,
  customer: "cus_Test",
  status: "open",
  ...over,
});

// ── The read surface, as a closed set ─────────────────────────────────────────────────────

describe("the read surface", () => {
  test("every entity maps to exactly one documented list/retrieve path", () => {
    expect(Object.keys(STRIPE_READ_PATHS).sort()).toEqual([...STRIPE_ENTITIES].sort());
    for (const path of Object.values(STRIPE_READ_PATHS)) {
      expect(path.startsWith("/v1/")).toBe(true);
    }
  });

  test("the paths are pinned literals — a rename must be a deliberate allow-list change", () => {
    expect(STRIPE_READ_PATHS).toEqual({
      balance: "/v1/balance",
      charges: "/v1/charges",
      invoices: "/v1/invoices",
      payouts: "/v1/payouts",
      disputes: "/v1/disputes",
    });
  });

  test("no write path is reachable through this table", () => {
    // Every Stripe write shares a path with its read and differs only by verb, so the table is not
    // the whole boundary — but a path with no read semantics at all must never appear here.
    for (const path of Object.values(STRIPE_READ_PATHS)) {
      for (const write of ["/refund", "/capture", "/cancel", "/finalize", "/void", "/pay"]) {
        expect(path.endsWith(write)).toBe(false);
      }
    }
  });

  test("the poll budget stays inside Stripe's read allocation", () => {
    // 500 reads per transaction with a 10,000/month FLOOR, aggregated across connected accounts.
    // A full poll is one request per page per entity, so the worst case must stay small enough that
    // a low-transaction account can be polled more than a handful of times a month.
    expect(STRIPE_PAGE_SIZE).toBeLessThanOrEqual(100);
    expect(STRIPE_ENTITIES.length * STRIPE_MAX_PAGES).toBeLessThanOrEqual(25);
    expect(STRIPE_CURSOR_PARAM).toBe("starting_after");
  });

  test("the default window is bounded by the contract module's cap", () => {
    expect(STRIPE_DEFAULT_WINDOW_DAYS).toBeLessThanOrEqual(CAPS.maxWindowDays);
    expect(boundedWindow(Date.now(), CAPS.maxWindowDays + 1).ok).toBe(false);
  });

  test("the window becomes Stripe's own created filter, in whole seconds", () => {
    const params = stripeWindowParams({ startMs: 1_700_000_000_000, endMs: 1_700_600_000_000 });
    expect(params.get("created[gte]")).toBe("1700000000");
    expect(params.get("created[lte]")).toBe("1700600000");
    expect(params.get("limit")).toBe(String(STRIPE_PAGE_SIZE));
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────────────────

describe("parseListPage", () => {
  test("reads a page and hands back the last id as the cursor", () => {
    const page = parseListPage({
      object: "list",
      has_more: true,
      data: [{ id: "ch_1" }, { id: "ch_2" }],
    });
    expect(page.rows).toHaveLength(2);
    expect(page.cursor).toBe("ch_2");
  });

  test("has_more false ends the walk", () => {
    const page = parseListPage({ object: "list", has_more: false, data: [{ id: "ch_1" }] });
    expect(page.cursor).toBeNull();
  });

  test("an empty page is a normal end, not a failure", () => {
    const page = parseListPage({ object: "list", has_more: false, data: [] });
    expect(page.rows).toEqual([]);
    expect(page.cursor).toBeNull();
  });

  test("has_more with no usable last id ends the walk rather than spinning", () => {
    // Stripe should never do this. If it does, returning the previous cursor would loop until the
    // page cap and report a bounded read when the truth is a broken one.
    const page = parseListPage({ object: "list", has_more: true, data: [{ nope: 1 }] });
    expect(page.cursor).toBeNull();
  });

  test("a non-list body throws rather than reading as empty", () => {
    expect(() => parseListPage({ object: "balance" })).toThrow();
    expect(() => parseListPage("nope")).toThrow();
    expect(() => parseListPage({ object: "list" })).toThrow();
  });
});

// ── Balance ───────────────────────────────────────────────────────────────────────────────

describe("parseBalance", () => {
  test("keeps available and pending apart, in minor units", () => {
    const parsed = parseBalance({
      object: "balance",
      available: [{ amount: 12_345, currency: "usd" }],
      pending: [{ amount: 500, currency: "usd" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.available[0]).toEqual({ minor: 12_345, currency: "USD" });
    expect(parsed.value.pending[0]).toEqual({ minor: 500, currency: "USD" });
  });

  test("carries every currency an account settles in, without combining them", () => {
    const parsed = parseBalance({
      object: "balance",
      available: [
        { amount: 100, currency: "usd" },
        { amount: 200, currency: "eur" },
      ],
      pending: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.available.map((m) => m.currency)).toEqual(["USD", "EUR"]);
  });

  test("a zero-decimal currency is NOT divided by a hundred", () => {
    const parsed = parseBalance({
      object: "balance",
      available: [{ amount: 5000, currency: "jpy" }],
      pending: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 5000 yen. A decimal-string parser would have made this 500000.
    expect(parsed.value.available[0]).toEqual({ minor: 5000, currency: "JPY" });
  });

  test("a three-decimal currency keeps all three", () => {
    const parsed = parseBalance({
      object: "balance",
      available: [{ amount: 1_500, currency: "bhd" }],
      pending: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.available[0]).toEqual({ minor: 1_500, currency: "BHD" });
  });

  test("refuses a body that is not a balance", () => {
    expect(parseBalance({ object: "list", data: [] }).ok).toBe(false);
    expect(parseBalance(null).ok).toBe(false);
  });

  test("refuses a non-integer amount rather than rounding it", () => {
    expect(
      parseBalance({
        object: "balance",
        available: [{ amount: 10.5, currency: "usd" }],
        pending: [],
      }).ok,
    ).toBe(false);
  });
});

// ── Charges ───────────────────────────────────────────────────────────────────────────────

describe("normalizeCharge", () => {
  test("a captured charge is a payment-rail receipt in exact minor units", () => {
    const result = normalizeCharge(charge());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toEqual({ minor: 1999, currency: "USD" });
    expect(result.value.authority).toBe("payment_rail");
    expect(result.value.paidAt).toBe(1_700_000_000_000);
    expect(result.value.ref).toEqual({ provider: "stripe", kind: "charge", id: "ch_3PikarTest" });
  });

  test("a refund is netted off, through the money module", () => {
    const result = normalizeCharge(charge({ amount_refunded: 999 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toEqual({ minor: 1000, currency: "USD" });
  });

  test("a fully refunded charge is a zero receipt, not a negative one", () => {
    const result = normalizeCharge(charge({ amount_refunded: 1999 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount.minor).toBe(0);
  });

  test("a refund larger than the capture is refused — that is a normalization bug", () => {
    expect(normalizeCharge(charge({ amount_refunded: 3000 })).ok).toBe(false);
  });

  test("an unsuccessful charge is not a receipt", () => {
    expect(normalizeCharge(charge({ status: "failed" })).ok).toBe(false);
    expect(normalizeCharge(charge({ status: "pending" })).ok).toBe(false);
  });

  test("the linked invoice is carried when Stripe knows it", () => {
    const result = normalizeCharge(charge({ invoice: "in_1PikarTest" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invoiceId).toBe("in_1PikarTest");
  });

  test("an expanded invoice object does not become an invoice id", () => {
    // `invoice` is an id OR an expanded object depending on request parameters. An object stringified
    // into `invoiceId` would never match a QuickBooks invoice id and would silently defeat the
    // double-count refusal in finance.reconcilePayments.
    const result = normalizeCharge(charge({ invoice: { id: "in_1PikarTest" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invoiceId).toBeNull();
  });

  test("no customer NAME or email can enter a ref", () => {
    const result = normalizeCharge(
      charge({ customer: "cus_Test", billing_details: { name: "Acme Ltd", email: "a@b.test" } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("Acme");
    expect(JSON.stringify(result.value)).not.toContain("@b.test");
  });

  test("refuses a row with no id, no currency or no created time", () => {
    expect(normalizeCharge(charge({ id: "" })).ok).toBe(false);
    expect(normalizeCharge(charge({ currency: "dollars" })).ok).toBe(false);
    expect(normalizeCharge(charge({ created: "yesterday" })).ok).toBe(false);
  });
});

// ── Invoices ──────────────────────────────────────────────────────────────────────────────

describe("normalizeStripeInvoice", () => {
  test("total and outstanding are separate, exact minor amounts", () => {
    const result = normalizeStripeInvoice(invoice());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toEqual({ minor: 25_000, currency: "USD" });
    expect(result.value.outstanding).toEqual({ minor: 15_000, currency: "USD" });
    expect(result.value.customerRef).toBe("cus_Test");
    expect(result.value.issuedAt).toBe(1_700_000_000_000);
    expect(result.value.dueAt).toBe(1_700_600_000_000);
  });

  test("no due date is null, so aging puts it in the unknown bucket", () => {
    const result = normalizeStripeInvoice(invoice({ due_date: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // NOT coerced to `created`: an undated invoice moved into `current` is an invoice reported as
    // not-yet-overdue when nobody knows whether it is.
    expect(result.value.dueAt).toBeNull();
  });

  test("a DRAFT invoice is not receivable and is refused", () => {
    expect(normalizeStripeInvoice(invoice({ status: "draft" })).ok).toBe(false);
  });

  test("a negative remaining balance is refused rather than aged", () => {
    expect(normalizeStripeInvoice(invoice({ amount_remaining: -100 })).ok).toBe(false);
  });

  test("an expanded customer object is refused, not stringified", () => {
    expect(normalizeStripeInvoice(invoice({ customer: { id: "cus_Test" } })).ok).toBe(false);
  });

  test("a customer NAME never reaches the customerRef", () => {
    const result = normalizeStripeInvoice(
      invoice({ customer_name: "Acme Ltd", customer_email: "a@b.test" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("Acme");
  });
});

// ── Payouts and disputes ──────────────────────────────────────────────────────────────────

describe("normalizePayout", () => {
  test("carries the arrival date, not the creation date", () => {
    const result = normalizePayout({
      id: "po_1",
      object: "payout",
      amount: 100_000,
      currency: "usd",
      created: 1_700_000_000,
      arrival_date: 1_700_200_000,
      status: "in_transit",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toEqual({ minor: 100_000, currency: "USD" });
    expect(result.value.arrivesAt).toBe(1_700_200_000_000);
    expect(result.value.status).toBe("in_transit");
    expect(result.value.ref.kind).toBe("payout");
  });

  test("an unknown status is refused — the set is closed", () => {
    expect(
      normalizePayout({
        id: "po_1",
        amount: 1,
        currency: "usd",
        arrival_date: 1,
        status: "teleported",
      }).ok,
    ).toBe(false);
  });
});

describe("normalizeDispute", () => {
  test("a dispute is money at risk, bound to its charge", () => {
    const result = normalizeDispute({
      id: "dp_1",
      object: "dispute",
      amount: 5_000,
      currency: "usd",
      created: 1_700_000_000,
      status: "needs_response",
      charge: "ch_3PikarTest",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toEqual({ minor: 5_000, currency: "USD" });
    expect(result.value.chargeRef).toBe("ch_3PikarTest");
    expect(result.value.status).toBe("needs_response");
  });

  test("an unknown dispute status is refused", () => {
    expect(
      normalizeDispute({ id: "dp_1", amount: 1, currency: "usd", created: 1, status: "arguing" })
        .ok,
    ).toBe(false);
  });

  test("there is no way to express a dispute RESPONSE through this shape", () => {
    const result = normalizeDispute({
      id: "dp_1",
      amount: 1,
      currency: "usd",
      created: 1,
      status: "won",
      charge: "ch_1",
      evidence: { uncategorized_text: "we shipped it" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual([
      "amount",
      "chargeRef",
      "openedAt",
      "ref",
      "status",
    ]);
  });
});

// ── The shared helpers, exercised through the Stripe normalizers ──────────────────────────

describe("bulk normalization reports rather than drops", () => {
  test("a row that will not normalize is COUNTED", () => {
    const out = normalizeAll([charge(), charge({ status: "failed" }), charge()], normalizeCharge);
    expect(out.rows).toHaveLength(2);
    expect(out.rejected).toBe(1);
  });

  test("other currencies are named, never silently totalled in", () => {
    const usd = normalizeCharge(charge());
    const eur = normalizeCharge(charge({ id: "ch_eur", currency: "eur" }));
    expect(usd.ok && eur.ok).toBe(true);
    if (!usd.ok || !eur.ok) return;
    const split = separateByCurrency([usd.value, eur.value], (p) => p.amount.currency, "USD");
    expect(split.kept).toHaveLength(1);
    expect(split.otherCurrencies).toEqual(["EUR"]);
  });
});
