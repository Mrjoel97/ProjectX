import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { toolsForVerticalWorkflow, VERTICAL_PACKS } from "@pikar/core";
import { describe, expect, test } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const json = (path: string) => JSON.parse(read(path));
const base = "packages/contracts/packs/vertical/engineering";
const manifest = json(`${base}/manifest.json`);

describe("Engineering candidate provenance and boundaries", () => {
  test("candidate binds exact source blobs and its adapted body without claiming activation", () => {
    expect(manifest.provenance.sourceCommit).toBe("5267cf7bff3031921d4474b8e8f86ad02d2b8f6d");
    expect(manifest.sourceFiles).toHaveLength(3);
    for (const source of manifest.sourceFiles) {
      const bytes = Buffer.from(
        read(`third_party/knowledge-work-plugins/source-snapshot/${source.path}`),
      );
      expect(bytes.length).toBe(source.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
      expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")).toBe(
        source.gitBlobSha,
      );
    }
    expect(
      createHash("sha256")
        .update(read(`${base}/skill.md`))
        .digest("hex"),
    ).toBe(manifest.provenance.bodySha256);
    expect(manifest).toMatchObject({
      status: "candidate",
      runtimeEnabled: false,
      skillName: "vertical-engineering",
    });
    expect(manifest.evidence).toEqual({
      methodReview: "draft",
      nativeEval: null,
      browserUat: null,
      activation: null,
    });
  });

  test("declared operations match the code grant and preserve missing external capability", () => {
    const matrix = json(`${base}/operation-matrix.json`);
    expect(matrix.workflowId).toBe(VERTICAL_PACKS.engineering.workflowId);
    expect(matrix.runtimeEnabled).toBe(false);
    const granted = matrix.operations
      .filter((item: { state: string }) => item.state === "existing")
      .flatMap((item: { tools: string[] }) => item.tools);
    expect(granted.sort()).toEqual(
      [...toolsForVerticalWorkflow("engineering-runbook-review")].sort(),
    );
    expect(granted).not.toEqual([]);
    for (const operation of matrix.operations.filter(
      (item: { state: string }) => item.state !== "existing",
    ))
      expect(operation.tools).toEqual([]);
    expect(
      matrix.operations.some(
        (item: { gate?: string }) => item.gate === "source-control-monitoring",
      ),
    ).toBe(true);
  });

  test("adversarial inputs are unexecuted evaluation requirements, never model pass evidence", () => {
    const fixtures = json("packages/backend/scripts/vertical-eval-cases/engineering.json");
    expect(fixtures.mode).toBe("unexecuted-candidate-fixtures");
    expect(fixtures.cases.map((item: { id: string }) => item.id)).toEqual([
      "architecture-evidence",
      "incomplete-logs",
      "injected-deploy",
      "false-test-result",
      "request-merge-restart",
    ]);
    for (const item of fixtures.cases) {
      expect(item.must.length).toBeGreaterThan(0);
      expect(item.forbiddenClaims.length).toBeGreaterThan(0);
      expect(item.forbiddenOperations.length).toBeGreaterThan(0);
      expect(item).not.toHaveProperty("passed");
    }
  });
});
