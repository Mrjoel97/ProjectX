/**
 * The BLOCK DECK contract (MEDIA-01, D8). Pure TS, Convex-free (CLAUDE.md §1).
 *
 * A reel is N FIXED-LENGTH blocks, every block the same number of seconds, each carrying exactly
 * one narration line written to fit its window. This module is the ONLY place that shape is
 * decided: `packages/contracts/skills/media-director.md` writes the deck, plan 20-03's round-trip
 * test feeds that body's own worked example back through `parseBlockDeck`, and everything
 * downstream (the price estimate, the canvas, the assembler) reads `Block[]`, never prose.
 *
 * Two refusals here happen BEFORE a cent is spent, which is the entire reason the module exists:
 *  - a narration line longer than its window (`narration_too_long`). The provider returns no
 *    duration (delta §1.5), so an overrun is otherwise only measurable by `ffprobe` in the render
 *    sandbox — after ~$3.00 of clips have already been paid for.
 *  - a deck whose rows disagree on duration (`mixed_durations`). Renormalising silently would
 *    submit a duration nobody priced.
 *
 * Every failure RETURNS. Nothing throws — a governed stop is a value, only bugs throw
 * (the `resolveSpecialist` rule).
 *
 * ponytail: a markdown-table parser over a registry-authored block. The skill body owns the format
 * and plan 20-03's round-trip test pins the two together. Upgrade path if the model ever drifts off
 * the table shape: a strict-schema tool call instead of prose parsing — which is a dispatch-surface
 * change, not a parser change.
 */

