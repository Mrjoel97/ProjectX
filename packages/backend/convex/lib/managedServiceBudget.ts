import { MANAGED_SERVICE_RUN_LIFETIME_MS } from "@pikar/core/managedServices";
import {
  EVAL_MAX_BUDGET_CENTS,
  evalLedgerCanReserve,
  evalLedgerUsageNanos,
} from "@pikar/cost/evalBudget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  MANAGED_SERVICE_RECURRENCE_ENABLED,
  settleStandingOccurrence,
} from "../managedServiceRecurrence";
import { managedServiceReadiness } from "../managedServices";
import { serviceKnowledgeFor } from "../serviceConversations";

/** A standing envelope is authoritative only through this exact bidirectional native binding. */
export async function standingServiceBinding(
  ctx: QueryCtx,
  run: Doc<"managedServiceRuns">,
  admission = false,
) {
  if (!run.standingOccurrenceId && !run.standingApprovalId) return null;
  if (admission && !MANAGED_SERVICE_RECURRENCE_ENABLED)
    throw new Error("SERVICE_STANDING_ADMISSION_DEFERRED");
  if (!run.standingOccurrenceId || !run.standingApprovalId)
    throw new Error("SERVICE_STANDING_BINDING_INVALID");
  const occurrence = await ctx.db.get(run.standingOccurrenceId);
  const approval = await ctx.db.get(run.standingApprovalId);
  const reservation = occurrence?.reservationId ? await ctx.db.get(occurrence.reservationId) : null;
  if (
    !occurrence ||
    !approval ||
    !reservation ||
    occurrence.tenantId !== run.tenantId ||
    approval.tenantId !== run.tenantId ||
    reservation.tenantId !== run.tenantId ||
    occurrence.runId !== run._id ||
    occurrence.serviceId !== run.serviceId ||
    approval.serviceId !== run.serviceId ||
    occurrence.approvalId !== approval._id ||
    occurrence.approvalRevision !== approval.revision ||
    occurrence.configRevision !== run.configRevision ||
    approval.configRevision !== run.configRevision ||
    occurrence.controlRevision !== run.controlRevision ||
    reservation.kind !== "standing_service" ||
    reservation.phase !== "reserved" ||
    reservation.rail !== "reasoning" ||
    reservation.amountCents !== run.budgetLimitCents ||
    reservation.correlationId !== `standing:${occurrence.occurrenceKey}` ||
    approval.terms.budgetLimitCents !== run.budgetLimitCents
  )
    throw new Error("SERVICE_STANDING_BINDING_INVALID");
  if (
    admission &&
    (occurrence.state !== "claimed" ||
      occurrence.terminalOutcome !== undefined ||
      approval.enabled !== true ||
      approval.suspendedAtMs !== undefined ||
      approval.expiresAtMs <= Date.now() ||
      approval.controlRevision !== run.controlRevision)
  )
    throw new Error("SERVICE_STANDING_AUTHORIZATION_REQUIRED");
  return { occurrence, approval, reservation };
}

/** Reuses append-only provider accounting, with no second spend store or evaluation envelope. */
export async function managedServiceSpend(
  ctx: QueryCtx,
  tenantId: string,
  runId: Id<"managedServiceRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.tenantId !== tenantId) throw new Error("SERVICE_RUN_UNAVAILABLE");
  const standing = await standingServiceBinding(ctx, run);
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
        row.kind !== (standing ? "paid_call_standing" : "paid_call") ||
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
  if (service.operationIds.includes("social.prepare")) {
    const knowledge = await serviceKnowledgeFor(ctx, service);
    if (
      !knowledge.assessment.ready ||
      !run.knowledgeHash ||
      run.knowledgeHash !== knowledge.sourceHash
    )
      throw new Error("SERVICE_KNOWLEDGE_CHANGED");
  }
  await standingServiceBinding(ctx, run, true);
  const spend = await managedServiceSpend(ctx, tenantId, runId);
  if (spend.breached) throw new Error("SERVICE_BUDGET_BREACHED");
  if (spend.outstandingNanos > 0) throw new Error("SERVICE_BUDGET_UNRESOLVED");
  if (spend.reservationCount >= 500 || !evalLedgerCanReserve(spend.remainingNanos, ceilingCents))
    throw new Error("SERVICE_BUDGET_EXHAUSTED");
}

/** Whole-run enforcement settles from trusted per-call receipts, never caller-provided costs.
 * Child paid_call_standing rows are accounting detail; only the standing envelope moves rails. */
export async function reconcileStandingServiceAccounting(
  ctx: MutationCtx,
  tenantId: string,
  runId: Id<"managedServiceRuns">,
  effectsKnown?: boolean,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.tenantId !== tenantId) throw new Error("SERVICE_RUN_UNAVAILABLE");
  const binding = await standingServiceBinding(ctx, run);
  if (!binding || run.state === "running" || run.state === "claimed") return;
  const spend = await managedServiceSpend(ctx, tenantId, runId);
  const outcome =
    binding.occurrence.terminalOutcome ??
    (run.state === "completed"
      ? "completed"
      : run.state === "stopped"
        ? "paused"
        : run.state === "failed"
          ? "validation"
          : "execution_uncertain");
  await settleStandingOccurrence(ctx, {
    tenantId,
    occurrenceId: binding.occurrence._id,
    knownSpentCents: Math.ceil(spend.actualNanos / 10_000_000),
    unknownHoldCents: Math.ceil(spend.outstandingNanos / 10_000_000),
    outcome,
    effectsKnown:
      effectsKnown ??
      (binding.occurrence.state === "terminal" ||
        run.state === "completed" ||
        run.state === "failed"),
  });
}
