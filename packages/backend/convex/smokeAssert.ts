// Integration assertions for the smoke workflows, runnable via `npx convex run`.
// Each throws on failure so `npx convex run` surfaces a failure banner (the node
// smoke scripts poll these, since workflow completion is asynchronous).
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { migrations } from "./migrations";

/** OPSG-04: a failing pipeline produced a deadLetters row + a deadletter.written audit. */
export const assertDeadLetter = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const row = news.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no deadLetters row for ${correlationId}`);
    if (!row.error.includes("SMOKE_FAILURE")) {
      throw new Error(`deadLetters error missing SMOKE_FAILURE: ${row.error}`);
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    if (!audits.some((a) => a.eventType === "deadletter.written")) {
      throw new Error(`no deadletter.written audit event for ${correlationId}`);
    }
    return { ok: true, error: row.error };
  },
});

/** Criterion 4: the review gate took the expected branch (and canceled the timeout). */
export const assertReviewOutcome = internalQuery({
  args: {
    correlationId: v.string(),
    expected: v.union(v.literal("decision"), v.literal("timeout")),
  },
  handler: async (ctx, { correlationId, expected }) => {
    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    const seen = audits.map((a) => a.eventType);
    if (!seen.includes(`smoke.reviewgate.${expected}`)) {
      throw new Error(
        `review outcome for ${correlationId}: expected smoke.reviewgate.${expected}, saw [${seen.join(", ")}]`,
      );
    }

    // Decision path must have canceled + cleared the scheduled timeout.
    if (expected === "decision") {
      const pending = await ctx.db.query("pendingTimeouts").collect();
      if (pending.some((r) => r.correlationId === correlationId)) {
        throw new Error(`pendingTimeouts row for ${correlationId} survived — timeout not canceled`);
      }
    }
    return { ok: true };
  },
});

/**
 * 02-06 full spine: the pipeline reached a delivery outcome. No Gmail token for
 * tenant "smoke" → `awaiting_reauth` (the automatable half of DLVR-01/03); a token
 * present → `sent` with exactly one `sent` telemetry row.
 */
export const assertPipelineDelivered = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "awaiting_reauth" && req.status !== "sent") {
      throw new Error(
        `pipeline ${correlationId} at "${req.status}", expected awaiting_reauth|sent`,
      );
    }
    if (req.status === "sent") {
      const tel = await ctx.db
        .query("telemetry")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .first();
      if (!tel || tel.reviewOutcome !== "sent") {
        throw new Error(`no sent telemetry row for ${correlationId}`);
      }
    }
    return { ok: true, status: req.status };
  },
});

/**
 * AGNT-03 + OPSG-01: a mis-route dead-lettered under the DISTINCT reason AND the
 * request reached the `failed` terminal (status=failed + one failed telemetry row) —
 * proving it no longer hangs at "routing".
 */
export const assertDeadLetterReason = internalQuery({
  args: { correlationId: v.string(), reason: v.string() },
  handler: async (ctx, { correlationId, reason }) => {
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const row = news.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no new deadLetters row for ${correlationId}`);
    if (!row.error.includes(reason)) {
      throw new Error(`deadLetters reason for ${correlationId}: "${row.error}" !~ "${reason}"`);
    }

    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "failed") {
      throw new Error(
        `request ${correlationId} at "${req.status}", expected failed (no-stuck-status)`,
      );
    }

    // OPSG-05: a dead-letter with a requestId ref fires a user-facing `deadletter` notification beside
    // its audit (07-05). Mirrors assertReviewExpired/assertReviewEscalated — keyed by requestId + kind.
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", req.tenantId))
      .collect();
    if (!notes.some((n) => n.requestId === req._id && n.kind === "deadletter")) {
      throw new Error(`no deadletter notification for ${correlationId}`);
    }

    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!tel || tel.reviewOutcome !== "failed") {
      throw new Error(`no failed telemetry row for ${correlationId}`);
    }
    return { ok: true, reason: row.error };
  },
});

