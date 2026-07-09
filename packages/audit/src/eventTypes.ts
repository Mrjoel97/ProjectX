// Audit event-type taxonomy (pure TS — no framework imports).
//
// This is the canonical, versionable vocabulary of things worth auditing across
// the pipeline. Convex's insert-only audit module (convex/audit.ts) and later
// governance surfaces reference these to keep event names consistent and typed.
// Add new event types here — never hardcode ad-hoc strings at call sites.

export const AUDIT_EVENT_TYPES = [
  "request.received",
  "routing.decided",
  "model.called",
  "review.action",
  "delivery.sent",
  "deadletter.written",
] as const;

/** Union of every recognized audit event type. */
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Narrowing guard — true when `value` is a recognized audit event type. */
export function isAuditEventType(value: string): value is AuditEventType {
  return (AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}
