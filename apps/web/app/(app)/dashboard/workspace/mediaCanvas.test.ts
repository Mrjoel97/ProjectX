import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deckStillNeedsJob } from "@pikar/core/render";
import { GENERIC_DECK_REFUSAL, TARGET_DURATIONS, VISUAL_KINDS } from "@pikar/core/storyboard";
import { MEDIA_GENERATED_SECONDS_CAP, sceneVisualSpec } from "@pikar/cost/media";
import { describe, expect, test } from "vitest";
import {
  adjustmentNotes,
  BRIEF_DEFAULTED_MARKER,
  BRIEF_LOCKED_NOTE,
  BRIEF_OPTIONAL_HINT,
  type Brief,
  briefChips,
  briefRefusalText,
  type Citation,
  CLIP_COST_LEVER_NOTE,
  CLIP_VS_STILL_RATIO,
  citationView,
  DECK_ADJUSTED_LEDE,
  DECK_STALE_NOTE,
  DURATION_COST_NOTE,
  deckStale,
  deckSummary,
  durationLabel,
  estimateView,
  type FailureFace,
  type FailureScene,
  failureCards,
  failureClause,
  failureText,
  GENERATED_LENGTH_RANGE,
  GENERIC_FAILURE_CLAUSE,
  heroState,
  isPickableVideo,
  type JobEstimate,
  KIND_COST_NOTE,
  KIND_LABEL,
  pictureLine,
  pricedAsLine,
  proposalFailureCard,
  REPROPOSE_LABEL,
  REPROPOSE_MESSAGE,
  RETRY_PROPOSAL_LABEL,
  RETRY_PROPOSAL_MESSAGE,
  refusalText,
  ribbonShares,
  type SummaryShot,
  salvageNote,
  type TrackerScene,
  trackerView,
  variationView,
  voiceLine,
  windowLabel,
} from "./mediaCanvasView";

/**
 * THE CLIP-VS-STILL LEVER, RE-DERIVED HERE FROM THE PRICE TABLES — never a literal.
 *
 * This number has been wrong on screen three times: "a tenth" until 33-06, "a fortieth" until
 * 33.1-03 measured the still at $0.006, and again when 33.1-04 moved the clip to $0.07/s. Each
 * time the tests were GREEN, because they pinned the stale word (`/fortieth/`) instead of the
 * computed value — a check that cannot fail, over the only cost lever this product tells anyone
 * they have. So the assertions below compute the ratio the same way the copy does, and a price
 * move updates both together instead of putting them into silent disagreement.
 */
