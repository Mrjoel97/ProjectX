/** Phase 30 preparation inventory. These inputs are not an executable outcome suite. */
export const VERTICAL_EVAL_SUITE = {
  revision: "2026-09-10.phase30.preparation",
  executable: false,
  names: [
    "vertical-data",
    "vertical-product",
    "vertical-design",
    "vertical-legal",
    "vertical-hr",
    "vertical-engineering",
  ],
} as const;

/**
 * Deliberate release lock until the native harness can prove source-backed outcomes and reserve
 * the complete evaluation budget. Fixture metadata, mock runs, and pilot evidence cannot certify
 * a vertical candidate. Replacing this lock requires an executable, versioned suite and tests;
 * adding JSON claiming a passing run must never unlock it.
 */
export function hasPassingVerticalEvalEvidence(
  _evidence: string | undefined,
  _name: string,
  _version: number,
): boolean {
  return false;
}
