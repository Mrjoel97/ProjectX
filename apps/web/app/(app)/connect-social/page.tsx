"use client";
import { api } from "@pikar/backend/api";
import {
  isSocialProvider,
  SOCIAL_AUTH_ORIGINS,
  SOCIAL_LABELS,
  type SocialProvider,
} from "@pikar/core/social";
import { useAction, useMutation, useQuery } from "convex/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import SocialWorkspace from "./SocialWorkspace";

const button: CSSProperties = {
  minHeight: 44,
  padding: "10px 18px",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--ink)",
  cursor: "pointer",
};
export default function ConnectSocialPage() {
  const rows = useQuery(api.social.status, {});
  const start = useAction(api.socialActions.startConnect);
  const complete = useMutation(api.social.completeConnect);
  const disconnect = useAction(api.socialActions.disconnect);
  const verify = useAction(api.socialActions.verifyConnection);
  const subscribeYouTube = useAction(api.socialActions.subscribeYouTube);
  const handled = useRef(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState<SocialProvider | null>(null);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider"),
      receipt = params.get("complete");
    if (!params.size) return;
    window.history.replaceState(window.history.state, "", "/connect-social");
    if (provider && isSocialProvider(provider) && receipt) {
      setBusy(true);
      void complete({ provider, receipt })
        .then(
          (result) =>
            setNotice(
              result.connected === false
                ? "This connection is currently unavailable. No new account connection was saved."
                : SOCIAL_LABELS[provider] + " connected. You can verify account access below.",
            ),
          () =>
            setNotice(
              "This connection could not be completed for your signed-in Pikar account. Start a new connection.",
            ),
        )
        .finally(() => setBusy(false));
    } else
      setNotice(
        params.get("result") === "cancelled"
          ? "Connection cancelled."
          : "Connection failed. Check the app permissions and try again.",
      );
  }, [complete]);
  return (
    <section style={{ maxWidth: 800, display: "grid", gap: 20, padding: 24 }}>
      <h1>Connect your social accounts</h1>
      <p>Authorize Pikar AI directly with each platform. Your credentials stay on the server.</p>
      <p>
        Choose which accounts Pikar may read and prepare posts for. Publishing, messages and
        analytics require their own supported platform permissions and review.
      </p>
      <p>
        Meta currently uses Facebook Login for your Facebook identity and Page/Instagram
        permissions. YouTube connects the channel selected during Google consent.
      </p>
      {rows === undefined ? (
        <p role="status">Checking connections…</p>
      ) : (
        rows.map((row) => (
          <article
            key={row.provider}
            style={{
              border: "1px solid var(--rule)",
              borderRadius: 16,
              padding: 20,
              display: "grid",
              gap: 12,
            }}
          >
            <h2>{SOCIAL_LABELS[row.provider]}</h2>
            <p>
              {row.connected
                ? "Connected: " + row.accountName
                : row.status === "reconnect_required"
                  ? "Reconnect required"
                  : row.status === "connected"
                    ? "Connection saved: " + row.accountName + ". Verify account access to renew."
                    : "Not connected"}
            </p>
            {!row.configured ? (
              <p>Connection setup is not complete on this deployment.</p>
            ) : (
              <button
                type="button"
                disabled={busy}
                style={button}
                onClick={async () => {
                  setBusy(true);
                  setNotice("");
                  try {
                    const result = await start({ provider: row.provider });
                    const target = new URL(result.url);
                    if (!SOCIAL_AUTH_ORIGINS.includes(target.origin)) throw new Error();
                    window.location.assign(target.toString());
                  } catch {
                    setNotice(
                      "The connection could not start. Check the app configuration and try again.",
                    );
                    setBusy(false);
                  }
                }}
              >
                {row.status !== "disconnected" ? "Reconnect " : "Connect "}
                {SOCIAL_LABELS[row.provider]}
              </button>
            )}
            {row.provider !== "x" && row.connected && row.configured && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {(row.provider === "meta"
                  ? (["read", "publish_facebook", "publish_instagram"] as const)
                  : (["read", "publish"] as const)
                ).map((intent) => (
                  <button
                    type="button"
                    key={intent}
                    disabled={busy}
                    style={button}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await start({ provider: row.provider, intent });
                        const target = new URL(result.url);
                        if (!SOCIAL_AUTH_ORIGINS.includes(target.origin)) throw Error();
                        window.location.assign(target.toString());
                      } catch {
                        setNotice(
                          "Additional permissions are not configured or approved for this platform yet.",
                        );
                        setBusy(false);
                      }
                    }}
                  >
                    {intent === "read"
                      ? "Enable content reading"
                      : intent === "publish_facebook"
                        ? "Enable Facebook publishing permissions"
                        : intent === "publish_instagram"
                          ? "Enable Instagram publishing permissions"
                          : "Enable publishing permissions"}
                  </button>
                ))}
              </div>
            )}
            {row.provider !== "x" &&
              row.connectionId &&
              (row.status === "connected" || row.status === "reconnect_required") && (
                <SocialWorkspace key={row.connectionId} row={row} accessReady={row.connected} />
              )}
            {row.provider === "youtube" && row.connected && (
              <button
                type="button"
                disabled={busy}
                style={button}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await subscribeYouTube({});
                    setNotice(
                      "YouTube notification subscription requested for 24 hours. Actual event delivery still needs verification.",
                    );
                  } catch {
                    setNotice(
                      "YouTube notifications could not be enabled. Check the webhook configuration.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Enable YouTube channel notifications
              </button>
            )}
            {row.status !== "disconnected" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  style={button}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await verify({ provider: row.provider });
                      setNotice("Account access verified: " + result.accountName);
                    } catch {
                      setNotice(
                        "Access could not be verified. Reconnect if your permission has expired.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Verify account access
                </button>
                <button
                  type="button"
                  disabled={busy}
                  style={button}
                  onClick={() => setConfirmDisconnect(row.provider)}
                >
                  Disconnect
                </button>
                {confirmDisconnect === row.provider && (
                  <div>
                    <p>
                      {row.provider === "youtube"
                        ? "This removes Pikar's saved YouTube connection and asks Google to revoke all access this Google project has for your account, including other integrations using the project. Those Google connections may also need to be reconnected. Saved YouTube account details and platform receipts will be cleared."
                        : "This removes Pikar's saved connection. Remove Pikar AI in the platform's connected-app settings to revoke upstream access too."}
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      style={button}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const result = await disconnect({
                            provider: row.provider,
                            ...(row.provider === "youtube"
                              ? { acknowledgedGoogleProjectRevocation: true }
                              : {}),
                          });
                          setNotice(
                            row.provider === "youtube"
                              ? result.upstreamRevoked
                                ? "YouTube disconnected from Pikar. Google confirmed revocation of the connected grant."
                                : "YouTube disconnected from Pikar. Google revocation could not be confirmed. Remove Pikar AI in your Google Account connections to end upstream access."
                              : "Disconnected from Pikar. Revoke Pikar AI in the platform settings to end upstream access.",
                          );
                          setConfirmDisconnect(null);
                        } catch {
                          setNotice(
                            "Disconnect could not be confirmed. Check the connection status before trying again.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {row.provider === "youtube"
                        ? "Confirm disconnect and revoke Google access"
                        : "Confirm disconnect"}
                    </button>
                    <button
                      type="button"
                      style={button}
                      disabled={busy}
                      onClick={() => setConfirmDisconnect(null)}
                    >
                      Keep connected
                    </button>
                  </div>
                )}
              </>
            )}
          </article>
        ))
      )}
      <p role="status" aria-live="polite">
        {notice}
      </p>
      <a href="/dashboard/profile?tab=connections">Back to Connections</a>
    </section>
  );
}
