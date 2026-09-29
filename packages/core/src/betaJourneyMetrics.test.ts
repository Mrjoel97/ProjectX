import { describe, expect, test } from "vitest";
import {
  costPerActiveUser,
  firstResultLatency,
  postOnboardingLatency,
  stepCompletion,
  weekTwoReturn,
} from "./betaJourneyMetrics";

describe("beta journey metrics", () => {
  const events = [
    { eventType: "admission_succeeded", occurredAt: 0, actorId: "a" },
    { eventType: "onboarding_completed", occurredAt: 10, actorId: "a" },
    { eventType: "delivery_failed", occurredAt: 20, actorId: "a" },
    { eventType: "delivery_sent", occurredAt: 30, actorId: "a" },
    { eventType: "return_observed", occurredAt: 8 * 86_400_000, actorId: "a" },
  ];
  test("uses governed successful terminals and separates admission from onboarding latency", () => {
    expect(firstResultLatency(events)).toEqual({ state: "available", value: 30 });
    expect(postOnboardingLatency(events)).toEqual({ state: "available", value: 20 });
  });
  test("keeps denominators explicit and declines fabricated zeroes", () => {
    expect(stepCompletion(events, "onboarding_completed", 1)).toEqual({
      state: "available",
      value: 1,
    });
    expect(stepCompletion([], "onboarding_completed", 0)).toMatchObject({ state: "unavailable" });
    expect(costPerActiveUser([], ["a"])).toMatchObject({ state: "unavailable" });
    expect(costPerActiveUser([3], ["a", "a", "b"])).toEqual({ state: "available", value: 1.5 });
  });
  test("uses a UTC week-two window", () => {
    expect(weekTwoReturn(events)).toEqual({ state: "available", value: 1 });
  });
  test("counts a later in-window return even when an earlier return is outside the window", () => {
    const day = 86_400_000;
    expect(
      weekTwoReturn([
        { eventType: "admission_succeeded", occurredAt: 0, actorId: "a" },
        { eventType: "return_observed", occurredAt: day, actorId: "a" },
        { eventType: "return_observed", occurredAt: 8 * day, actorId: "a" },
      ]),
    ).toEqual({ state: "available", value: 1 });
  });
});
