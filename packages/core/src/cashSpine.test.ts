import { expect, test } from "vitest";
import { CASH_INPUTS, type CashInputState } from "./cash";
import { FINANCE_SPINE_BUDGET, financeSpineLine } from "./cashSpine";

const NOW = 1_754_000_000_000;
const DAY = 86_400_000;

const state = (over: Partial<CashInputState> & { field: CashInputState["field"] }): CashInputState => ({
  value: null,
  statedAt: null,
  stale: false,
  origin: "stated",
  actor: "user",
  basis: null,
  ...over,
});

test("no collected inputs produces no line — an empty spine line is worse than none", () => {
  expect(financeSpineLine(CASH_INPUTS.map((s) => state({ field: s.field })), NOW)).toBeNull();
});

test("a collected figure renders with its age in days", () => {
  const line = financeSpineLine(
    [state({ field: "cashOnHand", value: 38_500, statedAt: NOW - 38 * DAY })],
    NOW,
  );
  expect(line).toContain("cashOnHand 38500(38d)");
});

test("a stale figure is marked so the agent can act on it", () => {
  const line = financeSpineLine(
    [state({ field: "cac", value: 1400, statedAt: NOW - 94 * DAY, stale: true })],
    NOW,
  );
  expect(line).toContain("STALE");
});

test("an unstamped figure reports unknown age rather than fabricating one", () => {
  const line = financeSpineLine([state({ field: "cac", value: 1400, statedAt: null })], NOW);
  expect(line).toContain("cac 1400(?d)");
});

// WHOLE-BRANCH RE-REVIEW. The line went live in the turn prompt (C1) carrying no provenance at all,
// while the skill body called every figure in it "the user's own" — the central invariant of this
// feature, breached at the MODEL surface exactly as C2 had breached it at the page surface. The
// blueprint spine in the same prompt marks every fact `[stated]` or `[source: X]` for this reason
// (`blueprint.ts`'s SPINE_INTRO); this is the same move, one token wide.
test("a figure the AGENT recorded is marked, so the model never calls it the user's own", () => {
  const line = financeSpineLine(
    [
      state({ field: "cashOnHand", value: 38_500, statedAt: NOW - 2 * DAY }),
      state({ field: "mrr", value: 9000, statedAt: NOW - 2 * DAY, actor: "agent" }),
    ],
    NOW,
  );
  expect(line).toContain("mrr 9000(2d PIKAR)");
  // The owner's own figure is UNMARKED — the marker means "not theirs", so marking everything
  // would say nothing.
  expect(line).toContain("cashOnHand 38500(2d)");
});

test("a stale AGENT figure carries both markers", () => {
  const line = financeSpineLine(
    [state({ field: "cac", value: 1400, statedAt: NOW - 94 * DAY, stale: true, actor: "agent" })],
    NOW,
  );
  expect(line).toContain("cac 1400(94d STALE PIKAR)");
});

test("the WORST case fits the budget — every input collected, longest values, all stale, all marked", () => {
  const worst = CASH_INPUTS.map((s) =>
    state({
      field: s.field,
      value: 999_999_999,
      statedAt: NOW - 9999 * DAY,
      stale: true,
      // The TRUE worst case since the marker landed: every field also agent-written. Measuring
      // without this is what would let the budget drift under a full grounded fill.
      actor: "agent",
    }),
  );
  const line = financeSpineLine(worst, NOW);
  expect(line).not.toBeNull();
  expect((line as string).length).toBeLessThanOrEqual(FINANCE_SPINE_BUDGET);
  // The length check alone is tautological — the function's own truncation branch guarantees it
  // for ANY budget value. This is the assertion that actually proves 437 is enough: the worst
  // case must survive whole, not merely end up short because it got cut off with "…". If a
  // twelfth `CASH_INPUTS` field is ever added without re-measuring `FINANCE_SPINE_BUDGET`, this
  // is what turns red instead of silently dropping trailing fields.
  expect(line).not.toContain("…");
});
