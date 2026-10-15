import { describe, expect, it } from "vitest";
import { encodePcmWav, inspectPcmWav, PCM_MAX_SECONDS, PCM_SAMPLE_RATE } from "./pcm";

describe("trusted transcription duration", () => {
  it("derives duration from full samples and accepts the exact ceiling", () => {
    expect(inspectPcmWav(encodePcmWav(new Float32Array(16000)))).toEqual({
      samples: 16000,
      seconds: 1,
    });
    expect(
      inspectPcmWav(encodePcmWav(new Float32Array(PCM_MAX_SECONDS * PCM_SAMPLE_RATE))),
    ).toMatchObject({ seconds: 600 });
  });
  it("rejects forged rate, format, lengths, appended and truncated bytes", () => {
    const good = encodePcmWav(new Float32Array(160));
    for (const at of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
      const bad = good.slice();
      bad[at] = (bad[at] ?? 0) ^ 1;
      expect(() => inspectPcmWav(bad)).toThrow("BOUNDED_PCM");
    }
    expect(() => inspectPcmWav(good.subarray(0, good.length - 1))).toThrow();
    expect(() => inspectPcmWav(new Uint8Array([...good, 0, 0]))).toThrow();
  });
  it("rejects overlong and nonfinite samples", () => {
    expect(() => encodePcmWav(new Float32Array(PCM_MAX_SECONDS * PCM_SAMPLE_RATE + 1))).toThrow();
    expect(() => encodePcmWav(new Float32Array([Number.NaN]))).toThrow();
  });
});
