/**
 * Every number this phase reports, computed here in pure TypeScript.
 *
 * No Convex, no network, no LLM (phase context, "Deterministic finance"): a model may EXPLAIN what
 * these functions return and may never create, modify or silently repair one. Two rules run through
 * all of it:
 *
 *   1. Missing history is UNKNOWN, never zero. The four-state figure vocabulary comes verbatim from
 *      `@pikar/core/cash` — `unknownFigure` / `notApplicable` / `notComputable` / a real `known`.
 *   2. Two sources never state the same business activity twice. `reconcilePayments` is the only
 *      route to a receipts total, so "the books said it AND Stripe said it" cannot become 2x.
 */
import { type CashFigure, knownFigure, notComputable, unknownFigure } from "@pikar/core/cash";
import { err, ok, type Result } from "@pikar/core/result";
import {
  CAPS,
  type CountFigure,
  type Coverage,
  type CoverageWindow,
  type Currency,
  type DayFigure,
  DECISION_SUPPORT_NOTICE,
  type Figure,
  type FinanceConfidence,
  type FinanceResult,
  type Invoice,
  known,
  type Money,
  type Obligation,
  type Payment,
  type Projection,
  type Provider,
  type SourceAuthority,
  type Unresolved,
} from "./contracts";
import {
  addMoney,
  formatMoneyAmount,
  negateMoney,
  normalizeCurrency,
  subMoney,
  sumMoney,
  zeroMoney,
} from "./money";

const DAY_MS = 86_400_000;

/**
 * Core's `unknownFigure` / `notComputable` are typed to the WHOLE `CashFigure` union, so their
 * results are not assignable to a `Figure<Money>` or a `Figure<CashTimeline>`. This narrows to the
 * unresolved arm without re-declaring the shapes — reuse, not a second copy of the vocabulary. The
 * throw is provably unreachable and exists so the narrowing is real rather than a cast.
 */
const asUnresolved = (f: CashFigure): Unresolved => {
  if (f.state === "known") throw new Error("an unresolved constructor returned a known figure");
  return f;
};
const gap = (needs: string): Unresolved => asUnresolved(unknownFigure(needs));
const undefinedResult = (because: string): Unresolved => asUnresolved(notComputable(because));

/**
 * Aging, lag and cash days are all counted in whole UTC days. A due date at 23:00 and a read at
 * 01:00 on the same day differ by a negative number of milliseconds and by ZERO days — the day is
 * the unit a business actually reasons in, and using raw millis makes an invoice "overdue" because
 * of a clock time nobody chose.
 */
const utcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
const daysBetween = (fromMs: number, toMs: number): number =>
  (utcDay(toMs) - utcDay(fromMs)) / DAY_MS;

// ── AR aging ──────────────────────────────────────────────────────────────────────────────

