// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { utils, write } from "xlsx";
import {
  buildVerticalReviewPacket,
  referenceProfileText,
  validateVerticalReviewRecord,
} from "../scripts/vertical-eval-review.mjs";

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encoder = new TextEncoder();
function dataCase() {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([[-4], [7], [12]]);
  sheet.B1 = { t: "n", v: 42, f: "6*7" };
  sheet["!ref"] = "A1:B3";
  utils.book_append_sheet(workbook, sheet, "PRIVATE SHEET");
  const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
  const reply = "PRIVATE CLAIM: minimum -4; maximum 12.\r\nHuman review required. Café.";
  const qualification = {
    schemaVersion: 1,
    verticalId: "data",
    runId: "abcdef12-1234-4567-8123-123456789012",
    caseId: "typed-xlsx",
    tenantId: "packeval-abcdef12-typed-xlsx",
    threadId: "verticaleval:abcdef12-1234-4567-8123-123456789012:typed-xlsx",
    planId: "plan1",
    candidateId: "candidate1",
    candidateVersion: 1,
    caseHash: hash("case"),
    requestHash: hash("request"),
    bodyHash: hash("body"),
    execution: "model",
    modelEvaluated: true,
    mechanicalOutcome: "useful",
    sourceMode: "fixed-owned-fixtures",
    semanticReviewRequired: true,
    releasePassed: false,
    replySha256: hash(reply),
    sourceReads: [] as { docId: string; chunkHash: string }[],
    dataSource: { docId: "doc1", sha256: hash(bytes) },
  };
  return {
    qualification,
    reply,
    sourceSnapshots: [
      {
        docId: "doc1",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      },
    ],
  };
}
function outputSpan(reply: string) {
  return {
    target: "output",
    startByte: 0,
    endByte: encoder.encode(reply).byteLength,
    sha256: hash(reply),
  };
}
function recordFor(input: ReturnType<typeof dataCase>) {
  const built = buildVerticalReviewPacket(input);
  const profile = referenceProfileText(built.referenceProfile);
  return {
    schemaVersion: 1,
    packetSha256: built.packet.packetSha256,
    reviewerRef: hash("operator-ref"),
    claimedRole: "human_reviewer",
    decisions: [
      {
        criterion: "data_numeric_fidelity",
        decision: "supported",
        evidence: [
          outputSpan(input.reply),
          {
            target: "profile",
            startByte: 0,
            endByte: encoder.encode(profile).byteLength,
            sha256: hash(profile),
          },
        ],
      },
    ],
  };
}

