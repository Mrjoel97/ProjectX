// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { main, prepareVerticalReview } from "../scripts/prepare-vertical-review.mjs";
import { compileSources, sourceManifest } from "../scripts/vertical-eval-sources.mjs";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("test fixture unexpectedly empty");
  return value;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sample() {
  const fixture = {
    id: "owned-text",
    input: {
      request: "Review this evidence.",
      sources: [
        { ref: "fixture:product:notes", kind: "vault-text", content: "Actual source facts." },
      ],
    },
    expected: { state: "artifact" },
  };
  const sourceFacts = sourceManifest(compileSources("product", fixture));
  const pin = {
    runId: "abcdef12-1234-4567-8123-123456789012",
    caseId: "product-owned-text",
    verticalId: "product",
    candidateVersion: 1,
    bodyHash: sha("body"),
    requestHash: sha("request"),
    caseHash: sha(JSON.stringify(fixture)),
  };
  const reply = "Actual model output.";
  const observation = {
    ...pin,
    schemaVersion: 1,
    sourceMode: "fixed-owned-fixtures",
    execution: "model",
    mechanicalOutcome: "useful",
    modelEvaluated: true,
    semanticReviewRequired: true,
    releasePassed: false,
    candidateId: "candidate1",
    planId: "plan1",
    tenantId: `packeval-${pin.runId.slice(0, 8)}-${pin.caseId}`,
    threadId: `verticaleval:${pin.runId}:${pin.caseId}`,
    replySha256: sha(reply),
    sourceReads: [{ docId: "ownedDoc1", chunkHash: sourceFacts[0].sha256 }],
  };
  const report = {
    runId: pin.runId,
    sourceMode: "fixed-owned-fixtures",
    semanticReviewRequired: true,
    releaseEvidenceRecorded: false,
    activated: false,
    manifest: [{ pin, sourceManifest: sourceFacts }],
    observations: [
      { caseId: pin.caseId, caseHash: pin.caseHash, sourceManifest: sourceFacts, observation },
    ],
    outputArchives: [{ caseId: pin.caseId, outputRef: "unused", sha256: sha(reply) }],
  };
  return { fixture, report, reply, caseId: pin.caseId };
}

describe("offline vertical review preparation boundary", () => {
  test("supplies actual matching source bytes, never fixture expectations", () => {
    const input = sample();
    const prepared = prepareVerticalReview(input);
    expect(prepared.sourceSnapshots).toHaveLength(1);
    expect(Buffer.from(first(prepared.sourceSnapshots).bytes).toString()).toBe(
      "Actual source facts.",
    );
    expect(prepared.packet.releasePassed).toBe(false);
  });

  test.each([
    "output",
    "fixture",
    "manifest",
    "candidate",
    "duplicate",
    "source",
  ])("rejects %s drift before constructing a review packet", (kind) => {
    const input = sample();
    if (kind === "output") input.reply += " changed";
    if (kind === "fixture") input.fixture.expected.state = "partial";
    if (kind === "manifest") first(input.report.manifest).sourceManifest[0].byteLength += 1;
    if (kind === "candidate") first(input.report.observations).observation.candidateVersion += 1;
    if (kind === "duplicate") input.report.observations.push(first(input.report.observations));
    if (kind === "source")
      first(first(input.report.observations).observation.sourceReads).chunkHash = sha("foreign");
    expect(() => prepareVerticalReview(input)).toThrow();
  });

  function diskFixture() {
    const input = sample();
    const root = mkdtempSync(join(tmpdir(), "pikar-review-cli-"));
    roots.push(root);
    const output = join(root, ".tmp", `vertical-eval-${input.report.runId}`, `${input.caseId}.md`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, input.reply);
    first(input.report.outputArchives).outputRef = output;
    const fixturePath = join(root, "packages/backend/scripts/vertical-eval-cases/product.json");
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, JSON.stringify({ cases: [input.fixture] }));
    const reportPath = join(root, ".tmp", "report.json");
    writeFileSync(reportPath, JSON.stringify(input.report));
    return { ...input, root, output, reportPath };
  }

  test("archives exact content and refuses overwriting an existing review", () => {
    const input = diskFixture();
    const args = ["--report", input.reportPath, "--case", input.caseId];
    const result = main(args, input.root);
    expect(readFileSync(join(result.directory, "output.md"), "utf8")).toBe(input.reply);
    expect(readFileSync(join(result.directory, "ownedDoc1.source"), "utf8")).toBe(
      "Actual source facts.",
    );
    expect(
      JSON.parse(readFileSync(join(result.directory, "packet.json"), "utf8")).releasePassed,
    ).toBe(false);
    expect(() => main(args, input.root)).toThrow();
  });

  test("does not follow arbitrary archive paths supplied by a report", () => {
    const input = diskFixture();
    first(input.report.outputArchives).outputRef = join(input.root, "outside.md");
    writeFileSync(input.reportPath, JSON.stringify(input.report));
    expect(() =>
      main(["--report", input.reportPath, "--case", input.caseId], input.root),
    ).toThrow();
  });
});
