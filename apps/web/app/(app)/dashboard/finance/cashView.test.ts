// Business-tab component contracts, in the DOM-free runner.
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, and
// a `.tsx` here would be silently skipped AND would need a DOM. Components are built with
// `createElement` and rendered to a STRING with `renderToStaticMarkup`. Only hook-free exports are
// importable; anything calling `useQuery` stays module-private in `CashView.tsx` on purpose.
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ActivitySection,
  FigureTile,
  HeadlineCard,
  NumbersPanel,
  ShapeMissingNotice,
  SolvencySection,
  UnitEconomicsSection,
} from "./CashView";

const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const DAY = 24 * 60 * 60 * 1000;
const today = Math.floor(Date.UTC(2026, 7, 9, 12, 0, 0) / DAY) * DAY;

const activity = (over: Record<string, unknown> = {}) => ({
  perDay: [
    { dayStartMs: today, count: 4 },
    { dayStartMs: today - DAY, count: 2 },
  ],
  todayCount: 4,
  streakDays: 2,
  // Deliberately distinct from todayCount, so a rendered figure that actually reads last7Count
  // can't be mistaken for one that (bugfully) reads todayCount twice — a plain `toContain("4")`
  // would pass either way.
  last7Count: 6,
  ...over,
});

describe("activity section", () => {
  test("renders the counts the books say matter most at the smallest scale", () => {
    const html = render(ActivitySection, {
      activity: activity(),
      partial: false,
    });
    expect(html).toContain("4");
    expect(html).toContain("2-day streak");
    // Pins the 7-day figure to its OWN value (6), distinct from todayCount (4) — a substring match
    // on "4" alone would also pass if last7Count were wrongly wired to todayCount.
    expect(html).toContain("6 in the last 7 days");
  });

  test("a zero day is a real measured zero, never Unknown", () => {
    const html = render(ActivitySection, {
      activity: activity({
        perDay: [{ dayStartMs: today, count: 0 }],
        todayCount: 0,
        streakDays: 0,
        last7Count: 0,
      }),
      partial: false,
    });
    expect(html).toContain("0");
    expect(html).not.toContain("Unknown");
  });

  test("a capped window says the count is a floor", () => {
    const html = render(ActivitySection, { activity: activity(), partial: true });
    expect(html).toMatch(/floor/i);
  });

  // Whole-branch review B4: `CASH_INPUTS` asks startup/sme/enterprise for "Referral share",
  // promising it "unlocks the 25% referral gate", and `unitEconomics.referralPct`/
  // `REFERRAL_GATE_PCT` already compute and name that gate — but nothing rendered it. This pins
  // that the tile now appears, against the 25% gate, when the caller has a figure to show.
  test("a referralPct figure renders against the 25% gate", () => {
    const html = render(ActivitySection, {
      activity: activity(),
      partial: false,
      referralPct: { state: "known", origin: "stated", value: 30, unit: "percent" },
    });
    expect(html).toContain("Referral share");
    expect(html).toMatch(/25%/);
  });

  test("no referralPct figure (e.g. a solopreneur's tier) renders no referral tile", () => {
    const html = render(ActivitySection, { activity: activity(), partial: false });
    expect(html).not.toContain("Referral share");
  });
});

const input = (over: Record<string, unknown> = {}) => ({
  field: "cashOnHand",
  value: null,
  statedAt: null,
  stale: false,
  ...over,
});

