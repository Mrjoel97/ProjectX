import { verticalSkillName } from "@pikar/core/verticalPacks";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
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
