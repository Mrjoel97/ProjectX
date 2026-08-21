#!/usr/bin/env node
/**
 * compare-refs — the ONE canonical comparator for refs-only snapshots.
 *
 * WHY THIS EXISTS. Plan 21-07 hand-inlined its state comparison three times as
 * `ConvertTo-Json -Compress` string equality, and every instance was broken the same two ways:
 *
 *   1. It compared `$h.deploymentUrlHash` to `$live.deploymentUrlHash`. The inspector emits
 *      `deploymentHash`. The right-hand side was always `$null`, so a healthy deployment ALWAYS
 *      reported drift — and the plan's next instruction is "do not refresh the handoff; diagnose".
 *   2. Key ORDER differs (the inspector alphabetises, the handoff does not) and the key SET differs
 *      (`rollbackBaseline.scope`, `lineage.basedOnTenantSkillId`). Identical data compared unequal.
 *
 * Sorting keys before stringifying would fix (2) and leave (1). This walks the tree instead and
 * never builds a string to compare, so both die at once.
 *
 * THE RULES, which are asymmetric on purpose — the expected side is a FROZEN record and the actual
 * side is a live document that may legitimately carry more:
 *
 *   - Every key the expected side recorded must be present on the actual side and match exactly
 *     (ordinal string compare, no coercion). ABSENT is its own failure, never `undefined == null`.
 *   - An actual-only key holding literal `null` passes: the live shape declares a field this
 *     snapshot has no value for.
 *   - An actual-only key holding ANYTHING else ESCALATES TO FAILURE unless named in --allow-extra.
 *     Escalate-by-default is the point: `rollbackBaseline.scope` was benign, and the only way to
 *     know that was to look. --allow-extra makes each such judgement explicit and reviewable
 *     instead of silently tolerated by a loose compare.
 *
 * Usage:
 *   node compare-refs.mjs --expected <a.json> --actual <b.json|-> [--pair exp=act]... \
 *                         [--allow-extra dotted.path]... [--label name]
 *   node compare-refs.mjs --self-check
 *
 * `--actual -` reads stdin, so a PowerShell inspector call can pipe straight in with no temp file.
 * `--pair` compares only the named subtrees (repeatable); with none, whole documents are compared.
 * Exit 0 = every comparison held. Exit 1 = at least one did not; each failure prints its full path.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Fail lines, not exceptions: one run should report EVERY mismatch, not just the first. */
