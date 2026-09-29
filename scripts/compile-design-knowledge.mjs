// Phase 49-01: deterministic, offline compiler for reviewed design knowledge.
// This file never fetches, imports, evaluates, or executes upstream material.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeRoot = join(repoRoot, "third_party", "design-knowledge");
const manifestPath = join(knowledgeRoot, "manifest.json");
const generatedPath = join(repoRoot, "packages", "core", "src", "designKnowledge.generated.ts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlobSha = (bytes) =>
  createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const clone = (value) => JSON.parse(JSON.stringify(value));

const allowed = {
  designProfile: ["accessibility", "density", "label", "motion", "style", "variance"],
  paletteProfile: ["accentRole", "label", "primaryRole", "productType"],
  typographyProfile: ["body", "heading", "label", "mood"],
  landingPattern: ["accessibility", "cta", "label", "sections"],
  formRule: ["label", "requirement"],
  tasteDial: ["density", "label", "motion", "preservation", "variance"],
  catalogueCopy: ["fields", "label", "proofRequired"],
};
const forbidden =
  /(?:<\/?(?:script|iframe|style)|javascript:|\b(?:npm|npx|pnpm|yarn|pip|curl|wget|powershell|bash|sh)\b|https?:\/\/|\b(?:fetch|web_fetch|install|execute|run command|tool grant|prompt override|system prompt|api[_ -]?key|secret|password|checkout|payment|merchant|inventory|cart|refund|shipping|tax|buy now)\b)/i;

function loadManifest() {
  if (!existsSync(manifestPath)) throw new Error("design-knowledge manifest is missing");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function sourceBytes(
  manifest,
  fail = (message) => {
    throw new Error(message);
  },
) {
  if (manifest.schemaVersion !== 1) fail("unsupported manifest schema");
  if (!Array.isArray(manifest.repositories) || manifest.repositories.length !== 3)
    fail("exactly three repositories are required");
  const refs = new Set();
  const safeRelative = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    value === value.replaceAll("//", "/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
  const contained = (base, value) => {
    const target = resolve(base, ...value.split("/"));
    const rest = relative(base, target);
    return rest !== "" && rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
  };
  for (const repository of manifest.repositories) {
    if (
      !/^[0-9a-f]{40}$/.test(repository.commit ?? "") ||
      !/^[0-9a-f]{40}$/.test(repository.treeSha ?? "")
    )
      fail(`${repository.id}: immutable commit/tree pins are required`);
    if (repository.license?.id !== "MIT") fail(`${repository.id}: only MIT sources are accepted`);
    if (
      !repository.license?.redistributedPath ||
      !/^[0-9a-f]{64}$/.test(repository.license?.redistributedSha256 ?? "")
    )
      fail(`${repository.id}: redistributed MIT notice hash is required`);
    const licensePrefix = "third_party/design-knowledge/LICENSES/";
    const redistributedPath = repository.license.redistributedPath;
    const redistributedName = redistributedPath.startsWith(licensePrefix)
      ? redistributedPath.slice(licensePrefix.length)
      : "";
    if (
      !safeRelative(repository.license.sourcePath) ||
      !safeRelative(redistributedPath) ||
      !redistributedPath.startsWith(licensePrefix) ||
      !safeRelative(redistributedName) ||
      redistributedName.includes("/") ||
      !contained(knowledgeRoot, redistributedPath) ||
      !contained(join(knowledgeRoot, "LICENSES"), redistributedName)
    )
      fail(
        `${repository.id}: license paths must be normalized and contained beneath design-knowledge/LICENSES`,
      );
    for (const file of repository.files ?? []) {
      if (
        !/^[0-9a-f]{40}$/.test(file.gitBlobSha ?? "") ||
        !/^[0-9a-f]{64}$/.test(file.sha256 ?? "")
      )
        fail(`${repository.id}/${file.path}: byte/blob hashes are required`);
      if (!Number.isInteger(file.bytes) || file.bytes < 0)
        fail(`${repository.id}/${file.path}: invalid byte count`);
      if (
        !safeRelative(file.path) ||
        !safeRelative(file.snapshotPath) ||
        !contained(knowledgeRoot, file.snapshotPath)
      )
        fail(`${repository.id}/${file.path}: invalid or escaping path`);
      const key = `${repository.id}:${file.path}`;
      if (refs.has(key)) fail(`${key}: duplicate source record`);
      refs.add(key);
      const full = join(knowledgeRoot, file.snapshotPath);
      if (!existsSync(full)) fail(`${file.snapshotPath}: snapshot is missing`);
      const bytes = readFileSync(full);
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
        fail(`${file.snapshotPath}: snapshot bytes drifted`);
      if (gitBlobSha(bytes) !== file.gitBlobSha) fail(`${file.snapshotPath}: Git blob sha drifted`);
      if (file.disposition === "included" && file.role === "license")
        fail(`${key}: licenses cannot be compiler inputs`);
      if (!["included", "excluded", "license"].includes(file.disposition))
        fail(`${key}: invalid disposition`);
    }
  }
  return refs;
}

export function validateManifest(manifest) {
  const refs = sourceBytes(manifest);
  if (!Array.isArray(manifest.records) || manifest.records.length < 7)
    throw new Error("reviewed data records are incomplete");
  for (const record of manifest.records) {
    if (!allowed[record.kind]) throw new Error(`${record.id}: unsupported data record kind`);
    if (!/^[a-z0-9-]+$/.test(record.id ?? ""))
      throw new Error(`${record.id}: closed identifier required`);
    if (!Array.isArray(record.sourceRefs) || record.sourceRefs.length === 0)
      throw new Error(`${record.id}: sourceRefs are required`);
    for (const ref of record.sourceRefs) {
      if (!refs.has(`${ref.repository}:${ref.path}`))
        throw new Error(`${record.id}: source ref is not in manifest`);
      const source = manifest.repositories
        .find((repository) => repository.id === ref.repository)
        ?.files.find((file) => file.path === ref.path);
      if (source?.disposition !== "included")
        throw new Error(`${record.id}: excluded source cannot be compiled`);
    }
    if (!record.data || Object.keys(record.data).some((key) => !allowed[record.kind].includes(key)))
      throw new Error(`${record.id}: unknown data field`);
    if (forbidden.test(JSON.stringify(record.data)))
      throw new Error(
        `${record.id}: prohibited executable, network, prompt, secret, or commerce material`,
      );
    if (
      record.kind === "designProfile" &&
      [record.data.variance, record.data.motion, record.data.density].some(
        (value) => !Number.isInteger(value) || value < 1 || value > 10,
      )
    )
      throw new Error(`${record.id}: design dials must be 1..10`);
    if (
      record.kind === "tasteDial" &&
      [record.data.variance, record.data.motion, record.data.density].some(
        (value) => !Number.isInteger(value) || value < 1 || value > 10,
      )
    )
      throw new Error(`${record.id}: taste dials must be 1..10`);
    if (
      record.kind === "catalogueCopy" &&
      (record.data.proofRequired !== true || !Array.isArray(record.data.fields))
    )
      throw new Error(`${record.id}: catalogue copy must require publisher proof`);
    if (!Array.isArray(record.sourceEvidence) || record.sourceEvidence.length === 0)
      throw new Error(`${record.id}: exact source evidence is required`);
    const recordRefs = new Set(record.sourceRefs.map((ref) => `${ref.repository}:${ref.path}`));
    for (const evidence of record.sourceEvidence) {
      if (
        !refs.has(`${evidence.repository}:${evidence.path}`) ||
        !recordRefs.has(`${evidence.repository}:${evidence.path}`) ||
        !Number.isInteger(evidence.byteStart) ||
        !Number.isInteger(evidence.byteEnd) ||
        evidence.byteStart < 0 ||
        evidence.byteEnd <= evidence.byteStart ||
        !/^[0-9a-f]{64}$/.test(evidence.sha256 ?? "")
      )
        throw new Error(`${record.id}: malformed exact source evidence`);
      const source = manifest.repositories
        .find((repository) => repository.id === evidence.repository)
        ?.files.find((file) => file.path === evidence.path);
      if (!source || source.disposition !== "included")
        throw new Error(`${record.id}: source evidence must reference an included source`);
      const bytes = readFileSync(join(knowledgeRoot, source.snapshotPath));
      if (
        evidence.byteEnd > bytes.length ||
        sha256(bytes.subarray(evidence.byteStart, evidence.byteEnd)) !== evidence.sha256
      )
        throw new Error(`${record.id}: exact source evidence drifted`);
    }
  }
  const ids = manifest.records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error("record identifiers must be unique");
  return refs;
}

function inputProjection(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    repositories: manifest.repositories,
    records: manifest.records,
    exclusions: manifest.exclusions,
  };
}

export function compile(manifest) {
  validateManifest(manifest);
  const records = clone(manifest.records)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map((record) => ({ id: record.id, kind: record.kind, data: record.data }));
  const inputHash = sha256(Buffer.from(canonical(inputProjection(manifest)), "utf8"));
  const payload = {
    schemaVersion: 1,
    compilerSchemaVersion: manifest.compilerSchemaVersion,
    inputHash,
    records,
  };
  const bundleHash = sha256(Buffer.from(canonical(payload), "utf8"));
  return { payload, inputHash, bundleHash };
}

function generatedSource(compiled, manifest) {
  const json = JSON.stringify(compiled.payload, null, 2);
  return `// GENERATED FILE. Do not edit. Offline compiler schema ${manifest.compilerSchemaVersion}; compiler ${manifest.compilerSha256}; bundle ${compiled.bundleHash}; input ${compiled.inputHash}.\nexport const designKnowledgeBundle = ${json} as const;\nexport type DesignKnowledgeBundle = typeof designKnowledgeBundle;\n`;
}

function main(argv) {
  const manifest = loadManifest();
  manifest.compilerSha256 = sha256(
    readFileSync(join(repoRoot, "scripts", "compile-design-knowledge.mjs")),
  );
  const compiled = compile(manifest);
  const generated = generatedSource(compiled, manifest);
  if (argv.includes("--check")) {
    if (!existsSync(generatedPath)) throw new Error("generated design knowledge module is missing");
    if (readFileSync(generatedPath, "utf8") !== generated)
      throw new Error("generated design knowledge module is not deterministic or is stale");
    if (manifest.compiledBundleHash !== compiled.bundleHash)
      throw new Error("manifest compiledBundleHash is stale");
    console.log(
      `design knowledge compile OK: ${compiled.payload.records.length} records, bundle ${compiled.bundleHash}`,
    );
    return;
  }
  writeFileSync(generatedPath, generated, "utf8");
  manifest.compiledBundleHash = compiled.bundleHash;
  manifest.compiledInputHash = compiled.inputHash;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `design knowledge compiled: ${compiled.payload.records.length} records, bundle ${compiled.bundleHash}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
