import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  durationLabel,
  failureText,
  isPickableVideo,
  KIND_LABEL,
  pictureLine,
  refusalText,
  ribbonShares,
  voiceLine,
  windowLabel,
} from "./mediaCanvasView";

const source = readFileSync(join(__dirname, "MediaCanvas.tsx"), "utf8");
const imageCanvas = source.slice(
  source.indexOf("function ImageCanvas("),
  source.indexOf("export function CanvasPane"),
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

// ── 20.2 wave 6 — the SCENE TIMELINE, as the canvas derives it ─────────────────────────────────
//
// Every case below was reachable on the shipped canvas and wrong: the window came off
// `index * clipSeconds`, the badge came off a block-era `type`, and three of the four scene kinds
// reported a clip job they will never have.

describe("a scene's place on the timeline is its OWN, never index x clipSeconds", () => {
  test("labels the window from the scene's real offset and length", () => {
    // The 8 / 6 / 4 / 12 deck. Under the old arithmetic (index x the deck's longest scene, 12)
    // scene 2 would have read 0:24–0:36 — a window it was never cut to.
    expect(windowLabel(0, 8_000)).toBe("0:00–0:08");
    expect(windowLabel(8_000, 6_000)).toBe("0:08–0:14");
    expect(windowLabel(14_000, 4_000)).toBe("0:14–0:18");
    expect(windowLabel(18_000, 12_000)).toBe("0:18–0:30");
  });

  test("crosses the minute without wrapping to 0:60", () => {
    expect(windowLabel(56_000, 8_000)).toBe("0:56–1:04");
    expect(windowLabel(115_000, 5_000)).toBe("1:55–2:00");
  });

  test("prints a whole-second length as a whole number, and a malformed one as odd", () => {
    expect(durationLabel(12_000)).toBe("12s");
    expect(durationLabel(1_500)).toBe("1.5s"); // never "2s" — a rounded lie reads as correct
  });
});

describe("the ribbon is proportional, but nothing is too thin to read", () => {
  test("a scene twice as long gets twice the free width", () => {
    const [a, b] = ribbonShares([4_000, 8_000], 0);
    expect(a).toBeCloseTo(1 / 3, 10);
    expect(b).toBeCloseTo(2 / 3, 10);
  });

  test("shares always sum to one, floor or no floor", () => {
    for (const durations of [[8_000, 6_000, 4_000, 12_000], [30_000], [2_000, 58_000]]) {
      const sum = ribbonShares(durations).reduce((n, s) => n + s, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  test("a 2-second scene inside a 60-second reel is still wide enough to click", () => {
    // 2s of 60s is 3.3% — a sliver with no room for a label. The floor is what makes the strip
    // usable, and it must not cost the LONGER scene its lead.
    const [short = 0, long = 0] = ribbonShares([2_000, 58_000], 0.05);
    expect(short).toBeGreaterThanOrEqual(0.05);
    expect(long).toBeGreaterThan(short * 5);
  });

  test("a zero-length or empty deck gets equal shares, never NaN widths", () => {
    expect(ribbonShares([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(ribbonShares([])).toEqual([]);
    expect(ribbonShares([5_000]).every(Number.isFinite)).toBe(true);
  });

  test("a floor larger than an equal split cannot invert the proportions", () => {
    const [a = 0, b = 0] = ribbonShares([1_000, 9_000], 0.9);
    expect(b).toBeGreaterThanOrEqual(a);
    const shares = [a, b];
    expect(shares.reduce((n, s) => n + s, 0)).toBeCloseTo(1, 10);
  });
});

describe("a tile says what its kind actually does — three of four never have a clip job", () => {
  test("a text card is drawn at render time, not waiting to start", () => {
    // The shipped canvas said "Clip: not requested yet" here, forever, about a picture that is
    // never requested from anyone.
    expect(pictureLine("text_card", null, null)).toMatch(/drawn when the reel is assembled/);
    expect(pictureLine("text_card", null, null)).not.toMatch(/not requested yet|waiting/);
  });

  test("an upload with no document names the missing thing and where to fix it", () => {
    expect(pictureLine("uploaded_video", null, null)).toMatch(/none chosen — pick a video/);
    expect(pictureLine("uploaded_video", null, { docId: "d1" }, "Founder interview.mp4")).toBe(
      "Footage: Founder interview.mp4",
    );
  });

  test("a still and a clip are different jobs, and are worded as different jobs", () => {
    expect(pictureLine("animated_image", { status: "submitted" }, null)).toBe("Still: generating…");
    expect(pictureLine("generated_video", { status: "submitted" }, null)).toBe(
      "Clip: generating… (usually 1–3 minutes)",
    );
    expect(pictureLine("generated_video", { status: "blocked" }, null)).toMatch(
      /refused by the provider/,
    );
  });

  test("an unknown provider status is shown, never swallowed", () => {
    expect(pictureLine("generated_video", { status: "wedged" }, null)).toBe("Clip: wedged");
  });

  test("a silent scene is silent on purpose, not a take that failed to arrive", () => {
    expect(voiceLine("", null)).toMatch(/silent scene/);
    expect(voiceLine("Say this.", null)).toBe("Voice: not requested yet");
    expect(voiceLine("Say this.", { status: "succeeded" })).toBe("Voice: ready");
  });

  test("every kind has a badge and a cost note — a new kind cannot ship unlabelled", () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual([
      "animated_image",
      "generated_video",
      "text_card",
      "uploaded_video",
    ]);
  });
});

describe("the refusal names the lever, in the deck's own vocabulary", () => {
  const base = { capCents: 500, totalCents: 812, maxChars: 140, noun: "scene" } as const;

  test("the stale IMAGE copy is gone — the narrowed guard is about naming a source", () => {
    const text = refusalText({ reason: "unrenderable_block", blockIndex: 2 }, base);
    // `IMAGE` was never a ShotType, and a card and an upload are both renderable since wave 5.
    expect(text).not.toMatch(/only VIDEO and IMAGE/);
    expect(text).toContain("Scene 3");
    expect(text).toMatch(/text card needs its words/);
    expect(text).toMatch(/footage needs a video picked from the vault/);
  });

  test("the duration refusal names the model's grid on a scene deck, and 5-or-10 on a block one", () => {
    expect(refusalText({ reason: "illegal_duration" }, base)).toMatch(/4, 8 or 12 seconds/);
    expect(refusalText({ reason: "illegal_duration" }, { ...base, noun: "block" })).toBe(
      "Every block must be 5 or 10 seconds.",
    );
  });

  test("the cap refusal offers the lever that is actually cheaper on a scene deck", () => {
    const text = refusalText({ reason: "over_job_cap" }, base);
    expect(text).toContain("$8.12");
    expect(text).toContain("$5.00");
    // Not "use the four-second clip tier" — on a scene deck the 10x lever is the animated still.
    expect(text).toMatch(/animated still/);
  });

  test("a scene with nothing to buy is told so, not told the deck is broken", () => {
    expect(refusalText({ reason: "nothing_to_regenerate", blockIndex: 0 }, base)).toMatch(
      /nothing to buy again for scene 1/,
    );
  });

  test("an unrecognised reason still says something true", () => {
    expect(refusalText({ reason: "something_new" }, base)).toBe(
      "This reel can't be generated yet.",
    );
  });
});

describe("a failed render says what happened, and what to do about it", () => {
  test("stale inputs are neither a retry nor an edit — they are a re-buy", () => {
    const text = failureText("stale_inputs", "scene");
    expect(text).toMatch(/reordered or trimmed/);
    expect(text).toMatch(/generate the reel again/);
  });

  test("an unknown code falls through to the code itself rather than being swallowed", () => {
    expect(failureText("brand_new_code", "scene")).toBe("brand_new_code");
  });
});

describe("the vault picker offers only what the render will accept", () => {
  test("video documents only — the same narrowing resolveRenderAsset applies", () => {
    expect(isPickableVideo({ mimeType: "video/mp4", status: "ready" })).toBe(true);
    expect(isPickableVideo({ mimeType: "application/pdf", status: "ready" })).toBe(false);
    expect(isPickableVideo({ mimeType: null, status: "ready" })).toBe(false);
    // A failed ingest has no bytes to render, so offering it would buy a refusal later.
    expect(isPickableVideo({ mimeType: "video/mp4", status: "failed" })).toBe(false);
  });

  test("33-05: a SAVED REEL is pickable — the BYTES are video, whatever the row says", () => {
    // The saved-reel shape: `mimeType` markdown (the searchable transcript row),
    // `storedMimeType` the mp4 bytes. `(storedMimeType ?? mimeType)` is what the render serves.
    expect(
      isPickableVideo({ mimeType: "text/markdown", storedMimeType: "video/mp4", status: "processing" }),
    ).toBe(true);
    // A markdown doc with NO storedMimeType is still just a document — never offered.
    expect(isPickableVideo({ mimeType: "text/markdown", status: "ready" })).toBe(false);
    // A two-mime doc whose bytes are NOT video (the createDocument PDF shape) stays excluded.
    expect(
      isPickableVideo({ mimeType: "text/markdown", storedMimeType: "application/pdf", status: "ready" }),
    ).toBe(false);
  });
});
