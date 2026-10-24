import { calculateRateLimit } from "@convex-dev/rate-limiter";
import {
  classifyStandingOccurrence,
  nextStandingServiceOccurrence,
  reconcileStandingRunBudget,
  reserveStandingRunBudget,
  STANDING_SERVICE_MAX_APPROVAL_MS,
  type StandingOccurrence,
  type StandingRunBudget,
  type StandingServiceSchedule,
  type StandingServiceTerms,
  type StandingTerminalOutcome,
  settleStandingRunBudget,
  standingOccurrenceKey,
  standingServiceOccurrenceMatches,
  validateStandingServiceTerms,
} from "@pikar/core/managedServicePolicy";
import { clampRefundCents } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getGuardrailConfig, rateLimiter } from "./guardrails";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { internalAction, internalMutation } from "./lib/tenantLifecycle";
import { managedServiceReadiness } from "./managedServices";
import { serviceKnowledgeFor } from "./serviceConversations";
import { recordMovement } from "./spendLedger";

// ADR-067: construction is executable in native fixtures; release admission remains code-owned.
// A browser flag, environment variable or native function argument cannot qualify a release.
// ADR-067 release candidate: only explicitly approved built-in social preparation is admitted.
// Production promotion still requires the authenticated staging acceptance recorded by the release.
export const MANAGED_SERVICE_RECURRENCE_ENABLED = true;
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

// Legacy claim-only probe stays disabled: complete native admission must also bind a run and rearm.
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
  handler: (ctx, args) => claimStandingOccurrence(ctx, args, { admitted: false }),
});

const serviceArgs = {
  serviceId: v.string(),
  expectedRevision: v.number(),
  expectedControlRevision: v.number(),
};
const scheduleArg = v.object({
  cadence: v.union(v.literal("daily"), v.literal("weekly")),
  weekday: v.union(v.number(), v.null()),
  hour: v.number(),
  minute: v.number(),
  timeZone: v.string(),
});
const tickArgs = {
  tenantId: v.string(),
  approvalId: v.id("managedServiceStandingApprovals"),
  expectedApprovalRevision: v.number(),
  expectedControlRevision: v.number(),
  expectedDueAtMs: v.number(),
};
type TickArgs = {
  tenantId: string;
  approvalId: Id<"managedServiceStandingApprovals">;
  expectedApprovalRevision: number;
  expectedControlRevision: number;
  expectedDueAtMs: number;
};
type SuspensionReason = NonNullable<Doc<"managedServiceStandingApprovals">["suspensionReason"]>;
const approvalView = (row: Doc<"managedServiceStandingApprovals">) => ({
  approvalId: row._id,
  revision: row.revision,
  configRevision: row.configRevision,
  controlRevision: row.controlRevision ?? null,
  enabled: row.enabled === true,
  expiresAtMs: row.expiresAtMs,
  schedule: row.terms.schedule,
  budgetLimitCents: row.terms.budgetLimitCents,
  nextDueAtMs: row.enabled === true ? (row.nextDueAtMs ?? null) : null,
  suspendedAtMs: row.suspendedAtMs ?? null,
  suspensionReason: row.suspensionReason ?? null,
});

async function suspendApproval(
  ctx: MutationCtx,
  row: Doc<"managedServiceStandingApprovals">,
  reason: SuspensionReason,
) {
  if (row.scheduledFunctionId) {
    try {
      await ctx.scheduler.cancel(row.scheduledFunctionId);
    } catch {
      // Already-running work cannot be unsent. The persisted approval fence is authoritative.
    }
  }
  await ctx.db.patch(row._id, {
    enabled: false,
    scheduledFunctionId: undefined,
    nextDueAtMs: undefined,
    nextLocalDate: undefined,
    nextRequestedLocalTime: undefined,
    suspendedAtMs: Date.now(),
    suspensionReason: reason,
  });
}

