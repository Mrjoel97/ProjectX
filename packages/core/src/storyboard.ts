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

/** Visual-provider durations supported by the media rail. The default is Sora's lowest-cost tier;
 *  5 and 10 remain accepted so already-proposed Wan decks can still be read and displayed. */
export const CLIP_SECONDS = [4, 5, 8, 10, 12] as const;
/** D8's default block length — the value the canvas editor starts a new deck at. The PARSER does
 *  not fall back to it: an absent `Clip seconds:` declaration is `bad_duration`, because guessing
 *  a block length picks a price. */
export const DEFAULT_CLIP_SECONDS = 4;
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
      reason: // HEADING ABSENT, and nothing else. See `unreadable_deck` — these two were one code, and
      // `persistStoryboard` branches on the difference.
        | "no_deck"
        | "unreadable_deck"
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
  // ⚠ AN UNPAID BLOCK IS ALSO AN UNRENDERABLE ONE, TODAY. Unpaid means no video line, which means
  // nothing ever writes that index's `blockNN.mp4` — and `assemble_final.sh` discovers inputs BY
  // INDEX and hard-errors on the first missing clip. The two comments below described an INTENT
  // (a title card; a human-supplied recording) that the assembler harvested in 20-13 does not
  // implement, and until it does, `media.reserveJobInner` refuses any deck containing one with
  // `unrenderable_block` — BEFORE a cent moves. Do not "fix" that refusal without first giving
  // the assembler a clipless-index branch.
  "SCREEN REC": false, // INTENT: an instruction to the human. No upload path exists yet.
  TEXT: false, // INTENT: a card rendered by the assembler. No drawtext branch exists yet.
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
    // `Scene N` as well as `Block N` (20.2 wave 8). The prompts section is SHARED by both deck
    // contracts, and a scene body writing `Scene 1` under a `Block`-only head regex would attach no
    // prompt at all — `parseSceneDeck` falls back to the row's DESCRIPTION, which is not a parse
    // failure and not a lie anyone notices until the pictures come back generic.
    const head = /^\s*#*\s*(?:Block|Scene)\s+(\d+)\b/i.exec(line);
    if (head) {
      current = Number(head[1]);
      continue;
    }
    const p = labelAt("Prompt", line);
    if (p && current !== undefined && !out.has(current))
      out.set(current, (p[1] ?? "").replace(/[*_\s]+$/, "").trim());
  }
  return out;
}

/**
 * A section's body: from its heading to the start of the next one, or `""`.
 *
 * `parseBlockDeck`'s heading idiom, generalised in two ways that both matter because the SPECIALIST
 * writes this, not us:
 *  - the heading matches with or without `#`s and with or without a `N.` prefix. The skill body
 *    uses `## 2. ART DIRECTION` for its own instructions but shows the model a BARE `BLOCK DECK`
 *    token in its example, and both shapes come back in real output.
 *  - a section therefore ends at the next `#` heading **or at the next known section token**. With
 *    a `#`-only terminator, a model that emits bare tokens would have ART DIRECTION run to EOF and
 *    swallow the whole deck — `avoid` would come back carrying table rows, on a plan row the user
 *    reads at the Approve gate.
 */
const SECTION_TOKENS = [
  "SCRIPT",
  "ART DIRECTION",
  "BLOCK DECK",
  "BLOCK PROMPTS",
  // The SCENE contract's two headings (20.2). Registered here rather than in a second list so a
  // body carrying a scene deck terminates `ART DIRECTION` at the deck instead of swallowing it —
  // the exact failure the comment above describes, one contract later.
  "SCENE DECK",
  "SCENE PROMPTS",
  // The guided-intake heading (33-01), registered for the same reason: a BRIEF above a script must
  // end where the script starts, and vice versa.
  "BRIEF",
];

/**
 * What may sit between the start of a line and a heading token.
 *
 * `#` for a markdown heading, and **`*`/`_` because a model told to write a bare `SCENE DECK` line
 * writes `**SCENE DECK**` about as often as it writes the bare form** — a decorated heading is the
 * SAME heading, not a different contract. Spaces are in the class rather than around it so
 * `## **SCENE DECK**` (both decorations, interleaved) matches too.
 *
 * ONE constant, shared by every heading matcher in this file, because the tolerance MUST NOT drift
 * between the two deck contracts, their prompt sections and the variation splitter. It did: all six
 * matchers accepted `#` and none accepted `*`, so a bolded `SCENE DECK` read as "this body has no
 * scene deck at all", fell through to `parseBlockDeck`, and refused a deck the model had actually
 * written — reported to the owner as "it never wrote a block deck".
 *
 * It cannot match a letter, so it can never eat into the token it precedes.
 */
const HEAD = "[#*_ \\t]*";

/** The one heading matcher. `4.`-style numbering stays tolerated (§-numbered bodies). */
const headingAt = (token: string, body: string): RegExpExecArray | null =>
  new RegExp(`^${HEAD}(?:\\d+\\.[ \\t]*)?${token}\\b.*$`, "im").exec(body);

/**
 * `HEAD`, one family down: what may sit between the start of a line and a LABEL.
 *
 * `-` joins the class because a labelled field is the shape a model writes as a bullet
 * (`- Target duration: 30`) far more often than a heading is.
 */
const LEAD = "[-*_# \\t]*";

/**
 * Decoration that may hug a label on EITHER side of its separator.
 *
 * This is the whole point of the helper. Every one of the five label matchers this replaces wrote
 * `(?:\\*\\*)?LABEL(?:\\*\\*)?[ \\t]*:` — bold around the LABEL, colon outside the asterisks. But
 * `**Target duration:** 30` puts the colon INSIDE, and that is the most ordinary way markdown
 * writes a labelled field. The two numeric matchers hard-refused it (`(\\d+)` cannot match `*`),
 * and `fieldOf` was worse: it matched and captured `"** warm"`, feeding decoration into an art
 * direction that goes on to buy video. A separator is a separator whichever side the bold is on.
 */
const MARK = "[*_]*";

/**
 * The one label matcher, shared by every `LABEL: value` read in this file.
 *
 * ONE function for the same reason `headingAt` is one function: five copies drifted into three
 * tolerances, and the two with the NARROWEST tolerance — `Clip seconds` and `Target duration` —
 * are the two that gate an entire deck. A model that decorates its headings decorates its labels
 * in the same body, so widening the headings alone just moved the refusal one gate down
 * (`no_deck` -> `bad_target_duration`, the owner's 2026-08-17 reel, twice).
 *
 * `value` is the caller's: `(.+)$` for prose (anchored — a label owns its whole line), `(\\d+)`
 * for the two duration reads (unanchored, so `Target duration: 30 seconds` still parses). Like
 * `HEAD`, neither `LEAD` nor `MARK` can match a letter, so neither can eat the label it hugs.
 */
const labelAt = (label: string, text: string, value = "(.+)$"): RegExpExecArray | null =>
  new RegExp(`^${LEAD}${label}${MARK}[ \\t]*(?:[—:-])[ \\t]*${MARK}[ \\t]*${value}`, "im").exec(
    text,
  );

/** A label's value with any trailing decoration removed — `**Mood:** warm**` is `warm`. */
const labelValue = (label: string, text: string): string =>
  (labelAt(label, text)?.[1] ?? "").replace(/[*_\s]+$/, "").trim();

function sectionOf(body: string, heading: string): string {
  const at = headingAt(heading, body);
  if (!at) return "";
  const after = body.slice(at.index + at[0].length);
  const others = SECTION_TOKENS.filter((t) => t !== heading).join("|");
  const next = new RegExp(
    `^[ \\t]*(?:#{1,6}[ \\t]*\\S|${HEAD}(?:\\d+\\.[ \\t]*)?(?:${others})\\b)`,
    "im",
  ).exec(after);
  return (next ? after.slice(0, next.index) : after).trim();
}

