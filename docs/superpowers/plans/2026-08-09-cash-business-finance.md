# Cash — tier-aware business finance on the Finance page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-09-cash-business-finance-design.md` — read it before Task 1. Everything below implements it; where this plan makes a call the spec left open, it says so under "Assumptions".

**Goal:** Turn `/dashboard/finance` into a three-tab page whose default tab answers "can my business survive, and does each customer pay for itself?" — grounded in the Hormozi spine (CFA, LTGP:CAC) plus a clearly-marked finance-ops layer (runway, burn, MRR/ARR, working capital), with the metric set selected by tier and the headline selected by capital posture.

**Architecture:** All derivation, three-truths resolution, tier→set selection and degenerate guards live in one new pure module `packages/core/src/cash.ts` — the role `spend.ts` plays for the Cost console. `packages/backend/convex/cash.ts` is a thin tenant-scoped adapter that reads the DB and calls those pure functions. The UI (`CashView.tsx`) renders `CashFigure` values and never computes one. The existing Cost console moves into a tab **unchanged**.

**Tech Stack:** TypeScript, Convex (thin adapters via `convex/lib/functions.ts` wrappers), React 19 / Next App Router, Vitest (3 runners: `packages/core`, `packages/backend`, `apps/web`), Playwright for browser evidence.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **CLAUDE.md §1** — domain logic in `packages/*`; `convex/` is a thin adapter. No arithmetic in `CashView.tsx` beyond formatting.
2. **CLAUDE.md §2** — never import `query`/`mutation`/`action` from `./_generated/server`. Import `tenantQuery`/`tenantMutation`/`ownerQuery` from `./lib/functions`. `importGuard.test.ts` enforces this.
3. **CLAUDE.md §4** — audit and log payloads carry refs, ids, hashes and counts only. **A business's cash on hand, CAC or MRR must never appear in an audit payload** (this is exactly the class `tenantProfile.ts:96-102` refuses to log). No new audit events are required by this plan; if you add one, log the field NAME and a boolean, never the value.
4. **CLAUDE.md §9** — every commit that touches a path watched by `docs/playbooks/dashboard-pages.md` also updates that playbook and bumps its `Last verified` line. A Stop hook blocks the turn otherwise. New files under `packages/`/`apps/` must be registered in `docs/playbooks/watch.json` in the task that creates them.
5. **CLAUDE.md §10** — use the `globals.css` CSS variables (`--card`, `--rule`, `--ink`, `--ink-soft`, `--teal-600`, `--held-text`). No new component library. Reuse the inline-`CSSProperties` idiom already in `FinanceView.tsx`. Amber (`--held`) is reserved for the approval gate — do not use it for a stale-input prompt; use `--ink-soft` with an explicit word.
6. **CLAUDE.md graphify** — after code changes: `graphify update .` then `node scripts/extract-convex-edges.mjs`.
7. **Units — the one rule that prevents a whole bug class.** The **business plane** (everything on the Business tab) is USD **dollars** as a plain `number`, matching `scorecard.financials.cac`. The **Pikar-spend plane** is integer USD **cents** (`DashboardMoney` / `createDashboardMoney`). The two never appear in one formula or one formatter. `formatUsdCents` stays cents-only; the business plane gets its own `formatUsdAmount`.
8. **No price is displayed anywhere in this work.** Tier pricing is a separate sub-project. The tier is consumed, never sold.
9. **No ROAS anywhere**, in code, copy, or comments-as-copy. A source scan test in Task 10 enforces it.
10. **The nav label stays `Finance`.** Do not touch `apps/web/app/(app)/layout.tsx`.
11. **The Pikar-spend tab is the shipped Cost console moved intact** — same rails, same coverage clamp, same ledger, same per-rail unlanded wording. Do not reopen any of it. Task 1 moves code; it changes no cost behaviour.
12. **Every section owns its own `useQuery`.** A failing scorecard read takes out unit economics and leaves solvency, activity and the whole Pikar-spend tab standing.
13. **TDD.** Write the failing test, run it, see it fail for the stated reason, then implement. Commit at the end of each task.

### Verification commands

| Scope | Command |
|---|---|
| Pure core | `pnpm --filter @pikar/core test` |
| Convex adapters | `pnpm --filter @pikar/backend test` |
| Web (DOM-free runner) | `pnpm --filter @pikar/web test` |
| Everything | `pnpm test` |
| Types | `pnpm typecheck` |
| Lint/format | `pnpm format` then `pnpm lint` |
| Browser evidence | `pnpm test:e2e` (needs a running deployment — see Task 10) |

---

## Assumptions

The spec left four things unstated that the code cannot leave unstated. Each is resolved here, and each is a one-line revert if the owner disagrees.

1. **`customerCount` is a new scorecard leaf.** The spec mandates "ratios carry their sample size" and shows `3.2:1 — from 4 customers`, but nothing in the system stores a customer count. Without it the rule is unexecutable. Added as `financials.customerCount`, collected in the numbers panel. When null, a ratio renders `— sample size not recorded`, never a bare ratio.
2. **`referralPct` is a new scorecard leaf.** The Activity row for Startup/SME is "Referral % vs the 25% gate"; no input existed. Added as `leadCard.referralPct` (a Hormozi lead metric, so it belongs in `leadCard`, not in the finance-ops table the spec restricts to five fields).
3. **`funding: "seeking"` counts as outside-money posture**, alongside `"funded"`. Precedent: `deriveTier` already groups them ("seeking and funded both read as startup-shaped", `businessProfile.ts:231`). A company raising watches the date the money ends exactly like a funded one.
4. **Scorecard-sourced inputs carry a real per-field `statedAt`, written by the one scorecard writer and carried forward verbatim.** `evaluations.userProvidedAt` maps each scorecard dot-path to the epoch-ms it was answered; `applyScorecardAnswer` writes it beside `userProvided`, and `runEvaluation` carries it into each new row unchanged. A field with a value but no recorded timestamp (a pre-existing row) has genuinely unknown age and is treated as **needing confirmation**, never as fresh.

   > **Corrected 2026-08-09, after Task 3's review.** This assumption originally read: *"the evaluation row's `createdAt` is a floor on the true stated-time, so the 90-day prompt can fire early but never late — the safe direction."* **That was false, and it failed in the unsafe direction.** `runEvaluation` carries a thread's scorecard forward verbatim into a *new* row stamped `createdAt: Date.now()` (`evaluations.ts:153`, `:207-222`), and the design re-runs weekly on one pinned thread — so a `cac` answered on day 0 is carried into a fresh row on day 91, reported as "confirmed today", with its confirm-or-update prompt suppressed for a number that is three months stale. That is exactly the failure the spec names as the reason the 90-day rule exists, and it reached 6 of the 11 inputs. Recorded rather than quietly rewritten: the original reasoning was plausible and wrong, and the next person reaching for a convenient nearby timestamp should see why this one didn't work.

---

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `packages/core/src/cash.ts` | The whole pure plane: `CashFigure` (the four truths), origin/staleness resolution, `unitEconomics`, `solvency`, `activityFromSends`, `metricSetFor`, input validation, `CASH_INPUTS` metadata. Delegates ratio/CFA arithmetic to `growth/financialSpine.ts`. |
| `packages/core/src/cash.test.ts` | Carries the weight. Derivations, all four truths, all five degenerate cases, tier selection, capital-posture switch, staleness, sample size. Pure, no Convex. |
| `packages/backend/convex/cash.ts` | Tenant-scoped read adapters + one write mutation, shaped like `finance.ts`. Reads `tenantProfiles`, `evaluations` (latest scorecard), `financeInputs`, `requests`; calls `@pikar/core`. |
| `packages/backend/convex/cash.test.ts` | Unauthenticated rejection, foreign-tenant isolation, staleness, not-applicable resolution, input validation at the trust boundary. |
| `apps/web/app/(app)/dashboard/finance/FinanceTabs.tsx` | The three-tab shell + page header. Owns tab state and the owner gate on the Operator tab. |
| `apps/web/app/(app)/dashboard/finance/CashView.tsx` | The Business tab: headline → unit economics → solvency → activity → your numbers. Pure presentational components exported for the DOM-free runner. |
| `apps/web/app/(app)/dashboard/finance/cashView.test.ts` | `.test.ts` (a `.tsx` is silently skipped by `vitest.config.mts`), `renderToStaticMarkup`. Unknown / not-applicable / not-computable / zero / stale / sample-size / suppressed-derived. |

### Modify

| Path | Change |
|---|---|
| `packages/core/src/index.ts` | `export * from "./cash";` |
| `packages/core/src/growth/scorecard.ts` | Four new nullable leaves: `financials.grossProfitPerPurchase`, `financials.purchasesPerLifetime`, `financials.customerCount`, `leadCard.referralPct`. |
| `packages/backend/convex/evaluations.ts` | Export two existing-shape helpers so `cash.ts` can reuse the ONE scorecard writer: `applyScorecardAnswer` (already written, currently module-private) and a new `latestScorecardRow`. |
| `packages/backend/convex/schema.ts` | One new table: `financeInputs`. |
| `packages/backend/convex/dashboardSchema.test.ts` | Assert the new table's shape and indexes. |
| `apps/web/app/(app)/dashboard/finance/FinanceView.tsx` | Split the composition: export `PikarSpendTab` and `OperatorTab`; the page header moves to `FinanceTabs.tsx`. No cost behaviour changes. |
| `apps/web/app/(app)/dashboard/finance/page.tsx` | Render `FinanceTabs` instead of `FinanceView`. |
| `apps/web/app/(app)/dashboard/finance/financeView.test.ts` | Keep every existing assertion; add the tab-list tests. |
| `apps/web/e2e/finance.spec.ts` | Extend for the three tabs and the owner-only Operator tab. |
| `docs/playbooks/dashboard-pages.md` | Updated in every task (§9). |
| `docs/playbooks/watch.json` | Register the two new `packages/` files under `dashboard-pages.md`. |

---

# SLICE 1 — structure and free data

Ships value with **zero data entry** and closes the owner's original complaint (operator state on a tenant page).

---

### Task 1: Three tabs, and the Operator controls move off the tenant surface

**Files:**
- Create: `apps/web/app/(app)/dashboard/finance/FinanceTabs.tsx`
- Modify: `apps/web/app/(app)/dashboard/finance/FinanceView.tsx` (rename + export `ConnectedFinance` → `PikarSpendTab`, `ConnectedDeployment` → `OperatorTab`; delete the header from `PikarSpendTab`)
- Modify: `apps/web/app/(app)/dashboard/finance/page.tsx`
- Test: `apps/web/app/(app)/dashboard/finance/financeView.test.ts`
- Docs: `docs/playbooks/dashboard-pages.md`

**Interfaces:**
- Produces: `FINANCE_TABS: readonly { id: FinanceTabId; label: string; ownerOnly: boolean; subheading: string }[]`, `type FinanceTabId = "business" | "spend" | "operator"`, `visibleTabs(isOwner: boolean)`, and the React components `FinanceTabs`, `PikarSpendTab`, `OperatorTab`.
- Consumes: nothing from earlier tasks.

