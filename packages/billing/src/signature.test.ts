// The Stripe-Signature header law. Every assertion here is offline at $0.
//
// This file is the ONLY place the parsing rules are pinned, and three of them are security
// properties rather than conveniences: v0 must be dropped, EVERY v1 must be returned, and the
// tolerance must be a real number of seconds.
import { describe, expect, test } from "vitest";
import { parseStripeSignature, SIGNATURE_TOLERANCE_S, timingSafeEqualHex } from "./signature";

describe("parseStripeSignature", () => {
  test("parses Stripe's documented header shape", () => {
    expect(parseStripeSignature("t=1492774577,v1=abc")).toEqual({ t: 1492774577, v1: ["abc"] });
  });

  // A secret roll puts the OLD and the NEW signature on one header. Returning only the first
  // makes the roll a hard outage on whichever half we did not keep.
  test("returns BOTH v1 values, in order, during a secret roll", () => {
    expect(parseStripeSignature("t=1492774577,v1=old,v1=new")).toEqual({
      t: 1492774577,
      v1: ["old", "new"],
    });
  });

  // v0 is Stripe's fake scheme on test events. Honouring it is a downgrade attack: an attacker
  // who can produce a v0 would be handed acceptance for free.
  test("DROPS v0 — honouring it is a downgrade attack", () => {
    expect(parseStripeSignature("t=1492774577,v1=real,v0=fake")).toEqual({
      t: 1492774577,
      v1: ["real"],
    });
    expect(parseStripeSignature("t=1492774577,v0=fake")).toBeNull();
  });

  // A future scheme (v2=, v3=) must be dropped for the same reason, without a code change.
  test("drops any unknown scheme", () => {
    expect(parseStripeSignature("t=1492774577,v1=real,v2=future")).toEqual({
      t: 1492774577,
      v1: ["real"],
    });
  });

  test.each([
    ["v1=abc", "no t"],
    ["t=1492774577", "no v1"],
    ["", "empty"],
    ["t=notanumber,v1=abc", "non-numeric t"],
    ["=1492774577,v1=abc", "no key before the ="],
  ])("returns null for %s (%s)", (header) => {
    expect(parseStripeSignature(header)).toBeNull();
  });

  test("tolerates the whitespace Stripe's own reference tolerates", () => {
    expect(parseStripeSignature("t=1492774577, v1=abc")).toEqual({ t: 1492774577, v1: ["abc"] });
  });
});

describe("timingSafeEqualHex", () => {
  test("length-first: different lengths are false without comparing content", () => {
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
  });

  test("identical values are true", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbeef")).toBe(true);
  });

  test("a one-character difference at the END is still false", () => {
    // A short-circuit on the first byte would pass a same-prefix digest. The XOR accumulator
    // must look at every character.
    expect(timingSafeEqualHex("deadbeef", "deadbeee")).toBe(false);
    expect(timingSafeEqualHex("deadbeef", "eeadbeef")).toBe(false);
  });

  test("the empty string equals itself and nothing else", () => {
    expect(timingSafeEqualHex("", "")).toBe(true);
    expect(timingSafeEqualHex("", "a")).toBe(false);
  });
});

describe("SIGNATURE_TOLERANCE_S", () => {
  // The LITERAL, written out. A test that only compares the import to itself cannot pin it.
  test("is 300 seconds — Stripe's own library default", () => {
    expect(SIGNATURE_TOLERANCE_S).toBe(300);
  });

  // 0 does not mean "strict", it means the recency check can never reject anything, because
  // |now - t| > 0 is false only at the exact same second and true forever after... which would
  // reject EVERYTHING. Either way it is wrong; this pins the direction that matters.
  test("is not 0 — 0 breaks the recency check rather than tightening it", () => {
    expect(SIGNATURE_TOLERANCE_S).toBeGreaterThan(0);
  });
});
