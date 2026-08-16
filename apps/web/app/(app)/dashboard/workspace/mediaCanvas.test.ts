import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TARGET_DURATIONS } from "@pikar/core/storyboard";
import { describe, expect, test } from "vitest";
import {
  BRIEF_DEFAULTED_MARKER,
  BRIEF_LOCKED_NOTE,
  BRIEF_OPTIONAL_HINT,
  type Brief,
  briefChips,
  briefRefusalText,
  type Citation,
  citationView,
  DECK_STALE_NOTE,
  DURATION_COST_NOTE,
  deckStale,
  deckSummary,
  durationLabel,
  estimateView,
  type FailureFace,
  type FailureScene,
  failureCards,
  failureText,
  heroState,
  isPickableVideo,
  type JobEstimate,
  KIND_COST_NOTE,
  KIND_LABEL,
  pictureLine,
  pricedAsLine,
  REPROPOSE_LABEL,
  REPROPOSE_MESSAGE,
  refusalText,
  ribbonShares,
  type SummaryShot,
  type TrackerScene,
  trackerView,
  variationView,
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

describe("33-06: the estimate is ONE headline, and it is jobEstimate's own number", () => {
  const est = {
    lines: [
      { label: "clips", qty: 2, unit: "8s of 30s 720p", cents: 80 },
      { label: "stills", qty: 2, unit: "pan/zoom", cents: 2 },
      { label: "voice", qty: 3, unit: "420 chars", cents: 6 },
      { label: "captions", qty: 1, unit: "0.50 min", cents: 3 },
      { label: "render (incl. one retry)", qty: 1, unit: "sandbox", cents: 4 },
    ],
    totalCents: 95,
    capCents: 500,
    remainingCents: 412,
    refusal: null,
  };
  const o = { noun: "scene", maxChars: 140 } as const;

  test("THE HEADLINE IS THE TOTAL — never a sum of the lines", () => {
    // Deliberately inconsistent input: the lines add to 95 and the total says 112. `jobEstimate`
    // owns the number the rail will consume (the render line is priced there, not here), so a view
    // that re-added the lines would print a SECOND estimate — the money bug in a new costume.
    const view = estimateView({ ...est, totalCents: 112 }, o);
    expect(view.headline).toBe("$1.12");
  });

  test("every line keeps ITS OWN label, including 33-04's retry wording", () => {
    const view = estimateView(est, o);
    expect(view.lines.map((l) => l.label)).toEqual([
      "clips",
      "stills",
      "voice",
      "captions",
      "render (incl. one retry)",
    ]);
    expect(view.lines.map((l) => l.amount)).toEqual(["$0.80", "$0.02", "$0.06", "$0.03", "$0.04"]);
    expect(view.lines[0]?.detail).toBe("2 × 8s of 30s 720p");
  });

  test("the clip line keeps the 40x lever discoverable — the whole point of itemising", () => {
    const view = estimateView(est, o);
    expect(view.lines[0]?.note).toMatch(/40/);
    expect(view.lines[1]?.note).toBeNull();
  });

  test("a still is a FORTIETH of a clip, not a tenth — the tile note said the wrong number", () => {
    // Measured at 20.2 wave 7 and written into `storyboard.ts`: a 4 s generated clip is $0.40 and a
    // still is $0.01 at any length. "About a tenth" understated the only lever the user has by 4x.
    expect(KIND_COST_NOTE.animated_image).toMatch(/fortieth/);
    expect(KIND_COST_NOTE.animated_image).not.toMatch(/tenth/);
  });

  test("the remaining budget is named in money, beside the headline", () => {
    expect(estimateView(est, o).remaining).toMatch(/\$4\.12 of today's media budget/);
  });

  test("an unresolved estimate disables Generate — a button that spends before the number lands", () => {
    const view = estimateView(undefined, o);
    expect(view.generateDisabled).toBe(true);
    expect(view.lines).toEqual([]);
    expect(view.headline).toBe("—");
  });

  test("a resolved, unrefused estimate with lines ENABLES Generate", () => {
    const view = estimateView(est, o);
    expect(view.generateDisabled).toBe(false);
    expect(view.refusalSentence).toBeNull();
  });

  test("a refusal disables Generate and names the lever", () => {
    const view = estimateView({ ...est, refusal: { reason: "over_job_cap" } }, o);
    expect(view.generateDisabled).toBe(true);
    expect(view.refusalSentence).toMatch(/over the \$5.00 per-reel limit/);
  });

  test("an estimate with NO lines cannot be generated — there is nothing to buy", () => {
    expect(estimateView({ ...est, lines: [] }, o).generateDisabled).toBe(true);
  });

  test("what is being priced is said in the DECK's terms, never the other deck's", () => {
    expect(pricedAsLine(30, 4, 4)).toBe("A 30-second reel of 4 scenes, priced per scene");
    expect(pricedAsLine(30, 4, 4)).not.toMatch(/per block/);
    expect(pricedAsLine(null, 4, 8)).toMatch(/8 s per block/);
  });
});

describe("33-06: every new refusal code is a DISTINCT lever, in a sentence", () => {
  const base = { capCents: 500, totalCents: 812, maxChars: 140, noun: "scene" } as const;
  const sentences = ["unconfirmed_claims", "deck_locked", "no_alternate", "nothing_to_render"].map(
    (reason) => refusalText({ reason, blockIndex: 1 }, base),
  );

  test("unconfirmed claims send the user to the confirmation badge, not to a rewrite", () => {
    expect(sentences[0]).toMatch(/[Cc]onfirm/);
    expect(sentences[0]).toContain("Scene 2");
  });

  test("a locked deck says the edits moved to the canvas, and that they are paid", () => {
    expect(sentences[1]).toMatch(/locked/);
    expect(sentences[1]).toMatch(/scene by scene|on the canvas/);
  });

  test("no alternate and nothing-to-render are different sentences, not one shrug", () => {
    expect(sentences[2]).toMatch(/second storyboard/);
    expect(sentences[3]).toMatch(/nothing to re-assemble|generate the reel first/);
    expect(new Set(sentences).size).toBe(4);
  });

  test("an unknown code still falls through to the generic sentence", () => {
    expect(refusalText({ reason: "invented_tomorrow" }, base)).toBe(
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

// ── 33-06 — THE PIPELINE TRACKER AND THE HERO SLOT ─────────────────────────────────────────────
//
// One layout for the whole lifecycle: the hero slot exists from the moment the deck is picked, and
// what it holds is a DERIVATION over reads that were already reactive. Every case below is a state
// a user can sit in for minutes with nothing arriving — which is exactly why the tracker exists and
// exactly why none of it may be a spinner.

const scene = (over: Partial<TrackerScene> = {}): TrackerScene => ({
  blockIndex: 0,
  visual: "generated_video",
  narration: "Say this.",
  clip: null,
  voice: null,
  ...over,
});
const stageOf = (view: ReturnType<typeof trackerView>, key: string) => {
  const found = view.stages.find((s) => s.key === key);
  if (!found) throw new Error(`no ${key} stage`);
  return found;
};

describe("the tracker is the four-stage spine, folded from the two job faces", () => {
  test("a fresh deck is pending everywhere — never 'active' before a cent moves", () => {
    const view = trackerView([scene(), scene({ blockIndex: 1 })], "pending", undefined, undefined);
    expect(view.stages.map((s) => s.key)).toEqual(["generate", "voice", "assemble", "captions"]);
    expect(view.stages.map((s) => s.state)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  test("a deck that buys no picture SKIPS generate, and says why", () => {
    // A card is drawn by ffmpeg and an upload is the tenant's own file. A "generating…" stage over
    // scenes that will never generate is the same defect as a spinner that never resolves.
    const view = trackerView(
      [scene({ visual: "text_card" }), scene({ blockIndex: 1, visual: "uploaded_video" })],
      "pending",
      undefined,
      undefined,
    );
    expect(stageOf(view, "generate").state).toBe("skipped");
    expect(stageOf(view, "generate").detail).toMatch(/own footage or a text card/);
  });

  test("a SILENT deck skips voice AND captions — there is nothing to record or transcribe", () => {
    const view = trackerView([scene({ narration: "" })], "pending", undefined, undefined);
    expect(stageOf(view, "voice").state).toBe("skipped");
    expect(stageOf(view, "captions").state).toBe("skipped");
    expect(stageOf(view, "captions").detail).toMatch(/[Ss]ilent/);
  });

  test("mid-generation counts what has landed, rather than saying 'working'", () => {
    const view = trackerView(
      [
        scene({ clip: { status: "succeeded" } }),
        scene({ blockIndex: 1, clip: { status: "submitted" } }),
      ],
      "pending",
      undefined,
      undefined,
    );
    expect(stageOf(view, "generate").state).toBe("active");
    expect(stageOf(view, "generate").detail).toBe("1 of 2 ready.");
  });

  test("a blocked or failed picture FAILS the stage — a refusal is not 'still working'", () => {
    for (const status of ["failed", "blocked"]) {
      const view = trackerView(
        [scene({ clip: { status } }), scene({ blockIndex: 1, clip: { status: "succeeded" } })],
        "pending",
        undefined,
        undefined,
      );
      expect(stageOf(view, "generate").state).toBe("failed");
      expect(stageOf(view, "generate").detail).toMatch(/1 of 2 failed/);
    }
  });

  test("the two job faces stay INDEPENDENT — voice ready while the picture has not started", () => {
    const view = trackerView(
      [scene({ voice: { status: "succeeded" } })],
      "pending",
      undefined,
      undefined,
    );
    expect(stageOf(view, "voice").state).toBe("done");
    expect(stageOf(view, "generate").state).toBe("pending");
  });

  test("a retried assembly SAYS it is a retry — the honest word, off renderRetriedAt", () => {
    const first = trackerView([scene()], "rendering", undefined, undefined);
    expect(stageOf(first, "assemble").state).toBe("active");
    expect(stageOf(first, "assemble").detail).not.toMatch(/[Rr]etry|[Rr]etrying/);

    const retried = trackerView([scene()], "rendering", undefined, 1_760_000_000_000);
    expect(stageOf(retried, "assemble").state).toBe("active");
    expect(stageOf(retried, "assemble").detail).toMatch(/first attempt failed/);
  });

  test("captions run AFTER the assembly, and a failed burn never unpublishes the reel", () => {
    const burning = trackerView([scene()], "rendered", "burning", undefined);
    expect(stageOf(burning, "assemble").state).toBe("done");
    expect(stageOf(burning, "captions").state).toBe("active");

    const failed = trackerView([scene()], "rendered", "failed", undefined);
    expect(stageOf(failed, "captions").state).toBe("failed");
    // 20-17's rule, in words: the reel is published, just without burned-in captions.
    expect(stageOf(failed, "captions").detail).toMatch(/without/);
    expect(stageOf(failed, "assemble").state).toBe("done");
  });

  test("a failed assembly is failed, and a captioned reel is done", () => {
    expect(stageOf(trackerView([scene()], "failed", undefined, undefined), "assemble").state).toBe(
      "failed",
    );
    expect(
      stageOf(trackerView([scene()], "rendered", "captioned", undefined), "captions").state,
    ).toBe("done");
  });

  test("per-scene rows land separately, and are labelled by the deck's own vocabulary", () => {
    const view = trackerView(
      [
        scene({ clip: { status: "succeeded" }, voice: { status: "submitted" } }),
        scene({ blockIndex: 1, visual: "text_card", narration: "" }),
      ],
      "pending",
      undefined,
      undefined,
    );
    expect(view.scenes).toHaveLength(2);
    expect(view.scenes[0]?.label).toBe("Scene 1");
    expect(view.scenes[0]?.picture.state).toBe("done");
    expect(view.scenes[0]?.voice.state).toBe("active");
    // A card buys no picture and a silent scene records no take — neither is "waiting".
    expect(view.scenes[1]?.picture.state).toBe("skipped");
    expect(view.scenes[1]?.voice.state).toBe("skipped");
  });
});

describe("the hero slot holds ONE thing at a time, and never jumps the layout", () => {
  const noUrl = null;
  const landed = scene({ clip: { status: "succeeded" } });

  test("before anything exists the hero is the tracker, not an empty player", () => {
    const hero = heroState({ renderStatus: "pending" }, [scene()], noUrl);
    expect(hero.mode).toBe("tracker");
    expect(hero.mode === "tracker" && hero.reason).toBe("never_built");
  });

  test("THE TRAP: stale and never-built are both 'pending' — the landed count separates them", () => {
    const hero = heroState({ renderStatus: "pending" }, [landed], noUrl);
    expect(hero.mode === "tracker" && hero.reason).toBe("out_of_date");
  });

  test("a landed final plays, muted-autoplay, with nothing else claimed", () => {
    const hero = heroState({ renderStatus: "rendered" }, [landed], "https://x/final.mp4");
    expect(hero).toEqual({
      mode: "video",
      url: "https://x/final.mp4",
      regenerating: false,
      note: null,
    });
  });

  test("during a regenerate the OLD final keeps playing, under the tracker overlay (33-05)", () => {
    const hero = heroState({ renderStatus: "rendering" }, [landed], "https://x/old.mp4");
    expect(hero.mode).toBe("video");
    expect(hero.mode === "video" && hero.regenerating).toBe(true);
    expect(hero.mode === "video" && hero.note).toMatch(/previous reel/);
  });

  test("a held final whose new run has not started yet says it is the OLD one", () => {
    // 33-05: `clearRender` resets the status to `pending` but HOLDS the artifact triple, so a url
    // with a `pending` status is the previous reel — calling it current would be a lie on screen.
    const hero = heroState({ renderStatus: "pending" }, [landed], "https://x/old.mp4");
    expect(hero.mode === "video" && hero.regenerating).toBe(false);
    expect(hero.mode === "video" && hero.note).toMatch(/previous reel/);
  });

  test("a failed re-render leaves the old final playing AND names the failure", () => {
    const hero = heroState(
      { renderStatus: "failed", renderReason: "sandbox_timeout" },
      [landed],
      "https://x/old.mp4",
    );
    expect(hero.mode === "video" && hero.regenerating).toBe(false);
    expect(hero.mode === "video" && hero.note).toMatch(/ran out of time/);
  });

  test("a HOLE in the deck HOLDS the reel — the cure is a scene fix, not a retry", () => {
    const hero = heroState(
      { renderStatus: "failed", renderReason: "incomplete_batch" },
      [scene({ clip: { status: "failed" } })],
      noUrl,
    );
    expect(hero.mode).toBe("held");
    expect(hero.mode === "held" && hero.sentence).toMatch(
      /never produced its picture or its voice/,
    );
  });

  test("every other failure is a FAILURE, and it says what happened", () => {
    const hero = heroState(
      { renderStatus: "failed", renderReason: "route_unreachable" },
      [landed],
      noUrl,
    );
    expect(hero.mode).toBe("failed");
    expect(hero.mode === "failed" && hero.sentence).toMatch(/could not be reached/);
  });

  test("'rendered' with no url is a GOVERNED REFUSAL to publish, never a missing file", () => {
    const hero = heroState({ renderStatus: "rendered" }, [landed], noUrl);
    expect(hero.mode).toBe("failed");
    expect(hero.mode === "failed" && hero.sentence).toMatch(/valid assembly record/);
  });

  test("a BLOCK deck keeps the block vocabulary in the hero's sentences", () => {
    const hero = heroState(
      { renderStatus: "failed", renderReason: "incomplete_blocks" },
      [scene({ visual: null })],
      noUrl,
    );
    expect(hero.mode === "held" && hero.sentence).toMatch(/a block is missing/);
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
      isPickableVideo({
        mimeType: "text/markdown",
        storedMimeType: "video/mp4",
        status: "processing",
      }),
    ).toBe(true);
    // A markdown doc with NO storedMimeType is still just a document — never offered.
    expect(isPickableVideo({ mimeType: "text/markdown", status: "ready" })).toBe(false);
    // A two-mime doc whose bytes are NOT video (the createDocument PDF shape) stays excluded.
    expect(
      isPickableVideo({
        mimeType: "text/markdown",
        storedMimeType: "application/pdf",
        status: "ready",
      }),
    ).toBe(false);
  });
});

// ── 33-07 — THE BRIEF CHIPS, THE STALE BADGE AND THE TWO-DECK SWITCHER ─────────────────────────
//
// Two surfaces, ONE brief. The chips are the canvas's account of what was captured, so every rule
// below is about what the canvas may claim: which fields it may block on (two), which it must mark
// as not-the-user's-word (the defaulted ones), and what it must never offer (a free-entry length).

const aBrief = (over: Partial<Brief> = {}): Brief => ({
  topic: "Launch week for the new pricing",
  durationSeconds: 30,
  defaulted: [],
  ...over,
});
const chipFor = (chips: ReturnType<typeof briefChips>, field: string) => {
  const chip = chips.find((c) => c.field === field);
  if (chip === undefined) throw new Error(`no chip for ${field}`);
  return chip;
};

describe("the brief chips are what was captured, and only two of them may block", () => {
  test("topic and length are required; audience, tone and brand voice never are", () => {
    const chips = briefChips(aBrief(), false);
    expect(chips.map((c) => c.field)).toEqual([
      "topic",
      "durationSeconds",
      "audience",
      "tone",
      "brandVoice",
    ]);
    expect(chips.filter((c) => c.required).map((c) => c.field)).toEqual([
      "topic",
      "durationSeconds",
    ]);
  });

  test("PHASE-11: an absent, untouched optional chip renders empty and says it is optional", () => {
    // The idea-stage tenant. `audience`/`tone`/`brandVoice` are simply not known yet, and the whole
    // point of Phase 11's sparse start is that this is a legal state rather than a gate.
    const chips = briefChips(aBrief(), false);
    for (const field of ["audience", "tone", "brandVoice"]) {
      const chip = chipFor(chips, field);
      expect(chip.value).toBe("");
      expect(chip.required).toBe(false);
      expect(chip.defaulted).toBe(false);
      expect(chip.marker).toBeNull();
      expect(chip.placeholder).toBe(BRIEF_OPTIONAL_HINT);
      expect(chip.editable).toBe(true);
    }
  });

  test("a DEFAULTED chip is marked as not the user's word — and is still editable", () => {
    const chips = briefChips(
      aBrief({ audience: "Solo founders", tone: "Direct", defaulted: ["audience", "tone"] }),
      false,
    );
    expect(chipFor(chips, "audience").defaulted).toBe(true);
    expect(chipFor(chips, "audience").marker).toBe(BRIEF_DEFAULTED_MARKER);
    expect(chipFor(chips, "audience").value).toBe("Solo founders");
    // Marked, never locked: editing it is exactly how it stops being defaulted (media.editBrief).
    expect(chipFor(chips, "audience").editable).toBe(true);
    // A field the user DID state carries no marker even when its neighbour is defaulted.
    expect(chipFor(chips, "topic").marker).toBeNull();
    expect(chipFor(chips, "brandVoice").defaulted).toBe(false);
  });

  test("a value the user stated is never marked, even if a defaulted list names another field", () => {
    const chips = briefChips(aBrief({ audience: "Solo founders", defaulted: ["tone"] }), false);
    expect(chipFor(chips, "audience").marker).toBeNull();
    expect(chipFor(chips, "tone").defaulted).toBe(true);
  });

  test("LENGTH IS A PRESET, and free entry is structurally impossible", () => {
    const chips = briefChips(aBrief({ durationSeconds: 30 }), false);
    const length = chipFor(chips, "durationSeconds");
    // The options ARE `TARGET_DURATIONS` — the same closed set `editBrief` validates against, so a
    // chip cannot produce the `illegal_duration` refusal at all.
    expect(length.options.map((o) => o.seconds)).toEqual([...TARGET_DURATIONS]);
    expect(length.options.filter((o) => o.current).map((o) => o.seconds)).toEqual([30]);
    expect(length.value).toBe("30 seconds");
    // Every OTHER chip is free text, and says so by carrying no options.
    for (const field of ["topic", "audience", "tone", "brandVoice"]) {
      expect(chipFor(chips, field).options).toEqual([]);
    }
  });

  test("60 SECONDS SHOWS ITS COST UP FRONT — on the option and, when picked, on the chip", () => {
    const options = chipFor(briefChips(aBrief(), false), "durationSeconds").options;
    expect(options.find((o) => o.seconds === 60)?.note).toBe(DURATION_COST_NOTE);
    // The two cheaper presets carry no note: a note on every option is a note on none.
    expect(options.find((o) => o.seconds === 15)?.note).toBeNull();
    expect(options.find((o) => o.seconds === 30)?.note).toBeNull();
    // Picked → the note MOVES to the chip itself, where it is read without opening the control.
    const picked60 = chipFor(briefChips(aBrief({ durationSeconds: 60 }), false), "durationSeconds");
    expect(picked60.note).toBe(DURATION_COST_NOTE);
    expect(chipFor(briefChips(aBrief(), false), "durationSeconds").note).toBeNull();
    // ONE CARRIER, NEVER TWO: the component renders the chip note and the option notes in the
    // same pass, so the sentence sitting in both slots at once would print it twice.
    expect(picked60.options.find((o) => o.seconds === 60)?.note).toBeNull();
  });

  test("A LOCKED DECK MAKES EVERY CHIP READ-ONLY, and says why once", () => {
    // `editBrief` answers `deck_locked` from Generate on. A chip that still looks editable is a
    // click that buys a refusal the canvas already knew about.
    const chips = briefChips(aBrief({ audience: "Solo founders", defaulted: ["audience"] }), true);
    expect(chips.every((c) => c.editable === false)).toBe(true);
    // Read-only does not mean silent: the values still render, and the marker still marks.
    expect(chipFor(chips, "audience").value).toBe("Solo founders");
    expect(chipFor(chips, "audience").marker).toBe(BRIEF_DEFAULTED_MARKER);
    expect(BRIEF_LOCKED_NOTE).toMatch(/locked/i);
  });

  test("no brief means no chips row — the canvas never invents an ask", () => {
    // `editBrief` refuses `no_brief` for exactly this reason: a chip row built over nothing would
    // launder a client-side default into "what the user asked for".
    expect(briefChips(undefined, false)).toEqual([]);
    expect(briefChips(null, false)).toEqual([]);
  });
});

describe("the stale badge fires on the two stamps and nothing else", () => {
  test("a brief edited AFTER the deck was proposed is stale", () => {
    expect(deckStale(2_000, 1_000)).toBe(true);
  });

  test("a deck proposed after the last brief edit is current", () => {
    expect(deckStale(1_000, 2_000)).toBe(false);
    // Equal stamps are the propose-then-stamp case, not an edit — never stale.
    expect(deckStale(1_000, 1_000)).toBe(false);
  });

  test("an ABSENT stamp is never stale — an unedited brief and an unproposed deck both read false", () => {
    expect(deckStale(undefined, 1_000)).toBe(false);
    expect(deckStale(2_000, undefined)).toBe(false);
    expect(deckStale(undefined, undefined)).toBe(false);
    expect(deckStale(null, null)).toBe(false);
  });

  test("editBrief's refusals have sentences — including the two a correct chip row cannot reach", () => {
    expect(briefRefusalText("deck_locked")).toBe(BRIEF_LOCKED_NOTE);
    // Unreachable from a preset control, which is the point — it is the fail-closed backstop, and
    // it names the closed set rather than the code.
    expect(briefRefusalText("illegal_duration")).toBe(
      "A reel is 15, 30 or 60 seconds long — nothing between.",
    );
    expect(briefRefusalText("no_brief")).toMatch(/no brief on this plan/);
    // An unrecognised reason must still say that NOTHING happened, never a bare "failed".
    expect(briefRefusalText("something_new")).toMatch(/Nothing was altered/);
  });

  test("the badge names the drift and the button says the re-propose is FREE", () => {
    expect(DECK_STALE_NOTE).toMatch(/Brief changed/);
    expect(REPROPOSE_LABEL).toMatch(/free/i);
    // The canned turn goes through the ordinary chat send path, so it must read as a message a
    // person could have typed — it lands in the transcript either way.
    expect(REPROPOSE_MESSAGE).toMatch(/re-propose/i);
    expect(REPROPOSE_MESSAGE.length).toBeGreaterThan(20);
  });
});

describe("the two decks are summarised the SAME way, and the switcher dies at Generate", () => {
  const picked: SummaryShot[] = [
    { visual: "generated_video", seconds: 8, description: "The founder, mid-sentence" },
    { visual: "animated_image", seconds: 4, description: "The pricing table" },
    { visual: "text_card", seconds: 3, description: "The ask" },
  ];
  const alternate: SummaryShot[] = [
    { visual: "animated_image", seconds: 6, description: "One chart, held" },
    { visual: "animated_image", seconds: 6, description: "The second chart" },
    { visual: "text_card", seconds: 3, description: "The ask" },
  ];

  test("a deck summary is scene count, kind mix, duration and the opening concept", () => {
    expect(deckSummary(picked)).toEqual({
      concept: "The founder, mid-sentence",
      sceneCount: 3,
      kindMix: "1 × GENERATED CLIP · 1 × ANIMATED STILL · 1 × TEXT CARD",
      duration: "15s",
    });
  });

  test("PARITY: the alternate is folded by the same function, so neither can drift", () => {
    // The bug this forbids: a compare region where one side counts scenes and the other counts
    // shots, or one totals seconds and the other reads the declared target. One function, twice.
    expect(deckSummary(alternate)).toEqual(deckSummary([...alternate]));
    expect(deckSummary(alternate)?.kindMix).toBe("2 × ANIMATED STILL · 1 × TEXT CARD");
    expect(deckSummary(alternate)?.duration).toBe("15s");
    // A BLOCK deck has no `visual` and must still summarise rather than printing `undefined`.
    expect(deckSummary([{ seconds: 5, description: "Open" }])?.kindMix).toBe("1 × BLOCK");
  });

  test("an empty or absent deck has no summary at all", () => {
    expect(deckSummary([])).toBeNull();
    expect(deckSummary(undefined)).toBeNull();
  });

  test("two decks, pre-Generate: comparable and switchable", () => {
    const view = variationView({ shots: picked, altShots: alternate });
    expect(view.hasAlternate).toBe(true);
    expect(view.locked).toBe(false);
    expect(view.canSwitch).toBe(true);
    expect(view.alternate?.concept).toBe("One chart, held");
    expect(view.picked?.concept).toBe("The founder, mid-sentence");
  });

  test("AFTER GENERATE the switcher is gone — locked wins even if an alternate is still on the row", () => {
    // `generateReel` clears `altShots` in the same patch that sets `deckLockedAt`, so this is
    // belt-and-braces — but `switchDeck` answers `deck_locked` FIRST for the same reason, and a
    // canvas that offered the control anyway would be showing a button that only ever refuses.
    const view = variationView({ shots: picked, altShots: alternate, deckLockedAt: 1 });
    expect(view.locked).toBe(true);
    expect(view.canSwitch).toBe(false);
    expect(view.alternate).toBeNull();
  });

  test("one deck means no compare region", () => {
    const view = variationView({ shots: picked });
    expect(view.hasAlternate).toBe(false);
    expect(view.canSwitch).toBe(false);
    expect(view.alternate).toBeNull();
    expect(view.picked?.sceneCount).toBe(3);
  });
});

// ── 33-08 — THE CITATIONS AND THE FAILURE CARDS ───────────────────────────────────────────────
//
// Two surfaces whose whole value is being RIGHT about somebody else's money and somebody else's
// word, which is why every case below is a called function rather than a source-text scan.

const cite = (over: Partial<Citation> = {}): Citation => ({
  sceneIndex: 0,
  docId: "doc_1",
  title: "Q3 revenue review",
  verified: true,
  needsConfirmation: false,
  confirmedAt: null,
  ...over,
});

describe("a citation is a link only when the document is genuinely this tenant's", () => {
  test("a verified source renders its title and its docId, ready to open", () => {
    const view = citationView([cite()]);
    const scene = view.byScene[0];
    expect(scene?.kind).toBe("cited");
    expect(scene?.link).toEqual({ title: "Q3 revenue review", docId: "doc_1" });
    expect(scene?.label).toBe("Q3 revenue review");
    expect(scene?.action).toBeNull();
    expect(view.unconfirmedCount).toBe(0);
    expect(view.blockLine).toBeNull();
  });

  test("AN UNVERIFIED SOURCE IS NEVER A LINK — a foreign or deleted id is inert", () => {
    // `sceneCitations` reports `verified:false` for a foreign, malformed or deleted docId, and the
    // two are deliberately indistinguishable to a probing model. Minting a PreviewModal link off
    // one would be a cross-tenant click-through offered by the UI.
    const view = citationView([cite({ verified: false })]);
    expect(view.byScene[0]?.kind).toBe("unverified");
    expect(view.byScene[0]?.link).toBeNull();
    expect(view.byScene[0]?.label).toMatch(/can't be checked|not in your vault/i);
    // Nothing to confirm: `confirmClaim` answers `not_a_claim` for a scene the backend never
    // flagged, so offering the button would be a control that can only ever refuse.
    expect(view.byScene[0]?.action).toBeNull();
    expect(view.unconfirmedCount).toBe(0);
  });

  test("AN UNCONFIRMED CLAIM asks the owner to vouch, and says so in words", () => {
    const view = citationView([cite({ needsConfirmation: true, docId: null, title: null })]);
    expect(view.byScene[0]?.kind).toBe("needs_confirmation");
    expect(view.byScene[0]?.link).toBeNull();
    expect(view.byScene[0]?.action).toMatch(/confirm/i);
    expect(view.unconfirmedCount).toBe(1);
  });

  test("a confirmed claim is quiet, and stops blocking", () => {
    const view = citationView([cite({ needsConfirmation: true, confirmedAt: 1_700_000_000_000 })]);
    expect(view.byScene[0]?.kind).toBe("confirmed");
    expect(view.byScene[0]?.action).toBeNull();
    // Confirmed AND verified: the source stays openable — vouching for a figure does not hide
    // where it came from.
    expect(view.byScene[0]?.link).toEqual({ title: "Q3 revenue review", docId: "doc_1" });
    expect(view.unconfirmedCount).toBe(0);
    expect(view.blockLine).toBeNull();
  });

  test("a claim whose source cannot be verified is STILL confirmable — the owner is the door", () => {
    // Both flags at once. The provenance rule's legitimate door is the owner's click, and it does
    // not require the model's cited document to check out; what it must not do is pretend the
    // unverifiable source is a real one.
    const scene = citationView([cite({ verified: false, needsConfirmation: true })]).byScene[0];
    expect(scene?.kind).toBe("needs_confirmation");
    expect(scene?.link).toBeNull();
    expect(scene?.action).toMatch(/confirm/i);
  });

  test("the deck-level line counts the claims and names Generate — singular and plural", () => {
    const one = citationView([cite({ sceneIndex: 1, needsConfirmation: true })]);
    expect(one.blockLine).toBe("Confirm 1 claim to enable Generate.");
    const two = citationView([
      cite({ sceneIndex: 1, needsConfirmation: true }),
      cite({ sceneIndex: 2, needsConfirmation: true }),
      cite({ sceneIndex: 3 }),
    ]);
    expect(two.unconfirmedCount).toBe(2);
    expect(two.blockLine).toBe("Confirm 2 claims to enable Generate.");
  });

  test("a scene that claims nothing has no entry at all — absence is the fourth state", () => {
    const view = citationView([cite({ sceneIndex: 4 })]);
    expect(view.byScene[0]).toBeUndefined();
    expect(view.byScene[4]?.kind).toBe("cited");
    expect(citationView([]).byScene).toEqual({});
    expect(citationView(undefined).unconfirmedCount).toBe(0);
  });
});

// The two money inputs, kept deliberately unequal in every fixture below: a card that printed the
// retry price in the sunk slot (or the reverse) would still print two plausible dollar amounts, so
// the tests pin BOTH strings and the swap test transposes them rather than deleting one.
const face = (over: Partial<FailureFace> = {}): FailureFace => ({
  status: "succeeded",
  failureReason: null,
  estUsd: 0.4,
  actualCents: null,
  ...over,
});

const fscene = (over: Partial<FailureScene> = {}): FailureScene => ({
  blockIndex: 0,
  visual: "generated_video",
  narration: "Revenue grew 40% last quarter.",
  clip: face(),
  voice: face({ estUsd: 0.02 }),
  ...over,
});

const anEstimate = (): JobEstimate => ({
  lines: [
    { label: "clips", qty: 1, unit: "8s of 15s 720p", cents: 40 },
    { label: "render (incl. one retry)", qty: 1, unit: "sandbox", cents: 5 },
  ],
  totalCents: 45,
  capCents: 500,
  remainingCents: 400,
  refusal: null,
});

const scenesWithFailure = (): FailureScene[] => [
  fscene(),
  fscene({
    blockIndex: 1,
    clip: face({ status: "failed", failureReason: "http_502", estUsd: 0.4, actualCents: null }),
    voice: face({ status: "succeeded", estUsd: 0.02, actualCents: 12 }),
  }),
];

const sceneCard = (over: Partial<FailureScene> = {}, est: JobEstimate | undefined = anEstimate()) =>
  failureCards({}, [fscene({ blockIndex: 1, ...over })], est).find((c) => c.where === "scene");

describe("a failure is a plain-language card with honest economics", () => {
  test("A FAILED SCENE NAMES WHAT BROKE, WHAT IT ALREADY COST, AND WHAT THE FIX ADDS", () => {
    const cards = failureCards({}, scenesWithFailure(), anEstimate());
    const card = cards.find((c) => c.where === "scene");
    expect(card?.sceneIndex).toBe(1);
    expect(card?.sceneRef).toBe("Scene 2");
    expect(card?.headline).toMatch(/picture/i);

    // SUNK: the failed clip's reservation (40c — unlanded and PERMANENTLY so, never "pending")
    // plus the voice take that actually landed and actually billed 12c.
    expect(card?.sunkLine).toContain("$0.52");
    expect(card?.sunkLine).not.toMatch(/pending|refund(ed)? to you|will be returned/i);
    expect(card?.sunkLine).toMatch(/cost|spent/i);

    // ADDS: this scene's two lines again (42c) plus the re-assembly the regenerate also reserves
    // (5c, the estimate's OWN render line). A DIFFERENT number from the sunk one, on purpose.
    const regenerate = card?.fixes.find((f) => f.arm === "regenerate");
    expect(regenerate?.priceLabel).toBe("$0.47 adds");
    expect(card?.sunkLine).not.toContain("$0.47");
    expect(regenerate?.priceLabel).not.toContain("$0.52");
  });

  test("SWAP-TESTED: transposing the two money fields moves the sunk line, it does not erase it", () => {
    // The repo's vacuous-test lesson: deleting a value makes it ABSENT and almost any assertion
    // notices. A transposition keeps every number present under the wrong label, which is the
    // mutation that actually finds a card reading the wrong field.
    const straight = sceneCard({
      clip: face({ status: "failed", failureReason: "http_502", estUsd: 0.4, actualCents: null }),
      voice: face({ estUsd: 0.02, actualCents: 12 }),
    });
    const transposed = sceneCard({
      clip: face({ status: "failed", failureReason: "http_502", estUsd: 0.4, actualCents: null }),
      voice: face({ estUsd: 0.12, actualCents: 2 }),
    });
    expect(straight?.sunkLine).toContain("$0.52");
    expect(transposed?.sunkLine).toContain("$0.42");
    expect(straight?.sunkLine).not.toBe(transposed?.sunkLine);
    // And the retry price moves the other way — 42c vs 52c of scene lines, plus the same render 5c.
    expect(straight?.fixes.find((f) => f.arm === "regenerate")?.priceLabel).toBe("$0.47 adds");
    expect(transposed?.fixes.find((f) => f.arm === "regenerate")?.priceLabel).toBe("$0.57 adds");
  });

  test("with no estimate loaded the price is honest about what it does NOT include", () => {
    // Understating money is the bad direction. Without the estimate's render line the card quotes
    // the scene's own lines and SAYS the re-assembly is on top, rather than silently omitting it.
    const card = failureCards(
      {},
      [fscene({ clip: face({ status: "failed", failureReason: "http_502" }) })],
      undefined,
    )[0];
    const regenerate = card?.fixes.find((f) => f.arm === "regenerate");
    expect(regenerate?.priceLabel).toBe("$0.42 adds, plus the re-assembly");
  });

  test("THE CHEAP FIXES ARE MARKED FREE, and the current kind is never offered back", () => {
    const card = sceneCard({ clip: face({ status: "failed", failureReason: "http_502" }) });
    const arms = card?.fixes.map((f) => f.arm);
    expect(arms).toEqual(["regenerate", "text_card", "animated_image", "uploaded_video"]);
    for (const arm of ["text_card", "animated_image", "uploaded_video"] as const) {
      expect(card?.fixes.find((f) => f.arm === arm)?.priceLabel).toMatch(/free/i);
    }
    // A still is bought by the REGENERATE that follows, not by the switch — and the ratio is the
    // measured one (a fortieth, not a tenth).
    expect(card?.fixes.find((f) => f.arm === "animated_image")?.note).toMatch(/fortieth/);
    // An animated-still scene is not offered "switch to an animated still".
    const still = sceneCard({
      visual: "animated_image",
      clip: face({ status: "failed", failureReason: "http_502" }),
    });
    expect(still?.fixes.map((f) => f.arm)).toEqual(["regenerate", "text_card", "uploaded_video"]);
  });

  test("A VOICE-ONLY FAILURE offers no kind switch — a text card would not fix a missing take", () => {
    const card = sceneCard({
      clip: face({ status: "succeeded", actualCents: 38 }),
      voice: face({ status: "failed", failureReason: "submit_failed", estUsd: 0.02 }),
    });
    expect(card?.headline).toMatch(/voice/i);
    expect(card?.fixes.map((f) => f.arm)).toEqual(["regenerate"]);
    // The landed picture's ACTUAL bill is part of what this scene has already cost.
    expect(card?.sunkLine).toContain("$0.40");
  });

  test("a BLOCKED scene says the provider refused it, and still owes the money", () => {
    const card = sceneCard({ clip: face({ status: "blocked", failureReason: "content_policy" }) });
    expect(card?.headline).toMatch(/refused/i);
    expect(card?.detailCode).toContain("content_policy");
    expect(card?.sunkLine).toContain("$0.42");
  });

  test("NO CARD PRINTS A PROVIDER STRING — the code is the detail line and nothing else", () => {
    const card = sceneCard({
      clip: face({ status: "failed", failureReason: "submit_canceled" }),
    });
    // A code the vocabulary knows becomes a SENTENCE in the headline; the code itself stays
    // underneath as the support line, never inside the prose.
    expect(card?.headline).not.toContain("submit_canceled");
    expect(card?.detailCode).toBe("picture: submit_canceled");
    expect(failureText("submit_canceled", "scene")).toMatch(/never (reached|started)|canceled/i);
    expect(failureText("submit_failed", "scene")).not.toBe("submit_failed");
  });

  test("a deck with nothing failed has no cards at all", () => {
    expect(failureCards({}, [fscene()], anEstimate())).toEqual([]);
    expect(failureCards({ renderStatus: "rendered" }, [fscene()], anEstimate())).toEqual([]);
  });
});

describe("the reel's own failures: retry, hold, and the degraded deliverable", () => {
  test("A RENDER FAILURE offers the free retry — the compute was already reserved", () => {
    const cards = failureCards(
      { renderStatus: "failed", renderReason: "sandbox_timeout" },
      [fscene()],
      anEstimate(),
    );
    const card = cards.find((c) => c.where === "hero");
    expect(card?.headline).toMatch(/ran out of time/);
    expect(card?.detailCode).toBe("sandbox_timeout");
    expect(card?.sceneRef).toBeNull();
    const retry = card?.fixes.find((f) => f.arm === "retry_render");
    expect(retry?.priceLabel).toMatch(/^free/);
    expect(retry?.note).toBeNull();
    // Nothing about a render failure is sunk on any ONE scene — the reel's own money is the
    // reserved render line, and quoting a scene's spend here would be the wrong ledger.
    expect(card?.sunkLine).toBeNull();
  });

  test("the SECOND retry says the first one already happened", () => {
    const card = failureCards(
      { renderStatus: "failed", renderReason: "route_unreachable", renderRetriedAt: 1_700_000 },
      [fscene()],
      anEstimate(),
    )[0];
    expect(card?.fixes.find((f) => f.arm === "retry_render")?.note).toMatch(/already retried/i);
  });

  test("an UNKNOWN render code still gets a sentence — the code never becomes the prose", () => {
    const card = failureCards(
      { renderStatus: "failed", renderReason: "brand_new_code" },
      [fscene()],
      anEstimate(),
    )[0];
    expect(card?.headline).not.toContain("brand_new_code");
    expect(card?.headline).toMatch(/could not be assembled/);
    expect(card?.detailCode).toBe("brand_new_code");
  });

  test("A HELD REEL IS NOT A DEAD END — it points at the scene that owes the fix", () => {
    // `incomplete_batch` means a scene never landed. The lever is that scene's own fix menu, and a
    // "Retry render" button here would re-run a sandbox over the same hole.
    const cards = failureCards(
      { renderStatus: "failed", renderReason: "incomplete_batch" },
      scenesWithFailure(),
      anEstimate(),
    );
    const held = cards.find((c) => c.where === "hero");
    expect(held?.headline).toMatch(/held/i);
    expect(held?.sceneRef).toBe("Scene 2");
    expect(held?.fixes).toEqual([]);
    // The scene's own card is still there, and it is where the arms live.
    expect(cards.filter((c) => c.where === "scene")).toHaveLength(1);
    // Hero first: the reel's state is read before its scenes'.
    expect(cards[0]?.where).toBe("hero");
  });

  test("a hold with no failed scene still says what is missing rather than naming a scene", () => {
    const held = failureCards(
      { renderStatus: "failed", renderReason: "incomplete_blocks" },
      [fscene()],
      anEstimate(),
    )[0];
    expect(held?.sceneRef).toBeNull();
    expect(held?.headline).toMatch(/held/i);
  });

  test("A CAPTION FAILURE IS A DEGRADED DELIVERABLE — the reel stands", () => {
    // 20-17's rule, said to the user: a caption failure NEVER unpublishes the reel, and there is
    // no retry arm because there is no mutation that re-burns them.
    const card = failureCards(
      { renderStatus: "rendered", captionStatus: "failed", captionReason: "incomplete_takes" },
      [fscene()],
      anEstimate(),
    )[0];
    expect(card?.where).toBe("hero");
    expect(card?.headline).toMatch(/reel is published|without them|captions/i);
    expect(card?.detailCode).toBe("incomplete_takes");
    expect(card?.fixes).toEqual([]);
    expect(failureText("incomplete_takes", "scene")).not.toBe("incomplete_takes");
  });

  test("every fix-menu refusal has a sentence in the SAME vocabulary the estimate rail uses", () => {
    // One refusal vocabulary, wherever it is read. Each of these is a code a fix arm or the retry
    // button can actually receive, and none of them quotes money — the zero context is the point.
    const noMoney = { capCents: 0, totalCents: 0, maxChars: 0, noun: "scene" } as const;
    expect(refusalText({ reason: "no_overlay" }, noMoney)).toMatch(/needs its words/);
    expect(refusalText({ reason: "not_failed" }, noMoney)).toMatch(/nothing to retry/);
    expect(refusalText({ reason: "no_block" }, noMoney)).toMatch(/isn't on this plan/);
    expect(refusalText({ reason: "unknown_visual" }, noMoney)).toMatch(
      /can't render|cannot render|isn't a kind/,
    );
    expect(refusalText({ reason: "not_a_claim" }, noMoney)).toMatch(/no flagged figure/);
    // The block deck's vocabulary follows the noun, as everywhere else on this surface.
    expect(refusalText({ reason: "no_deck" }, { ...noMoney, noun: "block" })).toMatch(/block/);
  });

  test("a rendered reel with captions burned in has no cards", () => {
    expect(
      failureCards({ renderStatus: "rendered", captionStatus: "captioned" }, [fscene()], undefined),
    ).toEqual([]);
  });
});
