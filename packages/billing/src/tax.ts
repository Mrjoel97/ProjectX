/**
 * BILL-05 — the honest tax posture. PURE (CLAUDE.md §1): no `ctx`, no `fetch`, no env, no clock.
 *
 * **`not_collecting` is AMBIGUOUS, and that ambiguity is this module's whole reason to exist.**
 * Stripe says it verbatim: `taxability_reason: "not_collecting"` means EITHER *no active
 * registration in the customer's jurisdiction* OR *a Nontaxable product tax code
 * (`txcd_00000000`) on the product*. Those are two different claims about our business — "we are
 * not registered where you are" versus "we decided this product is not taxable anywhere" — and
 * **only the product's own tax code can tell them apart.** That is why `taxPosture` takes TWO
 * inputs and structurally refuses to be written with one.
 *
 * The product code is `PRODUCT_TAX_CODE` in `./config` — a Dashboard value the owner reports. It
 * is passed IN rather than read here so this function stays a pure function of its arguments and
 * so a caller reading a historical invoice can pass the code that was configured *then*. It is
 * still `null` today (the owner deferred it), which is a real state with a real answer: unknown.
 *
 * **A bare `Tax: 0.00` is never presentable.** Zero has at least four distinct meanings and the
 * reason travels with the number or there is no number — see `renderTaxPosture`.
 *
 * **There is no threshold monitor here, and there never will be.** Stripe publishes no
 * tax-threshold webhook event of any name (the literal is deliberately not written out, so a
 * repo-wide grep for one stays empty), monitoring runs live-mode only, and notification is
 * gated at $10k prior-year revenue — so a monitor written in this repo could not fire. The owner duty that
 * replaces it is written down in `docs/playbooks/billing.md`.
 */

import { formatMoneyAmount, moneyFromMinor } from "@pikar/revenue/money";
import { NONTAXABLE_TAX_CODE } from "./config";

/**
 * THE INVOICE TAX FIELD, read against the version we PIN.
 *
 * `STRIPE_API_VERSION` is `2026-08-26.dahlia` (`./config`), which is after `2025-03-31.basil`, so
 * the invoice tax breakdown is **`total_taxes[]`**. Before Basil the same breakdown was
 * `total_tax_amounts[]`, and that name is deliberately NOT read here: a version downgrade must
 * become a visible edit rather than a silent null, and `tax.test.ts` pins the version literal
 * beside this field name so moving one without the other is RED.
 */
export const INVOICE_TAX_FIELD = "total_taxes";

/**
 * Stripe's published `taxability_reason` table, written out. A value outside this list is
 * `unknown` — never quietly folded into one of the arms below, because every arm is a factual
 * claim about why a customer was or was not charged tax.
 */
export const TAXABILITY_REASONS = [
  "not_collecting",
  "product_exempt",
  "reverse_charge",
  "customer_exempt",
  "not_supported",
  "not_subject_to_tax",
  "product_exempt_holiday",
  "portion_product_exempt",
  "zero_rated",
  "standard_rated",
] as const;

export type TaxabilityReason = (typeof TAXABILITY_REASONS)[number];

/**
 * What a tax line actually claims, in exactly one of four states.
 *
 *   • `not-owed`        — no tax was ever due. `because` carries WHICH of the two `not_collecting`
 *                         claims this is; they are not interchangeable.
 *   • `calculated-zero` — a real calculation ran and produced zero. A different statement from
 *                         "not owed", and the two must never render the same sentence.
 *   • `collected`       — a real positive amount, in minor units.
 *   • `unknown`         — we cannot say. Borrowed from `@pikar/core`'s `CashFigure` discipline
 *                         (missing history is unknown, never zero) but NOT its type: `cash.ts` is
 *                         USD dollars about the TENANT's business and must never carry Pikar's
 *                         billing cents.
 */
export type TaxPosture =
  | { state: "not-owed"; because: "unregistered" | "declared-nontaxable" }
  | { state: "calculated-zero"; reason: TaxabilityReason }
  | { state: "collected"; minor: number }
  | { state: "unknown"; reason: string };

