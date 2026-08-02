// @vitest-environment node
//
// The sidecar fixtures under `__fixtures__/assembly/` are COMMITTED FILES, not inline strings, so
// plan 20-15's failure matrix drives the real runner against the same bytes this validator was
// written to. An inline fixture here would have to be re-invented there, and the two would drift.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DURATION_TOLERANCE_S, isGovernedRender, parseAssemblySidecar } from "./assembly";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`./__fixtures__/assembly/${name}.json`, import.meta.url)),
    "utf8",
  );

/** The failure code, or "ok". Keeps every negative case to one legible line. */
const codeOf = (name: string) => {
  const r = parseAssemblySidecar(fixture(name));
  return r.ok ? "ok" : r.error.code;
};
const indexOf = (name: string) => {
  const r = parseAssemblySidecar(fixture(name));
  return !r.ok && "blockIndex" in r.error ? r.error.blockIndex : undefined;
};

describe("a governed render", () => {
  const r = parseAssemblySidecar(fixture("valid"));

  it("parses to a typed report with blockCount blocks", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.blockCount).toBe(6);
    expect(r.value.blocks).toHaveLength(6);
    expect(r.value.clipSeconds).toBe(10);
    expect(r.value.totalDurationS).toBe(60);
  });

  it("maps snake_case to camelCase — the mapping lives in ONE file", () => {
    if (!r.ok) throw new Error("expected ok");
    const first = r.value.blocks[0];
    expect(first).toMatchObject({
      blockIndex: 0,
      windowStartS: 0,
      leadSilenceS: 0.35,
      speechAbsS: 0.5,
      speechDurS: 9,
      overrun: false,
    });
  });

  it("carries the gate list the script recorded", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.gates).toContain("no_time_stretch");
    expect(r.value.gates).toContain("narration_every_window");
  });

  it("isGovernedRender is the one-line question", () => {
    expect(isGovernedRender(fixture("valid"))).toBe(true);
    expect(isGovernedRender(fixture("overrun-block-4"))).toBe(false);
  });
});

describe("the refusals — each failure gets its OWN code", () => {
  it("an overrunning block is a FAILED render, not a rendered failure", () => {
    expect(codeOf("overrun-block-4")).toBe("block_overrun");
    expect(indexOf("overrun-block-4")).toBe(3); // 0-based — "block 4" as the script counts it
  });

  it("speech longer than its window is refused by ARITHMETIC too, in case the flag lied", () => {
    expect(codeOf("speech-exceeds-window")).toBe("speech_exceeds_window");
    expect(indexOf("speech-exceeds-window")).toBe(2);
  });

  it("either missing rebase anchor is missing_speech_anchor, with the block index", () => {
    expect(codeOf("missing-speech-anchor")).toBe("missing_speech_anchor");
    expect(indexOf("missing-speech-anchor")).toBe(1);
    expect(codeOf("missing-lead-silence")).toBe("missing_speech_anchor");
    expect(indexOf("missing-lead-silence")).toBe(1);
  });

  it("a block_count that disagrees with the array is refused", () => {
    expect(codeOf("block-count-mismatch")).toBe("block_count_mismatch");
  });

  it("EMPTY and MALFORMED are different stories and get different codes", () => {
    // empty = the script died before writing one; malformed = it wrote one and it got corrupted.
    expect(codeOf("empty")).toBe("empty");
    expect(codeOf("malformed")).toBe("bad_json");
  });

  it("valid JSON that is not a sidecar object is not_an_object", () => {
    expect(codeOf("array")).toBe("not_an_object");
    expect(codeOf("null")).toBe("not_an_object");
  });
});

describe("range checks that need no fixture file", () => {
  const valid = JSON.parse(fixture("valid")) as Record<string, unknown>;
  const withPatch = (patch: Record<string, unknown>) =>
    parseAssemblySidecar(JSON.stringify({ ...valid, ...patch }));
  const codeFor = (patch: Record<string, unknown>) => {
    const r = withPatch(patch);
    return r.ok ? "ok" : r.error.code;
  };

  it("clip_seconds outside {5,10} is refused — a window nobody priced", () => {
    for (const s of [3, 7, 15, 0]) expect(codeFor({ clip_seconds: s })).toBe("bad_clip_seconds");
  });

  it("a total_duration_s that disagrees with block_count x clip_seconds is refused", () => {
    expect(codeFor({ total_duration_s: 45 })).toBe("duration_mismatch");
    expect(codeFor({ actual_duration_s: 45 })).toBe("duration_mismatch");
  });

  it(`…but ${DURATION_TOLERANCE_S}s of slack is allowed — the script's own gate`, () => {
    expect(codeFor({ actual_duration_s: 60.9 })).toBe("ok");
    expect(codeFor({ actual_duration_s: 61.5 })).toBe("duration_mismatch");
  });

  it("non-monotonic speech_abs_s is refused — blocks cannot play out of order", () => {
    const blocks = (JSON.parse(fixture("valid")) as { blocks: Record<string, unknown>[] }).blocks;
    const fourth = blocks[3];
    if (!fourth) throw new Error("fixture lost its fourth block");
    fourth.speech_abs_s = 5; // earlier than block 3 — the reel would play out of order
    expect(codeFor({ blocks })).toBe("non_monotonic_speech");
  });

  it("a missing top-level field is missing_field, never a silent default", () => {
    for (const field of ["block_count", "clip_seconds", "total_duration_s", "gates", "blocks"]) {
      const partial = { ...valid };
      delete partial[field];
      const r = parseAssemblySidecar(JSON.stringify(partial));
      expect(r.ok, `${field} was allowed to be missing`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("missing_field");
    }
  });

  it("garbage never throws", () => {
    for (const junk of ["", " ", "{", "[]", "null", "0", '"a string"', "{}"]) {
      expect(() => parseAssemblySidecar(junk)).not.toThrow();
      expect(isGovernedRender(junk)).toBe(false);
    }
  });
});
