// Phase 49: offline deterministic web-recipe evaluator self-check.
//
// This companion delegates execution to the same Convex/Vitest seam used by the backend. It never
// invents pass counts or mints browser evidence: the test seam loads each exact stored candidate
// body, executes all twenty cases for its family, and records through the production predicate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const skillSource = readFileSync(resolve(repo, "packages/contracts/src/skill.ts"), "utf8");
const implementationFiles = [
  "packages/backend/convex/webRecipeEvals.ts",
  "packages/backend/scripts/run-web-recipe-evals.mjs",
  "packages/contracts/src/skill.ts",
  "packages/core/src/index.ts",
  "packages/core/src/webRecipeFixtures.ts",
  "packages/core/src/webDesignRenderer.ts",
  "packages/core/src/webRecipes.ts",
  "packages/core/src/webRuntime.ts",
  "packages/core/src/designKnowledge.ts",
  "packages/core/src/designKnowledge.generated.ts",
];
const contractHashField = /(WEB_RECIPE_EVAL_IMPLEMENTATION_HASH\s*=\s*")[0-9a-f]{64}("\s*as const)/;
function normalizedSource(path, text) {
  const source = text.replace(/\r\n/g, "\n");
  if (path !== "packages/contracts/src/skill.ts") return source;
  assert(contractHashField.test(source), "implementation self-hash field missing");
  return source.replace(contractHashField, "$1<self-hash>$2");
}
const sourceByPath = Object.fromEntries(
  implementationFiles.map((path) => [path, readFileSync(resolve(repo, path), "utf8")]),
);
function implementationDigest(sources = sourceByPath) {
  return sha256(
    implementationFiles
      .map((path) => `${path}\n${normalizedSource(path, sources[path])}`)
      .join("\n\0\n"),
  );
}
const implementationHash = skillSource.match(
  /WEB_RECIPE_EVAL_IMPLEMENTATION_HASH\s*=\s*"([0-9a-f]{64})"/,
)?.[1];
const fixtureHash = skillSource.match(/WEB_RECIPE_EVAL_FIXTURE_HASH\s*=\s*"([0-9a-f]{64})"/)?.[1];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runExactCorpus() {
  const vitest = resolve(repo, "packages/backend/node_modules/vitest/vitest.mjs");
  const result = spawnSync(
    process.execPath,
    [vitest, "run", "convex/webRecipeEvals.test.ts", "--reporter=dot"],
    {
      cwd: resolve(repo, "packages/backend"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`WEB_RECIPE_EXACT_CORPUS_FAILED:${result.status}`);
  }
}

function selfCheck() {
  assert.equal(
    implementationHash,
    implementationDigest(),
    "evaluator implementation changed; retire evidence and review revision",
  );
  for (const path of [
    "packages/backend/convex/webRecipeEvals.ts",
    "packages/backend/scripts/run-web-recipe-evals.mjs",
    "packages/contracts/src/skill.ts",
    "packages/core/src/webRecipeFixtures.ts",
  ]) {
    assert.notEqual(
      implementationDigest({ ...sourceByPath, [path]: `${sourceByPath[path]}\nsource-drift` }),
      implementationHash,
      `source-only drift escaped manifest: ${path}`,
    );
  }
  const contractPath = "packages/contracts/src/skill.ts";
  const predicateChanged = sourceByPath[contractPath].replace(
    "parsed.pass === true",
    "parsed.pass === false",
  );
  assert.notEqual(predicateChanged, sourceByPath[contractPath], "evidence predicate probe missing");
  assert.notEqual(
    implementationDigest({ ...sourceByPath, [contractPath]: predicateChanged }),
    implementationHash,
    "evidence predicate drift escaped manifest",
  );
  const fixturePath = "packages/core/src/webRecipeFixtures.ts";
  const fixtureBuilderChanged = sourceByPath[fixturePath].replace(
    'caseFor(family, "positive", "pass", base)',
    'caseFor(family, "positive", "reject", base)',
  );
  assert.notEqual(
    fixtureBuilderChanged,
    sourceByPath[fixturePath],
    "fixture builder probe missing",
  );
  assert.notEqual(
    implementationDigest({ ...sourceByPath, [fixturePath]: fixtureBuilderChanged }),
    implementationHash,
    "fixture builder drift escaped manifest",
  );
  assert.match(fixtureHash ?? "", /^[0-9a-f]{64}$/, "canonical fixture digest missing");
  assert(
    skillSource.includes(
      "casesHash: sha256Utf8(`${WEB_RECIPE_EVAL_FIXTURE_HASH}\\n${WEB_RECIPE_EVAL_IMPLEMENTATION_HASH}`)",
    ),
  );
  // The backend test invokes this exact production evaluator for every stored candidate and
  // includes mutation controls; its runtime check recomputes the entire core fixture digest.
  runExactCorpus();
  console.log(
    `web-recipe self-check passed: exact evaluator=${implementationHash}, fixture=${fixtureHash}, costUsd=0`,
  );
}

if (process.argv.includes("--print-implementation-hash"))
  process.stdout.write(`${implementationDigest()}\n`);
else if (process.argv.includes("--self-check")) selfCheck();
else {
  console.error("Usage: node packages/backend/scripts/run-web-recipe-evals.mjs --self-check");
  process.exitCode = 2;
}

export { selfCheck };
