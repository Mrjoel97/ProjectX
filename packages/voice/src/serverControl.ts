/** Server-controlled transport accepts one audio-only WebRTC m-section. The browser
 * must not negotiate SCTP: a data channel would bypass server response/tool controls.
 * This parser validates, never attempts to sanitize an ambiguous offer. */
export function assertMediaOnlyOffer(sdp: string): void {
  if (
    !sdp ||
    sdp.length > 32_768 ||
    [...sdp].some((char) => {
      const n = char.charCodeAt(0);
      return ![9, 10, 13].includes(n) && (n < 32 || n > 126);
    })
  )
    throw new Error("VOICE_INVALID_SDP");
  const lines = sdp.split(/\r?\n/).filter(Boolean);
  const media = lines.filter((line) => line.startsWith("m="));
  if (media.length !== 1 || !/^m=audio \d+ UDP\/TLS\/RTP\/SAVPF \d+$/.test(media[0] ?? ""))
    throw new Error("VOICE_AUDIO_ONLY_REQUIRED");
  const payload = media[0]?.split(" ").at(-1);
  const codecs = lines.filter((line) => line.startsWith("a=rtpmap:"));
  if (
    codecs.length !== 1 ||
    codecs[0] !== `a=rtpmap:${payload} opus/48000/2` ||
    lines.some((line) => /sctp|datachannel|^a=extmap.*(video|frame-marking)/i.test(line))
  )
    throw new Error("VOICE_UNSUPPORTED_CODEC");
  if (
    !lines.includes("a=rtcp-mux") ||
    !lines.includes("a=sendrecv") ||
    lines.filter((line) => line.startsWith("a=mid:")).length !== 1 ||
    !lines.some((line) => /^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(line))
  )
    throw new Error("VOICE_INVALID_SDP");
}

export function trustedCallId(location: string | null): string {
  if (!location) throw new Error("VOICE_MISSING_CALL_ID");
  const url = new URL(location, "https://api.openai.com");
  const match = /^\/v1\/realtime\/calls\/(rtc_[A-Za-z0-9_-]{1,200})$/.exec(url.pathname);
  if (url.origin !== "https://api.openai.com" || url.search || url.hash || !match?.[1])
    throw new Error("VOICE_INVALID_CALL_ID");
  return match[1];
}

/** Strict usage extraction for trusted sideband events. Missing counters cannot
 * become zero: ambiguity must retain the admission hold. Cached input is charged
 * conservatively at the uncached rate until reconciliation proves otherwise. */
export function trustedResponseUsage(event: unknown): {
  responseId: string;
  inAudioTok: number;
  outAudioTok: number;
  textInTok: number;
  textOutTok: number;
} {
  const e = event as {
    type?: string;
    response?: {
      id?: unknown;
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        input_token_details?: { audio_tokens?: unknown; text_tokens?: unknown };
        output_token_details?: { audio_tokens?: unknown; text_tokens?: unknown };
      };
    };
  } | null;
  const usage = e?.response?.usage;
  const count = (n: unknown): number => {
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
      throw new Error("VOICE_USAGE_UNKNOWN");
    return n;
  };
  if (
    e?.type !== "response.done" ||
    typeof e.response?.id !== "string" ||
    e.response.id.length > 240
  )
    throw new Error("VOICE_USAGE_UNKNOWN");
  const result = {
    responseId: e.response.id,
    inAudioTok: count(usage?.input_token_details?.audio_tokens),
    textInTok: count(usage?.input_token_details?.text_tokens),
    outAudioTok: count(usage?.output_token_details?.audio_tokens),
    textOutTok: count(usage?.output_token_details?.text_tokens),
  };
  if (
    count(usage?.input_tokens) !== result.inAudioTok + result.textInTok ||
    count(usage?.output_tokens) !== result.outAudioTok + result.textOutTok
  )
    throw new Error("VOICE_USAGE_UNKNOWN");
  return result;
}
