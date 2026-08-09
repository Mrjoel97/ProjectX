// Business-tab component contracts, in the DOM-free runner.
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, and
// a `.tsx` here would be silently skipped AND would need a DOM. Components are built with
// `createElement` and rendered to a STRING with `renderToStaticMarkup`. Only hook-free exports are
// importable; anything calling `useQuery` stays module-private in `CashView.tsx` on purpose.
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ActivitySection, NumbersPanel } from "./CashView";

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

  test("a stale input asks for a confirm-or-update", () => {
    const html = render(NumbersPanel, {
      inputs: [input({ value: 5000, statedAt: Date.now() - 100 * 24 * 60 * 60 * 1000, stale: true })],
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
