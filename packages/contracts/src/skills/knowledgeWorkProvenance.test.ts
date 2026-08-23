import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

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
  upstream: { repo: string; commit: string };
  license: { id: string; rootLicenseAnomaly?: FileRecord & { finding: string } };
  packs: Pack[];
  licenseFiles: FileRecord[];
};

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

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

  // 27-04/05/06 author the bodies and 27-08 finalises the hashes. Until then every entry is `null`;
  // what must never happen is a HALF-populated manifest, which would make an unfinished adaptation
  // look complete. This assertion holds in both states and tightens as the bodies land.
  test("adapted body hashes are all pending or all present — never half", () => {
    const hashed = manifest.packs.filter((p) => typeof p.adaptedBodySha256 === "string");
    expect(hashed.length === 0 || hashed.length === manifest.packs.length).toBe(true);
    for (const pack of hashed) {
      expect(pack.adaptedBodySha256).toMatch(/^[0-9a-f]{64}$/);
      const body = join(repoRoot, ...pack.adaptedDestination.split("/"));
      expect(existsSync(body), `${pack.adaptedDestination} is hashed but absent`).toBe(true);
      expect(sha256(readFileSync(body))).toBe(pack.adaptedBodySha256);
    }
  });
});
