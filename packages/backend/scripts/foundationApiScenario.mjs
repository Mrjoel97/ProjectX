import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { assertFoundationExport, assertFoundationReview } from "./foundationEvidence.mjs";

// Native API account qualification only. This does not qualify browser/microphone or
// approve a real business. The caller keeps returned synthetic snapshots private.
export const FOUNDATION_FIXTURE = {
  essentials: {
    intent: "current",
    text: "Cedar Lantern Test Studio is a fictional Tanzanian business designing printable weekly lesson planners for independent tutors. Sole founder; headcount 1, paid staff 0, pre-revenue, bootstrapped, operating 0 years. Current stage is idea validation, with no customers or sales. Goal: interview 10 tutors in 90 days. Monthly fictional budget is 100 dollars.",
  },
  offers: {
    intent: "planned",
    text: "Planned offer: printable weekly lesson planner for independent tutors, priced at 12 fictional dollars. No customers or sales yet.",
  },
  operations: {
    intent: "current",
    text: "The sole founder drafts templates and checks layout each Friday. A spreadsheet tracks revisions. No employees, contractors or inventory.",
  },
  delivery: {
    intent: "planned",
    text: "Planned sales process: website inquiry, confirmation, payment, downloadable PDF within two working days. Founder handles support.",
  },
  goals: {
    intent: "planned",
    text: "Interview 10 tutors in 90 days. Track weekly interview counts and template revision counts. No confirmed revenue target.",
  },
  constraints: {
    intent: "current",
    text: "Monthly fictional budget ceiling: 100 dollars. Decision: validate demand before hiring. Do not collect sensitive personal data.",
  },
};
const FACT_KEYS = ["headcount", "paidStaff", "revenueStage", "funding", "yearsOperating"];
const INITIAL_FACTS = {
  headcount: 1,
  paidStaff: 0,
  revenueStage: "pre-revenue",
  funding: "bootstrapped",
  yearsOperating: 0,
};
const assert = (ok, code) => {
  if (!ok) throw new Error(code);
};
const ref = makeFunctionReference;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function refuses(operation, code) {
  let matched = false;
  try {
    await operation();
  } catch (error) {
    matched =
      JSON.stringify(error?.data ?? {}).includes(code) ||
      (error instanceof Error && error.message.includes(code));
  }
  assert(matched, "EXPECTED_REFUSAL_MISSING");
}
export async function collectFoundationExport(client) {
  const data = {};
  const seen = new Set();
  let cursor;
  for (let n = 0; n < 150; n++) {
    const page = await client.query(ref("tenantExport:exportTenantData"), cursor ? { cursor } : {});
    assert(!page.limits?.truncated, "EXPORT_TRUNCATED");
    if (page.table?.name) {
      data[page.table.name] ??= [];
      data[page.table.name].push(...page.table.rows);
    }
    if (!page.nextCursor) return data;
    const key = JSON.stringify(page.nextCursor);
    assert(!seen.has(key), "EXPORT_CURSOR_REPEATED");
    seen.add(key);
    cursor = page.nextCursor;
  }
  throw Error("EXPORT_PAGE_BOUND");
}
export async function runFoundationApiScenario({
  target,
  expectedDeployment,
  jwt,
  expectedUserId,
  freshAccount,
  allowPaid,
  approveSyntheticReview,
  emit = () => {},
  createClient = (url) => new ConvexHttpClient(url, { logger: false }),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  indexAttempts = 60,
}) {
  assert(
    !process.env.CONVEX_DEPLOY_KEY && !process.env.CONVEX_ADMIN_KEY,
    "ADMIN_CREDENTIAL_FORBIDDEN",
  );
  const url = new URL(target);
  assert(
    typeof expectedDeployment === "string" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(expectedDeployment) &&
      url.origin === `https://${expectedDeployment}.convex.cloud` &&
      url.href === `${url.origin}/`,
    "STAGING_TARGET_REQUIRED",
  );
  assert(
    freshAccount === true && allowPaid === true,
    "FRESH_NATIVE_PAID_FIXTURE_APPROVAL_REQUIRED",
  );
  assert(typeof approveSyntheticReview === "function", "SYNTHETIC_REVIEW_APPROVAL_REQUIRED");
  assert(
    Number.isInteger(indexAttempts) && indexAttempts >= 1 && indexAttempts <= 60,
    "INDEX_POLL_BOUND",
  );
  const subject = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub;
  assert(
    typeof subject === "string" &&
      subject.includes("|") &&
      subject.split("|")[0] === expectedUserId,
    "NATIVE_SESSION_REQUIRED",
  );
  const client = createClient(url.origin);
  client.setAuth(jwt);
  const query = (name, args = {}) => client.query(ref(name), args);
  const mutate = (name, args = {}) => client.mutation(ref(name), args);
  assert((await query("foundation:enabled")) === true, "FOUNDATION_DISABLED");
  assert((await query("foundation:get")) === null, "FRESH_INTERVIEW_REQUIRED");
  assert((await query("foundation:publication")).length === 0, "FRESH_PUBLICATION_REQUIRED");
  const id = await mutate("foundation:begin");
  assert((await mutate("foundation:begin")) === id, "BEGIN_NOT_IDEMPOTENT");
  async function answer(section, text, intent) {
    const before = await query("foundation:get");
    const eventId = `qualification-${randomUUID()}`;
    const result = await client.action(ref("foundation:answer"), {
      revision: before.revision,
      eventId,
      section,
      answer: text,
      intent,
    });
    const resumed = createClient(url.origin);
    resumed.setAuth(jwt);
    const after = await resumed.query(ref("foundation:get"), {});
    assert(
      after.revision === before.revision + 1 && result.revision === after.revision,
      "RESUME_REVISION_MISMATCH",
    );
    const saved = after.answers.find((a) => a.eventId === eventId);
    assert(
      saved?.text === text &&
        saved.section === section &&
        saved.intent === intent &&
        !saved.sourceDocId,
      "ANSWER_PROVENANCE_MISMATCH",
    );
    assert(same(after.answers.slice(0, -1), before.answers), "EARLIER_ANSWERS_CHANGED");
    return after;
  }
  for (const [section, { text, intent }] of Object.entries(FOUNDATION_FIXTURE)) {
    const after = await answer(section, text, intent);
    if (section === "essentials")
      assert(
        FACT_KEYS.every((k) => after.slots[k] === INITIAL_FACTS[k]),
        "EXTRACTED_FACTS_MISMATCH",
      );
  }
  emit({ phase: "typed_resume", passed: true });
  const before = await query("foundation:get");
  const obsoleteReview = await query("foundation:review");
  assertFoundationReview(obsoleteReview, before);
  // Correct an actual fact, not just narrative. This must invalidate extracted slots.
  const correction = FOUNDATION_FIXTURE.essentials.text.replace(
    "operating 0 years",
    "operating 1 year",
  );
  const answers = before.answers.map((a) =>
    a.section === "essentials" ? { ...a, text: correction } : a,
  );
  const revision = await mutate("foundation:edit", {
    revision: before.revision,
    profile: before.profile,
    answers,
  });
  await refuses(
    () =>
      mutate("foundation:edit", { revision: before.revision, profile: before.profile, answers }),
    "STALE_INTERVIEW",
  );
  const invalidated = await query("foundation:get");
  assert(
    invalidated.revision === revision &&
      invalidated.phase === "essential" &&
      FACT_KEYS.every((k) => invalidated.slots[k] === undefined),
    "CORRECTION_DID_NOT_INVALIDATE_FACTS",
  );
  assert((await query("foundation:review")) === null, "INCOMPLETE_REVIEW_AVAILABLE");
  await refuses(
    () => mutate("foundation:publish", { revision, reviewHash: obsoleteReview.reviewHash }),
    "INCOMPLETE_ONBOARDING",
  );
  const reconfirmed = await answer("essentials", correction, "current");
  assert(
    FACT_KEYS.every(
      (k) => reconfirmed.slots[k] === (k === "yearsOperating" ? 1 : INITIAL_FACTS[k]),
    ),
    "RECONFIRMED_FACTS_MISMATCH",
  );
  await refuses(
    () =>
      mutate("foundation:publish", {
        revision: reconfirmed.revision,
        reviewHash: obsoleteReview.reviewHash,
      }),
    "STALE_REVIEW",
  );
  emit({ phase: "essential_correction_reconfirmed", passed: true });
  const review = await query("foundation:review");
  const interview = await query("foundation:get");
  assertFoundationReview(review, interview);
  assert(new Set(interview.answers.map((a) => a.section)).size === 6, "SIX_SECTIONS_REQUIRED");
  assert(
    review.documents.find((d) => d.section === "essentials").text.includes(correction),
    "CORRECTED_CONTENT_MISSING",
  );
  const approval = await approveSyntheticReview(structuredClone({ review, interview }));
  assert(
    approval?.syntheticFixtureOnly === true &&
      approval.revision === review.revision &&
      approval.reviewHash === review.reviewHash,
    "EXACT_SYNTHETIC_APPROVAL_REQUIRED",
  );
  const snapshot = structuredClone({ review, interview });
  const first = await mutate("foundation:publish", {
    revision: review.revision,
    reviewHash: review.reviewHash,
  });
  const again = await mutate("foundation:publish", {
    revision: review.revision,
    reviewHash: review.reviewHash,
  });
  assert(same(first, again), "PUBLICATION_NOT_IDEMPOTENT");
  const docIds = first.docIds;
  let ready = false;
  for (let n = 0; n < indexAttempts; n++) {
    const docs = await query("foundation:publication");
    assert(
      docs.length === 6 &&
        same(
          docs.map((d) => d.id),
          docIds,
        ),
      "PUBLICATION_IDS_CHANGED",
    );
    assert(
      docs.every((d) => d.status !== "failed"),
      "FOUNDATION_INDEX_FAILED",
    );
    if (docs.every((d) => d.status === "ready")) {
      ready = true;
      break;
    }
    if (n + 1 < indexAttempts) await wait(2000);
  }
  assert(ready, "INDEX_NOT_READY");
  const data = await collectFoundationExport(client);
  assertFoundationExport({ data, snapshots: [snapshot], tenantId: expectedUserId, docIds });
  const docs = data.vaultDocuments.filter((d) => docIds.includes(d._id));
  assert(
    docs.every(
      (d) =>
        d.status === "ready" &&
        typeof d.ragEntryId === "string" &&
        !d.ragEntryId.startsWith("smoke::"),
    ),
    "REAL_INDEX_REQUIRED",
  );
  const found = await client.action(ref("vaultGround:vaultGround"), {
    query: "What does Cedar Lantern Test Studio offer independent tutors?",
  });
  assert(
    found.docIds.length > 0 && found.docIds.every((id) => docIds.includes(id)),
    "CURRENT_RETRIEVAL_REFS_MISMATCH",
  );
  for (const id of found.docIds) {
    const current = await query("vault:vaultDocText", { vaultDocId: id });
    assert(
      current.status === "ready" && current.text === review.documents[docIds.indexOf(id)].text,
      "CURRENT_HYDRATION_MISMATCH",
    );
  }
  const evidence = {
    phase: "foundation_api",
    passed: true,
    documentCount: 6,
    exactReviewVerified: true,
    essentialCorrectionReconfirmed: true,
    stableRepeatPublication: true,
    realIndexPointers: true,
    currentHydratedRefs: found.docIds.length,
    nativeMatchedChunksVerified: false,
    browserAcceptance: false,
    microphoneAcceptance: false,
    realBusinessApproval: false,
  };
  emit(evidence);
  return { evidence, snapshots: [snapshot], docIds, tenantId: expectedUserId };
}
