import { describe, expect, it } from "vitest";
import {
  assertMediaOnlyOffer,
  assertVoiceControlAcknowledged,
  trustedCallId,
  trustedResponseUsage,
  VOICE_RESPONSE_CEILING_CENTS,
  VOICE_TRUNCATION,
  voiceUsageWithinBounds,
} from "./serverControl";

const offer = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=mid:0",
  `a=fingerprint:sha-256 ${Array(32).fill("AA").join(":")}`,
].join("\r\n");
describe("server voice trust boundary", () => {
  it("requires the exact provider budget contract before admitting responses", () => {
    const ack = {
      model: "gpt-realtime-2.1",
      max_output_tokens: 1024,
      audio: { input: { turn_detection: { create_response: false } } },
      truncation: VOICE_TRUNCATION,
    };
    expect(VOICE_RESPONSE_CEILING_CENTS).toBe(84);
    expect(() => assertVoiceControlAcknowledged(ack)).not.toThrow();
    for (const patch of [
      { model: "gpt-realtime" },
      { max_output_tokens: 2048 },
      { audio: {} },
      { truncation: undefined },
      { truncation: { ...VOICE_TRUNCATION, retention_ratio: 0.9 } },
      { truncation: { ...VOICE_TRUNCATION, type: "auto" } },
      { truncation: { ...VOICE_TRUNCATION, token_limits: { post_instructions: 8193 } } },
    ])
      expect(() => assertVoiceControlAcknowledged({ ...ack, ...patch })).toThrow(
        "VOICE_CONTROL_UNCONFIRMED",
      );
    const usage = {
      responseId: "r",
      inAudioTok: 8192,
      textInTok: 119808,
      outAudioTok: 1024,
      textOutTok: 0,
    };
    expect(voiceUsageWithinBounds(usage)).toBe(true);
    for (const patch of [{ inAudioTok: 8193 }, { textInTok: 119809 }, { textOutTok: 1 }])
      expect(voiceUsageWithinBounds({ ...usage, ...patch })).toBe(false);
  });
  it("accepts one audio-only offer and rejects frontend control channels", () => {
    expect(() => assertMediaOnlyOffer(offer)).not.toThrow();
    for (const suffix of [
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "m=video 9 UDP/TLS/RTP/SAVPF 111",
      "a=sctp-port:5000",
    ])
      expect(() => assertMediaOnlyOffer(`${offer}\r\n${suffix}`)).toThrow();
    expect(() => assertMediaOnlyOffer(offer.replace("opus/48000/2", "PCMU/8000"))).toThrow();
  });
  it("accepts only the provider call resource location", () => {
    expect(trustedCallId("/v1/realtime/calls/rtc_abc123")).toBe("rtc_abc123");
    for (const value of [
      null,
      "https://evil.invalid/v1/realtime/calls/rtc_abc",
      "/v1/realtime/calls/rtc_a?x=1",
      "/v1/realtime/calls/../rtc_a",
    ])
      expect(() => trustedCallId(value)).toThrow();
  });
  it("requires complete internally consistent provider counters", () => {
    const usage = {
      input_tokens: 3,
      output_tokens: 7,
      input_token_details: { audio_tokens: 1, text_tokens: 2 },
      output_token_details: { audio_tokens: 3, text_tokens: 4 },
    };
    const event = { type: "response.done", response: { id: "resp_1", usage } };
    expect(trustedResponseUsage(event)).toEqual({
      responseId: "resp_1",
      inAudioTok: 1,
      textInTok: 2,
      outAudioTok: 3,
      textOutTok: 4,
    });
    expect(() => trustedResponseUsage({ ...event, response: { id: "resp_1" } })).toThrow();
    expect(() =>
      trustedResponseUsage({
        ...event,
        response: { id: "resp_1", usage: { ...usage, input_tokens: 4 } },
      }),
    ).toThrow();
  });
});
