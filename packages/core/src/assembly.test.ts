// @vitest-environment node
//
// The sidecar fixtures under `__fixtures__/assembly/` are COMMITTED FILES, not inline strings, so
// plan 20-15's failure matrix drives the real runner against the same bytes this validator was
// written to. An inline fixture here would have to be re-invented there, and the two would drift.
//
// `valid.json` carries the numbers a REAL render produced (20.2 wave 4's smoke): a mixed deck of
// video:8 + image:6 + card:4 + video:12, where the card is deliberately silent and scene 2's line
// outruns its own 6-second scene into it. A fixture of six identical 10s blocks would have passed
// every check in here while proving nothing about the contract this file now enforces.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DURATION_TOLERANCE_S,
  isGovernedRender,
  parseAssemblySidecar,
  TIMELINE_SLACK_S,
} from "./assembly";

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
  return !r.ok && "sceneIndex" in r.error ? r.error.sceneIndex : undefined;
};

describe("a governed render", () => {
  const r = parseAssemblySidecar(fixture("valid"));

  it("parses to a typed report with sceneCount scenes", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sceneCount).toBe(4);
    expect(r.value.scenes).toHaveLength(4);
    expect(r.value.targetDurationS).toBe(30);
    expect(r.value.totalDurationS).toBe(30);
  });

  it("maps snake_case to camelCase — the mapping lives in ONE file", () => {
    if (!r.ok) throw new Error("expected ok");
    const first = r.value.scenes[0];
    expect(first).toMatchObject({
      index: 0,
      startS: 0,
      durationS: 8,
      visual: "video",
      leadSilenceS: 0.2,
      speechAbsS: 0.4,
      speechDurS: 7.6,
      overrun: false,
    });
  });

  it("carries the per-scene lengths and kinds — a reel is no longer N x one number", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.scenes.map((s) => s.durationS)).toEqual([8, 6, 4, 12]);
    expect(r.value.scenes.map((s) => s.visual)).toEqual(["video", "image", "card", "video"]);
    expect(r.value.scenes.map((s) => s.startS)).toEqual([0, 8, 14, 18]);
  });

  it("a SILENT scene is recorded as speechDurS 0 — the captions' only key to the take list", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.scenes[2]?.speechDurS).toBe(0);
    expect(r.value.scenes.filter((s) => s.speechDurS > 0)).toHaveLength(3);
  });

  it("ACCEPTS a line that outruns its own scene — that is the scene timeline, not a fault", () => {
    if (!r.ok) throw new Error("expected ok");
    const second = r.value.scenes[1];
    if (!second) throw new Error("fixture lost its second scene");
    expect(second.speechDurS).toBeGreaterThan(second.durationS);
  });

  it("carries the gate list the script recorded", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.gates).toContain("no_time_stretch");
    expect(r.value.gates).toContain("narration_every_narrated_span");
  });

  it("isGovernedRender is the one-line question", () => {
    expect(isGovernedRender(fixture("valid"))).toBe(true);
    expect(isGovernedRender(fixture("overrun-scene-4"))).toBe(false);
  });
});

