/**
 * The caption stage's pure half (MEDIA-01, D8, plan 20-17). Pure TS, Convex-free (CLAUDE.md §1).
 *
 * Burned captions are what make a reel work on an autoplay-muted feed. Getting there added **no
 * Python, no Whisper weights and no font fetcher**: the transcription is a fal line like every
 * other media call, the timing math is this file, and the burn is one ffmpeg pass in the sandbox
 * that plan 20-15 already baked.
 *
 * THE ONE FORMULA, and everything else is bookkeeping around it:
 *
 *     absolute_t = speechAbsS + (word_t_in_clean_take - leadSilenceS)
 *
 * Captions are timed on the **CLEAN voice takes**, never the mixed bed — the upstream in-assembler
 * Whisper path was removed on 2026-07-29 for transcribing music and SFX under the speech and
 * swallowing words, and D8 forbids re-merging assembly and captions. So the word times this file
 * receives are relative to a take, and the sidecar's per-block anchors are the only thing that
 * knows where that take's SPEECH sits in the finished file. `windowStartS + t` is the wrong answer
 * that looks right for block 1 and drifts for every block after it.
 *
 * Consumes the VALIDATED `AssemblyReport`, never a raw sidecar: a caller that has not validated
 * cannot call this correctly, which is the type system doing governance work for free.
 *
 * ponytail: a ~120-line `.ass` writer instead of a subtitle library. `.ass` is a plain text format
 * and we emit ONE style and ONE event type; a dependency would be more lines of `package.json`
 * churn than of saved code. The ceiling is that we support exactly the subset ffmpeg's `subtitles=`
 * filter needs — no karaoke, no positioning animation, no multiple styles. Upgrade path if that
 * ever changes: a real library, at which point this file is deleted rather than extended.
 */

import type { AssemblyBlock, AssemblyReport } from "./assembly";
import { err, ok, type Result } from "./result";

/** One word as the STT provider returns it. `type` is `"word" | "spacing" | "audio_event"` in
 *  scribe-v2's own vocabulary; it is typed as `string` because a provider adding a fourth value
 *  must not become a type error at the boundary — it becomes a dropped token, which is correct. */
export type SttWord = { text: string; start: number; end: number; type: string };

/** One caption, on the FINISHED reel's timeline. `clamped` marks a line whose rebased time fell
 *  outside its own block's window and was pulled back in — carried so the caller can count them
 *  rather than discover a systematic offset by watching the video. */
export type CaptionLine = { startS: number; endS: number; text: string; clamped?: true };

/** Characters per caption line. 32 is what fits a 9:16 frame at the style below without wrapping
 *  into the safe area; libass would wrap a longer line itself, but where it wraps is not our
 *  decision to leave to it. */
export const DEFAULT_LINE_CHARS = 32;

/**
 * Take-relative word times → absolute reel times, for ONE block.
 *
 * Words that are not words are DROPPED. `"spacing"` carries no glyph and `"audio_event"` is the
 * provider describing the audio ("(music)"), not transcribing speech — burning either would put
 * text on screen that nobody said.
 *
 * A rebased time outside `[windowStartS, windowStartS + clipSeconds]` is CLAMPED to the window,
 * never allowed through: a word that bleeds is a word rendered over the NEXT block's scene, which
 * reads as a caption for the wrong shot rather than as a timing bug.
 */
export function rebaseWords(
  words: readonly SttWord[],
  block: AssemblyBlock,
  clipSeconds: number,
): CaptionLine[] {
  const lo = block.windowStartS;
  const hi = block.windowStartS + clipSeconds;
  const lines: CaptionLine[] = [];
  for (const w of words) {
    if (w.type !== "word") continue;
    const rawStart = block.speechAbsS + (w.start - block.leadSilenceS);
    const rawEnd = block.speechAbsS + (w.end - block.leadSilenceS);
    const startS = Math.min(Math.max(rawStart, lo), hi);
    const endS = Math.min(Math.max(rawEnd, lo), hi);
    const clamped = startS !== rawStart || endS !== rawEnd;
    lines.push(
      clamped ? { startS, endS, text: w.text, clamped: true } : { startS, endS, text: w.text },
    );
  }
  return lines;
}

