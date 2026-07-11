// Gmail token-expiry math — pure domain logic (CLAUDE.md §1: no Convex imports).
//
// Two clocks drive DLVR-03:
//   1. The proactive banner: flag a token ~24h before it dies so the user reconnects
//      BEFORE delivery breaks (isExpiringSoon).
//   2. The reactive safety net: a refresh token that has out-lived Gmail's Testing-mode
//      7-day window is dead — send routes to awaiting_reauth (isDead).
//
// Kept pure + unit-tested so the window boundaries are deterministic, independent of
// Convex and of Google's wall clock (the caller passes `now`).

/** Gmail Testing-mode refresh tokens expire 7 days after consent. */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Lead time for the "Reconnect Gmail" banner — flag a token within ~24h of expiry. */
export const EXPIRY_WARN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * True when `expiresAt` is within `windowMs` of `now` (or already past). False only when
 * expiry is further out than the window — i.e. still safely in the future.
 */
export function isExpiringSoon(
  expiresAt: number,
  now: number,
  windowMs: number = EXPIRY_WARN_WINDOW_MS,
): boolean {
  return expiresAt - now <= windowMs;
}

/** True once the refresh window has passed (`now` at/after the refresh expiry). */
export function isDead(refreshExpiresAt: number, now: number): boolean {
  return now >= refreshExpiresAt;
}
