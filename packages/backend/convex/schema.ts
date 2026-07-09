import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CONTRACTS_PACKAGE_NAME } from "@pikar/contracts";

// Compile-time proof the Convex bundler resolves source-export workspace packages.
void CONTRACTS_PACKAGE_NAME;

export default defineSchema({
  // Convex Auth identity tables (users, authSessions, authAccounts, ...).
  ...authTables,

  // Insert-only audit log. `payload` holds refs/hashes ONLY — never raw content
  // (redaction-safe). The audit module exposes no patch/replace/delete (see CLAUDE.md).
  audit: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    eventType: v.string(),
    actor: v.string(),
    payload: v.any(),
    ts: v.number(),
  })
    .index("by_tenant_ts", ["tenantId", "ts"])
    .index("by_correlation", ["correlationId"]),

  // Dead-letter queue populated by workflow onComplete on failure. Redaction-safe payload.
  deadLetters: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    workflowId: v.string(),
    payload: v.any(),
    error: v.string(),
    status: v.union(v.literal("new"), v.literal("replayed"), v.literal("resolved")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_status", ["status"]),

  // Versioned skill/prompt registry (no hardcoded agent prompts — load from here).
  skills: defineTable({
    name: v.string(),
    version: v.number(),
    body: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("candidate"),
      v.literal("rolled_back"),
      v.literal("archived"),
    ),
    evidence: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_name_status", ["name", "status"])
    .index("by_name_version", ["name", "version"]),

  // Scheduled awaitEvent-timeout bookkeeping (cancel the scheduled event on real decision).
  pendingTimeouts: defineTable({
    workflowId: v.string(),
    correlationId: v.string(),
    scheduledId: v.string(),
  }).index("by_workflow", ["workflowId"]),

  // Cursors for the WORM export cron (last audit ts exported to immutable storage).
  exportCursors: defineTable({
    name: v.string(),
    lastExportedTs: v.number(),
  }).index("by_name", ["name"]),

  // Demo table used by plan 02's cross-tenant negative test.
  demoItems: defineTable({
    tenantId: v.string(),
    label: v.string(),
  }).index("by_tenant", ["tenantId"]),
});
