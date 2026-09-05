import { BillingPanel } from "./BillingPanel";
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
          Your billing and your data
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          What you pay Pikar, what Pikar is holding for you, and a portable record of everything it
          knows about your account.
        </p>
      </header>

      {/* Billing first: this page is also where Stripe Checkout sends you back to (`?checkout=`),
          so the first thing a returning customer reads has to be about their subscription. */}
      <BillingPanel />
      <DataControls />
    </div>
  );
}
