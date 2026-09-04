// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Scene } from "./storyboard";
import {
  CLIP_SECONDS,
  DEFAULT_CLIP_SECONDS,
  deckRefusalClause,
  GENERATED_CLIP_SECONDS,
  GENERIC_DECK_REFUSAL,
  hasAssetSource,
  isPaidBlock,
  isPaidScene,
  MAX_CHARS_PER_BLOCK,
  MAX_CHARS_PER_SECOND,
  MUSIC_MOODS,
  maxCharsFor,
  minCharsFor,
  narrationCeilingSeconds,
  narrationChars,
  narrationOverrunsReel,
  parseArtDirection,
  parseBlockDeck,
  parseBrief,
  parseMusicMood,
  parseSceneDeck,
  parseScript,
  parseVariations,
  SHOT_TYPES,
  sceneNarrationChars,
  statesCheckableClaim,
  TARGET_DURATIONS,
  VISUAL_KINDS,
} from "./storyboard";

/** A well-formed deck, built from parts so each test can corrupt exactly one thing. */
const deck = (rows: readonly string[], header = "Clip seconds: 10") =>
  [
    "Some preamble the specialist wrote.",
    "",
    "BLOCK DECK",
    header,
    "",
    "| # | Type | Description | Narration | Text overlay |",
    "|---|------|-------------|-----------|--------------|",
    ...rows,
    "",
  ].join("\n");

// Narration lines are REALISTIC lengths on purpose: a 10-second window admits 103–140 characters,
// and the pithy ~45-character lines these fixtures used to carry would hard-fail the render.
// A fixture that could not survive the assembler is a fixture that teaches the wrong thing.
const LINE =
  "The window is fixed, so the line has to fit it — that is the whole discipline, and it is not negotiable here.";

const THREE = [
  "| 1 | VIDEO | Founder at a desk, morning light | Most teams lose a full hour every day to inbox triage, and not one of them ever decided to spend it that way. | LOSE AN HOUR |",
  "| 2 | AI | Abstract mail icons collapsing into one card | Pikar reads the whole thread once, drafts the reply in your voice, and hands it back before your coffee is cold. | |",
  "| 3 | SCREEN REC | The cockpit approving a draft | You approve it or you change it. Nothing leaves your account until you say so, and every send is written down. | |",
] as const;

/** A 5-second window admits 43–70 characters — a different band, so different copy. */
const SHORT = "Nothing sends without you, and every send is logged.";
const FIVE_SEC_ROWS = [
  `| 1 | VIDEO | Founder at a desk | ${SHORT} | |`,
  `| 2 | AI | Mail icons collapsing | ${SHORT} | |`,
  `| 3 | SCREEN REC | Approving a draft | ${SHORT} | |`,
];

describe("parseBlockDeck — the happy path", () => {
  const r = parseBlockDeck(deck(THREE));

  it("parses N blocks in row order", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocks).toHaveLength(3);
    expect(r.blocks.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(r.blocks.map((b) => b.type)).toEqual(["VIDEO", "AI", "SCREEN REC"]);
  });

  it("blocks are FIXED-LENGTH and uniform — every seconds === deck clipSeconds", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.clipSeconds).toBe(10);
    expect(r.blocks.every((b) => b.seconds === 10)).toBe(true);
  });

  it("windowStartMs is DERIVED (index * clipSeconds * 1000), starting at 0", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.blocks.map((b) => b.windowStartMs)).toEqual([0, 10_000, 20_000]);
  });

  it("carries description, narration and an optional overlay", () => {
    if (!r.ok) throw new Error("expected ok");
    const [first, second] = r.blocks;
    expect(first?.description).toContain("Founder at a desk");
    expect(first?.narration).toContain("inbox triage");
    expect(first?.overlay).toBe("LOSE AN HOUR");
    expect(second?.overlay).toBeUndefined();
  });

  it("accepts a 5-second deck — with lines written to the SHORTER window", () => {
    // A 5s window admits 43–70 characters. The 10-second deck's lines above would overrun it,
    // which is the point: the band travels with the block length.
    const five = parseBlockDeck(deck(FIVE_SEC_ROWS, "Clip seconds: 5"));
    expect(five.ok).toBe(true);
    if (!five.ok) return;
    expect(five.clipSeconds).toBe(5);
    expect(five.blocks.map((b) => b.windowStartMs)).toEqual([0, 5_000, 10_000]);
  });
});

