# 20-03 — SUMMARY

**Plan:** the `media-director` skill — the koda-stack media workflow as ONE versioned registry row,
deliberately UNGATED, pinned to the shipped parser by a round trip. **Status: complete**
(2026-08-02). **Cost: $0** — no eval run, no paid gate, nothing calls a model.

## The two decisions the plan asked to be recorded

**ONE row, not four.** The specialist runs ONE dispatched turn and a `SpecialistSpec.skillName` is
ONE string; four rows would need a composing dispatcher this repo does not have, and each extra row
is a second version stream to manage. The body produces all four sections — SCRIPT, ART DIRECTION,
BLOCK DECK, BLOCK PROMPTS — in that turn.

**UNGATED, and `skillBodies.test.ts` now asserts it.** Two independent reasons:

- *Mechanical:* `run-eval-golden.mjs` hard-validates `--skill` against a closed name list and drives
  `runCockpitAgent` over TEXT fixtures. It structurally cannot drive a storyboard turn, so gating
  would DEADLOCK the skill at v1 — the first body edit mints a candidate no runner could certify.
  The `document-analyst` mechanism exactly.
- *Substantive:* the guarantees are CODE, not prose. `searchVault` is the only grant, so the
  specialist cannot spend a cent (D2); the narration character band is enforced by the parser
  whatever the body says; the model comes from a price table the body cannot name into; the budget
  rail is code. And unlike `inbox-digest` / `reply-drafter` / `research-specialist`, this skill
  ingests no untrusted third-party content — only the tenant's own profile, blueprint and vault.

## Files (the five-file `documentDrafter` mirror, plus the round trip)

| file | what |
|---|---|
| `packages/contracts/skills/media-director.md` | the canonical body — 8,412 bytes, four sections, MIT attribution |
| `packages/contracts/src/skills/mediaDirector.ts` | the AUTO-DERIVED bundler-safe constant |
| `packages/contracts/src/skill.ts` | `MEDIA_DIRECTOR_SKILL`, with the UNGATED doc comment |
| `packages/contracts/src/skills/skillBodies.test.ts` | the drift row + the UNGATED assertion |
| `packages/backend/convex/skills.ts` | the import and the `seeds` entry |
| `packages/core/src/storyboard.test.ts` | the round trip (7 new assertions) |
| `docs/playbooks/skill-registry.md` | bumped, with the inventory entry and its rationale |

## The D8 reversal is applied, not straddled

`20-RESEARCH.md` §9.2's instruction — *"the deck is a SET OF ASSETS, not a reel … the body must not
promise a finished video"* — is **deleted, not softened**. The body now says plainly: the blocks are
generated, the narration is voiced, the whole thing is assembled into ONE mp4, and total length is
`blocks × clip seconds`. A body that said both would say the wrong one half the time.

What the body still must NOT promise, and says so: music, a sung track, re-cutting the user's own
footage, or anything longer than the budget allows.

## Deviations from the plan

1. **The body teaches a BAND, not a ceiling** — 103–140 characters at 10 s, 43–70 at 5 s. The plan
   specified only *"at most 140 characters"*, but harvesting the assembler in 20-13 showed a take
   that is too SHORT is a hard error too (`[clipSeconds - 1.4, clipSeconds]`), and both refusals
   land after the clips are paid for. Teaching only the ceiling would have taught half the rule.
   See the `fix(20-01)` commits.
2. **The round-trip test asserts `prompt !== description` for at least one block.** The plan's
   `Block.prompt` had no specified source; 20-01 made it parse from an optional `BLOCK PROMPTS`
   section with a fallback to the description. Without this assertion the body could drop section 4
   entirely and every generation prompt would silently degrade to a visual description — not a
   parse failure, and nothing anyone would notice until the images came back generic.
3. **`Settings:` has no `Model:` line and no voice/speed direction**, per the plan — and the body
   says WHY in each case (an invented model is a model nobody priced; a speed instruction asks for
   the time-stretch the assembler refuses).
4. **The MIT attribution line is carried from the plan's research record**, dated 2026-08-01. This
   session did not re-fetch koda-stack; it fetched the Higgsfield assembler (20-13). The prompt
   SHAPES are as D6 recorded them.

## Verification

- `pnpm --filter @pikar/contracts test` — 23/23 green (drift row + UNGATED assertion).
- `pnpm --filter @pikar/core test` — 437/437 green, including the 7-assertion round trip.
- `@pikar/contracts` typecheck clean; backend typecheck **13 errors, unchanged baseline, delta 0**.
- **Three mutation checks observed RED, then restored:**
  - one character changed in the `.md` without regenerating the `.ts` → the drift row fired;
  - `MEDIA_DIRECTOR_SKILL` added to `GATED_SKILLS` → the UNGATED assertion fired;
  - the body's table header renamed (`Type`→`Kind` …) → the round trip fired with `no_deck`, which
    is precisely the silent failure this test exists to catch.

## What the next plans inherit

- **20-08** wires `skillName: "media-director"` and calls `persistStoryboard` with the parsed deck.
  The body's output maps field-for-field onto `plans.shots` (20-02).
- **20-12** is the ONLY plan permitted to touch `cockpit-agent.md`; nothing here went near it, so
  the Lane-R narrowing holds.
- **Nobody** may add an `assemble` seed entry — `llmRedaction.test.ts` scans for it (20-13).
