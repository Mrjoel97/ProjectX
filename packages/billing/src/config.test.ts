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

  test("every value that has LANDED is format-checked, whether or not the rest have", () => {
    // WIDENED 2026-08-29 from all-or-nothing to per-field. The owner answered exactly one of the
    // five Dashboard questions (bank transfer) and deferred the other four, and the binary form
    // could not express that: it demanded all five be null, so a single true answer read as red.
    //
    // The intent it protected is UNCHANGED and is what these per-field guards enforce — a value
    // that lands is format-checked the moment it lands, so nothing escapes by arriving early.
    // That was the actual hazard; "landing together" never was.
    if (STRIPE_API_VERSION !== null) {
      expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.[a-z]+)?$/);
    }
    if (PRODUCT_TAX_CODE !== null) {
      expect(PRODUCT_TAX_CODE).toMatch(/^txcd_\d+$/);
    }
    if (HEAD_OFFICE_COUNTRY !== null) {
      expect(HEAD_OFFICE_COUNTRY).toMatch(/^[A-Z]{2}$/);
    }
    if (BANK_TRANSFER_ENABLED !== null) {
      expect(typeof BANK_TRANSFER_ENABLED).toBe("boolean");
    }
    if (TRIAL_DAYS !== null) {
      expect(Number.isInteger(TRIAL_DAYS)).toBe(true);
      expect(TRIAL_DAYS).toBeGreaterThanOrEqual(0);
    }
  });

  test("CONFIG_CONFIRMED is the claim that ALL FIVE landed — it cannot be flipped early", () => {
    // The flag stays explicit rather than derived, but its meaning is now precise: it asserts
    // completeness, not format. Format is guarded per-field above, unconditionally.
    if (!CONFIG_CONFIRMED) return;
    for (const [name, value] of Object.entries({
      STRIPE_API_VERSION,
      PRODUCT_TAX_CODE,
      HEAD_OFFICE_COUNTRY,
      BANK_TRANSFER_ENABLED,
      TRIAL_DAYS,
    })) {
      expect(value, `${name} is still null but CONFIG_CONFIRMED is true`).not.toBeNull();
    }
  });
});