describe("parseBlockDeck — the pre-payment narration guard (delta pitfall 13)", () => {
  it(`a narration over ${MAX_CHARS_PER_BLOCK} chars is refused WITH its index and count`, () => {
    const long = "x".repeat(186);
    const r = parseBlockDeck(deck([THREE[0], `| 2 | AI | A shot | ${long} | |`, THREE[2]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("narration_too_long");
    if (r.reason !== "narration_too_long") return;
    expect(r.blockIndex).toBe(1); // 0-based — the SECOND row
    expect(r.chars).toBe(186);
  });

  it(`exactly ${MAX_CHARS_PER_BLOCK} chars is allowed — the ceiling is inclusive`, () => {
    const at = "x".repeat(MAX_CHARS_PER_BLOCK);
    const r = parseBlockDeck(deck([`| 1 | AI | A shot | ${at} | |`]));
    expect(r.ok).toBe(true);
  });

  it("the ceiling SCALES with the deck's clip length — 140 at 10s, 70 at 5s", () => {
    // The 5-second case is the hole a flat 140 left: assemble_final.sh hard-errors when a take's
    // speech exceeds its window, and a 5s window holds ~75 characters. A 120-char line used to
    // clear this guard and fail the render AFTER the clips were paid for.
    expect(maxCharsFor(10)).toBe(MAX_CHARS_PER_BLOCK);
    expect(maxCharsFor(5)).toBe(70);

    const long = "x".repeat(120);
    const row = `| 1 | AI | A shot | ${long} | |`;
    expect(parseBlockDeck(deck([row], "Clip seconds: 10")).ok).toBe(true); // fine in a 10s window
    const five = parseBlockDeck(deck([row], "Clip seconds: 5"));
    expect(five.ok).toBe(false); // the SAME line in a 5s window is refused
    if (five.ok || five.reason !== "narration_too_long") throw new Error("expected too_long");
    expect(five.chars).toBe(120);
  });

  it("a line too SHORT to fill its window is refused too — the other half of the same guard", () => {
    // assemble_final.sh hard-errors on a take under `clipSeconds - 1.4` seconds just as loudly as
    // on one that overruns, and both land AFTER the clips are paid for. A pithy 46-character line
    // in a 10-second block is ~4s of speech.
    expect(minCharsFor(10)).toBe(103);
    expect(minCharsFor(5)).toBe(43);

    const pithy = "Most teams lose an hour a day to inbox triage."; // 46 — reads fine, renders never
    const r = parseBlockDeck(deck([THREE[0], `| 2 | AI | A shot | ${pithy} | |`]));
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== "narration_too_short") throw new Error("expected too_short");
    expect(r.blockIndex).toBe(1);
    expect(r.chars).toBe(46);
  });

  it("the floor travels with the block length — the SAME line passes at 5s and fails at 10s", () => {
    const row = `| 1 | AI | A shot | ${SHORT} | |`;
    expect(parseBlockDeck(deck([row], "Clip seconds: 5")).ok).toBe(true);
    const ten = parseBlockDeck(deck([row], "Clip seconds: 10"));
    expect(ten.ok).toBe(false);
    if (!ten.ok) expect(ten.reason).toBe("narration_too_short");
  });

  it("a block with no narration is missing_narration, not an empty string", () => {
    const r = parseBlockDeck(deck([THREE[0], "| 2 | AI | A shot | | |"]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_narration");
  });
});

describe("parseBlockDeck — discriminated refusals, never a throw", () => {
  it("no deck section → no_deck", () => {
    const r = parseBlockDeck("The specialist wrote prose and forgot the table.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_deck");
  });

  it("a header with no rows → empty_deck, not an empty success", () => {
    const r = parseBlockDeck(deck([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_deck");
  });

  it("an unknown shot type → unknown_shot_type, never a silent default", () => {
    const r = parseBlockDeck(deck([`| 1 | B-ROLL | A shot | ${LINE} | |`]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_shot_type");
  });

  it("a missing `Clip seconds:` declaration → bad_duration", () => {
    const r = parseBlockDeck(deck(THREE, ""));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_duration");
  });

  it("a clip length outside {5,10} → bad_duration (Wan 2.5 accepts nothing else)", () => {
    for (const n of [3, 7, 15, 0]) {
      const r = parseBlockDeck(deck(THREE, `Clip seconds: ${n}`));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad_duration");
    }
  });

  it("a per-row duration that disagrees with the deck → mixed_durations, NOT renormalised", () => {
    const body = [
      "BLOCK DECK",
      "Clip seconds: 10",
      "| # | Type | Description | Narration | Seconds |",
      "|---|------|-------------|-----------|---------|",
      `| 1 | VIDEO | A shot | ${LINE} | 10 |`,
      `| 2 | AI | Another shot | ${LINE} | 5 |`,
    ].join("\n");
    const r = parseBlockDeck(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("mixed_durations");
  });

  it("a table missing a required column → unreadable_deck (the heading IS here)", () => {
    const body = [
      "BLOCK DECK",
      "Clip seconds: 10",
      "| # | Type | Description |",
      "|---|------|-------------|",
      "| 1 | VIDEO | A shot |",
    ].join("\n");
    const r = parseBlockDeck(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreadable_deck");
  });

  it("garbage never throws", () => {
    for (const junk of ["", "|||", "BLOCK DECK", "BLOCK DECK\n|a|b|\n", " "]) {
      expect(() => parseBlockDeck(junk)).not.toThrow();
    }
  });
});

describe("parseBlockDeck — the per-block generation prompt", () => {
  const body = `${deck(THREE)}
BLOCK PROMPTS

Block 1
Prompt: Wide editorial shot, 35mm, warm golden light from camera left at 45 degrees, photograph, ultra realistic.
Negative prompt: text, watermark
Settings: 9:16, 1080x1920

Block 2
Prompt: Abstract 3D mail glyphs converging, studio lighting, shallow depth of field.
`;

  it("takes the Prompt: line from BLOCK PROMPTS, matched by block number", () => {
    const r = parseBlockDeck(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [first, second] = r.blocks;
    expect(first?.prompt).toContain("35mm");
    expect(second?.prompt).toContain("mail glyphs");
  });

  it("falls back to the description when a block has no written prompt", () => {
    const r = parseBlockDeck(body);
    if (!r.ok) throw new Error("expected ok");
    const third = r.blocks[2];
    expect(third?.prompt).toBeTruthy(); // not vacuously equal-because-both-undefined
    expect(third?.prompt).toBe(third?.description);
  });
});

describe("isPaidBlock — the ONE place clip money is decided", () => {
  const r = parseBlockDeck(
    deck([
      `| 1 | AI | a | ${LINE} | |`,
      `| 2 | VIDEO | b | ${LINE} | |`,
      `| 3 | SCREEN REC | c | ${LINE} | |`,
      `| 4 | TEXT | d | ${LINE} | |`,
    ]),
  );

  it("covers every member of SHOT_TYPES — AI and VIDEO cost, SCREEN REC and TEXT do not", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.blocks.map(isPaidBlock)).toEqual([true, true, false, false]);
    // the deck above must exercise the whole closed set, or this test rots silently
    expect(new Set(r.blocks.map((b) => b.type))).toEqual(new Set(SHOT_TYPES));
  });
});

describe("narrationChars", () => {
  it("sums the submitted characters across the deck — the tts MediaSpec's input", () => {
    const r = parseBlockDeck(deck(THREE));
    if (!r.ok) throw new Error("expected ok");
    expect(narrationChars(r.blocks)).toBe(r.blocks.reduce((n, b) => n + b.narration.length, 0));
  });
  it("empty deck → 0", () => expect(narrationChars([])).toBe(0));
});

describe("the constants themselves", () => {
  it("DEFAULT_CLIP_SECONDS is a member of CLIP_SECONDS", () => {
    expect(CLIP_SECONDS).toContain(DEFAULT_CLIP_SECONDS);
  });
});

// ── The round trip: the SKILL BODY's own worked example must parse ───────────────────────────
//
// The body owns the output format and this parser owns the input format. Nothing else pins them
// together, and the failure mode is silent: a drifted table produces an EMPTY deck, which reads to
// the user as "the specialist proposed nothing" rather than as a bug.
//
// The .md is read off DISK by relative path rather than imported: @pikar/core does not depend on
// @pikar/contracts and must not start to (specialists.test.ts reads contracts/src/skill.ts the
// same way, for the same reason).
describe("media-director.md round trip — the body's worked answer survives its own rules", () => {
  const body = readFileSync(
    fileURLToPath(new URL("../../contracts/skills/media-director.md", import.meta.url)),
    "utf8",
  );
  // 33-09: the body now answers with a BRIEF and TWO variations, so the round trip reads it the way
  // `persistStoryboard` does — `parseVariations` first, then each slice on its own — and every
  // per-deck rule below runs against BOTH decks. Variation B going unchecked would be the same hole
  // one level up: a worked example that violates its own rule is how a model learns the rule is
  // optional.
  const v = parseVariations(body);
  /** Both variation slices, or a loud failure. Never an empty array — a `for` over one of those
   *  passes every assertion in this file while the body carries no deck at all. */
  const both = () => {
    expect(v.kind, `the body's variations did not parse: ${JSON.stringify(v)}`).toBe("two");
    if (v.kind !== "two") throw new Error("expected two variations");
    return [v.a, v.b];
  };
  const decks = () => both().map((s) => s.deck);

  // The BRIEF sits ABOVE the variation headings, so it belongs to neither slice and the terminal
  // parses it off the whole turn. Here it is read off the worked ANSWER, because the file's own
  // `## 1. BRIEF` is an instruction section — its field labels are backticked precisely so they
  // cannot be mistaken for a filled-in brief.
  const WORKED = "## A worked answer";
  const workedAt = body.indexOf(WORKED);
  const brief = parseBrief(body.slice(Math.max(workedAt, 0)));

  it(`carries a worked answer ("${WORKED}") with a BRIEF and exactly TWO variations`, () => {
    expect(workedAt, "the worked answer heading was renamed or removed").toBeGreaterThan(0);
    expect(v.kind).toBe("two");
    expect(brief, "the worked answer's BRIEF did not parse").not.toBeNull();
  });

  it("the brief echoes the ask and MARKS what it defaulted, never leaking the marker as copy", () => {
    expect(brief?.topic).toBeTruthy();
    expect(TARGET_DURATIONS).toContain(brief?.durationSeconds);
    // At least one defaulted field, or the example teaches the marker by never showing it.
    expect(brief?.defaulted.length ?? 0).toBeGreaterThanOrEqual(1);
    for (const value of [brief?.topic, brief?.audience, brief?.tone, brief?.brandVoice]) {
      expect(value ?? "", "(defaulted) must be stripped from the value").not.toMatch(/defaulted/i);
    }
  });

  it("BOTH decks run the brief's duration — two lengths would be two different asks", () => {
    for (const r of decks()) expect(r.targetDurationSeconds).toBe(brief?.durationSeconds);
  });

  it("each deck parses to at least 3 scenes, in index order", () => {
    for (const r of decks()) {
      expect(r.scenes.length).toBeGreaterThanOrEqual(3);
      expect(r.scenes.map((s) => s.index)).toEqual(r.scenes.map((_, i) => i));
    }
  });

  it("every visual is a member of the closed VISUAL_KINDS set", () => {
    for (const r of decks()) for (const s of r.scenes) expect(VISUAL_KINDS).toContain(s.visual);
  });

  it("the declared target is legal and the scenes sum to it EXACTLY", () => {
    for (const r of decks()) {
      expect(TARGET_DURATIONS).toContain(r.targetDurationSeconds);
      const summed = r.scenes.reduce((n, s) => n + s.durationMs, 0) / 1000;
      expect(summed).toBe(r.targetDurationSeconds);
    }
  });

  it("every generated_video scene lands on the provider's grid", () => {
    for (const r of decks()) {
      for (const s of r.scenes) {
        if (s.visual !== "generated_video") continue;
        expect(GENERATED_CLIP_SECONDS, `scene ${s.index}`).toContain(s.durationMs / 1000);
      }
    }
  });

  it("no deck is all-generated, and at least one SPENDS a clip", () => {
    // Not a style note — but the REASON changed on 2026-08-30 and the old one was arithmetic.
    // It used to be that every member of GENERATED_CLIP_SECONDS was a multiple of 4, so an
    // all-generated deck could not sum to 15 or 30 at all. On grok's 1..15 grid it can, and cheaply
    // enough to pass the job cap ($2.10 at 30 s) — so what keeps this true is now
    // `MEDIA_GENERATED_SECONDS_CAP` in `@pikar/cost`, a code-owned ceiling of 12 generated seconds
    // per reservation, asserted there against this same body (ADR-027). The "at least one" half is
    // per-ANSWER rather than per-deck: a stills-and-cards concept costing a fraction of its sibling
    // is the cost lever the body teaches, not a gap.
    for (const r of decks())
      expect(r.scenes.some((s) => s.visual !== "generated_video")).toBe(true);
    expect(decks().some((r) => r.scenes.some((s) => s.visual === "generated_video"))).toBe(true);
  });

  it("the two decks are different CONCEPTS — their kind mixes differ", () => {
    // The testable shadow of "a different angle AND a different visual treatment". Two decks with
    // the same kinds in the same order are one deck with different words, and the owner's choice
    // is then a choice between nothing.
    const [a, b] = decks();
    const mix = (r: typeof a) =>
      (r?.scenes ?? [])
        .map((s) => s.visual)
        .sort()
        .join(",");
    expect(mix(a)).not.toBe(mix(b));
  });

  it("every scene names what its picture is built from", () => {
    // A text_card with no overlay and an uploaded_video with no asset both clear the money gate
    // and then render nothing. The body teaches both; the example must obey both.
    for (const r of decks()) {
      for (const s of r.scenes) expect(hasAssetSource(s), `scene ${s.index}`).toBe(true);
    }
  });

  it("each deck demonstrates BOTH a speaking scene and a silent one", () => {
    // Optional narration is the wave-4 contract. An example where every scene speaks teaches the
    // old rule by omission, and one where none does would not parse at all.
    for (const r of decks()) {
      expect(r.scenes.some((s) => s.narration !== "")).toBe(true);
      expect(r.scenes.some((s) => s.narration === "")).toBe(true);
    }
  });

  it("every narration line fits the window it ACTUALLY has, not a uniform one", () => {
    for (const r of decks()) {
      for (const [i, s] of r.scenes.entries()) {
        if (s.narration === "") continue;
        const available = narrationCeilingSeconds(r.scenes, i);
        expect(s.narration.length, `scene ${s.index} narration`).toBeLessThanOrEqual(
          available * MAX_CHARS_PER_SECOND,
        );
      }
    }
  });

  it("startMs is a RUNNING SUM, not index x a constant", () => {
    for (const r of decks()) {
      let running = 0;
      for (const s of r.scenes) {
        expect(s.startMs).toBe(running);
        running += s.durationMs;
      }
      // …and the example must actually exercise the difference, or this passes on a uniform deck.
      expect(new Set(r.scenes.map((s) => s.durationMs)).size).toBeGreaterThan(1);
    }
  });

  it("each variation's SCENE PROMPTS are reached — a prompt differs from its description", () => {
    // Without this the body could drop the prompts section entirely and every prompt would silently
    // degrade to the scene's visual description, which is not a parse failure and not a lie
    // anyone would notice until the images came back generic. It is also what catches the
    // `Scene N` / `Block N` head mismatch: the prompts section is shared by both contracts.
    for (const r of decks()) expect(r.scenes.some((s) => s.prompt !== s.description)).toBe(true);
  });

  it("each variation carries its OWN script and art direction inside its own slice", () => {
    // The terminal reads both off `variations.a.body`. A body that wrote one art direction above
    // the headings would land a plan row with none — a parse `null`, not an error.
    for (const s of both()) {
      const script = parseScript(s.body);
      expect(script).not.toBe("");
      const spoken = s.deck.scenes.find((sc) => sc.narration !== "");
      expect(script, "the script must be the deck's own lines").toContain(spoken?.narration ?? "");
      const art = parseArtDirection(s.body);
      expect(art, "nine fields, per variation").not.toBeNull();
      expect(art?.palette[0]).toMatch(/#[0-9a-f]{6}/i); // hex, never a vague colour word
      // THE BED, round-tripped out of the body the registry actually seeds. The worked answer is
      // advertised to the model as "the exact shape, end to end", so a `Music` line the parser
      // cannot read would teach the shape that does not work — which is precisely the failure this
      // whole round-trip suite exists to catch for the deck.
      expect(MUSIC_MOODS, "the example's bed is a real slug").toContain(art?.music);
    }
  });

  it("the worked answer demonstrates ALL THREE citation states", () => {
    // The whole point of 33-09's citation half: a cited claim, a claim the vault could not ground,
    // and creative copy that must carry no citation at all. An example missing the middle one
    // teaches that an ungrounded figure may simply be asserted.
    const [a] = decks();
    const scenes = a?.scenes ?? [];
    const cited = scenes.filter((s) => s.source !== undefined);
    const flagged = scenes.filter((s) => s.needsConfirmation === true);
    const creative = scenes.filter(
      (s) => s.source === undefined && s.needsConfirmation === undefined,
    );
    expect(cited.length, "no cited scene").toBeGreaterThanOrEqual(1);
    expect(flagged.length, "no `Source: unverified` scene").toBeGreaterThanOrEqual(1);
    expect(
      creative.length,
      "every scene is cited — creative copy must not be",
    ).toBeGreaterThanOrEqual(1);
    expect(cited[0]?.source?.docId).toBeTruthy();
    expect(cited[0]?.source?.title).toBeTruthy();
    // The two states are exclusive: a grounded claim is not also awaiting confirmation.
    expect(cited.some((s) => s.needsConfirmation)).toBe(false);
  });

  it("the body teaches the speech rate it is held to, and names its only tool", () => {
    expect(body).toContain(String(MAX_CHARS_PER_SECOND));
    for (const kind of VISUAL_KINDS) expect(body, `${kind} is not taught`).toContain(kind);
    expect(body).toContain("searchVault");
  });

  it("the body teaches the three 33-09 contracts by their literal tokens", () => {
    // Literal strings, because these ARE the output contract — the parser matches them byte for
    // byte and guidance prose about them is not what a model copies (the model-reflex lesson).
    for (const token of [
      "VARIATION A",
      "VARIATION B",
      "(defaulted)",
      "Source: unverified",
      "[doc:",
    ]) {
      expect(body, `the body never shows \`${token}\``).toContain(token);
    }
  });
});

// ── 20-08: the two remaining §-parsers ────────────────────────────────────────────────
//
// `parseBlockDeck` is what the money depends on and is tested above. These two feed the plan row's
// display fields, so their failure mode is a worse-looking reel rather than a wrong charge — which
// is exactly why `parseArtDirection` returns `null` instead of a half-filled object.

/** The shape the `media-director` skill body actually asks for (§1 and §2 of the body). */
const PROSE = [
  "Here is the reel.",
  "",
  "## 1. SCRIPT",
  "",
  "Six weeks, start to finish. That is how long it took.",
  "Nobody believed it could be done that fast.",
  "",
  "## 2. ART DIRECTION",
  "",
  "- **Palette** — `#0B4F4A deep teal`, `#F4F1EA bone`, `#1A1A1A ink`",
  "- **Mood** — Quietly confident, never triumphant.",
  "- **Lighting** — Warm golden light from camera left at 45 degrees, soft shadow falloff.",
  "- **Composition** — Subject slightly off-centre right, camera locked off.",
  "- **Environment** — A working studio, mid-afternoon.",
  "- **Texture** — 35mm film grain over matte paper.",
  "- **Typography** — A humanist sans with a tall x-height.",
  "- **References** — Gregory Crewdson; the film Locke; Apple's Shot on iPhone",
  "- **Do NOT** — No stock-footage handshakes, no drone establishing shots.",
  "",
  "## 3. BLOCK DECK",
].join("\n");

describe("parseScript", () => {
  it("takes the SCRIPT section verbatim and stops at the next heading", () => {
    const out = parseScript(PROSE);
    expect(out).toContain("Six weeks, start to finish.");
    expect(out).toContain("Nobody believed it could be done that fast.");
    // The section ENDS at `## 2.` — an art direction leaking into the script would be voiced.
    expect(out).not.toMatch(/ART DIRECTION|Palette/);
    expect(out).not.toContain("Here is the reel.");
  });

  it("is empty when the specialist wrote no script section", () => {
    expect(parseScript("just some prose with no headings at all")).toBe("");
  });
});

describe("parseArtDirection", () => {
  it("reads all nine fields, splitting palette and references into lists", () => {
    const art = parseArtDirection(PROSE);
    expect(art).not.toBeNull();
    expect(art?.palette).toEqual(["#0B4F4A deep teal", "#F4F1EA bone", "#1A1A1A ink"]);
    expect(art?.mood).toBe("Quietly confident, never triumphant.");
    expect(art?.lighting).toContain("45 degrees");
    expect(art?.composition).toContain("off-centre right");
    expect(art?.environment).toBe("A working studio, mid-afternoon.");
    expect(art?.texture).toBe("35mm film grain over matte paper.");
    expect(art?.typography).toContain("humanist sans");
    expect(art?.references).toEqual([
      "Gregory Crewdson",
      "the film Locke",
      "Apple's Shot on iPhone",
    ]);
    expect(art?.avoid).toContain("No stock-footage handshakes");
  });

  it("is NULL when a required field is missing — never a half-filled object", () => {
    // A 9-key schema object with empty strings in it renders as an art direction the specialist
    // never wrote. Dropping `Texture` is enough.
    const missing = PROSE.replace(/^- \*\*Texture\*\*.*$/m, "");
    expect(parseArtDirection(missing)).toBeNull();
    expect(parseArtDirection("no art direction section here")).toBeNull();
  });

  it("keeps `typography` OPTIONAL — the one field the schema allows to be absent", () => {
    const art = parseArtDirection(PROSE.replace(/^- \*\*Typography\*\*.*$/m, ""));
    expect(art).not.toBeNull();
    expect(art?.typography).toBeUndefined();
    expect(art?.mood).toBe("Quietly confident, never triumphant."); // the rest survived
  });

  it("accepts the label variants a model actually produces", () => {
    // Bare labels, a colon instead of an em-dash, `*` bullets, and `Avoid` for `Do NOT`. Failing a
    // whole art direction over a synonym would be a hard refusal caused by punctuation.
    const variant = PROSE.replace("- **Do NOT** —", "* Avoid:").replace("- **Mood** —", "Mood:");
    const art = parseArtDirection(variant);
    expect(art).not.toBeNull();
    expect(art?.mood).toBe("Quietly confident, never triumphant.");
    expect(art?.avoid).toContain("No stock-footage handshakes");
  });

  it("does NOT enforce the hex-palette rule — that is the skill body's job, not the parser's", () => {
    // A parser that refused `warm tones` would turn a soft quality problem into a hard refusal at
    // the Approve gate, where a human is already reading the proposal and is the better judge.
    const vague = PROSE.replace(/^- \*\*Palette\*\*.*$/m, "- **Palette** — warm tones");
    expect(parseArtDirection(vague)?.palette).toEqual(["warm tones"]);
  });

  it("keeps `music` OPTIONAL, and PROSE has none — absence is the normal case", () => {
    // A reel with no bed is the reel this system shipped before beds existed. Failing an art
    // direction over a missing music line would be a regression dressed as a feature.
    const art = parseArtDirection(PROSE);
    expect(art).not.toBeNull();
    expect(art?.music).toBeUndefined();
  });

  it("reads a `Music` line into the closed set", () => {
    const withBed = PROSE.replace("- **Do NOT** —", "- **Music** — upbeat\n- **Do NOT** —");
    expect(parseArtDirection(withBed)?.music).toBe("upbeat");
  });

  it("a bed the library cannot play is NO bed — never a passed-through name", () => {
    // The containment, end to end at the parser: the skill body ASKS for a mood and forbids naming
    // a track, but an instruction is a request. This is what makes it structural.
    const named = PROSE.replace(
      "- **Do NOT** —",
      '- **Music** — "Bittersweet Symphony" by The Verve, 128bpm\n- **Do NOT** —',
    );
    const art = parseArtDirection(named);
    expect(art, "the rest of the block still parses").not.toBeNull();
    expect(art?.music, "an invented track name cannot become a lookup").toBeUndefined();
  });
});

describe("parseMusicMood", () => {
  it("accepts every member of the closed set, and nothing else", () => {
    for (const mood of MUSIC_MOODS) expect(parseMusicMood(mood)).toBe(mood);
    for (const junk of ["lofi", "128bpm", "", "jazz", "музыка"]) {
      expect(parseMusicMood(junk), `${junk} names no track we can play`).toBeUndefined();
    }
  });

  it("SCANS a sentence — a model writes a phrase far more often than a bare word", () => {
    // Refusing the sentence would cost the bed over a comma. Tolerance here is safe precisely
    // because the scan is bounded by the closed set: it cannot widen what is reachable.
    expect(parseMusicMood("calm, low strings held under the voice")).toBe("calm");
    expect(parseMusicMood("Something CINEMATIC but restrained")).toBe("cinematic");
    expect(parseMusicMood("a warm, unhurried pad")).toBe("warm");
  });

  it("takes the FIRST slug named, so a two-mood line is not ambiguous", () => {
    // One bed, one mood. A line naming two is a specialist hedging; picking the first is
    // deterministic, which is what the reserve and the render both need it to be.
    expect(parseMusicMood("upbeat, or calm if that reads better")).toBe("upbeat");
  });

  it("cannot be talked into a path — the slug is never caller-shaped text", () => {
    // `--music` is interpolated into a path inside the VM. The script bounds the charset again on
    // its own side; this is the half that stops such a value ever being produced here.
    expect(parseMusicMood("../../etc/passwd")).toBeUndefined();
    expect(parseMusicMood("calm; rm -rf /")).toBe("calm"); // the SLUG survives, the rest does not
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SCENE TIMELINE (phase 20.2, wave 1)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** A well-formed 30-second scene deck, built from parts so each test corrupts exactly one thing.
 *  Four scenes: 8 + 6 + 4 + 12 = 30, which is what makes the exact-sum assert testable by
 *  arithmetic rather than by trust. */
const sceneDeck = (rows: readonly string[], header = "Target duration: 30") =>
  [
    "Some preamble the specialist wrote.",
    "",
    "SCENE DECK",
    header,
    "",
    "| # | Visual | Seconds | Description | Narration | Text overlay | Asset |",
    "|---|--------|---------|-------------|-----------|--------------|-------|",
    ...rows,
    "",
  ].join("\n");

// Ceilings for this shape at 14 chars/second: 8s -> 112, 6s -> 84, 4s -> 56, 12s -> 168.
const S1 = "Most founders lose a full hour a day to inbox triage.";
const S2 = "Pikar reads the thread and drafts your reply.";
const S3 = "You approve. Nothing sends alone.";
const S4 = "Every send is written down, and the whole trail stays yours to read.";

const SCENES = [
  `| 1 | generated_video | 8 | Founder at a desk, morning light | ${S1} | LOSE AN HOUR | |`,
  `| 2 | animated_image | 6 | Mail icons collapsing into one card | ${S2} | | |`,
  `| 3 | text_card | 4 | A single line of type on black | ${S3} | YOU APPROVE | |`,
  `| 4 | generated_video | 12 | The cockpit, one drafted reply | ${S4} | | |`,
] as const;

describe("parseSceneDeck — the happy path", () => {
  const r = parseSceneDeck(sceneDeck(SCENES));

  it("parses N scenes in row order", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes).toHaveLength(4);
    expect(r.scenes.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.targetDurationSeconds).toBe(30);
  });

  it("derives startMs as a RUNNING SUM, never index * something", () => {
    if (!r.ok) return;
    // The uniform contract's `index * clipSeconds * 1000` would give 0/8000/16000/24000 here.
    expect(r.scenes.map((s) => s.startMs)).toEqual([0, 8000, 14000, 18000]);
    expect(r.scenes.map((s) => s.durationMs)).toEqual([8000, 6000, 4000, 12000]);
  });

  it("carries the four visual kinds and their paid/renderable facts", () => {
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.visual)).toEqual([
      "generated_video",
      "animated_image",
      "text_card",
      "generated_video",
    ]);
    expect(r.scenes.map(isPaidScene)).toEqual([true, true, false, true]);
    // THE REPAIR: every kind here is renderable, where the block contract refused two of four.
    expect(r.scenes.every(hasAssetSource)).toBe(true);
  });

  it("sums the submitted narration characters", () => {
    if (!r.ok) return;
    expect(sceneNarrationChars(r.scenes)).toBe(S1.length + S2.length + S3.length + S4.length);
  });
});

describe("hasAssetSource — does this row name what its picture is built FROM? (20.2 wave 5)", () => {
  // The narrowed replacement for `isPaidBlock`-as-renderability. It is the guard `media.ts` calls
  // at the money gate, so a `true` here is a scene that may be BOUGHT — and a false negative
  // refuses a legitimate deck while a false positive buys the paid scenes around a row that can
  // never produce pixels, then hard-errors in the VM. Both directions are asserted.
  const scene = (over: Partial<Scene>): Scene => ({
    index: 0,
    startMs: 0,
    durationMs: 4000,
    visual: "generated_video",
    description: "d",
    narration: "n",
    prompt: "p",
    ...over,
  });

  it("an uploaded_video needs its vault doc NAMED — there is no footage otherwise", () => {
    expect(hasAssetSource(scene({ visual: "uploaded_video" }))).toBe(false);
    expect(
      hasAssetSource(
        scene({ visual: "uploaded_video", asset: { source: "vault", docId: "doc_1" } }),
      ),
    ).toBe(true);
  });

  it("a text_card needs WORDS — drawtext with nothing to draw is a black rectangle", () => {
    // …and a black rectangle passes every downstream gate: the file decodes, the duration is
    // right, the sidecar is well-formed. Only the picture is missing.
    expect(hasAssetSource(scene({ visual: "text_card" }))).toBe(false);
    expect(hasAssetSource(scene({ visual: "text_card", overlay: "   " }))).toBe(false);
    expect(hasAssetSource(scene({ visual: "text_card", overlay: "Ninety minutes" }))).toBe(true);
  });

  it("a GENERATED kind is always renderable — its source is the prompt the parser required", () => {
    expect(hasAssetSource(scene({ visual: "generated_video" }))).toBe(true);
    expect(hasAssetSource(scene({ visual: "animated_image" }))).toBe(true);
  });

  it("a STOCK kind needs its PROMPT — because the prompt is the search, and the parser does not require one", () => {
    // The reason this is checked rather than assumed: `parseSceneDeck` falls `prompt` back to the
    // `Description` cell, and that cell is only trimmed, never required to be non-empty. A blank
    // one would ask a stock library for "" and land whatever its default ranking returns — a
    // picture nobody chose, inside a reel someone approved.
    for (const visual of ["stock_video", "stock_image"] as const) {
      expect(hasAssetSource(scene({ visual, prompt: "" }))).toBe(false);
      expect(hasAssetSource(scene({ visual, prompt: "   " }))).toBe(false);
      expect(hasAssetSource(scene({ visual, prompt: "hands typing on a laptop" }))).toBe(true);
    }
    // An empty prompt is NOT fatal for the kinds whose picture comes from somewhere else — the
    // guard has to be narrow or it starts refusing decks it has no business refusing.
    expect(hasAssetSource(scene({ visual: "text_card", overlay: "WORDS", prompt: "" }))).toBe(true);
    expect(
      hasAssetSource(
        scene({ visual: "uploaded_video", asset: { source: "vault", docId: "d" }, prompt: "" }),
      ),
    ).toBe(true);
  });

  it("is NOT the paid flag — that equivalence is exactly what wave 5 removed", () => {
    // A free scene that names its source is renderable; a paid one is not automatically so.
    const card = scene({ visual: "text_card", overlay: "words" });
    expect(isPaidScene(card)).toBe(false);
    expect(hasAssetSource(card)).toBe(true);
  });
});

describe("parseSceneDeck — the exact-length rule", () => {
  it("REFUSES rows that do not sum to the declared target, and says what they summed to", () => {
    // 8 + 6 + 4 + 8 = 26 against a declared 30. Renormalising would submit a duration nobody
    // priced — `mixed_durations`' reasoning, one contract later.
    const short = SCENES.map((row) => row.replace("| 12 |", "| 8 |"));
    const r2 = parseSceneDeck(sceneDeck(short));
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe("duration_mismatch");
    expect(r2).toMatchObject({ totalSeconds: 26 });
  });

  it("refuses a target length nobody prices", () => {
    expect(parseSceneDeck(sceneDeck(SCENES, "Target duration: 20"))).toMatchObject({
      reason: "bad_target_duration",
    });
  });

  it("refuses an ABSENT target rather than guessing one", () => {
    expect(parseSceneDeck(sceneDeck(SCENES, ""))).toMatchObject({ reason: "bad_target_duration" });
  });

  it("accepts every member of TARGET_DURATIONS", () => {
    for (const t of TARGET_DURATIONS) {
      const rows = [`| 1 | animated_image | ${t} | One still, slowly pushing in | ${S3} | | |`];
      expect(parseSceneDeck(sceneDeck(rows, `Target duration: ${t}`)).ok).toBe(true);
    }
  });
});

describe("parseSceneDeck — the provider grid", () => {
  it("REPAIRS a generated clip off the 1..15 grid rather than refusing the deck (33-12)", () => {
    // 33.1-04 MOVED THE EXAMPLE, not the rule. A 6-second clip is ordinary on grok's grid, so the
    // off-grid case is now a clip LONGER than 15 — the only length left that the provider cannot
    // make. The clip snaps to 15 and the animated scene takes the 3 seconds back, so the reel is
    // still 30s and nothing is bought against a length the provider would reject.
    // The refusal survives only where no repair is safe — see the 33-12 describe block.
    const offGrid = [
      `| 1 | generated_video | 18 | Founder at a desk | ${S2} | | |`,
      `| 2 | animated_image | 12 | Mail icons | ${S4} | | |`,
    ];
    const r = parseSceneDeck(sceneDeck(offGrid));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([15, 15]);
    expect(r.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 18, toSeconds: 15, why: "grid" },
      { sceneIndex: 1, fromSeconds: 12, toSeconds: 15, why: "rebalance" },
    ]);
  });

  it("lets the OTHER kinds take any whole-second duration — that is why they exist", () => {
    const odd = [
      `| 1 | animated_image | 7 | A still pushing in | ${S2} | | |`,
      `| 2 | text_card | 11 | One line of type | ${S4} | | |`,
      `| 3 | uploaded_video | 12 | The founder's own footage | ${S1} | | doc_abc |`,
    ];
    const r2 = parseSceneDeck(sceneDeck(odd));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.scenes.map((s) => s.durationMs)).toEqual([7000, 11000, 12000]);
  });

  it("refuses a non-integer or non-positive scene duration", () => {
    for (const bad of ["0", "-4", "two", ""]) {
      const rows = [`| 1 | animated_image | ${bad} | A still | ${S3} | | |`];
      expect(parseSceneDeck(sceneDeck(rows, "Target duration: 15"))).toMatchObject({
        reason: "bad_scene_duration",
        sceneIndex: 0,
      });
    }
  });
});

describe("parseSceneDeck — uploaded footage", () => {
  it("refuses an uploaded_video scene with nothing to upload", () => {
    const rows = [`| 1 | uploaded_video | 15 | The founder's own clip | ${S3} | | |`];
    expect(parseSceneDeck(sceneDeck(rows, "Target duration: 15"))).toMatchObject({
      reason: "missing_asset",
      sceneIndex: 0,
    });
  });

  it("carries the vault ref, backticks stripped", () => {
    const rows = [`| 1 | uploaded_video | 15 | The founder's own clip | ${S3} | | \`doc_xyz\` |`];
    const r2 = parseSceneDeck(sceneDeck(rows, "Target duration: 15"));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.scenes[0]?.asset).toEqual({ source: "vault", docId: "doc_xyz" });
  });
});

describe("parseSceneDeck — narration has a ceiling and NO floor", () => {
  it("accepts a line far shorter than its scene — the DELETED floor", () => {
    // Under the block contract this was `narration_too_short`: a take had to FILL its window
    // because it was mixed inside it. On a master timeline the silence around a line is free.
    const rows = ["| 1 | animated_image | 30 | A slow push across one still | Hello. | | |"];
    expect(parseSceneDeck(sceneDeck(rows)).ok).toBe(true);
  });

  // ── 33.1-06: RUNNING INTO THE NEXT LINE IS NO LONGER A REFUSAL ────────────────────────────
  //
  // `assemble_final.sh` used to hard-error on it; it now DELAYS the later take by `TAKE_GAP_S`
  // and keeps only one fatal case. Refusing a deck for a failure the renderer no longer has is a
  // free refusal of a reel that would have rendered — which is what the owner kept hitting. The
  // pair below is the whole contract: the first accepts, the second still refuses.
  it("ACCEPTS a line that runs into the next line — the assembler pushes that take", () => {
    const tooLong = `${S4} ${S4} ${S4}`; // 200+ chars against an 8-second scene
    const rows = [
      `| 1 | generated_video | 8 | Founder at a desk | ${tooLong} | | |`,
      `| 2 | animated_image | 22 | Mail icons | ${S2} | | |`,
    ];
    // Scene 1 speaks for ~14.6s from 0; scene 2's line is displaced to ~14.7s and needs ~3.2s,
    // ending well inside 30. Nothing overruns the REEL, so nothing is refused.
    expect(parseSceneDeck(sceneDeck(rows)).ok).toBe(true);
  });

  it("STILL refuses a line that would still be speaking when the REEL ends", () => {
    // The surviving fatal case, and the reason the check was narrowed rather than deleted: a take
    // can be delayed, but there is nowhere to delay it TO once the picture track has ended. The
    // renderer exits with "would be cut mid-word", and by then every picture has been bought.
    const rows = [
      `| 1 | animated_image | 4 | Mail icons | ${S2} | | |`,
      `| 2 | animated_image | 26 | Founder at a desk | ${"y".repeat(600)}. | | |`,
    ];
    expect(parseSceneDeck(sceneDeck(rows))).toMatchObject({
      reason: "narration_too_long",
      sceneIndex: 1,
    });
  });

  it("refuses on the CASCADE, not on any single line — three lines that each look fine", () => {
    // NOT VACUOUS, and it is the reason `narrationOverrunsReel` carries a cursor instead of
    // testing each line against its own window. Every line here fits its own scene comfortably;
    // it is only the accumulated displacement of three of them that runs off the end. A per-line
    // check — the shape this replaced — passes this deck and lets the renderer eat it.
    const line = "y".repeat(150); // ~10.7s of speech in a 4-second scene
    const rows = [
      `| 1 | animated_image | 4 | one | ${line} | | |`,
      `| 2 | animated_image | 4 | two | ${line} | | |`,
      `| 3 | animated_image | 4 | three | ${line} | | |`,
      `| 4 | animated_image | 3 | four | | | |`,
    ];
    const r = parseSceneDeck(sceneDeck(rows, "Target duration: 15"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("narration_too_long");
  });

  it("lets a SILENT scene lend its whole duration to the line before it", () => {
    // Scene 1 starts at 0 and the next NARRATED scene starts at 18000, so the line has 18 seconds
    // (252 characters) even though its own scene is 8. This is what lets a deck cut visually
    // without cutting the sentence — and it is the whole point of the master audio timeline.
    const long = `${S1} ${S2} ${S3}`;
    const rows = [
      `| 1 | generated_video | 8 | Founder at a desk | ${long} | | |`,
      "| 2 | animated_image | 6 | Mail icons | | | |",
      "| 3 | text_card | 4 | One line of type | | | |",
      `| 4 | generated_video | 12 | The cockpit | ${S4} | | |`,
    ];
    const r2 = parseSceneDeck(sceneDeck(rows));
    expect(long.length).toBeGreaterThan(112); // would have failed its OWN window
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(narrationCeilingSeconds(r2.scenes, 0)).toBe(18);
  });

  it("refuses a deck where EVERY scene is silent", () => {
    const rows = [
      "| 1 | animated_image | 15 | A still | | | |",
      "| 2 | text_card | 15 | One line of type | | | |",
    ];
    expect(parseSceneDeck(sceneDeck(rows))).toMatchObject({ reason: "no_narration" });
  });
});

/**
 * SECONDS, NEVER WORDS. A line that overruns its window is repaired by moving DURATION between
 * scenes — the narration text is never touched, and the reel stays exactly as long as it was.
 *
 * The geometry is the whole design, and it is not the one it looks like. `narrationCeilingSeconds`
 * is `start(next narrated scene) - start(self)`, so scene i's window is the SUM of scenes
 * `i … nextNarrated-1`. Shrinking a scene BEFORE i moves both endpoints equally; shrinking a silent
 * scene INSIDE the window is zero-sum. Only seconds taken from OUTSIDE the span widen it.
 */
describe("parseSceneDeck — a long line buys seconds instead of losing the deck", () => {
  // 202 characters: ceil(202/14) = 15 seconds needed, and 202 <= 15*14 so 15 is enough.
  const long = `${S1} ${S2} ${S3} ${S4}`;

  it("takes the seconds from a scene OUTSIDE the window and keeps the reel exactly as long", () => {
    expect(long.length).toBe(202); // the fixture's premise, asserted rather than trusted
    const rows = [
      `| 1 | animated_image | 8 | Founder at a desk | ${long} | | |`,
      `| 2 | generated_video | 12 | The cockpit | ${S4} | | |`,
      "| 3 | animated_image | 10 | Mail icons | | | |",
    ];
    const r = parseSceneDeck(sceneDeck(rows));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Scene 1 grew by 7, scene 3 paid the 7. The generated clip is untouched — it is on the grid.
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([15, 12, 3]);
    expect(narrationCeilingSeconds(r.scenes, 0)).toBe(15);
    // Not one character moved.
    expect(r.scenes[0]?.narration).toBe(long);
    expect(r.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 8, toSeconds: 15, why: "narration" },
      { sceneIndex: 2, fromSeconds: 10, toSeconds: 3, why: "narration" },
    ]);
  });

  it("refuses when the only slack is INSIDE the window — moving it would change nothing", () => {
    // Scene 2 is silent and sits inside scene 1's window, so its 7 seconds are ALREADY counted in
    // the 11-second ceiling. Spending them would shorten a scene and buy zero characters. Every
    // scene OUTSIDE the span sits on `MIN_DONOR_SECONDS`, so nothing out there can give either.
    //
    // 33.1: this used to park two untouchable generated clips outside the span instead. That made
    // the test pass for the WRONG reason once clips became donatable — there was slack out there
    // all along, and only the old ban hid it. The floor is the honest way to say "no slack".
    const rows = [
      `| 1 | animated_image | 4 | Founder at a desk | ${long} | | |`,
      "| 2 | animated_image | 7 | Mail icons | | | |",
      `| 3 | generated_video | 2 | The cockpit | ${S3} | | |`,
      "| 4 | animated_image | 2 | One line of type | | | |",
    ];
    // 33.1-06: the TRADE still cannot happen — that is what this test is about, and it is
    // unchanged. The deck ALSO still refuses, but the reason moved and it is worth being exact
    // about, because it is no longer "line 1 runs into line 3": scene 1 speaks for ~14.4s of a
    // 15-second reel and scene 3's line needs ~2.3s more, so the LAST line is still talking after
    // the picture has ended. Delaying a take cannot cure that; only a shorter line or a longer
    // reel can. It is the surviving fatal case, arrived at through the cascade.
    expect(parseSceneDeck(sceneDeck(rows, "Target duration: 15"))).toMatchObject({
      reason: "narration_too_long",
      sceneIndex: 2,
    });
  });

  // THE DECK THE OWNER WAS REFUSED, LIVE, ON 2026-09-04 — verbatim narration and seconds. It is
  // renderable and always was; `bestDonor` chose on LENGTH alone and never asked whether a donor
  // still fit its OWN line. Scene 1 (52 chars in 4s) is already at its limit, so donating 2s to
  // scene 3 makes scene 1 the next offender; the next pass takes them straight back, and the
  // repair ping-pongs until its pass budget runs out. All the while the 7-second CLIP is carrying
  // 40 characters -- 4 spare seconds -- and is never asked, because a still that merely looked
  // slack is preferred first. The clip is the only donor that can actually pay.
  it("asks the CLIP when every still is already at its own narration limit", () => {
    const rows = [
      "| 1 | text_card | 4 | Introduction to the service | Our service helps you manage your tasks efficiently. | MANAGE YOUR TASKS | |",
      "| 2 | generated_video | 7 | A solopreneur using the service | See how easy it is to organize your day. | | |",
      "| 3 | stock_image | 2 | A clutter-free workspace | Simplify your workload and focus on growth. | SIMPLIFY YOUR WORKLOAD | |",
      "| 4 | text_card | 2 | A simple call to action | Join now and take the first step. | JOIN NOW | |",
    ];
    const r = parseSceneDeck(sceneDeck(rows, "Target duration: 15"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The clip pays for both short scenes and lands at 4s. The reel is still exactly 15.
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([4, 4, 4, 3]);
    expect(r.scenes.reduce((n, s) => n + s.durationMs, 0)).toBe(15_000);
    // Shrinking a clip only ever LOWERS the generated total, so this cannot raise the price.
    expect(r.adjustments.filter((a) => a.sceneIndex === 1)).toEqual([
      { sceneIndex: 1, fromSeconds: 7, toSeconds: 5, why: "narration" },
      { sceneIndex: 1, fromSeconds: 5, toSeconds: 4, why: "narration" },
    ]);
    // And the whole point: the reel it produces does NOT overrun, so the refusal was never real.
    expect(narrationOverrunsReel(r.scenes, 15)).toBeNull();
  });

  it("takes from OUTSIDE the window even when a longer scene sits inside it", () => {
    // Scene 2 is the biggest donor on the deck by a mile — 12 seconds against scene 4's 4 — and it
    // is the wrong one, because it is inside scene 1's window and its seconds are already counted.
    // Taking them would shorten a scene and buy zero characters, and the deck would then refuse
    // after burning every pass on trades that bought nothing. Scene 4 has exactly the 1 second the
    // line is short by, and it is outside the span, so it is the only donor that can work.
    const rows = [
      `| 1 | animated_image | 2 | Founder at a desk | ${long} | | |`,
      "| 2 | animated_image | 12 | Mail icons | | | |",
      `| 3 | generated_video | 12 | The cockpit | ${S3} | | |`,
      "| 4 | animated_image | 4 | One line of type | | | |",
    ];
    const r = parseSceneDeck(sceneDeck(rows));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([3, 12, 12, 3]);
    expect(r.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 2, toSeconds: 3, why: "narration" },
      { sceneIndex: 3, fromSeconds: 4, toSeconds: 3, why: "narration" },
    ]);
  });

  it("refuses rather than cut a donor below the floor", () => {
    // Scene 1 needs 7 more seconds. Every scene outside its window holds at most 6 above the floor
    // — the clip included, now that clips can donate — so donating 7 would leave a 1-second flash
    // and no donor can cover it. The deck refuses exactly as it did before.
    const rows = [
      `| 1 | animated_image | 8 | Founder at a desk | ${long} | | |`,
      `| 2 | generated_video | 8 | The cockpit | ${S4} | | |`,
      "| 3 | animated_image | 8 | Mail icons | | | |",
      "| 4 | animated_image | 6 | One line of type | | | |",
    ];
    // Same 33.1-06 change as above: the donor floor still refuses the TRADE, and the deck now
    // survives it. The floor is the assertion; the refusal was never this function's to make.
    const r = parseSceneDeck(sceneDeck(rows));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adjustments).toEqual([]);
    expect(r.scenes.map((x) => x.durationMs / 1000)).toEqual([8, 8, 8, 6]);
  });

  // ── 33.1: A CLIP MAY DONATE SECONDS. The shape below is the one that sent the owner back with
  // `narration_too_long` on a live reel, twice: a 15-second deck whose generated clip takes 7 of
  // the 15, leaving four scenes to share 8 — every one of them ON `MIN_DONOR_SECONDS`. The donor
  // pool was empty while five spare seconds sat in the clip, unreachable because resizing one used
  // to put it off the old 4/8/12 grid. `GENERATED_CLIP_SECONDS` is 1..15 now, so it does not.
  it("takes the seconds from a generated CLIP when every still is already on the floor", () => {
    const rows = [
      `| 1 | animated_image | 2 | Founder at a desk | ${S1} | | |`,
      `| 2 | generated_video | 7 | The cockpit | ${S3} | | |`,
      "| 3 | animated_image | 2 | Mail icons | | | |",
      "| 4 | animated_image | 2 | One line of type | | | |",
      "| 5 | animated_image | 2 | The trail | | | |",
    ];
    expect(S1.length).toBe(53); // ceil(53/14) = 4s needed against a 2s window: a deficit of 2
    const r = parseSceneDeck(sceneDeck(rows, "Target duration: 15"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([4, 5, 2, 2, 2]);
    // The clip lands on 5 — inside 1..15, so it is still a length the provider can make — and the
    // deck's generated total FELL from 7 to 5. A donating clip can only ever lower it, which is
    // why it needs no sight of `MEDIA_GENERATED_SECONDS_CAP` over in @pikar/cost.
    expect(r.scenes[1]?.visual).toBe("generated_video");
    expect(GENERATED_CLIP_SECONDS).toContain(5);
    expect(r.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 2, toSeconds: 4, why: "narration" },
      { sceneIndex: 1, fromSeconds: 7, toSeconds: 5, why: "narration" },
    ]);
  });

  it("leaves the clip alone when a still can cover the deficit", () => {
    // Same deficit of 2, but scene 3 now has 2 seconds above the floor. A still costs the reel
    // nothing to shrink; a clip costs it motion. The still is asked first and the clip is untouched.
    const rows = [
      `| 1 | animated_image | 2 | Founder at a desk | ${S1} | | |`,
      `| 2 | generated_video | 7 | The cockpit | ${S3} | | |`,
      "| 3 | animated_image | 4 | Mail icons | | | |",
      "| 4 | animated_image | 2 | One line of type | | | |",
    ];
    const r = parseSceneDeck(sceneDeck(rows, "Target duration: 15"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([4, 7, 2, 2]);
    expect(r.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 2, toSeconds: 4, why: "narration" },
      { sceneIndex: 2, fromSeconds: 4, toSeconds: 2, why: "narration" },
    ]);
  });

  it("leaves a deck that already fits completely alone", () => {
    const rows = [
      `| 1 | animated_image | 18 | Founder at a desk | ${long} | | |`,
      `| 2 | generated_video | 12 | The cockpit | ${S4} | | |`,
    ];
    const r = parseSceneDeck(sceneDeck(rows));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([18, 12]);
    expect(r.adjustments).toEqual([]);
  });
});

describe("parseSceneDeck — shape and tolerance", () => {
  it("maps the legacy block types onto the new kinds so an old deck still reads", () => {
    const legacy = [
      `| 1 | VIDEO | 8 | Founder at a desk | ${S1} | | |`,
      `| 2 | AI | 4 | Mail icons | ${S2} | | |`,
      `| 3 | TEXT | 6 | One line of type | ${S3} | | |`,
      `| 4 | SCREEN REC | 12 | The founder's own capture | ${S4} | | doc_1 |`,
    ];
    const r2 = parseSceneDeck(sceneDeck(legacy));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.scenes.map((s) => s.visual)).toEqual([
      "generated_video",
      "generated_video",
      "text_card",
      "uploaded_video",
    ]);
  });

  it("migrates a legacy TYPE, and the 1..15 grid now migrates the legacy DURATION too", () => {
    // INVERTED on 2026-08-30 (33.1-04), and the inversion is the point. The block contract's clip
    // lengths were 5 and 10 seconds and Sora's grid was 4/8/12, so an old deck parsed its TYPES
    // and then died on its SECONDS — six 5-second AI blocks summed perfectly to 30 and still could
    // not be generated. On grok's 1..15 both legacy lengths are ordinary, so the same deck now
    // parses whole. The grid did not get looser about SUBMISSION: 16 is still refused below.
    const oldWan = Array.from(
      { length: 6 },
      (_, i) => `| ${i + 1} | AI | 5 | Mail icons | ${S3} | | |`,
    );
    const r2 = parseSceneDeck(sceneDeck(oldWan));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.scenes.map((s) => s.durationMs / 1000)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(r2.adjustments).toEqual([]);
  });

  it("tolerates the casing and separator styles a model actually produces", () => {
    const messy = SCENES.map((row) =>
      row.replace("generated_video", "Generated Video").replace("animated_image", "ANIMATED-IMAGE"),
    );
    const r2 = parseSceneDeck(sceneDeck(messy));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.scenes[0]?.visual).toBe("generated_video");
    expect(r2.scenes[1]?.visual).toBe("animated_image");
  });

  it("refuses an unknown kind rather than defaulting — guessing a kind picks a price", () => {
    const rows = [`| 1 | hologram | 30 | Something new | ${S1} | | |`];
    expect(parseSceneDeck(sceneDeck(rows))).toMatchObject({ reason: "unknown_visual_kind" });
  });

  it("requires the Seconds column — without it this is the uniform contract renamed", () => {
    const noSeconds = [
      "SCENE DECK",
      "Target duration: 30",
      "",
      "| # | Visual | Description | Narration |",
      "|---|--------|-------------|-----------|",
      `| 1 | animated_image | A still | ${S1} |`,
    ].join("\n");
    // `unreadable_deck` since 2026-08-17, NOT `no_deck`: the heading is right there in this
    // fixture, and `no_deck` is the code persistStoryboard falls back to the block contract on.
    expect(parseSceneDeck(noSeconds)).toMatchObject({ reason: "unreadable_deck" });
  });

  it("refuses a deck with a header and no rows", () => {
    expect(parseSceneDeck(sceneDeck([]))).toMatchObject({ reason: "empty_deck" });
  });

  it("refuses a body with no SCENE DECK at all", () => {
    expect(parseSceneDeck("Just some prose about a video.")).toMatchObject({ reason: "no_deck" });
  });

  it("reads SCENE PROMPTS by DISPLAY number and falls back to the description", () => {
    const withPrompts = `${sceneDeck(SCENES)}\nSCENE PROMPTS\n\nBlock 2\n- Prompt: A slow push across stacked mail cards, cool light\n`;
    const r2 = parseSceneDeck(withPrompts);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.scenes[1]?.prompt).toBe("A slow push across stacked mail cards, cool light");
    expect(r2.scenes[0]?.prompt).toBe("Founder at a desk, morning light"); // description fallback
  });

  it("does not let ART DIRECTION swallow a scene deck", () => {
    const body = `ART DIRECTION\n- **Mood** — Quiet.\n\n${sceneDeck(SCENES)}`;
    // The section terminates at SCENE DECK, so `avoid` cannot come back carrying table rows.
    expect(parseArtDirection(body)).toBeNull(); // incomplete art direction, NOT a swallowed deck
    expect(parseSceneDeck(body).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PHASE-33 PARSE SURFACES (33-01)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("parseBrief — guided intake (33-01)", () => {
  const BRIEF = [
    "## 1. BRIEF",
    "",
    "Topic: Inbox triage, and what it costs a founder",
    "Duration: 30s",
    "Audience: Solo founders drowning in email (defaulted)",
    "Tone: Quietly confident (Defaulted)",
    "Brand voice: Plain words, short sentences",
    "",
  ].join("\n");

  it("round-trips a well-formed BRIEF, stripping the defaulted markers into the array", () => {
    const b = parseBrief(BRIEF);
    expect(b).not.toBeNull();
    expect(b?.topic).toBe("Inbox triage, and what it costs a founder");
    expect(b?.durationSeconds).toBe(30);
    // The markers are STRIPPED from the values — a chip must never render "(defaulted)" as copy —
    // and recorded by FIELD NAME, case-insensitively, so the canvas knows which chips to badge.
    expect(b?.audience).toBe("Solo founders drowning in email");
    expect(b?.tone).toBe("Quietly confident");
    expect(b?.brandVoice).toBe("Plain words, short sentences");
    expect(b?.defaulted).toEqual(["audience", "tone"]);
  });

  it("accepts a bare-number duration and a defaulted one — the preset can itself default", () => {
    const bare = parseBrief("BRIEF\nTopic: A topic\nDuration: 60");
    expect(bare?.durationSeconds).toBe(60);
    expect(bare?.defaulted).toEqual([]);

    const marked = parseBrief("BRIEF\nTopic: A topic\nDuration: 15s (defaulted)");
    expect(marked?.durationSeconds).toBe(15);
    expect(marked?.defaulted).toEqual(["duration"]);
  });

  it("omits the optional fields the specialist did not write, without inventing defaults", () => {
    const b = parseBrief("BRIEF\nTopic: A topic\nDuration: 30s");
    expect(b).not.toBeNull();
    expect(b?.audience).toBeUndefined();
    expect(b?.tone).toBeUndefined();
    expect(b?.brandVoice).toBeUndefined();
    expect(b?.defaulted).toEqual([]);
  });

  it("is NULL when the section is absent — a v2 body parses exactly as before", () => {
    expect(parseBrief(sceneDeck(SCENES))).toBeNull();
    expect(parseBrief("just prose, no headings")).toBeNull();
  });

  it("is NULL on an empty topic — a brief with nothing captured is no brief", () => {
    expect(parseBrief("BRIEF\nTopic:\nDuration: 30s")).toBeNull();
  });

  it("is NULL on a duration off the 15/30/60 presets — never free entry, never a guess", () => {
    for (const bad of ["45s", "20", "three", ""]) {
      expect(parseBrief(`BRIEF\nTopic: A topic\nDuration: ${bad}`)).toBeNull();
    }
    expect(parseBrief("BRIEF\nTopic: A topic")).toBeNull(); // absent line, same answer
  });

  it("terminates at the next section — a BRIEF above a deck reads both, brief fields clean", () => {
    const body = `BRIEF\nTopic: A topic\nDuration: 30s\n\n${sceneDeck(SCENES)}`;
    const b = parseBrief(body);
    expect(b?.topic).toBe("A topic");
    expect(b?.brandVoice).toBeUndefined(); // nothing leaked in from the deck below
    expect(parseSceneDeck(body).ok).toBe(true); // and the deck still parses beside it
  });
});

describe("parseSceneDeck — per-scene Source lines (33-01, document-level citations)", () => {
  // Source lines live in the per-scene blocks of SCENE PROMPTS, beside Prompt — the deck table
  // stays byte-for-byte what it was, which is what keeps every v2 fixture green.
  const withSources = [
    sceneDeck(SCENES),
    "SCENE PROMPTS",
    "",
    "Scene 1",
    "- Prompt: Founder at a desk, morning light, slow push in",
    "- Source: The 2025 pricing one-pager [doc:k57abc123]",
    "",
    "Scene 2",
    "- Source: unverified",
    "",
  ].join("\n");
  const r = parseSceneDeck(withSources);

  it("a cited scene gains source { docId, title } and nothing else", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes[0]?.source).toEqual({
      docId: "k57abc123",
      title: "The 2025 pricing one-pager",
    });
    expect(r.scenes[0]?.needsConfirmation).toBeUndefined();
  });

  it("`Source: unverified` marks the scene as needing owner confirmation, with no doc", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes[1]?.needsConfirmation).toBe(true);
    expect(r.scenes[1]?.source).toBeUndefined();
  });

  it("an absent Source line means creative copy — neither field, and v2 decks are untouched", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of [r.scenes[2], r.scenes[3]]) {
      expect(s?.source).toBeUndefined();
      expect(s?.needsConfirmation).toBeUndefined();
    }
    const plain = parseSceneDeck(sceneDeck(SCENES));
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    for (const s of plain.scenes) {
      expect(s.source).toBeUndefined();
      expect(s.needsConfirmation).toBeUndefined();
    }
  });

  it("refuses the deck on a [doc:] token with an empty id — never silently dropped", () => {
    const bad = withSources.replace("[doc:k57abc123]", "[doc:]");
    expect(parseSceneDeck(bad)).toMatchObject({ reason: "malformed_source", sceneIndex: 0 });
  });

  it("refuses a Source line that is neither a doc token nor `unverified`", () => {
    const bad = withSources.replace(
      "- Source: unverified",
      "- Source: something the model asserted freehand",
    );
    expect(parseSceneDeck(bad)).toMatchObject({ reason: "malformed_source", sceneIndex: 1 });
  });

  it("carries NO confirmation field in parser output — confirmedAt is a mutation's word, never the model's", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const scene = r.scenes[1];
    expect(scene && "confirmedAt" in scene).toBe(false);
    // @ts-expect-error — the Scene type must not grow a confirmation timestamp (provenance rule)
    scene?.confirmedAt;
  });
});

// ── 33-12: THE GENERATED-CLIP GRID IS REPAIRED, NOT JUST REFUSED ──────────────────────────────
//
// The generator only makes 4, 8 or 12 second clips. The model is TOLD this in both v2 and v3 of
// the body and still gets it wrong — and a model that does the wrong thing regardless of the
// instruction is not fixed by another instruction. Live on 2026-08-16 this cost the owner two
// consecutive reels.
//
// The rule, and its limit: snap an off-grid generated scene DOWN to the nearest legal length, then
// give the seconds back to the last scene that is NOT a generated clip, so the reel is still
// exactly as long as the user asked. Lengthening is always safe here — the only narration rule is
// that a line must not run into the NEXT one, and a longer window cannot break that.
//
// **It repairs the GRID, never the ARITHMETIC.** If the model's own rows do not add up to the
// length it declared, that is still `duration_mismatch`. Snapping a clip is fixing a fact about
// the provider; rebalancing a deck that never summed correctly would be inventing a reel.
describe("parseSceneDeck — off-grid generated clips are repaired (33-12)", () => {
  // 18 + 6 + 2 + 4 = 30, exactly the declared length. Only the GRID is wrong.
  // 33.1-04: was 10 + 6 + 2 + 12 against sora-2's [4, 8, 12]. Ten seconds is an ORDINARY length
  // on grok's 1..15, so the fixture had to move above 15 to keep exercising the repair at all —
  // an off-grid test whose clip is on the grid asserts nothing.
  const offGrid = sceneDeck([
    `| 1 | generated_video | 18 | Founder at a desk | ${S1} | | |`,
    `| 2 | animated_image | 6 | Mail icons | ${S2} | | |`,
    "| 3 | text_card | 2 | A line of type | | YOU APPROVE | |",
    `| 4 | generated_video | 4 | The cockpit | ${S3} | | |`,
  ]);

  it("snaps the off-grid clip DOWN and gives the seconds to the last non-generated scene", () => {
    const r = parseSceneDeck(offGrid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const secs = r.scenes.map((s) => s.durationMs / 1000);
    // Scene 1: 18 -> 15 (the top of the grid). Scene 3: 2 -> 5 (took the freed seconds).
    expect(secs).toEqual([15, 6, 5, 4]);
    // The reel is STILL exactly the length the user asked for.
    expect(secs.reduce((a, b) => a + b, 0)).toBe(30);
    expect(r.targetDurationSeconds).toBe(30);
    // Scene starts were recomputed, not left pointing at the old timeline.
    expect(r.scenes.map((s) => s.startMs)).toEqual([0, 15000, 21000, 26000]);
  });

  it("REPORTS every second it moved — a silent rewrite of the user's reel is not allowed", () => {
    const r = parseSceneDeck(offGrid);
    if (!r.ok) return;
    expect(r.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 18, toSeconds: 15, why: "grid" },
      { sceneIndex: 2, fromSeconds: 2, toSeconds: 5, why: "rebalance" },
    ]);
  });

  it("a deck already on the grid is untouched and reports NO adjustments", () => {
    const r = parseSceneDeck(sceneDeck(SCENES));
    if (!r.ok) return;
    expect(r.adjustments).toEqual([]);
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([8, 6, 4, 12]);
  });

  it("still refuses when the rows never summed to the declared length — grid, not arithmetic", () => {
    // 18 + 6 + 4 + 4 = 32 against a declared 30. Snapping 18->15 would leave 29 and rebalancing
    // would make it 30 by accident, which would be repairing a deck the model got wrong. That
    // must stay a refusal.
    const alsoBadMath = sceneDeck([
      `| 1 | generated_video | 18 | Founder at a desk | ${S1} | | |`,
      `| 2 | animated_image | 6 | Mail icons | ${S2} | | |`,
      "| 3 | text_card | 4 | A line of type | | YOU APPROVE | |",
      `| 4 | generated_video | 4 | The cockpit | ${S4} | | |`,
    ]);
    // It reports the GRID violation — the first thing wrong with the row — and the point of the
    // assertion is the `ok: false`: no repair was attempted on a deck whose own sum was wrong.
    expect(parseSceneDeck(alsoBadMath)).toMatchObject({
      ok: false,
      reason: "illegal_generated_duration",
    });
  });

  it("refuses when there is no non-generated scene to take the seconds back", () => {
    // Every scene is a generated clip AND one is over the top of the grid, so the freed seconds
    // have nowhere safe to go. 16 + 10 + 4 = 30 sums correctly; only the grid is wrong.
    const allGenerated = sceneDeck([
      `| 1 | generated_video | 16 | Founder | ${S1} | | |`,
      `| 2 | generated_video | 10 | Cockpit | ${S2} | | |`,
      `| 3 | generated_video | 4 | Close | ${S4} | | |`,
    ]);
    expect(parseSceneDeck(allGenerated)).toMatchObject({
      reason: "illegal_generated_duration",
      sceneIndex: 0,
    });
  });
});

