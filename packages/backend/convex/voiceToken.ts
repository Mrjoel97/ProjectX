import { getAuthUserId } from "@convex-dev/auth/server";
import { foundationPilotExpiresAt } from "@pikar/core/foundationPilot";
// Server-owned Realtime signaling. connect is the only public entry point.
// Internal mint secrets never leave this module/server action chain; private registration
// arms termination before the browser receives answer SDP. See docs/playbooks/voice.md.

import { DOCUMENT_ANALYST_SKILL, VOICE_SESSION_SKILL } from "@pikar/contracts/skill";
import { SAVE_FOUNDATION_ANSWER_TOOL } from "@pikar/core/foundation";
import {
  buildDocDigest,
  CALLS_URL,
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  hangupUrl,
  SEARCH_DOCUMENT_TOOL,
  SESSION_TOOL_KEYS,
  TOOL_CHOICE_AUTO,
  TRANSCRIPTION_MODEL,
  TURN_DETECTION_TYPE,
} from "@pikar/voice";
import {
  assertMediaOnlyOffer,
  trustedCallId,
  VOICE_OUTPUT_TOKENS,
  VOICE_TRUNCATION,
} from "@pikar/voice/serverControl";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { internalAction } from "./lib/tenantLifecycle";

// ponytail: warm GA voice for gpt-realtime; the voice is a product/BRAND choice — swap the
// literal if the persona picks another (the INSTRUCTIONS load from the registry, §5, never here).
const REALTIME_VOICE = "marin";

// The mint 200 shape — LIVE-VERIFIED 2026-07-20 against a real POST: the ephemeral secret is the
// TOP-LEVEL `value` field (an `ek_…` string) with `expires_at` beside it — NOT `client_secret`, nor
// a nested `client_secret.value` (the pre-live pin guessed wrong both ways). Single reader of the shape.
type MintResponse = { value: string; expires_at: number };

/**
 * The four vault fields a doc-scoped mint needs, read tenant-scoped. `internal.vault.getDoc`
 * cannot serve this: it returns `{text, contentHash, title}` with **no `status`** and no
 * `extractionTruncated`, so it structurally cannot answer either the readiness half of the check
 * or the truncation disclosure — the same wrong premise 14-03 hit at `voice.startSession`.
 * `getDocForExtraction` carries `status` but no `text`. Two round-trips still miss `truncated`.
 *
 * Returns `null` (never throws) for a missing or cross-tenant id, so the MINT owns the thrown
 * message and both trust boundaries speak with one voice (`voicedoc: document not found`).
 * Carries raw `text` — content plane, consumed only by `buildDocDigest`, never logged (§4).
 */
export const docForMint = internalQuery({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (
    ctx,
    { vaultDocId, tenantId },
  ): Promise<{
    title: string;
    text: string | undefined;
    status: string;
    extractionTruncated: boolean;
  } | null> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== tenantId) return null; // fail-closed: cross-tenant reads as missing
    return {
      title: doc.title,
      text: doc.text,
      status: doc.status,
      extractionTruncated: Boolean(doc.extractionTruncated),
    };
  },
});

/**
 * Internal preparation of a short-lived Realtime client secret for server signaling, optionally
 * scoped to ONE vault report (DOCV-01).
 *
 * Unscoped it uses the `voice-session` REGISTRY persona and no tool array at all. Scoped it swaps
 * in the `document-analyst` persona, appends a bounded FENCED digest of that report, and declares
 * exactly one read-only retrieval tool. When the tenant has a confirmed business blueprint, both
 * modes also receive its bounded, fenced spine so the live conversation has the same standing
 * business context as the cockpit. Both personas are registry-loaded and fail closed when
 * unseeded — never a hardcoded prompt (§5).
 *
 * Returns a server-internal credential envelope — OPENAI_API_KEY stays in Convex env and never
 * enters this object, a thrown message, a log line, or an audit row (Pitfall 4).
 */