const usdAt4s = (visual: "generated_video" | "animated_image"): number => {
  const r = sceneVisualSpec(visual, 4);
  if (!r.ok || r.value === null) throw new Error("expected a priced scene line");
  return r.value.usd;
};
const EXPECTED_RATIO = Math.round(usdAt4s("generated_video") / usdAt4s("animated_image"));

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
      "stock_image",
      "stock_video",
      "text_card",
      "uploaded_video",
    ]);
    // The badge is only half of it: a kind with a label and no cost note reads as free-or-not
    // ambiguous on the tile, which is the one question the badge exists to settle.
    expect(Object.keys(KIND_COST_NOTE).sort()).toEqual(Object.keys(KIND_LABEL).sort());
  });

  test("a STOCK tile never says 'generating' — nothing is generated for it", () => {
    // The word is the whole branch. A user watching "generating..." over a free library search has
    // been told the reel is spending money on that scene, which is exactly what the badge and the
    // cost note are there to deny.
    for (const visual of ["stock_video", "stock_image"] as const) {
      const line = pictureLine(visual, { status: "submitted" }, null);
      expect(line).not.toMatch(/generating/i);
      expect(line).toMatch(/free library/i);
    }
    // ...and it still reports the JOB's real states, because a stock scene has one.
    expect(pictureLine("stock_video", { status: "succeeded" }, null)).toMatch(/ready/);
    expect(pictureLine("stock_image", { status: "succeeded" }, null)).toMatch(/^Still:/);
    expect(pictureLine("stock_video", { status: "succeeded" }, null)).toMatch(/^Clip:/);
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
    // A RANGE, derived from `GENERATED_CLIP_SECONDS` — not a second copy of the grid in prose.
    // This sentence held `4, 8 or 12` until 33.1-04, which is the shape of defect that leaves the
    // whole visible symptom standing behind a green backend.
    expect(refusalText({ reason: "illegal_duration" }, base)).toContain(GENERATED_LENGTH_RANGE);
    expect(refusalText({ reason: "illegal_duration" }, base)).not.toMatch(/4, 8 or 12/);
    expect(GENERATED_LENGTH_RANGE).toBe("1 to 15");
    expect(refusalText({ reason: "illegal_duration" }, { ...base, noun: "block" })).toBe(
      "Every block must be 5 or 10 seconds.",
    );
  });

  test("the SECONDS ceiling gets its OWN sentence, naming its OWN lever", () => {
    // `refusalText` has a default fall-through — the test below proves an unknown reason returns a
    // generic string — so the compiler could NOT have caught a missing arm here. A governed code
    // with no sentence reads to the user as "This reel can't be generated yet", which names no
    // lever at all. The lever for this one is NOT "cut a scene": it is "swap a generated scene for
    // a still or stock", which cost the same at any length.
    const text = refusalText({ reason: "over_generated_seconds" }, base);
    expect(text).not.toBe("This reel can't be generated yet.");
    expect(text).toMatch(/generated video/);
    expect(text).toMatch(/animated still|stock/);
    // The NUMBER is derived from the cap, not typed out — the same rule as the cost ratio.
    expect(text).toContain(`${MEDIA_GENERATED_SECONDS_CAP} seconds`);
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

  test("the clip line keeps the cost lever discoverable — the whole point of itemising", () => {
    const view = estimateView(est, o);
    expect(view.lines[0]?.note).toBe(CLIP_COST_LEVER_NOTE);
    expect(view.lines[0]?.note).toContain(`${EXPECTED_RATIO}×`);
    expect(view.lines[1]?.note).toBeNull();
  });

  test("EVERY SENTENCE ABOUT THE LEVER DERIVES THE RATIO — no restated number anywhere", () => {
    // The ratio is computed from the price tables at both ends (see EXPECTED_RATIO above), so this
    // cannot rot the way "a tenth" and "a fortieth" both did. The sanity bounds are what stop the
    // derivation from being vacuous: a broken table would give 0, 1 or Infinity and be caught here.
    expect(Number.isFinite(EXPECTED_RATIO)).toBe(true);
    expect(EXPECTED_RATIO).toBeGreaterThan(1);
    expect(CLIP_VS_STILL_RATIO).toBe(EXPECTED_RATIO);
    expect(KIND_COST_NOTE.animated_image).toContain(`1/${EXPECTED_RATIO}`);
    // …and not one of the stale words or numbers, at any of the three sites.
    for (const s of [
      KIND_COST_NOTE.animated_image,
      CLIP_COST_LEVER_NOTE,
      String(estimateView(est, o).lines[0]?.note),
    ]) {
      expect(s).not.toMatch(/fortieth|tenth|40×/);
    }
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

  // 33.1-06: the codes that actually happened in the audit log — 11 of 58 jobs failed on money —
  // every one of which read "no plainer word". And the two render refusals the first live reel
  // hit, which had collapsed into `render_failed`.
  test("names the money failures and the two real render refusals in plain words", () => {
    expect(failureClause("http_402", "scene")).toMatch(/out of credit/);
    expect(failureClause("credit_balance_exhausted", "scene")).toMatch(/out of credit/);
    expect(failureClause("card_font_missing", "scene")).toMatch(/font/);
    expect(failureClause("narration_overruns_reel", "scene")).toMatch(
      /still going when the reel ends/,
    );
    expect(failureClause("tts_not_verbatim", "scene")).toMatch(
      /differently from how it was written/,
    );
    // A provider status with no dedicated entry still says the number rather than nothing.
    expect(failureClause("http_429", "scene")).toMatch(/HTTP 429/);
    expect(failureClause("http_5xx", "scene")).toBe(GENERIC_FAILURE_CLAUSE); // not a real status
    // The assembler no longer refuses a colliding take, so the old sentence is gone, not stale.
    expect(failureText("speech_out_of_window", "scene")).toBe("speech_out_of_window");
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
/** Throws rather than returning `undefined`, so a missing row fails LOUDLY instead of turning a
 *  `.not.toBe(...)` assertion below into one that passes on nothing. */
const sceneOf = (view: ReturnType<typeof trackerView>, i: number) => {
  const found = view.scenes[i];
  if (!found) throw new Error(`no scene row ${i}`);
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

  test("the picture face agrees with the RENDER TRIGGER on every visual kind", () => {
    // THE CHECK THAT WAS MISSING, and the reason a reel sat held with no visible lever. The
    // tracker asked a MONEY question (`generated_video`/`animated_image`, a local `||` chain over
    // the PAID kinds) to answer a PIPELINE one. Stock is free AND lands a `mediaJobs` row, so a
    // failed stock fetch drew as "nothing to buy", dropped out of `pictureStates` entirely, and
    // left Pictures reading `Done — All 2 ready` while `evaluateRenderTrigger` — reading
    // `@pikar/core`'s sets — held the reel at `incomplete_batch` over that same scene.
    //
    // Derived from `deckStillNeedsJob` rather than from a second list here, so the next
    // `VisualKind` cannot re-open this gap. MUTATION that turns it red: put the two stock kinds
    // back outside `landsPictureRow`.
    const disagreements = VISUAL_KINDS.filter((visual) => {
      const shot = { visual, narration: "Say this." };
      const wantsRow = deckStillNeedsJob(shot, "video") || deckStillNeedsJob(shot, "image");
      const view = trackerView(
        [scene({ visual, clip: { status: "failed" } })],
        "pending",
        undefined,
        undefined,
      );
      return (sceneOf(view, 0).picture.state === "skipped") === wantsRow;
    });
    expect(disagreements).toEqual([]);
  });

  test("a FAILED stock picture is SHOWN, not drawn as 'nothing to buy'", () => {
    // The reported state, reduced: a five-scene reel held at `incomplete_batch` whose hero said
    // "Fix Scene 1" while Scene 1's own row said there was nothing to buy and the Pictures stage
    // said Done. A held reel whose named scene looks healthy leaves the user no lever at all.
    const view = trackerView(
      [
        scene({ visual: "stock_image", clip: { status: "failed" } }),
        scene({ blockIndex: 1, clip: { status: "succeeded" } }),
      ],
      "failed",
      undefined,
      undefined,
    );
    expect(sceneOf(view, 0).picture.text).not.toBe("nothing to buy");
    expect(sceneOf(view, 0).picture.state).toBe("failed");
    // The stage may not read `done` over a hole — the count now has a denominator of 2, not 1.
    expect(stageOf(view, "generate").state).toBe("failed");
    expect(stageOf(view, "generate").detail).toMatch(/1 of 2 failed/);
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
    expect(arms).toEqual([
      "regenerate",
      "text_card",
      "animated_image",
      "stock_video",
      "uploaded_video",
    ]);
    for (const arm of ["text_card", "animated_image", "stock_video", "uploaded_video"] as const) {
      expect(card?.fixes.find((f) => f.arm === arm)?.priceLabel).toMatch(/free/i);
    }
    // A still is bought by the REGENERATE that follows, not by the switch — and the ratio is
    // DERIVED from the price tables rather than written out in words that go stale.
    expect(card?.fixes.find((f) => f.arm === "animated_image")?.note).toContain(
      `1/${EXPECTED_RATIO}`,
    );
    // An animated-still scene is not offered "switch to an animated still".
    const still = sceneCard({
      visual: "animated_image",
      clip: face({ status: "failed", failureReason: "http_502" }),
    });
    expect(still?.fixes.map((f) => f.arm)).toEqual([
      "regenerate",
      "text_card",
      "stock_video",
      "uploaded_video",
    ]);
    // ...and the same exclusion holds for a FAILED STOCK scene: swapping it for stock is not a fix.
    const stock = sceneCard({
      visual: "stock_video",
      clip: face({ status: "failed", failureReason: "stock_no_match" }),
    });
    // Asserted as a POSITIVE list, not just an absence: `not.toContain` on an empty fix menu
    // passes for the wrong reason, and an empty menu is itself the defect (a failed scene with no
    // lever). The stock scene must still be offered the other three arms.
    expect(stock?.fixes.map((f) => f.arm)).toEqual([
      "regenerate",
      "text_card",
      "animated_image",
      "uploaded_video",
    ]);
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

  test("a failed row the DECK NO LONGER WANTS is history, not a card", () => {
    // The fix menu's own repair flow: a clip failed, the user swapped the scene to a text card.
    // `setSceneVisual` leaves the failed row in place deliberately — the fix changes the DECK,
    // never the batch — and `evaluateRenderTrigger`/`batchToRender` both ignore it via
    // `deckStillNeedsJob`. This file did not, so it went on naming the scene and reporting the
    // provider's stale reason over a picture the deck had stopped wanting.
    // MUTATION that turns this red: filter `failedScenes` on bare `FAILED(s.clip)` again.
    const swapped = fscene({
      visual: "text_card",
      overlay: "ONE WEEK A MONTH",
      clip: face({ status: "failed" }),
    });
    expect(failureCards({}, [swapped], anEstimate()).filter((c) => c.where === "scene")).toEqual(
      [],
    );

    // ...and a hold no longer points the user at it.
    const held = failureCards(
      { renderStatus: "failed", renderReason: "incomplete_batch" },
      [swapped],
      anEstimate(),
    );
    expect(held.find((c) => c.key === "hero-held")?.sceneRef).toBeNull();
  });

  test("a still-wanted failed row IS a card — the filter must not swallow real failures", () => {
    // The other half of the same predicate, so the fix above cannot be "return nothing".
    const stock = fscene({
      visual: "stock_image",
      prompt: "city street at dawn",
      clip: face({ status: "failed" }),
    });
    const card = failureCards({}, [stock], anEstimate()).find((c) => c.where === "scene");
    expect(card).toBeDefined();
    expect(card?.sceneRef).toBe("Scene 1");
  });

  test("a scene that NAMES NO SOURCE gets a card and a true sentence", () => {
    // The second way a reel holds at `incomplete_batch`: `evaluateRenderTrigger` also demands every
    // scene name its asset source, and `setSceneVisual` deliberately permits a switch to
    // `uploaded_video` with no asset yet ("the re-arm keeps the reel held, in words, until
    // setSceneAsset names the footage"). Those words did not exist — no card, no scene named, and a
    // headline claiming a picture or voice had failed when every job succeeded.
    // MUTATION that turns this red: drop `sourcelessScenes` from the hero fallback and the loop.
    const cards = failureCards(
      { renderStatus: "failed", renderReason: "incomplete_batch" },
      [fscene({ visual: "uploaded_video", asset: null }), fscene({ blockIndex: 1 })],
      anEstimate(),
    );

    const hero = cards.find((c) => c.key === "hero-held");
    expect(hero?.sceneRef).toBe("Scene 1");
    expect(hero?.headline).toMatch(/names no footage/);
    // The reason code's own words are FALSE for this cause and must not be used.
    expect(hero?.headline).not.toMatch(/never produced its picture or its voice/);

    const scene = cards.find((c) => c.where === "scene");
    expect(scene?.headline).toMatch(/Scene 1 names no footage/);
    // A real lever, not just a diagnosis: a kind that names its own source ends the hold.
    expect(scene?.fixes.length).toBeGreaterThan(0);
    expect(scene?.fixes.map((f) => f.arm)).not.toContain("uploaded_video");
  });

  test("one scene never gets two cards — a failure and a missing source are one card", () => {
    // The compound state the repair flow actually produces: the clip failed AND the user swapped to
    // their own footage without picking it yet. Two pushes here would read as two problems.
    const cards = failureCards(
      { renderStatus: "failed", renderReason: "incomplete_batch" },
      [fscene({ visual: "uploaded_video", asset: null, clip: face({ status: "failed" }) })],
      anEstimate(),
    );
    expect(cards.filter((c) => c.where === "scene")).toHaveLength(1);
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 33-13 — THE PROPOSAL STAGE'S OWN FAILURE CARD
//
// The live defect, twice, in the owner's words: "the user just stays there and stares at the
// screen where nothing happens." A deck that could not be parsed landed as a memo card offering
// Approve and Save — two acts that mean nothing over a reel that does not exist — with the only
// recovery instruction buried in prose. The RENDER stage has had a failure card with a named
// cause and a retry since 33-04/33-08; this gives the PROPOSAL stage the same vocabulary.
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("proposalFailureCard — a refusal is actionable, not a memo", () => {
  test("names the cause in WORDS and carries a retry that costs nothing", () => {
    const card = proposalFailureCard({
      reason: "illegal_generated_duration",
      contract: "scene",
    });
    expect(card?.where).toBe("hero");
    // The owner's own code, as a sentence — and the code itself is NOT in the prose.
    expect(card?.headline).toContain(
      "a generated scene asked for a length the video model cannot produce",
    );
    expect(card?.headline).not.toContain("illegal_generated_duration");
    // ...but it IS present, once, subordinate — the support string the card must not swallow.
    expect(card?.detailCode).toContain("illegal_generated_duration");
    // ONE arm, and it re-asks the specialist. Approve and Save are gone by construction: this is
    // a FailureCard, and a FailureCard has no approve.
    expect(card?.fixes.map((f) => f.arm)).toEqual(["retry_proposal"]);
    expect(card?.fixes[0]?.label).toBe(RETRY_PROPOSAL_LABEL);
    expect(card?.fixes[0]?.priceLabel).toMatch(/free/i);
    // Nothing was generated, so the money line must not read as spend.
    expect(card?.sunkLine).toMatch(/nothing|no video/i);
    expect(card?.sunkLine).not.toMatch(/\$/);
  });

  test("the CONTRACT chooses the sentence — a block refusal never says 'scene deck'", () => {
    const block = proposalFailureCard({ reason: "no_deck", contract: "block" });
    const scene = proposalFailureCard({ reason: "no_deck", contract: "scene" });
    expect(block?.headline).toContain("block deck");
    expect(scene?.headline).toContain("scene deck");
    expect(block?.headline).not.toContain("scene deck");
  });

  test("a variation refusal says WHICH variation broke, in the same sentence", () => {
    const card = proposalFailureCard({ reason: "no_deck", contract: "scene", variation: "b" });
    expect(card?.headline).toMatch(/variation B/);
    expect(card?.detailCode).toContain("variation b");
  });

  test("an unknown code becomes a generic clause rather than prose the user can't read", () => {
    const card = proposalFailureCard({ reason: "http_502", contract: "scene" });
    expect(card?.headline).toContain(GENERIC_DECK_REFUSAL);
    expect(card?.headline).not.toContain("http_502");
    expect(card?.detailCode).toContain("http_502");
    // The retry is offered whatever the code: a refusal we have no word for is still a refusal
    // the user must be able to leave.
    expect(card?.fixes.map((f) => f.arm)).toEqual(["retry_proposal"]);
  });

  test("no refusal, no card — an ordinary memo is still an ordinary memo", () => {
    expect(proposalFailureCard(null)).toBeNull();
    expect(proposalFailureCard(undefined)).toBeNull();
  });

  test("the retry message reads like something a person would type, and asks for a storyboard", () => {
    expect(RETRY_PROPOSAL_MESSAGE.length).toBeGreaterThan(20);
    expect(RETRY_PROPOSAL_MESSAGE).toMatch(/storyboard|reel/i);
  });
});

describe("the canvas mounts the proposal failure card at BOTH of its mount points", () => {
  // The canvas has two mount points — `cards.tsx`'s plan-kind switch and `page.tsx`'s
  // CanvasPane — and 33-07's summary names threading a thing through one of them as the way the
  // other gets forgotten. A refusal row is `kind: "memo"`, so BOTH doors have to branch on the
  // refusal BEFORE they branch on the kind, or the canvas tab shows "no reel in this thread yet"
  // over a run that failed.
  const cards = readFileSync(join(__dirname, "cards.tsx"), "utf8");
  const canvasPane = source.slice(source.indexOf("export function CanvasPane"));

  test("cards.tsx branches on the refusal ahead of the memo card", () => {
    expect(cards.indexOf("plan.proposalRefusal")).toBeGreaterThan(0);
    expect(cards.indexOf("plan.proposalRefusal")).toBeLessThan(
      cards.indexOf('plan.kind === "memo"'),
    );
    expect(cards).toContain("ProposalFailureCanvas");
  });

  test("the canvas TAB shows the failure instead of an empty-thread message", () => {
    expect(canvasPane).toContain("proposalRefusal");
    expect(canvasPane.indexOf("proposalRefusal")).toBeLessThan(
      canvasPane.indexOf('plan?.kind !== "media"'),
    );
  });

  test("the retry goes through the ONE cockpit send path, not a second dispatch door", () => {
    const canvas = source.slice(
      source.indexOf("export function ProposalFailureCanvas"),
      source.indexOf("function ReelCanvas("),
    );
    expect(canvas.length).toBeGreaterThan(400);
    expect(canvas).toContain("useSendCockpitMessage()");
    expect(canvas).toContain("RETRY_PROPOSAL_MESSAGE");
    expect(canvas).toContain("FailureCardBlock");
    // No thread, no send: sending without one MINTS A NEW THREAD (33-07's rule, verbatim).
    expect(canvas).toContain("!threadId");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 33-13 TASK 2 — THE SALVAGE IS DISCLOSED
//
// 33-11 stopped one refusing variation from killing its good sibling: the survivor is proposed
// ALONE, and `plans.lostVariation` records which sibling was lost and why. That row exists so the
// canvas can SAY so. A user who was promised a choice of two and silently handed one has been
// told something untrue by omission — and they would never know to ask for the other.
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("salvageNote — one of two, said out loud", () => {
  test("names BOTH letters: the one you are looking at and the one that was lost", () => {
    const note = salvageNote({ variation: "b", reason: "illegal_generated_duration" });
    expect(note).toContain("variation A");
    expect(note).toContain("variation B");
    // The one BELOW is the survivor; the one named as broken is the lost sibling. Order matters:
    // a sentence that swaps them tells the user the storyboard they can see is the broken one.
    expect(note?.indexOf("variation A")).toBeLessThan(note?.indexOf("variation B") as number);
    expect(note).toContain("a generated scene asked for a length the video model cannot produce");
  });

  test("the surviving letter is the OTHER one — a lost A means B is what's on screen", () => {
    const note = salvageNote({ variation: "a", reason: "no_deck" });
    expect(note?.indexOf("variation B")).toBeLessThan(note?.indexOf("variation A") as number);
    expect(note).toContain("it never wrote a scene deck");
  });

  test("it says only ONE could be built, in words, without a code", () => {
    const note = salvageNote({ variation: "b", reason: "duration_mismatch" });
    expect(note).toMatch(/only one/i);
    expect(note).not.toContain("duration_mismatch");
  });

  test("an unknown reason still discloses the salvage — the disclosure is not conditional on words", () => {
    const note = salvageNote({ variation: "b", reason: "sideways" });
    expect(note).toContain(GENERIC_DECK_REFUSAL);
    expect(note).toMatch(/only one/i);
  });

  test("no salvage, no sentence — an ordinary one- or two-deck proposal says nothing", () => {
    expect(salvageNote(null)).toBeNull();
    expect(salvageNote(undefined)).toBeNull();
  });

  test("the canvas renders it UNCONDITIONALLY, not inside a <details>", () => {
    const reel = source.slice(
      source.indexOf("function ReelCanvas("),
      source.indexOf("/** `media.editBrief`'s patch"),
    );
    expect(reel).toContain("salvageNote(");
    // Above the storyboard and outside every disclosure widget on this surface.
    expect(reel).toContain("ParserNotes");
    const notes = source.slice(source.indexOf("function ParserNotes("));
    const block = notes.slice(0, notes.indexOf("\nfunction "));
    expect(block).not.toContain("<details");
    expect(block).not.toContain("<summary");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 33-13 TASK 3 — THE REPAIR IS DISCLOSED
//
// 33-12 stopped an off-grid generated clip from throwing the whole reel away: the parser snaps it
// DOWN to a length the provider can make and gives the freed seconds to the last non-generated
// scene. That rewrites the user's reel. The committed rule is that such a change must never be
// silent — a parser quietly editing what the user asked for is the same defect class as an
// invented provenance. `plans.deckAdjustments` records every moved second; this reads it back.
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("adjustmentNotes — every second the parser moved", () => {
  const REPAIR = [
    { sceneIndex: 0, fromSeconds: 10, toSeconds: 8, why: "grid" },
    { sceneIndex: 1, fromSeconds: 20, toSeconds: 22, why: "rebalance" },
  ];

  test("says WHICH scene, from WHAT to WHAT, and why — in that direction", () => {
    const notes = adjustmentNotes(REPAIR, 30);
    expect(notes).toHaveLength(2);
    // Scene numbers are 1-based on screen; `sceneIndex` is the array index.
    expect(notes[0]).toContain("Scene 1");
    expect(notes[1]).toContain("Scene 2");
    // The DIRECTION is the assertion: a shortened scene went from the bigger number to the
    // smaller one, and a lengthened scene the other way. Both numbers appear either way.
    expect(notes[0]).toMatch(/shortened .*10s.*8s/);
    expect(notes[1]).toMatch(/lengthened .*20s.*22s/);
    expect(notes[0]).not.toMatch(/shortened .*8s.*10s/);
    expect(notes[1]).not.toMatch(/lengthened .*22s.*20s/);
  });

  test("the GRID reason names the generator's lengths as a RANGE, on the RENDERED string", () => {
    const note = adjustmentNotes([REPAIR[0] as (typeof REPAIR)[number]], 30)[0];
    // Asserted on what is RENDERED, not on the constant: `GENERATED_CLIP_SECONDS` went from three
    // members to fifteen on 2026-08-30, and the old `join(", ")` would have printed
    // "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 or 15 second clips" into the sentence.
    expect(note).toContain(GENERATED_LENGTH_RANGE);
    expect(note).not.toMatch(/\d+, \d+, \d+/);
    expect(note).not.toContain("4, 8 or 12");
    expect(note).not.toContain("grid");
  });

  test("the REBALANCE reason names the reel length the seconds went back into", () => {
    const note = adjustmentNotes([REPAIR[1] as (typeof REPAIR)[number]], 30)[0];
    expect(note).toContain("30");
    expect(note).not.toContain("rebalance");
  });

  // The narration repair moves seconds in PAIRS — one scene grows so its line can finish, another
  // pays for it — and the two halves must not read as the same event. A donor that claimed "so its
  // line has room" would be describing a scene that has no line.
  test("the NARRATION reason distinguishes the scene that grew from the one that paid", () => {
    const [grew, paid] = adjustmentNotes(
      [
        { sceneIndex: 0, fromSeconds: 8, toSeconds: 15, why: "narration" },
        { sceneIndex: 2, fromSeconds: 10, toSeconds: 3, why: "narration" },
      ],
      30,
    );
    expect(grew).toMatch(/lengthened .*8s.*15s/);
    expect(grew).toContain("line");
    expect(paid).toMatch(/shortened .*10s.*3s/);
    expect(paid).toContain("above");
    // The support code never reaches the page — 33-08's rule, same as grid and rebalance.
    expect(grew).not.toContain("narration");
    expect(paid).not.toContain("narration");
  });

  test("with no declared reel length it still discloses, without inventing one", () => {
    const note = adjustmentNotes([REPAIR[1] as (typeof REPAIR)[number]], null)[0];
    expect(note).toContain("20s");
    expect(note).toContain("22s");
    expect(note).not.toContain("30");
  });

  test("an unknown why still reports the seconds — disclosure is never conditional on vocabulary", () => {
    const note = adjustmentNotes(
      [{ sceneIndex: 2, fromSeconds: 6, toSeconds: 4, why: "sideways" }],
      15,
    )[0];
    expect(note).toContain("Scene 3");
    expect(note).toContain("6s");
    expect(note).toContain("4s");
  });

  test("a deck the model got right says nothing at all", () => {
    expect(adjustmentNotes([], 30)).toEqual([]);
    expect(adjustmentNotes(null, 30)).toEqual([]);
    expect(adjustmentNotes(undefined, null)).toEqual([]);
  });

  test("the canvas renders every note, unexpanded, beside the salvage note", () => {
    const reel = source.slice(
      source.indexOf("function ReelCanvas("),
      source.indexOf("function ParserNotes("),
    );
    expect(reel).toContain("adjustmentNotes(");
    expect(reel).toContain("plan.deckAdjustments");
    const notes = source.slice(source.indexOf("function ParserNotes("));
    const block = notes.slice(0, notes.indexOf("\nfunction "));
    expect(block).toContain("DECK_ADJUSTED_LEDE");
    expect(block).not.toContain("<details");
    expect(block).not.toContain("<summary");
    // The lede says a length changed — it is the sentence that makes the list mean something.
    expect(DECK_ADJUSTED_LEDE).toMatch(/length|second/i);
  });
});