/**
 * REVW-03: the review-inactivity timeout landed the request at the `expired` terminal —
 * status expired + a review.expired notification fired (07-03's addition, was audit-only) +
 * one expired telemetry row + NO send (never sent/delivering).
 */
export const assertReviewExpired = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "expired") {
      throw new Error(`request ${correlationId} at "${req.status}", expected expired (NO send)`);
    }

    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", req.tenantId))
      .collect();
    if (!notes.some((n) => n.requestId === req._id && n.kind === "review.expired")) {
      throw new Error(`no review.expired notification for ${correlationId}`);
    }

    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!tel || tel.reviewOutcome !== "expired") {
      throw new Error(`no expired telemetry row for ${correlationId}`);
    }
    return { ok: true, status: req.status };
  },
});

/**
 * REVW-02 (the bug fix): a regenerate breach past MAX_REGENERATE fails closed at the
 * `escalated` terminal — status escalated + a review.escalated audit + a retry.limit
 * notification + one escalated telemetry row + NO send (never sent/delivering).
 */
export const assertReviewEscalated = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "escalated") {
      throw new Error(`request ${correlationId} at "${req.status}", expected escalated (NO send)`);
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    if (!audits.some((a) => a.eventType === "review.escalated")) {
      throw new Error(`no review.escalated audit for ${correlationId}`);
    }

    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", req.tenantId))
      .collect();
    if (!notes.some((n) => n.requestId === req._id && n.kind === "retry.limit")) {
      throw new Error(`no retry.limit notification for ${correlationId}`);
    }

    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!tel || tel.reviewOutcome !== "escalated") {
      throw new Error(`no escalated telemetry row for ${correlationId}`);
    }
    return { ok: true, status: req.status };
  },
});

// ── 03-05 guardrail phase-gate assertions ────────────────────────────────────
// The component behaviors convex-test cannot emulate (kill switch, budget window,
// action-cache isolation/hit, fallback) plus GRDL-02's no-raw-PII needle scan.

/** A governed stop (kill switch / budget) landed the request at the `blocked`
 *  terminal: status blocked + guardrail.blocked audit (reason) + blocked telemetry,
 *  and — critically — NO deadLetters row (a governed stop must never dead-letter). */
export const assertBlocked = internalQuery({
  args: { correlationId: v.string(), reason: v.string() },
  handler: async (ctx, { correlationId, reason }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "blocked") {
      throw new Error(`request ${correlationId} at "${req.status}", expected blocked`);
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    const blocked = audits.find((a) => a.eventType === "guardrail.blocked");
    if (!blocked) throw new Error(`no guardrail.blocked audit for ${correlationId}`);
    if (blocked.payload?.reason !== reason) {
      throw new Error(`guardrail.blocked reason "${blocked.payload?.reason}" !== "${reason}"`);
    }

    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!tel || tel.reviewOutcome !== "blocked") {
      throw new Error(`no blocked telemetry row for ${correlationId}`);
    }

    // A governed stop is NOT a DLQ failure — no dead letter may exist for this cid.
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    if (news.some((r) => r.correlationId === correlationId)) {
      throw new Error(
        `deadLetters row for ${correlationId} — a governed stop must not dead-letter`,
      );
    }
    return { ok: true, reason };
  },
});

/** Non-consuming "parked at the review gate" probe. The mid-flight budget test needs
 *  request A settled at awaiting_review BEFORE draining the window (so a regenerate
 *  hits the preCall path, not prepare) — sendDecision would consume the gate. */
export const assertAtReview = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "awaiting_review") {
      throw new Error(`request ${correlationId} at "${req.status}", not yet awaiting_review`);
    }
    return { ok: true };
  },
});

