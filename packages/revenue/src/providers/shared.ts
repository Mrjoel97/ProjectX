/**
 * The three provider-agnostic helpers every rail in this phase needs, in one place.
 *
 * They were written for QuickBooks (28-06) and re-exported from there for compatibility; Stripe
 * (28-07) is the second rail to need them and PayPal (28-08) will be the third. Copying them per
 * lane is how the item cap, the reject count and the mixed-currency rule quietly stop meaning the
 * same thing in three files (CLAUDE.md §8 rung 2).
 *
 * Nothing here is provider-specific: no URL, no verb, no vendor field name. `CAPS` is imported
 * rather than restated, so there is still exactly ONE definition of every bound.
 */
import type { Result } from "@pikar/core/result";
import { err, ok } from "@pikar/core/result";
import { CAPS, type Currency } from "../contracts";

const DAY_MS = 86_400_000;

export type ReadWindow = { startMs: number; endMs: number };

/**
 * A bounded coverage window ending at `asOfMs`. Refuses anything wider than `CAPS.maxWindowDays` so
 * a caller cannot ask for "since forever" and then present a capped answer as complete.
 */
export function boundedWindow(asOfMs: number, days: number): Result<ReadWindow, string> {
  if (!Number.isFinite(asOfMs)) return err("A read window needs a valid as-of time.");
  if (!Number.isSafeInteger(days) || days < 1 || days > CAPS.maxWindowDays) {
    return err(`A provider read window must be 1..${CAPS.maxWindowDays} whole days.`);
  }
  return ok({ startMs: asOfMs - days * DAY_MS, endMs: asOfMs });
}

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
