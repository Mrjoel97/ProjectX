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
  "packages/backend/convex/managedServices.ts",
  "packages/backend/convex/managedServiceRuns.ts",
  "packages/backend/convex/managedServiceExecution.ts",
  "packages/backend/convex/managedServiceTools.ts",
  "packages/backend/convex/lib/managedServiceBudget.ts",
  "packages/core/src/managedServices.ts",
  "packages/core/src/managedServicePolicy.ts",
  "packages/core/src/serviceOutcomes.ts",
  "packages/core/src/socialServiceOutcome.ts",
  "packages/backend/convex/serviceOutcomes.ts",
  "packages/backend/convex/blueprint.ts",
  "packages/core/src/blueprint.ts",
  "packages/backend/convex/managedServiceRecurrence.ts",
  "packages/backend/convex/buffer.ts",
  "packages/backend/convex/bufferActions.ts",
  "packages/backend/convex/bufferTools.ts",
  "packages/backend/convex/lib/bufferMcp.ts",
  "packages/core/src/buffer.ts",
  "packages/backend/convex/zernio.ts",
  "packages/backend/convex/zernioActions.ts",
  "packages/core/src/zernio.ts",
  "packages/core/src/zernioPilot.ts",
  "packages/revenue/src/credential.ts",
  "packages/backend/convex/lib/webResearchTools.ts",
  "packages/backend/convex/lib/markdownPdf.ts",
  "packages/backend/convex/lib/mediaRead.ts",
  "packages/backend/convex/guardrails.ts",
  "packages/backend/convex/authoringProbe.ts",
  "packages/backend/convex/audit.ts",
  "packages/backend/convex/cockpit.ts",
  "packages/backend/convex/cockpitCapabilities.ts",
  "packages/backend/convex/intake.ts",
  "packages/backend/convex/index.ts",
  "packages/backend/convex/spendLedger.ts",
  "packages/backend/convex/lib/evalBudgetModel.ts",
  "packages/backend/convex/lib/paidBudgetModel.ts",
  "packages/backend/convex/authRevocations.ts",
  "packages/backend/convex/lib/tenantLifecycle.ts",
  "packages/backend/convex/uploads.ts",
  "packages/core/src/authLifetime.ts",
  "packages/backend/convex/lib/models.ts",
  "packages/backend/convex/lib/toolContextArgs.ts",
  "packages/backend/convex/lib/functions.ts",
  "packages/backend/convex/agentSteps.ts",
  "packages/backend/convex/dispatch.ts",
  "packages/backend/convex/dispatchRun.ts",
  "packages/backend/convex/evaluations.ts",
  "packages/backend/convex/plans.ts",
  "packages/backend/convex/research.ts",
  "packages/backend/convex/researchControl.ts",
  "packages/backend/convex/researchDeliverable.ts",
  "packages/backend/convex/lib/dispatchShared.ts",
  "packages/backend/convex/schema.ts",
  "packages/backend/convex/skills.ts",
  "packages/backend/convex/vault.ts",
  "packages/backend/convex/vaultIngest.ts",
  "packages/backend/convex/vaultLlm.ts",
  "packages/backend/convex/vaultRag.ts",
  "packages/backend/convex/vaultGround.ts",
  "packages/backend/convex/vaultSmoke.ts",
  "packages/cost/src/evalBudget.ts",
  "packages/core/src/researchEvidence.ts",
  "packages/core/src/researchControl.ts",
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