/** GRDL-01/02: the request was redacted — safeText + hash written, every expected
 *  placeholder present, and a request.redacted audit row carries piiCounts. Returns
 *  safeTextHash (the cache-key + audit correlation for the count/needle assertions). */
export const assertRedacted = internalQuery({
  args: { correlationId: v.string(), placeholders: v.optional(v.array(v.string())) },
  handler: async (ctx, { correlationId, placeholders }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (!req.safeTextHash || req.safeText === undefined) {
      throw new Error(`request ${correlationId} not redacted (safeText/safeTextHash unset)`);
    }
    for (const p of placeholders ?? []) {
      if (!req.safeText.includes(p)) {
        throw new Error(`safeText for ${correlationId} missing placeholder ${p}`);
      }
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    const redacted = audits.find((a) => a.eventType === "request.redacted");
    if (!redacted) throw new Error(`no request.redacted audit for ${correlationId}`);
    if (redacted.payload?.piiCounts === undefined) {
      throw new Error(`request.redacted for ${correlationId} missing piiCounts`);
    }
    return { safeTextHash: req.safeTextHash };
  },
});

/** GRDL-02's letter: NO raw PII in any log plane. Scans every audit row for BOTH
 *  the request cid AND the safeTextHash (the model-side audit correlation), every
 *  new deadLetters row for the cid, and the telemetry row — asserts no needle appears.
 *  Needle values (raw PII) are NEVER echoed back — only their index — so this
 *  assertion's own output can't become a leak. */
export const assertNoRawPii = internalQuery({
  args: { correlationId: v.string(), safeTextHash: v.string(), needles: v.array(v.string()) },
  handler: async (ctx, { correlationId, safeTextHash, needles }) => {
    const auditsCid = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    const auditsHash = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", safeTextHash))
      .collect();
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();

    const blobs = [
      ...auditsCid.map((a) => JSON.stringify(a)),
      ...auditsHash.map((a) => JSON.stringify(a)),
      ...news.filter((r) => r.correlationId === correlationId).map((r) => JSON.stringify(r)),
      tel ? JSON.stringify(tel) : "",
    ];
    for (let n = 0; n < needles.length; n++) {
      const needle = needles[n];
      if (needle && blobs.some((b) => b.includes(needle))) {
        throw new Error(`RAW PII leak: needle #${n} found in a log plane for ${correlationId}`);
      }
    }
    return { ok: true, scanned: blobs.length };
  },
});

/** GRDL-04 cache oracle: count llm.called DRAFT-stage rows for this (tenant, hash).
 *  A cache miss adds a row; a hit adds none. Two tenants with the identical goal each
 *  produce 1 (isolated entries); the same tenant repeating the goal stays at 1 (hit). */
export const assertLlmCalledCount = internalQuery({
  args: {
    safeTextHash: v.string(),
    tenantId: v.string(),
    stage: v.string(),
    expected: v.number(),
  },
  handler: async (ctx, { safeTextHash, tenantId, stage, expected }) => {
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", safeTextHash))
      .collect();
    const count = rows.filter(
      (a) => a.eventType === "llm.called" && a.tenantId === tenantId && a.payload?.stage === stage,
    ).length;
    if (count !== expected) {
      throw new Error(
        `llm.called ${stage} count for ${tenantId}/${safeTextHash.slice(0, 8)} = ${count}, expected ${expected}`,
      );
    }
    return { ok: true, count };
  },
});

/** GRDL-05: an eligible primary failure produced an llm.fallback audit for the hash. */
export const assertFallback = internalQuery({
  args: { safeTextHash: v.string() },
  handler: async (ctx, { safeTextHash }) => {
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", safeTextHash))
      .collect();
    if (!rows.some((a) => a.eventType === "llm.fallback")) {
      throw new Error(`no llm.fallback audit for ${safeTextHash.slice(0, 8)}`);
    }
    return { ok: true };
  },
});

// ── 03.1-04 fan-out delivery assertions (SC4/SC5) ────────────────────────────

/** SC4: every non-failure recipient row reached a delivery outcome (awaiting_reauth
 *  offline, or sent with a token) — the fan-out loop touched all of them. */
export const assertFanoutReachedAll = internalQuery({
  args: { correlationIds: v.array(v.string()), failCid: v.string() },
  handler: async (ctx, { correlationIds, failCid }) => {
    let reached = 0;
    for (const cid of correlationIds) {
      if (cid === failCid) continue;
      const req = await ctx.db
        .query("requests")
        .withIndex("by_correlation", (q) => q.eq("correlationId", cid))
        .first();
      if (!req) throw new Error(`fanout: no request for ${cid}`);
      if (req.status !== "awaiting_reauth" && req.status !== "sent") {
        throw new Error(
          `fanout recipient ${cid} at "${req.status}", expected awaiting_reauth|sent`,
        );
      }
      reached++;
    }
    return { ok: true, reached };
  },
});

/** SC5 isolation: the ONE forced-failure row dead-lettered (deadLetters + deadletter.written
 *  audit + status=failed + one failed telemetry row) WHILE no sibling dead-lettered. */
export const assertRecipientDeadLettered = internalQuery({
  args: { correlationId: v.string(), siblingCids: v.array(v.string()) },
  handler: async (ctx, { correlationId, siblingCids }) => {
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const row = news.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no deadLetters row for forced-fail ${correlationId}`);
    if (!row.error.includes("SMOKE_FAILURE")) {
      throw new Error(`deadLetters error missing SMOKE_FAILURE: ${row.error}`);
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    if (!audits.some((a) => a.eventType === "deadletter.written")) {
      throw new Error(`no deadletter.written audit for ${correlationId}`);
    }

    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "failed") {
      throw new Error(`forced-fail ${correlationId} at "${req.status}", expected failed`);
    }

    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!tel || tel.reviewOutcome !== "failed") {
      throw new Error(`no failed telemetry row for ${correlationId}`);
    }

    // The isolation assertion: a sibling's send failing would collapse per-recipient
    // isolation — none of them may have dead-lettered.
    for (const sib of siblingCids) {
      if (news.some((r) => r.correlationId === sib)) {
        throw new Error(
          `isolation breach: sibling ${sib} dead-lettered alongside ${correlationId}`,
        );
      }
    }
    return { ok: true };
  },
});

/** SC4 idempotency: each recipient has at most ONE terminal telemetry row (write-once —
 *  a step replay never doubles it). The double-approve CAS lives in executePlan (plan 07). */
export const assertFanoutIdempotent = internalQuery({
  args: { correlationIds: v.array(v.string()) },
  handler: async (ctx, { correlationIds }) => {
    for (const cid of correlationIds) {
      const tels = await ctx.db
        .query("telemetry")
        .withIndex("by_correlation", (q) => q.eq("correlationId", cid))
        .collect();
      if (tels.length > 1) {
        throw new Error(
          `recipient ${cid} has ${tels.length} telemetry rows — terminal not write-once`,
        );
      }
    }
    return { ok: true };
  },
});

/** SC5 redaction: NO raw email content (subject/body/recipient) in any audit/DLQ/telemetry
 *  row for the fan-out. Scans by each recipient cid; needle values are never echoed (index
 *  only) so this assertion cannot itself leak. */
export const assertNoRawPiiFanout = internalQuery({
  args: { correlationIds: v.array(v.string()), needles: v.array(v.string()) },
  handler: async (ctx, { correlationIds, needles }) => {
    const cidSet = new Set(correlationIds);
    const dls = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const blobs: string[] = [];
    for (const cid of correlationIds) {
      const audits = await ctx.db
        .query("audit")
        .withIndex("by_correlation", (q) => q.eq("correlationId", cid))
        .collect();
      for (const a of audits) blobs.push(JSON.stringify(a));
      const tel = await ctx.db
        .query("telemetry")
        .withIndex("by_correlation", (q) => q.eq("correlationId", cid))
        .first();
      if (tel) blobs.push(JSON.stringify(tel));
    }
    for (const r of dls) if (cidSet.has(r.correlationId)) blobs.push(JSON.stringify(r));

    for (let n = 0; n < needles.length; n++) {
      const needle = needles[n];
      if (needle && blobs.some((b) => b.includes(needle))) {
        throw new Error(`RAW PII leak: needle #${n} found in a fan-out log plane`);
      }
    }
    return { ok: true, scanned: blobs.length };
  },
});

