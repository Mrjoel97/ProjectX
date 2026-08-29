/**
 * BILL-03 — which Stripe signal means which money movement. PURE (CLAUDE.md §1): no `ctx`, no
 * `fetch`, no DB, no env, and no clock read (`nowMs` is an argument, never `Date.now()` inside).
 *
 * **THE CENTRAL LAW: `invoice.paid` is NOT cash in hand.**
 *
 * `BANK_TRANSFER_ENABLED` is `true` for this merchant (owner-confirmed 2026-08-29), so this is a
 * live path, not defensive code. Bank-transfer funds land in the customer's **cash balance**, not
 * on the invoice. Stripe then reconciles them onto PaymentIntents — and only sometimes, only when
 * the amount AND reference match. So:
 *
 *   • `customer_cash_balance_transaction` `funded`             → ARRIVAL      → `reserved`
 *   • `customer_cash_balance_transaction` `applied_to_payment` → COLLECTION   → `actual`
 *   • `customer_cash_balance_transaction` `funding_reversed`   → TAKEN BACK   → `refunded`
 *   • `invoice.paid` on a bank-transfer invoice                → NOTHING moved, only an observation
 *   • `invoice.paid` on a CARD invoice                         → COLLECTION   → `actual`
 *
 * Booking `actual` on a bank-transfer `invoice.paid` records money we do not have, in an
 * append-only ledger that cannot quietly correct it — and `funding_reversed` makes that a real
 * financial error rather than a theoretical one.
 *
 * `cash_balance.funds_available` is the trap that is easiest to get BACKWARDS. Under Stripe's
 * default automatic reconciliation it fires only when there is a positive **remaining** balance
 * after reconciliation — it is the "unapplied funds are visible" signal, **not** an arrival
 * signal. It therefore produces ZERO ledger movements and one observation carrying an AGE, because
 * unreconciled money has a clock (see the two constants below).
 *
 * Phases come from `@pikar/core`'s `SPEND_PHASES` verbatim; no phase name is invented here, and
 * `spend.ts` is not modified. Every amount is POSITIVE: direction lives in the phase, never in the
 * sign, so no consumer has to guess whether a negative number is a credit or a bug.
 */

import { err, ok, type Result } from "@pikar/core/result";
import type { SpendPhase } from "@pikar/core/spend";
import type { Money } from "@pikar/revenue/contracts";
import { moneyFromMinor } from "@pikar/revenue/money";

/**
 * Stripe's payment-method type for the customer cash balance — i.e. bank transfer. ONE symbol, so
 * the discriminator is not a string scattered through branches.
 */
export const PAYMENT_METHOD_BANK_TRANSFER = "customer_balance";

/** Stripe attempts to RETURN unreconciled funds to the customer's bank at this age. */
export const UNRECONCILED_RETURN_DAYS = 75;
/** Unreturnable funds are SWEPT to the Stripe account balance by this age. */
export const UNRECONCILED_SWEEP_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * `spend.ts:42` — refs, ids and code-owned tokens only. No space, so prose cannot pass.
 *
 * EXPORTED so `convex/billingLedger.ts` validates its trust boundary against the SAME pattern that
 * built the values, rather than a third copy of it. `spend.ts`'s own `TOKEN` is private and that
 * file is deliberately not being edited by 28.1-06 (the spend plane must show an empty diff), so
 * this is the one definition the billing plane can share.
 */
export const REF_TOKEN = /^[A-Za-z0-9._:@/-]+$/;

export interface BillingMovement {
  phase: SpendPhase;
  /** Integer minor units + explicit currency, built only by `@pikar/revenue`. Always positive. */
  amount: Money;
  /** `billing/<stripe id>`. Ids only — never a Stripe object, an email, a name or any prose. */
  correlationId: string;
  /** Code-owned token naming which signal produced this. Never caller-supplied. */
  kind: string;
  stripeObjectId: string;
}

export type BillingObservation =
  | {
      kind: "unapplied-funds";
      amount: Money;
      correlationId: string;
      stripeObjectId: string;
      ageDays: number;
      stage: "held" | "return-attempted" | "swept";
    }
  | { kind: "awaiting-cash-application"; correlationId: string; stripeObjectId: string }
  | { kind: "payment-method-undetermined"; correlationId: string; stripeObjectId: string };

export interface Reconciliation {
  movements: BillingMovement[];
  observations: BillingObservation[];
}

