// Pure qualification assertions: no network, credentials, deployment targeting or writes.
// Callers must supply independently retained, explicitly approved review snapshots.
// Passing these checks does not prove native auth, microphone behavior, physical deletion,
// matched retrieval chunks, provider billing reconciliation or seven-day expiry.
import { createHash } from "node:crypto";

const FOUNDATION_SECTIONS = [
  "essentials",
  "offers",
  "operations",
  "delivery",
  "goals",
  "constraints",
];
const assert = (ok, code) => {
  if (!ok) throw new Error(code);
};
const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const same = (a, b) => canonical(a) === canonical(b);
export function assertFoundationReview(review, interview) {
  assert(review && interview && review.revision === interview.revision, "REVIEW_REVISION_MISMATCH");
  const documents = review.documents.map((d) => ({
    section: d.section,
    title: d.title,
    kind: d.kind,
    text: d.text,
  }));
  assert(
    documents.length === 6 &&
      same(
        documents.map((d) => d.section),
        FOUNDATION_SECTIONS,
      ),
    "REVIEW_SECTION_ORDER",
  );
  assert(
    digest(
      JSON.stringify({
        documents,
        blueprint: review.blueprint,
        previousBlueprint: review.previousBlueprint,
      }),
    ) === review.reviewHash,
    "REVIEW_HASH_MISMATCH",
  );
  assert(
    [
      "headcount",
      "paidStaff",
      "revenueStage",
      "funding",
      "yearsOperating",
      "oneLineDescription",
    ].every((k) => interview.slots[k] !== undefined),
    "ESSENTIAL_FACTS_MISSING",
  );
  assert(
    interview.answers.length > 0 &&
      new Set(interview.answers.map((a) => a.eventId)).size === interview.answers.length,
    "ANSWER_PROVENANCE_DUPLICATE",
  );
  for (const answer of interview.answers) {
    const doc = documents.find((d) => d.section === answer.section);
    const source =
      "[source: " +
      answer.eventId +
      (answer.sourceDocId ? `; document: ${answer.sourceDocId}` : "") +
      "]";
    const label =
      answer.intent === "planned" ? "Intended future practice" : "User-stated information";
    assert(
      doc?.text.includes(`### ${label} ${source}\n${answer.text}`),
      "REVIEW_PROVENANCE_MISMATCH",
    );
  }
}
export function assertFoundationExport({ data, snapshots, tenantId, docIds: ids }) {
  assert(Array.isArray(snapshots) && snapshots.length > 0, "APPROVAL_SNAPSHOTS_REQUIRED");
  const approvedSnapshots = new Map(snapshots.map((s) => [s.review.revision, s]));
  assert(approvedSnapshots.size === snapshots.length, "DUPLICATE_APPROVAL_REVISION");
  const snapshot = snapshots.at(-1);
  const accountId = tenantId;
  assert(typeof accountId === "string" && accountId.length > 0, "TENANT_REQUIRED");
  assert(
    Array.isArray(ids) && ids.length === 6 && new Set(ids).size === 6,
    "SIX_DOCUMENT_IDS_REQUIRED",
  );
  for (const s of snapshots) assertFoundationReview(s.review, s.interview);
  const { review, interview } = snapshot;
  const interviews = data.foundationInterviews ?? [];
  assert(interviews.length === 1, "INTERVIEW_EXPORT_COUNT");
  const current = interviews[0];
  assert(
    current.tenantId === accountId &&
      current.state === "published" &&
      current.phase === "enrichment" &&
      current.revision === review.revision &&
      current.publishedRevision === review.revision,
    "INTERVIEW_PUBLICATION_MISMATCH",
  );
  assert(
    same(current.docIds, ids) &&
      same(current.profile, interview.profile) &&
      same(current.slots, interview.slots) &&
      same(current.answers, interview.answers),
    "INTERVIEW_CONTENT_MISMATCH",
  );
  const revisions = data.foundationRevisions ?? [];
  assert(revisions.length === approvedSnapshots.size, "REVISION_EXPORT_COUNT");
  for (const [version, expected] of approvedSnapshots) {
    const matches = revisions.filter((r) => r.revision === version);
    assert(matches.length === 1, "REVISION_DUPLICATE_OR_MISSING");
    const r = matches[0];
    assert(
      r.tenantId === accountId &&
        same(r.docIds, ids) &&
        same(r.documents, expected.review.documents) &&
        same(r.profile, expected.interview.profile) &&
        same(r.slots, expected.interview.slots) &&
        same(r.answers, expected.interview.answers),
      "REVISION_CONTENT_MISMATCH",
    );
  }
  const docs = data.vaultDocuments ?? [];
  assert(docs.length === 7, "UNEXPECTED_VAULT_DOCUMENT_COUNT");
  for (const [i, id] of ids.entries()) {
    const found = docs.filter((d) => d._id === id);
    assert(found.length === 1, "FOUNDATION_DOC_MISSING");
    const d = found[0],
      expected = review.documents[i];
    assert(
      d.tenantId === accountId &&
        d.kind === expected.kind &&
        d.text === expected.text &&
        d.contentHash === digest(expected.text),
      "PUBLISHED_CONTENT_HASH_MISMATCH",
    );
    // Business-profile title follows the existing profile writer; its body is exact reviewed text.
    if (i > 0) assert(d.title === expected.title, "FOUNDATION_TITLE_MISMATCH");
  }
  const tp = data.tenantProfiles ?? [];
  assert(
    tp.length === 1 && same(tp[0].blueprintSourceDocIds, ids),
    "EXPORTED_BLUEPRINT_REFS_MISMATCH",
  );
  const bp = docs.find((d) => d._id === tp[0].blueprintDocId);
  assert(
    bp?.kind === "business_blueprint" &&
      bp.tenantId === accountId &&
      bp.text === review.blueprint &&
      bp.contentHash === digest(review.blueprint) &&
      !bp.ragEntryId,
    "BLUEPRINT_REVIEW_MISMATCH",
  );
}
