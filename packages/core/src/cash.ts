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
 *
 * ponytail: `ltgpCac` from `./growth/financialSpine` is not imported here — this task (Task 2) has
 * no caller for it yet, and an unused import fails lint. Task 5 imports it where it is first used.
 */

import type { Tier } from "./businessProfile";

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

export const isStale = (statedAt: number | null, nowMs: number): boolean =>
  statedAt !== null && nowMs - statedAt > STALE_AFTER_MS;

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
    stale: isStale(input.statedAt, nowMs),
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
