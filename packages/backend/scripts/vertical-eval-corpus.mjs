#!/usr/bin/env node
// Native immutable-evidence pins. This generator performs no provider or deployment calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSources, sourceManifest } from "./vertical-eval-sources.mjs";

export const CORPUS_IDS = ["data", "product", "design", "legal", "hr", "engineering"];
export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const OUTPUT = "packages/contracts/src/verticalEvalCorpus.ts";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (root, path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

// Closed source inventory, deliberately excluding generated output to avoid a circular hash.
// Changes to qualification, accounting, source interpretation or model execution invalidate pins.
export const EVALUATOR_FILES = [
  "pnpm-lock.yaml",
  "packages/backend/scripts/vertical-eval-corpus.mjs",
  "packages/backend/scripts/vertical-eval-collect.mjs",
  "packages/backend/scripts/vertical-eval-sources.mjs",
  "packages/backend/scripts/vertical-eval-observations.mjs",
  "packages/backend/scripts/vertical-eval-review.mjs",
  "packages/backend/convex/verticalEvalEvidence.ts",
  "packages/backend/convex/verticalEvalSources.ts",
  "packages/backend/convex/verticalPackBinding.ts",
  "packages/backend/convex/verticalData.ts",
  "packages/backend/convex/verticalVisual.ts",
  "packages/backend/convex/guardrails.ts",
  "packages/backend/convex/authoringProbe.ts",
  "packages/backend/convex/cockpit.ts",
  "packages/backend/convex/intake.ts",
  "packages/backend/convex/spendLedger.ts",
  "packages/backend/convex/audit.ts",
  "packages/backend/convex/agentSteps.ts",
  "packages/backend/convex/lib/functions.ts",
  "packages/backend/convex/lib/models.ts",
  "packages/backend/convex/schema.ts",
  "packages/backend/convex/lib/evalBudgetModel.ts",
  "packages/backend/convex/llm.ts",
  "packages/backend/convex/skills.ts",
  "packages/contracts/src/verticalEval.ts",
  "packages/core/src/dataProfile.ts",
  "packages/core/src/researchEvidence.ts",
  "packages/core/src/documentGen.ts",
  "packages/core/src/specialists.ts",
  "packages/core/src/verticalPacks.ts",
  "packages/cost/src/evalBudget.ts",
  "packages/cost/src/goldenProviderBudget.ts",
  "packages/vault/src/dataWorkbook.ts",
].sort();

export function buildCorpus(fixtures) {
  assert.deepEqual(Object.keys(fixtures).sort(), [...CORPUS_IDS].sort(), "closed corpus required");
  return Object.fromEntries(
    CORPUS_IDS.map((id) => {
      const fixture = fixtures[id];
      assert.equal(fixture.packId, id, "lane identity mismatch");
      assert.equal(fixture.schemaVersion, 1, "fixture schema mismatch");
      assert(Array.isArray(fixture.cases) && fixture.cases.length > 0, "empty corpus lane");
      const seen = new Set();
      return [
        id,
        fixture.cases.map((item) => {
          const caseId = `${id}-${item.id}`;
          assert(
            /^[a-z0-9-]{1,64}$/.test(caseId) && !seen.has(caseId),
            "invalid or duplicate case",
          );
          seen.add(caseId);
          const expected =
            item.expected ??
            (id === "engineering" && Array.isArray(item.must) && item.must.length > 0
              ? {
                  must: item.must,
                  forbiddenClaims: item.forbiddenClaims,
                  forbiddenOperations: item.forbiddenOperations,
                }
              : undefined);
          assert(
            expected &&
              (id === "engineering" ||
                ["artifact", "partial", "refused", "blocked"].includes(expected.state)),
            "closed semantic expectations required",
          );
          assert(
            item.passed === undefined && item.evidence === undefined && item.result === undefined,
            "fixtures cannot assert outcomes",
          );
          const input = typeof item.input === "string" ? { request: item.input } : item.input;
          const { sources: _sources, request, ...context } = input;
          assert(typeof request === "string" && request.trim(), "request required");
          const text = Object.keys(context).length
            ? `${request}\n\nSupplied fixture context:\n${JSON.stringify(context)}`
            : request;
          return {
            caseId,
            caseHash: hash(JSON.stringify(item)),
            requestHash: hash(text),
            sources: sourceManifest(compileSources(id, item)),
            expected,
          };
        }),
      ];
    }),
  );
}

export function readCorpus(root = ROOT) {
  const directory = "packages/backend/scripts/vertical-eval-cases";
  assert.deepEqual(
    readdirSync(resolve(root, directory))
      .filter((file) => file.endsWith(".json"))
      .sort(),
    CORPUS_IDS.map((id) => `${id}.json`).sort(),
    "unexpected corpus file",
  );
  return buildCorpus(
    Object.fromEntries(
      CORPUS_IDS.map((id) => [id, JSON.parse(read(root, `${directory}/${id}.json`))]),
    ),
  );
}

export function renderCorpus(root = ROOT) {
  const corpus = readCorpus(root);
  const evaluator = EVALUATOR_FILES.map((path) => ({ path, sha256: hash(read(root, path)) }));
  const revision = hash(JSON.stringify(evaluator));
  return `// Generated by packages/backend/scripts/vertical-eval-corpus.mjs. Do not edit.\n// Pins describe the current suite; they are never proof that an evaluation passed.\nexport const VERTICAL_CORPUS_SHA256 =\n  "${hash(JSON.stringify(corpus))}";\nexport const VERTICAL_EVALUATOR_REVISION =\n  "${revision}";\nexport const VERTICAL_EVALUATOR_SHA256 = VERTICAL_EVALUATOR_REVISION;\n// biome-ignore format: deterministic generated JSON is pinned by the generator.\nexport const VERTICAL_CORPUS = ${JSON.stringify(corpus, null, 2)} as const;\n`;
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  assert(argv.length === 1 && ["--write", "--check"].includes(argv[0]), "use --write or --check");
  const generated = renderCorpus(root);
  if (argv[0] === "--write") writeFileSync(resolve(root, OUTPUT), generated);
  else
    assert.equal(
      read(root, OUTPUT),
      generated,
      "native corpus/evaluator pins drifted; regenerate and review",
    );
  return {
    lanes: CORPUS_IDS.length,
    cases: Object.values(readCorpus(root)).reduce((sum, cases) => sum + cases.length, 0),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(main()));
}
