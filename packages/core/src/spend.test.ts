import { describe, expect, it } from "vitest";
import {
  aggregateSpend,
  SPEND_PHASES,
  SPEND_RAILS,
  type SpendMovement,
  validateSpendMovement,
} from "./spend";

function movement(overrides: Partial<SpendMovement> = {}): SpendMovement {
  return {
    rail: "reasoning",
    phase: "actual",
    amountCents: 125,
    correlationId: "plan:abc123:step:1",
    ...overrides,
  };
}

describe("spend movement validation", () => {
  it("accepts every declared rail and phase", () => {
    for (const rail of SPEND_RAILS) {
      for (const phase of SPEND_PHASES) {
        expect(validateSpendMovement(movement({ rail, phase }))).toMatchObject({ rail, phase });
      }
    }
  });

  it("returns a copy so a caller cannot mutate a validated movement into the ledger", () => {
    const input = movement();
    const validated = validateSpendMovement(input);
    expect(validated).not.toBe(input);
    validated.amountCents = 999_999;
    expect(input.amountCents).toBe(125);
  });

  it("rejects a rail or phase outside the closed vocabulary", () => {
    expect(() => validateSpendMovement(movement({ rail: "email" as never }))).toThrow(/rail/);
    expect(() => validateSpendMovement(movement({ phase: "pending" as never }))).toThrow(/phase/);
  });

  it("rejects zero, negative, fractional and unsafe cents", () => {
    for (const amountCents of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => validateSpendMovement(movement({ amountCents }))).toThrow(/amountCents/);
    }
  });

  it("rejects a correlation id that is empty, oversized or carries free text", () => {
    expect(() => validateSpendMovement(movement({ correlationId: "" }))).toThrow(/correlationId/);
    expect(() => validateSpendMovement(movement({ correlationId: "a".repeat(129) }))).toThrow(
      /correlationId/,
    );
    // A correlation id is server-minted from refs. Whitespace is the cheapest structural
    // proof that a caller pasted a sentence (CLAUDE.md §4 — refs, hashes, ids and counts only).
    expect(() =>
      validateSpendMovement(movement({ correlationId: "draft the Q3 board memo" })),
    ).toThrow(/correlationId/);
  });

  it("rejects a model or kind that is not a code-owned token", () => {
    expect(validateSpendMovement(movement({ model: "gpt-5.1-mini", kind: "video" }))).toMatchObject(
      {
        model: "gpt-5.1-mini",
        kind: "video",
      },
    );
    expect(() =>
      validateSpendMovement(movement({ model: "the model the user asked us to try" })),
    ).toThrow(/model/);
    expect(() => validateSpendMovement(movement({ kind: "" }))).toThrow(/kind/);
  });
});

describe("spend aggregation", () => {
  const coverageStartedAt = 1_000;

  it("is unknown, never zero, when coverage never started", () => {
    expect(aggregateSpend({ movements: [], windowSinceMs: 5_000 })).toEqual({
      coverage: "unknown",
      reason: "not-started",
    });
  });

  it("is unknown, never zero, when the window opens before coverage", () => {
    expect(
      aggregateSpend({
        movements: [movement()],
        windowSinceMs: coverageStartedAt - 1,
        coverageStartedAt,
      }),
    ).toEqual({ coverage: "unknown", reason: "window-precedes-coverage" });
  });

  it("reports zero for a covered window with no movements", () => {
    const result = aggregateSpend({ movements: [], windowSinceMs: coverageStartedAt });
    expect(result).toEqual({ coverage: "unknown", reason: "not-started" });

    const covered = aggregateSpend({
      movements: [],
      windowSinceMs: coverageStartedAt,
      coverageStartedAt,
    });
    expect(covered).toMatchObject({ coverage: "covered" });
    if (covered.coverage !== "covered") throw new Error("expected covered");
    expect(covered.totals.actual).toEqual({ phase: "actual", amountCents: 0, currency: "USD" });
    expect(covered.totals.unlanded.amountCents).toBe(0);
  });

  it("sums each phase and folds an adjustment into landed cost", () => {
    const covered = aggregateSpend({
      movements: [
        movement({ phase: "estimated", amountCents: 500, correlationId: "c1" }),
        movement({ phase: "reserved", amountCents: 400, correlationId: "c1" }),
        movement({ phase: "actual", amountCents: 300, correlationId: "c1" }),
        movement({ phase: "adjustment", amountCents: 25, correlationId: "c1" }),
        movement({ phase: "refunded", amountCents: 50, correlationId: "c1" }),
      ],
      windowSinceMs: coverageStartedAt,
      coverageStartedAt,
    });
    if (covered.coverage !== "covered") throw new Error("expected covered");
    expect(covered.totals.estimated.amountCents).toBe(500);
    expect(covered.totals.reserved.amountCents).toBe(400);
    // An adjustment is a post-hoc correction to what was charged, so it lands in `actual`.
    expect(covered.totals.actual.amountCents).toBe(325);
    expect(covered.totals.refunded.amountCents).toBe(50);
    // 400 reserved, 325 landed, 50 returned -> 25 still committed and unaccounted for.
    expect(covered.totals.unlanded.amountCents).toBe(25);
  });

  it("never reports negative unlanded money when landings exceed the reservation", () => {
    const covered = aggregateSpend({
      movements: [
        movement({ phase: "reserved", amountCents: 100 }),
        movement({ phase: "actual", amountCents: 260 }),
      ],
      windowSinceMs: coverageStartedAt,
      coverageStartedAt,
    });
    if (covered.coverage !== "covered") throw new Error("expected covered");
    expect(covered.totals.unlanded.amountCents).toBe(0);
    expect(covered.totals.actual.amountCents).toBe(260);
  });

  it("refuses to sum a movement that would not have been allowed into the ledger", () => {
    expect(() =>
      aggregateSpend({
        movements: [movement({ amountCents: -5 })],
        windowSinceMs: coverageStartedAt,
        coverageStartedAt,
      }),
    ).toThrow(/amountCents/);
  });
});
