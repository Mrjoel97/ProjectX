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
// no test downstream would catch. `--music` and `--song` are deliberately deferred scope.
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
  for (const flag of ["--music", "--song", "--stepped"]) {
    expect(code, `${flag} is deferred scope and must not be re-added silently`).not.toContain(flag);
  }
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
