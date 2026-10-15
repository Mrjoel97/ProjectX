import { getAuthUserId } from "@convex-dev/auth/server";
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
import { capEndsAt, DEFAULT_REALTIME_MODEL, isEnded } from "@pikar/voice";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { internalAction, internalMutation } from "./lib/tenantLifecycle";
import { startIngest } from "./vaultIngest";

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
 *
 * DOCV-01: an optional `docRef` scopes the session to exactly ONE vault report. This is the TRUST
 * BOUNDARY for that scope — 14-07's document picker is a courtesy, not a gate. The locked CONTEXT
 * decision "never burn capped 15-minute time discussing a document the agent cannot actually see"
 * is only true if the SERVER refuses a non-ready or cross-tenant document.
 */
export const startSession = internalMutation({
  args: {
    tenantId: v.optional(v.string()),
    controlled: v.optional(v.boolean()),
    callId: v.string(),
    reservationId: v.optional(v.id("spendEvents")),
    onboarding: v.optional(v.boolean()),
    language: v.optional(v.string()),
    // The ONE report under discussion (DOCV-01). Optional — the Phase-6 path is unchanged without it.
    docRef: v.optional(v.id("vaultDocuments")),
  },
  handler: async (
    ctx,
    { callId, language, docRef, reservationId, onboarding, tenantId: suppliedTenant, controlled },
  ): Promise<{ sessionId: Id<"voiceSessions"> }> => {
    const tenantId = suppliedTenant ?? String((await getAuthUserId(ctx)) ?? "");
    if (!tenantId) throw new Error("UNAUTHENTICATED");
    // Validate the doc scope BEFORE any write — never after. A rejected document must not leave an
    // `active` row holding a watchdog. Read straight off `ctx.db` (this file's own endSessionClean /
    // abortSession ownership idiom): `internal.vault.getDoc` carries no `status`, so it structurally
    // cannot answer the readiness half of this check.
    // Thrown messages are a STATUS, never content — no title, no text, no character count (§4).
    if (onboarding && docRef) throw new Error("voice: incompatible purpose");
    if (!reservationId) throw new Error("voice: reservation required");
    const reservation = await ctx.db.get(reservationId);
    if (
      !reservation ||
      reservation.tenantId !== tenantId ||
      reservation.kind !== "paid_call" ||
      reservation.phase !== "reserved" ||
      reservation.model !== DEFAULT_REALTIME_MODEL ||
      Date.now() - reservation.createdAt > 120000
    )
      throw new Error("voice: invalid reservation");
    if (
      await ctx.db
        .query("voiceSessions")
        .withIndex("by_spendReservationId", (q) => q.eq("spendReservationId", reservationId))
        .first()
    )
      throw new Error("voice: reservation already used");
    if (
      onboarding &&
      !(await ctx.db
        .query("foundationInterviews")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique())
    )
      throw new Error("voice: interview missing");
    if (docRef !== undefined) {
      const doc = await ctx.db.get(docRef);
      if (!doc || doc.tenantId !== tenantId) throw new Error("voicedoc: document not found");
      if (doc.status !== "ready" || !doc.text?.trim())
        throw new Error("voicedoc: document not ready");
    }

    // Parallel-session guard: force-end any prior active session before opening a new one. It is
    // still `active` (watchdog pending) so cancelling its timer is safe (never a fired-id throw),
    // then its abnormal-end path (hangup + auto-store) runs asynchronously.
    const prior = await ctx.db
      .query("voiceSessions")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
      .first();
    if (prior) {
      if (prior.watchdogFnId) await ctx.scheduler.cancel(prior.watchdogFnId);
      await ctx.scheduler.runAfter(0, internal.voice.forceEndSession, { sessionId: prior._id });
    }

    const startedAt = Date.now();
    const endsAt = controlled ? startedAt + 300_000 : capEndsAt(startedAt);
    const sessionId = await ctx.db.insert("voiceSessions", {
      tenantId: tenantId,
      status: "active",
      controlled,
      controlExpiresAt: controlled ? endsAt + 30 * 60_000 : undefined,
      callId,
      onboarding,
      spendReservationId: reservationId,
      startedAt,
      endsAt,
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
      language,
      ...(docRef && { docRef }),
      createdAt: startedAt,
    });
    // Arm the ONE durable watchdog (cockpit.executePlan deferred-send precedent). runAt(endsAt) so
    // the fire time IS the wall-clock cap; the cancellable handle is stored for the clean-end cancel.
    const watchdogFnId = await ctx.scheduler.runAt(endsAt, internal.voice.forceEndSession, {
      sessionId,
    });
    await ctx.db.patch(sessionId, { watchdogFnId });

    // Refs-only session_started audit: {sessionId} + at most the docRef — both IDS. Never the
    // callId (a secret handle), never the document title, text or a character count of it (§4).
    await ctx.runMutation(internal.audit.log, {
      tenantId: tenantId,
      correlationId: String(sessionId),
      eventType: "voice.session_started",
      actor: "user",
      payload: { sessionId, ...(docRef && { docRef }) },
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
    await ctx.scheduler.runAfter(30 * 60_000, internal.voice.clearTransientControl, { sessionId });
    if (s.callId) await ctx.scheduler.runAfter(0, internal.voice.terminateProvider, { sessionId });
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
    await ctx.scheduler.runAfter(30 * 60_000, internal.voice.clearTransientControl, { sessionId });
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
  ): Promise<{ ok: true; alreadyEnded?: true; vaultDocId?: Id<"vaultDocuments"> }> => {
    const s = await ctx.db.get(sessionId);
    if (!s || s.tenantId !== ctx.tenantId) throw new Error("voice: session not found"); // no cross-tenant
    const ended = await ctx.runMutation(internal.voice.markEndedClean, { sessionId });
    // Store the reviewed brief EVEN WHEN the CAS already flipped the session: the client calls End
    // (flips ended_clean + cancels the watchdog promptly, so no abnormal fire during review), THEN
    // the post-call review screen stores the edited markdown — that second call's markEndedClean
    // no-ops, but the brief must still persist. persistBrief is idempotent on briefRef, so a race
    // with the watchdog's auto-store never double-writes. A bare end (no markdown) keeps the original
    // CAS no-op — nothing to store — which the "clean end after abnormal" test still asserts.
    // The vaultDocId is returned so the review UI can mark this brief "reviewed" — it never re-surfaces
    // in the dropped-session banner (VOIC-03: the banner is for briefs the user has NOT yet seen).
    let vaultDocId: Id<"vaultDocuments"> | undefined;
    if (editedMarkdown && !s.onboarding) {
      const stored = await ctx.runMutation(internal.voice.persistBrief, {
        sessionId,
        markdown: editedMarkdown,
      });
      vaultDocId = stored.vaultDocId;
    }
    return {
      ok: true,
      ...(ended ? {} : { alreadyEnded: true as const }),
      ...(vaultDocId && { vaultDocId }),
    };
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
    // Provider termination has its own receipt. An ended UI status proves nothing about billing.
    await ctx.runAction(internal.voice.terminateProvider, { sessionId });
    if (!flipped) return { noop: true };
    // Auto-store: no transcript is available for a gone-tab fire, so draftVoiceBrief runs over an
    // empty transcript → a minimal brief the user reviews on next open (RESEARCH Pitfall 3, beta).
    // ponytail: empty-transcript brief; upgrade path is a client beacon carrying the last transcript.
    const session = await ctx.runQuery(internal.voice.getSession, { sessionId });
    if (!session?.onboarding) await ctx.runAction(internal.voice.storeBrief, { sessionId });
    return { ended: true };
  },
});

/** Acknowledged provider hangup, independently retried after clean/abnormal UI ends.
 * Exhausted attempts remain explicitly unresolved; never release a billing hold here. */
export const terminationReceipt = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    confirmed: v.boolean(),
    noRetry: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionId, confirmed, noRetry }) => {
    const s = await ctx.db.get(sessionId);
    if (!s || s.hangupConfirmedAt) return;
    const attempts = (s.hangupAttempts ?? 0) + 1;
    await ctx.db.patch(sessionId, {
      hangupAttempts: attempts,
      ...(confirmed
        ? { hangupConfirmedAt: Date.now(), hangupUnresolved: false }
        : { hangupUnresolved: true }),
    });
    if (!confirmed && !noRetry && attempts < 12)
      await ctx.scheduler.runAfter(
        Math.min(60_000, 1000 * 2 ** attempts),
        internal.voice.terminateProvider,
        { sessionId },
      );
  },
});

