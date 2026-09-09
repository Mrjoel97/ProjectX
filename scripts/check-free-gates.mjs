// EVERY FREE GATE MUST BE GREEN, AND CI MUST BE THE ONE ASKING.
//
// THE DEFECT THIS CLOSES. This repo has seventeen scripts carrying a `--self-test` / `--self-check` /
// `--fixtures-only` mode: offline, zero-cost checks that exist to redden BEFORE anyone spends money
// or touches a deployment. Nothing ran them. Two were found red by accident on 2026-09-08/09:
//
//   • `run-workflow-pack-evals.mjs --self-test` had asserted `PACK_EVAL_SUITE.packs.size === 6`
//     since 35-02 added a seventh pack. It failed on the NUMBER while the per-pack drift loop
//     directly above it — the check that actually matters — was passing.
//   • `check-provider-lane.mjs --self-test` failed three checks whose premises ("hubspot's lane is
//     unbuilt", "stripe's allow-list is empty") had been BORROWED FROM THE REAL TREE and expired
//     when somebody did the work they assumed nobody had done.
//
// Neither was noticed, because a gate nobody runs is indistinguishable from a gate that passes. And
// a gate that is red for a non-reason stops being read, which takes the real failures with it.
//
// TWO CHECKS, and the first is the one that survives contact with a growing repo:
//
//   1. THE REGISTRY IS AN ALLOWLIST, not a scan result. `GATES` below is written BY HAND, and this
//      script fails when the filesystem and the list disagree in EITHER direction. A new script with
//      a free mode is therefore a visible one-line diff in review rather than a gate that silently
//      covers nothing — the same reason `CONVEX_MODULES` and `SCHEDULER_CALL_SITES` are pinned
//      literals elsewhere in this repo. Deriving the list from the scan would make this file agree
//      with whatever it found, which is not a check.
//   2. EVERY REGISTERED GATE EXITS 0. Exit codes are read DIRECTLY from `spawnSync`, never through a
//      pipe: a pipeline reports the exit of its LAST stage, so `node gate.mjs | tail` is green
//      whatever the gate said. That mistake is how at least one red gate stayed invisible here.
//
// Usage:
//   node scripts/check-free-gates.mjs              # the gate (CI runs this)
//   node scripts/check-free-gates.mjs --list       # what is registered, and which flag each takes
//   node scripts/check-free-gates.mjs --self-test  # prove this file can fail
//
// Exit 0 = every free gate is green and the registry matches the tree. Exit 1 = otherwise.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where a script with a free mode may live. Scanned, then reconciled against `GATES`. */
const SCRIPT_DIRS = ["scripts", "packages/backend/scripts"];

/** The flags that mean "offline, free, and safe to run anywhere", in preference order. */
const FREE_FLAGS = ["--self-test", "--self-check", "--fixtures-only"];

/**
 * THE ALLOWLIST. Hand-written on purpose — see the header. `flag` is pinned too, because a script
 * that grows a second free mode should be a decision, not a silent change of what CI runs.
 *
 * `cwd` matters: the backend scripts resolve `node_modules` and their own repo paths relative to
 * `packages/backend`.
 */
const GATES = [
  { path: "scripts/check-absence-guards.mjs", flag: "--self-test" },
  { path: "scripts/check-audit-payloads.mjs", flag: "--self-test" },
  { path: "scripts/check-phase28-completion.mjs", flag: "--self-test" },
  { path: "scripts/check-phase28-readiness.mjs", flag: "--self-check" },
  { path: "scripts/check-provider-lane.mjs", flag: "--self-test" },
  { path: "scripts/smoke-hubspot-read.mjs", flag: "--self-test" },
  { path: "scripts/smoke-paypal-read.mjs", flag: "--self-test" },
  { path: "scripts/smoke-quickbooks-read.mjs", flag: "--self-test" },
  { path: "scripts/smoke-stripe-read.mjs", flag: "--self-test" },
  { path: "packages/backend/scripts/check-phase21-artifacts.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/check-routine-gate.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/collect-recurrence-evidence.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/compare-refs.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/run-eval-golden.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/run-probe-websearch.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/run-storyboard-bakeoff.mjs", flag: "--self-check" },
  { path: "packages/backend/scripts/run-workflow-pack-evals.mjs", flag: "--self-test" },
];

/** This file. Excluded from the RUN list (it would recurse); its own mode is a separate CI step. */
const SELF = "scripts/check-free-gates.mjs";

/** Which free flag a script declares, or null. A flag only counts when it appears QUOTED — that is
 *  how these scripts dispatch on it, and it keeps a mention in a comment from registering a gate. */
export function freeFlagOf(source) {
  return FREE_FLAGS.find((f) => source.includes(`"${f}"`) || source.includes(`'${f}'`)) ?? null;
}