// ── 03.3-06 attachment fan-out assertions (CKPT-02 / V6, V8) ──────────────────

/** V6: the ONE generated document set fanned to EVERY recipient — every row carries the SAME
 *  single shared attachment ref (no per-recipient duplication). Proves the attachment rode the
 *  governed fan-out to all recipients (executePlan's materialization is unit-tested; this is the
 *  live delivery-plane proof). */
export const assertFanoutAttachmentShared = internalQuery({
  args: { correlationIds: v.array(v.string()) },
  handler: async (ctx, { correlationIds }) => {
    const refs = new Set<string>();
    for (const cid of correlationIds) {
      const req = await ctx.db
        .query("requests")
        .withIndex("by_correlation", (q) => q.eq("correlationId", cid))
        .first();
      if (!req) throw new Error(`fanout-attach: no request for ${cid}`);
      if (req.attachmentRefs.length !== 1) {
        throw new Error(
          `fanout-attach: ${cid} carries ${req.attachmentRefs.length} refs, expected 1 (shared attachment)`,
        );
      }
      refs.add(String(req.attachmentRefs[0]));
    }
    if (refs.size !== 1) {
      throw new Error(
        `fanout-attach: ${refs.size} distinct attachment refs across rows, expected 1 (shared)`,
      );
    }
    return { ok: true, sharedRef: [...refs][0] };
  },
});

