// 27-02 Task 3 (PACK-02/PACK-03): the workflow-pack eval harness — FIXTURE VALIDATION ONLY.
//
// This half exists BEFORE the adaptation lanes so 27-04/05/06 can validate a fixture's structure
// and its operation ids without a deployed candidate, a model call or a cent. Candidate execution
// and evidence recording are added in 27-08, on top of this file.
//
// 27-08 Task 3 added CANDIDATE EXECUTION on top of it: `--candidate` drives ONE pack's fixtures
// against its deployed candidate version and records suite-bound evidence on that exact row.
//
// Invocation:
//   node scripts/run-workflow-pack-evals.mjs --fixtures-only [--packs a,b]
//   node scripts/run-workflow-pack-evals.mjs --self-test
//   node scripts/run-workflow-pack-evals.mjs --packs <ONE-id> --candidate      COSTS MONEY
//
//   --fixtures-only  OFFLINE: parse and validate every fixture against the code-owned registry.
//                    Zero convex calls, zero model calls, zero spend.
//   --candidate      LIVE, PAID, one pack per invocation. Runs that pack's fixtures against the
//                    EXACT deployed candidate version and, on an all-green full run, records
//                    evidence on that row. NEVER `--all`: `run-eval-golden.mjs`'s cap is per-run,
//                    evidence writes only on an unfiltered all-green run, and one teardown crash
//                    discards the whole gate — so six packs means six invocations, six verdicts.
//   --repeat N       MEASUREMENT MODE, with --candidate. Runs the pack's fixtures N times and
//                    reports per-case stability instead of one pass count. **NEVER writes evidence,
//                    at any score** — see `summarizeRepeats` for why that is not a limitation but
//                    the point. Costs N x a normal run (~$0.006 each on a free model).
//   --dump <path>    DIAGNOSTIC, with --candidate. Writes every case's replies and tool calls to
//                    <path> as JSON, one write per case so an abort still leaves what ran. The
//                    scorer says `citations: expected >= 1, got 0`; only this says WHERE the prose
//                    went. It holds model output, so it is a local file and never part of a gate.
//   --packs          restrict to a comma-separated list of pack ids. A filter that matches NO
//                    fixture is an ERROR, never an empty green run — a typo'd filter silently
//                    shrinking a gate to zero cases and then reporting "all green" is the exact
//                    failure `run-eval-golden.mjs`'s `applyOnly` was hardened against.
//   --self-test      the ponytail one-runnable-check: assert-based, in-file, no framework. It
//                    proves the validator REJECTS each malformed shape before trusting it to
//                    accept the real corpus. `packages/backend/vitest.config.mts` includes only
//                    `convex/**/*.test.ts`, so a `.test.ts` beside this file would never execute —
//                    a gate that cannot run is worse than no gate.
//
// Exit codes, mirroring run-eval-golden.mjs: 0 all green · 1 a fixture (or self-test) failed ·
// 2 environment abort — never an eval failure.
//
// THE REGISTRY IS IMPORTED, NOT PARSED. `packages/core/src/workflowPacks.ts` is erasable-syntax TS
// with no imports, and Node >= 22.6 strips types natively, so this script reads the REAL operation
// matrix rather than a regex approximation of it that could drift from the module it is checking.
// ponytail: that is a hard Node-version floor (CI still pins 20 for the test job, which never runs
// this script). The guard below fails loudly and names the requirement. Upgrade path if the floor
// ever bites: emit a JSON projection of the registry from a build step and read that instead —
// never a second, hand-rolled parse that can disagree with the module.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { must } from "./smokeRun.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "workflow-pack-fixtures");
const registryPath = resolve(here, "../../core/src/workflowPacks.ts");
const thresholdsPath = join(fixturesDir, "thresholds.json");
/** `PACK_EVAL_SUITE` lives in @pikar/contracts (Convex has no filesystem); this script has no build
 *  step, so it READS the constant off disk — the `gatedSkillNames()` idiom, one runner over. */
const skillSrcPath = resolve(here, "../../contracts/src/skill.ts");
const costSrcPath = resolve(here, "../../cost/src/cost.ts");

/** Registry-wide facts, set by `projectRegistry`. Null until the registry is loaded. */
let REGISTRY = null;

const parse = (out) => JSON.parse(out);

/**
 * PER-PACK cost ceiling for ONE invocation. Half of `run-eval-golden.mjs`'s 2.0, because that cap
 * bounds a 33-case whole-suite run and this bounds five cases of one pack. At the measured
 * ~$0.017/case plain and ~$0.21/case when research dispatches, a five-case pack lands well under
 * it; hitting it means something is looping, and the run ABORTS (exit 2) rather than spending on.
 */
const COST_CAP_USD = 1.0;

/**
 * The model every evidence row records — **DERIVED FROM `DEFAULT_MODEL`, NEVER HAND-COPIED.**
 *
 * IT WAS A LITERAL AND IT DRIFTED WITHIN A DAY. On 2026-08-24 the pins moved to `stealth/ox-alpha`
 * and this literal moved with them; on 2026-08-25 the pins moved back and this did not — so a run
 * would have executed `openai/gpt-4o-mini` and written evidence claiming `stealth/ox-alpha`. That is
 * precisely the failure the previous docstring here warned about, shipped by the same hand that
 * wrote the warning. **A comment saying "these must move together" is not a mechanism.**
 *
 * A run picks its model INSIDE the deployment (`chooseModel` -> `DEFAULT_MODEL`), so the only honest
 * source is `packages/cost/src/cost.ts`. Read by regex, exactly as `codeOwnedPackSuite` reads
 * `PACK_EVAL_SUITE` out of `skill.ts`: this is a `.mjs` script and `@pikar/cost` ships unbuilt
 * TypeScript, so there is no import to make.
 *
 * Resolves ONE level of aliasing, the shape cost.ts uses
 * (`DEFAULT_MODEL = OPENAI_DEFAULT_MODEL` -> `OPENAI_DEFAULT_MODEL = "openai/gpt-4o-mini"`), and
 * THROWS rather than guessing: a run that refuses to start is better than an evidence row naming a
 * model that never ran.
 */
function codeOwnedPackModel() {
  const src = readFileSync(costSrcPath, "utf8");
  // 27-10: **`PACK_MODEL`, not `DEFAULT_MODEL`.** This runner certifies PACK runs, and
  // `runSpecialistTurn` now resolves a pack to its own lane — so reading the default here would
  // record evidence naming a model no pack executed, which is the exact dishonesty the docstring
  // above was written about, one lane over. The regex shape is unchanged, so a pack pin that stops
  // being a single-literal alias still THROWS rather than guessing.
  const pin = /^export const PACK_MODEL = ([A-Za-z_][A-Za-z0-9_]*);/m.exec(src);
  if (!pin)
    throw new EnvironmentAbort(`PACK_MODEL not found (or not an alias) in ${costSrcPath}`);
  const lit = new RegExp(`^export const ${pin[1]} = "([^"]+)";`, "m").exec(src);
  if (!lit)
    throw new EnvironmentAbort(
      `PACK_MODEL aliases ${pin[1]}, which is not a string literal in ${costSrcPath} — ` +
        "resolve it by hand rather than letting evidence name a model that never ran",
    );
  return lit[1];
}
const EVAL_MODEL = codeOwnedPackModel();

/** WHICH DEPLOYMENT this run is talking to, for the log lines and the evidence row. It was the
 *  hardcoded string "dev", which is exactly the kind of label that stays right until the day it
 *  silently is not — evidence lives on ONE deployment's skills row, so mislabelling which one a run
 *  certified is the whole failure mode the per-deployment rule exists to prevent. */
const TARGET = process.env.PIKAR_CONVEX_TARGET === "prod" ? "prod" : "dev";

// The Windows/Node-24 `UV_HANDLE_CLOSING` teardown crash: `convex run` completes and dies before
// flushing stdout. `must()` retries only when stdout is EMPTY and no failure banner printed, so a
// real refusal, governed stop or model error still fails hard. Measured economics are unchanged
// from `run-eval-golden.mjs`: a duplicated turn bills ~$0.01, the hard fail it replaces discards a
// whole pack gate.
const RETRY_TURN = { retryOnEmpty: true };

/**
 * `--dump <path>`: every case's REPLIES and tool calls, written as JSON after each case.
 *
 * The scorer reports `citations: expected >= 1, got 0` and nothing about WHERE the prose went — and
 * a pack whose deliverable is a saved document has two planes it could have gone to. Diagnosing
 * that from the failure list alone is guesswork; this is the transcript. Written per case (not at
 * the end) so an abort mid-pack still leaves the cases that ran. Off by default: it holds model
 * prose, so it is a local debugging file, never part of the gate.
 */
let DUMP_PATH = null;
const DUMP = [];
const RETRY_READ = { retryOnEmpty: true };

/** Closed outcome vocabulary. Mirrors `workflowPackEvents.outcome` in convex/schema.ts. */
const OUTCOMES = ["useful", "partial", "blocked", "refused", "failed", "no_findings"];
/** Closed source-state vocabulary. Mirrors `SourceState` in the registry. */
const SOURCE_STATES = ["available", "partial", "unavailable"];

/**
 * The outcomes a GREEN RUN can actually produce — `outcomeFor` in `convex/workflowPackBinding.ts`
 * derives exactly these three. The other three in `OUTCOMES` are real states of the table and are
 * still parsed, but none is an expectation a passing run could satisfy: `blocked` is a guardrail
 * stop (kill switch / budget), `failed` is a thrown bug, and NOTHING in the system emits `refused`.
 *
 * 27-08 FOUND THIS THE EXPENSIVE WAY. 27-04/05/06 authored the corpus against the schema's full
 * six-word union while 27-07 wrote the deriving function afterwards, and three fixtures ended up
 * asserting an outcome no run could reach. They were reconciled to `partial`; this rule is what
 * stops the next author re-introducing one — a case that can only ever fail is worse than no case,
 * because it makes an honest red run indistinguishable from a broken pack.
 */
const EXPECTABLE_OUTCOMES = ["useful", "partial", "no_findings"];

const KNOWN_FLAGS = new Set([
  "--fixtures-only",
  "--self-test",
  "--packs",
  "--candidate",
  "--repeat",
  "--dump",
]);
const VALUED_FLAGS = new Set(["--packs", "--repeat", "--dump"]);

/** `process.argv` really does contain a bare `--` under pnpm. Strip it once, at the entry. */
const stripSeparator = (argv) => argv.filter((a) => a !== "--");

function assertKnownArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const flag = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`unknown flag ${flag}`);
    if (VALUED_FLAGS.has(flag) && !a.includes("=")) {
      const value = argv[i + 1];
      // A swallowed value turns `--packs` into a no-op and the run silently covers everything.
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${flag} requires a value`);
    }
  }
}

function valueFlag(argv, flag) {
  const hit = argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (hit === undefined) return null;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : argv[argv.indexOf(hit) + 1];
}

/** Marks a failure as an ENVIRONMENT abort (exit 2) rather than a fixture failure (exit 1). */
class EnvironmentAbort extends Error {}

async function loadRegistry() {
  try {
    return await import(`file://${registryPath.split("\\").join("/")}`);
  } catch (err) {
    // Exit 2, not 1: a Node too old to strip types is an environment problem, and reporting it as a
    // fixture failure would send a lane hunting through its corpus for a defect that is not there.
    throw new EnvironmentAbort(
      `cannot load the pack registry (${registryPath}). This script strips TypeScript types ` +
        `natively and needs Node >= 22.6; this is ${process.version}. Original: ${err.message}`,
    );
  }
}

/** The registry, projected into the shape the validator asks questions of. */
function projectRegistry(mod) {
  const packs = new Map();
  for (const packId of mod.WORKFLOW_PACK_IDS) {
    const spec = mod.WORKFLOW_PACKS[packId];
    packs.set(packId, {
      output: spec.output,
      tools: new Set(mod.toolsForWorkflowPack(packId)),
      existingOps: new Set(
        spec.operations.filter((op) => op.state === "existing").map((op) => op.id),
      ),
      missingOps: new Set(
        spec.operations.filter((op) => op.state === "missing").map((op) => op.id),
      ),
      forbiddenOps: new Set(
        spec.operations.filter((op) => op.state === "forbidden").map((op) => op.id),
      ),
      missingSources: new Set(
        spec.operations.filter((op) => op.state === "missing").map((op) => op.reads),
      ),
      sources: new Set(
        spec.operations
          .filter((op) => op.state !== "forbidden" && op.reads !== null)
          .map((op) => op.reads),
      ),
      // The REACHABLE half, separately: `expect.sources` must name every one of them, because the
      // scorer derives the preflight's own `sourceAvailableCount` from that list. A fixture that
      // omitted one would silently be compared against a count for a source it never mentioned.
      reachable: new Set(
        spec.operations
          .filter((op) => op.state === "existing" && op.reads !== null)
          .map((op) => op.reads),
      ),
      // Which operation ids each granted tool can evidence, for the trace scorer.
      opTools: new Map(
        spec.operations.filter((op) => op.state === "existing").map((op) => [op.id, [...op.tools]]),
      ),
      missingUnlocks: spec.operations.filter((op) => op.state === "missing").map((op) => op.reads),
    });
  }
  // Module-scope, not properties hung off the Map: the Map is the per-pack projection every
  // caller already passes around, and these three are facts about the REGISTRY as a whole.
  REGISTRY = {
    probeStates: mod.PACK_SOURCE_PROBE_STATES,
    // The synonym list PLUS the code-owned label, minus its leading "your " so it matches inside
    // a sentence. MEASURED 2026-08-26: `connector-financials` produced three DIFFERENT near-misses
    // in four runs — "connected sales systems", then "Sales conversion data. Revenue, acquisition
    // cost" under a heading reading "Measurement gaps the owner cannot resolve in this workflow".
    // Each named the gap correctly and matched no entry. Widening the list one string at a time is a
    // treadmill; the label is the fix, because the BODIES can be told to emit exactly it and
    // `PACK_SOURCE_LABEL` exists precisely so six bodies cannot each invent their own name.
    mentions: Object.fromEntries(
      Object.entries(mod.MISSING_SOURCE_MENTIONS).map(([source, phrases]) => [
        source,
        [...phrases, mod.PACK_SOURCE_LABEL[source].replace(/^your /, "").toLowerCase()],
      ]),
    ),
    labels: mod.PACK_SOURCE_LABEL,
    toolsFor: mod.toolsForWorkflowPack,
  };
  return packs;
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length);

/**
 * Validate ONE fixture against the code-owned matrix. Throws with a message naming the file and the
 * exact violation — a fixture that names an operation the pack does not have, or asserts a tool the
 * pack was never granted, is a fixture that will "pass" against a pack that cannot do the thing.
 */
export function validateFixture(fx, file, packs) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };

  if (!isPlainObject(fx)) fail("fixture is not an object");
  if (typeof fx.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fx.id))
    fail("id must be stable kebab-case");
  if (typeof fx.description !== "string" || fx.description.length < 8)
    fail("description is missing or too short to explain what the case proves");

  const pack = packs.get(fx.pack);
  if (pack === undefined) fail(`pack "${fx.pack}" is not in the registry`);
  if (!fx.id.startsWith(`${fx.pack}-`)) fail(`id must start with its pack id, "${fx.pack}-"`);
  // One FILE per pack, holding an array of cases: `business-pulse.json` carries every
  // business-pulse case. The file name is therefore the pack id, and a case that names a different
  // pack is in the wrong file — which would make `--packs` silently skip it.
  if (`${fx.pack}.json` !== file) fail(`pack "${fx.pack}" does not match its file name`);

  if (!isStringArray(fx.turns) || fx.turns.length === 0)
    fail("turns must be a non-empty array of non-empty strings");

  const e = fx.expect;
  if (!isPlainObject(e)) fail("expect is missing");
  if (!OUTCOMES.includes(e.outcome))
    fail(`expect.outcome "${e.outcome}" is not one of ${OUTCOMES.join("|")}`);
  // …and it must be one a run can REACH. See EXPECTABLE_OUTCOMES.
  if (!EXPECTABLE_OUTCOMES.includes(e.outcome))
    fail(
      `expect.outcome "${e.outcome}" is a real state of the table but NOT one \`outcomeFor\` can ` +
        `derive — a case expecting it can only ever fail`,
    );

  // OPERATIONS. Only an `existing` operation may be expected to happen; naming a `missing` or
  // `forbidden` id here is asserting the pack does something the matrix says it cannot.
  if (!isStringArray(e.operations) || e.operations.length === 0)
    fail("expect.operations must name at least one operation id");
  for (const id of e.operations) {
    if (pack.existingOps.has(id)) continue;
    if (pack.missingOps.has(id))
      fail(`expect.operations names "${id}", which is MISSING for this pack`);
    if (pack.forbiddenOps.has(id))
      fail(`expect.operations names "${id}", which is FORBIDDEN for this pack`);
    fail(`expect.operations names "${id}", which is not an operation of this pack`);
  }

  // SOURCE STATES. Every key must be a source this pack actually touches, or the expectation is
  // about something the run will never resolve.
  if (!isPlainObject(e.sources)) fail("expect.sources is missing");
  for (const [source, state] of Object.entries(e.sources)) {
    if (!pack.sources.has(source))
      fail(`expect.sources names "${source}", not a source of this pack`);
    if (!SOURCE_STATES.includes(state))
      fail(`expect.sources.${source} = "${state}" is not one of ${SOURCE_STATES.join("|")}`);
    // The symmetric rule, which the two checks below already enforce in their own direction: a
    // source the MATRIX calls missing cannot resolve as anything but unavailable, so a fixture
    // asserting one is "available" asserts a state `packPreflight` can never produce.
    if (pack.missingSources.has(source) && state !== "unavailable")
      fail(
        `expect.sources.${source} = "${state}", but the matrix says it is MISSING for this pack`,
      );
    // THE PRODUCIBILITY RULE (27-08). `probeSources` is the only writer of these states and it does
    // not resolve every source across all three: `vault` and `web` are constantly `available`, an
    // empty calendar is `partial`, and the finance spine either exists or does not. 21 of the 30
    // fixtures asserted a state the probe can never return; they were reconciled, and this is what
    // keeps them reconciled.
    const producible = REGISTRY?.probeStates[source];
    if (producible !== undefined && !producible.includes(state))
      fail(
        `expect.sources.${source} = "${state}", which probeSources can never return ` +
          `(it yields ${producible.join("|")})`,
      );
  }
  // Every REACHABLE source must be named, or the scorer's derived `sourceAvailableCount` is wrong.
  for (const source of pack.reachable) {
    if (!(source in e.sources))
      fail(`expect.sources does not name "${source}", a source this pack can read`);
  }

  // THE OUTCOME-REACHABILITY RULE (2026-08-25). The sibling of the producibility rule above, for
  // the terminal instead of the sources, and it was written because 11 of the 30 fixtures expected a
  // terminal NO RUN OF THEIR PACK COULD EVER PRODUCE. `outcomeFor` (workflowPackBinding.ts) is the
  // only writer:
  //     no_findings  ← empty reply
  //     partial      ← truncated || declaredUnsupported || runtimeMissing > 0
  //     useful       ← everything else
  // and `runtimeMissing` counts REACHABLE sources whose state is "unavailable" (buildPreflight —
  // a matrix-MISSING source lands in `missingKnown` and deliberately does NOT make a run partial:
  // "every plane it COULD have read did answer" is the documented bar).
  //
  // Two directions, both mechanical, neither a judgement about what a fixture ought to assert:
  //   • `useful` while a reachable source is declared "unavailable" — that source IS runtimeMissing,
  //     so the terminal is `partial` on every run. 3 fixtures did this.
  //   • `partial` with nothing runtimeMissing, on a pack that does not GRANT `declareUnsupported` —
  //     the only remaining route to `partial` is truncation, which is a failure mode no fixture may
  //     bank on. FOUR OF THE SIX PACKS grant no `declareUnsupported` at all (business-pulse,
  //     customer-complaint, process-sop, brand-review), and 8 of their fixtures did this.
  //
  // DELIBERATELY NOT REJECTED: `partial` with nothing runtimeMissing on a pack that CAN declare. That
  // is reachable — the model may declare — so it is a bet on behaviour, not an impossibility, and
  // this validator does not grade bets. Those cases are listed in docs/playbooks/workflow-packs.md.
  {
    const runtimeMissing = [...pack.reachable].filter((s) => e.sources[s] === "unavailable");
    if (e.outcome === "useful" && runtimeMissing.length > 0)
      fail(
        `expect.outcome "useful" is unreachable: ${runtimeMissing.join(", ")} is a source this pack ` +
          `READS and the fixture declares it unavailable, so outcomeFor returns "partial" every time`,
      );
    if (
      e.outcome === "partial" &&
      runtimeMissing.length === 0 &&
      !pack.tools.has("declareUnsupported")
    )
      fail(
        `expect.outcome "partial" is unreachable: no reachable source is declared unavailable and ` +
          `pack "${fx.pack}" does not grant declareUnsupported, so outcomeFor can only return "useful"`,
      );
  }

  // THE HONEST-PARTIAL ASSERTION. A named missing source must be one the MATRIX calls missing —
  // otherwise the fixture certifies an apology for a source the pack could actually have read.
  if (!Array.isArray(e.missingNamed) || !e.missingNamed.every((s) => typeof s === "string"))
    fail("expect.missingNamed must be an array of source names (use [] when none is expected)");
  for (const source of e.missingNamed) {
    if (!pack.missingSources.has(source))
      fail(`expect.missingNamed names "${source}", which is NOT missing for this pack`);
  }

  // TOOL TRACES, both directions. Allowed must be granted; forbidden must NOT be granted, because
  // asserting the absence of a tool the pack holds is an expectation the runtime cannot honour.
  if (!isStringArray(e.toolsAllowed) || e.toolsAllowed.length === 0)
    fail("expect.toolsAllowed must name at least one granted tool");
  for (const tool of e.toolsAllowed) {
    if (!pack.tools.has(tool))
      fail(`expect.toolsAllowed names "${tool}", which this pack is not granted`);
  }
  if (!Array.isArray(e.toolsForbidden) || !e.toolsForbidden.every((t) => typeof t === "string"))
    fail("expect.toolsForbidden must be an array of tool names");
  for (const tool of e.toolsForbidden) {
    if (pack.tools.has(tool))
      fail(
        `expect.toolsForbidden names "${tool}", which this pack IS granted — it cannot be absent`,
      );
  }

  if (typeof e.artifactCreated !== "boolean") fail("expect.artifactCreated must be a boolean");
  // A pack that cannot write an artifact can never create one.
  if (e.artifactCreated && pack.output === "briefing")
    fail("expect.artifactCreated is true, but this pack's output contract is a briefing");

  if (fx.needles !== undefined && !isStringArray(fx.needles))
    fail("needles, when present, must be an array of non-empty strings");
  return fx;
}

