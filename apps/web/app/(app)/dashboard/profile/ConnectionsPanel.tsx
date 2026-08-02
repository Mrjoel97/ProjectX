"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { DisconnectGoogle } from "../../_components/DisconnectGoogle";
import { BLOCKED } from "./connections";
import { card, label } from "./styles";

// The connections surface. Google is the only provider that can connect today, so it is written
// CONCRETELY — no Record<Provider, …> lookup and no ConnectionRow interface. Phase 25 mints that
// lookup in the same commit as the Microsoft Graph adapter (spec §3), not before.

const row: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  alignItems: "flex-start",
  justifyContent: "space-between",
  flexWrap: "wrap",
  border: "1px solid var(--rule)",
  borderRadius: "0.8rem",
  padding: "0.9rem 1rem",
  background: "var(--canvas)",
};

const pill: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
  border: "1px solid var(--rule)",
  borderRadius: "999px",
  padding: "0.2rem 0.6rem",
  whiteSpace: "nowrap",
};

export function ConnectionsPanel() {
  return (
    <section style={card} aria-label="Connections">
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span style={label}>Connections</span>
        <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "1.2rem" }}>
          What Pikar is connected to
        </h2>
      </div>

      <GoogleRow />

      {BLOCKED.map((c) => (
        <div key={c.id} style={row}>
          <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
            <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>{c.label}</strong>
            <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{c.blocker}</span>
          </div>
          <span style={pill}>Not available</span>
        </div>
      ))}
    </section>
  );
}

function GoogleRow() {
  const status = useQuery(api.gmailAuth.gmailStatus);

  return (
    <div style={row}>
      <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
        <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>Google — Gmail &amp; Calendar</strong>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
          {/* `undefined` = still loading. Rendering "Not connected" here would be a FALSE NEGATIVE
              inviting the user to reconnect an already-connected account — the flash-of-wrong-state
              class this codebase has been bitten by before (see the rail shell and DeadLetterBadge,
              both of which render nothing rather than guess). */}
          {status === undefined
            ? "Checking…"
            : !status.connected
              ? "Not connected"
              : status.expiresAt
                ? `Access token expires ${new Date(status.expiresAt).toLocaleString()}`
                : "Connected"}
        </span>
      </div>
      {/* `<DisconnectGoogle />` renders UNCONDITIONALLY — never gated on `status.connected` here.
          It carries its own `gmailStatus` subscription and decides for itself whether to show the
          button, a partial-revoke warning, or nothing. Gating its mount on this row's `connected`
          check is exactly the bug this shape fixes: the action flips `connected` to false before
          returning, which would unmount the component before its warning could render. After a
          failed revoke the user correctly sees BOTH the warning below AND the Connect link. */}
      <div style={{ display: "grid", gap: "0.4rem", justifyItems: "end" }}>
        {status !== undefined && !status.connected && (
          <a
            href="/connect-gmail"
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "0.375rem",
              background: "var(--teal-600)",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
            }}
          >
            Connect
          </a>
        )}
        <DisconnectGoogle />
      </div>
    </div>
  );
}
