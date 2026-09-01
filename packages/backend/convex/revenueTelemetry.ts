// Phase 28's content-free adapter to the Phase 27 `workflowPackEvents` plane.
//
// This module owns NO table and NO insert. Mutation terminals reuse `recordRevenueEvent`; action
// terminals use `emitRevenueEvent`, which delegates to the same internal recorder. Both paths land
// in `writeWorkflowPackEvent`, the sole insert primitive, so idempotency and privacy validation
// cannot drift between provider and workflow call sites.
//
// Cost and latency are deliberately absent. `spendEvents` and `agentSteps` own those facts and the
// operational projection joins them by the same `runId`.

import { REVENUE_COUNT_MAX, type RevenueEventKind } from "@pikar/core";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
  writeWorkflowPackEvent,
  type WorkflowPackEventInput,
} from "./workflowPackEventLog";

export { REVENUE_COUNT_MAX };

export type RevenueTelemetryArgs = Omit<WorkflowPackEventInput, "packId" | "event"> & {
  readonly event: RevenueEventKind;
};

/** Use from a Convex mutation terminal that already has database access. */
export async function recordRevenueEvent(
  ctx: Pick<MutationCtx, "db">,
  args: RevenueTelemetryArgs,
) {
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
