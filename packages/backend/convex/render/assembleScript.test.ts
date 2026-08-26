// @vitest-environment node
//
// The .sh ↔ .ts mirror, and the tripwires on what the harvested script may contain.
//
// Why the node pragma: backend vitest runs `edge-runtime`, which has no `node:fs`. The
// `traceParity.test.ts` / `cockpitTools.test.ts` precedent.
//
// Why a mirror at all: the Convex runtime cannot `fs.read` repo files, so the Vercel Sandbox
// runner (plan 20-15) ships the script as a STRING. The `.sh` stays canonical because a shell
// script inside a TS string literal is unreviewable and unlintable. Drift between the two means
// the sandbox runs a script nobody read — so it is a test, not a convention.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { assembleScriptBody } from "./assembleScript";

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const SH = lf(readFileSync(fileURLToPath(new URL("./assemble_final.sh", import.meta.url)), "utf8"));

test("assemble_final.sh === its derived constant (byte-identical, LF-normalized)", () => {
  expect(lf(assembleScriptBody)).toBe(SH);
});

// Non-vacuity floor (house rule): if the read ever returns nothing, this must fail LOUDLY rather
// than pass by comparing two empty strings.
test("the mirror is not vacuously equal", () => {
  expect(SH.length).toBeGreaterThan(5_000);
  expect(SH).toContain("assembly.json");
  expect(SH).toContain("speech_abs_s");
});

// Delta pitfall 15's second tripwire, and the deferred-feature guard, in one. `atempo` and
// `setpts` are ffmpeg's time-stretch filters: D8 makes an overrunning voice line a HARD ERROR to
// be rewritten upstream, never something to rate-shift around, and a stretch is audible in a way
// no test downstream would catch.
//
// `--music` WAS on the deferred list below and was REMOVED from it deliberately, which is the
// event this assertion was shaped to force: the script's header called re-adding it "a scope
// decision, not a patch", and the list said "must not be re-added SILENTLY". It was re-added
// loudly — by editing this line, in the same change that added the bed, with the bed's own
// tripwires below. `--song` (music-video mode) and `--stepped` (on-twos cadence) are still scope
// nobody has earned, and are still guarded.
test("no time-stretch filter and no deferred-mode flag survives in the harvested script", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#")) // strip comments — the 15.2-07 lesson
    .join("\n");
  // The two filters are anchored on `=` because an ffmpeg filter is ALWAYS `atempo=1.05` /
  // `setpts=0.9*PTS`, while the bare word appears legitimately inside the script's own error
  // message ("never pad, atempo, or trim speech") — which is the instruction, not the offence.
  // Same reasoning as the rate-knob scan in packages/cost/src/media.test.ts.
  for (const filter of ["atempo=", "setpts="]) {
    expect(code, `${filter} is a time-stretch filter and must never appear`).not.toContain(filter);
  }
  for (const flag of ["--song", "--stepped"]) {
    expect(code, `${flag} is deferred scope and must not be re-added silently`).not.toContain(flag);
  }
});

// ── The music bed ───────────────────────────────────────────────────────────────────────────────
//
// Source tripwires, same instrument and same reason as the scene branches: a shell script cannot
// be unit-tested, and the behavioural half is `smoke_assemble.sh`. What these pin is the SHAPE that
// makes the bed safe — every one of them is a way a well-meaning "make the music better" edit
// would quietly break something that has nothing to do with music.

