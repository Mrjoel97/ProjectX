import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { assertFoundationExport, assertFoundationReview } from "./foundationEvidence.mjs";

// Human-operated staging qualification. No credentials, OTPs, provider bodies or URLs are logged.
// Run only for a newly invited disposable account. Every paid phase requires explicit TTY input.
const require = createRequire(import.meta.url);
const { ConvexHttpClient } = require("convex/browser");
const { makeFunctionReference } = require("convex/server");
const TARGET = process.env.STAGING_CONVEX_URL ?? "https://invalid.convex.cloud";
const ORIGIN = process.env.STAGING_APP_ORIGIN;
const email = process.env.STAGING_TEST_EMAIL;
const allowedEmail =
  /^[^@\s]+\+(?:foundation-qualification|pikar-stage)-[a-z0-9-]+@[^@\s]+\.[^@\s]+$/;
const safe = (phase, result = "pass", extra = {}) =>
  process.stdout.write(`${JSON.stringify({ phase, result, ...extra })}\n`);
const assert = (ok, code) => {
  if (!ok) throw new Error(code);
};
let phase = "startup";
let input;
let raw = false;
const lines = [];
let resolveLine;
let accountId;
let fresh = false;
let live;
let deleted = false;
const oldPassword = randomBytes(32).toString("base64url");

const ref = (name) => makeFunctionReference(name);
// Convex client default console logging may include function error details; explicitly discard it.
const client = () => new ConvexHttpClient(TARGET, { logger: false });
const anonymous = client();

