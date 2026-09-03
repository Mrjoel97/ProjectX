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
  concatWavTakes,
  DEFAULT_LINE_CHARS,
  groupIntoLines,
  pcm16ToWav,
  rebaseWords,
  type SttWord,
  toAss,
} from "./captions";

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
