// The always-on finance line. The spine is assembled on EVERY turn, so this is paid for in
// conversations about nothing financial — it carries STATE (what is known, missing, stale) and
// never analysis. Derived metrics cost a `readFinance` call, on the turns that need them.
import type { CashInputState } from "./cash";

/** Hard ceiling, proven by the worst-case test. Sits inside the existing spine budget the goals
 *  line already shares. */
export const FINANCE_SPINE_BUDGET = 320;

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
