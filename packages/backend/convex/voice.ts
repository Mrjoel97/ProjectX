// Plan-06 VOIC-02/VOIC-03: the server-side voice-session engine — a THIN adapter (§1) over the
// pure @pikar/voice FSM/cap math + the in-repo scheduler/CAS/ingest precedents. Domain logic
// (capEndsAt, isEnded) lives in @pikar/voice; @pikar/cost prices the metering; this file only
// reads/writes the `voiceSessions` row and orchestrates.
//
// The load-bearing invariant: EVERY session — clean or abnormal (gone tab) — is capped at 15 min
// by ONE durable watchdog armed once at start (scheduler.runAt, the cockpit deferred-send precedent),
// force-terminated via voiceToken.hangupCall, and always yields a vault-indexed brief. Session
// audit rows carry {sessionId} + counts ONLY — never the transcript, the callId-as-secret, or the
// client secret (CLAUDE.md §4). The brief BODY keeps PII (it is vault content, not a log).
import { priceRealtime } from "@pikar/cost";
import { categoryFor } from "@pikar/vault";
import { capEndsAt, isEnded } from "@pikar/voice";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { workflow } from "./index";
import { tenantMutation } from "./lib/functions";
import { contentHash } from "./lib/hash";

// ── Reads (parallel-session guard + brief resolvers) ─────────────────────────

/** The single active session row for a tenant (by_tenant_status) — the parallel-session guard's
 *  read, and null when none is live. Internal: startSession consults it before opening a new one. */
export const getActiveSession = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("voiceSessions")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
      .first();
  },
});

/** The session row by id (storeBrief reader). Carries the tenantId + language + briefRef the brief
 *  path needs; refs/counts only (no transcript is ever stored on this row — §4). */
export const getSession = internalQuery({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }) => await ctx.db.get(sessionId),
});

// ── Start (persist callId + arm the ONE watchdog) ────────────────────────────

/**
 * Open a live session (VOIC-02). The row is "active" ONLY WITH a callId (Pitfall 1 — the watchdog's
 * force-terminate has nothing to target otherwise). Parallel guard: a pre-existing active session is
 * force-ended first (cancel its watchdog + schedule its abnormal end) so a tenant never runs two.
 * Arms exactly ONE scheduler.runAt(endsAt, forceEndSession) — armed once, never re-armed (the cap is
 * a wall-clock bound a hung client cannot stall). Emits a refs-only session_started audit.
 */
export const startSession = tenantMutation({
  args: { callId: v.string(), language: v.optional(v.string()) },
  handler: async (ctx, { callId, language }): Promise<{ sessionId: Id<"voiceSessions"> }> => {
    // Parallel-session guard: force-end any prior active session before opening a new one. It is
    // still `active` (watchdog pending) so cancelling its timer is safe (never a fired-id throw),
    // then its abnormal-end path (hangup + auto-store) runs asynchronously.
    const prior = await ctx.db
      .query("voiceSessions")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
      .first();
    if (prior) {
      if (prior.watchdogFnId) await ctx.scheduler.cancel(prior.watchdogFnId);
      await ctx.scheduler.runAfter(0, internal.voice.forceEndSession, { sessionId: prior._id });
    }

    const startedAt = Date.now();
    const endsAt = capEndsAt(startedAt);
    const sessionId = await ctx.db.insert("voiceSessions", {
      tenantId: ctx.tenantId,
      status: "active",
      callId,
      startedAt,
      endsAt,
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
      language,
      createdAt: startedAt,
    });
    // Arm the ONE durable watchdog (cockpit.executePlan deferred-send precedent). runAt(endsAt) so
    // the fire time IS the wall-clock cap; the cancellable handle is stored for the clean-end cancel.
    const watchdogFnId = await ctx.scheduler.runAt(endsAt, internal.voice.forceEndSession, {
      sessionId,
    });
    await ctx.db.patch(sessionId, { watchdogFnId });

    // Refs-only session_started audit: {sessionId} ONLY — never the callId (a secret handle, §4).
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: String(sessionId),
      eventType: "voice.session_started",
      actor: "user",
      payload: { sessionId },
    });
    return { sessionId };
  },
});

