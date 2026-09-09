// CLAUDE.md §4, CHECKED AGAINST THE ROWS — the gate ADR-044 T3 requires before WORM is armed.
//
// §4 says `audit.payload` and `deadLetters.payload` carry refs, hashes, ids and COUNTS ONLY.
// Every existing guard for that reads SOURCE. ADR-044 T3 says that is not enough, and is explicit
// about why: "every latent §4 defect in the history becomes permanent on arming day, and a source
// scan cannot see a single already-written row. The honest check reads rows, not code."
//
// VALUES NEVER REACH THIS PROCESS. `audit:payloadShapes` is an internalQuery that classifies
// INSIDE the deployment and returns a field path, a code-owned reason, a count and a redacted
// fingerprint (length + character classes). So this output is safe to paste into a terminal, a CI
// log or an agent transcript — which matters, because a checker that echoed suspected PII would
// have moved the leak rather than found it.
//
// EXIT CODES, AND WHY SUSPECTS DO NOT REDDEN IT.
//   0 = no violations (suspects may be listed, loudly)
//   1 = at least one VIOLATION, or the walk could not finish
//   2 = environment: no deployment reachable, bad arguments
// A `suspect` is "this shape is not provably a ref" — an unclassified opaque string, or a
// PII-shaped KEY holding a clean value. Reddening on those would flag legitimate rows on day one,
// and a gate that is red for a non-reason stops being read, which takes the real failures with it
// (45-06 shipped that lesson twice). `--strict` opts into failing on suspects for a deliberate
// pre-arming audit.
//
// Usage:
//   node scripts/check-audit-payloads.mjs --self-test          # offline; proves this file can fail
//   node scripts/check-audit-payloads.mjs                      # dev deployment, audit + deadLetters
//   node scripts/check-audit-payloads.mjs --prod --strict      # the pre-arming audit

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TABLES = ["audit", "deadLetters"];
const PAGE = 400;
/** A walk that will not terminate is a bug in the caller, not a clean bill of health. */
const MAX_PAGES = 500;

/** Merge page findings into a running total, summing `count` per (kind, path, reason). */
export function mergeFindings(into, findings) {
  for (const f of findings) {
    const key = `${f.kind}|${f.path}|${f.reason}`;
    const hit = into.get(key);
    if (hit) hit.count += f.count;
    else into.set(key, { ...f });
  }
  return into;
}

/** The verdict of a whole run, and therefore its exit code. */
export function exitCodeFor(findings, { strict = false, complete = true } = {}) {
  if (!complete) return 1;
  const list = [...findings.values()];
  if (list.some((f) => f.verdict === "violation")) return 1;
  if (strict && list.some((f) => f.verdict === "suspect")) return 1;
  return 0;
}

/** One page from the deployment. `run` is injected so the self-test needs no deployment. */
async function walkTable(run, table, prod) {
  const found = new Map();
  let cursor;
  let scanned = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await run(table, cursor, prod);
    scanned += res.scanned ?? 0;
    mergeFindings(found, res.findings ?? []);
    if (res.isDone) return { found, scanned, complete: true };
    cursor = res.cursor;
  }
  return { found, scanned, complete: false };
}

