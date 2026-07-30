"use client";

import type { BlueprintDiffRow } from "@pikar/core";
import { label } from "./page";

/**
 * Task 1's buildable draft-state seam. Task 2 replaces this summary with the D5 confirmation
 * controls after its source-contract test has first been committed RED.
 */
export function BlueprintDiff({ diff }: { diff: readonly BlueprintDiffRow[] }) {
  const additions = diff.filter((row) => row.kind === "addition").length;
  const contradictions = diff.filter((row) => row.kind === "contradiction").length;

  return (
    <section style={{ display: "grid", gap: "0.5rem" }}>
      <span style={label}>Draft review</span>
      <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
        Review {additions} additions and {contradictions} contradictions before confirming this
        blueprint.
      </p>
    </section>
  );
}
