/**
 * CASH — the PURE half of the business-finance plane (CLAUDE.md §1).
 *
 * The Cost console answers *what is Pikar spending*. This module answers *is the business using
 * Pikar viable*. `convex/cash.ts` owns storage and tenant scoping; everything decidable without a
 * database lives here — the role `spend.ts` plays for Cost.
 *
 * TWO PLANES, mirroring that split so one mental model serves the whole page:
 *   • UNIT ECONOMICS — does each customer pay for itself? (the Hormozi spine: CFA, LTGP:CAC)
 *   • SOLVENCY — how long does the business survive? (the finance-ops layer: runway, burn, MRR/ARR,
 *     working capital). This layer is deliberately OUTSIDE the Hormozi framework and is marked as
 *     such wherever it is rendered. It earns its place because it is the survival metric for funded
 *     businesses, whom the books explicitly exclude.
 *
 * UNITS. Everything here is USD **dollars** as a plain number, matching `scorecard.financials.cac`.
 * The Pikar-spend plane uses integer **cents** (`DashboardMoney`). They never meet in one formula.
 *
 * THE ARITHMETIC IS NOT REIMPLEMENTED. `growth/financialSpine.ts` already ports LTGP:CAC and CFA
 * from the source material, with the divide-by-zero guards. This module adds what a *screen* needs
 * on top: which truth a figure is in, where it came from, whether it is stale, and which set of
 * metrics this tenant should see at all.
 */

import type { RevenueStage, Tier } from "./businessProfile";
import { cfa, INDUSTRY_MULTIPLE, ltgpCac, round2 } from "./growth/financialSpine";
import type { Scorecard } from "./growth/scorecard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A `stated` input this old asks for a confirm-or-update. Outputs are only readable when their
 *  inputs are consistent, and a stale number silently poisoning a ratio is that failure. */
export const STALE_AFTER_MS = 90 * DAY_MS;

/** What a number MEANS, so a renderer never has to guess a suffix. */
export type CashUnit = "usd" | "ratio" | "months" | "percent" | "count" | "perDay";

/** Where a known figure came from. The blueprint code's vocabulary, reused verbatim. */
export type CashOrigin = "observed" | "stated" | "derived";

/**
 * ONE figure, in exactly one of FOUR states. Three of them are the spec's three truths; the fourth
 * exists because a real, recorded input can still make the arithmetic undefined.
 *
 *   • `unknown`         — never asked, or unanswered. Names the missing input.
 *   • `not-applicable`  — the metric does not exist for this business. Decided by tier and revenue
 *                         stage, NEVER inferred from absent data. "MRR $0" shown to a project-based
 *                         consultant implies a failing subscription business that does not exist.
 *   • `not-computable`  — the inputs are present and one of them makes the result undefined
 *                         (CAC = 0, monthly cost = 0). Deliberately NOT folded into `unknown`:
 *                         "needs your CAC" is a lie to someone who told us it was zero.
 *   • `known`           — a real number, including a real measured ZERO.
 *
 * Collapsing any two of these is the failure mode this type exists to prevent. `cash.test.ts` has a
 * red test per collapse.
 */
export type CashFigure =
  | { state: "unknown"; needs: string }
  | { state: "not-applicable"; because: string }
  | { state: "not-computable"; because: string }
  | {
      state: "known";
      origin: CashOrigin;
      value: number;
      unit: CashUnit;
      /** For `derived`: what it was computed FROM, in words. Never rendered without it. */
      from?: string;
      /** For a RATIO: how many customers it rests on. `null` = not recorded, and it says so. */
      sampleSize?: number | null;
      /** For `stated`: when the user last confirmed it. */
      statedAt?: number;
      /** For `stated`: older than STALE_AFTER_MS, so the page asks for a confirm-or-update. */
      stale?: boolean;
    };

export const unknownFigure = (needs: string): CashFigure => ({ state: "unknown", needs });
export const notApplicable = (because: string): CashFigure => ({
  state: "not-applicable",
  because,
});
export const notComputable = (because: string): CashFigure => ({
  state: "not-computable",
  because,
});
export const knownFigure = (
  origin: CashOrigin,
  value: number,
  unit: CashUnit,
  extra: Pick<
    Extract<CashFigure, { state: "known" }>,
    "from" | "sampleSize" | "statedAt" | "stale"
  > = {},
): CashFigure => ({ state: "known", origin, value, unit, ...extra });

