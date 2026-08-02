// Shared profile-surface styles. Previously exported from `page.tsx`, which meant every panel
// imported from a page component — fine with one panel, wrong once the page became a tab shell.
// BRAND §8.3: inline style objects, no component library.

export const label: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
};

export const field: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  borderRadius: "0.7rem",
  border: "1px solid var(--rule)",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  background: "var(--card)",
  color: "var(--ink)",
  resize: "vertical",
};

export const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1.1rem",
  padding: "1.25rem",
  boxShadow: "0 12px 32px -24px rgb(14 20 25 / 45%)",
  display: "grid",
  gap: "1rem",
};

export const primaryButton = (disabled: boolean): React.CSSProperties => ({
  padding: "0.65rem 1.5rem",
  borderRadius: "999px",
  border: "none",
  background: "var(--teal-600)",
  color: "#fff",
  fontWeight: 700,
  fontSize: "0.95rem",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
  boxShadow: "0 8px 18px -8px rgb(0 150 137 / 70%)",
});
