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

test("closed vertical event boundary rejects prose, malformed counts and cross-tenant refs", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const candidateId = await t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId: "a",
      name: verticalSkillName("legal"),
      version: 1,
      status: "candidate",
      rollbackEligible: false,
      body: "Private person's clause",
      authoredBody: "",
      author: "system",
      basedOnScope: "global",
      basedOnName: verticalSkillName("legal"),
      basedOnVersion: 1,
      createdAt: 1,
    }),
  );
  const args = {
    tenantId: "a",
    candidateId,
    verticalId: "legal" as const,
    event: "blocked" as const,
    reason: "not_released" as const,
  };
  await t.mutation(internal.verticalPackTelemetry.record, args);
  for (const extra of [
    { prompt: "Private person's clause" },
    { claimCount: -1 },
    { claimCount: NaN },
    { claimCount: 1, citedClaimCount: 2 },
    { reason: "alice@example.com" },
    { costBucket: "account balance 450" },
    { actor: "user" },
  ])
    await expect(
      t.mutation(internal.verticalPackTelemetry.record, { ...args, ...extra } as never),
    ).rejects.toThrow();
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, { ...args, tenantId: "b" }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, { ...args, verticalId: "hr" }),
  ).rejects.toThrow("NOT_FOUND");
  const rows = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toEqual({
    candidateId,
    verticalId: "legal",
    event: "blocked",
    reason: "not_released",
  });
  expect(JSON.stringify(rows)).not.toContain("Private person's clause");
  expect(
    (await t.withIdentity({ subject: "a" }).query(api.verticalPackTelemetry.summary, {}))
      .sampledEvents,
  ).toBe(1);
  expect(
    (await t.withIdentity({ subject: "b" }).query(api.verticalPackTelemetry.summary, {}))
      .sampledEvents,
  ).toBe(0);
});

test("aggregate samples are bounded and mark truncation without exposing payloads", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: "seed",
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: i,
        payload: { event: "blocked", verticalId: "legal" },
      });
    await ctx.db.insert("audit", {
      tenantId: "b",
      correlationId: "seed",
      eventType: "vertical_pack.outcome",
      actor: "system",
      ts: 999,
      payload: { event: "run_completed", verticalId: "hr" },
    });
  });
  const summary = await t
    .withIdentity({ subject: "a" })
    .query(api.verticalPackTelemetry.summary, {});
  expect(summary).toMatchObject({
    partial: true,
    sampledEvents: 200,
    counts: { blocked: 200, run_completed: 0 },
  });
  expect(Object.keys(summary).sort()).toEqual(["counts", "partial", "sampledEvents"]);
});

test("repeat use is derived only from a second distinct ordinary artifact on one exact candidate", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const {
    candidateId,
    otherVersionId,
    firstId,
    previewId,
    otherVersionArtifactId,
    repeatId,
    foreignId,
  } = await t.run(async (ctx) => {
    const candidate = {
      tenantId: "a",
      name: verticalSkillName("product"),
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
    const candidateId = await ctx.db.insert("tenantSkills", { ...candidate, version: 1 });
    const otherVersionId = await ctx.db.insert("tenantSkills", { ...candidate, version: 2 });
    const document = {
      title: "Synthetic draft",
      kind: "document" as const,
      category: "workspace-docs" as const,
      source: "agent" as const,
      mimeType: "text/markdown",
      size: 12,
      contentHash: "synthetic",
      text: "Synthetic draft",
      status: "ready" as const,
      createdAt: 1,
    };
    const firstId = await ctx.db.insert("vaultDocuments", { tenantId: "a", ...document });
    const previewId = await ctx.db.insert("vaultDocuments", { tenantId: "a", ...document });
    const otherVersionArtifactId = await ctx.db.insert("vaultDocuments", {
      tenantId: "a",
      ...document,
    });
    const repeatId = await ctx.db.insert("vaultDocuments", { tenantId: "a", ...document });
    const foreignId = await ctx.db.insert("vaultDocuments", { tenantId: "b", ...document });
    return {
      candidateId,
      otherVersionId,
      firstId,
      previewId,
      otherVersionArtifactId,
      repeatId,
      foreignId,
    };
  });
  const base = {
    tenantId: "a",
    verticalId: "product" as const,
    candidateId,
    event: "artifact_created" as const,
  };
  await t.mutation(internal.verticalPackTelemetry.record, { ...base, artifactId: firstId });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    artifactId: previewId,
    preview: true,
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    candidateId: otherVersionId,
    artifactId: otherVersionArtifactId,
  });
  expect(
    (await t.withIdentity({ subject: "a" }).query(api.verticalPackTelemetry.summary, {})).counts
      .repeat_use,
  ).toBe(0);
  await t.mutation(internal.verticalPackTelemetry.record, { ...base, artifactId: repeatId });
  await t.mutation(internal.verticalPackTelemetry.record, { ...base, artifactId: repeatId });
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, { ...base, artifactId: foreignId }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "repeat_use",
      artifactId: repeatId,
    }),
  ).rejects.toThrow("REPEAT_USE_DERIVED_ONLY");
  const summary = await t
    .withIdentity({ subject: "a" })
    .query(api.verticalPackTelemetry.summary, {});
  expect(summary.counts).toMatchObject({ artifact_created: 4, repeat_use: 1 });
  const rows = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(rows.filter((row) => row.payload?.event === "repeat_use")).toMatchObject([
    { payload: { candidateId, verticalId: "product", artifactId: repeatId } },
  ]);
  expect(JSON.stringify(rows)).not.toContain("Synthetic draft");
});

