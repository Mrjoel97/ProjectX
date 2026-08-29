import { minorDigits } from "@pikar/revenue/money";
import { describe, expect, test } from "vitest";
import {
  PAYMENT_METHOD_BANK_TRANSFER,
  reconcileEvent,
  UNRECONCILED_RETURN_DAYS,
  UNRECONCILED_SWEEP_DAYS,
  unappliedStage,
} from "./reconcile";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 7, 29);
/** Event `created` is Stripe's UNIX SECONDS. Ages below are built from it, never from a clock. */
const secondsAgo = (days: number) => Math.floor((NOW - days * DAY_MS) / 1000);

const event = (type: string, object: unknown, created = secondsAgo(0)) => ({
  id: "evt_1",
  type,
  created,
  data: { object },
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "in_123",
  object: "invoice",
  currency: "usd",
  total: 1050,
  amount_paid: 1050,
  payment_intent: "pi_123",
  ...over,
});

const CARD = { payment_settings: { payment_method_types: ["card"] } };
const BANK = { payment_settings: { payment_method_types: ["customer_balance"] } };

const cashTxn = (over: Record<string, unknown> = {}) => ({
  id: "ccsbtxn_1",
  object: "customer_cash_balance_transaction",
  customer: "cus_1",
  currency: "usd",
  net_amount: 1050,
  ...over,
});

/** Every test unwraps through here, so a silent `err` can never read as "zero movements". */
const okOf = (r: ReturnType<typeof reconcileEvent>) => {
  if (!r.ok) throw new Error(`expected ok, got err: ${r.error}`);
  return r.value;
};
const run = (type: string, object: unknown, created?: number) =>
  okOf(reconcileEvent(event(type, object, created), NOW));

describe("PAYMENT_METHOD_BANK_TRANSFER", () => {
  // The literal. One symbol, so the discriminator is not a string scattered through branches —
  // and a rename of the constant cannot fake a pass here.
  test("is Stripe's customer_balance payment method type", () => {
    expect(PAYMENT_METHOD_BANK_TRANSFER).toBe("customer_balance");
  });
});

describe("invoice.finalized — what we EXPECT to collect", () => {
  test("produces one estimated movement for the invoice total, correlated on the invoice id", () => {
    const { movements, observations } = run("invoice.finalized", invoice({ status: "open" }));
    expect(movements).toEqual([
      {
        phase: "estimated",
        amount: { minor: 1050, currency: "USD" },
        correlationId: "billing/in_123",
        kind: "invoice-finalized",
        stripeObjectId: "in_123",
      },
    ]);
    expect(observations).toEqual([]);
  });
});

describe("invoice.paid — the central law of this phase", () => {
  test("a CARD invoice IS collection: one actual movement", () => {
    const { movements } = run("invoice.paid", invoice(CARD));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      phase: "actual",
      amount: { minor: 1050, currency: "USD" },
      correlationId: "billing/in_123",
    });
  });

  // THE most important assertion in the phase. Bank-transfer funds are in the customer CASH
  // BALANCE, not on the invoice. Booking `actual` here records money we do not have, in an
  // append-only ledger that cannot quietly correct it.
  test("a BANK TRANSFER invoice produces NO actual movement", () => {
    const { movements, observations } = run("invoice.paid", invoice(BANK));
    expect(movements.filter((m) => m.phase === "actual")).toEqual([]);
    expect(movements).toEqual([]);
    expect(observations).toEqual([
      {
        kind: "awaiting-cash-application",
        correlationId: "billing/in_123",
        stripeObjectId: "in_123",
      },
    ]);
  });

  test("customer_balance among SEVERAL allowed methods still books no actual", () => {
    // `payment_settings.payment_method_types` is what was ALLOWED, not what was USED. If bank
    // transfer was on the table we cannot prove a card paid it, and unprovable is not `actual`.
    const inv = invoice({
      payment_settings: { payment_method_types: ["card", "customer_balance"] },
    });
    expect(run("invoice.paid", inv).movements).toEqual([]);
  });

  test("an UNDETERMINABLE payment method books no actual either — unknown is never card", () => {
    const { movements, observations } = run("invoice.paid", invoice());
    expect(movements).toEqual([]);
    expect(observations).toEqual([
      {
        kind: "payment-method-undetermined",
        correlationId: "billing/in_123",
        stripeObjectId: "in_123",
      },
    ]);
  });

  test("the charge's ACTUAL method beats the invoice's allow-list", () => {
    const paidByBank = invoice({
      ...CARD,
      charge: { payment_method_details: { type: "customer_balance" } },
    });
    expect(run("invoice.paid", paidByBank).movements).toEqual([]);

    const paidByCard = invoice({
      ...BANK,
      charge: { payment_method_details: { type: "card" } },
    });
    expect(run("invoice.paid", paidByCard).movements).toHaveLength(1);
  });
});

