/**
 * The growth financial spine — LTGP:CAC and CFA. Pure port of Skills/growth-os/scripts/ltgp_cac.py
 * and cfa.py. Framework-agnostic (CLAUDE.md §1); every divisor is guarded so an unknown input
 * returns a null field, never an invented number (§4 / Pitfall 4).
 *
 * LTGP uses GROSS PROFIT per purchase (never revenue) — the whole point of the metric.
 */
export const FLOOR_RATIO = 3.0;
export const INDUSTRY_MULTIPLE = 3.0;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * LTGP:CAC health ratio + the master switch (business model vs advertising ceiling).
 * LTGP = grossProfitPerPurchase × purchases; CAC = acqSpend / customers; ratio = LTGP / CAC.
 * ratio >= FLOOR_RATIO (3) => scalable. Guards customers<=0 → null CAC/ratio (no divide-by-zero).
 */
export function ltgpCac(i: {
  grossProfitPerPurchase: number;
  purchases: number;
  acqSpend: number;
  customers: number;
  industryAvgCac?: number | null;
}): {
  ltgp: number;
  cac: number | null;
  ratio: number | null;
  scalable: boolean;
  ceiling: "business_model" | "advertising" | null;
} {
  const ltgp = round2(i.grossProfitPerPurchase * i.purchases);
  const cac = i.customers > 0 ? round2(i.acqSpend / i.customers) : null;
  const ratio = cac !== null && cac > 0 ? round2(ltgp / cac) : null;
  const scalable = ratio !== null && ratio >= FLOOR_RATIO;

  // Master switch: only meaningful with a valid CAC and a known industry average — else don't guess.
  let ceiling: "business_model" | "advertising" | null = null;
  if (i.industryAvgCac != null && i.industryAvgCac > 0 && cac !== null && cac > 0) {
    ceiling = cac > i.industryAvgCac * INDUSTRY_MULTIPLE ? "advertising" : "business_model";
  }

  return { ltgp, cac, ratio, scalable, ceiling };
}

/**
 * Client Financed Acquisition: does a customer's first-30-day gross profit exceed the cost to get
 * AND service them? ratio = thirtyDayCash / (cac + serviceCost). >=1 achieved; each whole ratio
 * above 1 funds another customer. Guards a non-positive denominator → not achieved, never NaN.
 */
export function cfa(i: { thirtyDayCash: number; cac: number; serviceCost: number }): {
  ratio: number;
  achieved: boolean;
  additionalCustomersFunded: number;
} {
  const totalCost = i.cac + i.serviceCost;
  if (totalCost <= 0) {
    // ponytail: no valid acquisition cost → conservatively "not funded", not a fabricated ratio.
    return { ratio: 0, achieved: false, additionalCustomersFunded: 0 };
  }
  const ratio = round2(i.thirtyDayCash / totalCost);
  const achieved = ratio >= 1;
  return { ratio, achieved, additionalCustomersFunded: achieved ? Math.floor(ratio) - 1 : 0 };
}
