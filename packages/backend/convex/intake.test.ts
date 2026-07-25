// @vitest-environment node
//
// convex-test coverage for the backend intake spine (INTK-02/03) — the SC3
// guardrail-ordering heart of Phase 4 (04-VALIDATION.md Wave-2 rows). Every SMOKE:: path here
// drives the REAL spine (classify -> extract -> redact -> cost -> audit -> merge) with ZERO
// real API calls: the merge step calls the REAL api.cockpit.sendCockpitMessage, whose governed
// loop (runCockpitAgent) loads the cockpit-agent skill via getActiveSkill BEFORE it would ever
// touch a model — since this suite never seeds the skill registry, that lookup fails closed
// (NO_ACTIVE_SKILL) and sendCockpitMessage's own try/catch converts it into a conversational
// error turn. No network call is ever attempted; the USER turn (the merged intake content) is
// still saved to the thread beforehand, which is exactly what the merge-seam assertions check.
//
// Registers the components sendCockpitMessage's spine touches offline: "agent" (the thread
// message store), "rateLimiter" (guardrails.preCall/recordSpend), "auditCounts" (the aggregate
// audit.log maintains on every insert) — the Wave-0 gap this plan closes (04-VALIDATION.md).
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const agentModules = import.meta.glob("../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");

const TENANT = "tenant_intake";
type T = ReturnType<typeof convexTest>;

/** The seed helper (Wave-0 gap): registers every component the intake spine's merge seam
 *  (sendCockpitMessage) touches offline, so attachToThread/dictateToThread run end-to-end. */
function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agentModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  // The attachment→vault seam (step 8b) reaches workflow.start via startIngest. The row insert and
  // startIngest share ONE transaction, so without these the whole vault write would roll back.
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const vaultDocs = (t: T) => t.run((ctx) => ctx.db.query("vaultDocuments").collect());

/** Mint a thread + its plans row the same way the cockpit composer does (first turn), so
 *  attachToThread/dictateToThread have an in-progress conversation to merge into. The skill
 *  registry is deliberately left unseeded (see the file header) — zero real API calls. */
async function seedThread(t: T, tenantId = TENANT) {
  const asT = t.withIdentity({ subject: tenantId });
  const { threadId } = await asT.action(api.cockpit.sendCockpitMessage, { text: "Hello" });
  return { asT, threadId };
}

const allMessages = (asT: ReturnType<T["withIdentity"]>, threadId: string) =>
  asT.query(api.cockpit.listThreadMessages, { threadId, paginationOpts: { numItems: 20, cursor: null } });

describe("intakeDb round-trip (Wave-0 seed check)", () => {
  test("generateUploadUrl + insertArtifact round-trip", async () => {
    const t = setup();
    const asT = t.withIdentity({ subject: TENANT });

    const url = await asT.mutation(api.intakeDb.generateUploadUrl, {});
    expect(url).toBeTruthy();

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["hello"])));
    const artifactId = await t.mutation(internal.intakeDb.insertArtifact, {
      tenantId: TENANT,
      threadId: "thread_x",
      storageId,
      filename: "a.txt",
      mimeType: "text/plain",
      size: 5,
      kind: "document",
    });

    const row = await t.run((ctx) => ctx.db.get(artifactId));
    expect(row).toMatchObject({ tenantId: TENANT, status: "uploaded", filename: "a.txt", kind: "document" });
  });
});

