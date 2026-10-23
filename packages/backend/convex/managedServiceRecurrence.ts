import { calculateRateLimit } from "@convex-dev/rate-limiter";
import {
  classifyStandingOccurrence,
  reconcileStandingRunBudget,
  reserveStandingRunBudget,
  type StandingOccurrence,
  type StandingRunBudget,
  type StandingTerminalOutcome,
  settleStandingRunBudget,
  standingOccurrenceKey,
} from "@pikar/core/managedServicePolicy";
import { clampRefundCents } from "@pikar/vault";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getGuardrailConfig, rateLimiter } from "./guardrails";
import { contentHash } from "./lib/hash";
import { internalMutation } from "./lib/tenantLifecycle";
import { managedServiceReadiness } from "./managedServices";
import { recordMovement } from "./spendLedger";

// Development-only construction exception: no scheduler, worker, public action or enabled admission.
// The explicit capability below belongs to plain transaction fixtures, never native function args.
export const MANAGED_SERVICE_RECURRENCE_ENABLED = false;
export type RecurrenceCapability = Readonly<{ admitted: boolean }>;
type ClaimArgs = {
  tenantId: string;
  approvalId: Id<"managedServiceStandingApprovals">;
  expectedControlRevision: number;
  localDate: string;
  requestedLocalTime: string;
  timeZone: string;
  dueAtMs: number;
};
const unavailable = (): never => {
  throw new Error("STANDING_SERVICE_UNAVAILABLE");
};

