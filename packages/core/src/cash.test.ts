import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FUNDING_STATES, TIERS } from "./businessProfile";
import {
  activityFromSends,
  CASH_INPUTS,
  cashInputSpec,
  cashInputsForTier,
  metricSetFor,
  needsConfirmation,
  requireInputs,
  solvency,
  statedFigure,
  toCashInputs,
  unitEconomics,
  validateCashInput,
} from "./cash";
import type { Scorecard } from "./growth/scorecard";
import { emptyScorecard } from "./growth/scorecard";

const DAY = 24 * 60 * 60 * 1000;
// A fixed UTC instant, so the test never depends on the machine's clock or zone.
const NOW = Date.UTC(2026, 7, 9, 15, 30, 0);
const day = (offset: number) => Date.UTC(2026, 7, 9 - offset, 9, 0, 0);

describe("activityFromSends", () => {
  test("counts sends into UTC days, newest first, with no gaps in the window", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(0), day(1), day(3)],
      sinceMs: NOW - 4 * DAY,
      nowMs: NOW,
    });
    expect(result.perDay.map((d) => d.count)).toEqual([2, 1, 0, 1, 0]);
    expect(result.todayCount).toBe(2);
  });

  test("the streak counts consecutive days with at least one send, ending today", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(2), day(4)],
      sinceMs: NOW - 6 * DAY,
      nowMs: NOW,
    });
    expect(result.streakDays).toBe(3);
  });

  test("a day with no sends today ends the streak at zero, never at yesterday's value", () => {
    // Reporting "3-day streak" to someone who has not sent today is the flattering lie the
    // activity row exists to avoid: the row is a prompt to act, not a trophy.
    const result = activityFromSends({
      sentAtMs: [day(1), day(2), day(3)],
      sinceMs: NOW - 6 * DAY,
      nowMs: NOW,
    });
    expect(result.streakDays).toBe(0);
  });

  test("no sends at all is a real measured zero, not unknown", () => {
    const result = activityFromSends({ sentAtMs: [], sinceMs: NOW - 2 * DAY, nowMs: NOW });
    expect(result.todayCount).toBe(0);
    expect(result.streakDays).toBe(0);
    expect(result.perDay).toHaveLength(3);
  });

  test("a send outside the window is ignored rather than folded into the first bucket", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(30)],
      sinceMs: NOW - 2 * DAY,
      nowMs: NOW,
    });
    expect(result.perDay.reduce((sum, d) => sum + d.count, 0)).toBe(1);
  });

  test("last7Count sums exactly the newest 7 days — pinned against both an 8-day and an 11-day sum", () => {
    // 11-day window (offsets 0..10). Sends land on offsets 0,1,1,2,6,6,7,8 — one send on offset 7,
    // the day RIGHT AFTER the 7-day cutoff, so an off-by-one that includes it (slice(0, 8)) is
    // caught: the 7-day sum (offsets 0-6) is 6, the 8-day sum (offsets 0-7) is 7, and the whole
    // 11-day window is 8. Three different numbers pin both the lower edge (todayCount, below) and
    // the upper edge of the 7-day window, so a wrong slice direction OR a wrong window length (7
    // vs 8 vs the whole window) all show up as a failure here.
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(1), day(2), day(6), day(6), day(7), day(8)],
      sinceMs: NOW - 10 * DAY,
      nowMs: NOW,
    });
    expect(result.todayCount).toBe(1);
    const eightDaySum = result.perDay.slice(0, 8).reduce((sum, d) => sum + d.count, 0);
    expect(eightDaySum).toBe(7);
    const wholeWindowSum = result.perDay.reduce((sum, d) => sum + d.count, 0);
    expect(wholeWindowSum).toBe(8);
    expect(result.last7Count).toBe(6);
    expect(result.last7Count).not.toBe(result.todayCount);
    expect(result.last7Count).not.toBe(eightDaySum);
    expect(result.last7Count).not.toBe(wholeWindowSum);
  });

  test("a window shorter than 7 days sums only the days that exist", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(2)],
      sinceMs: NOW - 2 * DAY,
      nowMs: NOW,
    });
    expect(result.perDay).toHaveLength(3);
    expect(result.last7Count).toBe(3);
  });
});

