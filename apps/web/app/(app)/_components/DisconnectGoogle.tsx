"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";

// ONE writer for the disconnect confirm copy and for how a partial revoke is reported. This was
// inline in `connect-gmail/page.tsx` until the Connections tab needed the same control; two copies
// of a user-facing warning drift the moment the Google scope changes.
//
// This component owns ITS OWN `gmailStatus` subscription rather than trusting a `connected` prop
// from the caller. `disconnectGoogle` runs `deleteTokens` UNCONDITIONALLY before it returns, so the
// instant the action resolves, `gmailStatus` flips to `connected: false` everywhere it is
// subscribed. If the CALLER decided whether to mount this component from that same flag, a
// `revoked: false` warning would be destroyed the instant it was set — the component unmounting out
// from under its own `setNote`. Owning the subscription lets the note outlive the connected state:
// both call sites now render `<DisconnectGoogle />` unconditionally.
export function DisconnectGoogle() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const disconnect = useAction(api.gmailAuth.disconnectGoogle);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onDisconnect = async () => {
    // ponytail: window.confirm — this app has no dialog pattern (BRAND §5 defines none). Native is
    // keyboard-accessible and costs no component. Build a real dialog when a SECOND destructive
    // control needs one.
    // The copy names every capability deliberately: it is ONE Google grant covering mail, calendar
    // AND Drive, so a user who reads "disconnect Gmail" would not expect their events to stop
    // working or their Drive imports to stop refreshing. Widen the grant, widen this sentence —
    // `connectionsSurface.test.ts` fails until you do.
    const ok = window.confirm(
      "Disconnect Google? Pikar will lose access to your mail, your calendar AND your Drive. " +
        "Any scheduled send will be held until you reconnect, and Drive folders already imported " +
        "stay in your vault but stop refreshing.",
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const { revoked } = await disconnect();
      // `deleteTokens` runs UNCONDITIONALLY in the action (gmailAuth.ts), so `revoked: false` means
      // our copy is deleted but Google may still hold the grant. Reporting a flat "Disconnected"
      // here would be a second false promise of exactly the kind this control exists to retire.
      if (!revoked) {
        setNote(
          "Pikar's copy of your token is deleted, but Google did not confirm the revocation. " +
            "Remove Pikar at myaccount.google.com/permissions to be certain.",
        );
      }
    } catch {
      // A thrown fetch aborts the action BEFORE deleteTokens, so the connection really is intact.
      setNote(
        "Disconnect failed — your connection is unchanged. Check your network and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  // The button only makes sense while there is something to disconnect. The note does NOT depend
  // on `status.connected` — that is the whole point (see the block comment above): a `revoked:
  // false` warning must survive the status flipping to disconnected.
  const showButton = status?.connected === true;
  if (!showButton && note === null) return null;

  return (
    <div style={{ display: "grid", gap: "0.4rem", justifyItems: "start" }}>
      {showButton && (
        <button
          type="button"
          onClick={() => void onDisconnect()}
          disabled={busy}
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
          {busy ? "Disconnecting…" : "Disconnect Google"}
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
