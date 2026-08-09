// Cost Console component contracts, in the DOM-free runner.
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, and a
// `.tsx` here would be silently skipped AND would need a DOM. Components are built with
// `createElement` and rendered to a STRING with `renderToStaticMarkup`, which is what keeps the file
// `.ts` and needs no jsdom. Only the hook-free exports are importable; anything calling
// `useQuery`/`useMutation` is module-private in `FinanceView.tsx` on purpose.
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  BudgetControl,
  ControlRow,
  CoverageClampNotice,
  coverageCopy,
  DeploymentSection,
  FinanceStateNotice,
  formatUsd,
  formatUsdCents,
  formatUtcDay,
  MediaLedgerTable,
  RailTile,
  SpendSeriesTable,
  TrackedTotals,
  unlandedCopy,
} from "./FinanceView";

// ONE cast, here, so the fixtures below stay readable. These tests assert RENDERED OUTPUT; the prop
// TYPES are enforced where the components are actually used, in `FinanceView.tsx`, against the
// generated Convex API — so a fixture drifting from the real shape shows up there, not by making
// every fixture in this file a fully-annotated `DashboardMoney` literal.
const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const money = (phase: string, amountCents: number) => ({ phase, amountCents, currency: "USD" });
const totals = (over: Partial<Record<string, number>> = {}) => ({
  estimated: money("estimated", over.estimated ?? 0),
  reserved: money("reserved", over.reserved ?? 0),
  actual: money("actual", over.actual ?? 0),
  refunded: money("refunded", over.refunded ?? 0),
  unlanded: money("unlanded", over.unlanded ?? 0),
});

const rail = (over: Record<string, unknown> = {}) => ({
  rail: "reasoning",
  remainingCents: 186,
  capCents: 500,
  usedCents: 314,
  resetsAtMs: Date.UTC(2026, 7, 10, 0, 0, 0),
  resetTimeZone: "UTC",
  ...over,
});

describe("money formatting", () => {
  test("integer cents render as USD, including the sub-dollar and zero cases", () => {
    expect(formatUsdCents(186)).toBe("$1.86");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(5)).toBe("$0.05");
    expect(formatUsdCents(10_000)).toBe("$100.00");
  });

  test("the per-request budget keeps its tenth-of-a-cent precision", () => {
    // The backend normalizes to 0.001, so a 2-decimal formatter would show $0.12 for a stored
    // 0.123 and the owner would be editing a value they were never shown.
    expect(formatUsd(0.123)).toBe("$0.123");
    expect(formatUsd(0.05)).toBe("$0.05");
  });
});