test("the bed cannot make the narration assert vacuous — the level margin is a GATE", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // THE LOAD-BEARING PAIR, and the whole reason this test exists. The narration assert proves a
  // take reached the mix by finding NO span quieter than -18dB across its speech window. A bed
  // louder than that threshold would hold a silent window above it, and the assert would pass on a
  // reel with no narration in it — the "silent second half" failure, reopened by a decoration.
  //
  // Pinned as VALUES, not as "is there a loudnorm": someone raising the bed toward the voice is
  // exactly the plausible future edit, and it has to come past this assertion to do it.
  expect(code, "the bed's true-peak ceiling is pinned in the script").toContain('MUSIC_TP="-24"');
  expect(code, "and the narration assert's threshold is the number it must stay under").toContain(
    "silencedetect=noise=-18dB",
  );
  const tp = Number(/MUSIC_TP="(-?\d+)"/.exec(code)?.[1]);
  expect(tp, "the bed must sit at least 3dB below the narration assert's -18dB floor").toBeLessThan(
    -21,
  );
  // THE CEILING IS alimiter's, NOT loudnorm's — and this assertion exists because the first
  // version of this code got that wrong. `loudnorm`'s own `TP` accepts only [-9, 0], so asking it
  // for -24 is not a silent no-op: ffmpeg exits with "out of range", the bed fails to build, and
  // the reel renders bedless while every source tripwire stays green. Pinning the MECHANISM, not
  // just the number, is what makes that unrepeatable.
  expect(code, "the peak is clamped by a hard limiter, which can express -24").toContain(
    "alimiter=limit=${MUSIC_PEAK}",
  );
  // alimiter's auto-level normalises its output back to 0dB by DEFAULT, which would undo the very
  // limit it was asked to apply — and leave a full-scale bed sitting over the narration assert.
  expect(code, "alimiter's auto-level must stay OFF or the limit is undone").toContain(
    "alimiter=limit=${MUSIC_PEAK}:level=disabled",
  );
  // …and loudnorm is asked only for a value inside its own range.
  const lnTp = /loudnorm=I=\$\{MUSIC_I\}:TP=(-?\d+)/.exec(code)?.[1];
  expect(Number(lnTp), "loudnorm's TP must be within [-9, 0]").toBeGreaterThanOrEqual(-9);
  // The linear limit is DERIVED from the dB constant, so the two cannot drift into disagreeing.
  expect(code, "the linear peak is computed from MUSIC_TP, never hand-written").toContain(
    "10^(d/20)",
  );
  expect(code, "the music input enters the mix with no volume knob of its own").not.toMatch(
    /\[mus\][^;]*volume=/,
  );
});

test("the bed is STATIC — sidechain ducking would make the level unprovable", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // A compressor's output level is a function of the voice over time. The bound asserted above is
  // a constant, and there is no source tripwire that can pin a release curve — so ducking would
  // trade a provable property for an audible one. If it is ever wanted, the assert has to be
  // reworked FIRST.
  expect(code, "sidechaincompress makes the bed's level time-varying").not.toContain(
    "sidechaincompress",
  );
});

test("the bed cannot change the reel's length and cannot move a take", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // Built to exactly TOT — looped up if short, cut if long — so the fixed-length guarantee is
  // untouched by construction rather than by a check.
  expect(code, "the bed is looped and then cut to the reel's own length").toMatch(
    /-stream_loop -1 -i "\$MTRACK" -t "\$TOT"/,
  );
  // It enters at offset 0 with no delay. `adelay` on the music input would mean the bed has a
  // PLACEMENT, and a placement is a thing that can be computed wrong against a take.
  expect(code, "the music input takes no part in speech placement").not.toMatch(
    /\[mus\][^;]*adelay=/,
  );
  // And it is still ONE mix. This is asserted in the wave-4 test too; repeated here because the
  // obvious way to add music is a second pass over the finished file, which would also be the way
  // to bypass every gate that runs between the mix and the output.
  expect(code.match(/amix=/g) ?? [], "there must still be exactly one amix").toHaveLength(1);
});

test("a missing track DEGRADES and says so; a malformed slug REFUSES", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The two are different failures on purpose. A slug with no track behind it is a deployment
  // state (a snapshot baked before that mood existed) and must not kill a paid render. A slug
  // that is not a slug is a caller bug — and it is about to be interpolated into a path.
  expect(code, "the slug's charset is bounded before it reaches a path").toContain(
    "^[a-z][a-z0-9-]{0,23}$",
  );
  expect(SH, "a malformed slug is a hard refusal").toMatch(/--music must be a lowercase mood slug/);
  expect(SH, "a missing track warns and renders on").toMatch(/rendering with NO music bed/);
  // NOT SILENT. The sidecar reports what reached the mix, so "the bed was missing" and "there was
  // no bed" are distinguishable after the fact. `MUSIC_USED` starts at "none" and is only ever set
  // once the bed has actually been built.
  expect(code, "the sidecar reports the bed that was USED, not the one requested").toContain(
    '"music":"%s"',
  );
  expect(code, "and it defaults to none rather than to the request").toContain('MUSIC_USED="none"');
});