export const terminateProvider = internalAction({
  args: { sessionId: v.id("voiceSessions"), retryForErasure: v.optional(v.boolean()) },
  handler: async (ctx, { sessionId, retryForErasure }): Promise<void> => {
    const session = await ctx.runQuery(internal.voice.getSession, { sessionId });
    if (
      !session?.callId ||
      session.hangupConfirmedAt ||
      (!retryForErasure && (session.hangupAttempts ?? 0) >= 12)
    )
      return;
    let confirmed = false;
    try {
      await ctx.runAction(internal.voiceToken.hangupCall, { callId: session.callId });
      confirmed = true;
    } catch {
      /* Transport ambiguity retains the reservation and schedules a durable retry. */
    }
    await ctx.runMutation(internal.voice.terminationReceipt, {
      sessionId,
      confirmed,
      noRetry: retryForErasure,
    });
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
    if (s.controlled) return { ok: false }; // Browser events never alter trusted counters.
    // Fail closed BEFORE any write — a bad delta never mutates a counter (no negative/NaN spend).
    const priced = priceRealtime(inAudioTok, outAudioTok, textInTok, textOutTok);
    if (!priced.ok) return { ok: false };
    // FIN-01 correlation, read BEFORE the patch: the session's cumulative token count is the
    // offset of this fold in the session's token stream, and it is the discriminator. `sessionId`
    // alone would collapse EVERY response.done fold of one call into a single ledger row while the
    // limiter consumed each one — the ledger would sit below the limiter, the unrecoverable
    // direction. The counters only ever rise (priceRealtime refuses a negative), so a chargeable
    // second fold always lands on a different correlation; two consecutive zero-token folds share
    // one, and they cost nothing.
    const offset = s.inAudioTok + s.outAudioTok + s.textInTok + s.textOutTok;
    await ctx.db.patch(sessionId, {
      inAudioTok: s.inAudioTok + inAudioTok,
      outAudioTok: s.outAudioTok + outAudioTok,
      textInTok: s.textInTok + textInTok,
      textOutTok: s.textOutTok + textOutTok,
    });
    // Browser telemetry is not authoritative billing. Admission-held sessions keep their
    // conservative hold until trusted provider reconciliation, without double charging deltas.
    if (s.spendReservationId) return { ok: true };
    await ctx.runMutation(internal.guardrails.recordSpend, {
      tenantId: ctx.tenantId,
      costUsd: priced.value,
      // Derived, not a nonce: this is a MUTATION, so a re-run re-reads the counters inside the same
      // transaction and re-derives the same key — there is no re-entry that spends twice under it.
      correlationId: `voice:usage:${sessionId}:${offset}`,
      model: DEFAULT_REALTIME_MODEL,
      kind: "realtime",
    });
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
    await startIngest(ctx, { vaultDocId, tenantId: s.tenantId, correlationId });
    await ctx.db.patch(sessionId, { briefRef: vaultDocId });
    return { vaultDocId };
  },
});

