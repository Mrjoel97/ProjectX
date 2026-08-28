import { describe, expect, test } from "vitest";
import {
  BANK_TRANSFER_ENABLED,
  CONFIG_CONFIRMED,
  HEAD_OFFICE_COUNTRY,
  NONTAXABLE_TAX_CODE,
  PRODUCT_TAX_CODE,
  STRIPE_API_BASE,
  STRIPE_API_VERSION,
  TRIAL_DAYS,
} from "./config";

describe("the Dashboard configuration mirrored in code", () => {
  test("NONTAXABLE_TAX_CODE is Stripe's real Nontaxable id", () => {
    // Written out, not imported from itself: this constant is only useful if it is the id Stripe
    // actually returns. An edit to a plausible-looking but wrong code would otherwise pass every
    // test below while making the whole `not_collecting` discrimination meaningless.
    expect(NONTAXABLE_TAX_CODE).toBe("txcd_00000000");
  });

  test("PRODUCT_TAX_CODE is NEVER the Nontaxable code", () => {
    // The one rule this plan is certain of, and it holds in BOTH states — before the owner answers
    // (null) and after. Asserted against the WRITTEN-OUT literal as well as the constant, so that
    // renaming or re-pointing `NONTAXABLE_TAX_CODE` cannot make this test pass vacuously.
    expect(PRODUCT_TAX_CODE).not.toBe("txcd_00000000");
    expect(PRODUCT_TAX_CODE).not.toBe(NONTAXABLE_TAX_CODE);
  });

  test("STRIPE_API_BASE is Stripe's origin with no trailing slash", () => {
    expect(STRIPE_API_BASE).toBe("https://api.stripe.com");
    expect(STRIPE_API_BASE.endsWith("/")).toBe(false);
  });

  test("the config is either wholly pending or wholly landed — never half", () => {
    if (!CONFIG_CONFIRMED) {
      // A value that lands while the flag stays false would escape every format guard below.
      expect({
        STRIPE_API_VERSION,
        PRODUCT_TAX_CODE,
        HEAD_OFFICE_COUNTRY,
        BANK_TRANSFER_ENABLED,
        TRIAL_DAYS,
      }).toEqual({
        STRIPE_API_VERSION: null,
        PRODUCT_TAX_CODE: null,
        HEAD_OFFICE_COUNTRY: null,
        BANK_TRANSFER_ENABLED: null,
        TRIAL_DAYS: null,
      });
      return;
    }

    // Confirmed: every value must be well formed, because from here the rest of the phase reads
    // them without re-checking.
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.[a-z]+)?$/);
    expect(PRODUCT_TAX_CODE).toMatch(/^txcd_\d+$/);
    expect(HEAD_OFFICE_COUNTRY).toMatch(/^[A-Z]{2}$/);
    expect(typeof BANK_TRANSFER_ENABLED).toBe("boolean");
    expect(typeof TRIAL_DAYS).toBe("number");
    expect(Number.isInteger(TRIAL_DAYS)).toBe(true);
    expect(TRIAL_DAYS as number).toBeGreaterThanOrEqual(0);
  });
});
