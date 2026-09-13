/** Request limits count attempts, including failed or ambiguous extraction calls. */
export const MAX_RESEARCH_PAGE_ATTEMPTS = 6;
export const RESEARCH_REQUEST_LIFETIME_MS = 60 * 60 * 1000;

export function researchPageLimit(value = MAX_RESEARCH_PAGE_ATTEMPTS): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_RESEARCH_PAGE_ATTEMPTS)
    throw new Error("RESEARCH_PAGE_LIMIT_INVALID");
  return value;
}

export function canClaimResearchPage(
  control: { limit: number; attempts: readonly string[]; expiresAt: number; closed: boolean },
  attemptId: string,
  now: number,
): boolean {
  return (
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attemptId) &&
    Number.isInteger(control.limit) &&
    control.limit >= 0 &&
    control.limit <= MAX_RESEARCH_PAGE_ATTEMPTS &&
    Number.isFinite(now) &&
    Number.isFinite(control.expiresAt) &&
    !control.closed &&
    now < control.expiresAt &&
    control.attempts.length < control.limit &&
    !control.attempts.includes(attemptId)
  );
}