export const mintClientSecret = internalAction({
  args: {
    tenantId: v.optional(v.string()),
    docId: v.optional(v.id("vaultDocuments")),
    onboarding: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { docId, onboarding, tenantId: suppliedTenant },
  ): Promise<{
    clientSecret: string;
    expiresAt: number;
    toolsAtMint: boolean;
    reservationId: Id<"spendEvents">;
  }> => {
    const tenantId = suppliedTenant ?? String((await getAuthUserId(ctx)) ?? "");
    if (!tenantId) throw new Error("UNAUTHENTICATED");
    // Persona from the registry — fail-closed (getActiveSkill throws NO_ACTIVE_SKILL) when
    // unseeded. Never a hardcoded fallback prompt (§5). The Phase-6 `voice-session` body is
    // untouched by this branch, so a Phase-14 prompt change cannot regress Phase 6.
    const skill = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: onboarding ? "foundation-voice" : docId ? DOCUMENT_ANALYST_SKILL : VOICE_SESSION_SKILL,
    });

    // The mint is a SECOND trust boundary alongside `voice.startSession` — and the FIRST one in
    // wall-clock order, since the browser mints before it has a session row. A document must
    // exist, be this tenant's, and be `ready`; the thrown message is a STATUS, never content.
    if (
      onboarding &&
      process.env.FOUNDATION_ONBOARDING_ENABLED !== "1" &&
      foundationPilotExpiresAt(process.env.NATIVE_ONBOARDING_PILOT, tenantId) === undefined
    )
      throw new Error("voice: onboarding unavailable");
    if (onboarding && docId) throw new Error("voice: incompatible purpose");
    let instructions = skill.body;
    if (onboarding) {
      const context = await ctx.runQuery(internal.foundation.context, { tenantId: tenantId });
      instructions += `\n<interview_data>\n${context}\n</interview_data>`;
    }
    // The owner explicitly authorizes this tenant-scoped blueprint to cross the OpenAI Realtime
    // boundary as private session context. `spineForTenant` returns only the CONFIRMED blueprint,
    // already bounded and fenced as reference data; drafts can never leak into a voice session.
    const blueprintSpine = await ctx.runQuery(internal.blueprint.spineForTenant, {
      tenantId: tenantId,
    });
    if (blueprintSpine) instructions = `${instructions}\n\n${blueprintSpine}`;
    if (docId) {
      const doc = await ctx.runQuery(internal.voiceToken.docForMint, {
        vaultDocId: docId,
        tenantId: tenantId,
      });
      if (!doc) throw new Error("voicedoc: document not found");
      if (doc.status !== "ready") throw new Error("voicedoc: document not ready");
      // The digest is already capped, fenced and truncation-disclosing in @pikar/voice — do NOT
      // re-slice or re-fence it here, and do NOT add a behavioural instruction inline: every rule
      // the analyst follows lives in the registry skill body (§5).
      instructions = `${instructions}\n\n${buildDocDigest({
        title: doc.title,
        text: doc.text,
        truncated: doc.extractionTruncated,
      })}`;
    }

    // ponytail: PROMPT-INJECTION CEILING. A digest of user-supplied document text sits inside the
    // SYSTEM `instructions` field — a materially stronger exposure than ADR-006's tool-RETURN case,
    // because instructions are the most-trusted channel the model has. Three containments, no
    // fourth: (1) the fence + its one safety line from buildDocDigest, (2) this tool SET — exactly
    // ONE tool, READ-ONLY, so an instruction planted in the report has nothing to actuate (no
    // write, no send, no plan mutation is reachable from a voice session at all), and (3) the human
    // Approve gate on anything the post-call flow proposes. Upgrade path if live sessions show
    // steering: move the document out of `instructions` entirely and make the digest the first
    // `conversation.item.create` user-role message instead — a data-plane channel, at the cost of
    // the from-the-first-second fluency that is the whole point of the digest.
    const sessionBody = (withTools: boolean): string =>
      JSON.stringify({
        session: {
          type: "realtime",
          model: DEFAULT_REALTIME_MODEL,
          max_output_tokens: VOICE_OUTPUT_TOKENS,
          truncation: VOICE_TRUNCATION,
          instructions, // registry persona + confirmed blueprint (+ digest when doc-scoped)
          // LIVE-VERIFIED 2026-07-20: turn_detection + transcription nest under `audio.input` — a
          // top-level `session.turn_detection` 400s ("unknown parameter"); the API key is `transcription`.
          audio: {
            input: {
              transcription: { model: TRANSCRIPTION_MODEL }, // auto-detect → in-language brief
              turn_detection: {
                type: TURN_DETECTION_TYPE,
                create_response: false,
                interrupt_response: true,
              }, // semantic_vad → barge-in
            },
            output: { voice: REALTIME_VOICE },
          },
          ...(withTools
            ? {
                [SESSION_TOOL_KEYS.tools]: [
                  onboarding ? SAVE_FOUNDATION_ANSWER_TOOL : SEARCH_DOCUMENT_TOOL,
                ], // FLAT Realtime shape, one tool
                [SESSION_TOOL_KEYS.toolChoice]: TOOL_CHOICE_AUTO,
              }
            : {}),
        },
      });

    const admittedPilot = onboarding
      ? foundationPilotExpiresAt(process.env.NATIVE_ONBOARDING_PILOT, tenantId)
      : undefined;
    const post = (withTools: boolean): Promise<Response> => {
      if (
        onboarding &&
        ((process.env.FOUNDATION_ONBOARDING_ENABLED !== "1" &&
          foundationPilotExpiresAt(process.env.NATIVE_ONBOARDING_PILOT, tenantId) === undefined) ||
          (admittedPilot !== undefined &&
            process.env.VOICE_SERVER_CONTROL_VERIFIED !== "1" &&
            foundationPilotExpiresAt(process.env.NATIVE_ONBOARDING_PILOT, tenantId) !==
              admittedPilot))
      )
        throw new Error("voice: onboarding unavailable");
      return fetch(CLIENT_SECRETS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        body: sessionBody(withTools),
      });
    };

    // OPEN QUESTION 3 (14-RESEARCH), both branches shipped. The TypeScript client_secrets
    // reference lists `tools`/`tool_choice` on RealtimeSessionCreateRequest; the REST reference
    // page for the same endpoint does not — and voiceToken.ts has been wrong about this body
    // TWICE. So: declare at mint FIRST (server-owned, and it races nothing — the tools exist
    // before the data channel is even open), and on a 400 re-POST without them and tell the
    // browser to declare them itself. 14-06's relay reads `toolsAtMint` and sends
    // {type:"session.update", session:{tools, tool_choice}} over the data channel when it is false.
    // The accepted branch gets recorded WITH A DATE on the `LIVE-VERIFIED ____-__-__:` line in
    // packages/voice/src/realtime.ts at 14-09's live verify — not filled in from a doc page.
    const declareTools = Boolean(docId || onboarding);
    // `true` TRIVIALLY when there is no doc scope: an unscoped session declares no tool, so there
    // is nothing left for the browser to do and its branch stays a single `if (!toolsAtMint)`.
    // Admission allowance, not a proof of a hard provider cost cap: the current transport
    // is browser-direct. Hold it until trusted provider reconciliation; browser usage cannot
    // authorize a refund. Failed/abandoned mints remain visible as unresolved holds.
    const reservationId = await ctx.runMutation(internal.guardrails.reservePaidCall, {
      tenantId: tenantId,
      callId: crypto.randomUUID(),
      model: DEFAULT_REALTIME_MODEL,
      ceilingCents: 100,
    });
    let toolsAtMint = true;
    let res = await post(declareTools);
    if (declareTools && res.status === 400) {
      toolsAtMint = false;
      res = await post(false);
    }
    // ponytail: no retry/backoff for beta — a failed mint surfaces to the pre-flight UI as
    // "couldn't start" (the thrown message is a status only, never the key). The 400 re-POST above
    // is a SHAPE fallback, not a retry: any other non-OK status still throws first time.
    if (!res.ok) throw new Error(`mintClientSecret: ${res.status}`);

    const body = (await res.json()) as MintResponse;
    // Return ONLY the ephemeral secret, its expiry, and the transport-control flag. `toolsAtMint`
    // is the ONE deliberate extension to the Phase-6 {clientSecret, expiresAt} contract: it is
    // TRANSPORT CONTROL (where the tool array got declared), not a secret and not document
    // content. OPENAI_API_KEY stays in Convex env — structurally absent from this object, and
    // nothing here logs or audits either (Pitfall 4).
    return { clientSecret: body.value, expiresAt: body.expires_at, toolsAtMint, reservationId };
  },
});