**Why the tab pattern is copied, not invented:** `apps/web/app/(app)/dashboard/profile/page.tsx:49-223` already establishes it — a `role="tablist"` with roving tabindex, arrow-key navigation that moves DOM focus (not just `tabIndex`), `?tab=` read once on mount from `window.location.search` (never `useSearchParams` — it needs a Suspense boundary typecheck cannot see is missing), and `history.replaceState` on switch so a tab change is not a navigation. Read that file before writing this one.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/(app)/dashboard/finance/financeView.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @pikar/web test`
Expected: FAIL — `Failed to resolve import "./FinanceTabs"`.

- [ ] **Step 3: Split `FinanceView.tsx`**

Three edits, no behaviour change.

Rename `ConnectedFinance` to `PikarSpendTab`, export it, and remove its `<header>` block (the header moves to the shell). It becomes:

```tsx
/** The shipped Cost console, MOVED INTACT into a tab. Nothing here is reopened. */
export function PikarSpendTab() {
  const report = useReportWindow();
  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <RailsSection report={report} />
      <TrackedSection report={report} />
      <LedgerSection report={report} />
    </div>
  );
}
```

Rename `ConnectedDeployment` to `OperatorTab` and export it. Its body is unchanged — including the `isOwner ? {} : "skip"` guards, which stay: the tab being hidden is presentation, and `finance.globalRails`/`controls` remain the trust boundary.

Replace the `FinanceView` export with one that wraps only the spend tab, keeping the error boundary available to the shell:

```tsx
export function FinanceView({ children }: { children: ReactNode }) {
  return <FinanceErrorBoundary>{children}</FinanceErrorBoundary>;
}
```

Update the file's top comment: the page is no longer cost-only; this module is now the Pikar-spend tab plus the owner tab. Keep the three-things-this-must-not-do block verbatim — it still governs.

- [ ] **Step 4: Write `FinanceTabs.tsx`**

```tsx
"use client";

// The Finance page shell. THREE TABS, and the split is the point:
//   • Business  — the tenant's own money. Leads, because the business's money outranks the tool's bill.
//   • Pikar spend — the shipped Cost console, moved intact.
//   • Operator  — deployment-global ceilings and kill switches. OWNER ONLY.
//
// Moving the deployment controls to an owner-only tab resolves the complaint that global operator
// state sat on a tenant page. Hiding the tab is PRESENTATION; `finance.globalRails`/`finance.controls`
// are `ownerQuery` and remain the trust boundary (lib/functions.ts).
//
// The tab mechanics are copied from dashboard/profile/page.tsx, deliberately: roving tabindex that
// moves real DOM focus, `?tab=` read once from window.location.search (useSearchParams needs a
// Suspense boundary typecheck cannot see is missing), and replaceState so a tab switch is not a
// navigation that re-runs every query.
import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { CashTab } from "./CashView";
import { FinanceView, OperatorTab, PikarSpendTab } from "./FinanceView";

export type FinanceTabId = "business" | "spend" | "operator";

export const FINANCE_TABS = [
  {
    id: "business",
    label: "Business",
    ownerOnly: false,
    subheading: "Can you survive, and does each customer pay for itself?",
  },
  {
    id: "spend",
    label: "Pikar spend",
    ownerOnly: false,
    subheading: "What the tool is costing you, and what is left today.",
  },
  {
    id: "operator",
    label: "Operator",
    ownerOnly: true,
    subheading: "Deployment ceilings, kill switches and the per-request budget. Every tenant.",
  },
] as const satisfies readonly {
  id: FinanceTabId;
  label: string;
  ownerOnly: boolean;
  subheading: string;
}[];

/** The tabs this viewer may see. A non-owner is offered no Operator tab at all. */
export function visibleTabs(isOwner: boolean) {
  return FINANCE_TABS.filter((tab) => !tab.ownerOnly || isOwner);
}

const isTabId = (value: string | null): value is FinanceTabId =>
  FINANCE_TABS.some((tab) => tab.id === value);