describe("customer_cash_balance_transaction.created — where bank-transfer money really moves", () => {
  test("funded is ARRIVAL, not collection: reserved", () => {
    const { movements } = run(
      "customer_cash_balance_transaction.created",
      cashTxn({ type: "funded" }),
    );
    expect(movements).toEqual([
      {
        phase: "reserved",
        amount: { minor: 1050, currency: "USD" },
        correlationId: "billing/cus_1",
        kind: "cash-funded",
        stripeObjectId: "ccsbtxn_1",
      },
    ]);
  });

  test("applied_to_payment is COLLECTION: actual, correlated to the PaymentIntent", () => {
    const txn = cashTxn({
      type: "applied_to_payment",
      net_amount: -1050,
      applied_to_payment: { payment_intent: "pi_987" },
    });
    expect(run("customer_cash_balance_transaction.created", txn).movements).toEqual([
      {
        phase: "actual",
        // Direction lives in the PHASE, never in the sign — Stripe's net_amount is negative here.
        amount: { minor: 1050, currency: "USD" },
        correlationId: "billing/pi_987",
        kind: "cash-applied",
        stripeObjectId: "ccsbtxn_1",
      },
    ]);
  });

  test("applied_to_payment WITHOUT a PaymentIntent is an error, never an uncorrelated actual", () => {
    const txn = cashTxn({ type: "applied_to_payment", net_amount: -1050 });
    expect(reconcileEvent(event("customer_cash_balance_transaction.created", txn), NOW).ok).toBe(
      false,
    );
  });

  test("funding_reversed TAKES IT BACK — a refunded movement, never silently dropped", () => {
    const txn = cashTxn({ type: "funding_reversed", net_amount: -1050 });
    const { movements } = run("customer_cash_balance_transaction.created", txn);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      phase: "refunded",
      amount: { minor: 1050, currency: "USD" },
      kind: "funding-reversed",
    });
  });

  test("unapplied_from_payment is refunded, positive", () => {
    const txn = cashTxn({
      type: "unapplied_from_payment",
      net_amount: 1050,
      unapplied_from_payment: { payment_intent: "pi_987" },
    });
    expect(run("customer_cash_balance_transaction.created", txn).movements[0]).toMatchObject({
      phase: "refunded",
      amount: { minor: 1050, currency: "USD" },
      correlationId: "billing/pi_987",
    });
  });

  test("refunded_from_payment is refunded, positive", () => {
    const txn = cashTxn({
      type: "refunded_from_payment",
      net_amount: 1050,
      refunded_from_payment: { payment_intent: "pi_987" },
    });
    expect(run("customer_cash_balance_transaction.created", txn).movements[0]).toMatchObject({
      phase: "refunded",
    });
  });

  test("a cash-balance type we do not map produces no movement and no throw", () => {
    for (const type of ["adjusted_for_overdraft", "return_initiated", "transferred_to_balance"]) {
      expect(run("customer_cash_balance_transaction.created", cashTxn({ type })).movements).toEqual(
        [],
      );
    }
  });
});

