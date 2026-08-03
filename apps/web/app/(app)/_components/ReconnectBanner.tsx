"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";

// Dismissal for the held-request half. The notification half dismisses server-side
// (notifications.markRead, the NotificationsBanner idiom), but a request parked at
// `awaiting_reauth` has no "dismissed" column and nothing resumes it yet, so its id goes in a
// client seen-set — the AbnormalBriefBanner idiom, no schema change. A NEW hold or a NEW expiry
// warning re-surfaces the banner: dismissing silences today's prompt, never tomorrow's.
const SEEN_KEY = "pikar:reconnectHoldsSeen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

// DLVR-03 reactive loop. The banner surfaces when Gmail delivery is (or is about to be)
// blocked, so a dead token is a visible prompt rather than a silent failure:
//   - reactive: a request sits in `awaiting_reauth` (gmail.send hit a dead token and held
//     the already-approved draft; no resume sweep exists yet, so reconnecting does NOT
//     re-fire that delivery — the hold is dismissible, not self-healing);
//   - proactive: the daily cron flagged the 7-day refresh window with a `gmail_reconnect`
//     notification (CONTEXT: in-app only, never via the mail path it reports on).
export function ReconnectBanner() {
  const awaitingReauth = useQuery(api.requests.list, { status: "awaiting_reauth" });
  const notifications = useQuery(api.notifications.list);
  const markRead = useMutation(api.notifications.markRead);

  // Load the seen-set AFTER mount (SSR has no localStorage) — until then render nothing so a
  // dismissed banner never flashes back on every navigation.
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => setSeen(readSeen()), []);
  if (seen === null) return null;

  const holds = (awaitingReauth ?? []).filter((r) => !seen.has(r._id));
  const unread = (notifications ?? []).filter((n) => n.kind === "gmail_reconnect" && !n.read);
  if (holds.length === 0 && unread.length === 0) return null;

  const dismiss = () => {
    for (const n of unread) void markRead({ notificationId: n._id });
    const next = new Set(seen);
    for (const r of holds) next.add(r._id);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode / no storage — the banner degrades to re-surfacing, never to hiding a hold */
    }
    setSeen(next);
  };

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
      <span style={{ flex: 1 }}>Reconnect Gmail to send this</span>
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
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss reconnect notice"
        title="Dismiss"
        style={{
          flex: "none",
          padding: "0.15rem 0.45rem",
          border: "none",
          background: "transparent",
          color: "#92400e",
          font: "inherit",
          fontSize: "1.1rem",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}