// ── Collection: the six-input panel (and the three extra Hormozi asks it forces) ───────────

export type CashInputField =
  | "cashOnHand"
  | "monthlyOperatingCost"
  | "mrr"
  | "receivables"
  | "payables"
  | "cac"
  | "thirtyDayCashPerCustomer"
  | "grossProfitPerPurchase"
  | "purchasesPerLifetime"
  | "customerCount"
  | "referralPct";

export type CashInputSpec = {
  field: CashInputField;
  /** Which store owns the VALUE. The scorecard keeps the Hormozi inputs; nothing is duplicated. */
  store: "financeInputs" | "scorecard";
  /** Dot-path into the Scorecard, for `store: "scorecard"` only. */
  path?: string;
  unit: CashUnit;
  label: string;
  help: string;
  /** What answering this buys the user. An input with no payoff should not be asked for. */
  unlocks: string;
  /** Tiers this input is asked of. Absent = every tier. */
  tiers?: readonly Tier[];
};

/**
 * The whole collection surface, in panel order. NINE for an SME, SIX for most, and that is the
 * difference between a dashboard and a tax return.
 *
 * `customerCount` and `referralPct` are the two additions the design's own rules force: a ratio
 * must carry its sample size, and the referral gate must have a referral number. Both are Hormozi
 * inputs, so both live on the scorecard rather than in the finance-ops table.
 */
export const CASH_INPUTS: readonly CashInputSpec[] = [
  {
    field: "cashOnHand",
    store: "financeInputs",
    unit: "usd",
    label: "Cash on hand",
    help: "Everything the business could spend today.",
    unlocks: "runway",
  },
  {
    field: "monthlyOperatingCost",
    store: "financeInputs",
    unit: "usd",
    label: "Monthly operating cost",
    help: "What it costs to run the business for a month.",
    unlocks: "net burn, runway",
  },
  {
    field: "cac",
    store: "scorecard",
    path: "financials.cac",
    unit: "usd",
    label: "Customer acquisition cost",
    help: "What you spend, on average, to win one customer.",
    unlocks: "CFA, LTGP:CAC, payback",
  },
  {
    field: "thirtyDayCashPerCustomer",
    store: "scorecard",
    path: "financials.thirtyDayCashPerCustomer",
    unit: "usd",
    label: "30-day cash per customer",
    help: "Cash collected from one customer in their first 30 days.",
    unlocks: "CFA",
  },
  {
    field: "grossProfitPerPurchase",
    store: "scorecard",
    path: "financials.grossProfitPerPurchase",
    unit: "usd",
    label: "Gross profit per purchase",
    help: "Profit on one sale after the cost of delivering it. Not revenue.",
    unlocks: "LTGP",
  },
  {
    field: "purchasesPerLifetime",
    store: "scorecard",
    path: "financials.purchasesPerLifetime",
    unit: "count",
    label: "Purchases per customer lifetime",
    help: "How many times an average customer buys, in total.",
    unlocks: "LTGP, LTGP:CAC",
  },
  {
    field: "customerCount",
    store: "scorecard",
    path: "financials.customerCount",
    unit: "count",
    label: "Customers so far",
    help: "How many customers these figures are based on.",
    unlocks: "the sample size beside every ratio",
  },
  {
    field: "referralPct",
    store: "scorecard",
    path: "leadCard.referralPct",
    unit: "percent",
    label: "Referral share",
    help: "Share of new customers who arrived by referral.",
    unlocks: "the 25% referral gate",
    tiers: ["startup", "sme", "enterprise"],
  },
  {
    field: "mrr",
    store: "financeInputs",
    unit: "usd",
    label: "Monthly recurring revenue",
    help: "Subscription revenue that recurs every month.",
    unlocks: "MRR, ARR",
    tiers: ["startup", "sme", "enterprise"],
  },
  {
    field: "receivables",
    store: "financeInputs",
    unit: "usd",
    label: "Receivables",
    help: "Money owed to you and not yet collected.",
    unlocks: "working capital",
    tiers: ["sme", "enterprise"],
  },
  {
    field: "payables",
    store: "financeInputs",
    unit: "usd",
    label: "Payables",
    help: "Money you owe and have not yet paid.",
    unlocks: "working capital",
    tiers: ["sme", "enterprise"],
  },
];