// ── End transitions (CAS) ────────────────────────────────────────────────────

/**
 * Clean-end CAS (User End / graceful 0:00): flip active → ended_clean, cancel the watchdog, and write
 * the refs-only session_ended audit. Returns null (no-op) if the session is already ended — the
 * status CAS is what keeps scheduler.cancel from throwing on an already-fired watchdog id (the
 * cockpit.cancelScheduledPlan Pitfall). Idempotent: a second clean end no-ops.
 */
export const markEndedClean = internalMutation({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }): Promise<{ ended: true } | null> => {
    const s = await ctx.db.get(sessionId);
    if (!s || isEnded(s.status)) return null; // CAS no-op (already ended / fire race)
    if (s.watchdogFnId) await ctx.scheduler.cancel(s.watchdogFnId); // safe: status still active ⇒ pending id
    await ctx.db.patch(sessionId, { status: "ended_clean" });
    await ctx.runMutation(internal.audit.log, {
      tenantId: s.tenantId,
      correlationId: String(sessionId),
      eventType: "voice.session_ended",
      actor: "user",
      // refs/counts ONLY (§4): the token totals are counts, never transcript/secret.
      payload: {
        sessionId,
        outcome: "clean",
        inAudioTok: s.inAudioTok,
        outAudioTok: s.outAudioTok,
        textInTok: s.textInTok,
        textOutTok: s.textOutTok,
      },
    });
    return { ended: true };
  },
});

/**
 * Abnormal-end CAS (watchdog fire / parallel-guard): flip active → ended_abnormal and write the
 * refs-only session_ended audit; returns the stored callId so the caller can hangup, or null if the
 * session already ended (a clean end won the 0:00 race). NEVER cancels a timer — the watchdog is the
 * one executing this path (the parallel guard cancels the prior timer BEFORE scheduling this).
 */
export const markEndedAbnormal = internalMutation({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }): Promise<{ callId?: string } | null> => {
    const s = await ctx.db.get(sessionId);
    if (!s || isEnded(s.status)) return null; // CAS no-op (clean end won the race)
    await ctx.db.patch(sessionId, { status: "ended_abnormal" });
    await ctx.runMutation(internal.audit.log, {
      tenantId: s.tenantId,
      correlationId: String(sessionId),
      eventType: "voice.session_ended",
      actor: "system",
      payload: {
        sessionId,
        outcome: "abnormal",
        inAudioTok: s.inAudioTok,
        outAudioTok: s.outAudioTok,
        textInTok: s.textInTok,
        textOutTok: s.textOutTok,
      },
    });
    return { callId: s.callId };
  },
});

/**
 * The user's graceful End (VOIC-02). CAS-cancels the watchdog and, once ended, ingests the reviewed
 * brief markdown as a vault doc. A no-op if the watchdog already force-ended the session (the abnormal
 * path already auto-stored). ponytail: a tenantMutation, not an action — the client already composed
 * the markdown (no draftVoiceBrief model call needed), so persistBrief runs inline via runMutation.
 */
export const endSessionClean = tenantMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    // The reviewed/edited brief markdown from the summary screen (RESEARCH Pattern 6). Optional so a
    // bare end still transitions + audits; when present it is ingested as the session's brief.
    editedMarkdown: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { sessionId, editedMarkdown },
  ): Promise<{ ok: true; alreadyEnded?: true }> => {
    const s = await ctx.db.get(sessionId);
    if (!s || s.tenantId !== ctx.tenantId) throw new Error("voice: session not found"); // no cross-tenant
    const ended = await ctx.runMutation(internal.voice.markEndedClean, { sessionId });
    if (!ended) return { ok: true, alreadyEnded: true }; // watchdog already fired
    if (editedMarkdown)
      await ctx.runMutation(internal.voice.persistBrief, { sessionId, markdown: editedMarkdown });
    return { ok: true };
  },
});

