import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  const tenantId = "customer-website";
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId, threadId: "website" });
  const session = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    planId,
    threadId: "website",
    text: "Build my business website",
  });
  return {
    t,
    args: {
      tenantId,
      model: "or/moonshotai/kimi-k3.1-pro",
      callId: crypto.randomUUID(),
      ceilingCents: 428,
      websiteDesign: { planId, revision: session.revision, runRef: "abc12345abc12345" },
    },
  };
}
test("ordinary tenant website call preserves unknown hold across new run identities", async () => {
  const { t, args } = await setup();
  const id = await t.mutation(internal.guardrails.reservePaidCall, args);
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).toMatchObject({ tenantId: "customer-website", amountCents: 428, phase: "reserved" });
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, {
      ...args,
      callId: crypto.randomUUID(),
      websiteDesign: { ...args.websiteDesign, runRef: "abc12345abc12346" },
    }),
  ).rejects.toThrow("PRIOR_HOLD");
  await t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: args.tenantId,
    reservationId: id,
    costUsd: 0.04,
  });
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, callId: crypto.randomUUID() }),
  ).resolves.toBeTruthy();
});
test("wrong tenant, stale revision and under-reservation refuse website authority", async () => {
  const { t, args } = await setup();
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, tenantId: "other" }),
  ).rejects.toThrow("CONTEXT_CHANGED");
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, {
      ...args,
      websiteDesign: { ...args.websiteDesign, revision: args.websiteDesign.revision + 1 },
    }),
  ).rejects.toThrow("CONTEXT_CHANGED");
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, ceilingCents: 1 }),
  ).rejects.toThrow("ADMISSION_INVALID");

  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});

test("vision-only ceiling requires the current captured job and rejects layout/purpose mismatches", async () => {
  const { t, args } = await setup();
  const visionArgs = {
    ...args,
    ceilingCents: 424,
    websiteDesign: { ...args.websiteDesign, purpose: "vision-review" as const },
  };
  await expect(t.mutation(internal.guardrails.reservePaidCall, visionArgs)).rejects.toThrow(
    "VISION_CONTEXT_INVALID",
  );
  const versionId = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("webProjects", {
      tenantId: args.tenantId,
      kind: "site",
      slug: "vision",
      title: "Vision",
      publicHost: "example.test",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      draftVersion: 1,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob(["capture"]));
    const id = await ctx.db.insert("webProjectVersions", {
      tenantId: args.tenantId,
      projectId,
      version: 1,
      document: {},
      contentHash: "a".repeat(64),
      rendererVersion: "web-design-renderer-v15",
      artifactByteLength: 1,
      createdBy: args.tenantId,
      createdAt: 1,
      sourceRefs: [],
      providerReceipt: {
        pipelineVersion: "stitch-kimi-required-v1",
        runRef: args.websiteDesign.runRef,
        stitchHash: "b".repeat(64),
        kimiHash: "c".repeat(64),
        sourceFingerprint: "d".repeat(64),
        briefHash: "e".repeat(64),
        layoutHash: "f".repeat(64),
        artifactHashes: [],
        pendingBrowser: true,
      },
      browserReviewReportStorageId: storageId,
      browserReviewJob: { runRef: args.websiteDesign.runRef, state: "captured", startedAt: 1 },
    });
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_plan", (q) =>
        q.eq("tenantId", args.tenantId).eq("planId", args.websiteDesign.planId),
      )
      .unique();
    await ctx.db.patch(session!._id, {
      projectId,
      projectVersion: 1,
      projectContentHash: "a".repeat(64),
    });
    return id;
  });
  for (const bad of [
    { ...visionArgs, ceilingCents: 428 },
    { ...args, ceilingCents: 424 },
    { ...visionArgs, websiteDesign: { ...visionArgs.websiteDesign, runRef: "abc12345abc12346" } },
  ]) {
    await expect(t.mutation(internal.guardrails.reservePaidCall, bad)).rejects.toThrow();
  }
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, {
      ...visionArgs,
      websiteDesign: { ...visionArgs.websiteDesign, purpose: "arbitrary" },
    } as never),
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
  const reservation = await t.mutation(internal.guardrails.reservePaidCall, visionArgs);
  expect(await t.run((ctx) => ctx.db.get(reservation))).toMatchObject({
    amountCents: 424,
    phase: "reserved",
  });
  await t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: args.tenantId,
    reservationId: reservation,
    costUsd: 0.02,
  });
  await t.run((ctx) =>
    ctx.db.patch(versionId, {
      browserReviewJob: { runRef: args.websiteDesign.runRef, state: "completed", startedAt: 1 },
    }),
  );
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...visionArgs, callId: crypto.randomUUID() }),
  ).rejects.toThrow("VISION_CONTEXT_INVALID");
});

test("ordinary Kimi admission remains available without a website context", async () => {
  const { t, args } = await setup();
  const { websiteDesign: _scope, ...unscoped } = args;
  const id = await t.mutation(internal.guardrails.reservePaidCall, unscoped);
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    phase: "reserved",
    model: args.model,
    amountCents: 428,
  });
});
test("combining website and managed-service scope is rejected before any reservation", async () => {
  const { t, args } = await setup();
  const runId = await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId: args.tenantId,
      serviceId: "social-marketing",
      revision: 1,
      controlRevision: 1,
      controlState: "active",
      goal: "fixture",
      operationIds: ["social.prepare"],
      accounts: [],
      skills: [],
      budgetLimitCents: 10,
      createdAt: 1,
      updatedAt: 1,
    });
    return ctx.db.insert("managedServiceRuns", {
      tenantId: args.tenantId,
      serviceId,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: 10,
      requestKey: "fixture",
      state: "running",
      threadId: "website",
      planId: args.websiteDesign.planId,
      turnId: "fixture",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, managedServiceRunId: runId }),
  ).rejects.toThrow("MODEL_SCOPE_INVALID");
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});