/** Words → caption lines of at most `maxChars`, so a line never runs off a 9:16 frame. A single
 *  word longer than the whole budget gets its own line rather than being dropped: an unreadable
 *  caption beats a missing one, and the alternative is silently losing a word. */
export function groupIntoLines(
  lines: readonly CaptionLine[],
  maxChars: number = DEFAULT_LINE_CHARS,
): CaptionLine[] {
  const out: CaptionLine[] = [];
  let current: CaptionLine | null = null;
  for (const line of lines) {
    const merged: string = current === null ? line.text : `${current.text} ${line.text}`;
    if (current !== null && merged.length <= maxChars) {
      current = {
        startS: current.startS,
        endS: line.endS,
        text: merged,
        ...(current.clamped || line.clamped ? { clamped: true as const } : {}),
      };
      continue;
    }
    if (current !== null) out.push(current);
    current = { ...line };
  }
  if (current !== null) out.push(current);
  return out;
}

// ── the .ass file ───────────────────────────────────────────────────────────────────────────────

/** `H:MM:SS.cc` — centiseconds, exactly two digits, which is the only time format libass accepts
 *  in an `.ass` Dialogue row. */
function assTime(seconds: number): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  // A round up to 100 would print `:01.100`; carry it into the second instead.
  const carry = cs === 100;
  const sec = carry ? s + 1 : s;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(
    carry ? 0 : cs,
  ).padStart(2, "0")}`;
}

/**
 * `.ass` treats `{...}` as an inline style override and `\` as an escape lead-in. The caption text
 * is MODEL-AUTHORED NARRATION. An unescaped brace is markup injection into a renderer — harmless
 * today, and exactly the kind of thing that is not harmless once the renderer changes.
 *
 * Substituted with a space rather than deleted, so `a{x}b` cannot silently become the word `ab`.
 * A newline would end the Dialogue row and turn the remainder into a malformed line, so it goes
 * the same way.
 */
function escapeAss(text: string): string {
  return text
    .replace(/[{}\\]/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The `.ass` file, with one style and one event type.
 *
 * `PlayResX/Y` default to a 9:16 frame. libass scales the script resolution onto the video, so the
 * numbers that matter are the RATIO and the font size relative to `PlayResY` — which is why they
 * are stated rather than omitted (an `.ass` without them is assumed to be 384x288, and the font
 * comes out roughly five times too large).
 *
 * The font is **DejaVu Sans because that is what plan 20-15's snapshot bakes**. `deny-all` egress
 * means a font named here and not present in the image does not fail — libass silently substitutes
 * and the reel ships in the wrong typeface.
 */
export function toAss(
  lines: readonly CaptionLine[],
  opts: { playResX?: number; playResY?: number } = {},
): string {
  const x = opts.playResX ?? 1080;
  const y = opts.playResY ?? 1920;
  const rows: string[] = [];
  for (const line of lines) {
    const text = escapeAss(line.text);
    if (text.length === 0) continue; // a blank Dialogue row is a row libass renders as nothing
    rows.push(`Dialogue: 0,${assTime(line.startS)},${assTime(line.endS)},Default,,0,0,0,,${text}`);
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${x}`,
    `PlayResY: ${y}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // White fill, black outline, bottom-centre, generous MarginV: the readable-on-anything default.
    "Style: Default,DejaVu Sans,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,80,80,120,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...rows,
    "",
  ].join("\n");
}

// ── one transcript needs one audio file ─────────────────────────────────────────────────────────

export type WavError = { code: "no_takes" | "not_a_wav" | "format_mismatch" };

const ascii = (b: Uint8Array, at: number): string =>
  String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

type WavParts = { channels: number; sampleRate: number; bits: number; data: Uint8Array };

/** RIFF chunk walk. Deliberately not a general parser: it reads `fmt ` and `data` and ignores
 *  everything else, which is what makes it immune to the LIST/INFO chunks some encoders emit. */
function parseWav(bytes: Uint8Array): WavParts | null {
  if (bytes.byteLength < 44 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE")
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let data: Uint8Array | null = null;
  while (at + 8 <= bytes.byteLength) {
    const id = ascii(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      data = bytes.subarray(body, Math.min(body + size, bytes.byteLength));
    }
    at = body + size + (size % 2); // chunks are word-aligned
  }
  return fmt && data ? { ...fmt, data } : null;
}

/**
 * The N clean voice takes as ONE wav, plus where each take starts in it.
 *
 * **This is not a byte concat, and the difference is the whole function.** Gluing two wav files
 * together leaves a header claiming the FIRST file's length; a decoder stops there and transcribes
 * take 1 only — silently, with a plausible-looking transcript. The header has to be rewritten, so
 * it is rewritten canonically: 44 bytes, PCM, the takes' own rate and channel count.
 *
 * One request rather than N is what the reservation already assumes: `reserveJobInner` creates ONE
 * `stt` line at `blockIndex: -1` priced at the whole reel's audio minutes.
 *
 * The returned `offsetsS` is the key the rebase is partitioned on — it is how a word at t=4.5s in
 * the concatenated stream is known to belong to take 1 rather than take 0.
 */
export function concatWavTakes(
  takes: readonly Uint8Array[],
): Result<{ wav: Uint8Array; offsetsS: number[]; durationS: number }, WavError> {
  if (takes.length === 0) return err({ code: "no_takes" });
  const parsed: WavParts[] = [];
  for (const take of takes) {
    const p = parseWav(take);
    if (!p) return err({ code: "not_a_wav" });
    const first = parsed[0];
    if (
      first &&
      (p.channels !== first.channels || p.sampleRate !== first.sampleRate || p.bits !== first.bits)
    ) {
      // Concatenating a 24 kHz take onto a 48 kHz one produces audio that plays at the wrong
      // speed, which produces a transcript with plausible words at wrong times. Refuse instead.
      return err({ code: "format_mismatch" });
    }
    parsed.push(p);
  }

  const head = parsed[0] as WavParts;
  const bytesPerSecond = head.sampleRate * head.channels * (head.bits / 8);
  const offsetsS: number[] = [];
  let total = 0;
  for (const p of parsed) {
    offsetsS.push(total / bytesPerSecond);
    total += p.data.byteLength;
  }

  const out = new Uint8Array(44 + total);
  const view = new DataView(out.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + total, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, head.channels, true);
  view.setUint32(24, head.sampleRate, true);
  view.setUint32(28, bytesPerSecond, true);
  view.setUint16(32, head.channels * (head.bits / 8), true);
  view.setUint16(34, head.bits, true);
  write(36, "data");
  view.setUint32(40, total, true);
  let at = 44;
  for (const p of parsed) {
    out.set(p.data, at);
    at += p.data.byteLength;
  }
  // The duration of what is actually being SENT. `stt` is billed per input audio minute, so this is
  // the number the estimate has to have been taken against — measured, never assumed from the deck.
  return ok({ wav: out, offsetsS, durationS: total / bytesPerSecond });
}

// ── the whole track ─────────────────────────────────────────────────────────────────────────────

/**
 * The finished caption track: every word placed where the sidecar says its block's speech is.
 *
 * Words are partitioned by take using the concat offsets, shifted back to take-relative time, and
 * rebased against THAT block's anchors. A word is never rebased against a block it was not spoken
 * in, which is the failure the offsets exist to prevent.
 */
export function buildCaptionLines(a: {
  words: readonly SttWord[];
  report: AssemblyReport;
  offsetsS: readonly number[];
  maxChars?: number;
}): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const block of a.report.blocks) {
    const takeStart = a.offsetsS[block.blockIndex];
    if (takeStart === undefined) continue; // fewer takes than blocks: that block simply has no words
    const takeEnd = a.offsetsS[block.blockIndex + 1] ?? Number.POSITIVE_INFINITY;
    const inTake = a.words
      .filter((w) => w.start >= takeStart && w.start < takeEnd)
      .map((w) => ({ ...w, start: w.start - takeStart, end: w.end - takeStart }));
    out.push(...groupIntoLines(rebaseWords(inTake, block, a.report.clipSeconds), a.maxChars));
  }
  return out.sort((l, r) => l.startS - r.startS);
}
