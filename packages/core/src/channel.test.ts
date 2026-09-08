import { describe, expect, test } from "vitest";
import { CHANNEL_SPECS, CHANNELS, isSchedulable, LEGACY_CHANNEL, parseChannel } from "./channel";

describe("channel — the canonical list and its specs (ADR-039 D4, ADR-042)", () => {
  // THE EXPIRED ASSERTION, AND WHERE IT WENT (43-06). This file used to open with
  // `expect(CHANNELS.filter((c) => !CHANNEL_SPECS[c].schedulable)).not.toEqual([])` — "at least one
  // channel is unschedulable, so the refusal has a reachable subject". 43-06 flipped `vault` to
  // schedulable in the same commit as the arm that honours it (ADR-042 D3), so that assertion had
  // no subject left and was removed ON PURPOSE, not lost.
  //
  // ADR-042 D4 names its replacement, and it is STRICTLY STRONGER: `cockpit.test.ts` now binds
  // every channel whose spec says `schedulable: true` to an ARM that actually fires it. The old
  // check asked a question about a LIST; the new one asks the hazard — can every channel that
  // claims to be schedulable actually be scheduled — and it stays falsifiable for ever.
  //
  // It could not live here: proving a channel has an arm needs `convex/`, and `packages/core` must
  // never import it (§1).

  // A list where NOTHING is schedulable would make the queue itself fictional.
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
