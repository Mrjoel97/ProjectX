"use client";

import { api } from "@pikar/backend/api";
import { REVIEW_THREAD_ID } from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

// BEVL-03: the review notification is only useful if it opens the review. `?thread=` is the
// existing VOIC-04 workspace deep-link — no new route. A kind with no entry stays plain text
// (today's behaviour for every other kind), so this is opt-in per kind and never a redirect trap.
const KIND_HREF: Record<string, string> = {
  weekly_review: `/dashboard/workspace?thread=${REVIEW_THREAD_ID}`,
  weekly_review_failed: "/dashboard/workspace", // the on-demand evaluateBusiness path is live there
};

// OPSG-05 in-app render surface. Every failure terminal in the phase routes through
// notifications.notify, which inserts a row here (the fail-closed floor) AND best-effort
// emails it (notifyExternal). The email half was live-proven; this banner is the in-app
// half — the general matrix: review/agent timeouts, escalations, retry-limit breaches,
// dead-letter, validation/guardrail blocks.
//
// `gmail_reconnect` is EXCLUDED on purpose: ReconnectBanner already owns that kind (it
// pairs it with a Reconnect CTA), so surfacing it here too would double-render it.
//
// `message` is refs/counts-only by contract (CLAUDE.md §4 — callers pass
// notificationMessage(kind), a static string), so rendering it carries no PII.
//
// ponytail: a stacked banner list, mirroring the sibling ReconnectBanner/AbnormalBriefBanner
// idiom (fewest new concepts). If notification volume ever grows past a handful, swap for a
// rail bell + popover panel (the BellIcon on the "Approvals" nav item is the intended home).
export function NotificationsBanner() {
  const notifications = useQuery(api.notifications.list);
  const markRead = useMutation(api.notifications.markRead);

  // undefined = still loading → render nothing (no flash), same as DeadLetterBadge.
  const unread = (notifications ?? []).filter((n) => !n.read && n.kind !== "gmail_reconnect");
  if (unread.length === 0) return null;

  return (
    <section className="notif-banner" aria-label="Notifications">
      <ul className="notif-list">
        {unread.map((n) => {
          const href = KIND_HREF[n.kind];
          return (
            <li key={n._id} className="notif-row">
              <span className="notif-dot" aria-hidden="true" />
              {href ? (
                <Link className="notif-msg" href={href}>
                  {n.message}
                </Link>
              ) : (
                <span className="notif-msg">{n.message}</span>
              )}
              <button
                type="button"
                className="notif-dismiss"
                aria-label={`Dismiss: ${n.message}`}
                onClick={() => void markRead({ notificationId: n._id })}
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
