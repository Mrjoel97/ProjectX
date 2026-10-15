import { describe, expect, it } from "vitest";
import { assertMediaOnlyOffer, trustedCallId, trustedResponseUsage } from "./serverControl";

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
