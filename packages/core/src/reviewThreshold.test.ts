import { describe, expect, test } from "vitest";
import { classifyReviewDecision, MAX_REGENERATE } from "./reviewThreshold";

describe("classifyReviewDecision (REVW-02 fail-closed review gate)", () => {
  test("approve → proceed", () => {
    expect(classifyReviewDecision({ decision: "approve", regenerateCount: 0 })).toEqual({
      action: "proceed",
    });
  });

  test("edit_text → proceed (a single-shot terminal, counter cannot exceed 1)", () => {
    expect(classifyReviewDecision({ decision: "edit_text", regenerateCount: 0 })).toEqual({
      action: "proceed",
    });
  });

  test("reject → terminate with a rejected outcome", () => {
    expect(classifyReviewDecision({ decision: "reject", regenerateCount: 0 })).toEqual({
      action: "terminate",
      outcome: "rejected",
    });
  });

  test("regenerate below the cap → regenerate", () => {
    expect(classifyReviewDecision({ decision: "regenerate", regenerateCount: 0 })).toEqual({
      action: "regenerate",
    });
  });

  test("regenerate one step below the cap still regenerates (boundary)", () => {
    expect(
      classifyReviewDecision({ decision: "regenerate", regenerateCount: MAX_REGENERATE - 1 }),
    ).toEqual({ action: "regenerate" });
  });

  test("regenerate AT the cap escalates — never proceeds to delivery (the fail-closed fix)", () => {
    expect(
      classifyReviewDecision({ decision: "regenerate", regenerateCount: MAX_REGENERATE }),
    ).toEqual({ action: "escalate", reason: "regenerate_limit" });
  });

  test("regenerate past the cap escalates too — a breach never falls through to a send", () => {
    const r = classifyReviewDecision({
      decision: "regenerate",
      regenerateCount: MAX_REGENERATE + 5,
    });
    expect(r.action).toBe("escalate");
    expect(r.action).not.toBe("proceed");
  });

  test("MAX_REGENERATE is a positive default cap", () => {
    expect(MAX_REGENERATE).toBeGreaterThan(0);
    expect(MAX_REGENERATE).toBe(3);
  });
});
