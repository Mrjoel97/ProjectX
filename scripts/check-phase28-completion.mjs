#!/usr/bin/env node

/**
 * check-phase28-completion — the gate that decides whether Phase 28 may be called COMPLETE.
 *
 * WHAT IT EXISTS TO PREVENT. `docs/playbooks/revenue-connectors.md` has always said that phase
 * completion means "REVN-01, REVN-02 and REVN-03 each require EVERY provider they name to hold a
 * current production-suitability decision AND a passed live read/revoke gate" — and cited this
 * script as the thing that checks it. Until now the script did not exist, so the strongest
 * statement about phase completion in the repository was a paragraph. A subset release (one lane
 * passed, its workflows shipped) is genuine value and is NOT completion; conflating the two is how
 * a phase gets closed on three quarters of its promise.
 *
 * IT IS OFFLINE AND SOURCE-DERIVED, exactly like `check-provider-lane.mjs`. Every fact is read out
 * of a file in this repository:
 *   • the six REVN statements, from `.planning/REQUIREMENTS.md`
 *   • which providers each of REVN-01..03 names, from those statements' own words
 *   • each lane's decision marker and open conditions, via `check-provider-lane.mjs`
 *   • which lanes have ever passed live, which — offline — is NONE, and it says so
 *
 * IT CANNOT SEE A DEPLOYMENT, AND THAT IS DELIBERATE. `providerGates` rows live in a Convex
 * deployment; a script that phoned one would report a different answer per environment and could
 * be made green by sealing a row on a laptop. The live half is `--verify-current`, which requires
 * an operator to paste what `check-provider-lane.mjs --provider <p>` actually reported.
 *
 * MODES
 *   (no flags)        the honest current picture. Exit 0 — reporting is not asserting.
 *   --strict          exit 1 unless EVERY named lane has passed. This is the completion gate.
 *   --verify-current  same, plus require the lane rows to be consistent right now.
 *   --self-test       OFFLINE. Mutates its own inputs and requires every guard to fire.
 *
 * Usage:
 *   node scripts/check-phase28-completion.mjs
 *   node scripts/check-phase28-completion.mjs --strict
 *   node scripts/check-phase28-completion.mjs --self-test
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The four lanes, in register order. */
const PROVIDERS = ["hubspot", "quickbooks", "stripe", "paypal"];

/**
 * Which providers each requirement NAMES. Derived by reading the requirement's own words rather
 * than typed here, because a hand-typed map is a second source of truth that drifts the first time
 * a requirement is reworded. REVN-04..06 name no provider — they are composition requirements, and
 * a composition over an unproven lane is not complete either, so they inherit ALL of them.
 */
function providersNamedBy(statement) {
  const named = PROVIDERS.filter((p) => new RegExp(p, "i").test(statement));
  return named.length > 0 ? named : PROVIDERS;
}

/** The six REVN statements, read from the requirements register. */
function requirementsFrom(fs) {
  const text = fs.read(".planning/REQUIREMENTS.md");
  const rows = [];
  for (const match of text.matchAll(/^- \[[ x]\] \*\*(REVN-\d\d)\*\*: (.+)$/gm)) {
    rows.push({ id: match[1], statement: match[2], providers: providersNamedBy(match[2]) });
  }
  return rows;
}

/**
 * What the per-lane gate says about one provider, RIGHT NOW.
 *
 * `check-provider-lane.mjs` is the authority and is re-run rather than re-implemented — the whole
 * point of the lane gate is that there is one composite rule. Its own output distinguishes
 * `consistent` (nothing contradicts the record) from `passed` (a live gate observed green), and
 * that distinction is the only thing this script actually needs.
 */
