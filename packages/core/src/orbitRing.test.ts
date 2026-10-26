import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseAssemblySidecar } from "./assembly";
import { parseMediaFinishing } from "./mediaFinishing";
import { orbitRingAss } from "./orbitRing";
import { nativeGraphicColorsOf } from "./render";

test("ring color uses the reviewed palette accent and refuses arbitrary ASS content", () => {
  expect(nativeGraphicColorsOf(["black #080808", "gold #D7B77A"])).toEqual({
    bg: "0x080808",
    ink: "0xD7B77A",
  });
  expect(nativeGraphicColorsOf(undefined)).toEqual({ bg: "0x000000", ink: "0xFFFFFF" });
  expect(orbitRingAss(1, "0xD7B77A")).toContain("\\1c&H7AB7D7&");
  for (const color of ["gold", "#D7B77A", "0xFFFFFF\\pos(0,0)", "0x12345678"])
    expect(() => orbitRingAss(1, color)).toThrow("INVALID_RING_COLOR");
});

test("closed 3D ring renderer is bounded, deterministic and time-aligned", () => {
  const ass = orbitRingAss(15);
  expect(ass).toBe(orbitRingAss(15));
  expect(new TextEncoder().encode(ass).length).toBeLessThan(5 * 1024 * 1024);
  expect(ass.match(/^Dialogue:/gm)).toHaveLength(15 * 24 * 48);
  expect(ass).toContain("0:00:15.00");
  expect(() => orbitRingAss(16)).toThrow("INVALID_RING_DURATION");
  expect(() => orbitRingAss(1.5)).toThrow("INVALID_RING_DURATION");
  expect(parseMediaFinishing({ motionGraphic: "orbit-ring" }, 15000)).toEqual({
    motionGraphic: "orbit-ring",
  });
  expect(parseMediaFinishing({ motionGraphic: "orbit-ring" }, 16000)).toBeNull();
  expect(parseMediaFinishing({ motionGraphic: "model-url" } as never, 15000)).toBeNull();
});

test("the animated finishing profile refuses a stale static-only runner", () => {
  const report = JSON.parse(
    readFileSync(new URL("./__fixtures__/assembly/valid.json", import.meta.url), "utf8"),
  );
  expect(
    parseAssemblySidecar(
      JSON.stringify({ ...report, finishing_version: 2, finishing_cue_count: 1 }),
    ).ok,
  ).toBe(true);
  expect(
    parseAssemblySidecar(
      JSON.stringify({ ...report, finishing_version: 1, finishing_cue_count: 1 }),
    ).ok,
  ).toBe(false);
});
