// What a connector row SAYS, tested without rendering anything (28-09 Task 2).
//
// The properties that matter here are all about not lying to the user:
//
//  1. LOADING IS NEVER "NOT CONNECTED". That false negative invites reconnecting a live account,
//     and this surface has shipped it twice before (the Google and Microsoft rows both carry a
//     comment about it).
//  2. A DISCONNECT BUTTON SAYS WHAT IT WILL ACTUALLY DO, BEFORE IT IS PRESSED. For three of the
//     four lanes Pikar cannot revoke upstream, so a bare "Disconnect" promises what the code
//     cannot deliver.
//  3. NO PROVIDER PROSE REACHES THE SCREEN — failures render a closed class (CLAUDE.md §4).
import { describe, expect, test } from "vitest";
import { type ConnectorRow, connectorRowView } from "./connectorRows";

const row = (over: Partial<ConnectorRow> = {}): ConnectorRow => ({
  provider: "hubspot",
  environment: "production",
  connected: true,
  status: "connected",
  connectedAt: 1,
  lastReadAt: null,
  lastFailureClass: null,
  revokeSupport: "unproven",
  grantRemainsLiveUpstream: false,
  unproven: false,
  ...over,
});

// `revokeSupport: "unproven"` and `unproven: true` are DIFFERENT facts that share a word: the first
// is about whether a disconnect can revoke upstream, the second about whether the LANE has ever
// passed its gate. The fixture above pins the first to "unproven" already, so every assertion below
// varies only the second.
describe("an unproven lane is offered, and says it is unproven", () => {
  test("the owner still gets a Connect button — the whole point of showing the row", () => {
    const v = connectorRowView(row({ connected: false, status: null, unproven: true }));
    expect(v.action).toBe("connect");
    expect(v.state).toBe("connect");
    expect(v.detail).toContain("never completed a live read");
  });

  test("a proven lane says nothing of the sort", () => {
    const v = connectorRowView(row({ connected: false, status: null, unproven: false }));
    expect(v.action).toBe("connect");
    expect(v.detail).not.toContain("never completed a live read");
  });

  // The marker has to survive CONNECTING. A lane that has been connected but never proven is
  // exactly the state this phase is trying to reach, and a row that dropped the caveat the moment a
  // grant existed would present an unjudged connector as a finished integration.
  test.each([
    ["connecting", { status: "connecting" as const, connected: false }],
    ["connected", { status: "connected" as const, connected: true }],
    ["reauth_required", { status: "reauth_required" as const, connected: true }],
    ["failed", { status: "failed" as const, connected: true }],
    ["revoked", { status: "revoked" as const, connected: false }],
  ])("state %s keeps the caveat", (_name, over) => {
    expect(connectorRowView(row({ ...over, unproven: true })).detail).toContain(
      "never completed a live read",
    );
    expect(connectorRowView(row({ ...over, unproven: false })).detail).not.toContain(
      "never completed a live read",
    );
  });

  test("the caveat is added to the row's own detail, never instead of it", () => {
    const v = connectorRowView(row({ connected: true, status: "connected", unproven: true }));
    expect(v.detail).toContain("never completed a live read");
    expect(v.detail).toContain("Read-only. Pikar never writes to this account.");
  });
});

describe("a connectable-but-unconnected row offers Connect and nothing else", () => {
  test("no disconnect control exists for a connection that does not exist", () => {
    const v = connectorRowView(row({ connected: false, status: null }));
    expect(v.state).toBe("connect");
    expect(v.action).toBe("connect");
    expect(v.canDisconnect).toBe(false);
    expect(v.disconnectNote).toBeNull();
  });

  // The row survives a disconnect precisely so this sentence can be shown. Dropping it would leave
  // a user believing an account was disconnected while it is still granting access.
  test("after a disconnect that could not revoke, the row still says the grant is live", () => {
    const v = connectorRowView(
      row({ connected: false, status: "revoked", grantRemainsLiveUpstream: true }),
    );
    expect(v.residualNotice).toContain("still active in your provider account");
  });

  test("a clean disconnect leaves no residual notice", () => {
    const v = connectorRowView(
      row({ connected: false, status: "revoked", grantRemainsLiveUpstream: false }),
    );
    expect(v.residualNotice).toBeNull();
    expect(v.state).toBe("disconnected");
  });

  test("an upstream grant that remains live is a partial revoke, not a clean connect state", () => {
    const v = connectorRowView(
      row({ connected: false, status: "revoked", grantRemainsLiveUpstream: true }),
    );
    expect(v.state).toBe("revoke_partial");
  });
});