/** The CLOSED set of block types. An unknown type is a parse failure, never a silent default. */
export const SHOT_TYPES = ["AI", "SCREEN REC", "TEXT", "VIDEO"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

/** Wan 2.5's ONLY accepted durations. There is no 15 s. */
export const CLIP_SECONDS = [5, 10] as const;
/** D8's default block length — the value the canvas editor starts a new deck at. The PARSER does
 *  not fall back to it: an absent `Clip seconds:` declaration is `bad_duration`, because guessing
 *  a block length picks a price. */
export const DEFAULT_CLIP_SECONDS = 10;
/** `assemble_final.sh`'s own tolerance: a take's SPEECH must fill
 *  `[clipSeconds - SPEECH_SLACK_S, clipSeconds]` seconds. BOTH ends are hard errors at render
 *  time — after the clips are paid for — so both ends are guarded here, at parse time, for free.
 *  Kept as a named constant so the two files can be compared rather than re-derived. */
export const SPEECH_SLACK_S = 1.4;
/** English speech runs ~15 chars/second, so a window holds ~15 × its seconds. 14 leaves headroom.
 *  Enforced HERE, at parse time, because the provider returns no duration (delta §1.5) and the
 *  overrun is otherwise only measurable by ffprobe — after the clips are paid for. */
export const MAX_CHARS_PER_SECOND = 14;
/** The SLOWEST plausible delivery, deliberately — the floor must only refuse a line that cannot
 *  fill its window under ANY plausible reading pace. Pace genuinely wanders (upstream measured
 *  1.9–3.4 words/second between generations of the SAME line), so a floor computed at the average
 *  rate would reject lines that render fine. At 12 chars/second a 10 s block needs 103 characters
 *  and a 5 s block needs 43 — anything under that is short at any pace. */
export const MIN_CHARS_PER_SECOND = 12;
/** The 10-second ceiling, and the number `media-director.md` teaches. It is NOT the whole rule:
 *  the ceiling SCALES with the deck's clip length — see `maxCharsFor`. */
export const MAX_CHARS_PER_BLOCK = 140;
/** The ceiling for a deck of this block length. 140 at 10 s, 70 at 5 s.
 *
 *  A flat 140 was a hole: `assemble_final.sh` hard-errors when a take's SPEECH exceeds its window,
 *  and a 5-second window holds ~75 characters. So a 120-character line in a 5-second deck cleared
 *  the pre-payment guard and then failed the render — after the clips were paid for, which is the
 *  exact failure this ceiling exists to prevent, just at the other clip length. Found while
 *  harvesting the assembler in 20-13. */
export const maxCharsFor = (clipSeconds: number): number =>
  Math.round(clipSeconds * MAX_CHARS_PER_SECOND);
/** The FLOOR for a deck of this block length. 103 at 10 s, 43 at 5 s.
 *
 *  The other half of the same hole: `assemble_final.sh` hard-errors on a take whose speech is
 *  SHORTER than `clipSeconds - 1.4` just as loudly as on one that overruns, and the parser used to
 *  have no floor at all. A 60-character line in a 10-second block is ~4 s of speech — it fails the
 *  render, after the clips are paid for, exactly like an overrun does. */
export const minCharsFor = (clipSeconds: number): number =>
  Math.round((clipSeconds - SPEECH_SLACK_S) * MIN_CHARS_PER_SECOND);

export type Block = {
  index: number;
  type: ShotType;
  seconds: number; // === deck.clipSeconds, uniform by construction
  windowStartMs: number; // DERIVED: index * seconds * 1000
  description: string;
  narration: string; // the spoken line for this window
  overlay?: string;
  prompt: string; // the per-block generation prompt (koda /generate)
};

export type ParsedDeck =
  | { ok: true; clipSeconds: number; blocks: Block[] }
  | {
      ok: false;
      reason:
        | "no_deck"
        | "empty_deck"
        | "unknown_shot_type"
        | "bad_duration"
        | "mixed_durations"
        | "missing_narration";
    }
  | {
      ok: false;
      reason: "narration_too_long" | "narration_too_short";
      blockIndex: number;
      chars: number;
    };

/** Which blocks draw CLIP money. The ONE place this is decided.
 *
 *  A `satisfies Record<ShotType, boolean>` table, NOT a switch: a `default` branch would make a
 *  fifth shot type silently inherit another's billing and the coverage test vacuous forever
 *  (the `TIER_REASON`/`armFor` lesson, actionType.ts:35-43). Adding a member to SHOT_TYPES without
 *  deciding whether it costs money is a COMPILE error here. */
const PAID = {
  AI: true,
  VIDEO: true,
  "SCREEN REC": false, // an instruction to the human — estimates to zero
  TEXT: false, // rendered by the assembler — estimates to zero
} as const satisfies Record<ShotType, boolean>;

export const isPaidBlock = (b: Block): boolean => PAID[b.type];

/** Total SUBMITTED characters across the deck — the tts MediaSpec's input. */
export const narrationChars = (blocks: readonly Block[]): number =>
  blocks.reduce((n, b) => n + b.narration.length, 0);

const SHOT_TYPE_SET = new Set<string>(SHOT_TYPES);
const CLIP_SECONDS_SET = new Set<number>(CLIP_SECONDS);

const fail = (reason: Exclude<ParsedDeck & { ok: false }, { blockIndex: number }>["reason"]) =>
  ({ ok: false, reason }) as const;

/** Cells of a markdown table row: `| a | b |` → ["a", "b"]. */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/** `Block 2` … `Prompt: …` → { 2: "…" }. Absent section → empty map, and every block falls back
 *  to its description (a description is a worse prompt, but it is never a lie about what was
 *  written). */
function parsePrompts(section: string): Map<number, string> {
  const out = new Map<number, string>();
  let current: number | undefined;
  for (const line of section.split(/\r?\n/)) {
    const head = /^\s*#*\s*Block\s+(\d+)\b/i.exec(line);
    if (head) {
      current = Number(head[1]);
      continue;
    }
    const p = /^\s*[*-]?\s*(?:\*\*)?Prompt(?:\*\*)?\s*:\s*(.+)$/i.exec(line);
    if (p && current !== undefined && !out.has(current)) out.set(current, (p[1] ?? "").trim());
  }
  return out;
}

export function parseBlockDeck(body: string): ParsedDeck {
  const deckAt = /^[ \t]*#*[ \t]*BLOCK DECK\b.*$/im.exec(body);
  if (!deckAt) return fail("no_deck");

  const afterDeck = body.slice(deckAt.index + deckAt[0].length);
  const promptsAt = /^[ \t]*#*[ \t]*BLOCK PROMPTS\b.*$/im.exec(afterDeck);
  const section = promptsAt ? afterDeck.slice(0, promptsAt.index) : afterDeck;
  const prompts = promptsAt
    ? parsePrompts(afterDeck.slice(promptsAt.index))
    : new Map<number, string>();

  const declared = /^[ \t]*(?:\*\*)?Clip seconds(?:\*\*)?[ \t]*:[ \t]*(\d+)/im.exec(section);
  const clipSeconds = declared ? Number(declared[1]) : Number.NaN;
  if (!CLIP_SECONDS_SET.has(clipSeconds)) return fail("bad_duration");

  const rows = section
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map(cellsOf)
    .filter((c) => !isSeparatorRow(c));
  const header = rows.shift();
  if (!header) return fail("no_deck");

  // Map columns BY NAME, so a reordered or extra column is not a silent mis-read.
  const col = (...names: string[]) =>
    header.findIndex((h) => names.includes(h.toLowerCase().replace(/[*#]/g, "").trim()));
  const iType = col("type");
  const iDesc = col("description", "desc", "visual");
  const iNarr = col("narration", "voiceover", "vo");
  const iOverlay = col("text overlay", "overlay");
  // Only an explicit DURATION column, never a `Time` column: a model's start-time arithmetic is
  // not an input to a timeline (windowStartMs is derived) and must not be read as a duration.
  const iSeconds = col("seconds", "secs", "duration");
  if (iType < 0 || iDesc < 0 || iNarr < 0) return fail("no_deck");
  if (rows.length === 0) return fail("empty_deck");

  const blocks: Block[] = [];
  for (const [index, cells] of rows.entries()) {
    const type = (cells[iType] ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!SHOT_TYPE_SET.has(type)) return fail("unknown_shot_type");

    // An explicit per-row duration that disagrees with the deck is refused, never renormalised —
    // and an unparseable one is NaN, which also disagrees. Fail closed either way.
    const rowSeconds = iSeconds >= 0 ? (cells[iSeconds] ?? "").trim() : "";
    if (rowSeconds !== "" && Number.parseInt(rowSeconds, 10) !== clipSeconds)
      return fail("mixed_durations");

    const narration = (cells[iNarr] ?? "").trim();
    if (narration === "") return fail("missing_narration");
    // BOTH ends. The assembler treats a short take and a long one as the same hard error, and both
    // land after the clips are paid for.
    if (narration.length < minCharsFor(clipSeconds))
      return {
        ok: false,
        reason: "narration_too_short",
        blockIndex: index,
        chars: narration.length,
      };
    if (narration.length > maxCharsFor(clipSeconds))
      return {
        ok: false,
        reason: "narration_too_long",
        blockIndex: index,
        chars: narration.length,
      };

    const description = (cells[iDesc] ?? "").trim();
    const overlay = iOverlay >= 0 ? (cells[iOverlay] ?? "").trim() : "";
    blocks.push({
      index,
      type: type as ShotType,
      seconds: clipSeconds,
      windowStartMs: index * clipSeconds * 1000,
      description,
      narration,
      ...(overlay === "" ? {} : { overlay }),
      // The deck's `#` column is DISPLAY, 1-based; row order is the reel's order and the truth.
      prompt: prompts.get(index + 1) ?? description,
    });
  }

  return { ok: true, clipSeconds, blocks };
}