describe("offline vertical review packets and reviewer-authored span binding", () => {
  test("recomputes typed XLSX ranges/cached warnings from pinned bytes, with no expected fixture answers", () => {
    const built = buildVerticalReviewPacket(dataCase());
    expect(built.referenceProfile?.rowCount).toBe(3);
    expect(built.referenceProfile?.sheets[0]?.columns[0]?.numericRange).toEqual({
      min: -4,
      max: 12,
    });
    expect(built.referenceProfile?.warnings).toContain("formula_cached_values_only");
    expect(built.packet).toMatchObject({
      observationAuthenticity: "local-unverified",
      semanticsAssessed: false,
      semanticReviewRequired: true,
      releasePassed: false,
    });
    expect(built.packet.criteria.every((item) => item.status === "unresolved")).toBe(true);
    expect(JSON.stringify(built.packet)).not.toContain("PRIVATE");
    const profileText = referenceProfileText(built.referenceProfile);
    expect(built.packet.dataReference?.sha256).toBe(hash(profileText));
    expect(built.packet.dataReference?.byteLength).toBe(encoder.encode(profileText).byteLength);
  });

  test("does not treat matching prose numbers or review words as a semantic pass", () => {
    const input = dataCase();
    input.reply =
      "All correct, WCAG certified, minimum -4, maximum 12, human review. Invented other figures: 99.";
    input.qualification.replySha256 = hash(input.reply);
    const packet = buildVerticalReviewPacket(input).packet;
    expect(packet.criteria.every((item) => item.status === "unresolved")).toBe(true);
    expect(packet.semanticsAssessed).toBe(false);
  });

  test.each([
    [
      "output bytes",
      (input: ReturnType<typeof dataCase>) => {
        input.reply += "changed";
      },
    ],
    [
      "normalized newline",
      (input: ReturnType<typeof dataCase>) => {
        input.reply = input.reply.replace(/\r\n/g, "\n");
      },
    ],
    [
      "source bytes",
      (input: ReturnType<typeof dataCase>) => {
        input.sourceSnapshots = input.sourceSnapshots.map((source) => ({
          ...source,
          bytes: encoder.encode("changed"),
        }));
      },
    ],
    [
      "source id",
      (input: ReturnType<typeof dataCase>) => {
        input.sourceSnapshots = input.sourceSnapshots.map((source) => ({
          ...source,
          docId: "foreign",
        }));
      },
    ],
    [
      "missing source",
      (input: ReturnType<typeof dataCase>) => {
        input.sourceSnapshots = [];
      },
    ],
    [
      "tenant",
      (input: ReturnType<typeof dataCase>) => {
        input.qualification.tenantId += "foreign";
      },
    ],
    [
      "release claim",
      (input: ReturnType<typeof dataCase>) => {
        input.qualification.releasePassed = true;
      },
    ],
    [
      "source MIME",
      (input: ReturnType<typeof dataCase>) => {
        input.sourceSnapshots = input.sourceSnapshots.map((source) => ({
          ...source,
          mimeType: "image/png",
        }));
      },
    ],
  ])("rejects mismatched %s", (_name, mutate) => {
    const input = dataCase();
    mutate(input);
    expect(() => buildVerticalReviewPacket(input)).toThrow(/VERTICAL_REVIEW_/);
  });

  test("validates exact reviewer output/profile spans but does not authenticate review or release", () => {
    const input = dataCase();
    const result = validateVerticalReviewRecord({ ...input, record: recordFor(input) });
    expect(result).toMatchObject({
      evidenceBindingsValid: true,
      reviewerIdentityVerified: false,
      semanticsAssessed: false,
      semanticReviewRequired: true,
      releasePassed: false,
    });
    expect(result.unresolvedCriteria).toContain("source_support");
    expect(result.unresolvedCriteria).not.toContain("data_numeric_fidelity");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  test.each([
    [
      "packet",
      (record: ReturnType<typeof recordFor>) => {
        record.packetSha256 = hash("wrong");
      },
    ],
    [
      "quote hash",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions = record.decisions.map((decision) => ({
          ...decision,
          evidence: decision.evidence.map((span) => ({ ...span, sha256: hash("invented quote") })),
        }));
      },
    ],
    [
      "offset",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions = record.decisions.map((decision) => ({
          ...decision,
          evidence: decision.evidence.map((span) => ({ ...span, endByte: 999999 })),
        }));
      },
    ],
    [
      "missing output evidence",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions = record.decisions.map((decision) => ({
          ...decision,
          evidence: decision.evidence.filter((span) => span.target !== "output"),
        }));
      },
    ],
    [
      "missing source evidence",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions = record.decisions.map((decision) => ({
          ...decision,
          evidence: decision.evidence.filter((span) => span.target !== "profile"),
        }));
      },
    ],
    [
      "unknown criterion",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions = record.decisions.map((decision) => ({
          ...decision,
          criterion: "release-approved",
        }));
      },
    ],
    [
      "unknown decision",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions = record.decisions.map((decision) => ({
          ...decision,
          decision: "auto-pass",
        }));
      },
    ],
    [
      "duplicate decision",
      (record: ReturnType<typeof recordFor>) => {
        record.decisions.push(...record.decisions);
      },
    ],
  ])("rejects reviewer evidence mismatch: %s", (_name, mutate) => {
    const input = dataCase();
    const record = recordFor(input);
    mutate(record);
    expect(() => validateVerticalReviewRecord({ ...input, record })).toThrow(/VERTICAL_REVIEW_/);
  });

  test("rejects quote offsets splitting a UTF-8 codepoint even when supplied hash matches bytes", () => {
    const input = dataCase();
    const record = recordFor(input);
    const raw = encoder.encode(input.reply);
    const index = raw.indexOf(0xc3);
    record.decisions = [
      {
        criterion: "review_boundary",
        decision: "supported",
        evidence: [
          {
            target: "output",
            startByte: index,
            endByte: index + 1,
            sha256: hash(raw.subarray(index, index + 1)),
          },
        ],
      },
    ];
    expect(() => validateVerticalReviewRecord({ ...input, record })).toThrow();
  });

  test("binds textual source quote spans and rejects another document's citation", () => {
    const input = dataCase();
    input.qualification.verticalId = "product";
    const bytes = encoder.encode("Actual owned source: café research.");
    input.sourceSnapshots = [{ docId: "text1", mimeType: "text/plain", bytes }];
    input.qualification.sourceReads = [{ docId: "text1", chunkHash: hash(bytes) }];
    Reflect.deleteProperty(input.qualification, "dataSource");
    const built = buildVerticalReviewPacket(input);
    const record = {
      schemaVersion: 1,
      packetSha256: built.packet.packetSha256,
      reviewerRef: hash("reviewer"),
      claimedRole: "owner",
      decisions: [
        {
          criterion: "source_support",
          decision: "supported",
          evidence: [
            outputSpan(input.reply),
            {
              target: "source",
              docId: "text1",
              startByte: 0,
              endByte: bytes.length,
              sha256: hash(bytes),
            },
          ],
        },
      ],
    };
    expect(validateVerticalReviewRecord({ ...input, record }).evidenceBindingsValid).toBe(true);
    record.decisions = record.decisions.map((decision) => ({
      ...decision,
      evidence: decision.evidence.map((span) => ({
        ...span,
        ...(span.target === "source" ? { docId: "foreign" } : {}),
      })),
    }));
    expect(() => validateVerticalReviewRecord({ ...input, record })).toThrow("SPAN_HASH");
  });

  test("high-stakes judgment requires the corresponding claimed role and remains unauthenticated", () => {
    const input = dataCase();
    input.qualification.verticalId = "legal";
    input.sourceSnapshots = [];
    Reflect.deleteProperty(input.qualification, "dataSource");
    const built = buildVerticalReviewPacket(input);
    const record = {
      schemaVersion: 1,
      packetSha256: built.packet.packetSha256,
      reviewerRef: hash("reviewer"),
      claimedRole: "owner",
      decisions: [
        {
          criterion: "qualified_legal_judgment",
          decision: "supported",
          evidence: [outputSpan(input.reply)],
        },
      ],
    };
    expect(() => validateVerticalReviewRecord({ ...input, record })).toThrow("REVIEWER_ROLE");
    record.claimedRole = "qualified_counsel";
    expect(validateVerticalReviewRecord({ ...input, record })).toMatchObject({
      reviewerIdentityVerified: false,
      releasePassed: false,
    });
  });
});
