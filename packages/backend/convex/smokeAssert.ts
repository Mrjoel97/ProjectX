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
      throw new Error(`pipeline ${correlationId} at "${req.status}", expected awaiting_reauth|sent`);
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
      throw new Error(`request ${correlationId} at "${req.status}", expected failed (no-stuck-status)`);
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
      throw new Error(`deadLetters row for ${correlationId} — a governed stop must not dead-letter`);
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
        throw new Error(`fanout recipient ${cid} at "${req.status}", expected awaiting_reauth|sent`);
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
        throw new Error(`isolation breach: sibling ${sib} dead-lettered alongside ${correlationId}`);
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
        throw new Error(`recipient ${cid} has ${tels.length} telemetry rows — terminal not write-once`);
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
      throw new Error(`fanout-attach: ${refs.size} distinct attachment refs across rows, expected 1 (shared)`);
    }
    return { ok: true, sharedRef: [...refs][0] };
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
      throw new Error(`plan ${planId} stored ${plan.attachments?.length} attachment(s) under a governed stop`);
    }
    if (plan.attachmentError !== undefined) {
      throw new Error(`plan ${planId} set attachmentError under a governed stop (expected a clean pause)`);
    }
    const dls = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    if (dls.some((r) => r.tenantId === tenantId)) {
      throw new Error(`deadLetters row for ${tenantId} — a governed pause during generation must not dead-letter`);
    }
    return { ok: true };
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
