import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { computeEvaluatorRevision, EVALUATOR_FILES } from "./goldenEvaluatorIdentity.mjs";

function fixtureRoot(t) {
  const scratchParent = resolve(tmpdir());
  const root = mkdtempSync(join(scratchParent, "pikar-golden-identity-"));
  t.after(() => {
    const child = relative(scratchParent, resolve(root));
    assert.ok(child.startsWith("pikar-golden-identity-") && !child.includes(sep));
    rmSync(root, { recursive: true, force: true });
  });
  for (const path of EVALUATOR_FILES) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `// Isolated evaluator file: ${path}\nconst value = 1;\n`);
  }
  return root;
}

test("an evaluator source edit retires its revision while the fixture corpus stays identical", (t) => {
  const root = fixtureRoot(t);
  const corpusPath = join(root, "unchanged-fixture-corpus.json");
  const corpus = '{"cases":[{"id":"same-case","expected":"same-expectation"}]}\n';
  writeFileSync(corpusPath, corpus);
  const before = computeEvaluatorRevision(root);
  assert.match(before, /^2026-09-11\.budgeted-evaluator\.[a-f0-9]{64}$/);
  const sourcePath = join(root, "packages/backend/convex/llm.ts");
  const original = readFileSync(sourcePath, "utf8");
  writeFileSync(sourcePath, original.replace("value = 1", "value = 2"));
  assert.notEqual(computeEvaluatorRevision(root), before);
  assert.equal(readFileSync(corpusPath, "utf8"), corpus);
  writeFileSync(sourcePath, original);
  assert.equal(computeEvaluatorRevision(root), before);
});

test("Windows CRLF checkout normalization preserves the evaluator revision", (t) => {
  const root = fixtureRoot(t);
  const before = computeEvaluatorRevision(root);
  for (const path of EVALUATOR_FILES) {
    const target = join(root, path);
    writeFileSync(target, readFileSync(target, "utf8").replace(/\n/g, "\r\n"));
  }
  assert.equal(computeEvaluatorRevision(root), before);
});

test("a missing pinned source fails closed instead of certifying a partial evaluator", (t) => {
  const root = fixtureRoot(t);
  rmSync(join(root, "packages/backend/convex/llm.ts"));
  assert.throws(() => computeEvaluatorRevision(root), { code: "ENOENT" });
});