const SPEC_BY_FIELD = new Map<CashInputField, CashInputSpec>(
  CASH_INPUTS.map((spec) => [spec.field, spec]),
);

export const cashInputSpec = (field: CashInputField): CashInputSpec => {
  const spec = SPEC_BY_FIELD.get(field);
  if (!spec) throw new Error(`unknown cash input: ${String(field)}`);
  return spec;
};

/** Which inputs this tier is asked for, in panel order. */
export const cashInputsForTier = (tier: Tier): CashInputSpec[] =>
  CASH_INPUTS.filter((spec) => spec.tiers === undefined || spec.tiers.includes(tier));

/**
 * Validate one input at the trust boundary. Throws nothing — the caller decides whether a bad value
 * is a form error or a rejected mutation, and both need the reason in words.
 *
 * `purchasesPerLifetime < 1` is REJECTED rather than accepted: half a purchase multiplied into an
 * LTGP produces a plausible-looking number that is wrong, which is worse than a refusal.
 */
export function validateCashInput(
  field: CashInputField,
  value: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(value)) return { ok: false, reason: "Enter a number." };
  const spec = cashInputSpec(field);
  if (value < 0) return { ok: false, reason: "This cannot be negative." };
  if (spec.unit === "percent" && value > 100) return { ok: false, reason: "Enter 0 to 100." };
  // Checked BEFORE the generic count-is-a-whole-number rule below: 0.5 is both non-integer and
  // below 1, and the "at least 1" reason is the one worth surfacing — "enter a whole number" would
  // leave someone who typed 0.5 unsure whether 1 or 2 is the fix.
  if (field === "purchasesPerLifetime" && value < 1) {
    return { ok: false, reason: "A customer buys at least 1 time. Enter at least 1." };
  }
  if (spec.unit === "count" && !Number.isInteger(value)) {
    return { ok: false, reason: "Enter a whole number." };
  }
  return { ok: true };
}

export type CashInputState = {
  field: CashInputField;
  value: number | null;
  statedAt: number | null;
  stale: boolean;
};

/**
 * Does this input need a confirm-or-update prompt? THE single definition of staleness — every
 * caller (this module's `statedFigure` below, and `convex/cash.ts`'s `inputs` query, for BOTH the
 * `financeInputs` and the scorecard branch) routes through this one predicate rather than
 * re-deriving the rule. A prior version had `cash.ts` re-derive it from a bare `statedAt`+`nowMs`
 * check while `convex/cash.ts` already had the full three-way rule inline — two definitions of one
 * rule, disagreeing, exactly the drift CLAUDE.md §1 exists to prevent.
 *
 *   • `value === null`  (absent)        → NOT stale. Staleness is a property of an ANSWERED input;
 *                                          a missing one is `unknown`, a different truth entirely.
 *   • `value` present, `statedAt: null` → STALE. An unstamped legacy value (every scorecard figure
 *                                          written before `userProvidedAt` existed) does not get to
 *                                          read as fresh just because its age was never recorded —
 *                                          the safe direction is "needs confirmation".
 *   • `value` present, older than 90d   → STALE.
 */
export const needsConfirmation = (
  value: number | null,
  statedAt: number | null,
  nowMs: number,
): boolean => value !== null && (statedAt === null || nowMs - statedAt > STALE_AFTER_MS);

// ── The four truths, resolved once: a stated input becomes a figure, and a derived figure is
// suppressed until every input it rests on is known. ──────────────────────────────────────

/** Every collected input, keyed by field. The shape `requireInputs`/`valueOf`/`statedFigure` read. */
export type CashInputs = Partial<Record<CashInputField, CashInputState>>;

export const toCashInputs = (states: readonly CashInputState[]): CashInputs =>
  Object.fromEntries(states.map((s) => [s.field, s])) as CashInputs;

/**
 * One STATED input as a figure. A real zero is `known` — measured nothing is an answer, so only a
 * missing/null value (never asked, or unanswered) produces `unknown`.
 */
export function statedFigure(
  input: CashInputState | undefined,
  spec: CashInputSpec,
  nowMs: number,
): CashFigure {
  if (input === undefined || input.value === null) {
    return unknownFigure(`Needs your ${spec.label}.`);
  }
  return knownFigure("stated", input.value, spec.unit, {
    ...(input.statedAt === null ? {} : { statedAt: input.statedAt }),
    stale: needsConfirmation(input.value, input.statedAt, nowMs),
  });
}

