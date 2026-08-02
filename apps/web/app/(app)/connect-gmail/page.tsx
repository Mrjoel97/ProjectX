"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { DisconnectGoogle } from "../_components/DisconnectGoogle";

// DLVR-03 / Google consent (02-05, widened in 17-02). One explicit consent grants mail and
// calendar access. The authorize URL is minted server-side with a tenant-bound signed `state`;
// the browser only follows the link. Reconnect resets the 7-day Testing-mode refresh window,
// resumes any awaiting_reauth delivery, and grants Calendar to pre-17 connections.
export default function ConnectGmailPage() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const connectUrl = useQuery(api.gmailAuth.gmailConnectUrl);

  // The OAuth callback (backend http.ts) redirects failures back here as ?gmailError=<reason>
  // so the user never dead-ends on the Convex-site domain. Read once on mount (client-only —
  // avoids the useSearchParams Suspense requirement for a value that only arrives via redirect).
  const [gmailError, setGmailError] = useState<string | null>(null);
  useEffect(() => {
    setGmailError(new URLSearchParams(window.location.search).get("gmailError"));
  }, []);

  // Disconnect revokes the grant at Google and drops the stored token. `gmailStatus` is a live
  // subscription on that row, so the panel flips on its own — no refetch, no optimistic state.

  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: "40rem" }}>
      <h1>Connect Google</h1>

      {/* Red stays hardcoded: BRAND defines no error token (globals.css reserves amber for the
          approval gate alone), and globals.css hardcodes #dc2626 for the DLQ badge on the same
          reasoning. Minting a --danger token is scope this change did not ask for. */}
      {gmailError && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: "0.5rem", padding: "1rem", color: "#991b1b" }}>
          {gmailError}
        </div>
      )}

      {status === undefined ? (
        <p>Loading…</p>
      ) : status.connected ? (
        <div style={{ border: "1px solid var(--released)", background: "var(--card)", borderRadius: "0.5rem", padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--released)" }}>Google connected</div>
          {status.expiresAt && (
            <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
              Access token expires {new Date(status.expiresAt).toLocaleString()}
            </div>
          )}
          <p style={{ fontSize: "0.9rem", color: "var(--ink-soft)" }}>
            Reconnect any time to refresh the connection.
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <DisconnectGoogle />
          </div>
        </div>
      ) : (
        <p style={{ color: "var(--ink-soft)" }}>
          Pikar needs your consent to read, draft, and send email, check calendar availability,
          and create approved calendar events. It can never permanently delete your mail.
        </p>
      )}

      {connectUrl ? (
        <a
          href={connectUrl}
          style={{
            display: "inline-block",
            padding: "0.6rem 1.2rem",
            borderRadius: "0.375rem",
            background: "var(--teal-600)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
            width: "fit-content",
          }}
        >
          {status?.connected ? "Reconnect Google" : "Connect Google"}
        </a>
      ) : (
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>Preparing consent link…</p>
      )}
    </section>
  );
}
