/**
 * Business Scorecard — the pure-TS mirror of Skills/growth-os/assets/business-scorecard.template.json.
 *
 * Every leaf is `T | null`. Nullable is load-bearing: a null means "not enough data" (a nudge to
 * ask), NEVER a fabricated value (CLAUDE.md §4 / RESEARCH Pitfall 4). `diagnose()` reads this shape
 * and, when a decisive financial input is null, ASKS rather than routing on a guessed number.
 *
 * Boolean "presence" maps (offerTypesPresent, coreFourActive, enhancers, leadGettersActive) default
 * to `false` = known-absent in the template — they are checklists, not unknowns.
 */
export type ValueEquation = {
  dreamOutcome: number | null;
  likelihood: number | null;
  timeDelay: number | null;
  effortSacrifice: number | null;
};

export type Scorecard = {
  schemaVersion: string | null;
  businessName: string | null;
  updatedAt: string | null;
  identity: {
    market: string | null;
    eternalMarket: string | null;
    niche: string | null;
    avatar: string | null;
    currentOffers: string[];
    headlinePrice: number | null;
    /** Gate 0 signal: does the market pass the 4 indicators (pain, power, targetable, growing)? */
    marketViable: boolean | null;
    /** Gate 1 signal: is the offer perceived as an interchangeable commodity? */
    commodity: boolean | null;
  };
  financials: {
    ltgp: number | null;
    cac: number | null;
    ltgpCacRatio: number | null;
    industryAvgCac: number | null;
    thirtyDayCashPerCustomer: number | null;
    costToServicePerCustomer: number | null;
    grossMarginPct: number | null;
    refundPct: number | null;
    churnByCadence: { monthly: number | null; quarterly: number | null; annual: number | null };
  };
  position: {
    roadmapLevel: number | null;
    currentConstraint: string | null;
    funnel: string[];
  };
  offerCard: {
    valueEquation: ValueEquation;
    enhancers: {
      scarcity: boolean;
      urgency: boolean;
      bonuses: boolean;
      guarantee: boolean;
      named: boolean;
    };
    guarantee: string | null;
    offerName: string | null;
  };
  modelCard: {
    offerTypesPresent: {
      attraction: boolean;
      upsell: boolean;
      downsell: boolean;
      continuity: boolean;
    };
    thirtyDayPayback: boolean | null;
    continuityTakePct: number | null;
  };
  leadCard: {
    coreFourActive: {
      warmOutreach: boolean;
      content: boolean;
      coldOutreach: boolean;
      paidAds: boolean;
    };
    ruleOf100Active: boolean;
    leadGettersActive: {
      customers: boolean;
      employees: boolean;
      agencies: boolean;
      affiliates: boolean;
    };
    primaryConstraintStep: string | null;
  };
  history: unknown[];
};

/** The template's all-null default. A fresh scorecard knows nothing — and says so. */
export const emptyScorecard: Scorecard = {
  schemaVersion: "1.0",
  businessName: null,
  updatedAt: null,
  identity: {
    market: null,
    eternalMarket: null,
    niche: null,
    avatar: null,
    currentOffers: [],
    headlinePrice: null,
    marketViable: null,
    commodity: null,
  },
  financials: {
    ltgp: null,
    cac: null,
    ltgpCacRatio: null,
    industryAvgCac: null,
    thirtyDayCashPerCustomer: null,
    costToServicePerCustomer: null,
    grossMarginPct: null,
    refundPct: null,
    churnByCadence: { monthly: null, quarterly: null, annual: null },
  },
  position: { roadmapLevel: null, currentConstraint: null, funnel: [] },
  offerCard: {
    valueEquation: { dreamOutcome: null, likelihood: null, timeDelay: null, effortSacrifice: null },
    enhancers: { scarcity: false, urgency: false, bonuses: false, guarantee: false, named: false },
    guarantee: null,
    offerName: null,
  },
  modelCard: {
    offerTypesPresent: { attraction: false, upsell: false, downsell: false, continuity: false },
    thirtyDayPayback: null,
    continuityTakePct: null,
  },
  leadCard: {
    coreFourActive: { warmOutreach: false, content: false, coldOutreach: false, paidAds: false },
    ruleOf100Active: false,
    leadGettersActive: { customers: false, employees: false, agencies: false, affiliates: false },
    primaryConstraintStep: null,
  },
  history: [],
};
