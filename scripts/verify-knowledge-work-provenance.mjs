// 27-01 Task 2 (PACK-01): the offline provenance verifier for the pinned upstream snapshot.
//
// STRICTLY OFFLINE AND READ-ONLY. It fetches nothing, writes nothing, publishes nothing, schedules
// nothing and activates nothing — it reads `third_party/knowledge-work-plugins/` off disk and
// compares it against `manifest.json`. That is the whole point: an update to the upstream material
// must arrive as a HUMAN-REVIEWED DIFF against a newly pinned commit, and this script is what makes
// an unreviewed drift fail rather than pass quietly.
//
// Invocation:
//   node scripts/verify-knowledge-work-provenance.mjs --check-source   source snapshot only
//   node scripts/verify-knowledge-work-provenance.mjs --check          THE FULL GATE (27-08)
//   node scripts/verify-knowledge-work-provenance.mjs --diff-report    source checks, reporting every
//                                                                     discrepancy rather than the
//                                                                     first, and never exiting 0
//                                                                     while any exist
//
// Exit codes: 0 everything matches · 1 drift, a missing file, or a malformed manifest.
//
// `--check-source` VERSUS `--check`. 27-01 shipped the source half alone, because the adapted
// bodies did not exist yet: it accepts `adaptedBodySha256: null` as long as ALL six are null (never
// half, which would let an unfinished adaptation look complete). `--check` is the 27-08 gate and
// accepts no such pending state — every body must exist, be hashed, match, be attributed in
// THIRD_PARTY_NOTICES.md with a stated modification, and agree with its derived `.ts` constant.
// The source half is a subset of it, so `--check` runs every source check too.
//
// THE ADAPTED HASH IS OVER LF-NORMALIZED BYTES, and that is not a convenience. The repo root
// `.gitattributes` sets `* text=auto`, so `packages/contracts/skills/*.md` is checked out CRLF on a
// Windows clone with `core.autocrlf=true` and LF everywhere else — a raw-byte hash would be a
// different number per machine and the gate would be unfalsifiable. LF is also exactly what SHIPS:
// the published body is the derived `.ts` constant, which is LF, and `skillBodies.test.ts` compares
// the pair LF-normalized. The SNAPSHOT hashes stay raw-byte, because the vendored tree carries its
// own `.gitattributes` with `* -text` and is guaranteed verbatim on every checkout.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(repoRoot, "third_party", "knowledge-work-plugins");
const manifestPath = join(vendorRoot, "manifest.json");
const snapshotRoot = join(vendorRoot, "source-snapshot");
const noticesPath = join(repoRoot, "THIRD_PARTY_NOTICES.md");

const KNOWN_FLAGS = new Set(["--check-source", "--check", "--diff-report"]);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
/** The checkout-independent body identity — see the LF note in the header. */
const lf = (s) => s.replace(/\r\n/g, "\n");

/**
 * The derived constant that MIRRORS a canonical `.md` body: `pack-business-pulse.md` ships as
 * `packages/contracts/src/skills/packBusinessPulse.ts` exporting `packBusinessPulseSkillBody`.
 * There is no generator — the `.ts` is hand-derived — which is exactly why the pair is checked.
 */
function derivedConstantFor(packId) {
  const camel = packId.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const base = `pack${camel[0].toUpperCase()}${camel.slice(1)}`;
  return {
    path: join(repoRoot, "packages", "contracts", "src", "skills", `${base}.ts`),
    exportName: `${base}SkillBody`,
  };
}

/** Every file under the snapshot, as upstream-relative POSIX paths. */
function snapshotFiles(dir = snapshotRoot) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...snapshotFiles(full));
    else out.push(relative(snapshotRoot, full).split(sep).join("/"));
  }
  return out.sort();
}

/**
 * Import a hand-derived `.ts` body constant. The file is type-free by construction (a comment and
 * one exported string), so Node's native type stripping loads it as-is — but that stripping is a
 * Node >= 22.6 feature, so the failure names the requirement instead of surfacing as "cannot find
 * module". ponytail: no bundler and no second parser; a hand-rolled decode of a JS string literal
 * is exactly the kind of copy that can disagree with the module it is checking.
 */
async function loadDerived(path) {
  try {
    return await import(pathToFileURL(path).href);
  } catch (err) {
    throw new Error(
      `cannot load the derived constant ${path}. This check strips TypeScript types natively and ` +
        `needs Node >= 22.6; this is ${process.version}. Original: ${err.message}`,
    );
  }
}

