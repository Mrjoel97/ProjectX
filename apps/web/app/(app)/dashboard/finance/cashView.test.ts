// Business-tab component contracts, in the DOM-free runner.
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, and
// a `.tsx` here would be silently skipped AND would need a DOM. Components are built with
// `createElement` and rendered to a STRING with `renderToStaticMarkup`. Only hook-free exports are
// importable; anything calling `useQuery` stays module-private in `CashView.tsx` on purpose.
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ActivitySection } from "./CashView";

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
  });

  test("a zero day is a real measured zero, never Unknown", () => {
    const html = render(ActivitySection, {
      activity: activity({
        perDay: [{ dayStartMs: today, count: 0 }],
        todayCount: 0,
        streakDays: 0,
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