describe("page states", () => {
  test.each([
    ["loading", "Loading cost"],
    ["empty", "No cost recorded"],
    ["partial", "a floor"],
    ["unknown", "Unknown"],
    ["busy", "Applying"],
    ["error", "Couldn’t load cost"],
    ["refusal", "Nothing changed"],
  ] as const)("renders an announced %s state", (state, copy) => {
    const html = render(FinanceStateNotice, { state });
    expect(html).toContain(copy);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe("unknown history is never a number", () => {
  test("both coverage reasons explain the gap without stating an amount", () => {
    expect(coverageCopy("not-started", null)).toContain("Unknown");
    expect(coverageCopy("not-started", null)).not.toContain("$");
    expect(coverageCopy("window-precedes-coverage", Date.UTC(2026, 7, 1))).not.toContain("$");
  });

  test("an unknown window renders NO currency figure at all", () => {
    const html = render(TrackedTotals, {
      tracked: { coverage: "unknown", reason: "window-precedes-coverage" },
      coverageStartedAt: Date.UTC(2026, 7, 1),
      unlandedResolves: { reasoning: true, ingest: true, media: false },
      partial: false,
    });
    // A zero here is indistinguishable from a watched period in which nothing was spent. The
    // absence of `$` is the assertion — this is the lie the whole ledger exists to prevent.
    expect(html).not.toContain("$");
    expect(html).toContain("Unknown");
    expect(html).toContain("cannot be reconstructed");
  });

  test("a shortened window NAMES its own truncation", () => {
    // Found by the 26-10 UAT: a fixed 30-day window over a tenant covered since yesterday reported
    // the whole period Unknown while the series below it showed real money on a covered day. The
    // page now clamps to the coverage start — which is only honest because it says so. A clamp that
    // renders nothing is the silent-narrower-window failure the coverage field exists to prevent.
    const startedAt = Date.UTC(2026, 7, 8);
    const html = render(CoverageClampNotice, { startedAt });
    expect(html).toContain("Showing since");
    // Via the same formatter, not a hardcoded string: Node's default locale renders "8 Aug 2026"
    // where the browser renders "Aug 8, 2026", and pinning either one makes this fail on a machine
    // whose locale differs rather than on a real regression.
    expect(html).toContain(formatUtcDay(startedAt));
    expect(html).toContain("when cost tracking began");
    expect(html).toContain("cannot be reconstructed");
    expect(html).toContain('role="status"');
    expect(html).toContain('data-finance-state="clamped"');
  });

  test("a covered but empty window DOES state a confident zero", () => {
    const html = render(TrackedTotals, {
      tracked: {
        coverage: "covered",
        totals: totals(),
        byRail: { reasoning: totals(), ingest: totals(), media: totals() },
      },
      coverageStartedAt: Date.UTC(2026, 7, 1),
      unlandedResolves: { reasoning: true, ingest: true, media: false },
      partial: false,
    });
    // The opposite lie from the one above: with coverage open, nothing spent IS $0.00.
    expect(html).toContain("$0.00");
    expect(html).not.toContain("Unknown");
  });
});

describe("unlanded means two different things", () => {
  test("a resolving rail is in flight; media's is permanent", () => {
    expect(unlandedCopy(true)).toContain("still expected");
    expect(unlandedCopy(false)).toContain("permanent");
    expect(unlandedCopy(false)).toContain("no refund path");
    // The media sentence may SAY "not pending"; what it must never do is promise resolution.
    expect(unlandedCopy(false)).not.toContain("still expected");
  });

  test("the per-rail notes use the rail's own resolution fact, not one blended sentence", () => {
    const html = render(TrackedTotals, {
      tracked: {
        coverage: "covered",
        totals: totals({ reserved: 1_200, actual: 152, refunded: 400, unlanded: 690 }),
        byRail: {
          reasoning: totals({ actual: 42 }),
          ingest: totals({ reserved: 900, refunded: 400, unlanded: 500 }),
          media: totals({ reserved: 300, actual: 110, unlanded: 190 }),
        },
      },
      coverageStartedAt: Date.UTC(2026, 7, 1),
      unlandedResolves: { reasoning: true, ingest: true, media: false },
      partial: false,
    });
    expect(html).toContain("$5.00 unlanded");
    expect(html).toContain("$1.90 unlanded");
    // Both sentences must be present — one page, two meanings.
    expect(html).toContain("still expected");
    expect(html).toContain("no refund path");
    // The blended total is the SUM of the per-rail figures, shown but never re-explained.
    expect(html).toContain("$6.90");
    expect(html).toContain("All rails");
  });

  test("a capped window says its totals are a floor", () => {
    const html = render(TrackedTotals, {
      tracked: {
        coverage: "covered",
        totals: totals({ actual: 100 }),
        byRail: { reasoning: totals({ actual: 100 }), ingest: totals(), media: totals() },
      },
      coverageStartedAt: 0,
      unlandedResolves: { reasoning: true, ingest: true, media: false },
      partial: true,
    });
    expect(html).toContain("a floor");
    expect(html).toContain('data-finance-state="partial"');
  });
});

describe("budget rails", () => {
  test("the meter is never the only carrier of how much is left", () => {
    const html = render(RailTile, { rail: rail() });
    expect(html).toContain("$1.86");
    // The same fact in words, for anyone who cannot see the bar (BRAND §6).
    expect(html).toContain("63% used");
    expect(html).toContain("left of $5.00 today");
    expect(html).toContain("<progress");
    expect(html).toContain(
      'aria-label="Reasoning &amp; drafting: 63% of today&#x27;s budget used"',
    );
  });

  test("the reset instant is labelled UTC — the enforcement clock, not the browser's", () => {
    const html = render(RailTile, { rail: rail() });
    expect(html).toContain("(UTC)");
  });

  test("each rail names its own budget rather than a combined ceiling", () => {
    expect(render(RailTile, { rail: rail({ rail: "media", capCents: 1_000 }) })).toContain(
      "Media generation",
    );
    expect(render(RailTile, { rail: rail({ rail: "ingest", capCents: 2_500 }) })).toContain(
      "Vault ingest",
    );
  });
});

describe("the series admits its gaps per day", () => {
  test("a pre-coverage bucket reads Unknown while a covered one reads its amount", () => {
    const html = render(SpendSeriesTable, {
      buckets: [
        { startMs: Date.UTC(2026, 7, 1), coverage: "unknown", reason: "window-precedes-coverage" },
        {
          startMs: Date.UTC(2026, 7, 2),
          coverage: "covered",
          totals: totals({ actual: 250 }),
          byRail: { reasoning: totals(), ingest: totals(), media: totals({ actual: 250 }) },
        },
      ],
    });
    expect(html).toContain("Unknown");
    expect(html).toContain("$2.50");
    expect(html).toContain("Landed cost per UTC day");
  });
});

describe("media ledger", () => {
  test("renders refs, phases and money — and nothing a person typed", () => {
    const html = render(MediaLedgerTable, {
      items: [
        {
          id: "row1",
          createdAt: Date.UTC(2026, 7, 8),
          phase: "actual",
          amountCents: 84,
          currency: "USD",
          correlationId: "mediabatch:b1:j1",
          mediaJobId: null,
          model: "wan-2.5",
          kind: "video",
        },
      ],
    });
    expect(html).toContain("Landed");
    expect(html).toContain("$0.84");
    expect(html).toContain("mediabatch:b1:j1");
    expect(html).toContain("video");
  });
});

describe("the deployment section is role-shaped", () => {
  const controls = {
    masterKillSwitch: { on: false, requiresConfirmation: true },
    mediaKillSwitch: { on: true, requiresConfirmation: true },
    budgetUsdPerRequest: {
      usd: 0.05,
      minUsd: 0.001,
      maxUsd: 5,
      requiresConfirmation: true,
    },
    updatedAt: Date.UTC(2026, 7, 8),
    stored: true,
  };
  const globalRails = {
    rails: [
      rail({ rail: "reasoning", capCents: 5_000, remainingCents: 2_380, usedCents: 2_620 }),
      rail({ rail: "media", capCents: 10_000, remainingCents: 7_620, usedCents: 2_380 }),
      rail({ rail: "ingest", capCents: 25_000, remainingCents: 25_000, usedCents: 0 }),
    ],
  };
  const noop = () => undefined;
  const base = {
    controls,
    globalRails,
    busy: false,
    refusal: null,
    onToggleMaster: noop,
    onToggleMedia: noop,
    onSaveBudget: noop,
  };

  test("a NON-owner sees no ceiling, no utilization and no switch state", () => {
    const html = render(DeploymentSection, { ...base, isOwner: false });
    expect(html).toContain("managed by the operator");
    // No deployment VALUE and no switch POSITION may reach a non-owner's DOM. Naming that the
    // controls exist is product copy; saying a ceiling is $50 or a switch is On is a global fact,
    // and that is what the ownerQuery wrappers protect. This asserts the page leaks neither.
    expect(html).not.toContain("$");
    expect(html).not.toContain("Off —");
    expect(html).not.toContain("On —");
    expect(html).not.toContain("% used");
    expect(html).not.toContain("<progress");
    expect(html).not.toContain("<button");
  });

  test("an owner sees each ceiling separately, never one combined limit", () => {
    const html = render(DeploymentSection, { ...base, isOwner: true });
    expect(html).toContain("$50.00");
    expect(html).toContain("$100.00");
    expect(html).toContain("$250.00");
    expect(html).toContain("there is no single combined limit");
  });

  test("owner controls show the returned effective state, not the argument", () => {
    const html = render(DeploymentSection, { ...base, isOwner: true });
    expect(html).toContain("Off — model calls permitted within budget.");
    expect(html).toContain("On — paid generation is paused.");
    expect(html).toContain("Now $0.05");
    expect(html).toContain("allowed $0.001 to $5.00");
  });

  test("a refusal is shown in place, not thrown at the error boundary", () => {
    const html = render(DeploymentSection, {
      ...base,
      isOwner: true,
      refusal: "That control is owner-only. Nothing changed.",
    });
    expect(html).toContain('data-finance-state="refusal"');
    expect(html).toContain("owner-only");
  });

  test("controls are still loading while the owner query has not resolved", () => {
    const html = render(DeploymentSection, {
      ...base,
      isOwner: true,
      controls: undefined,
      globalRails: undefined,
    });
    expect(html).toContain('data-finance-state="loading"');
  });
});

describe("a deployment-wide change takes two deliberate steps", () => {
  test("a confirmation-required control offers the action first, never the commit", () => {
    const html = render(ControlRow, {
      label: "Master kill switch",
      description: "Stops every model call for every tenant.",
      state: "Off",
      actionLabel: "Turn on",
      requiresConfirmation: true,
      busy: false,
      onConfirm: () => undefined,
    });
    expect(html).toContain("Turn on");
    // `requiresConfirmation` is a BACKEND fact. One click must not pause every tenant.
    expect(html).not.toContain("Confirm");
  });

  test("a control that does not require confirmation commits directly", () => {
    const html = render(ControlRow, {
      label: "Master kill switch",
      description: "…",
      state: "Off",
      actionLabel: "Turn on",
      requiresConfirmation: false,
      busy: false,
      onConfirm: () => undefined,
    });
    expect(html).toContain("Confirm");
  });

  test("a busy control says so and cannot be clicked again", () => {
    const html = render(ControlRow, {
      label: "Master kill switch",
      description: "…",
      state: "Off",
      actionLabel: "Turn on",
      requiresConfirmation: false,
      busy: true,
      onConfirm: () => undefined,
    });
    expect(html).toContain("Applying");
    expect(html).toContain("disabled");
  });

  test("the budget input carries the backend's own range", () => {
    const html = render(BudgetControl, {
      controls: {
        masterKillSwitch: { on: false, requiresConfirmation: true },
        mediaKillSwitch: { on: false, requiresConfirmation: true },
        budgetUsdPerRequest: { usd: 0.05, minUsd: 0.001, maxUsd: 5, requiresConfirmation: true },
        updatedAt: null,
        stored: false,
      },
      busy: false,
      onSave: () => undefined,
    });
    expect(html).toContain('min="0.001"');
    expect(html).toContain('max="5"');
    expect(html).toContain('type="number"');
  });
});

import { FINANCE_TABS, visibleTabs } from "./FinanceTabs";

describe("finance tabs", () => {
  test("Business leads, because the business's money outranks the tool's bill", () => {
    expect(FINANCE_TABS[0]?.id).toBe("business");
    expect(FINANCE_TABS.map((t) => t.id)).toEqual(["business", "spend", "operator"]);
  });

  test("a non-owner is offered no Operator tab at all", () => {
    const ids = visibleTabs(false).map((t) => t.id);
    expect(ids).toEqual(["business", "spend"]);
    expect(ids).not.toContain("operator");
  });

  test("an owner is offered all three", () => {
    expect(visibleTabs(true).map((t) => t.id)).toEqual(["business", "spend", "operator"]);
  });

  test("exactly one tab is owner-only — hiding more would hide tenant data from a tenant", () => {
    expect(FINANCE_TABS.filter((t) => t.ownerOnly).map((t) => t.id)).toEqual(["operator"]);
  });

  test("every tab carries its own sub-heading, so the page frame covers both planes", () => {
    for (const tab of FINANCE_TABS) expect(tab.subheading.length).toBeGreaterThan(10);
  });
});