describe("your numbers panel", () => {
  const noop = () => {};

  test("an unanswered input shows what it unlocks, not a zero", () => {
    const html = render(NumbersPanel, {
      inputs: [input()],
      tier: "solopreneur",
      busy: false,
      error: null,
      onSave: noop,
    });
    expect(html).toContain("runway");
    expect(html).not.toContain("$0");
  });

  // A legacy scorecard value (answered before `userProvidedAt` existed) has NO recorded stated
  // time — unknown age, never fabricated as fresh (cash-business-finance Task 3 review fix). This
  // also pins that the row does not crash formatting a null date.
  test("a value with no recorded stated time asks for confirmation, honestly, without a date", () => {
    const html = render(NumbersPanel, {
      inputs: [input({ value: 900, statedAt: null, stale: true })],
      tier: "solopreneur",
      busy: false,
      error: null,
      onSave: noop,
    });
    expect(html).toMatch(/no confirmation date on file/i);
    expect(html).toMatch(/still right|confirm/i);
  });

  test("a stale input asks for a confirm-or-update", () => {
    const html = render(NumbersPanel, {
      inputs: [
        input({ value: 5000, statedAt: Date.now() - 100 * 24 * 60 * 60 * 1000, stale: true }),
      ],
      tier: "solopreneur",
      busy: false,
      error: null,
      onSave: noop,
    });
    expect(html).toMatch(/still right|confirm/i);
  });

  test("a solopreneur is not asked for MRR, receivables or payables", () => {
    const html = render(NumbersPanel, {
      inputs: [input(), input({ field: "mrr" })],
      tier: "solopreneur",
      busy: false,
      error: null,
      onSave: noop,
    });
    expect(html).not.toMatch(/recurring revenue/i);
  });

  test("an SME is asked for receivables and payables", () => {
    const html = render(NumbersPanel, {
      inputs: [input({ field: "receivables" }), input({ field: "payables" })],
      tier: "sme",
      busy: false,
      error: null,
      onSave: noop,
    });
    expect(html).toMatch(/receivables/i);
    expect(html).toMatch(/payables/i);
  });
});

describe("figure rendering — the four truths, on screen", () => {
  test("unknown names the missing input and shows no number", () => {
    const html = render(FigureTile, {
      label: "CFA",
      figure: { state: "unknown", needs: "needs your 30-day cash per customer" },
    });
    expect(html).toContain("30-day cash");
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain(">0<");
  });

  test("not-applicable says the metric does not exist here, and is NOT the word Unknown", () => {
    const html = render(FigureTile, {
      label: "MRR",
      figure: {
        state: "not-applicable",
        because: "Project revenue has no monthly recurring figure.",
      },
    });
    expect(html).toContain("no monthly recurring figure");
    expect(html).not.toMatch(/unknown/i);
    expect(html).not.toMatch(/\$0/);
  });

  test("not-computable states the reason and never renders infinity", () => {
    const html = render(FigureTile, {
      label: "CFA",
      figure: {
        state: "not-computable",
        because: "No acquisition cost recorded, so there is nothing to pay back.",
      },
    });
    expect(html).toContain("No acquisition cost recorded");
    expect(html).not.toContain("Infinity");
    expect(html).not.toMatch(/unknown/i);
  });

  test("a real zero renders as zero", () => {
    const html = render(FigureTile, {
      label: "Runway",
      figure: { state: "known", origin: "derived", value: 0, unit: "months", from: "no cash left" },
    });
    expect(html).toContain("0");
  });

  test("a derived figure always shows what it came from", () => {
    const html = render(FigureTile, {
      label: "LTGP:CAC",
      figure: {
        state: "known",
        origin: "derived",
        value: 3.2,
        unit: "ratio",
        from: "$4,500 lifetime gross profit and $1,400 to acquire",
        sampleSize: 4,
      },
    });
    expect(html).toContain("3.2");
    expect(html).toContain("$4,500");
    expect(html).toContain("4 customers");
  });

  test("a ratio with no recorded sample size SAYS so rather than dropping the caveat", () => {
    const html = render(FigureTile, {
      label: "LTGP:CAC",
      figure: {
        state: "known",
        origin: "derived",
        value: 3.2,
        unit: "ratio",
        from: "x",
        sampleSize: null,
      },
    });
    expect(html).toMatch(/sample size not recorded/i);
  });

  test("a stale stated figure asks for a confirm-or-update", () => {
    const html = render(FigureTile, {
      label: "Cash on hand",
      figure: {
        state: "known",
        origin: "stated",
        value: 5000,
        unit: "usd",
        statedAt: Date.UTC(2026, 1, 1),
        stale: true,
      },
    });
    expect(html).toMatch(/still right|confirm/i);
  });

  // `observed` figures became REACHABLE with the provenance columns (convex/cash.ts's read boundary
  // now reports a grounded scorecard fill as observed). The observed branch used to render a bare
  // "Measured by Pikar." — discarding both `statedAt` and `stale`, so a 200-day-old machine-extracted
  // figure got LESS scrutiny than one the owner typed yesterday. Nothing else in either package fails
  // when that regresses, so it is pinned here.
  test("a stale OBSERVED figure says when it was measured and asks for a confirm-or-update", () => {
    const html = render(FigureTile, {
      label: "Cash on hand",
      figure: {
        state: "known",
        origin: "observed",
        value: 5000,
        unit: "usd",
        statedAt: Date.UTC(2026, 1, 1),
        stale: true,
      },
    });
    expect(html).toMatch(/measured by pikar on/i);
    expect(html).toMatch(/still right|confirm/i);
  });

  test("an observed figure with no measured date still renders, without inventing one", () => {
    const html = render(FigureTile, {
      label: "Cash on hand",
      figure: { state: "known", origin: "observed", value: 5000, unit: "usd", stale: false },
    });
    expect(html).toContain("Measured by Pikar.");
    expect(html).not.toMatch(/still right|confirm/i);
  });
});