describe("attachToThread (INTK-02) — extract -> redact -> persist -> audit -> merge", () => {
  // Slower than the default 5000ms: this is the only test exercising the FULL happy path
  // (extract -> redact -> persist -> audit -> merge) plus every assertion query afterward.
  test("a SMOKE::extract:: fixture carrying PII is redacted before persist/audit/merge (§4 honeypot)", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    const RAW_EMAIL = "john@example.com";
    const RAW_SSN = "123-45-6789";
    const bytes = `SMOKE::extract::Contact John at ${RAW_EMAIL} or SSN ${RAW_SSN}`;
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "image/png" })));

    const res = await asT.action(api.intake.attachToThread, {
      threadId,
      storageId,
      filename: "receipt.png",
      mimeType: "image/png",
      size: bytes.length,
    });
    expect(res).toEqual({ threadId });

    // Persisted artifact: REDACTED safeText only, never the raw PII.
    const artifacts = await t.run((ctx) => ctx.db.query("intakeArtifacts").collect());
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0]!;
    expect(artifact.status).toBe("extracted");
    expect(artifact.kind).toBe("image");
    expect(artifact.extracted).toContain("[EMAIL_1]");
    expect(artifact.extracted).toContain("[SSN_1]");
    expect(artifact.extracted).not.toContain(RAW_EMAIL);
    expect(artifact.extracted).not.toContain(RAW_SSN);

    // Audit: refs/counts ONLY — the raw email/SSN must never appear anywhere in the payload.
    const auditRows = await t.run((ctx) => ctx.db.query("audit").collect());
    const extractedAudit = auditRows.find((r) => r.eventType === "intake.extracted");
    expect(extractedAudit).toBeTruthy();
    expect(extractedAudit?.payload).toMatchObject({
      artifactId: artifact._id,
      kind: "image",
      piiCounts: { email: 1, ssn: 1, card: 0, phone: 0 },
    });
    const auditStr = JSON.stringify(auditRows.map((r) => r.payload));
    expect(auditStr).not.toContain(RAW_EMAIL);
    expect(auditStr).not.toContain(RAW_SSN);

    // Merge seam: the framed, REDACTED content landed as a turn in the thread.
    const page = await allMessages(asT, threadId);
    const merged = page.page.find((m) => m.text?.includes("receipt.png"));
    expect(merged?.text).toContain("[EMAIL_1]");
    expect(merged?.text).not.toContain(RAW_EMAIL);
  }, 20000);

  test("fail-closed: a poisoned fixture forces scanText's own Err path -> failed, no safeText, no merge, ONE refs-only audit row (OPSG-02)", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    // Document kind (plain UTF-8 decode, no model) so the poison sentinel is the rawText verbatim —
    // intake.ts routes it into scanText's real non-string Err branch (never a fabricated Err).
    const POISON = "PII_POISON::this content must never reach audit or the conversation";
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([POISON], { type: "text/plain" })));

    const res = await asT.action(api.intake.attachToThread, {
      threadId,
      storageId,
      filename: "poison.txt",
      mimeType: "text/plain",
      size: POISON.length,
    });
    expect(res).toEqual({ threadId });

    const artifacts = await t.run((ctx) => ctx.db.query("intakeArtifacts").collect());
    const artifact = artifacts.find((a) => a.filename === "poison.txt");
    expect(artifact?.status).toBe("failed");
    expect(artifact?.extracted).toBeUndefined(); // NO safeText written

    // Exactly ONE refs-only redaction-failure audit row — no raw/redacted text anywhere in it.
    const auditRows = await t.run((ctx) => ctx.db.query("audit").collect());
    const failureRows = auditRows.filter((r) => r.eventType === "intake.extraction_failed");
    expect(failureRows).toHaveLength(1);
    expect(failureRows[0]?.payload).toEqual({ artifactId: artifact?._id, kind: "document", reason: "pii_scan_failed" });
    expect(JSON.stringify(failureRows[0]?.payload)).not.toContain("PII_POISON");

    // NO "intake.extracted" row and no framed-content merge — only the conversational refusal.
    expect(auditRows.some((r) => r.eventType === "intake.extracted")).toBe(false);
    const page = await allMessages(asT, threadId);
    expect(page.page.some((m) => m.text?.includes("PII_POISON"))).toBe(false);
    expect(page.page.some((m) => m.text?.toLowerCase().includes("safety scan"))).toBe(true);
  });

  test("cost/kill-switch respected: a governed stop runs BEFORE any extraction — no artifact, no spend, conversational pause", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    await t.run((ctx) =>
      ctx.db.insert("guardrailConfig", { killSwitch: true, budgetUsdPerRequest: 0.05, updatedAt: Date.now() }),
    );
    const bytes = "SMOKE::extract::should never be processed";
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "image/png" })));

    const res = await asT.action(api.intake.attachToThread, {
      threadId,
      storageId,
      filename: "blocked.png",
      mimeType: "image/png",
      size: bytes.length,
    });
    expect(res).toEqual({ threadId });

    // The preCall gate stopped BEFORE step 4 (insertArtifact) — no row, no extraction, no audit.
    expect(await t.run((ctx) => ctx.db.query("intakeArtifacts").collect())).toHaveLength(0);
    const auditRows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(auditRows.some((r) => r.eventType.startsWith("intake."))).toBe(false);

    const page = await allMessages(asT, threadId);
    expect(page.page.some((m) => m.text?.toLowerCase().includes("paused"))).toBe(true);
  });
});

