"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";

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
export function DisconnectMicrosoft() {
  const status = useQuery(api.microsoftAuth.microsoftStatus);
  const disconnect = useAction(api.microsoftAuth.disconnectMicrosoft);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
        "This deletes Pikar's copy of your token, but it does NOT remove Pikar from your Microsoft " +
        "account — do that in Microsoft My Apps, or ask your admin in Entra for a work account.",
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
          deleted
            ? "Pikar's copy of your token is deleted. Microsoft still lists Pikar on your account — " +
                "remove it at Microsoft My Apps (or in Entra for a work or school account) to be certain."
            : "There was no stored Microsoft connection to delete. If Microsoft still lists Pikar on " +
                "your account, remove it at Microsoft My Apps.",
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
