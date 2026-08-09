import { describe, expect, it } from "vitest";
import {
  CALLS_URL,
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  hangupUrl,
  RESPONSE_DONE_USAGE_FIELDS,
  readUsage,
  SESSION_CONFIG_KEYS,
  TURN_DETECTION_TYPE,
} from "./realtime";

// Self-check: fails if a pinned endpoint/model/config/usage name is dropped or renamed.
describe("realtime pinned shapes", () => {
  it("pins the GA endpoints", () => {
    expect(CLIENT_SECRETS_URL).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(CALLS_URL).toBe("https://api.openai.com/v1/realtime/calls");
    expect(hangupUrl("call_123")).toBe("https://api.openai.com/v1/realtime/calls/call_123/hangup");
  });

  it("pins the current default model snapshot", () => {
    expect(DEFAULT_REALTIME_MODEL).toBe("gpt-realtime-2.1");
  });

  it("pins the session-config keys and barge-in VAD type", () => {
    expect(TURN_DETECTION_TYPE).toBe("semantic_vad");
    expect(Object.keys(SESSION_CONFIG_KEYS)).toEqual([
      "model",
      "instructions",
      "voice",
      "turnDetectionType",
      "transcriptionModel",
    ]);
  });

  it("pins the response.done usage field names", () => {
    expect(RESPONSE_DONE_USAGE_FIELDS).toMatchObject({
      inputDetails: "input_token_details",
      outputDetails: "output_token_details",
      audio: "audio_tokens",
      text: "text_tokens",
    });
  });
});

describe("readUsage", () => {
  it("flattens a full usage object to the metering tuple", () => {
    expect(
      readUsage({
        input_token_details: { audio_tokens: 100, text_tokens: 5 },
        output_token_details: { audio_tokens: 200, text_tokens: 7 },
      }),
    ).toEqual({ inAudioTok: 100, outAudioTok: 200, textInTok: 5, textOutTok: 7 });
  });

  it("defaults missing counts to 0 (text-only / audio-only turn is legal)", () => {
    expect(readUsage({})).toEqual({
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    });
  });
});