export const AGING_BUCKETS = [
  "current",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
  "unknown",
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export type AgingBucketTotal = { count: number; total: Money };
export type Aging = {
  currency: Currency;
  buckets: Record<AgingBucket, AgingBucketTotal>;
  outstanding: Money;
};

/** `null` due date lands in `unknown` — an invoice with no due date is not "current". */
export function agingBucket(dueAt: number | null, asOfMs: number): AgingBucket {
  if (dueAt === null || !Number.isFinite(dueAt)) return "unknown";
  const overdue = daysBetween(dueAt, asOfMs);
  if (overdue <= 0) return "current";
  if (overdue <= 30) return "d1_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d90_plus";
}

/**
 * The currency is a REQUIRED argument, not read off the first invoice: an empty ledger still has to
 * answer in some currency, and a mixed ledger must be refused rather than silently reported in
 * whichever currency happened to sort first.
 */
export function agingReport(
  invoices: readonly Invoice[],
  asOfMs: number,
  currency: unknown,
): Result<Aging, string> {
  const cur = normalizeCurrency(currency);
  if (!cur.ok) return cur;
  if (!Number.isFinite(asOfMs)) return err("An aging report needs a valid as-of time.");

  const buckets = Object.fromEntries(
    AGING_BUCKETS.map((b) => [b, { count: 0, total: zeroMoney(cur.value) }]),
  ) as Record<AgingBucket, AgingBucketTotal>;
  let outstanding = zeroMoney(cur.value);

  for (const inv of invoices) {
    if (inv.outstanding.currency !== cur.value || inv.total.currency !== cur.value) {
      return err(`Cannot age ${inv.outstanding.currency} invoices into a ${cur.value} report.`);
    }
    // `ponytail:` credit memos and overpayments are a later plan; a negative balance today means a
    // normalization bug, and quietly aging it would hide the bug behind a plausible number.
    if (inv.outstanding.minor < 0) return err("An outstanding balance cannot be negative.");
    if (inv.outstanding.minor === 0) continue;
    if (!Number.isFinite(inv.issuedAt)) return err("An invoice needs a valid issue date.");

    const b = buckets[agingBucket(inv.dueAt, asOfMs)];
    const total = addMoney(b.total, inv.outstanding);
    if (!total.ok) return total;
    b.count += 1;
    b.total = total.value;
    const running = addMoney(outstanding, inv.outstanding);
    if (!running.ok) return running;
    outstanding = running.value;
  }
  return ok({ currency: cur.value, buckets, outstanding });
}

// ── Payment lag ───────────────────────────────────────────────────────────────────────────

export type LagStats = {
  settledCount: CountFigure;
  medianDays: DayFigure;
  p90Days: DayFigure;
};

/**
 * Nearest-rank: `sorted[ceil(p*n) - 1]`. ONE algorithm for both percentiles, always an observed
 * value, never an interpolated half-day that no invoice actually took.
 */
const nearestRank = (sorted: readonly number[], p: number): number | undefined =>
  sorted[Math.ceil(p * sorted.length) - 1];

/**
 * Days from issue to the invoice's LAST payment. Instalments settle an invoice when the final one
 * lands, so taking the first would report a business as paid faster than it is.
 */
export function paymentLag(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
): Result<LagStats, string> {
  const lastPaidAt = new Map<string, number>();
  for (const p of payments) {
    if (p.invoiceId === null) continue;
    if (!Number.isFinite(p.paidAt)) return err("A payment needs a valid paid date.");
    const seen = lastPaidAt.get(p.invoiceId);
    if (seen === undefined || p.paidAt > seen) lastPaidAt.set(p.invoiceId, p.paidAt);
  }

  const lags: number[] = [];
  for (const inv of invoices) {
    const paidAt = lastPaidAt.get(inv.ref.id);
    if (paidAt === undefined) continue;
    if (!Number.isFinite(inv.issuedAt)) return err("An invoice needs a valid issue date.");
    const lag = daysBetween(inv.issuedAt, paidAt);
    if (lag < 0) return err("A payment cannot be dated before the invoice it settles.");
    lags.push(lag);
  }
  lags.sort((a, b) => a - b);

  const from = "invoice issue dates and settlement dates";
  if (lags.length === 0) {
    // NOT zero: the inputs are present and the statistic is undefined over an empty set. That is
    // exactly what core's `not-computable` state exists for, as distinct from `unknown`.
    const because = "no invoice in this window has been settled yet";
    return ok({
      settledCount: known("derived", 0, from),
      medianDays: undefinedResult(because),
      p90Days: undefinedResult(because),
    });
  }
  const median = nearestRank(lags, 0.5);
  const p90 = nearestRank(lags, 0.9);
  // Unreachable for a non-empty list. A `?? 0` fallback here would be exactly the fabricated zero
  // this module exists to prevent, so the impossible case refuses instead of inventing a number.
  if (median === undefined || p90 === undefined)
    return err("A percentile over no data is undefined.");
  return ok({
    settledCount: known("derived", lags.length, from),
    medianDays: known("derived", median, from),
    p90Days: known("derived", p90, from),
  });
}

// ── Cash timeline ─────────────────────────────────────────────────────────────────────────

export type CashEvent = { atMs: number; amount: Money };
export type CashPoint = {
  /** UTC day start. */
  atMs: number;
  /** The intraday TROUGH: after that day's outflows, before that day's receipts. */
  low: Money;
  /** End of day. */
  balance: Money;
};
export type CashTimeline = {
  currency: Currency;
  /** One point per day that has an event, in order. */
  points: readonly CashPoint[];
  closing: Money;
};

export type TimelineArgs = {
  /** `null` means never recorded. The whole timeline goes UNKNOWN — it does NOT start at zero. */
  openingCash: Money | null;
  asOfMs: number;
  horizonDays: number;
  inflows: readonly CashEvent[];
  outflows: readonly CashEvent[];
};

/**
 * Two different failures, two different channels: `err` is a contradiction in the ARGUMENTS (mixed
 * currency, a negative "inflow", an out-of-range horizon) and is a caller bug; a `Figure` in the
 * `unknown` state is a DATA gap the owner can close by telling us their cash balance.
 */
export function cashTimeline(args: TimelineArgs): Result<Figure<CashTimeline>, string> {
  if (!Number.isFinite(args.asOfMs)) return err("A cash timeline needs a valid as-of time.");
  if (
    !Number.isSafeInteger(args.horizonDays) ||
    args.horizonDays < 1 ||
    args.horizonDays > CAPS.maxWindowDays
  ) {
    return err(`A cash horizon must be 1..${CAPS.maxWindowDays} whole days.`);
  }
  if (args.openingCash === null) {
    return ok(gap("your opening cash on hand"));
  }
  const currency = args.openingCash.currency;

  const startDay = utcDay(args.asOfMs);
  const endDay = startDay + args.horizonDays * DAY_MS;
  // day -> [outflowMinor, inflowMinor]
  const byDay = new Map<number, [number, number]>();

  for (const [events, slot, label] of [
    [args.outflows, 0, "outflow"],
    [args.inflows, 1, "inflow"],
  ] as const) {
    for (const e of events) {
      if (!Number.isFinite(e.atMs)) return err(`An ${label} needs a valid date.`);
      if (e.amount.currency !== currency) {
        return err(`Cannot mix ${e.amount.currency} into a ${currency} cash timeline.`);
      }
      // A negative "inflow" is an outflow wearing the wrong sign; accepting it would let a caller
      // net two directions and lose the intraday trough this timeline exists to expose.
      if (e.amount.minor < 0) return err(`An ${label} amount cannot be negative.`);
      const day = utcDay(e.atMs);
      if (day < startDay || day > endDay) continue;
      const cell = byDay.get(day) ?? [0, 0];
      cell[slot] += e.amount.minor;
      byDay.set(day, cell);
    }
  }

  let balance = args.openingCash;
  const points: CashPoint[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const cell = byDay.get(day) ?? [0, 0];
    // Outflows first: the prudent same-day order. A receipt expected on payday is not a promise it
    // clears before the payroll debit does.
    const low = subMoney(balance, { minor: cell[0], currency });
    if (!low.ok) return low;
    const end = addMoney(low.value, { minor: cell[1], currency });
    if (!end.ok) return end;
    points.push({ atMs: day, low: low.value, balance: end.value });
    balance = end.value;
  }

  return ok(
    known(
      "derived",
      { currency, points, closing: balance },
      "opening cash, expected receipts and scheduled obligations",
    ),
  );
}

// ── Payroll gap ───────────────────────────────────────────────────────────────────────────

export type PayrollOutlook = {
  covered: boolean;
  /** UTC day start of the first payroll run that cannot clear. `null` when all clear. */
  firstShortfallAt: number | null;
  shortfall: Money | null;
};

export type PayrollArgs = {
  openingCash: Money | null;
  asOfMs: number;
  horizonDays: number;
  expectedInflows: readonly CashEvent[];
  /** Every scheduled outflow. The `payroll` ones are what this answer is about. */
  obligations: readonly Obligation[];
};

export function payrollGap(args: PayrollArgs): Result<Figure<PayrollOutlook>, string> {
  const timeline = cashTimeline({
    openingCash: args.openingCash,
    asOfMs: args.asOfMs,
    horizonDays: args.horizonDays,
    inflows: args.expectedInflows,
    outflows: args.obligations.map((o) => ({ atMs: o.dueAt, amount: o.amount })),
  });
  if (!timeline.ok) return timeline;
  // Propagates `unknown` when opening cash was never recorded, rather than answering "covered".
  if (timeline.value.state !== "known") return ok(timeline.value);

  const startDay = utcDay(args.asOfMs);
  const endDay = startDay + args.horizonDays * DAY_MS;
  const runs = args.obligations
    .filter((o) => o.kind === "payroll")
    .map((o) => utcDay(o.dueAt))
    .filter((day) => day >= startDay && day <= endDay)
    .sort((a, b) => a - b);

  if (runs.length === 0) {
    // THE invariant of this function. No payroll on file is not "payroll is safe" — it is a
    // question we never asked, and answering `covered: true` here would be the whole feature lying.
    return ok(gap("your payroll schedule for this window"));
  }

  const t = timeline.value.value;
  const lowByDay = new Map(t.points.map((p) => [p.atMs, p.low]));
  const from = "opening cash, expected receipts and scheduled payroll";
  for (const day of runs) {
    const low = lowByDay.get(day);
    // Every payroll run in range contributed an outflow, so it has a point. Defensive only.
    if (low === undefined || low.minor >= 0) continue;
    return ok(
      known(
        "derived",
        { covered: false, firstShortfallAt: day, shortfall: negateMoney(low) },
        from,
      ),
    );
  }
  return ok(known("derived", { covered: true, firstShortfallAt: null, shortfall: null }, from));
}

// ── Source authority: the double-count refusal ────────────────────────────────────────────

export type PaymentSource = {
  authority: SourceAuthority;
  window: CoverageWindow;
  payments: readonly Payment[];
};

export type Reconciled = {
  included: readonly Payment[];
  excluded: readonly { payment: Payment; because: string }[];
};

/**
 * The books own settlement. A payment rail reports the SAME business activity from the other side,
 * so believing both double-counts it. Two exclusions, in order:
 *
 *   1. The rail names an invoice the books already settled.
 *   2. The rail's charge falls inside a period the books cover — the books already booked it, even
 *      though the rail's id is unknown to them.
 *
 * A rail charge OUTSIDE every accounting window survives: that is genuinely new information, and
 * dropping it would under-report cash as badly as keeping it would over-report.
 */
export function reconcilePayments(sources: readonly PaymentSource[]): Reconciled {
  const authoritative = sources.filter((s) => s.authority === "accounting_authority");
  const bookedInvoices = new Set<string>();
  for (const s of authoritative) {
    for (const p of s.payments) if (p.invoiceId !== null) bookedInvoices.add(p.invoiceId);
  }

  const included: Payment[] = [];
  const excluded: { payment: Payment; because: string }[] = [];

  for (const source of sources) {
    for (const p of source.payments) {
      if (source.authority === "accounting_authority") {
        included.push(p);
        continue;
      }
      if (source.authority !== "payment_rail") {
        // Colour (HubSpot deal stage) and owner-stated obligations are never receipts.
        excluded.push({ payment: p, because: `a ${source.authority} source is not a receipt` });
        continue;
      }
      if (p.invoiceId !== null && bookedInvoices.has(p.invoiceId)) {
        excluded.push({ payment: p, because: "already booked by the accounting authority" });
        continue;
      }
      const covered = authoritative.some(
        (s) => p.paidAt >= s.window.startMs && p.paidAt <= s.window.endMs,
      );
      if (covered) {
        excluded.push({
          payment: p,
          because: "inside the accounting authority's coverage window",
        });
        continue;
      }
      included.push(p);
    }
  }
  return { included, excluded };
}

/**
 * The ONLY total over payments this module exports, and it takes a `Reconciled` — so there is no
 * shape in the public API that lets a caller sum raw provider payments and double-count.
 */
export const receiptsTotal = (r: Reconciled, currency: unknown): Result<Money, string> =>
  sumMoney(
    r.included.map((p) => p.amount),
    currency,
  );

// ── Coverage and confidence ───────────────────────────────────────────────────────────────

export function coverageOf(projections: readonly Projection<unknown>[]): Coverage {
  const providers: Provider[] = [];
  const authorities: SourceAuthority[] = [];
  const missing: string[] = [];
  let capped = false;
  let partial = false;

  for (const p of projections) {
    const provider = p.state === "unavailable" ? p.provider : p.meta.provider;
    if (!providers.includes(provider)) providers.push(provider);
    if (p.state === "unavailable") {
      // The provider name is a LABEL. The reason is not folded in: it can be adapter-authored text
      // and this list reaches renderers and telemetry (CLAUDE.md §4).
      if (!missing.includes(provider)) missing.push(provider);
      continue;
    }
    if (!authorities.includes(p.meta.authority)) authorities.push(p.meta.authority);
    if (p.meta.capped) capped = true;
    if (p.state === "partial") {
      partial = true;
      if (!missing.includes(p.missing)) missing.push(p.missing);
    }
  }
  return { providers, authorities, capped, partial, missing };
}

/**
 * Closed, total, and monotone DOWNWARD: degrading any input can only lower the answer. The
 * permutation test in `finance.test.ts` asserts that over every authority subset x degradation
 * combination, which is what stops a future edit turning "we only saw part of it" into a promotion.
 */
export function confidenceFor(c: Coverage): FinanceConfidence {
  if (c.authorities.length === 0) return "unavailable";
  const degraded = c.capped || c.partial || c.missing.length > 0;
  if (c.authorities.includes("accounting_authority")) return degraded ? "medium" : "high";
  if (
    c.authorities.includes("payment_rail") ||
    c.authorities.includes("user_confirmed_obligation")
  ) {
    return degraded ? "low" : "medium";
  }
  // Supplemental only (a CRM deal stage). Never a basis for a confident number.
  return "low";
}

export const financeResult = <T>(value: T, coverage: Coverage): FinanceResult<T> => ({
  value,
  coverage,
  confidence: confidenceFor(coverage),
  notice: DECISION_SUPPORT_NOTICE,
});

/**
 * Bridge to `@pikar/core`'s single-currency `CashFigure`, for the existing cash panel and finance
 * spine. Only legal for a figure the caller has already confirmed is USD — core's `CashUnit` has
 * no currency, so anything else would lose the code and print a dollar sign over euros.
 */
export function toCashFigure(figure: Figure<Money>): CashFigure {
  if (figure.state !== "known") return figure;
  if (figure.value.currency !== "USD") {
    return notComputable(
      `this figure is in ${figure.value.currency}, and the cash panel only reports USD`,
    );
  }
  return knownFigure(figure.origin, Number(formatMoneyAmount(figure.value)), "usd", {
    ...(figure.actor === undefined ? {} : { actor: figure.actor }),
    ...(figure.from === undefined ? {} : { from: figure.from }),
  });
}