/**
 * Server-side force-terminate of a live call by its stored `callId` (the VOIC-02 watchdog / client
 * beacon path — an internalAction, never client-exposed). POSTs to the hangup endpoint with the
 * server key; 200 = terminated. A non-200 throws with the STATUS only so the caller can log it
 * refs-only (never the key or the callId-as-secret).
 */
export const hangupCall = internalAction({
  args: { callId: v.string() },
  handler: async (_ctx, { callId }): Promise<{ ended: true }> => {
    const res = await fetch(hangupUrl(callId), {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
      signal: AbortSignal.timeout(15_000),
    });
    // 200 = terminated. A non-200 throws with the STATUS only — the watchdog caller logs it
    // refs-only (never the key or the callId-as-secret, §4).
    if (!res.ok) throw new Error(`hangupCall: ${res.status}`);
    return { ended: true };
  },
});

/** No reusable provider credential or provider call handle crosses this boundary.
 * Audio-only provider acceptance is a deployment evidence gate, not an assumption. */
export const connect = tenantAction({
  args: {
    offerSdp: v.string(),
    docId: v.optional(v.id("vaultDocuments")),
    onboarding: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { offerSdp, docId, onboarding },
  ): Promise<{ answerSdp: string; sessionId: Id<"voiceSessions">; endsAt: number }> => {
    const pilotEndsAt =
      onboarding && !docId
        ? foundationPilotExpiresAt(process.env.NATIVE_ONBOARDING_PILOT, ctx.tenantId)
        : undefined;
    const pilotOnly = process.env.VOICE_SERVER_CONTROL_VERIFIED !== "1";
    if (pilotOnly && (pilotEndsAt === undefined || pilotEndsAt - Date.now() < 300_000))
      throw new Error("VOICE_CONTROL_NOT_VERIFIED");
    assertMediaOnlyOffer(offerSdp);
    const mint = await ctx.runAction(internal.voiceToken.mintClientSecret, {
      tenantId: ctx.tenantId,
      docId,
      onboarding,
    });
    if (
      pilotOnly &&
      foundationPilotExpiresAt(process.env.NATIVE_ONBOARDING_PILOT, ctx.tenantId) !== pilotEndsAt
    )
      throw new Error("VOICE_CONTROL_NOT_VERIFIED");
    // The ephemeral credential exists only inside server-to-provider exchanges.
    const response = await fetch(CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${mint.clientSecret}`, "Content-Type": "application/sdp" },
      body: offerSdp,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("VOICE_CONNECTION_REFUSED");
    const callId = trustedCallId(response.headers.get("Location"));
    let sessionId: Id<"voiceSessions"> | undefined;
    try {
      const answerSdp = await response.text();
      if (answerSdp.length > 32_768 || /m=application|sctp/i.test(answerSdp))
        throw new Error("VOICE_UNSAFE_ANSWER");
      const started = await ctx.runMutation(internal.voice.startSession, {
        tenantId: ctx.tenantId,
        callId,
        controlled: true,
        ...(pilotOnly ? { pilotEndsAt } : {}),
        reservationId: mint.reservationId,
        onboarding,
        docRef: docId,
      });
      sessionId = started.sessionId;
      await ctx.scheduler.runAfter(0, internal.voiceControl.run, { sessionId });
      // Returning SDP before trusted control is attached would admit an uncontrolled session.
      for (let attempt = 0; attempt < 30; attempt++) {
        const session = await ctx.runQuery(internal.voice.getSession, { sessionId });
        if (session?.controlReady && session.status === "active")
          return { answerSdp, sessionId, endsAt: session.endsAt };
        if (!session || session.status !== "active") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("VOICE_CONTROL_UNAVAILABLE");
    } catch {
      if (sessionId) await ctx.runAction(internal.voice.forceEndSession, { sessionId });
      else await ctx.runAction(internal.voiceToken.hangupCall, { callId });
      throw new Error("VOICE_CONTROL_UNAVAILABLE");
    }
  },
});