describe("the headline", () => {
  test("a bootstrapped tenant is led by CFA, framed as the question it answers", () => {
    const html = render(HeadlineCard, {
      metric: "cfa",
      figure: {
        state: "known",
        origin: "derived",
        value: 2.5,
        unit: "ratio",
        from: "x",
        sampleSize: 4,
      },
      tier: "solopreneur",
      funding: "bootstrapped",
    });
    expect(html).toMatch(/30 days/i);
  });

  test("a funded tenant is led by runway", () => {
    const html = render(HeadlineCard, {
      metric: "runway",
      figure: { state: "known", origin: "derived", value: 6, unit: "months", from: "x" },
      tier: "startup",
      funding: "funded",
    });
    expect(html).toMatch(/6/);
    expect(html).toMatch(/months/i);
  });

  test("a tenant with no business shape is invited to complete it, never gated", () => {
    const html = render(ShapeMissingNotice, {});
    expect(html).toMatch(/business profile|business shape/i);
    expect(html).not.toMatch(/required|must/i);
  });

  // Whole-branch review B2: the caption used to be keyed on `funding === "bootstrapped"` ALONE,
  // so EVERY bootstrapped tenant read "whether each customer pays for itself matters most right
  // now" — including an SME or enterprise, whose actual headline (`metricSetFor`'s clause 2) is
  // `workingCapital`, not `cfa`. The caption must derive from the same `metric` the headline itself
  // is keyed on, so the two cannot drift again.
  test("a bootstrapped SME's caption matches its ACTUAL headline (working capital), not the CFA line", () => {
    const html = render(HeadlineCard, {
      metric: "workingCapital",
      figure: { state: "known", origin: "derived", value: 1000, unit: "usd", from: "x" },
      tier: "sme",
      funding: "bootstrapped",
    });
    expect(html).toMatch(/cash conversion cycle/i);
    expect(html).not.toMatch(/pays for itself/i);
  });

  test("a bootstrapped enterprise's caption also matches working capital, not the CFA line", () => {
    const html = render(HeadlineCard, {
      metric: "workingCapital",
      figure: { state: "known", origin: "derived", value: 2000, unit: "usd", from: "x" },
      tier: "enterprise",
      funding: "bootstrapped",
    });
    expect(html).toMatch(/cash conversion cycle/i);
    expect(html).not.toMatch(/pays for itself/i);
  });
});

const knownFigure = (value: number, unit = "usd") => ({
  state: "known",
  origin: "derived",
  value,
  unit,
  from: "x",
});

// A real `CashSolvency`-shaped record — five fields, matching `packages/core/src/cash.ts`'s type.
const realSolvency = () => ({
  runway: knownFigure(6, "months"),
  netBurn: knownFigure(2000),
  mrr: knownFigure(500),
  arr: knownFigure(6000),
  workingCapital: knownFigure(1000),
});

