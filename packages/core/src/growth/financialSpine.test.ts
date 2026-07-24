import { describe, expect, test } from "vitest";
import { cfa, ltgpCac } from "./financialSpine";

describe("ltgpCac (Growth OS worked example — gross profit, never revenue)", () => {
  test("worked example: GP 150 × 30 purchases → LTGP 4500; 3000/20 → CAC 150; ratio 30; scalable", () => {
    const r = ltgpCac({
      grossProfitPerPurchase: 150,
      purchases: 30,
      acqSpend: 3000,
      customers: 20,
    });
    expect(r.ltgp).toBe(4500);
    expect(r.cac).toBe(150);
    expect(r.ratio).toBe(30);
    expect(r.scalable).toBe(true);
    expect(r.ceiling).toBeNull(); // no industry avg given → don't guess the master switch
  });

  test("below floor is not scalable (ratio 2 < 3)", () => {
    const r = ltgpCac({ grossProfitPerPurchase: 100, purchases: 2, acqSpend: 100, customers: 1 });
    expect(r.ratio).toBe(2);
    expect(r.scalable).toBe(false);
  });

  test("master switch: CAC within 3× industry avg → ceiling business_model (raise LTGP)", () => {
    const r = ltgpCac({
      grossProfitPerPurchase: 100,
      purchases: 1,
      acqSpend: 400,
      customers: 1,
      industryAvgCac: 200, // threshold 600; CAC 400 <= 600
    });
    expect(r.cac).toBe(400);
    expect(r.ceiling).toBe("business_model");
  });

  test("master switch: CAC above 3× industry avg → ceiling advertising (lower CAC)", () => {
    const r = ltgpCac({
      grossProfitPerPurchase: 100,
      purchases: 1,
      acqSpend: 700,
      customers: 1,
      industryAvgCac: 200, // threshold 600; CAC 700 > 600
    });
    expect(r.cac).toBe(700);
    expect(r.ceiling).toBe("advertising");
  });

  test("guard: customers <= 0 → null CAC / null ratio, never a divide-by-zero fabrication", () => {
    const r = ltgpCac({ grossProfitPerPurchase: 150, purchases: 30, acqSpend: 3000, customers: 0 });
    expect(r.ltgp).toBe(4500);
    expect(r.cac).toBeNull();
    expect(r.ratio).toBeNull();
    expect(r.scalable).toBe(false);
    expect(r.ceiling).toBeNull();
  });
});

describe("cfa (Client Financed Acquisition — the 30-day self-funding test)", () => {
  test("boundary: ratio exactly 1 → achieved, 0 additional customers funded", () => {
    const r = cfa({ thirtyDayCash: 30, cac: 30, serviceCost: 0 });
    expect(r.ratio).toBe(1);
    expect(r.achieved).toBe(true);
    expect(r.additionalCustomersFunded).toBe(0);
  });

  test("boundary: ratio exactly 2 → achieved, funds exactly 1 more customer", () => {
    const r = cfa({ thirtyDayCash: 60, cac: 30, serviceCost: 0 });
    expect(r.ratio).toBe(2);
    expect(r.achieved).toBe(true);
    expect(r.additionalCustomersFunded).toBe(1);
  });

  test("service cost counts against the ratio (cac + serviceCost is the denominator)", () => {
    const r = cfa({ thirtyDayCash: 30, cac: 20, serviceCost: 10 });
    expect(r.ratio).toBe(1);
    expect(r.achieved).toBe(true);
  });

  test("below 1 → not achieved, 0 funded (cash is trapped)", () => {
    const r = cfa({ thirtyDayCash: 10, cac: 30, serviceCost: 0 });
    expect(r.ratio).toBeCloseTo(0.33, 2);
    expect(r.achieved).toBe(false);
    expect(r.additionalCustomersFunded).toBe(0);
  });

  test("guard: (cac + serviceCost) <= 0 → not achieved, no NaN", () => {
    const r = cfa({ thirtyDayCash: 100, cac: 0, serviceCost: 0 });
    expect(Number.isNaN(r.ratio)).toBe(false);
    expect(r.achieved).toBe(false);
    expect(r.additionalCustomersFunded).toBe(0);
  });
});
