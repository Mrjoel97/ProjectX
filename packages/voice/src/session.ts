/**
 * Pure session status FSM + cap math (VOIC-02). The 15-min cap is a server wall-clock
 * bound; `capEndsAt` is what the watchdog arms against, armed ONCE and never re-armed.
 * No 'wrapping' state — the T-2min wrap-up is a client-side agent instruction, not a
 * server status. `canTransition`/`isEnded` are the guards later CAS mutations reuse.
 */

export const CAP_MS = 15 * 60 * 1000;

/** Wall-clock instant the watchdog force-ends the session. */
export const capEndsAt = (startedAt: number): number => startedAt + CAP_MS;

export type SessionStatus = "active" | "ended_clean" | "ended_abnormal";

/** A terminal status — no further transitions (CAS no-op point). */
export const isEnded = (status: SessionStatus): boolean =>
  status === "ended_clean" || status === "ended_abnormal";

/** Legal transitions: only active → ended_clean and active → ended_abnormal. Anything
 *  from an ended status, or a non-ending target, is rejected (idempotent CAS guard). */
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from !== "active") return false;
  return to === "ended_clean" || to === "ended_abnormal";
}

/**
 * Has a bounded grace window fully elapsed? True iff `now - sinceMs >= windowMs`. The ONE predicate
 * behind BOTH the mic-recovery window (sinceMs = paused-at) and the silence timeout (sinceMs = last
 * audio activity) in useVoiceSession — one place decides "give up and end", so the two timers can
 * never disagree. Fail-SAFE by construction: a non-finite or negative input returns `false` (never
 * end on a bad clock read — a spurious end is worse than a slightly late one). The window consuming
 * cap time is the caller's concern; this is pure arithmetic with no wall-clock of its own.
 */
export function graceExpired(sinceMs: number, now: number, windowMs: number): boolean {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(now) || !Number.isFinite(windowMs))
    return false;
  if (sinceMs < 0 || now < 0 || windowMs < 0) return false;
  return now - sinceMs >= windowMs;
}
