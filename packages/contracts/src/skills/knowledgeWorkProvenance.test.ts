import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { KNOWLEDGE_WORK_PINNED_AT, KNOWLEDGE_WORK_PROVENANCE } from "./knowledgeWorkProvenance";

// 27-01 (PACK-01). The upstream material Phase 27's packs are adapted from is pinned to ONE exact
// commit, snapshotted byte-for-byte, and hashed. This is the vitest-resident half of that gate:
// `scripts/verify-knowledge-work-provenance.mjs` is the runnable CLI, and this file makes the same
// properties part of a suite that CI already runs.
//
// It lives in @pikar/contracts because that is where the skill bodies live and because
// `packages/contracts/vitest.config.ts` includes `src/**/*.test.ts`. A test under `scripts/` would
// never execute — there is no root vitest and `scripts/` is not a pnpm workspace.

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const vendorRoot = join(repoRoot, "third_party", "knowledge-work-plugins");
const snapshotRoot = join(vendorRoot, "source-snapshot");

type FileRecord = { path: string; bytes: number; sha256: string; gitBlobSha: string };
type Pack = {
  packId: string;
  skillName: string;
  upstreamSource: string | null;
  upstreamAbsentReason?: string;
  adaptedDestination: string;
  adaptedBodySha256: string | null;
  plannedModifications: string;
  files: FileRecord[];
};

const manifest = JSON.parse(readFileSync(join(vendorRoot, "manifest.json"), "utf8")) as {
  upstream: { repo: string; commit: string; commitDate: string };
  license: { id: string; rootLicenseAnomaly?: FileRecord & { finding: string } };
  packs: Pack[];
  adaptedBodies: { status: string };
  licenseFiles: FileRecord[];
};

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
/** The checkout-independent body identity — see the adapted-body test for why this is not raw bytes. */
const lf = (s: string) => s.replace(/\r\n/g, "\n");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(snapshotRoot, full).split(sep).join("/"));
  }
  return out.sort();
}