export const derived = (args: {
  value: number;
  unit: CashUnit;
  from: string;
  sampleSize?: number | null;
}): CashFigure =>
  knownFigure("derived", args.value, args.unit, {
    from: args.from,
    ...(args.sampleSize === undefined ? {} : { sampleSize: args.sampleSize }),
  });

/**
 * THE suppression rule: a derived figure is never rendered when any of its inputs is unknown, and
 * it names the missing one. This is `scorecard.ts`'s null-means-ask contract applied at the display
 * boundary — the alternative is a confident number resting on a value nobody supplied.
 *
 * Returns the blocking figure, or `null` when everything is present. Names the FIRST missing input
 * rather than all of them: a metric that answers with a checklist gets ignored.
 */
export function requireInputs(
  inputs: CashInputs,
  fields: readonly CashInputField[],
): CashFigure | null {
  for (const field of fields) {
    const state = inputs[field];
    if (state === undefined || state.value === null) {
      return unknownFigure(`Needs your ${cashInputSpec(field).label}.`);
    }
  }
  return null;
}

/**
 * A present input's number, for use once `requireInputs` has returned `null` for a field list
 * containing `field`. Throws if the field is still absent — a programming-error tripwire, never a
 * runtime path, so it must not be softened into `?? 0`: that would fabricate a figure and defeat
 * the suppression rule above.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: `valueOf` is the plan's contracted name; a top-level export is never called by JS's implicit coercion protocol.
export const valueOf = (inputs: CashInputs, field: CashInputField): number => {
  const value = inputs[field]?.value;
  if (value === null || value === undefined) {
    throw new Error(`cash input "${field}" read before requireInputs proved it present`);
  }
  return value;
};

// ── Activity: the row that costs nothing ────────────────────────────────────────────────
//
// Pikar already delivers the emails, so `requests` rows in status `sent` ARE the reach-out count.
// The books say the readable signals at the smallest scale are INPUTS — reach-outs per day, posts
// per day, streak — and explicitly that rates at small samples are unreadable. This is the one row
// that populates itself with no data entry.

export type CashActivity = {
  /** Newest UTC day first, one entry per day in the window, gaps included as real zeroes. */
  perDay: { dayStartMs: number; count: number }[];
  todayCount: number;
  /** Consecutive UTC days with at least one send, ENDING TODAY. Zero if nothing went out today. */
  streakDays: number;
  /**
   * Sum of today plus the six preceding UTC days (the newest 7 entries of `perDay`, or fewer if
   * the window is shorter). Derived HERE, not in the view — CLAUDE.md §1: a view renders, it never
   * sums. `perDay` alone still carries the raw per-day counts for anything that needs the series.
   */
  last7Count: number;
};

const utcDayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Bucket delivered sends into UTC days.
 *
 * The streak ends TODAY by definition. A streak that keeps counting yesterday's run for someone who
 * has not sent today is the flattering lie this row exists to avoid — it is a prompt to act, not a
 * trophy.
 */
export function activityFromSends(input: {
  sentAtMs: readonly number[];
  sinceMs: number;
  nowMs: number;
}): CashActivity {
  const firstDay = utcDayStart(input.sinceMs);
  const today = utcDayStart(input.nowMs);

  const counts = new Map<number, number>();
  for (let day = firstDay; day <= today; day += DAY_MS) counts.set(day, 0);
  for (const sentAt of input.sentAtMs) {
    const day = utcDayStart(sentAt);
    // Outside the reported window is IGNORED, never folded into the first bucket — a bar that
    // silently absorbs older history misreports the day it sits on.
    if (!counts.has(day)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const perDay = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStartMs, count]) => ({ dayStartMs, count }));

  let streakDays = 0;
  for (const bucket of perDay) {
    if (bucket.count === 0) break;
    streakDays += 1;
  }

  const last7Count = perDay.slice(0, 7).reduce((sum, bucket) => sum + bucket.count, 0);

  return { perDay, todayCount: counts.get(today) ?? 0, streakDays, last7Count };
}

// ── Unit economics: the Hormozi spine, as figures a page can render ────────────────────────