export function FinanceTabs() {
  const viewer = useQuery(api.owner.viewer, {});
  const isOwner = viewer?.isOwner === true;
  const tabs = visibleTabs(isOwner);

  const [tab, setTab] = useState<FinanceTabId | null>(null);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    setTab(isTabId(requested) ? requested : "business");
  }, []);

  // A non-owner who lands on ?tab=operator gets the default tab, not an empty panel.
  const active: FinanceTabId =
    tab !== null && tabs.some((t) => t.id === tab) ? tab : "business";

  const tabRefs = useRef<Partial<Record<FinanceTabId, HTMLButtonElement>>>({});

  function selectTab(next: FinanceTabId) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  const current = FINANCE_TABS.find((t) => t.id === active);

  return (
    <FinanceView>
      <div style={{ display: "grid", gap: "1.5rem", padding: "1.5rem 0" }}>
        <header style={{ display: "grid", gap: "0.65rem" }}>
          <p
            style={{
              color: "var(--ink-soft)",
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Finance · USD
          </p>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)",
            }}
          >
            Your money, and what Pikar costs
          </h1>
          <p style={{ color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 }}>
            {current?.subheading}
          </p>
        </header>

        <div
          role="tablist"
          aria-label="Finance sections"
          style={{ display: "flex", gap: "0.35rem", borderBottom: "1px solid var(--rule)" }}
          onKeyDown={(event) => {
            const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (delta === 0) return;
            event.preventDefault();
            const index = tabs.findIndex((t) => t.id === active);
            const next = tabs[(index + delta + tabs.length) % tabs.length];
            if (!next) return;
            selectTab(next.id);
            tabRefs.current[next.id]?.focus();
          }}
        >
          {tabs.map((t) => {
            const selected = t.id === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  if (el) tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`finance-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`finance-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(t.id)}
                style={{
                  appearance: "none",
                  border: "none",
                  background: "none",
                  font: "inherit",
                  cursor: "pointer",
                  padding: "0.55rem 0.9rem",
                  marginBottom: "-1px",
                  fontWeight: 600,
                  fontSize: "0.92rem",
                  color: selected ? "var(--ink)" : "var(--ink-soft)",
                  borderBottom: `2px solid ${selected ? "var(--teal-600)" : "transparent"}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Business and Pikar spend stay MOUNTED and toggle with `hidden`, so a half-typed number
            in the your-numbers panel survives a trip to the spend tab (the profile-page idiom).
            Operator is mounted ONLY for an owner — a hidden-but-mounted owner panel would fire the
            owner queries for a non-owner and put OWNER_REQUIRED into the error boundary. */}
        <div
          role="tabpanel"
          id="finance-panel-business"
          aria-labelledby="finance-tab-business"
          hidden={active !== "business"}
        >
          <CashTab />
        </div>
        <div
          role="tabpanel"
          id="finance-panel-spend"
          aria-labelledby="finance-tab-spend"
          hidden={active !== "spend"}
        >
          <PikarSpendTab />
        </div>
        {isOwner ? (
          <div
            role="tabpanel"
            id="finance-panel-operator"
            aria-labelledby="finance-tab-operator"
            hidden={active !== "operator"}
          >
            <OperatorTab />
          </div>
        ) : null}
      </div>
    </FinanceView>
  );
}
```

- [ ] **Step 5: Add the placeholder `CashTab`**

`CashView.tsx` is fully built in Tasks 2, 3, 6 and 9. Create it now with the minimum the shell imports, so Task 1 ships a working page:

```tsx
"use client";

// The Business tab — the tenant's OWN money. Ordered by the capital-posture switch:
// headline → unit economics → solvency → activity → your numbers.
//
// Every figure on this tab is a `CashFigure` from `@pikar/core` — this file renders, it never
// derives. A derived figure is suppressed whenever any input is unknown, and names the missing one.
export function CashTab() {
  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <p style={{ color: "var(--ink-soft)", margin: 0 }}>
        Your business numbers arrive here.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Point the route at the shell**

`apps/web/app/(app)/dashboard/finance/page.tsx`:

```tsx
import { FinanceTabs } from "./FinanceTabs";

export default function FinancePage() {
  return <FinanceTabs />;
}
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @pikar/web test`
Expected: PASS — all five new tab tests, plus every pre-existing `financeView.test.ts` assertion still green.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Update the playbook**

In `docs/playbooks/dashboard-pages.md`: bump the `Last verified` line to today with a one-line reason, and under the Finance section record that the route is now a three-tab shell, that Business is the default, and that the Operator tab is owner-only presentation over the unchanged `ownerQuery` trust boundary.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/\(app\)/dashboard/finance docs/playbooks/dashboard-pages.md
git commit -m "feat(finance): three tabs, and the operator controls leave the tenant surface"
```

---

### Task 2: The activity row, populated from delivered sends

**Files:**
- Create: `packages/core/src/cash.ts`
- Create: `packages/core/src/cash.test.ts`
- Create: `packages/backend/convex/cash.ts`
- Create: `packages/backend/convex/cash.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/app/(app)/dashboard/finance/CashView.tsx`
- Create: `apps/web/app/(app)/dashboard/finance/cashView.test.ts`
- Modify: `docs/playbooks/watch.json`, `docs/playbooks/dashboard-pages.md`

**Interfaces:**
- Consumes: `CashTab` from Task 1.
- Produces:
  - `packages/core/src/cash.ts`: `type CashUnit`, `type CashFigure`, `knownFigure`, `unknownFigure`, `activityFromSends(input): CashActivity`, `type CashActivity = { perDay: { dayStartMs: number; count: number }[]; todayCount: number; streakDays: number }`.
  - `packages/backend/convex/cash.ts`: `activity` tenantQuery, args `{ sinceMs: number; untilMs: number }`, returning `{ activity: CashActivity; bound: DashboardBound }`.
  - `CashView.tsx`: `ActivitySection({ activity, bound })` and `ActivityTile({ label, figure })`, both pure.

**Why this row is free:** Pikar already delivers the emails. `requests` rows with `status: "sent"` **are** the reach-out count, and `by_tenant_status_createdAt` (`schema.ts:167`) indexes them by tenant, status and time. The row the books say matters most for the smallest user is the one row that populates itself.

- [ ] **Step 1: Write the failing pure test**

Create `packages/core/src/cash.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { activityFromSends } from "./cash";

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

  test("the 7-day total is derived HERE, not in the view, and is not the same as today's count", () => {
    // Distinct from todayCount and from a whole-window sum, so a wrong slice direction or window
    // length fails here rather than passing a substring match in the rendered HTML.
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(3), day(6), day(8)],
      sinceMs: NOW - 10 * DAY,
      nowMs: NOW,
    });
    expect(result.todayCount).toBe(1);
    expect(result.last7Count).toBe(4);
    expect(result.perDay.reduce((sum, d) => sum + d.count, 0)).toBe(5);
  });

  test("a window shorter than 7 days totals what it has, not a padded week", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(1)],
      sinceMs: NOW - 2 * DAY,
      nowMs: NOW,
    });
    expect(result.last7Count).toBe(2);
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
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @pikar/core test cash`
Expected: FAIL — `Failed to resolve import "./cash"`.

- [ ] **Step 3: Create `packages/core/src/cash.ts` with the figure vocabulary and the activity derivation**

```ts
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
import { ltgpCac } from "./growth/financialSpine";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Today plus the six preceding UTC days. DERIVED HERE, never in the view (CLAUDE.md §1). */
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
```

`ltgpCac` is imported now and used in Task 5; if your linter flags the unused import, add it in Task 5 instead and drop the import line here.

- [ ] **Step 4: Export it from the package index**

In `packages/core/src/index.ts`, add alongside the existing exports (keep the file's alphabetical-ish grouping):

```ts
export * from "./cash";
```

- [ ] **Step 5: Run the pure tests**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS — all five.

- [ ] **Step 6: Write the failing adapter test**

Create `packages/backend/convex/cash.test.ts`. Mirror the setup idiom in `finance.test.ts` (read it first for the `convexTest` harness, the auth identity helper and the tenant-isolation pattern used there).

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const DAY = 24 * 60 * 60 * 1000;

// Match finance.test.ts's identity helper exactly — a second, subtly different one is how two
// tenant-scoping tests end up asserting different things about the same wrapper.
const asTenant = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: `${userId}|session`, issuer: "test" });

async function seedSend(t: ReturnType<typeof convexTest>, tenantId: string, createdAt: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("requests", {
      tenantId,
      correlationId: `c-${createdAt}-${Math.random()}`,
      goal: "g",
      recipient: "someone@example.com",
      status: "sent",
      attachmentRefs: [],
      createdAt,
    });
  });
}

describe("cash.activity", () => {
  test("an unauthenticated caller is rejected before anything is read", async () => {
    const t = convexTest(schema);
    await expect(
      t.query(api.cash.activity, { sinceMs: Date.now() - DAY, untilMs: Date.now() }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("counts only this tenant's delivered sends", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    await seedSend(t, "tenant-a", now - 1000);
    await seedSend(t, "tenant-a", now - 2000);
    await seedSend(t, "tenant-b", now - 1000);

    const result = await asTenant(t, "tenant-a").query(api.cash.activity, {
      sinceMs: now - 3 * DAY,
      untilMs: now,
    });
    expect(result.activity.todayCount).toBe(2);
  });

  test("a non-sent request is not a reach-out", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("requests", {
        tenantId: "tenant-a",
        correlationId: "c-draft",
        goal: "g",
        recipient: "someone@example.com",
        status: "awaiting_review",
        attachmentRefs: [],
        createdAt: now - 1000,
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.activity, {
      sinceMs: now - 3 * DAY,
      untilMs: now,
    });
    expect(result.activity.todayCount).toBe(0);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm --filter @pikar/backend test cash`
Expected: FAIL — `api.cash` does not exist.

- [ ] **Step 8: Create `packages/backend/convex/cash.ts`**

```ts
// CASH adapter — the READ side of the business-finance plane, tenant-scoped.
//
// THIS MODULE IS A READER AND ONE WRITER. Every derivation lives in `@pikar/core`'s `cash.ts`
// (CLAUDE.md §1); re-deriving anything here would create a second, silently-drifting definition of
// the business's money — the exact drift that produced two separate selector bugs on 2026-08-09.
//
// EVERY SECTION IS ITS OWN QUERY, on purpose. A failing scorecard read must take out unit economics
// and leave solvency, activity and the whole Pikar-spend tab standing.
//
// NOTHING HERE IS LOGGED. A tenant's cash on hand, CAC and MRR are precisely what CLAUDE.md §4
// keeps out of the audit table. If you ever add an audit event to this module, log the field NAME
// and a boolean, never the value.
import { activityFromSends, createDashboardBound } from "@pikar/core";
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";

/** 31 days, matching the Cost console's reported window so the two tabs speak the same period. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
/** A bounded read. A tenant past this in one window has their count reported as a FLOOR. */
const SEND_SCAN_LIMIT = 1000;

export const activity = tenantQuery({
  args: { sinceMs: v.number(), untilMs: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.sinceMs) || !Number.isSafeInteger(args.untilMs)) {
      throw new Error("INVALID_WINDOW");
    }
    if (args.sinceMs >= args.untilMs) throw new Error("INVALID_WINDOW");
    if (args.untilMs - args.sinceMs > MAX_WINDOW_MS) throw new Error("INVALID_WINDOW");

    const rows = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("status", "sent")
          .gte("createdAt", args.sinceMs)
          .lt("createdAt", args.untilMs),
      )
      .take(SEND_SCAN_LIMIT + 1);

    // A window that fills the cap is UNDER-reported. `partial` says the count is a floor rather
    // than letting a quietly small number read as the truth (the finance.ts readWindow precedent).
    const partial = rows.length > SEND_SCAN_LIMIT;
    const counted = rows.slice(0, SEND_SCAN_LIMIT);

    return {
      activity: activityFromSends({
        sentAtMs: counted.map((row) => row.createdAt),
        sinceMs: args.sinceMs,
        nowMs: args.untilMs,
      }),
      bound: createDashboardBound({
        returned: counted.length,
        limit: SEND_SCAN_LIMIT,
        nextCursor: null,
        partial,
        ...(partial ? { partialReason: "row-cap" as const } : {}),
      }),
    };
  },
});
```

- [ ] **Step 9: Run the adapter tests**

Run: `pnpm --filter @pikar/backend test cash`
Expected: PASS — all three.

- [ ] **Step 10: Write the failing view test**

Create `apps/web/app/(app)/dashboard/finance/cashView.test.ts`:

```ts
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
      activity: activity({ perDay: [{ dayStartMs: today, count: 0 }], todayCount: 0, streakDays: 0 }),
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
```

- [ ] **Step 11: Run it and watch it fail**

Run: `pnpm --filter @pikar/web test cashView`
Expected: FAIL — `ActivitySection` is not exported.

- [ ] **Step 12: Build the activity section in `CashView.tsx`**

Replace the placeholder body. Reuse the inline-style idiom from `FinanceView.tsx` (copy the `card`, `stack`, `muted`, `caps` constants into this file — they are 6 lines each and a shared styles module for two files is an abstraction nobody asked for; if a third finance file needs them, extract then).

```tsx
"use client";

import { api } from "@pikar/backend/api";
import type { CashActivity } from "@pikar/core";
import { useQuery } from "convex/react";
import { type CSSProperties, useMemo } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

const stack: CSSProperties = { display: "grid", gap: "0.75rem" };
const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1rem",
};
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--ink)",
};

export function CashStateNotice({ state, children }: { state: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-cash-state={state}
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.85rem 1rem",
        color: "var(--ink-soft)",
        background: "color-mix(in srgb, var(--card) 70%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Reach-outs, posts and the streak.
 *
 * This is the most important row on the page for the smallest user, and the one the source material
 * most directly supports: at the earliest levels the readable signals are INPUTS, not rates — rates
 * at small samples are explicitly unreadable. It is also the only row that needs no data entry.
 *
 * ponytail: "posts per day" has no source yet — Pikar delivers email, not social posts. It renders
 * as an explicit "not tracked yet" rather than as a zero. Upgrade path: a social rail feeds the same
 * shape.
 */
export function ActivitySection({
  activity,
  partial,
}: {
  activity: CashActivity;
  partial: boolean;
}) {
  return (
    <section style={stack} aria-labelledby="cash-activity-heading">
      <h2 id="cash-activity-heading" style={cardTitle}>
        What you did — measured, not asked
      </h2>
      <p style={muted}>
        Counted from what Pikar actually delivered. Nothing here needs you to enter a number.
      </p>
      {partial ? (
        <CashStateNotice state="partial">
          More sends exist than this bounded read counts. These counts are a floor, not the period's
          activity.
        </CashStateNotice>
      ) : null}
      <section className="stat-grid" aria-label="Activity">
        <div className="stat-tile">
          <div className="stat-head">
            <p className="caps-label">Reach-outs today</p>
          </div>
          <div className="stat-value">{activity.todayCount}</div>
          {/* Formatting only. The 7-day sum is derived in `activityFromSends` — a `.reduce()`
              here would be domain arithmetic in the view, which Global Constraint 1 forbids. */}
          <p style={{ ...muted, fontSize: "0.8rem" }}>{activity.last7Count} in the last 7 days</p>
        </div>
        <div className="stat-tile">
          <div className="stat-head">
            <p className="caps-label">Streak</p>
          </div>
          <div className="stat-value">{activity.streakDays}</div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            {activity.streakDays}-day streak · consecutive days you sent something, ending today
          </p>
        </div>
        <div className="stat-tile">
          <div className="stat-head">
            <p className="caps-label">Posts per day</p>
          </div>
          <div className="stat-value">—</div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            Not tracked yet — Pikar delivers email, not posts.
          </p>
        </div>
      </section>
    </section>
  );
}

function ConnectedActivity() {
  // Frozen once per mount: a sliding window would make every render a new subscription.
  const window = useMemo(() => {
    const untilMs = Date.now();
    return { sinceMs: untilMs - WINDOW_DAYS * DAY_MS, untilMs };
  }, []);
  const result = useQuery(api.cash.activity, window);
  if (result === undefined) return <CashStateNotice state="loading">Loading activity…</CashStateNotice>;
  return <ActivitySection activity={result.activity} partial={result.bound.partial} />;
}

export function CashTab() {
  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <ConnectedActivity />
    </div>
  );
}
```

- [ ] **Step 13: Run every runner**

Run: `pnpm --filter @pikar/web test`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 14: Register the new files and update the playbook**

In `docs/playbooks/watch.json`, add to the `dashboard-pages.md` array:

```json
    "packages/core/src/cash.ts",
    "packages/core/src/cash.test.ts",
    "packages/backend/convex/cash.ts",
    "packages/backend/convex/cash.test.ts",
```

In `docs/playbooks/dashboard-pages.md`: add a "Cash — business finance" subsection under Key files naming the two new modules and their split (pure derivation vs thin adapter), and record the four-state `CashFigure` contract. Bump `Last verified`.

- [ ] **Step 15: Refresh the graph and commit**

```bash
graphify update . && node scripts/extract-convex-edges.mjs
git add packages/core/src/cash.ts packages/core/src/cash.test.ts packages/core/src/index.ts packages/backend/convex/cash.ts packages/backend/convex/cash.test.ts apps/web/app/\(app\)/dashboard/finance docs/playbooks graphify-out
git commit -m "feat(cash): the activity row, counted from delivered sends"
```

---

### Task 3: The six-input panel and the `financeInputs` table

**Files:**
- Modify: `packages/core/src/growth/scorecard.ts` (four new nullable leaves)
- Modify: `packages/core/src/cash.ts` (`CASH_INPUTS`, `validateCashInput`)
- Modify: `packages/core/src/cash.test.ts`
- Modify: `packages/backend/convex/schema.ts` (`financeInputs`)
- Modify: `packages/backend/convex/dashboardSchema.test.ts`
- Modify: `packages/backend/convex/evaluations.ts` (export two helpers)
- Modify: `packages/backend/convex/approvals.ts` + `approvals.test.ts` (extend `QUESTION_CATALOG`, collapse both if-chains onto the one writer)
- Modify: `packages/backend/convex/cash.ts` (`inputs` query, `saveInput` mutation)
- Modify: `packages/backend/convex/cash.test.ts`
- Modify: `apps/web/app/(app)/dashboard/finance/CashView.tsx` (`NumbersPanel`)
- Modify: `apps/web/app/(app)/dashboard/finance/cashView.test.ts`
- Docs: `docs/playbooks/dashboard-pages.md`, and `docs/playbooks/growth-diagnostic.md` (the scorecard leaves)

**Interfaces:**
- Consumes: `CashFigure`, `knownFigure`, `unknownFigure` (Task 2).
- Produces:
  - `CASH_INPUTS: readonly CashInputSpec[]` where
    `type CashInputSpec = { field: CashInputField; store: "financeInputs" | "scorecard"; path?: string; unit: CashUnit; label: string; help: string; unlocks: string; tiers?: readonly Tier[] }`
  - `type CashInputField = "cashOnHand" | "monthlyOperatingCost" | "mrr" | "receivables" | "payables" | "cac" | "thirtyDayCashPerCustomer" | "grossProfitPerPurchase" | "purchasesPerLifetime" | "customerCount" | "referralPct"`
  - `validateCashInput(field: CashInputField, value: number): { ok: true } | { ok: false; reason: string }`
  - `type CashInputState = { field: CashInputField; value: number | null; statedAt: number | null; stale: boolean }`
  - `cash.inputs` tenantQuery → `{ inputs: CashInputState[] }`
  - `cash.saveInput` tenantMutation, args `{ field: <closed union>, value: v.number() }` → `{ saved: true }`
  - `NumbersPanel({ inputs, tier, busy, error, onSave })` in `CashView.tsx`

**Storage split, and why it is not a duplication:** the scorecard stays the source of truth for the Hormozi inputs — `financials.cac`, `financials.ltgp`, `financials.thirtyDayCashPerCustomer`, `financials.grossMarginPct`, `financials.churnByCadence` already live there and `answerDecision`/`recordScorecardAnswer` already write them. **CAC is not copied into a second table.** The new table holds the five finance-ops inputs only. One mutation routes by field to the correct store, so there is still one writer per field.

- [ ] **Step 1: Write the failing validation test**

Append to `packages/core/src/cash.test.ts`:

```ts
import { CASH_INPUTS, validateCashInput } from "./cash";

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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @pikar/core test cash`
Expected: FAIL — `CASH_INPUTS` and `validateCashInput` are not exported.

- [ ] **Step 3: Add the four scorecard leaves**

In `packages/core/src/growth/scorecard.ts`, add to the `Scorecard["financials"]` type and to `emptyScorecard.financials`:

```ts
    /** Gross profit on ONE purchase. With `purchasesPerLifetime` this DERIVES ltgp. */
    grossProfitPerPurchase: number | null;
    /** How many times an average customer buys. Below 1 is rejected at input, never multiplied. */
    purchasesPerLifetime: number | null;
    /**
     * How many customers the ratios above rest on. The books are explicit that rates at small
     * samples are unreadable, so a ratio is never rendered without this beside it — and when it is
     * null the page says "sample size not recorded" rather than showing a bare, confident number.
     */
    customerCount: number | null;
```

and to `Scorecard["leadCard"]` and `emptyScorecard.leadCard`:

```ts
  /** Share of new customers arriving by referral, 0-100. The 25% gate is the books' threshold. */
  referralPct: number | null;
```

`ltgp` stays. It now has two possible producers and **exactly one stored value**: the panel writes the two components and never writes `ltgp`; `answerDecision`'s direct `ltgp` answer stays for the cockpit path. Task 5 resolves the precedence (components win, and say so).

- [ ] **Step 4: Add `CASH_INPUTS` and `validateCashInput` to `packages/core/src/cash.ts`**

```ts
import type { Tier } from "./businessProfile";

/** A `stated` input this old asks for a confirm-or-update. Outputs are only readable when their
 *  inputs are consistent, and a stale number silently poisoning a ratio is that failure. */
export const STALE_AFTER_MS = 90 * DAY_MS;

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
export const CASH_INPUTS = [
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
] as const satisfies readonly CashInputSpec[];

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
  if (spec.unit === "count" && !Number.isInteger(value)) {
    return { ok: false, reason: "Enter a whole number." };
  }
  if (field === "purchasesPerLifetime" && value < 1) {
    return { ok: false, reason: "A customer buys at least 1 time. Enter at least 1." };
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
```

- [ ] **Step 5: Run the pure tests**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS.

- [ ] **Step 6: Add the `financeInputs` table**

In `packages/backend/convex/schema.ts`, beside `tenantProfiles`:

```ts
  // The FINANCE-OPS inputs, and only those (design §5). The Hormozi inputs stay on the scorecard —
  // duplicating CAC into a second table is what produced two separate selector bugs on 2026-08-09.
  //
  // One row per (tenant, field), read with `.unique()` so a duplicate is LOUD rather than silently
  // shadowed (the tenantProfiles precedent). `statedAt` is per FIELD, not per row-set: cash on hand
  // goes stale far faster than payables, and one shared timestamp would make the 90-day
  // confirm-or-update prompt fire on the wrong number.
  //
  // Values are USD DOLLARS as a plain number, matching `scorecard.financials.cac`. The Pikar-spend
  // plane's integer cents never appear here.
  financeInputs: defineTable({
    tenantId: v.string(),
    field: v.union(
      v.literal("cashOnHand"),
      v.literal("monthlyOperatingCost"),
      v.literal("mrr"),
      v.literal("receivables"),
      v.literal("payables"),
    ),
    valueUsd: v.number(),
    statedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_field", ["tenantId", "field"]),
```

Add the matching assertions to `packages/backend/convex/dashboardSchema.test.ts` following that file's existing idiom (assert the table exists, the field union is closed, and both indexes are declared).

- [ ] **Step 7: Export the two scorecard helpers from `evaluations.ts`**

Change `async function applyScorecardAnswer(` to `export async function applyScorecardAnswer(` and add beside it:

```ts
/**
 * The tenant's latest evaluation row across ALL threads — the row whose Scorecard is the tenant's
 * current financial truth.
 *
 * `byThread` and `answerDecision` are thread-scoped because they answer a question asked inside one
 * conversation. The Finance page belongs to no thread, so it needs this. Exported as a plain
 * function rather than a query: `cash.ts` calls it with its own `ctx.db` inside an already
 * tenant-scoped handler, which adds no public API surface.
 */
export async function latestScorecardRow(
  db: DatabaseReader,
  tenantId: string,
): Promise<Doc<"evaluations"> | null> {
  return await db
    .query("evaluations")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .first();
}
```

`DatabaseReader` may need adding to the existing `_generated/server` type import in that file.

- [ ] **Step 8: Write the failing adapter tests**

Append to `packages/backend/convex/cash.test.ts`:

```ts
describe("cash.saveInput", () => {
  test("an unauthenticated caller cannot write a number", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.cash.saveInput, { field: "cashOnHand", value: 1000 }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("a finance-ops field lands in financeInputs with its own statedAt", async () => {
    const t = convexTest(schema);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
      field: "cashOnHand",
      value: 12_000,
    });
    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe("tenant-a");
    expect(rows[0]?.valueUsd).toBe(12_000);
    expect(rows[0]?.statedAt).toBeGreaterThan(0);
  });

  test("saving the same field twice updates the row rather than adding a second", async () => {
    const t = convexTest(schema);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 100 });
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 200 });
    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valueUsd).toBe(200);
  });

  test("a Hormozi field lands on the SCORECARD — CAC is never duplicated into a second table", async () => {
    const t = convexTest(schema);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    const financeRows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(financeRows).toHaveLength(0);
    const evaluation = await t.run((ctx) => ctx.db.query("evaluations").first());
    expect(evaluation?.scorecard.financials.cac).toBe(1400);
    expect(evaluation?.userProvided).toContain("financials.cac");
  });

  test("an invalid value is refused at the boundary and writes nothing", async () => {
    const t = convexTest(schema);
    await expect(
      asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
        field: "purchasesPerLifetime",
        value: 0.5,
      }),
    ).rejects.toThrow(/INVALID_INPUT/);
    const evaluations = await t.run((ctx) => ctx.db.query("evaluations").collect());
    expect(evaluations).toHaveLength(0);
  });
});