/**
 * Client-initiated abnormal end (VOIC-01 mic-loss / silence fall-through). `forceEndSession` is an
 * internalAction the browser cannot call, so this is the thin tenant-guarded gateway to it — it does
 * NOT re-implement the abnormal path, it just schedules the SAME actuator the parallel guard already
 * schedules (hangup + auto-store brief; the watchdog is never re-armed). Mirrors startSession's own
 * `scheduler.runAfter(0, internal.voice.forceEndSession, …)`. Idempotent by construction: a second
 * call schedules a second forceEndSession whose markEndedAbnormal CAS no-ops on an already-ended row.
 */
export const abortSession = tenantMutation({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }): Promise<{ ok: true }> => {
    const s = await ctx.db.get(sessionId);
    if (!s || s.tenantId !== ctx.tenantId) throw new Error("voice: session not found"); // no cross-tenant
    await ctx.scheduler.runAfter(0, internal.voice.forceEndSession, { sessionId });
    return { ok: true };
  },
});

/**
 * The watchdog actuator (VOIC-02) — armed by startSession, fires at endsAt or immediately from the
 * parallel guard / client beacon. CAS-flips the session to ended_abnormal (no-op if a clean end won),
 * force-terminates the OpenAI call, then auto-stores a brief (no human present to gate). A failed
 * hangup is swallowed refs-only — the session is already marked ended and the brief must still store.
 */
export const forceEndSession = internalAction({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }): Promise<{ ended: true } | { noop: true }> => {
    const flipped = await ctx.runMutation(internal.voice.markEndedAbnormal, { sessionId });
    if (!flipped) return { noop: true }; // CAS no-op — already ended
    if (flipped.callId) {
      try {
        await ctx.runAction(internal.voiceToken.hangupCall, { callId: flipped.callId });
      } catch {
        // Refs-only: the hangup status is not re-thrown — a gone/already-ended call must not block
        // the brief. The 15-min cap is already enforced by the abnormal-end transition above.
      }
    }
    // Auto-store: no transcript is available for a gone-tab fire, so draftVoiceBrief runs over an
    // empty transcript → a minimal brief the user reviews on next open (RESEARCH Pitfall 3, beta).
    // ponytail: empty-transcript brief; upgrade path is a client beacon carrying the last transcript.
    await ctx.runAction(internal.voice.storeBrief, { sessionId });
    return { ended: true };
  },
});

// ── Metering (VOIC-02) ───────────────────────────────────────────────────────

/**
 * Fold one response.done usage delta into the session's cumulative counters and price the DELTA onto
 * the existing daily-spend rails (priceRealtime → recordSpend). Metering is telemetry + a best-effort
 * budget contribution — the 15-min wall-clock cap is the real cost bound (RESEARCH Pattern 4), so no
 * server-side reconciliation. Fails CLOSED: a non-finite/negative delta patches nothing and records no
 * spend (priceRealtime returns Err), so metering can never write a NaN counter or a negative charge.
 */
export const recordUsage = tenantMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    inAudioTok: v.number(),
    outAudioTok: v.number(),
    textInTok: v.number(),
    textOutTok: v.number(),
  },
  handler: async (
    ctx,
    { sessionId, inAudioTok, outAudioTok, textInTok, textOutTok },
  ): Promise<{ ok: boolean }> => {
    const s = await ctx.db.get(sessionId);
    if (!s || s.tenantId !== ctx.tenantId) throw new Error("voice: session not found");
    // Fail closed BEFORE any write — a bad delta never mutates a counter (no negative/NaN spend).
    const priced = priceRealtime(inAudioTok, outAudioTok, textInTok, textOutTok);
    if (!priced.ok) return { ok: false };
    await ctx.db.patch(sessionId, {
      inAudioTok: s.inAudioTok + inAudioTok,
      outAudioTok: s.outAudioTok + outAudioTok,
      textInTok: s.textInTok + textInTok,
      textOutTok: s.textOutTok + textOutTok,
    });
    await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
    return { ok: true };
  },
});