const isReason = (r: unknown): r is TaxabilityReason =>
  typeof r === "string" && (TAXABILITY_REASONS as readonly string[]).includes(r);

/**
 * @param reason  Stripe's `taxability_reason` for the line, or `null`/`undefined` if absent.
 * @param productTaxCode  OUR configured product tax code (`PRODUCT_TAX_CODE`). `null` or empty
 *   means not yet configured — which makes `not_collecting` undecidable, not "unregistered".
 * @param taxMinor  The tax amount in the currency's minor units. Stripe is natively minor units.
 */
export function taxPosture(
  reason: string | null | undefined,
  productTaxCode: string | null,
  taxMinor: number,
): TaxPosture {
  // A number beats a reason. Whatever Stripe said about why, money that was charged was charged.
  if (!Number.isSafeInteger(taxMinor) || taxMinor < 0) {
    return { state: "unknown", reason: "invalid-tax-amount" };
  }
  if (taxMinor > 0) return { state: "collected", minor: taxMinor };

  if (!isReason(reason)) return { state: "unknown", reason: "unrecognised-taxability-reason" };

  if (reason === "not_collecting") {
    // The second half. Without it there is no honest answer, so we give none.
    if (!productTaxCode) {
      return { state: "unknown", reason: "not-collecting-without-product-tax-code" };
    }
    return productTaxCode === NONTAXABLE_TAX_CODE
      ? { state: "not-owed", because: "declared-nontaxable" }
      : { state: "not-owed", because: "unregistered" };
  }

  // Every other published reason means a calculation RAN and landed on zero. The product code is
  // irrelevant to these — only `not_collecting` is ambiguous.
  return { state: "calculated-zero", reason };
}

/**
 * The ONE taxability reason an invoice claims, or null when it does not claim exactly one.
 *
 * Null on DISAGREEMENT, not just on absence. An invoice can carry several tax entries, and if two
 * of them give different reasons there is no single reason — storing the first would pick a
 * winner and print a confident sentence about the wrong one. `taxPosture` answers `unknown` for a
 * null, which is the honest result.
 *
 * PURE, and the only thing it lifts is a published enum token: the value is checked against
 * `TAXABILITY_REASONS` before it is returned, so an unrecognised string (or prose) becomes null
 * rather than a free-text field on a row that lives forever (CLAUDE.md §4).
 */
export function invoiceTaxabilityReason(invoice: unknown): TaxabilityReason | null {
  const object = (typeof invoice === "object" && invoice !== null ? invoice : {}) as Record<
    string,
    unknown
  >;
  const entries = object[INVOICE_TAX_FIELD];
  if (!Array.isArray(entries)) return null;

  const claimed = new Set<unknown>();
  for (const entry of entries) {
    const reason = (entry as { taxability_reason?: unknown } | null)?.taxability_reason;
    if (reason !== undefined && reason !== null) claimed.add(reason);
  }
  if (claimed.size !== 1) return null;
  const [only] = [...claimed];
  return isReason(only) ? only : null;
}

/**
 * The sentence a human reads. This exists because BILL-05's promise is about what is RENDERED, not
 * about an enum value: a backend that models the distinction perfectly and then prints "$0.00" has
 * delivered nothing. **No zero arm below emits an amount at all** — that is how a bare `0.00` is
 * made unreachable rather than merely discouraged.
 */
export function renderTaxPosture(posture: TaxPosture, currency: string): string {
  switch (posture.state) {
    case "not-owed":
      return posture.because === "declared-nontaxable"
        ? "Tax not owed — this product is declared nontaxable, so none was ever due."
        : "Tax not owed — we hold no tax registration in this jurisdiction.";
    case "calculated-zero":
      return `Tax was calculated and came to zero — Stripe reason: ${posture.reason}.`;
    case "collected": {
      const money = moneyFromMinor(posture.minor, currency);
      return money.ok
        ? `Tax collected: ${formatMoneyAmount(money.value)} ${money.value.currency}.`
        : `Tax collected: ${posture.minor} minor units — unrecognised currency, not converted.`;
    }
    case "unknown":
      return `Tax posture unknown (${posture.reason}) — not reported as zero.`;
  }
}
