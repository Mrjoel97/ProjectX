// The always-on finance line. The spine is assembled on EVERY turn, so this is paid for in
// conversations about nothing financial — it carries STATE (what is known, missing, stale) and
// never analysis. Derived metrics cost a `readFinance` call, on the turns that need them.
import type { CashInputState } from "./cash";

/**
 * The MEASURED worst case: every `CASH_INPUTS` field collected, at its longest renderable value
 * (`999999999`) and age (`9999d`), all stale. Not a round number picked in advance — it is what
 * the worst-case test in `cashSpine.test.ts` actually computes, with a `.not.toContain("…")`
 * assertion pinning that the line at this budget is never truncated. Add a member to
 * `CASH_INPUTS` and this MUST be re-measured (re-run the worst-case test, read the new length,
 * update this constant) — the truncation branch below silently drops trailing fields otherwise,
 * which is the exact failure this constant exists to prevent.
 */
export const FINANCE_SPINE_BUDGET = 437;

const DAY_MS = 86_400_000;

const age = (statedAt: number | null, nowMs: number): string =>
  statedAt === null ? "?d" : `${Math.floor((nowMs - statedAt) / DAY_MS)}d`;

/**
 * `null` when the tenant has collected nothing — a line reading "Finance: all unknown" spends
 * budget on every turn to say the agent knows nothing, which the absence of the line says for free.
 */
export function financeSpineLine(
  inputs: readonly CashInputState[],
  nowMs: number,
): string | null {
  const known = inputs.filter((i) => i.value !== null);
  if (known.length === 0) return null;
  const parts = known.map(
    (i) => `${i.field} ${i.value}(${age(i.statedAt, nowMs)}${i.stale ? " STALE" : ""})`,
  );
  const missing = inputs.filter((i) => i.value === null).map((i) => `${i.field} ?`);
  const line = `Finance: ${[...parts, ...missing].join(" · ")}`;
  return line.length <= FINANCE_SPINE_BUDGET ? line : `${line.slice(0, FINANCE_SPINE_BUDGET - 1)}…`;
}