/** CKPT-03 (03.4-04): the INVERSE of assertFanoutAttachmentShared — per-recipient personalization
 *  fans DISTINCT bodies under a SHARED subject. Every row's `draft` is unique (no two recipients got
 *  the same tailored body) AND every row's subject (`goal`, minus the delivery-only SMOKE::fail
 *  prefix) is identical (one shared subject). Proves the distinct-body seed rode the governed fan-out
 *  to per-recipient rows (executePlan's seed is unit-tested; this is the live delivery-plane proof). */
export const assertFanoutBodiesDistinct = internalQuery({
  args: { correlationIds: v.array(v.string()) },
  handler: async (ctx, { correlationIds }) => {
    const drafts: string[] = [];
    const subjects = new Set<string>();
    for (const cid of correlationIds) {
      const req = await ctx.db
        .query("requests")
        .withIndex("by_correlation", (q) => q.eq("correlationId", cid))
        .first();
      if (!req) throw new Error(`fanout-bodies: no request for ${cid}`);
      drafts.push(req.draft ?? "");
      // Strip the delivery-only SMOKE::fail sentinel so the SHARED subject is what's compared.
      subjects.add((req.goal ?? "").replace(/^SMOKE::fail /, ""));
    }
    if (new Set(drafts).size !== drafts.length) {
      throw new Error(
        `fanout-bodies: drafts not all distinct (${drafts.length} rows, ${new Set(drafts).size} unique) — personalization must give each recipient its OWN body`,
      );
    }
    if (subjects.size !== 1) {
      throw new Error(
        `fanout-bodies: ${subjects.size} distinct subjects across rows, expected 1 (shared subject)`,
      );
    }
    return { ok: true, distinct: drafts.length };
  },
});

/** V8: a governed stop (kill switch / budget) during attachment GENERATION paused as data —
 *  NO attachment was stored on the plan, NO attachmentError set, and NO deadLetters row exists
 *  for the tenant (a pause never touches the DLQ). */