/**
 * The reel's narration script (skill §1) — the whole section, verbatim.
 *
 * Deliberately NOT re-wrapped, re-punctuated or length-checked here: the per-block narration is
 * what gets SUBMITTED and `parseBlockDeck` already enforces the band on it. This string is the
 * reel's script of record, shown to the human at the Approve gate.
 */
export const parseScript = (body: string): string => sectionOf(body, "SCRIPT");

/**
 * The music bed's mood, as a CLOSED set of slugs — and the closed-ness is the whole containment.
 *
 * The skill body ASKS for a mood or a genre and forbids naming a track or a tempo, for the same
 * reason it forbids naming a model: a specialist that could name the artefact could pick one
 * nobody priced, nobody licensed and nobody baked. But an instruction is a request. **This set is
 * what makes it structural** — a value outside it does not parse, so `Music: "Bittersweet
 * Symphony"` and `Music: 128bpm` both land as no music at all rather than as a lookup.
 *
 * One slug is one file in the baked library (`<slug>.mp3`). Adding a member here is therefore
 * exactly half a change: the other half is a vouched track and a re-bake, and until both are done
 * the mood parses, prices at $0 and renders WITHOUT a bed — recorded in the assembly sidecar as
 * `"music":"none"`, never silently.
 */
export const MUSIC_MOODS = ["calm", "warm", "upbeat", "cinematic"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

const MUSIC_MOOD_SET = new Set<string>(MUSIC_MOODS);

/**
 * The first mood slug named anywhere in an art-direction `Music:` value, or `undefined`.
 *
 * SCANS rather than matches whole. A model writes `Music — calm, low strings under the voice` far
 * more often than it writes `calm`, and refusing the sentence would cost the bed over a comma. The
 * scan is bounded by `MUSIC_MOOD_SET`, so tolerance here cannot widen what is actually reachable.
 *
 * ponytail: a word scan over a four-member set, not a fuzzy match or a synonym table. The ceiling
 * is that `Music: energetic` yields no bed even though `upbeat` is what it meant; the upgrade path
 * is a synonym map here (NOT in the skill body, which should keep teaching the four slugs).
 */
export const parseMusicMood = (value: string): MusicMood | undefined =>
  value
    .toLowerCase()
    .split(/[^a-z]+/)
    .find((w) => MUSIC_MOOD_SET.has(w)) as MusicMood | undefined;

/** koda's fixed 9-field art direction, plus the optional music bed. `typography` and `music` are
 *  the ONLY optional fields (schema.ts). */
export type ArtDirection = {
  palette: string[];
  mood: string;
  lighting: string;
  composition: string;
  environment: string;
  texture: string;
  typography?: string;
  references: string[];
  avoid: string;
  /** The BED's mood — deliberately not the same field as `mood`, which is the PICTURE's. A reel
   *  can look austere and sound warm, and collapsing the two would make one of them a lie. */
  music?: MusicMood;
};

/** `- **Palette** — 3-5 colours…` → the text after the label. Tolerates `-`/`*` bullets, bold or
 *  bare labels, and either an em-dash or a colon as the separator, because a model will produce
 *  all of them and none of the differences mean anything. See `labelAt`. */
const fieldOf = (section: string, label: string): string => labelValue(label, section);

/** A comma/semicolon/backtick-separated list into trimmed entries. */
const listOf = (s: string): string[] =>
  s
    .split(/[;,]/)
    .map((e) => e.replace(/`/g, "").trim())
    .filter((e) => e !== "");

/**
 * Parse the art-direction block, or `null` when the REQUIRED fields are not all there.
 *
 * `null` rather than a partial object with empty strings: the schema field is a 9-key object and a
 * half-filled one would render as an art direction the specialist never wrote. `typography` is the
 * only field allowed to be absent — it is the only optional key on the schema object.
 *
 * The palette rule ("hex, never a vague colour word") is the SKILL BODY's to teach, not this
 * parser's to enforce. A parser that rejected `warm tones` would turn a soft quality problem into a
 * hard refusal at the Approve gate, and the human reading the proposal is the better judge.
 */
export function parseArtDirection(body: string): ArtDirection | null {
  const section = sectionOf(body, "ART DIRECTION");
  if (section === "") return null;

  const palette = listOf(fieldOf(section, "Palette"));
  const mood = fieldOf(section, "Mood");
  const lighting = fieldOf(section, "Lighting");
  const composition = fieldOf(section, "Composition");
  const environment = fieldOf(section, "Environment");
  const texture = fieldOf(section, "Texture");
  const typography = fieldOf(section, "Typography");
  // OPTIONAL, and never a reason to fail the block. A reel without a bed is the reel we shipped
  // before there were beds at all; a reel refused at the Approve gate over a music slug is a
  // regression. Same posture as `typography`, for the same reason.
  const music = parseMusicMood(fieldOf(section, "Music"));
  const references = listOf(fieldOf(section, "References"));
  // The skill body writes this one as `Do NOT`; `Avoid` is accepted because it is the obvious
  // paraphrase and rejecting it would fail the whole block over a synonym.
  const avoid = fieldOf(section, "Do NOT") || fieldOf(section, "Avoid");

  if (
    palette.length === 0 ||
    references.length === 0 ||
    [mood, lighting, composition, environment, texture, avoid].some((f) => f === "")
  ) {
    return null;
  }
  return {
    palette,
    mood,
    lighting,
    composition,
    environment,
    texture,
    ...(typography === "" ? {} : { typography }),
    references,
    avoid,
    ...(music === undefined ? {} : { music }),
  };
}

export function parseBlockDeck(body: string): ParsedDeck {
  const deckAt = headingAt("BLOCK DECK", body);
  if (!deckAt) return fail("no_deck");

  const afterDeck = body.slice(deckAt.index + deckAt[0].length);
  const promptsAt = headingAt("BLOCK PROMPTS", afterDeck);
  const section = promptsAt ? afterDeck.slice(0, promptsAt.index) : afterDeck;
  const prompts = promptsAt
    ? parsePrompts(afterDeck.slice(promptsAt.index))
    : new Map<number, string>();

  const declared = labelAt("Clip seconds", section, "(\\d+)");
  const clipSeconds = declared ? Number(declared[1]) : Number.NaN;
  if (!CLIP_SECONDS_SET.has(clipSeconds)) return fail("bad_duration");

  const rows = section
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map(cellsOf)
    .filter((c) => !isSeparatorRow(c));
  const header = rows.shift();
  // `unreadable_deck`, NOT `no_deck`: the BLOCK DECK heading matched above, so the deck IS here.
  if (!header) return fail("unreadable_deck");

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
  if (iType < 0 || iDesc < 0 || iNarr < 0) return fail("unreadable_deck");
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SCENE TIMELINE (phase 20.2, wave 1)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything above this line is the UNIFORM BLOCK contract: N blocks, all the same length, one
// narration line per window, total length whatever `blocks × clipSeconds` happens to be. It is
// still the live contract and every caller still reads it; wave 2 moves them and wave 3 deletes it.
//
// What changes, and why each change is forced rather than chosen:
//
//  * A reel now declares its LENGTH (15/30/60 s) and the scenes sum to it EXACTLY. Length was
//    previously an accident of block count — nobody could ask for a 30-second reel.
//  * Scenes have INDIVIDUAL durations, so `mixed_durations` (the refusal that made a deck with
//    disagreeing rows a parse failure) is gone. Its replacement is `duration_mismatch`: the rows
//    must agree with the DECLARED TOTAL, not with each other.
//  * FOUR visual sources, not four shot types, and **all four are renderable**. That is the whole
//    repair: `media.ts`'s `unrenderable_block` refuses any deck containing a `TEXT` or
//    `SCREEN REC` block, and `media-director.md`'s own worked example emits a `SCREEN REC` — so
//    the deck the specialist is taught to write cannot be generated. Here a card is drawn and an
//    upload is supplied, so the only thing left to refuse is an upload with nothing to upload.
//  * The narration FLOOR is DELETED and the ceiling is re-derived. Under the block contract a take
//    was mixed inside its own window, so speech had to FILL `[clip - 1.4, clip]` seconds — hence a
//    31-56 character band at 4 s, which is not a band a person can write in. Under the master
//    audio timeline (wave 4) a take is placed at an absolute offset on ONE track, so silence
//    between lines is free and the only physical limit is that a line must not run into the NEXT
//    line. `narrationCeilingSeconds` is that limit, and it is the ONLY narration rule left.

/** The reel lengths a user may ask for. A closed set because each one is a price and a format
 *  decision, not a free parameter. */
export const TARGET_DURATIONS = [15, 30, 60] as const;
export type TargetDuration = (typeof TARGET_DURATIONS)[number];

/** Where a scene's pixels come from. A CLOSED set, and unlike `SHOT_TYPES` every member is
 *  renderable — see the header note. */
export const VISUAL_KINDS = [
  "generated_video",
  "animated_image",
  "uploaded_video",
  "text_card",
  /** Stock library footage and stills — free, third-party, fetched at job time. Deliberately NOT
   *  folded into `uploaded_video`: that kind means "the tenant already owns these bytes" and
   *  resolves through a `vaultDocuments` row whose OWNERSHIP is checked against the calling tenant
   *  (`renderReel.batchToRender`'s vault branch). Stock bytes belong to neither the tenant nor us,
   *  arrive over the network and land in `_storage` on a `mediaJobs` row like any bought asset.
   *  Widening `uploaded_video` would put "which sort of upload is this" inside the one branch that
   *  guards a model-authored id against naming any document in the deployment. */
  "stock_video",
  "stock_image",
] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

/**
 * The provider's duration grid: xAI's **1-15, any integer** (33.1-04, ADR-027). A
 * `generated_video` scene MUST land on it, and above 15 it is snapped down or refused.
 *
 * **WHAT THIS GRID CHANGED, stated because the old comment claimed the opposite.** Until
 * 2026-08-30 this was sora-2's `[4, 8, 12]`, and the multiple-of-four property was called *"the
 * real reason the other three kinds exist"*: no sum of them is 15 or 30, so a deck of only
 * generated clips could not be built at all. That is **no longer true**. Two 15-second clips make
 * a 30-second reel and price at $2.10, under the $3.50 job cap. The arithmetic no longer forbids
 * anything.
 *
 * So the cheap kinds are now a **COST lever rather than an arithmetic necessity**: a 30-second
 * all-generated reel is $2.10 of pictures against $0.864 for the mixed deck in
 * `media.fixtures.json` — the same thirty seconds for a third of the money. Kind-mixing is kept
 * MANDATORY by `@pikar/cost`'s `MEDIA_GENERATED_SECONDS_CAP` (12 generated seconds per
 * reservation, below `min(TARGET_DURATIONS)`), which is a code-owned ceiling at the money
 * boundary rather than a fact about the provider. See ADR-027's structural-guarantee section: a
 * mitigation in code is not the same thing as an impossibility in arithmetic, and the ADR says so
 * rather than pretending nothing was spent.
 *
 * **THIS CONSTANT MUST STAY IDENTICAL TO `MEDIA_VIDEO_SECONDS[MEDIA_DEFAULT_VIDEO.model]` in
 * `@pikar/cost`.** They are two hand-maintained copies of one provider grid, and they DRIFTED at
 * the last cutover with nothing noticing — `isBuyableClipLength`'s comment in
 * `packages/backend/convex/media.ts` records what that cost. `packages/cost/src/media.test.ts`
 * now asserts the two are equal, which is the only thing that makes "keep them in step"
 * enforceable.
 *
 * ponytail: two copies, one assertion — NOT an inverted package dependency. `@pikar/core`
 * deliberately does not depend on `@pikar/cost` (the dependency runs the other way, because
 * pricing is downstream of the contract), and inverting that to deduplicate fifteen integers
 * would be a much larger change than the drift it prevents.
 */
export const GENERATED_CLIP_SECONDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/** The old closed set, mapped onto the new one, so a deck proposed under the block contract still
 *  READS. Accepted by the parser for one version and taught by the skill body for none:
 *  `AI`/`VIDEO` were both paid video lines, `TEXT` was always meant to be a drawn card, and
 *  `SCREEN REC` was always meant to be a human-supplied recording. */
const LEGACY_VISUAL: Readonly<Record<ShotType, VisualKind>> = {
  AI: "generated_video",
  VIDEO: "generated_video",
  TEXT: "text_card",
  "SCREEN REC": "uploaded_video",
};

export type Scene = {
  index: number;
  /** DERIVED: the running sum of every prior scene's `durationMs`. Never `index * something` —
   *  that arithmetic is what the uniform contract was. */
  startMs: number;
  durationMs: number;
  visual: VisualKind;
  /** `uploaded_video` only, and REQUIRED there: a scene that says "use the user's footage" with no
   *  footage named has nothing to render. Vault-only by decision — it reuses the shipped ingest
   *  path rather than adding a second upload surface. */
  asset?: { source: "vault"; docId: string };
  description: string;
  /** The spoken line, or `""` for a deliberately silent scene. Silence is now legal — see the
   *  header note on the deleted floor. */
  narration: string;
  overlay?: string;
  prompt: string;
  /** Document-level citation (the Phase-14 locked idiom): ONE vault doc per scene, no chunk refs.
   *  Declared by the specialist as a `Source:` line in the scene's SCENE PROMPTS block. */
  source?: { docId: string; title: string };
  /** `Source: unverified` — a factual claim the specialist could not ground in the vault, so the
   *  owner must confirm it before it ships. NOTE deliberately no `confirmedAt` here or anywhere in
   *  parser output: a confirmation is written ONLY by an authenticated tenant mutation later. The
   *  model must have no path to writing one, and this type is the first door. */
  needsConfirmation?: true;
};

/** Which kinds draw money. Same `satisfies Record<...>` table as `PAID`, for the same reason:
 *  adding a member to `VISUAL_KINDS` without deciding whether it costs money is a COMPILE error,
 *  where a `switch` with a `default` would silently inherit another kind's billing. */
const PAID_VISUAL = {
  generated_video: true,
  animated_image: true, // one still generation, then ffmpeg pan/zoom — paid, but ~10x cheaper
  uploaded_video: false, // the tenant already owns the bytes
  text_card: false, // drawtext in the sandbox
  // FREE, and unlike the two above it still buys a `mediaJobs` row: the bytes have to be fetched
  // and landed before the assembler can read them. "Unpaid" and "no provider line" came apart
  // here — see MEDIA_STOCK_PRICING for why $0 is a PRICE and not an absence of one.
  stock_video: false,
  stock_image: false,
} as const satisfies Record<VisualKind, boolean>;

export const isPaidScene = (s: Scene): boolean => PAID_VISUAL[s.visual];

/**
 * Can this scene produce pixels at all? The narrowed replacement for `isPaidBlock`'s use as a
 * renderability proxy (`media.ts:260`).
 *
 * **Unpaid no longer implies unrenderable** — that equivalence held only while the assembler had
 * no `drawtext` and no still path, and it is what made a deck containing a text card impossible to
 * buy. What remains is the honest question: does this row name the thing its picture is built FROM?
 *
 *   * `uploaded_video` — the vault doc. Named, or there is no footage.
 *   * `text_card` — the words. `drawtext` with nothing to draw is a black rectangle that passes
 *     every downstream gate: the file decodes, the duration is right, the sidecar is well-formed.
 *     Only the picture is missing, which is the failure `assemble_final.sh` refuses to ship by
 *     probing for a font rather than trusting one. Same reasoning, one step earlier and for free.
 *   * `generated_video` / `animated_image` — the prompt, which the parser already requires.
 *   * `stock_video` / `stock_image` — the prompt, and here it is checked rather than assumed. A
 *     stock scene's prompt IS its search query, and the parser does NOT guarantee one: `prompt`
 *     falls back to the `Description` cell (`parseSceneDeck`), and that cell is only ever `.trim()`ed
 *     — never required to be non-empty. So a deck with a blank description and no SCENE PROMPTS
 *     entry would reach the fetcher asking a stock library for `""` and pull back whatever its
 *     default ranking returns. That is a picture nobody chose, in a reel someone approved.
 */
// Structurally typed (33-04): the same question is asked of parser `Scene`s at the money gate and
// of stored `plans.shots` rows at the render trigger's re-arm, and the two shapes differ only in
// optionality. One predicate, or the gate and the trigger drift on what "renderable" means.
export const hasAssetSource = (s: {
  visual?: string;
  overlay?: string;
  asset?: unknown;
  prompt?: string;
}): boolean => {
  if (s.visual === "uploaded_video") return s.asset !== undefined;
  if (s.visual === "text_card") return (s.overlay ?? "").trim() !== "";
  if (s.visual === "stock_video" || s.visual === "stock_image") {
    return (s.prompt ?? "").trim() !== "";
  }
  return true;
};

/* ── DOES THIS LINE ASSERT SOMETHING ABOUT THE WORLD? ──────────────────────────────────────────
 *
 * The parser used to treat a scene with no `Source:` line as claiming nothing, which trusted the
 * model to volunteer that it had made a claim. `media-director.md` mandates the line in prose, and
 * a prose mandate is not a guarantee: `dispatch.ts`'s `persistResearchFindings` records the
 * measured version of exactly this — "the prose mandate ... was violated twice in six attempts,
 * which is why this is code and not another sentence in the body."
 *
 * So the default is inverted. Silence now means UNVERIFIED, and the existing confirm gate
 * (`firstUnconfirmedClaim` -> `unconfirmed_claims` -> `confirmClaim`) does the rest unchanged.
 * Nothing new was built downstream; what changed is which scenes reach it.
 *
 * **A NUMERAL ALONE IS NOT A CLAIM.** "You read one screen and decide" is copy; "ninety minutes a
 * day" is an assertion about the world. The difference is whether the number quantifies something
 * MEASURABLE, so a numeral only counts when a unit follows it closely. That single rule is what
 * keeps this off ordinary marketing prose — measured against the two worked examples in
 * `media-director.md`, it flagged 3 of 3 scenes that carry a `Source:` line, missed none, and
 * flagged one that does not: `ONE WEEK A MONTH`, a card restating the sourced figure from the
 * scene before it with no citation of its own. That one is the example being loose, not this
 * predicate being wrong.
 *
 * ponytail: a keyword predicate, not a claim-detection model. The ceiling is real and worth saying
 * plainly — it catches quantities and appeals to evidence, and it will NOT catch an unsourced
 * qualitative assertion ("the fastest way to X"). It is a floor that cannot be argued with, not a
 * proof of groundedness. The upgrade path is a model-side check at proposal time; the thing NOT to
 * do is widen these lists until ordinary copy trips them, because a gate that cries wolf gets
 * confirmed blind and then guards nothing.
 */

/** Numbers, as digits or as words. Kept small deliberately: every addition here is a chance to
 *  flag prose that was never a claim. */
const CLAIM_NUMERAL =
  "\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen";

/** What a number has to be measuring before it counts as a claim. */
const CLAIM_UNIT =
  "second|minute|hour|day|week|month|year|time|percent|dollar|pound|euro|cent|customer|client|user|sale|lead|order|%|x";

/** A quantity ATTACHED to a unit, within a short window so "one screen and decide ... every month"
 *  does not read as a quantity of months. */
const CLAIM_QUANTIFIED = new RegExp(
  `\\b(?:${CLAIM_NUMERAL})\\b[^.!?]{0,24}?\\b(?:${CLAIM_UNIT})s?\\b`,
  "i",
);

/** A bare figure with a symbol on it — "40%", "$2,000" — needs no unit word. */
const CLAIM_SYMBOL = /[%$£€]\s*\d|\d\s*[%$£€]/;

/** An explicit appeal to evidence. "Studies show" with no citation is the purest form of the
 *  failure this exists to catch: it borrows authority it never names. */
const CLAIM_APPEAL =
  /\b(?:studies show|research shows?|according to|survey(?:s|ed)?|report finds?|data shows?|on average|statistics)\b/i;

/**
 * Does this line assert something a reader could check — and therefore something that needs a
 * source before it is burned into a frame?
 *
 * Applied to BOTH the narration and the overlay. An overlay is the most prominent text in a reel:
 * a card reading "90% FASTER" is the strongest claim the video makes, and it is spoken by nobody.
 */
export const statesCheckableClaim = (text: string | undefined): boolean => {
  const t = (text ?? "").trim();
  if (t === "") return false;
  return CLAIM_QUANTIFIED.test(t) || CLAIM_SYMBOL.test(t) || CLAIM_APPEAL.test(t);
};

/** Total SUBMITTED characters across the reel — the tts MediaSpec's input, as `narrationChars` is
 *  for blocks. Silent scenes contribute nothing. */
export const sceneNarrationChars = (scenes: readonly Scene[]): number =>
  scenes.reduce((n, s) => n + s.narration.length, 0);

/**
 * How many seconds scene `i`'s line has to be spoken in: from its own start to the start of the
 * NEXT NARRATED scene, or to the end of the reel if it is the last one.
 *
 * The generalisation of the old per-window ceiling, and the reason a line may now run past its own
 * scene: a take is placed on one master track at an absolute offset, so the only thing it can
 * collide with is the next take. A silent scene therefore lends its whole duration to the line
 * before it, which is what lets a deck cut visually without cutting the sentence.
 */
export function narrationCeilingSeconds(scenes: readonly Scene[], i: number): number {
  const self = scenes[i];
  if (!self) return 0;
  const totalMs = scenes.reduce((n, s) => n + s.durationMs, 0);
  const nextNarrated = scenes.find((s, j) => j > i && s.narration !== "");
  return ((nextNarrated?.startMs ?? totalMs) - self.startMs) / 1000;
}

/**
 * 33-12: one second of a scene's length that the PARSER changed, not the model. `grid` is an
 * off-grid generated clip snapped to a length the provider can actually make; `rebalance` is the
 * scene that took those seconds back so the reel stays exactly as long as the user asked.
 *
 * `narration` is the second repair (`repairNarrationWindows`): seconds traded between two scenes so
 * a spoken line has room to finish before the next one starts. It appears in PAIRS — the scene that
 * grew, then the scene that paid — and the DIRECTION is read off the numbers, never off a separate
 * code, so the two halves can never swap sentences.
 *
 * It exists to be SHOWN. A parser that quietly rewrites the user's reel is the same defect class
 * as a figure whose provenance is invented — the change may be right, but it must not be silent.
 */
export type SceneAdjustment = {
  sceneIndex: number;
  fromSeconds: number;
  toSeconds: number;
  why: "grid" | "rebalance" | "narration";
};

export type ParsedSceneDeck =
  | {
      ok: true;
      targetDurationSeconds: TargetDuration;
      scenes: Scene[];
      /** Empty on a deck the model got right — which is the common case and stays silent. */
      adjustments: readonly SceneAdjustment[];
    }
  | {
      ok: false;
      reason: // HEADING ABSENT, and nothing else. See `unreadable_deck` — these two were one code, and
      // `persistStoryboard` branches on the difference.
        | "no_deck"
        | "unreadable_deck"
        | "empty_deck"
        | "bad_target_duration"
        | "unknown_visual_kind"
        | "no_narration";
    }
  | {
      ok: false;
      reason: "duration_mismatch";
      /** What the rows actually summed to, so the refusal can say the number rather than "wrong". */
      totalSeconds: number;
    }
  | {
      ok: false;
      reason:
        | "bad_scene_duration"
        | "illegal_generated_duration"
        | "missing_asset"
        | "malformed_source";
      sceneIndex: number;
    }
  | {
      ok: false;
      reason: "narration_too_long";
      sceneIndex: number;
      chars: number;
      /** The window the line had, so the refusal can be acted on without re-deriving it. */
      availableSeconds: number;
    };

/**
 * WHY A DECK COULD NOT BE BUILT — one sentence per refusal code, per contract (33-13).
 *
 * These two tables lived in `convex/dispatch.ts`, where the only reader was the memo body it
 * wrote. That is what made a proposal refusal look like a hang: the sentence was buried in prose
 * on a card offering Approve/Save, and the CANVAS — which owns every other failure the user can
 * act on — could not speak them at all, because `apps/web` cannot import a Convex module. They
 * live here, beside the unions they describe, so the memo body and the canvas's failure card read
 * from ONE vocabulary. A second copy in the browser is how one reason ends up saying two things.
 *
 * TWO TABLES, NEVER ONE. The block and scene contracts share only `no_deck` and `empty_deck`, and
 * those two mean a different deck in each — merging the unions is how a reason renders the wrong
 * sentence. The CALLER, which always knows statically which parser refused, passes the contract.
 */
export type DeckContract = "scene" | "block";

export const BLOCK_REFUSAL_WHY: Record<string, string> = {
  no_deck: "it never wrote a block deck",
  // Names the COLUMNS, because that is the only thing this code can mean and the only thing anyone
  // can act on. "It never wrote a deck" was the sentence this case used to borrow, about a deck
  // sitting fully written in the response.
  unreadable_deck:
    "the block deck is there, but its table could not be read — the columns must include " +
    "Type, Description and Narration",
  empty_deck: "the block deck came back empty",
  unknown_shot_type: "one of the blocks used a shot type the renderer does not have",
  bad_duration: "the block length was not one of the generation model's supported durations",
  mixed_durations: "the blocks disagreed about how long they are, and they must all match",
  missing_narration: "a block had no narration line, and every block needs one to be voiced",
  narration_too_long: "a narration line is too long to fit its block without rushing it",
  narration_too_short: "a narration line is too short to fill its block without dead air",
};

export const SCENE_REFUSAL_WHY: Record<string, string> = {
  no_deck: "it never wrote a scene deck",
  unreadable_deck:
    "the scene deck is there, but its table could not be read — the columns must include " +
    "Visual, Seconds, Description and Narration",
  empty_deck: "the scene deck came back empty",
  bad_target_duration: "the reel length was not one of the supported 15, 30 or 60 seconds",
  unknown_visual_kind: "a scene asked for a kind of visual the renderer does not have",
  bad_scene_duration: "a scene did not say how many whole seconds it runs for",
  illegal_generated_duration: "a generated scene asked for a length the video model cannot produce",
  missing_asset: "a scene said to use your own footage but never named which file",
  duration_mismatch: "the scene lengths did not add up to the reel length it declared",
  no_narration: "not one scene had a spoken line, so there would be nothing to voice",
  narration_too_long: "a spoken line is too long to finish before the next line starts",
  // 33-01: a Source line the parser cannot read must never silently become creative copy.
  malformed_source: "a scene cited a source in a form I couldn't read back",
};

/** What an UNKNOWN code says. A code is never prose (33-08's rule): the card prints the code once,
 *  subordinate, and speaks in words above it. */
export const GENERIC_DECK_REFUSAL = "the deck did not parse";

export const deckRefusalClause = (contract: DeckContract, reason: string): string =>
  (contract === "scene" ? SCENE_REFUSAL_WHY : BLOCK_REFUSAL_WHY)[reason] ?? GENERIC_DECK_REFUSAL;

const VISUAL_KIND_SET = new Set<string>(VISUAL_KINDS);
const TARGET_SET = new Set<number>(TARGET_DURATIONS);
const GENERATED_SET = new Set<number>(GENERATED_CLIP_SECONDS);

const sceneFail = (reason: Extract<ParsedSceneDeck, { ok: false }>["reason"]) =>
  ({ ok: false, reason }) as ParsedSceneDeck;

/**
 * `generated_video`, `Generated Video`, `GENERATED-VIDEO`, `AI` → a `VisualKind`, or `null`.
 *
 * Underscores, hyphens and case are all normalised away because a model produces all of them and
 * none of the differences mean anything — the same tolerance `fieldOf` extends to bullet and
 * separator style. What is NOT tolerated is an unknown token: that is a parse failure, never a
 * silent default, because guessing a kind picks a price.
 */
function visualKindOf(cell: string): VisualKind | null {
  const norm = cell.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (VISUAL_KIND_SET.has(norm.replace(/ /g, "_"))) return norm.replace(/ /g, "_") as VisualKind;
  const legacy = norm.toUpperCase();
  return SHOT_TYPE_SET.has(legacy) ? LEGACY_VISUAL[legacy as ShotType] : null;
}

type SceneSource = { docId: string; title: string } | "unverified";

/**
 * Per-scene `Source:` lines from the SCENE PROMPTS blocks (33-01) — same `Scene N` head walk as
 * `parsePrompts`, kept separate so the shared prompts reader stays untouched for the block
 * contract, which has no citations.
 *
 * Three legal forms and NOTHING else: `<title> [doc:<id>]`, `unverified`, or no line at all. A
 * Source line the parser cannot read — an empty `[doc:]` id, or freehand text with no token — is
 * a citation that would otherwise be SILENTLY DROPPED into creative copy, so it refuses instead
 * (`malformed` carries the scene's display number).
 */
function sceneSourcesOf(section: string): {
  sources: Map<number, SceneSource>;
  malformed?: number;
} {
  const sources = new Map<number, SceneSource>();
  let current: number | undefined;
  for (const line of section.split(/\r?\n/)) {
    const head = /^\s*#*\s*(?:Block|Scene)\s+(\d+)\b/i.exec(line);
    if (head) {
      current = Number(head[1]);
      continue;
    }
    const s = labelAt("Source", line);
    if (!s || current === undefined || sources.has(current)) continue;
    const value = (s[1] ?? "").replace(/[*_\s]+$/, "").trim();
    if (/^unverified$/i.test(value)) {
      sources.set(current, "unverified");
      continue;
    }
    const doc = /^(.*?)\s*\[doc:([^\]]*)\]$/.exec(value);
    const docId = (doc?.[2] ?? "").trim();
    if (!doc || docId === "") return { sources, malformed: current };
    sources.set(current, { docId, title: (doc[1] ?? "").replace(/`/g, "").trim() });
  }
  return { sources };
}