describe("THE V1 SHAPE IS REFUSED OUTRIGHT — a validator that accepts two proves neither", () => {
  it("names the old shape rather than falling through to missing_field", () => {
    // "A field is missing" sends an operator looking for a corrupted write. "This is the old
    // shape" says the runner is stale and names the fix.
    expect(codeOf("legacy-v1")).toBe("legacy_sidecar");
    expect(isGovernedRender(fixture("legacy-v1"))).toBe(false);
  });

  it("ANY of the three retired fields is enough, even beside a valid scene shape", () => {
    const valid = JSON.parse(fixture("valid")) as Record<string, unknown>;
    for (const field of ["block_count", "clip_seconds", "blocks"]) {
      const r = parseAssemblySidecar(JSON.stringify({ ...valid, [field]: 1 }));
      expect(r.ok, `${field} was tolerated alongside the new shape`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("legacy_sidecar");
    }
  });

  it("was safe to ship because it was MEASURED: no published reel carries a v1 sidecar", () => {
    // Production held 257 `plans` rows on 2026-08-14, fully scanned, and zero had a
    // `sidecarStorageId`. This test is the note, not the check — but the note belongs beside the
    // refusal it justifies, because the refusal is only correct while that is true.
    expect(codeOf("legacy-v1")).toBe("legacy_sidecar");
  });
});

describe("the refusals — each failure gets its OWN code", () => {
  it("an overrunning scene is a FAILED render, not a rendered failure", () => {
    expect(codeOf("overrun-scene-4")).toBe("scene_overrun");
    expect(indexOf("overrun-scene-4")).toBe(3); // 0-based — "scene 4" as the script counts it
  });

  it("speech past the END OF THE REEL is refused — the line would be cut mid-word", () => {
    expect(codeOf("speech-past-reel")).toBe("speech_past_reel");
    expect(indexOf("speech-past-reel")).toBe(3);
  });

  it("two lines speaking at once is refused, by the same rule the assembler applies", () => {
    expect(codeOf("overlapping-speech")).toBe("overlapping_speech");
    expect(indexOf("overlapping-speech")).toBe(1);
  });

  it("a start_s that is not the running sum is refused — captions rebase off it", () => {
    expect(codeOf("bad-scene-offset")).toBe("bad_scene_offset");
    expect(indexOf("bad-scene-offset")).toBe(2);
  });

  it("a visual kind we did not ship is a renderer we did not ship", () => {
    expect(codeOf("bad-scene-shape")).toBe("bad_scene_shape");
    expect(indexOf("bad-scene-shape")).toBe(1);
  });

  it("either missing rebase anchor is missing_speech_anchor, with the scene index", () => {
    expect(codeOf("missing-speech-anchor")).toBe("missing_speech_anchor");
    expect(indexOf("missing-speech-anchor")).toBe(1);
    expect(codeOf("missing-lead-silence")).toBe("missing_speech_anchor");
    expect(indexOf("missing-lead-silence")).toBe(1);
  });

  it("a scene_count that disagrees with the array is refused", () => {
    expect(codeOf("scene-count-mismatch")).toBe("scene_count_mismatch");
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
  const scenesOf = () =>
    (JSON.parse(fixture("valid")) as { scenes: Record<string, unknown>[] }).scenes;

  it("the scenes must SUM to the declared target — the check `N x clip` used to be", () => {
    const scenes = scenesOf();
    const last = scenes[3];
    if (!last) throw new Error("fixture lost its last scene");
    last.duration_s = 11; // 8 + 6 + 4 + 11 = 29, not 30
    expect(codeFor({ scenes })).toBe("duration_mismatch");
  });

  it("a total_duration_s that disagrees with the target is refused", () => {
    expect(codeFor({ total_duration_s: 45 })).toBe("duration_mismatch");
    expect(codeFor({ actual_duration_s: 45 })).toBe("duration_mismatch");
  });

  it(`…but ${DURATION_TOLERANCE_S}s of slack is allowed on the MEASURED length`, () => {
    // Tightened from 1s in wave 4: every duration on a scene timeline is one the script chose.
    expect(codeFor({ actual_duration_s: 30.4 })).toBe("ok");
    expect(codeFor({ actual_duration_s: 30.6 })).toBe("duration_mismatch");
  });

  it(`${TIMELINE_SLACK_S}s of slack on the timeline checks, matching the script's own`, () => {
    const scenes = scenesOf();
    const last = scenes[3];
    if (!last) throw new Error("fixture lost its last scene");
    last.speech_dur_s = 11.83; // ends at 30.03 — inside the slack
    expect(codeFor({ scenes })).toBe("ok");
    last.speech_dur_s = 11.9; // ends at 30.10 — outside it
    expect(codeFor({ scenes })).toBe("speech_past_reel");
  });

  it("non-monotonic speech_abs_s is refused — scenes cannot play out of order", () => {
    const scenes = scenesOf();
    const fourth = scenes[3];
    if (!fourth) throw new Error("fixture lost its fourth scene");
    fourth.speech_abs_s = 5; // earlier than scene 3 — the reel would play out of order
    expect(codeFor({ scenes })).toBe("non_monotonic_speech");
  });

  it("a missing top-level field is missing_field, never a silent default", () => {
    for (const field of [
      "scene_count",
      "target_duration_s",
      "total_duration_s",
      "actual_duration_s",
      "gates",
      "scenes",
    ]) {
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
