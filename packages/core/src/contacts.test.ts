import { describe, expect, it } from "vitest";
import { followUpIsDue, needsAttention, normalizeAddress, renderFooter } from "./index";

describe("normalizeAddress", () => {
  const INPUTS = [
    "bob@example.com", // already normal
    "  Bob@Example.COM ", // mixed case + surrounding spaces
    "\tBOB@EXAMPLE.COM\n", // tabs and newlines
    "", // empty
    "   ", // whitespace only
    "Ann.O'Neil+tag@Sub.Example.Co.UK",
  ];

  it("trims and lowercases", () => {
    expect(normalizeAddress("  Bob@Example.COM ")).toBe("bob@example.com");
  });

  it("is idempotent — the suppressions key must be byte-stable", () => {
    for (const s of INPUTS) {
      const once = normalizeAddress(s);
      expect(normalizeAddress(once)).toBe(once);
    }
  });

  it("normalizes empty and whitespace-only input to the empty string (callers reject)", () => {
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress("   \t\n ")).toBe("");
  });

  it("does NOT strip plus-addressing or fold dots — that is person-level merging, deferred", () => {
    expect(normalizeAddress("Bob+news@Example.com")).toBe("bob+news@example.com");
    expect(normalizeAddress("b.o.b@Example.com")).toBe("b.o.b@example.com");
  });
});

describe("needsAttention", () => {
  it("is true for a contact with no open follow-up", () => {
    expect(needsAttention("c1", new Set(["c2"]))).toBe(true);
  });

  it("is false for a contact with an open follow-up", () => {
    expect(needsAttention("c1", new Set(["c1", "c2"]))).toBe(false);
  });

  it("is true when the open set is empty — done/canceled follow-ups never reach here", () => {
    expect(needsAttention("c1", new Set<string>())).toBe(true);
  });
});

describe("followUpIsDue", () => {
  const NOW = Date.UTC(2026, 7, 9);

  it("is true when the due instant has passed", () => {
    expect(followUpIsDue(NOW - 1, NOW)).toBe(true);
  });

  it("is true AT the due instant — the tile's arithmetic boundary", () => {
    expect(followUpIsDue(NOW, NOW)).toBe(true);
  });

  it("is false before the due instant", () => {
    expect(followUpIsDue(NOW + 1, NOW)).toBe(false);
  });
});

describe("renderFooter", () => {
  const POSTAL = "Pikar AI, 12 Kigali Heights, Kigali, Rwanda";
  const URL = "https://app.pikar.ai/u/abc123";

  it("contains the postal address and the unsubscribe URL verbatim", () => {
    const out = renderFooter({ postalAddress: POSTAL, unsubscribeUrl: URL });
    expect(out).toContain(POSTAL);
    expect(out).toContain(URL);
  });

  it("begins with a blank-line separator so it cannot run into the last sentence", () => {
    const out = renderFooter({ postalAddress: POSTAL, unsubscribeUrl: URL });
    expect(out.startsWith("\n\n")).toBe(true);
  });

  it("throws on an empty or whitespace-only postal address (fail closed)", () => {
    expect(() => renderFooter({ postalAddress: "", unsubscribeUrl: URL })).toThrow();
    expect(() => renderFooter({ postalAddress: "   \t ", unsubscribeUrl: URL })).toThrow();
  });

  it("throws on an empty unsubscribe URL — a dead link is not an unsubscribe", () => {
    expect(() => renderFooter({ postalAddress: POSTAL, unsubscribeUrl: "  " })).toThrow();
  });
});