/** Cross-fixture rules — the things no single file can check about itself. */
export function validateCorpus(fixtures, packs) {
  const byId = new Map();
  for (const { fx, file } of fixtures) {
    if (byId.has(fx.id)) throw new Error(`${file}: duplicate fixture id "${fx.id}"`);
    byId.set(fx.id, file);
  }

  // A needle is how a run proves raw content did NOT leak into a log or an event. Two fixtures
  // sharing one makes a leak attributable to either, so the assertion stops meaning anything.
  // Keyed on the CASE id, not the file. With one file per pack a file-keyed check stopped seeing
  // collisions between two cases in the SAME file, which is where they are now most likely.
  const needleOwner = new Map();
  for (const { fx, file } of fixtures) {
    for (const needle of fx.needles ?? []) {
      const owner = needleOwner.get(needle);
      if (owner !== undefined && owner !== fx.id)
        throw new Error(`${file}: needle "${needle}" is used by both ${owner} and ${fx.id}`);
      needleOwner.set(needle, fx.id);
    }
  }

  // THE CORPUS-LEVEL HONEST-PARTIAL RULE (owner decision A): every pack in this pilot has at least
  // one matrix-missing source, so a pack whose fixtures never assert the missing-source statement
  // has no coverage of the phase's primary deliverable. Checked only for packs that HAVE fixtures,
  // so the lanes can land one pack at a time.
  const packsPresent = new Set(fixtures.map(({ fx }) => fx.pack));
  for (const packId of packsPresent) {
    if (packs.get(packId).missingSources.size === 0) continue;
    const covered = fixtures.some(
      ({ fx }) => fx.pack === packId && fx.expect.missingNamed.length > 0,
    );
    if (!covered)
      throw new Error(
        `${packId}: no fixture asserts a missing source, but the matrix says it is starved — ` +
          "the honest-partial statement is a deliverable of this phase, not a fallback",
      );
  }
  return fixtures;
}

function readFixtures(packFilter, packs) {
  let files;
  try {
    files = readdirSync(fixturesDir)
      // `thresholds.json` shares this directory deliberately — it is the only prefix
      // `docs/playbooks/watch.json` registers for pack fixtures — but it is configuration, not a
      // case file, so it is excluded by NAME rather than by shape. A shape-based skip would also
      // swallow a genuinely malformed corpus file.
      .filter((f) => f.endsWith(".json") && f !== "thresholds.json")
      .sort();
  } catch {
    files = []; // the lanes have not written any yet — an empty corpus is valid, not an abort
  }
  const all = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0)
      throw new Error(`${file}: a pack fixture file must be a non-empty ARRAY of cases`);
    for (const fx of parsed) all.push({ file, fx });
  }
  if (packFilter === null) return all;

  const wanted = new Set(
    packFilter
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (wanted.size === 0) throw new Error("--packs was given an empty list");
  // PER NAME, and NEVER conditioned on the corpus being non-empty. The first version of this guard
  // read `kept.length === 0 && all.length > 0`, which made it silent in exactly the case it exists
  // for: with no fixtures on disk, `--packs anything-at-all` validated zero cases and exited 0, so
  // a lane that wrote no fixture would pass its only automated gate. Checking each requested name
  // against the registry AND against the corpus is what makes the gate red until that pack really
  // has coverage — while still allowing the lanes to land one pack at a time.
  for (const id of wanted) {
    if (!packs.has(id)) throw new Error(`--packs names "${id}", which is not a pack id`);
    if (!all.some(({ fx }) => fx.pack === id))
      throw new Error(`--packs names "${id}", which has no fixture of the ${all.length} on disk`);
  }
  return all.filter(({ fx }) => wanted.has(fx.pack));
}

