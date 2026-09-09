// AN ABSENCE ASSERTION NEEDS SOMETHING THAT PROVES THE SURFACE RENDERED.
//
// THE DEFECT THIS CLOSES, and it is recorded rather than theoretical. Playwright's
// `expect(locator).toHaveCount(0)` SUCCEEDS ON ITS FIRST POLL — it does not wait for anything,
// because zero is already true of a page that has painted nothing. So an absence assertion placed
// straight after a `goto`, with nothing before it establishing that the surface resolved, passes
// against "Loading…" and reports it as proof.
//
// Two instances shipped here. `routines.spec.ts` waited on `getByText("Run again")`, which matched
// the always-present intro prose rather than the button, so every `toHaveCount(0)` in the block ran
// before a single Convex query resolved. And `workflow-pack-pilot.spec.ts`'s `@dark` block PASSED
// WITH ALL SIX PACKS ACTIVE — a check asserting the pilot was invisible, while it was on offer to
// every user.
//
// WHAT IS FLAGGED, and deliberately not more. Only an absence assertion with NOTHING before it in
// its own `test(` block that could establish the page rendered. A repo-wide "every zero-count needs
// a positive control" rule would flag 82 sites across 20 files on day one, and a gate that is red
// for a non-reason stops being read — which is the failure this whole family of checks exists to
// prevent. MEASURED 2026-09-09: 82 absence assertions in this directory; ONE genuinely
// unguarded (`reports.spec.ts` asserted the owner-only card absent immediately after a `goto`),
// now fixed. The first draft of this scan reported five — four were ITS OWN bug, a `toBeVisible\(\)`
// pattern requiring empty parens that could not match `toBeVisible({ timeout: 15_000 })`. Reading
// each flagged site before “fixing” it is what kept four healthy tests from being edited to
// satisfy a broken detector.
//
// COMMENTS ARE STRIPPED FIRST. Prose describing the hazard would otherwise register as the hazard,
// and two of the five raw matches were exactly that — comment lines in `finance.spec.ts` and
// `routines.spec.ts` warning about vacuous absence.
//
// Usage:
//   node scripts/check-absence-guards.mjs              # the gate
//   node scripts/check-absence-guards.mjs --self-test  # prove it can fail
//
// Exit 0 = every absence assertion is guarded. Exit 1 = at least one is not.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const E2E_DIR = "apps/web/e2e";

/** The absence assertions that do not wait. `not.toBeVisible()` has the same property. */
const ABSENCE = /toHaveCount\(\s*0\s*\)|not\.toBeVisible\(\)/;

/**
 * Anything that proves the surface actually resolved before absence is claimed: a positive control,
 * an explicit wait, or any assertion that something IS there.
 */
const SETTLED = new RegExp(
  [
    "toBeGreaterThan\\(\\s*0\\s*\\)",
    "\\.waitFor\\(",
    // `toBeVisible\(` — NOT `toBeVisible\(\)`. The first draft of this scan required EMPTY
    // parens and therefore missed every `toBeVisible({ timeout: 15_000 })`, which is how this
    // codebase actually writes it. It flagged five healthy tests, and had they been “fixed” to
    // satisfy it, the scanner's bug would have been laundered into the suite as five redundant
    // assertions. A pattern that matches a shape the code does not use is the same defect this
    // file exists to catch, wearing the detector's clothes.
    "toBeVisible\\(",
    "toHaveText\\(",
    "toContainText\\(",
    "toHaveValue\\(",
    "toHaveAttribute\\(",
    "toHaveCount\\(\\s*[1-9]",
    "expect\\(\\s*await",
    // PINNED SETTLE HELPERS, hand-written and each one VERIFIED at its definition rather than
    // taken on the name's word (a whitelist justified by another function's claim is not a
    // check). `openWorkspace` awaits `expect(getByTestId("workspace-pane")).toBeVisible()`;
    // `settlePackQueries` awaits a `waitFor` race on the two owner regions. Adding a name here
    // without reading its body is how this gate would start passing things it should not.
    "openWorkspace\\(",
    "settlePackQueries\\(",
  ].join("|"),
);

