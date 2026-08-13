import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(join(__dirname, "MediaCanvas.tsx"), "utf8");
const imageCanvas = source.slice(
  source.indexOf("function ImageCanvas("),
  source.indexOf("const dimText"),
);

describe("standalone image retry surface", () => {
  test("renders the latest immutable attempt and permits retry only after a terminal failure", () => {
    expect(imageCanvas.length).toBeGreaterThan(2_000);
    expect(imageCanvas).toContain("imageAttempts.at(-1)");
    expect(imageCanvas).toContain('asset?.status === "failed" || asset?.status === "blocked"');
    expect(imageCanvas).toContain('"Retry image"');
    expect(imageCanvas).toContain("asset.failureReason");
  });

  test("names the current provider and model, with no stale fal or Flux copy", () => {
    expect(imageCanvas).toContain("Wan is generating the image");
    expect(imageCanvas).toContain("{estimate.model}");
    expect(imageCanvas).not.toMatch(/fal is generating|Flux Schnell/);
  });
});
