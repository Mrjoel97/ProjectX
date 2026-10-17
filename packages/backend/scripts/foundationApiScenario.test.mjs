import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import { runFoundationApiScenario } from "./foundationApiScenario.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const clone = structuredClone;
function backend({ retainFacts = false } = {}) {
  let draft = null,
    published = null;
  const calls = [];
  let snapshot;
  let docs = [];
  const profile = {
    name: "Cedar Lantern Test Studio",
    oneLineDescription: "Fictional templates",
    stage: "idea",
    offering: "Planners",
    targetCustomer: "Tutors",
    primaryGoals: [],
    knownConstraints: [],
  };
  function review() {
    if (!draft || draft.phase === "essential") return null;
    const documents = [
      "essentials",
      "offers",
      "operations",
      "delivery",
      "goals",
      "constraints",
    ].map((section) => ({
      section,
      title: section,
      kind: section === "essentials" ? "business_profile" : `business_foundation_${section}`,
      text: draft.answers
        .filter((a) => a.section === section)
        .map(
          (a) =>
            `### ${a.intent === "planned" ? "Intended future practice" : "User-stated information"} [source: ${a.eventId}]\n${a.text}`,
        )
        .join("\n"),
    }));
    const projection = { documents, blueprint: "Synthetic Blueprint", previousBlueprint: "" };
    return {
      revision: draft.revision,
      ...projection,
      reviewHash: hash(JSON.stringify(projection)),
    };
  }
  function fail(code) {
    throw Object.assign(Error(code), { data: { code } });
  }
  const client = {
    setAuth() {},
    async query(reference, args) {
      const name = getFunctionName(reference);
      calls.push(name);
      if (name === "foundation:enabled") return true;
      if (name === "foundation:get") return clone(draft);
      if (name === "foundation:review") return clone(review());
      if (name === "foundation:publication")
        return docs
          .filter((d) => d.kind !== "business_blueprint")
          .map((d) => ({ id: d._id, status: d.status }));
      if (name === "tenantExport:exportTenantData") {
        const tables = {
          foundationInterviews: [draft],
          foundationRevisions: [
            {
              ...snapshot.interview,
              tenantId: "test-user",
              docIds: published.docIds,
              documents: snapshot.review.documents,
            },
          ],
          tenantProfiles: [
            { blueprintDocId: "blueprint", blueprintSourceDocIds: published.docIds },
          ],
          vaultDocuments: docs,
        };
        const keys = Object.keys(tables),
          index = args.cursor?.index ?? 0;
        return {
          table: { name: keys[index], rows: tables[keys[index]] },
          limits: { truncated: false },
          nextCursor: index + 1 < keys.length ? { index: index + 1 } : null,
        };
      }
      if (name === "vault:vaultDocText") return clone(docs.find((d) => d._id === args.vaultDocId));
      throw Error("unexpected query");
    },
    async mutation(reference, args) {
      const name = getFunctionName(reference);
      calls.push(name);
      if (name === "foundation:begin") {
        draft ??= { revision: 0, phase: "essential", profile, answers: [], slots: {} };
        return "interview";
      }
      if (name === "foundation:edit") {
        if (args.revision !== draft.revision) fail("STALE_INTERVIEW");
        draft = {
          ...draft,
          profile: clone(args.profile),
          answers: clone(args.answers),
          revision: draft.revision + 1,
          ...(retainFacts
            ? {}
            : { phase: "essential", slots: { oneLineDescription: profile.oneLineDescription } }),
        };
        return draft.revision;
      }
      if (name === "foundation:publish") {
        if (draft.phase === "essential") fail("INCOMPLETE_ONBOARDING");
        if (args.reviewHash !== review().reviewHash) fail("STALE_REVIEW");
        if (published) return published;
        snapshot = { review: review(), interview: clone(draft) };
        const docIds = snapshot.review.documents.map((_, i) => `doc${i}`);
        published = { docIds };
        docs = snapshot.review.documents.map((d, i) => ({
          ...d,
          _id: docIds[i],
          tenantId: "test-user",
          contentHash: hash(d.text),
          status: "ready",
          ragEntryId: `real-entry-${i}`,
        }));
        docs.push({
          _id: "blueprint",
          tenantId: "test-user",
          kind: "business_blueprint",
          text: snapshot.review.blueprint,
          contentHash: hash(snapshot.review.blueprint),
          status: "ready",
        });
        draft = {
          ...draft,
          state: "published",
          publishedRevision: draft.revision,
          tenantId: "test-user",
          docIds,
        };
        return published;
      }
      throw Error("unexpected mutation");
    },
    async action(reference, args) {
      const name = getFunctionName(reference);
      calls.push(name);
      if (name === "foundation:answer") {
        draft = {
          ...draft,
          revision: draft.revision + 1,
          answers: [
            ...draft.answers,
            {
              eventId: args.eventId,
              section: args.section,
              text: args.answer,
              intent: args.intent,
            },
          ],
        };
        if (args.section === "essentials") {
          draft.phase = "enrichment";
          draft.slots = {
            headcount: 1,
            paidStaff: 0,
            revenueStage: "pre-revenue",
            funding: "bootstrapped",
            yearsOperating: args.answer.includes("operating 1 year") ? 1 : 0,
            oneLineDescription: profile.oneLineDescription,
          };
        }
        return { revision: draft.revision };
      }
      if (name === "vaultGround:vaultGround") return { docIds: [published.docIds[0]] };
      throw Error("unexpected action");
    },
  };
  return { client, calls };
}
function options(client) {
  return {
    target: "https://synthetic-stage-123.convex.cloud",
    expectedDeployment: "synthetic-stage-123",
    jwt: `header.${Buffer.from(JSON.stringify({ sub: "test-user|test-session" })).toString("base64url")}.signature`,
    expectedUserId: "test-user",
    freshAccount: true,
    allowPaid: true,
    createClient: () => client,
    approveSyntheticReview: async ({ review }) => ({
      syntheticFixtureOnly: true,
      revision: review.revision,
      reviewHash: review.reviewHash,
    }),
    wait: async () => {},
  };
}
test("scenario reconfirms corrected facts and checks exact publication/export/current hydration", async () => {
  const { client, calls } = backend();
  const result = await runFoundationApiScenario(options(client));
  assert.equal(result.evidence.essentialCorrectionReconfirmed, true);
  assert.equal(result.evidence.nativeMatchedChunksVerified, false);
  assert.equal(result.snapshots[0].interview.slots.yearsOperating, 1);
  assert.equal(calls.filter((x) => x === "foundation:answer").length, 7);
  assert.equal(calls.filter((x) => x === "vaultGround:vaultGround").length, 1);
});
test("refuses incorrect staging or missing native session before any call", async () => {
  for (const alter of [
    { target: "https://different-stage.convex.cloud" },
    {
      jwt: `header.${Buffer.from(JSON.stringify({ sub: "admin-fixture" })).toString("base64url")}.signature`,
    },
    { freshAccount: false },
    { allowPaid: false },
  ]) {
    const { client, calls } = backend();
    await assert.rejects(runFoundationApiScenario({ ...options(client), ...alter }));
    assert.equal(calls.length, 0);
  }
});
test("retained extracted facts after correction stop qualification before publication", async () => {
  const { client, calls } = backend({ retainFacts: true });
  await assert.rejects(
    runFoundationApiScenario(options(client)),
    /CORRECTION_DID_NOT_INVALIDATE_FACTS/,
  );
  assert.equal(calls.includes("foundation:publish"), false);
});
test("publication requires approval of exact synthetic revision and hash", async () => {
  for (const approval of [null, { syntheticFixtureOnly: true, revision: 0, reviewHash: "wrong" }]) {
    const { client, calls } = backend();
    await assert.rejects(
      runFoundationApiScenario({
        ...options(client),
        approveSyntheticReview: async () => approval,
      }),
      /EXACT_SYNTHETIC_APPROVAL_REQUIRED/,
    );
    assert.equal(calls.filter((x) => x === "foundation:publish").length, 2); // only expected refusal checks
    assert.equal(calls.includes("vaultGround:vaultGround"), false);
  }
});