test("another candidate's events cannot evict exact-candidate artifact provenance", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const { candidateId, firstId, secondId } = await t.run(async (ctx) => {
    const candidateId = await ctx.db.insert("tenantSkills", {
      tenantId: "a",
      name: verticalSkillName("product"),
      version: 1,
      status: "candidate",
      rollbackEligible: false,
      body: "Synthetic candidate",
      authoredBody: "",
      author: "system",
      basedOnScope: "global",
      basedOnName: verticalSkillName("product"),
      basedOnVersion: 1,
      createdAt: 1,
    });
    const document = {
      tenantId: "a",
      title: "Synthetic draft",
      kind: "document" as const,
      category: "workspace-docs" as const,
      source: "agent" as const,
      mimeType: "text/markdown",
      size: 12,
      contentHash: "synthetic",
      text: "Synthetic draft",
      status: "ready" as const,
      createdAt: 1,
    };
    const firstId = await ctx.db.insert("vaultDocuments", document);
    const secondId = await ctx.db.insert("vaultDocuments", document);
    return { candidateId, firstId, secondId };
  });
  const base = { tenantId: "a", verticalId: "product" as const, candidateId };
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: firstId,
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: "other-candidate",
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: Date.now() + 1_000_000 + i,
        payload: { event: "blocked", verticalId: "product" },
      });
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "review_approved",
    actor: "user",
    artifactId: firstId,
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: secondId,
  });
  const rows = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(rows.filter((row) => row.payload?.event === "repeat_use")).toMatchObject([
    { payload: { candidateId, artifactId: secondId } },
  ]);
  expect(rows.filter((row) => row.payload?.event === "review_approved")).toHaveLength(1);
});

test("same-candidate history beyond 200 rows keeps exact origin, repeat use and replay", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const { candidateId, firstId, secondId } = await t.run(async (ctx) => {
    const candidateId = await ctx.db.insert("tenantSkills", {
      tenantId: "a",
      name: verticalSkillName("product"),
      version: 1,
      status: "candidate",
      rollbackEligible: false,
      body: "Synthetic candidate",
      authoredBody: "",
      author: "system",
      basedOnScope: "global",
      basedOnName: verticalSkillName("product"),
      basedOnVersion: 1,
      createdAt: 1,
    });
    const document = {
      tenantId: "a",
      title: "Synthetic draft",
      kind: "document" as const,
      category: "workspace-docs" as const,
      source: "agent" as const,
      mimeType: "text/markdown",
      size: 12,
      contentHash: "synthetic",
      text: "Synthetic draft",
      status: "ready" as const,
      createdAt: 1,
    };
    const firstId = await ctx.db.insert("vaultDocuments", document);
    const secondId = await ctx.db.insert("vaultDocuments", document);
    return { candidateId, firstId, secondId };
  });
  const base = { tenantId: "a", candidateId, verticalId: "product" as const };
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: firstId,
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: String(candidateId),
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: Date.now() + i,
        payload: { event: "blocked", verticalId: "product", candidateId },
      });
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "review_approved",
    actor: "user",
    artifactId: firstId,
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: secondId,
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: firstId,
  });
  const events = await t.run((ctx) =>
    ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", String(candidateId)))
      .collect(),
  );
  expect(events.filter((row) => row.payload?.event === "artifact_created")).toHaveLength(2);
  expect(events.filter((row) => row.payload?.event === "repeat_use")).toHaveLength(1);
  expect(events.filter((row) => row.payload?.event === "review_approved")).toHaveLength(1);
});

test("generic audit logging cannot mint an unindexed vertical origin", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await expect(
    t.mutation(internal.audit.log, {
      tenantId: "a",
      correlationId: "candidate-ref",
      eventType: "vertical_pack.outcome",
      actor: "system",
      payload: { event: "artifact_created", candidateId: "candidate-ref" },
    }),
  ).rejects.toThrow("RESERVED_EVIDENCE_NAMESPACE");
});