// The five inherited properties, each one a failure that has actually happened. If a future edit
// drops one, this names which.
test("the harvested contract's five properties are all still present", () => {
  expect(SH, "fixed-length windows").toContain("--clip-seconds");
  expect(SH, "clip must cover its window").toMatch(/REGENERATE the block/);
  // Wave 4 moved this from the CELL to the TIMELINE. The property is unchanged — an overrunning
  // line is rewritten upstream, never stretched — so it is still asserted here, on the two ways
  // speech can overrun once it is free to cross a scene boundary.
  expect(SH, "a line past the end of the reel is a hard error").toMatch(/would be cut mid-word/);
  expect(SH, "two lines at once is a hard error").toMatch(/two narrators would speak at once/);
  expect(SH, "and the fix is upstream, never a stretch").toMatch(/REWRITE it shorter/);
  expect(SH, "speech-centred via silencedetect").toContain("silencedetect=noise=-45dB");
  expect(SH, "narration assert over the narrated spans").toMatch(/is NOT in the mix/);
  expect(SH, "the sidecar is written").toContain('"gates":[');
});

// ── 20.2 wave 3: the scene branches ─────────────────────────────────────────────────────────────
//
// A shell script cannot be unit-tested, so these are SOURCE tripwires — the same instrument the
// three tests above use, for the same reason. The behavioural half is `smoke_assemble.sh`, which
// renders a real 30-second reel from a clip, a still, a drawn card and a silent scene, and asserts
// the sidecar. Neither half substitutes for the other: a tripwire cannot tell you the card drew,
// and the smoke does not run in CI.

test("EXPANSION IS OFF on the card — this is a trust boundary, not a formatting choice", () => {
  // The card's words are model-authored. With drawtext's default expansion, `%{...}` in the text
  // file is EVALUATED as an ffmpeg expression inside the VM that holds tenant media. `textfile=`
  // (not `text=`) removes the shell/filtergraph escaping problem; `expansion=none` removes the
  // evaluation. Deleting either one is a silent capability grant, so both are pinned.
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  expect(code, "the card must read its words from a FILE, never an inlined argument").toContain(
    "textfile=",
  );
  expect(code, "drawtext must not evaluate %{...} in model-authored text").toContain(
    "expansion=none",
  );
  expect(code, "a card must never be built by interpolating text into the filtergraph").not.toMatch(
    /drawtext=[^\n]*\btext=/,
  );
});

test("a build that cannot draw REFUSES, rather than shipping a black rectangle", () => {
  // The `burn_caps.sh` libass precedent. A minimal ffmpeg has no drawtext, and a card scene that
  // silently rendered nothing would pass every downstream gate — the file decodes, the duration is
  // right, the sidecar is well-formed. Only the picture is missing.
  expect(SH).toContain("has no 'drawtext' filter");
  expect(SH, "a missing font is named with its fix, not left to ffmpeg").toMatch(
    /needs a TrueType font and none was found/,
  );
  expect(
    SH,
    "grep -q under pipefail can turn a successful filter probe into SIGPIPE 141",
  ).not.toMatch(/ffmpeg[^\n]*-filters[^\n]*\|\s*grep\s+-q/);
});

