// @vitest-environment node
// Candidate artifact integrity only; native model outcomes are explicitly unrun.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolsForVerticalWorkflow, VERTICAL_PACKS, verticalSkillName } from "@pikar/core";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const id = "hr" as const;
const dir = `packages/contracts/packs/vertical/${id}`;
const read = (path: string) => readFileSync(resolve(root, path));
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(read(`${dir}/manifest.json`).toString()) as {
  packId: string;
  workflowId: string;
  skillName: string;
  status: string;
  runtimeEnabled: boolean;
  requiredReview: string;
  requiredInputs: string[];
  missingOutcomes: string[];
  outputRestrictions: string[];
  outputFlags: { assistive: boolean; review_required: boolean; reviewer: string };
  provenance: {
    sourceCommit: string;
    sourceRepo: string;
    sourcePaths: string[];
    bodySha256: string;
    skillVersions: Record<string, number>;
  };
  sourceFiles: { path: string; sha256: string; gitBlobSha: string; bytes: number }[];
  licenseEvidence: { governingPath: string; governingSha256: string };
  evidence: { methodReview: string; nativeEval: null; browserUat: null; activation: null };
};
const fixtures = JSON.parse(
  read(`packages/backend/scripts/vertical-eval-cases/${id}.json`).toString(),
) as {
  executionStatus: string;
  cases: {
    id: string;
    category: string;
    expected: {
      state: string;
      assistive: boolean;
      review_required: boolean;
      reviewer: string;
      forbiddenTools: string[];
      requiredSourceRefs?: string[];
    };
  }[];
};

describe(`${id} assistive candidate artifacts`, () => {
  test("all raw sources match official pinned blobs, SHA256 and license evidence", () => {
    expect(manifest.provenance.sourceRepo).toBe(
      "https://github.com/anthropics/knowledge-work-plugins",
    );
    expect(manifest.provenance.sourceCommit).toBe("5267cf7bff3031921d4474b8e8f86ad02d2b8f6d");
    expect(manifest.sourceFiles.map((f) => f.path)).toEqual(manifest.provenance.sourcePaths);
    expect(manifest.sourceFiles.length).toBe(3);
    for (const file of manifest.sourceFiles) {
      const bytes = read(`third_party/knowledge-work-plugins/source-snapshot/${file.path}`);
      expect(bytes.length).toBe(file.bytes);
      expect(hash(bytes)).toBe(file.sha256);
      expect(
        createHash("sha1")
          .update(Buffer.from(`blob ${bytes.length}\0`))
          .update(bytes)
          .digest("hex"),
      ).toBe(file.gitBlobSha);
    }
    expect(
      hash(
        read(
          `third_party/knowledge-work-plugins/source-snapshot/${manifest.licenseEvidence.governingPath}`,
        ),
      ),
    ).toBe(manifest.licenseEvidence.governingSha256);
    expect(hash(read(`${dir}/skill.md`).toString().replace(/\r\n/g, "\n"))).toBe(
      manifest.provenance.bodySha256,
    );
  });

  test("qualified review and native tools do not imply release or external authority", () => {
    expect(manifest.packId).toBe(id);
    expect(manifest.workflowId).toBe(VERTICAL_PACKS[id].workflowId);
    expect(manifest.skillName).toBe(verticalSkillName(id));
    expect(manifest.requiredReview).toBe(VERTICAL_PACKS[id].requiredReview);
    expect(manifest.status).toBe("candidate");
    expect(manifest.runtimeEnabled).toBe(false);
    expect(manifest.evidence).toEqual({
      methodReview: "draft",
      nativeEval: null,
      browserUat: null,
      activation: null,
    });
    expect(manifest.outputFlags).toEqual({
      assistive: true,
      review_required: true,
      reviewer: "qualified_hr",
    });
    const matrix = JSON.parse(read(`${dir}/operation-matrix.json`).toString()) as {
      operations: { state: string; tools: string[] }[];
      blockedDomainOperations: string[];
    };
    const granted = matrix.operations
      .filter((op) => op.state === "existing")
      .flatMap((op) => op.tools)
      .sort();
    expect(granted).toEqual([...toolsForVerticalWorkflow(VERTICAL_PACKS[id].workflowId)].sort());
    expect(granted).toEqual(["saveAsDocument", "searchVault"]);
    for (const denied of matrix.blockedDomainOperations) expect(granted).not.toContain(denied);
    expect(manifest.requiredInputs).toEqual(["explicit-role-criteria"]);
    expect(manifest.missingOutcomes).toEqual([
      "missing_role_criteria",
      "unsupported",
      "insufficient_evidence",
    ]);
    expect(manifest.outputRestrictions).toEqual(
      expect.arrayContaining([
        "protected-trait-inference",
        "proxy-inference",
        "applicant-ranking",
        "individual-scoring",
        "hire-fire-promotion-pay-recommendation",
      ]),
    );
  });

  test("unrun adversarial fixtures retain review flags and do not grant forbidden tools", () => {
    expect(fixtures.executionStatus).toBe("not-run");
    expect(fixtures.cases.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "positive",
        "partial",
        "protected-attribute",
        "proxy",
        "ranking",
        "decision",
        "injection",
        "external-action",
      ]),
    );
    expect(new Set(fixtures.cases.map((item) => item.id)).size).toBe(fixtures.cases.length);
    const granted = toolsForVerticalWorkflow(VERTICAL_PACKS[id].workflowId);
    for (const item of fixtures.cases) {
      expect(["artifact", "partial", "refused"]).toContain(item.expected.state);
      expect(item.expected.assistive).toBe(true);
      expect(item.expected.review_required).toBe(true);
      expect(item.expected.reviewer).toBe("qualified_hr");
      for (const denied of item.expected.forbiddenTools) expect(granted).not.toContain(denied);
      if (item.category === "positive")
        expect(item.expected.requiredSourceRefs?.length).toBeGreaterThan(0);
    }
  });
});
