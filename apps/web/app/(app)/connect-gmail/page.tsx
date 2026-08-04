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

  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: "40rem" }}>
      <h1>Connect Google</h1>

      {/* Red stays hardcoded: BRAND defines no error token (globals.css reserves amber for the
          approval gate alone), and globals.css hardcodes #dc2626 for the DLQ badge on the same
          reasoning. Minting a --danger token is scope this change did not ask for. */}
      {gmailError && (
        <div
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            borderRadius: "0.5rem",
            padding: "1rem",
            color: "#991b1b",
          }}
        >
          {gmailError}
        </div>
      )}

      {status === undefined ? (
        <p>Loading…</p>
      ) : status.connected ? (
        <div
          style={{
            border: "1px solid var(--released)",
            background: "var(--card)",
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--released)" }}>Google connected</div>
          {status.expiresAt && (
            <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
              Access token expires {new Date(status.expiresAt).toLocaleString()}
            </div>
          )}
          <p style={{ fontSize: "0.9rem", color: "var(--ink-soft)" }}>
            Reconnect any time to refresh the connection.
          </p>
        </div>
      ) : (
        // ⚠ THIS PARAGRAPH IS THE CONSENT. It must name EVERY capability in `GOOGLE_SCOPES`: a
        // user granting read access to their whole Drive deserves to have been told so on the page
        // where they grant it. 15.3-09 widened the grant and left this untouched.
        // `connectionsSurface.test.ts` now fails until every surface names every capability.
        <p style={{ color: "var(--ink-soft)" }}>
          Pikar needs your consent to read, draft, and send email, check calendar availability,
          create approved calendar events, and read files from your Google Drive so you can import
          folders into your vault. It can never permanently delete your mail, and it can never
          change or delete anything in your Drive.
        </p>
      )}

      {/* Rendered UNCONDITIONALLY — not nested inside the `status.connected` branch above. It
          carries its own `gmailStatus` subscription and would otherwise unmount (destroying its
          own partial-revoke warning) the instant disconnect flips `connected` to false. */}
      <div style={{ marginTop: "0.75rem" }}>
        <DisconnectGoogle />
      </div>

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
