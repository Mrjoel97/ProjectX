import { describe, expect, test } from "vitest";
import { NONTAXABLE_TAX_CODE, PRODUCT_TAX_CODE, STRIPE_API_VERSION } from "./config";
import {
  INVOICE_TAX_FIELD,
  invoiceTaxabilityReason,
  renderTaxPosture,
  TAXABILITY_REASONS,
  taxPosture,
} from "./tax";

/** A real SaaS-shaped code. NOT read from config: `PRODUCT_TAX_CODE` is still `null`, and a test
 *  that reads its subject from a value the owner can change tomorrow proves nothing today. */
const REAL_CODE = "txcd_10103001";

describe("taxPosture — the not_collecting ambiguity, both halves", () => {
  test("not_collecting + a REAL product tax code = not owed because unregistered", () => {
    expect(taxPosture("not_collecting", REAL_CODE, 0)).toEqual({
      state: "not-owed",
      because: "unregistered",
    });
  });

  // The literal, written out. Renaming `NONTAXABLE_TAX_CODE` (or repointing it) cannot fake this.
  test("not_collecting + txcd_00000000 = a DIFFERENT claim: we declared it nontaxable", () => {
    expect(taxPosture("not_collecting", "txcd_00000000", 0)).toEqual({
      state: "not-owed",
      because: "declared-nontaxable",
    });
  });

  test("the constant and the literal are the same string", () => {
    expect(NONTAXABLE_TAX_CODE).toBe("txcd_00000000");
  });

  // The disambiguator is MISSING. Guessing "unregistered" here would assert a registration gap we
  // have no evidence for. Missing history is unknown, never zero.
  test("not_collecting + an unconfigured (null) product tax code = unknown, never not-owed", () => {
    expect(taxPosture("not_collecting", null, 0)).toEqual({
      state: "unknown",
      reason: "not-collecting-without-product-tax-code",
    });
  });

  test("not_collecting + an empty-string product tax code is also unknown", () => {
    expect(taxPosture("not_collecting", "", 0)).toEqual({
      state: "unknown",
      reason: "not-collecting-without-product-tax-code",
    });
  });
});

describe("taxPosture — calculated zero is a different statement from not owed", () => {
  test.each([
    "zero_rated",
    "not_subject_to_tax",
    "reverse_charge",
    "customer_exempt",
    "product_exempt",
    "not_supported",
    "product_exempt_holiday",
    "portion_product_exempt",
    "standard_rated",
  ])("%s with a zero amount is a CALCULATED zero carrying its reason", (reason) => {
    expect(taxPosture(reason, REAL_CODE, 0)).toEqual({ state: "calculated-zero", reason });
  });

  test("every taxability_reason Stripe publishes has an asserted posture", () => {
    // The literal table from Stripe's "Zero tax amounts and reverse charges" page.
    expect([...TAXABILITY_REASONS]).toEqual([
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
    ]);
    for (const reason of TAXABILITY_REASONS) {
      expect(taxPosture(reason, REAL_CODE, 0).state).not.toBe("unknown");
    }
  });

  test("the product tax code does NOT change a calculated zero — only not_collecting is ambiguous", () => {
    expect(taxPosture("zero_rated", NONTAXABLE_TAX_CODE, 0)).toEqual({
      state: "calculated-zero",
      reason: "zero_rated",
    });
    expect(taxPosture("zero_rated", null, 0)).toEqual({
      state: "calculated-zero",
      reason: "zero_rated",
    });
  });
});

