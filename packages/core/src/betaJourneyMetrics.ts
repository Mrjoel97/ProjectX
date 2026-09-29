/** Framework-free reducers for the BETA-03 measurement plane. Missing evidence is unavailable. */
export type JourneyEvent = {
  eventType: string;
  occurredAt: number;
  actorId?: string;
  terminalOutcome?: "sent" | "failed" | "suppressed" | "held";
};

export type Metric<T> = { state: "available"; value: T } | { state: "unavailable"; reason: string };
const unavailable = <T>(reason: string): Metric<T> => ({ state: "unavailable", reason });

/** Successful admission to first successful governed delivery; failures never activate a cohort. */
export function firstResultLatency(events: readonly JourneyEvent[]): Metric<number> {
  const admission = events
    .filter((e) => e.eventType === "admission_succeeded")
    .sort((a, b) => a.occurredAt - b.occurredAt)[0];
  if (!admission) return unavailable("no-successful-admission");
  const terminal = events
    .filter((e) => e.eventType === "delivery_sent" && e.occurredAt >= admission.occurredAt)
    .sort((a, b) => a.occurredAt - b.occurredAt)[0];
  return terminal
    ? { state: "available", value: terminal.occurredAt - admission.occurredAt }
    : unavailable("no-successful-governed-terminal");
}

/** Explicitly labelled post-onboarding latency; it intentionally has a different cohort start. */
export function postOnboardingLatency(events: readonly JourneyEvent[]): Metric<number> {
  const start = events
    .filter((e) => e.eventType === "onboarding_completed")
    .sort((a, b) => a.occurredAt - b.occurredAt)[0];
  if (!start) return unavailable("no-onboarding-completion");
  const terminal = events
    .filter((e) => e.eventType === "delivery_sent" && e.occurredAt >= start.occurredAt)
    .sort((a, b) => a.occurredAt - b.occurredAt)[0];
  return terminal
    ? { state: "available", value: terminal.occurredAt - start.occurredAt }
    : unavailable("no-successful-governed-terminal");
}

/** Completion is event-count based; the denominator is stated instead of inferred from a silent zero. */
export function stepCompletion(
  events: readonly JourneyEvent[],
  step: string,
  admitted: number,
): Metric<number> {
  if (!Number.isSafeInteger(admitted) || admitted <= 0)
    return unavailable("no-admission-denominator");
  return {
    state: "available",
    value: events.filter((e) => e.eventType === step).length / admitted,
  };
}

/** UTC [day 7, day 14) return window relative to an admission, with distinct actors required. */
export function weekTwoReturn(events: readonly JourneyEvent[]): Metric<number> {
  const admissions = events.filter((e) => e.eventType === "admission_succeeded" && e.actorId);
  const admitted = new Map(admissions.map((e) => [e.actorId!, e.occurredAt]));
  if (admitted.size === 0) return unavailable("no-admission-denominator");
  const returning = new Set(
    [...admitted]
      .filter(([id, start]) =>
        events.some(
          (e) =>
            e.eventType === "return_observed" &&
            e.actorId === id &&
            e.occurredAt >= start + 7 * 86_400_000 &&
            e.occurredAt < start + 14 * 86_400_000,
        ),
      )
      .map(([id]) => id),
  );
  return { state: "available", value: returning.size / admitted.size };
}

/** Cost is unavailable until BOTH settled spend and an explicit distinct active-user denominator exist. */
export function costPerActiveUser(
  settledSpendUsd: readonly number[],
  activeUserIds: readonly string[],
): Metric<number> {
  const active = new Set(activeUserIds.filter(Boolean));
  if (active.size === 0) return unavailable("no-active-user-denominator");
  if (settledSpendUsd.length === 0) return unavailable("no-settled-spend-observation");
  if (!settledSpendUsd.every((value) => Number.isFinite(value) && value >= 0))
    return unavailable("invalid-settled-spend");
  return {
    state: "available",
    value: settledSpendUsd.reduce((sum, value) => sum + value, 0) / active.size,
  };
}
