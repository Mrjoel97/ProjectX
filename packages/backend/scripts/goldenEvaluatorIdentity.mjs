import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reuse the existing server-enforced suite revision to retire evidence when evaluator
// execution changes. Exclude the contracts constant and generated manifests to avoid cycles.
export const EVALUATOR_FILES = [
  "pnpm-lock.yaml",
  "packages/backend/scripts/goldenEvaluatorIdentity.mjs",
  "packages/backend/scripts/goldenPaidAttempt.mjs",
  "packages/backend/scripts/run-eval-golden.mjs",
  "packages/backend/scripts/smokeRun.mjs",
  "packages/backend/convex/smoke.ts",
  "packages/backend/convex/smokeAssert.ts",
  "packages/backend/convex/llm.ts",
  "packages/backend/convex/guardrails.ts",
  "packages/backend/convex/spendLedger.ts",
  "packages/backend/convex/lib/evalBudgetModel.ts",
  "packages/backend/convex/lib/models.ts",
  "packages/backend/convex/lib/toolContextArgs.ts",
  "packages/backend/convex/lib/functions.ts",
  "packages/backend/convex/agentSteps.ts",
  "packages/backend/convex/dispatch.ts",
  "packages/backend/convex/dispatchRun.ts",
  "packages/backend/convex/evaluations.ts",
  "packages/backend/convex/research.ts",
  "packages/backend/convex/schema.ts",
  "packages/backend/convex/skills.ts",
  "packages/backend/convex/vaultIngest.ts",
  "packages/backend/convex/vaultLlm.ts",
  "packages/backend/convex/vaultRag.ts",
  "packages/backend/convex/vaultGround.ts",
  "packages/backend/convex/vaultSmoke.ts",
  "packages/cost/src/evalBudget.ts",
  "packages/core/src/researchEvidence.ts",
  "packages/core/src/documentGen.ts",
  "packages/core/src/specialists.ts",
  "packages/cost/src/goldenProviderBudget.ts",
].sort();

export function computeEvaluatorRevision(
  root = fileURLToPath(new URL("../../../", import.meta.url)),
) {
  const rows = EVALUATOR_FILES.map((path) => {
    const bytes = readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
    return `${path}:${createHash("sha256").update(bytes).digest("hex")}`;
  });
  return `2026-09-11.budgeted-evaluator.${createHash("sha256").update(rows.join("\n")).digest("hex")}`;
}