test("the concat list is RELATIVE — an absolute path is a portability trap", () => {
  // The demuxer resolves each entry against the list file's own directory, and every scene is
  // written beside it. Absolute paths broke the first smoke run outright.
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The variable is deliberately not pinned here — wave 4 changed WHAT is listed (the silent
  // picture, not a per-scene mux) and that belongs in its own test. This one owns `basename`.
  expect(code).toContain("echo \"file '$(basename ");
});

// ── 20.2 wave 4: the master audio timeline ─────────────────────────────────────────────────────
//
// Source tripwires again, for the same reason: the behavioural half is `smoke_assemble.sh`, which
// renders a 6-second scene carrying 7.2 seconds of speech and then re-renders the same deck
// through a sabotaged copy to watch the narration assert go red. These pin the SHAPE that makes
// that possible, so it cannot be undone by a well-meaning edit that still passes a green smoke.

test("audio is mixed ONCE, on one timeline — not per scene and concatenated", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // Two amix calls means two mixing units, which means the scene is a mixing unit again — and the
  // per-cell band follows from that, not the other way round.
  expect(code.match(/amix=/g) ?? [], "there must be exactly one amix").toHaveLength(1);
  expect(code, "the mix must not be divided down by its own input count").toContain("normalize=0");
  // The concat list carries the PICTURE, which is silent by construction. Listing a per-scene mux
  // here is what the old shape did.
  expect(code).toContain('echo "file \'$(basename "$pic")\'"');
  expect(code, "the picture track is joined with no audio at all").toContain("-an -c:v libx264");
});

test("the per-cell speech band is GONE, and did not come back as a constant", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The band was `[SEC-1.4, SEC]`, enforced per scene. Wave 4's whole deliverable is its removal;
  // a re-added floor or ceiling would silently restore "narration written for a 56-character
  // cell" while every other test here stayed green.
  for (const gone of ["SPEECH_MIN", "SPEECH_MAX", "c-1.4"]) {
    expect(code, `${gone} is the per-cell band and must not return`).not.toContain(gone);
  }
  // …and the replacement is a check against the REEL, not against the scene.
  expect(code, "the reel's own end is what speech is bounded by").toContain('-v t="$TOT"');
});

test("the declared target is asserted before any work AND on the output, at 0.5s", () => {
  expect(SH, "--target-seconds is the declared length").toContain("--target-seconds");
  expect(SH, "a deck that does not sum to its target is refused while it is still free").toMatch(
    /the assembler will not pad or trim to reach a target/,
  );
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The tolerance is the guarantee. 1s was sized for provider-returned clip lengths; every
  // duration on a scene timeline is one this script built to.
  expect(code, "the output tolerance is 0.5s, not 1s").toContain("exit (x<=0.5)?0:1");
  expect(code, "and it is measured against the DECLARED target").toContain('-v e="$TARGET"');
});

// ── 20.2 wave 5: the sidecar the validator actually reads ──────────────────────────────────────
//
// The script WRITES the sidecar and `packages/core/src/assembly.ts` READS it, and nothing else
// connects the two — they are a shell printf and a TS parser in different packages. A rename on
// either side is invisible to both test suites (each one is self-consistent) and shows up as a
// governed render being refused at publish. This is the tie.

test("the sidecar printf emits EXACTLY the field names the validator requires", () => {
  // Kept as a literal list rather than derived: the point is that changing either side has to
  // change this line too, which is the moment someone notices there are two sides.
  for (const field of [
    '"scene_count"',
    '"target_duration_s"',
    '"total_duration_s"',
    '"actual_duration_s"',
    '"gates"',
    '"scenes"',
  ]) {
    expect(SH, `${field} is a top-level field parseAssemblySidecar requires`).toContain(field);
  }
  for (const field of [
    '"index"',
    '"start_s"',
    '"duration_s"',
    '"visual"',
    '"lead_silence_s"',
    '"speech_abs_s"',
    '"speech_dur_s"',
    '"overrun"',
  ]) {
    expect(SH, `${field} is a per-scene field parseAssemblySidecar requires`).toContain(field);
  }
});

test("the retired v1 sidecar fields are GONE from the script, not merely unused", () => {
  // `assembly.ts` refuses a sidecar carrying any of these BY NAME, so a script that still writes
  // one produces a reel that renders and can never be published. Deleting them here is what makes
  // that refusal unreachable rather than merely unlikely.
  for (const gone of ['"block_count"', '"clip_seconds"', '"blocks"', '"block_index"']) {
    expect(SH, `${gone} is the v1 shape and the validator refuses it`).not.toContain(gone);
  }
});