/** The runnable check. Proves the validator goes RED on each malformed shape before it is trusted. */
function selfTest(packs) {
  const good = () => ({
    id: "brand-review-01-generic",
    pack: "brand-review",
    // `useful`, not `partial`: brand-review READS only the vault (which answers), and its absent
    // brand guidance is matrix-MISSING — `missingKnown`, which deliberately does not make a run
    // partial. The pack grants no `declareUnsupported`, so `partial` is unreachable here by
    // construction. This template used to say `partial` and was itself an instance of the defect the
    // outcome-reachability rule now rejects.
    description: "reviews against general principles and names the absent brand guidance",
    turns: ["Review this tagline for me."],
    expect: {
      outcome: "useful",
      operations: ["ground-in-vault", "save-review"],
      sources: { vault: "available", "tenant-brand-guidance": "unavailable" },
      missingNamed: ["tenant-brand-guidance"],
      toolsAllowed: ["searchVault", "saveAsDocument"],
      toolsForbidden: ["proposePlan"],
      artifactCreated: true,
    },
    needles: ["zzq-selftest-needle"],
  });
  const file = "brand-review.json";

  // The accepting case first: if THIS breaks, every rejection below is meaningless.
  validateFixture(good(), file, packs);

  let rejections = 0;
  const mutate = (label, fn) => {
    rejections++;
    const fx = good();
    fn(fx);
    assert.throws(
      () => validateFixture(fx, file, packs),
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `a fixture with ${label} was ACCEPTED — the validator does not check it`,
    );
  };

  mutate("is not in the registry", (fx) => {
    fx.pack = "not-a-pack";
  });
  mutate("does not match its file name", (fx) => {
    fx.pack = "process-sop";
    fx.id = "process-sop-01-x";
  });
  mutate("must start with its pack id", (fx) => {
    fx.id = "campaign-plan-01-generic";
  });
  mutate("is not one of useful", (fx) => {
    fx.expect.outcome = "great";
  });
  mutate("which is FORBIDDEN for this pack", (fx) => {
    fx.expect.operations = ["send-externally"];
  });
  mutate("which is MISSING for this pack", (fx) => {
    fx.expect.operations = ["read-brand-guidance"];
  });
  mutate("not an operation of this pack", (fx) => {
    fx.expect.operations = ["read-finance-figures"];
  });
  mutate("not a source of this pack", (fx) => {
    fx.expect.sources = { calendar: "available" };
  });
  mutate("is not one of available", (fx) => {
    fx.expect.sources = { vault: "sort-of" };
  });
  mutate("which is NOT missing for this pack", (fx) => {
    fx.expect.missingNamed = ["vault"];
  });
  mutate("the matrix says it is MISSING for this pack", (fx) => {
    fx.expect.sources["tenant-brand-guidance"] = "available";
  });
  // 27-08's two producibility rules. Each of these shapes SHIPPED in the wave-2 corpus and could
  // only ever have failed, so each earns its own rejection case rather than a shared one.
  mutate("probeSources can never return", (fx) => {
    // `vault` is constantly `available`; the probe has no branch that yields anything else.
    fx.expect.sources.vault = "unavailable";
  });
  mutate("NOT one `outcomeFor` can derive", (fx) => {
    fx.expect.outcome = "refused";
  });
  mutate("a source this pack can read", (fx) => {
    fx.expect.sources = { "tenant-brand-guidance": "unavailable" };
  });
  mutate("which this pack is not granted", (fx) => {
    fx.expect.toolsAllowed = ["stageCrmWrite"];
  });
  mutate("it cannot be absent", (fx) => {
    fx.expect.toolsForbidden = ["searchVault"];
  });
  mutate("must be a non-empty array", (fx) => {
    fx.turns = [];
  });
  mutate("artifactCreated must be a boolean", (fx) => {
    fx.expect.artifactCreated = "yes";
  });
  // The remaining shape rules. Each had no case, which meant deleting that rule from the validator
  // left the self-test green — the tally counts CASES, so a rule with no case is invisible to it.
  mutate("too short to explain what the case proves", (fx) => {
    fx.description = "short";
  });
  mutate("id must be stable kebab-case", (fx) => {
    fx.id = "Brand Review 01";
  });
  mutate("expect is missing", (fx) => {
    fx.expect = "not an object";
  });
  mutate("must name at least one operation id", (fx) => {
    fx.expect.operations = [];
  });
  mutate("must name at least one granted tool", (fx) => {
    fx.expect.toolsAllowed = [];
  });
  mutate("needles, when present, must be an array", (fx) => {
    fx.needles = "one-needle";
  });

  // A pack whose output contract is a briefing cannot create an artifact.
  rejections++;
  assert.throws(
    () =>
      validateFixture(
        {
          ...good(),
          id: "business-pulse-01-x",
          pack: "business-pulse",
          expect: {
            ...good().expect,
            operations: ["ground-in-vault"],
            sources: { vault: "available", "finance-inputs": "available" },
            missingNamed: ["phase26-summaries"],
            toolsAllowed: ["searchVault"],
            toolsForbidden: ["createDocument"],
            artifactCreated: true,
          },
        },
        "business-pulse.json",
        packs,
      ),
    /output contract is a briefing/,
  );

  // Corpus rules.
  rejections++;
  assert.throws(
    () =>
      validateCorpus(
        [
          { file, fx: good() },
          { file, fx: { ...good(), id: "brand-review-02-b" } },
        ],
        packs,
      ),
    /is used by both/,
    "two fixtures sharing a needle were ACCEPTED",
  );
  rejections++;
  assert.throws(
    () =>
      validateCorpus(
        [
          { file, fx: { ...good(), id: "brand-review-01-generic" } },
          { file, fx: good() },
        ],
        packs,
      ),
    /duplicate fixture id/,
  );
  const noMissing = good();
  noMissing.expect.missingNamed = [];
  rejections++;
  assert.throws(
    () => validateCorpus([{ file, fx: noMissing }], packs),
    /no fixture asserts a missing source/,
    "a starved pack with no honest-partial fixture was ACCEPTED",
  );

  // …and the accepting direction for the corpus, so the rules above are not merely throwing at
  // everything.
  validateCorpus([{ file, fx: good() }], packs);

  // ── the LIVE half, exercised offline (27-08) ──────────────────────────────────────────────
  //
  // `packages/backend/vitest.config.mts` includes only `convex/**/*.test.ts`, so a `.test.ts`
  // beside this file would never run. These assertions are how the paid path gets a check that
  // costs nothing: every one of them is over a pure function or a file already on disk.

  // Money detection, both directions. A false positive here fails a good pack; a false negative
  // lets an invented figure through, which is the whole point of `maxUnsupportedFigures`.
  assert.deepEqual(moneyIn("runway is $12,400 and CAC is $1,400"), [12400, 1400]);
  assert.deepEqual(moneyIn("we sent 3 emails on 12 March about Q3"), []);
  assert.deepEqual(moneyIn("about EUR 900 per month"), [900]);
  assert.deepEqual(urlsIn("see https://example.com/a and (https://b.example/c)"), [
    "https://example.com/a",
    "https://b.example/c",
  ]);

  // The provider-abort classifier decides exit 1 (this pack is broken) vs exit 2 (the environment
  // is). Getting it wrong in either direction is expensive, so both directions are pinned.
  assert.ok(PROVIDER_ABORT.test("Uncaught Error: ... code: 'credit_balance_exhausted' ..."));
  assert.ok(PROVIDER_ABORT.test("http2 error: keep-alive timed out: operation timed out"));
  assert.ok(PROVIDER_ABORT.test("429 Too Many Requests"));
  assert.ok(!PROVIDER_ABORT.test("NO_ACTIVE_SKILL: pack-brand-review"));
  assert.ok(!PROVIDER_ABORT.test("PACK_GATE: pack-brand-review v1 lacks eval evidence"));

  // The per-case tenant must satisfy `smoke.seedPackEvalTenant`'s guard, or every live run aborts
  // on its first seed call — after the deployment check has already passed and looked healthy.
  assert.match(tenantFor(randomUUID(), 4), /^packeval-[0-9a-f]{8}-[a-z0-9-]+$/);

  // The suite the gate will check must be the suite on disk. This is the same comparison
  // `runCandidate` makes before spending, run here so a fixture edit reddens the FREE gate first.
  const declaredSuite = codeOwnedPackSuite();
  for (const [name, declaredPack] of declaredSuite.packs) {
    const disk = suiteIdentityOnDisk(name.replace(/^pack-/, ""));
    assert.equal(disk.casesHash, declaredPack.casesHash, `${name} casesHash has drifted from disk`);
    assert.equal(disk.caseCount, declaredPack.caseCount, `${name} caseCount has drifted from disk`);
  }
  assert.equal(declaredSuite.packs.size, 6, "PACK_EVAL_SUITE does not declare all six packs");

  // Every pack must have thresholds, and none may licence an invented money figure.
  for (const packId of packs.keys()) {
    const t = thresholdsFor(packId);
    assert.equal(t.maxUnsupportedFigures, 0, `${packId} allows unsupported figures`);
    assert.equal(
      t.minCasesPassed,
      suiteIdentityOnDisk(packId).caseCount,
      `${packId}: minCasesPassed is not the whole corpus, which no evidence row could ever satisfy`,
    );
  }

  // THE SCORER. A green scoring of a passing run, then one mutation per assertion — because a
  // scorer that cannot fail is a gate that certifies whatever it is handed.
  const scored = (over = {}, fxOver = {}) =>
    scoreCase({
      fx: { ...good(), ...fxOver },
      pack: packs.get("brand-review"),
      packId: "brand-review",
      transcript:
        "I reviewed against general principles; you have no confirmed brand guidance saved.",
      facts: {
        events: [
          { event: "run_started", createdAt: 1, outcome: null },
          {
            event: "preflight_completed",
            createdAt: 2,
            sourceAvailableCount: 1,
            sourceExpectedCount: 3,
            preflightMissingCount: 2,
          },
          { event: "artifact_created", createdAt: 3 },
          { event: "run_completed", createdAt: 9, outcome: "useful", skillVersion: 1 },
        ],
        artifactCount: 1,
        ...over.facts,
      },
      calls: over.calls ?? { searchVault: 1, saveAsDocument: 1, thinking: 1 },
      thresholds: { maxUnsupportedFigures: 0, minCitationsWhenWebRead: 0 },
      mentions: REGISTRY.mentions,
    });

  assert.deepEqual(scored(), [], "a passing run was scored as a failure");

  const keysOf = (failures) => failures.map((f) => f.key);
  const mutations = [
    // Same discipline as the artifact case: only the terminal OUTCOME differs, so nothing else can
    // be what reddens.
    [
      "outcome",
      () =>
        scored({
          facts: {
            events: [
              { event: "run_started", createdAt: 1, outcome: null },
              {
                event: "preflight_completed",
                createdAt: 2,
                sourceAvailableCount: 1,
                sourceExpectedCount: 3,
                preflightMissingCount: 2,
              },
              { event: "artifact_created", createdAt: 3 },
              { event: "run_completed", createdAt: 9, outcome: "partial", skillVersion: 1 },
            ],
            artifactCount: 1,
          },
        }),
    ],
    ["operation:save-review", () => scored({ calls: { searchVault: 1 } })],
    [
      "forbidden:proposePlan",
      () => scored({ calls: { searchVault: 1, saveAsDocument: 1, proposePlan: 1 } }),
    ],
    [
      "ungranted:stageCrmWrite",
      () => scored({ calls: { searchVault: 1, saveAsDocument: 1, stageCrmWrite: 1 } }),
    ],
    // The event list is kept INTACT here: `artifactCount: 0` alone must be what reddens, or the
    // case would pass on the back of a missing terminal row and prove nothing about artifacts.
    [
      "artifactCreated",
      () =>
        scored({
          facts: {
            events: [
              { event: "run_started", createdAt: 1, outcome: null },
              {
                event: "preflight_completed",
                createdAt: 2,
                sourceAvailableCount: 1,
                sourceExpectedCount: 3,
                preflightMissingCount: 2,
              },
              { event: "run_completed", createdAt: 9, outcome: "useful", skillVersion: 1 },
            ],
            artifactCount: 0,
          },
        }),
    ],
  ];
  for (const [key, run] of mutations) {
    rejections++;
    const failures = run();
    assert.ok(
      keysOf(failures).some((k) => k === key),
      `the scorer did not report ${key} — it reported ${JSON.stringify(keysOf(failures))}`,
    );
  }

  // The prose assertion, in both directions. It is the ONLY heuristic in the gate, so it gets the
  // same treatment as the structural ones rather than being trusted because it looks reasonable.
  rejections++;
  const silent = scoreCase({
    fx: good(),
    pack: packs.get("brand-review"),
    packId: "brand-review",
    transcript: "Here is your brand review. Everything looks consistent.",
    facts: {
      events: [
        {
          event: "preflight_completed",
          createdAt: 2,
          sourceAvailableCount: 1,
          sourceExpectedCount: 3,
          preflightMissingCount: 2,
        },
        { event: "run_completed", createdAt: 9, outcome: "useful" },
      ],
      artifactCount: 1,
    },
    calls: { searchVault: 1, saveAsDocument: 1 },
    thresholds: { maxUnsupportedFigures: 0, minCitationsWhenWebRead: 0 },
    mentions: REGISTRY.mentions,
  });
  assert.ok(
    keysOf(silent).includes("missingNamed:tenant-brand-guidance"),
    "a reply that never named the missing brand guidance was scored as a PASS — the honest-partial " +
      "statement is the deliverable of this phase, not a nicety",
  );

  // ── THE OUTCOME-REACHABILITY RULE, BOTH DIRECTIONS ──
  //
  // The `partial` direction mutates `good()`: brand-review grants no `declareUnsupported` and its one
  // reachable source (vault) is available, so `partial` is unreachable for it.
  mutate("is unreachable", (fx) => {
    fx.expect.outcome = "partial";
  });

  // The `useful` direction CANNOT be built from `good()`, and the reason is worth stating:
  // brand-review reads only the vault, and `probeSources` can never return `vault: "unavailable"` —
  // so the 27-08 producibility rule rejects that mutation FIRST, with its own message, and a test
  // asserting /is unreachable/ would pass for the wrong reason on a rule that had been deleted.
  // It needs a pack with a reachable source that can genuinely be unavailable: customer-complaint
  // reads `inbox`, which is exactly that.
  const goodCC = () => ({
    id: "customer-complaint-01-selftest",
    pack: "customer-complaint",
    description: "drafts a reply from pasted text while the mailbox itself is unreadable",
    turns: ["A customer complained. Draft me a reply."],
    expect: {
      outcome: "partial",
      operations: ["ground-in-vault", "draft-reply", "stage-for-approval"],
      sources: { vault: "available", inbox: "unavailable" },
      missingNamed: ["crm-facts", "connector-financials"],
      toolsAllowed: ["searchVault", "replyToMessage", "proposePlan"],
      toolsForbidden: ["stageCrmWrite", "dispatchResearch", "generateAttachment", "createDocument"],
      artifactCreated: false,
    },
  });
  // The accepting case FIRST, exactly as `good()` is used above: if this does not validate, the
  // rejection below proves nothing about the rule under test.
  validateFixture(goodCC(), "customer-complaint.json", packs);
  rejections++;
  assert.throws(
    () => {
      const fx = goodCC();
      fx.expect.outcome = "useful";
      validateFixture(fx, "customer-complaint.json", packs);
    },
    /is unreachable/,
    "a fixture expecting `useful` while a source the pack READS is unavailable was ACCEPTED — " +
      "that source is runtimeMissing, so outcomeFor returns partial on every run and the case can " +
      "only ever fail",
  );

  rejections++;
  const invented = scoreCase({
    fx: good(),
    pack: packs.get("brand-review"),
    packId: "brand-review",
    transcript: "You have no confirmed brand guidance; rebranding usually costs about $18,000.",
    facts: {
      events: [
        {
          event: "preflight_completed",
          createdAt: 2,
          sourceAvailableCount: 1,
          sourceExpectedCount: 3,
          preflightMissingCount: 2,
        },
        { event: "run_completed", createdAt: 9, outcome: "useful" },
      ],
      artifactCount: 1,
    },
    calls: { searchVault: 1, saveAsDocument: 1 },
    thresholds: { maxUnsupportedFigures: 0, minCitationsWhenWebRead: 0 },
    mentions: REGISTRY.mentions,
  });
  assert.ok(
    keysOf(invented).includes("unsupportedFigures"),
    "an invented money figure was accepted",
  );

  // THE REGRESSION GUARD FOR THE 2026-08-24 SCOPE FIX. Two turns: the gap is named in the FIRST and
  // the second is the bare follow-up these fixtures actually contain. Under the old last-turn-only
  // scoring this scored `missingNamed:tenant-brand-guidance` and was the reason 4 of 5
  // customer-complaint cases failed on BOTH models. It must PASS.
  //
  // PAIRED with the `silent` rejection above, deliberately: that one proves a transcript which NEVER
  // names the gap still FAILS. Without the pair, "join the turns" could be satisfied by a scorer that
  // stopped checking altogether — which is the failure mode this file's own comments keep naming.
  const acrossTurns = scoreCase({
    fx: good(),
    pack: packs.get("brand-review"),
    packId: "brand-review",
    transcript:
      "I reviewed against general principles; you have no confirmed brand guidance saved." +
      "\n\nDone — it is saved to your vault.",
    facts: {
      events: [
        {
          event: "preflight_completed",
          createdAt: 2,
          sourceAvailableCount: 1,
          sourceExpectedCount: 3,
          preflightMissingCount: 2,
        },
        { event: "run_completed", createdAt: 9, outcome: "useful" },
      ],
      artifactCount: 1,
    },
    calls: { searchVault: 1, saveAsDocument: 1 },
    thresholds: { maxUnsupportedFigures: 0, minCitationsWhenWebRead: 0 },
    mentions: REGISTRY.mentions,
  });
  assert.deepEqual(
    acrossTurns,
    [],
    "a gap named in turn 1 and not repeated in turn 2 was scored as a FAILURE — the honest-partial " +
      "statement is a property of the RUN, not of every individual turn",
  );

  // And the fabrication guard must now SEE turn 1, not just the last turn.
  rejections++;
  const inventedEarly = scoreCase({
    fx: good(),
    pack: packs.get("brand-review"),
    packId: "brand-review",
    transcript:
      "You have no confirmed brand guidance; rebranding usually costs about $18,000." +
      "\n\nSaved to your vault.",
    facts: {
      events: [
        {
          event: "preflight_completed",
          createdAt: 2,
          sourceAvailableCount: 1,
          sourceExpectedCount: 3,
          preflightMissingCount: 2,
        },
        { event: "run_completed", createdAt: 9, outcome: "useful" },
      ],
      artifactCount: 1,
    },
    calls: { searchVault: 1, saveAsDocument: 1 },
    thresholds: { maxUnsupportedFigures: 0, minCitationsWhenWebRead: 0 },
    mentions: REGISTRY.mentions,
  });
  assert.ok(
    keysOf(inventedEarly).includes("unsupportedFigures"),
    "a money figure invented in an EARLIER turn was accepted — the old last-turn-only scoring could " +
      "not see it at all",
  );

  // ── summarizeRepeats: the one piece of --repeat that can be checked without spending money ──
  //
  // The bucket boundaries are the whole contract, so they are asserted at both edges (N/N and 0/N)
  // and in the middle. The FLAKY case is built from the real observation that motivated repeat mode:
  // the same case failing two DIFFERENT ways across identical runs.
  {
    const runs = [
      [
        { id: "a", pass: true, failures: [] },
        { id: "b", pass: false, failures: [{ key: "missingNamed:crm-facts" }] },
        { id: "c", pass: false, failures: [{ key: "operation:ground-in-vault" }] },
      ],
      [
        { id: "a", pass: true, failures: [] },
        { id: "b", pass: true, failures: [] },
        { id: "c", pass: false, failures: [{ key: "missingNamed:crm-facts" }] },
      ],
    ];
    const s = summarizeRepeats(runs);
    assert.equal(s.runs, 2);
    assert.equal(s.stablePass, 1, "a passed both runs and must be stable-pass");
    assert.equal(s.stableFail, 1, "c failed both runs and must be stable-fail");
    assert.equal(s.flaky, 1, "b passed once and failed once — that is the verdict repeat mode exists for");
    const b = s.cases.find((x) => x.id === "b");
    assert.equal(b.verdict, "flaky");
    assert.equal(b.passed, 1);
    // c failed BOTH runs but for DIFFERENT reasons, and both must survive into the report — a
    // stable-fail that is actually two alternating defects is the case most likely to be
    // mis-diagnosed from one log.
    const c = s.cases.find((x) => x.id === "c");
    assert.equal(c.verdict, "stable-fail");
    assert.deepEqual(
      c.failures.map((f) => f.key).sort(),
      ["missingNamed:crm-facts", "operation:ground-in-vault"],
      "a stable-fail must report EVERY way it failed, not just the first",
    );
    // A single run must never be reported as stability.
    const one = summarizeRepeats([runs[0]]);
    assert.equal(one.flaky, 0, "one run cannot detect flakiness");
    assert.equal(one.stablePass, 1);
    assert.equal(summarizeRepeats([]).runs, 0, "no runs must not throw");
  }

  // ── assertRanModel: the model half of "did the thing we are certifying actually run" ──
  {
    const ok = [
      { id: "a", ranModels: ["openai/gpt-4o-mini"], spendRows: 2 },
      { id: "b", ranModels: ["openai/gpt-4o-mini"], spendRows: 1 },
    ];
    assert.doesNotThrow(
      () => assertRanModel(ok, "openai/gpt-4o-mini"),
      "a run that executed exactly the pinned model was refused",
    );

    rejections++;
    assert.throws(
      () => assertRanModel(ok, "stealth/ox-alpha"),
      /executed model\(s\)/,
      "evidence naming a model the run never executed was ACCEPTED",
    );

    // THE LIVE SHAPE: primary exhausted, fallback answered, run still green.
    rejections++;
    assert.throws(
      () =>
        assertRanModel(
          [{ id: "a", ranModels: ["google/gemini-3.5-flash-lite"], spendRows: 1 }],
          "openai/gpt-4o-mini",
        ),
      /A fallback almost certainly fired/,
      "a run carried entirely by the FALLBACK was certified under the primary's name",
    );

    // A mixed run is not "mostly the pin" — it is two models, and neither is what evidence says.
    rejections++;
    assert.throws(
      () =>
        assertRanModel(
          [
            { id: "a", ranModels: ["openai/gpt-4o-mini"], spendRows: 1 },
            { id: "b", ranModels: ["google/gemini-3.5-flash-lite"], spendRows: 1 },
          ],
          "openai/gpt-4o-mini",
        ),
      /executed model\(s\)/,
      "a run where only SOME cases fell back was accepted",
    );

    // Absence must never read as agreement.
    rejections++;
    assert.throws(
      () => assertRanModel([{ id: "a", ranModels: [], spendRows: 0 }], "openai/gpt-4o-mini"),
      /no model-spend rows/,
      "a case with NO spend rows was treated as proof the pinned model ran",
    );
  }

  // Counted, never hardcoded: a self-test that reports a number it does not derive is the first
  // step to a self-test that reports a number it no longer earns.
  // A TRIPWIRE, like the table count in tenantData.test.ts: the floor equals what the self-test
  // exercises today, so DELETING a case fails here and forces the deleter to say why. Adding one is
  // free. Without it, `rejections` is only a number printed to a log nobody diffs.
  assert.ok(rejections >= 42, `self-test only exercised ${rejections} rejections, expected >= 42`);
  console.log(
    `self-test: ${rejections} validator/scorer rejections and the live-path invariants verified`,
  );
}