export type CashUnitEconomics = {
  cfa: CashFigure;
  ltgp: CashFigure;
  ltgpCac: CashFigure;
  cacPayback: CashFigure;
  cacVsIndustry: CashFigure;
  grossMargin: CashFigure;
  cohortChurn: CashFigure;
  referralPct: CashFigure;
};

/** The referral share the source material treats as the gate worth clearing. */
export const REFERRAL_GATE_PCT = 25;

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * The Hormozi spine, as figures a page can render.
 *
 * The ARITHMETIC is `financialSpine.ts`'s — `ltgpCac` and `cfa` are ports of the source scripts and
 * already guard every divisor. What this adds is the part a screen needs: which truth each result
 * is in, what it was derived from, and how many customers it rests on.
 *
 * CAC = 0 is intercepted BEFORE `cfa`, which would answer `{ratio: 0, achieved: false}` for a
 * zero denominator — conservative and correct as a routing signal, but as a rendered figure it
 * reads as "your acquisition does not pay for itself" to someone who spent nothing acquiring.
 */
export function unitEconomics(args: {
  inputs: CashInputs;
  scorecard: Scorecard;
  nowMs: number;
}): CashUnitEconomics {
  const { inputs, scorecard, nowMs } = args;
  const sampleSize = inputs.customerCount?.value ?? null;
  const cacValue = inputs.cac?.value ?? null;
  const zeroCac = cacValue === 0;

  // ── LTGP: the two components WIN over a stated total, and the figure says which it used.
  const missingComponents = requireInputs(inputs, [
    "grossProfitPerPurchase",
    "purchasesPerLifetime",
  ]);
  const ltgpFigure: CashFigure = (() => {
    if (missingComponents === null) {
      const perPurchase = valueOf(inputs, "grossProfitPerPurchase");
      const purchases = valueOf(inputs, "purchasesPerLifetime");
      const spine = ltgpCac({
        grossProfitPerPurchase: perPurchase,
        purchases,
        acqSpend: 0,
        customers: 1,
      });
      return derived({
        value: spine.ltgp,
        unit: "usd",
        from: `${usd(perPurchase)} gross profit × ${purchases} purchases`,
      });
    }
    if (scorecard.financials.ltgp !== null) {
      return knownFigure("stated", scorecard.financials.ltgp, "usd");
    }
    return missingComponents;
  })();

  // ── CFA: does a customer pay for itself inside 30 days?
  const cfaFigure: CashFigure = (() => {
    const missing = requireInputs(inputs, ["cac", "thirtyDayCashPerCustomer"]);
    if (missing) return missing;
    if (zeroCac)
      return notComputable("No acquisition cost recorded, so there is nothing to pay back.");
    const cac = valueOf(inputs, "cac");
    const thirtyDayCash = valueOf(inputs, "thirtyDayCashPerCustomer");
    const serviceCost = scorecard.financials.costToServicePerCustomer ?? 0;
    const result = cfa({ thirtyDayCash, cac, serviceCost });
    return derived({
      value: result.ratio,
      unit: "ratio",
      from: `${usd(thirtyDayCash)} in the first 30 days against ${usd(cac + serviceCost)} to get and serve them`,
      sampleSize,
    });
  })();

  // ── LTGP:CAC, with its sample size beside it.
  const ratioFigure: CashFigure = (() => {
    if (ltgpFigure.state !== "known") return ltgpFigure;
    const missing = requireInputs(inputs, ["cac"]);
    if (missing) return missing;
    if (zeroCac)
      return notComputable("No acquisition cost recorded, so there is no ratio to take.");
    const cac = valueOf(inputs, "cac");
    const spine = ltgpCac({
      grossProfitPerPurchase: ltgpFigure.value,
      purchases: 1,
      acqSpend: cac,
      customers: 1,
    });
    if (spine.ratio === null) return notComputable("No acquisition cost recorded.");
    return derived({
      value: spine.ratio,
      unit: "ratio",
      from: `${usd(ltgpFigure.value)} lifetime gross profit and ${usd(cac)} to acquire`,
      sampleSize,
    });
  })();

  // ── CAC payback, in months: CAC ÷ monthly gross profit per customer.
  // ponytail: deriving lifetime-months from monthly churn is a judgement call the spec didn't make
  // explicit; absent churn is `unknown` rather than a guessed lifetime — the honest fallback.
  const paybackFigure: CashFigure = (() => {
    const missing = requireInputs(inputs, [
      "cac",
      "grossProfitPerPurchase",
      "purchasesPerLifetime",
    ]);
    if (missing) return missing;
    if (zeroCac)
      return notComputable("No acquisition cost recorded, so there is nothing to pay back.");
    const monthlyChurnPct = scorecard.financials.churnByCadence.monthly;
    if (monthlyChurnPct === null || monthlyChurnPct <= 0) {
      return unknownFigure("needs your monthly churn, to know how long a customer lasts");
    }
    // Average lifetime in months from monthly churn, then gross profit spread across it.
    const lifetimeMonths = 100 / monthlyChurnPct;
    const lifetimeGrossProfit =
      valueOf(inputs, "grossProfitPerPurchase") * valueOf(inputs, "purchasesPerLifetime");
    const monthlyGrossProfit = lifetimeGrossProfit / lifetimeMonths;
    if (monthlyGrossProfit <= 0) {
      return notComputable("No monthly gross profit recorded, so payback has no month count.");
    }
    const months = Math.round((valueOf(inputs, "cac") / monthlyGrossProfit) * 10) / 10;
    return derived({
      value: months,
      unit: "months",
      from: `${usd(valueOf(inputs, "cac"))} to acquire against ${usd(Math.round(monthlyGrossProfit))} gross profit a month`,
      sampleSize,
    });
  })();

  // ── The industry-average switch. OFF by default, and it renders the REASON, never a pass.
  // The source supplies no industry table and says to research the average yourself, so this
  // cannot run until the user provides that figure. A default "within range" would tell someone to
  // stop optimising a CAC nobody has measured against anything.
  const industryFigure: CashFigure = (() => {
    const average = scorecard.financials.industryAvgCac;
    if (average === null || average <= 0) {
      return unknownFigure(
        "needs the industry-average CAC for your market — there is no table to look it up in",
      );
    }
    const missing = requireInputs(inputs, ["cac"]);
    if (missing) return missing;
    const cac = valueOf(inputs, "cac");
    return derived({
      value: round2(cac / average),
      unit: "ratio",
      from: `${usd(cac)} against a ${usd(average)} industry average — the threshold is ${INDUSTRY_MULTIPLE}×`,
      sampleSize,
    });
  })();

  return {
    cfa: cfaFigure,
    ltgp: ltgpFigure,
    ltgpCac: ratioFigure,
    cacPayback: paybackFigure,
    cacVsIndustry: industryFigure,
    // ponytail: grossMargin/cohortChurn read the scorecard directly rather than through
    // `statedFigure`, unlike referralPct below — neither is a `CashInputField` in `CASH_INPUTS`,
    // so there is no `CashInputState` carrying a per-field `statedAt` for either. Routing them
    // through `statedFigure` would need a fabricated timestamp; upgrade path is adding both to
    // `CASH_INPUTS` (they already have Scorecard dot-paths) if staleness on them is ever wanted.
    grossMargin:
      scorecard.financials.grossMarginPct === null
        ? unknownFigure("needs your gross margin")
        : knownFigure("stated", scorecard.financials.grossMarginPct, "percent"),
    cohortChurn:
      scorecard.financials.churnByCadence.monthly === null
        ? unknownFigure("needs your monthly churn")
        : knownFigure("stated", scorecard.financials.churnByCadence.monthly, "percent"),
    // referralPct IS a CashInputField (CASH_INPUTS) with a real CashInputState — it gets the same
    // staleness treatment every other stated cash input gets, through the one shared function.
    referralPct: statedFigure(inputs.referralPct, cashInputSpec("referralPct"), nowMs),
  };
}

