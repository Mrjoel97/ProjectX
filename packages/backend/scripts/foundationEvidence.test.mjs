import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertFoundationExport, assertFoundationReview } from "./foundationEvidence.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const clone = (x) => structuredClone(x);
function fixture() {
  const sections = ["essentials", "offers", "operations", "delivery", "goals", "constraints"];
  const ids = sections.map((_, i) => `synthetic_doc_${i}`),
    tenantId = "synthetic_tenant";
  const interview = {
    revision: 2,
    profile: { name: "Synthetic studio" },
    slots: {
      headcount: 1,
      paidStaff: 0,
      revenueStage: "pre-revenue",
      funding: "bootstrapped",
      yearsOperating: 0,
      oneLineDescription: "Synthetic templates",
    },
    answers: sections.map((section) => ({
      section,
      text: "Synthetic statement",
      eventId: `source_${section}`,
      intent: section === "goals" ? "planned" : "current",
    })),
  };
  const documents = interview.answers.map((a) => ({
    section: a.section,
    title: a.section,
    kind: a.section === "essentials" ? "business_profile" : `business_foundation_${a.section}`,
    text: `### ${a.intent === "planned" ? "Intended future practice" : "User-stated information"} [source: ${a.eventId}]\n${a.text}`,
  }));
  const review = {
    revision: 2,
    documents,
    blueprint: "Synthetic blueprint",
    previousBlueprint: "",
  };
  review.reviewHash = hash(
    JSON.stringify({
      documents,
      blueprint: review.blueprint,
      previousBlueprint: review.previousBlueprint,
    }),
  );
  const data = {
    foundationInterviews: [
      {
        ...clone(interview),
        tenantId,
        state: "published",
        phase: "enrichment",
        publishedRevision: 2,
        docIds: ids,
      },
    ],
    foundationRevisions: [
      { ...clone(interview), tenantId, docIds: ids, documents: clone(documents) },
    ],
    tenantProfiles: [{ blueprintSourceDocIds: ids, blueprintDocId: "synthetic_blueprint" }],
    vaultDocuments: [
      ...documents.map((d, i) => ({ ...d, _id: ids[i], tenantId, contentHash: hash(d.text) })),
      {
        _id: "synthetic_blueprint",
        tenantId,
        kind: "business_blueprint",
        text: review.blueprint,
        contentHash: hash(review.blueprint),
      },
    ],
  };
  return { data, snapshots: [{ review, interview }], tenantId, docIds: ids };
}
test("exact approved content, provenance and Blueprint references pass without requiring live calls", () => {
  const f = fixture();
  assertFoundationReview(f.snapshots[0].review, f.snapshots[0].interview);
  assertFoundationExport(f);
});
for (const [name, alter] of [
  ["changed document text", (f) => (f.data.vaultDocuments[0].text += " changed")],
  [
    "forged revision provenance",
    (f) => (f.data.foundationRevisions[0].answers[0].eventId = "forged"),
  ],
  ["stale published revision", (f) => (f.data.foundationInterviews[0].publishedRevision = 1)],
  ["missing Blueprint references", (f) => (f.data.tenantProfiles[0].blueprintSourceDocIds = [])],
  ["embedded Blueprint", (f) => (f.data.vaultDocuments.at(-1).ragEntryId = "unexpected")],
  [
    "duplicate stored revision",
    (f) => f.data.foundationRevisions.push(clone(f.data.foundationRevisions[0])),
  ],
  ["foreign document", (f) => (f.data.vaultDocuments[0].tenantId = "other_synthetic_tenant")],
  ["changed reviewed hash", (f) => (f.snapshots[0].review.reviewHash = "0".repeat(64))],
  ["duplicate expected approval", (f) => f.snapshots.push(clone(f.snapshots[0]))],
  ["changed stored hash", (f) => (f.data.vaultDocuments[0].contentHash = "0".repeat(64))],
  ["missing interview", (f) => (f.data.foundationInterviews = [])],
  ["reordered document references", (f) => f.docIds.reverse()],
])
  test(`refuses ${name}`, () => {
    const f = fixture();
    alter(f);
    assert.throws(() => assertFoundationExport(f));
  });
test("Convex object-key normalization does not change the reconstructed approval hash", () => {
  const f = fixture(),
    r = f.snapshots[0].review;
  r.documents = r.documents.map((d) =>
    Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b))),
  );
  assertFoundationReview(r, f.snapshots[0].interview);
  assertFoundationExport(f);
});