async function armApproval(
  ctx: MutationCtx,
  approval: Doc<"managedServiceStandingApprovals">,
  afterUtcMs: number,
) {
  if (approval.controlRevision === undefined || !Number.isSafeInteger(approval.controlRevision))
    return unavailable();
  const expectedControlRevision = approval.controlRevision;
  const next = nextStandingServiceOccurrence(approval.terms, afterUtcMs);
  if (next.dueAtMs >= approval.expiresAtMs) {
    // The final occurrence may still be executing. Keep its approved allowance until actual expiry.
    const scheduledFunctionId = await ctx.scheduler.runAt(
      approval.expiresAtMs,
      internal.managedServiceRecurrence.expire,
      {
        tenantId: approval.tenantId,
        approvalId: approval._id,
        expectedApprovalRevision: approval.revision,
      },
    );
    await ctx.db.patch(approval._id, {
      scheduledFunctionId,
      nextDueAtMs: undefined,
      nextLocalDate: undefined,
      nextRequestedLocalTime: undefined,
    });
    return;
  }
  const scheduledFunctionId = await ctx.scheduler.runAt(
    next.dueAtMs,
    internal.managedServiceRecurrence.dispatch,
    {
      tenantId: approval.tenantId,
      approvalId: approval._id,
      expectedApprovalRevision: approval.revision,
      expectedControlRevision,
      expectedDueAtMs: next.dueAtMs,
    },
  );
  await ctx.db.patch(approval._id, {
    nextDueAtMs: next.dueAtMs,
    nextLocalDate: next.localDate,
    nextRequestedLocalTime: next.requestedLocalTime,
    scheduledFunctionId,
  });
}

/** Explicit fresh terms, including after reconnect: no resume of an old permission snapshot. */
export async function configureStandingService(
  ctx: MutationCtx,
  args: {
    tenantId: string;
    serviceId: string;
    expectedRevision: number;
    expectedControlRevision: number;
    expectedApprovalRevision?: number;
    schedule: StandingServiceSchedule;
    expiresAtMs: number;
  },
  capability: RecurrenceCapability,
) {
  if (!capability.admitted) throw new Error("STANDING_SERVICE_QUALIFICATION_REQUIRED");
  const service = await ctx.db
    .query("managedServices")
    .withIndex("by_tenant_service", (q) =>
      q.eq("tenantId", args.tenantId).eq("serviceId", args.serviceId),
    )
    .unique();
  if (
    service?.serviceId !== "social-marketing" ||
    service.controlState !== "active" ||
    service.revision !== args.expectedRevision ||
    service.controlRevision !== args.expectedControlRevision ||
    service.skills.length !== 1 ||
    service.skills[0]?.name !== "cockpit-agent" ||
    service.skills[0]?.tenantId !== null ||
    !service.operationIds.every((op) => op === "social.prepare" || op === "social.report") ||
    !(await managedServiceReadiness(ctx, service)).ready
  )
    return unavailable();
  const [unknownRuns, unknownOccurrences] = await Promise.all([
    ctx.db
      .query("managedServiceRuns")
      .withIndex("by_service_state", (q) =>
        q.eq("tenantId", args.tenantId).eq("serviceId", service._id).eq("state", "unknown"),
      )
      .take(1),
    ctx.db
      .query("managedServiceOccurrences")
      .withIndex("by_service_state", (q) =>
        q.eq("tenantId", args.tenantId).eq("serviceId", service._id).eq("state", "unknown"),
      )
      .take(1),
  ]);
  if (unknownRuns.length || unknownOccurrences.length)
    throw new Error("STANDING_SERVICE_RECONCILIATION_REQUIRED");
  const now = Date.now();
  if (
    !Number.isSafeInteger(args.expiresAtMs) ||
    args.expiresAtMs <= now ||
    args.expiresAtMs - now > STANDING_SERVICE_MAX_APPROVAL_MS
  )
    throw new Error("STANDING_SERVICE_EXPIRY_INVALID");
  const terms: StandingServiceTerms = {
    goalHash: await contentHash(service.goal),
    operationIds: service.operationIds,
    skillPins: service.skills,
    recipientRefs: [],
    accountPins: service.accounts,
    budgetLimitCents: service.budgetLimitCents,
    schedule: args.schedule,
  };
  validateStandingServiceTerms(terms);
  if (nextStandingServiceOccurrence(terms, now).dueAtMs >= args.expiresAtMs)
    throw new Error("STANDING_SERVICE_EXPIRY_INVALID");
  const previous = await ctx.db
    .query("managedServiceStandingApprovals")
    .withIndex("by_service_revision", (q) =>
      q.eq("tenantId", args.tenantId).eq("serviceId", service._id),
    )
    .order("desc")
    .first();
  if (
    !Number.isSafeInteger(args.expectedApprovalRevision ?? 0) ||
    (args.expectedApprovalRevision ?? 0) !== (previous?.revision ?? 0)
  )
    throw new Error("STANDING_SERVICE_APPROVAL_CHANGED");
  if (previous?.enabled) await suspendApproval(ctx, previous, "approval_stale");
  const approvalId = await ctx.db.insert("managedServiceStandingApprovals", {
    tenantId: args.tenantId,
    serviceId: service._id,
    revision: (previous?.revision ?? 0) + 1,
    configRevision: service.revision,
    controlRevision: service.controlRevision,
    terms: {
      ...terms,
      operationIds: [...terms.operationIds],
      skillPins: terms.skillPins.map((pin) => ({ ...pin })),
      recipientRefs: [...terms.recipientRefs],
      accountPins: terms.accountPins.map((pin) => ({ ...pin })),
      schedule: { ...terms.schedule },
    },
    enabled: true,
    expiresAtMs: args.expiresAtMs,
    createdAt: now,
  });
  const approval = await ctx.db.get(approvalId);
  if (!approval) return unavailable();
  await armApproval(ctx, approval, now);
  const result = await ctx.db.get(approvalId);
  if (!result) return unavailable();
  return approvalView(result);
}

