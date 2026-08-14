"use client";

import { api } from "@pikar/backend/api";
import { microsoftCallbackMessage } from "@pikar/core";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { DisconnectMicrosoft } from "../_components/DisconnectMicrosoft";

// ACTN-02 / DLVR-02 Microsoft consent (17-06, ADR-018). ONE explicit consent grants calendar AND
// mail. The authorize URL is minted server-side with a tenant-bound signed `state`; the browser
// only follows the link. Mirrors connect-gmail/page.tsx deliberately — same shape, same states.
export default function ConnectMicrosoftPage() {
  const status = useQuery(api.microsoftAuth.microsoftStatus);
  const connect = useQuery(api.microsoftAuth.microsoftConnectUrl);

  // The OAuth callback (backend http.ts) redirects failures back here as ?microsoftError=<code>
  // so the user never dead-ends on the Convex-site domain. Read once on mount (client-only —
  // avoids the useSearchParams Suspense requirement for a value that only arrives via redirect).
  const [errorCode, setErrorCode] = useState<string | null>(null);
  useEffect(() => {
    setErrorCode(new URLSearchParams(window.location.search).get("microsoftError"));
  }, []);

  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: "40rem" }}>
      <h1>Connect Microsoft</h1>

      {/* Red stays hardcoded, matching connect-gmail: BRAND defines no error token (globals.css
          reserves amber for the approval gate alone). Minting a --danger token is scope this
          change did not ask for.

          ⚠ THE CODE IS NEVER RENDERED — only `microsoftCallbackMessage(code)`. The query value is
          attacker-controllable (anyone can hand-craft ?microsoftError=), and its default branch
          returns a FIXED sentence rather than echoing the input. Rendering `{errorCode}` here
          would reflect arbitrary text onto the page. */}
      {errorCode && (
        <div
          role="alert"
          data-testid="microsoft-error"
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            borderRadius: "0.5rem",
            padding: "1rem",
            color: "#991b1b",
          }}
        >
          {microsoftCallbackMessage(errorCode)}
        </div>
      )}

      {status === undefined ? (
        <p>Loading…</p>
      ) : status.connected ? (
        <div
          data-testid="microsoft-connected"
          style={{
            border: "1px solid var(--released)",
            background: "var(--card)",
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--released)" }}>Microsoft connected</div>
          {status.expiresAt && (
            <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
              Access token expires {new Date(status.expiresAt).toLocaleString()}
            </div>
          )}
          {/* A CONNECTED GRANT IS NOT NECESSARILY A COMPLETE ONE. Microsoft can grant less than was
              requested, and a grant stored before a widening keeps its old scope string. Naming the
              missing half here is the difference between "reconnect to add it" and a 403 later. */}
          {!status.calendarReady && (
            <div style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
              Calendar access is not included in this connection. Reconnect to add it.
            </div>
          )}
          {!status.mailReady && (
            <div style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
              Outlook mail access is not included in this connection. Reconnect to add it.
            </div>
          )}
          <p style={{ fontSize: "0.9rem", color: "var(--ink-soft)" }}>
            Reconnect any time to refresh the connection.
          </p>
        </div>
      ) : (
        // ⚠ THIS PARAGRAPH IS THE CONSENT. It must name EVERY capability in `MICROSOFT_SCOPES`,
        // and `connectionsSurface.test.ts` fails until it does.
        //
        // ADR-018 consequence 6 is the reason this sentence names MAIL even though no mail code
        // ships yet: the union grant is requested now so the user consents once, which means a
        // scope is granted that nothing currently exercises. A consent screen that under-describes
        // a granted scope is the defect that consequence exists to prevent — describing only the
        // calendar feature shipping this week would be exactly that defect.
        <p style={{ color: "var(--ink-soft)" }}>
          Pikar needs your consent to check your calendar availability, create and update approved
          calendar events, and — for Outlook mail delivery — to read your mail and send mail as you.
          Mail features are not switched on yet; the permission is requested now so you only have to
          approve this connection once. Pikar can never permanently delete your mail or your events.
        </p>
      )}

      {/* Rendered UNCONDITIONALLY — not nested inside the `status.connected` branch above, matching
          DisconnectGoogle's shape. It carries its own `microsoftStatus` subscription and would
          otherwise unmount the instant disconnect flips `connected` to false, destroying its own
          provider-revocation notice before a human could read it. */}
      <div style={{ marginTop: "0.75rem" }}>
        <DisconnectMicrosoft />
      </div>

      {connect?.url ? (
        <a
          href={connect.url}
          data-testid="microsoft-connect-link"
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
          {status?.connected ? "Reconnect Microsoft" : "Connect Microsoft"}
        </a>
      ) : connect?.configured === false ? (
        <div
          role="alert"
          data-testid="microsoft-unconfigured"
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            borderRadius: "0.5rem",
            padding: "1rem",
            color: "#991b1b",
          }}
        >
          Microsoft connection is temporarily unavailable because OAuth has not been configured for
          this deployment. Ask an administrator to configure it, then reload this page.
        </div>
      ) : (
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>Preparing consent link…</p>
      )}
    </section>
  );
}