export const assertNoAttachmentStored = internalQuery({
  args: { planId: v.id("plans"), tenantId: v.string() },
  handler: async (ctx, { planId, tenantId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan) throw new Error(`no plan ${planId}`);
    if ((plan.attachments ?? []).length !== 0) {
      throw new Error(
        `plan ${planId} stored ${plan.attachments?.length} attachment(s) under a governed stop`,
      );
    }
    if (plan.attachmentError !== undefined) {
      throw new Error(
        `plan ${planId} set attachmentError under a governed stop (expected a clean pause)`,
      );
    }
    const dls = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    if (dls.some((r) => r.tenantId === tenantId)) {
      throw new Error(
        `deadLetters row for ${tenantId} — a governed pause during generation must not dead-letter`,
      );
    }
    return { ok: true };
  },
});

// ── 03.6-04 golden-set eval standing invariants (EVAL-01) ─────────────────────

/** EVAL-01 standing invariants, checked after EVERY eval case for the throwaway
 *  eval tenant: (1) ZERO `requests` rows — structural zero-send proof (only the
 *  human-only executePlan seeds requests rows, and the eval never approves);
 *  (2) refs-only needle scan — no fixture needle (recipient addresses, names)
 *  appears in any audit/deadLetters/telemetry row for the tenant (§4). Needle
 *  values are NEVER echoed back — only their index — mirroring assertNoRawPii.
 *  The eval tenant is throwaway-per-run, so these tenant-prefix reads are tiny. */
export const assertEvalCaseClean = internalQuery({
  args: { tenant: v.string(), needles: v.array(v.string()) },
  handler: async (ctx, { tenant, needles }) => {
    // 1. Zero requests rows for the tenant (tenantId-prefix read across all statuses).
    const reqs = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenant))
      .collect();
    if (reqs.length !== 0) {
      throw new Error(
        `eval tenant ${tenant} has ${reqs.length} requests row(s) — a send path was reached (zero-send invariant broken)`,
      );
    }

    // 2. Needle scan across the three log planes (refs-only §4).
    const audits = await ctx.db
      .query("audit")
      .withIndex("by_tenant_ts", (q) => q.eq("tenantId", tenant))
      .collect();
    const dls = await ctx.db
      .query("deadLetters")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant))
      .collect();
    const tels = await ctx.db
      .query("telemetry")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenant))
      .collect();
    // 27-08: `workflowPackEvents` joins the scan. It is the newest structured-log plane and the one
    // Phase 27 adds rows to on every pack run — and it is classified `audit_immutable`, so a field
    // that ever carried raw user content could never be corrected or erased afterwards. A leak
    // check that stops at the three older planes would certify exactly the plane that matters least.
    const packs = await ctx.db
      .query("workflowPackEvents")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", tenant))
      .collect();
    const planes: Array<[string, string[]]> = [
      ["audit", audits.map((r) => JSON.stringify(r))],
      ["deadLetters", dls.map((r) => JSON.stringify(r))],
      ["telemetry", tels.map((r) => JSON.stringify(r))],
      ["workflowPackEvents", packs.map((r) => JSON.stringify(r))],
    ];
    let rowsScanned = 0;
    for (const [table, blobs] of planes) {
      rowsScanned += blobs.length;
      for (let n = 0; n < needles.length; n++) {
        const needle = needles[n];
        if (needle && blobs.some((b) => b.includes(needle))) {
          throw new Error(
            `refs-only leak: needle #${n} found in ${table} for eval tenant ${tenant}`,
          );
        }
      }
    }
    return { ok: true, requestsCount: 0, rowsScanned };
  },
});