const NOTHING: Reconciliation = { movements: [], observations: [] };

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** A correlation id is built from an id and nothing else, and refused if the id is not ref-safe. */
function ref(id: unknown): Result<string, string> {
  const s = str(id);
  if (s === null || s.length > 100 || !REF_TOKEN.test(s)) {
    return err("a correlation id must be built from a ref-safe Stripe id");
  }
  return ok(`billing/${s}`);
}

/**
 * One movement, or nothing. A raw amount of 0 means nothing moved — that is not an error and not a
 * zero-valued row. An amount that cannot be turned into money IS an error: a ledger that writes a
 * zero because it could not read a number is worse than one that refuses.
 */
function movement(
  phase: SpendPhase,
  kind: string,
  rawAmount: unknown,
  currency: unknown,
  correlationSource: unknown,
  stripeObjectId: unknown,
): Result<BillingMovement[], string> {
  if (typeof rawAmount !== "number") return err(`${kind}: amount must be a number`);
  // `Math.abs` because Stripe signs cash-balance `net_amount`; the phase already carries direction.
  const money = moneyFromMinor(Math.abs(rawAmount), currency);
  if (!money.ok) return err(`${kind}: ${money.error}`);
  if (money.value.minor === 0) return ok([]);

  const correlationId = ref(correlationSource);
  if (!correlationId.ok) return err(`${kind}: ${correlationId.error}`);
  const objectId = str(stripeObjectId);
  if (objectId === null || !REF_TOKEN.test(objectId)) return err(`${kind}: unusable object id`);

  return ok([
    {
      phase,
      amount: money.value,
      correlationId: correlationId.value,
      kind,
      stripeObjectId: objectId,
    },
  ]);
}

const moved = (m: Result<BillingMovement[], string>): Result<Reconciliation, string> =>
  m.ok ? ok({ movements: m.value, observations: [] }) : m;

/**
 * Which payment methods could have paid this invoice, MOST SPECIFIC FIRST.
 *
 * `payment_settings.payment_method_types` is what was ALLOWED, not what was USED, so it is the
 * last resort. An empty result means undeterminable — which must never resolve to "card".
 */
function invoicePaymentMethods(inv: Obj): string[] {
  const charged = str(obj(obj(inv.charge).payment_method_details).type);
  if (charged) return [charged];

  const pi = obj(inv.payment_intent);
  const piTypes = Array.isArray(pi.payment_method_types) ? pi.payment_method_types : null;
  if (piTypes?.length) return piTypes.filter((t): t is string => typeof t === "string");

  const allowed = obj(inv.payment_settings).payment_method_types;
  return Array.isArray(allowed) ? allowed.filter((t): t is string => typeof t === "string") : [];
}

function invoicePaid(inv: Obj): Result<Reconciliation, string> {
  const correlationId = ref(inv.id);
  if (!correlationId.ok) return correlationId;
  const stripeObjectId = str(inv.id) as string;

  const methods = invoicePaymentMethods(inv);
  // Fail CLOSED on both branches below. Only a positively-identified non-cash-balance payment is
  // collection; "we could not tell" is not a card, and a bank transfer is definitively not paid.
  if (methods.length === 0) {
    return ok({
      movements: [],
      observations: [
        { kind: "payment-method-undetermined", correlationId: correlationId.value, stripeObjectId },
      ],
    });
  }
  if (methods.includes(PAYMENT_METHOD_BANK_TRANSFER)) {
    return ok({
      movements: [],
      observations: [
        { kind: "awaiting-cash-application", correlationId: correlationId.value, stripeObjectId },
      ],
    });
  }
  const amount = typeof inv.amount_paid === "number" ? inv.amount_paid : inv.total;
  return moved(movement("actual", "invoice-paid-card", amount, inv.currency, inv.id, inv.id));
}

