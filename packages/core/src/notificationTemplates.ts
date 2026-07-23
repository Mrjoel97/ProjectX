/**
 * OPSG-05 notification labels — the §4 static-label firewall.
 *
 * Every Phase-7 notification site maps to ONE fixed, human-readable label. The messages
 * are STATIC (refs/counts only, never interpolated content): a notification derived from
 * an untrusted mail body, a rejected draft, or a guardrail block must never carry that
 * content into the notifications plane. `notificationMessage` takes a kind and NOTHING
 * else — there is deliberately no content parameter to smuggle a body through (§4).
 *
 * Ids/counts a notification legitimately needs (a requestId ref, an "N failed" count) are
 * carried in structured fields by the Convex adapter (convex/notifications.ts), never
 * interpolated into these labels. The unit test asserts no label contains `${`.
 */

/** Closed union of every Phase-7 notification site. A new site adds a member here. */
export type NotificationKind =
  | "validation.rejected"
  | "guardrail.blocked"
  | "review.expired"
  | "review.escalated"
  | "retry.limit"
  | "agent.timeout"
  | "deadletter"
  | "awaiting_reauth"
  | "optimizer.candidate";

/** Runtime list of the union members — lets callers/tests iterate every kind exhaustively. */
export const NOTIFICATION_KINDS = [
  "validation.rejected",
  "guardrail.blocked",
  "review.expired",
  "review.escalated",
  "retry.limit",
  "agent.timeout",
  "deadletter",
  "awaiting_reauth",
  "optimizer.candidate",
] as const satisfies readonly NotificationKind[];

/** Static label per kind. `Record<NotificationKind, …>` makes a missing kind a compile error. */
const MESSAGES: Record<NotificationKind, string> = {
  "validation.rejected": "A submission was rejected by validation.",
  "guardrail.blocked": "A request was blocked by a guardrail.",
  "review.expired": "A review timed out before you responded.",
  "review.escalated": "A draft reached its revision limit and was escalated for your attention.",
  "retry.limit": "An action failed after its retry limit and was moved to the dead-letter queue.",
  "agent.timeout": "An agent step timed out.",
  deadletter: "A workflow failed and was recorded in the dead-letter queue.",
  awaiting_reauth: "Your Gmail connection needs to be reauthorized.",
  "optimizer.candidate": "A new optimized skill candidate is ready for your review.",
};

/** The fixed label for a notification kind — NEVER interpolates content (§4). Pure. */
export function notificationMessage(kind: NotificationKind): string {
  return MESSAGES[kind];
}
