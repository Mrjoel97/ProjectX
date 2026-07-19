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