// ── Brief → vault (VOIC-03) ──────────────────────────────────────────────────

/**
 * Ingest brief markdown as an ordinary vault document (vault.ts text-first precedent). The `text`
 * carries PII by design — it is vault CONTENT, not a log (§4): do NOT scanText-strip it. Idempotent
 * on the session's briefRef (a re-store returns the existing doc). Shared by the clean + abnormal
 * paths (endSessionClean runs it inline; storeBrief runs it after draftVoiceBrief).
 */
export const persistBrief = internalMutation({
  args: { sessionId: v.id("voiceSessions"), markdown: v.string() },
  handler: async (ctx, { sessionId, markdown }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const s = await ctx.db.get(sessionId);
    if (!s) throw new Error("voice: session not found");
    if (s.briefRef) return { vaultDocId: s.briefRef }; // idempotent — already stored
    const hash = await contentHash(markdown);
    const vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId: s.tenantId,
      title: `Voice brief — ${new Date().toISOString().slice(0, 10)}`,
      kind: "brief",
      category: categoryFor({ source: "agent" }), // workspace-docs — a generated brief, not an upload
      source: "voice",
      mimeType: "text/markdown",
      size: new TextEncoder().encode(markdown).length,
      contentHash: hash,
      text: markdown, // PII kept — content plane (§4); ingestDoc redacts only the vector
      status: "processing",
      createdAt: Date.now(),
    });
    const correlationId = crypto.randomUUID();
    await workflow.start(ctx, internal.vaultIngest.ingestDoc, {
      vaultDocId,
      tenantId: s.tenantId,
      correlationId,
    });
    await ctx.db.patch(sessionId, { briefRef: vaultDocId });
    return { vaultDocId };
  },
});

// The brief stored when a session is force-ended with NO captured transcript (a gone-tab abnormal
// end — the transcript is never server-stored, §4). ponytail: a fixed placeholder, not an
// empty-transcript model call (drafting over "" is a wasted spend for a degenerate input); the
// upgrade path is a client beacon (pagehide + sendBeacon) carrying the last transcript to storeBrief.
const ABANDONED_BRIEF_MD =
  "# Voice brief\n\nThe session ended before a transcript could be captured (the tab closed or the " +
  "15-minute cap was reached with no client connected). No summary is available.";

/**
 * Draft-or-use → ingest the session's brief (VOIC-03). editedMarkdown (clean end) is ingested
 * verbatim; a captured transcript is drafted via draftVoiceBrief; a gone-tab abnormal end with
 * neither stores ABANDONED_BRIEF_MD (never a model call over nothing). Idempotent on briefRef. The
 * SMOKE:: transcript path drives brief → ingest → vault "ready" offline (draftVoiceBrief's sentinel).
 */
export const storeBrief = internalAction({
  args: {
    sessionId: v.id("voiceSessions"),
    editedMarkdown: v.optional(v.string()),
    transcript: v.optional(v.array(v.object({ speaker: v.string(), text: v.string() }))),
    language: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { sessionId, editedMarkdown, transcript, language },
  ): Promise<{ vaultDocId: Id<"vaultDocuments"> } | { skipped: true }> => {
    const s = await ctx.runQuery(internal.voice.getSession, { sessionId });
    if (!s) return { skipped: true };
    if (s.briefRef) return { vaultDocId: s.briefRef }; // idempotent — already stored
    let markdown: string;
    if (editedMarkdown !== undefined) {
      markdown = editedMarkdown; // clean end — the client already composed/edited it
    } else if (transcript && transcript.length > 0) {
      markdown = await ctx.runAction(internal.llm.draftVoiceBrief, {
        tenantId: s.tenantId,
        transcript,
        language: language ?? s.language ?? "en",
      });
    } else {
      markdown = ABANDONED_BRIEF_MD; // gone-tab abnormal end — no transcript to draft over
    }
    return await ctx.runMutation(internal.voice.persistBrief, { sessionId, markdown });
  },
});