describe("cash.inputs", () => {
  test("one tenant cannot read another tenant's numbers", async () => {
    const t = convexTest(schema);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
      field: "cashOnHand",
      value: 99_000,
    });
    const result = await asTenant(t, "tenant-b").query(api.cash.inputs, {});
    const cash = result.inputs.find((i) => i.field === "cashOnHand");
    expect(cash?.value).toBeNull();
  });

  test("an input stated more than 90 days ago is stale", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("financeInputs", {
        tenantId: "tenant-a",
        field: "cashOnHand",
        valueUsd: 5_000,
        statedAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    expect(result.inputs.find((i) => i.field === "cashOnHand")?.stale).toBe(true);
  });

  test("a fresh input is not stale", async () => {
    const t = convexTest(schema);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cashOnHand", value: 1 });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    expect(result.inputs.find((i) => i.field === "cashOnHand")?.stale).toBe(false);
  });
});
```

- [ ] **Step 9: Run and watch it fail**

Run: `pnpm --filter @pikar/backend test cash`
Expected: FAIL — `api.cash.saveInput` / `api.cash.inputs` do not exist.

- [ ] **Step 10: Add `inputs` and `saveInput` to `packages/backend/convex/cash.ts`**

```ts
import {
  CASH_INPUTS,
  cashInputSpec,
  type CashInputField,
  type CashInputState,
  isStale,
  validateCashInput,
} from "@pikar/core";
import type { Scorecard } from "@pikar/core/growth/index";
import { emptyScorecard } from "@pikar/core/growth/index";
import { applyScorecardAnswer, latestScorecardRow } from "./evaluations";
import { tenantMutation } from "./lib/functions";

/** The closed field union, mirroring `CashInputField`. A widening is a deliberate edit here. */
const vCashField = v.union(
  v.literal("cashOnHand"),
  v.literal("monthlyOperatingCost"),
  v.literal("mrr"),
  v.literal("receivables"),
  v.literal("payables"),
  v.literal("cac"),
  v.literal("thirtyDayCashPerCustomer"),
  v.literal("grossProfitPerPurchase"),
  v.literal("purchasesPerLifetime"),
  v.literal("customerCount"),
  v.literal("referralPct"),
);
// Compile-time bind, both directions: a field added to `@pikar/core` but not to the validator (or
// the reverse) is a COMPILE error here rather than a silently unsaveable form row.
const _fieldToDoc: readonly (typeof vCashField.type)[] = CASH_INPUTS.map((s) => s.field);
const _docToField: readonly CashInputField[] = [] as (typeof vCashField.type)[];

/** A dot-path read over the Scorecard. Mirrors `evaluations.ts`'s `getPath` on the write side. */
function scorecardValue(scorecard: Scorecard, path: string): number | null {
  const value = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], scorecard);
  return typeof value === "number" ? value : null;
}