// ══ LIVE CANDIDATE EXECUTION (27-08 Task 3) ═════════════════════════════════════════════════
//
// ONE PACK PER INVOCATION, on DEV. Everything below spends money; nothing above it does.
//
// WHAT IT GRADES, AND WHAT IT DOES NOT. Eight of the nine per-case assertions are FACTS OF THE RUN
// — event rows the binding wrote and tool rows the SDK wrote — not readings of prose:
//
//   outcome            the terminal `workflowPackEvents` row's own `outcome`
//   operations         >= 1 of the operation's granted tools appears in the thread's `agentSteps`
//   forbidden tools    none of them appears
//   the grant          every tool called is in `toolsForWorkflowPack` — the allow-list, proven
//   artifact           `artifact_created` rows, not a claim in the reply
//   source counts      the preflight event's own expected/available counts, derived from the
//                      fixture's `expect.sources` — which is also what SEEDED the tenant, so the
//                      two cannot agree by accident
//   missing sources    the preflight event's `preflightMissingCount`
//   needles            a per-case marker, asserted ABSENT from every structured log plane
//
// The ninth is the honest-partial statement, which is prose by nature and is the deliverable of the
// phase: the reply must NAME each missing source, matched against `MISSING_SOURCE_MENTIONS`.
//
// COST AND LATENCY ARE READ, NEVER RE-EMITTED. `costUsd` comes back from the action, which sums the
// `spendEvents` rows it caused; duration is the pack's own `run_started` -> terminal event gap. A
// second number computed here could disagree with the billing plane, and a number that can disagree
// with billing is worse than no number.

/** One throwaway tenant PER CASE — the preflight is resolved from tenant state, so cases that want
 *  different source states cannot share one. Matches `smoke.seedPackEvalTenant`'s guard exactly. */
const tenantFor = (runId, index) => `packeval-${runId.slice(0, 8)}-c${index}`;

/** The pack eval suite identity as declared in @pikar/contracts, read off disk (no build step). */
function codeOwnedPackSuite() {
  const src = readFileSync(skillSrcPath, "utf8");
  const block = /export const PACK_EVAL_SUITE[^=]*=\s*\{([\s\S]*?)\n\} as const;/.exec(src);
  if (!block) throw new EnvironmentAbort(`PACK_EVAL_SUITE not found in ${skillSrcPath}`);
  const revision = /revision:\s*"([^"]+)"/.exec(block[1]);
  if (!revision) throw new EnvironmentAbort("PACK_EVAL_SUITE has no revision");
  const packs = new Map();
  for (const m of block[1].matchAll(
    /"(pack-[a-z-]+)":\s*\{\s*casesHash:\s*"([0-9a-f]{64})",\s*caseCount:\s*(\d+),?\s*\}/g,
  )) {
    packs.set(m[1], { casesHash: m[2], caseCount: Number(m[3]) });
  }
  if (packs.size === 0) throw new EnvironmentAbort("PACK_EVAL_SUITE declares no packs");
  return { revision: revision[1], packs };
}

