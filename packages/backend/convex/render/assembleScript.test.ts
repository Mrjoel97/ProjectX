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
  expect(SH, "speech window is a hard error, not a stretch").toMatch(/REWRITE the narration/);
  expect(SH, "speech-centred via silencedetect").toContain("silencedetect=noise=-45dB");
  expect(SH, "narration-per-window assert").toMatch(/have NO narration in their windows/);
  expect(SH, "the sidecar is written").toContain('"gates":[');
});