describe("cash_balance.funds_available — LEFTOVER money, not an arrival", () => {
  const balance = (available: Record<string, number>) => ({
    object: "cash_balance",
    customer: "cus_1",
    available,
  });

  test("produces ZERO ledger movements and one visibility record", () => {
    const { movements, observations } = run("cash_balance.funds_available", balance({ usd: 1050 }));
    expect(movements).toEqual([]);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: "unapplied-funds",
      amount: { minor: 1050, currency: "USD" },
      correlationId: "billing/cus_1",
      ageDays: 0,
      stage: "held",
    });
  });

  test("carries an AGE, because unreconciled funds have a clock", () => {
    const at = (days: number) =>
      run("cash_balance.funds_available", balance({ usd: 1050 }), secondsAgo(days))
        .observations[0] as { ageDays: number; stage: string };
    expect(at(10).ageDays).toBe(10);
    expect(at(74).stage).toBe("held");
    // 75 days: Stripe attempts to RETURN the funds to the customer's bank.
    expect(at(75).stage).toBe("return-attempted");
    expect(at(89).stage).toBe("return-attempted");
    // 90 days: unreturnable funds are SWEPT to the Stripe account balance.
    expect(at(90).stage).toBe("swept");
    expect(at(200).stage).toBe("swept");
  });

  test("the clock constants are the literals from Stripe's reconciliation docs", () => {
    expect(UNRECONCILED_RETURN_DAYS).toBe(75);
    expect(UNRECONCILED_SWEEP_DAYS).toBe(90);
  });

  test("mixed currency is SEPARATED into one observation each, never combined", () => {
    const { observations } = run(
      "cash_balance.funds_available",
      balance({ usd: 1050, jpy: 900, eur: 0 }),
    );
    expect(observations.map((o) => ("amount" in o ? o.amount : null))).toEqual([
      { minor: 1050, currency: "USD" },
      { minor: 900, currency: "JPY" },
    ]);
  });
});

describe("refunds — direction lives in the phase, never in the sign", () => {
  test("charge.refunded is a POSITIVE refunded movement", () => {
    const charge = {
      id: "ch_1",
      object: "charge",
      currency: "usd",
      amount_refunded: 500,
      payment_intent: "pi_123",
    };
    expect(run("charge.refunded", charge).movements).toEqual([
      {
        phase: "refunded",
        amount: { minor: 500, currency: "USD" },
        correlationId: "billing/pi_123",
        kind: "charge-refunded",
        stripeObjectId: "ch_1",
      },
    ]);
  });

  test("credit_note.created is a POSITIVE refunded movement correlated on the invoice", () => {
    const note = {
      id: "cn_1",
      object: "credit_note",
      currency: "usd",
      total: 500,
      invoice: "in_123",
    };
    expect(run("credit_note.created", note).movements[0]).toMatchObject({
      phase: "refunded",
      amount: { minor: 500, currency: "USD" },
      correlationId: "billing/in_123",
    });
  });
});

describe("the quiet arms", () => {
  test("invoice.payment_failed produces zero movements", () => {
    expect(run("invoice.payment_failed", invoice(CARD))).toEqual({
      movements: [],
      observations: [],
    });
  });

  test("an event type outside the handled union produces zero movements and never throws", () => {
    for (const type of ["charge.dispute.created", "customer.subscription.updated", "made.up"]) {
      expect(() => reconcileEvent(event(type, {}), NOW)).not.toThrow();
      expect(run(type, {})).toEqual({ movements: [], observations: [] });
    }
  });

  test("a zero-amount invoice produces no movement — nothing moved", () => {
    expect(run("invoice.finalized", invoice({ total: 0 })).movements).toEqual([]);
  });
});

