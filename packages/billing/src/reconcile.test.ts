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
  // DELIBERATELY different from `total` (28.1-11 #14). `reconcile.ts` chooses `amount_paid` —
  // money COLLECTED — over `total` — money BILLED — and an invoice partly settled from a credit
  // balance is exactly where they diverge. While both read 1050 the assertions below could not
  // tell the two apart, so changing the source to `inv.total` kept the suite green over a ledger
  // booking money we do not have.
  amount_paid: 900,
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
  test("a CARD invoice IS collection: one actual movement for what was COLLECTED", () => {
    const { movements } = run("invoice.paid", invoice(CARD));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      phase: "actual",
      // 900 — `amount_paid`, not the 1050 `total`. The fixture separates them on purpose: an
      // invoice partly settled from a credit balance bills 1050 and collects 900, and booking the
      // total would put 150 minor units of money we never received into an append-only book that
      // can only be corrected by a fabricated `refunded` row.
      amount: { minor: 900, currency: "USD" },
      correlationId: "billing/in_123",
    });
  });

  test("amount_paid BEATS total — the oracle for the collected-vs-billed choice", () => {
    // The discriminating assertion #14 found missing. `reconcile.ts` reads `amount_paid` when it
    // is a number and falls back to `total` only when it is absent; both halves are pinned here,
    // so changing the source to `inv.total` fails and so does dropping the fallback.
    expect(
      run("invoice.paid", invoice({ ...CARD, total: 4900, amount_paid: 2900 })).movements[0],
    ).toMatchObject({ amount: { minor: 2900, currency: "USD" } });
    const { amount_paid: _dropped, ...noAmountPaid } = invoice(CARD);
    expect(run("invoice.paid", noAmountPaid).movements[0]).toMatchObject({
      amount: { minor: 1050, currency: "USD" },
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
        // The TRANSACTION, not the customer (28.1-11 #1). See the repeat-movement block below.
        correlationId: "billing/ccsbtxn_1",
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
  test("refund.created is a POSITIVE refunded movement", () => {
    const ref = {
      id: "re_1",
      object: "refund",
      currency: "usd",
      amount: 500,
      charge: "ch_1",
      payment_intent: "pi_123",
    };
    expect(run("refund.created", ref).movements).toEqual([
      {
        phase: "refunded",
        amount: { minor: 500, currency: "USD" },
        correlationId: "billing/re_1",
        kind: "refund-created",
        stripeObjectId: "re_1",
      },
    ]);
  });

  test("credit_note.created is a POSITIVE refunded movement correlated on the CREDIT NOTE", () => {
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
      // The note is the movement; the invoice is the tie-back (28.1-11 #7).
      correlationId: "billing/cn_1",
      stripeObjectId: "in_123",
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

/**
 * 28.1-11 findings #1, #6, #7 — ONE root cause: a correlation built from an entity that REPEATS
 * instead of from the movement that is unique.
 *
 * `recordBillingMovement` makes `(tenantId, correlationId, phase)` the identity and on a hit
 * returns the stored row while IGNORING the replayed amount (`billingLedger.ts:142`). So a
 * correlation shared by two genuinely different movements is not a duplicate-suppression win — it
 * is the second movement silently never being booked, in an append-only table that cannot correct
 * it. Every assertion below pins the POSITIVE correlation value, not merely that two differ, so a
 * refactor that made both `undefined` could not read as a pass.
 */
describe("a correlation is built from the MOVEMENT, never from an entity that repeats", () => {
  const cashRun = (over: Record<string, unknown>) =>
    run("customer_cash_balance_transaction.created", cashTxn(over)).movements;

  test("#1 a customer's SECOND bank transfer is its own reserved movement", () => {
    const jan = cashRun({ id: "ccsbtxn_jan", type: "funded", net_amount: 4900 });
    const feb = cashRun({ id: "ccsbtxn_feb", type: "funded", net_amount: 12000 });
    expect(jan[0]).toMatchObject({
      phase: "reserved",
      amount: { minor: 4900, currency: "USD" },
      correlationId: "billing/ccsbtxn_jan",
      stripeObjectId: "ccsbtxn_jan",
    });
    expect(feb[0]).toMatchObject({
      phase: "reserved",
      amount: { minor: 12000, currency: "USD" },
      correlationId: "billing/ccsbtxn_feb",
      stripeObjectId: "ccsbtxn_feb",
    });
  });

  test("#1 the SECOND funding_reversed for one customer is its own refunded movement", () => {
    const first = cashRun({ id: "ccsbtxn_r1", type: "funding_reversed", net_amount: -4900 });
    const second = cashRun({ id: "ccsbtxn_r2", type: "funding_reversed", net_amount: -12000 });
    expect(first[0]).toMatchObject({
      phase: "refunded",
      amount: { minor: 4900, currency: "USD" },
      correlationId: "billing/ccsbtxn_r1",
    });
    expect(second[0]).toMatchObject({
      phase: "refunded",
      amount: { minor: 12000, currency: "USD" },
      correlationId: "billing/ccsbtxn_r2",
    });
  });

  test("#1 the PaymentIntent fallbacks fall back to the TRANSACTION, never to the customer", () => {
    // `unapplied_from_payment` / `refunded_from_payment` without an expanded PaymentIntent. The
    // customer would collapse every one of them onto one `refunded` identity.
    for (const type of ["unapplied_from_payment", "refunded_from_payment"]) {
      const a = cashRun({ id: "ccsbtxn_a", type, net_amount: 100 })[0];
      const b = cashRun({ id: "ccsbtxn_b", type, net_amount: 200 })[0];
      expect(a?.correlationId).toBe("billing/ccsbtxn_a");
      expect(b?.correlationId).toBe("billing/ccsbtxn_b");
    }
  });

  test("#7 a SECOND credit note against ONE invoice is its own movement", () => {
    const note = (id: string, total: number) =>
      run("credit_note.created", {
        id,
        object: "credit_note",
        currency: "usd",
        total,
        invoice: "in_123",
      }).movements[0];
    expect(note("cn_1", 3000)).toMatchObject({
      phase: "refunded",
      amount: { minor: 3000, currency: "USD" },
      correlationId: "billing/cn_1",
      // The invoice survives as the TIE-BACK, so nothing is lost by moving the correlation.
      stripeObjectId: "in_123",
    });
    expect(note("cn_2", 4000)).toMatchObject({
      amount: { minor: 4000, currency: "USD" },
      correlationId: "billing/cn_2",
      stripeObjectId: "in_123",
    });
  });
});

/**
 * #6 — `charge.refunded` carries the CUMULATIVE `amount_refunded` on the charge and repeats on one
 * `ch_`; `refund.created` carries this refund's own `amount` under a unique `re_`. Stripe's own
 * documentation on `charge.refunded` says to listen to `refund.created` for the refund's detail.
 */
describe("refund.created — the DELTA, under an id that is unique per refund", () => {
  const refund = (over: Record<string, unknown> = {}) => ({
    id: "re_1",
    object: "refund",
    currency: "usd",
    amount: 500,
    charge: "ch_1",
    payment_intent: "pi_123",
    ...over,
  });

  test("books this refund's own amount, correlated on the refund", () => {
    expect(run("refund.created", refund()).movements).toEqual([
      {
        phase: "refunded",
        amount: { minor: 500, currency: "USD" },
        correlationId: "billing/re_1",
        kind: "refund-created",
        stripeObjectId: "re_1",
      },
    ]);
  });

  test("a SECOND partial refund on ONE charge books its own DELTA, not a running total", () => {
    const first = run("refund.created", refund({ id: "re_1", amount: 500 })).movements[0];
    const second = run("refund.created", refund({ id: "re_2", amount: 1200 })).movements[0];
    expect(first).toMatchObject({
      amount: { minor: 500, currency: "USD" },
      correlationId: "billing/re_1",
    });
    // 1200, the delta — NOT 1700, which is what the charge's `amount_refunded` would have said.
    expect(second).toMatchObject({
      amount: { minor: 1200, currency: "USD" },
      correlationId: "billing/re_2",
    });
  });

  test("charge.refunded books NOTHING — its amount_refunded is a cumulative total", () => {
    // A guard against re-adding the arm, not decoration: this exact payload used to book 1700 as
    // if it were a second $12 refund, on a correlation the first refund already owned.
    const charge = {
      id: "ch_1",
      object: "charge",
      currency: "usd",
      amount_refunded: 1700,
      payment_intent: "pi_123",
    };
    expect(run("charge.refunded", charge)).toEqual({ movements: [], observations: [] });
  });
});
