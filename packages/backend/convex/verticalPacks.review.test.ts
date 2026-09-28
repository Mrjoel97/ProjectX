import { verticalSkillName } from "@pikar/core/verticalPacks";
import { sheetRows } from "@pikar/vault/sheets";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

async function setup(registerAggregate = true) {
  const t = convexTest(schema, modules);
  if (registerAggregate) t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const ids = await t.run(async (ctx) => {
    const candidate = {
      tenantId: "a",
      name: verticalSkillName("product"),
      version: 1,
      status: "candidate" as const,
      rollbackEligible: false,
      body: "Synthetic candidate",
      authoredBody: "",
      author: "system" as const,
      basedOnScope: "global" as const,
      basedOnName: verticalSkillName("product"),
      basedOnVersion: 1,
      createdAt: 1,
    };
    const candidateId = await ctx.db.insert("tenantSkills", candidate);
    const otherCandidateId = await ctx.db.insert("tenantSkills", { ...candidate, version: 2 });
    const document = {
      title: "Private draft",
      kind: "document" as const,
      category: "workspace-docs" as const,
      source: "agent" as const,
      mimeType: "text/markdown",
      size: 12,
      contentHash: "synthetic",
      text: "Private draft body",
      origin: "agent" as const,
      status: "ready" as const,
      createdAt: 1,
    };
    const artifactId = await ctx.db.insert("vaultDocuments", { tenantId: "a", ...document });
    const previewId = await ctx.db.insert("vaultDocuments", { tenantId: "a", ...document });
    const foreignId = await ctx.db.insert("vaultDocuments", { tenantId: "b", ...document });
    return { candidateId, otherCandidateId, artifactId, previewId, foreignId };
  });
  return { t, ...ids };
}

test("authenticated review refuses missing, foreign, preview and ambiguous origins", async () => {
  const { t, candidateId, otherCandidateId, artifactId, previewId, foreignId } = await setup();
  const owner = t.withIdentity({ subject: "a" });
  const other = t.withIdentity({ subject: "b" });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toBeNull();
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId: previewId,
    preview: true,
  });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId: previewId })).toBeNull();
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId: previewId, decision: "approve" }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  await expect(
    other.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId: foreignId, decision: "approve" }),
  ).rejects.toThrow("NOT_FOUND");
  for (const id of [candidateId, otherCandidateId])
    await t.mutation(internal.verticalPackTelemetry.record, {
      tenantId: "a",
      candidateId: id,
      verticalId: "product",
      event: "artifact_created",
      artifactId,
    });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toBeNull();
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "reject" }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_AMBIGUOUS");
  const userReviews = (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
    (row) => row.actor === "user" && row.eventType === "vertical_pack.outcome",
  );
  expect(userReviews).toEqual([]);
});

test("one ordinary artifact accepts one authenticated refs-only decision", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  const owner = t.withIdentity({ subject: "a" });
  const other = t.withIdentity({ subject: "b" });
  expect(await other.query(api.verticalPacks.reviewTarget, { artifactId })).toBeNull();
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: null,
  });
  expect(
    await owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).toEqual({ recorded: true, decision: "approve" });
  expect(
    await owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).toEqual({ recorded: false, decision: "approve" });
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "reject" }),
  ).rejects.toThrow("REVIEW_ALREADY_RECORDED");
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: "approve",
  });
  const rows = (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
    (row) => row.actor === "user" && row.eventType === "vertical_pack.outcome",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toMatchObject({
    candidateId,
    verticalId: "product",
    event: "review_approved",
    artifactId,
  });
  expect(JSON.stringify(rows)).not.toContain("Private draft");
  expect((await owner.query(api.verticalPackTelemetry.summary, {})).counts.review_approved).toBe(1);
});

test("authenticated review remains available after 201 newer tenant outcome rows", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: String(candidateId),
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: Date.now() + i,
        payload: { event: "blocked", candidateId, verticalId: "product" },
      });
  });
  const owner = t.withIdentity({ subject: "a" });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: null,
  });
  expect(
    await owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).toEqual({ recorded: true, decision: "approve" });
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: String(candidateId),
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: Date.now() + 1_000 + i,
        payload: { event: "blocked", candidateId, verticalId: "product" },
      });
  });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: "approve",
  });
  expect(
    await owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).toEqual({ recorded: false, decision: "approve" });
});

