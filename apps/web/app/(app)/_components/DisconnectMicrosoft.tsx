"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import { type ReactNode, useState } from "react";

// ponytail: an inline style object, not a class — this file already styles every element inline and
// the app has no CSS-module or component-library pattern to reuse (BRAND §5). `--ink` against the
// note's `--ink-soft` is what makes it read as a link; it is a token, never a hex.
const LINK = { color: "var(--ink)", textDecoration: "underline" };

// ONE writer for the Microsoft disconnect copy, mirroring DisconnectGoogle. It owns its OWN
// `microsoftStatus` subscription for the same reason: `disconnectMicrosoft` deletes the token row
// before it returns, so `connected` flips to false the instant the action resolves. If the CALLER
// gated this component's mount on that flag, the notice below would be destroyed the instant it was
// set — the component unmounting out from under its own `setNote`.
//
// ⚠ THE ONE PLACE THIS DELIBERATELY DIVERGES FROM DisconnectGoogle, AND IT IS NOT AN OVERSIGHT.
// `disconnectGoogle` revokes AT Google first and reports `revoked`. The Microsoft identity platform
// v2 delegated flow used here has NO equivalent revocation endpoint, so `disconnectMicrosoft`
// returns a hard `revokedAtProvider: false` and this component ALWAYS tells the user that removing
// consent is a separate step on their side. Inventing a revoke call against a non-existent endpoint
// would be worse than the honest gap: it would report success for nothing. GOVN-03 inherits this.
// TWO portals, not one, and the distinction is load-bearing. 25-06 Task 2's re-verification
// (2026-08-17) found the original copy sent EVERY user to "Microsoft My Apps" — which is the
// work/school portal only. A personal-account holder following that lands somewhere that will never
// list Pikar, so the honest instruction reads as a broken one. The private beta is expected to be
// mostly personal accounts, so that was the majority path.
const REMOVAL_LINKS = (
  <>
    <a href="https://account.microsoft.com/privacy/app-access" target="_blank" rel="noreferrer" style={LINK}>
      Microsoft account → App access
    </a>{" "}
    for a personal account, or{" "}
    <a href="https://myapps.microsoft.com/" target="_blank" rel="noreferrer" style={LINK}>
      My Apps
    </a>{" "}
    for a work or school account.
  </>
);

export function DisconnectMicrosoft() {
  const status = useQuery(api.microsoftAuth.microsoftStatus);
  const disconnect = useAction(api.microsoftAuth.disconnectMicrosoft);
  const [busy, setBusy] = useState(false);
  // `ReactNode`, not `string`: the removal instruction has to LINK the two portals, and 25-06 Task 2
  // measured why naming them in prose is not enough — see REMOVAL_LINKS below.
  const [note, setNote] = useState<ReactNode | null>(null);

  const onDisconnect = async () => {
    // ponytail: window.confirm — this app has no dialog pattern (BRAND §5 defines none), matching
    // DisconnectGoogle. Build a real dialog when a component library exists.
    //
    // The copy names every capability in MICROSOFT_SCOPES, including the mail half that is granted
    // but not yet used — `connectionsSurface.test.ts` fails until it does. It also states the
    // provider-side truth up front rather than only after the click, because "disconnect" reads as
    // "revoked everywhere" and here it is not.
    const ok = window.confirm(
      "Disconnect Microsoft? Pikar will lose access to your calendar AND to Outlook mail. " +
        "This deletes Pikar's copy of your token. It does NOT remove Pikar from your Microsoft " +
        "account — that is a separate step you take at account.microsoft.com (personal account) " +
        "or myapps.microsoft.com (work or school account).",
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const { deleted, revokedAtProvider } = await disconnect();
      // ALWAYS shown on success, never conditional on a failure. There is no success path where
      // the provider-side grant is gone, so there is no path where staying quiet would be honest.
      if (!revokedAtProvider) {
        setNote(
          deleted ? (
            <>
              Pikar's copy of your token is deleted. Microsoft still lists Pikar on your account — we
              have no way to remove it for you. Remove it yourself at {REMOVAL_LINKS}
            </>
          ) : (
            <>
              There was no stored Microsoft connection to delete. If Microsoft still lists Pikar on
              your account, remove it at {REMOVAL_LINKS}
            </>
          ),
        );
      }
    } catch {
      // A throw aborts the action BEFORE deleteTokens, so the connection really is intact.
      setNote(
        "Disconnect failed — your connection is unchanged. Check your network and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  // The button only makes sense while there is something to disconnect. The note does NOT depend on
  // `status.connected` — that is the whole point of the subscription comment above.
  const showButton = status?.connected === true;
  if (!showButton && note === null) return null;

  return (
    <div style={{ display: "grid", gap: "0.4rem", justifyItems: "start" }}>
      {showButton && (
        <button
          type="button"
          onClick={() => void onDisconnect()}
          disabled={busy}
          data-testid="microsoft-disconnect"
          style={{
            padding: "0.45rem 0.9rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--rule)",
            background: "transparent",
            color: "var(--ink-soft)",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            width: "fit-content",
          }}
        >
          {busy ? "Disconnecting…" : "Disconnect Microsoft"}
        </button>
      )}
      {note && (
        <p
          role="status"
          style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)", maxWidth: "34rem" }}
        >
          {note}
        </p>
      )}
    </div>
  );
}
