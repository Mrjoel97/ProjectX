// Plan-06 VOIC-01/VOIC-02: the server↔OpenAI Realtime seam. Two PLAIN-runtime actions
// (deliberately DEFAULT-runtime, no node pragma — both are just `fetch` to api.openai.com, and a
// SECOND node-runtime module would re-trip the TS circular-inference cliff llm.ts's header warns about).
//
//   mintClientSecret — hands the browser a short-lived client secret so OPENAI_API_KEY never
//     leaves Convex (the browser does the WebRTC SDP handshake with that secret, not the key).
//     Phase 14 (DOCV-01): an optional `docId` makes it a DOC-GROUNDED mint — document-analyst
//     persona + a fenced digest of that report + the one read-only `search_document` tool.
//   hangupCall       — the server's ONLY way to force-terminate a browser-direct call; the
//     VOIC-02 watchdog's actuator (a hung/gone tab can't stop billing otherwise).
//
// Both read OPENAI_API_KEY from Convex env and NEVER return/log it (Pitfall 4 / playbook).
import { DOCUMENT_ANALYST_SKILL, VOICE_SESSION_SKILL } from "@pikar/contracts/skill";
import {
  buildDocDigest,
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  hangupUrl,
  SEARCH_DOCUMENT_TOOL,
  SESSION_TOOL_KEYS,
  TOOL_CHOICE_AUTO,
  TRANSCRIPTION_MODEL,
  TURN_DETECTION_TYPE,
} from "@pikar/voice";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { tenantAction } from "./lib/functions";

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
 * Mint a short-lived Realtime client secret for the browser (VOIC-01 pre-flight), optionally
 * scoped to ONE vault report (DOCV-01).
 *
 * Unscoped it uses the `voice-session` REGISTRY persona and no tool array at all. Scoped it swaps
 * in the `document-analyst` persona, appends a bounded FENCED digest of that report, and declares
 * exactly one read-only retrieval tool. When the tenant has a confirmed business blueprint, both
 * modes also receive its bounded, fenced spine so the live conversation has the same standing
 * business context as the cockpit. Both personas are registry-loaded and fail closed when
 * unseeded — never a hardcoded prompt (§5).
 *
 * Returns `{clientSecret, expiresAt, toolsAtMint}` — OPENAI_API_KEY stays in Convex env and never
 * enters this object, a thrown message, a log line, or an audit row (Pitfall 4).
 */
export const mintClientSecret = tenantAction({
  args: { docId: v.optional(v.id("vaultDocuments")) },
  handler: async (
    ctx,
    { docId },
  ): Promise<{ clientSecret: string; expiresAt: number; toolsAtMint: boolean }> => {
    // Persona from the registry — fail-closed (getActiveSkill throws NO_ACTIVE_SKILL) when
    // unseeded. Never a hardcoded fallback prompt (§5). The Phase-6 `voice-session` body is
    // untouched by this branch, so a Phase-14 prompt change cannot regress Phase 6.
    const skill = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: docId ? DOCUMENT_ANALYST_SKILL : VOICE_SESSION_SKILL,
    });

    // The mint is a SECOND trust boundary alongside `voice.startSession` — and the FIRST one in
    // wall-clock order, since the browser mints before it has a session row. A document must
    // exist, be this tenant's, and be `ready`; the thrown message is a STATUS, never content.
    let instructions = skill.body;
    // The owner explicitly authorizes this tenant-scoped blueprint to cross the OpenAI Realtime
    // boundary as private session context. `spineForTenant` returns only the CONFIRMED blueprint,
    // already bounded and fenced as reference data; drafts can never leak into a voice session.
    const blueprintSpine = await ctx.runQuery(internal.blueprint.spineForTenant, {
      tenantId: ctx.tenantId,
    });
    if (blueprintSpine) instructions = `${instructions}\n\n${blueprintSpine}`;
    if (docId) {
      const doc = await ctx.runQuery(internal.voiceToken.docForMint, {
        vaultDocId: docId,
        tenantId: ctx.tenantId,
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
          instructions, // registry persona + confirmed blueprint (+ digest when doc-scoped)
          // LIVE-VERIFIED 2026-07-20: turn_detection + transcription nest under `audio.input` — a
          // top-level `session.turn_detection` 400s ("unknown parameter"); the API key is `transcription`.
          audio: {
            input: {
              transcription: { model: TRANSCRIPTION_MODEL }, // auto-detect → in-language brief
              turn_detection: { type: TURN_DETECTION_TYPE }, // semantic_vad → barge-in
            },
            output: { voice: REALTIME_VOICE },
          },
          ...(withTools
            ? {
                [SESSION_TOOL_KEYS.tools]: [SEARCH_DOCUMENT_TOOL], // FLAT Realtime shape, one tool
                [SESSION_TOOL_KEYS.toolChoice]: TOOL_CHOICE_AUTO,
              }
            : {}),
        },
      });

    const post = (withTools: boolean): Promise<Response> =>
      fetch(CLIENT_SECRETS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        body: sessionBody(withTools),
      });

    // OPEN QUESTION 3 (14-RESEARCH), both branches shipped. The TypeScript client_secrets
    // reference lists `tools`/`tool_choice` on RealtimeSessionCreateRequest; the REST reference
    // page for the same endpoint does not — and voiceToken.ts has been wrong about this body
    // TWICE. So: declare at mint FIRST (server-owned, and it races nothing — the tools exist
    // before the data channel is even open), and on a 400 re-POST without them and tell the
    // browser to declare them itself. 14-06's relay reads `toolsAtMint` and sends
    // {type:"session.update", session:{tools, tool_choice}} over the data channel when it is false.
    // The accepted branch gets recorded WITH A DATE on the `LIVE-VERIFIED ____-__-__:` line in
    // packages/voice/src/realtime.ts at 14-09's live verify — not filled in from a doc page.
    const declareTools = Boolean(docId);
    // `true` TRIVIALLY when there is no doc scope: an unscoped session declares no tool, so there
    // is nothing left for the browser to do and its branch stays a single `if (!toolsAtMint)`.
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
    return { clientSecret: body.value, expiresAt: body.expires_at, toolsAtMint };
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
    });
    // 200 = terminated. A non-200 throws with the STATUS only — the watchdog caller logs it
    // refs-only (never the key or the callId-as-secret, §4).
    if (!res.ok) throw new Error(`hangupCall: ${res.status}`);
    return { ended: true };
  },
});
