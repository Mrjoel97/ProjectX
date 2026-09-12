import { describe, expect, test } from "vitest";
import {
  formatFunnelCount,
  MARKETING_CHANNEL_CATALOG,
  marketingChannelState,
  normalizeFunnelSource,
  parseFunnelCounters,
  parseFunnelStage,
} from "./marketing";

describe("Phase 31 honest marketing contract", () => {
  test("catalog is exactly the six approved channels including TikTok", () => {
    expect(MARKETING_CHANNEL_CATALOG.map((channel) => channel.name)).toEqual([
      "Gmail",
      "Meta/Instagram",
      "LinkedIn",
      "TikTok",
      "X",
      "YouTube",
    ]);
  });
  test.each([
    "meta-instagram",
    "linkedin",
    "tiktok",
    "x",
    "youtube",
  ] as const)("%s is blocked by both external prerequisites, never connectable", (id) => {
    for (const gmail of [{}, { connected: true, configured: true }]) {
      const state = marketingChannelState(id, gmail);
      expect(state?.status).toBe("blocked-with-reason");
      expect(state && "reason" in state && state.reason).toMatch(/legal entity is not formed/);
      expect(state && "reason" in state && state.reason).toMatch(
        /provider suitability and permissions review has not started/,
      );
      expect(state).not.toHaveProperty("cta");
    }
  });
  test("Gmail does not invent missing state and only connects when configured", () => {
    expect(marketingChannelState("gmail", {})).toBeNull();
    expect(marketingChannelState("gmail", { connected: false })).toBeNull();
    expect(marketingChannelState("gmail", { connected: true })).toEqual({ status: "connected" });
    expect(marketingChannelState("gmail", { connected: false, configured: true })).toMatchObject({
      status: "connectable",
      cta: { href: "/connect-gmail" },
    });
    expect(marketingChannelState("gmail", { connected: false, configured: false })).toMatchObject({
      status: "blocked-with-reason",
    });
  });
  test("missing and malformed counters are never zeros", () => {
    expect(parseFunnelCounters(undefined)).toBeNull();
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", undefined]) {
      expect(parseFunnelCounters({ visits: bad, claims: 0, downloads: 0 })).toBeNull();
      expect(formatFunnelCount(bad)).toBe("—");
    }
    expect(parseFunnelCounters({ visits: 0, claims: 2, downloads: 3 })).toEqual({
      visits: 0,
      claims: 2,
      downloads: 3,
    });
    expect(formatFunnelCount(0)).toBe("0");
    expect(formatFunnelCount(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
  });
  test("stages are exact independent names and source is one bounded creation-time value", () => {
    for (const stage of ["visit", "claim", "download"]) expect(parseFunnelStage(stage)).toBe(stage);
    for (const stage of ["Visit", "visits", "../visit", "", null])
      expect(parseFunnelStage(stage)).toBeNull();
    expect(normalizeFunnelSource("  Newsletter Spring  ")).toBe("newsletter-spring");
    expect(normalizeFunnelSource("a".repeat(64))).toHaveLength(64);
    for (const bad of ["", "a".repeat(65), "__proto__", "https://x", "a\nB", {}, null])
      expect(normalizeFunnelSource(bad)).toBeNull();
  });
});