/** OPSG-06: the first migration ran and recorded a completed (success) state. */
export const assertMigrationRan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [status] = await migrations.getStatus(ctx, {
      migrations: ["migrations:backfillRequestDefaults"],
      limit: 1,
    });
    if (!status) {
      throw new Error("backfillRequestDefaults has no recorded state — the migration never ran");
    }
    if (status.state !== "success" || !status.isDone) {
      throw new Error(
        `migration not complete: state=${status.state} isDone=${status.isDone} processed=${status.processed}`,
      );
    }
    return { ok: true, name: status.name, processed: status.processed, state: status.state };
  },
});

/**
 * 23-04 (SKILL-02): the AUTHORING-STATE ORACLE the golden runner reads instead of assistant prose.
 *
 * A fixture that asserted "the reply mentions a skill update" would pass on a model that said the
 * words and wrote nothing, and fail on a model that wrote the row and phrased it differently. The
 * only trustworthy oracle for an authoring case is the DURABLE STATE, scoped to the exact turn.
 *
 * REFS, COUNTS, ENUMS AND BOOLEANS ONLY (CLAUDE.md §4). It never returns `body` or `authoredBody`:
 * the runner writes this snapshot into its console output and its own assertions, and a fixture's
 * adversarial needle or a live registry prompt appearing there would put both in the run log.
 *
 * Scoped by `sourceThreadId` because that is what a fixture case owns — one eval case is one
 * thread. `sourceTurnId` narrows further when the caller knows it.
 */
export const agentAuthoringStateForThread = internalQuery({
  args: {
    tenantId: v.string(),
    sourceThreadId: v.string(),
    sourceTurnId: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, sourceThreadId, sourceTurnId }) => {
    const rows = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_source_turn", (q) =>
        sourceTurnId === undefined
          ? q.eq("tenantId", tenantId).eq("sourceThreadId", sourceThreadId)
          : q
              .eq("tenantId", tenantId)
              .eq("sourceThreadId", sourceThreadId)
              .eq("sourceTurnId", sourceTurnId),
      )
      .collect();

    // Every tenant row, so "the active row did not move" is answerable without a second read.
    const all = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const active = all.filter((r) => r.status === "active");

    // The zero-send invariant, per tenant: an authoring turn must never reach a send path.
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId))
      .collect();

    // The POSITIVE WITNESS every absence assertion in the runner pairs with: did the tool actually
    // RUN this turn? A bound or an absence on a turn where the model never called the tool asserts
    // nothing, and that is the one way an authoring gate goes quietly green forever.
    // `by_tenant_tool_startedAt`, NOT a thread index: `agentSteps` has none, and this prefix is
    // tighter anyway — one tenant's authoring steps only. The thread filter runs in code over that
    // already-tiny set. (Each authoring fixture gets its own throwaway tenant, so this is a handful
    // of rows, never the trace of a whole run.)
    const steps = await ctx.db
      .query("agentSteps")
      .withIndex("by_tenant_tool_startedAt", (q) =>
        q.eq("tenantId", tenantId).eq("tool", "authorSkillCandidate"),
      )
      .collect();
    const authoringToolCalls = steps.filter((r) => r.threadId === sourceThreadId).length;

    return {
      authoringToolCalls,
      // What THIS turn authored.
      candidateCount: rows.length,
      candidates: rows.map((r) => ({
        tenantSkillId: String(r._id),
        name: r.name,
        version: r.version,
        status: r.status,
        author: r.author,
        authorAgentId: r.authorAgentId ?? null,
        sourceTurnId: r.sourceTurnId ?? null,
        rollbackEligible: r.rollbackEligible,
        // PRESENCE, never content: raw evidence carries held-out fixture ids, and an approval
        // record carries an owner's user id. Both are booleans here on purpose.
        hasEvidence: r.evidence !== undefined,
        hasOwnerApproval: r.ownerApproval !== undefined,
      })),
      // The tenant's whole overlay, as refs — the "nothing went live" half.
      activeCount: active.length,
      activeIds: active.map((r) => String(r._id)).sort(),
      totalRowCount: all.length,
      // The outward-effect half.
      requestCount: requests.length,
    };
  },
});

