// Phase 28's content-free adapter to the Phase 27 `workflowPackEvents` plane.
//
// This module owns NO table and NO insert. Mutation terminals reuse `recordRevenueEvent`; action
// terminals use `emitRevenueEvent`, which delegates to the same internal recorder. Both paths land
// in `writeWorkflowPackEvent`, the sole insert primitive, so idempotency and privacy validation
// cannot drift between provider and workflow call sites.
//
// Cost and latency are deliberately absent. `spendEvents` and `agentSteps` own those facts and the
// operational projection joins them by the same `runId`.

import { REVENUE_COUNT_MAX, type RevenueEventKind, type RevenueProvider } from "@pikar/core";
import type { Projection } from "@pikar/revenue";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { contentHash } from "./lib/hash";
import { type WorkflowPackEventInput, writeWorkflowPackEvent } from "./workflowPackEventLog";

export { REVENUE_COUNT_MAX };

export type RevenueTelemetryArgs = Omit<WorkflowPackEventInput, "packId" | "event"> & {
  readonly event: RevenueEventKind;
};

/** Use from a Convex mutation terminal that already has database access. */
export async function recordRevenueEvent(ctx: Pick<MutationCtx, "db">, args: RevenueTelemetryArgs) {
  return await writeWorkflowPackEvent(ctx, { ...args, packId: "revenue" });
}

/** Use from a Convex action terminal; the internal mutation applies the identical contract. */
export async function emitRevenueEvent(
  ctx: Pick<ActionCtx, "runMutation">,
  args: RevenueTelemetryArgs,
) {
  return await ctx.runMutation(internal.workflowPackEventLog.record, {
    ...args,
    packId: "revenue",
  });
}

/** Reduce a bounded provider projection to counts and closed labels before it reaches storage. */
export async function emitConnectorReadEvent(
  ctx: Pick<ActionCtx, "runMutation">,
  tenantId: string,
  provider: RevenueProvider,
  projection: Projection<unknown>,
) {
  const available = projection.state === "unavailable" ? undefined : projection;
  return await emitRevenueEvent(ctx, {
    tenantId,
    runId: `rev:read:${provider}:${crypto.randomUUID()}`,
    event: "connector_read",
    provider,
    status: projection.state,
    itemCount: available === undefined ? 0 : Math.min(available.items.length, REVENUE_COUNT_MAX),
    sourceAvailableCount:
      available === undefined ? 0 : Math.min(available.meta.sources.length, REVENUE_COUNT_MAX),
    partial: projection.state === "partial",
  });
}

/** Provider-scoped one-way ref: stable for matching, useless as customer/provider content. */
export async function revenueSubjectRef(
  provider: RevenueProvider,
  kind: "invoice",
  externalRef: string,
): Promise<string> {
  const hex = await contentHash(`${provider}\0${kind}\0${externalRef}`);
  return `rev:${provider}:${kind}:${hex.slice(0, 32)}`;
}

export type RevenueRecoveryObservation = {
  readonly externalRef: string;
  readonly status: "paid" | "resolved";
};

/** Emit only observations that a prior tenant-scoped overdue-reminder event can corroborate. */
export async function emitObservedRecoveryEvents(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  tenantId: string,
  provider: RevenueProvider,
  observedAt: number,
  observations: readonly RevenueRecoveryObservation[],
): Promise<void> {
  const candidates = [];
  const seen = new Set<string>();
  for (const observation of observations.slice(0, REVENUE_COUNT_MAX)) {
    const subjectRef = await revenueSubjectRef(provider, "invoice", observation.externalRef);
    if (seen.has(subjectRef)) continue;
    seen.add(subjectRef);
    candidates.push({ subjectRef, status: observation.status });
  }
  if (candidates.length === 0) return;

  const matched = await ctx.runQuery(internal.plans.matchingStagedRevenueRecoveries, {
    tenantId,
    observedAt,
    candidates,
  });
  for (const observation of matched) {
    await emitRevenueEvent(ctx, {
      tenantId,
      runId: `rev:recovery:${provider}:${observation.subjectRef.split(":").at(-1)}`,
      event: "recovery_observed",
      provider,
      subjectRef: observation.subjectRef,
      status: observation.status,
      observedAt,
    });
  }
}
