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
    const p = /^\s*[*-]?\s*(?:\*\*)?Prompt(?:\*\*)?\s*:\s*(.+)$/i.exec(line);
    if (p && current !== undefined && !out.has(current)) out.set(current, (p[1] ?? "").trim());
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

function sectionOf(body: string, heading: string): string {
  const at = new RegExp(`^[ \\t]*#*[ \\t]*(?:\\d+\\.[ \\t]*)?${heading}\\b.*$`, "im").exec(body);
  if (!at) return "";
  const after = body.slice(at.index + at[0].length);
  const others = SECTION_TOKENS.filter((t) => t !== heading).join("|");
  const next = new RegExp(
    `^[ \\t]*(?:#{1,6}[ \\t]*\\S|#*[ \\t]*(?:\\d+\\.[ \\t]*)?(?:${others})\\b)`,
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

/** koda's fixed 9-field art direction. `typography` is the ONE optional field (schema.ts). */
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
};

/** `- **Palette** — 3-5 colours…` → the text after the label. Tolerates `-`/`*` bullets, bold or
 *  bare labels, and either an em-dash or a colon as the separator, because a model will produce
 *  all of them and none of the differences mean anything. */
function fieldOf(section: string, label: string): string {
  const re = new RegExp(
    `^[ \\t]*[*-]?[ \\t]*(?:\\*\\*)?${label}(?:\\*\\*)?[ \\t]*(?:[—:-])[ \\t]*(.+)$`,
    "im",
  );
  return (re.exec(section)?.[1] ?? "").trim();
}

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
  };
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
] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

/** The provider's duration grid. Sora returns 4, 8 or 12 second clips and nothing between, so a
 *  `generated_video` scene MUST land on it. **This is the real reason the other three kinds
 *  exist**: they are frame-exact at any length, and every member of this grid is a multiple of 4,
 *  so a deck of ONLY generated clips cannot sum to 15 or 30 at all (and a 60 costs $6.00, over the
 *  job cap). It is also a 40x cost lever — measured at wave 7: a 4 s generated clip is $0.40 and a
 *  still is $0.01 at ANY length — so a deck that reaches for a still first is cheaper AND more
 *  flexible. See ADR-019. */
export const GENERATED_CLIP_SECONDS = [4, 8, 12] as const;

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
 */
// Structurally typed (33-04): the same question is asked of parser `Scene`s at the money gate and
// of stored `plans.shots` rows at the render trigger's re-arm, and the two shapes differ only in
// optionality. One predicate, or the gate and the trigger drift on what "renderable" means.
export const hasAssetSource = (s: {
  visual?: string;
  overlay?: string;
  asset?: unknown;
}): boolean => {
  if (s.visual === "uploaded_video") return s.asset !== undefined;
  if (s.visual === "text_card") return (s.overlay ?? "").trim() !== "";
  return true;
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

export type ParsedSceneDeck =
  | {
      ok: true;
      targetDurationSeconds: TargetDuration;
      scenes: Scene[];
    }
  | {
      ok: false;
      reason:
        | "no_deck"
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
    const s = /^\s*[*-]?\s*(?:\*\*)?Source(?:\*\*)?\s*:\s*(.+)$/i.exec(line);
    if (!s || current === undefined || sources.has(current)) continue;
    const value = (s[1] ?? "").trim();
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
  const deckAt = /^[ \t]*#*[ \t]*SCENE DECK\b.*$/im.exec(body);
  if (!deckAt) return sceneFail("no_deck");

  const afterDeck = body.slice(deckAt.index + deckAt[0].length);
  const promptsAt = /^[ \t]*#*[ \t]*SCENE PROMPTS\b.*$/im.exec(afterDeck);
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

  const declared = /^[ \t]*(?:\*\*)?Target duration(?:\*\*)?[ \t]*:[ \t]*(\d+)/im.exec(section);
  const targetDurationSeconds = declared ? Number(declared[1]) : Number.NaN;
  if (!TARGET_SET.has(targetDurationSeconds)) return sceneFail("bad_target_duration");

  const rows = section
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map(cellsOf)
    .filter((c) => !isSeparatorRow(c));
  const header = rows.shift();
  if (!header) return sceneFail("no_deck");

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
  if (iVisual < 0 || iSeconds < 0 || iDesc < 0 || iNarr < 0) return sceneFail("no_deck");
  if (rows.length === 0) return sceneFail("empty_deck");

  const scenes: Scene[] = [];
  let startMs = 0;
  for (const [index, cells] of rows.entries()) {
    const visual = visualKindOf(cells[iVisual] ?? "");
    if (visual === null) return sceneFail("unknown_visual_kind");

    const seconds = Number.parseInt((cells[iSeconds] ?? "").trim(), 10);
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
        if (src === undefined) return {};
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

  // The ONE narration rule left: a line must not run into the next line. No floor — see the
  // header note.
  for (const [index, scene] of scenes.entries()) {
    if (scene.narration === "") continue;
    const availableSeconds = narrationCeilingSeconds(scenes, index);
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

  return { ok: true, targetDurationSeconds: targetDurationSeconds as TargetDuration, scenes };
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
  new RegExp(`^[ \\t]*#*[ \\t]*(?:\\d+\\.[ \\t]*)?VARIATION ${letter}\\b.*$`, "im").exec(body);

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
