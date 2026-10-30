/** Customer media allowance remains unchanged by a one-task human approval. */
export const DEFAULT_MEDIA_DAILY_BUDGET_CENTS = 10_000;

const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** The grant covers only the current task's shortfall; it creates no reusable daily credit. */
export function mediaTaskIncreaseCents(
  estimatedCents: number,
  dailyRemainingCents: number,
): number | null {
  return cents(estimatedCents) && cents(dailyRemainingCents)
    ? Math.max(0, estimatedCents - dailyRemainingCents)
    : null;
}

/** Split a reservation without driving the normal bucket negative or borrowing tomorrow's
 * allowance. The caller still records and checks the FULL cost on deployment and spend ledgers. */
export function mediaDailyCharge(
  estimatedCents: number,
  dailyRemainingCents: number,
  taskAllowanceCents: number,
): { baseCents: number; extraCents: number } | null {
  const extraCents = mediaTaskIncreaseCents(estimatedCents, dailyRemainingCents);
  if (extraCents === null || !cents(taskAllowanceCents) || extraCents > taskAllowanceCents)
    return null;
  return { baseCents: estimatedCents - extraCents, extraCents };
}
