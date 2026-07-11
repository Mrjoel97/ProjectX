"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";

// DLVR-03 reactive loop. The banner surfaces when Gmail delivery is (or is about to be)
// blocked, so a dead token is a visible prompt rather than a silent failure:
//   - reactive: a request sits in `awaiting_reauth` (gmail.send hit a dead token and held
//     the already-approved draft — the workflow re-fires delivery on reconnect, so the UI
//     never re-prompts for approval);
//   - proactive: the daily cron flagged the 7-day refresh window with a `gmail_reconnect`
//     notification (CONTEXT: in-app only, never via the mail path it reports on).
export function ReconnectBanner() {
  const awaitingReauth = useQuery(api.requests.list, { status: "awaiting_reauth" });
  const notifications = useQuery(api.notifications.list);

  const blocked = (awaitingReauth?.length ?? 0) > 0;
  const expiringSoon = (notifications ?? []).some((n) => n.kind === "gmail_reconnect" && !n.read);
  if (!blocked && !expiringSoon) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.6rem 1.5rem",
        background: "#fef3c7",
        borderBottom: "1px solid #f59e0b",
        color: "#92400e",
        fontWeight: 600,
      }}
    >
      <span>Reconnect Gmail to send this</span>
      <Link
        href="/connect-gmail"
        style={{
          padding: "0.35rem 0.9rem",
          borderRadius: "0.375rem",
          background: "#92400e",
          color: "#fff",
          textDecoration: "none",
        }}
      >
        Reconnect
      </Link>
    </div>
  );
}
