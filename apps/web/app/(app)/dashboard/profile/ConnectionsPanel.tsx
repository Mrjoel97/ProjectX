"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { DisconnectGoogle } from "../../_components/DisconnectGoogle";
import { DisconnectMicrosoft } from "../../_components/DisconnectMicrosoft";
import { BLOCKED } from "./connections";
import {
  type ConnectorRow,
  connectorBusyLabel,
  connectorListView,
  connectorRowView,
} from "./connectorRows";
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

const rowStyle: React.CSSProperties = {
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

const connectButton: React.CSSProperties = {
  padding: "0.45rem 0.9rem",
  borderRadius: "0.375rem",
  background: "var(--teal-600)",
  color: "#fff",
  border: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const disconnectButton: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  borderRadius: "0.375rem",
  background: "transparent",
  color: "var(--ink-soft)",
  border: "1px solid var(--rule)",
  fontWeight: 600,
  fontSize: "0.85rem",
  whiteSpace: "nowrap",
  cursor: "pointer",
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
      {/* Phase 28 connector rows sit HERE, ABOVE the blocked list, and the placement is load
          bearing. `packages/core/src/connectionsSurface.test.ts` scans the blocked-list block and
          asserts it holds no button, href or onClick. Connector rows are interactive, so putting
          them below would turn that scan red for the wrong reason.
          (This comment deliberately names neither delimiter the scan searches for — writing them
          here made `indexOf` land on the comment and slice 37 characters of prose instead.) */}
      <ConnectorRows />

      {BLOCKED.map((c) => (
        <div key={c.id} style={rowStyle}>
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
    <div style={rowStyle} data-testid="connections-microsoft">
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

/**
 * The Phase 28 connectors, and the whole row set is a function of the SERVER GATE.
 *
 * `connectorConnections.connections` returns only lanes whose gate resolved to `passed`, so a
 * parked, failed or expired provider is ABSENT here rather than filtered out by this component.
 * There is deliberately no client-side check of a provider name or an admission: a surface that
 * filtered for itself would be a second copy of the release rule, and the two would drift.
 *
 * An EMPTY list renders nothing at all. Today every lane is parked, so this component is invisible
 * — the correct amount of promise to make about connectors that have never spoken to a provider.
 *
 * Unlike the Google and Microsoft rows above, these ARE written through a shared row: four
 * providers with one identical shape is the repetition the panel comment above said to revisit at.
 */
function ConnectorRows() {
  const rows = useQuery(api.connectorConnections.connections);
  const list = connectorListView(rows);
  if (list.state === "checking") {
    return (
      <p role="status" aria-live="polite" style={{ margin: 0, color: "var(--ink-soft)" }}>
        Checking connector availability…
      </p>
    );
  }
  if (list.state === "hidden") return null;
  return (
    <>
      {list.rows.map((r) => (
        <ConnectorRowCard key={`${r.provider}:${r.environment}`} row={r} />
      ))}
    </>
  );
}

function ConnectorRowCard({ row }: { row: ConnectorRow }) {
  const view = connectorRowView(row);
  const connect = useAction(api.connectorConnections.startConnect);
  const disconnect = useAction(api.connectorConnections.disconnectProvider);
  const [busy, setBusy] = useState<"connecting" | "disconnecting" | null>(null);
  const busyLabel = connectorBusyLabel(busy);

  return (
    <div style={rowStyle} data-testid={`connections-${view.provider}`}>
      <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
        <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>{view.title}</strong>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{view.detail}</span>
        {view.residualNotice && (
          <span style={{ fontSize: "0.85rem", color: "var(--ink)" }}>{view.residualNotice}</span>
        )}
        {/* The caveat sits NEXT TO the button, not behind a confirm dialog: a warning a user only
            sees after deciding is a warning that arrived too late. */}
        {view.canDisconnect && view.disconnectNote && (
          <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
            {view.disconnectNote}
          </span>
        )}
        {busyLabel && (
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: "0.85rem", color: "var(--ink)" }}
          >
            {busyLabel}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: "0.4rem", justifyItems: "end" }}>
        {view.action && (
          <button
            type="button"
            disabled={busy !== null}
            style={connectButton}
            onClick={async () => {
              setBusy("connecting");
              try {
                const started = await connect({
                  provider: row.provider,
                  environment: row.environment,
                  redirectPath: "/dashboard/profile",
                });
                // A provider can refuse to start and say why (PayPal has no consent surface at
                // all). Navigating to a null URL would look like a dead button.
                if (started.url) window.location.href = started.url;
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "connecting"
              ? busyLabel
              : view.action === "connect"
                ? "Connect"
                : "Reconnect"}
          </button>
        )}
        {view.canDisconnect && (
          <button
            type="button"
            disabled={busy !== null}
            style={disconnectButton}
            onClick={async () => {
              setBusy("disconnecting");
              try {
                await disconnect({ provider: row.provider, environment: row.environment });
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "disconnecting" ? busyLabel : "Disconnect"}
          </button>
        )}
      </div>
    </div>
  );
}

function GoogleRow() {
  const status = useQuery(api.gmailAuth.gmailStatus);

  return (
    <div style={rowStyle}>
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