export const inputs = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ inputs: CashInputState[] }> => {
    const now = Date.now();
    const rows = await ctx.db
      .query("financeInputs")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const byField = new Map(rows.map((row) => [row.field, row]));
    const evaluation = await latestScorecardRow(ctx.db, ctx.tenantId);
    const scorecard = (evaluation?.scorecard as Scorecard | undefined) ?? emptyScorecard;

    return {
      inputs: CASH_INPUTS.map((spec): CashInputState => {
        if (spec.store === "financeInputs") {
          const row = byField.get(spec.field as (typeof rows)[number]["field"]);
          const statedAt = row?.statedAt ?? null;
          return {
            field: spec.field,
            value: row?.valueUsd ?? null,
            statedAt,
            stale: isStale(statedAt, now),
          };
        }
        const value = spec.path === undefined ? null : scorecardValue(scorecard, spec.path);
        // The REAL per-field stated-time, carried forward verbatim by `runEvaluation` alongside
        // `userProvided`. Do NOT substitute the row's `createdAt`: re-evaluation inserts a NEW row
        // stamped with a fresh `createdAt` while carrying the same answers, so a figure nobody has
        // re-confirmed would read as stated today and its 90-day prompt would never fire. A present
        // value with NO recorded timestamp has unknown age and is treated as needing confirmation.
        const statedAt =
          value === null ? null : (evaluation?.userProvidedAt?.[spec.path ?? ""] ?? null);
        return { field: spec.field, value, statedAt, stale: isStale(statedAt, now) };
      }),
    };
  },
});

/**
 * ONE writer, routing by field to the store that owns the value.
 *
 * The Hormozi inputs go to the SCORECARD through `applyScorecardAnswer` — the same function
 * `recordScorecardAnswer` and the cockpit tool use, so a number entered in the panel and a number
 * given in conversation land in the same place and carry forward the same way. The finance-ops
 * inputs go to `financeInputs`. Nothing is written twice.
 *
 * The value is validated HERE and not only in the form: a form is a convenience, and this mutation
 * is the trust boundary. Nothing about it is logged (CLAUDE.md §4) — the value IS the sensitive part.
 */
export const saveInput = tenantMutation({
  args: { field: vCashField, value: v.number() },
  handler: async (ctx, { field, value }): Promise<{ saved: true }> => {
    const check = validateCashInput(field, value);
    if (!check.ok) throw new Error(`INVALID_INPUT: ${check.reason}`);
    const spec = cashInputSpec(field);

    if (spec.store === "scorecard") {
      if (spec.path === undefined) throw new Error("INVALID_INPUT: no scorecard path");
      const existing = await latestScorecardRow(ctx.db, ctx.tenantId);
      // No evaluation yet: seed under a stable, non-conversational thread id so the panel's answers
      // survive into the tenant's first real evaluation (the applyScorecardAnswer carrier path).
      await applyScorecardAnswer(
        ctx.db,
        ctx.tenantId,
        existing?.threadId ?? "finance-panel",
        spec.path,
        value,
      );
      return { saved: true };
    }

    const row = await ctx.db
      .query("financeInputs")
      .withIndex("by_tenant_field", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("field", field as "cashOnHand"),
      )
      .unique();
    const write = { valueUsd: value, statedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, write);
    else await ctx.db.insert("financeInputs", { tenantId: ctx.tenantId, field: field as "cashOnHand", ...write });
    return { saved: true };
  },
});
```

The `as "cashOnHand"` casts narrow the wide `CashInputField` to the table's five-literal union on the branch where `spec.store === "financeInputs"` has already proved it. If TypeScript can express the narrowing without the cast (e.g. by making the store discriminant a type predicate), prefer that — but do not widen the table's union to accept scorecard fields.

- [ ] **Step 11: Run the adapter tests**

Run: `pnpm --filter @pikar/backend test cash`
Expected: PASS — all eight new cases.

- [ ] **Step 12: Write the failing panel test**

Append to `apps/web/app/(app)/dashboard/finance/cashView.test.ts`:

```ts
import { NumbersPanel } from "./CashView";

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
```

- [ ] **Step 13: Run and watch it fail, then build `NumbersPanel`**

Run: `pnpm --filter @pikar/web test cashView`
Expected: FAIL — `NumbersPanel` is not exported.

Add to `CashView.tsx`. Each row is a label, a number input seeded from the stored value, a save button, and a provenance line (`Last confirmed <date>` or `Unlocks <what>`). Drive the visible rows from `cashInputsForTier(tier)` intersected with the `inputs` prop, so the tier decides the form and the panel never invents a field. Validate on change with `validateCashInput` and disable Save while invalid, showing `check.reason` in a `role="alert"` — the mutation refuses too, so this is convenience, not the boundary. Wire a `ConnectedNumbers` component using `useMutation(api.cash.saveInput)` with the busy/refusal handling copied from `FinanceView.tsx`'s `run` helper, and add it to `CashTab` beneath `ConnectedActivity`.

- [ ] **Step 14: Extend the Approvals decision catalogue — the seam that already exists**

The spec names three collection seams and this is the first: `QUESTION_CATALOG` in `approvals.ts:199` already asks for `financials.cac`, `financials.ltgp` and `financials.thirtyDayCashPerCustomer`, and `answerDecision` already writes them. The four new leaves need entries, or a user who answers in Approvals and a user who answers in the panel fill different sets.

Add to `QUESTION_CATALOG`:

```ts
  {
    field: "financials.grossProfitPerPurchase",
    valueType: "number",
    label: "Gross profit per purchase",
    prompt: "What is your gross profit on one sale, after the cost of delivering it?",
  },
  {
    field: "financials.purchasesPerLifetime",
    valueType: "number",
    label: "Purchases per customer lifetime",
    prompt: "How many times does an average customer buy from you in total?",
  },
  {
    field: "financials.customerCount",
    valueType: "number",
    label: "Customers so far",
    prompt: "How many customers are these figures based on?",
  },
```

`leadCard.referralPct` is deliberately NOT added: `hasFinancialQuestion` gates this catalogue on a `notEnoughData` entry in the `financials` section, and a lead metric surfacing behind a financial gate would be a category error. It stays a panel-and-cockpit input.

Then collapse the two hand-written if-chains rather than extending them — three entries became six, and a per-field branch that must be edited in two places is how a catalogue entry ships unwritable:

- Replace `fieldValue`'s if-chain with a dot-path read over the Scorecard (the same shape `cash.ts`'s `scorecardValue` uses).
- Replace `answerDecision`'s assignment if-chain with a single call to `applyScorecardAnswer(ctx.db, ctx.tenantId, threadId, answer.field, answer.value)` — now exported from `evaluations.ts` (Step 7). That makes the panel, the cockpit tool and the Approvals prompt **one writer**, which is exactly the anti-drift rule §5 states.
- Widen `numericField` to include the three new literals.
- Route the numeric bounds check through `validateCashInput` for fields that are cash inputs, so `purchasesPerLifetime: 0.5` is refused in Approvals for the same reason and with the same words as in the panel.

Add to `packages/backend/convex/approvals.test.ts`:

```ts
test("the new financial questions are askable and writable", async () => {
  // Follow this file's existing seeding idiom for an evaluation row carrying a financials
  // notEnoughData entry, then assert each new field appears in listDecisions and round-trips
  // through answerDecision onto the scorecard.
});

test("purchases per lifetime below 1 is refused in Approvals too", async () => {
  // Same reason, same words as the panel — one validator.
});
```

Write those two out in full against the file's existing helpers before running.

Run: `pnpm --filter @pikar/backend test approvals`
Expected: PASS, with every pre-existing assertion in that file still green.

- [ ] **Step 15: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 16: Update both playbooks and commit**

`docs/playbooks/dashboard-pages.md`: record the `financeInputs` table, the one-writer routing rule and the storage split (Hormozi inputs on the scorecard, finance-ops in the table, nothing duplicated). Bump `Last verified`.
`docs/playbooks/growth-diagnostic.md`: record the four new Scorecard leaves and that `ltgp` now has a derived-from-components precedence resolved at read time in `cash.ts`, never a second stored value. Bump `Last verified`.

```bash
graphify update . && node scripts/extract-convex-edges.mjs
git add packages apps/web/app/\(app\)/dashboard/finance docs/playbooks graphify-out
git commit -m "feat(cash): the six-input panel, and one writer per number"
```

**Slice 1 is now shippable.** Three tabs, operator controls off the tenant surface, an activity row that needed no data entry, and a place to put the numbers.

---

# SLICE 2 — unit economics

---

### Task 4: The four truths, origin, and staleness — resolved once, in one place

**Files:**
- Modify: `packages/core/src/cash.ts`
- Modify: `packages/core/src/cash.test.ts`
- Docs: `docs/playbooks/dashboard-pages.md`

**Interfaces:**
- Consumes: `CashFigure`, `CashInputState`, `STALE_AFTER_MS` (Tasks 2, 3).
- Produces:
  - `type CashInputs = Partial<Record<CashInputField, CashInputState>>`
  - `toCashInputs(states: readonly CashInputState[]): CashInputs`
  - `statedFigure(input: CashInputState | undefined, spec: CashInputSpec, nowMs: number): CashFigure`
  - `derived(args: { value: number; unit: CashUnit; from: string; sampleSize?: number | null }): CashFigure`
  - `requireInputs(inputs: CashInputs, fields: readonly CashInputField[]): CashFigure | null` — returns an `unknown` figure naming the FIRST missing input, or `null` when every input is present.
  - `valueOf(inputs: CashInputs, field: CashInputField): number` — the present value. Throws if called before `requireInputs` proved the field present; that throw is a programming-error tripwire, not a runtime path.

**Imports `cash.ts` needs by the end of Slice 3:** `import type { Funding, RevenueStage, Tier } from "./businessProfile";` and `import { cfa, INDUSTRY_MULTIPLE, ltgpCac } from "./growth/financialSpine";` and `import type { Scorecard } from "./growth/scorecard";`. Add each in the task that first needs it rather than all at once, so no task leaves an unused import for biome to flag.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/cash.test.ts`:

```ts
import { cashInputSpec, requireInputs, statedFigure, toCashInputs } from "./cash";

const state = (field: string, over: Record<string, unknown> = {}) => ({
  field,
  value: 100,
  statedAt: NOW - DAY,
  stale: false,
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
    expect(figure).toMatchObject({ state: "known", origin: "stated", statedAt: NOW - DAY, stale: false });
  });

  test("past 90 days it is flagged stale rather than silently used", () => {
    const old = state("cac", { statedAt: NOW - 91 * DAY, stale: true });
    expect(statedFigure(old, cashInputSpec("cac"), NOW)).toMatchObject({ stale: true });
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @pikar/core test cash`
Expected: FAIL — `statedFigure`, `requireInputs`, `toCashInputs` are not exported.

- [ ] **Step 3: Implement**

```ts
export type CashInputs = Partial<Record<CashInputField, CashInputState>>;

export const toCashInputs = (states: readonly CashInputState[]): CashInputs =>
  Object.fromEntries(states.map((s) => [s.field, s])) as CashInputs;

/** One STATED input as a figure. A real zero is `known` — measured nothing is an answer. */
export function statedFigure(
  input: CashInputState | undefined,
  spec: CashInputSpec,
  nowMs: number,
): CashFigure {
  if (input === undefined || input.value === null) {
    return unknownFigure(`needs your ${spec.label.toLowerCase()} — ${spec.label}`);
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
 * Returns the blocking figure, or `null` when everything is present. The FIRST missing input is
 * named rather than all of them: a metric that answers with a checklist gets ignored.
 */
export function requireInputs(
  inputs: CashInputs,
  fields: readonly CashInputField[],
): CashFigure | null {
  for (const field of fields) {
    const state = inputs[field];
    if (state === undefined || state.value === null) {
      return unknownFigure(`needs your ${cashInputSpec(field).label.toLowerCase()}`);
    }
  }
  return null;
}

/** A present input's number. Only call after `requireInputs` returned null. */
export const valueOf = (inputs: CashInputs, field: CashInputField): number => {
  const value = inputs[field]?.value;
  if (value === null || value === undefined) {
    throw new Error(`cash input ${field} read before requireInputs proved it present`);
  }
  return value;
};
```