// ── 33.1-04: THE GRID IS 1..15, AND THE REFUSAL CLASS IT RETIRES ──────────────────────────────
//
// `illegal_generated_duration` was the SECOND of the two defects the owner hit live on
// 2026-08-30: a deck of ordinary-looking scene lengths was refused at the write boundary because
// sora-2 only made multiples of four. On grok's 1..15 grid that class is gone for every integer
// length a scene sensibly has, and what is left fires only ABOVE 15.
describe("parseSceneDeck — the 1..15 grid retires illegal_generated_duration (33.1-04)", () => {
  it("a 5-SECOND and a 7-SECOND generated scene parse AT THEIR OWN LENGTHS, with NO adjustments", () => {
    // 5 + 7 + 3 = 15. Asserting `adjustments: []` is what makes this non-vacuous: a test that
    // only asserted `ok` would pass on a deck the repair had silently snapped to 4 s and 4 s.
    const r = parseSceneDeck(
      sceneDeck(
        [
          `| 1 | generated_video | 5 | Founder | ${S1} | | |`,
          `| 2 | generated_video | 7 | Cockpit | ${S2} | | |`,
          `| 3 | animated_image | 3 | Close | ${S3} | | |`,
        ],
        "Target duration: 15",
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([5, 7, 3]);
    expect(r.adjustments).toEqual([]);
  });

  it("A DECK OF ONLY GENERATED SCENES NOW PARSES — the repair has nothing to absorb, and no longer needs one", () => {
    // The exact shape that refused before: every scene is a generated clip, so
    // `repairGeneratedGrid` has no non-generated absorber and returned null, and the row loop then
    // refused. Nothing is off-grid now, so the repair never runs at all.
    const r = parseSceneDeck(
      sceneDeck(
        [
          `| 1 | generated_video | 5 | Founder | ${S1} | | |`,
          `| 2 | generated_video | 7 | Cockpit | ${S2} | | |`,
          `| 3 | generated_video | 3 | Close | ${S3} | | |`,
        ],
        "Target duration: 15",
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.durationMs / 1000)).toEqual([5, 7, 3]);
    expect(r.adjustments).toEqual([]);
    // …and it is still refused by MONEY rather than by arithmetic — 15 generated seconds is over
    // `MEDIA_GENERATED_SECONDS_CAP`. The parser's job is the contract; the cap's job is the spend.
  });

  it("the grid is WIDER, NOT OPEN: a 16-second scene is still snapped or refused", () => {
    // With an absorber: 16 -> 15, and the freed second goes to the card.
    const withAbsorber = parseSceneDeck(
      sceneDeck([
        `| 1 | generated_video | 16 | Founder | ${S1} | | |`,
        `| 2 | animated_image | 10 | Mail icons | ${S2} | | |`,
        "| 3 | text_card | 4 | A line of type | | YOU APPROVE | |",
      ]),
    );
    expect(withAbsorber.ok).toBe(true);
    if (!withAbsorber.ok) return;
    expect(withAbsorber.scenes.map((s) => s.durationMs / 1000)).toEqual([15, 10, 5]);
    expect(withAbsorber.adjustments).toEqual([
      { sceneIndex: 0, fromSeconds: 16, toSeconds: 15, why: "grid" },
      { sceneIndex: 2, fromSeconds: 4, toSeconds: 5, why: "rebalance" },
    ]);
    // Every integer 1..15 is legal, and 16 is the first that is not.
    expect([...GENERATED_CLIP_SECONDS]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });
});

describe("parseVariations — two-variation bodies (33-01)", () => {
  // A second, genuinely different deck: 15 seconds, different kinds, its own narration.
  const DECK_B = sceneDeck(
    [
      "| 1 | animated_image | 11 | A calendar filling itself | Your week, planned before coffee. | | |",
      "| 2 | text_card | 4 | Logo on black | | PIKAR | |",
    ],
    "Target duration: 15",
  );
  const twoUp = ["## VARIATION A", "", sceneDeck(SCENES), "", "## VARIATION B", "", DECK_B].join(
    "\n",
  );

  it("parses two valid variations into two independent decks", () => {
    const r = parseVariations(twoUp);
    expect(r.kind).toBe("two");
    if (r.kind !== "two") return;
    expect(r.a.deck.targetDurationSeconds).toBe(30);
    expect(r.a.deck.scenes).toHaveLength(4);
    expect(r.b.deck.targetDurationSeconds).toBe(15);
    expect(r.b.deck.scenes).toHaveLength(2);
  });

  it("returns kind:'one' for a body without VARIATION headings — v2 bodies are untouched", () => {
    expect(parseVariations(sceneDeck(SCENES))).toEqual({ kind: "one" });
    expect(parseVariations("just prose")).toEqual({ kind: "one" });
  });

  // ── 33-11: ONE BAD DECK NO LONGER KILLS ITS GOOD SIBLING ────────────────────────────────────
  //
  // THE RULE THIS REPLACES, and exactly how far: 33-01/33-03 refused the WHOLE proposal when
  // either variation refused, to stop "a silent one-deck fallback". The rationale it protected is
  // **never propose a deck nobody wrote** — and that is UNTOUCHED here: the surviving deck is one
  // the model really did write, whole and unedited. What changes is only the fate of its sibling.
  //
  // WHY IT HAD TO CHANGE (live, 2026-08-16, the owner's own two runs): requiring TWO legal decks
  // doubles the chance of a dead end, and both of the owner's attempts died this way — one on
  // variation A, one on variation B — throwing away a perfectly good storyboard each time. The
  // refusal then landed as a memo card with Approve/Save and no way forward.
  //
  // `salvaged` is NOT silent: it names the lost variation and its reason, and the caller is
  // obliged to say so on the canvas. A silent fallback would still be forbidden.
  // An UNREPAIRABLE variation B: every scene is a generated clip, so 33-12's grid repair has no
  // non-generated scene to give the freed seconds back to and correctly declines to touch it.
  // (Injecting a merely off-grid clip no longer works as a failure — 33-12 repairs those, which
  // is the point of 33-12.)
  // 33.1-04: the clip has to be ABOVE 15 now. It was 11 s, which was off sora-2's 4/8/12 grid and
  // is an ordinary length on grok's 1..15 — leaving it would have made this deck parse and turned
  // the three salvage tests below into assertions about nothing. 16 + 14 = 30, so the deck sums.
  const DECK_B_UNFIXABLE = sceneDeck(
    [
      `| 1 | generated_video | 16 | A calendar filling itself | ${S1} | |`,
      `| 2 | generated_video | 14 | Logo on black | ${S2} | |`,
    ],
    "Target duration: 30",
  );
  const twoUpBadB = [
    "## VARIATION A",
    "",
    sceneDeck(SCENES),
    "",
    "## VARIATION B",
    "",
    DECK_B_UNFIXABLE,
  ].join("\n");

  it("ONE good deck survives its sibling's refusal — salvaged, never silent", () => {
    const r = parseVariations(twoUpBadB);
    expect(r).toMatchObject({
      kind: "salvaged",
      keptVariation: "a",
      lostVariation: "b",
      reason: "illegal_generated_duration",
    });
    if (r.kind !== "salvaged") return;
    // The KEPT deck is variation A, entire and unmodified — 4 scenes summing to its declared 30.
    expect(r.kept.deck.targetDurationSeconds).toBe(30);
    expect(r.kept.deck.scenes).toHaveLength(4);
  });

  it("salvages symmetrically — a bad A keeps B", () => {
    // 33.1-04: was 8 -> 7. Seven seconds is legal on grok's grid, so that edit now produces a
    // `duration_mismatch` instead of a grid refusal — a different reason, and this test is about
    // the SALVAGE, not about which code. 8 -> 16 keeps it an illegal generated duration.
    const aIllegal = twoUp.replace("| 1 | generated_video | 8 |", "| 1 | generated_video | 16 |");
    expect(parseVariations(aIllegal)).toMatchObject({
      kind: "salvaged",
      keptVariation: "b",
      lostVariation: "a",
      reason: "illegal_generated_duration",
    });
  });

  it("BOTH variations refusing still refuses the whole proposal", () => {
    // The salvage has something to salvage FROM. When nothing parses, the old contract stands and
    // the reported variation is the FIRST to fail, so the message names a real deck.
    // A: 8 -> 16 makes the rows sum to 38 against a declared 30, so the repair declines (grid,
    // not arithmetic) and the grid refusal stands — 16 is above the top of the 1..15 grid. B is
    // the all-generated deck above.
    const bothBad = twoUpBadB.replace(
      "| 1 | generated_video | 8 |",
      "| 1 | generated_video | 16 |",
    );
    expect(parseVariations(bothBad)).toMatchObject({
      kind: "refused",
      variation: "a",
      reason: "illegal_generated_duration",
    });
  });

  it("a declared variation with no deck inside SALVAGES its sibling, and still says so", () => {
    // 33-11 CHANGED THIS CASE DELIBERATELY. It used to refuse the whole proposal, on the reading
    // that "no_deck is not 'fall back'". But from the user's chair a prose-only variation and a
    // malformed one are the same situation — exactly one usable storyboard exists — and dead-ending
    // on either is the failure the owner actually hit. `salvaged` is not the silent fallback the
    // old rule forbade: it carries `lostVariation` + `reason: "no_deck"`, which the canvas renders
    // as "it never wrote a scene deck". The proposal still discloses that it is one option, not two.
    const noB = [
      "## VARIATION A",
      "",
      sceneDeck(SCENES),
      "",
      "## VARIATION B",
      "",
      "Prose only.",
    ].join("\n");
    expect(parseVariations(noB)).toMatchObject({
      kind: "salvaged",
      keptVariation: "a",
      lostVariation: "b",
      reason: "no_deck",
    });
    const headingOnlyA = ["## VARIATION A", "", "## VARIATION B", "", DECK_B].join("\n");
    expect(parseVariations(headingOnlyA)).toMatchObject({
      kind: "salvaged",
      keptVariation: "b",
      lostVariation: "a",
      reason: "no_deck",
    });
    // One heading without its sibling is a declared-variations body missing a whole deck.
    expect(parseVariations(["## VARIATION A", "", sceneDeck(SCENES)].join("\n"))).toMatchObject({
      kind: "refused",
      variation: "b",
      reason: "no_deck",
    });
  });

  it("Source lines inside a variation survive the split (composes with the citation contract)", () => {
    const aWithSources = [
      sceneDeck(SCENES),
      "SCENE PROMPTS",
      "",
      "Scene 1",
      "- Source: The 2025 pricing one-pager [doc:k57abc123]",
      "",
    ].join("\n");
    const body = ["## VARIATION A", "", aWithSources, "", "## VARIATION B", "", DECK_B].join("\n");
    const r = parseVariations(body);
    expect(r.kind).toBe("two");
    if (r.kind !== "two") return;
    expect(r.a.deck.scenes[0]?.source).toEqual({
      docId: "k57abc123",
      title: "The 2025 pricing one-pager",
    });
    expect(r.b.deck.scenes[0]?.source).toBeUndefined(); // B's slice is clean — the split held
  });

  it("each variation keeps its own body slice, so per-variation SCRIPT/ART DIRECTION stay separate", () => {
    const r = parseVariations(twoUp);
    expect(r.kind).toBe("two");
    if (r.kind !== "two") return;
    expect(r.a.body).toContain("Target duration: 30");
    expect(r.a.body).not.toContain("Target duration: 15");
    expect(r.b.body).toContain("Target duration: 15");
    expect(r.b.body).not.toContain("Target duration: 30");
  });
});

// ── 33-13: the refusal vocabulary, now readable from BOTH halves ────────────────────────────────
//
// These sentences lived in `convex/dispatch.ts` while the memo body was the only place a user
// could read them. The canvas renders a proposal refusal as a failure card now, so `apps/web`
// needs the same words — and a second copy over there is exactly how one reason ends up saying
// two different things.
describe("deckRefusalClause (33-13)", () => {
  it("gives each contract its OWN sentence for the codes the two vocabularies share", () => {
    expect(deckRefusalClause("scene", "no_deck")).toBe("it never wrote a scene deck");
    expect(deckRefusalClause("block", "no_deck")).toBe("it never wrote a block deck");
    expect(deckRefusalClause("scene", "empty_deck")).not.toBe(
      deckRefusalClause("block", "empty_deck"),
    );
  });

  it("speaks every reason its own parser can produce", () => {
    const sceneReasons = [
      "no_deck",
      "empty_deck",
      "bad_target_duration",
      "unknown_visual_kind",
      "bad_scene_duration",
      "illegal_generated_duration",
      "missing_asset",
      "duration_mismatch",
      "no_narration",
      "narration_too_long",
      "malformed_source",
    ];
    for (const reason of sceneReasons) {
      expect(deckRefusalClause("scene", reason), reason).not.toBe(GENERIC_DECK_REFUSAL);
    }
    // The live one the owner actually hit, in words rather than in a code.
    expect(deckRefusalClause("scene", "illegal_generated_duration")).toBe(
      "a generated scene asked for a length the video model cannot produce",
    );
  });

  it("an unknown code falls back to the generic clause rather than printing itself", () => {
    expect(deckRefusalClause("scene", "http_502")).toBe(GENERIC_DECK_REFUSAL);
    expect(deckRefusalClause("block", "")).toBe(GENERIC_DECK_REFUSAL);
  });
});

/**
 * The production `no_deck` defect, 2026-08-17.
 *
 * All six heading matchers accepted `#` and none accepted `*`. A model that wrote `**SCENE DECK**`
 * — routine markdown for a heading the body asks for as a bare line — had its deck read as "this
 * body has no scene deck at all", fell through to `parseBlockDeck`, and was refused to the owner as
 * "it never wrote a block deck" while the deck sat fully written in the response.
 *
 * The refusal path must still refuse: a body with genuinely no deck is the OTHER cause of the same
 * code, and widening the heading must not swallow it.
 */
describe("a decorated heading is the SAME heading", () => {
  const bold = (body: string, token: string) => body.replace(token, `**${token}**`);

  it("parses a bolded SCENE DECK heading", () => {
    expect(parseSceneDeck(bold(sceneDeck(SCENES), "SCENE DECK")).ok).toBe(true);
  });

  it("parses a bolded BLOCK DECK heading — the fix is shared, not scene-only", () => {
    expect(parseBlockDeck(bold(deck(THREE), "BLOCK DECK")).ok).toBe(true);
  });

  it("tolerates a markdown heading and bold TOGETHER", () => {
    const body = sceneDeck(SCENES).replace("SCENE DECK", "## **SCENE DECK**");
    expect(parseSceneDeck(body).ok).toBe(true);
  });

  it("splits bolded VARIATION headings instead of reading the pair as one deck", () => {
    const one = sceneDeck(SCENES);
    const body = ["**VARIATION A**", one, "**VARIATION B**", one].join("\n\n");
    const v = parseVariations(body);
    expect(v.kind).toBe("two");
  });

  it("leaves a bare heading parsing exactly as before", () => {
    expect(parseSceneDeck(sceneDeck(SCENES)).ok).toBe(true);
    expect(parseVariations(sceneDeck(SCENES)).kind).toBe("one");
  });

  it("STILL refuses a body that carries no deck at all", () => {
    const r = parseSceneDeck("Here's my idea for the ad. It should feel warm and unhurried.");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_deck");
  });
});

/**
 * The production `bad_target_duration` defect, 2026-08-17 — the SECOND gate on the same body.
 *
 * Widening the six heading matchers let a bolded body past `no_deck` and straight into the next
 * matcher written the same narrow way. Five label matchers carried three different tolerances and
 * not one of them accepted `**Label:** value` — the colon INSIDE the bold, which is the most
 * ordinary way markdown writes a labelled field. The two with the narrowest tolerance,
 * `Clip seconds` and `Target duration`, are the two that gate an entire deck, so the owner's reel
 * refused twice in a row with the heading fix already live.
 *
 * `fieldOf` failed differently and worse: it MATCHED `**Mood:** warm` and captured `"** warm"`,
 * feeding decoration into an art direction that goes on to buy video. A refusal is loud; that one
 * was silent.
 */
describe("a decorated label is the SAME label", () => {
  it("reads a Target duration whose colon is inside the bold — the owner's live refusal", () => {
    expect(parseSceneDeck(sceneDeck(SCENES, "**Target duration:** 30")).ok).toBe(true);
  });

  it("reads a bulleted Target duration", () => {
    expect(parseSceneDeck(sceneDeck(SCENES, "- Target duration: 30")).ok).toBe(true);
  });

  it("reads Clip seconds the same way — the fix is shared, not scene-only", () => {
    expect(parseBlockDeck(deck(THREE, "**Clip seconds:** 10")).ok).toBe(true);
    expect(parseBlockDeck(deck(THREE, "- Clip seconds: 10")).ok).toBe(true);
  });

  it("leaves the bare and bold-around-label forms parsing exactly as before", () => {
    expect(parseSceneDeck(sceneDeck(SCENES, "Target duration: 30")).ok).toBe(true);
    expect(parseSceneDeck(sceneDeck(SCENES, "**Target duration**: 30")).ok).toBe(true);
    expect(parseSceneDeck(sceneDeck(SCENES, "Target duration: 30 seconds")).ok).toBe(true);
  });

  it("keeps decoration OUT of a captured value instead of matching and corrupting it", () => {
    const art = [
      "ART DIRECTION",
      "- **Palette:** #0F172A, #F8FAFC",
      "- **Mood:** warm and unhurried",
      "- **Lighting:** low side light",
      "- **Composition:** centred, shallow depth",
      "- **Environment:** a small workshop",
      "- **Texture:** grain, soft cloth",
      "- **References:** none",
      "- **Do NOT:** no stock footage",
      "",
      "SCENE DECK",
    ].join("\n");
    const a = parseArtDirection(art);
    expect(a).not.toBeNull();
    // The pre-fix capture was "** warm and unhurried" — matched, and wrong.
    expect(a?.mood).toBe("warm and unhurried");
    expect(a?.palette).toEqual(["#0F172A", "#F8FAFC"]);
    expect(a?.avoid).toBe("no stock footage");
  });

  it("STILL refuses a deck that declares no target at all", () => {
    const r = parseSceneDeck(sceneDeck(SCENES, ""));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("bad_target_duration");
  });

  it("STILL refuses a target that is off the 15/30/60 grid", () => {
    const r = parseSceneDeck(sceneDeck(SCENES, "**Target duration:** 20"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("bad_target_duration");
  });
});

/**
 * `no_deck` MEANS THE HEADING IS ABSENT — the third gate, 2026-08-17.
 *
 * Both parsers returned `no_deck` from THREE places: the heading, the table's header row, and a
 * missing required column. Only the first is "this body has no deck". `persistStoryboard` falls
 * back to `parseBlockDeck` on `no_deck` ALONE, with a comment stating that guard means "no SCENE
 * DECK heading at all" — so a scene deck with one renamed column fell through to the block
 * contract, found no BLOCK DECK heading, and the owner was told **"it never wrote a block deck"**
 * about a deck sitting fully written in the response. That is what production said after the
 * heading and label fixes landed.
 *
 * The table-shaped failures are `unreadable_deck` now. The distinction is load-bearing: a branch
 * reads it, so these tests assert the CODE, not just that something refused.
 */
describe("no_deck means the heading is absent, and nothing else", () => {
  /** A scene deck whose columns are plausible synonyms the parser does not know. */
  const renamedColumns = (rows: readonly string[]) =>
    [
      "SCENE DECK",
      "Target duration: 30",
      "",
      "| # | Shot | Length | Scene | Script |",
      "|---|------|--------|-------|--------|",
      ...rows,
      "",
    ].join("\n");

  it("a scene deck with unreadable columns is unreadable_deck, NOT no_deck", () => {
    const r = parseSceneDeck(renamedColumns(SCENES));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The whole point: this must NOT be the code persistStoryboard falls back to the block contract on.
    expect(r.reason).toBe("unreadable_deck");
  });

  it("a scene deck heading with no table at all is unreadable_deck too", () => {
    const r = parseSceneDeck("SCENE DECK\nTarget duration: 30\n\nI'll fill the shots in shortly.");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unreadable_deck");
  });

  it("a block deck with unreadable columns is unreadable_deck, NOT no_deck", () => {
    const body = [
      "BLOCK DECK",
      "Clip seconds: 10",
      "",
      "| # | Kind | Words |",
      "|---|---|---|",
      "| 1 | a | b |",
    ].join("\n");
    const r = parseBlockDeck(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unreadable_deck");
  });

  it("a body with genuinely NO heading is still no_deck — the fallback must keep working", () => {
    for (const parse of [parseSceneDeck, parseBlockDeck]) {
      const r = parse("Here's my idea for the ad. It should feel warm and unhurried.");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("no_deck");
    }
  });

  it("both contracts say the columns out loud instead of borrowing 'it never wrote a deck'", () => {
    for (const contract of ["scene", "block"] as const) {
      const clause = deckRefusalClause(contract, "unreadable_deck");
      expect(clause).not.toBe(GENERIC_DECK_REFUSAL);
      expect(clause).toMatch(/could not be read/i);
      expect(clause).toMatch(/columns/i);
      expect(clause).not.toMatch(/never wrote/i);
    }
    // And the two contracts still name their OWN columns — one vocabulary, two tables.
    expect(deckRefusalClause("scene", "unreadable_deck")).toMatch(/Visual, Seconds/);
    expect(deckRefusalClause("block", "unreadable_deck")).toMatch(/Type, Description/);
  });
});

// ── SILENCE MEANS UNVERIFIED (the citation default, inverted) ──────────────────────────────────
//
// The parser used to read a scene with no `Source:` line as claiming nothing, which trusted the
// model to volunteer that it had made a claim. `media-director.md` mandates the line in prose and
// `dispatch.ts` records the measured worth of a prose mandate on this exact skill family: violated
// twice in six attempts. These tests pin the inversion and, just as importantly, its BOUNDARY —
// a gate that fires on ordinary copy gets confirmed blind and then guards nothing.

describe("statesCheckableClaim: a number is not a claim until it measures something", () => {
  it("flags a quantity attached to a unit", () => {
    for (const line of [
      "Founders lose ninety minutes a day to the inbox.",
      "Ninety minutes a day is a full working week every month.",
      "Most of it is replies you have written a hundred times before.",
      "We onboarded 40 customers last quarter.",
      "It takes 3 days.",
    ]) {
      expect(statesCheckableClaim(line), line).toBe(true);
    }
  });

  it("flags a figure carrying its own symbol, and an appeal to evidence", () => {
    for (const line of ["90% FASTER", "We save you $2,000", "Cuts costs by 40%"]) {
      expect(statesCheckableClaim(line), line).toBe(true);
    }
    // The purest form of the failure: authority borrowed and never named.
    for (const line of [
      "Studies show it works",
      "According to recent research, founders lose time",
      "On average, replies take longer",
    ]) {
      expect(statesCheckableClaim(line), line).toBe(true);
    }
  });

  it("DOES NOT flag ordinary copy — the boundary that keeps the gate meaningful", () => {
    // Every one of these is real product prose from the skill body's own worked examples, or the
    // shape of it. A numeral appears in the first; it measures nothing, so it is not a claim.
    for (const line of [
      "You read one screen and decide. Nothing leaves without you.",
      "Pikar reads the whole thread overnight and drafts the reply in your voice.",
      "Pikar drafts the whole queue overnight, in your words.",
      "Nothing sends until you approve it, and every send is written down.",
      "YOUR INBOX, ANSWERED",
      "YOU APPROVE",
      "",
    ]) {
      expect(statesCheckableClaim(line), line).toBe(false);
    }
  });

  it("is measured against the worked examples, not against its own examples", () => {
    // The corpus check, kept as a test so a later widening of the keyword lists has to face it.
    // Flagging B2's "ONE WEEK A MONTH" is DELIBERATE and is not a false positive: it restates the
    // sourced figure from the scene before it and carries no citation of its own.
    const sourcedInExamples = [
      "Founders lose ninety minutes a day to the inbox.",
      "Most of it is replies you have written a hundred times before, in slightly different words.",
      "Ninety minutes a day is a full working week every month.",
    ];
    for (const line of sourcedInExamples) {
      expect(
        statesCheckableClaim(line),
        `a SOURCED example line must flag when uncited: ${line}`,
      ).toBe(true);
    }
  });
});

describe("parseSceneDeck: an uncited claim is flagged for confirmation, not waved through", () => {
  const deck = (narration: string, overlay: string, source?: string) => `
SCENE DECK
Target duration: 15
| # | Visual | Seconds | Description | Narration | Text overlay | Asset |
|---|--------|---------|-------------|-----------|--------------|-------|
| 1 | animated_image | 15 | a desk | ${narration} | ${overlay} | |

SCENE PROMPTS

Scene 1
Prompt: a desk
${source === undefined ? "" : `Source: ${source}`}
`;

  const sceneOf = (narration: string, overlay = "", source?: string) => {
    const r = parseSceneDeck(deck(narration, overlay, source));
    expect(r.ok, `deck refused: ${r.ok ? "" : r.reason}`).toBe(true);
    return r.ok ? r.scenes[0] : undefined;
  };

  it("THE INVERSION: an uncited figure is now needsConfirmation", () => {
    // Before this, the scene parsed clean, the money gate saw nothing to confirm, and the figure
    // reached a rendered frame. Nothing downstream could have caught it.
    expect(sceneOf("Founders lose ninety minutes a day to the inbox.")?.needsConfirmation).toBe(
      true,
    );
  });

  it("an OVERLAY claim is flagged too — it is the loudest text in the reel and nobody speaks it", () => {
    expect(sceneOf("Here is how it works.", "90% FASTER")?.needsConfirmation).toBe(true);
  });

  it("ordinary copy still parses clean, with no flag and no source", () => {
    const scene = sceneOf("You read one screen and decide.", "YOUR INBOX, ANSWERED");
    expect(scene?.needsConfirmation).toBeUndefined();
    expect(scene?.source).toBeUndefined();
  });

  it("a CITED claim is not flagged — citing is the way out, and it still works", () => {
    const scene = sceneOf("Founders lose ninety minutes a day.", "", "Time audit [doc:k57h3n9v2]");
    expect(scene?.needsConfirmation).toBeUndefined();
    expect(scene?.source).toEqual({ docId: "k57h3n9v2", title: "Time audit" });
  });

  it("an explicit `Source: unverified` still flags, exactly as before", () => {
    // The old path is untouched: this change ADDS scenes to the flagged set, it does not
    // reinterpret the ones the model labelled itself.
    expect(sceneOf("Something qualitative.", "", "unverified")?.needsConfirmation).toBe(true);
  });
});
