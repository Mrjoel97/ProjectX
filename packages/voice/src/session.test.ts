import { describe, expect, it } from "vitest";
import { CAP_MS, canTransition, capEndsAt, isEnded } from "./session";

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
