/**
 * @pikar/voice — pinned OpenAI Realtime API shapes (Wave 0 foundation).
 *
 * Every voice consumer imports the endpoint, model, session-config, and usage-field
 * names FROM HERE — nothing downstream re-derives a Realtime literal (that is the whole
 * point of this module). The Realtime API GA'd `gpt-realtime` / `client_secrets` / `calls`
 * on 2026-07-06, PAST the model training cutoff, so these are pinned from the phase
 * RESEARCH doc citing the live OpenAI docs, each with a `ponytail:` source + re-fetch path.
 *
 * ponytail: values pinned 2026-07-20 from the OpenAI Realtime docs
 *   - https://developers.openai.com/api/docs/guides/realtime  (client_secrets mint body,
 *     calls handshake, semantic_vad turn_detection, input_audio_transcription, response.done usage)
 *   - https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup
 * Upgrade path: if a mint/handshake/hangup starts 4xx-ing or a usage field reads
 * undefined, RE-FETCH those two pages and bump the values + this date. Do not scatter the
 * literal — change it here and every consumer follows.
 */

const API_BASE = "https://api.openai.com/v1/realtime";

/** POST here (Bearer OPENAI_API_KEY, server-only) to mint an ephemeral client secret. */
export const CLIENT_SECRETS_URL = `${API_BASE}/client_secrets` as const;

/** POST the browser SDP offer here (Bearer <clientSecret>); the answer's `Location`
 *  header carries the `call_id` the server needs to force-terminate. */
export const CALLS_URL = `${API_BASE}/calls` as const;

/** Server-side force-terminate: POST here (Bearer OPENAI_API_KEY), expects 200. */
export const hangupUrl = (callId: string): string => `${API_BASE}/calls/${callId}/hangup`;

/** Current GA default snapshot (moved off `gpt-4o-realtime-preview` on 2026-07-06).
 *  `-mini` is the cheaper tier. */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1" as const;
export const MINI_REALTIME_MODEL = "gpt-realtime-2.1-mini" as const;

/** Barge-in requires server-side VAD; `semantic_vad` is the GA turn-detection type. */
export const TURN_DETECTION_TYPE = "semantic_vad" as const;

/** Default transcription model for the kept (text-only) transcript — auto-detects
 *  language, which drives the in-language brief. */
export const TRANSCRIPTION_MODEL = "gpt-4o-transcribe" as const;

/** Key names written into the `client_secrets` mint body's `session` object. The
 *  live-session `instructions` load from the registry skill (CLAUDE.md §5), never hardcoded. */
export const SESSION_CONFIG_KEYS = {
  model: "model",
  instructions: "instructions",
  voice: "audio.output.voice",
  turnDetectionType: "turn_detection.type",
  transcriptionModel: "input_audio_transcription.model",
} as const;

/** The nested field names on `response.done`'s `usage` object that the client reads for
 *  metering. priceRealtime consumes the flattened {inAudioTok,outAudioTok,textInTok,
 *  textOutTok}; `readUsage` below welds the two together so the paths live in ONE place. */
export const RESPONSE_DONE_USAGE_FIELDS = {
  inputDetails: "input_token_details",
  outputDetails: "output_token_details",
  audio: "audio_tokens",
  text: "text_tokens",
} as const;

/** Shape of `response.done.response.usage` (only the fields we meter). Everything is
 *  optional because a text-only turn omits the audio counts (and vice versa). */
export type RealtimeUsage = {
  input_token_details?: { audio_tokens?: number; text_tokens?: number };
  output_token_details?: { audio_tokens?: number; text_tokens?: number };
};

/** Flatten a `response.done` usage object into the token tuple priceRealtime/accumulateUsage
 *  consume. Missing counts default to 0 (a text-only or audio-only turn is legal). This is
 *  the single reader of the pinned field names — if OpenAI renames one, only this breaks. */
export function readUsage(usage: RealtimeUsage): {
  inAudioTok: number;
  outAudioTok: number;
  textInTok: number;
  textOutTok: number;
} {
  return {
    inAudioTok: usage.input_token_details?.audio_tokens ?? 0,
    outAudioTok: usage.output_token_details?.audio_tokens ?? 0,
    textInTok: usage.input_token_details?.text_tokens ?? 0,
    textOutTok: usage.output_token_details?.text_tokens ?? 0,
  };
}
