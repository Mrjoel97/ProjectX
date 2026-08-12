#!/usr/bin/env node
// The Calendar BEHAVIOR gate (17-05 Task 1). A bounded, attributable wrapper around the backend
// Vitest run.
//
// WHY THIS EXISTS. The 2026-08-10 phase verifier recorded three consecutive Calendar runs that
// produced NO test result at all — 66.2s, 71.8s and 55.3s of wall clock and then nothing — and
// wrote them into 17-VERIFICATION.md as gap G4. A run that emits no result is indistinguishable,
// from the outside, from a run that passed slowly; the only honest way to tell them apart is to
// give the run a HARD wall clock, kill it when it blows, and then assert on the machine-readable
// result rather than on whether the command "looked fine".
//
// So this wrapper asserts FOUR things, and every one of them exits nonzero on failure:
//   1. the child finished inside `--timeout-ms` and was not killed by a signal;
//   2. it exited 0;
//   3. the JSON report parsed and `numTotalTests > 0`  — a suite that ran nothing is not a pass;
//   4. `numPassedTests === numTotalTests`               — no skips laundered into a green.
//
// A timeout is DIAGNOSED, never converted into a pass: the process exits 1 and prints which
// budget was blown. There is no `--allow-timeout`, no retry, and no "0 tests is fine" branch.
//
// ponytail: `spawnSync` + the JSON reporter, no test-runner API, no framework. It spawns
// `node <vitest.mjs>` rather than `node_modules/.bin/vitest` on purpose — the `.bin` entry is a
// POSIX shell script on Windows, so spawning it without `shell: true` fails, and `shell: true`
// would put a cmd.exe between us and the child that `timeout` cannot reliably kill.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(REPO, "packages", "backend");
const VITEST = join(BACKEND, "node_modules", "vitest", "vitest.mjs");

function die(message) {
  console.error(`CALENDAR_GATE_FAIL ${message}`);
  process.exit(1);
}

// ── args ──────────────────────────────────────────────────────────────────────────────────────
// `-- <spec...>` separates our flags from the Vitest specs. Everything after the FIRST `--` is a
// spec, verbatim. Unknown flags are rejected rather than forwarded: a typo'd budget that silently
// became a Vitest flag would give this gate a timeout it never enforced.
const argv = process.argv.slice(2);
const sepAt = argv.indexOf("--");
const flags = sepAt === -1 ? argv : argv.slice(0, sepAt);
const specs = sepAt === -1 ? [] : argv.slice(sepAt + 1);

const opts = { "--timeout-ms": null, "--test-timeout-ms": null, "--hook-timeout-ms": null };
for (let i = 0; i < flags.length; i++) {
  const flag = flags[i];
  if (!(flag in opts)) die(`unknown argument: ${flag} (expected ${Object.keys(opts).join(", ")})`);
  const raw = flags[++i];
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    die(`${flag} needs a positive integer, got ${raw}`);
  opts[flag] = value;
}
// REQUIRED. A wall clock that defaults to "generous" is the failure mode this file exists to stop.
if (opts["--timeout-ms"] === null) die("--timeout-ms is required (the wall clock IS the gate)");
if (specs.length === 0) die("no test spec given (expected `-- convex/calendar.test.ts`)");

// ── run ───────────────────────────────────────────────────────────────────────────────────────
const outDir = mkdtempSync(join(tmpdir(), "calendar-gate-"));
const outFile = join(outDir, "report.json");
const args = [VITEST, "run", ...specs, "--reporter=json", `--outputFile=${outFile}`];
if (opts["--test-timeout-ms"]) args.push(`--testTimeout=${opts["--test-timeout-ms"]}`);
if (opts["--hook-timeout-ms"]) args.push(`--hookTimeout=${opts["--hook-timeout-ms"]}`);

const startedAt = Date.now();
const child = spawnSync(process.execPath, args, {
  cwd: BACKEND,
  timeout: opts["--timeout-ms"],
  killSignal: "SIGKILL",
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  // `vitest run` is non-watch by construction; CI=1 additionally stops any interactive prompt.
  env: { ...process.env, CI: "1" },
});
const elapsedMs = Date.now() - startedAt;

function cleanup() {
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {}
}

// 1. bounded and unsignalled. `timeout` in spawnSync surfaces as ETIMEDOUT and/or a kill signal.
if (child.error && child.error.code === "ETIMEDOUT") {
  cleanup();
  die(`timeout after ${elapsedMs}ms (budget ${opts["--timeout-ms"]}ms) — no test result emitted`);
}
if (child.error) {
  cleanup();
  die(`could not run vitest: ${child.error.code ?? child.error.message}`);
}
if (child.signal) {
  cleanup();
  die(`killed by ${child.signal} after ${elapsedMs}ms — no test result emitted`);
}

// The report is read BEFORE the exit-code assertion, because ATTRIBUTION is the point: the JSON
// reporter writes to a file, so the child's stdout carries almost nothing, and a bare
// "vitest exited 1" would be exactly the unattributable result this gate exists to replace. A
// per-test timeout must name the test that hung.
let report = null;
let reportError = null;
try {
  report = JSON.parse(readFileSync(outFile, "utf8"));
} catch (e) {
  reportError = e.message;
}
cleanup();

/**
 * The failed tests, each with its own elapsed time — the NAMED owner of a hang or a red.
 *
 * The duration is carried deliberately: Vitest's JSON reporter renders a per-test timeout as the
 * useless string `Error: STACK_TRACE_ERROR`, so the only machine-readable evidence that a test hung
 * rather than asserted is that its own duration sat on the `--test-timeout-ms` budget. Verified
 * against a planted `await new Promise(() => {})` on 2026-08-11.
 */
function failures() {
  const out = [];
  for (const suite of report?.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === "failed") {
        const why = ((assertion.failureMessages ?? [])[0] ?? "").split("\n")[0];
        out.push(`  - [${assertion.duration ?? "?"}ms] ${assertion.fullName}: ${why}`);
      }
    }
  }
  return out;
}

// 2. exit code.
if (child.status !== 0) {
  process.stderr.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  const named = report ? failures() : [];
  if (named.length) console.error(`failing tests:\n${named.join("\n")}`);
  die(`vitest exited ${child.status} after ${elapsedMs}ms`);
}

// 3. the report parsed and is non-empty.
if (reportError !== null) die(`unreadable JSON report at ${outFile}: ${reportError}`);

const total = report.numTotalTests;
const passed = report.numPassedTests;
if (!Number.isInteger(total) || !Number.isInteger(passed)) {
  die(`malformed JSON report (numTotalTests=${total}, numPassedTests=${passed})`);
}
if (total === 0) die("the run reported ZERO tests — a suite that ran nothing is not a pass");

// 4. every test that existed also passed.
if (passed !== total) {
  const named = failures();
  if (named.length) console.error(`failing tests:\n${named.join("\n")}`);
  die(`only ${passed}/${total} tests passed`);
}

console.log(`CALENDAR_GATE_PASS total=${total} passed=${passed} elapsedMs=${elapsedMs}`);