Adjust the test's expected `needs` strings to whatever wording you settle on — but keep the assertion that the missing input's **label** appears, because that is the contract.

- [ ] **Step 4: Run**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cash.ts packages/core/src/cash.test.ts docs/playbooks/dashboard-pages.md
git commit -m "feat(cash): four truths, provenance and the suppression rule"
```

(Update `docs/playbooks/dashboard-pages.md`'s `Last verified` in the same commit — §9 applies to every commit in this plan and is not repeated below.)

---

### Task 5: Unit economics — CFA, LTGP:CAC with its sample size, payback, and the degenerate guards

**Files:**
- Modify: `packages/core/src/cash.ts`
- Modify: `packages/core/src/cash.test.ts`

**Interfaces:**
- Consumes: everything from Task 4; `ltgpCac` and `cfa` from `./growth/financialSpine`.
- Produces:
  - `type CashUnitEconomics = { cfa: CashFigure; ltgpCac: CashFigure; ltgp: CashFigure; cacPayback: CashFigure; cacVsIndustry: CashFigure; grossMargin: CashFigure; cohortChurn: CashFigure; referralPct: CashFigure }`
  - `unitEconomics(args: { inputs: CashInputs; scorecard: Scorecard; nowMs: number }): CashUnitEconomics`

**Reuse, not reimplementation:** `growth/financialSpine.ts` already ports LTGP:CAC and CFA from the source, including the guards. Call them. This function's job is which truth each result is in.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/cash.test.ts`:

```ts
import { emptyScorecard } from "./growth/scorecard";
import { unitEconomics } from "./cash";

const withInputs = (values: Record<string, number>) =>
  toCashInputs(
    Object.entries(values).map(([field, value]) => ({
      field,
      value,
      statedAt: NOW - DAY,
      stale: false,
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
      inputs: withInputs({ cac: 0, thirtyDayCashPerCustomer: 250, grossProfitPerPurchase: 10, purchasesPerLifetime: 2 }),
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
});
```

`3.21` in the sample-size test is `round2(4500 / 1400)`. Confirm against `financialSpine.ts`'s `round2` before asserting; if it rounds differently, take the function's answer, not the plan's.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @pikar/core test cash`
Expected: FAIL — `unitEconomics` is not exported.

- [ ] **Step 3: Implement**

```ts
import { cfa, INDUSTRY_MULTIPLE, ltgpCac } from "./growth/financialSpine";
import type { Scorecard } from "./growth/scorecard";

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
  const components = requireInputs(inputs, ["grossProfitPerPurchase", "purchasesPerLifetime"]);
  const ltgpFigure: CashFigure = (() => {
    if (components === null) {
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
    return components;
  })();

  // ── CFA: does a customer pay for itself inside 30 days?
  const cfaFigure: CashFigure = (() => {
    const missing = requireInputs(inputs, ["cac", "thirtyDayCashPerCustomer"]);
    if (missing) return missing;
    if (zeroCac) return notComputable("No acquisition cost recorded, so there is nothing to pay back.");
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
    if (zeroCac) return notComputable("No acquisition cost recorded, so there is no ratio to take.");
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
  const paybackFigure: CashFigure = (() => {
    const missing = requireInputs(inputs, ["cac", "grossProfitPerPurchase", "purchasesPerLifetime"]);
    if (missing) return missing;
    if (zeroCac) return notComputable("No acquisition cost recorded, so there is nothing to pay back.");
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
      value: Math.round((cac / average) * 100) / 100,
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
    grossMargin:
      scorecard.financials.grossMarginPct === null
        ? unknownFigure("needs your gross margin")
        : knownFigure("stated", scorecard.financials.grossMarginPct, "percent"),
    cohortChurn:
      scorecard.financials.churnByCadence.monthly === null
        ? unknownFigure("needs your monthly churn")
        : knownFigure("stated", scorecard.financials.churnByCadence.monthly, "percent"),
    referralPct:
      scorecard.leadCard.referralPct === null
        ? unknownFigure("needs your referral share")
        : knownFigure("stated", scorecard.leadCard.referralPct, "percent"),
  };
}
```

The CAC-payback lifetime derivation from monthly churn is a judgement call the spec did not make; if the churn input is absent the figure is `unknown`, which is the honest fallback. Leave a `ponytail:` comment naming it.

