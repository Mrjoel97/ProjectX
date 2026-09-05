// The Phase 28 connector rows, as PURE presentation — no JSX, no "use client", no Convex import.
//
// It lives beside `connections.ts` rather than inside it because that file is source-scanned by
// `packages/core/src/connectionsSurface.test.ts`, which counts `label:` and `blocker:` keys and
// requires one `ponytail:` comment per entry. A second data shape in there would silently break
// counts that are about something else entirely.
//
// WHY A DERIVATION AND NOT A COMPONENT. This repo tests web presentation as pure functions
// (`approvalsView.ts`, `financeView.ts`, `cashView.ts`), so the decision of what a row SAYS is
// testable without rendering anything. The .tsx keeps only the markup.

/** The server's view of one connectable provider (`connectorConnections.connections`). */
export type ConnectorRow = {
  provider: "hubspot" | "quickbooks" | "stripe" | "paypal";
  environment: "sandbox" | "production";
  connected: boolean;
  status: "connecting" | "connected" | "reauth_required" | "revoked" | "failed" | null;
  connectedAt: number | null;
  lastReadAt: number | null;
  lastFailureClass: string | null;
  revokeSupport: "confirmed" | "unproven" | "unsupported";
  grantRemainsLiveUpstream: boolean;
};

/**
 * `checking` is a state, not a default.
 *
 * Rendering "Not connected" while the query is in flight invites a user to reconnect an account
 * that is already connected — the false-negative class this surface has been bitten by twice
 * (see the Google and Microsoft rows). `undefined` from `useQuery` means "we do not know yet".
 */
export type ConnectorState =
  | "checking"
  | "connect"
  | "disconnected"
  | "revoke_partial"
  | "ready"
  | "reauth"
  | "failed";

export type ConnectorRowView = {
  provider: string;
  title: string;
  state: ConnectorState;
  detail: string;
  /** The primary control, or null when there is nothing honest to offer. */
  action: "connect" | "reconnect" | null;
  /** Whether a disconnect control belongs on this row. */
  canDisconnect: boolean;
  /**
   * What a disconnect will ACTUALLY do, shown BEFORE it is pressed.
   *
   * For three of the four lanes Pikar cannot revoke the grant upstream, so a bare "Disconnect"
   * promises something the code cannot deliver. This sentence is the difference between deleting a
   * credential and telling someone their account is disconnected when it is not.
   */
  disconnectNote: string | null;
  /** Shown after a disconnect that could not revoke — the sentence the tenant is owed. */
  residualNotice: string | null;
};

/**
 * The list query has a lifecycle of its own. `undefined` is checking; an empty server answer is
 * hidden because the server has already omitted every parked/failed/expired lane. Keeping this
 * tiny derivation pure makes the false-negative loading branch executable in the plan's focused
 * test instead of leaving it as a comment in JSX.
 */
export function connectorListView(rows: readonly ConnectorRow[] | undefined): {
  state: "checking" | "hidden" | "ready";
  rows: readonly ConnectorRow[];
} {
  if (rows === undefined) return { state: "checking", rows: [] };
  if (rows.length === 0) return { state: "hidden", rows };
  return { state: "ready", rows };
}

/** Closed operation copy shared by the live region and the button label. */
export function connectorBusyLabel(
  busy: "connecting" | "disconnecting" | null,
): "Connecting…" | "Disconnecting…" | null {
  return busy === null ? null : busy === "connecting" ? "Connecting…" : "Disconnecting…";
}

const TITLES: Record<ConnectorRow["provider"], string> = {
  hubspot: "HubSpot — contacts, companies & deals",
  quickbooks: "QuickBooks — invoices, customers & balances",
  stripe: "Stripe — charges, invoices & payouts",
  paypal: "PayPal — transactions & balances",
};

/** Read-only, and the row says so. Every Phase 28 lane is a READ; none of them writes. */
const READ_ONLY = "Read-only. Pikar never writes to this account.";

const DISCONNECT_NOTES: Record<ConnectorRow["revokeSupport"], string | null> = {
  // QuickBooks is the only lane with a documented revocation endpoint a platform may call.
  confirmed: null,
  unproven:
    "Disconnecting deletes Pikar's copy and asks the provider to revoke. Whether that also " +
    "invalidates tokens already issued is not documented, so access may persist briefly.",
  unsupported:
    "Disconnecting deletes Pikar's copy. This provider documents no way for Pikar to revoke the " +
    "grant, so it stays active until you remove it in your own account.",
};

/**
 * ONE row's presentation. `undefined` for the whole list is handled by the caller; this takes a
 * row that exists.
 */
export function connectorRowView(row: ConnectorRow): ConnectorRowView {
  const title = TITLES[row.provider];
  const sandbox = row.environment === "sandbox" ? " (sandbox)" : "";
  const base = { provider: row.provider, title: `${title}${sandbox}` };

  if (row.status === "connecting") {
    return {
      ...base,
      state: "checking",
      detail: "Checking this connection…",
      action: null,
      canDisconnect: false,
      disconnectNote: null,
      residualNotice: null,
    };
  }

  if (!row.connected) {
    const partialRevoke = row.grantRemainsLiveUpstream;
    const disconnected = row.status === "revoked";
    return {
      ...base,
      state: partialRevoke ? "revoke_partial" : disconnected ? "disconnected" : "connect",
      detail: disconnected ? `Disconnected here. ${READ_ONLY}` : READ_ONLY,
      action: "connect",
      canDisconnect: false,
      disconnectNote: null,
      // A row that was disconnected without an upstream revoke keeps saying so, because the
      // account is still granting access and only the user can end that.
      residualNotice: partialRevoke
        ? "Pikar's copy is deleted. The grant is still active in your provider account until you " +
          "remove it there."
        : null,
    };
  }

  if (row.status === "reauth_required") {
    return {
      ...base,
      state: "reauth",
      detail: "This connection needs to be re-authorised before Pikar can read again.",
      action: "reconnect",
      canDisconnect: true,
      disconnectNote: DISCONNECT_NOTES[row.revokeSupport],
      residualNotice: null,
    };
  }

  if (row.status === "failed") {
    return {
      ...base,
      state: "failed",
      // A CLOSED CLASS, never provider prose — vendor error text can carry account ids and
      // customer names (CLAUDE.md §4), and this string is rendered.
      detail: `Last read failed (${row.lastFailureClass ?? "unknown"}). Reconnecting usually fixes it.`,
      action: "reconnect",
      canDisconnect: true,
      disconnectNote: DISCONNECT_NOTES[row.revokeSupport],
      residualNotice: null,
    };
  }

  return {
    ...base,
    state: "ready",
    detail: row.lastReadAt
      ? `${READ_ONLY} Last read ${new Date(row.lastReadAt).toLocaleString()}.`
      : `${READ_ONLY} Not read yet.`,
    action: null,
    canDisconnect: true,
    disconnectNote: DISCONNECT_NOTES[row.revokeSupport],
    residualNotice: null,
  };
}
