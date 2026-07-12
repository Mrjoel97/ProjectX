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
    .index("by_status", ["status"])
    // 02-06's newCount/listNew tenantQueries filter tenant AND status — a compound
    // index avoids an in-memory cross-filter.
    .index("by_tenant_status", ["tenantId", "status"]),

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
  // by_correlation added for 02-04's sendDecision (currently full-scans; unbounded now).
  pendingTimeouts: defineTable({
    workflowId: v.string(),
    correlationId: v.string(),
    scheduledId: v.string(),
    // The gate's attempt suffix — the review wrapper reads it to fire the decision
    // at the authoritative gate (client-supplied attempt could skew after a regenerate
    // and silently lose the decision). Optional: pre-02-09 rows carry none (treated as 0).
    attempt: v.optional(v.number()),
  })
    .index("by_workflow", ["workflowId"])
    .index("by_correlation", ["correlationId"]),

  // Cursors for the WORM export cron (last audit ts exported to immutable storage).
  exportCursors: defineTable({
    name: v.string(),
    lastExportedTs: v.number(),
  }).index("by_name", ["name"]),

  // ── Phase-2 content + telemetry plane ──────────────────────────────────────
  // Every table is tenant-scoped and carries the index its reactive query needs.

  // Content plane: the user's goal, recipient, draft/edited body, reject reason.
  // Raw content lives HERE (CLAUDE.md §4) — never in audit/deadLetters payloads.
  requests: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    goal: v.string(),
    recipient: v.string(),
    // The Executive Router's decision, persisted so the review gate can show it
    // read-only (AGNT-02 — the user sees the route before anything runs).
    route: v.optional(v.string()),
    draft: v.optional(v.string()),
    editedBody: v.optional(v.string()),
    rejectReason: v.optional(v.string()),
    // Guardrail redaction output (content plane, like goal/draft). Written by
    // guardrails.prepare (plan 03-03/04); optional — no backfill/migration.
    safeText: v.optional(v.string()), // redacted goal
    safeTextHash: v.optional(v.string()), // SHA-256 hex of safeText — the cache-key member
    lastInstruction: v.optional(v.string()), // scanned (redacted) latest regenerate instruction (03-04)
    // The 13 observable pipeline stages (kept in sync with pipeline.ts REQUEST_STATUS).
    status: v.union(
      v.literal("submitted"),
      v.literal("routing"),
      v.literal("scanning"),
      v.literal("drafting"),
      v.literal("awaiting_review"),
      v.literal("approved"),
      v.literal("delivering"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("blocked"),
      v.literal("expired"),
      v.literal("failed"),
      v.literal("awaiting_reauth"),
    ),
    attachmentRefs: v.array(v.id("attachments")),
    workflowId: v.optional(v.string()),
    // Groups fan-out recipient rows under one cockpit plan (DECISION #1). Optional
    // → no migration (Pitfall-7 optional-on-read, same as safeText). The REPORT
    // projection reads every recipient row for a plan via by_plan.
    planId: v.optional(v.id("plans")),
    createdAt: v.number(),
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_correlation", ["correlationId"])
    // Deterministic hash→text recovery for the cached action (03-RESEARCH Pattern 3).
    .index("by_tenant_safeTextHash", ["tenantId", "safeTextHash"])
    // REPORT projection: all recipient rows grouped under one cockpit plan.
    .index("by_plan", ["planId"]),

  // Cockpit plan/draft content plane (CLAUDE.md §4: raw content lives HERE, never in audit/DLQ).
  // ONE row per guided conversation; the approve-gate object + idempotency CAS (DECISION #1).
  plans: defineTable({
    tenantId: v.string(),
    threadId: v.string(), // agent thread → renders PLAN/DRAFT/REPORT cards for this thread
    status: v.union(
      // PINNED lifecycle enum, shared by agent + delivery lanes:
      v.literal("collecting"), // slots still filling during the guided conversation
      v.literal("proposed"), // all slots filled + body drafted → PLAN card, awaiting Approve
      v.literal("approved"), // executePlan CAS passed (set immediately before workflow.start)
      v.literal("delivering"), // fan-out workflow started (requests rows seeded)
      v.literal("done"), // fan-out complete
    ),
    // Slot content (accumulated during the conversation; all optional until filled):
    recipients: v.optional(v.array(v.string())), // validated, deduped emails
    mode: v.optional(v.union(v.literal("individual"), v.literal("group"))),
    subject: v.optional(v.string()),
    bodyIntent: v.optional(v.string()), // the user's goal → drafter turns it into `body`
    body: v.optional(v.string()), // drafted wording (filled at "ready")
    correlationId: v.optional(v.string()), // set on executePlan (not the per-recipient cids)
    workflowId: v.optional(v.string()), // set on executePlan
    createdAt: v.number(),
  }).index("by_thread", ["tenantId", "threadId"]),

  // File metadata only — the agent sees filename/mimeType/size, never contents.
  // `extracted` is filled by Phase 4 (INTK-02). requestId set after the request insert.
  attachments: defineTable({
    tenantId: v.string(),
    requestId: v.optional(v.id("requests")),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    extracted: v.optional(v.string()),
  }).index("by_request", ["requestId"]),

  // One row per request, written once at terminal state (OPSG-01). Bounded by
  // request count — queried directly, not via the aggregate.
  telemetry: defineTable({
    tenantId: v.string(),
    correlationId: v.string(),
    requestId: v.id("requests"),
    tokensIn: v.number(),
    tokensOut: v.number(),
    costUsd: v.number(),
    durationMs: v.number(),
    decisionCounts: v.any(),
    regenerateCount: v.number(),
    reviewOutcome: v.string(),
    createdAt: v.number(),
  }).index("by_correlation", ["correlationId"]),

  // In-app notifications (INTK-04 seam; OPSG-05 grows channels onto these rows in Phase 7).
  notifications: defineTable({
    tenantId: v.string(),
    kind: v.string(),
    requestId: v.optional(v.id("requests")),
    message: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  }).index("by_tenant_read", ["tenantId", "read"]),

  // Gmail OAuth tokens — the crown jewels. Read by internal functions ONLY;
  // never returned to a client query, never in the browser, never in an audit payload.
  gmailTokens: defineTable({
    tenantId: v.string(),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.string(),
    updatedAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  // ── Phase-3 guardrail plane ────────────────────────────────────────────────
  // GRDL-06 kill switch + per-request budget. SINGLE row, upserted by
  // guardrails.setKillSwitch; read with .first() (≤1 row — no index needed).
  // Default-on-read: a missing row means switch OFF (zero seed, no migration).
  guardrailConfig: defineTable({
    killSwitch: v.boolean(),
    budgetUsdPerRequest: v.number(),
    updatedAt: v.number(),
  }),

  // Demo table used by plan 02's cross-tenant negative test.
  demoItems: defineTable({
    tenantId: v.string(),
    label: v.string(),
  }).index("by_tenant", ["tenantId"]),
});