/**
 * Parse a SCENE DECK, or refuse.
 *
 * Every refusal RETURNS — nothing throws, exactly as `parseBlockDeck` does, because a governed
 * stop is a value. And every refusal happens BEFORE a cent moves: `duration_mismatch`,
 * `illegal_generated_duration` and `narration_too_long` are all conditions the assembler would
 * hard-error on inside a VM, after the clips have been paid for.
 *
 * ponytail: scene durations are WHOLE SECONDS. 15, 30 and 60 all decompose into integers, an
 * integer column is one `Number.parseInt` instead of a float-sum tolerance, and the exact-sum
 * assert stays exact. Upgrade path if a deck ever needs 2.5 s: parse to milliseconds here and the
 * sum assert already works in ms.
 */
export function parseSceneDeck(body: string): ParsedSceneDeck {
  const deckAt = headingAt("SCENE DECK", body);
  if (!deckAt) return sceneFail("no_deck");

  const afterDeck = body.slice(deckAt.index + deckAt[0].length);
  const promptsAt = headingAt("SCENE PROMPTS", afterDeck);
  const section = promptsAt ? afterDeck.slice(0, promptsAt.index) : afterDeck;
  const prompts = promptsAt
    ? parsePrompts(afterDeck.slice(promptsAt.index))
    : new Map<number, string>();
  const { sources, malformed } = promptsAt
    ? sceneSourcesOf(afterDeck.slice(promptsAt.index))
    : { sources: new Map<number, SceneSource>(), malformed: undefined };
  // Display numbers are 1-based (the `prompts.get(index + 1)` idiom below); refusals speak row index.
  if (malformed !== undefined) {
    return { ok: false, reason: "malformed_source", sceneIndex: malformed - 1 };
  }

  const declared = labelAt("Target duration", section, "(\\d+)");
  const targetDurationSeconds = declared ? Number(declared[1]) : Number.NaN;
  if (!TARGET_SET.has(targetDurationSeconds)) return sceneFail("bad_target_duration");

  const rows = section
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map(cellsOf)
    .filter((c) => !isSeparatorRow(c));
  const header = rows.shift();
  // `unreadable_deck`, NOT `no_deck`: the SCENE DECK heading matched above, so the deck IS here.
  if (!header) return sceneFail("unreadable_deck");

  const col = (...names: string[]) =>
    header.findIndex((h) => names.includes(h.toLowerCase().replace(/[*#]/g, "").trim()));
  const iVisual = col("visual", "type", "kind");
  const iSeconds = col("seconds", "secs", "duration");
  const iDesc = col("description", "desc");
  const iNarr = col("narration", "voiceover", "vo");
  const iOverlay = col("text overlay", "overlay");
  const iAsset = col("asset", "source", "file");
  // `Seconds` is REQUIRED now, where the block contract treated it as an optional cross-check. A
  // scene deck without per-row durations is the uniform contract wearing new column names.
  if (iVisual < 0 || iSeconds < 0 || iDesc < 0 || iNarr < 0) return sceneFail("unreadable_deck");
  if (rows.length === 0) return sceneFail("empty_deck");

  // 33-12: repair off-grid generated clips BEFORE the row loop, because the seconds they give
  // back land on a LATER row and a single forward pass cannot un-write one it already emitted.
  // Returns per-row seconds to use instead of the model's, or null to leave every row as written
  // (in which case the grid check below refuses exactly as it always did).
  const repair = repairGeneratedGrid(rows, iVisual, iSeconds, targetDurationSeconds);
  const adjustments = repair?.adjustments ?? [];

  const scenes: Scene[] = [];
  let startMs = 0;
  for (const [index, cells] of rows.entries()) {
    const visual = visualKindOf(cells[iVisual] ?? "");
    if (visual === null) return sceneFail("unknown_visual_kind");

    const seconds = repair?.seconds[index] ?? Number.parseInt((cells[iSeconds] ?? "").trim(), 10);
    if (!Number.isInteger(seconds) || seconds <= 0) {
      return { ok: false, reason: "bad_scene_duration", sceneIndex: index };
    }
    // The provider grid, checked HERE rather than at submit: a 6-second Sora request is not a
    // shorter clip, it is a refused one, and finding that out at submit means the rest of the deck
    // has already been bought.
    if (visual === "generated_video" && !GENERATED_SET.has(seconds)) {
      return { ok: false, reason: "illegal_generated_duration", sceneIndex: index };
    }

    const assetCell = iAsset >= 0 ? (cells[iAsset] ?? "").replace(/`/g, "").trim() : "";
    if (visual === "uploaded_video" && assetCell === "") {
      return { ok: false, reason: "missing_asset", sceneIndex: index };
    }

    const description = (cells[iDesc] ?? "").trim();
    const narration = (cells[iNarr] ?? "").trim();
    const overlay = iOverlay >= 0 ? (cells[iOverlay] ?? "").trim() : "";
    scenes.push({
      index,
      startMs,
      durationMs: seconds * 1000,
      visual,
      ...(assetCell === "" ? {} : { asset: { source: "vault" as const, docId: assetCell } }),
      description,
      narration,
      ...(overlay === "" ? {} : { overlay }),
      // The deck's `#` column is DISPLAY, 1-based; row order is the reel's order and the truth.
      prompt: prompts.get(index + 1) ?? description,
      ...(() => {
        const src = sources.get(index + 1);
        // NO `Source:` LINE USED TO MEAN "CLAIMS NOTHING". It now means "unverified", and that
        // inversion is the point — see `statesCheckableClaim`. A scene that asserts a figure and
        // simply omits the line is the failure this catches, because nothing downstream could:
        // the money gate reads `needsConfirmation`, and a scene that never set it sails through
        // reservation, render and publish with the figure burned into a frame.
        if (src === undefined) {
          return statesCheckableClaim(narration) || statesCheckableClaim(overlay)
            ? { needsConfirmation: true as const }
            : {};
        }
        return src === "unverified" ? { needsConfirmation: true as const } : { source: src };
      })(),
    });
    startMs += seconds * 1000;
  }

  // THE EXACT-LENGTH RULE. Renormalising a deck that summed to 28 s would submit a duration nobody
  // priced and a reel nobody asked for — the `mixed_durations` reasoning, one contract later.
  const totalSeconds = startMs / 1000;
  if (totalSeconds !== targetDurationSeconds) {
    return { ok: false, reason: "duration_mismatch", totalSeconds };
  }

  // A reel with no narration at all is a silent video. Silence in SOME scenes is the feature; in
  // ALL of them it is a deck that forgot the voiceover, and the tts lines would price zero.
  if (scenes.every((s) => s.narration === "")) return sceneFail("no_narration");

  // SECONDS, NEVER WORDS. Before refusing an overrunning line, try to buy it the time it needs by
  // trading duration between scenes — see `repairNarrationWindows` for why the only legal trade is
  // "lengthen inside the window, shrink outside it". `null` means unchanged, so a deck that already
  // fits keeps the exact scenes and the exact adjustment list the grid pass produced.
  const repaired = repairNarrationWindows(scenes);
  const finalScenes = repaired?.scenes ?? scenes;
  const finalAdjustments = repaired ? [...adjustments, ...repaired.adjustments] : adjustments;

  // The ONE narration rule left: a line must not run into the next line. No floor — see the
  // header note. Still the LAST word: a repair that could not fix every window leaves the deck
  // exactly as it was, and this loop refuses it on the same terms as before.
  for (const [index, scene] of finalScenes.entries()) {
    if (scene.narration === "") continue;
    const availableSeconds = narrationCeilingSeconds(finalScenes, index);
    if (scene.narration.length > availableSeconds * MAX_CHARS_PER_SECOND) {
      return {
        ok: false,
        reason: "narration_too_long",
        sceneIndex: index,
        chars: scene.narration.length,
        availableSeconds,
      };
    }
  }

  return {
    ok: true,
    targetDurationSeconds: targetDurationSeconds as TargetDuration,
    scenes: finalScenes,
    adjustments: finalAdjustments,
  };
}

/**
 * 33-12. Snap off-grid `generated_video` rows to a length the provider can actually make, and give
 * the freed seconds to the last scene that is NOT a generated clip, so the reel stays exactly as
 * long as the user asked for.
 *
 * THE THREE LIMITS, each one a deliberate refusal to be clever:
 *  1. **Grid, never arithmetic.** If the model's own rows do not already sum to the declared
 *     length, this does nothing — `duration_mismatch`/the grid refusal still fires. Repairing a
 *     deck that never added up would be inventing a reel nobody wrote.
 *  2. **Down, never up.** Snapping DOWN frees seconds, and the scene that receives them only gets
 *     LONGER — which cannot break the one narration rule (a line must not run into the next).
 *     Snapping up would have to SHORTEN some other scene, which can.
 *  3. **Into a non-generated scene, or not at all.** Lengthening a generated clip would put it
 *     back off the grid, so a deck of nothing but generated clips is left to refuse.
 *
 * Returns null for "nothing to do, or nothing safe to do" — the caller then behaves exactly as it
 * did before this function existed.
 */
function repairGeneratedGrid(
  rows: string[][],
  iVisual: number,
  iSeconds: number,
  targetDurationSeconds: number,
): { seconds: number[]; adjustments: SceneAdjustment[] } | null {
  const parsed = rows.map((cells) => ({
    visual: visualKindOf(cells[iVisual] ?? ""),
    seconds: Number.parseInt((cells[iSeconds] ?? "").trim(), 10),
  }));
  // Anything malformed is not this function's business — the row loop reports it precisely.
  if (parsed.some((p) => p.visual === null || !Number.isInteger(p.seconds) || p.seconds <= 0)) {
    return null;
  }
  // Limit 1: the model's own arithmetic must already be right.
  if (parsed.reduce((sum, p) => sum + p.seconds, 0) !== targetDurationSeconds) return null;

  const seconds = parsed.map((p) => p.seconds);
  const adjustments: SceneAdjustment[] = [];
  let freed = 0;
  for (const [index, p] of parsed.entries()) {
    if (p.visual !== "generated_video" || GENERATED_SET.has(p.seconds)) continue;
    // Limit 2: the largest legal length at or below what was asked for.
    const legal = GENERATED_CLIP_SECONDS.filter((s) => s < p.seconds).pop();
    if (legal === undefined) return null; // shorter than the shortest clip — snapping up is unsafe
    seconds[index] = legal;
    freed += p.seconds - legal;
    adjustments.push({ sceneIndex: index, fromSeconds: p.seconds, toSeconds: legal, why: "grid" });
  }
  if (freed === 0) return adjustments.length === 0 ? { seconds, adjustments } : null;

  // Limit 3: the LAST non-generated scene takes the seconds back.
  const absorber = parsed
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.visual !== "generated_video");
  const target = absorber[absorber.length - 1];
  if (target === undefined) return null;
  const before = seconds[target.i] as number;
  seconds[target.i] = before + freed;
  adjustments.push({
    sceneIndex: target.i,
    fromSeconds: before,
    toSeconds: before + freed,
    why: "rebalance",
  });
  return { seconds, adjustments };
}

/** The shortest a scene may be left after donating seconds. Nothing else in the contract sets a
 *  floor (`repairGeneratedGrid` only rejects `<= 0`), and a one-second flash is not a scene — it
 *  is a glitch the user never asked for. A repair that would produce one refuses instead. */
export const MIN_DONOR_SECONDS = 2;

/** Re-derive `durationMs`/`startMs` from a seconds array. The scenes are otherwise untouched —
 *  narration, prompt, asset and citation fields ride through by spread. */
const restartScenes = (scenes: readonly Scene[], seconds: readonly number[]): Scene[] => {
  let startMs = 0;
  return scenes.map((s, j) => {
    const durationMs = (seconds[j] as number) * 1000;
    const moved = { ...s, durationMs, startMs };
    startMs += durationMs;
    return moved;
  });
};

/**
 * Give ONE overrunning line the seconds it needs, by moving duration between scenes.
 *
 * THE GEOMETRY, which is not the one the refusal makes it look like. `narration_too_long` names a
 * `sceneIndex`, so the fix reads as local — and it never is. `narrationCeilingSeconds(scenes, i)`
 * is `start(next narrated) - start(i)`, which is exactly **the sum of the durations of the scenes
 * from `i` up to the next narrated one** (or to the end of the reel when `i` speaks last). Call
 * that span the WINDOW.
 *
 * Three consequences, and every one of them is a way the obvious repair does nothing:
 *  * Shrinking a scene BEFORE `i` moves `start(i)` and `start(next narrated)` by the same amount.
 *  * Shrinking a silent scene INSIDE the window is zero-sum — it is already counted.
 *  * Lengthening the offending scene while paying for it from inside the window is both at once.
 *
 * So the ONLY move that widens a window is: **lengthen a scene inside the span, shrink one
 * outside it.** That single rule is uniform across both shapes of the window — when `i` speaks
 * last the span runs to the end of the reel, "outside" can only mean before `i`, and the sum grows
 * exactly the same way.
 *
 * THE LIMITS, each forced rather than chosen:
 *  1. **Seconds, never words.** No narration cell is read except for its LENGTH. Rewriting a line
 *     to fit would put words in the user's mouth — the provenance rule, and the reason this
 *     function moves time instead of text.
 *  2. **A `generated_video` may DONATE but never RECEIVE, and that asymmetry is 33.1's.** The rule
 *     used to be "never, at either end", because resizing a clip put it off the provider's 4/8/12
 *     grid. 33.1 widened `GENERATED_CLIP_SECONDS` to every integer 1..15, so that reason is gone —
 *     and leaving the ban in place cost real decks: a 15-second reel whose clip takes 7 seconds
 *     leaves four scenes sharing 8, every one of them at `MIN_DONOR_SECONDS`, so the donor pool was
 *     empty and the deck refused with `narration_too_long` while five spare seconds sat in the clip.
 *     Shrinking one is safe on both counts that matter: it lands at or above `MIN_DONOR_SECONDS`,
 *     which is inside the grid, and it only ever LOWERS the deck's generated total and its cost.
 *     GROWING one is still refused — that spends money the user has not approved yet and could
 *     breach `MEDIA_GENERATED_SECONDS_CAP`, which this package cannot see.
 *  2b. **A still is preferred as donor over a clip.** Shrinking a still costs the reel nothing;
 *     shrinking a clip takes motion out of it. Only when no still can cover the deficit is a clip
 *     asked, which is why the search runs twice rather than taking the longest scene outright.
 *  3. **The total never moves.** Donor and receiver trade the same whole number of seconds, so
 *     the exact-length rule still holds and the generated clips are still priced at what the user
 *     approved.
 *
 * Returns null for "nothing to do, or nothing safe to do" — the caller then refuses exactly as it
 * did before this function existed. Every second it moves is reported as a `SceneAdjustment`,
 * because a parser that quietly rewrites the user's reel is the defect class this repo bans.
 */
function widenNarrationWindow(
  scenes: readonly Scene[],
  i: number,
): { scenes: Scene[]; adjustments: SceneAdjustment[] } | null {
  const self = scenes[i];
  if (!self) return null;
  const deficit =
    Math.ceil(self.narration.length / MAX_CHARS_PER_SECOND) - narrationCeilingSeconds(scenes, i);
  if (deficit <= 0) return null;

  // The span whose durations SUM to the window. `-1` (nothing narrated after `i`) means it runs to
  // the end of the reel, and "outside" then means "before `i`" — see the note above.
  const next = scenes.findIndex((s, j) => j > i && s.narration !== "");
  const spanEnd = next === -1 ? scenes.length : next;
  const inSpan = (j: number) => j >= i && j < spanEnd;

  // A clip may not GROW — see limit 2. Growing one spends money the user has not approved and
  // could push the deck past the generated-seconds cap, which lives in `@pikar/cost` and is not
  // visible from here. A still or a card growing is free.
  const receiver = scenes.findIndex((s, j) => inSpan(j) && s.visual !== "generated_video");
  if (receiver === -1) return null; // a span of nothing but generated clips cannot grow

  // The donor with the most to give, so one trade covers as much as any single trade can. Stills
  // first, clips only if no still can cover the deficit (limit 2b).
  const bestDonor = (wantClip: boolean): number => {
    let at = -1;
    let most = 0;
    for (const [j, s] of scenes.entries()) {
      if (inSpan(j) || (s.visual === "generated_video") !== wantClip) continue;
      // MIN_DONOR_SECONDS is also what keeps a shrunk clip on the 1..15 grid: the floor is 2.
      const slack = s.durationMs / 1000 - MIN_DONOR_SECONDS;
      if (slack >= deficit && slack > most) {
        at = j;
        most = slack;
      }
    }
    return at;
  };
  let donor = bestDonor(false);
  if (donor === -1) donor = bestDonor(true);
  if (donor === -1) return null;

  const seconds = scenes.map((s) => s.durationMs / 1000);
  const wasReceiver = seconds[receiver] as number;
  const wasDonor = seconds[donor] as number;
  seconds[receiver] = wasReceiver + deficit;
  seconds[donor] = wasDonor - deficit;
  return {
    scenes: restartScenes(scenes, seconds),
    adjustments: [
      {
        sceneIndex: receiver,
        fromSeconds: wasReceiver,
        toSeconds: wasReceiver + deficit,
        why: "narration",
      },
      { sceneIndex: donor, fromSeconds: wasDonor, toSeconds: wasDonor - deficit, why: "narration" },
    ],
  };
}

/**
 * Run `widenNarrationWindow` until every line fits, or until one cannot be fixed.
 *
 * Bounded by the scene count rather than looped to a fixed point: a trade that widens one window
 * necessarily narrows something elsewhere, so an unbounded loop could ping-pong between two lines
 * forever. One pass per scene is more than any deck needs, and running out is treated as "not
 * safely repairable" — the deck refuses, which is where it started.
 *
 * `null` means UNCHANGED (nothing needed fixing, or nothing could be), so the caller keeps the
 * scenes it built. That is what leaves a deck the model got right byte-for-byte untouched.
 */
function repairNarrationWindows(
  scenes: readonly Scene[],
): { scenes: Scene[]; adjustments: SceneAdjustment[] } | null {
  let current = [...scenes];
  const adjustments: SceneAdjustment[] = [];
  for (let pass = 0; pass < scenes.length; pass++) {
    const offender = current.findIndex(
      (s, j) =>
        s.narration !== "" &&
        s.narration.length > narrationCeilingSeconds(current, j) * MAX_CHARS_PER_SECOND,
    );
    if (offender === -1) {
      return adjustments.length === 0 ? null : { scenes: current, adjustments };
    }
    const traded = widenNarrationWindow(current, offender);
    if (traded === null) return null;
    current = traded.scenes;
    adjustments.push(...traded.adjustments);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PHASE-33 PARSE SURFACES (33-01)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The guided-intake brief, as the specialist echoed it back. `defaulted` names the fields the
 *  specialist filled from the business profile rather than from the user's own words — the canvas
 *  badges those chips, and the copy never carries the marker itself. */
export type BriefFields = {
  topic: string;
  durationSeconds: TargetDuration;
  audience?: string;
  tone?: string;
  brandVoice?: string;
  /** Field NAMES ("audience" | "tone" | "brandVoice" | "duration"), in the order they appear. */
  defaulted: string[];
};

/**
 * Parse the BRIEF section, or `null` — the `parseArtDirection` precedent, NOT a refusal: a missing
 * brief is a worse UX, not an unusable proposal, because the deck still carries its own validated
 * `targetDurationSeconds`. All free at parse time; nothing here touches money.
 *
 * `null` when the section is absent, when `Topic:` is empty, or when `Duration:` is off the
 * 15/30/60 preset grid — presets only, per the locked decision; a free-entry duration is a price
 * nobody computed. A `(defaulted)` suffix (case-insensitive) is stripped from the value and the
 * FIELD NAME is recorded instead, so "(defaulted)" can never leak into a chip as copy.
 */
export function parseBrief(body: string): BriefFields | null {
  const section = sectionOf(body, "BRIEF");
  if (section === "") return null;

  const defaulted: string[] = [];
  const read = (label: string, name: string): string => {
    const raw = fieldOf(section, label);
    const marked = /^(.*?)\s*\(defaulted\)$/i.exec(raw);
    if (!marked) return raw;
    defaulted.push(name);
    return (marked[1] ?? "").trim();
  };

  // Topic is the user's own ask — there is nothing to default it FROM, so no marker handling.
  const topic = fieldOf(section, "Topic");
  // `30s` and `30` both parse; `parseInt` stops at the `s`. Anything off the preset grid is null.
  const durationSeconds = Number.parseInt(read("Duration", "duration"), 10);
  if (topic === "" || !TARGET_SET.has(durationSeconds)) return null;

  const audience = read("Audience", "audience");
  const tone = read("Tone", "tone");
  const brandVoice = read("Brand voice", "brandVoice");
  return {
    topic,
    durationSeconds: durationSeconds as TargetDuration,
    ...(audience === "" ? {} : { audience }),
    ...(tone === "" ? {} : { tone }),
    ...(brandVoice === "" ? {} : { brandVoice }),
    defaulted,
  };
}

/** One variation: its parsed deck, plus its OWN body slice so a caller can run
 *  `parseScript`/`parseArtDirection`/`parsePrompts` per-variation without cross-contamination. */
export type VariationSlice = {
  deck: Extract<ParsedSceneDeck, { ok: true }>;
  body: string;
};

export type ParsedVariations =
  | { kind: "two"; a: VariationSlice; b: VariationSlice }
  /** No VARIATION headings — the caller falls through to the existing single-deck path. */
  | { kind: "one" }
  /**
   * 33-11: exactly ONE of the two decks parsed. The survivor is proposed ALONE, and the caller
   * MUST say which sibling was lost and why — `salvaged` is not a quiet `two`.
   *
   * This narrows 33-01/33-03's "a refusing variation refuses the WHOLE proposal", and only that
   * far. The rule that rationale actually protects — **never propose a deck nobody wrote** — is
   * untouched: `kept` is the model's own deck, whole and unedited.
   */
  | {
      kind: "salvaged";
      kept: VariationSlice;
      keptVariation: "a" | "b";
      lostVariation: "a" | "b";
      reason: Extract<ParsedSceneDeck, { ok: false }>["reason"];
    }
  | {
      kind: "refused";
      variation: "a" | "b";
      reason: Extract<ParsedSceneDeck, { ok: false }>["reason"];
    };

const variationHeading = (letter: "A" | "B", body: string) =>
  headingAt(`VARIATION ${letter}`, body);

/**
 * Split a two-variation body at its VARIATION A / VARIATION B headings and run the EXISTING
 * `parseSceneDeck` on each slice, unchanged — a thin splitter, no duplicate scene parsing.
 *
 * The one rule that matters: a variation slice whose deck refuses FOR ANY REASON — including
 * `no_deck` inside a declared variation, or one heading written without its sibling — refuses the
 * WHOLE proposal. Never a silent fallback to a single deck: the persistStoryboard rule again, a
 * deck nobody wrote must never be proposed.
 */
export function parseVariations(body: string): ParsedVariations {
  const aAt = variationHeading("A", body);
  const bAt = variationHeading("B", body);
  if (!aAt && !bAt) return { kind: "one" };
  if (!aAt) return { kind: "refused", variation: "a", reason: "no_deck" };
  if (!bAt) return { kind: "refused", variation: "b", reason: "no_deck" };

  // Order-agnostic slices: each runs from the end of its heading to the other heading or EOF.
  const marks = [
    { v: "a" as const, m: aAt },
    { v: "b" as const, m: bAt },
  ].sort((x, y) => x.m.index - y.m.index);
  const first = marks[0] as (typeof marks)[number];
  const second = marks[1] as (typeof marks)[number];
  const slices = {
    [first.v]: body.slice(first.m.index + first.m[0].length, second.m.index),
    [second.v]: body.slice(second.m.index + second.m[0].length),
  } as Record<"a" | "b", string>;

  // Parse BOTH before deciding: the outcome depends on how many survived, so an early return on
  // the first refusal cannot tell "one bad deck" from "two bad decks".
  const parsed = (["a", "b"] as const).map((v) => ({ v, deck: parseSceneDeck(slices[v]) }));
  const good = parsed.filter((p) => p.deck.ok);
  const bad = parsed.filter((p) => !p.deck.ok);

  if (bad.length === 0) {
    const [a, b] = parsed;
    // Non-null: `parsed` is built from a two-element literal and every deck is `ok` here.
    return {
      kind: "two",
      a: { deck: a?.deck as ParsedSceneDeck & { ok: true }, body: slices.a },
      b: { deck: b?.deck as ParsedSceneDeck & { ok: true }, body: slices.b },
    };
  }

  // Both refused: the old contract, unchanged. Report the FIRST failure so the sentence names a
  // deck the model really wrote rather than whichever happened to be scanned last.
  const firstBad = bad[0] as (typeof bad)[number];
  const firstBadReason = (firstBad.deck as Extract<ParsedSceneDeck, { ok: false }>).reason;
  if (good.length === 0) {
    return { kind: "refused", variation: firstBad.v, reason: firstBadReason };
  }

  // Exactly one survived. Propose it alone and hand the caller what it must disclose.
  const keeper = good[0] as (typeof good)[number];
  return {
    kind: "salvaged",
    kept: { deck: keeper.deck as ParsedSceneDeck & { ok: true }, body: slices[keeper.v] },
    keptVariation: keeper.v,
    lostVariation: firstBad.v,
    reason: firstBadReason,
  };
}
