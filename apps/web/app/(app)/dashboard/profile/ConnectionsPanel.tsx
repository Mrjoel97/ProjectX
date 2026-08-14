"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { DisconnectGoogle } from "../../_components/DisconnectGoogle";
import { DisconnectMicrosoft } from "../../_components/DisconnectMicrosoft";
import { BLOCKED } from "./connections";
import { card, label } from "./styles";

// The connections surface. There are now TWO connectable providers (17-06 added Microsoft), and
// both rows are still written CONCRETELY — no Record<Provider, …> lookup and no ConnectionRow
// interface.
//
// That is a deliberate re-decision, not inherited inertia. The original note said Phase 25 would
// mint the lookup "in the same commit as the Microsoft Graph adapter". Two rows is not enough
// repetition to pay for an abstraction: the readiness fields genuinely differ (Google reports
// `driveReady`, Microsoft reports `calendarReady` AND `mailReady`), so a shared row component would
// need a per-provider slot for the one part that matters — an abstraction that abstracts nothing.
// Revisit at a THIRD provider, when the shape is actually known.

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
      <MicrosoftRow />

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

// 17-06 (ADR-018): ONE Microsoft connection covering calendar AND Outlook mail. The row names both
// halves because this tab is the answer to "what is Pikar connected to" — an unnamed capability is
// invisible here. `connectionsSurface.test.ts` fails until it names every capability in the grant.
function MicrosoftRow() {
  const status = useQuery(api.microsoftAuth.microsoftStatus);

  return (
    <div style={row} data-testid="connections-microsoft">
      <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
        <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>
          Microsoft — Calendar &amp; Outlook mail
        </strong>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
          {/* `undefined` = still loading. Rendering "Not connected" here would be a FALSE NEGATIVE
              inviting the user to reconnect an already-connected account — same rule as the row
              above, and the same reason. */}
          {status === undefined
            ? "Checking…"
            : !status.connected
              ? "Not connected"
              : status.expiresAt
                ? `Access token expires ${new Date(status.expiresAt).toLocaleString()}`
                : "Connected"}
        </span>
        {/* A CONNECTED GRANT IS NOT NECESSARILY A COMPLETE ONE. Microsoft can return LESS than was
            requested, and a grant stored before a widening keeps its old scope string — so
            `connected` alone reports a half-grant as healthy. These two lines are the only place a
            user learns which half is missing before hitting a 403. */}
        {status?.connected && !status.calendarReady && (
          <span style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
            Calendar is not included in this connection. Reconnect to add it.
          </span>
        )}
        {status?.connected && !status.mailReady && (
          <span style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
            Outlook mail is not included in this connection. Reconnect to add it.
          </span>
        )}
      </div>
      {/* `<DisconnectMicrosoft />` renders UNCONDITIONALLY — never gated on `status.connected`,
          for the reason its own block comment gives: the action deletes the row before returning,
          so gating the mount here would unmount the component before its provider-revocation
          notice could be read. */}
      <div style={{ display: "grid", gap: "0.4rem", justifyItems: "end" }}>
        {status !== undefined &&
          (!status.connected || !status.calendarReady || !status.mailReady) && (
            <a
              href="/connect-microsoft"
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
              {status.connected ? "Reconnect" : "Connect"}
            </a>
          )}
        <DisconnectMicrosoft />
      </div>
    </div>
  );
}

function GoogleRow() {
  const status = useQuery(api.gmailAuth.gmailStatus);

  return (
    <div style={row}>
      <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
        <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>
          Google — Gmail, Calendar &amp; Drive
        </strong>
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
        {/* ⚠ A CONNECTED GRANT IS NOT NECESSARILY A COMPLETE ONE, and this is the only surface that
            can say so. `include_granted_scopes` is forward-only, so a tenant who connected before
            15.3-09 is fully connected for mail and calendar and holds NO Drive scope — `connected`
            alone reports that as healthy. Without this line the vault's Drive panel is the only
            place the shortfall is visible, and a user who never opens the vault never learns why
            their imports are missing. */}
        {status?.connected && !status.driveReady && (
          <span style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
            Drive is not included in this connection — it was made before Drive access existed.
            Reconnect to add it; mail and calendar keep working either way.
          </span>
        )}
      </div>
      {/* `<DisconnectGoogle />` renders UNCONDITIONALLY — never gated on `status.connected` here.
          It carries its own `gmailStatus` subscription and decides for itself whether to show the
          button, a partial-revoke warning, or nothing. Gating its mount on this row's `connected`
          check is exactly the bug this shape fixes: the action flips `connected` to false before
          returning, which would unmount the component before its warning could render. After a
          failed revoke the user correctly sees BOTH the warning below AND the Connect link. */}
      <div style={{ display: "grid", gap: "0.4rem", justifyItems: "end" }}>
        {status !== undefined && (!status.connected || !status.driveReady) && (
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
            {status.connected ? "Reconnect" : "Connect"}
          </a>
        )}
        <DisconnectGoogle />
      </div>
    </div>
  );
}