describe("order independence — Stripe does not guarantee delivery order", () => {
  test("the same events in reverse produce the same movement SET", () => {
    const feed = [
      event("invoice.finalized", invoice()),
      event("customer_cash_balance_transaction.created", cashTxn({ type: "funded" })),
      event("customer_cash_balance_transaction.created", {
        ...cashTxn({ type: "applied_to_payment", net_amount: -1050 }),
        applied_to_payment: { payment_intent: "pi_987" },
      }),
    ];
    const collect = (evs: typeof feed) =>
      evs
        .flatMap((e) => okOf(reconcileEvent(e, NOW)).movements)
        .map((m) => JSON.stringify(m))
        .sort();
    expect(collect([...feed].reverse())).toEqual(collect(feed));
  });
});

describe("the money boundary — Stripe is natively minor units", () => {
  test("lowercase usd normalizes and 1050 stays 1050: no double conversion, no float", () => {
    const amount = run("invoice.finalized", invoice({ currency: "usd", total: 1050 })).movements[0]
      ?.amount;
    expect(amount).toEqual({ minor: 1050, currency: "USD" });
    expect(Number.isInteger(amount?.minor)).toBe(true);
  });

  test("a JPY amount has zero minor digits and is not divided by 100", () => {
    expect(minorDigits("JPY")).toBe(0);
    expect(
      run("invoice.finalized", invoice({ currency: "jpy", total: 1050 })).movements[0]?.amount,
    ).toEqual({ minor: 1050, currency: "JPY" });
  });

  test("a movement that cannot be built returns an error rather than a zero", () => {
    for (const bad of [
      invoice({ currency: "dollars" }),
      invoice({ currency: null }),
      invoice({ total: 10.5 }),
      invoice({ total: "1050" }),
    ]) {
      const r = reconcileEvent(event("invoice.finalized", bad), NOW);
      expect(r.ok).toBe(false);
    }
  });

  test("an id that is not a ref-safe token is refused, never written into a correlation", () => {
    // CLAUDE.md §4 — refs, hashes, ids and counts ONLY. A movement is audit-bound.
    for (const id of ["in 123", "in_<script>", "customer name", ""]) {
      expect(reconcileEvent(event("invoice.finalized", invoice({ id })), NOW).ok).toBe(false);
    }
  });

  test("no Stripe object, email or prose ever reaches a movement", () => {
    const inv = invoice({
      ...CARD,
      customer_email: "someone@example.com",
      customer_name: "A Person",
      description: "a sentence of prose",
    });
    const json = JSON.stringify(run("invoice.paid", inv));
    expect(json).not.toContain("someone@example.com");
    expect(json).not.toContain("A Person");
    expect(json).not.toContain("prose");
  });
});

/**
 * THE BOUNDARIES THEMSELVES, at the exact days — because deletion-style mutation is blind here.
 * Deleting either `if` still leaves most ages classified correctly, and flipping `>=` to `>` moves
 * the answer on ONE day only. These assert that day.
 *
 * The literals are written out for the third blind spot: a constant the test IMPORTS moves the
 * oracle with the subject, so mutating `UNRECONCILED_RETURN_DAYS` would never be caught by a test
 * that only compares against it.
 */
describe("Stripe's unreconciled-funds clock, at the day it turns", () => {
  test("the two constants are 75 and 90", () => {
    expect(UNRECONCILED_RETURN_DAYS).toBe(75);
    expect(UNRECONCILED_SWEEP_DAYS).toBe(90);
  });

  test("day 74 is held, day 75 is return-attempted — the boundary is INCLUSIVE", () => {
    expect(unappliedStage(74)).toBe("held");
    expect(unappliedStage(75)).toBe("return-attempted");
  });

  test("day 89 is return-attempted, day 90 is swept — inclusive again", () => {
    expect(unappliedStage(89)).toBe("return-attempted");
    expect(unappliedStage(90)).toBe("swept");
  });

  test("fresh money is held and very old money stays swept", () => {
    expect(unappliedStage(0)).toBe("held");
    expect(unappliedStage(1)).toBe("held");
    expect(unappliedStage(365)).toBe("swept");
  });
});