/** `applied_to_payment` is the ONLY collection signal on this rail. */
function cashBalanceTransaction(txn: Obj): Result<Reconciliation, string> {
  const type = str(txn.type);
  const pi = (key: string) => obj(txn[key]).payment_intent;

  switch (type) {
    case "funded":
      // Money EXISTS but is not ours: precisely `reserved`. There is no PaymentIntent yet, so the
      // customer is the only thing to correlate on.
      return moved(
        movement("reserved", "cash-funded", txn.net_amount, txn.currency, txn.customer, txn.id),
      );
    case "applied_to_payment":
      // The PaymentIntent is the ONLY tie back to the invoice. Without it there is no honest
      // correlation, and an uncorrelated `actual` in an append-only ledger can never be paired up.
      return moved(
        movement(
          "actual",
          "cash-applied",
          txn.net_amount,
          txn.currency,
          pi("applied_to_payment"),
          txn.id,
        ),
      );
    case "funding_reversed":
      // The incoming transfer was pulled back. NEVER silently dropped — this is the event that
      // makes "record actual on invoice.paid" a real financial error.
      return moved(
        movement(
          "refunded",
          "funding-reversed",
          txn.net_amount,
          txn.currency,
          txn.customer,
          txn.id,
        ),
      );
    case "unapplied_from_payment":
      return moved(
        movement(
          "refunded",
          "cash-unapplied",
          txn.net_amount,
          txn.currency,
          pi("unapplied_from_payment") ?? txn.customer,
          txn.id,
        ),
      );
    case "refunded_from_payment":
      return moved(
        movement(
          "refunded",
          "cash-refunded",
          txn.net_amount,
          txn.currency,
          pi("refunded_from_payment") ?? txn.customer,
          txn.id,
        ),
      );
    default:
      // `adjusted_for_overdraft`, `return_initiated`, `return_canceled`, `transferred_to_balance`.
      // Real events, deliberately unmapped: none of them is Pikar collecting or returning revenue.
      // ponytail: silence, not a throw — map one the day a surface needs it.
      return ok(NOTHING);
  }
}

/**
 * LEFTOVER money, not an arrival. Under automatic reconciliation this fires only when a positive
 * balance REMAINS. One observation per currency — the "separate" answer to mixed currency; two
 * currencies never combine into one figure.
 */
function fundsAvailable(
  balance: Obj,
  createdMs: number,
  nowMs: number,
): Result<Reconciliation, string> {
  const correlationId = ref(balance.customer);
  if (!correlationId.ok) return correlationId;
  const stripeObjectId = str(balance.customer) as string;

  const ageDays = Math.max(0, Math.floor((nowMs - createdMs) / DAY_MS));
  const stage =
    ageDays >= UNRECONCILED_SWEEP_DAYS
      ? "swept"
      : ageDays >= UNRECONCILED_RETURN_DAYS
        ? "return-attempted"
        : "held";

  const observations: BillingObservation[] = [];
  for (const [currency, minor] of Object.entries(obj(balance.available))) {
    if (typeof minor !== "number") return err("funds-available: an amount must be a number");
    const money = moneyFromMinor(Math.abs(minor), currency);
    if (!money.ok) return err(`funds-available: ${money.error}`);
    if (money.value.minor === 0) continue;
    observations.push({
      kind: "unapplied-funds",
      amount: money.value,
      correlationId: correlationId.value,
      stripeObjectId,
      ageDays,
      stage,
    });
  }
  return ok({ movements: [], observations });
}

/**
 * Map ONE Stripe event to ledger movements and observations.
 *
 * Stateless and per-event ON PURPOSE: Stripe does not guarantee delivery order, so nothing here
 * may depend on what arrived before it. An unhandled type is zero movements and never a throw.
 *
 * @param nowMs Injected, never read. A pure function that reads a clock is not pure and cannot be
 *   tested at a boundary — this repo has been bitten by exactly that.
 */
export function reconcileEvent(event: unknown, nowMs: number): Result<Reconciliation, string> {
  const e = obj(event);
  const object = obj(obj(e.data).object);
  const createdMs = typeof e.created === "number" ? e.created * 1000 : nowMs;

  switch (str(e.type)) {
    case "invoice.finalized":
      // What we EXPECT to collect. Not money, not yet.
      return moved(
        movement(
          "estimated",
          "invoice-finalized",
          object.total,
          object.currency,
          object.id,
          object.id,
        ),
      );
    case "invoice.paid":
      return invoicePaid(object);
    case "customer_cash_balance_transaction.created":
      return cashBalanceTransaction(object);
    case "cash_balance.funds_available":
      return fundsAvailable(object, createdMs, nowMs);
    case "charge.refunded":
      return moved(
        movement(
          "refunded",
          "charge-refunded",
          object.amount_refunded,
          object.currency,
          object.payment_intent ?? object.id,
          object.id,
        ),
      );
    case "credit_note.created":
      return moved(
        movement(
          "refunded",
          "credit-note",
          object.total,
          object.currency,
          object.invoice ?? object.id,
          object.id,
        ),
      );
    default:
      // `invoice.payment_failed`, the subscription/checkout lifecycle, and everything Stripe adds
      // without asking. No money moved.
      return ok(NOTHING);
  }
}
