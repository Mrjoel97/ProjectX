import { expect, test } from "vitest";
import {
  assessServiceKnowledge,
  SERVICE_KNOWLEDGE_KEYS,
  type ServiceKnowledgeCandidate,
  serviceKnowledgeFromProfile,
} from "./serviceKnowledge";

const nowMs = 1000;
const hash = "a".repeat(64);
function candidate(
  key: ServiceKnowledgeCandidate["key"],
  value = `${key} confirmed answer`,
  overrides: Partial<ServiceKnowledgeCandidate> = {},
): ServiceKnowledgeCandidate {
  return {
    key,
    value,
    sourceRef: `foundation-event-${key}`,
    sourceHash: hash,
    confirmedAt: 100,
    sourceState: "current",
    ...overrides,
  };
}
const assess = (candidates: readonly ServiceKnowledgeCandidate[]) =>
  assessServiceKnowledge({ operationIds: ["social.prepare"], candidates, nowMs });
const complete = () => SERVICE_KNOWLEDGE_KEYS.map((key) => candidate(key));

test("social preparation asks one bounded question in stable order, without asking the saved goal again", () => {
  const result = assess([]);
  expect(result.ready).toBe(false);
  expect(result.gaps.map((row) => row.key)).toEqual(SERVICE_KNOWLEDGE_KEYS);
  expect(result.nextQuestion).toEqual({
    key: "offering",
    reason: "missing",
    question: "What product or service should your social content focus on?",
    why: "Pikar needs a confirmed offer to prepare relevant content.",
  });
  expect(assess([candidate("offering")]).nextQuestion?.key).toBe("targetCustomer");
  expect(assess(complete())).toMatchObject({ ready: true, gaps: [], nextQuestion: null });
});

test("reporting-only work needs account evidence, not content questions or fabricated knowledge", () => {
  expect(
    assessServiceKnowledge({ operationIds: ["social.report"], candidates: [], nowMs }),
  ).toEqual({
    ready: true,
    gaps: [],
    nextQuestion: null,
    knowledge: [],
  });
  expect(
    assessServiceKnowledge({
      operationIds: ["social.report", "social.prepare"],
      candidates: [],
      nowMs,
    }).ready,
  ).toBe(false);
});

test("confirmed profile offer/audience are reused with exact provenance, without inferring voice or boundaries", () => {
  const provenance = {
    sourceRef: "foundation-published-profile",
    sourceHash: hash,
    confirmedAt: 10,
    sourceState: "current" as const,
  };
  const fromProfile = serviceKnowledgeFromProfile(
    { offering: "  Coffee subscriptions  ", targetCustomer: "Local offices" },
    provenance,
  );
  const result = assess(fromProfile);
  expect(result.nextQuestion?.key).toBe("brandVoice");
  expect(result.knowledge).toEqual([
    { key: "offering", value: "Coffee subscriptions", ...provenance },
    { key: "targetCustomer", value: "Local offices", ...provenance },
  ]);
  expect(serviceKnowledgeFromProfile({ offering: "", targetCustomer: "  " }, provenance)).toEqual(
    [],
  );
});

test("unconfirmed extraction or missing exact source hash cannot become operational knowledge", () => {
  for (const overrides of [
    { confirmedAt: null },
    { sourceHash: null },
    { sourceState: "unverified" as const },
  ]) {
    const rows = complete().map((row) => (row.key === "offering" ? { ...row, ...overrides } : row));
    const result = assess(rows);
    expect(result.ready).toBe(false);
    expect(result.gaps).toMatchObject([{ key: "offering", reason: "unconfirmed" }]);
    expect(result.knowledge.some((row) => row.key === "offering")).toBe(false);
  }
});

