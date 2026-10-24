"use client";
import { api } from "@pikar/backend/api";
import { SOCIAL_LABELS } from "@pikar/core/social";
import { useQuery } from "convex/react";
export function SocialConnections() {
  const rows = useQuery(api.social.status, {});
  return (
    <section
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 20,
        padding: 24,
        background: "var(--card)",
      }}
    >
      <h2>Direct social accounts</h2>
      <p>Connect X, Meta, TikTok and YouTube directly to Pikar AI.</p>
      {rows === undefined ? (
        <p role="status">Checking connections…</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.provider}>
              {SOCIAL_LABELS[row.provider]}:{" "}
              {row.connected
                ? "Connected as " + row.accountName
                : row.status === "reconnect_required"
                  ? "Reconnect required"
                  : row.configured
                    ? "Ready to connect"
                    : "Setup required"}
            </li>
          ))}
        </ul>
      )}
      <a href="/connect-social">Manage direct social connections</a>
      <p>
        Available features depend on platform permissions. Connecting alone does not enable
        publishing.
      </p>
    </section>
  );
}
