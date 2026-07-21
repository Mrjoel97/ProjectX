/**
 * IMPR-02 trigger policy — the PURE breach classifier the optimizer eligibility check consults.
 *
 * The loop is eligible to fire ONLY when a skill's rolling negative-rate crosses a threshold
 * over a MINIMUM SAMPLE FLOOR (so one/few bad ratings can't trigger it) AND a cooldown has
 * elapsed (so it can't re-fire immediately). Order of checks: sample floor → threshold →
 * cooldown → eligible. All boundaries INCLUSIVE.
 *
 * Pure — no Convex, no Date.now (nowMs is a param, the emailIntent.ts classify(epochMs, nowMs)
 * precedent). The Convex query (optimizerEligibility.ts) only gathers the counts and calls this,
 * so the threshold math lives in exactly one unit-testable place (CLAUDE.md §1/§8).
 */

export interface BreachConfig {
  readonly negativeRateThreshold: number;
  readonly minSampleFloor: number;
  readonly cooldownMs: number;
}

export interface BreachInput {
  readonly downCount: number;
  readonly total: number;
  /** When the optimizer last ran (the cooldown anchor); undefined = never run. */
  readonly lastRunAt?: number;
  readonly nowMs: number;
  readonly cfg: BreachConfig;
}

export type BreachReason =
  | "below_sample_floor"
  | "below_threshold"
  | "cooldown"
  | "eligible";

export interface BreachResult {
  readonly eligible: boolean;
  readonly reason: BreachReason;
  readonly negativeRate: number;
}

export function classifyBreach(input: BreachInput): BreachResult {
  const { downCount, total, lastRunAt, nowMs, cfg } = input;

  // Sample floor FIRST — below it there isn't enough signal, and this also guards the
  // divide-by-zero on total === 0. A high rate over a tiny sample can never win here.
  if (total < cfg.minSampleFloor) {
    return { eligible: false, reason: "below_sample_floor", negativeRate: 0 };
  }

  const negativeRate = downCount / total;
  if (negativeRate < cfg.negativeRateThreshold) {
    return { eligible: false, reason: "below_threshold", negativeRate };
  }

  // Cooldown: strictly-less-than the window is too soon; exactly elapsed is eligible (inclusive).
  if (lastRunAt !== undefined && nowMs - lastRunAt < cfg.cooldownMs) {
    return { eligible: false, reason: "cooldown", negativeRate };
  }

  return { eligible: true, reason: "eligible", negativeRate };
}
