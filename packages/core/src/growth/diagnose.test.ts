import { describe, expect, test } from "vitest";
import { diagnose, leverageRank } from "./diagnose";
import { emptyScorecard, type Scorecard } from "./scorecard";

/** A fully-healthy scorecard; each gate test dents ONE thing so exactly that gate fails. */
function healthy(): Scorecard {
  const sc = structuredClone(emptyScorecard);
  sc.identity.marketViable = true;
  sc.identity.currentOffers = ["Grand Slam Offer"];
  sc.identity.commodity = false;
  sc.offerCard.valueEquation = {
    dreamOutcome: 9,
    likelihood: 9,
    timeDelay: 8,
    effortSacrifice: 8,
  };
  sc.financials.cac = 100;
  sc.financials.ltgp = 400; // ratio 4 >= floor 3
  sc.financials.thirtyDayCashPerCustomer = 200; // >= cac
  sc.financials.industryAvgCac = 100; // threshold 300; cac 100 well under
  sc.modelCard.thirtyDayPayback = true;
  sc.modelCard.offerTypesPresent = {
    attraction: true,
    upsell: true,
    downsell: false,
    continuity: false,
  };
  sc.leadCard.coreFourActive = {
    warmOutreach: true,
    content: false,
    coldOutreach: false,
    paidAds: false,
  };
  return sc;
}

