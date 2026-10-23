import { MANAGED_SERVICE_RUN_LIFETIME_MS } from "@pikar/core/managedServices";
import {
  EVAL_MAX_BUDGET_CENTS,
  evalLedgerCanReserve,
  evalLedgerUsageNanos,
} from "@pikar/cost/evalBudget";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { managedServiceReadiness } from "../managedServices";

/** Reuses append-only provider accounting, with no second spend store or evaluation envelope. */
export async function managedServiceSpend(
  ctx: QueryCtx,
  tenantId: string,
  runId: Id<"managedServiceRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.tenantId !== tenantId) throw new Error("SERVICE_RUN_UNAVAILABLE");
  if (
    !Number.isSafeInteger(run.budgetLimitCents) ||
    run.budgetLimitCents < 1 ||
    run.budgetLimitCents > EVAL_MAX_BUDGET_CENTS
  )
    throw new Error("SERVICE_BUDGET_INVALID");
  // At most500 reservations +500 actual +500 refund records. Refuse a truncated bill.
  const rows = await ctx.db
    .query("spendEvents")
    .withIndex("by_managed_service_run", (q) =>
      q.eq("tenantId", tenantId).eq("managedServiceRunId", runId),
    )
    .take(1501);
  if (
    rows.length > 1500 ||
    rows.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.kind !== "paid_call" ||
        !["reserved", "actual", "refunded"].includes(row.phase),
    )
  )
    throw new Error("SERVICE_BUDGET_INVALID");
  const reservations = rows.filter((row) => row.phase === "reserved");
  const settlements = rows.filter(
    (row) => row.phase === "actual" || (row.phase === "refunded" && row.evalActualUsd === 0),
  );
  const usage = evalLedgerUsageNanos(
    run.budgetLimitCents,
    reservations,
    settlements.map((row) => ({
      correlationId: row.correlationId,
      evalActualUsd: row.evalActualUsd ?? Number.NaN,
    })),
  );
  return {
    ...usage,
    reservationCount: reservations.length,
    settledCount: settlements.length,
    breached:
      rows.some((row) => row.evalBreach === true) ||
      usage.actualNanos > run.budgetLimitCents * 10_000_000,
  };
}

/** Same transaction as the native provider reservation: stop/edit/account changes win races. */
export async function assertManagedServicePaidAdmission(
  ctx: MutationCtx,
  tenantId: string,
  runId: Id<"managedServiceRuns">,
  ceilingCents: number,
) {
  const run = await ctx.db.get(runId);
  if (
    run &&
    (!Number.isSafeInteger(run.createdAt) ||
      run.createdAt > Date.now() ||
      Date.now() - run.createdAt >= MANAGED_SERVICE_RUN_LIFETIME_MS)
  )
    throw new Error("SERVICE_RUN_EXPIRED");
  if (
    !run ||
    run.tenantId !== tenantId ||
    run.state !== "running" ||
    !run.threadId ||
    !run.planId ||
    !run.turnId
  )
    throw new Error("SERVICE_RUN_UNAVAILABLE");
  const service = await ctx.db.get(run.serviceId);
  const plan = await ctx.db.get(run.planId);
  if (
    !service ||
    service.tenantId !== tenantId ||
    service.controlState !== "active" ||
    service.revision !== run.configRevision ||
    service.controlRevision !== run.controlRevision ||
    service.budgetLimitCents !== run.budgetLimitCents ||
    !plan ||
    plan.tenantId !== tenantId ||
    plan.threadId !== run.threadId ||
    plan.parentPlanId !== undefined ||
    !["collecting", "proposed"].includes(plan.status)
  )
    throw new Error("SERVICE_RUN_FENCED");
  if (!(await managedServiceReadiness(ctx, service)).ready) throw new Error("SERVICE_NOT_READY");
  const spend = await managedServiceSpend(ctx, tenantId, runId);
  if (spend.breached) throw new Error("SERVICE_BUDGET_BREACHED");
  if (spend.outstandingNanos > 0) throw new Error("SERVICE_BUDGET_UNRESOLVED");
  if (spend.reservationCount >= 500 || !evalLedgerCanReserve(spend.remainingNanos, ceilingCents))
    throw new Error("SERVICE_BUDGET_EXHAUSTED");
}
