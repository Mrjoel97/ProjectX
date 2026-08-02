"use client";

import { api } from "@pikar/backend/api";
import { useAction } from "convex/react";
import { useState } from "react";

// ONE writer for the disconnect confirm copy and for how a partial revoke is reported. This was
// inline in `connect-gmail/page.tsx` until the Connections tab needed the same control; two copies
// of a user-facing warning drift the moment the Google scope changes.
export function DisconnectGoogle() {
  const disconnect = useAction(api.gmailAuth.disconnectGoogle);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onDisconnect = async () => {
    // ponytail: window.confirm — this app has no dialog pattern (BRAND §5 defines none). Native is
    // keyboard-accessible and costs no component. Build a real dialog when a SECOND destructive
    // control needs one.
    // The copy names calendar deliberately: it is ONE Google grant covering mail and calendar, so
    // a user who reads "disconnect Gmail" would not expect their events to stop working.
    const ok = window.confirm(
      "Disconnect Google? Pikar will lose access to your mail AND your calendar. " +
        "Any scheduled send will be held until you reconnect.",
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
      setNote("Disconnect failed — your connection is unchanged. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "0.4rem", justifyItems: "start" }}>
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
      {note && (
        <p role="status" style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)", maxWidth: "34rem" }}>
          {note}
        </p>
      )}
    </div>
  );
}