function setupInput() {
  assert(
    process.stdin.isTTY && typeof process.stdin.setRawMode === "function",
    "PRIVATE_TTY_REQUIRED",
  );
  process.stdin.setRawMode(true);
  raw = true;
  input = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (resolveLine) {
      const receive = resolveLine;
      resolveLine = undefined;
      receive(line);
    } else lines.push(line);
  });
  process.stdin.on("data", (chunk) => {
    if (chunk.includes(3)) {
      safe("interrupted", "stopped", { accountCreated: fresh, deleted });
      cleanup();
      process.exit(130);
    }
  });
}
function cleanup() {
  input?.close();
  if (raw) {
    process.stdin.setRawMode(false);
    raw = false;
  }
}
async function command(expected) {
  safe(phase, "awaiting_private_input", { command: expected });
  const line = lines.length
    ? lines.shift()
    : await new Promise((r) => {
        resolveLine = r;
      });
  assert(line.length <= 8192, "INPUT_TOO_LONG");
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("INVALID_PRIVATE_INPUT");
  }
  assert(value && typeof value === "object" && value.command === expected, "UNEXPECTED_COMMAND");
  return value;
}
function token(result) {
  assert(typeof result?.tokens?.token === "string", "AUTH_TOKEN_MISSING");
  return result.tokens.token;
}
function subject(jwt) {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert(typeof payload.sub === "string" && payload.sub.includes("|"), "INVALID_SESSION_SUBJECT");
  return payload.sub.split("|")[0];
}
async function signin(params) {
  return anonymous.action(ref("auth:signIn"), { provider: "password", params });
}
function validateOtp(value) {
  assert(
    typeof value.code === "string" && /^[a-zA-Z0-9-]{4,128}$/.test(value.code),
    "INVALID_CODE_FORMAT",
  );
  return value.code;
}
const SYNTHETIC = {
  essentials:
    "This is a fictional test business called Cedar Lantern Test Studio in Tanzania. We design printable planning templates for independent tutors. I am the sole founder: headcount 1, paid staff 0, bootstrapped, pre-revenue, operating for 0 years. We have no customers or real personal information. Our stage is idea validation. Our primary goal is to interview 10 tutors in 90 days. Budget constraint: 100 fictional dollars monthly. Current offer is a printable weekly lesson planner. We manually draft templates and check them weekly. Planned sales channel is a simple website. No regulated advice.",
  offers:
    "Our fictional current offer is a printable weekly lesson planner for independent tutors. Planned price is 12 fictional dollars. We plan to interview 10 tutors before launching; no sales or customers yet.",
  operations:
    "The sole founder drafts templates and checks layout each Friday. We use a spreadsheet to track revisions. There are no employees, contractors or inventory.",
  delivery:
    "The planned process is website inquiry, confirmation, payment, and delivery of a downloadable PDF within two working days. The founder handles support.",
  goals:
    "Planned goal: interview 10 tutors in 90 days. Track weekly interview count and template revision count. No revenue target is confirmed.",
  constraints:
    "Monthly fictional budget ceiling is 100 dollars. Decision: validate demand before hiring. No sensitive personal data should be collected.",
};
let jwt;
let lastReview;
let publicationIds;
let revision;
const completedSections = new Set();
const approvedSnapshots = new Map();
let reviewedInterview;
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
const validateReview = assertFoundationReview;
function validateExportEvidence(data, snapshot, ids) {
  assert(snapshot === approvedSnapshots.get(lastReview.revision), "CURRENT_APPROVAL_REQUIRED");
  assertFoundationExport({
    data,
    snapshots: [...approvedSnapshots.values()],
    tenantId: accountId,
    docIds: ids,
  });
}
async function refuse(op, code, label) {
  let matched = false;
  try {
    await op();
  } catch (e) {
    matched =
      JSON.stringify(e?.data ?? {}).includes(code) ||
      (e instanceof Error && e.message.includes(code));
  }
  assert(matched, "EXPECTED_REFUSAL_MISSING");
  safe(label);
}
async function selfDelete(c) {
  assert(
    fresh && !deleted && accountId && c.userId === accountId && c.confirmation === "DELETE MY DATA",
    "EXPLICIT_SELF_DELETE_REQUIRED",
  );
  phase = "self_delete";
  await live.action(ref("tenantDelete:deleteTenantData"), { confirmation: "DELETE MY DATA" });
  deleted = true;
  await refuse(
    () => live.query(ref("foundation:get"), {}),
    "UNAUTHENTICATED",
    "erased_jwt_read_refused",
  );
  await refuse(
    () => live.mutation(ref("demo:addItem"), { label: "erased tenant must not resurrect" }),
    "UNAUTHENTICATED",
    "erased_jwt_mutation_refused",
  );
  safe("cleanup_complete", "pass", {
    deleted: true,
    oldJwtReadDenied: true,
    oldJwtMutationDenied: true,
    browserQualified: false,
    voiceQualified: false,
    physicalBlobAbsenceVerified: false,
    physicalRagAbsenceVerified: false,
    sevenDayExpiryVerified: false,
  });
}
async function inspectExport() {
  const collected = {};
  let cursor;
  const cursors = new Set();
  for (let n = 0; n < 150; n++) {
    const p = await live.query(ref("tenantExport:exportTenantData"), cursor ? { cursor } : {});
    assert(!p.limits?.truncated, "EXPORT_TRUNCATED");
    const name = p.table?.name;
    if (
      ["vaultDocuments", "foundationRevisions", "foundationInterviews", "tenantProfiles"].includes(
        name,
      )
    )
      collected[name] = [...(collected[name] ?? []), ...(p.table.rows ?? [])];
    if (!p.nextCursor) return collected;
    const key = canonical(p.nextCursor);
    assert(!cursors.has(key), "EXPORT_CURSOR_REPEATED");
    cursors.add(key);
    cursor = p.nextCursor;
  }
  throw Error("EXPORT_PAGE_BOUND");
}
async function verifyPublication() {
  const rows = await live.query(ref("foundation:publication"), {});
  assert(rows.length === 6 && new Set(rows.map((x) => x.id)).size === 6, "PUBLICATION_COUNT");
  assert(
    JSON.stringify(rows.map((x) => x.id)) === JSON.stringify(publicationIds),
    "PUBLICATION_IDS_CHANGED",
  );
  const tp = await live.query(ref("tenantProfile:get"), {});
  assert(
    JSON.stringify(tp?.blueprintSourceDocIds) === JSON.stringify(publicationIds),
    "BLUEPRINT_REFS_MISMATCH",
  );
  const bp = await live.query(ref("blueprint:blueprintState"), {});
  assert(bp?.live && bp?.confirmedAt, "BLUEPRINT_NOT_CONFIRMED");
  const text = await live.query(ref("vault:vaultDocText"), { vaultDocId: tp.blueprintDocId });
  assert(text?.status === "ready", "BLUEPRINT_NOT_READY");
  safe("publication_refs", "pass", {
    documents: rows.length,
    ready: rows.filter((x) => x.status === "ready").length,
    failed: rows.filter((x) => x.status === "failed").length,
  });
  return rows;
}
async function run() {
  assert(allowedEmail.test(email ?? ""), "DEDICATED_ALIAS_REQUIRED");
  assert(
    !process.env.CONVEX_DEPLOY_KEY && !process.env.CONVEX_ADMIN_KEY,
    "LOCAL_ADMIN_CREDENTIAL_FORBIDDEN",
  );
  const target = new URL(TARGET),
    origin = new URL(ORIGIN ?? "https://invalid.invalid");
  assert(process.env.STAGING_QUALIFICATION_ACK === "ISOLATED_STAGING_ONLY", "STAGING_ACK_REQUIRED");
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(process.env.STAGING_EXPECTED_DEPLOYMENT ?? ""),
    "EXPECTED_DEPLOYMENT_REQUIRED",
  );
  assert(
    target.protocol === "https:" &&
      target.hostname === `${process.env.STAGING_EXPECTED_DEPLOYMENT}.convex.cloud` &&
      !target.username &&
      !target.password &&
      target.pathname === "/" &&
      !target.search &&
      !target.hash,
    "STAGING_TARGET_REQUIRED",
  );
  assert(
    ORIGIN &&
      origin.protocol === "https:" &&
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash,
    "STAGING_ORIGIN_REQUIRED",
  );
  assert(
    !process.env.PRODUCTION_CONVEX_URL ||
      new URL(process.env.PRODUCTION_CONVEX_URL).origin !== target.origin,
    "PRODUCTION_TARGET_REFUSED",
  );
  setupInput();
  if (process.env.STAGING_HARNESS_DRY_RUN === "1") {
    phase = "privacy_probe";
    await command("dummy");
    safe("privacy_probe_complete");
    return;
  }
  phase = "invite";
  const invite = await command("invite");
  assert(
    invite.email === email && invite.reused === false && invite.accountAbsent === true,
    "FRESH_ACCOUNT_ATTESTATION_REQUIRED",
  );
  assert(typeof invite.code === "string" && invite.code.length <= 256, "INVITE_MISSING");
  phase = "signup";
  const start = await signin({
    flow: "signUp",
    email,
    password: oldPassword,
    inviteCode: invite.code,
  });
  assert(!start?.tokens, "SIGNUP_ISSUED_UNVERIFIED_SESSION");
  fresh = true;
  safe(phase);
  phase = "verification";
  const code = validateOtp(await command("verify"));
  jwt = token(await signin({ flow: "email-verification", email, code }));
  accountId = subject(jwt);
  live = client();
  live.setAuth(jwt);
  safe(phase, "pass", { testUserId: accountId });
  phase = "disabled_gate";
  assert((await live.query(ref("foundation:enabled"), {})) === false, "FLAG_ALREADY_ENABLED");
  await refuse(
    () => live.mutation(ref("foundation:begin"), {}),
    "FOUNDATION_ONBOARDING_DISABLED",
    "disabled_begin_refused",
  );
  await refuse(
    () =>
      live.action(ref("foundation:answer"), {
        revision: 0,
        eventId: "disabled-test",
        answer: SYNTHETIC.essentials,
        section: "essentials",
        intent: "current",
      }),
    "FOUNDATION_ONBOARDING_DISABLED",
    "disabled_paid_answer_refused",
  );
  await refuse(
    () => live.mutation(ref("foundation:publish"), { revision: 0, reviewHash: "0".repeat(64) }),
    "FOUNDATION_ONBOARDING_DISABLED",
    "disabled_publish_refused",
  );
  assert((await live.query(ref("foundation:get"), {})) === null, "DISABLED_CREATED_DRAFT");
  safe(phase, "pass", { testUserId: accountId });
  while (!deleted) {
    phase = "operator_checkpoint";
    const c = await command("continue");
    if (c.action === "delete") {
      await selfDelete(c);
      break;
    }
    if (c.action === "activate") {
      phase = "activated_begin";
      assert((await live.query(ref("foundation:enabled"), {})) === true, "FLAG_NOT_ENABLED");
      assert((await live.query(ref("foundation:get"), {})) === null, "NOT_FRESH_DRAFT");
      const id = await live.mutation(ref("foundation:begin"), {});
      assert((await live.mutation(ref("foundation:begin"), {})) === id, "BEGIN_NOT_IDEMPOTENT");
      const draft = await live.query(ref("foundation:get"), {});
      revision = draft.revision;
      safe(phase, "pass", { revision });
      continue;
    }
    if (c.action === "answer") {
      assert(
        c.allowPaid === true && Object.hasOwn(SYNTHETIC, c.section),
        "EXPLICIT_PAID_SECTION_REQUIRED",
      );
      assert(
        !completedSections.has(c.section) || (c.section === "essentials" && c.retry === true),
        "SECTION_ALREADY_ANSWERED",
      );
      const eventId = `qualification-${c.section}-${randomBytes(6).toString("hex")}`;
      phase = `answer_${c.section}`;
      const before = await live.query(ref("foundation:get"), {});
      assert(before, "NO_DRAFT");
      const result = await live.action(ref("foundation:answer"), {
        revision: before.revision,
        eventId,
        section: c.section,
        intent: c.section === "goals" ? "planned" : "current",
        answer: SYNTHETIC[c.section],
      });
      revision = result.revision;
      completedSections.add(c.section);
      // New HTTP client with the same real authenticated session proves durable resume across clients.
      const resumed = client();
      resumed.setAuth(jwt);
      const after = await resumed.query(ref("foundation:get"), {});
      assert(
        after.revision === revision &&
          revision === before.revision + 1 &&
          after.answers.length === before.answers.length + 1,
        "RESUME_REVISION_MISMATCH",
      );
      const saved = after.answers.find((a) => a.eventId === eventId);
      assert(
        saved?.text === SYNTHETIC[c.section] &&
          saved.section === c.section &&
          saved.intent === (c.section === "goals" ? "planned" : "current") &&
          !saved.sourceDocId,
        "RESUME_PROVENANCE_MISMATCH",
      );
      assert(same(after.answers.slice(0, -1), before.answers), "EARLIER_ANSWERS_CHANGED");
      safe(phase, "pass", {
        revision,
        essentialComplete: result.complete,
        answerCount: after.answers.length,
      });
      continue;
    }
    if (c.action === "correct") {
      phase = "typed_correction";
      const before = await live.query(ref("foundation:get"), {});
      assert(before?.answers?.length, "ANSWER_REQUIRED");
      lastReview = await live.query(ref("foundation:review"), {});
      assert(lastReview?.documents?.length === 6, "ESSENTIALS_INCOMPLETE");
      const profile = { ...before.profile, name: "Cedar Lantern Test Studio Revised" };
      const answers = before.answers.map((a, i) =>
        i === 0
          ? {
              ...a,
              text:
                a.text +
                " Correction: the fictional business name is Cedar Lantern Test Studio Revised.",
            }
          : a,
      );
      revision = await live.mutation(ref("foundation:edit"), {
        revision: before.revision,
        profile,
        answers,
      });
      await refuse(
        () =>
          live.mutation(ref("foundation:edit"), { revision: before.revision, profile, answers }),
        "STALE_INTERVIEW",
        "stale_edit_refused",
      );
      await refuse(
        () =>
          live.mutation(ref("foundation:publish"), { revision, reviewHash: lastReview.reviewHash }),
        "STALE_REVIEW",
        "stale_review_refused",
      );
      const corrected = await live.query(ref("foundation:get"), {});
      assert(
        corrected.revision === revision &&
          same(corrected.profile, profile) &&
          same(corrected.answers, answers),
        "CORRECTION_NOT_PERSISTED",
      );
      safe(phase, "pass", { revision });
      continue;
    }
    if (c.action === "review") {
      phase = "six_document_review";
      lastReview = await live.query(ref("foundation:review"), {});
      assert(
        lastReview?.documents?.length === 6 &&
          new Set(lastReview.documents.map((d) => d.kind)).size === 6,
        "SIX_DOCUMENT_REVIEW_REQUIRED",
      );
      assert(
        typeof lastReview.reviewHash === "string" && lastReview.reviewHash.length === 64,
        "REVIEW_HASH_REQUIRED",
      );
      assert(
        lastReview.documents.every((d) => typeof d.text === "string" && d.text.length > 0),
        "EMPTY_DOCUMENT",
      );
      reviewedInterview = await live.query(ref("foundation:get"), {});
      validateReview(lastReview, reviewedInterview);
      const sections = new Set(reviewedInterview.answers.map((a) => a.section));
      safe(phase, "pass", {
        revision: lastReview.revision,
        documentCount: 6,
        reviewHash: lastReview.reviewHash,
        providedSections: sections.size,
        allSectionsProvided: sections.size === 6,
      });
      continue;
    }
    if (c.action === "publish") {
      assert(
        c.allowPaid === true &&
          lastReview &&
          c.approveRevision === lastReview.revision &&
          c.approveHash === lastReview.reviewHash,
        "EXPLICIT_EXACT_APPROVAL_REQUIRED",
      );
      assert(reviewedInterview, "REVIEW_SNAPSHOT_REQUIRED");
      validateReview(lastReview, reviewedInterview);
      phase = "approved_publication";
      const first = await live.mutation(ref("foundation:publish"), {
        revision: lastReview.revision,
        reviewHash: lastReview.reviewHash,
      });
      if (publicationIds)
        assert(
          JSON.stringify(first.docIds) === JSON.stringify(publicationIds),
          "REVISED_IDS_CHANGED",
        );
      publicationIds = first.docIds;
      approvedSnapshots.set(lastReview.revision, {
        review: structuredClone(lastReview),
        interview: structuredClone(reviewedInterview),
      });
      const again = await live.mutation(ref("foundation:publish"), {
        revision: lastReview.revision,
        reviewHash: lastReview.reviewHash,
      });
      assert(JSON.stringify(first) === JSON.stringify(again), "PUBLICATION_NOT_IDEMPOTENT");
      await verifyPublication();
      validateExportEvidence(
        await inspectExport(),
        approvedSnapshots.get(lastReview.revision),
        publicationIds,
      );
      safe(phase, "pass", {
        documentCount: 6,
        exactReviewedContentVerified: true,
        revisionCount: approvedSnapshots.size,
      });
      continue;
    }
    if (c.action === "index") {
      phase = "index_evidence";
      assert(publicationIds, "PUBLICATION_REQUIRED");
      const rows = await verifyPublication();
      if (rows.some((x) => x.status !== "ready")) {
        safe(phase, "pending", {
          ready: rows.filter((x) => x.status === "ready").length,
          failed: rows.filter((x) => x.status === "failed").length,
        });
        continue;
      }
      const data = await inspectExport();
      validateExportEvidence(data, approvedSnapshots.get(lastReview.revision), publicationIds);
      const docs = data.vaultDocuments ?? [];
      const actual = docs.filter((d) => publicationIds.includes(d._id));
      assert(actual.length === 6, "EXPORTED_DOCS_MISSING");
      assert(
        actual.every(
          (d) =>
            d.status === "ready" &&
            typeof d.ragEntryId === "string" &&
            !d.ragEntryId.startsWith("smoke::"),
        ),
        "REAL_INDEX_EVIDENCE_MISSING",
      );
      const bp = docs.filter((d) => d.kind === "business_blueprint");
      assert(bp.length === 1 && !bp[0].ragEntryId, "BLUEPRINT_EMBEDDED");
      safe(phase, "pass", {
        ready: 6,
        indexed: 6,
        blueprintEmbedded: false,
        exactReviewedContentVerified: true,
        provenanceVerified: true,
        physicalRagAbsenceVerified: false,
        sevenDayExpiryVerified: false,
        revisionCount: data.foundationRevisions?.length ?? 0,
      });
      continue;
    }
    if (c.action === "retrieve") {
      assert(c.allowPaid === true && publicationIds, "EXPLICIT_PAID_RETRIEVAL_REQUIRED");
      phase = "current_retrieval_refs";
      const r = await live.action(ref("vaultGround:vaultGround"), {
        query: "What does Cedar Lantern Test Studio Revised offer independent tutors?",
      });
      assert(
        r.docIds.length > 0 && r.docIds.every((id) => publicationIds.includes(id)),
        "CURRENT_RETRIEVAL_MISMATCH",
      );
      // Public vaultGround currently returns IDs in context, not native matched chunks.
      // Verify the selected current documents separately; never call this matched-chunk proof.
      for (const id of r.docIds) {
        const d = await live.query(ref("vault:vaultDocText"), { vaultDocId: id });
        const expected = approvedSnapshots.get(lastReview.revision)?.review.documents[
          publicationIds.indexOf(id)
        ];
        assert(
          d?.status === "ready" && d.text === expected?.text,
          "RETRIEVED_DOCUMENT_CONTENT_MISMATCH",
        );
      }
      safe(phase, "pass", {
        matchedCurrentDocumentRefs: r.docIds.length,
        currentDocumentHydrationVerified: true,
        nativeMatchedChunkRetrievalVerified: false,
        staleRagEntryAbsenceVerified: false,
      });
      continue;
    }
    throw Error("UNKNOWN_ACTION");
  }
}
run()
  .catch(async () => {
    safe(phase, "failed", {
      accountCreated: fresh,
      deleted,
      ...(accountId ? { testUserId: accountId } : {}),
    });
    process.exitCode = 1;
    if (fresh && accountId && live && !deleted) {
      phase = "failed_test_cleanup_review";
      try {
        const c = await command("continue");
        assert(c.action === "delete", "CLEANUP_ONLY");
        await selfDelete(c);
      } catch {
        safe("cleanup", "failed", { testUserId: accountId });
      }
    }
  })
  .finally(cleanup);
