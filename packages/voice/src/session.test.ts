import { describe, expect, it } from "vitest";
import { CAP_MS, canTransition, capEndsAt, graceExpired, isEnded } from "./session";

describe("capEndsAt", () => {
  it("is startedAt + a 15-minute cap", () => {
    expect(CAP_MS).toBe(15 * 60 * 1000);
    expect(capEndsAt(1000)).toBe(1000 + 900_000);
  });
});

describe("session FSM", () => {
  it("active → ended_clean and active → ended_abnormal are legal", () => {
    expect(canTransition("active", "ended_clean")).toBe(true);
    expect(canTransition("active", "ended_abnormal")).toBe(true);
  });

  it("an already-ended status is terminal", () => {
    expect(canTransition("ended_clean", "ended_abnormal")).toBe(false);
    expect(canTransition("ended_abnormal", "ended_clean")).toBe(false);
  });

  it("active → active is not a valid end transition", () => {
    expect(canTransition("active", "active")).toBe(false);
  });

  it("isEnded reflects terminal states (CAS guard reuse)", () => {
    expect(isEnded("active")).toBe(false);
    expect(isEnded("ended_clean")).toBe(true);
    expect(isEnded("ended_abnormal")).toBe(true);
  });
});

describe("graceExpired (mic-recovery + silence predicate)", () => {
  const WINDOW = 30_000;

  it("is true once the window has fully elapsed (>= boundary is inclusive)", () => {
    expect(graceExpired(1000, 1000 + WINDOW, WINDOW)).toBe(true); // exactly elapsed
    expect(graceExpired(1000, 1000 + WINDOW + 5, WINDOW)).toBe(true); // past
  });

  it("is false while the window is still open", () => {
    expect(graceExpired(1000, 1000 + WINDOW - 1, WINDOW)).toBe(false);
    expect(graceExpired(1000, 1000, WINDOW)).toBe(false);
  });

  it("fail-safe: a non-finite input never ends the session (bad clock read)", () => {
    expect(graceExpired(Number.NaN, 1_000_000, WINDOW)).toBe(false);
    expect(graceExpired(1000, Number.POSITIVE_INFINITY, WINDOW)).toBe(false);
    expect(graceExpired(1000, 2000, Number.NaN)).toBe(false);
  });

  it("fail-safe: a negative input never ends the session", () => {
    expect(graceExpired(-1, 1_000_000, WINDOW)).toBe(false);
    expect(graceExpired(1000, -1, WINDOW)).toBe(false);
    expect(graceExpired(1000, 2000, -WINDOW)).toBe(false);
  });
});
