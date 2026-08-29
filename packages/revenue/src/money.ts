/**
 * The only module in the repo allowed to MAKE a money value.
 *
 * Every amount is a safe-integer count of a currency's minor unit plus an explicit ISO 4217 code.
 * No float ever holds a money value: parsing is string/BigInt arithmetic, so `0.1` USD is exactly
 * `10` and never `10.000000000000002`.
 *
 * Two currencies never combine. Every combining operation returns a `Result` and refuses a
 * mismatch rather than picking a winner — `groupByCurrency` is the "separate" half of the phase
 * context's "reject or separate mixed currency".
 */
import { err, ok, type Result } from "@pikar/core/result";
import type { Currency, Money } from "./contracts";

const ALPHA3 = /^[A-Za-z]{3}$/;
/** `-?` digits, optional `.` digits. No exponent, no separators, no whitespace, no bare dot. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * ISO 4217 minor-unit exponents that are NOT 2. The default of 2 is not a guess — the exceptions
 * are a finite, published list, and enumerating them IS enumerating all of them. A currency that
 * later joins one of these families must be added here, or its amounts parse off by a factor of
 * ten. `ponytail:` a lookup table, not a currency-data dependency; upgrade to one if the product
 * ever needs symbols, names or historical exponents.
 */
const EXPONENT_EXCEPTIONS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

const MAX = Number.MAX_SAFE_INTEGER;
const MAX_BIG = BigInt(MAX);

/** The one door a raw currency string comes through. Case-insensitive: Stripe sends `usd`. */
export function normalizeCurrency(raw: unknown): Result<Currency, string> {
  if (typeof raw !== "string" || !ALPHA3.test(raw)) {
    return err("A currency must be an ISO 4217 alpha-3 code.");
  }
  return ok(raw.toUpperCase());
}

/** Assumes a normalized code. Unknown-but-well-formed codes take the ISO default of 2. */
export const minorDigits = (currency: Currency): number => EXPONENT_EXCEPTIONS[currency] ?? 2;

const make = (minor: number, currency: Currency): Money =>
  // `+ 0` collapses -0 to 0: a negative zero balance is not a thing, and it breaks equality.
  ({ minor: minor + 0, currency });

export function moneyFromMinor(minor: number, currency: unknown): Result<Money, string> {
  const cur = normalizeCurrency(currency);
  if (!cur.ok) return cur;
  if (!Number.isSafeInteger(minor)) {
    return err("A money amount must be a safe integer count of minor units.");
  }
  return ok(make(minor, cur.value));
}

export const zeroMoney = (currency: Currency): Money => make(0, currency);
export const isZeroMoney = (m: Money): boolean => m.minor === 0;

/** Exact decimal string -> minor units. The primary door for PayPal/HubSpot string amounts. */
export function parseMoney(text: unknown, currency: unknown): Result<Money, string> {
  const cur = normalizeCurrency(currency);
  if (!cur.ok) return cur;
  if (typeof text !== "string") return err("An amount must be a decimal string.");
  const m = DECIMAL.exec(text);
  if (!m) return err("An amount must be a plain decimal string.");
  const sign = m[1] ?? "";
  const whole = m[2] ?? "";
  const frac = m[3] ?? "";
  const exp = minorDigits(cur.value);
  if (frac.length > exp) {
    return err(`An amount in ${cur.value} has at most ${exp} decimal places.`);
  }
  // BigInt, not Number: the digit string can be longer than a float can hold exactly, and the
  // magnitude check below has to happen BEFORE any lossy conversion.
  const magnitude = BigInt(whole + frac.padEnd(exp, "0"));
  if (magnitude > MAX_BIG) return err("An amount exceeds safe integer range.");
  return ok(make(Number(magnitude) * (sign === "-" ? -1 : 1), cur.value));
}

/**
 * A provider that sends money as a JSON number (QuickBooks) — routed through the exact shortest
 * round-trip string so there is still only ONE parser. `1e21` and friends stringify to exponent
 * notation, which `parseMoney` refuses rather than misread; that is the right answer for an amount
 * far outside any real ledger.
 */
export function moneyFromNumber(value: unknown, currency: unknown): Result<Money, string> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err("An amount must be a finite number.");
  }
  return parseMoney(String(value), currency);
}

/** Exact decimal rendering, padded to the currency exponent. Never localized — callers add the code. */
export function formatMoneyAmount(m: Money): string {
  const exp = minorDigits(m.currency);
  const digits = String(Math.abs(m.minor)).padStart(exp + 1, "0");
  const cut = digits.length - exp;
  const frac = exp === 0 ? "" : `.${digits.slice(cut)}`;
  return `${m.minor < 0 ? "-" : ""}${digits.slice(0, cut)}${frac}`;
}

const sameCurrency = (a: Money, b: Money): Result<Currency, string> =>
  a.currency === b.currency
    ? ok(a.currency)
    : err(`Cannot combine ${a.currency} and ${b.currency} in one figure.`);

const safe = (minor: number, currency: Currency): Result<Money, string> =>
  Number.isSafeInteger(minor)
    ? ok(make(minor, currency))
    : err("A money total exceeds safe integer range.");

export function addMoney(a: Money, b: Money): Result<Money, string> {
  const cur = sameCurrency(a, b);
  return cur.ok ? safe(a.minor + b.minor, cur.value) : cur;
}

export function subMoney(a: Money, b: Money): Result<Money, string> {
  const cur = sameCurrency(a, b);
  return cur.ok ? safe(a.minor - b.minor, cur.value) : cur;
}

export const negateMoney = (m: Money): Money => make(-m.minor, m.currency);

/** `-1 | 0 | 1`, or a refusal. Ordering across currencies is meaningless without an FX rate. */
export function compareMoney(a: Money, b: Money): Result<-1 | 0 | 1, string> {
  const cur = sameCurrency(a, b);
  if (!cur.ok) return cur;
  return ok(a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1);
}

/**
 * The currency is REQUIRED, never inferred from the first element: an empty list still has to
 * produce a zero of some currency, and inferring one is how a caller silently totals the wrong
 * ledger.
 */
export function sumMoney(items: readonly Money[], currency: unknown): Result<Money, string> {
  const cur = normalizeCurrency(currency);
  if (!cur.ok) return cur;
  let total = 0;
  for (const item of items) {
    if (item.currency !== cur.value) {
      return err(`Cannot total ${item.currency} into a ${cur.value} figure.`);
    }
    total += item.minor;
    if (!Number.isSafeInteger(total)) return err("A money total exceeds safe integer range.");
  }
  return ok(make(total, cur.value));
}

/** The "separate" answer to mixed currency, for callers that must report per-ledger. */
export function groupByCurrency(items: readonly Money[]): Map<Currency, Money[]> {
  const out = new Map<Currency, Money[]>();
  for (const item of items) {
    const bucket = out.get(item.currency);
    if (bucket) bucket.push(item);
    else out.set(item.currency, [item]);
  }
  return out;
}
