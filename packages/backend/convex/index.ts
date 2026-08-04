import { ActionRetrier } from "@convex-dev/action-retrier";
import { WorkflowManager } from "@convex-dev/workflow";
import { Workpool } from "@convex-dev/workpool";
import { VAULT_INGEST_PARALLELISM } from "@pikar/vault";
import { components } from "./_generated/api";

// Durable workflow orchestrator with default action-retry behavior (exp backoff).
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 100, base: 2 },
    retryActionsByDefault: true,
  },
});

// Reliable wrapper around external (sidecar/LLM/email) fetch calls.
export const retrier = new ActionRetrier(components.actionRetrier);

/**
 * THE vault-extraction pool (15.3-04, VALT-06). Every `vault.scheduleExtraction` enqueue lands
 * here instead of on the raw scheduler, so the app — not the deployment's scheduled-job
 * concurrency class — decides how wide a folder ingest may run.
 *
 * DO NOT "fix" the starvation by raising the WorkflowManager above instead. That manager is
 * shared by EVERY workflow in the app (`executePlan`, `deliverApprovedPlan`, `pipelineWorkflow`,
 * `ingestDoc`), so widening it widens the delivery spine too. Note what it actually runs at:
 * `@convex-dev/workflow@0.4.4` declares its OWN `DEFAULT_MAX_PARALLELISM = 25`
 * (`src/component/pool.ts:36`) and resolves `opts ?? config ?? 25` — workpool's default of 10 is
 * never reached, and the `?? 10` in `workflowMutation.ts` is the per-EXECUTION step channel, not a
 * cross-workflow cap. Platform guidance: keep total parallelism across all pools and workflows
 * under ~100.
 *
 * `maxParallelism` is EXPLICIT on purpose. `WorkpoolOptions.maxParallelism` is optional and
 * defaults to 10 — silently above the smallest deployment class, which would defeat the point.
 *
 * `retryActionsByDefault` is deliberately left at its `false` default (the WorkflowManager above
 * sets it true for workflow steps; this pool must NOT copy that). `extractDoc` charges OCR pages
 * via `recordSpend` before it reaches the ingest seam, so it is not idempotent with respect to
 * spend, and a silent retry would double-charge a reservation. Its own try/catch already turns
 * every in-handler throw into a terminal `markFailed`.
 *
 * A folder-level WORKFLOW was rejected: the journal caps at 8 MiB, steps pass ≤1 MB total, and 400
 * sequential `step.runAction` calls serialise the folder behind the shared pool with determinism
 * risk on redeploy. One workflow per document; the folder is a row + counters.
 */
export const vaultIngestPool = new Workpool(components.vaultIngestPool, {
  maxParallelism: VAULT_INGEST_PARALLELISM,
});
