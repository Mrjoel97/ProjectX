#!/usr/bin/env node
// Preparation is free. Explicit observation collection is paid and never writes release evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectObservations } from "./vertical-eval-collect.mjs";
import { compileSources, sourceManifest } from "./vertical-eval-sources.mjs";

export const IDS = ["data", "product", "design", "legal", "hr", "engineering"];
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (text) => createHash("sha256").update(text).digest("hex");
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

export function validatePreparationFixture(fixture, id, version) {
  assert(IDS.includes(id), "unknown vertical");
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.packId, id);
  assert(
    fixture.executionStatus === "not-run" || fixture.mode === "unexecuted-candidate-fixtures",
    `${id}: fixture must explicitly be unexecuted`,
  );
  if (fixture.candidateVersion !== undefined) assert.equal(fixture.candidateVersion, version);
  assert(Array.isArray(fixture.cases) && fixture.cases.length > 0, `${id}: cases missing`);
  const seen = new Set();
  for (const c of fixture.cases) {
    assert(typeof c.id === "string" && /^[a-z0-9-]+$/.test(c.id), `${id}: invalid case id`);
    assert(!seen.has(c.id), `${id}: duplicate case ${c.id}`);
    seen.add(c.id);
    const request = typeof c.input === "string" ? c.input : c.input?.request;
    assert(typeof request === "string" && request.trim(), `${id}/${c.id}: request missing`);
    if (c.expected !== undefined) {
      assert(
        ["artifact", "partial", "refused", "blocked"].includes(c.expected.state),
        `${id}/${c.id}: state missing`,
      );
    } else {
      assert(Array.isArray(c.must) && c.must.length > 0, `${id}/${c.id}: expectations missing`);
    }
    assert(
      c.passed === undefined && c.evidence === undefined && c.result === undefined,
      `${id}/${c.id}: fixture inputs cannot contain execution evidence`,
    );
  }
  return fixture.cases.length;
}

export function inspectPreparation(root = ROOT) {
  const fixtureDir = resolve(root, "packages/backend/scripts/vertical-eval-cases");
  assert.deepEqual(
    readdirSync(fixtureDir)
      .filter((f) => f.endsWith(".json"))
      .sort(),
    IDS.map((id) => `${id}.json`).sort(),
    "closed six-lane fixture inventory differs",
  );
  return IDS.map((id) => {
    const candidateDir = resolve(root, `packages/contracts/packs/vertical/${id}`);
    const manifest = JSON.parse(read(resolve(candidateDir, "manifest.json")));
    assert.equal(manifest.packId, id);
    assert.equal(manifest.skillName, `vertical-${id}`);
    assert.equal(manifest.status, "candidate");
    assert.equal(manifest.runtimeEnabled, false);
    assert(Number.isSafeInteger(manifest.version) && manifest.version > 0);
    const bodyHash = hash(read(resolve(candidateDir, "skill.md")));
    assert.equal(bodyHash, manifest.provenance.bodySha256, `${id}: body hash drift`);
    assert.equal(manifest.provenance.skillVersions[manifest.skillName], manifest.version);
    assert.equal(
      manifest.evidence.nativeEval,
      null,
      `${id}: preparation must not claim native evidence`,
    );
    const fixtureText = read(resolve(fixtureDir, `${id}.json`));
    const fixture = JSON.parse(fixtureText);
    const caseCount = validatePreparationFixture(fixture, id, manifest.version);
    const compiled = fixture.cases.flatMap((item) => sourceManifest(compileSources(id, item)));
    // Refs, versions, hashes and counts only; never emit prompts or fixture content.
    return {
      name: manifest.skillName,
      candidateVersion: manifest.version,
      bodyHash,
      casesHash: hash(fixtureText),
      caseCount,
      sourceCount: compiled.length,
      sourceBytes: compiled.reduce((sum, source) => sum + source.byteLength, 0),
    };
  });
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  if (argv.includes("--collect-observations")) {
    const capIndex = argv.indexOf("--max-cost-cents");
    assert(
      capIndex >= 0 && /^\d+$/.test(argv[capIndex + 1] ?? ""),
      "explicit --max-cost-cents required",
    );
    const flags = argv.filter((_, index) => index !== capIndex && index !== capIndex + 1);
    assert.deepEqual(
      [...flags].sort(),
      [
        "--all-candidates",
        "--collect-observations",
        "--no-activate",
        "--credit-billing-only",
      ].sort(),
      "collection requires --all-candidates --no-activate --credit-billing-only and no filters; the operator must verify no external BYOK billing",
    );
    const candidates = inspectPreparation(root);
    const fixtures = Object.fromEntries(
      IDS.map((id) => [
        id,
        JSON.parse(read(resolve(root, `packages/backend/scripts/vertical-eval-cases/${id}.json`))),
      ]),
    );
    return collectObservations({
      candidates,
      fixtures,
      capCents: Number(argv[capIndex + 1]),
      creditBillingOnly: true,
      saveOutput: async ({ runId, caseId, markdown, sha256 }) => {
        const directory = resolve(root, ".tmp", `vertical-eval-${runId}`);
        mkdirSync(directory, { recursive: true });
        const outputRef = resolve(directory, `${caseId}.md`);
        writeFileSync(outputRef, markdown);
        assert.equal(hash(readFileSync(outputRef)), sha256, "output archive hash mismatch");
        return { outputRef };
      },
      checkpoint: async (report) => {
        const directory = resolve(root, ".tmp");
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          resolve(directory, `vertical-eval-observations-${report.runId}.json`),
          `${JSON.stringify(report, null, 2)}\n`,
        );
      },
    });
  }
  const allowed = new Set(["--fixtures-only", "--all-candidates", "--no-activate"]);
  assert(
    argv.every((arg) => allowed.has(arg)),
    "unknown flag; use --fixtures-only or --all-candidates --no-activate",
  );
  assert(new Set(argv).size === argv.length, "duplicate flags");
  const offline = argv.includes("--fixtures-only");
  assert(
    offline
      ? !argv.includes("--all-candidates")
      : argv.includes("--all-candidates") && argv.includes("--no-activate"),
    "use --fixtures-only or --all-candidates --no-activate",
  );
  const candidates = inspectPreparation(root);
  if (!offline) {
    throw new Error(
      "VERTICAL_EVAL_NOT_EXECUTABLE: measured semantic assertions and reviewed release evidence " +
        "remain incomplete. Observation collection is a separate unpaid-until-invoked diagnostic. No model called; no evidence recorded; no activation. " +
        "See .planning/phases/30-optional-vertical-workflow-packs/30-08-EVAL-PREPARATION.md",
    );
  }
  return {
    status: "preparation-only",
    modelEvaluated: false,
    evidenceRecorded: false,
    runtimeEnabled: false,
    candidates,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    if (result.semanticReviewRequired) {
      const directory = resolve(ROOT, ".tmp");
      mkdirSync(directory, { recursive: true });
      const output = resolve(directory, `vertical-eval-observations-${result.runId}.json`);
      writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
      console.log(
        JSON.stringify(
          {
            status: result.status,
            runId: result.runId,
            observedCases: result.observations.length,
            releaseEvidenceRecorded: false,
            output,
          },
          null,
          2,
        ),
      );
      process.exitCode = 2; // collected observations still require semantic review; never a passing release gate
    } else console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
