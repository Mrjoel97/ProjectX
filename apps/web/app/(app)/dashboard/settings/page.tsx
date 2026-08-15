import { DataControls } from "./DataControls";

export default function SettingsPage() {
  return (
    <div
      style={{
        width: "100%",
        padding: "2rem clamp(1rem, 2.5vw, 2.5rem)",
        display: "grid",
        gap: "1.5rem",
        alignContent: "start",
      }}
    >
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <span
          style={{
            color: "var(--ink-soft)",
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Settings
        </span>
        <h1
          style={{
            margin: 0,
            color: "var(--ink)",
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            fontWeight: 700,
          }}
        >
          Control your data
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          Download a portable record of the data Pikar AI holds for your account.
        </p>
      </header>

      <DataControls />
    </div>
  );
}
