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
  const active: FinanceTabId = tab !== null && tabs.some((t) => t.id === tab) ? tab : "business";

  const tabRefs = useRef<Partial<Record<FinanceTabId, HTMLButtonElement>>>({});

  function selectTab(next: FinanceTabId) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  const current = FINANCE_TABS.find((t) => t.id === active);

  return (
    // `minmax(0, 1fr)` — NOT the default implicit track. A grid's implicit column is `auto`, which
    // sizes to its widest item and REFUSES to go below it, and grid items default to
    // `min-width: auto` on top of that. So the Cost Console panel (a wide ledger table) widened this
    // one column to 441px at a 390px viewport, and every sibling stretched to match: the h1, the
    // eyebrow, the description and the tab strip all rendered 425px and clipped mid-word. The page
    // itself never scrolled — `document.documentElement.scrollWidth` stayed exactly 390 — which is
    // why a page-level overflow check reported clean and only a screenshot caught it.
    //
    // `minmax(0, 1fr)` lets the track shrink to the viewport; the tables then scroll inside their
    // own `scroller` wrappers (see FinanceView's `scroller`, which needs its own `minWidth: 0` for
    // the same reason). Measured at 390×844 on ?tab=spend: 103 elements past the edge before, 0
    // after, with the ledger still horizontally scrollable rather than truncated.
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "1.5rem",
        padding: "1.5rem 0",
      }}
    >
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
            owner queries for a non-owner and put OWNER_REQUIRED into the error boundary.

            EACH panel carries its OWN `FinanceView` error boundary (whole-branch review cleanup) —
            a single shared boundary used to wrap all three, so a thrown query error in ANY one tab
            took the whole tab tree down, not just that tab. Three separate boundaries turn that into
            "one tab degrades": Business staying up while Pikar spend fails, or vice versa. */}
      <div
        role="tabpanel"
        id="finance-panel-business"
        aria-labelledby="finance-tab-business"
        hidden={active !== "business"}
      >
        <FinanceView>
          <CashTab />
        </FinanceView>
      </div>
      <div
        role="tabpanel"
        id="finance-panel-spend"
        aria-labelledby="finance-tab-spend"
        hidden={active !== "spend"}
      >
        <FinanceView>
          <PikarSpendTab />
        </FinanceView>
      </div>
      {isOwner ? (
        <div
          role="tabpanel"
          id="finance-panel-operator"
          aria-labelledby="finance-tab-operator"
          hidden={active !== "operator"}
        >
          <FinanceView>
            <OperatorTab />
          </FinanceView>
        </div>
      ) : null}
    </div>
  );
}
