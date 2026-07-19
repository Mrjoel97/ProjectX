// Plan-06 VOIC-01/VOIC-02: the server↔OpenAI Realtime seam. Two PLAIN-runtime actions
// (deliberately NO "use node" — both are just `fetch` to api.openai.com, and a SECOND node
// module would re-trip the TS circular-inference cliff llm.ts's header warns about).
//
//   mintClientSecret — hands the browser a short-lived client secret so OPENAI_API_KEY never
//     leaves Convex (the browser does the WebRTC SDP handshake with that secret, not the key).
//   hangupCall       — the server's ONLY way to force-terminate a browser-direct call; the
//     VOIC-02 watchdog's actuator (a hung/gone tab can't stop billing otherwise).
//
// Both read OPENAI_API_KEY from Convex env and NEVER return/log it (Pitfall 4 / playbook).
import { VOICE_SESSION_SKILL } from "@pikar/contracts/skill";
import {
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  hangupUrl,
  TRANSCRIPTION_MODEL,
  TURN_DETECTION_TYPE,
} from "@pikar/voice";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { tenantAction } from "./lib/functions";

// ponytail: warm GA voice for gpt-realtime; the voice is a product/BRAND choice — swap the
// literal if the persona picks another (the INSTRUCTIONS load from the registry, §5, never here).
const REALTIME_VOICE = "marin";

// The mint 200 shape ({ client_secret, expires_at }) is pinned from the phase RESEARCH doc, NOT a
// live fetch (no fetch tool at build time). ponytail: re-confirm against a live 200 the first time
// a real mint runs — if OpenAI nests it ({ client_secret: { value, expires_at } }), fix it HERE
// (this is the single reader of the response shape).
type MintResponse = { client_secret: string; expires_at: number };

/**
 * Mint a short-lived Realtime client secret for the browser (VOIC-01 pre-flight). The session
 * config bakes in the `voice-session` REGISTRY persona (fail-closed if unseeded — never a
 * hardcoded prompt, §5). Returns ONLY `{clientSecret, expiresAt}` — OPENAI_API_KEY stays in
 * Convex env and never enters this object, a log line, or an audit row (Pitfall 4).
 */
export const mintClientSecret = tenantAction({
  args: {},
  handler: async (ctx): Promise<{ clientSecret: string; expiresAt: number }> => {
    // Persona from the registry — fail-closed (getActiveSkill throws NO_ACTIVE_SKILL) when
    // unseeded. Never a hardcoded fallback prompt (§5).
    const skill = await ctx.runQuery(internal.skills.getActiveSkill, { name: VOICE_SESSION_SKILL });

    const res = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: DEFAULT_REALTIME_MODEL,
          instructions: skill.body, // registry persona, baked into the ephemeral secret
          audio: { output: { voice: REALTIME_VOICE } },
          turn_detection: { type: TURN_DETECTION_TYPE }, // semantic_vad → barge-in
          input_audio_transcription: { model: TRANSCRIPTION_MODEL }, // auto-detect → in-language brief
        },
      }),
    });
    // ponytail: no retry/backoff for beta — a failed mint surfaces to the pre-flight UI as
    // "couldn't start" (the thrown message is a status only, never the key). Add retry only if
    // live-verify shows flakiness.
    if (!res.ok) throw new Error(`mintClientSecret: ${res.status}`);

    const body = (await res.json()) as MintResponse;
    // Return ONLY the ephemeral secret + its expiry. OPENAI_API_KEY stays in Convex env — it is
    // structurally absent from this object, and nothing here logs or audits either (Pitfall 4).
    return { clientSecret: body.client_secret, expiresAt: body.expires_at };
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
  handler: async (_ctx, { callId: _callId }): Promise<{ ended: true }> => {
    throw new Error("not_implemented");
  },
});
