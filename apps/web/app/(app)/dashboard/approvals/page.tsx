"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type KeyboardEvent, Suspense, useRef } from "react";
import { ComplianceView } from "../../ops/page";
import { ApprovalsView } from "./ApprovalsView";

export const APPROVAL_COMPLIANCE_TABS = [
  { id: "approvals", label: "Approvals" },
  { id: "compliance", label: "Compliance" },
] as const;

export type ApprovalComplianceTab = (typeof APPROVAL_COMPLIANCE_TABS)[number]["id"];

export function isApprovalComplianceTab(value: string | null): value is ApprovalComplianceTab {
  return APPROVAL_COMPLIANCE_TABS.some((tab) => tab.id === value);
}

const pageStyle: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gap: "1.5rem",
  alignContent: "start",
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  appearance: "none",
  border: 0,
  borderBottom: active ? "3px solid var(--teal-600)" : "3px solid transparent",
  background: "transparent",
  color: active ? "var(--ink)" : "var(--ink-soft)",
  cursor: "pointer",
  font: "inherit",
  fontWeight: active ? 700 : 600,
  padding: "0.7rem 1rem",
});

export function ApprovalComplianceTabs({
  tab,
  onSelect,
  onKeyDown,
  registerTab,
}: {
  tab: ApprovalComplianceTab;
  onSelect: (tab: ApprovalComplianceTab) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  registerTab?: (tab: ApprovalComplianceTab, element: HTMLButtonElement | null) => void;
}) {
  return (
    <div style={pageStyle}>
      <header style={{ display: "grid", gap: "0.4rem" }}>
        <p className="caps-label" style={{ margin: 0 }}>
          Governance
        </p>
        <h1
          style={{
            margin: 0,
            color: "var(--ink)",
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.75rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
          }}
        >
          Approval &amp; Compliance
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Review guarded work and monitor the controls that keep it accountable.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Approval and compliance sections"
        onKeyDown={onKeyDown}
        style={{
          display: "flex",
          gap: "0.35rem",
          borderBottom: "1px solid var(--rule)",
          overflowX: "auto",
        }}
      >
        {APPROVAL_COMPLIANCE_TABS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              ref={(element) => registerTab?.(item.id, element)}
              id={`approval-compliance-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`approval-compliance-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(item.id)}
              style={tabStyle(active)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <section
        id={`approval-compliance-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`approval-compliance-tab-${tab}`}
      >
        {tab === "compliance" ? (
          <ComplianceView headingLevel="h2" />
        ) : (
          <ApprovalsView headingLevel="h2" />
        )}
      </section>
    </div>
  );
}

// WHY `useSearchParams` HERE, AND NOT THIS REPO'S USUAL ONE-SHOT `window.location.search` READ
// (the idiom documented in dashboard/voice/page.tsx:23-30): those reads are for values that arrive
// ONCE via a redirect and never change while the page stays mounted. `?tab=` is not one of those —
// it is NAVIGABLE. The rail's "Compliance" entry and ApprovalsView's "Review in Compliance" link
// both target THIS route, and the App Router serves a same-route `<Link>` as a soft navigation that
// does NOT remount the page. A mount-time snapshot therefore left the URL saying `compliance` while
// the panel still showed `approvals` — the link looked broken because the tab could not hear it.
// Deriving the tab on every render is the fix, and the Suspense boundary below is the price the App
// Router charges for that, paid the same way (auth)/signup/page.tsx already pays it.
function ApprovalComplianceSurface() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: ApprovalComplianceTab = isApprovalComplianceTab(requested) ? requested : "approvals";

  // Roving-tabindex: changing `tabIndex` does not move DOM focus, so the keyboard path moves it.
  const tabRefs = useRef<Partial<Record<ApprovalComplianceTab, HTMLButtonElement>>>({});

  // `router.replace`, NOT `history.replaceState`: only a router navigation re-runs
  // `useSearchParams`, and a manual history write would put the URL and the panel back out of sync
  // — the exact bug this component was just fixed for. `replace` (not `push`) preserves the
  // property the old `replaceState` was chosen for: one history entry per visit, not per click.
  function selectTab(next: ApprovalComplianceTab) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    router.replace(`/dashboard/approvals?${params}`, { scroll: false });
  }

  return (
    <ApprovalComplianceTabs
      tab={tab}
      onSelect={selectTab}
      registerTab={(id, element) => {
        if (element) tabRefs.current[id] = element;
      }}
      onKeyDown={(event) => {
        const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (delta === 0) return;
        event.preventDefault();
        const index = APPROVAL_COMPLIANCE_TABS.findIndex((item) => item.id === tab);
        const next =
          APPROVAL_COMPLIANCE_TABS[
            (index + delta + APPROVAL_COMPLIANCE_TABS.length) % APPROVAL_COMPLIANCE_TABS.length
          ];
        if (!next) return;
        selectTab(next.id);
        tabRefs.current[next.id]?.focus();
      }}
    />
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense
      fallback={
        <p role="status" aria-live="polite" style={{ color: "var(--ink-soft)" }}>
          Loading approval and compliance controls…
        </p>
      }
    >
      <ApprovalComplianceSurface />
    </Suspense>
  );
}
