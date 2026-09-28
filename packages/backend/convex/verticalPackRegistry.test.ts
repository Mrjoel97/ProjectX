// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { VERTICAL_CANDIDATES } from "@pikar/contracts/skills/verticalCandidates";
import { TIERS, toolsForVerticalWorkflow, VERTICAL_PACKS } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const names = [
  "vertical-data",
  "vertical-design",
  "vertical-engineering",
  "vertical-hr",
  "vertical-legal",
  "vertical-product",
] as const;

describe("Phase 30 six candidate registry", () => {
  test("publishes exact canonical bodies and complete immutable source provenance, with no active or Bio row", async () => {
    const t = convexTest(schema, modules);
    expect(Object.keys(VERTICAL_CANDIDATES).sort()).toEqual([...names]);
    const published = await t.mutation(internal.skills.seedVerticalCandidates, {});
    expect(published).toHaveLength(6);
    expect(published.every((row) => row.inserted && row.version === 1)).toBe(true);

    const rows = await t.run((ctx) => ctx.db.query("skills").collect());
    expect(rows.map((row) => row.name).sort()).toEqual([...names]);
    for (const row of rows) {
      const id = row.name.slice("vertical-".length);
      const manifest = JSON.parse(
        readFileSync(
          new URL(`../../contracts/packs/vertical/${id}/manifest.json`, import.meta.url),
          "utf8",
        ),
      );
      const body = readFileSync(
        new URL(`../../contracts/packs/vertical/${id}/skill.md`, import.meta.url),
        "utf8",
      ).replace(/\r\n/g, "\n");
      expect(row).toMatchObject({ version: 1, status: "candidate", body });
      expect(row.evidence).toBeUndefined();
      expect(row.browserEvidence).toBeUndefined();
      if (!row.provenance) throw new Error("MISSING_CANDIDATE_PROVENANCE");
      expect(JSON.parse(row.provenance)).toEqual(manifest.provenance);
      expect(manifest).toMatchObject({ status: "candidate", runtimeEnabled: false });
      expect(manifest.provenance.sourceRepo).toMatch(/^https:\/\//);
      expect(manifest.provenance.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(manifest.provenance.license.length).toBeGreaterThan(0);
      expect(manifest.provenance.modificationNotice.length).toBeGreaterThan(0);
      expect(manifest.provenance.sourcePaths.length).toBeGreaterThan(0);
      expect(manifest.provenance.bodySha256).toBe(createHash("sha256").update(body).digest("hex"));
      expect(manifest.sourceFiles.map((source: { path: string }) => source.path)).toEqual(
        manifest.provenance.sourcePaths,
      );
      expect(
        manifest.sourceFiles.every(
          (source: { sha256: string; gitBlobSha: string }) =>
            /^[a-f0-9]{64}$/.test(source.sha256) && /^[a-f0-9]{40}$/.test(source.gitBlobSha),
        ),
      ).toBe(true);
    }
    await expect(
      t.mutation(internal.skills.publishPackCandidate, {
        name: "vertical-bio",
        body: "Excluded",
        provenance: "{}",
      }),
    ).rejects.toThrow("NOT_A_PACK");
    expect(await t.run((ctx) => ctx.db.query("skills").collect())).toHaveLength(6);
  });

  test("each source gets an independent version stream and repeat seeding stays candidate-only", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedVerticalCandidates, {});
    expect(
      (await t.mutation(internal.skills.seedVerticalCandidates, {})).every(
        (row) => row.version === 1 && !row.inserted,
      ),
    ).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("skills").collect())).toHaveLength(6);
    for (const name of names) {
      const original = VERTICAL_CANDIDATES[name];
      const body = `${original.body}\nVersion-two test amendment for ${name}.\n`;
      const versionTwo = {
        ...original.provenance,
        bodySha256: createHash("sha256").update(body).digest("hex"),
        skillVersions: { [name]: 2 },
      };
      expect(
        await t.mutation(internal.skills.publishPackCandidate, {
          name,
          body,
          provenance: JSON.stringify(versionTwo),
        }),
      ).toMatchObject({ name, version: 2, inserted: true });
      const rows = await t.run((ctx) => ctx.db.query("skills").collect());
      expect(rows.filter((row) => row.name === name).map((row) => row.version)).toEqual([1, 2]);
      expect(rows.every((row) => row.status === "candidate")).toBe(true);
    }
    expect(
      (await t.mutation(internal.skills.seedVerticalCandidates, {})).every(
        (row) => row.version === 3 && row.inserted,
      ),
    ).toBe(true);
  });

  test("reviewed operation matrices match the code-owned grant for every tier", () => {
    expect(TIERS.length).toBeGreaterThan(1);
    for (const name of names) {
      const id = name.slice("vertical-".length) as keyof typeof VERTICAL_PACKS;
      const matrix = JSON.parse(
        readFileSync(
          new URL(`../../contracts/packs/vertical/${id}/operation-matrix.json`, import.meta.url),
          "utf8",
        ),
      );
      const matrixTools = matrix.operations
        .flatMap((operation: { state: string; tools: string[] }) =>
          operation.state === "existing" ? operation.tools : [],
        )
        .sort();
      expect(matrix.runtimeEnabled).toBe(false);
      expect(
        matrix.operations
          .filter((operation: { state: string }) => operation.state === "forbidden")
          .every((operation: { tools: string[] }) => operation.tools.length === 0),
      ).toBe(true);
      for (const _tier of TIERS) {
        expect([...toolsForVerticalWorkflow(VERTICAL_PACKS[id].workflowId)].sort()).toEqual(
          matrixTools,
        );
      }
      expect(matrixTools).toEqual(["saveAsDocument", "searchVault"]);
    }
  });
});
