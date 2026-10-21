// Offline exact-source identity. Writing this pin never records passing recipe evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const contract = "packages/contracts/src/webRecipeSkill.ts";
const declaration = /(export const WEB_RECIPE_EVAL_IMPLEMENTATION_HASH =\s*)"([a-f0-9]{64})"/;
export const WEB_RECIPE_EVALUATOR_FILES = [
  "packages/backend/scripts/webRecipeEvaluatorIdentity.mjs",
  "packages/backend/convex/webRecipeEvals.ts",
  "packages/backend/convex/webRecipes.ts",
  "packages/backend/convex/webProjects.ts",
  "packages/backend/convex/webAssets.ts",
  "packages/backend/convex/webHttp.ts",
  "packages/backend/convex/webRuntime.ts",
  "packages/backend/convex/skills.ts",
  "packages/backend/convex/schema.ts",
  "packages/backend/convex/lib/functions.ts",
  "packages/backend/convex/lib/tenantLifecycle.ts",
  "packages/contracts/src/webRuntime.ts",
  contract,
  "packages/core/src/webRecipes.ts",
  "packages/core/src/webRecipeFixtures.ts",
  "packages/core/src/webDesignRenderer.ts",
  "packages/core/src/webRuntime.ts",
  "packages/core/src/webAssets.ts",
  "packages/core/src/designKnowledge.ts",
  "packages/core/src/designKnowledge.generated.ts",
].sort();
const hash = (text) => createHash("sha256").update(text).digest("hex");
const fingerprint = (rows) =>
  hash(rows.map(({ path, text }) => `${path}:${hash(text)}`).join("\n"));
function sourceRows(directory) {
  return WEB_RECIPE_EVALUATOR_FILES.map((path) => {
    let text = readFileSync(resolve(directory, path), "utf8").replace(/\r\n/g, "\n");
    // Every other activation/evidence clause is included. Scrub only this self-referential value.
    if (path === contract) {
      assert(declaration.test(text), "recipe implementation identity declaration missing");
      text = text.replace(declaration, '$1"SELF_IDENTITY"');
    }
    return { path, text };
  });
}
export const computeWebRecipeEvaluatorIdentity = (directory = root) =>
  fingerprint(sourceRows(directory));
function main(args) {
  assert(
    args.length === 1 && ["--check", "--write", "--self-check"].includes(args[0]),
    "use --check, --write or --self-check",
  );
  const path = resolve(root, contract);
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const stored = declaration.exec(text)?.[2];
  assert(stored, "missing declared implementation identity");
  const actual = computeWebRecipeEvaluatorIdentity();
  if (args[0] === "--write") {
    writeFileSync(path, text.replace(declaration, `$1"${actual}"`));
    console.log(`Recipe source identity refreshed: ${actual}; no evaluation or activation.`);
    return;
  }
  assert.equal(
    stored,
    actual,
    "recipe evaluator sources changed; refresh and review exact-source pin",
  );
  if (args[0] === "--self-check") {
    const rows = sourceRows(root);
    for (const row of rows) {
      assert.notEqual(
        fingerprint(
          rows.map((item) =>
            item === row ? { ...item, text: item.text + "\n// mutation" } : item,
          ),
        ),
        actual,
        row.path,
      );
    }
    const windows = text.replace(/\n/g, "\r\n").replace(/\r\n/g, "\n");
    assert.equal(windows, text);
  }
  console.log(`Recipe evaluator source identity OK: ${WEB_RECIPE_EVALUATOR_FILES.length} sources.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
