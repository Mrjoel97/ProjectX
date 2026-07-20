"use node";

// OPSG-05 external notification channel — best-effort, fail-closed, loop-guarded.
//
// `notifications.notify` inserts the in-app row (the fail-closed floor) and THEN schedules this
// action via runAfter(0). Here we email the user's OWN connected mailbox a STATIC failure notice
// (the kind label only — NEVER a requestId/subject/body/content, CLAUDE.md §4). Everything is
// wrapped so a dispatch failure is SWALLOWED: it never throws, never calls notify, never writes a
// deadLetter — a failed external send that re-notified would create the notification loop the
// must-haves forbid. Worst case is a console.warn carrying refs only.
//
// "use node": reuses gmail.ts's freshAccessToken/buildMime/base64Url + the GOVERNED SEND_ENDPOINT
// (the same sanctioned send, not a new write verb). A dead/absent token → return silently (the
// already-inserted in-app row is the guarantee; email is a bonus channel).
import { v } from "convex/values";
import { NOTIFICATION_KINDS, notificationMessage, type NotificationKind } from "@pikar/core";
import { internalAction } from "./_generated/server";
import { SEND_ENDPOINT, base64Url, buildMime, freshAccessToken } from "./gmail";

// The user's own mailbox address (send-to-self). A GET, never a write — so the read-only-mailbox
// invariant holds and gmail.ts's POST-target scan is untouched (the only POST here is the send).
const PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

const KINDS = new Set<string>(NOTIFICATION_KINDS);

/**
 * Best-effort external (email) dispatch of a notification. Explicit `Promise<void>` return keeps
 * this action out of the internal-graph inference cycle (Convex guidelines §96).
 */
export const dispatch = internalAction({
  args: { tenantId: v.string(), kind: v.string() },
  handler: async (ctx, { tenantId, kind }): Promise<void> => {
    try {
      // Pin to a known kind at the boundary — an unknown label has no static message to send, and
      // must never be interpolated into the mail (§4). Nothing to say → fail closed to the in-app row.
      if (!KINDS.has(kind)) return;
      const k = kind as NotificationKind;

      // No connected mailbox / refresh failure → return silently (fail closed to in-app). Never throw.
      const access = await freshAccessToken(ctx, tenantId);
      if (!access.ok) return;

      // Resolve the user's OWN address to send-to-self (read-only GET).
      const profRes = await fetch(PROFILE_ENDPOINT, {
        headers: { Authorization: `Bearer ${access.token}` },
      });
      if (!profRes.ok) return;
      const { emailAddress } = (await profRes.json()) as { emailAddress?: string };
      if (!emailAddress) return;

      // STATIC subject + body — the kind label and its fixed message ONLY. No requestId, no content,
      // nothing interpolated (§4). notificationMessage takes a kind and nothing else by design.
      const raw = base64Url(buildMime(emailAddress, `Pikar: ${k}`, notificationMessage(k)));
      await fetch(SEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });
    } catch {
      // The loop guard: a failed external send NEVER throws, NEVER notifies, NEVER dead-letters.
      // Refs only in the log line — the kind is a static enum member, never content.
      console.warn(`[notifyExternal] external dispatch failed (kind=${kind}) — in-app row stands`);
    }
  },
});
