import { unwrap } from "@pikar/core/result";
import { describe, expect, it } from "vitest";
import type { Money } from "./contracts";
import {
  addMoney,
  compareMoney,
  formatMoneyAmount,
  groupByCurrency,
  isZeroMoney,
  minorDigits,
  moneyFromMinor,
  moneyFromNumber,
  negateMoney,
  normalizeCurrency,
  parseMoney,
  subMoney,
  sumMoney,
  zeroMoney,
} from "./money";

const usd = (minor: number): Money => unwrap(moneyFromMinor(minor, "USD"));
const jpy = (minor: number): Money => unwrap(moneyFromMinor(minor, "JPY"));
const eur = (minor: number): Money => unwrap(moneyFromMinor(minor, "EUR"));

describe("normalizeCurrency", () => {
  it("uppercases a provider's lowercase code (Stripe sends `usd`)", () => {
    expect(unwrap(normalizeCurrency("usd"))).toBe("USD");
    expect(unwrap(normalizeCurrency("EUR"))).toBe("EUR");
  });

  it("refuses anything that is not an ISO 4217 alpha-3 code", () => {
    for (const bad of ["US", "USDX", "US1", "", "  ", "$", "u sd", null, undefined, 840]) {
      expect(normalizeCurrency(bad as never).ok).toBe(false);
    }
  });
});

describe("minorDigits — the exponent is code-owned, never guessed per call", () => {
  it("knows the zero-decimal, two-decimal and three-decimal families", () => {
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KRW")).toBe(0);
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("BHD")).toBe(3);
    expect(minorDigits("KWD")).toBe(3);
    expect(minorDigits("CLF")).toBe(4);
  });
});

describe("parseMoney — exact decimal string to safe integer minor units", () => {
  it("parses without ever touching a float", () => {
    // 0.1 * 100 is 10.000000000000002 in IEEE-754. String arithmetic is exact.
    expect(unwrap(parseMoney("0.1", "USD")).minor).toBe(10);
    expect(unwrap(parseMoney("0.07", "USD")).minor).toBe(7);
    expect(unwrap(parseMoney("1234.56", "USD")).minor).toBe(123456);
    expect(unwrap(parseMoney("1.1", "USD")).minor).toBe(110);
    expect(unwrap(parseMoney("29.97", "USD")).minor).toBe(2997);
  });

  it("respects the currency exponent rather than assuming cents", () => {
    expect(unwrap(parseMoney("1000", "JPY")).minor).toBe(1000);
    expect(unwrap(parseMoney("1.234", "BHD")).minor).toBe(1234);
    expect(unwrap(parseMoney("1.2", "BHD")).minor).toBe(1200);
  });

  it("refuses excess scale at the exact boundary, per currency", () => {
    expect(parseMoney("1.00", "USD").ok).toBe(true);
    expect(parseMoney("1.005", "USD").ok).toBe(false);
    expect(parseMoney("1", "JPY").ok).toBe(true);
    expect(parseMoney("1.5", "JPY").ok).toBe(false);
    expect(parseMoney("1.234", "BHD").ok).toBe(true);
    expect(parseMoney("1.2345", "BHD").ok).toBe(false);
  });

  it("refuses everything that is not a plain decimal string", () => {
    for (const bad of [
      "1e3",
      "1E3",
      "1,000.00",
      " 1.00",
      "1.00 ",
      "",
      ".",
      "1.",
      ".5",
      "--1",
      "+1.00",
      "1 000",
      "NaN",
      "Infinity",
      "0x10",
      "１.００",
    ]) {
      expect(parseMoney(bad, "USD").ok).toBe(false);
    }
  });

  it("normalizes negative zero to zero", () => {
    const m = unwrap(parseMoney("-0.00", "USD"));
    expect(Object.is(m.minor, 0)).toBe(true);
  });

  it("accepts the largest safe amount and refuses the next one up", () => {
    // MAX_SAFE_INTEGER minor units, written as a USD decimal.
    expect(unwrap(parseMoney("90071992547409.91", "USD")).minor).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney("90071992547409.92", "USD").ok).toBe(false);
    expect(parseMoney("-90071992547409.91", "USD").ok).toBe(true);
    expect(parseMoney("-90071992547409.92", "USD").ok).toBe(false);
  });

  it("round-trips every generated permutation through the formatter", () => {
    for (const currency of ["USD", "JPY", "BHD"]) {
      for (const sign of ["", "-"]) {
        for (const whole of ["0", "7", "1234", "90071992547"]) {
          for (const frac of ["", "1", "12", "123", "1234"]) {
            const exp = minorDigits(currency);
            if (frac.length > exp) continue;
            const text = frac === "" ? `${sign}${whole}` : `${sign}${whole}.${frac}`;
            const parsed = parseMoney(text, currency);
            if (!parsed.ok) throw new Error(`unexpected refusal of ${text} ${currency}`);
            const again = unwrap(parseMoney(formatMoneyAmount(parsed.value), currency));
            expect(again.minor).toBe(parsed.value.minor);
            expect(again.currency).toBe(currency);
          }
        }
      }
    }
  });
});

