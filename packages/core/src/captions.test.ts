// @vitest-environment node
//
// The caption stage's pure half (plan 20-17 Task 1), asserted at $0 with no STT provider in sight.
//
// The one identity everything else rests on is the FIRST test: a word spoken at the take's very
// first speech instant must land exactly at that block's `speechAbsS`. Every other timing
// assertion is a consequence of it. If the rebase is ever "simplified" to `windowStartS + t`, that
// test is what goes red — and the symptom in production would be captions that drift further out
// of sync with every block, which nothing downstream would catch.
//
// The second thing this file is for is the escape function, which looks cosmetic and is not.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AssemblyScene } from "./assembly";
import {
  buildCaptionLines,
  buildCaptionLinesChecked,
  buildTimelineCaptionLinesChecked,
  concatWavTakes,
  DEFAULT_LINE_CHARS,
  groupIntoLines,
  isNativeCaptionWav,
  pcm16ToWav,
  rebaseWords,
  type SttWord,
  toAss,
} from "./captions";

describe("native soundtrack captions use the actual final timeline", () => {
  const words: SttWord[] = [
    { text: "Keep", start: 1.2, end: 1.7, type: "word" },
    { text: "it", start: 2, end: 2.2, type: "word" },
    { text: "close", start: 4, end: 4.8, type: "word" },
  ];
  it("matches the reviewed script and preserves native word endpoints without TTS centering", () => {
    const result = buildTimelineCaptionLinesChecked({
      words,
      durationS: 6,
      expectedText: "Keep it close.",
    });
    expect(result).toEqual({
      ok: true,
      value: [{ text: "Keep it close", startS: 1.2, endS: 4.8 }],
    });
  });
  it("refuses an ad-lib or music lyric instead of manufacturing reviewed words", () => {
    expect(
      buildTimelineCaptionLinesChecked({ words, durationS: 6, expectedText: "Keep it safe." }),
    ).toEqual({ ok: false, error: { code: "caption_expected_text_mismatch" } });
  });
  it("refuses words beyond the actual soundtrack", () => {
    expect(
      buildTimelineCaptionLinesChecked({ words, durationS: 4, expectedText: "Keep it close." }),
    ).toEqual({ ok: false, error: { code: "caption_word_outside_take" } });
  });
  it("requires full-duration PCM16 mono24k and rejects MP4 or another sample rate", () => {
    const pcm = new Uint8Array(6 * 24000 * 2);
    expect(isNativeCaptionWav(pcm16ToWav(pcm, 24000), 6)).toBe(true);
    expect(isNativeCaptionWav(pcm16ToWav(pcm, 48000), 6)).toBe(false);
    expect(isNativeCaptionWav(new Uint8Array([0, 0, 0, 24]), 6)).toBe(false);
    expect(isNativeCaptionWav(pcm16ToWav(pcm.subarray(0, 48000), 24000), 6)).toBe(false);
  });
});

const block = (over: Partial<AssemblyScene> = {}): AssemblyScene => ({
  index: 0,
  startS: 10,
  durationS: 10,
  visual: "video",
  leadSilenceS: 0.4,
  speechAbsS: 11,
  speechDurS: 8,
  overrun: false,
  ...over,
});

const word = (text: string, start: number, end: number, type = "word"): SttWord => ({
  text,
  start,
  end,
  type,
});

describe("rebaseWords — the sidecar's anchor, not the file's start", () => {
  it("puts the take's first speech instant EXACTLY at speechAbsS", () => {
    const b = block();
    const [line] = rebaseWords([word("hello", b.leadSilenceS, b.leadSilenceS + 0.5)], b, 20);
    expect(line?.startS).toBeCloseTo(b.speechAbsS, 10);
  });

  it("applies speechAbsS + (t - leadSilenceS) to every word", () => {
    // windowStartS moves with the anchor: a block whose speech sits at 20.5s is the THIRD window,
    // not the second. An anchor outside its own window is a state `parseAssemblySidecar` refuses.
    const b = block({ startS: 20, leadSilenceS: 0.25, speechAbsS: 20.5 });
    const [line] = rebaseWords([word("later", 1.25, 1.75)], b, 30);
    // 20.5 + (1.25 - 0.25) = 21.5
    expect(line?.startS).toBeCloseTo(21.5, 10);
    expect(line?.endS).toBeCloseTo(22, 10);
  });

  it("is NOT windowStartS + t — the two disagree by exactly the anchor offset", () => {
    const b = block({ startS: 10, leadSilenceS: 0.4, speechAbsS: 11 });
    const [line] = rebaseWords([word("w", 0.4, 0.9)], b, 20);
    expect(line?.startS).not.toBeCloseTo(b.startS + 0.4, 3);
  });

  it("drops spacing and audio_event, keeps only words", () => {
    const b = block();
    const lines = rebaseWords(
      [
        word("kept", 0.4, 0.8),
        word(" ", 0.8, 0.9, "spacing"),
        word("(music)", 0.9, 1.2, "audio_event"),
        word("also", 1.2, 1.5),
      ],
      b,
      20,
    );
    expect(lines.map((l) => l.text)).toEqual(["kept", "also"]);
  });

  it("CLAMPS a word that would bleed before its window, and flags it", () => {
    // A take whose measured lead silence is longer than the word's own start: the rebase runs
    // negative relative to the anchor and would land in the PREVIOUS block's caption.
    const b = block({ startS: 10, leadSilenceS: 2, speechAbsS: 11 });
    const [line] = rebaseWords([word("early", 0, 0.3)], b, 20);
    expect(line?.startS).toBe(10);
    expect(line?.clamped).toBe(true);
  });

  it("CLAMPS a word that would bleed past its bound, and flags it", () => {
    const b = block({ startS: 10, leadSilenceS: 0, speechAbsS: 11 });
    const [line] = rebaseWords([word("late", 30, 31)], b, 20);
    expect(line?.endS).toBe(20); // the bound it was given — the next take's start, or the reel's end
    expect(line?.clamped).toBe(true);
  });

  it("never emits a line whose end precedes its start", () => {
    const b = block({ startS: 10, leadSilenceS: 5, speechAbsS: 11 });
    for (const l of rebaseWords([word("a", 0, 0.1), word("b", 40, 41)], b, 20)) {
      expect(l.endS).toBeGreaterThanOrEqual(l.startS);
    }
  });
});

