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