/** Every script on disk that declares a free mode, as {path, flag}. Sorted for a stable diff. */
export function discoverGates(fs, dirs = SCRIPT_DIRS) {
  const found = [];
  for (const dir of dirs) {
    for (const name of fs.list(dir)) {
      if (!name.endsWith(".mjs")) continue;
      const path = `${dir}/${name}`;
      if (path === SELF) continue;
      const flag = freeFlagOf(fs.read(path));
      if (flag !== null) found.push({ path, flag });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Reconcile the hand-written list against the tree. BOTH directions are errors: an unregistered
 * gate is one CI does not run, and a registered gate that no longer exists is a line that will
 * quietly stop covering anything.
 */
export function reconcile(registered, discovered) {
  const key = (g) => `${g.path} ${g.flag}`;
  const reg = new Set(registered.map(key));
  const dis = new Set(discovered.map(key));
  return {
    unregistered: discovered.filter((g) => !reg.has(key(g))),
    stale: registered.filter((g) => !dis.has(key(g))),
  };
}

const realFs = {
  read: (p) => readFileSync(join(repoRoot, p), "utf8"),
  list: (d) => (existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)) : []),
};

function runGate(gate) {
  const backend = gate.path.startsWith("packages/backend");
  // ANY NON-ZERO IS A FAILURE, INCLUDING AN "ENVIRONMENT ABORT" (exit 2). The pack harness exits 2
  // when the Node running it is too old to strip TS types natively, and that is what reddened this
  // step on its very first CI run: ci.yml pinned Node 20 while deploy-production built on 24, so the
  // gate was reporting on a runtime nothing ships. Do NOT teach this runner to skip exit 2 — "the
  // environment could not run the check" is indistinguishable from "nobody ran the check", which is
  // the entire defect this file exists to close. Fix the environment; leave the gate red.
  // Exit code read DIRECTLY. Never `| tail`, never `$?` after a pipeline.
  const r = spawnSync(process.execPath, [join(repoRoot, gate.path), gate.flag], {
    cwd: backend ? join(repoRoot, "packages/backend") : repoRoot,
    encoding: "utf8",
    timeout: 300_000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").filter(Boolean);
  return { code: r.status, tail: out[out.length - 1] ?? "(no output)" };
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  const fake = (files) => ({
    read: (p) => files[p] ?? "",
    list: (d) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${d}/`))
        .map((p) => p.slice(d.length + 1)),
  });
  let failures = 0;
  const check = (ok, why) => {
    if (!ok) failures += 1;
    stdout.write(`  ${ok ? "OK  " : "FAIL"} ${why}\n`);
  };

  check(freeFlagOf('argv.includes("--self-test")') === "--self-test", "a quoted flag registers");
  check(freeFlagOf("// mentions --self-test in prose") === null, "a flag in a COMMENT does not");
  check(freeFlagOf("nothing here") === null, "a script with no free mode is not a gate");

  const discovered = discoverGates(fake({ "scripts/a.mjs": '"--self-check"' }), ["scripts"]);
  check(
    discovered.length === 1 && discovered[0].flag === "--self-check",
    "discovery finds a gate and its flag",
  );

  // The two directions that matter.
  const un = reconcile([], [{ path: "scripts/a.mjs", flag: "--self-test" }]);
  check(un.unregistered.length === 1, "an UNREGISTERED gate is reported");
  const st = reconcile([{ path: "scripts/gone.mjs", flag: "--self-test" }], []);
  check(st.stale.length === 1, "a STALE registry line is reported");
  const drift = reconcile(
    [{ path: "scripts/a.mjs", flag: "--self-test" }],
    [{ path: "scripts/a.mjs", flag: "--self-check" }],
  );
  check(
    drift.unregistered.length === 1 && drift.stale.length === 1,
    "a CHANGED flag is drift in both directions, not a silent swap",
  );

  // And the registry must match the real tree right now.
  const real = reconcile(GATES, discoverGates(realFs));
  check(
    real.unregistered.length === 0 && real.stale.length === 0,
    "the checked-in registry matches this tree",
  );
  for (const g of real.unregistered) stdout.write(`       -> unregistered: ${g.path} ${g.flag}\n`);
  for (const g of real.stale) stdout.write(`       -> stale: ${g.path} ${g.flag}\n`);

  stdout.write(
    failures === 0
      ? "\nself-test PASSED\n"
      : `\nSELF-TEST FAILED — ${failures} check(s) did not behave.\n`,
  );
  return failures === 0 ? 0 : 1;
}

// ── entry ────────────────────────────────────────────────────────────────────
if (argv.includes("--self-test")) exit(selfTest());

if (argv.includes("--list")) {
  for (const g of GATES) stdout.write(`${g.flag.padEnd(16)} ${g.path}\n`);
  exit(0);
}

const { unregistered, stale } = reconcile(GATES, discoverGates(realFs));
let bad = 0;
for (const g of unregistered) {
  bad += 1;
  stdout.write(`UNREGISTERED  ${g.path} declares ${g.flag} — add it to GATES in ${SELF}\n`);
}
for (const g of stale) {
  bad += 1;
  stdout.write(`STALE         ${g.path} ${g.flag} is registered but not on disk\n`);
}

for (const gate of GATES) {
  const { code, tail } = runGate(gate);
  const green = code === 0;
  if (!green) bad += 1;
  stdout.write(`${green ? "GREEN" : "RED  "} exit=${code} ${gate.flag.padEnd(16)} ${gate.path}\n`);
  if (!green) stdout.write(`        ${tail.slice(0, 200)}\n`);
}

stdout.write(
  bad === 0
    ? `\nAll ${GATES.length} free gates are green and the registry matches the tree.\n`
    : `\nFREE GATES FAILED — ${bad} problem(s).\n`,
);
exit(bad === 0 ? 0 : 1);