describe("groupIntoLines — a line that fits a 9:16 frame", () => {
  it("never exceeds the character budget", () => {
    const words = Array.from({ length: 20 }, (_, i) => ({
      startS: i,
      endS: i + 1,
      text: "eleven_char",
    }));
    for (const line of groupIntoLines(words, 32)) {
      expect(line.text.length).toBeLessThanOrEqual(32);
    }
  });

  it("keeps the first word's start and the last word's end", () => {
    const [line] = groupIntoLines(
      [
        { startS: 1, endS: 1.5, text: "one" },
        { startS: 1.5, endS: 2.25, text: "two" },
      ],
      32,
    );
    expect(line).toEqual({ startS: 1, endS: 2.25, text: "one two" });
  });

  it("emits a word longer than the whole budget on its own line rather than dropping it", () => {
    const long = "x".repeat(DEFAULT_LINE_CHARS + 10);
    const lines = groupIntoLines([{ startS: 0, endS: 1, text: long }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe(long);
  });

  it("carries `clamped` forward — a grouped line containing a clamped word is still clamped", () => {
    const lines = groupIntoLines([
      { startS: 0, endS: 1, text: "a" },
      { startS: 1, endS: 2, text: "b", clamped: true },
    ]);
    expect(lines[0]?.clamped).toBe(true);
  });
});

describe("toAss — a valid file, and text that cannot become markup", () => {
  it("smooth cues keep speech endpoints and clamp motion/fades to short cue durations", () => {
    const ass = toAss([{ startS: 2, endS: 2.08, text: "Now" }], {
      treatment: "smooth",
      playResX: 720,
      playResY: 1280,
    });
    expect(ass).toContain("0:00:02.00,0:00:02.08");
    expect(ass).toContain("\\move(360,1024,360,1012,0,40)");
    expect(ass).toContain("\\fad(20,20)");
    expect(ass).toContain("Style: Default,DejaVu Sans,38,");
  });

  it("smooth markup is closed: narration cannot inject effects or benchmark branding", () => {
    const ass = toAss([{ startS: 1, endS: 3, text: "Fresh {\\pos(0,0)} ideas" }], {
      treatment: "smooth",
    });
    const row = ass.split("\n").find((line) => line.startsWith("Dialogue:")) ?? "";
    expect(row.match(/\{/g)).toHaveLength(1);
    expect(row).not.toContain("\\pos(0,0)");
    expect(row).toContain("Fresh pos(0,0) ideas");
    expect(ass).not.toMatch(/FORMA|D7B77A|7AB7D7/);
    expect(toAss([{ startS: 1, endS: 3, text: "Original" }])).not.toContain("\\move");
  });

  it.each([
    [1080, 1920],
    [720, 1280],
    [1920, 1080],
  ])("reserves the bottom 20%% and at least 8%% on each side at %sx%s", (width, height) => {
    const style = toAss([{ startS: 0, endS: 1, text: "Readable caption" }], {
      playResX: width,
      playResY: height,
    })
      .split("\n")
      .find((row) => row.startsWith("Style: Default,"))
      ?.split(",");
    expect(style).toBeDefined();
    expect(Number(style?.[2])).toBe(64); // Font size/family stay unchanged; geometry is explicit.
    expect(Number(style?.[19])).toBeGreaterThanOrEqual(width * 0.08);
    expect(Number(style?.[20])).toBeGreaterThanOrEqual(width * 0.08);
    expect(Number(style?.[21])).toBe(Math.ceil(height * 0.2));
    expect(Number(style?.[19])).toBeLessThan(width * 0.1);
  });
  const lines = [
    { startS: 0, endS: 1.5, text: "first line" },
    { startS: 1.5, endS: 3.25, text: "second line" },
  ];

  it("emits the three required sections in order", () => {
    const ass = toAss(lines);
    expect(ass.indexOf("[Script Info]")).toBe(0);
    expect(ass.indexOf("[V4+ Styles]")).toBeGreaterThan(0);
    expect(ass.indexOf("[Events]")).toBeGreaterThan(ass.indexOf("[V4+ Styles]"));
  });

  it("wraps INSIDE the margins — a full-length cue must never run off the frame", () => {
    // Measured on the first rendered reel: a 31-character cue at 64px touched both frame edges
    // under `WrapStyle: 2` (no wrapping). 0 is libass's smart wrap within MarginL/MarginR, which
    // makes overflow impossible for any cue `groupIntoLines` can produce.
    const header = toAss(lines).split("[V4+ Styles]")[0] ?? "";
    expect(header).toContain("WrapStyle: 0");
    expect(header).not.toContain("WrapStyle: 2");
  });

  it("writes H:MM:SS.cc times, ascending", () => {
    const ass = toAss([{ startS: 3661.5, endS: 3662, text: "hour" }]);
    expect(ass).toContain("Dialogue: 0,1:01:01.50,1:01:02.00,");
  });

  it("emits one Dialogue row per line, in order", () => {
    const rows = toAss(lines)
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("first line");
    expect(rows[1]).toContain("second line");
  });

  it("names the BAKED font, never one that would have to be fetched", () => {
    // `deny-all` egress makes a runtime font fetch impossible; plan 20-15's snapshot bakes
    // dejavu-sans-fonts. A style naming anything else renders in libass's fallback silently.
    expect(toAss(lines)).toContain("DejaVu Sans");
  });

  describe("the hostile fixture — narration is MODEL-AUTHORED and lands in a renderer's markup", () => {
    const hostile = "hello {\\pos(0,0)\\c&HFF0000&} world";

    it("no brace survives into the Dialogue text", () => {
      const row = toAss([{ startS: 0, endS: 1, text: hostile }])
        .split("\n")
        .find((l) => l.startsWith("Dialogue:")) as string;
      const text = row.split(",").slice(9).join(",");
      expect(text).not.toContain("{");
      expect(text).not.toContain("}");
      expect(text).not.toContain("\\");
    });

    it("a newline cannot split one caption into two Dialogue rows", () => {
      const rows = toAss([{ startS: 0, endS: 1, text: "line one\nline two\r\nline three" }])
        .split("\n")
        .filter((l) => l.startsWith("Dialogue:"));
      expect(rows).toHaveLength(1);
    });

    it("an empty or whitespace-only caption is dropped, not emitted as a blank row", () => {
      const rows = toAss([{ startS: 0, endS: 1, text: "   " }])
        .split("\n")
        .filter((l) => l.startsWith("Dialogue:"));
      expect(rows).toHaveLength(0);
    });
  });
});

describe("verified script caption alignment", () => {
  const report = {
    sceneCount: 2,
    targetDurationS: 10,
    totalDurationS: 10,
    actualDurationS: 10,
    gates: [],
    scenes: [
      block({ index: 0, startS: 0, durationS: 5, leadSilenceS: 0, speechAbsS: 1, speechDurS: 2.5 }),
      block({ index: 1, startS: 5, durationS: 5, leadSilenceS: 0, speechAbsS: 6, speechDurS: 2.5 }),
    ],
  };
  const input = () => ({
    report,
    offsetsS: [0, 3],
    expectedTakeTexts: ["Come back.", "Keep it close."],
    words: [
      word("Come", 0.1, 0.5),
      word("back", 0.5, 1),
      word("Keep", 2.74, 3.24),
      word("it", 3.24, 3.5),
      word("close", 3.5, 4),
    ],
  });

  it("assigns a boundary word by exact submitted text, preserving every provider timestamp and token", () => {
    const a = input(),
      before = structuredClone(a.words);
    const result = buildCaptionLinesChecked(a);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((line) => line.text)).toEqual(["Come back", "Keep it close"]);
    expect(result.value[1]?.startS).toBeCloseTo(5.74, 8);
    expect(a.words).toEqual(before);
    expect(
      buildCaptionLines({ ...a, expectedTakeTexts: undefined }).map((line) => line.text),
    ).toEqual(["Come back Keep", "it close"]);
  });

  it("keeps zero-duration words inside positive-duration readable grouped cues", () => {
    const a = input();
    a.words[3] = word("it", 3.24, 3.24);
    const result = buildCaptionLinesChecked(a);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[1]?.text).toBe("Keep it close");
    expect(result.value.every((line) => line.endS > line.startS)).toBe(true);
  });

  it("does not silently fall back when text differs or a provider token ambiguously spans words", () => {
    for (const changed of [word("Far", 2.74, 3.24), word("Keep it", 2.74, 3.24)]) {
      const a = input();
      a.words[2] = changed;
      expect(buildCaptionLinesChecked(a)).toEqual({
        ok: false,
        error: { code: "caption_expected_text_mismatch" },
      });
      expect(buildCaptionLines(a)).toEqual([]);
    }
  });

  it.each([
    [Number.NaN, 3.24],
    [2.74, Number.POSITIVE_INFINITY],
    [2.74, 2.5],
    [-1, 0],
  ])("refuses invalid provider times %s→%s", (start, end) => {
    const a = input();
    a.words[2] = word("Keep", start, end);
    expect(buildCaptionLinesChecked(a)).toEqual({
      ok: false,
      error: { code: "caption_invalid_word_time" },
    });
  });

  it("refuses exact text whose timing falls outside the bounded half-second take window", () => {
    const a = input();
    a.words[2] = word("Keep", 2.4, 3.24);
    expect(buildCaptionLinesChecked(a)).toEqual({
      ok: false,
      error: { code: "caption_word_outside_take" },
    });
  });

  it("refuses missing, duplicated or unordered take offsets instead of guessing ownership", () => {
    for (const offsetsS of [[0], [0, 0], [3, 0]])
      expect(buildCaptionLinesChecked({ ...input(), offsetsS })).toEqual({
        ok: false,
        error: { code: "caption_take_count_mismatch" },
      });
  });

  it("repeated words retain ordinal ownership without fuzzy searching or editing actual text", () => {
    const result = buildCaptionLinesChecked({
      ...input(),
      expectedTakeTexts: ["Refill now", "Refill tomorrow"],
      words: [
        word("Refill", 0, 0.4),
        word("now", 0.4, 0.8),
        word("Refill", 2.9, 3.2),
        word("tomorrow", 3.2, 3.7),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.map((line) => line.text)).toEqual(["Refill now", "Refill tomorrow"]);
  });

  it("refuses an isolated zero-duration cue rather than inventing display time", () => {
    const a = input();
    const result = buildCaptionLinesChecked({
      ...a,
      report: { ...report, sceneCount: 1, scenes: [report.scenes[0] as AssemblyScene] },
      offsetsS: [0],
      expectedTakeTexts: ["Wait"],
      words: [word("Wait", 0.2, 0.2)],
    });
    expect(result).toEqual({ ok: false, error: { code: "caption_nonpositive_cue" } });
  });

  it("refuses decreasing word ends rather than truncating an earlier overlapping word", () => {
    const a = input();
    a.words[0] = word("Come", 0.1, 2);
    a.words[1] = word("back", 0.2, 0.3);
    expect(buildCaptionLinesChecked(a)).toEqual({
      ok: false,
      error: { code: "caption_invalid_word_time" },
    });
  });
  it("refuses positive floating-point cue duration that collapses at actual ASS precision", () => {
    const a = input();
    const result = buildCaptionLinesChecked({
      ...a,
      report: { ...report, sceneCount: 1, scenes: [report.scenes[0] as AssemblyScene] },
      offsetsS: [0],
      expectedTakeTexts: ["Wait"],
      words: [word("Wait", 0.2, 0.201)],
    });
    expect(result).toEqual({ ok: false, error: { code: "caption_nonpositive_cue" } });
    expect(toAss([{ startS: 1.2, endS: 1.201, text: "Wait" }])).toContain("0:00:01.20,0:00:01.20");
  });

  it("maps only narrated scenes across silent holes", () => {
    const a = input();
    const result = buildCaptionLinesChecked({
      ...a,
      report: {
        ...report,
        sceneCount: 3,
        totalDurationS: 15,
        targetDurationS: 15,
        actualDurationS: 15,
        scenes: [
          report.scenes[0] as AssemblyScene,
          block({ index: 1, startS: 5, durationS: 5, speechDurS: 0 }),
          { ...(report.scenes[1] as AssemblyScene), index: 2, startS: 10, speechAbsS: 11 },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[1]?.startS).toBeCloseTo(10.74, 8);
  });
});

describe("verified take readability — regroup words, never manufacture display time", () => {
  // Actual problematic takes from the paid benchmark, with their provider-relative timestamps.
  // The zero-length 'comfortable' and 'rhythm' tokens must survive the new partition unchanged.
  const takes = [
    {
      text: "Move what you need within a comfortable reach",
      words: [
        word("Move", 0.23999938964843892, 0.35999832153320455),
        word("what", 0.35999832153320455, 0.5599990844726577),
        word("you", 0.5599990844726577, 0.7599998474121108),
        word("need", 0.7599998474121108, 0.940000152587892),
        word("within", 0.940000152587892, 1.160001373291017),
        word("a", 1.160001373291017, 1.739999389648439),
        word("comfortable", 1.739999389648439, 1.739999389648439),
        word("reach", 1.739999389648439, 2.140000915527345),
      ],
      greedyTail: "comfortable reach",
      greedyTailSeconds: 0.4,
      balanced: ["Move what you need within", "a comfortable reach"],
      tailSeconds: 0.98,
      maxSpeed: 27.18,
    },
    {
      text: "Find a rhythm that fits your own routine",
      words: [
        word("Find", 0.18999938964843466, 0.32999877929687216),
        word("a", 0.32999877929687216, 0.8099983215332003),
        word("rhythm", 0.8099983215332003, 0.8099983215332003),
        word("that", 0.8099983215332003, 1.4699981689453097),
        word("fits", 1.4699981689453097, 1.4699981689453097),
        word("your", 1.4699981689453097, 1.6899993896484347),
        word("own", 1.6899993896484347, 2.110001373291013),
        word("routine", 2.110001373291013, 2.369999694824216),
      ],
      greedyTail: "routine",
      greedyTailSeconds: 0.26,
      balanced: ["Find a rhythm that fits", "your own routine"],
      tailSeconds: 0.9,
      maxSpeed: 18,
    },
  ];
  const input = (take: (typeof takes)[number]) => ({
    words: take.words,
    offsetsS: [0],
    expectedTakeTexts: [take.text],
    report: {
      sceneCount: 1,
      targetDurationS: 5,
      totalDurationS: 5,
      actualDurationS: 5,
      gates: [],
      scenes: [block({ startS: 0, durationS: 5, leadSilenceS: 0, speechAbsS: 1, speechDurS: 3 })],
    },
  });
  it.each(takes)("removes the fast '$greedyTail' fragment within its own take", (take) => {
    const a = input(take);
    const before = structuredClone(a);
    const greedy = buildCaptionLinesChecked(a);
    const balanced = buildCaptionLinesChecked({ ...a, balanceReadability: true });
    expect(greedy.ok && balanced.ok).toBe(true);
    if (!greedy.ok || !balanced.ok) return;
    const tail = greedy.value.at(-1);
    expect(tail?.text).toBe(take.greedyTail);
    expect((tail?.endS ?? 0) - (tail?.startS ?? 0)).toBeCloseTo(take.greedyTailSeconds, 4);
    expect(balanced.value.map((line) => line.text)).toEqual(take.balanced);
    const newTail = balanced.value.at(-1);
    expect((newTail?.endS ?? 0) - (newTail?.startS ?? 0)).toBeCloseTo(take.tailSeconds, 4);
    expect(balanced.value.map((line) => line.text).join(" ")).toBe(take.text);
    expect(balanced.value).toHaveLength(greedy.value.length);
    expect(balanced.value[0]?.startS).toBe(greedy.value[0]?.startS);
    expect(newTail?.endS).toBe(tail?.endS);
    for (const line of balanced.value) {
      expect(line.text.length).toBeLessThanOrEqual(DEFAULT_LINE_CHARS);
      expect(line.text.length / (line.endS - line.startS)).toBeLessThan(take.maxSpeed);
      expect(line.endS - line.startS).toBeGreaterThanOrEqual(0.75);
      expect(a.words.some((w) => w.start + 1 === line.startS)).toBe(true);
      expect(a.words.some((w) => w.end + 1 === line.endS)).toBe(true);
    }
    expect(a).toEqual(before);
  });

  it("does not introduce simultaneous cues by cutting through overlapping provider words", () => {
    const first = takes[0];
    if (!first) throw new Error("missing test take");
    const a = input(first);
    a.words = first.words.map((w) => (w.text === "within" ? { ...w, end: 1.3 } : { ...w }));
    const before = structuredClone(a);
    const greedy = buildCaptionLinesChecked(a);
    const balanced = buildCaptionLinesChecked({ ...a, balanceReadability: true });
    expect(greedy.ok && balanced.ok).toBe(true);
    if (!greedy.ok || !balanced.ok) return;
    expect(greedy.value[0]?.endS).toBe(greedy.value[1]?.startS);
    // The former optimum cut after 'within' would end at2.3s, while the next cue
    // starts with 'a' at2.1600013733s. Choose a clean word boundary instead of padding.
    expect(balanced.value.map((line) => line.text)).toEqual([
      "Move what you",
      "need within a comfortable reach",
    ]);
    expect(balanced.value[0]?.endS).toBeLessThanOrEqual(balanced.value[1]?.startS ?? 0);
    expect(balanced.value[0]?.startS).toBe(greedy.value[0]?.startS);
    expect(balanced.value.at(-1)?.endS).toBe(greedy.value.at(-1)?.endS);
    expect(balanced.value.map((line) => line.text).join(" ")).toBe(first.text);
    expect(a).toEqual(before);
  });

  it("retains the greedy fallback when the character ceiling leaves no clean cut", () => {
    const first = takes[0];
    if (!first) throw new Error("missing test take");
    const a = {
      ...input(first),
      words: [word("a".repeat(32), 0.1, 1.3), word("b".repeat(32), 1.2, 2)],
      expectedTakeTexts: [`${"a".repeat(32)} ${"b".repeat(32)}`],
    };
    const greedy = buildCaptionLinesChecked(a);
    expect(greedy.ok).toBe(true);
    expect(buildCaptionLinesChecked({ ...a, balanceReadability: true })).toEqual(greedy);
  });

  it("bounds the search:129-word takes retain the valid linear greedy result", () => {
    const first = takes[0];
    if (!first) throw new Error("missing test take");
    const a = input(first);
    const words = Array.from({ length: 129 }, (_, i) => word("a", i * 0.1, (i + 1) * 0.1));
    const long = {
      ...a,
      words,
      expectedTakeTexts: [words.map((w) => w.text).join(" ")],
      report: {
        ...a.report,
        totalDurationS: 20,
        scenes: [
          block({ startS: 0, durationS: 20, leadSilenceS: 0, speechAbsS: 0, speechDurS: 13 }),
        ],
      },
    };
    const original = buildCaptionLinesChecked(long);
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(original.value.at(-1)?.text).toBe("a");
    expect(buildCaptionLinesChecked({ ...long, balanceReadability: true })).toEqual(original);
  });

  it("keeps separate takes separate even when joining them would reduce the reading rate", () => {
    const first = takes[0];
    if (!first) throw new Error("missing test take");
    const a = input(first);
    const result = buildCaptionLinesChecked({
      ...a,
      balanceReadability: true,
      expectedTakeTexts: [first.text, "Wait"],
      offsetsS: [0, 3.5],
      words: [...first.words, word("Wait", 3.6, 3.6)],
      report: {
        ...a.report,
        sceneCount: 2,
        totalDurationS: 10,
        scenes: [
          ...a.report.scenes,
          block({ index: 1, startS: 5, speechAbsS: 6, leadSilenceS: 0, speechDurS: 2 }),
        ],
      },
    });
    expect(result).toEqual({ ok: false, error: { code: "caption_nonpositive_cue" } });
  });

  it("preserves legacy grouping without verified scripts and still refuses a script mismatch", () => {
    const first = takes[0];
    if (!first) throw new Error("missing test take");
    const a = input(first);
    expect(
      buildCaptionLines({ ...a, expectedTakeTexts: undefined, balanceReadability: true }),
    ).toEqual(buildCaptionLines({ ...a, expectedTakeTexts: undefined }));
    expect(
      buildCaptionLinesChecked({
        ...a,
        expectedTakeTexts: ["Different words"],
        balanceReadability: true,
      }),
    ).toEqual({
      ok: false,
      error: { code: "caption_expected_text_mismatch" },
    });
  });
});

describe("concatWavTakes — one transcript needs one audio file", () => {
  /** A minimal canonical 16-bit PCM WAV, so the test builds its input the way the landing plane
   *  describes the takes: 24 kHz, mono, 16-bit. */
  const wav = (samples: number, sampleRate = 24_000, channels = 1): Uint8Array => {
    const dataBytes = samples * 2 * channels;
    const buf = new Uint8Array(44 + dataBytes);
    const view = new DataView(buf.buffer);
    const ascii = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < dataBytes; i++) buf[44 + i] = i % 251;
    return buf;
  };

  it("returns ONE playable wav whose data length is the sum of the takes'", () => {
    const out = concatWavTakes([wav(1_000), wav(2_000)]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const view = new DataView(out.value.wav.buffer, out.value.wav.byteOffset);
    expect(out.value.wav.byteLength).toBe(44 + 3_000 * 2);
    // The header must DESCRIBE the concatenation, which is the whole reason this is not a byte
    // concat: two files glued together leave a header claiming the first file's length, and a
    // decoder stops there — a transcript of take 1 only, silently.
    expect(view.getUint32(4, true)).toBe(36 + 3_000 * 2);
    expect(view.getUint32(40, true)).toBe(3_000 * 2);
  });

  it("reports each take's start offset in seconds — the key the rebase is partitioned on", () => {
    const out = concatWavTakes([wav(24_000), wav(12_000), wav(24_000)]);
    if (!out.ok) throw new Error(out.error.code);
    expect(out.value.offsetsS).toEqual([0, 1, 1.5]);
  });

  it("REFUSES takes that disagree on format rather than producing garbled audio", () => {
    const mixed = concatWavTakes([wav(100, 24_000), wav(100, 48_000)]);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error.code).toBe("format_mismatch");
  });

  it("REFUSES a file that is not a wav", () => {
    const notWav = concatWavTakes([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]);
    expect(notWav.ok).toBe(false);
    if (!notWav.ok) expect(notWav.error.code).toBe("not_a_wav");
  });

  it("REFUSES an empty take list", () => {
    const empty = concatWavTakes([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("no_takes");
  });
});

describe("buildCaptionLines — the whole track, partitioned by take", () => {
  const report = {
    sceneCount: 2,
    targetDurationS: 20,
    totalDurationS: 20,
    actualDurationS: 20,
    gates: [],
    scenes: [
      block({ index: 0, startS: 0, leadSilenceS: 0.5, speechAbsS: 1 }),
      block({ index: 1, startS: 10, leadSilenceS: 0.5, speechAbsS: 11 }),
    ],
  };

  it("assigns each word to the take it was spoken in, then rebases against THAT block", () => {
    // Take 0 spans [0, 4) of the concatenated stream; take 1 starts at 4.
    const lines = buildCaptionLines({
      words: [word("first", 0.5, 1), word("second", 4.5, 5)],
      report,
      offsetsS: [0, 4],
      maxChars: 32,
    });
    expect(lines[0]?.startS).toBeCloseTo(1, 10); // block 0's anchor
    expect(lines[1]?.startS).toBeCloseTo(11, 10); // block 1's anchor, NOT 1 + 4
  });

  it("returns lines in ascending start order across blocks", () => {
    const lines = buildCaptionLines({
      words: [word("b", 4.5, 5), word("a", 0.5, 1)],
      report,
      offsetsS: [0, 4],
    });
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]?.startS).toBeGreaterThanOrEqual(lines[i - 1]?.startS ?? 0);
    }
  });

  it("ignores a transcript with more takes than the sidecar has blocks", () => {
    const lines = buildCaptionLines({ words: [word("x", 0.5, 1)], report, offsetsS: [0, 4, 8] });
    expect(lines.length).toBeGreaterThan(0);
  });
});

// ── 20.2 wave 4 fallout, fixed before wave 5 removes the guards hiding it ───────────────────────
//
// Two defects that are UNREACHABLE today only because of refusals wave 5 deletes:
//   * `media.ts:260` (`unrenderable_block`) and `media.ts:262` (min narration chars) mean no
//     reserved deck has a silent scene, so the take list never has a hole.
//   * `assembly.ts:129` (`speech_dur_s > clip_seconds`) means an overrunning take never reaches
//     the caption stage.
// Wave 4 made both states legal at the assembler. Wave 5 removes both refusals. So these must be
// correct BEFORE that wave, not during it — the narrowing rule the plan already applies to the
// money leak applies here for the same reason.
describe("captions on a SCENE timeline", () => {
  it("assigns takes by NARRATED ORDINAL, not by block index — a silent scene is a hole", () => {
    // Three scenes; the middle one is a deliberately silent card, so only TWO takes were ever
    // recorded and `offsetsS` has two entries. Indexing them by `blockIndex` reads take 1 as if it
    // belonged to the card and then runs off the end of the array for the scene that actually
    // owns it — the word lands ~10s early, against the wrong anchor, and the last scene loses its
    // captions entirely.
    const report = {
      sceneCount: 3,
      targetDurationS: 30,
      totalDurationS: 30,
      actualDurationS: 30,
      gates: [],
      scenes: [
        block({ index: 0, startS: 0, leadSilenceS: 0.5, speechAbsS: 1, speechDurS: 8 }),
        // The card: no take, and the sidecar says so with speech_dur_s = 0.
        block({ index: 1, startS: 10, leadSilenceS: 0, speechAbsS: 10, speechDurS: 0 }),
        block({
          index: 2,
          startS: 20,
          leadSilenceS: 0.5,
          speechAbsS: 21,
          speechDurS: 8,
        }),
      ],
    };
    const lines = buildCaptionLines({
      words: [word("first", 0.5, 1), word("third", 9.5, 10)],
      report,
      offsetsS: [0, 9], // take 0 is scene 1's; take 1 is scene 3's
      maxChars: 32,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.startS).toBeCloseTo(1, 10); // scene 1's anchor
    expect(lines[1]?.startS).toBeCloseTo(21, 10); // scene 3's anchor — NOT the card's 10.5
    expect(lines.map((l) => l.text)).toEqual(["first", "third"]);
  });

  it("a silent scene contributes no caption line of its own", () => {
    const report = {
      sceneCount: 2,
      targetDurationS: 20,
      totalDurationS: 20,
      actualDurationS: 20,
      gates: [],
      scenes: [
        block({ index: 0, startS: 0, leadSilenceS: 0, speechAbsS: 0, speechDurS: 0 }),
        block({
          index: 1,
          startS: 10,
          leadSilenceS: 0.5,
          speechAbsS: 11,
          speechDurS: 8,
        }),
      ],
    };
    const lines = buildCaptionLines({
      words: [word("only", 0.5, 1)],
      report,
      offsetsS: [0], // ONE take, and it belongs to the second scene
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.startS).toBeCloseTo(11, 10);
  });

  it("keeps a line that outruns its own scene, and stops it at the NEXT take", () => {
    // The live uniform path: three 10s blocks. Wave 4 deleted the per-cell band, so a take
    // carrying 10.4s of speech now renders — it ends at 20.4s, before take 3 starts at 20.6s, so
    // the assembler's timeline checks pass it. `windowStartS + clipSeconds` would clamp its tail
    // back to 20.0 and flag it, which is a caption cut off mid-word for being correct.
    const report = {
      sceneCount: 3,
      targetDurationS: 30,
      totalDurationS: 30,
      actualDurationS: 30,
      gates: [],
      scenes: [
        block({
          index: 0,
          startS: 0,
          leadSilenceS: 0.2,
          speechAbsS: 0.2,
          speechDurS: 9,
        }),
        block({
          index: 1,
          startS: 10,
          leadSilenceS: 0.2,
          speechAbsS: 10,
          speechDurS: 10.4,
        }),
        block({
          index: 2,
          startS: 20,
          leadSilenceS: 0.2,
          speechAbsS: 20.6,
          speechDurS: 9,
        }),
      ],
    };
    const lines = buildCaptionLines({
      words: [word("tail", 10.4, 10.6)], // take-relative, inside take 1
      report,
      offsetsS: [0, 0, 21], // take 1 spans [0, 21) of the concatenated stream
      maxChars: 32,
    });
    const tail = lines.find((l) => l.text === "tail");
    expect(tail?.endS).toBeCloseTo(20.4, 6); // past its own scene, which ended at 20
    expect(tail?.clamped).toBeUndefined();
  });

  it("still clamps a word that would land on the NEXT take's line", () => {
    // The hazard the clamp exists for, re-expressed: the bound is the next take's speech start,
    // not an arbitrary window width. STT drift that would put this word on top of the following
    // caption is still pulled back.
    const report = {
      sceneCount: 2,
      targetDurationS: 30,
      totalDurationS: 30,
      actualDurationS: 30,
      gates: [],
      scenes: [
        block({ index: 0, startS: 0, leadSilenceS: 0, speechAbsS: 0, speechDurS: 9 }),
        block({ index: 1, startS: 10, leadSilenceS: 0, speechAbsS: 12, speechDurS: 9 }),
      ],
    };
    const lines = buildCaptionLines({
      words: [word("drift", 25, 26)],
      report,
      offsetsS: [0, 30],
      maxChars: 32,
    });
    expect(lines[0]?.endS).toBe(12); // the next take's speechAbsS, not 0 + clipSeconds
    expect(lines[0]?.clamped).toBe(true);
  });
});

describe("the module is pure", () => {
  const source = readFileSync(fileURLToPath(new URL("./captions.ts", import.meta.url)), "utf8");

  it("imports nothing from Convex, node: or the network", () => {
    expect(source).not.toMatch(/from\s+["']convex/);
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});

// ── 33.1: THE PCM16 -> WAV BRIDGE ─────────────────────────────────────────────────────────────
//
// OpenRouter's chat-audio stream returns HEADERLESS pcm16. Every reader downstream expects WAV.
// These assertions deliberately go through `concatWavTakes` — the real consumer, which parses
// `fmt `/`data` and refuses anything it does not recognise — rather than re-reading the header
// this function just wrote. A test that only checked its own bytes back would pass just as well
// against a header no other reader in this repo accepts.
describe("pcm16ToWav — headerless samples become something the takes plane can read", () => {
  /** 24 kHz mono 16-bit, the pinned MEDIA_DEFAULT_VOICE shape. */
  const pcm = (samples: number): Uint8Array =>
    Uint8Array.from({ length: samples * 2 }, (_, i) => i % 251);

  it("produces a wav the REAL consumer accepts, with the duration the samples imply", () => {
    const out = concatWavTakes([pcm16ToWav(pcm(24_000), 24_000)]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // 24,000 mono 16-bit samples at 24 kHz is exactly one second. A header that lied about the
    // sample rate or the block align would still parse and would land here as the wrong number.
    expect(out.value.durationS).toBe(1);
  });

  it("keeps every sample byte, at offset 44 — a voice take is not allowed to lose its tail", () => {
    const samples = pcm(1_000);
    const wav = pcm16ToWav(samples, 24_000);
    expect(wav.byteLength).toBe(44 + samples.byteLength);
    expect(Array.from(wav.subarray(44))).toEqual(Array.from(samples));
  });

  it("honours the sample rate it is given rather than assuming the default", () => {
    // Not vacuous: a hardcoded 24000 inside the writer passes every assertion above. Here the
    // same samples must read as HALF the duration, which only a threaded rate produces.
    const out = concatWavTakes([pcm16ToWav(pcm(24_000), 48_000)]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.durationS).toBe(0.5);
  });
});
