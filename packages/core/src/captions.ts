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

import type { AssemblyReport, AssemblyScene } from "./assembly";
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
 * A rebased time outside `[windowStartS, boundS]` is CLAMPED, never allowed through: a word that
 * bleeds is a word rendered over the NEXT take's caption, which reads as a caption for the wrong
 * line rather than as a timing bug.
 *
 * `boundS` is the NEXT take's speech start (or the reel's end for the last take) — **not**
 * `windowStartS + clipSeconds`. Since 20.2 wave 4 a line may legitimately run past its own scene
 * and carry over the cut, so a scene-width bound is wrong in both directions: it cuts a correct
 * line off at the boundary, and on a deck of mixed scene lengths `clipSeconds` is the LONGEST
 * scene, which lets a drifting word sail over the next take. The next take's start is the bound
 * the assembler itself enforces (it refuses two lines that overlap), so it is the one that holds.
 */
export function rebaseWords(
  words: readonly SttWord[],
  scene: AssemblyScene,
  boundS: number,
): CaptionLine[] {
  const lo = scene.startS;
  const hi = Math.max(lo, boundS);
  const lines: CaptionLine[] = [];
  for (const w of words) {
    if (w.type !== "word") continue;
    const rawStart = scene.speechAbsS + (w.start - scene.leadSilenceS);
    const rawEnd = scene.speechAbsS + (w.end - scene.leadSilenceS);
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

/** Same cue count and character ceiling as the greedy split, but move whole words between
 * neighbouring cues to avoid flashes, then minimize the fastest reading rate. Called within ONE verified take.
 * Every boundary remains an original word boundary; extra display time is never invented. */
function balanceCaptionLines(
  words: readonly CaptionLine[],
  maxChars: number = DEFAULT_LINE_CHARS,
): CaptionLine[] {
  const greedy = groupIntoLines(words, maxChars);
  if (greedy.length < 2 || words.length > 128) return greedy;
  const speed = (line: CaptionLine): number => line.text.length / (line.endS - line.startS);
  type Split = { flashes: number; fastest: number; lines: CaptionLine[] };
  const better = (a: Split, b: Split): boolean =>
    a.flashes < b.flashes || (a.flashes === b.flashes && a.fastest < b.fastest);
  let previous = new Map<number, Split>([[0, { flashes: 0, fastest: 0, lines: [] }]]);
  // ponytail: retain the greedy cue count instead of introducing a configurable subtitle
  // optimizer. At most128 words enter this bounded search; longer takes retain the linear
  // greedy path. Slower narration is the upgrade when the whole take itself reads fast.
  for (let count = 1; count <= greedy.length; count++) {
    const next = new Map<number, Split>();
    for (const [start, split] of previous) {
      let text = "";
      let clamped = false;
      for (let end = start; end < words.length; end++) {
        const first = words[start];
        const last = words[end];
        if (!first || !last) break;
        text = text.length === 0 ? last.text : `${text} ${last.text}`;
        if (text.length > maxChars && end > start) break;
        clamped ||= last.clamped === true;
        const line: CaptionLine = {
          startS: first.startS,
          endS: last.endS,
          text,
          ...(clamped ? { clamped: true as const } : {}),
        };
        if (line.endS <= line.startS || assTime(line.endS) === assTime(line.startS)) continue;
        // STT word ranges may overlap despite monotonic starts/ends. A new cut must not
        // turn that overlap into simultaneous cues; keep the original endpoints instead.
        const following = words[end + 1];
        if (following && line.endS > following.startS) continue;
        const candidate = {
          flashes: split.flashes + (line.endS - line.startS < 0.75 ? 1 : 0),
          fastest: Math.max(split.fastest, speed(line)),
          lines: [...split.lines, line],
        };
        const existing = next.get(end + 1);
        if (!existing || better(candidate, existing)) next.set(end + 1, candidate);
      }
    }
    previous = next;
  }
  const balanced = previous.get(words.length);
  const original = {
    flashes: greedy.filter((line) => line.endS - line.startS < 0.75).length,
    fastest: Math.max(...greedy.map(speed)),
    lines: greedy,
  };
  return balanced && better(balanced, original) ? balanced.lines : greedy;
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
  const marginX = Math.ceil(x * 0.08);
  const marginY = Math.ceil(y * 0.2);
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
    // 0 = smart wrap INSIDE the margins. It was 2 (no wrapping at all) on the reasoning that
    // `groupIntoLines` already bounds a cue at DEFAULT_LINE_CHARS — but 32 characters of 64px
    // DejaVu Sans is ~1280px wide against a 920px band (1080 minus the two 80px margins), so a
    // full-length cue ran off BOTH edges. Measured on the first rendered reel: a 31-character cue
    // touched both frame edges even in the narrower fallback face. The chunker still keeps cues
    // short; libass now guarantees that whatever length arrives is drawn within the frame.
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // White/outlined, above native/social player chrome: bottom 20%, horizontal inset at least 8%.
    `Style: Default,DejaVu Sans,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,${marginX},${marginX},${marginY},1`,
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

type WavParts = {
  encoding: number;
  channels: number;
  sampleRate: number;
  bits: number;
  data: Uint8Array;
};

/** RIFF chunk walk. Deliberately not a general parser: it reads `fmt ` and `data` and ignores
 *  everything else, which is what makes it immune to the LIST/INFO chunks some encoders emit. */
function parseWav(bytes: Uint8Array): WavParts | null {
  if (bytes.byteLength < 44 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE")
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let fmt: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Uint8Array | null = null;
  while (at + 8 <= bytes.byteLength) {
    const id = ascii(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      fmt = {
        encoding: view.getUint16(body, true),
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

/** The native caption source is one bounded PCM16/24k/mono track at final timeline zero. */
export function isNativeCaptionWav(bytes: Uint8Array, durationS: number): boolean {
  if (!Number.isFinite(durationS) || durationS <= 0 || bytes.byteLength > 6 * 1024 * 1024)
    return false;
  let parsed: WavParts | null;
  try {
    parsed = parseWav(bytes);
  } catch {
    return false;
  }
  return (
    parsed !== null &&
    parsed.encoding === 1 &&
    parsed.channels === 1 &&
    parsed.sampleRate === 24000 &&
    parsed.bits === 16 &&
    parsed.data.byteLength % 2 === 0 &&
    Math.abs(parsed.data.byteLength / 48000 - durationS) <= 0.05
  );
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
/**
 * Wrap HEADERLESS little-endian PCM16 in a 44-byte RIFF header.
 *
 * 33.1 needs exactly one bridge and no more. OpenRouter's chat-audio stream returns `pcm16` —
 * raw samples, no container — while everything downstream reads WAV: `concatWavTakes` below,
 * `readWav`, and the assembler's own ffmpeg inputs. Rather than teach three readers a second
 * dialect, the bytes are given the header they are missing at the edge where they arrive.
 *
 * The byte layout is deliberately the SAME one `concatWavTakes` writes below, field for field.
 * Two RIFF writers in one file that disagree by a field is a defect nobody finds until a render
 * produces silence, so if you change one, change both — `readWav` parses what both emit.
 */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const bits = 16;
  const bytesPerSecond = sampleRate * channels * (bits / 8);
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, bytesPerSecond, true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

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
 *
 * **The offsets are keyed by NARRATED ORDINAL, never by `blockIndex`.** `concatWavTakes` builds one
 * offset per take it was actually handed, positionally; those two agree only while every scene owns
 * a take. Since 20.2 wave 3 a scene may be deliberately silent, and the sidecar says so with
 * `speech_dur_s: 0` — so a silent scene is a HOLE, and reading `offsetsS[blockIndex]` past one
 * hands every later scene the wrong take and drops the last one off the end of the array. That is
 * a caption on the wrong shot, not a rounding error: on a 3-scene reel with a silent card the last
 * line lands ~10s early.
 */
type CaptionBuildArgs = {
  words: readonly SttWord[];
  report: AssemblyReport;
  offsetsS: readonly number[];
  maxChars?: number;
  /** Exact submitted scripts in narrated ordinal order; never an unverified edited deck. */
  expectedTakeTexts?: readonly string[];
  /** Rebalance whole words within verified takes; preserve cue count, width and word times. */
  balanceReadability?: boolean;
};
export type CaptionBuildError = {
  code:
    | "caption_take_count_mismatch"
    | "caption_expected_text_mismatch"
    | "caption_invalid_word_time"
    | "caption_word_outside_take"
    | "caption_nonpositive_cue";
};

const alignmentTokens = (text: string): string[] =>
  (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
  ).map((token) => token.replaceAll("’", "'"));

/** STT may round a boundary word slightly into its preceding take. Exact submitted scripts
 * disambiguate ownership, never timestamps. A half-second window bounds tolerated STT drift;
 * it is a refusal threshold, not synthetic word duration or a request to stretch speech. */
export function buildCaptionLinesChecked(
  a: CaptionBuildArgs & { expectedTakeTexts: readonly string[] },
): Result<CaptionLine[], CaptionBuildError> {
  const narrated = a.report.scenes.filter((s) => s.speechDurS > 0);
  if (
    a.expectedTakeTexts.length !== narrated.length ||
    a.offsetsS.length !== narrated.length ||
    a.offsetsS.some(
      (offset, i) =>
        !Number.isFinite(offset) || offset < 0 || (i > 0 && offset <= (a.offsetsS[i - 1] ?? 0)),
    )
  )
    return err({ code: "caption_take_count_mismatch" });
  if (a.words.some((w) => !w || typeof w !== "object"))
    return err({ code: "caption_invalid_word_time" });
  const words = a.words.filter((w) => w.type === "word");
  if (
    words.some(
      (w, i) =>
        typeof w.text !== "string" ||
        !Number.isFinite(w.start) ||
        !Number.isFinite(w.end) ||
        w.start < 0 ||
        w.end < w.start ||
        (i > 0 && (w.start < (words[i - 1]?.start ?? 0) || w.end < (words[i - 1]?.end ?? 0))),
    )
  )
    return err({ code: "caption_invalid_word_time" });
  const expected = a.expectedTakeTexts.map(alignmentTokens);
  const actual = words.map((w) => alignmentTokens(w.text));
  const flat = expected.flat();
  if (
    expected.some((tokens) => tokens.length === 0) ||
    actual.length !== flat.length ||
    actual.some((tokens, i) => tokens.length !== 1 || tokens[0] !== flat[i])
  )
    return err({ code: "caption_expected_text_mismatch" });
  let cursor = 0;
  const byTake: SttWord[][] = [];
  for (const [ordinal, scene] of narrated.entries()) {
    const selected = words.slice(cursor, cursor + (expected[ordinal]?.length ?? 0));
    cursor += selected.length;
    const takeStart = a.offsetsS[ordinal] as number;
    const takeEnd = a.offsetsS[ordinal + 1] ?? takeStart + scene.leadSilenceS + scene.speechDurS;
    if (selected.some((w) => w.start < takeStart - 0.5 || w.end > takeEnd + 0.5))
      return err({ code: "caption_word_outside_take" });
    byTake.push(selected);
  }
  const lines = captionLinesInner(a, byTake);
  if (
    lines.length === 0 ||
    lines.some(
      (line) =>
        !Number.isFinite(line.startS) ||
        !Number.isFinite(line.endS) ||
        line.endS <= line.startS ||
        assTime(line.endS) === assTime(line.startS),
    )
  )
    return err({ code: "caption_nonpositive_cue" });
  return ok(lines);
}

/** Native audio is transcribed from one full rendered soundtrack. Its word timestamps already
 * use the final timeline; project that audio track as one zero-anchored window instead of applying
 * the clean-TTS take centering recorded by the picture sidecar. The reviewed script still must
 * match exactly, and no returned word timestamp is changed to repair a mismatch. */
export function buildTimelineCaptionLinesChecked(a: {
  words: readonly SttWord[];
  durationS: number;
  expectedText: string;
  balanceReadability?: boolean;
}): Result<CaptionLine[], CaptionBuildError> {
  if (!Number.isFinite(a.durationS) || a.durationS <= 0)
    return err({ code: "caption_invalid_word_time" });
  if (a.words.some((word) => !word || typeof word !== "object"))
    return err({ code: "caption_invalid_word_time" });
  if (a.words.some((word) => word.type === "word" && word.end > a.durationS))
    return err({ code: "caption_word_outside_take" });
  return buildCaptionLinesChecked({
    words: a.words,
    expectedTakeTexts: [a.expectedText],
    offsetsS: [0],
    balanceReadability: a.balanceReadability,
    report: {
      sceneCount: 1,
      targetDurationS: a.durationS,
      totalDurationS: a.durationS,
      actualDurationS: a.durationS,
      gates: [],
      scenes: [
        {
          index: 0,
          startS: 0,
          durationS: a.durationS,
          visual: "video",
          leadSilenceS: 0,
          speechAbsS: 0,
          speechDurS: a.durationS,
          overrun: false,
        },
      ],
    },
  });
}

/** Legacy callers preserve timestamp partitioning. Supplying verified scripts opts into strict
 * alignment; invalid alignment yields no track, never a silently timestamp-partitioned result.
 * Adapters use the checked entry point above to retain its explicit failure reason. */
export function buildCaptionLines(a: CaptionBuildArgs): CaptionLine[] {
  if (a.expectedTakeTexts !== undefined) {
    const checked = buildCaptionLinesChecked({ ...a, expectedTakeTexts: a.expectedTakeTexts });
    return checked.ok ? checked.value : [];
  }
  return captionLinesInner(a);
}

function captionLinesInner(
  a: CaptionBuildArgs,
  wordsByTake?: readonly (readonly SttWord[])[],
): CaptionLine[] {
  const out: CaptionLine[] = [];
  // The scenes that DECLARE narration, in reel order. This is the take list the STT stage was
  // handed, so its position is the key into `offsetsS`.
  const narrated = a.report.scenes.filter((s) => s.speechDurS > 0);
  for (const [ordinal, scene] of narrated.entries()) {
    const takeStart = a.offsetsS[ordinal];
    if (takeStart === undefined) continue; // fewer takes than narrated scenes: no words for this one
    const takeEnd = a.offsetsS[ordinal + 1] ?? Number.POSITIVE_INFINITY;
    const inTake = (
      wordsByTake?.[ordinal] ?? a.words.filter((w) => w.start >= takeStart && w.start < takeEnd)
    ).map((w) => ({ ...w, start: w.start - takeStart, end: w.end - takeStart }));
    // A line may run past its own scene but never into the next line — the same bound the
    // assembler enforces on the audio, applied to the captions so the two cannot disagree.
    const bound = narrated[ordinal + 1]?.speechAbsS ?? a.report.totalDurationS;
    const rebased = rebaseWords(inTake, scene, bound);
    out.push(
      ...(wordsByTake && a.balanceReadability
        ? balanceCaptionLines(rebased, a.maxChars)
        : groupIntoLines(rebased, a.maxChars)),
    );
  }
  return out.sort((l, r) => l.startS - r.startS);
}