/** Atomic persistence seam. Future-capability fixtures exercise it without enabling a callable route. */
export async function claimStandingOccurrence(
  ctx: MutationCtx,
  args: ClaimArgs,
  capability: RecurrenceCapability,
) {
  if (!capability.admitted) return { decision: "admission_deferred" as const, occurrenceId: null };
  const approval = await ctx.db.get(args.approvalId);
  if (!approval || approval.tenantId !== args.tenantId) return unavailable();
  const service = await ctx.db.get(approval.serviceId);
  if (!service || service.tenantId !== args.tenantId) return unavailable();
  const occurrence: StandingOccurrence = {
    tenantId: args.tenantId,
    serviceId: service._id,
    approvalRevision: approval.revision,
    localDate: args.localDate,
    requestedLocalTime: args.requestedLocalTime,
    timeZone: args.timeZone,
    dueAtMs: args.dueAtMs,
  };
  const rawKey = standingOccurrenceKey(occurrence);
  const occurrenceKey = await contentHash(rawKey);
  const previous = await ctx.db
    .query("managedServiceOccurrences")
    .withIndex("by_occurrence", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("serviceId", service._id)
        .eq("occurrenceKey", occurrenceKey),
    )
    .unique();
  if (previous) return { decision: "duplicate" as const, occurrenceId: previous._id };
  if (approval.suspendedAtMs !== undefined)
    return { decision: "authorization_required" as const, occurrenceId: null };
  if (
    approval.configRevision !== service.revision ||
    approval.terms.recipientRefs.length !== 0 ||
    service.skills.length !== 1 ||
    service.skills[0]?.name !== "cockpit-agent" ||
    service.skills[0]?.tenantId !== null ||
    !service.operationIds.every((op) => op === "social.prepare" || op === "social.report")
  )
    return { decision: "approval_stale" as const, occurrenceId: null };
  const readiness = await managedServiceReadiness(ctx, service);
  const exactSkills =
    readiness.skills.length === service.skills.length &&
    readiness.skills.every(
      (pin, index) =>
        pin.qualified &&
        pin.skillId === service.skills[index]?.skillId &&
        pin.name === service.skills[index]?.name &&
        pin.version === service.skills[index]?.version &&
        pin.bodyHash === service.skills[index]?.bodyHash,
    );
  if (!exactSkills) return { decision: "approval_stale" as const, occurrenceId: null };
  const authorization = readiness.accounts.every(
    (pin, index) =>
      pin.connected && pin.connectionRevision === service.accounts[index]?.connectionRevision,
  )
    ? "valid"
    : "expired";
  const pending = [];
  for (const state of ["claimed", "unknown"] as const) {
    const row = await ctx.db
      .query("managedServiceOccurrences")
      .withIndex("by_service_state", (q) =>
        q.eq("tenantId", args.tenantId).eq("serviceId", service._id).eq("state", state),
      )
      .first();
    if (row) pending.push(row.state);
  }
  for (const state of ["claimed", "running", "unknown"] as const) {
    const row = await ctx.db
      .query("managedServiceRuns")
      .withIndex("by_service_state", (q) =>
        q.eq("tenantId", args.tenantId).eq("serviceId", service._id).eq("state", state),
      )
      .first();
    if (row) pending.push(row.state);
  }
  const decision = classifyStandingOccurrence({
    admitted: capability.admitted,
    occurrence,
    nowMs: Date.now(),
    currentTerms: {
      goalHash: await contentHash(service.goal),
      operationIds: service.operationIds,
      skillPins: service.skills,
      recipientRefs: [],
      accountPins: service.accounts,
      budgetLimitCents: service.budgetLimitCents,
      schedule: approval.terms.schedule,
    },
    approval: {
      tenantId: approval.tenantId,
      serviceId: approval.serviceId,
      revision: approval.revision,
      terms: approval.terms,
      expiresAtMs: approval.expiresAtMs,
    },
    control: { state: service.controlState, revision: service.controlRevision },
    expectedControlRevision: args.expectedControlRevision,
    authorization,
    previousOccurrenceKeys: [],
    activeRun: pending.includes("unknown") ? "unknown" : pending.length ? "running" : "none",
  });
  if (decision === "authorization_required")
    await ctx.db.patch(approval._id, {
      suspendedAtMs: Date.now(),
      suspensionReason: "authorization_required",
    });
  if (!["claimable", "skipped_missed", "skipped_overlap"].includes(decision))
    return { decision, occurrenceId: null };
  const now = Date.now();
  const occurrenceId = await ctx.db.insert("managedServiceOccurrences", {
    tenantId: args.tenantId,
    serviceId: service._id,
    approvalId: approval._id,
    approvalRevision: approval.revision,
    occurrenceKey,
    localDate: args.localDate,
    requestedLocalTime: args.requestedLocalTime,
    timeZone: args.timeZone,
    dueAtMs: args.dueAtMs,
    configRevision: service.revision,
    controlRevision: service.controlRevision,
    state:
      decision === "claimable"
        ? "claimed"
        : decision === "skipped_missed"
          ? "skipped_missed"
          : "skipped_overlap",
    receiptIds: [],
    createdAt: now,
    updatedAt: now,
  });
  if (decision === "claimable") {
    if ((await getGuardrailConfig(ctx)).killSwitch) throw new Error("STANDING_SERVICE_KILL_SWITCH");
    const cap = service.budgetLimitCents;
    reserveStandingRunBudget({
      reservationKey: occurrenceKey,
      runRef: occurrenceId,
      capCents: cap,
      availableCents: cap,
    });
    if (
      !(await rateLimiter.check(ctx, "dailySpendCents", { key: args.tenantId, count: cap })).ok ||
      !(await rateLimiter.check(ctx, "deploymentSpendCents", { count: cap })).ok
    )
      throw new Error("STANDING_SERVICE_BUDGET_UNAVAILABLE");
    await rateLimiter.limit(ctx, "dailySpendCents", {
      key: args.tenantId,
      count: cap,
      reserve: true,
    });
    await rateLimiter.limit(ctx, "deploymentSpendCents", { count: cap, reserve: true });
    const reservationId = await recordMovement(ctx, {
      tenantId: args.tenantId,
      rail: "reasoning",
      phase: "reserved",
      amountCents: cap,
      correlationId: `standing:${occurrenceKey}`,
      kind: "standing_service",
      createdAt: now,
    });
    await ctx.db.patch(occurrenceId, { reservationId });
  }
  return { decision, occurrenceId };
}

async function budgetFor(ctx: MutationCtx, row: Doc<"managedServiceOccurrences">) {
  const reservation = row.reservationId ? await ctx.db.get(row.reservationId) : null;
  if (
    !reservation ||
    reservation.tenantId !== row.tenantId ||
    reservation.phase !== "reserved" ||
    reservation.kind !== "standing_service" ||
    reservation.rail !== "reasoning" ||
    reservation.correlationId !== `standing:${row.occurrenceKey}` ||
    row.receiptIds.length > 20 ||
    new Set(row.receiptIds).size !== row.receiptIds.length
  )
    return unavailable();
  let knownSpentCents = 0,
    releasedCents = 0;
  for (const id of row.receiptIds) {
    const receipt = await ctx.db.get(id);
    if (
      !receipt ||
      receipt.tenantId !== row.tenantId ||
      receipt.kind !== "standing_service" ||
      !receipt.correlationId.startsWith(`standing:${row.occurrenceKey}:`) ||
      !Number.isSafeInteger(receipt.amountCents) ||
      receipt.amountCents < 0
    )
      return unavailable();
    if (receipt.phase === "actual") knownSpentCents += receipt.amountCents;
    else if (receipt.phase === "refunded") releasedCents += receipt.amountCents;
    else return unavailable();
  }
  const heldCents = row.terminalOutcome ? row.unknownHoldCents : reservation.amountCents;
  if (heldCents === undefined) return unavailable();
  const overrunCents = Math.max(
    0,
    knownSpentCents + heldCents + releasedCents - reservation.amountCents,
  );
  const budget: StandingRunBudget = {
    reservationKey: row.occurrenceKey,
    runRef: row._id,
    capCents: reservation.amountCents,
    phase: row.terminalOutcome ? "terminal" : "reserved",
    knownSpentCents,
    releasedCents,
    heldCents,
    overrunCents,
    terminalOutcome: row.terminalOutcome ?? null,
  };
  return { budget, reservation };
}

