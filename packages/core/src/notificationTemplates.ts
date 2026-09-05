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

/**
 * BEVL-03 proactive weekly review. The thread id is deterministic and SHARED by the backend cron
 * and the web pinned tab — the one string that must not drift across that boundary.
 *
 * The two review kinds are DELIBERATELY ABSENT from NOTIFICATION_KINDS above. That absence is the
 * SC#2 guarantee: notifyExternal.dispatch returns at `if (!KINDS.has(kind)) return;` BEFORE
 * freshAccessToken, so an unregistered kind can never reach a Gmail token. Adding them here would
 * arm the mailbox path and break notificationTemplates.test.ts:36. Do not.
 */
export const REVIEW_THREAD_ID = "proactive-review";
export const REVIEW_READY_MESSAGE = "Your weekly business review is ready.";
export const REVIEW_FAILED_MESSAGE =
  "We couldn't run your weekly review — open the cockpit to run one now.";
/**
 * Phase 34 (Goal Engine v0): the review staged ONE proposal onto the approvals surface. Same
 * rule as the two review kinds — `agenda_proposal` stays OUT of NOTIFICATION_KINDS above, so it
 * can never arm the mailbox path. Static copy; the proposal itself is on /dashboard/approvals.
 */
export const AGENDA_PROPOSAL_MESSAGE = "Pikar staged one next step for your approval.";

/**
 * The per-provider reconnect prompts — DELIBERATELY OUTSIDE `NOTIFICATION_KINDS` above.
 *
 * ⚠ DO NOT ADD THESE TO `NOTIFICATION_KINDS`. That list is what arms
 * `notifyExternal.dispatch`, which reaches `freshAccessToken` and sends MAIL. A reconnect
 * prompt says "your connection is dying" — routing it through the connection it reports on is
 * the loop `audit-dead-letter.md` exists to prevent, and it is why `gmail_reconnect` rows are
 * inserted directly with their own copy rather than through `notificationMessage`. The same
 * reasoning that keeps the two review kinds out of that list keeps these out.
 *
 * They live here anyway, beside the list they must stay out of, because that is where a future
 * reader is standing when they are tempted to add them.
 *
 * 17-06 (ADR-018) added the Microsoft row. Before it there was one hardcoded `"gmail_reconnect"`
 * literal in six places; a second provider made the table cheaper than the literals.
 */
export const RECONNECT_PROVIDERS = ["google", "microsoft"] as const;
export type ReconnectProvider = (typeof RECONNECT_PROVIDERS)[number];

/**
 * `message` is the PROACTIVE notification copy (a cron noticed the grant is expiring).
 * `holdMessage` is the REACTIVE copy for a request parked at `awaiting_reauth`.
 *
 * They are separate fields because the two states are different facts about different things, and
 * conflating them ships the wrong sentence. Microsoft is the case that proves it: its notification
 * is raised by the CALENDAR expiry cron ("keep calendar access working"), but since 25-05 a
 * Microsoft MAIL send can also hold — and telling someone whose email is stuck that their calendar
 * needs attention describes the wrong subsystem entirely.
 */
export const RECONNECT: Record<
  ReconnectProvider,
  {
    readonly kind: string;
    readonly message: string;
    readonly holdMessage: string;
    readonly href: string;
    readonly cta: string;
  }
> = {
  google: {
    kind: "gmail_reconnect",
    message: "Reconnect Gmail to keep delivery running",
    holdMessage: "Reconnect Gmail to send this",
    href: "/connect-gmail",
    cta: "Reconnect",
  },
  microsoft: {
    kind: "microsoft_calendar_reconnect",
    message: "Reconnect Microsoft to keep calendar access working",
    holdMessage: "Reconnect Microsoft to send this",
    href: "/connect-microsoft",
    cta: "Reconnect",
  },
};

/** Every reconnect kind, for the banner's filter and for tests that must be exhaustive. */
export const RECONNECT_KINDS = RECONNECT_PROVIDERS.map((p) => RECONNECT[p].kind);

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