describe("dictateToThread (INTK-03) — transcribe -> redact -> merge VERBATIM as a request turn", () => {
  test("a SMOKE::transcribe:: fixture merges verbatim (no attachment-style wrapper)", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    // Bracket placeholder (not a real email) so scanText leaves it untouched — the verbatim-frame
    // contract is what this test isolates, per 04-VALIDATION.md's exact fixture.
    const TRANSCRIPT = "send an email to [EMAIL] about lunch";
    const bytes = `SMOKE::transcribe::${TRANSCRIPT}`;
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "audio/webm" })));

    const res = await asT.action(api.intake.dictateToThread, { threadId, storageId });
    expect(res).toEqual({ threadId });

    const artifacts = await t.run((ctx) => ctx.db.query("intakeArtifacts").collect());
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "audio", status: "extracted", extracted: TRANSCRIPT });

    const auditRows = await t.run((ctx) => ctx.db.query("audit").collect());
    const extractedAudit = auditRows.find((r) => r.eventType === "intake.extracted");
    expect(extractedAudit?.payload).toMatchObject({ kind: "audio", charCount: TRANSCRIPT.length });

    // The merged turn is the transcript EXACTLY — no "Here is the content of the attached file" wrapper.
    const page = await allMessages(asT, threadId);
    expect(page.page.some((m) => m.text === TRANSCRIPT)).toBe(true);
    expect(page.page.some((m) => m.text?.includes("attached file"))).toBe(false);
  });
});

// The Phase-2/Phase-5 seam closed: a cockpit attachment ALSO becomes a vault doc, so it is
// embedded/graph-extracted and can ground a LATER turn instead of vanishing with the thread.
// Spec: docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md
describe("attachToThread -> vault (attachments persist, not one-shot prompt context)", () => {
  const attach = async (
    t: T,
    asT: ReturnType<T["withIdentity"]>,
    threadId: string,
    body: string,
    filename = "profile.md",
    mimeType = "text/markdown",
  ) => {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([body], { type: mimeType })));
    return asT.action(api.intake.attachToThread, {
      threadId,
      storageId,
      filename,
      mimeType,
      size: body.length,
    });
  };

  test("an attached document becomes ONE groundable vault doc carrying the raw text + storageId", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    await attach(t, asT, threadId, "# Northwind Cartage\n\nCAC: $180\n");

    const docs = await vaultDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      tenantId: TENANT,
      title: "profile.md",
      kind: "upload",
      source: "upload",
      category: "my-uploads",
      mimeType: "text/markdown",
      status: "processing",
    });
    // Raw text, so a later evaluation can actually ground on the figure.
    expect(docs[0]?.text).toContain("CAC: $180");
    // storageId carried through, so the doc stays downloadable from the vault UI.
    expect(docs[0]?.storageId).toBeTruthy();
  });

  test("the vault copy keeps RAW pii while the conversation still gets the REDACTED text", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    const RAW_EMAIL = "john@example.com";
    await attach(t, asT, threadId, `Owner contact: ${RAW_EMAIL}`, "contacts.txt", "text/plain");

    // Vault = raw (every other vault doc does this; redacting here would degrade grounding).
    const docs = await vaultDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.text).toContain(RAW_EMAIL);

    // Artifact (the prompt-bound plane) = redacted. GRDL-01 is untouched by this change.
    const artifacts = await t.run((ctx) => ctx.db.query("intakeArtifacts").collect());
    expect(artifacts[0]?.extracted).toContain("[EMAIL_1]");
    expect(artifacts[0]?.extracted).not.toContain(RAW_EMAIL);
  });

  test("re-attaching identical content dedups — one row, no second embed", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    const body = "# Same File\n\nidentical bytes\n";
    await attach(t, asT, threadId, body);
    await attach(t, asT, threadId, body, "renamed-copy.md");

    expect(await vaultDocs(t)).toHaveLength(1);
  });

  test("dictation creates NO vault doc — a voice note is the request, not a document", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    const bytes = "SMOKE::transcribe::remind me to call the lab";
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "audio/webm" })));

    await asT.action(api.intake.dictateToThread, { threadId, storageId });

    expect(await vaultDocs(t)).toHaveLength(0);
  });

  test("content that fails the PII scan never reaches the vault (fail-closed gate is upstream)", async () => {
    const t = setup();
    const { asT, threadId } = await seedThread(t);
    await attach(t, asT, threadId, "PII_POISON::must never be stored", "poison.txt", "text/plain");

    expect(await vaultDocs(t)).toHaveLength(0);
  });
});