test("changed or withdrawn exact sources reopen the question without treating retrieval time as confirmation", () => {
  for (const sourceState of ["changed", "withdrawn"] as const) {
    const result = assess(
      complete().map((row) => (row.key === "brandVoice" ? { ...row, sourceState } : row)),
    );
    expect(result.nextQuestion).toMatchObject({ key: "brandVoice", reason: sourceState });
    expect(result.knowledge.some((row) => row.key === "brandVoice")).toBe(false);
  }
  const prior = candidate("offering");
  expect(assess([...complete(), { ...prior, sourceState: "withdrawn" }]).ready).toBe(false);
  expect(assess([candidate("offering", "", { sourceState: "withdrawn" })]).gaps[0]).toMatchObject({
    key: "offering",
    reason: "withdrawn",
  });
});

test("conflicting confirmed sources stay explicit; only a newer confirmed replacement supersedes them", () => {
  const prior = candidate("brandVoice", "Formal", { sourceRef: "document-old" });
  const newer = candidate("brandVoice", "Warm and concise", {
    sourceRef: "foundation-event-new",
    confirmedAt: 200,
  });
  const other = complete().filter((row) => row.key !== "brandVoice");
  const conflicted = assess([...other, prior, newer]);
  expect(conflicted.ready).toBe(false);
  expect(conflicted.nextQuestion).toMatchObject({ key: "brandVoice", reason: "conflict" });
  expect(conflicted.nextQuestion?.question).toContain("Your saved information disagrees.");
  expect(assess([...other, prior, { ...newer, supersedes: [prior.sourceRef] }])).toMatchObject({
    ready: true,
    gaps: [],
  });
  for (const replacement of [
    { ...newer, confirmedAt: 100 },
    { ...newer, confirmedAt: 99 },
    { ...newer, confirmedAt: null },
    { ...newer, sourceState: "withdrawn" as const },
  ]) {
    const result = assess([...other, prior, { ...replacement, supersedes: [prior.sourceRef] }]);
    // An unconfirmed answer cannot supersede. A previously confirmed replacement still
    // suppresses the old fact after withdrawal, reopening the gap instead of resurrecting it.
    if (replacement.confirmedAt === null)
      expect(result.knowledge.filter((row) => row.key === "brandVoice")).toEqual([prior]);
    else {
      expect(result.ready).toBe(false);
      if (replacement.sourceState === "withdrawn")
        expect(result.gaps).toMatchObject([{ key: "brandVoice", reason: "withdrawn" }]);
    }
  }
});

test("corroborating sources preserve lineage with deterministic ordering and no candidate mutation", () => {
  const rows = [
    ...complete(),
    candidate("offering", "offering   confirmed answer", { sourceRef: "doc-other" }),
  ];
  const original = JSON.stringify(rows);
  const result = assess(rows);
  expect(result.ready).toBe(true);
  expect(result).toEqual(assess([...rows].reverse()));
  expect(result.knowledge.filter((row) => row.key === "offering")).toHaveLength(2);
  expect(JSON.stringify(rows)).toBe(original);
});

test("input bounds and future/malformed provenance refuse without leaking content into errors", () => {
  for (const overrides of [
    { sourceHash: "bad" },
    { sourceRef: "https://untrusted.example/raw" },
    { confirmedAt: nowMs + 1 },
    { value: "x".repeat(4001) },
    { supersedes: ["foundation-event-offering"] },
  ])
    expect(() => assess([candidate("offering", "PRIVATE BUSINESS CONTENT", overrides)])).toThrow(
      "SERVICE_KNOWLEDGE_INPUT_INVALID",
    );
  expect(() => assess(Array.from({ length: 65 }, () => candidate("offering")))).toThrow(
    "SERVICE_KNOWLEDGE_INPUT_INVALID",
  );
});

test("elapsed clock time alone does not expire confirmed business facts", () => {
  expect(
    assessServiceKnowledge({
      operationIds: ["social.prepare"],
      candidates: complete(),
      nowMs: Date.parse("2036-10-24T10:00:00Z"),
    }).ready,
  ).toBe(true);
});