export function compareRefs(expected, actual, { allowExtra = [], path = "" } = {}) {
  const at = path || "(root)";
  const fails = [];
  const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

  if (kind(expected) !== kind(actual)) {
    return [
      `${at}: expected ${kind(expected)} ${show(expected)}, got ${kind(actual)} ${show(actual)}`,
    ];
  }
  if (expected === null || typeof expected !== "object") {
    // Ordinal, no coercion: "12" must never satisfy 12, and undefined must never satisfy null.
    return expected === actual ? [] : [`${at}: expected ${show(expected)}, got ${show(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      return [`${at}: expected ${expected.length} items, got ${actual.length}`];
    }
    for (let i = 0; i < expected.length; i++) {
      fails.push(
        ...compareRefs(expected[i], actual[i], {
          allowExtra,
          path: `${at === "(root)" ? "" : at}[${i}]`,
        }),
      );
    }
    return fails;
  }
  for (const key of Object.keys(expected)) {
    const child = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(actual, key)) {
      fails.push(`${child}: MISSING on the actual side (expected ${show(expected[key])})`);
      continue;
    }
    fails.push(...compareRefs(expected[key], actual[key], { allowExtra, path: child }));
  }
  for (const key of Object.keys(actual)) {
    if (Object.hasOwn(expected, key)) continue;
    const child = path ? `${path}.${key}` : key;
    if (actual[key] === null || allowExtra.includes(child)) continue;
    fails.push(
      `${child}: UNRECORDED live key with a non-null value ${show(actual[key])} — verify it, then --allow-extra it`,
    );
  }
  return fails;
}

const show = (v) =>
  typeof v === "string"
    ? JSON.stringify(v)
    : v === undefined
      ? "undefined"
      : (JSON.stringify(v) ?? String(v));

function repeated(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[++i]);
  return out;
}
const single = (argv, flag) => repeated(argv, flag)[0];

function selfCheck() {
  const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error(`${msg}\n  got ${JSON.stringify(a)}`);
  };
  const base = { id: "a", version: 12, nested: { hash: "h", flag: false }, target: null };

  eq(compareRefs(base, structuredClone(base)), [], "identical documents must pass");
  // Order-independence is the whole reason this is not a string compare.
  eq(
    compareRefs(base, { target: null, nested: { flag: false, hash: "h" }, version: 12, id: "a" }),
    [],
    "reordered keys must pass",
  );
  eq(compareRefs(base, { ...base, scope: null }), [], "an actual-only NULL key must pass");
  eq(
    compareRefs(base, { ...base, scope: "tenant" }).length,
    1,
    "an actual-only non-null key must fail",
  );
  eq(
    compareRefs(base, { ...base, scope: "tenant" }, { allowExtra: ["scope"] }),
    [],
    "--allow-extra must clear a verified live-only key",
  );
  eq(
    compareRefs(
      base,
      { ...base, nested: { ...base.nested, extra: 1 } },
      { allowExtra: ["nested.extra"] },
    ),
    [],
    "--allow-extra must address nested paths by full dotted path",
  );
  eq(
    compareRefs(base, { ...base, nested: { ...base.nested, extra: 1 } }, { allowExtra: ["extra"] })
      .length,
    1,
    "a bare leaf name must NOT clear a nested key",
  );

  // The two defects that shipped in 21-07's own verify block.
  const missing = compareRefs({ deploymentUrlHash: "b8c0" }, { deploymentHash: "b8c0" });
  eq(
    missing.length,
    2,
    "a RENAMED key must fail as missing AND as unrecorded, never as a silent null compare",
  );
  if (!missing[0].includes("MISSING")) throw new Error("absence must be reported as absence");

  eq(compareRefs({ v: 12 }, { v: "12" }).length, 1, "no type coercion");
  eq(
    compareRefs({ target: null }, { target: { id: "x" } }).length,
    1,
    "null expected vs object actual must fail",
  );
  eq(compareRefs({ a: [1, 2] }, { a: [1, 2] }), [], "arrays compare elementwise");
  eq(compareRefs({ a: [1, 2] }, { a: [2, 1] }).length, 2, "array ORDER is significant");
  eq(compareRefs({ a: [1, 2] }, { a: [1] }).length, 1, "array length is significant");
  // Every failure in one pass, not just the first.
  eq(
    compareRefs({ a: 1, b: 2 }, { a: 9, b: 9 }).length,
    2,
    "all mismatches must be reported together",
  );

  console.log("[compare-refs] self-check PASSED (14 assertions)");
}

function main(argv) {
  if (argv.includes("--self-check")) return selfCheck();

  const expectedPath = single(argv, "--expected");
  const actualPath = single(argv, "--actual");
  if (!expectedPath || !actualPath) {
    console.error(
      "usage: compare-refs.mjs --expected <a.json> --actual <b.json|-> [--pair exp=act]... [--allow-extra path]...",
    );
    process.exit(2);
  }
  const read = (p) => JSON.parse(p === "-" ? readFileSync(0, "utf8") : readFileSync(p, "utf8"));
  const expected = read(expectedPath);
  const actual = read(actualPath);
  const allowExtra = repeated(argv, "--allow-extra");
  const label = single(argv, "--label") ?? "compare-refs";

  const pairs = repeated(argv, "--pair").map((p) => {
    const [e, a] = p.split("=");
    if (!e || !a) throw new Error(`--pair needs expectedKey=actualKey, got "${p}"`);
    return [e, a];
  });

  const fails = [];
  if (pairs.length === 0) fails.push(...compareRefs(expected, actual, { allowExtra }));
  else
    for (const [e, a] of pairs) {
      if (!Object.hasOwn(expected, e)) fails.push(`${e}: MISSING on the expected side`);
      else if (!Object.hasOwn(actual, a)) fails.push(`${a}: MISSING on the actual side`);
      else fails.push(...compareRefs(expected[e], actual[a], { allowExtra, path: a }));
    }

  if (fails.length === 0) {
    console.log(`[${label}] OK — ${pairs.length || 1} comparison(s), 0 mismatches`);
    process.exit(0);
  }
  for (const f of fails) console.error(`[${label}] ${f}`);
  console.error(`[${label}] ${fails.length} mismatch(es)`);
  process.exit(1);
}

// Only run as a CLI — this file also EXPORTS `compareRefs`, and an unguarded main() would parse the
// importer's argv and call process.exit the moment anything imported it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