test("immutable pre-index origin uses only the bounded legacy window", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("audit", {
      tenantId: "a",
      correlationId: String(candidateId),
      eventType: "vertical_pack.outcome",
      actor: "system",
      ts: 1,
      payload: { event: "artifact_created", candidateId, verticalId: "product", artifactId },
    }),
  );
  const owner = t.withIdentity({ subject: "a" });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: null,
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: String(candidateId),
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: i + 2,
        payload: { event: "blocked", candidateId, verticalId: "product" },
      });
  });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toBeNull();
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
});

test("needs-changes records a rejection without publishing or changing the artifact", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  const owner = t.withIdentity({ subject: "a" });
  expect(
    await owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "reject" }),
  ).toEqual({ recorded: true, decision: "reject" });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: "reject",
  });
  const state = await t.run(async (ctx) => ({
    artifact: await ctx.db.get(artifactId),
    candidate: await ctx.db.get(candidateId),
  }));
  expect(state.artifact).toMatchObject({ status: "ready", text: "Private draft body" });
  expect(state.candidate).toMatchObject({ status: "candidate" });
  expect((await owner.query(api.verticalPackTelemetry.summary, {})).counts.review_rejected).toBe(1);
});

test("a document rewritten in place cannot retain its original vertical review provenance", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  await t.mutation(internal.vaultSources.insert, {
    tenantId: "a",
    threadId: "review-thread",
    docIds: [artifactId],
    titles: ["Private draft"],
    count: 1,
    role: "created",
    snippet: "Private draft body",
    form: "long",
    createdAt: Date.now(),
  });
  const owner = t.withIdentity({ subject: "a" });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toMatchObject({
    verticalId: "product",
  });
  expect(
    await t.mutation(internal.vault.patchCreatedDoc, {
      tenantId: "a",
      threadId: "review-thread",
      index: 1,
      title: "Rewritten draft",
      form: "long",
      markdown: "A different document",
      contentHash: "revised-hash",
    }),
  ).toMatchObject({ ok: true });
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toBeNull();
  await expect(
    owner.mutation(api.verticalPacks.recordReview, { artifactId, decision: "approve" }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
});

test("a real authenticated text edit persists before one user edit outcome", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.run((ctx) => ctx.db.patch(artifactId, { kind: "created_content" }));
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  const owner = t.withIdentity({ subject: "a" });
  await expect(
    owner.action(api.verticalArtifactEdit.save, { artifactId, markdown: "Private draft body" }),
  ).rejects.toThrow("ARTIFACT_EDIT_UNCHANGED");
  expect(
    await owner.action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "Human-edited draft body",
    }),
  ).toEqual({ saved: true });
  expect((await t.run((ctx) => ctx.db.get(artifactId)))?.text).toBe("Human-edited draft body");
  expect((await t.run((ctx) => ctx.db.get(artifactId)))?.contentRevision).toBe(1);
  expect(await owner.query(api.verticalPacks.reviewTarget, { artifactId })).toEqual({
    verticalId: "product",
    decision: "edit",
  });
  const userReviews = (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
    (row) => row.actor === "user" && row.eventType === "vertical_pack.outcome",
  );
  expect(userReviews).toHaveLength(1);
  expect(userReviews[0]?.payload).toMatchObject({
    candidateId,
    artifactId,
    event: "review_edited",
    contentRevision: 1,
  });
  expect(JSON.stringify(userReviews)).not.toContain("Human-edited");
  await expect(
    owner.action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "Another edit",
    }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  await expect(
    owner.mutation(api.verticalPacks.recordReview, {
      artifactId,
      decision: "approve",
    }),
  ).rejects.toThrow("REVIEW_ALREADY_RECORDED");
});

test("foreign and stale edits cannot overwrite an artifact or claim a user outcome", async () => {
  const { t, candidateId, artifactId } = await setup();
  await t.run((ctx) => ctx.db.patch(artifactId, { kind: "created_content" }));
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  await expect(
    t.withIdentity({ subject: "b" }).action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "Foreign rewrite",
    }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  await expect(
    t.mutation(internal.verticalPacks.commitEdit, {
      tenantId: "a",
      artifactId,
      expectedContentHash: "wrong",
      markdown: "Stale rewrite",
      contentHash: "new",
      form: "short",
    }),
  ).rejects.toThrow("ARTIFACT_EDIT_STALE_OR_UNCHANGED");
  expect((await t.run((ctx) => ctx.db.get(artifactId)))?.text).toBe("Private draft body");
  expect(
    (await t.withIdentity({ subject: "a" }).query(api.verticalPackTelemetry.summary, {})).counts
      .review_edited,
  ).toBe(0);
});

