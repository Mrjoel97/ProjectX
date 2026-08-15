// @vitest-environment node
//
// The .sh ↔ .ts mirror for the caption burn, and the tripwires on what the pass may do.
// Plan 20-13's `assembleScript.test.ts` verbatim in shape; the node pragma is for `node:fs`, which
// backend vitest's `edge-runtime` does not have.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { burnCapsScriptBody } from "./burnCapsScript";

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const SH = lf(readFileSync(fileURLToPath(new URL("./burn_caps.sh", import.meta.url)), "utf8"));

test("burn_caps.sh === its derived constant (byte-identical, LF-normalized)", () => {
  expect(lf(burnCapsScriptBody)).toBe(SH);
});

// Non-vacuity floor (house rule): a read that returns nothing must fail LOUDLY rather than pass by
// comparing two empty strings.
test("the mirror is not vacuously equal", () => {
  expect(SH.length).toBeGreaterThan(1_500);
  expect(SH).toContain("subtitles=");
});

test("the audio is COPIED — the level law is not re-opened by the caption pass", () => {
  const code = SH.split("\n")
    .filter((l) => !l.trimStart().startsWith("#")) // strip comments — the 15.2-07 lesson
    .join("\n");
  expect(code).toContain("-c:a copy");
  // The assembler's two-pass linear loudnorm settled the levels. A second normalisation here would
  // move them again, inaudibly in review and audibly in the shipped reel.
  expect(code).not.toContain("loudnorm");
  // D8 forbids time-stretch everywhere, not just in the assembler.
  for (const filter of ["atempo=", "setpts="]) {
    expect(code, `${filter} is a time-stretch filter and must never appear`).not.toContain(filter);
  }
});

test("exactly ONE ffmpeg encode pass", () => {
  const encodes = SH.split("\n").filter((l) => /^ffmpeg -y/.test(l.trim()));
  expect(encodes).toHaveLength(1);
});

test("no font is fetched, and the fonts directory is the image's own", () => {
  expect(SH).toContain("fontsdir=/usr/share/fonts");
  // `deny-all` egress makes a runtime fetch impossible; a script that tried would fail deep inside
  // the VM instead of here. These are the shapes such an attempt would take.
  for (const reach of ["curl ", "wget ", "http://", "https://"]) {
    expect(
      SH.split("\n")
        .filter((l) => !l.trimStart().startsWith("#"))
        .join("\n"),
    ).not.toContain(reach);
  }
});

test("the three silent-success failures are all refused", () => {
  expect(SH, "an ffmpeg without libass").toMatch(/libass is missing/);
  expect(SH, "an empty subtitle track").toMatch(/subtitle track is empty/);
  expect(SH, "a burn that re-timed the video").toMatch(/re-timed the video/);
  expect(
    SH,
    "grep -q under pipefail can turn a successful filter probe into SIGPIPE 141",
  ).not.toMatch(/ffmpeg[^\n]*-filters[^\n]*\|\s*grep\s+-q/);
});