/** This pack's fixture file AS IT IS ON DISK. LF-normalized: the root `.gitattributes` is text=auto. */
function suiteIdentityOnDisk(packId) {
  const raw = readFileSync(join(fixturesDir, `${packId}.json`), "utf8").replace(/\r\n/g, "\n");
  return {
    casesHash: createHash("sha256").update(raw).digest("hex"),
    caseCount: JSON.parse(raw).length,
  };
}

/** Per-pack thresholds. Absent file or absent pack is an ABORT, never a default — a threshold that
 *  silently defaults is a threshold nobody set. */
function thresholdsFor(packId) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(thresholdsPath, "utf8"));
  } catch (err) {
    throw new EnvironmentAbort(`cannot read ${thresholdsPath}: ${err.message}`);
  }
  const t = doc.packs?.[packId];
  if (t === undefined) throw new EnvironmentAbort(`thresholds.json declares no ${packId}`);
  return t;
}

/**
 * PROVIDER FAILURES ARE NOT PACK FAILURES, and this repo has already paid to learn it: an exhausted
 * OpenAI balance surfaces as every case failing at $0.0000, which reads exactly like six broken
 * bodies. (Confirmed again while this runner was being built — the dev key's balance was empty, and
 * the first symptom was a seeding call dying mid-run.) Anything matching this is re-thrown as an
 * EnvironmentAbort, so the run exits 2 and nobody goes hunting through a body that is fine.
 */
const PROVIDER_ABORT =
  /insufficient_quota|credit_balance_exhausted|billing|rate.?limit|429|ECONNRESET|ETIMEDOUT|keep-alive|socket hang up|fetch failed/i;

/** Run a paid turn, classifying a provider/network failure as an ENV abort rather than a verdict. */
function paidTurn(args) {
  try {
    return parse(must("workflowPackBinding:runWorkflowPack", args, RETRY_TURN));
  } catch (err) {
    if (PROVIDER_ABORT.test(err.message ?? "")) {
      throw new EnvironmentAbort(
        `the model provider refused before this pack could be judged: ${err.message}`,
      );
    }
    throw err;
  }
}

/**
 * Refuse to certify a run whose MODEL is not the one evidence will name.
 *
 * The runner already refuses when the executed SKILL VERSION differs from the pin — "recording
 * evidence would certify a body that did not run". This is the same sentence for the other half of
 * the identity, and the gap it closes is live rather than theoretical: `EVAL_MODEL` is derived from
 * `DEFAULT_MODEL`, which is what the deployment CHOOSES, not what answered. An eligible primary
 * failure rolls over to `CHEAP_MODEL` and the run still SUCCEEDS. With a primary on an exhausted key
 * and a fallback on a funded one — the exact dev configuration — every green run would certify the
 * fallback's work under the primary's name.
 *
 * **ZERO SPEND ROWS IS A FAILURE, NOT A PASS.** `recordModelSpend` returns early WITHOUT writing when
 * `priceUsage` rejects the id, so "no rows" means either nothing ran or something unpriced did.
 * Neither is evidence that the pin ran, and reading absence as agreement is the vacuous green this
 * file exists to refuse.
 *
 * Pure and exported so it is checked by `--self-test` rather than only on the rare all-green run —
 * a gate that can only be exercised by success is a gate nobody has seen work.
 */
export function assertRanModel(results, evalModel) {
  const noSpend = results.filter((r) => (r.spendRows ?? 0) === 0).map((r) => r.id);
  if (noSpend.length > 0)
    throw new EnvironmentAbort(
      `no model-spend rows for ${noSpend.join(", ")} — cannot prove which model ran, so evidence ` +
        "would be a claim rather than a record",
    );
  const ran = [...new Set(results.flatMap((r) => r.ranModels ?? []))].sort();
  if (ran.length !== 1 || ran[0] !== evalModel)
    throw new EnvironmentAbort(
      `the runs executed model(s) ${ran.join(", ") || "none"} but evidence would record ` +
        `"${evalModel}" (derived from DEFAULT_MODEL). A fallback almost certainly fired — fund or ` +
        "repoint the primary, or run the gate on the model you intend to certify.",
    );
}

/**
 * Fold N independent runs of the same pack into a per-case stability report.
 *
 * **WHY THIS EXISTS.** Two runs of `customer-complaint` on an IDENTICAL configuration scored 0/5 and
 * 1/5, and individual cases changed which way they failed — case 03 failed on `missingNamed` in one
 * run and on dropped tool calls in the next. A pack score from ONE invocation is a measurement of the
 * dice, not of the change, and a whole afternoon of model comparisons was made worthless by not
 * knowing that. The upstream DeepSWE harness used `-k 3` for the same reason.
 *
 * THE THREE BUCKETS ARE THE WHOLE POINT, because they need different actions:
 *   `stable-pass`  passed every run — the only kind of green worth believing.
 *   `stable-fail`  failed every run — a real defect. Read `failures`: a case that fails the SAME way
 *                  every time is a bug in the body, the corpus or the code, and is fixable.
 *   `flaky`        passed sometimes. NOT a smaller version of stable-fail: it is a statement about
 *                  the MODEL, and no amount of editing a fixture will settle it.
 *
 * `failures` counts each assertion key across all runs, so "which way did it fail" is answerable
 * without re-reading N logs — that is what separates "the corpus is wrong" from "the model wobbles".
 *
 * Pure and exported: this is the one piece of repeat mode that can be checked without spending money.
 */
export function summarizeRepeats(runs) {
  if (runs.length === 0) return { runs: 0, cases: [], stablePass: 0, stableFail: 0, flaky: 0 };
  const byCase = new Map();
  for (const run of runs) {
    for (const r of run) {
      if (!byCase.has(r.id)) byCase.set(r.id, { id: r.id, passed: 0, failures: new Map() });
      const agg = byCase.get(r.id);
      if (r.pass) agg.passed++;
      for (const f of r.failures ?? [])
        agg.failures.set(f.key, (agg.failures.get(f.key) ?? 0) + 1);
    }
  }
  const cases = [...byCase.values()].map((c) => ({
    id: c.id,
    passed: c.passed,
    of: runs.length,
    verdict: c.passed === runs.length ? "stable-pass" : c.passed === 0 ? "stable-fail" : "flaky",
    // Most frequent first: the failure that happens every run is the one to fix.
    failures: [...c.failures.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n })),
  }));
  return {
    runs: runs.length,
    cases,
    stablePass: cases.filter((c) => c.verdict === "stable-pass").length,
    stableFail: cases.filter((c) => c.verdict === "stable-fail").length,
    flaky: cases.filter((c) => c.verdict === "flaky").length,
  };
}

/** Money amounts in a reply. Currency-marked only — a bare number is usually a count or a date. */
const moneyIn = (text) =>
  [...text.matchAll(/(?:[$£€]\s?|\b(?:usd|eur|gbp)\s?)([\d,]+(?:\.\d+)?)/gi)].map((m) =>
    Number(m[1].replace(/,/g, "")),
  );

const urlsIn = (text) => [...text.matchAll(/https?:\/\/[^\s)>\]]+/g)].map((m) => m[0]);

/** Seed exactly the tenant state this case's `expect.sources` declares. The fixture is the seed
 *  directive AND the assertion, which is what makes the preflight expectation non-circular: the
 *  seed goes in through the product's own writers, and the assertion reads the probe's own output. */
function seedCase(tenant, fx, pack) {
  const src = fx.expect.sources;
  must("smoke:seedPackEvalTenant", {
    tenantId: tenant,
    finance: src["finance-inputs"] === "available",
    calendar: src.calendar === "available",
    inbox: src.inbox === "available",
  });
  if (src.inbox === "available") {
    // The MESSAGES. The read tools take this seam before the token, so the mailbox is real and
    // offline; `seedPackEvalTenant`'s token row is only what makes the PREFLIGHT agree with them.
    // `complaint: true` is OPT-IN and only this runner passes it. `pack-customer-complaint` stages
    // through `replyToMessage`, which resolves its target server-side against this mailbox — with no
    // complaint in it the pack cannot stage anything by any route (measured 0/5, 2026-08-26).
    must("smoke:seedInboxFixture", { tenantId: tenant, offlineDigest: false, complaint: true });
  }
  // The vault corpus is seeded for cases that expect the pack to ground in it. There is no
  // `expect.sources.vault` signal to use — the probe reports `vault: available` unconditionally,
  // because an empty vault is the tool's own honest answer rather than a preflight fact.
  //
  // THIS ONE IS NOT FREE AND NOT LOCAL: `vaultSmoke:seedCorpus` embeds each brief through the
  // OpenAI embeddings API. The spend is a rounding error next to a model turn, but the NETWORK CALL
  // is a real flake surface — it timed out once while this runner was being built. Hence the single
  // retry: the alternative is a transient keep-alive timeout discarding a paid pack gate.
  if (fx.expect.operations.some((id) => (pack.opTools.get(id) ?? []).includes("searchVault"))) {
    const seedVault = () =>
      must("vaultSmoke:seedCorpus", { tenantId: tenant, needle: `zqv${fx.id.slice(-6)}` });
    try {
      seedVault();
    } catch {
      console.log(`    (vault seed retry for ${fx.id})`);
      seedVault();
    }
  }
}

/**
 * Score ONE case against what actually happened. Returns the list of failures (empty = pass).
 *
 * `transcript` IS EVERY TURN'S REPLY JOINED, NOT THE LAST ONE — renamed from `reply` 2026-08-24
 * because the old name was the bug. **MEASURED:** `customer-complaint` scored 0/5 on ox-alpha and
 * 1/5 on gemini-3.5-flash, and `missingNamed:crm-facts` failed on 4 of 5 cases FOR BOTH MODELS. A
 * failure that is identical across two unrelated models is not a model failure. The single passing
 * case was the only 1-TURN fixture in the file; every 2-turn fixture failed.
 *
 * THE MECHANISM: the honest-partial statement is made when the pack first answers, and turn 2 of
 * these fixtures is a bare follow-up — `"That reads well, put it in front of me."` — which has no
 * reason to restate a data gap the user was told about a moment ago. Scoring only the final turn
 * asked the model to repeat itself and called it dishonest when it did not.
 *
 * THE ROOT CAUSE WAS A SCOPE MISMATCH, AND IT WAS SHARED BY ALL THREE PROSE ASSERTIONS. `facts` is
 * whole-RUN and `calls` comes from `smoke:toolCallsForThread` — whole-THREAD. Only the prose was
 * last-turn. So the same defect sat under two more checks, and fixing only `missingNamed` would have
 * left them:
 *   • `unsupportedFigures` — a figure invented in turn 1 was invisible. This widens the guard
 *     (strictly more fabrication is now caught), which is the correct direction for a fabrication
 *     check and cannot make a clean run red.
 *   • `citations` — gated on `called.has("webResearch")`, a WHOLE-THREAD fact, then counted URLs in
 *     the LAST reply. A run that searched and cited in turn 1 failed for citing in the wrong turn.
 *
 * A one-turn case passes a single string here and is unchanged: a 1-turn transcript is a transcript.
 */