test("editing a long document replaces its PDF bytes with the edited rendering", async () => {
  const { t, candidateId, artifactId } = await setup();
  const oldStorageId = await t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["old PDF"], { type: "application/pdf" }));
    await ctx.db.patch(artifactId, {
      kind: "created_document",
      storageId: id,
      storedMimeType: "application/pdf",
    });
    return id;
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  expect(
    await t.withIdentity({ subject: "a" }).action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "# Human-edited title\n\nA corrected paragraph.",
    }),
  ).toEqual({ saved: true });
  const doc = await t.run((ctx) => ctx.db.get(artifactId));
  expect(doc?.contentRevision).toBe(1);
  expect(doc?.storedMimeType).toBe("application/pdf");
  expect(doc?.storageId).not.toBe(oldStorageId);
  const pdfHead = await t.run(async (ctx) => {
    const blob = doc?.storageId ? await ctx.storage.get(doc.storageId) : null;
    return blob ? (await blob.text()).slice(0, 4) : null;
  });
  expect(pdfHead).toBe("%PDF");
  expect(await t.run(async (ctx) => (await ctx.storage.get(oldStorageId)) === null)).toBe(true);
});

test("editing a spreadsheet replaces workbook bytes and refuses a table-free draft", async () => {
  const { t, candidateId, artifactId } = await setup();
  const oldStorageId = await t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["old workbook"]));
    await ctx.db.patch(artifactId, {
      kind: "created_document",
      storageId: id,
      storedMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return id;
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    tenantId: "a",
    candidateId,
    verticalId: "product",
    event: "artifact_created",
    artifactId,
  });
  const owner = t.withIdentity({ subject: "a" });
  await expect(
    owner.action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "A paragraph without a table",
    }),
  ).rejects.toThrow("ARTIFACT_EDIT_NO_TABLE");
  expect(
    await owner.action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "| Item | Count |\n| --- | --- |\n| Revised | 2 |",
    }),
  ).toEqual({ saved: true });
  const doc = await t.run((ctx) => ctx.db.get(artifactId));
  expect(doc?.contentRevision).toBe(1);
  expect(doc?.storedMimeType).toBe(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect(doc?.storageId).not.toBe(oldStorageId);
  const workbook = await t.run(async (ctx) => {
    const blob = doc?.storageId ? await ctx.storage.get(doc.storageId) : null;
    return blob ? sheetRows(new Uint8Array(await blob.arrayBuffer())) : null;
  });
  expect(workbook?.sheetCount).toBe(1);
  expect(workbook?.sheets).toMatchObject([
    {
      name: "Sheet 1",
      rows: [
        ["Item", "Count"],
        ["Revised", "2"],
      ],
    },
  ]);
  expect(await t.run(async (ctx) => (await ctx.storage.get(oldStorageId)) === null)).toBe(true);
});

test("a post-patch audit failure rolls back the edit and retains its original PDF", async () => {
  const { t, candidateId, artifactId } = await setup(false);
  const oldStorageId = await t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["original PDF"], { type: "application/pdf" }));
    await ctx.db.patch(artifactId, {
      kind: "created_document",
      storageId: id,
      storedMimeType: "application/pdf",
    });
    await ctx.db.insert("audit", {
      tenantId: "a",
      correlationId: String(candidateId),
      eventType: "vertical_pack.outcome",
      actor: "system",
      ts: Date.now(),
      payload: { candidateId, artifactId, verticalId: "product", event: "artifact_created" },
    });
    return id;
  });
  await expect(
    t.withIdentity({ subject: "a" }).action(api.verticalArtifactEdit.save, {
      artifactId,
      markdown: "# Revised PDF\n\nEdited content.",
    }),
  ).rejects.toThrow();
  const doc = await t.run((ctx) => ctx.db.get(artifactId));
  expect(doc?.text).toBe("Private draft body");
  expect(doc?.contentRevision).toBeUndefined();
  expect(doc?.storageId).toBe(oldStorageId);
  expect(await t.run(async (ctx) => (await ctx.storage.get(oldStorageId)) !== null)).toBe(true);
  const storageRows = await t.run((ctx) => ctx.db.system.query("_storage").collect());
  expect(storageRows.map((row) => row._id)).toEqual([oldStorageId]);
  const userOutcomes = (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
    (row) => row.actor === "user" && row.eventType === "vertical_pack.outcome",
  );
  expect(userOutcomes).toEqual([]);
});