describe("solvency section", () => {
  test("carries the outside-the-framework frame", () => {
    const html = render(SolvencySection, { solvency: realSolvency(), set: ["runway"] });
    expect(html).toMatch(/not part of the growth framework/i);
  });

  test("an empty set renders nothing, not an empty heading", () => {
    const html = render(SolvencySection, { solvency: {}, set: [] });
    expect(html).toBe("");
  });

  test("a normal set renders one tile per key", () => {
    const html = render(SolvencySection, {
      solvency: realSolvency(),
      set: ["runway", "mrr"],
    });
    expect(html).toContain('data-figure-state="known"');
    expect((html.match(/data-figure-state="known"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/months until the cash runs out/i);
    expect(html).toMatch(/monthly recurring revenue/i);
    // workingCapital/netBurn/arr are in `realSolvency()` but NOT in `set` — never rendered.
    expect(html).not.toMatch(/working capital/i);
  });

  // Task 9 review: `metricSetFor`'s orphan-headline guard used to be able to hand `SolvencySection`
  // a key (`cfa`) that `CashSolvency` structurally cannot carry — fixed at the source in
  // `packages/core/src/cash.ts` (the orphan is now routed to the row that owns it), but this pins
  // the DEFENSIVE side too: a `solvency` object is never handed a key it cannot resolve without the
  // component skipping it cleanly — no crash, no blank tile, no invented figure.
  test("a set key absent from the solvency record is skipped, never crashes or renders blank", () => {
    const html = render(SolvencySection, {
      solvency: realSolvency(),
      set: ["runway", "cfa"],
    });
    expect((html.match(/data-figure-state="known"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-figure="cfa"');
    expect(html).toMatch(/months until the cash runs out/i);
  });
});

/**
 * What this proves and what it does NOT (Task 9 review — the report/playbook asserted isolation in
 * prose only, with no test behind it; whole-branch review B-cleanup fixed the exception gap this
 * comment used to document as NOT true — corrected below):
 *
 * PROVEN here: each section component is a pure function of its OWN props — no shared module state,
 * no prop threading between sections — so one section given empty/degraded data (the render-layer
 * shape of `useQuery` returning `undefined`/an empty result) renders independently of a SIBLING
 * section given full, healthy data in the same pass. This is what `CashTab`'s per-section
 * `Connected*` wrappers rely on: `ConnectedUnitEconomics`'s `cash.unitEconomics` read failing to
 * return data leaves `ConnectedSolvency`/`ConnectedActivity`'s OWN independent `useQuery` calls
 * completely unaffected.
 *
 * NOT proven HERE (this file renders pure components with `renderToStaticMarkup`, never a real React
 * tree with error boundaries), but now TRUE at the composition level: a `useQuery` call THROWING (a
 * real Convex query error, as opposed to returning `undefined` while loading) stays contained to one
 * TAB. `FinanceTabs.tsx` used to mount `CashTab` under `FinanceView.tsx`'s single, page-wide
 * `FinanceErrorBoundary`, shared with the always-mounted `PikarSpendTab` — a thrown exception from
 * ANY section's query unwound to that one shared boundary and took the whole tab tree down with it.
 * Each of the three tab panels (`finance-panel-business`/`-spend`/`-operator`) now carries its OWN
 * `<FinanceView>` boundary, so a thrown exception inside `CashTab` degrades ONLY the Business panel —
 * Pikar spend (and Operator, for an owner) keep rendering. This remains a component-composition fact
 * verified by reading `FinanceTabs.tsx`, not by a DOM-free test here: an error boundary needs a real
 * React tree (`componentDidCatch`) to exercise, which this file's `renderToStaticMarkup` runner
 * cannot do.
 */
describe("section isolation — what is proven and what is not", () => {
  test("a section given empty/degraded data renders independently of a sibling given full data", () => {
    const degradedUnitEconomics = render(UnitEconomicsSection, { economics: {}, keys: [] });
    const healthySolvency = render(SolvencySection, { solvency: realSolvency(), set: ["runway"] });
    const healthyActivity = render(ActivitySection, { activity: activity(), partial: false });

    // The degraded section renders nothing (its own "no data yet" shape) ...
    expect(degradedUnitEconomics).toBe("");
    // ... while its siblings, rendered in the same pass, show their real content untouched.
    expect(healthySolvency).toMatch(/months until the cash runs out/i);
    expect(healthyActivity).toContain("4");
  });
});