/** The real transport: `convex run`, no shell — Windows `shell: true` strips the JSON's quotes. */
function convexRun(table, cursor, prod) {
  const args = [
    // The convex CLI is NOT hoisted to the repo root under pnpm — it lives in the backend
    // package, which is the path `check-provider-lane.mjs` already resolves. One answer, not two.
    join(repoRoot, "packages", "backend", "node_modules", "convex", "bin", "main.js"),
    "run",
    ...(prod ? ["--prod"] : []),
    "audit:payloadShapes",
    JSON.stringify({ table, ...(cursor ? { cursor } : {}), limit: PAGE }),
  ];
  const r = spawnSync(process.execPath, args, {
    cwd: join(repoRoot, "packages", "backend"),
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    stdout.write(`ENVIRONMENT: convex run failed for ${table} (exit ${r.status})\n`);
    stdout.write(`${(r.stderr ?? "").trim().split("\n").slice(-3).join("\n")}\n`);
    exit(2);
  }
  // `convex run` prints the JSON result; anything before it is CLI chatter.
  const text = (r.stdout ?? "").trim();
  const brace = text.indexOf("{");
  if (brace === -1) {
    stdout.write(`ENVIRONMENT: no JSON in convex output for ${table}\n`);
    exit(2);
  }
  return JSON.parse(text.slice(brace));
}

// ── self-test ────────────────────────────────────────────────────────────────
// It tests THIS FILE's logic — paging, merging, exit codes — and deliberately does NOT re-test the
// classifier, which has its own suite in `packages/core/src/payloadShape.test.ts`. Two copies of
// one assertion is two places to update and one place to forget.
async function selfTest() {
  let failures = 0;
  const check = (ok, why) => {
    if (!ok) failures += 1;
    stdout.write(`  ${ok ? "OK  " : "FAIL"} ${why}\n`);
  };

  const merged = mergeFindings(new Map(), [
    { kind: "a", path: "p", reason: "r", verdict: "suspect", count: 2 },
  ]);
  mergeFindings(merged, [{ kind: "a", path: "p", reason: "r", verdict: "suspect", count: 3 }]);
  check(merged.size === 1 && [...merged.values()][0].count === 5, "counts SUM across pages");

  mergeFindings(merged, [{ kind: "b", path: "p", reason: "r", verdict: "suspect", count: 1 }]);
  check(merged.size === 2, "a different kind is a DIFFERENT finding, not a merge");

  check(exitCodeFor(new Map()) === 0, "no findings exits 0");
  check(
    exitCodeFor(new Map([["k", { verdict: "suspect", count: 1 }]])) === 0,
    "a SUSPECT alone does not redden the gate",
  );
  check(
    exitCodeFor(new Map([["k", { verdict: "suspect", count: 1 }]]), { strict: true }) === 1,
    "--strict DOES fail on a suspect",
  );
  check(
    exitCodeFor(new Map([["k", { verdict: "violation", count: 1 }]])) === 1,
    "a VIOLATION fails the gate",
  );
  check(
    exitCodeFor(new Map(), { complete: false }) === 1,
    "an INCOMPLETE walk fails — a partial scan is not a clean bill of health",
  );

  // Paging: a fake transport that reports done only on the third page.
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return calls < 3
      ? { scanned: 2, isDone: false, cursor: `c${calls}`, findings: [] }
      : { scanned: 1, isDone: true, cursor: null, findings: [] };
  };
  const walked = await walkTable(fake, "audit", false);
  check(
    calls === 3 && walked.scanned === 5 && walked.complete,
    "the walk DRIVES THE CURSOR to done",
  );

  // And a transport that never finishes must not be reported as clean.
  const never = async () => ({ scanned: 1, isDone: false, cursor: "x", findings: [] });
  const stuck = await walkTable(never, "audit", false);
  check(!stuck.complete, "a walk that never finishes is reported INCOMPLETE");

  stdout.write(
    failures === 0
      ? "\nself-test PASSED\n"
      : `\nSELF-TEST FAILED — ${failures} check(s) did not behave.\n`,
  );
  return failures === 0 ? 0 : 1;
}

// ── entry ────────────────────────────────────────────────────────────────────
if (argv.includes("--self-test")) exit(await selfTest());

const prod = argv.includes("--prod");
const strict = argv.includes("--strict");
stdout.write(`§4 payload audit — ${prod ? "PRODUCTION" : "dev"}${strict ? " (strict)" : ""}\n\n`);

const all = new Map();
let complete = true;
for (const table of TABLES) {
  const r = await walkTable(convexRun, table, prod);
  complete &&= r.complete;
  mergeFindings(all, [...r.found.values()]);
  stdout.write(
    `${table.padEnd(12)} scanned=${String(r.scanned).padStart(6)}  ${r.complete ? "complete" : "INCOMPLETE"}  findings=${r.found.size}\n`,
  );
}

const list = [...all.values()];
const violations = list.filter((f) => f.verdict === "violation");
const suspects = list.filter((f) => f.verdict === "suspect");

for (const f of [...violations, ...suspects]) {
  stdout.write(
    `\n${f.verdict === "violation" ? "VIOLATION" : "suspect  "} ${f.kind} :: ${f.path}\n` +
      `          reason=${f.reason} rows=${f.count}${f.fingerprint ? ` ${f.fingerprint}` : ""}\n`,
  );
}

stdout.write(
  violations.length === 0 && suspects.length === 0
    ? "\nEvery payload is refs, hashes, ids and counts. §4 holds on the ROWS, not just in the source.\n"
    : `\n${violations.length} violation(s), ${suspects.length} suspect(s).\n`,
);
exit(exitCodeFor(all, { strict, complete }));