export function scoreCase({ fx, pack, packId, transcript, facts, calls, thresholds, mentions }) {
  const failures = [];
  const fail = (key, expected, actual) => failures.push({ key, expected, actual });
  const e = fx.expect;

  const terminal = facts.events.find(
    (r) => r.event === "run_completed" || r.event === "run_failed",
  );
  if (terminal === undefined) fail("terminal", "a run_completed or run_failed row", "none");
  else if (terminal.outcome !== e.outcome) fail("outcome", e.outcome, terminal.outcome);

  // OPERATIONS. An operation happened if at least ONE of its granted tools was called — never all
  // of them: `research-the-web` grants `webResearch` AND `declareUnsupported`, and a run that
  // researched successfully must not be failed for not also declaring itself unsupported.
  const called = new Set(Object.keys(calls).filter((t) => t !== "thinking"));
  for (const id of e.operations) {
    const tools = pack.opTools.get(id) ?? [];
    if (!tools.some((t) => called.has(t))) fail(`operation:${id}`, tools.join("|"), [...called]);
  }
  for (const tool of e.toolsForbidden) {
    if (called.has(tool)) fail(`forbidden:${tool}`, "never called", calls[tool]);
  }
  // THE ALLOW-LIST, proven from the trace rather than from the code that built it. `thinking` is
  // the trace floor `cockpit.startWorkflowPack` writes, not a tool the model can reach.
  const granted = new Set(REGISTRY.toolsFor(packId));
  for (const tool of called) {
    if (!granted.has(tool)) fail(`ungranted:${tool}`, "not callable by this pack", "called");
  }

  if (facts.artifactCount > 0 !== e.artifactCreated)
    fail("artifactCreated", e.artifactCreated, facts.artifactCount);

  // SOURCE STATES, through the preflight's own counts. `expect.sources` names every source the pack
  // touches that is reachable, plus whichever missing ones the fixture chose to spell out; the
  // matrix supplies the rest, so both numbers are derivable and neither is re-emitted here.
  const pre = facts.events.find((r) => r.event === "preflight_completed");
  if (pre === undefined) fail("preflight", "a preflight_completed row", "none");
  else {
    const expectedAvailable = [...pack.reachable].filter(
      (sourceId) => e.sources[sourceId] !== "unavailable",
    ).length;
    if (pre.sourceAvailableCount !== expectedAvailable)
      fail("sourceAvailableCount", expectedAvailable, pre.sourceAvailableCount);
    if (pre.sourceExpectedCount !== pack.sources.size)
      fail("sourceExpectedCount", pack.sources.size, pre.sourceExpectedCount);
    if (pre.preflightMissingCount !== pack.missingSources.size)
      fail("preflightMissingCount", pack.missingSources.size, pre.preflightMissingCount);
  }

  // THE HONEST-PARTIAL STATEMENT — the one prose assertion, and the phase's deliverable.
  // Over the WHOLE transcript: the contract is "the run told the user", not "every turn repeats it".
  const lower = transcript.toLowerCase();
  for (const source of e.missingNamed) {
    const phrases = mentions[source] ?? [];
    if (!phrases.some((phrase) => lower.includes(phrase)))
      fail(`missingNamed:${source}`, `the reply names it (${phrases[0]}…)`, "not named");
  }

  // THRESHOLDS. Money the run could not have read is the sharpest fabrication signal these packs
  // have: the eval tenant holds exactly one figure, so any OTHER amount came from nowhere.
  const money = moneyIn(transcript).filter((amount) => amount !== 1400);
  if (money.length > (thresholds.maxUnsupportedFigures ?? 0))
    fail("unsupportedFigures", `<= ${thresholds.maxUnsupportedFigures ?? 0}`, money);
  if (called.has("webResearch")) {
    const cites = urlsIn(transcript).length;
    if (cites < (thresholds.minCitationsWhenWebRead ?? 0))
      fail("citations", `>= ${thresholds.minCitationsWhenWebRead ?? 0}`, cites);
  }

  return failures;
}

/** Drive ONE case end to end. Returns { pass, failures, cost, durationMs, version }. */
function runCase(fx, index, { packId, pack, version, runnerRunId, thresholds }) {
  const tenant = tenantFor(runnerRunId, index);
  // EXIT 2, NOT 1. A tenant that could not be seeded says nothing about the pack body, and the
  // plan this runner was written for names exactly this mis-signal: an env problem reported as case
  // FAILURES at $0.0000 sends someone editing a body that is fine.
  try {
    seedCase(tenant, fx, pack);
  } catch (err) {
    throw new EnvironmentAbort(`could not seed ${tenant} for ${fx.id}: ${err.message}`);
  }
  const { planId, threadId } = parse(must("smoke:seedCockpitPlan", { tenant }));
  console.log(`  · ${fx.id} tenant=${tenant} thread=${threadId}`);

  // The needle rides INSIDE the untrusted user text, which is the only way its absence from the log
  // planes proves anything. A needle that never entered the system cannot leak out of it.
  const needle = (fx.needles ?? [])[0];
  let cost = 0;
  let lastRunId = null;
  /** Every turn's runId, in order — `artifact_created` rows are keyed per run, one run per turn. */
  const runIds = [];
  // EVERY turn's reply, not just the last. See scoreCase's header for why this was the whole bug.
  const replies = [];
  for (const [turnIndex, turn] of fx.turns.entries()) {
    // ONE runId per TURN — the binding writes a `run_started` and a terminal row per invocation, so
    // reusing one across turns would produce two starts under a single id and make every per-run
    // count ambiguous. The case is scored on its FINAL turn; cost is summed across all of them.
    lastRunId = randomUUID();
    const text = needle === undefined ? turn : `${turn}\n\n[ref ${needle}]`;
    const res = paidTurn({
      tenantId: tenant,
      packId,
      threadId,
      planId,
      text,
      runId: lastRunId,
      // THE POINT OF THE WHOLE RUN: the exact candidate, not the active row. Without this the
      // evidence would name a version the turn never executed.
      skillVersions: { [`pack-${packId}`]: version },
    });
    if (res.ok !== true)
      return { pass: false, failures: [{ key: "run", expected: "ok", actual: res.reason }], cost };
    if (res.blocked !== undefined)
      throw new EnvironmentAbort(`governed stop on ${fx.id} turn ${turnIndex + 1}: ${res.blocked}`);
    cost += res.costUsd ?? 0;
    runIds.push(lastRunId);
    replies.push(res.reply ?? "");
  }

  const facts = parse(
    must("smoke:packRunFacts", { tenantId: tenant, runId: lastRunId }, RETRY_READ),
  );
  // ARTIFACTS ARE COUNTED ACROSS EVERY TURN, NOT JUST THE LAST — the same scope mismatch that once
  // made `missingNamed` score only the final reply, one plane over, and here it was scoring the
  // OPPOSITE of the behaviour the bodies teach. `packRunFacts` is keyed by runId and there is one
  // runId PER TURN, so a pack that saved its brief on the turn that WROTE it recorded that
  // `artifact_created` under turn 1 — and a two-turn fixture then read turn 2's facts, saw zero, and
  // failed the case. MEASURED: `gpt-5.6-luna` saved the prep on turn 1 of case 01 and was scored as
  // never having saved at all, while `gpt-4o-mini` "passed" the same case by saving the FOLLOW-UP
  // turn's reply — the wrong bytes, scored green. The terminal row, the preflight counts and the
  // outcome stay LAST-TURN facts, because those are per-run by definition; only the artifact tally
  // is cumulative, because the fixture asks "did this case produce one", not "on which turn".
  const artifactCount = runIds
    .map((id) => parse(must("smoke:packRunFacts", { tenantId: tenant, runId: id }, RETRY_READ)))
    .reduce((n, f) => n + f.artifactCount, 0);
  // THE MODEL HALF of "did the thing we are about to certify actually run". Read from spend rows,
  // which record the model AFTER each call returns, so a fallback attempt is its own row.
  const ran = parse(
    must("smoke:modelsForRun", { tenantId: tenant, runId: lastRunId }, RETRY_READ),
  );
  const { calls } = parse(
    must("smoke:toolCallsForThread", { tenantId: tenant, threadId }, RETRY_READ),
  );
  // Zero `requests` rows and no needle in any structured log plane. It THROWS on a leak, which is
  // the correct blast radius: a redaction failure is not one case's problem.
  must("smokeAssert:assertEvalCaseClean", {
    tenant,
    needles: needle === undefined ? [] : [needle],
  });

  const started = facts.events.find((r) => r.event === "run_started");
  const ended = facts.events.find((r) => r.event === "run_completed" || r.event === "run_failed");
  const failures = scoreCase({
    fx,
    pack,
    packId,
    // Blank-line joined so a phrase cannot be manufactured ACROSS a turn boundary by two halves
    // abutting — the matcher is a substring test and `…crm` + `facts…` would otherwise read as one.
    transcript: replies.join("\n\n"),
    facts: { ...facts, artifactCount },
    calls,
    thresholds,
    mentions: REGISTRY.mentions,
  });
  if (DUMP_PATH !== null) {
    DUMP.push({ id: fx.id, failures, replies, calls, artifactCount });
    writeFileSync(DUMP_PATH, JSON.stringify(DUMP, null, 2));
  }
  return {
    pass: failures.length === 0,
    failures,
    cost,
    durationMs: started && ended ? ended.createdAt - started.createdAt : null,
    version: ended?.skillVersion ?? null,
    // Surfaced per case so the all-green check can refuse a mismatch before writing evidence.
    ranModels: ran.models ?? [],
    spendRows: ran.rowCount ?? 0,
  };
}

/** `--repeat N`: 1 (the default) is the ordinary gate run. Refuses 0, junk and absurd values
 *  rather than defaulting, because a silently-ignored repeat count would report one run as N. */
function repeatCount(argv) {
  const raw = valueFlag(argv, "--repeat");
  // `valueFlag` returns NULL for an absent flag, not undefined — checking only for undefined made
  // every ordinary --candidate run fail with `--repeat must be an integer 1..20, got "null"`. Caught by
  // running the plain gate path, which is the one that matters most and the one a new flag is least
  // likely to be tested against.
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20)
    throw new EnvironmentAbort(`--repeat must be an integer 1..20, got "${raw}"`);
  return n;
}