async function main(argv) {
  const problems = [];
  const fail = (msg) => problems.push(msg);

  for (const arg of argv) {
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`unknown flag ${arg}`);
  }
  if (argv.length === 0) throw new Error("pass --check (or --check-source / --diff-report)");
  const final = argv.includes("--check");

  if (!existsSync(manifestPath)) throw new Error(`manifest.json is missing at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Source inventory is distinct from the six published Phase-27 adaptations.
  // Draft integrity must not imply a runtime mirror, eval pass, or activation.
  const draft = JSON.parse(readFileSync(join(vendorRoot, "draft-manifest.json"), "utf8"));
  if (draft.status !== "draft-source-inventory" || draft.runtimeEnabled !== false)
    fail("draft source inventory must not claim runtime activation");
  if (
    draft.upstream?.commit !== manifest.upstream?.commit ||
    draft.upstream?.repo !== manifest.upstream?.repo
  )
    fail("draft source inventory must use the same verified upstream pin");
  const draftIds = ["data", "design", "engineering", "hr", "legal", "product"];
  if (
    JSON.stringify((draft.candidates ?? []).map((c) => c.packId).sort()) !==
    JSON.stringify(draftIds)
  )
    fail("draft source inventory must name exactly the six closed vertical candidates");

  // ── the pin itself ────────────────────────────────────────────────────────
  const commit = manifest.upstream?.commit;
  // A floating ref makes every hash below unfalsifiable, so the SHAPE is checked, not just presence.
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit))
    fail(`upstream.commit must be an exact 40-character sha, got ${JSON.stringify(commit)}`);
  if (typeof manifest.upstream?.repo !== "string" || !manifest.upstream.repo.startsWith("https://"))
    fail("upstream.repo must be an https URL");
  if (manifest.license?.id !== "Apache-2.0") fail("license.id must be Apache-2.0");

  // ── licence and notices survive redistribution ────────────────────────────
  const licensePath = join(vendorRoot, "LICENSE");
  if (!existsSync(licensePath)) fail("third_party/knowledge-work-plugins/LICENSE is missing");
  else {
    const text = readFileSync(licensePath, "utf8");
    for (const phrase of ["Apache License", "Version 2.0", "WITHOUT WARRANTIES OR CONDITIONS"]) {
      if (!text.includes(phrase)) fail(`the redistributed LICENSE does not contain "${phrase}"`);
    }
  }
  if (!existsSync(noticesPath)) fail("THIRD_PARTY_NOTICES.md is missing");
  else {
    const notices = readFileSync(noticesPath, "utf8");
    // Apache-2.0 §4(b) wants a PROMINENT notice that files were changed. Presence of the pinned
    // commit and of a modification notice are both required — attribution without the modification
    // notice is the half that quietly goes missing.
    if (!notices.includes(commit)) fail("THIRD_PARTY_NOTICES.md does not cite the pinned commit");
    if (!/NOTICE OF MODIFICATION/i.test(notices))
      fail("THIRD_PARTY_NOTICES.md carries no modification notice (Apache-2.0 4(b))");
    for (const pack of manifest.packs ?? []) {
      if (!notices.includes(pack.upstreamSource))
        fail(`THIRD_PARTY_NOTICES.md does not attribute ${pack.upstreamSource}`);
    }
  }

  // The anomaly record duplicates a hash the snapshot walk already checks, so it can silently
  // disagree with it — a second copy of a fact is a second place for it to be wrong. Found by
  // mutating it and watching the verifier stay green.
  const anomaly = manifest.license?.rootLicenseAnomaly;
  if (anomaly) {
    const same = (manifest.licenseFiles ?? []).find((f) => f.path === anomaly.path);
    if (!same)
      fail(`rootLicenseAnomaly names ${anomaly.path}, which is not a declared licence file`);
    else if (same.sha256 !== anomaly.sha256 || same.bytes !== anomaly.bytes)
      fail(`rootLicenseAnomaly disagrees with the declared licence file for ${anomaly.path}`);
  }

  // ── the snapshot matches the manifest, BOTH WAYS ──────────────────────────
  const declared = new Map();
  for (const pack of manifest.packs ?? []) {
    if (!Array.isArray(pack.files) || pack.files.length === 0)
      fail(`${pack.packId}: no source files recorded`);
    // A pack with no upstream counterpart is recorded as null WITH a reason — never guessed at.
    if (pack.upstreamSource === null && !pack.upstreamAbsentReason)
      fail(`${pack.packId}: upstreamSource is null with no upstreamAbsentReason`);
    for (const f of pack.files ?? []) declared.set(f.path, f);
  }
  for (const f of manifest.licenseFiles ?? []) declared.set(f.path, f);
  for (const f of draft.files ?? []) {
    if (
      typeof f.path !== "string" ||
      f.path.startsWith("/") ||
      f.path.includes("\\") ||
      f.path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      fail("draft source inventory contains an invalid relative path");
      continue;
    }
    const existing = declared.get(f.path);
    if (
      existing &&
      (existing.sha256 !== f.sha256 ||
        existing.bytes !== f.bytes ||
        existing.gitBlobSha !== f.gitBlobSha)
    )
      fail(`draft and runtime source records disagree for ${f.path}`);
    declared.set(f.path, f);
  }
  const draftReferenced = new Set();
  for (const entry of draft.candidates ?? []) {
    const expectedPath = `packages/contracts/packs/vertical/${entry.packId}/manifest.json`;
    if (!draftIds.includes(entry.packId) || entry.manifestPath !== expectedPath) {
      fail("draft candidate has an invalid manifest path");
      continue;
    }
    const candidate = JSON.parse(readFileSync(join(repoRoot, entry.manifestPath), "utf8"));
    if (
      candidate.packId !== entry.packId ||
      candidate.status !== "candidate" ||
      candidate.runtimeEnabled !== false
    )
      fail(`${entry.packId}: draft candidate cannot claim activation`);
    if (
      candidate.provenance?.sourceCommit !== commit ||
      candidate.provenance?.sourceRepo !== manifest.upstream.repo
    )
      fail(`${entry.packId}: candidate source pin disagrees with inventory`);
    if (JSON.stringify(candidate.provenance?.sourcePaths) !== JSON.stringify(entry.sourcePaths))
      fail(`${entry.packId}: source path inventory drift`);
    if (
      JSON.stringify(candidate.sourceFiles?.map((f) => f.path)) !==
      JSON.stringify(entry.sourcePaths)
    )
      fail(`${entry.packId}: source files do not cover the candidate paths`);
    for (const f of candidate.sourceFiles ?? []) {
      const rec = declared.get(f.path);
      if (
        !rec ||
        rec.sha256 !== f.sha256 ||
        rec.bytes !== f.bytes ||
        rec.gitBlobSha !== f.gitBlobSha
      )
        fail(`${entry.packId}: candidate source hash disagrees for ${f.path}`);
      draftReferenced.add(f.path);
    }
    const license = declared.get(entry.governingLicense);
    if (
      !license ||
      candidate.licenseEvidence?.governingPath !== entry.governingLicense ||
      candidate.licenseEvidence?.governingSha256 !== license.sha256
    )
      fail(`${entry.packId}: governing license is not pinned consistently`);
    draftReferenced.add(entry.governingLicense);
    const body = readFileSync(
      join(repoRoot, "packages/contracts/packs/vertical", entry.packId, "skill.md"),
      "utf8",
    );
    if (sha256(lf(body)) !== candidate.provenance?.bodySha256)
      fail(`${entry.packId}: draft canonical body hash drift`);
    const notices = readFileSync(noticesPath, "utf8");
    for (const path of entry.sourcePaths ?? []) {
      if (!notices.includes(path.replace(/\/SKILL\.md$/, "")))
        fail(`THIRD_PARTY_NOTICES.md does not attribute draft source ${path}`);
    }
  }
  for (const f of draft.files ?? []) {
    if (!draftReferenced.has(f.path)) fail(`draft source ${f.path} has no attributed candidate`);
  }
  if (declared.size === 0) fail("the manifest declares no files at all");

  const onDisk = existsSync(snapshotRoot) ? snapshotFiles() : [];
  for (const path of onDisk) {
    if (!declared.has(path)) fail(`snapshot holds ${path}, which the manifest does not declare`);
  }
  for (const [path, rec] of declared) {
    const full = join(snapshotRoot, ...path.split("/"));
    if (!existsSync(full)) {
      fail(`declared ${path} is absent from the snapshot`);
      continue;
    }
    const bytes = readFileSync(full);
    if (bytes.length !== rec.bytes)
      fail(`${path}: ${bytes.length} bytes on disk, manifest says ${rec.bytes}`);
    const actual = sha256(bytes);
    if (actual !== rec.sha256)
      fail(`${path}: sha256 ${actual} on disk, manifest says ${rec.sha256}`);
    if (typeof rec.gitBlobSha !== "string" || !/^[0-9a-f]{40}$/.test(rec.gitBlobSha))
      fail(`${path}: gitBlobSha is not a 40-character sha`);
    else if (
      createHash("sha1")
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest("hex") !== rec.gitBlobSha
    )
      fail(`${path}: bytes do not match the recorded Git blob sha`);
  }

  // ── adapted bodies ────────────────────────────────────────────────────────
  const packs = manifest.packs ?? [];
  const withHash = packs.filter((p) => typeof p.adaptedBodySha256 === "string");
  if (withHash.length !== 0 && withHash.length !== packs.length)
    fail(
      `${withHash.length} of ${packs.length} adapted bodies are hashed — a half-populated manifest ` +
        "makes an unfinished adaptation look complete",
    );
  // THE FULL GATE ACCEPTS NO PENDING STATE. Under `--check-source` the all-null corpus is a legal
  // recorded state; under `--check` it is the whole thing being checked, so "pending" is a failure
  // rather than a fact — otherwise the 27-08 gate passes on a manifest that pins nothing at all.
  if (final) {
    if (manifest.adaptedBodies?.status !== "final")
      fail(
        `adaptedBodies.status is "${manifest.adaptedBodies?.status}" — --check requires "final"`,
      );
    for (const p of packs) {
      if (typeof p.adaptedBodySha256 !== "string")
        fail(`${p.packId}: adaptedBodySha256 is still pending, and --check is the final gate`);
    }
  }
  for (const p of withHash) {
    if (!/^[0-9a-f]{64}$/.test(p.adaptedBodySha256))
      fail(`${p.packId}: adaptedBodySha256 is not a sha256`);
    // The hash pins the CANONICAL .md, never the auto-derived .ts constant.
    if (!p.adaptedDestination?.startsWith("packages/contracts/skills/"))
      fail(
        `${p.packId}: adaptedDestination must be a canonical .md under packages/contracts/skills/`,
      );
    const body = join(repoRoot, ...p.adaptedDestination.split("/"));
    if (!existsSync(body)) {
      fail(`${p.packId}: adapted body ${p.adaptedDestination} is absent`);
      continue;
    }
    const canonical = lf(readFileSync(body, "utf8"));
    if (sha256(canonical) !== p.adaptedBodySha256)
      fail(`${p.packId}: adapted body does not match its manifest hash`);

    if (!final) continue;

    // Apache-2.0 §4(b) in the redistributed artifact, not only in the machine-readable manifest:
    // the notices file a human reads must name the pack AND say what changed.
    if (typeof p.plannedModifications !== "string" || p.plannedModifications.length < 40)
      fail(`${p.packId}: plannedModifications is missing or too short to be a modification notice`);
    const notices = existsSync(noticesPath) ? readFileSync(noticesPath, "utf8") : "";
    if (!notices.includes(p.packId))
      fail(`THIRD_PARTY_NOTICES.md does not name the adapted pack ${p.packId}`);

    // THE DRIFT CHECK. The `.md` is canonical and is what the hash pins, but the `.ts` constant is
    // what actually SHIPS (the Convex runtime cannot read repo files) and it is hand-derived with
    // no generator. If the pair has drifted, this manifest pins bytes nobody runs — so the gate
    // fails rather than certifying whichever file it happened to open.
    const derived = derivedConstantFor(p.packId);
    if (!existsSync(derived.path)) fail(`${p.packId}: derived constant ${derived.path} is absent`);
    else {
      const mod = await loadDerived(derived.path);
      const shipped = mod[derived.exportName];
      if (typeof shipped !== "string")
        fail(`${p.packId}: ${derived.exportName} is not exported as a string`);
      else if (lf(shipped) !== canonical)
        fail(`${p.packId}: the derived .ts constant has DRIFTED from ${p.adaptedDestination}`);
    }
  }

  if (problems.length > 0) {
    console.error(`FAIL provenance: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  const state = final
    ? " (adapted bodies final, hashed and mirrored)"
    : withHash.length === 0
      ? " (adapted bodies pending, as recorded)"
      : "";
  console.log(
    `provenance OK: ${declared.size} files at ${commit.slice(0, 12)}, ${packs.length} runtime packs${state}; ${draft.candidates.length} draft source records (not release evidence)`,
  );
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`FAIL ${err.message}`);
    process.exit(1);
  });
