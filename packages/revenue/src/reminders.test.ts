import { describe, expect, test } from "vitest";
import type { Invoice, Projection, SourceRef } from "./contracts";
import {
  buildInvoiceReminderDraft,
  REMINDER_SOURCE_MAX_AGE_MS,
  selectInvoiceReminderInput,
  type ReminderInvoice,
} from "./reminders";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const REF: SourceRef = { provider: "quickbooks", kind: "invoice", id: "inv_42" };

function invoice(over: Partial<ReminderInvoice> = {}): ReminderInvoice {
  const base: Invoice = {
    ref: REF,
    customerRef: "customer_7",
    issuedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    dueAt: Date.parse("2026-08-21T00:00:00.000Z"),
    total: { minor: 125_050, currency: "USD" },
    outstanding: { minor: 25_050, currency: "USD" },
  };
  return { ...base, paymentState: "open", ...over };
}

function projection(
  items: readonly ReminderInvoice[] = [invoice()],
  over: Partial<Extract<Projection<ReminderInvoice>, { state: "ready" }>["meta"]> = {},
): Projection<ReminderInvoice> {
  return {
    state: "ready",
    meta: {
      provider: "quickbooks",
      authority: "accounting_authority",
      retrievedAt: NOW - 1_000,
      window: { startMs: NOW - 90 * 86_400_000, endMs: NOW },
      capped: false,
      sources: items.map((row) => row.ref),
      ...over,
    },
    items,
  };
}

function reason(result: ReturnType<typeof selectInvoiceReminderInput>): string {
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.error;
}

describe("invoice reminder source guards", () => {
  test("copies immutable source facts and computes lateness in code", () => {
    const selected = selectInvoiceReminderInput({
      requestedRef: REF,
      source: projection(),
      now: NOW,
    });

    expect(selected).toEqual({
      ok: true,
      value: {
        source: REF,
        customerRef: "customer_7",
        amountMinor: 25_050,
        currency: "USD",
        issuedAt: Date.parse("2026-07-01T00:00:00.000Z"),
        dueAt: Date.parse("2026-08-21T00:00:00.000Z"),
        daysPastDue: 10,
        sourceRetrievedAt: NOW - 1_000,
      },
    });
    if (selected.ok) expect(Object.isFrozen(selected.value)).toBe(true);
  });

  test.each([
    ["paid", "paid"],
    ["void", "void"],
    ["disputed", "disputed"],
  ] as const)("rejects a %s invoice", (paymentState, expected) => {
    expect(reason(selectInvoiceReminderInput({ requestedRef: REF, source: projection([invoice({ paymentState })]), now: NOW }))).toContain(expected);
  });

  test("rejects a missing exact external ref instead of picking another invoice", () => {
    const another = invoice({ ref: { ...REF, id: "inv_other" } });
    expect(reason(selectInvoiceReminderInput({ requestedRef: REF, source: projection([another]), now: NOW }))).toContain("not found");
  });

  test("rejects source-provider disagreement", () => {
    expect(reason(selectInvoiceReminderInput({
      requestedRef: REF,
      source: projection([], { provider: "stripe" }),
      now: NOW,
    }))).toContain("provider");
  });

  test("rejects an invalid or non-invoice source ref", () => {
    expect(reason(selectInvoiceReminderInput({
      requestedRef: { ...REF, kind: "payment" },
      source: projection(),
      now: NOW,
    }))).toContain("invoice ref");
  });

  test("rejects unavailable and partial reads", () => {
    expect(reason(selectInvoiceReminderInput({
      requestedRef: REF,
      source: { state: "unavailable", provider: "quickbooks", because: "lane parked" },
      now: NOW,
    }))).toContain("unavailable");
    expect(reason(selectInvoiceReminderInput({
      requestedRef: REF,
      source: { ...projection(), state: "partial", missing: "next page" },
      now: NOW,
    }))).toContain("partial");
  });

  test("rejects stale source data at the exact freshness boundary", () => {
    expect(selectInvoiceReminderInput({
      requestedRef: REF,
      source: projection([], { retrievedAt: NOW - REMINDER_SOURCE_MAX_AGE_MS }),
      now: NOW,
    }).ok).toBe(true);
    expect(reason(selectInvoiceReminderInput({
      requestedRef: REF,
      source: projection([], { retrievedAt: NOW - REMINDER_SOURCE_MAX_AGE_MS - 1 }),
      now: NOW,
    }))).toContain("stale");
  });

  test("rejects missing due date, zero balance and cross-currency facts", () => {
    expect(reason(selectInvoiceReminderInput({ requestedRef: REF, source: projection([invoice({ dueAt: null })]), now: NOW }))).toContain("due date");
    expect(reason(selectInvoiceReminderInput({ requestedRef: REF, source: projection([invoice({ outstanding: { minor: 0, currency: "USD" } })]), now: NOW }))).toContain("unpaid balance");
    expect(reason(selectInvoiceReminderInput({ requestedRef: REF, source: projection([invoice({ outstanding: { minor: 25_050, currency: "EUR" } })]), now: NOW }))).toContain("currency");
  });
});

test("the code-owned draft renders exact amount, due date and lateness without an LLM", () => {
  const selected = selectInvoiceReminderInput({ requestedRef: REF, source: projection(), now: NOW });
  expect(selected.ok).toBe(true);
  if (!selected.ok) return;

  expect(buildInvoiceReminderDraft(selected.value)).toEqual({
    subject: "Reminder: invoice inv_42 is past due",
    body:
      "Hello,\n\nThis is a reminder that invoice inv_42 has an outstanding balance of USD 250.50. " +
      "It was due on 2026-08-21 and is 10 days past due.\n\nPlease review the invoice and arrange payment if it remains outstanding.\n",
  });
});