async function runCandidate(argv, packs) {
  const filter = valueFlag(argv, "--packs");
  const wanted = (filter ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (wanted.length !== 1)
    throw new EnvironmentAbort(
      "--candidate takes exactly ONE --packs id. A whole-corpus run is over the cost cap and is " +
        "all-or-nothing: six packs means six invocations, six evidence writes, six verdicts.",
    );
  const packId = wanted[0];
  const pack = packs.get(packId);
  if (pack === undefined) throw new EnvironmentAbort(`"${packId}" is not a pack id`);
  const name = `pack-${packId}`;

  // 1. THE SUITE MUST BE THE ONE THE GATE WILL CHECK. Recorded evidence is compared against the
  //    compiled `PACK_EVAL_SUITE`, so a run against a corpus that has drifted from it would spend
  //    real money to produce a row the gate then refuses — and it would look like a pack failure.
  const declared = codeOwnedPackSuite();
  const onDisk = suiteIdentityOnDisk(packId);
  const mine = declared.packs.get(name);
  if (mine === undefined) throw new EnvironmentAbort(`PACK_EVAL_SUITE declares no ${name}`);
  if (mine.casesHash !== onDisk.casesHash || mine.caseCount !== onDisk.caseCount)
    throw new EnvironmentAbort(
      `${packId}.json has drifted from PACK_EVAL_SUITE (disk ${onDisk.caseCount} cases ` +
        `${onDisk.casesHash.slice(0, 12)}, code ${mine.caseCount} ${mine.casesHash.slice(0, 12)}). ` +
        "Update packages/contracts/src/skill.ts before spending.",
    );

  // 2. THE EXACT CANDIDATE. Never the active row, never a guessed version.
  const rows = parse(must("skills:inspectPackCandidates", {}, RETRY_READ));
  const row = rows.find((r) => r.name === name);
  if (row === undefined || row.present !== true)
    throw new EnvironmentAbort(
      `${name} has no row on this deployment — run skills:seedPackCandidates`,
    );
  if (row.status !== "candidate")
    throw new EnvironmentAbort(`${name} v${row.version} is "${row.status}", not a candidate`);
  const version = row.version;

  const thresholds = thresholdsFor(packId);
  const cases = readFixtures(packId, packs).map(({ file, fx }) => validateFixture(fx, file, packs));
  validateCorpus(
    cases.map((fx) => ({ file: `${packId}.json`, fx })),
    packs,
  );
  if (cases.length !== mine.caseCount)
    throw new EnvironmentAbort(
      `${packId}: ${cases.length} cases loaded, suite declares ${mine.caseCount}`,
    );

  const repeat = repeatCount(argv);
  DUMP_PATH = valueFlag(argv, "--dump");
  const runnerRunId = randomUUID();
  console.log(
    `[eval:pack] ${packId} -> ${name} v${version} (${TARGET}) · ${cases.length} cases · ` +
      `suite ${declared.revision} · cap ${COST_CAP_USD.toFixed(2)}` +
      (repeat > 1 ? ` · REPEAT x${repeat} (measurement only, no evidence)` : ""),
  );

  let total = 0;
  const allRuns = [];
  let aborted = 0;
  for (let pass = 1; pass <= repeat; pass++) {
    if (repeat > 1) console.log(`  -- run ${pass}/${repeat} --`);
    if (repeat === 1) {
      // THE GATE PATH IS UNCHANGED: an abort still propagates. A single run that could not complete
      // must never be summarised as a result.
      const { results: runResults, cost } = runOnce();
      total += cost;
      allRuns.push(runResults);
      continue;
    }
    // REPEAT MODE SWALLOWS A RUN-LEVEL ABORT, and only here. Learned by losing data: run 2 of a
    // 3-run batch hit `agent_timeout`, the abort propagated, and it discarded run 1's completed
    // results — the exact measurement the batch existed to collect. An abort is ALSO a fact about
    // stability (this model times out), so it is counted and reported rather than hidden; what it
    // must not do is destroy the runs that did finish.
    try {
      const { results: runResults, cost } = runOnce();
      total += cost;
      allRuns.push(runResults);
    } catch (err) {
      aborted++;
      console.log(`  -- run ${pass}/${repeat} ABORTED: ${String(err.message).split("\n")[0]}`);
    }
  }
  if (allRuns.length === 0)
    throw new EnvironmentAbort(
      `every one of the ${repeat} runs aborted — that is an environment or model-availability ` +
        "problem, not a stability measurement",
    );
  const results = allRuns[allRuns.length - 1];

  if (repeat > 1) {
    const s = summarizeRepeats(allRuns);
    console.log(
      `\n[eval:pack] ${packId} STABILITY over ${s.runs} completed run(s)` +
        (aborted > 0 ? ` (+${aborted} ABORTED)` : "") +
        ` · ${total.toFixed(4)}`,
    );
    if (aborted > 0)
      console.log(
        `    NOTE: ${aborted} of ${repeat} runs never finished. An abort is itself a stability ` +
          "signal — read the counts below as conditional on the runs that completed.",
      );
    for (const c of s.cases) {
      const mark =
        c.verdict === "stable-pass" ? "PASS" : c.verdict === "stable-fail" ? "FAIL" : "FLAKY";
      console.log(
        `    ${mark.padEnd(5)} ${c.passed}/${c.of}  ${c.id}` +
          (c.failures.length === 0
            ? ""
            : `\n            ${c.failures.map((f) => `${f.key} x${f.n}`).join(", ")}`),
      );
    }
    console.log(
      `[eval:pack] ${s.stablePass} stable-pass · ${s.stableFail} stable-fail · ${s.flaky} FLAKY`,
    );
    // Deliberately no evidence write on ANY score. A pack certified by the best of N runs is exactly
    // the vacuous green the all-green gate exists to refuse, and repeat mode would be the way to
    // launder it. Measure here; certify with a normal single all-green run.
    console.log("[eval:pack] evidence NOT recorded — --repeat is a measurement, never a gate.");
    if (s.flaky > 0)
      console.log(
        `[eval:pack] ${s.flaky} case(s) changed verdict between identical runs — do NOT compare ` +
          "configurations on a single run's pass count.",
      );
    return s.stablePass === s.cases.length ? 0 : 1;
  }

  function runOnce() {
  const results = [];
  let total = 0;
  for (const [index, fx] of cases.entries()) {
    const out = runCase(fx, index, { packId, pack, version, runnerRunId, thresholds });
    total += out.cost;
    results.push({ id: fx.id, ...out });
    console.log(
      `    ${out.pass ? "PASS" : "FAIL"} ${fx.id} · ${out.cost.toFixed(4)} · ` +
        `${out.durationMs === null ? "?" : out.durationMs}ms` +
        (out.version === null ? "" : ` · v${out.version}`) +
        // Printed ALWAYS, not only on a mismatch: the run that quietly executed a different model is
        // the one nobody thinks to check, and it is invisible on a pack that is not green.
        (out.ranModels.length > 0 ? ` · ${out.ranModels.join("+")}` : " · NO SPEND ROWS"),
    );
    for (const f of out.failures) {
      console.log(
        `      ${f.key}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`,
      );
    }
    // The cap ABORTS (exit 2) rather than failing the pack: overspending is an environment problem,
    // and reporting it as a pack failure would send someone editing a body that is fine.
    if (total > COST_CAP_USD)
      throw new EnvironmentAbort(`cost cap: ${total.toFixed(4)} over ${COST_CAP_USD.toFixed(2)}`);
  }
  return { results, cost: total };
  }

  const casesPassed = results.filter((r) => r.pass).length;
  const allGreen = casesPassed === results.length && results.length === mine.caseCount;
  // The version EVERY turn actually executed, read back off the events rather than assumed.
  const ranVersions = [...new Set(results.map((r) => r.version).filter((v) => v !== null))];
  console.log(
    `\n[eval:pack] ${packId}: ${casesPassed}/${results.length} passed · $${total.toFixed(4)} · ` +
      `versions executed ${ranVersions.join(",") || "unknown"}`,
  );

  if (!allGreen) {
    console.log(`[eval:pack] evidence NOT recorded — ${packId} did not pass. It stays dark.`);
    return 1;
  }
  if (ranVersions.length !== 1 || ranVersions[0] !== version) {
    throw new EnvironmentAbort(
      `the runs executed version(s) ${ranVersions.join(",")} but the pin was v${version} — ` +
        "recording evidence would certify a body that did not run",
    );
  }

  assertRanModel(results, EVAL_MODEL);

  // Suite-bound evidence: refs and counts only (CLAUDE.md §4). The `suite` block is what lets the
  // pack gate tell this row from an `eval:golden` row, and from a run against an older corpus.
  const evidence = JSON.stringify({
    runner: "eval:pack",
    runId: runnerRunId,
    pass: true,
    casesPassed,
    casesTotal: results.length,
    retriedCases: [],
    costUsd: total,
    model: EVAL_MODEL,
    skillVersions: { [name]: version },
    suite: { revision: declared.revision, casesHash: mine.casesHash, caseCount: mine.caseCount },
    ts: Date.now(),
  });
  // No `retryOnEmpty` on the WRITE, exactly as in run-eval-golden.mjs: a retry writes a duplicate.
  must("skills:recordEvalEvidence", { name, version, evidence });
  console.log(`[eval:pack] evidence recorded on ${name} v${version} (${TARGET}). Still a candidate.`);
  return 0;
}

async function main() {
  const argv = stripSeparator(process.argv.slice(2));
  assertKnownArgs(argv);

  const packs = projectRegistry(await loadRegistry());

  // The self-test stands ALONE: it is the runnable check this file owes, and requiring it to be
  // paired with a mode flag made `--self-test` on its own exit 2 with a message about 27-02.
  if (argv.includes("--self-test")) {
    selfTest(packs);
    if (!argv.includes("--fixtures-only") && !argv.includes("--candidate")) return;
  }

  if (argv.includes("--candidate")) {
    if (argv.includes("--fixtures-only"))
      throw new EnvironmentAbort("--fixtures-only and --candidate are different runs; pick one");
    process.exitCode = await runCandidate(argv, packs);
    return;
  }

  if (!argv.includes("--fixtures-only")) {
    throw new EnvironmentAbort("pass --fixtures-only, --self-test, or --candidate");
  }

  const fixtures = validateCorpus(
    readFixtures(valueFlag(argv, "--packs"), packs).map(({ file, fx }) => ({
      file,
      fx: validateFixture(fx, file, packs),
    })),
    packs,
  );

  const byPack = new Map();
  for (const { fx } of fixtures) byPack.set(fx.pack, (byPack.get(fx.pack) ?? 0) + 1);
  const summary =
    byPack.size === 0
      ? "none yet (27-04/05/06 write them)"
      : [...byPack].map(([p, n]) => `${p}=${n}`).join(" ");
  console.log(`fixtures-only: ${fixtures.length} valid — ${summary}`);
}

main().catch((err) => {
  console.error(`FAIL ${err.message}`);
  // The documented contract: 0 all green · 1 a fixture (or self-test) failed · 2 environment abort.
  process.exit(err instanceof EnvironmentAbort ? 2 : 1);
});
