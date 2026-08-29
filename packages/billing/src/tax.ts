// RED stub — 28.1-03 Task 1. Replaced by the real implementation in the GREEN commit.
export const TAXABILITY_REASONS = [] as const;
export type TaxPosture = { state: "unknown"; reason: string };
export function taxPosture(_r: unknown, _c: unknown, _m: number): TaxPosture {
  return { state: "unknown", reason: "not-implemented" };
}
export function renderTaxPosture(_p: TaxPosture, _currency: string): string {
  return "0.00";
}
