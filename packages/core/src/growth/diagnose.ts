/**
 * Diagnose a Business Scorecard and route to the single highest-leverage constraint. Pure port of
 * Skills/growth-os/scripts/diagnose.py: work top-down (Market → Offer → Money Model → Leads), STOP
 * at the first failing gate, emit ONE prescription (CLAUDE.md §1, Convex-free).
 *
 * Deliberately conservative (§4 / RESEARCH Pitfall 4): when the money-model gate's financial inputs
 * are all null there is no basis to route OR to declare health, so it ASKS (naming the missing
 * figure) instead of fabricating a metric or a false "scale" verdict.
 */
import type { SpecialistRoute } from "../specialists";
import { FLOOR_RATIO, INDUSTRY_MULTIPLE } from "./financialSpine";
import type { Scorecard } from "./scorecard";

export type Prescription = {
  constraint: string;
  gate: 0 | 1 | 2 | 3 | "scale";
  /**
   * Closed to the dispatchable specialists (DISP-01). `""` stays representable ON PURPOSE — the
   * not-enough-data ask branch below emits it deliberately, and `resolveSpecialist("")` refuses it
   * at runtime rather than routing on a guess. Dependency direction is growth/ → specialists,
   * never the reverse.
   */
  route: SpecialistRoute | "";
  playbook: string;
  reason: string;
  proofMetric: string;
  roadmapLevel: number | null;
  /** Set => "not enough data, ask for this"; NEVER accompanied by a route or a fabricated metric. */
  ask?: string;
};

export function diagnose(sc: Scorecard): Prescription {
  const level = sc.position.roadmapLevel;
  const rx = (
    gate: Prescription["gate"],
    constraint: string,
    // Every rx() gate routes somewhere; only the ask branch below (which builds its object
    // literal directly) emits "". Narrower than Prescription["route"] on purpose.
    route: SpecialistRoute,
    playbook: string,
    reason: string,
    proofMetric: string,
  ): Prescription => ({ constraint, gate, route, playbook, reason, proofMetric, roadmapLevel: level });

  // --- Gate 0: Market (a great offer to the wrong crowd falls on deaf ears) ---
  if (sc.identity.marketViable === false) {
    return rx(
      0,
      "Market is not viable (no pain / no money / shrinking).",
      "offer-architect",
      "01-select-market",
      "A great offer to the wrong crowd falls on deaf ears. Fix the market/niche first.",
      "market passes the 4 indicators (pain, power, targetable, growing)",
    );
  }

  // --- Gate 1: Offer ---
  const hasOffer = sc.identity.currentOffers.length > 0;
  const veScores = Object.values(sc.offerCard.valueEquation).filter(
    (v): v is number => typeof v === "number",
  );
  const weakOffer = veScores.length > 0 && Math.min(...veScores) <= 3;
  if (!hasOffer) {
    return rx(
      1,
      "No offer worth buying yet.",
      "offer-architect",
      "02-build-offer",
      "Nothing downstream matters without a differentiated offer.",
      "a stacked Grand Slam Offer exists with value >> price",
    );
  }
  if (sc.identity.commodity === true || weakOffer) {
    return rx(
      1,
      "Offer is a commodity / perceived value too low.",
      "offer-architect",
      "03-enhance-offer",
      "Buyers compare on price because value isn't differentiated. Raise value before spend.",
      "value-equation scores raised; conversion or price up",
    );
  }

  // --- Gate 2: Money Model ---
  const { thirtyDayPayback: payback } = sc.modelCard;
  const { cac, ltgp, thirtyDayCashPerCustomer: tdc, industryAvgCac: iac } = sc.financials;

  // Conservative: no financial signal at all → ask, never guess a route/metric or a false "scale".
  if (payback == null && tdc == null && cac == null && ltgp == null) {
    return {
      constraint: "Not enough financial data to diagnose the money model.",
      gate: 2,
      route: "",
      playbook: "",
      reason:
        "Vault-first, then ask: without CAC, LTGP, 30-day cash, or payback there is no basis to route or to declare the business healthy.",
      proofMetric: "",
      roadmapLevel: level,
      ask: "Provide 30-day cash per customer, CAC, LTGP, and whether acquisition cost is recovered within 30 days.",
    };
  }

  const offerTypeCount = Object.values(sc.modelCard.offerTypesPresent).filter(Boolean).length;
  const ratio = ltgp && cac ? Math.round((ltgp / cac) * 100) / 100 : null;

  if (payback === false) {
    return rx(
      2,
      "30-day payback fails — cash is trapped.",
      "money-model-designer",
      "01-assess-money-model",
      "Acquisition cost isn't recovered in 30 days, so the business can't self-fund growth.",
      "30-day cash >= cost to get+service a customer (CFA achieved)",
    );
  }
  if (tdc != null && cac != null && tdc < cac) {
    return rx(
      2,
      "Customer doesn't pay for themselves in 30 days.",
      "money-model-designer",
      "06-assemble",
      "Pull cash forward with an upsell/downsell/continuity sequence.",
      "30-day cash >= CAC",
    );
  }
  if (offerTypeCount <= 1) {
    return rx(
      2,
      "Only one thing to sell — no upsell/downsell/continuity.",
      "money-model-designer",
      "06-assemble",
      "A sequence of offers multiplies 30-day cash from the same customers.",
      "attraction + upsell + downsell + continuity all present",
    );
  }
  if (ratio != null && ratio < FLOOR_RATIO && iac && cac && cac <= iac * INDUSTRY_MULTIPLE) {
    return rx(
      2,
      `LTGP:CAC ${ratio}:1 is below floor because LTGP is low.`,
      "money-model-designer",
      "01-assess-money-model",
      "CAC is within industry norms, so the ceiling is monetization — raise LTGP.",
      `LTGP:CAC >= ${FLOOR_RATIO}:1`,
    );
  }

  // --- Gate 3: Leads ---
  if (iac && cac && cac > iac * INDUSTRY_MULTIPLE) {
    return rx(
      3,
      `CAC (${cac}) exceeds 3x industry average (${iac}).`,
      "lead-engine",
      "11-more-better-new",
      "Advertising is inefficient — find the funnel constraint and test one thing per week.",
      "CAC falls below 3x industry average",
    );
  }
  const activeChannels = Object.values(sc.leadCard.coreFourActive).filter(Boolean).length;
  if (activeChannels === 0) {
    return rx(
      3,
      "No lead channel is running.",
      "lead-engine",
      "01-pick-channel",
      "Offer and money model are sound; the constraint is that too few people know.",
      ">= 1 Core Four channel running at Rule-of-100 volume",
    );
  }

  // --- Nothing failed: scale ---
  return rx(
    "scale",
    "No failing gate — offer, money model, and leads are healthy.",
    "lead-engine",
    "11-more-better-new",
    "Compound the working channels (More/Better/New) and add Lead Getters.",
    "lead volume and LTGP:CAC both climbing",
  );
}

const gateOrder = (g: Prescription["gate"]): number => (g === "scale" ? 4 : g);

/** Order prescriptions by gate (Market<Offer<Money<Leads<Scale) — fix the ONE bottleneck first. */
export function leverageRank(scs: Prescription[]): Prescription[] {
  return [...scs].sort((a, b) => gateOrder(a.gate) - gateOrder(b.gate));
}
