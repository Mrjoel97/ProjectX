"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

// DLVR-03 / Gmail consent (02-05). One explicit consent grants gmail.modify (read, draft,
// send, organise — never permanent delete). The authorize URL is minted server-side with a
// tenant-bound signed `state`; the browser only follows the link. Reconnect resets the
// 7-day Testing-mode refresh window and resumes any awaiting_reauth delivery (backend).
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
      <h1>Connect Gmail</h1>

      {gmailError && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: "0.5rem", padding: "1rem", color: "#991b1b" }}>
          {gmailError}
        </div>
      )}

      {status === undefined ? (
        <p>Loading…</p>
      ) : status.connected ? (
        <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: "0.5rem", padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "#166534" }}>Gmail connected</div>
          {status.expiresAt && (
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              Access token expires {new Date(status.expiresAt).toLocaleString()}
            </div>
          )}
          <p style={{ fontSize: "0.9rem", color: "#444" }}>
            Reconnect any time to refresh the connection.
          </p>
        </div>
      ) : (
        <p style={{ color: "#444" }}>
          Pikar needs your consent to read, draft, and send email on your behalf. It can never
          permanently delete your mail.
        </p>
      )}

      {connectUrl ? (
        <a
          href={connectUrl}
          style={{
            display: "inline-block",
            padding: "0.6rem 1.2rem",
            borderRadius: "0.375rem",
            background: "#2563eb",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
            width: "fit-content",
          }}
        >
          {status?.connected ? "Reconnect Gmail" : "Connect Gmail"}
        </a>
      ) : (
        <p style={{ color: "#999", fontSize: "0.85rem" }}>Preparing consent link…</p>
      )}
    </section>
  );
}
