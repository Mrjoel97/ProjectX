// One-tree repository/local qualification. Every listed plane executes; missing, skipped,
// timed-out and nonzero steps are failures. Wave 7/8 remain outside this local gate.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verification =
  ".planning/phases/49-qualified-public-web-and-storefront-recipes/49-VERIFICATION.md";
const summary = ".planning/phases/49-qualified-public-web-and-storefront-recipes/49-07-SUMMARY.md";
const waveMap =
  ".planning/phases/37.1-closure-programme-integration-and-wave-0-baseline/37.1-WAVE-MAP.md";
// This is the declared implementation artifact set. Directory entries expand recursively and
// lexically; summary, verification and mutable planning status are deliberately excluded.
export const ARTIFACT_INPUTS = [
  "third_party/design-knowledge",
  "packages/contracts/src/skill.ts",
  "packages/contracts/src/verticalEvalCorpus.ts",
  "packages/contracts/src/webRuntime.ts",
  "packages/core/src/designKnowledge.ts",
  "packages/core/src/designKnowledge.generated.ts",
  "packages/core/src/designKnowledge.test.ts",
  "packages/core/src/index.ts",
  "packages/core/src/webRuntime.ts",
  "packages/core/src/webRuntime.test.ts",
  "packages/core/src/webForms.ts",
  "packages/core/src/webForms.test.ts",
  "packages/core/src/webRecipes.ts",
  "packages/core/src/webRecipes.test.ts",
  "packages/core/src/webRecipeFixtures.ts",
  "packages/core/src/webRecipeFixtures.test.ts",
  "packages/core/src/webDesignRenderer.ts",
  "packages/core/src/webDesignRenderer.test.ts",
  "packages/backend/convex/skills.ts",
  "packages/backend/convex/webRecipeEvals.ts",
  "packages/backend/convex/webRecipeEvals.test.ts",
  "packages/backend/convex/webRecipes.ts",
  "packages/backend/convex/webRecipes.test.ts",
  "packages/backend/convex/webProjects.ts",
  "packages/backend/convex/webProjects.test.ts",
  "packages/backend/convex/webRuntime.ts",
  "packages/backend/convex/webRuntime.test.ts",
  "packages/backend/convex/webRuntimeHttp.test.ts",
  "packages/backend/convex/webForms.ts",
  "packages/backend/convex/webForms.test.ts",
  "packages/backend/convex/isolation.test.ts",
  "packages/backend/convex/smoke.ts",
  "packages/backend/convex/http.ts",
  "packages/backend/scripts/run-web-recipe-evals.mjs",
  "packages/backend/scripts/eval-suite-manifest.json",
  "packages/backend/scripts/vertical-eval-corpus.mjs",
  "apps/web/app/(app)/dashboard/sites/WebRecipeForm.tsx",
  "apps/web/app/(app)/dashboard/sites/SiteEditor.tsx",
  "apps/web/app/(app)/dashboard/sites/preview/PreviewCanvas.tsx",
  "apps/web/app/(app)/ops/WebRecipeQualification.tsx",
  "apps/web/e2e/phase49-recipe-qualification.spec.ts",
  "apps/web/e2e/phase49-web-recipes.spec.ts",
  "apps/web/e2e/phase49-disposable-stack.mjs",
  "apps/web/e2e/phase49-stack-lifecycle.mjs",
  "apps/web/e2e/phase49-windows-job.mjs",
  "apps/web/e2e/phase49-windows-job-broker.ps1",
  "scripts/verify-design-knowledge-provenance.mjs",
  "scripts/compile-design-knowledge.mjs",
  "scripts/check-phase49-acceptance.mjs",
  "scripts/check-phase49-qualification.mjs",
  "scripts/check-free-gates.mjs",
  "docs/playbooks/public-web-runtime.md",
  "docs/playbooks/skill-registry.md",
  "docs/playbooks/vertical-packs.md",
  "docs/playbooks/watch.json",
  "docs/releases/phase-49-wave7-wave8-reentry.md",
];

