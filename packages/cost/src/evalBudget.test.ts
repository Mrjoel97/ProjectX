import { describe, expect, it } from "vitest";
import { evalActualCents, evalLedgerCanReserve, evalLedgerUsageNanos } from "./evalBudget";

const reservation = (id: string, amountCents = 1) => ({ correlationId: id, amountCents });
const settlement = (id: string, evalActualUsd: number) => ({ correlationId: id, evalActualUsd });

describe("opt-in aggregate evaluation ledger nanos", () => {
  it("198 settled sub-cent calls retain the same $2 cap without charging 198 rounded cents", () => {
    const reservations = Array.from({ length: 198 }, (_, i) => reservation(`call-${i}`));
    const settlements = reservations.map((row, i) =>
      settlement(row.correlationId, i === 197 ? 0.00761101 : 0.0007),
    );
    const usage = evalLedgerUsageNanos(200, reservations, settlements);
    expect(usage).toEqual({
      actualNanos: 145_511_010,
      outstandingNanos: 0,
      remainingNanos: 1_854_488_990,
      remainingCents: 185,
    });
    expect(evalLedgerCanReserve(usage.remainingNanos, 50)).toBe(true);
    // The legacy helper is deliberately unchanged, as are the daily/deployment rails using it.
    expect(settlements.reduce((sum, row) => sum + evalActualCents(row.evalActualUsd), 0)).toBe(198);
  });

  it("unknown calls retain full ceilings, including a call that might turn out to be free", () => {
    expect(evalLedgerUsageNanos(200, [reservation("unknown", 150)], [])).toEqual({
      actualNanos: 0,
      outstandingNanos: 1_500_000_000,
      remainingNanos: 500_000_000,
      remainingCents: 50,
    });
    expect(
      evalLedgerUsageNanos(200, [reservation("free", 150)], [settlement("free", 0)]).remainingCents,
    ).toBe(200);
  });

  it("a transactional reread counts the first concurrent admission before admitting another", () => {
    expect(evalLedgerCanReserve(evalLedgerUsageNanos(200, [], []).remainingNanos, 150)).toBe(true);
    const reserved = [reservation("first", 150)];
    expect(evalLedgerCanReserve(evalLedgerUsageNanos(200, reserved, []).remainingNanos, 100)).toBe(
      false,
    );
    expect(
      evalLedgerCanReserve(
        evalLedgerUsageNanos(200, reserved, [settlement("first", 0.25)]).remainingNanos,
        100,
      ),
    ).toBe(true);
  });

  it("rounds each positive amount up to nanos, including decimal and exponent boundaries", () => {
    for (const [usd, nanos] of [
      [0, 0],
      [0.01, 10_000_000],
      [1e-9, 1],
      [1e-10, 1],
      [Number.MIN_VALUE, 1],
      [1.0000000000000003e-9, 2],
      [9.000000000000001e-9, 10],
    ] as const) {
      expect(evalLedgerUsageNanos(1, [reservation("a")], [settlement("a", usd)]).actualNanos).toBe(
        nanos,
      );
    }
    expect(
      evalLedgerUsageNanos(
        1,
        [reservation("a"), reservation("b")],
        [settlement("a", 1e-10), settlement("b", 1e-10)],
      ).actualNanos,
    ).toBe(2);
  });

  it("admits exactly at the cap and floors display cents without weakening exact admission", () => {
    const usage = evalLedgerUsageNanos(2, [reservation("a")], [settlement("a", 1e-10)]);
    expect(usage.remainingNanos).toBe(19_999_999);
    expect(usage.remainingCents).toBe(1);
    expect(evalLedgerCanReserve(usage.remainingNanos, 2)).toBe(false);
    expect(evalLedgerCanReserve(usage.remainingNanos, 1)).toBe(true);
    expect(evalLedgerCanReserve(20_000_000, 2)).toBe(true);
  });

  it("preserves actual provider overages while clamping availability instead of forgiving cost", () => {
    expect(evalLedgerUsageNanos(1, [reservation("breach")], [settlement("breach", 0.02)])).toEqual({
      actualNanos: 20_000_000,
      outstandingNanos: 0,
      remainingNanos: 0,
      remainingCents: 0,
    });
    expect(evalLedgerCanReserve(0, 1)).toBe(false);
    expect(
      evalLedgerUsageNanos(1, [reservation("one"), reservation("two")], []).remainingNanos,
    ).toBe(0);
  });

  it("rejects duplicate or orphan records and malformed correlation/ceiling data", () => {
    for (const [reservations, settlements] of [
      [[reservation("a"), reservation("a")], []],
      [[reservation("a")], [settlement("a", 0), settlement("a", 0)]],
      [[reservation("a")], [settlement("orphan", 0)]],
      [[reservation("")], []],
      [[reservation(" a")], []],
      [[reservation("a", 0)], []],
      [[reservation("a", 0.5)], []],
    ] as const)
      expect(() => evalLedgerUsageNanos(200, reservations, settlements)).toThrow(
        "EVAL_LEDGER_INVALID",
      );
    expect(() =>
      evalLedgerUsageNanos(
        200,
        Array.from({ length: 501 }, (_, i) => reservation(`r-${i}`)),
        [],
      ),
    ).toThrow("EVAL_LEDGER_INVALID");
    expect(() =>
      evalLedgerUsageNanos(
        200,
        [],
        Array.from({ length: 501 }, (_, i) => settlement(`r-${i}`, 0)),
      ),
    ).toThrow("EVAL_LEDGER_INVALID");
  });

  it("rejects invalid, overflowing and unsafe amounts rather than manufacturing availability", () => {
    for (const value of [-1, NaN, Infinity, Number.MAX_VALUE]) {
      expect(() => evalLedgerUsageNanos(200, [reservation("a")], [settlement("a", value)])).toThrow(
        "EVAL_LEDGER_INVALID",
      );
    }
    for (const cap of [0, -1, 0.5, 1001, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => evalLedgerUsageNanos(cap, [], [])).toThrow("EVAL_LEDGER_INVALID");
    }
    expect(() =>
      evalLedgerUsageNanos(200, [reservation("a", Number.MAX_SAFE_INTEGER)], []),
    ).toThrow("EVAL_LEDGER_INVALID");
    const nearLimitCents = Math.floor(Number.MAX_SAFE_INTEGER / 10_000_000);
    expect(() =>
      evalLedgerUsageNanos(
        200,
        [reservation("a", nearLimitCents), reservation("b", nearLimitCents)],
        [],
      ),
    ).toThrow("EVAL_LEDGER_INVALID");
    expect(() =>
      evalLedgerUsageNanos(
        200,
        [reservation("a", 460_000_000), reservation("b", 460_000_000)],
        [settlement("a", 4_600_000), settlement("b", 4_600_000)],
      ),
    ).toThrow("EVAL_LEDGER_INVALID");
    for (const [remaining, ceiling] of [
      [-1, 1],
      [0.1, 1],
      [Infinity, 1],
      [0, 0],
      [0, 0.5],
      [0, Number.MAX_SAFE_INTEGER],
    ] as const) {
      expect(() => evalLedgerCanReserve(remaining, ceiling)).toThrow("EVAL_LEDGER_INVALID");
    }
  });
});
