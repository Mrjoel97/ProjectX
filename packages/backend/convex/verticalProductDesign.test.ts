// @vitest-environment node
// Artifact integrity tests only. Native model outcomes and responsive UAT remain unrun.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolsForVerticalWorkflow, VERTICAL_PACKS, verticalSkillName } from "@pikar/core";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const hash = (text: string | Buffer, algorithm = "sha256") =>
  createHash(algorithm).update(text).digest("hex");
type Candidate = {
  schemaVersion: number;
  packId: "product" | "design";
  workflowId: "product-prd-brief" | "design-artifact-critique";
  skillName: string;
  version: number;
  status: string;
  runtimeEnabled: boolean;
  outputContractId: string;
  disclaimerId: string;
  requiredReview: string;
  requiredSources: string[];
  provenance: {
    sourceRepo: string;
    sourceCommit: string;
    sourcePaths: string[];
    bodySha256: string;
    skillVersions: Record<string, number>;
  };
  sourceFiles: { path: string; bytes: number; sha256: string; gitBlobSha: string }[];
  evidence: { methodReview: string; nativeEval: null; browserUat: null; activation: null };
  releaseBlockedBy: string[];
  licenseEvidence: { governingPath: string; governingSha256: string; redistributedCopy: string };
};
type Fixture = {
  executionStatus: string;
  candidateVersion: number;
  cases: {
    id: string;
    category: string;
    expected: { state: string; forbiddenTools?: string[]; retainAuthority?: string[] };
  }[];
};

for (const id of ["product", "design"] as const) {
  describe(`${id} candidate artifacts`, () => {
    const directory = `packages/contracts/packs/vertical/${id}`;
    const manifest = JSON.parse(read(`${directory}/manifest.json`)) as Candidate;
    const body = read(`${directory}/skill.md`);
    const matrix = JSON.parse(read(`${directory}/operation-matrix.json`)) as {
      runtimeEnabled: boolean;
      workflowId: string;
      operations: { id: string; state: string; tools: string[] }[];
    };
    const fixtures = JSON.parse(
      read(`packages/backend/scripts/vertical-eval-cases/${id}.json`),
    ) as Fixture;

    test("source bytes match the pinned official commit's Git blobs and SHA256", () => {
      expect(manifest.provenance.sourceRepo).toBe(
        "https://github.com/anthropics/knowledge-work-plugins",
      );
      expect(manifest.provenance.sourceCommit).toBe("5267cf7bff3031921d4474b8e8f86ad02d2b8f6d");
      expect(manifest.sourceFiles).toHaveLength(2);
      expect(manifest.sourceFiles.map((file) => file.path)).toEqual(
        manifest.provenance.sourcePaths,
      );
      for (const file of manifest.sourceFiles) {
        const bytes = Buffer.from(
          read(`third_party/knowledge-work-plugins/source-snapshot/${file.path}`),
        );
        expect(bytes.length).toBe(file.bytes);
        expect(hash(bytes)).toBe(file.sha256);
        expect(hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1")).toBe(
          file.gitBlobSha,
        );
      }
      expect(
        hash(
          read(
            `third_party/knowledge-work-plugins/source-snapshot/${manifest.licenseEvidence.governingPath}`,
          ),
        ),
      ).toBe(manifest.licenseEvidence.governingSha256);
      expect(read(manifest.licenseEvidence.redistributedCopy)).toContain("Apache License");
      expect(hash(body)).toBe(manifest.provenance.bodySha256);
    });

    test("version and authority match native policy while all release evidence is absent", () => {
      const policy = VERTICAL_PACKS[id];
      expect(manifest.packId).toBe(id);
      expect(manifest.workflowId).toBe(policy.workflowId);
      expect(manifest.skillName).toBe(verticalSkillName(id));
      expect(manifest.provenance.skillVersions).toEqual({ [manifest.skillName]: manifest.version });
      expect(manifest.outputContractId).toBe(policy.outputContractId);
      expect(manifest.disclaimerId).toBe(policy.disclaimerId);
      expect(manifest.requiredSources).toEqual(policy.requiredSources);
      expect(manifest.requiredReview).toBe(policy.requiredReview);
      expect(manifest.status).toBe("candidate");
      expect(manifest.runtimeEnabled).toBe(false);
      expect(manifest.evidence).toEqual({
        methodReview: "draft",
        nativeEval: null,
        browserUat: null,
        activation: null,
      });
      expect(manifest.releaseBlockedBy).toEqual(
        expect.arrayContaining([
          "independent-method-review",
          "exact-version-native-eval",
          "authenticated-responsive-uat",
          "runtime-binding",
        ]),
      );
      expect(matrix.runtimeEnabled).toBe(false);
      expect(matrix.workflowId).toBe(policy.workflowId);
      const granted = matrix.operations
        .filter((op) => op.state === "existing")
        .flatMap((op) => op.tools)
        .sort();
      expect(granted).toEqual([...toolsForVerticalWorkflow(policy.workflowId)].sort());
      expect(granted).toEqual(["saveAsDocument", "searchVault"]);
      for (const operation of matrix.operations) {
        expect(["existing", "missing", "forbidden"]).toContain(operation.state);
        if (operation.state !== "existing") expect(operation.tools).toEqual([]);
      }
    });

    test("adversarial corpus stays unrun and cannot add denied connector tools", () => {
      expect(fixtures.executionStatus).toBe("not-run");
      expect(fixtures.candidateVersion).toBe(manifest.version);
      expect(fixtures.cases.length).toBeGreaterThanOrEqual(5);
      expect(new Set(fixtures.cases.map((item) => item.id)).size).toBe(fixtures.cases.length);
      expect(fixtures.cases.map((item) => item.category)).toEqual(
        expect.arrayContaining(["positive", "partial", "unsupported-claim", "injection"]),
      );
      const grant = toolsForVerticalWorkflow(manifest.workflowId);
      for (const fixture of fixtures.cases) {
        expect(["artifact", "partial"]).toContain(fixture.expected.state);
        for (const denied of fixture.expected.forbiddenTools ?? [])
          expect(grant).not.toContain(denied);
        if (fixture.expected.retainAuthority)
          expect([...fixture.expected.retainAuthority].sort()).toEqual([...grant].sort());
      }
      expect(body).toContain("sourceRefs");
      expect(body).toContain("artifactRef");
      expect(body).toContain("partial");
      expect(read(`${directory}/method-review.md`)).toContain("independent method review");
    });
  });
}