test("a mismatched vertical audit index cannot ground review provenance", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const { candidateId, artifactId } = await t.run(async (ctx) => {
    const candidateId = await ctx.db.insert("tenantSkills", {
      tenantId: "a",
      name: verticalSkillName("product"),
      version: 1,
      status: "candidate",
      rollbackEligible: false,
      body: "Synthetic candidate",
      authoredBody: "",
      author: "system",
      basedOnScope: "global",
      basedOnName: verticalSkillName("product"),
      basedOnVersion: 1,
      createdAt: 1,
    });
    const artifactId = await ctx.db.insert("vaultDocuments", {
      tenantId: "a",
      title: "Synthetic draft",
      kind: "document",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 12,
      contentHash: "synthetic",
      text: "Synthetic draft",
      status: "ready",
      createdAt: 1,
    });
    await ctx.db.insert("audit", {
      tenantId: "a",
      correlationId: String(candidateId),
      eventType: "vertical_pack.outcome",
      actor: "system",
      ts: 1,
      verticalEvent: "artifact_created",
      verticalPreview: false,
      verticalArtifactId: artifactId,
      payload: { event: "blocked", candidateId, verticalId: "product", artifactId },
    });
    return { candidateId, artifactId };
  });
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      tenantId: "a",
      candidateId,
      verticalId: "product",
      event: "review_approved",
      actor: "user",
      artifactId,
    }),
  ).rejects.toThrow("VERTICAL_AUDIT_INDEX_MISMATCH");
});

test("review observations require an owned artifact created by the exact native candidate", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const { candidateId, otherCandidateId, artifactId, foreignArtifactId } = await t.run(
    async (ctx) => {
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
      const otherCandidateId = await ctx.db.insert("tenantSkills", {
        ...candidate,
        version: 2,
      });
      const document = {
        title: "Synthetic draft",
        kind: "document" as const,
        category: "workspace-docs" as const,
        source: "agent" as const,
        mimeType: "text/markdown",
        size: 12,
        contentHash: "synthetic",
        text: "Synthetic draft",
        status: "ready" as const,
        createdAt: 1,
      };
      const artifactId = await ctx.db.insert("vaultDocuments", { tenantId: "a", ...document });
      const foreignArtifactId = await ctx.db.insert("vaultDocuments", {
        tenantId: "b",
        ...document,
      });
      return { candidateId, otherCandidateId, artifactId, foreignArtifactId };
    },
  );
  const base = { tenantId: "a", candidateId, verticalId: "product" as const };
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "review_approved",
    }),
  ).rejects.toThrow("ARTIFACT_REQUIRED");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "review_rejected",
      artifactId: foreignArtifactId,
    }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "review_edited",
      artifactId,
    }),
  ).rejects.toThrow("EDIT_REVISION_UNVERIFIED");
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId,
  });
  for (const event of ["review_approved", "review_rejected"] as const)
    await expect(
      t.mutation(internal.verticalPackTelemetry.record, { ...base, event, artifactId }),
    ).rejects.toThrow("USER_REVIEW_ACTOR_REQUIRED");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      candidateId: otherCandidateId,
      event: "review_approved",
      actor: "user",
      artifactId,
    }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  for (const event of ["review_approved", "review_rejected"] as const)
    await t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event,
      artifactId,
      actor: "user",
    });
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "review_edited",
      artifactId,
    }),
  ).rejects.toThrow("EDIT_REVISION_UNVERIFIED");
  expect(
    (await t.withIdentity({ subject: "a" }).query(api.verticalPackTelemetry.summary, {})).counts,
  ).toMatchObject({
    artifact_created: 1,
    review_approved: 1,
    review_edited: 0,
    review_rejected: 1,
  });
});

test("preview artifacts cannot ground non-preview review outcomes", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const { candidateId, previewArtifactId, productionArtifactId } = await t.run(async (ctx) => {
    const candidateId = await ctx.db.insert("tenantSkills", {
      tenantId: "a",
      name: verticalSkillName("product"),
      version: 1,
      status: "candidate",
      rollbackEligible: false,
      body: "Synthetic candidate",
      authoredBody: "",
      author: "system",
      basedOnScope: "global",
      basedOnName: verticalSkillName("product"),
      basedOnVersion: 1,
      createdAt: 1,
    });
    const document = {
      tenantId: "a",
      title: "Synthetic draft",
      kind: "document" as const,
      category: "workspace-docs" as const,
      source: "agent" as const,
      mimeType: "text/markdown",
      size: 12,
      contentHash: "synthetic",
      text: "Synthetic draft",
      status: "ready" as const,
      createdAt: 1,
    };
    const previewArtifactId = await ctx.db.insert("vaultDocuments", document);
    const productionArtifactId = await ctx.db.insert("vaultDocuments", document);
    return { candidateId, previewArtifactId, productionArtifactId };
  });
  const base = { tenantId: "a", candidateId, verticalId: "product" as const };
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: previewArtifactId,
    preview: true,
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "artifact_created",
    artifactId: productionArtifactId,
  });
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "review_approved",
      actor: "user",
      artifactId: previewArtifactId,
    }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, {
      ...base,
      event: "review_approved",
      actor: "user",
      artifactId: productionArtifactId,
      preview: true,
    }),
  ).rejects.toThrow("ARTIFACT_ORIGIN_UNVERIFIED");
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "review_approved",
    actor: "user",
    artifactId: previewArtifactId,
    preview: true,
  });
  await t.mutation(internal.verticalPackTelemetry.record, {
    ...base,
    event: "review_approved",
    actor: "user",
    artifactId: productionArtifactId,
  });
});
