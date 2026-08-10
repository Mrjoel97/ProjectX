import { expect, test } from "vitest";
import { type FigureClaim, isNewerThan, validateFigureClaim } from "./financeClaim";

const claim = (over: Partial<FigureClaim> = {}): FigureClaim => ({
  field: "cac",
  value: 1400,
  origin: "stated",
  actor: "agent",
  basis: "user statement, turn 4",
  observedAt: 1_754_000_000_000,
  confidence: "high",
  ...over,
});

test("a well-formed claim passes", () => {
  expect(validateFigureClaim(claim())).toEqual({ ok: true });
});

test("the underlying cash validation still governs the value", () => {
  const bad = validateFigureClaim(claim({ value: -5 }));
  expect(bad.ok).toBe(false);
});

test("a non-finite value is refused before it can reach a store", () => {
  expect(validateFigureClaim(claim({ value: Number.NaN })).ok).toBe(false);
});

test("an empty basis is refused — an unattributable figure is not a claim", () => {
  const r = validateFigureClaim(claim({ basis: "   " }));
  expect(r).toEqual({ ok: false, reason: "A claim must carry a basis." });
});

test("a user claim is always high confidence — confidence grades extraction, not truth", () => {
  const r = validateFigureClaim(claim({ actor: "user", confidence: "low" }));
  expect(r).toEqual({ ok: false, reason: "A user-entered figure is always high confidence." });
});

test("observedAt in the future is refused — a figure cannot be true before it exists", () => {
  const r = validateFigureClaim(claim({ observedAt: 4_000_000_000_000 }), 1_754_000_000_000);
  expect(r).toEqual({ ok: false, reason: "A figure cannot be observed in the future." });
});

test("a NaN observedAt is refused — it would freeze isNewerThan and staleness forever", () => {
  const r = validateFigureClaim(claim({ observedAt: Number.NaN }));
  expect(r).toEqual({ ok: false, reason: "A figure must have a valid observed date." });
});

test("an infinite observedAt is refused", () => {
  const r = validateFigureClaim(claim({ observedAt: Number.POSITIVE_INFINITY }));
  expect(r).toEqual({ ok: false, reason: "A figure must have a valid observed date." });
});

test("a negative observedAt (before the epoch) is refused", () => {
  const r = validateFigureClaim(claim({ observedAt: -1 }));
  expect(r).toEqual({ ok: false, reason: "A figure must have a valid observed date." });
});

test("isNewerThan is true when nothing is stored", () => {
  expect(isNewerThan(claim(), null)).toBe(true);
});

test("isNewerThan refuses a claim no newer than what is stored", () => {
  expect(isNewerThan(claim({ observedAt: 100 }), 100)).toBe(false);
  expect(isNewerThan(claim({ observedAt: 99 }), 100)).toBe(false);
  expect(isNewerThan(claim({ observedAt: 101 }), 100)).toBe(true);
});
