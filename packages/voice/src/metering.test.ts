import { describe, expect, it } from "vitest";
import { accumulateUsage, ZERO_USAGE } from "./metering";

describe("accumulateUsage", () => {
  it("folds a stream of usage deltas into cumulative counters", () => {
    const stream = [
      { inAudioTok: 100, outAudioTok: 200, textInTok: 1, textOutTok: 2 },
      { inAudioTok: 50, outAudioTok: 60, textInTok: 3, textOutTok: 4 },
    ];
    const total = stream.reduce(accumulateUsage, ZERO_USAGE);
    expect(total).toEqual({ inAudioTok: 150, outAudioTok: 260, textInTok: 4, textOutTok: 6 });
  });

  it("ZERO_USAGE is the fold identity", () => {
    const one = { inAudioTok: 5, outAudioTok: 6, textInTok: 7, textOutTok: 8 };
    expect(accumulateUsage(ZERO_USAGE, one)).toEqual(one);
  });
});