describe("diagnose — top-down gate router (stop at first failing gate)", () => {
  test("healthy scorecard → gate 'scale', no gap, no ask", () => {
    const rx = diagnose(healthy());
    expect(rx.gate).toBe("scale");
    expect(rx.ask).toBeUndefined();
    expect(rx.constraint).toMatch(/no failing gate/i);
  });

  test("Gate 0: market not viable → offer-architect/01-select-market", () => {
    const sc = healthy();
    sc.identity.marketViable = false;
    const rx = diagnose(sc);
    expect(rx.gate).toBe(0);
    expect(rx.route).toBe("offer-architect");
    expect(rx.playbook).toBe("01-select-market");
    expect(rx.ask).toBeUndefined();
  });

  test("Gate 1: no offer → offer-architect/02-build-offer", () => {
    const sc = healthy();
    sc.identity.currentOffers = [];
    const rx = diagnose(sc);
    expect(rx.gate).toBe(1);
    expect(rx.route).toBe("offer-architect");
    expect(rx.playbook).toBe("02-build-offer");
  });

  test("Gate 1: commodity offer → offer-architect/03-enhance-offer", () => {
    const sc = healthy();
    sc.identity.commodity = true;
    const rx = diagnose(sc);
    expect(rx.gate).toBe(1);
    expect(rx.playbook).toBe("03-enhance-offer");
  });

  test("Gate 1: weak value equation (min score <= 3) → offer-architect", () => {
    const sc = healthy();
    sc.offerCard.valueEquation.effortSacrifice = 2;
    const rx = diagnose(sc);
    expect(rx.gate).toBe(1);
    expect(rx.route).toBe("offer-architect");
  });

  test("Gate 2: 30-day payback fails → money-model-designer/01-assess-money-model", () => {
    const sc = healthy();
    sc.modelCard.thirtyDayPayback = false;
    const rx = diagnose(sc);
    expect(rx.gate).toBe(2);
    expect(rx.route).toBe("money-model-designer");
    expect(rx.playbook).toBe("01-assess-money-model");
  });

  test("Gate 2: 30-day cash < CAC → money-model-designer/06-assemble", () => {
    const sc = healthy();
    sc.financials.thirtyDayCashPerCustomer = 50; // < cac 100
    const rx = diagnose(sc);
    expect(rx.gate).toBe(2);
    expect(rx.playbook).toBe("06-assemble");
  });

  test("Gate 2: only one offer type → money-model-designer/06-assemble", () => {
    const sc = healthy();
    sc.modelCard.offerTypesPresent = {
      attraction: true,
      upsell: false,
      downsell: false,
      continuity: false,
    };
    const rx = diagnose(sc);
    expect(rx.gate).toBe(2);
    expect(rx.playbook).toBe("06-assemble");
  });

  test("Gate 2: LTGP:CAC below floor with CAC within industry norm → 01-assess-money-model", () => {
    const sc = healthy();
    sc.financials.ltgp = 200; // ratio 2 < 3, cac 100 <= 300
    const rx = diagnose(sc);
    expect(rx.gate).toBe(2);
    expect(rx.playbook).toBe("01-assess-money-model");
  });

  test("Gate 3: CAC > 3× industry avg → lead-engine/11-more-better-new", () => {
    const sc = healthy();
    sc.financials.cac = 400; // threshold 300
    sc.financials.ltgp = 2000; // keep ratio >= floor so gate 2 passes
    sc.financials.thirtyDayCashPerCustomer = 500; // >= cac so the tdc<cac gate 2 doesn't preempt
    const rx = diagnose(sc);
    expect(rx.gate).toBe(3);
    expect(rx.route).toBe("lead-engine");
    expect(rx.playbook).toBe("11-more-better-new");
  });

  test("Gate 3: no active lead channel → lead-engine/01-pick-channel", () => {
    const sc = healthy();
    sc.leadCard.coreFourActive = {
      warmOutreach: false,
      content: false,
      coldOutreach: false,
      paidAds: false,
    };
    const rx = diagnose(sc);
    expect(rx.gate).toBe(3);
    expect(rx.playbook).toBe("01-pick-channel");
  });

  // The eval fixture 31 shape, EXACTLY as the live engine can build it: no tenant profile is seeded
  // for an eval tenant and the seeded vault briefs carry no numbers, so the ONLY paths that fill this
  // scorecard are one grounded LTGP and `recordScorecardAnswer`. `healthy()` is far too rich to catch
  // this — it hands gate 2 four financial inputs AND two offer types. Run c1fe054c routed this case
  // to money-model-designer; with cac/tdc/payback/industryAvgCac all unfillable here, `offerTypeCount
  // <= 1` is the ONLY gate-2 branch that can fire, which is what the second assertion pins.
  test("fixture 31 shape: thin scorecard, two offer types, no channel → lead-engine/01-pick-channel", () => {
    const sc = structuredClone(emptyScorecard);
    sc.identity.currentOffers = ["done-for-you shipment onboarding package"];
    sc.financials.ltgp = 3200; // the one grounded figure; cac/tdc/payback stay null
    sc.modelCard.offerTypesPresent.attraction = true;
    sc.modelCard.offerTypesPresent.continuity = true;
    // coreFourActive is already all-false in emptyScorecard — gate 3 needs NO recording.
    const rx = diagnose(sc);
    expect(rx.gate).toBe(3);
    expect(rx.route).toBe("lead-engine");
    expect(rx.playbook).toBe("01-pick-channel");

    // Drop ONE offer type and gate 2 preempts — the measured c1fe054c misroute, reproduced offline.
    sc.modelCard.offerTypesPresent.continuity = false;
    expect(diagnose(sc).route).toBe("money-model-designer");
  });

  test("CONSERVATIVE: null financials at the money-model gate → ASK, never a route or metric", () => {
    const sc = healthy();
    sc.financials.cac = null;
    sc.financials.ltgp = null;
    sc.financials.thirtyDayCashPerCustomer = null;
    sc.modelCard.thirtyDayPayback = null;
    const rx = diagnose(sc);
    expect(rx.gate).toBe(2);
    expect(rx.ask).toBeTruthy();
    expect(rx.route).toBe(""); // no route
    expect(rx.proofMetric).toBe(""); // no fabricated metric
  });
});

describe("leverageRank — fix the ONE bottleneck first (gate order)", () => {
  test("sorts by gate 0 < 1 < 2 < 3 < scale", () => {
    const mk = (gate: 0 | 1 | 2 | 3 | "scale") => ({
      constraint: "",
      gate,
      // `as const`: Prescription.route is closed to SpecialistRoute | "" (15-02), and a bare ""
      // in an un-annotated helper widens to `string` — which no longer satisfies the type.
      route: "" as const,
      playbook: "",
      reason: "",
      proofMetric: "",
      roadmapLevel: null,
    });
    const ranked = leverageRank([mk(3), mk("scale"), mk(0), mk(2), mk(1)]);
    expect(ranked.map((r) => r.gate)).toEqual([0, 1, 2, 3, "scale"]);
  });
});