describe("moneyFromMinor / moneyFromNumber", () => {
  it("refuses a non-integer or unsafe minor amount", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(moneyFromMinor(bad, "USD").ok).toBe(false);
    }
    expect(moneyFromMinor(Number.MAX_SAFE_INTEGER, "USD").ok).toBe(true);
  });

  it("takes a provider's JSON float only through the exact string form", () => {
    expect(unwrap(moneyFromNumber(1234.56, "USD")).minor).toBe(123456);
    expect(unwrap(moneyFromNumber(0, "USD")).minor).toBe(0);
    expect(moneyFromNumber(1.005, "USD").ok).toBe(false);
    expect(moneyFromNumber(Number.NaN, "USD").ok).toBe(false);
    // 1e21 stringifies to exponent notation, which the parser refuses rather than misread.
    expect(moneyFromNumber(1e21, "USD").ok).toBe(false);
  });
});

describe("formatMoneyAmount", () => {
  it("pads to the currency exponent and never localizes", () => {
    expect(formatMoneyAmount(usd(7))).toBe("0.07");
    expect(formatMoneyAmount(usd(0))).toBe("0.00");
    expect(formatMoneyAmount(usd(-5))).toBe("-0.05");
    expect(formatMoneyAmount(usd(123456))).toBe("1234.56");
    expect(formatMoneyAmount(jpy(1000))).toBe("1000");
    expect(formatMoneyAmount(unwrap(moneyFromMinor(1234, "BHD")))).toBe("1.234");
  });
});

describe("currencies never combine silently", () => {
  it("adds and subtracts within one currency", () => {
    expect(unwrap(addMoney(usd(100), usd(23))).minor).toBe(123);
    expect(unwrap(subMoney(usd(100), usd(123))).minor).toBe(-23);
    expect(negateMoney(usd(100)).minor).toBe(-100);
    expect(Object.is(negateMoney(usd(0)).minor, 0)).toBe(true);
  });

  it("refuses to add two different currencies", () => {
    expect(addMoney(usd(100), eur(100)).ok).toBe(false);
    expect(subMoney(usd(100), eur(100)).ok).toBe(false);
    expect(compareMoney(usd(100), eur(100)).ok).toBe(false);
  });

  it("refuses a sum whose result would leave safe integer range", () => {
    const big = usd(Number.MAX_SAFE_INTEGER);
    expect(addMoney(big, usd(1)).ok).toBe(false);
    expect(subMoney(negateMoney(big), usd(1)).ok).toBe(false);
    expect(sumMoney([big, usd(1)], "USD").ok).toBe(false);
  });

  it("refuses a mixed-currency sum instead of picking one", () => {
    expect(sumMoney([usd(100), jpy(100)], "USD").ok).toBe(false);
    expect(sumMoney([usd(100)], "EUR").ok).toBe(false);
  });

  it("sums an empty list only against an explicit currency", () => {
    expect(unwrap(sumMoney([], "USD"))).toEqual({ minor: 0, currency: "USD" });
    expect(sumMoney([], "nope").ok).toBe(false);
  });

  it("separates a mixed list rather than combining it", () => {
    const grouped = groupByCurrency([usd(100), eur(50), usd(1), jpy(9)]);
    expect([...grouped.keys()].sort()).toEqual(["EUR", "JPY", "USD"]);
    expect(unwrap(sumMoney(grouped.get("USD") ?? [], "USD")).minor).toBe(101);
    expect(unwrap(sumMoney(grouped.get("JPY") ?? [], "JPY")).minor).toBe(9);
  });

  it("orders within a currency", () => {
    expect(unwrap(compareMoney(usd(1), usd(2)))).toBe(-1);
    expect(unwrap(compareMoney(usd(2), usd(1)))).toBe(1);
    expect(unwrap(compareMoney(usd(2), usd(2)))).toBe(0);
  });

  it("knows a real zero", () => {
    expect(isZeroMoney(zeroMoney("USD"))).toBe(true);
    expect(isZeroMoney(usd(1))).toBe(false);
  });
});
