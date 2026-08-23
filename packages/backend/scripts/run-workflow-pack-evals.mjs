// 27-02 Task 3 (PACK-02/PACK-03): the workflow-pack eval harness — FIXTURE VALIDATION ONLY.
//
// This half exists BEFORE the adaptation lanes so 27-04/05/06 can validate a fixture's structure
// and its operation ids without a deployed candidate, a model call or a cent. Candidate execution
// and evidence recording are added in 27-08, on top of this file.
//
// Invocation:
//   node scripts/run-workflow-pack-evals.mjs --fixtures-only [--packs a,b] [--self-test]
//
//   --fixtures-only  OFFLINE: parse and validate every fixture against the code-owned registry.
//                    Zero convex calls, zero model calls, zero spend.
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
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "workflow-pack-fixtures");
const registryPath = resolve(here, "../../core/src/workflowPacks.ts");

/** Closed outcome vocabulary. Mirrors `workflowPackEvents.outcome` in convex/schema.ts. */
const OUTCOMES = ["useful", "partial", "blocked", "refused", "failed", "no_findings"];
/** Closed source-state vocabulary. Mirrors `SourceState` in the registry. */
const SOURCE_STATES = ["available", "partial", "unavailable"];

const KNOWN_FLAGS = new Set(["--fixtures-only", "--self-test", "--packs"]);
const VALUED_FLAGS = new Set(["--packs"]);

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
    });
  }
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
  if (`${fx.id}.json` !== file) fail(`id "${fx.id}" does not match its filename`);
  if (typeof fx.description !== "string" || fx.description.length < 8)
    fail("description is missing or too short to explain what the case proves");

  const pack = packs.get(fx.pack);
  if (pack === undefined) fail(`pack "${fx.pack}" is not in the registry`);
  if (!fx.id.startsWith(`${fx.pack}-`)) fail(`id must start with its pack id, "${fx.pack}-"`);

  if (!isStringArray(fx.turns) || fx.turns.length === 0)
    fail("turns must be a non-empty array of non-empty strings");

  const e = fx.expect;
  if (!isPlainObject(e)) fail("expect is missing");
  if (!OUTCOMES.includes(e.outcome))
    fail(`expect.outcome "${e.outcome}" is not one of ${OUTCOMES.join("|")}`);

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
  const needleOwner = new Map();
  for (const { fx, file } of fixtures) {
    for (const needle of fx.needles ?? []) {
      const owner = needleOwner.get(needle);
      if (owner !== undefined && owner !== file)
        throw new Error(`${file}: needle "${needle}" is also used by ${owner}`);
      needleOwner.set(needle, file);
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
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    files = []; // the lanes have not written any yet — an empty corpus is valid, not an abort
  }
  const all = files.map((file) => ({
    file,
    fx: JSON.parse(readFileSync(join(fixturesDir, file), "utf8")),
  }));
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
    description: "reviews against general principles and names the absent brand guidance",
    turns: ["Review this tagline for me."],
    expect: {
      outcome: "partial",
      operations: ["ground-in-vault", "save-review"],
      sources: { vault: "available", "tenant-brand-guidance": "unavailable" },
      missingNamed: ["tenant-brand-guidance"],
      toolsAllowed: ["searchVault", "createDocument"],
      toolsForbidden: ["proposePlan"],
      artifactCreated: true,
    },
    needles: ["zzq-selftest-needle"],
  });
  const file = "brand-review-01-generic.json";

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
  mutate("does not match its filename", (fx) => {
    fx.id = "brand-review-99-other";
  });
  mutate("must start with its pack id", (fx) => {
    fx.id = "brand-review-01-generic";
    fx.pack = "process-sop";
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
            sources: { vault: "available" },
            missingNamed: ["phase26-summaries"],
            toolsAllowed: ["searchVault"],
            toolsForbidden: ["createDocument"],
            artifactCreated: true,
          },
        },
        "business-pulse-01-x.json",
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
          { file: "brand-review-02-b.json", fx: { ...good(), id: "brand-review-02-b" } },
        ],
        packs,
      ),
    /is also used by/,
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
  // Counted, never hardcoded: a self-test that reports a number it does not derive is the first
  // step to a self-test that reports a number it no longer earns.
  // A TRIPWIRE, like the table count in tenantData.test.ts: the floor equals what the self-test
  // exercises today, so DELETING a case fails here and forces the deleter to say why. Adding one is
  // free. Without it, `rejections` is only a number printed to a log nobody diffs.
  assert.ok(rejections >= 25, `self-test only exercised ${rejections} rejections, expected >= 25`);
  console.log(`self-test: ${rejections} validator rejections and 2 acceptances verified`);
}

async function main() {
  const argv = stripSeparator(process.argv.slice(2));
  assertKnownArgs(argv);

  const packs = projectRegistry(await loadRegistry());

  if (!argv.includes("--fixtures-only")) {
    console.error(
      "live candidate execution is not implemented in 27-02 — 27-08 adds it. Use --fixtures-only.",
    );
    process.exit(2);
  }

  if (argv.includes("--self-test")) selfTest(packs);

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
