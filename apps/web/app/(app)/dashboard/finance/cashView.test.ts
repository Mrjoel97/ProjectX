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
});