// ── Solvency: the finance-ops layer, deliberately OUTSIDE the Hormozi framework ───────────────

export type CashSolvency = {
  runway: CashFigure;
  netBurn: CashFigure;
  mrr: CashFigure;
  arr: CashFigure;
  workingCapital: CashFigure;
};

/**
 * The finance-ops layer. DELIBERATELY OUTSIDE the Hormozi framework — none of `runway`, `burn`,
 * `MRR`, `ARR` or `working capital` appears anywhere in the three source books, and the page marks
 * this section as such rather than presenting it as part of the spine. It earns its place because
 * it is the survival metric for exactly the population the books exclude: businesses running on
 * outside money, for whom the constraint is the date the money ends.
 *
 * `not-applicable` here is decided by the TIER, never inferred from absent data. A solopreneur with
 * project revenue has no meaningful monthly recurring figure — that is a fact about their business,
 * not a gap in their answers, and "MRR $0" would describe a failing subscription business that does
 * not exist.
 *
 * `revenueStage` is accepted (it is the natural pairing with `tier` on this page, and a future cut
 * of this layer may need it) but not read by any branch below — `not-applicable` is a TIER decision
 * only, per the design note above. ponytail: unused for now; drop from the signature if a later task
 * proves no branch will ever need it.
 */
export function solvency(args: {
  inputs: CashInputs;
  tier: Tier;
  revenueStage: RevenueStage | null;
  nowMs: number;
}): CashSolvency {
  const { inputs, tier, nowMs } = args;
  const recurringApplies = tier !== "solopreneur";
  const workingCapitalApplies = tier === "sme" || tier === "enterprise";

  // mrr is surfaced DIRECTLY as a figure (unlike cashOnHand/monthlyOperatingCost/receivables/
  // payables below, which are only ever CONSUMED through requireInputs+valueOf on the way to a
  // derived figure) — so it is the one field here that must route through `statedFigure`, the same
  // way `referralPct` does in `unitEconomics` above. Not-applicable is checked FIRST and short-
  // circuits `statedFigure` entirely: a solopreneur's stated MRR value (if any legacy row has one)
  // must never leak through as a real figure.
  const mrrFigure: CashFigure = !recurringApplies
    ? notApplicable(
        "Project revenue has no monthly recurring figure. This is not zero — it does not apply.",
      )
    : statedFigure(inputs.mrr, cashInputSpec("mrr"), nowMs);

  const arrFigure: CashFigure =
    mrrFigure.state !== "known"
      ? mrrFigure
      : derived({
          value: mrrFigure.value * 12,
          unit: "usd",
          from: `${usd(mrrFigure.value)} a month × 12`,
        });

  // Net burn: what leaves, minus what recurs. Clamped at zero — a profitable month is "not
  // burning", and a negative burn rendered as a number reads as a deeper hole than reality.
  const netBurnFigure: CashFigure = (() => {
    const missing = requireInputs(inputs, ["monthlyOperatingCost"]);
    if (missing) return missing;
    const cost = valueOf(inputs, "monthlyOperatingCost");
    const recurring = mrrFigure.state === "known" ? mrrFigure.value : 0;
    const burn = Math.max(0, cost - recurring);
    return derived({
      value: burn,
      unit: "usd",
      from:
        recurring > 0
          ? `${usd(cost)} out against ${usd(recurring)} recurring in`
          : `${usd(cost)} a month out`,
    });
  })();

  const runwayFigure: CashFigure = (() => {
    const missing = requireInputs(inputs, ["cashOnHand", "monthlyOperatingCost"]);
    if (missing) return missing;
    if (valueOf(inputs, "monthlyOperatingCost") === 0) {
      return notComputable("No operating cost recorded, so there is no runway to count down.");
    }
    if (netBurnFigure.state !== "known") return netBurnFigure;
    if (netBurnFigure.value <= 0) {
      return notApplicable("Not burning — recurring revenue covers the monthly cost.");
    }
    const cash = valueOf(inputs, "cashOnHand");
    // Never negative: cash cannot go below zero on this page, and a negative month count is not a
    // figure to put in front of a person.
    const months = Math.max(0, Math.round((cash / netBurnFigure.value) * 10) / 10);
    return derived({
      value: months,
      unit: "months",
      from: `${usd(cash)} on hand against ${usd(netBurnFigure.value)} a month of net burn`,
    });
  })();

  const workingCapitalFigure: CashFigure = (() => {
    if (!workingCapitalApplies) {
      return notApplicable("Working capital is an established-business measure.");
    }
    const missing = requireInputs(inputs, ["receivables", "payables"]);
    if (missing) return missing;
    const receivables = valueOf(inputs, "receivables");
    const payables = valueOf(inputs, "payables");
    return derived({
      value: receivables - payables,
      unit: "usd",
      from: `${usd(receivables)} owed to you against ${usd(payables)} you owe`,
    });
  })();

  return {
    runway: runwayFigure,
    netBurn: netBurnFigure,
    mrr: mrrFigure,
    arr: arrFigure,
    workingCapital: workingCapitalFigure,
  };
}
