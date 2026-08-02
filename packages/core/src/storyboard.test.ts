// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLIP_SECONDS,
  DEFAULT_CLIP_SECONDS,
  isPaidBlock,
  MAX_CHARS_PER_BLOCK,
  maxCharsFor,
  minCharsFor,
  narrationChars,
  parseBlockDeck,
  SHOT_TYPES,
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
    expect(body).toContain(String(maxCharsFor(10)));
    expect(body).toContain(String(minCharsFor(10)));
    expect(body).toContain("searchVault");
  });
});