- [ ] **Step 4: Run**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS — all eleven.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cash.ts packages/core/src/cash.test.ts docs/playbooks/dashboard-pages.md
git commit -m "feat(cash): CFA, LTGP:CAC with sample size, payback, and every degenerate guard"
```

---

### Task 6: Wire unit economics to the page

**Files:**
- Modify: `packages/backend/convex/cash.ts` (`unitEconomics` query)
- Modify: `packages/backend/convex/cash.test.ts`
- Modify: `apps/web/app/(app)/dashboard/finance/CashView.tsx` (`FigureTile`, `UnitEconomicsSection`)
- Modify: `apps/web/app/(app)/dashboard/finance/cashView.test.ts`

**Interfaces:**
- Consumes: `unitEconomics`, `toCashInputs` (Task 5); the `inputs` query's read path (Task 3).
- Produces:
  - `cash.unitEconomics` tenantQuery, no args → `CashUnitEconomics`
  - `FigureTile({ label, figure, note })` and `UnitEconomicsSection({ economics, tier })` in `CashView.tsx`

- [ ] **Step 1: Write the failing view test**

Append to `apps/web/app/(app)/dashboard/finance/cashView.test.ts`:

```ts
import { FigureTile } from "./CashView";

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
      figure: { state: "not-applicable", because: "Project revenue has no monthly recurring figure." },
    });
    expect(html).toContain("no monthly recurring figure");
    expect(html).not.toMatch(/unknown/i);
    expect(html).not.toMatch(/\$0/);
  });

  test("not-computable states the reason and never renders infinity", () => {
    const html = render(FigureTile, {
      label: "CFA",
      figure: { state: "not-computable", because: "No acquisition cost recorded, so there is nothing to pay back." },
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @pikar/web test cashView`
Expected: FAIL — `FigureTile` is not exported.

- [ ] **Step 3: Build `FigureTile` and `UnitEconomicsSection`**

Add to `CashView.tsx`:

```tsx
import type { CashFigure } from "@pikar/core";

/**
 * The business plane's formatter. USD DOLLARS — never hand it cents. `formatUsdCents` in
 * FinanceView.tsx is the other plane's formatter and the two must never be swapped.
 */
export function formatUsdAmount(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

function formatFigureValue(value: number, unit: string): string {
  if (unit === "usd") return formatUsdAmount(value);
  if (unit === "ratio") return `${value}:1`;
  if (unit === "months") return `${value} ${value === 1 ? "month" : "months"}`;
  if (unit === "percent") return `${value}%`;
  return String(value);
}

const shortDay = (epochMs: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(epochMs),
  );

/**
 * ONE figure, in whichever of the four truths it is in. FOUR BRANCHES, and collapsing any two of
 * them is the failure this component exists to prevent:
 *
 *   • unknown        — the prompt, and NO number. Not even a zero: a zero here is indistinguishable
 *                      from a measured nothing, which is the whole reason the state exists.
 *   • not-applicable — the reason. Never the word "Unknown", never "$0". "MRR $0" shown to a
 *                      project-based consultant describes a failing subscription business that
 *                      does not exist.
 *   • not-computable — the reason. A real input made the arithmetic undefined; "needs your CAC" is
 *                      a lie to someone who told us it was zero.
 *   • known          — the number, including a real measured zero, plus its provenance.
 *
 * A DERIVED figure always shows what it came from, and a ratio always shows its sample size —
 * including when that sample size is not recorded, which it says rather than quietly omitting.
 * Hiding a number the reader could judge for themselves is its own dishonesty.
 */
export function FigureTile({
  label,
  figure,
  note,
}: {
  label: string;
  figure: CashFigure;
  note?: string;
}) {
  const body = (() => {
    if (figure.state === "unknown") {
      return (
        <>
          <div className="stat-value" style={{ color: "var(--ink-soft)" }}>
            —
          </div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>{figure.needs}</p>
        </>
      );
    }
    if (figure.state === "not-applicable" || figure.state === "not-computable") {
      return (
        <>
          <div className="stat-value" style={{ color: "var(--ink-soft)" }}>
            —
          </div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>{figure.because}</p>
        </>
      );
    }
    return (
      <>
        <div className="stat-value">{formatFigureValue(figure.value, figure.unit)}</div>
        {figure.origin === "derived" && figure.from ? (
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            from {figure.from}
            {figure.unit === "ratio" || figure.sampleSize !== undefined
              ? figure.sampleSize === null || figure.sampleSize === undefined
                ? " · sample size not recorded"
                : ` · from ${figure.sampleSize} ${figure.sampleSize === 1 ? "customer" : "customers"}`
              : null}
          </p>
        ) : null}
        {figure.origin === "stated" ? (
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            {figure.statedAt === undefined
              ? "You told us this."
              : `You told us this on ${shortDay(figure.statedAt)}.`}
            {figure.stale ? " Is this still right?" : ""}
          </p>
        ) : null}
        {figure.origin === "observed" ? (
          <p style={{ ...muted, fontSize: "0.8rem" }}>Measured by Pikar.</p>
        ) : null}
      </>
    );
  })();

  return (
    <div className="stat-tile" data-figure-state={figure.state} data-figure={label}>
      <div className="stat-head">
        <p className="caps-label">{label}</p>
      </div>
      {body}
      {note ? <p style={{ ...muted, fontSize: "0.78rem" }}>{note}</p> : null}
    </div>
  );
}

const UNIT_ECONOMICS_LABELS: Record<string, string> = {
  cfa: "Does a customer pay for itself in 30 days?",
  ltgp: "Lifetime gross profit",
  ltgpCac: "LTGP:CAC",
  cacPayback: "CAC payback",
  cacVsIndustry: "CAC vs industry average",
  grossMargin: "Gross margin",
  cohortChurn: "Monthly churn",
  referralPct: "Referral share",
};

/**
 * The Hormozi spine. `keys` comes from the tenant's tier set, so a solopreneur is never shown the
 * ratio stack the source material says is unreadable at their sample size.
 */
export function UnitEconomicsSection({
  economics,
  keys,
}: {
  economics: Record<string, CashFigure>;
  keys: readonly string[];
}) {
  if (keys.length === 0) return null;
  return (
    <section style={stack} aria-labelledby="cash-unit-heading">
      <h2 id="cash-unit-heading" style={cardTitle}>
        Does each customer pay for itself?
      </h2>
      <section className="stat-grid" aria-label="Unit economics">
        {keys.map((key) => {
          const figure = economics[key];
          if (!figure) return null;
          return (
            <FigureTile key={key} label={UNIT_ECONOMICS_LABELS[key] ?? key} figure={figure} />
          );
        })}
      </section>
    </section>
  );
}
```

Until Task 8 supplies the set, pass `Object.keys(economics)` as `keys`.

`SolvencySection` in Task 9 is the same shape with its own label map plus the outside-the-framework frame line — build it by copying this component, not by generalising both into one configurable renderer nobody asked for.

- [ ] **Step 4: Add the backend query**

```ts
export const unitEconomics = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const states = (await inputStatesFor(ctx, ctx.tenantId, now)).inputs;
    const evaluation = await latestScorecardRow(ctx.db, ctx.tenantId);
    return coreUnitEconomics({
      inputs: toCashInputs(states),
      scorecard: (evaluation?.scorecard as Scorecard | undefined) ?? emptyScorecard,
      nowMs: now,
    });
  },
});
```

Extract the body of the `inputs` query into a shared `async function inputStatesFor(ctx, tenantId, nowMs)` and have both `inputs` and `unitEconomics` call it — one read path, so the panel and the metrics can never disagree about what the tenant has entered. Import the core function as `coreUnitEconomics` to avoid shadowing the export name.

- [ ] **Step 5: Add the adapter tests**

Append to `packages/backend/convex/cash.test.ts`: unauthenticated rejection; a foreign tenant's scorecard is not read (seed an evaluation for `tenant-b`, assert `tenant-a`'s CFA is `unknown`); and a full happy path (seed `cac` and `thirtyDayCashPerCustomer` through `saveInput`, assert `cfa.state === "known"` and `origin === "derived"`).

- [ ] **Step 6: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
graphify update . && node scripts/extract-convex-edges.mjs
git add packages/backend/convex/cash.ts packages/backend/convex/cash.test.ts apps/web/app/\(app\)/dashboard/finance docs/playbooks graphify-out
git commit -m "feat(cash): unit economics on the Business tab"
```

**Slice 2 is now shippable.**

---

# SLICE 3 — solvency and tier differentiation

---

### Task 7: Solvency — runway, net burn, MRR/ARR, working capital

**Files:**
- Modify: `packages/core/src/cash.ts`
- Modify: `packages/core/src/cash.test.ts`

**Interfaces:**
- Consumes: Task 4's helpers.
- Produces:
  - `type CashSolvency = { runway: CashFigure; netBurn: CashFigure; mrr: CashFigure; arr: CashFigure; workingCapital: CashFigure }`
  - `solvency(args: { inputs: CashInputs; tier: Tier; revenueStage: RevenueStage | null; nowMs: number }): CashSolvency`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/cash.test.ts`:

```ts
import { solvency } from "./cash";

const sol = (values: Record<string, number>, tier = "startup" as const) =>
  solvency({ inputs: withInputs(values), tier, revenueStage: "early-revenue", nowMs: NOW });

describe("solvency — the finance-ops layer", () => {
  test("runway is cash over monthly burn, in months", () => {
    const result = sol({ cashOnHand: 60_000, monthlyOperatingCost: 10_000 });
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
    const result = sol({ cashOnHand: 0, monthlyOperatingCost: 5_000 });
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
      revenueStage: "early-revenue",
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
      revenueStage: "steady-revenue",
      nowMs: NOW,
    });
    expect(result.workingCapital).toMatchObject({ state: "known", value: -15_000 });
  });

  test("working capital is not-applicable below SME", () => {
    expect(sol({ receivables: 1, payables: 1 }).workingCapital).toMatchObject({
      state: "not-applicable",
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @pikar/core test cash`
Expected: FAIL — `solvency` is not exported.

- [ ] **Step 3: Implement**

```ts
export type CashSolvency = {
  runway: CashFigure;
  netBurn: CashFigure;
  mrr: CashFigure;
  arr: CashFigure;
  workingCapital: CashFigure;
};

/**
 * The finance-ops layer. DELIBERATELY OUTSIDE the Hormozi framework — none of `runway`, `burn`,
 * `MRR`, `ARR` or `working capital` appears anywhere in the source material, and the page marks
 * this section as such rather than presenting it as part of the spine. It earns its place because
 * it is the survival metric for exactly the population the books exclude: businesses running on
 * outside money, for whom the constraint is the date the money ends.
 *
 * `not-applicable` here is decided by the TIER, never inferred from absent data. A solopreneur with
 * project revenue has no meaningful monthly recurring figure — that is a fact about their business,
 * not a gap in their answers, and "MRR $0" would describe a failing subscription business that does
 * not exist.
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
  // burning", and a negative burn rendered as a number reads as a deeper hole.
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
```

`derived` currently produces `origin: "derived"` values that can be negative; `knownFigure` must not reject them (working capital is legitimately negative). Confirm no guard blocks it.

- [ ] **Step 4: Run**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS — all ten.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cash.ts packages/core/src/cash.test.ts docs/playbooks/dashboard-pages.md
git commit -m "feat(cash): solvency, with not-burning and never-infinite runway"
```

---

### Task 8: Which metrics this tenant sees — tier sets and the capital-posture headline

**Files:**
- Modify: `packages/core/src/cash.ts`
- Modify: `packages/core/src/cash.test.ts`

**Interfaces:**
- Produces:
  - `type CashMetricKey` (the closed union of every renderable metric)
  - `type CashMetricSet = { headline: CashMetricKey; unitEconomics: CashMetricKey[]; solvency: CashMetricKey[]; activity: CashMetricKey[] }`
  - `metricSetFor(tier: Tier, funding: Funding | null): CashMetricSet`
  - `hasOutsideMoney(funding: Funding | null): boolean`

**The one rule:** capital posture wins the headline; the tier keeps the sets below it. No per-cell exceptions.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/cash.test.ts`:

```ts
import { metricSetFor } from "./cash";

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
    expect(set.unitEconomics).toEqual(expect.arrayContaining(["ltgpCac", "grossMargin", "cohortChurn"]));
  });

  test("ROAS is not a metric key anywhere", () => {
    for (const tier of ["solopreneur", "startup", "sme", "enterprise"] as const) {
      const set = metricSetFor(tier, "bootstrapped");
      expect(JSON.stringify(set).toLowerCase()).not.toContain("roas");
    }
  });

  test("an unknown funding posture falls back to the tier's typical headline, never to a blank", () => {
    expect(metricSetFor("startup", null).headline).toBe("runway");
    expect(metricSetFor("solopreneur", null).headline).toBe("cfa");
  });

  test("every set's headline also appears in one of its rows, so the page never orphans it", () => {
    for (const tier of ["solopreneur", "startup", "sme", "enterprise"] as const) {
      for (const funding of ["bootstrapped", "seeking", "funded", null] as const) {
        const set = metricSetFor(tier, funding);
        const all = [...set.unitEconomics, ...set.solvency, ...set.activity];
        expect(all).toContain(set.headline);
      }
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @pikar/core test cash`
Expected: FAIL — `metricSetFor` is not exported.

- [ ] **Step 3: Implement**

```ts
export type CashMetricKey =
  | "cfa"
  | "ltgp"
  | "ltgpCac"
  | "cacPayback"
  | "cacVsIndustry"
  | "grossMargin"
  | "cohortChurn"
  | "runway"
  | "netBurn"
  | "mrr"
  | "arr"
  | "workingCapital"
  | "reachOutsPerDay"
  | "postsPerDay"
  | "streak"
  | "engagedLeads"
  | "referralPct";

export type CashMetricSet = {
  headline: CashMetricKey;
  unitEconomics: CashMetricKey[];
  solvency: CashMetricKey[];
  activity: CashMetricKey[];
};

/**
 * `seeking` counts as outside money alongside `funded`. Precedent: `deriveTier` already groups them
 * ("seeking and funded both read as startup-shaped"), and a company raising watches the date the
 * money ends exactly like a funded one does.
 */
export const hasOutsideMoney = (funding: Funding | null): boolean =>
  funding === "funded" || funding === "seeking";

/**
 * A TABLE, deliberately not a switch: a tier added to the union without a set is a COMPILE error
 * here rather than a silent inheritance of someone else's metrics (the `TIER_REASON` precedent).
 */
const TIER_SETS = {
  solopreneur: {
    typicalHeadline: "cfa",
    unitEconomics: ["cfa", "ltgpCac"],
    solvency: ["runway"],
    activity: ["reachOutsPerDay", "postsPerDay", "streak", "engagedLeads"],
  },
  startup: {
    typicalHeadline: "runway",
    unitEconomics: ["ltgpCac", "cacPayback", "cacVsIndustry"],
    solvency: ["mrr", "arr", "netBurn", "runway"],
    activity: ["referralPct"],
  },
  sme: {
    typicalHeadline: "workingCapital",
    unitEconomics: ["ltgpCac", "grossMargin", "cohortChurn"],
    solvency: ["workingCapital", "netBurn", "runway", "mrr", "arr"],
    activity: ["referralPct"],
  },
  enterprise: {
    typicalHeadline: "workingCapital",
    unitEconomics: ["cfa", "ltgp", "ltgpCac", "cacPayback", "cacVsIndustry", "grossMargin", "cohortChurn"],
    solvency: ["workingCapital", "netBurn", "runway", "mrr", "arr"],
    activity: ["referralPct"],
  },
} as const satisfies Record<
  Tier,
  { typicalHeadline: CashMetricKey } & Omit<CashMetricSet, "headline">
>;

/**
 * THE selection rule, and there is exactly one exception clause in it.
 *
 * Capital posture decides the HEADLINE, because it is the one segmentation axis the source material
 * argues for: without outside money a customer paying for itself inside 30 days IS survival, and
 * with outside money the constraint is the date the money ends. The TIER decides the sets below.
 * When they disagree, posture wins the headline and the tier keeps its rows — one rule, no per-cell
 * exceptions.
 *
 * The tier's `typicalHeadline` is the fallback when the posture is unknown: it is what the typical
 * posture for that tier produces, so an incomplete profile still gets a sensible lead rather than a
 * blank.
 */
export function metricSetFor(tier: Tier, funding: Funding | null): CashMetricSet {
  const base = TIER_SETS[tier];
  const headline: CashMetricKey =
    funding === null
      ? base.typicalHeadline
      : hasOutsideMoney(funding)
        ? "runway"
        : tier === "sme" || tier === "enterprise"
          ? "workingCapital"
          : "cfa";

  const set: CashMetricSet = {
    headline,
    unitEconomics: [...base.unitEconomics],
    solvency: [...base.solvency],
    activity: [...base.activity],
  };

  // A headline the page does not otherwise render would be an orphan. A funded solopreneur leads
  // with runway, and runway is already in their solvency row — this only fires if a future set
  // omits it.
  const rendered = [...set.unitEconomics, ...set.solvency, ...set.activity];
  if (!rendered.includes(headline)) set.solvency = [headline, ...set.solvency];
  return set;
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS — all nine.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cash.ts packages/core/src/cash.test.ts docs/playbooks/dashboard-pages.md
git commit -m "feat(cash): tier sets, and capital posture wins the headline"
```

---

### Task 9: The Business tab, assembled

**Files:**
- Modify: `packages/backend/convex/cash.ts` (`shape` and `solvency` queries)
- Modify: `packages/backend/convex/cash.test.ts`
- Modify: `apps/web/app/(app)/dashboard/finance/CashView.tsx`
- Modify: `apps/web/app/(app)/dashboard/finance/cashView.test.ts`

**Interfaces:**
- Consumes: `metricSetFor`, `solvency`, `unitEconomics`, `activityFromSends`.
- Produces:
  - `cash.shape` tenantQuery → `{ tier: Tier | null; funding: Funding | null; revenueStage: RevenueStage | null }`
  - `cash.solvency` tenantQuery → `CashSolvency`
  - `HeadlineCard({ metric, figure, tier, funding })`, `SolvencySection({ solvency, set })`, `ShapeMissingNotice()` in `CashView.tsx`

- [ ] **Step 1: Write the failing tests**

Adapter (`packages/backend/convex/cash.test.ts`):

```ts
describe("cash.shape", () => {
  test("a tenant with no profile row gets a null tier, not a guessed solopreneur", async () => {
    const t = convexTest(schema);
    const result = await asTenant(t, "tenant-a").query(api.cash.shape, {});
    expect(result.tier).toBeNull();
    expect(result.funding).toBeNull();
  });

  test("the tier and posture come from tenantProfiles, read-only", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        funding: "funded",
        revenueStage: "early-revenue",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.shape, {});
    expect(result).toMatchObject({ tier: "startup", funding: "funded" });
  });

  test("one tenant's shape is not another's", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "sme",
        tierSource: "derived",
        derivedAt: Date.now(),
      });
    });
    expect((await asTenant(t, "tenant-b").query(api.cash.shape, {})).tier).toBeNull();
  });
});

