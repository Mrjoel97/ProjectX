/**
 * Per-session token metering fold (VOIC-02). The client reads `response.done` usage
 * (via realtime.readUsage), then folds each delta into cumulative counters here. The
 * cumulative counts price onto the existing spend rails via @pikar/cost's priceRealtime.
 */

export type UsageDelta = {
  inAudioTok: number;
  outAudioTok: number;
  textInTok: number;
  textOutTok: number;
};

export const ZERO_USAGE: UsageDelta = {
  inAudioTok: 0,
  outAudioTok: 0,
  textInTok: 0,
  textOutTok: 0,
};

/** Reducer: fold a stream of usage deltas into a running total (`stream.reduce(accumulateUsage, ZERO_USAGE)`). */
export function accumulateUsage(acc: UsageDelta, delta: UsageDelta): UsageDelta {
  return {
    inAudioTok: acc.inAudioTok + delta.inAudioTok,
    outAudioTok: acc.outAudioTok + delta.outAudioTok,
    textInTok: acc.textInTok + delta.textInTok,
    textOutTok: acc.textOutTok + delta.textOutTok,
  };
}