/** Trusted cumulative usage receipts only. Closing a run never resumes work or erases an unknown hold. */
export async function settleStandingOccurrence(
  ctx: MutationCtx,
  args: {
    tenantId: string;
    occurrenceId: Id<"managedServiceOccurrences">;
    knownSpentCents: number;
    unknownHoldCents: number;
    outcome: StandingTerminalOutcome;
    effectsKnown: boolean;
  },
) {
  const row = await ctx.db.get(args.occurrenceId);
  if (typeof args.effectsKnown !== "boolean") return unavailable();
  if (
    !row ||
    row.tenantId !== args.tenantId ||
    !["claimed", "terminal", "unknown"].includes(row.state)
  )
    return unavailable();
  const { budget, reservation } = await budgetFor(ctx, row);
  if (row.terminalOutcome && row.terminalOutcome !== args.outcome)
    throw new Error("STANDING_SETTLEMENT_MISMATCH");
  const next = row.terminalOutcome
    ? reconcileStandingRunBudget(budget, args)
    : settleStandingRunBudget(budget, args);
  const actual = next.knownSpentCents - budget.knownSpentCents;
  const refund = next.releasedCents - budget.releasedCents;
  const state =
    next.heldCents > 0 || (!args.effectsKnown && row.state !== "terminal")
      ? ("unknown" as const)
      : ("terminal" as const);
  if (actual === 0 && refund === 0 && row.terminalOutcome && row.state === state)
    return { state: row.state, budget: next };
  if (row.receiptIds.length + Number(actual > 0) + Number(refund > 0) > 20)
    throw new Error("STANDING_RECEIPT_LIMIT");
  const receiptIds = [...row.receiptIds];
  const correlationId = `standing:${row.occurrenceKey}:${row.receiptIds.length}`;
  const overrun = next.overrunCents - budget.overrunCents;
  if (overrun > 0) {
    await rateLimiter.limit(ctx, "dailySpendCents", {
      key: row.tenantId,
      count: overrun,
      reserve: true,
    });
    await rateLimiter.limit(ctx, "deploymentSpendCents", { count: overrun, reserve: true });
  }
  if (refund > 0) {
    for (const rail of ["dailySpendCents", "deploymentSpendCents"] as const) {
      const options = rail === "dailySpendCents" ? { key: row.tenantId } : {};
      const window = await rateLimiter.getValue(ctx, rail, options);
      const rolled = calculateRateLimit(
        { value: window.value, ts: window.ts },
        window.config,
        Date.now(),
      );
      const count =
        reservation.createdAt < rolled.ts
          ? 0
          : clampRefundCents(refund, rolled.value, window.config.capacity ?? window.config.rate);
      if (count > 0)
        await rateLimiter.limit(ctx, rail, { ...options, count: -count, reserve: true });
    }
    receiptIds.push(
      await recordMovement(ctx, {
        tenantId: row.tenantId,
        rail: "reasoning",
        phase: "refunded",
        amountCents: refund,
        correlationId,
        kind: "standing_service",
        createdAt: Date.now(),
      }),
    );
  }
  if (actual > 0)
    receiptIds.push(
      await recordMovement(ctx, {
        tenantId: row.tenantId,
        rail: "reasoning",
        phase: "actual",
        amountCents: actual,
        correlationId,
        kind: "standing_service",
        createdAt: Date.now(),
      }),
    );
  await ctx.db.patch(row._id, {
    state,
    terminalOutcome: next.terminalOutcome ?? args.outcome,
    receiptIds,
    unknownHoldCents: next.heldCents,
    updatedAt: Date.now(),
  });
  return { state, budget: next };
}

// Deliberately has no native bypass argument. Releasing source does not enable recurrence.
export const claim = internalMutation({
  args: {
    tenantId: v.string(),
    approvalId: v.id("managedServiceStandingApprovals"),
    expectedControlRevision: v.number(),
    localDate: v.string(),
    requestedLocalTime: v.string(),
    timeZone: v.string(),
    dueAtMs: v.number(),
  },
  handler: (ctx, args) =>
    claimStandingOccurrence(ctx, args, { admitted: MANAGED_SERVICE_RECURRENCE_ENABLED }),
});