function laneStatus(provider) {
  try {
    const out = execFileSync(
      "node",
      [join(repoRoot, "scripts", "check-provider-lane.mjs"), "--provider", provider],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const passed = /RESULT:\s*passed/.test(out);
    const consistent = /RESULT:\s*consistent/.test(out);
    const pending = (out.match(/^\s*PEND\s/gm) ?? []).length;
    const red = (out.match(/^\s*RED\s/gm) ?? []).length;
    return { provider, passed, consistent, pending, red, reachable: true };
  } catch {
    // A lane gate that cannot run is NOT a pass. Failing open here would be the whole defect.
    return { provider, passed: false, consistent: false, pending: 0, red: 0, reachable: false };
  }
}

/**
 * THE COMPOSITE RULE, and the only place completion is decided.
 *
 * A requirement is complete when EVERY provider it names has a PASSED lane. Not `consistent`, not
 * `approved_production`, not "the adapter is built and tested" — passed. Everything in this phase
 * is built and offline-tested today and not one lane has run.
 */
export function resolveCompletion(requirements, lanes) {
  const byProvider = new Map(lanes.map((l) => [l.provider, l]));
  const rows = requirements.map((req) => {
    const missing = req.providers.filter((p) => byProvider.get(p)?.passed !== true);
    return { ...req, complete: missing.length === 0, missing };
  });
  return {
    rows,
    complete: rows.every((r) => r.complete),
    passedLanes: lanes.filter((l) => l.passed).map((l) => l.provider),
    // A subset release is real and must be nameable, or the only two words available are
    // "complete" and "nothing", and the first one starts getting used loosely.
    subset: lanes.some((l) => l.passed) && !rows.every((r) => r.complete),
  };
}

const fsReal = { read: (rel) => readFileSync(join(repoRoot, rel), "utf8") };

function render(result, lanes, stdout) {
  stdout.write("\nPhase 28 completion\n\n");
  for (const lane of lanes) {
    const state = !lane.reachable
      ? "UNREACHABLE"
      : lane.passed
        ? "passed"
        : lane.consistent
          ? "consistent"
          : "red";
    const mark = lane.passed ? "OK  " : "PEND";
    stdout.write(
      `  ${mark}  ${lane.provider.padEnd(11)} ${state}${lane.pending ? ` (${lane.pending} pending row(s))` : ""}\n`,
    );
  }
  stdout.write("\n");
  for (const row of result.rows) {
    const mark = row.complete ? "OK  " : "PEND";
    const why = row.complete ? "every named lane passed" : `waiting on ${row.missing.join(", ")}`;
    stdout.write(`  ${mark}  ${row.id.padEnd(11)} ${why}\n`);
  }
  stdout.write("\n");
  if (result.complete) {
    stdout.write("RESULT: complete — every REVN requirement's named lanes have passed.\n");
  } else if (result.subset) {
    stdout.write(
      `RESULT: subset — ${result.passedLanes.join(", ")} passed. Partial value may ship.\n` +
        "A SUBSET RELEASE IS NOT PHASE COMPLETION.\n",
    );
  } else {
    stdout.write(
      "RESULT: incomplete — no lane has passed a live gate.\n" +
        "Every adapter is built and offline-tested; none has spoken to its provider.\n",
    );
  }
}

// ── Self-test ─────────────────────────────────────────────────────────────────────────────

/**
 * A gate never observed refusing is not a gate. Each case feeds a mutated input through the SAME
 * resolver the real run uses and requires the stated refusal.
 */
function selfTest(stdout) {
  const reqs = [
    { id: "REVN-01", statement: "a HubSpot adapter", providers: ["hubspot"] },
    { id: "REVN-03", statement: "Stripe and PayPal adapters", providers: ["stripe", "paypal"] },
  ];
  const lane = (provider, passed) => ({ provider, passed, consistent: true, reachable: true });
  const cases = [
    {
      why: "no lane passed is INCOMPLETE, not subset",
      lanes: PROVIDERS.map((p) => lane(p, false)),
      expect: (r) => !r.complete && !r.subset,
    },
    {
      why: "one lane passed is SUBSET, never complete",
      lanes: PROVIDERS.map((p) => lane(p, p === "hubspot")),
      expect: (r) => !r.complete && r.subset,
    },
    {
      why: "REVN-03 needs BOTH Stripe and PayPal — one of them is not enough",
      lanes: PROVIDERS.map((p) => lane(p, p !== "paypal")),
      expect: (r) => !r.complete && r.rows.some((x) => x.id === "REVN-03" && !x.complete),
    },
    {
      why: "every lane passed is COMPLETE",
      lanes: PROVIDERS.map((p) => lane(p, true)),
      expect: (r) => r.complete && !r.subset,
    },
    {
      why: "an UNREACHABLE lane gate is not a pass",
      lanes: PROVIDERS.map((p) => ({ ...lane(p, true), reachable: false, passed: false })),
      expect: (r) => !r.complete,
    },
  ];

  stdout.write("\ncheck-phase28-completion --self-test (offline, no deployment)\n\n");
  let failed = 0;
  for (const c of cases) {
    const ok = c.expect(resolveCompletion(reqs, c.lanes));
    stdout.write(`  ${ok ? "OK  " : "FAIL"}  ${c.why}\n`);
    if (!ok) failed += 1;
  }

  // The derivation itself, which is the part a reworded requirement would silently break.
  const derived = providersNamedBy("Server-side Stripe and PayPal adapters provide read-only");
  const named = derived.includes("stripe") && derived.includes("paypal") && derived.length === 2;
  stdout.write(`  ${named ? "OK  " : "FAIL"}  a requirement's providers come from its own words\n`);
  if (!named) failed += 1;

  const all = providersNamedBy("Cash-flow results are computed in pure TypeScript");
  const inherits = all.length === PROVIDERS.length;
  stdout.write(
    `  ${inherits ? "OK  " : "FAIL"}  a requirement naming no provider inherits ALL of them\n`,
  );
  if (!inherits) failed += 1;

  stdout.write(
    failed === 0
      ? "\nSELF-TEST PASSED. This proves the RESOLVER. It proves nothing about any lane.\n"
      : `\nSELF-TEST FAILED: ${failed} case(s).\n`,
  );
  return failed === 0 ? 0 : 1;
}

// ── Entry ─────────────────────────────────────────────────────────────────────────────────

export function main(argv, stdout) {
  if (argv.includes("--self-test")) return selfTest(stdout);

  const requirements = requirementsFrom(fsReal);
  if (requirements.length === 0) {
    stdout.write("REQUIREMENTS.md yielded no REVN rows — the scan would be vacuous.\n");
    return 1;
  }
  const lanes = PROVIDERS.map(laneStatus);
  const result = resolveCompletion(requirements, lanes);
  render(result, lanes, stdout);

  const strict = argv.includes("--strict") || argv.includes("--verify-current");
  if (!strict) return 0;
  if (argv.includes("--verify-current") && lanes.some((l) => !l.reachable || l.red > 0)) {
    stdout.write("\n--verify-current: a lane gate is unreachable or red.\n");
    return 1;
  }
  if (!result.complete) {
    stdout.write("\n--strict: Phase 28 may NOT be marked complete.\n");
    return 1;
  }
  return 0;
}

// `file://` + a Windows path is `file:///C:/...` with THREE slashes, so the naive template
// comparison never matched and the script exited 0 having done nothing — a gate that cannot
// fail, which is exactly the class this repo keeps finding. Compare resolved paths instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2), process.stdout));
}