describe("input validation at the trust boundary", () => {
  test("purchases per lifetime below 1 is REJECTED, not silently multiplied", () => {
    // Multiplying gross profit by 0.5 purchases produces a plausible-looking LTGP that is wrong.
    expect(validateCashInput("purchasesPerLifetime", 0.5)).toEqual({
      ok: false,
      reason: expect.stringMatching(/at least 1/i),
    });
    expect(validateCashInput("purchasesPerLifetime", 1)).toEqual({ ok: true });
  });

  test("money cannot be negative, infinite or NaN", () => {
    expect(validateCashInput("cashOnHand", -1).ok).toBe(false);
    expect(validateCashInput("cashOnHand", Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(validateCashInput("cashOnHand", Number.NaN).ok).toBe(false);
    expect(validateCashInput("cashOnHand", 0)).toEqual({ ok: true });
  });

  test("a percentage is bounded to 0-100", () => {
    expect(validateCashInput("referralPct", 101).ok).toBe(false);
    expect(validateCashInput("referralPct", 25)).toEqual({ ok: true });
  });

  test("a customer count is a whole number", () => {
    expect(validateCashInput("customerCount", 4.5).ok).toBe(false);
    expect(validateCashInput("customerCount", 4)).toEqual({ ok: true });
  });

  test("every input names what it unlocks — a field with no payoff should not be asked for", () => {
    for (const spec of CASH_INPUTS) expect(spec.unlocks.length).toBeGreaterThan(0);
  });

  test("no input is stored in two places", () => {
    const fields = CASH_INPUTS.map((spec) => spec.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

const state = (field: string, over: Record<string, unknown> = {}) =>
  ({
    field,
    value: 100,
    statedAt: NOW - DAY,
    stale: false,
    origin: "stated",
    actor: "user",
    basis: null,
    ...over,
  }) as never;

describe("the four truths", () => {
  test("an unanswered input is unknown and NAMES what is missing", () => {
    const figure = statedFigure(undefined, cashInputSpec("cac"), NOW);
    expect(figure).toEqual({
      state: "unknown",
      needs: expect.stringContaining("Customer acquisition cost"),
    });
  });

  test("a real zero is KNOWN, not unknown — measured nothing is an answer", () => {
    const figure = statedFigure(state("cac", { value: 0 }), cashInputSpec("cac"), NOW);
    expect(figure).toMatchObject({ state: "known", origin: "stated", value: 0 });
  });

  test("a stated input carries when it was said", () => {
    const figure = statedFigure(state("cac"), cashInputSpec("cac"), NOW);
    expect(figure).toMatchObject({
      state: "known",
      origin: "stated",
      statedAt: NOW - DAY,
      stale: false,
    });
  });

  test("past 90 days it is flagged stale rather than silently used", () => {
    const old = state("cac", { statedAt: NOW - 91 * DAY, stale: true });
    expect(statedFigure(old, cashInputSpec("cac"), NOW)).toMatchObject({ stale: true });
  });

  test("a fresh statedAt is NOT stale", () => {
    const figure = statedFigure(state("cac", { statedAt: NOW - DAY }), cashInputSpec("cac"), NOW);
    expect(figure).toMatchObject({ stale: false });
  });

  test("an answered input with UNKNOWN age needs confirmation — not fresh, and no fabricated date", () => {
    const figure = statedFigure(state("cac", { statedAt: null }), cashInputSpec("cac"), NOW);
    expect(figure).toMatchObject({ state: "known", origin: "stated", stale: true });
    expect(figure).not.toHaveProperty("statedAt");
  });

  test("a derived figure is SUPPRESSED when any input is unknown, and names the missing one", () => {
    const inputs = toCashInputs([state("cac")]);
    const blocked = requireInputs(inputs, ["cac", "thirtyDayCashPerCustomer"]);
    expect(blocked).toEqual({
      state: "unknown",
      needs: expect.stringContaining("30-day cash per customer"),
    });
  });

  test("with every input present nothing is suppressed", () => {
    const inputs = toCashInputs([state("cac"), state("thirtyDayCashPerCustomer")]);
    expect(requireInputs(inputs, ["cac", "thirtyDayCashPerCustomer"])).toBeNull();
  });

  test("the FIRST missing input is named, so the prompt is one ask and not a list", () => {
    const blocked = requireInputs(toCashInputs([]), ["cac", "thirtyDayCashPerCustomer"]);
    expect(blocked).toMatchObject({ needs: expect.stringContaining("Customer acquisition cost") });
  });
});

// `needsConfirmation` is THE single staleness rule — `statedFigure` above and `convex/cash.ts`'s
// `inputs` query (both its `financeInputs` and its scorecard branch) all call this one function
// rather than re-deriving it. Pinned directly so a future edit to either caller can't reintroduce
// a second, disagreeing definition.
describe("needsConfirmation — the one staleness rule every caller routes through", () => {
  test("an absent value is not stale — it is unknown, a different truth entirely", () => {
    expect(needsConfirmation(null, null, NOW)).toBe(false);
    expect(needsConfirmation(null, NOW - 91 * DAY, NOW)).toBe(false);
  });

  test("a present value with unknown age (statedAt: null) needs confirmation", () => {
    expect(needsConfirmation(100, null, NOW)).toBe(true);
  });

  test("a present value older than 90 days needs confirmation", () => {
    expect(needsConfirmation(100, NOW - 91 * DAY, NOW)).toBe(true);
  });

  test("a present value within 90 days does not need confirmation", () => {
    expect(needsConfirmation(100, NOW - DAY, NOW)).toBe(false);
  });
});

const withInputs = (values: Record<string, number>) =>
  toCashInputs(
    Object.entries(values).map(([field, value]) => ({
      field,
      value,
      statedAt: NOW - DAY,
      stale: false,
      origin: "stated",
      actor: "user",
      basis: null,
    })) as never,
  );

const scorecardWith = (over: Record<string, unknown> = {}) => ({
  ...emptyScorecard,
  financials: { ...emptyScorecard.financials, ...over },
});

describe("unit economics", () => {
  test("CFA is derived from 30-day cash against CAC, and says so", () => {
    const result = unitEconomics({
      inputs: withInputs({ cac: 100, thirtyDayCashPerCustomer: 250 }),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.cfa).toMatchObject({ state: "known", origin: "derived", value: 2.5 });
    expect((result.cfa as { from: string }).from).toMatch(/250/);
    expect((result.cfa as { from: string }).from).toMatch(/100/);
  });

  test("LTGP:CAC carries its sample size", () => {
    const result = unitEconomics({
      inputs: withInputs({
        cac: 1400,
        grossProfitPerPurchase: 1500,
        purchasesPerLifetime: 3,
        customerCount: 4,
      }),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.ltgpCac).toMatchObject({ state: "known", value: 3.21, sampleSize: 4 });
  });

  test("an unrecorded sample size is null and never omitted", () => {
    const result = unitEconomics({
      inputs: withInputs({ cac: 1400, grossProfitPerPurchase: 1500, purchasesPerLifetime: 3 }),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.ltgpCac).toMatchObject({ state: "known", sampleSize: null });
  });

  test("CAC of zero is NOT-COMPUTABLE, never infinity and never unknown", () => {
    const result = unitEconomics({
      inputs: withInputs({
        cac: 0,
        thirtyDayCashPerCustomer: 250,
        grossProfitPerPurchase: 10,
        purchasesPerLifetime: 2,
      }),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.cfa).toEqual({
      state: "not-computable",
      because: expect.stringMatching(/no acquisition cost recorded/i),
    });
    expect(result.ltgpCac).toMatchObject({ state: "not-computable" });
    expect(JSON.stringify(result)).not.toContain("Infinity");
  });

  test("a missing input suppresses the derived figure and names it", () => {
    const result = unitEconomics({
      inputs: withInputs({ cac: 100 }),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.cfa).toMatchObject({
      state: "unknown",
      needs: expect.stringContaining("30-day cash"),
    });
  });

  test("LTGP prefers the two components and says what it came from", () => {
    const result = unitEconomics({
      inputs: withInputs({ grossProfitPerPurchase: 1500, purchasesPerLifetime: 3 }),
      scorecard: scorecardWith({ ltgp: 9999 }),
      nowMs: NOW,
    });
    expect(result.ltgp).toMatchObject({ state: "known", origin: "derived", value: 4500 });
  });

  test("with no components it falls back to a stated LTGP", () => {
    const result = unitEconomics({
      inputs: withInputs({}),
      scorecard: scorecardWith({ ltgp: 4500 }),
      nowMs: NOW,
    });
    expect(result.ltgp).toMatchObject({ state: "known", origin: "stated", value: 4500 });
  });

  test("CAC payback is months, from CAC over monthly gross profit per customer", () => {
    const result = unitEconomics({
      inputs: withInputs({
        cac: 1200,
        grossProfitPerPurchase: 300,
        purchasesPerLifetime: 4,
        customerCount: 10,
      }),
      scorecard: scorecardWith({ churnByCadence: { monthly: 5, quarterly: null, annual: null } }),
      nowMs: NOW,
    });
    expect(result.cacPayback).toMatchObject({ state: "known", unit: "months" });
  });

  test("the industry-CAC switch is OFF until the user supplies the average — never a pass", () => {
    const result = unitEconomics({
      inputs: withInputs({ cac: 1400 }),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.cacVsIndustry).toMatchObject({
      state: "unknown",
      needs: expect.stringMatching(/industry/i),
    });
    expect(JSON.stringify(result.cacVsIndustry)).not.toMatch(/pass|within|healthy/i);
  });

  test("with an industry average supplied it compares against 3x", () => {
    const result = unitEconomics({
      inputs: withInputs({ cac: 1400 }),
      scorecard: scorecardWith({ industryAvgCac: 600 }),
      nowMs: NOW,
    });
    expect(result.cacVsIndustry).toMatchObject({ state: "known", origin: "derived" });
  });

  // referralPct is a real CashInputField (CASH_INPUTS) with its own CashInputState, unlike
  // grossMargin/cohortChurn below — it must go through the SAME staleness rule every other stated
  // cash input does, not read the scorecard directly and skip the check.
  test("referralPct older than STALE_AFTER_MS needs confirmation", () => {
    const result = unitEconomics({
      inputs: toCashInputs([
        {
          field: "referralPct",
          value: 25,
          statedAt: NOW - 91 * DAY,
          stale: true,
          origin: "stated",
          actor: "user",
          basis: null,
        },
      ] as never),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.referralPct).toMatchObject({ state: "known", origin: "stated", stale: true });
  });

  test("referralPct with a present value and unknown age needs confirmation, no fabricated date", () => {
    const result = unitEconomics({
      inputs: toCashInputs([
        {
          field: "referralPct",
          value: 25,
          statedAt: null,
          stale: true,
          origin: "stated",
          actor: "user",
          basis: null,
        },
      ] as never),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.referralPct).toMatchObject({ state: "known", origin: "stated", stale: true });
    expect(result.referralPct).not.toHaveProperty("statedAt");
  });

  test("referralPct absent is unknown, not stale", () => {
    const result = unitEconomics({
      inputs: withInputs({}),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.referralPct).toEqual({
      state: "unknown",
      needs: expect.stringContaining("Referral share"),
    });
  });

  // grossMargin/cohortChurn are not CashInputFields — no staleness signal exists to attach (see the
  // ponytail comment in cash.ts). Minimal known/null coverage only, closing the gap the review found.
  test("grossMargin and cohortChurn: known when the scorecard has them", () => {
    const result = unitEconomics({
      inputs: withInputs({}),
      scorecard: scorecardWith({
        grossMarginPct: 40,
        churnByCadence: { monthly: 5, quarterly: null, annual: null },
      }),
      nowMs: NOW,
    });
    expect(result.grossMargin).toMatchObject({ state: "known", origin: "stated", value: 40 });
    expect(result.cohortChurn).toMatchObject({ state: "known", origin: "stated", value: 5 });
  });

  test("grossMargin and cohortChurn: unknown when the scorecard lacks them", () => {
    const result = unitEconomics({
      inputs: withInputs({}),
      scorecard: scorecardWith(),
      nowMs: NOW,
    });
    expect(result.grossMargin).toMatchObject({ state: "unknown" });
    expect(result.cohortChurn).toMatchObject({ state: "unknown" });
  });

  // Whole-branch review B1: `scorecard` arrives from the DB's `v.any()` column and is not
  // guaranteed to match the `Scorecard` type at runtime — a `document-review` row (`voiceDoc.ts`)
  // carries a LITERAL `scorecard: {}`. The unfixed function threw reaching for
  // `scorecard.financials.ltgp` (`Cannot read properties of undefined (reading 'ltgp')`), which
  // took down the whole Finance page via its one shared error boundary. Every `scorecard.financials.*`
  // read must be defensive and report `unknown`, never throw and never a fabricated `$NaN`.
  test("does not throw on a malformed ({}) scorecard, and reports unknown rather than $NaN", () => {
    const run = () =>
      unitEconomics({
        inputs: withInputs({
          cac: 1400,
          thirtyDayCashPerCustomer: 2000,
          grossProfitPerPurchase: 1500,
          purchasesPerLifetime: 3,
        }),
        scorecard: {} as Scorecard,
        nowMs: NOW,
      });
    expect(run).not.toThrow();
    const result = run();
    // LTGP still derives from the two present components — a malformed `financials` only blocks
    // the stated-total FALLBACK, never the derived path.
    expect(result.ltgp).toMatchObject({ state: "known", origin: "derived", value: 4500 });
    // CFA reads `scorecard.financials.costToServicePerCustomer`, defaulted to 0 rather than thrown.
    expect(result.cfa.state).toBe("known");
    // Everything that reads `scorecard.financials.*` with nothing else to fall back on reports
    // unknown, never a fabricated figure.
    expect(result.cacPayback).toMatchObject({ state: "unknown" });
    expect(result.cacVsIndustry).toMatchObject({ state: "unknown" });
    expect(result.grossMargin).toMatchObject({ state: "unknown" });
    expect(result.cohortChurn).toMatchObject({ state: "unknown" });
    expect(JSON.stringify(result)).not.toMatch(/NaN/);
  });

  test("with no ltgp components at all, a malformed scorecard is unknown, never $NaN", () => {
    const run = () =>
      unitEconomics({ inputs: withInputs({}), scorecard: {} as Scorecard, nowMs: NOW });
    expect(run).not.toThrow();
    const result = run();
    expect(result.ltgp).toMatchObject({ state: "unknown" });
    expect(JSON.stringify(result)).not.toMatch(/NaN/);
  });
});

const sol = (values: Record<string, number>, tier = "startup" as const) =>
  solvency({ inputs: withInputs(values), tier, nowMs: NOW });

describe("solvency — the finance-ops layer", () => {
  test("runway is cash over monthly burn, in months", () => {
    // `sol`'s default tier is "startup", where MRR applies (B3 fix) — answered here as a real
    // zero so this stays the plain happy-path test the plan intended, not a suppressed figure.
    const result = sol({ cashOnHand: 60_000, monthlyOperatingCost: 10_000, mrr: 0 });
    expect(result.runway).toMatchObject({ state: "known", value: 6, unit: "months" });
  });

  // Whole-branch review B3: `netBurn`/`runway` used to read an UNANSWERED `mrr` as a real zero,
  // so a funded startup with real MRR they had not entered saw net burn equal to the full
  // operating cost and a runway shorter than the truth — violating the module's own suppression
  // contract (`requireInputs`'s doc comment: a derived figure is suppressed while any input it
  // rests on is unknown, and names the missing one).
  test("for a tier where MRR applies, an unanswered MRR suppresses net burn and runway, and names it", () => {
    const result = sol({ cashOnHand: 60_000, monthlyOperatingCost: 10_000 });
    expect(result.netBurn).toMatchObject({
      state: "unknown",
      needs: expect.stringContaining("Monthly recurring revenue"),
    });
    expect(result.runway).toMatchObject({ state: "unknown" });
  });

  // A solopreneur's `mrr` is `not-applicable`, not unknown — demanding it before computing burn
  // would wrongly suppress a runway they are entitled to see (B3 fix must not regress this).
  test("a solopreneur (MRR not-applicable) still gets a runway with no MRR ever asked", () => {
    const result = solvency({
      inputs: withInputs({ cashOnHand: 60_000, monthlyOperatingCost: 10_000 }),
      tier: "solopreneur",
      nowMs: NOW,
    });
    expect(result.runway).toMatchObject({ state: "known", value: 6, unit: "months" });
  });

  test("a monthly cost of zero is NOT infinite runway", () => {
    const result = sol({ cashOnHand: 60_000, monthlyOperatingCost: 0 });
    expect(result.runway).toEqual({
      state: "not-computable",
      because: expect.stringMatching(/no operating cost recorded/i),
    });
    expect(JSON.stringify(result)).not.toContain("Infinity");
  });

  test("zero cash with a real burn is 0 months, never negative", () => {
    // mrr: 0 — see the "runway is cash over monthly burn" test above for why (B3 fix).
    const result = sol({ cashOnHand: 0, monthlyOperatingCost: 5_000, mrr: 0 });
    expect(result.runway).toMatchObject({ state: "known", value: 0 });
  });

  test("a profitable business is NOT BURNING — not a month count", () => {
    const result = sol({ cashOnHand: 60_000, monthlyOperatingCost: 10_000, mrr: 15_000 });
    expect(result.netBurn).toMatchObject({ state: "known", value: 0 });
    expect(result.runway).toEqual({
      state: "not-applicable",
      because: expect.stringMatching(/not burning/i),
    });
  });

  test("ARR is derived from MRR and says so", () => {
    const result = sol({ mrr: 5_000 });
    expect(result.arr).toMatchObject({ state: "known", origin: "derived", value: 60_000 });
    expect((result.arr as { from: string }).from).toMatch(/5,000/);
  });

  test("MRR is NOT-APPLICABLE for a solopreneur — lumpy project revenue has no monthly figure", () => {
    const result = solvency({
      inputs: withInputs({ mrr: 5_000 }),
      tier: "solopreneur",
      nowMs: NOW,
    });
    expect(result.mrr).toMatchObject({ state: "not-applicable" });
    expect(result.arr).toMatchObject({ state: "not-applicable" });
    // The collapse this test exists to prevent: "MRR $0" to a project-based consultant implies a
    // failing subscription business that does not exist.
    expect(result.mrr).not.toMatchObject({ state: "unknown" });
    expect(JSON.stringify(result.mrr)).not.toContain('"value":0');
  });

  test("a startup with no MRR entered is UNKNOWN, not not-applicable", () => {
    expect(sol({ cashOnHand: 1 }).mrr).toMatchObject({ state: "unknown" });
  });

  test("a startup billing nothing this month is a real measured ZERO", () => {
    expect(sol({ mrr: 0 }).mrr).toMatchObject({ state: "known", value: 0 });
  });

  test("working capital is receivables minus payables, and can be negative", () => {
    const result = solvency({
      inputs: withInputs({ receivables: 30_000, payables: 45_000 }),
      tier: "sme",
      nowMs: NOW,
    });
    expect(result.workingCapital).toMatchObject({ state: "known", value: -15_000 });
  });

  test("working capital is not-applicable below SME", () => {
    expect(sol({ receivables: 1, payables: 1 }).workingCapital).toMatchObject({
      state: "not-applicable",
    });
  });

  // mrr is the one field solvency() surfaces directly as a stated figure (runway/netBurn/
  // workingCapital only ever CONSUME cashOnHand/monthlyOperatingCost/receivables/payables through
  // requireInputs+valueOf, same as unitEconomics does for cac/thirtyDayCashPerCustomer/etc. above —
  // it is mrr that must route through statedFigure/needsConfirmation like every other stated cash
  // input, not a hand-rolled check). This plan has shipped a staleness safeguard that failed open
  // three times already (Tasks 3, 4, 5); this pins the fourth call site.
  test("mrr surfaces staleness like every other stated cash input, not a hand-rolled check", () => {
    const result = solvency({
      inputs: toCashInputs([
        {
          field: "mrr",
          value: 5_000,
          statedAt: NOW - 91 * DAY,
          stale: true,
          origin: "stated",
          actor: "user",
          basis: null,
        },
      ] as never),
      tier: "startup",
      nowMs: NOW,
    });
    expect(result.mrr).toMatchObject({ state: "known", origin: "stated", stale: true });
  });

  // recurringApplies/workingCapitalApplies are DERIVED from CASH_INPUTS's own `tiers` lists, not
  // restated as hand-rolled tier comparisons — this pins the agreement BOTH directions, so an edit
  // to the panel's `tiers` (the stated single source of "which tiers see this field") cannot
  // silently leave these two booleans on the old answer while the collection panel asks (or stops
  // asking) the tier for the number.
  test("not-applicable agrees with the catalogue's own tiers list, for every tier", () => {
    for (const tier of TIERS) {
      const result = solvency({
        inputs: withInputs({ mrr: 1, receivables: 1, payables: 1 }),
        tier,
        nowMs: NOW,
      });
      const offersMrr = cashInputsForTier(tier).some((spec) => spec.field === "mrr");
      expect(result.mrr.state === "not-applicable").toBe(!offersMrr);
      const offersWorkingCapital = cashInputsForTier(tier).some(
        (spec) => spec.field === "receivables",
      );
      expect(result.workingCapital.state === "not-applicable").toBe(!offersWorkingCapital);
    }
  });
});

describe("which metrics a tenant sees", () => {
  test("a bootstrapped solopreneur leads with CFA — a customer paying for itself IS survival", () => {
    expect(metricSetFor("solopreneur", "bootstrapped").headline).toBe("cfa");
  });

  test("a funded startup leads with runway — the constraint is the date the money ends", () => {
    expect(metricSetFor("startup", "funded").headline).toBe("runway");
  });

  test("capital posture WINS the headline when it disagrees with the tier", () => {
    // A funded solopreneur leads with runway...
    const fundedSolo = metricSetFor("solopreneur", "funded");
    expect(fundedSolo.headline).toBe("runway");
    // ...and still keeps the solopreneur sets underneath it.
    expect(fundedSolo.activity).toContain("streak");
    expect(fundedSolo.solvency).not.toContain("mrr");

    // A bootstrapped startup leads with CFA and still sees MRR/ARR/burn/runway underneath.
    const bootstrappedStartup = metricSetFor("startup", "bootstrapped");
    expect(bootstrappedStartup.headline).toBe("cfa");
    expect(bootstrappedStartup.solvency).toEqual(
      expect.arrayContaining(["mrr", "arr", "netBurn", "runway"]),
    );
  });

  // Task 9 review: the orphan-headline guard used to prepend EVERY orphan into `solvency`
  // regardless of which row's type actually carries the key. `cfa` is a `CashUnitEconomics`
  // member — `CashSolvency` (the object `cash.solvency` actually returns) has no such field, so it
  // was silently unresolvable there. It must land in `unitEconomics`, the row that owns it, so a
  // bootstrapped startup's "Does each customer pay for itself?" row actually shows CFA and not just
  // the headline card above it.
  test("an orphaned headline is routed to the row that owns its key, not always to solvency", () => {
    const bootstrappedStartup = metricSetFor("startup", "bootstrapped");
    expect(bootstrappedStartup.unitEconomics).toContain("cfa");
    expect(bootstrappedStartup.solvency).not.toContain("cfa");
  });

  test("seeking outside money reads as outside money, like the tier rule already treats it", () => {
    expect(metricSetFor("startup", "seeking").headline).toBe("runway");
  });

  test("a solopreneur is shown activity counts, not ratios they cannot read", () => {
    const set = metricSetFor("solopreneur", "bootstrapped");
    expect(set.activity).toEqual(expect.arrayContaining(["reachOutsPerDay", "streak"]));
    expect(set.solvency).not.toContain("mrr");
    expect(set.solvency).not.toContain("arr");
  });

  test("an SME leads with working capital and sees per-channel unit economics", () => {
    const set = metricSetFor("sme", "bootstrapped");
    expect(set.headline).toBe("workingCapital");
    expect(set.unitEconomics).toEqual(
      expect.arrayContaining(["ltgpCac", "grossMargin", "cohortChurn"]),
    );
  });

  test("ROAS is not a metric key anywhere", () => {
    for (const tier of TIERS) {
      const set = metricSetFor(tier, "bootstrapped");
      expect(JSON.stringify(set).toLowerCase()).not.toContain("roas");
    }
  });

  test("an unknown funding posture falls back to the tier's typical headline, never to a blank", () => {
    expect(metricSetFor("startup", null).headline).toBe("runway");
    expect(metricSetFor("solopreneur", null).headline).toBe("cfa");
  });

  test("every set's headline also appears in one of its rows, so the page never orphans it", () => {
    for (const tier of TIERS) {
      for (const funding of [...FUNDING_STATES, null] as const) {
        const set = metricSetFor(tier, funding);
        const all = [...set.unitEconomics, ...set.solvency, ...set.activity];
        expect(all).toContain(set.headline);
      }
    }
  });
});

// ── The two source-scan guards (Task 10) ────────────────────────────────────────────────────
//
// The idiom `businessProfile.test.ts` and `vaultSurface.test.ts` already use: read the SURFACE as
// source text, because a prohibition on a WORD cannot be asserted any other way. `metricSetFor`'s
// "ROAS is not a metric key anywhere" test above checks the DATA a tier set produces; this checks
// the SOURCE nobody has yet written a line into — the only place a regression could actually land.
const here = dirname(fileURLToPath(import.meta.url));
const SURFACES = [
  resolve(here, "cash.ts"),
  resolve(here, "../../../apps/web/app/(app)/dashboard/finance/CashView.tsx"),
  resolve(here, "../../../apps/web/app/(app)/dashboard/finance/FinanceTabs.tsx"),
  resolve(here, "../../backend/convex/cash.ts"),
];

describe("what this surface must never say", () => {
  test("ROAS appears nowhere", () => {
    // Absent from all three books, and the source says to STOP optimising CAC once inside 3x the
    // industry average. Adding ROAS pushes users toward the lever the framework says to put down.
    for (const file of SURFACES) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\broas\b/i);
    }
  });

  test("no price is displayed", () => {
    // Tier pricing is a separate sub-project. This work only CONSUMES the tier.
    for (const file of SURFACES) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\$(99|297|597)\b/);
      expect(source).not.toMatch(/per month|\/mo\b|upgrade to/i);
    }
  });
});

// ── Task 2: origin is stored on CashInputState, not inferred (Task 3 wires it from the vault) ──
describe("statedFigure returns the stored origin", () => {
  test("statedFigure carries the stored origin rather than assuming 'stated'", () => {
    const spec = cashInputSpec("cashOnHand");
    const figure = statedFigure(
      {
        field: "cashOnHand",
        value: 38_500,
        statedAt: 1_754_000_000_000,
        stale: false,
        origin: "observed",
        actor: "agent",
        basis: "vault:doc_7c2a#p3",
      },
      spec,
      1_754_000_100_000,
    );
    // Brief used `figure.kind`; CashFigure's actual discriminant is `state` (cash.ts:56-92) — see
    // task-2-report.md for the noted deviation.
    expect(figure.state).toBe("known");
    if (figure.state === "known") expect(figure.origin).toBe("observed");
  });

  test("an absent input is unknown regardless of provenance", () => {
    const spec = cashInputSpec("cashOnHand");
    const figure = statedFigure(undefined, spec, 1_754_000_000_000);
    expect(figure.state).toBe("unknown");
  });
});
