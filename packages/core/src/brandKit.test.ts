import { describe, expect, test } from "vitest";
import { brandImageDirection, renderBrandKit, validateBrandKit } from "./brandKit";

const kit = {
  name: "Forma",
  tagline: "Everyday form",
  audience: "Design lovers",
  positioning: "Thoughtful daily objects",
  voice: ["Clear"],
  palette: [
    { name: "Ink", hex: "#111111" },
    { name: "Paper", hex: "#ffffff" },
  ],
  typography: { heading: "Arial", body: "Arial" },
  logoDirection: "Wordmark",
  imagery: "Product close-ups",
  motion: "Slow upward camera rise",
  examples: ["Meet Forma"],
  prohibitedClaims: ["Unverified sustainability"],
};
describe("brand kit contract", () => {
  test("normalizes colors and renders an explicit revision without product authority", () => {
    const checked = validateBrandKit(kit);
    expect(checked.palette[1]?.hex).toBe("#FFFFFF");
    expect(renderBrandKit(checked, 2)).toContain("Revision: 2");
    expect(renderBrandKit(checked, 2)).toContain("not evidence of product specifications");
  });
  test("rejects malformed, unbounded and empty proposals", () => {
    for (const invalid of [
      { ...kit, name: "" },
      { ...kit, palette: [{ name: "bad", hex: "red" }] },
      { ...kit, voice: Array(13).fill("x") },
      { ...kit, imagery: "x".repeat(1201) },
    ])
      expect(() => validateBrandKit(invalid)).toThrow("INVALID_BRAND_KIT");
  });
});

test("image direction is UTF-8 bounded for multilingual brands", () => {
  const direction = brandImageDirection({ ...kit, imagery: "美".repeat(1100) });
  expect(new TextEncoder().encode(direction).length).toBeLessThanOrEqual(1200);
  expect(direction).toContain("Forma");
});