describe("tier change", () => {
  test("inputs persist untouched when a solopreneur hires — they are facts about the business", async () => {
    const t = convexTest(schema);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 20_000 });
    await as.mutation(api.cash.saveInput, { field: "cac", value: 300 });

    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        funding: "bootstrapped",
      });
    });

    const inputs = await as.query(api.cash.inputs, {});
    expect(inputs.inputs.find((i) => i.field === "cashOnHand")?.value).toBe(20_000);
    expect(inputs.inputs.find((i) => i.field === "cac")?.value).toBe(300);
    // A newly visible metric shows unknown with its prompt, never back-filled.
    expect(inputs.inputs.find((i) => i.field === "mrr")?.value).toBeNull();
  });
});
```

View (`cashView.test.ts`):

```ts
import { HeadlineCard, ShapeMissingNotice } from "./CashView";

describe("the headline", () => {
  test("a bootstrapped tenant is led by CFA, framed as the question it answers", () => {
    const html = render(HeadlineCard, {
      metric: "cfa",
      figure: { state: "known", origin: "derived", value: 2.5, unit: "ratio", from: "x", sampleSize: 4 },
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @pikar/backend test cash` and `pnpm --filter @pikar/web test cashView`
Expected: FAIL on `api.cash.shape` / `HeadlineCard` not existing.

- [ ] **Step 3: Add the two queries**

```ts
/**
 * The tenant's business SHAPE, read-only. The tier is derived from facts by
 * `tenantProfile.saveFacts` and is never settable here — this page consumes it and nothing more.
 * A tenant with no row gets nulls rather than a guessed "solopreneur": guessing is what the
 * markdown-fallback defect did, and a wrong guess here selects the wrong metric set.
 */
export const shape = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return {
      tier: row?.tier ?? null,
      funding: row?.funding ?? null,
      revenueStage: row?.revenueStage ?? null,
    };
  },
});

export const solvency = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const row = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const states = (await inputStatesFor(ctx, ctx.tenantId, now)).inputs;
    return coreSolvency({
      inputs: toCashInputs(states),
      // No profile row: treat as solopreneur for not-applicable resolution, which is the most
      // conservative set — it hides MRR/ARR rather than inventing them. The page separately shows
      // the complete-your-shape invitation, so this is never the whole story a user sees.
      tier: row?.tier ?? "solopreneur",
      revenueStage: row?.revenueStage ?? null,
      nowMs: now,
    });
  },
});
```

- [ ] **Step 4: Assemble `CashTab`**

Order, top to bottom: `HeadlineCard` → `UnitEconomicsSection` → `SolvencySection` → `ActivitySection` → `NumbersPanel`, exactly as the spec's Section 3 states.

Each section keeps its own `useQuery` (`cash.shape`, `cash.unitEconomics`, `cash.solvency`, `cash.activity`, `cash.inputs`) so one failing read cannot take the others down. Compute the set once from `cash.shape` with `metricSetFor(tier, funding)` and pass the relevant key list into each section; a section whose set is empty renders nothing rather than an empty heading.

`SolvencySection` carries a one-line frame marking the layer honestly — something like *"Not part of the growth framework. These are the figures investors and accountants ask for."* — because the spec is explicit that the finance-ops layer must be marked as outside the Hormozi framework rather than presented as part of it.

When `shape.tier === null`, render `ShapeMissingNotice` above the headline: a non-blocking link to `/dashboard/profile?tab=shape`, never a modal, never a redirect, never a gate (the profile page's legacy-tenant precedent).

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
graphify update . && node scripts/extract-convex-edges.mjs
git add packages/backend/convex apps/web/app/\(app\)/dashboard/finance docs/playbooks graphify-out
git commit -m "feat(cash): the Business tab, ordered by the capital-posture switch"
```

---

### Task 10: Browser evidence and the two source-scan guards

**Files:**
- Modify: `apps/web/e2e/finance.spec.ts`
- Modify: `packages/core/src/cash.test.ts` (source scan)
- Docs: `docs/playbooks/dashboard-pages.md`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the source-scan guards**

Append to `packages/core/src/cash.test.ts`. This is the `businessProfile.test.ts` / `vaultSurface.test.ts` idiom — read the surface as source text, because a prohibition on a WORD cannot be asserted any other way:

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
```

Adjust the relative paths to whatever resolves from `packages/core/src/`; verify by running the test and reading the failure, not by assuming.

- [ ] **Step 2: Run and confirm both pass**

Run: `pnpm --filter @pikar/core test cash`
Expected: PASS. If either fails, the fix is to remove the word from the surface, never to weaken the pattern.

- [ ] **Step 3: Extend the browser spec**

In `apps/web/e2e/finance.spec.ts`, keep the existing ordering discipline verbatim — **the non-owner assertions run FIRST**, because `owner:bootstrapOwner` has no inverse and once the test user is the owner the boundary can no longer be observed from that account. Add:

```ts
test("the Finance page opens on Business, and a non-owner is offered no Operator tab", async ({ page }) => {
  await page.goto(`${appOrigin}${ROUTE}`);
  const tablist = page.getByRole("tablist", { name: "Finance sections" });
  await expect(tablist.getByRole("tab", { name: "Business" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tablist.getByRole("tab", { name: "Pikar spend" })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: "Operator" })).toHaveCount(0);
});

test("the Cost console is intact behind the Pikar spend tab", async ({ page }) => {
  await page.goto(`${appOrigin}${ROUTE}`);
  await page.getByRole("tab", { name: "Pikar spend" }).click();
  await expect(page.getByRole("heading", { name: /budget rails/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /where it went/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /media job ledger/i })).toBeVisible();
});

test("a number entered in the panel appears as a business figure", async ({ page }) => {
  await page.goto(`${appOrigin}${ROUTE}`);
  // Seeds through the real mutation, so this proves the panel → mutation → derivation → render
  // path end to end. It proves nothing about any external system.
  await page.getByLabel("Cash on hand").fill("60000");
  await page.getByRole("button", { name: /save cash on hand/i }).click();
  await page.getByLabel("Monthly operating cost").fill("10000");
  await page.getByRole("button", { name: /save monthly operating cost/i }).click();
  await expect(page.getByText(/6 months/i)).toBeVisible();
});
```

Then, **after** the existing owner-bootstrap step, add:

```ts
test("an owner gets the Operator tab, and the deployment controls live there", async ({ page }) => {
  await page.goto(`${appOrigin}${ROUTE}`);
  await page.getByRole("tab", { name: "Operator" }).click();
  await expect(page.getByRole("heading", { name: /deployment controls/i })).toBeVisible();
  // And they are NOT on the tenant's own tabs any more — the original complaint.
  await page.getByRole("tab", { name: "Business" }).click();
  await expect(page.getByText(/master kill switch/i)).toHaveCount(0);
});
```

Make sure the panel's inputs carry accessible labels and its buttons carry accessible names matching these selectors; if they do not, fix the component, not the selector.

- [ ] **Step 4: Run the browser evidence**

Run: `pnpm test:e2e` against a running deployment.
Expected: PASS. **Record the actual output in the commit message or the phase summary.** A green run here is accounting evidence about seeded state and the projection — it proves nothing about any provider or external charge, and no claim beyond that may be made from it.

- [ ] **Step 5: Final playbook pass**

`docs/playbooks/dashboard-pages.md` gets its full update: the three-tab structure, the four-state `CashFigure` contract and why `not-computable` is not `unknown`, the storage split and the one-writer rule, the capital-posture headline rule, the 90-day staleness threshold and its `createdAt` floor, the industry-CAC switch being off by default, and the two source-scan guards. Bump `Last verified` with today's date and the reason.

- [ ] **Step 6: Final verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, all three.

```bash
graphify update . && node scripts/extract-convex-edges.mjs
git add apps/web/e2e/finance.spec.ts packages/core/src/cash.test.ts docs/playbooks graphify-out
git commit -m "test(cash): browser evidence for the tabs, and the ROAS/no-price guards"
```

---

## Mutation checks — the tests that must go red

Named up front so a reviewer can verify each one bites. Make the mutation, run the test, confirm red, revert.

| Mutation | Test that must go red |
|---|---|
| Collapse `not-applicable` into `unknown` in `solvency` | `packages/core/src/cash.test.ts` → "MRR is NOT-APPLICABLE for a solopreneur" |
| Collapse `not-computable` into `unknown` | "CAC of zero is NOT-COMPUTABLE, never infinity and never unknown" |
| Render a derived figure with one null input | "a derived figure is SUPPRESSED when any input is unknown" |
| Drop the sample size from a ratio | "an unrecorded sample size is null and never omitted" + the view's "sample size not recorded" |
| Return `Infinity` for CAC = 0 | "CAC of zero is NOT-COMPUTABLE" |
| Return `Infinity` for monthly cost = 0 | "a monthly cost of zero is NOT infinite runway" |
| Allow negative runway | "zero cash with a real burn is 0 months, never negative" |
| Let the tier win the headline over posture | "capital posture WINS the headline when it disagrees with the tier" |
| Default the industry-CAC switch to a pass | "the industry-CAC switch is OFF until the user supplies the average" |
| Duplicate CAC into `financeInputs` | "a Hormozi field lands on the SCORECARD — CAC is never duplicated" |
| Show the Operator tab to a non-owner | "a non-owner is offered no Operator tab at all" + the e2e |
| Add a ROAS metric | "ROAS appears nowhere" |

---

## Out of scope

Stated so an executor does not drift into them:

- **Connector-derived figures.** Beta is user-entered only. Stripe/QuickBooks/HubSpot rails are Phase 28; when they land they replace `stated` with `observed` behind the same origin vocabulary, with no redesign of this page.
- **Tenant-settable spend caps and monthly windows.**
- **Tier pricing.**
- **Industry-average CAC data.** The source supplies no table; the user provides it or the switch stays off.
- **Anything on the Pikar-spend tab.** It moves; it does not change.