export const configure = tenantMutation({
  args: {
    ...serviceArgs,
    expectedApprovalRevision: v.optional(v.number()),
    schedule: scheduleArg,
    expiresAtMs: v.number(),
  },
  handler: (ctx, args) =>
    configureStandingService(
      ctx,
      { ...args, tenantId: ctx.tenantId },
      {
        admitted: MANAGED_SERVICE_RECURRENCE_ENABLED,
      },
    ),
});

export const expire = internalMutation({
  args: {
    tenantId: v.string(),
    approvalId: v.id("managedServiceStandingApprovals"),
    expectedApprovalRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (
      approval?.tenantId === args.tenantId &&
      approval.enabled === true &&
      approval.revision === args.expectedApprovalRevision &&
      approval.expiresAtMs <= Date.now()
    )
      await suspendApproval(ctx, approval, "expired");
    return null;
  },
});

export const status = tenantQuery({
  args: { serviceId: v.string() },
  handler: async (ctx, args) => {
    const service = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant_service", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", args.serviceId),
      )
      .unique();
    const approval = service
      ? await ctx.db
          .query("managedServiceStandingApprovals")
          .withIndex("by_service_revision", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("serviceId", service._id),
          )
          .order("desc")
          .first()
      : null;
    return {
      qualified: MANAGED_SERVICE_RECURRENCE_ENABLED,
      approval: approval ? approvalView(approval) : null,
    };
  },
});

export async function suspendStandingService(
  ctx: MutationCtx,
  args: { tenantId: string; serviceId: Id<"managedServices">; reason: SuspensionReason },
) {
  const approvals = await ctx.db
    .query("managedServiceStandingApprovals")
    .withIndex("by_service_enabled", (q) =>
      q.eq("tenantId", args.tenantId).eq("serviceId", args.serviceId).eq("enabled", true),
    )
    .take(2);
  if (approvals.length > 1) throw new Error("STANDING_SERVICE_APPROVAL_CONFLICT");
  if (approvals[0]) await suspendApproval(ctx, approvals[0], args.reason);
  return null;
}

export const suspend = tenantMutation({
  args: serviceArgs,
  handler: async (ctx, args) => {
    const service = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant_service", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", args.serviceId),
      )
      .unique();
    if (
      !service ||
      service.revision !== args.expectedRevision ||
      service.controlRevision !== args.expectedControlRevision
    )
      return unavailable();
    await suspendStandingService(ctx, {
      tenantId: ctx.tenantId,
      serviceId: service._id,
      reason: "paused",
    });
    return { suspended: true as const };
  },
});

export const suspendForService = internalMutation({
  args: {
    tenantId: v.string(),
    serviceId: v.id("managedServices"),
    reason: v.union(
      v.literal("paused"),
      v.literal("approval_stale"),
      v.literal("authorization_required"),
      v.literal("budget_required"),
    ),
  },
  handler: suspendStandingService,
});

