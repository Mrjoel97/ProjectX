// Test-only schema. This file is outside convex.json's production functions root.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const rule = v.object({
  timeZone: v.string(),
  hour: v.number(),
  minute: v.number(),
  cadence: v.union(
    v.object({ frequency: v.literal("daily") }),
    v.object({ frequency: v.literal("weekly"), weekday: v.number() }),
  ),
});
const outcome = v.union(
  v.literal("claimed"),
  v.literal("running"),
  v.literal("retry_pending"),
  v.literal("reconciliation_required"),
  v.literal("prepared"),
  v.literal("skipped_missed"),
  v.literal("skipped_overlap"),
  v.literal("stopped_paused"),
  v.literal("stopped_changed"),
  v.literal("failed_auth"),
  v.literal("failed_validation"),
  v.literal("failed_budget"),
  v.literal("failed_provider_refusal"),
  v.literal("failed_provider_5xx"),
  v.literal("failed_provider_timeout"),
  v.literal("failed_internal"),
);
const railState = v.union(
  v.literal("pending"),
  v.literal("held"),
  v.literal("denied"),
  v.literal("released"),
  v.literal("uncertain"),
);

export default defineSchema({
  candidateRoutines: defineTable({
    tenantId: v.string(),
    status: v.union(v.literal("awaiting_approval"), v.literal("approved"), v.literal("paused")),
    version: v.number(),
    promptVersion: v.number(),
    promptHash: v.string(),
    recipients: v.array(v.string()),
    accountRef: v.string(),
    envelopeCents: v.number(),
    rule,
    scanOrdinal: v.number(),
    activatedAtUtcMs: v.optional(v.number()),
    lastOccurrenceKey: v.optional(v.string()),
    activeRunId: v.optional(v.id("candidateRuns")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_and_scanOrdinal", ["tenantId", "scanOrdinal"]),
  candidateRuns: defineTable({
    tenantId: v.string(),
    scanOrdinal: v.number(),
    routineId: v.id("candidateRoutines"),
    routineVersion: v.number(),
    occurrenceKey: v.string(),
    status: outcome,
    pendingTerminal: v.optional(outcome),
    pendingPlanRef: v.optional(v.string()),
    attempts: v.number(),
    planRef: v.optional(v.string()),
    reservation: v.optional(
      v.object({
        admissionId: v.string(),
        state: v.union(
          v.literal("admitted"),
          v.literal("held"),
          v.literal("reconciliation_required"),
          v.literal("released"),
        ),
        dailyKey: v.string(),
        deploymentKey: v.string(),
        daily: railState,
        deployment: railState,
      }),
    ),
    paidStep: v.optional(
      v.object({
        stepId: v.string(),
        token: v.string(),
        state: v.union(v.literal("admitted"), v.literal("start_claimed")),
      }),
    ),
    lastStepId: v.optional(v.string()),
    lastStepOutcome: v.optional(outcome),
    settledStepIds: v.optional(v.array(v.string())),
    humanApprovalRef: v.optional(v.string()),
  })
    .index("by_tenant_routine", ["tenantId", "routineId"])
    .index("by_tenant_occurrence", ["tenantId", "occurrenceKey"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_and_scanOrdinal", ["tenantId", "scanOrdinal"]),
  candidateSweepProgress: defineTable({
    tenantId: v.string(),
    routineOrdinal: v.number(),
    runOrdinal: v.number(),
    due: v.object({ cursor: v.number(), highWater: v.number(), epoch: v.number() }),
    recovery: v.object({ cursor: v.number(), highWater: v.number(), epoch: v.number() }),
  }).index("by_tenant", ["tenantId"]),
  candidateAudit: defineTable({
    tenantId: v.string(),
    routineId: v.id("candidateRoutines"),
    runId: v.id("candidateRuns"),
    occurrenceKey: v.string(),
    outcome,
  }).index("by_tenant", ["tenantId"]),
  candidateDeadLetters: defineTable({
    tenantId: v.string(),
    routineId: v.id("candidateRoutines"),
    runId: v.id("candidateRuns"),
    occurrenceKey: v.string(),
    failureClass: v.union(
      v.literal("auth"),
      v.literal("validation"),
      v.literal("budget"),
      v.literal("provider_refusal"),
      v.literal("provider_5xx"),
      v.literal("provider_timeout"),
      v.literal("internal"),
    ),
  }).index("by_tenant", ["tenantId"]),
});
