"use client";

import { api } from "@pikar/backend/api";
import { RECONNECT, type ReconnectProvider } from "@pikar/core";
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

/**
 * WHICH PROVIDER LINES TO SHOW. Exported and pure so it can be tested against real inputs — the
 * component itself renders nothing until its seen-set loads after mount, so a render test would
 * assert on an empty string and prove nothing.
 *
 * 17-06 (ADR-018) generalized the NOTIFICATION half by provider. The HOLD half stayed hardcoded
 * Google, correctly at the time: `awaiting_reauth` could only ever be set by `gmail.send`.
 * **25-05 ended that.** `graph.send` sets it too, so a hold no longer implies Google — it implies
 * whichever mailbox the ROW was routed to. Getting this wrong sends a user to the wrong consent
 * screen while the real problem stands.
 *
 * `mailProvider` absent ⇒ google, the same legacy default `delivery.send` applies.
 *
 * A HOLD outranks a notification for the same provider: a stuck message is a concrete thing the
 * user is waiting on; an expiry warning is not yet. The two carry different copy because they are
 * different facts — Microsoft's notification is raised by the CALENDAR cron, and reusing it for a
 * mail hold would describe the wrong subsystem.
 */
export function reconnectLines(
  holds: readonly { mailProvider?: "google" | "microsoft" }[],
  unread: readonly { kind: string }[],
): { provider: ReconnectProvider; message: string }[] {
  const lines: { provider: ReconnectProvider; message: string }[] = [];
  for (const provider of ["google", "microsoft"] as const) {
    const held = holds.filter((r) => (r.mailProvider ?? "google") === provider).length;
    const warned = unread.filter((n) => n.kind === RECONNECT[provider].kind).length;
    if (held === 0 && warned === 0) continue;
    lines.push({
      provider,
      message: held > 0 ? RECONNECT[provider].holdMessage : RECONNECT[provider].message,
    });
  }
  return lines;
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
  const unreadFor = (provider: ReconnectProvider) =>
    (notifications ?? []).filter((n) => n.kind === RECONNECT[provider].kind && !n.read);
  const googleUnread = unreadFor("google");
  const microsoftUnread = unreadFor("microsoft");
  const unread = [...googleUnread, ...microsoftUnread];
  if (holds.length === 0 && unread.length === 0) return null;

  const lines = reconnectLines(holds, [...googleUnread, ...microsoftUnread]);

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
    <div style={{ display: "grid" }}>
      {lines.map(({ provider, message }, i) => (
        <div
          key={provider}
          data-testid={`reconnect-${provider}`}
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
          <span style={{ flex: 1 }}>{message}</span>
          <Link
            href={RECONNECT[provider].href}
            style={{
              padding: "0.35rem 0.9rem",
              borderRadius: "0.375rem",
              background: "#92400e",
              color: "#fff",
              textDecoration: "none",
            }}
          >
            {RECONNECT[provider].cta}
          </Link>
          {/* ONE dismiss control, on the last line only: dismissing is a single act over every
              prompt currently showing, and a per-line ✕ would imply otherwise while `dismiss`
              clears them all. */}
          {i === lines.length - 1 ? (
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
          ) : (
            <span style={{ flex: "none", width: "1.6rem" }} aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}
