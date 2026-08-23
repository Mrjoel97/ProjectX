// 27-01 Task 2 (PACK-01): the offline provenance verifier for the pinned upstream snapshot.
//
// STRICTLY OFFLINE AND READ-ONLY. It fetches nothing, writes nothing, publishes nothing, schedules
// nothing and activates nothing — it reads `third_party/knowledge-work-plugins/` off disk and
// compares it against `manifest.json`. That is the whole point: an update to the upstream material
// must arrive as a HUMAN-REVIEWED DIFF against a newly pinned commit, and this script is what makes
// an unreviewed drift fail rather than pass quietly.
//
// Invocation:
//   node scripts/verify-knowledge-work-provenance.mjs --check-source   full check, exit non-zero on drift
//   node scripts/verify-knowledge-work-provenance.mjs --diff-report    same checks, but reports every
//                                                                     discrepancy instead of stopping
//                                                                     at the first, and never exits 0
//                                                                     while any exist
//
// Exit codes: 0 everything matches · 1 drift, a missing file, or a malformed manifest.
//
// WHAT IT DELIBERATELY DOES NOT CHECK: the ADAPTED body hashes. Those pin
// `packages/contracts/skills/pack-*.md`, which 27-04/05/06 author and 27-08 finalises. The manifest
// records them as `null` and this script asserts they are still `null` OR fully valid — never
// half-populated, which would let a partially-finished adaptation look complete.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(repoRoot, "third_party", "knowledge-work-plugins");
const manifestPath = join(vendorRoot, "manifest.json");
const snapshotRoot = join(vendorRoot, "source-snapshot");
const noticesPath = join(repoRoot, "THIRD_PARTY_NOTICES.md");

const KNOWN_FLAGS = new Set(["--check-source", "--diff-report"]);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

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

function main(argv) {
  const problems = [];
  const fail = (msg) => problems.push(msg);

  for (const arg of argv) {
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`unknown flag ${arg}`);
  }
  if (argv.length === 0) throw new Error("pass --check-source (or --diff-report)");

  if (!existsSync(manifestPath)) throw new Error(`manifest.json is missing at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

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
  }

  // ── adapted bodies are all-pending or all-present, never half ─────────────
  const packs = manifest.packs ?? [];
  const withHash = packs.filter((p) => typeof p.adaptedBodySha256 === "string");
  if (withHash.length !== 0 && withHash.length !== packs.length)
    fail(
      `${withHash.length} of ${packs.length} adapted bodies are hashed — a half-populated manifest ` +
        "makes an unfinished adaptation look complete",
    );
  for (const p of withHash) {
    if (!/^[0-9a-f]{64}$/.test(p.adaptedBodySha256))
      fail(`${p.packId}: adaptedBodySha256 is not a sha256`);
    // The hash pins the CANONICAL .md, never the auto-derived .ts constant.
    if (!p.adaptedDestination?.startsWith("packages/contracts/skills/"))
      fail(
        `${p.packId}: adaptedDestination must be a canonical .md under packages/contracts/skills/`,
      );
    const body = join(repoRoot, ...p.adaptedDestination.split("/"));
    if (!existsSync(body)) fail(`${p.packId}: adapted body ${p.adaptedDestination} is absent`);
    else if (sha256(readFileSync(body)) !== p.adaptedBodySha256)
      fail(`${p.packId}: adapted body does not match its manifest hash`);
  }

  if (problems.length > 0) {
    console.error(`FAIL provenance: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  const pending = withHash.length === 0 ? " (adapted bodies pending, as recorded)" : "";
  console.log(
    `provenance OK: ${declared.size} files at ${commit.slice(0, 12)}, ${packs.length} packs${pending}`,
  );
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (err) {
  console.error(`FAIL ${err.message}`);
  process.exit(1);
}
