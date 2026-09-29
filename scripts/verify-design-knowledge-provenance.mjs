// Phase 49-01: offline provenance and positive-control verifier.
// No network, package manager, subprocess, model, or upstream loader is used here.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, validateManifest } from "./compile-design-knowledge.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeRoot = join(repoRoot, "third_party", "design-knowledge");
const manifestPath = join(knowledgeRoot, "manifest.json");
const generatedPath = join(repoRoot, "packages", "core", "src", "designKnowledge.generated.ts");
const noticesPath = join(repoRoot, "THIRD_PARTY_NOTICES.md");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const knownRepos = new Set([
  "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
  "https://github.com/leonxlnx/taste-skill",
  "https://github.com/nexscope-ai/eCommerce-Skills",
]);
const knownForbidden =
  /(?:<\/?(?:script|iframe|style)|javascript:|\b(?:npm|npx|pnpm|yarn|pip|curl|wget|powershell|bash|sh)\b|https?:\/\/|\b(?:fetch|web_fetch|install|execute|run command|tool grant|prompt override|system prompt|api[_ -]?key|secret|password|checkout|payment|merchant|inventory|cart|refund|shipping|tax|buy now)\b)/i;

function readManifest() {
  if (!existsSync(manifestPath)) throw new Error("manifest.json is missing");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function verifyInventory(manifest) {
  validateManifest(manifest);
  const notice = readFileSync(noticesPath, "utf8");
  for (const repository of manifest.repositories) {
    if (!knownRepos.has(repository.repo))
      throw new Error(`${repository.id}: repository is outside the three owner-selected sources`);
    if (!notice.includes(repository.repo) || !notice.includes(repository.commit))
      throw new Error(`${repository.id}: notice lacks exact repository/commit attribution`);
    const license = repository.license;
    const redistributed = join(repoRoot, license.redistributedPath);
    if (!existsSync(redistributed))
      throw new Error(`${repository.id}: redistributed MIT notice is missing`);
    if (sha256(readFileSync(redistributed)) !== license.redistributedSha256)
      throw new Error(`${repository.id}: redistributed MIT notice drifted`);
    for (const file of repository.files) {
      if (file.disposition === "included" && !file.role)
        throw new Error(`${repository.id}/${file.path}: included record lacks reviewed role`);
      if (
        file.disposition === "included" &&
        !Array.isArray(file.excludedSections) &&
        file.path.endsWith("SKILL.md")
      )
        throw new Error(`${repository.id}/${file.path}: reviewed exclusions are not explicit`);
    }
  }
  return true;
}

function verifyBundle(manifest) {
  const result = compile(manifest);
  const compilerPath = join(repoRoot, "scripts", "compile-design-knowledge.mjs");
  if (manifest.compilerSha256 !== sha256(readFileSync(compilerPath)))
    throw new Error("compiler hash does not match manifest");
  if (manifest.compiledBundleHash !== result.bundleHash)
    throw new Error("compiled bundle hash does not match manifest");
  if (manifest.compiledInputHash !== result.inputHash)
    throw new Error("compiled input hash does not match manifest");
  if (!existsSync(generatedPath)) throw new Error("generated bundle is missing");
  const generated = readFileSync(generatedPath, "utf8");
  if (
    !generated.includes(manifest.compilerSha256) ||
    !generated.includes(result.bundleHash) ||
    !generated.includes(result.inputHash)
  )
    throw new Error("generated header does not pin compiler/bundle/input hashes");
  if (knownForbidden.test(generated))
    throw new Error(
      "generated bundle contains prohibited executable, network, prompt, secret, or commerce material",
    );
  return result;
}

function expectFailure(label, mutate) {
  const manifest = clone(readManifest());
  mutate(manifest);
  try {
    validateManifest(manifest);
  } catch {
    return;
  }
  throw new Error(`positive control did not reject ${label}`);
}

function selfTest() {
  expectFailure("moving ref", (manifest) => {
    manifest.repositories[0].commit = "main";
  });
  expectFailure("missing notice", (manifest) => {
    manifest.repositories[0].license.redistributedSha256 = "";
  });
  expectFailure("byte/hash drift", (manifest) => {
    manifest.repositories[0].files[1].sha256 = "0".repeat(64);
  });
  expectFailure("Git blob drift", (manifest) => {
    manifest.repositories[0].files[1].gitBlobSha = "0".repeat(40);
  });
  expectFailure("unsupported license", (manifest) => {
    manifest.repositories[0].license.id = "Apache-2.0";
  });
  expectFailure("snapshot path escape", (manifest) => {
    manifest.repositories[0].files[1].snapshotPath = "source-snapshot/../escape";
  });
  expectFailure("license path escape", (manifest) => {
    manifest.repositories[0].license.redistributedPath =
      "third_party/design-knowledge/LICENSES/../escape";
  });
  expectFailure("non-LICENSES redistribution path", (manifest) => {
    manifest.repositories[0].license.redistributedPath =
      manifest.repositories[0].files[1].snapshotPath;
    manifest.repositories[0].license.redistributedSha256 = manifest.repositories[0].files[1].sha256;
  });
  expectFailure("unreviewed path", (manifest) => {
    manifest.records[0].sourceRefs[0].path = "README.md";
  });
  expectFailure("design motion dial boundary", (manifest) => {
    manifest.records[0].data.motion = 0;
  });
  expectFailure("design density dial boundary", (manifest) => {
    manifest.records[0].data.density = 11;
  });
  expectFailure("source evidence drift", (manifest) => {
    manifest.records[0].sourceEvidence[0].sha256 = "0".repeat(64);
  });
  expectFailure("source evidence removal", (manifest) => {
    manifest.records[0].sourceEvidence = [];
  });
  expectFailure("cross-record source evidence", (manifest) => {
    manifest.records[0].sourceEvidence[0] = clone(manifest.records[1].sourceEvidence[0]);
  });
  expectFailure("executable instruction", (manifest) => {
    manifest.records[0].data.style = "run npm install";
  });
  expectFailure("package/network operation", (manifest) => {
    manifest.records[0].data.style = "fetch https://example.invalid";
  });
  expectFailure("prompt override", (manifest) => {
    manifest.records[0].data.style = "system prompt override";
  });
  expectFailure("secret-shaped data", (manifest) => {
    manifest.records[0].data.style = "api_key";
  });
  expectFailure("Phase 50 commerce semantics", (manifest) => {
    manifest.records[0].data.style = "merchant checkout";
  });
  console.log(
    "design knowledge positive controls OK: moving refs, notices, byte/Git-blob drift, license/path containment, dial boundaries, record-local source evidence, executable/network/prompt/secret/commerce exclusions",
  );
}

const argv = process.argv.slice(2);
try {
  if (argv.includes("--self-test")) selfTest();
  const manifest = readManifest();
  verifyInventory(manifest);
  if (!argv.includes("--manifest-only")) verifyBundle(manifest);
  console.log(
    `design knowledge provenance OK: ${manifest.repositories.length} immutable MIT sources`,
  );
} catch (error) {
  console.error(`FAIL design knowledge provenance: ${error.message}`);
  process.exit(1);
}