/**
 * WHICH SKILL BODIES A RUN ACTUALLY LOADED — the observation `run-eval-golden.mjs` was missing.
 *
 * THE HOLE THIS CLOSES. The runner built its evidence row from `skillVersionsOf(pins)` — the
 * caller's own claim about what it asked for — and never asked whether that body was reached. A
 * green, unfiltered, non-empty run therefore wrote `pass: true` certifying a body it never loaded,
 * which is a certificate manufactured for work that did not happen. It is why two Phase-29 skills
 * were EXEMPTED from `GATED_SKILLS` rather than left behind a gate that only looked like protection.
 *
 * WHAT MAKES THIS AN OBSERVATION RATHER THAN AN ECHO. Every row read here is written from a skill
 * row that was actually fetched out of the registry and whose `body` string went to the provider:
 * `agent.skill_loaded` from the cockpit loop, `subagent.completed` from `runSpecialistTurn`. None
 * of them is derived from the `skillVersions` / `tenantSkillIds` argument the caller supplied — if
 * they were, checking a pin against them would prove nothing at all, which is the trap this
 * function exists to avoid. `skillBodyHash` is the strongest field: it identifies the exact string
 * that ran, so it can catch a version number that is right about a body that changed underneath it.
 *
 * Scoped by TENANT because the eval runner uses one throwaway tenant per run (`eval-<runId>`), so
 * "did this run exercise the pinned body at all" is exactly a tenant-scoped question.
 *
 * REFS AND COUNTS ONLY (§4): names, version numbers, a scope enum, a row id and a hash.
 */
export const observedSkillLoads = internalQuery({
  args: { tenant: v.string() },
  handler: async (ctx, { tenant }) => {
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_tenant_ts", (q) => q.eq("tenantId", tenant))
      .collect();

    const seen = new Map<
      string,
      {
        name: string;
        version: number;
        scope: "global" | "tenant" | "unknown";
        skillId: string | null;
        bodyHash: string | null;
        pinned: boolean;
        loads: number;
      }
    >();

    for (const row of rows) {
      // The two planes that record a body they actually loaded. Any other event type is a claim
      // about something else and must not be mistaken for an observation.
      if (row.eventType !== "agent.skill_loaded" && row.eventType !== "subagent.completed")
        continue;
      const p = row.payload as {
        skillName?: unknown;
        skillVersion?: unknown;
        skillScope?: unknown;
        skillId?: unknown;
        skillBodyHash?: unknown;
        pinned?: unknown;
      } | null;
      // A row missing either half of the identity is NOT evidence. `subagent.completed` predates
      // the attribution fields and older rows genuinely lack them — skipping is correct and
      // fail-closed: an unidentifiable load can never satisfy a pin.
      if (typeof p?.skillName !== "string" || typeof p?.skillVersion !== "number") continue;

      const key = `${p.skillName}@${p.skillVersion}`;
      const prior = seen.get(key);
      seen.set(key, {
        name: p.skillName,
        version: p.skillVersion,
        scope:
          p.skillScope === "global" || p.skillScope === "tenant"
            ? p.skillScope
            : (prior?.scope ?? "unknown"),
        skillId: typeof p.skillId === "string" ? p.skillId : (prior?.skillId ?? null),
        bodyHash: typeof p.skillBodyHash === "string" ? p.skillBodyHash : (prior?.bodyHash ?? null),
        // Sticky: one pinned load in the run is what the gate asks about.
        pinned: prior?.pinned === true || p.pinned === true,
        loads: (prior?.loads ?? 0) + 1,
      });
    }

    return {
      tenant,
      // Sorted so the runner's failure message is stable and diffable between runs.
      loaded: [...seen.values()].sort((a, b) =>
        a.name === b.name ? a.version - b.version : a.name < b.name ? -1 : 1,
      ),
      auditRowsScanned: rows.length,
    };
  },
});