describe("the upstream pin is exact and reproducible", () => {
  // A branch or a tag makes every hash in the manifest unfalsifiable: the bytes it names can change
  // underneath the pin without the pin changing. Only a commit is a fact.
  test("the commit is a 40-character sha, never a floating ref", () => {
    expect(manifest.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.upstream.repo).toBe("https://github.com/anthropics/knowledge-work-plugins");
  });

  test("every declared file is on disk with exactly the recorded bytes and hash", () => {
    const declared = [...manifest.packs.flatMap((p) => p.files), ...manifest.licenseFiles];
    // Non-vacuity floor: an empty manifest must fail loudly rather than pass by having nothing to
    // check — the way a hash-checking test rots into decoration.
    expect(declared.length).toBeGreaterThan(10);

    for (const rec of declared) {
      const full = join(snapshotRoot, ...rec.path.split("/"));
      expect(existsSync(full), `${rec.path} is declared but absent from the snapshot`).toBe(true);
      const bytes = readFileSync(full);
      expect(bytes.length, `${rec.path} byte count`).toBe(rec.bytes);
      expect(sha256(bytes), `${rec.path} sha256`).toBe(rec.sha256);
      expect(rec.gitBlobSha, `${rec.path} gitBlobSha`).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  // BOTH directions. A file added to the snapshot but not the manifest is unattributed material
  // being redistributed, which is exactly what the manifest exists to prevent.
  test("the snapshot holds nothing the manifest does not declare", () => {
    const declared = new Set(
      [...manifest.packs.flatMap((p) => p.files), ...manifest.licenseFiles].map((f) => f.path),
    );
    expect(walk(snapshotRoot).filter((p) => !declared.has(p))).toEqual([]);
  });
});

describe("licensing and modification notices survive redistribution", () => {
  test("the redistributed licence is Apache-2.0", () => {
    expect(manifest.license.id).toBe("Apache-2.0");
    const text = readFileSync(join(vendorRoot, "LICENSE"), "utf8");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0");
    expect(text).toContain("WITHOUT WARRANTIES OR CONDITIONS");
  });

  // Apache-2.0 §4(b): a prominent notice that files were CHANGED. Attribution without the
  // modification notice is the half that quietly goes missing, so both are asserted.
  test("THIRD_PARTY_NOTICES.md cites the pin, the modification notice, and every source", () => {
    const notices = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toContain(manifest.upstream.commit);
    expect(notices).toMatch(/NOTICE OF MODIFICATION/i);
    for (const pack of manifest.packs) {
      expect(pack.upstreamSource, `${pack.packId} has no upstream source recorded`).toBeTruthy();
      expect(notices, `${pack.packId} is not attributed`).toContain(pack.upstreamSource as string);
    }
  });

  // The anomaly record duplicates a hash the file walk already checks. A second copy of a fact is a
  // second place for it to be wrong, so the two must agree.
  test("the recorded root-licence anomaly agrees with the snapshot", () => {
    const anomaly = manifest.license.rootLicenseAnomaly;
    expect(anomaly, "the root-licence anomaly is no longer recorded").toBeTruthy();
    const declared = manifest.licenseFiles.find((f) => f.path === anomaly?.path);
    expect(declared?.sha256).toBe(anomaly?.sha256);
    expect(declared?.bytes).toBe(anomaly?.bytes);
    expect(anomaly?.finding.length).toBeGreaterThan(40);
  });
});

describe("every pack has a real, reproducible source record", () => {
  test("all six packs are recorded, with files and a stated modification", () => {
    expect(manifest.packs.map((p) => p.packId).sort()).toEqual([
      "brand-review",
      "business-pulse",
      "campaign-plan",
      "customer-complaint",
      "process-sop",
      "sales-call-prep",
    ]);
    for (const pack of manifest.packs) {
      expect(pack.skillName).toBe(`pack-${pack.packId}`);
      expect(pack.files.length, `${pack.packId} has no source files`).toBeGreaterThan(0);
      // The planned modification is the Apache-2.0 §4(b) content in machine-readable form. An empty
      // one means we are redistributing an adaptation without saying what we changed.
      expect(pack.plannedModifications.length, `${pack.packId} modification note`).toBeGreaterThan(
        40,
      );
      // A pack with no upstream counterpart must say WHY — never be silently blank.
      if (pack.upstreamSource === null) expect(pack.upstreamAbsentReason).toBeTruthy();
      else expect(pack.files.every((f) => f.path.startsWith(`${pack.upstreamSource}/`))).toBe(true);
    }
  });

  // The hash pins the CANONICAL `.md`. `packages/contracts/src/skills/*.ts` are derived constants
  // that `skillBodies.test.ts` asserts are byte-identical to their `.md`; hashing the `.ts` would
  // pin the copy rather than the original.
  test("adapted destinations are canonical .md bodies, never the derived .ts constants", () => {
    for (const pack of manifest.packs) {
      expect(pack.adaptedDestination).toBe(`packages/contracts/skills/pack-${pack.packId}.md`);
      expect(pack.adaptedDestination.endsWith(".md")).toBe(true);
      expect(pack.adaptedDestination).not.toContain("src/skills");
    }
  });

  // 27-04/05/06 authored the bodies and 27-08 finalised the hashes. This was "all pending or all
  // present — never half" while the corpus was being written; it is now the FINAL state, because a
  // pending entry after 27-08 means a pack was published against bytes nothing pins.
  //
  // THE HASH IS OVER LF-NORMALIZED BYTES. The repo root `.gitattributes` sets `* text=auto`, so a
  // raw-byte hash of a `.md` is a different number on a CRLF Windows checkout than on CI — the gate
  // would then fail or pass by machine rather than by content. LF is also what actually ships: the
  // published body is the derived `.ts` constant, which `skillBodies.test.ts` compares LF-normalized.
  test("every adapted body is final, hashed, and matches its manifest hash", () => {
    expect(manifest.adaptedBodies.status).toBe("final");
    for (const pack of manifest.packs) {
      expect(pack.adaptedBodySha256, `${pack.packId} is still pending`).toMatch(/^[0-9a-f]{64}$/);
      const body = join(repoRoot, ...pack.adaptedDestination.split("/"));
      expect(existsSync(body), `${pack.adaptedDestination} is hashed but absent`).toBe(true);
      expect(sha256(lf(readFileSync(body, "utf8"))), `${pack.packId} body hash`).toBe(
        pack.adaptedBodySha256,
      );
    }
  });

  // 27-08 Task 2. `skills.ts` runs inside Convex and has NO FILESYSTEM, so the provenance it attaches
  // to a published candidate cannot be read from `manifest.json` — it comes from the code-owned
  // mirror in `knowledgeWorkProvenance.ts`. This is the drift row that makes the mirror a copy rather
  // than a second, independent claim: without it, a corrected manifest and a stale constant would
  // publish six immutable candidates whose recorded source record contradicts the repo's own.
  test("the code-owned provenance mirror agrees with manifest.json field for field", () => {
    expect(Object.keys(KNOWLEDGE_WORK_PROVENANCE).sort()).toEqual(
      manifest.packs.map((p) => p.skillName).sort(),
    );
    expect(KNOWLEDGE_WORK_PINNED_AT).toBe(Date.parse(manifest.upstream.commitDate));
    for (const pack of manifest.packs) {
      const mirror = KNOWLEDGE_WORK_PROVENANCE[pack.skillName];
      if (mirror === undefined) throw new Error(`no mirrored provenance for ${pack.skillName}`);
      expect(mirror.sourceRepo).toBe(manifest.upstream.repo);
      expect(mirror.sourceCommit).toBe(manifest.upstream.commit);
      expect(mirror.bodySha256, `${pack.packId} body hash`).toBe(pack.adaptedBodySha256);
      expect(mirror.modificationNotice, `${pack.packId} notice`).toBe(pack.plannedModifications);
      expect(mirror.license).toBe(manifest.license.id);
      // Every declared source file, in the manifest's own order — a mirror that carried a SUBSET
      // would still satisfy `hasValidPackProvenance` (which only requires a non-empty array), so
      // the completeness has to be asserted here or nowhere.
      expect([...mirror.sourcePaths], `${pack.packId} source paths`).toEqual(
        pack.files.map((f) => f.path),
      );
    }
  });

  // Apache-2.0 §4(b) again, but for the ADAPTATION rather than the source: the notices file a human
  // reads must name each pack and state what changed. The manifest's `plannedModifications` is the
  // machine-readable half and is checked above; a modification recorded ONLY in a JSON file nobody
  // ships to a reader is attribution that exists for the repo, not for the licence.
  test("THIRD_PARTY_NOTICES.md names every adapted pack and its modification", () => {
    const notices = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toMatch(/NOTICE OF MODIFICATION/i);
    for (const pack of manifest.packs) {
      expect(notices, `${pack.packId} is not named in the notices`).toContain(pack.packId);
    }
  });
});
