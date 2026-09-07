import { describe, expect, test } from "vitest";
import { CHANNEL_SPECS, CHANNELS, isSchedulable, LEGACY_CHANNEL, parseChannel } from "./channel";

describe("channel — the canonical list and its specs (ADR-039 D4, ADR-042)", () => {
  // NON-VACUITY, and it is the first test in the file on purpose. Every refusal test in
  // `plans.test.ts` asserts that an unschedulable channel is refused; if no channel is
  // unschedulable, those tests pass against a guard that can never fire and the whole refusal is
  // decoration.
  //
  // THIS TEST HAS A KNOWN EXPIRY. Plan 43-06 lands the memo/vault scheduler arm and flips `vault`
  // to `schedulable: true` in the SAME commit as the arm (ADR-042 D3). At that moment both members
  // are schedulable and this assertion fails BY DESIGN. Do not delete it and move on: ADR-042 D4
  // says what replaces it — a binding test in `packages/backend` that every channel whose spec says
  // `schedulable: true` HAS an arm. That question stays falsifiable for ever, and it is the one
  // that actually matters.
  test("at least one channel is unschedulable, so the refusal has a reachable subject", () => {
    expect(CHANNELS.filter((c) => !CHANNEL_SPECS[c].schedulable)).not.toEqual([]);
  });

  // The other half: a list where NOTHING is schedulable would also pass the test above while
  // making the queue itself fictional.
  test("at least one channel IS schedulable, so the queue is not fictional", () => {
    expect(CHANNELS.filter((c) => CHANNEL_SPECS[c].schedulable)).not.toEqual([]);
  });

  test("every channel has a spec, and isSchedulable agrees with it", () => {
    for (const c of CHANNELS) {
      expect(CHANNEL_SPECS[c]).toBeDefined();
      expect(isSchedulable(c)).toBe(CHANNEL_SPECS[c].schedulable);
    }
  });

  // A schedulable channel carries a horizon; an unschedulable one structurally cannot. This is the
  // discriminated union doing its job — there is no fictional number beside `schedulable: false`.
  test("a horizon exists exactly where scheduling does", () => {
    for (const c of CHANNELS) {
      const spec = CHANNEL_SPECS[c];
      expect("horizonMs" in spec).toBe(spec.schedulable);
      if (spec.schedulable) expect(spec.horizonMs).toBeGreaterThan(0);
    }
  });
});

describe("parseChannel — the trust boundary", () => {
  test("a legacy row (no channel) reads as email, with no migration", () => {
    expect(parseChannel(undefined)).toBe(LEGACY_CHANNEL);
    expect(parseChannel(null)).toBe("email");
  });

  test("every canonical value round-trips", () => {
    for (const c of CHANNELS) expect(parseChannel(c)).toBe(c);
  });

  // THROWS rather than falling back. A silent fallback to "email" on an unrecognised value would
  // publish a vault-intended piece into a real person's inbox — the loudest possible version of
  // this failure, reached by the quietest possible bug.
  test("an unknown value throws and never degrades to email", () => {
    expect(() => parseChannel("slack")).toThrow(/CHANNEL_UNKNOWN:slack/);
    expect(() => parseChannel("")).toThrow(/CHANNEL_UNKNOWN:/);
    // Case matters: a near-miss is still a miss, not a match.
    expect(() => parseChannel("Email")).toThrow(/CHANNEL_UNKNOWN:Email/);
  });
});