test("the uniform BLOCK contract is still expressible, and is not a second code path", () => {
  // `--blocks N --clip-seconds C` fills the SAME scene arrays with N entries of `video:C`. That is
  // what lets the live block contract keep rendering byte-identically while the scene contract is
  // still being built. A second loop would be two things to keep in step.
  expect(SH).toContain('KINDS+=("video"); SECS+=("$CLIP")');
  expect(SH, "the two shapes must not be combinable").toContain(
    "pass --scene OR --blocks, never both",
  );
});

// ── THE CARD PALETTE (phase 3) ─────────────────────────────────────────────────────────────────
//
// Source tripwires, and their limits are worth stating: reading the script as TEXT proves SPELLING,
// not validity. The behavioural half of this feature was verified by running `assemble_final.sh`
// end to end against real ffmpeg — a palette card whose pixels were sampled at 26,75,67 against a
// requested 0x1B4B43, an unflagged run that stayed 0,0,0, and a malformed colour refused with
// exit 2. These tests exist to catch a later edit silently removing what that run proved.

test("the colour charset is asserted BEFORE either value reaches a filtergraph", () => {
  // The load-bearing one. A card's WORDS are kept out of the filter string by `textfile=`, so a
  // colour is the first model-derived value that is written INTO it. Without this guard the whole
  // `expansion=none` trust boundary is reopened one option to the left.
  expect(SH).toContain('=~ ^0x[0-9A-Fa-f]{6}$');
  expect(SH, "a malformed colour is a caller bug and exits, never a guessed replacement").toContain(
    "--card-bg/--card-ink must be 0xRRGGBB",
  );
  // Asserted for BOTH values, not just the background: the ink is interpolated identically.
  expect(SH).toContain('for c in "$CARD_BG" "$CARD_INK"');
});

test("the defaults ARE the pre-palette card, so an unflagged reel is byte-identical", () => {
  expect(SH).toContain('CARD_BG="0x000000"');
  expect(SH).toContain('CARD_INK="0xFFFFFF"');
});

test("the card still uses textfile= and expansion=none — the palette did not weaken them", () => {
  // The regression that would matter most: adding colour by switching to `text=` would put the
  // model's WORDS in the filter string too, which is the exact hole the card branch was built to
  // avoid. Re-asserted here because this change edited that very line.
  expect(SH).toContain("textfile='${txt}':expansion=none");
  expect(SH, "drawtext must never take the words inline").not.toContain("drawtext=text=");
});

test("the fade is drawn INSIDE the scene and cannot move a boundary", () => {
  // A card is still built to exactly SEC. The fade is capped at a third of the scene so a short
  // card is not still arriving when it should be landing, and it is a filter on the picture — it
  // never becomes a duration term.
  expect(SH).toContain("fade=t=in:st=0:d=${CFADE}");
  expect(SH).toContain('if(d>0.4)d=0.4');
  // The card branch's own length still comes from SEC and nothing else.
  expect(SH).toContain('-an -t "$SEC" -c:v libx264 -preset veryfast -crf 20 "$pic"');
});

test("TYPOGRAPHY IS NOT WIRED, and the script says why rather than silently ignoring it", () => {
  // The deck carries a `Typography` line and only DejaVu is baked into the snapshot. Accepting the
  // field and ignoring it would be a promise the renderer breaks with nothing going red, so the
  // absence is documented. If a `--card-font` flag ever appears, this test is the one to delete
  // deliberately — and deleting it is the moment to check a font was actually baked.
  expect(SH).not.toContain("--card-font");
  expect(SH).toContain("TYPOGRAPHY IS DELIBERATELY NOT WIRED");
});

test("the sidecar reports the colour that was DRAWN, beside the bed that was mixed", () => {
  // Same rule the bed follows: the proof plane records what happened, not what was asked for.
  expect(SH).toContain('"card_bg":"%s"');
  expect(SH).toContain('"$MUSIC_USED" "$CARD_BG"');
  // And NO new `gates` entry: this script runs no gate on the palette, and claiming one it does
  // not run is the single thing a proof plane must never do.
  expect(SH).not.toContain("card_contrast");
});