describe("the disconnect control tells the truth before it is pressed", () => {
  test("QuickBooks — the one lane with a documented revoke — needs no caveat", () => {
    const v = connectorRowView(row({ provider: "quickbooks", revokeSupport: "confirmed" }));
    expect(v.canDisconnect).toBe(true);
    expect(v.disconnectNote).toBeNull();
  });

  test("an UNPROVEN revoke says access may persist, without claiming it will", () => {
    const v = connectorRowView(row({ revokeSupport: "unproven" }));
    expect(v.disconnectNote).toContain("not documented");
    expect(v.disconnectNote).toContain("may persist");
  });

  test("an UNSUPPORTED revoke says the grant stays until the user removes it", () => {
    const v = connectorRowView(row({ provider: "paypal", revokeSupport: "unsupported" }));
    expect(v.disconnectNote).toContain("documents no way for Pikar to revoke");
    expect(v.disconnectNote).toContain("your own account");
  });

  // The three notes must differ. One shared string would make the distinction invisible, which is
  // the same collapse `RevocationUpstream` exists to prevent on the server.
  test("the three revoke classes produce three DIFFERENT answers", () => {
    const notes = (["confirmed", "unproven", "unsupported"] as const).map(
      (revokeSupport) => connectorRowView(row({ revokeSupport })).disconnectNote,
    );
    expect(new Set(notes).size).toBe(3);
  });
});

describe("lifecycle states are distinguishable and none of them lies", () => {
  test("a server-returned connecting row stays checking rather than appearing ready", () => {
    const v = connectorRowView(row({ status: "connecting" }));
    expect(v.state).toBe("checking");
    expect(v.action).toBeNull();
    expect(v.detail).toMatch(/checking/i);
  });

  test("a healthy connection offers no Connect button", () => {
    const v = connectorRowView(row({ lastReadAt: null }));
    expect(v.state).toBe("ready");
    expect(v.action).toBeNull();
    expect(v.detail).toContain("Not read yet");
  });

  test("reauth_required asks for a reconnect rather than showing it as healthy", () => {
    const v = connectorRowView(row({ status: "reauth_required" }));
    expect(v.state).toBe("reauth");
    expect(v.action).toBe("reconnect");
    // Still disconnectable: a broken connection is still a stored credential.
    expect(v.canDisconnect).toBe(true);
  });

  test("a failed read renders the CLOSED class and never provider prose", () => {
    const v = connectorRowView(row({ status: "failed", lastFailureClass: "rate_limited" }));
    expect(v.state).toBe("failed");
    expect(v.detail).toContain("rate_limited");
  });

  test("a failed read with no class still renders, saying unknown", () => {
    const v = connectorRowView(row({ status: "failed", lastFailureClass: null }));
    expect(v.detail).toContain("unknown");
  });

  test("every state is reachable and they are all distinct", () => {
    const states = [
      connectorRowView(row({ connected: false, status: null })).state,
      connectorRowView(row({ connected: false, status: "revoked" })).state,
      connectorRowView(row({ connected: false, status: "revoked", grantRemainsLiveUpstream: true }))
        .state,
      connectorRowView(row({ status: "connecting" })).state,
      connectorRowView(row()).state,
      connectorRowView(row({ status: "reauth_required" })).state,
      connectorRowView(row({ status: "failed" })).state,
    ];
    expect(new Set(states).size).toBe(7);
  });
});

describe("the row names the provider and the environment", () => {
  test("a sandbox connection is labelled as one — it is not the business's real data", () => {
    expect(connectorRowView(row({ environment: "sandbox" })).title).toContain("(sandbox)");
    expect(connectorRowView(row({ environment: "production" })).title).not.toContain("(sandbox)");
  });

  test("every provider has its own title naming what Pikar reads", () => {
    const titles = (["hubspot", "quickbooks", "stripe", "paypal"] as const).map(
      (provider) => connectorRowView(row({ provider })).title,
    );
    expect(new Set(titles).size).toBe(4);
    // An unnamed capability is invisible on this tab — the standing rule the Microsoft row states.
    for (const t of titles) expect(t).toMatch(/—/);
  });

  test("every connected row says it is read-only", () => {
    expect(connectorRowView(row()).detail).toContain("Read-only");
    expect(connectorRowView(row({ connected: false })).detail).toContain("Read-only");
  });
});