// The brief stored when a session is force-ended with NO captured transcript (a gone-tab abnormal
// end — the transcript is never server-stored, §4). ponytail: a fixed placeholder, not an
// empty-transcript model call (drafting over "" is a wasted spend for a degenerate input); the
// upgrade path is a client beacon (pagehide + sendBeacon) carrying the last transcript to storeBrief.
const ABANDONED_BRIEF_MD =
  "Voice brief\n\nThe session ended before a transcript could be captured (the tab closed or the " +
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

export const controlState = tenantQuery({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    if (!s || s.tenantId !== ctx.tenantId) throw new Error("voice: session not found");
    return {
      status: s.status,
      ready: !!s.controlReady,
      events: s.controlEvents ?? [],
      offset: s.controlEventOffset ?? 0,
      endsAt: s.endsAt,
    };
  },
});
export const sendText = tenantMutation({
  args: { sessionId: v.id("voiceSessions"), text: v.string() },
  handler: async (ctx, { sessionId, text }) => {
    const s = await ctx.db.get(sessionId);
    if (
      !s ||
      s.tenantId !== ctx.tenantId ||
      !s.controlled ||
      s.status !== "active" ||
      s.endsAt <= Date.now()
    )
      throw new Error("VOICE_SESSION_INACTIVE");
    if (!text.trim() || text.length > 4000 || (s.controlCommands?.length ?? 0) >= 8)
      throw new Error("VOICE_INPUT_LIMIT");
    const seq = (s.controlCommandSeq ?? 0) + 1;
    if (seq > 80) throw new Error("VOICE_INPUT_LIMIT");
    await ctx.db.patch(sessionId, {
      controlCommandSeq: seq,
      controlCommands: [...(s.controlCommands ?? []), { seq, text }],
    });
  },
});
export const controlUpdate = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    ready: v.optional(v.boolean()),
    event: v.optional(v.string()),
    consumedSeq: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sessionId);
    if (!s?.controlled) return;
    const patch: {
      controlReady?: boolean;
      controlEvents?: string[];
      controlEventOffset?: number;
      controlCommands?: { seq: number; text: string }[];
    } = {};
    if (a.ready !== undefined) patch.controlReady = a.ready;
    if (a.event !== undefined) {
      if (a.event.length > 16000) throw new Error("VOICE_EVENT_LIMIT");
      const events = [...(s.controlEvents ?? []), a.event];
      patch.controlEvents = events.slice(-64);
      patch.controlEventOffset = (s.controlEventOffset ?? 0) + Math.max(0, events.length - 64);
    }
    if (a.consumedSeq !== undefined)
      patch.controlCommands = (s.controlCommands ?? []).filter((c) => c.seq > (a.consumedSeq ?? 0));
    await ctx.db.patch(a.sessionId, patch);
  },
});
export const recordTrustedUsage = internalMutation({
  args: {
    retainReservation: v.optional(v.boolean()),
    sessionId: v.id("voiceSessions"),
    responseId: v.string(),
    reservationId: v.id("spendEvents"),
    inAudioTok: v.number(),
    outAudioTok: v.number(),
    textInTok: v.number(),
    textOutTok: v.number(),
  },
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sessionId);
    if (!s?.controlled) throw new Error("VOICE_UNCONTROLLED");
    if (s.trustedResponseIds?.includes(a.responseId)) return;
    if ((s.trustedResponseIds?.length ?? 0) >= 20) throw new Error("VOICE_RESPONSE_LIMIT");
    const priced = priceRealtime(a.inAudioTok, a.outAudioTok, a.textInTok, a.textOutTok);
    if (!priced.ok) throw new Error("VOICE_USAGE_UNKNOWN");
    const held = await ctx.db.get(a.reservationId);
    if (
      !held ||
      held.tenantId !== s.tenantId ||
      held.kind !== "paid_call" ||
      held.phase !== "reserved"
    )
      throw new Error("VOICE_RESERVATION_INVALID");
    // A violated provider contract cannot justify releasing its conservative hold.
    // Known usage above the hold is still debited in full, never capped to admission.
    const retain = a.retainReservation && Math.ceil(priced.value * 100) <= held.amountCents;
    const settled = retain
      ? undefined
      : await ctx.runMutation(internal.guardrails.settlePaidCall, {
          tenantId: s.tenantId,
          reservationId: a.reservationId,
          costUsd: priced.value,
        });
    await ctx.db.patch(a.sessionId, {
      trustedResponseIds: [...(s.trustedResponseIds ?? []), a.responseId],
      inAudioTok: s.inAudioTok + a.inAudioTok,
      outAudioTok: s.outAudioTok + a.outAudioTok,
      textInTok: s.textInTok + a.textInTok,
      textOutTok: s.textOutTok + a.textOutTok,
    });
    if (a.retainReservation || settled?.breached)
      await ctx.scheduler.runAfter(0, internal.voice.forceEndSession, { sessionId: a.sessionId });
  },
});

export const clearTransientControl = internalMutation({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    if (s && s.status !== "active")
      await ctx.db.patch(sessionId, {
        controlEvents: undefined,
        controlCommands: undefined,
        controlExpiresAt: undefined,
      });
  },
});

export const sweepTransientControl = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("voiceSessions")
      .withIndex("by_controlExpiresAt", (q) =>
        q.gt("controlExpiresAt", 0).lte("controlExpiresAt", Date.now()),
      )
      .take(100);
    for (const s of expired) {
      await ctx.db.patch(s._id, {
        controlEvents: undefined,
        controlCommands: undefined,
        controlExpiresAt: undefined,
      });
      if (s.status === "active")
        await ctx.scheduler.runAfter(0, internal.voice.forceEndSession, { sessionId: s._id });
    }
    if (expired.length === 100)
      await ctx.scheduler.runAfter(0, internal.voice.sweepTransientControl, {});
  },
});
