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
import type { AssemblyBlock } from "./assembly";
import {
  buildCaptionLines,
  concatWavTakes,
  DEFAULT_LINE_CHARS,
  groupIntoLines,
  rebaseWords,
  type SttWord,
  toAss,
} from "./captions";

const block = (over: Partial<AssemblyBlock> = {}): AssemblyBlock => ({
  blockIndex: 0,
  windowStartS: 10,
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
    const [line] = rebaseWords([word("hello", b.leadSilenceS, b.leadSilenceS + 0.5)], b, 10);
    expect(line?.startS).toBeCloseTo(b.speechAbsS, 10);
  });

  it("applies speechAbsS + (t - leadSilenceS) to every word", () => {
    // windowStartS moves with the anchor: a block whose speech sits at 20.5s is the THIRD window,
    // not the second. An anchor outside its own window is a state `parseAssemblySidecar` refuses.
    const b = block({ windowStartS: 20, leadSilenceS: 0.25, speechAbsS: 20.5 });
    const [line] = rebaseWords([word("later", 1.25, 1.75)], b, 10);
    // 20.5 + (1.25 - 0.25) = 21.5
    expect(line?.startS).toBeCloseTo(21.5, 10);
    expect(line?.endS).toBeCloseTo(22, 10);
  });

  it("is NOT windowStartS + t — the two disagree by exactly the anchor offset", () => {
    const b = block({ windowStartS: 10, leadSilenceS: 0.4, speechAbsS: 11 });
    const [line] = rebaseWords([word("w", 0.4, 0.9)], b, 10);
    expect(line?.startS).not.toBeCloseTo(b.windowStartS + 0.4, 3);
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
      10,
    );
    expect(lines.map((l) => l.text)).toEqual(["kept", "also"]);
  });

  it("CLAMPS a word that would bleed before its window, and flags it", () => {
    // A take whose measured lead silence is longer than the word's own start: the rebase runs
    // negative relative to the anchor and would land in the PREVIOUS block's caption.
    const b = block({ windowStartS: 10, leadSilenceS: 2, speechAbsS: 11 });
    const [line] = rebaseWords([word("early", 0, 0.3)], b, 10);
    expect(line?.startS).toBe(10);
    expect(line?.clamped).toBe(true);
  });

  it("CLAMPS a word that would bleed past the window's end, and flags it", () => {
    const b = block({ windowStartS: 10, leadSilenceS: 0, speechAbsS: 11 });
    const [line] = rebaseWords([word("late", 30, 31)], b, 10);
    expect(line?.endS).toBe(20); // windowStartS + clipSeconds
    expect(line?.clamped).toBe(true);
  });

  it("never emits a line whose end precedes its start", () => {
    const b = block({ windowStartS: 10, leadSilenceS: 5, speechAbsS: 11 });
    for (const l of rebaseWords([word("a", 0, 0.1), word("b", 40, 41)], b, 10)) {
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
    blockCount: 2,
    clipSeconds: 10,
    totalDurationS: 20,
    actualDurationS: 20,
    gates: [],
    blocks: [
      block({ blockIndex: 0, windowStartS: 0, leadSilenceS: 0.5, speechAbsS: 1 }),
      block({ blockIndex: 1, windowStartS: 10, leadSilenceS: 0.5, speechAbsS: 11 }),
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

describe("the module is pure", () => {
  const source = readFileSync(fileURLToPath(new URL("./captions.ts", import.meta.url)), "utf8");

  it("imports nothing from Convex, node: or the network", () => {
    expect(source).not.toMatch(/from\s+["']convex/);
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