/** A new `test(` or `test.step(` opens a block; absence is judged against its own block only. */
const BLOCK_START = /^\s*(?:test|test\.step)\s*[.(]/;

/**
 * Strip line and block comments. NOT a general parser — it exists so prose about the hazard is not
 * mistaken for the hazard, and it must never blank real code (the `codeOf` lesson: a preprocessor
 * that destroys its input makes every `not.toMatch` pass forever).
 */
export function codeOnly(source) {
  const out = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    const open = line.indexOf("/*");
    if (open !== -1) {
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlock = true;
      } else {
        line = line.slice(0, open) + line.slice(close + 2);
      }
    }
    // `//` inside a string literal is left alone by requiring it to start the trimmed line or follow
    // whitespace — good enough here, and it errs toward KEEPING code rather than blanking it.
    const slash = line.search(/(^|\s)\/\//);
    if (slash !== -1) line = line.slice(0, slash);
    out.push(line);
  }
  return out.join("\n");
}

/** Every unguarded absence assertion in one file, as {line, text}. */
export function unguardedIn(source) {
  const lines = codeOnly(source).split("\n");
  const hits = [];
  let blockStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (BLOCK_START.test(line)) blockStart = i;
    if (!ABSENCE.test(line)) continue;
    if (SETTLED.test(lines.slice(blockStart, i).join("\n"))) continue;
    hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let failures = 0;
  const check = (ok, why) => {
    if (!ok) failures += 1;
    stdout.write(`  ${ok ? "OK  " : "FAIL"} ${why}\n`);
  };

  const unguarded = `test("x", async ({ page }) => {
  await page.goto("/r");
  await expect(page.getByText("gone")).toHaveCount(0);
});`;
  const guarded = `test("x", async ({ page }) => {
  await page.goto("/r");
  await expect(page.getByRole("heading", { name: "R" })).toBeVisible();
  await expect(page.getByText("gone")).toHaveCount(0);
});`;

  check(
    unguardedIn(unguarded).length === 1,
    "an absence assertion with nothing before it is caught",
  );
  check(unguardedIn(guarded).length === 0, "a preceding positive control clears it");
  check(
    unguardedIn(`// await expect(x).toHaveCount(0);`).length === 0,
    "a LINE COMMENT about the hazard is not the hazard",
  );
  check(
    unguardedIn(`/*\n * mentions toHaveCount(0) in prose\n */`).length === 0,
    "a BLOCK COMMENT about the hazard is not the hazard",
  );
  check(
    codeOnly('const a = 1; // note\nconst b = "keep";').includes('const b = "keep"'),
    "the comment stripper does not blank real code",
  );
  check(
    unguardedIn(`test("a", async () => {
  await expect(x).toBeVisible();
});
test("b", async () => {
  await expect(y).toHaveCount(0);
});`).length === 1,
    "a settle in a DIFFERENT block does not count",
  );
  check(
    unguardedIn(`test("x", async () => {
  await expect(y).not.toBeVisible();
});`).length === 1,
    "not.toBeVisible() is an absence assertion too",
  );

  stdout.write(
    failures === 0
      ? "\nself-test PASSED\n"
      : `\nSELF-TEST FAILED — ${failures} check(s) did not behave.\n`,
  );
  return failures === 0 ? 0 : 1;
}

// ── entry ────────────────────────────────────────────────────────────────────
if (argv.includes("--self-test")) exit(selfTest());

let bad = 0;
for (const name of readdirSync(join(repoRoot, E2E_DIR)).sort()) {
  if (!name.endsWith(".spec.ts")) continue;
  const hits = unguardedIn(readFileSync(join(repoRoot, E2E_DIR, name), "utf8"));
  for (const h of hits) {
    bad += 1;
    stdout.write(`UNGUARDED  ${E2E_DIR}/${name}:${h.line}\n           ${h.text.slice(0, 110)}\n`);
  }
}

stdout.write(
  bad === 0
    ? "\nEvery absence assertion in e2e is preceded by something that proves the surface rendered.\n"
    : `\nABSENCE GUARDS FAILED — ${bad} assertion(s) could pass against a page that never rendered.\n`,
);
exit(bad === 0 ? 0 : 1);