describe("taxPosture — a number beats a reason", () => {
  test("a positive amount is collected", () => {
    expect(taxPosture("standard_rated", REAL_CODE, 1250)).toEqual({
      state: "collected",
      minor: 1250,
    });
  });

  test.each([
    "not_collecting",
    "zero_rated",
    "not_subject_to_tax",
    "",
    "nonsense",
  ])("a positive amount wins over reason %s — a non-zero number is never 'not owed'", (reason) => {
    expect(taxPosture(reason, NONTAXABLE_TAX_CODE, 1)).toEqual({
      state: "collected",
      minor: 1,
    });
  });

  test("a negative or non-integer tax amount is unknown, never collected and never zero", () => {
    for (const bad of [-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(taxPosture("standard_rated", REAL_CODE, bad)).toEqual({
        state: "unknown",
        reason: "invalid-tax-amount",
      });
    }
  });
});

describe("taxPosture — unknown is not zero", () => {
  test.each([
    null,
    undefined,
    "",
    "made_up_reason",
    "NOT_COLLECTING",
  ])("an absent or unrecognised reason %s with a zero amount is explicitly unknown", (reason) => {
    expect(taxPosture(reason, REAL_CODE, 0)).toEqual({
      state: "unknown",
      reason: "unrecognised-taxability-reason",
    });
  });
});

describe("renderTaxPosture — what a human actually reads (BILL-05)", () => {
  const render = (r: string | null, code: string | null, minor: number) =>
    renderTaxPosture(taxPosture(r, code, minor), "usd");

  test("not owed / unregistered says 'not owed' and never shows 0.00", () => {
    const s = render("not_collecting", REAL_CODE, 0);
    expect(s.toLowerCase()).toContain("not owed");
    expect(s).not.toContain("0.00");
    expect(s.toLowerCase()).toContain("registration");
  });

  test("not owed / declared-nontaxable reads as OUR declaration, not a registration gap", () => {
    const s = render("not_collecting", NONTAXABLE_TAX_CODE, 0);
    expect(s.toLowerCase()).toContain("not owed");
    expect(s.toLowerCase()).toContain("nontaxable");
    expect(s.toLowerCase()).not.toContain("registration");
    expect(s).not.toContain("0.00");
  });

  test("the two not-owed halves never render the same sentence", () => {
    expect(render("not_collecting", REAL_CODE, 0)).not.toBe(
      render("not_collecting", NONTAXABLE_TAX_CODE, 0),
    );
  });

  test("calculated zero says the tax was CALCULATED as zero and names the reason", () => {
    const s = render("zero_rated", REAL_CODE, 0);
    expect(s.toLowerCase()).toContain("calculated");
    expect(s.toLowerCase()).toContain("zero");
    expect(s).toContain("zero_rated");
    expect(s.toLowerCase()).not.toContain("not owed");
  });

  test("unknown never renders as zero and never claims a calculation", () => {
    const s = render(null, REAL_CODE, 0);
    expect(s.toLowerCase()).toContain("unknown");
    expect(s).not.toContain("0.00");
    expect(s.toLowerCase()).not.toContain("not owed");
    expect(s.toLowerCase()).not.toContain("calculated as zero");
  });

  // The defect class: a backend fix that never reaches the rendered string. NO zero posture may
  // ever produce a bare amount — the reason travels with the number or there is no number.
  test("NO zero-tax posture renders a bare 0.00 anywhere", () => {
    for (const reason of [...TAXABILITY_REASONS, null, "made_up"]) {
      for (const code of [REAL_CODE, NONTAXABLE_TAX_CODE, null]) {
        expect(renderTaxPosture(taxPosture(reason, code, 0), "usd")).not.toContain("0.00");
      }
    }
  });

  test("a collected amount renders as exact currency, never a float artefact", () => {
    expect(renderTaxPosture({ state: "collected", minor: 1250 }, "usd")).toContain("12.50 USD");
    expect(renderTaxPosture({ state: "collected", minor: 1 }, "jpy")).toContain("1 JPY");
  });

  test("a collected amount in an unusable currency says so rather than inventing one", () => {
    expect(
      renderTaxPosture({ state: "collected", minor: 1250 }, "dollars").toLowerCase(),
    ).toContain("unrecognised currency");
  });

  // Whatever the owner has (or has not) configured today, this line can never lie.
  test("the LIVE PRODUCT_TAX_CODE never produces a calculated-zero claim on not_collecting", () => {
    const s = renderTaxPosture(taxPosture("not_collecting", PRODUCT_TAX_CODE, 0), "usd");
    expect(s).not.toContain("0.00");
    expect(s.toLowerCase()).not.toContain("calculated as zero");
  });
});

describe("invoiceTaxabilityReason — read against the version we PIN", () => {
  /**
   * THE VERSION AND THE FIELD NAME, pinned side by side as WRITTEN-OUT LITERALS.
   *
   * The invoice tax breakdown is `total_tax_amounts[]` before `2025-03-31.basil` and `total_taxes[]`
   * from Basil onward. A comment cannot make a version bump visible; this can. Changing
   * `STRIPE_API_VERSION` without re-reading the field shape turns this RED, which is the entire
   * point — the alternative failure is a silent `null` on every invoice.
   */
  test("the pinned API version is Basil-or-later, so the field is total_taxes", () => {
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
    expect(INVOICE_TAX_FIELD).toBe("total_taxes");
    // Stripe's version strings sort lexicographically by their leading ISO date.
    expect(String(STRIPE_API_VERSION) > "2025-03-31.basil").toBe(true);
  });

  test("the pre-Basil field is NOT read — a version downgrade must be an edit, not a silent null", () => {
    expect(
      invoiceTaxabilityReason({ total_tax_amounts: [{ taxability_reason: "standard_rated" }] }),
    ).toBeNull();
  });

  test("one entry with a published reason is that reason", () => {
    expect(
      invoiceTaxabilityReason({ total_taxes: [{ taxability_reason: "reverse_charge" }] }),
    ).toBe("reverse_charge");
  });

  test("several entries that AGREE are still one reason", () => {
    expect(
      invoiceTaxabilityReason({
        total_taxes: [{ taxability_reason: "zero_rated" }, { taxability_reason: "zero_rated" }],
      }),
    ).toBe("zero_rated");
  });

  // Storing the first would print a confident sentence about the wrong half of the invoice.
  test("entries that DISAGREE are null — there is no single reason to claim", () => {
    expect(
      invoiceTaxabilityReason({
        total_taxes: [
          { taxability_reason: "standard_rated" },
          { taxability_reason: "reverse_charge" },
        ],
      }),
    ).toBeNull();
  });

  test("a reason Stripe has not published, and prose, are both null", () => {
    expect(invoiceTaxabilityReason({ total_taxes: [{ taxability_reason: "vibes" }] })).toBeNull();
    expect(
      invoiceTaxabilityReason({ total_taxes: [{ taxability_reason: "because Acme said so" }] }),
    ).toBeNull();
    expect(invoiceTaxabilityReason({ total_taxes: [{ taxability_reason: 7 }] })).toBeNull();
  });

  test("no tax breakdown at all is null, and never a throw", () => {
    expect(invoiceTaxabilityReason({})).toBeNull();
    expect(invoiceTaxabilityReason(null)).toBeNull();
    expect(invoiceTaxabilityReason(undefined)).toBeNull();
    expect(invoiceTaxabilityReason("not an object")).toBeNull();
    expect(invoiceTaxabilityReason({ total_taxes: [] })).toBeNull();
    expect(invoiceTaxabilityReason({ total_taxes: "nope" })).toBeNull();
  });

  // Non-vacuity: every published reason survives the round trip, so the guard is not just "null".
  test("every published reason is readable", () => {
    for (const reason of TAXABILITY_REASONS) {
      expect(invoiceTaxabilityReason({ total_taxes: [{ taxability_reason: reason }] })).toBe(
        reason,
      );
    }
  });
});
