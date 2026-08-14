// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLIP_SECONDS,
  DEFAULT_CLIP_SECONDS,
  hasAssetSource,
  isPaidBlock,
  isPaidScene,
  MAX_CHARS_PER_BLOCK,
  maxCharsFor,
  minCharsFor,
  narrationCeilingSeconds,
  narrationChars,
  parseArtDirection,
  parseBlockDeck,
  parseSceneDeck,
  parseScript,
  SHOT_TYPES,
  sceneNarrationChars,
  TARGET_DURATIONS,
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

  it("a table missing a required column → no_deck", () => {
    const body = [
      "BLOCK DECK",
      "Clip seconds: 10",
      "| # | Type | Description |",
      "|---|------|-------------|",
      "| 1 | VIDEO | A shot |",
    ].join("\n");
    const r = parseBlockDeck(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_deck");
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
describe("media-director.md round trip — the body's example survives its own rules", () => {
  const body = readFileSync(
    fileURLToPath(new URL("../../contracts/skills/media-director.md", import.meta.url)),
    "utf8",
  );
  const r = parseBlockDeck(body);

  it("parses to a deck of at least 2 blocks, in index order", () => {
    expect(r.ok, `the body's BLOCK DECK did not parse: ${r.ok ? "" : r.reason}`).toBe(true);
    if (!r.ok) return;
    expect(r.blocks.length).toBeGreaterThanOrEqual(2);
    expect(r.blocks.map((b) => b.index)).toEqual(r.blocks.map((_, i) => i));
  });

  it("every type is a member of the closed SHOT_TYPES set", () => {
    if (!r.ok) throw new Error("expected ok");
    for (const b of r.blocks) expect(SHOT_TYPES).toContain(b.type);
  });

  it("the deck's clipSeconds is legal and EVERY block matches it", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(CLIP_SECONDS).toContain(r.clipSeconds);
    for (const b of r.blocks) expect(b.seconds).toBe(r.clipSeconds);
  });

  it("every narration in the worked example obeys the band the body TEACHES", () => {
    // A worked example that violates its own rule is how a model learns the rule is optional.
    if (!r.ok) throw new Error("expected ok");
    for (const b of r.blocks) {
      expect(b.narration.length, `block ${b.index} narration`).toBeGreaterThanOrEqual(
        minCharsFor(r.clipSeconds),
      );
      expect(b.narration.length, `block ${b.index} narration`).toBeLessThanOrEqual(
        maxCharsFor(r.clipSeconds),
      );
    }
  });

  it("windowStartMs is strictly increasing and derived", () => {
    if (!r.ok) throw new Error("expected ok");
    for (const b of r.blocks) expect(b.windowStartMs).toBe(b.index * r.clipSeconds * 1000);
    const starts = r.blocks.map((b) => b.windowStartMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("the BLOCK PROMPTS section is actually reached — a prompt differs from its description", () => {
    // Without this the body could drop section 4 entirely and every prompt would silently
    // degrade to the block's visual description, which is not a parse failure and not a lie
    // anyone would notice until the images came back generic.
    if (!r.ok) throw new Error("expected ok");
    expect(r.blocks.some((b) => b.prompt !== b.description)).toBe(true);
  });

  it("the body teaches the character band it is held to, and names its only tool", () => {
    expect(body).toContain(String(maxCharsFor(DEFAULT_CLIP_SECONDS)));
    expect(body).toContain(String(minCharsFor(DEFAULT_CLIP_SECONDS)));
    expect(body).toContain("searchVault");
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
  it("refuses a generated clip off the 4/8/12 grid, naming the scene", () => {
    // A 6-second Sora request is a REFUSED request, not a shorter clip — and finding that out at
    // submit means the rest of the deck has already been bought.
    const offGrid = [
      `| 1 | generated_video | 6 | Founder at a desk | ${S2} | | |`,
      `| 2 | animated_image | 24 | Mail icons | ${S4} | | |`,
    ];
    expect(parseSceneDeck(sceneDeck(offGrid))).toMatchObject({
      reason: "illegal_generated_duration",
      sceneIndex: 0,
    });
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

  it("refuses a line that would run into the NEXT line, naming its window", () => {
    const tooLong = `${S4} ${S4} ${S4}`; // 200+ chars against an 8-second, 112-character window
    const rows = [
      `| 1 | generated_video | 8 | Founder at a desk | ${tooLong} | | |`,
      `| 2 | animated_image | 22 | Mail icons | ${S2} | | |`,
    ];
    expect(parseSceneDeck(sceneDeck(rows))).toMatchObject({
      reason: "narration_too_long",
      sceneIndex: 0,
      chars: tooLong.length,
      availableSeconds: 8,
    });
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

  it("migrates a legacy TYPE but not a legacy DURATION — an old Wan deck still refuses", () => {
    // The block contract's clip lengths were 5 and 10 seconds; Sora's grid is 4/8/12. So the
    // migration map alone does NOT make an old deck renderable, and pretending otherwise would
    // move the failure from this parser into a paid submit. Six 5-second AI blocks = 30 s, a deck
    // that sums perfectly and still cannot be generated.
    const oldWan = Array.from(
      { length: 6 },
      (_, i) => `| ${i + 1} | AI | 5 | Mail icons | ${S3} | | |`,
    );
    expect(parseSceneDeck(sceneDeck(oldWan))).toMatchObject({
      reason: "illegal_generated_duration",
      sceneIndex: 0,
    });
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
    expect(parseSceneDeck(noSeconds)).toMatchObject({ reason: "no_deck" });
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