/** Native atomic claim, run lineage and next timer; no model/provider action in this mutation. */
export async function tickStandingService(
  ctx: MutationCtx,
  args: TickArgs,
  capability: RecurrenceCapability,
) {
  const approval = await ctx.db.get(args.approvalId);
  if (
    !approval ||
    approval.tenantId !== args.tenantId ||
    approval.enabled !== true ||
    approval.revision !== args.expectedApprovalRevision ||
    approval.controlRevision !== args.expectedControlRevision ||
    approval.nextDueAtMs !== args.expectedDueAtMs ||
    !approval.nextLocalDate ||
    !approval.nextRequestedLocalTime
  )
    return { decision: "stale_callback" as const, runId: null };
  if (!capability.admitted) {
    await suspendApproval(ctx, approval, "qualification_required");
    return { decision: "admission_deferred" as const, runId: null };
  }
  if (approval.expiresAtMs <= Date.now()) {
    await suspendApproval(ctx, approval, "expired");
    return { decision: "approval_stale" as const, runId: null };
  }
  if (Date.now() < args.expectedDueAtMs) return { decision: "not_due" as const, runId: null };
  if (
    !standingServiceOccurrenceMatches(approval.terms, {
      dueAtMs: args.expectedDueAtMs,
      localDate: approval.nextLocalDate,
      requestedLocalTime: approval.nextRequestedLocalTime,
      timeZone: approval.terms.schedule.timeZone,
    })
  ) {
    await suspendApproval(ctx, approval, "approval_stale");
    return { decision: "approval_stale" as const, runId: null };
  }
  const service = await ctx.db.get(approval.serviceId);
  if (!service || service.tenantId !== args.tenantId) return unavailable();
  let knowledgeHash: string | undefined;
  if (service.operationIds.includes("social.prepare")) {
    const knowledge = await serviceKnowledgeFor(ctx, service);
    if (!knowledge.assessment.ready || !/^[a-f0-9]{64}$/.test(knowledge.sourceHash)) {
      await suspendApproval(ctx, approval, "approval_stale");
      return { decision: "approval_stale" as const, runId: null };
    }
    knowledgeHash = knowledge.sourceHash;
  }
  const claimed = await claimStandingOccurrence(
    ctx,
    {
      tenantId: args.tenantId,
      approvalId: approval._id,
      expectedControlRevision: args.expectedControlRevision,
      localDate: approval.nextLocalDate,
      requestedLocalTime: approval.nextRequestedLocalTime,
      timeZone: approval.terms.schedule.timeZone,
      dueAtMs: args.expectedDueAtMs,
    },
    capability,
  );
  if (!["claimable", "skipped_missed", "skipped_overlap", "duplicate"].includes(claimed.decision)) {
    const reason =
      claimed.decision === "authorization_required"
        ? "authorization_required"
        : claimed.decision === "reconciliation_required"
          ? "reconciliation_required"
          : claimed.decision === "paused" || claimed.decision === "control_changed"
            ? "paused"
            : "approval_stale";
    await suspendApproval(ctx, approval, reason);
    return { decision: claimed.decision, runId: null };
  }
  let runId: Id<"managedServiceRuns"> | null = null;
  if (claimed.decision === "claimable" && claimed.occurrenceId) {
    const occurrence = await ctx.db.get(claimed.occurrenceId);
    if (!occurrence) return unavailable();
    runId = await ctx.db.insert("managedServiceRuns", {
      tenantId: args.tenantId,
      serviceId: service._id,
      configRevision: service.revision,
      controlRevision: service.controlRevision,
      budgetLimitCents: service.budgetLimitCents,
      ...(service.goalId ? { goalId: service.goalId } : {}),
      ...(knowledgeHash ? { knowledgeHash } : {}),
      standingOccurrenceId: occurrence._id,
      standingApprovalId: approval._id,
      requestKey: `standing_${occurrence.occurrenceKey}`,
      state: "claimed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(occurrence._id, { runId });
    await ctx.scheduler.runAfter(0, internal.managedServiceRecurrenceExecution.start, {
      tenantId: args.tenantId,
      runId,
    });
  }
  await armApproval(ctx, approval, Math.max(Date.now(), args.expectedDueAtMs));
  return { decision: claimed.decision, runId };
}

export const tick = internalMutation({
  args: tickArgs,
  handler: (ctx, args) =>
    tickStandingService(ctx, args, { admitted: MANAGED_SERVICE_RECURRENCE_ENABLED }),
});

export const suspendFailedTick = internalMutation({
  args: { ...tickArgs, budgetUnavailable: v.boolean() },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (
      approval?.tenantId === args.tenantId &&
      approval.enabled === true &&
      approval.revision === args.expectedApprovalRevision &&
      approval.controlRevision === args.expectedControlRevision &&
      approval.nextDueAtMs === args.expectedDueAtMs
    )
      await suspendApproval(
        ctx,
        approval,
        args.budgetUnavailable ? "budget_required" : "approval_stale",
      );
    return null;
  },
});

/** No retry: a rolled-back failed claim is suspended explicitly, never silently dropped. */
export const dispatch = internalAction({
  args: tickArgs,
  handler: async (ctx, args): Promise<null> => {
    try {
      await ctx.runMutation(internal.managedServiceRecurrence.tick, args);
    } catch (error) {
      await ctx.runMutation(internal.managedServiceRecurrence.suspendFailedTick, {
        ...args,
        budgetUnavailable:
          error instanceof Error && error.message.includes("STANDING_SERVICE_BUDGET_UNAVAILABLE"),
      });
    }
    return null;
  },
});