function expand(inputs, base = root) {
  const files = [];
  const visit = (path) => {
    const full = resolve(base, path);
    if (!existsSync(full)) throw new Error(`artifact missing: ${path}`);
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full).sort()) visit(join(path, entry));
    } else files.push(relative(base, full).replaceAll("\\", "/"));
  };
  for (const path of inputs) visit(path);
  const unique = [...new Set(files)].sort();
  if (unique.length !== files.length) throw new Error("duplicate artifact path in manifest");
  return unique;
}
function digestRows(rows) {
  return createHash("sha256")
    .update(rows.map((row) => `${row.path}\0${row.sha256}\n`).join(""))
    .digest("hex");
}
function manifest(inputs = ARTIFACT_INPUTS, base = root) {
  const paths = expand(inputs, base);
  const rows = paths.map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(resolve(base, path)))
      .digest("hex"),
  }));
  const digest = digestRows(rows);
  return { rows, digest };
}
function recordedHash(text) {
  return text.match(/^Artifact-set SHA-256: `([a-f0-9]{64})`$/m)?.[1] ?? null;
}
function currentWaveHash(text, wave) {
  const section = text.split(new RegExp(`^## Wave ${wave} \\u2014[^\\r\\n]*$`, "m"))[1];
  const current = section?.split(/^## Wave \d+ /m)[0];
  return current?.match(/\*\*Current local checkpoint[^\n]*\*\*[^\n]*\n?`([a-f0-9]{64})`/)?.[1] ?? null;
}
function finalState() {
  const report = readFileSync(resolve(root, verification), "utf8");
  const note = readFileSync(resolve(root, summary), "utf8");
  const roadmap = readFileSync(resolve(root, ".planning/ROADMAP.md"), "utf8");
  const requirements = readFileSync(resolve(root, ".planning/REQUIREMENTS.md"), "utf8");
  const map = readFileSync(resolve(root, waveMap), "utf8");
  const actual = manifest();
  if (recordedHash(report) !== actual.digest || recordedHash(note) !== actual.digest)
    throw new Error("recorded Phase 49 artifact hash is missing or stale");
  for (const wave of [3, 4])
    if (currentWaveHash(map, wave) !== actual.digest)
      throw new Error(`Wave ${wave} current checkpoint hash is missing or stale`);
  if (
    !/^\| 49\. Qualified Public-Web and Storefront Recipes[^\n]*\| 7\/7 \| Complete \(repository\/local technical layer only\)/m.test(
      roadmap,
    )
  )
    throw new Error("Phase 49 roadmap has not reached 7/7 repository/local status");
  for (const id of ["SITE-03", "LAND-03", "SHOP-01"])
    if (!new RegExp(`\\| ${id} \\| Phase 49 \\| Repository/local`).test(requirements))
      throw new Error(`${id} repository/local traceability is missing`);
  if (!/Wave 7[^\n]*open/i.test(report) || !/Wave 8[^\n]*open/i.test(report))
    throw new Error("external/production boundaries are absent from verification");
  return actual;
}

const node = (label, path, args = []) => ({ label, bin: process.execPath, args: [path, ...args] });
const TEST_FILES = Object.freeze({
  core: [
    "src/designKnowledge.test.ts",
    "src/webRecipeFixtures.test.ts",
    "src/webRecipes.test.ts",
    "src/webDesignRenderer.test.ts",
    "src/webRuntime.test.ts",
    "src/webForms.test.ts",
  ],
  backend: [
    "convex/skills.test.ts",
    "convex/webRecipeEvals.test.ts",
    "convex/webRecipes.test.ts",
    "convex/webProjects.test.ts",
    "convex/webRuntime.test.ts",
    "convex/webRuntimeHttp.test.ts",
    "convex/webForms.test.ts",
    "convex/isolation.test.ts",
    "convex/tenantExport.test.ts",
    "convex/tenantDelete.test.ts",
  ],
  web: [
    "app/(app)/ops/webRecipeQualification.test.tsx",
    "app/(app)/dashboard/sites/webRecipeForm.test.tsx",
    "app/(app)/dashboard/sites/siteEditor.test.tsx",
    "app/(app)/dashboard/sites/preview/previewCanvas.test.tsx",
  ],
});
const packageDir = { core: "packages/core", backend: "packages/backend", web: "apps/web" };
const vitest = (label, key) => ({
  label,
  bin: process.execPath,
  args: [
    resolve(root, packageDir[key], "node_modules/vitest/vitest.mjs"),
    "run",
    ...TEST_FILES[key],
  ],
  cwd: packageDir[key],
  testFiles: TEST_FILES[key],
  expectedFiles: TEST_FILES[key].length,
});
const typecheck = (label, key) => ({
  label,
  bin: process.execPath,
  args: [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit"],
  cwd: packageDir[key],
});
export const PLANES = [
  node("provenance self-test", "scripts/verify-design-knowledge-provenance.mjs", ["--self-test"]),
  node("provenance actual", "scripts/verify-design-knowledge-provenance.mjs"),
  node("offline compiler", "scripts/compile-design-knowledge.mjs", ["--check"]),
  vitest("Phase 48/49 core regression", "core"),
  vitest("Phase 48/49 backend regression", "backend"),
  vitest("Phase 49 web regression", "web"),
  node("native vertical corpus pin", "packages/backend/scripts/vertical-eval-corpus.mjs", [
    "--check",
  ]),
  node("deterministic evaluator", "packages/backend/scripts/run-web-recipe-evals.mjs", [
    "--self-check",
  ]),
  node("exact owner candidate browser", "apps/web/e2e/phase49-disposable-stack.mjs", [
    "e2e/phase49-recipe-qualification.spec.ts",
  ]),
  node("integrated three-family browser", "apps/web/e2e/phase49-disposable-stack.mjs", [
    "e2e/phase49-web-recipes.spec.ts",
  ]),
  typecheck("core typecheck", "core"),
  typecheck("backend typecheck", "backend"),
  typecheck("web typecheck", "web"),
  {
    label: "production web build",
    bin: process.execPath,
    args: ["node_modules/next/dist/bin/next", "build", "--webpack"],
    cwd: "apps/web",
    env: {
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3410",
      CONVEX_URL: "http://127.0.0.1:3410",
      CONVEX_SITE_URL: "http://127.0.0.1:3411",
      NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3411",
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve(root, "apps/web/e2e/phase49-next-font-mock.cjs"),
    },
  },
  node("audit self-test", "scripts/check-audit-payloads.mjs", ["--self-test"]),
  { label: "audit actual on both isolated stacks", verify: "audit-witness" },
  node("strict playbook", "scripts/check-playbooks.mjs", ["check", "--exit-code"]),
  node("strict planning", "scripts/check-planning.mjs", [".", "--exit-code"]),
  node("claim positive controls", "scripts/check-phase49-acceptance.mjs", ["--self-test"]),
  node("claim actual", "scripts/check-phase49-acceptance.mjs"),
  node("free gates self-test", "scripts/check-free-gates.mjs", ["--self-test"]),
  node("all registered free gates", "scripts/check-free-gates.mjs"),
];

function resultOk(result) {
  return (
    result.status === 0 &&
    !result.error &&
    !result.signal &&
    !/"status"\s*:\s*"skipped"|\bSKIPPED\b/i.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
  );
}
// vitest colourises its summary even when stdout is a pipe, so the real line arrives as
// `ESC[2m Test Files ESC[22m ESC[1mESC[32m6 passed...` and a naive match fails while every test
// actually passed. Strip the escapes and keep the exact count requirement: this removes a
// formatting false negative, it does not weaken the count. ci.yml records the same hazard for a
// red gate whose reason is not a real failure. The escape is built from a char code rather than
// written into the pattern, which lint/suspicious/noControlCharactersInRegex rejects.
const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function exactTestCount(output, count) {
  const text = String(output ?? "").replace(ansiEscape, "");
  return new RegExp(`Test Files\\s+${count} passed \\(${count}\\)`).test(text);
}
function selfTest() {
  const labels = new Set(PLANES.map((plane) => plane.label));
  const required = [
    "provenance self-test",
    "provenance actual",
    "offline compiler",
    "Phase 48/49 core regression",
    "Phase 48/49 backend regression",
    "Phase 49 web regression",
    "native vertical corpus pin",
    "deterministic evaluator",
    "exact owner candidate browser",
    "integrated three-family browser",
    "core typecheck",
    "backend typecheck",
    "web typecheck",
    "production web build",
    "audit actual on both isolated stacks",
    "strict playbook",
    "strict planning",
    "claim actual",
    "all registered free gates",
  ];
  let bad = required.filter((label) => !labels.has(label)).length;
  if (labels.size !== PLANES.length) bad += 1;
  for (const [key, expected] of [
    ["core", 6],
    ["backend", 10],
    ["web", 4],
  ]) {
    const files = TEST_FILES[key];
    if (
      files.length !== expected ||
      new Set(files).size !== expected ||
      files.some((file) => !existsSync(resolve(root, packageDir[key], file)))
    )
      bad += 1;
  }
  for (const file of [
    "convex/isolation.test.ts",
    "convex/webRecipeEvals.test.ts",
    "convex/webRecipes.test.ts",
  ])
    if (!TEST_FILES.backend.includes(file)) bad += 1;
  for (const file of ["src/webRecipeFixtures.test.ts", "src/webRecipes.test.ts"])
    if (!TEST_FILES.core.includes(file)) bad += 1;
  // The runtime/form tests are meaningful only when their implementation bytes also retire the
  // aggregate. Keep this closed subset explicit rather than relying on the test list alone.
  for (const file of [
    "packages/core/src/index.ts",
    "packages/core/src/webRuntime.ts",
    "packages/core/src/webRuntime.test.ts",
    "packages/core/src/webForms.ts",
    "packages/core/src/webForms.test.ts",
    "packages/backend/convex/webRuntime.ts",
    "packages/backend/convex/webRuntime.test.ts",
    "packages/backend/convex/webRuntimeHttp.test.ts",
    "packages/backend/convex/webForms.ts",
    "packages/backend/convex/webForms.test.ts",
  ])
    if (!ARTIFACT_INPUTS.includes(file)) bad += 1;
  if (
    !exactTestCount("Test Files  6 passed (6)", 6) ||
    // positive control: the colourised form vitest actually emits must now match
    !exactTestCount(
      "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m6 passed\u001b[39m\u001b[22m\u001b[90m (6)\u001b[39m",
      6,
    ) ||
    exactTestCount("Test Files  5 passed (5)", 6) ||
    exactTestCount("Test Files  6 passed (7)", 6) ||
    // a colourised SKIPPED/partial summary must still not satisfy the count
    exactTestCount(
      "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[33m5 passed\u001b[39m | 1 skipped (6)",
      6,
    )
  )
    bad += 1;
  if (
    resultOk({ status: 1, stdout: "" }) ||
    resultOk({ status: 0, stdout: '{"status":"skipped"}' }) ||
    resultOk({ status: null, error: new Error("missing") })
  )
    bad += 1;
  const old = manifest(["scripts/check-phase49-qualification.mjs"]);
  if (
    !/^[a-f0-9]{64}$/.test(old.digest) ||
    recordedHash(`Artifact-set SHA-256: \`${old.digest}\``) !== old.digest
  )
    bad += 1;
  if (
    digestRows([{ path: "control", sha256: "a".repeat(64) }]) ===
    digestRows([{ path: "control", sha256: "b".repeat(64) }])
  )
    bad += 1;
  const checkpointFixture = `## Wave 3 \u2014 test\n**Current local checkpoint:**\n\`${"a".repeat(64)}\`\n## Wave 4 \u2014 test\n**Current local checkpoint:** \`${"b".repeat(64)}\`\n`;
  if (
    currentWaveHash(checkpointFixture, 3) !== "a".repeat(64) ||
    currentWaveHash(checkpointFixture, 4) !== "b".repeat(64) ||
    currentWaveHash(checkpointFixture.replace("Current local checkpoint", "Retired checkpoint"), 3) !==
      null
  )
    bad += 1;
  stdout.write(
    bad
      ? `Phase 49 aggregate self-test FAILED (${bad}).\n`
      : "Phase 49 aggregate self-test PASSED.\n",
  );
  return bad ? 1 : 0;
}

if (argv.includes("--self-test")) exit(selfTest());
if (argv.includes("--manifest")) {
  const result = manifest();
  for (const row of result.rows) stdout.write(`${row.sha256}  ${row.path}\n`);
  stdout.write(`Artifact-set SHA-256: ${result.digest}\n`);
  exit(0);
}
try {
  const initial = finalState();
  stdout.write(`Phase 49 source set: ${initial.rows.length} files, sha256 ${initial.digest}\n`);
  let bad = 0;
  let auditWitnesses = 0;
  for (const plane of PLANES) {
    const command =
      plane.verify === "audit-witness"
        ? "two independently executed node scripts/check-audit-payloads.mjs on the owned Convex stacks"
        : `${plane.bin === process.execPath ? "node" : plane.bin} ${plane.args.join(" ")}`;
    const result =
      plane.verify === "audit-witness"
        ? {
            status: auditWitnesses === 2 ? 0 : 1,
            stdout: `observed isolated audit exits: ${auditWitnesses}/2`,
            stderr: "",
          }
        : spawnSync(plane.bin, plane.args, {
            cwd: resolve(root, plane.cwd ?? "."),
            env: { ...process.env, ...plane.env },
            encoding: "utf8",
            timeout: plane.label.includes("browser") ? 2_400_000 : 900_000,
            stdio: ["ignore", "pipe", "pipe"],
          });
    const ok =
      resultOk(result) &&
      (plane.expectedFiles === undefined || exactTestCount(result.stdout, plane.expectedFiles));
    if (
      ok &&
      ["exact owner candidate browser", "integrated three-family browser"].includes(plane.label) &&
      (result.stdout ?? "").includes("Phase 49 isolated audit actual: exit 0")
    )
      auditWitnesses += 1;
    if (!ok) bad += 1;
    const lines = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    stdout.write(`${ok ? "PASS" : "FAIL"} exit=${result.status} ${plane.label}: ${command}\n`);
    if (!ok)
      stdout.write(
        `  ${lines.slice(-3).join(" | ").slice(0, 600)}${result.error ? ` | ${result.error.message}` : ""}\n`,
      );
  }
  const final = finalState();
  if (final.digest !== initial.digest)
    throw new Error("artifact set changed during aggregate execution");
  stdout.write(
    bad
      ? `Phase 49 repository/local aggregate FAILED: ${bad} required plane(s).\n`
      : `Phase 49 repository/local aggregate PASSED on ${final.digest}; Wave 7/8 remain open.\n`,
  );
  exit(bad ? 1 : 0);
} catch (error) {
  stdout.write(
    `Phase 49 repository/local aggregate FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  exit(1);
}
