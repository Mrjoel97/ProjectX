import {
  WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
  WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
  WEB_RECIPE_BROWSER_RUNNER,
  WEB_RECIPE_PROVENANCE_SCHEMA,
  WEB_RECIPE_REQUIRED_VIEWPORTS,
  WEB_RECIPE_UPSTREAM_PROVENANCE,
} from "@pikar/contracts/webRecipeSkill";
import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import { assessWebBrowserQuality } from "@pikar/core/webBrowserQuality";
import { renderDesignedWebDocument } from "@pikar/core/webDesignRenderer";
import { canonicalWebLayoutPlan } from "@pikar/core/webLayoutPlan";
import {
  canonicalWebRecipeDefinition,
  WEB_RECIPE_BUNDLE_HASH,
  WEB_RECIPE_COMPILER_ID,
  WEB_RECIPE_DEFINITIONS,
} from "@pikar/core/webRecipes";
import { canonicalWebDocument, sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  artifactHashes,
  canonicalEvidenceHash,
  presencePublicationReady,
  providerReceiptHash,
} from "./lib/presencePublication";
import { verifyRepairEvidence } from "./presenceBrowserRepair";
import schema from "./schema";
import { evaluateWebRecipeCandidate } from "./webRecipeEvals";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
async function setup(text = "Acme designs gardens for homeowners.") {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const threadId = "online-presence-test-thread";
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId, threadId });
  const session = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    threadId,
    planId,
    text,
  });
  const brief = {
    kind: "website",
    businessName: "Acme",
    headline: "Gardens designed around you",
    summary: "Garden design for homeowners.",
    audience: "Homeowners",
    sourceRefs: [session.sourceRef],
  };
  return { t, tenantId, threadId, planId, session, brief };
}
type Stack = Awaited<ReturnType<typeof setup>>;
/** OFFLINE provider fixture only. These hashes prove native finalization, never real provider
 * execution or browser quality. Production code cannot invoke this test helper. */
async function offlineProviderBuild(
  t: Stack["t"],
  args: {
    tenantId: string;
    planId: Id<"plans">;
    expectedRevision: number;
  },
) {
  const snapshot = await t.mutation(internal.onlinePresence.designSnapshot, args);
  if (!("document" in snapshot)) return t.mutation(internal.onlinePresence.buildProject, args);
  const digest = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
  const layoutPlan = canonicalWebLayoutPlan({
    version: 1,
    hero: "overlay-left",
    sectionLayout: "editorial-columns",
    services: "rows",
    gallery: "carousel",
    spacing: "relaxed",
    headingScale: "balanced",
    motion: "subtle",
  });
  const profile = { ...snapshot.recipeRef.designProfile, layoutPlan };
  if (!validateDesignProfileRef(profile)) throw Error("Invalid offline profile fixture");
  const runRef = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const identity = {
    tenantId: args.tenantId,
    planId: args.planId,
    revision: args.expectedRevision,
    runRef,
  };
  const stitchHash = digest("OFFLINE mocked Stitch reference"),
    kimiHash = digest("OFFLINE mocked Kimi plan");
  const hashes = artifactHashes(
    snapshot.document.pages.map((page) => ({
      pageSlug: page.slug,
      html: renderDesignedWebDocument(snapshot.document, profile, {
        slug: snapshot.slug,
        page: page.slug,
      }),
    })),
  );
  await t.mutation(makeFunctionReference<"mutation">("presenceDesignControl:claim"), {
    ...identity,
    workflow: true,
    sourceFingerprint: snapshot.sourceFingerprint,
  });
  await t.mutation(makeFunctionReference<"mutation">("presenceDesignControl:advance"), {
    ...identity,
    phase: "stitch_complete",
    designHash: stitchHash,
  });
  await t.mutation(makeFunctionReference<"mutation">("presenceDesignControl:advance"), {
    ...identity,
    phase: "kimi_complete",
    designHash: stitchHash,
    proposalHash: kimiHash,
    documentHash: sha256Bytes(new TextEncoder().encode(canonicalWebDocument(snapshot.document))),
    artifactsHash: digest(hashes),
  });
  return t.mutation(internal.onlinePresence.buildProject, {
    ...args,
    designCompletion: {
      profile,
      providerReceipt: {
        pipelineVersion: "stitch-kimi-required-v1",
        runRef,
        stitchHash,
        kimiHash,
        sourceFingerprint: snapshot.sourceFingerprint,
        briefHash: snapshot.briefHash,
        layoutHash: digest(layoutPlan),
        artifactHashes: hashes,
        pendingBrowser: true,
      },
    },
  });
}
async function _vault(t: Stack["t"], tenantId: string, overrides: Record<string, unknown> = {}) {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business facts",
      kind: "upload",
      category: "operations",
      source: "upload",
      mimeType: "text/plain",
      size: 40,
      contentHash: "a".repeat(64),
      text: "Acme designs gardens.",
      status: "ready",
      createdAt: Date.now(),
      ...overrides,
    }),
  );
}

/** Isolated database fixture only. These are test rows, never a deployed qualification receipt. */
async function activeRecipe(t: Stack["t"]) {
  const definition = WEB_RECIPE_DEFINITIONS.find((entry) => entry.id === "business-site");
  if (!definition) throw new Error("Missing business recipe");
  const id = await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: definition.registryName,
      version: 1,
      body: canonicalWebRecipeDefinition(definition),
      status: "active",
      createdAt: 1,
    }),
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("Missing recipe row");
  const evidence = evaluateWebRecipeCandidate(row, "online-presence-fixture", 1);
  const provenance = JSON.stringify({
    schemaVersion: WEB_RECIPE_PROVENANCE_SCHEMA,
    name: row.name,
    version: row.version,
    bodySha256: evidence.bodyHash,
    definitionHash: evidence.definitionHash,
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    compilerId: WEB_RECIPE_COMPILER_ID,
    skillVersions: { [row.name]: row.version },
    upstream: WEB_RECIPE_UPSTREAM_PROVENANCE[definition.registryName],
  });
  const browserEvidence = JSON.stringify({
    runner: WEB_RECIPE_BROWSER_RUNNER,
    runId: "online-presence-fixture",
    pass: true,
    authenticated: true,
    actorClass: "owner",
    route: "/ops",
    rendered: true,
    skillId: String(id),
    name: row.name,
    version: row.version,
    bodyHash: evidence.bodyHash,
    definitionHash: evidence.definitionHash,
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    evidenceRevision: WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
    viewports: WEB_RECIPE_REQUIRED_VIEWPORTS,
    casesPassed: 1,
    casesTotal: 1,
    revision: 1,
    outcomeRefs: WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
    transcriptHash: "b".repeat(64),
    ts: 1,
  });
  await t.run((ctx) =>
    ctx.db.patch(id, { evidence: JSON.stringify(evidence), provenance, browserEvidence }),
  );
}

const repairApply = makeFunctionReference<"mutation">("presenceBrowserRepair:apply");
const digest = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
async function repairFixture() {
  const f = await setup();
  await activeRecipe(f.t);
  const saved = await f.t.mutation(internal.onlinePresence.saveBrief, {
    tenantId: f.tenantId,
    planId: f.planId,
    expectedRevision: f.session.revision,
    brief: f.brief,
  });
  await offlineProviderBuild(f.t, {
    tenantId: f.tenantId,
    planId: f.planId,
    expectedRevision: saved.revision,
  });
  const version = await f.t.run(
    async (ctx) => (await ctx.db.query("webProjectVersions").collect())[0]!,
  );
  const visionStorageId = await f.t.run((ctx) => ctx.storage.store(new Blob(["offline"])));
  const layoutPlan = canonicalWebLayoutPlan({
    ...version.recipeRef!.designProfile.layoutPlan!,
    spacing: "compact",
  });
  const args = {
    tenantId: f.tenantId,
    projectId: version.projectId,
    version: version.version,
    layoutPlan,
    visionEvidenceHash: "a".repeat(64),
    visionStorageId,
    reportHash: "b".repeat(64),
  };
  await f.t.run((ctx) =>
    ctx.db.patch(version._id, {
      browserReviewVisionStorageId: visionStorageId,
      browserReviewJob: { state: "completed", runRef: "offline", startedAt: 1 },
      browserReview: {
        contentHash: version.contentHash,
        providerReceiptHash: providerReceiptHash(version.providerReceipt!),
        artifactHashes: version.providerReceipt!.artifactHashes,
        status: "failed",
        reportHash: args.reportHash,
        checkedAt: 1,
      },
    }),
  );
  return { ...f, version, args };
}
test("one repair appends a private immutable version and schedules fresh review; repeat is refused", async () => {
  const { t, args, version, planId } = await repairFixture();
  const result = await t.mutation(repairApply, args);
  expect(result).toEqual({ status: "repaired", version: 2 });
  const next = await t.run(
    async (ctx) =>
      (await ctx.db.query("webProjectVersions").collect()).find((v) => v.version === 2)!,
  );
  expect(next.document).toEqual(version.document);
  expect(next.sourceRefs).toEqual(version.sourceRefs);
  expect(next.providerReceipt?.repair).toEqual({
    priorVersion: 1,
    attempt: 1,
    visionEvidenceHash: args.visionEvidenceHash,
  });
  expect(next.providerReceipt?.kimiHash).toBe(version.providerReceipt?.kimiHash);
  expect(next.browserReview).toBeUndefined();
  expect(presencePublicationReady(next)).toBe(false);
  const context = await t.query(internal.onlinePresence.contextForTenant, {
    tenantId: args.tenantId,
    planId,
  });
  expect(context.revision).toBeGreaterThan(1);
  await expect(t.mutation(repairApply, args)).rejects.toThrow("PRESENCE_REPAIR_STALE");
  await t.run((ctx) =>
    ctx.db.patch(next._id, {
      browserReviewVisionStorageId: args.visionStorageId,
      browserReviewJob: { state: "completed", runRef: "offline", startedAt: 1 },
      browserReview: {
        ...version.browserReview!,
        contentHash: next.contentHash,
        providerReceiptHash: providerReceiptHash(next.providerReceipt!),
        artifactHashes: next.providerReceipt!.artifactHashes,
        status: "failed",
        reportHash: args.reportHash,
        checkedAt: 1,
      },
    }),
  );
  await expect(t.mutation(repairApply, { ...args, version: 2 })).rejects.toThrow(
    "PRESENCE_REPAIR_UNAVAILABLE",
  );
});
test("foreign tenant, stale evidence and changed authoritative sources cannot append repairs", async () => {
  const { t, args, planId, tenantId, threadId } = await repairFixture();
  await expect(t.mutation(repairApply, { ...args, tenantId: "foreign" })).rejects.toThrow(
    "PRESENCE_REPAIR_STALE",
  );
  await expect(t.mutation(repairApply, { ...args, reportHash: "c".repeat(64) })).rejects.toThrow(
    "PRESENCE_REPAIR_UNAVAILABLE",
  );
  await t.run(async (ctx) => {
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_plan", (q) => q.eq("tenantId", tenantId).eq("planId", planId))
      .unique();
    if (!session) throw Error("fixture");
    await ctx.db.patch(session._id, {
      sourceSnapshots: session.sourceSnapshots!.map((s) => ({ ...s, revision: "changed" })),
    });
  });
  await expect(t.mutation(repairApply, args)).rejects.toThrow("PRESENCE_REPAIR_SOURCES_CHANGED");
  expect(await t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toHaveLength(1);
});
test("repair evidence must match exact persisted report, screenshots and closed proposal", async () => {
  const { version, args } = await repairFixture();
  const reports: never[] = [];
  const fidelity = { matched: false, evidenceHash: "a".repeat(64) },
    visualContrast = { passed: false, evidenceHash: "a".repeat(64) };
  const bound = {
    ...version,
    providerReceipt: version.providerReceipt!,
    browserReviewScreenshots: [{ sha256: "c".repeat(64) }],
    browserReview: {
      reportHash: canonicalEvidenceHash({
        reports,
        fidelity,
        visualContrast,
        assessment: assessWebBrowserQuality({
          pageSlugs: version.providerReceipt!.artifactHashes.map((p) => p.pageSlug),
          reports,
        }),
      }),
    },
  };
  const vision = {
    repairPlan: args.layoutPlan,
    fidelity,
    visualContrast,
    contentHash: version.contentHash,
    providerReceiptHash: providerReceiptHash(version.providerReceipt!),
    screenshotHashes: ["c".repeat(64)],
  };
  expect(verifyRepairEvidence(bound, vision, { reports }).layoutPlan).toEqual(args.layoutPlan);
  for (const altered of [
    { ...vision, contentHash: "bad" },
    { ...vision, screenshotHashes: [] },
    { ...vision, repairPlan: { ...args.layoutPlan, css: "bad" } },
    { ...vision, fidelity: { ...fidelity, evidenceHash: "d".repeat(64) } },
  ])
    expect(() => verifyRepairEvidence(bound, altered, { reports })).toThrow();
  expect(() =>
    verifyRepairEvidence({ ...bound, browserReview: { reportHash: "0".repeat(64) } }, vision, {
      reports,
    }),
  ).toThrow();
});
test("action uses actual completed report and owned stored vision despite object key reordering", async () => {
  const { t, args, version } = await repairFixture();
  const fidelity = { matched: false, evidenceHash: "a".repeat(64) },
    visualContrast = { passed: false, evidenceHash: "a".repeat(64) };
  const reports: never[] = [];
  await t.mutation(makeFunctionReference<"mutation">("presenceBrowserReview:complete"), {
    tenantId: args.tenantId,
    versionId: version._id,
    contentHash: version.contentHash,
    providerReceiptHash: providerReceiptHash(version.providerReceipt!),
    artifactHashes: version.providerReceipt!.artifactHashes,
    reports,
    fidelity,
    visualContrast,
  });
  // Stored JSON retains insertion order, unlike Convex argument rehydration.
  const vision = {
    repairPlan: args.layoutPlan,
    fidelity: { evidenceHash: fidelity.evidenceHash, matched: false },
    visualContrast: { evidenceHash: visualContrast.evidenceHash, passed: false },
    contentHash: version.contentHash,
    providerReceiptHash: providerReceiptHash(version.providerReceipt!),
    screenshotHashes: ["f".repeat(64)],
  };
  const [visionId, captureId] = await t.run(async (ctx) =>
    Promise.all([
      ctx.storage.store(new Blob([JSON.stringify(vision)])),
      ctx.storage.store(new Blob([JSON.stringify({ reports })])),
    ]),
  );
  for (const storageId of [visionId!, captureId!])
    await t.mutation(internal.lib.tenantLifecycle.ownGeneratedStorage, {
      tenantId: args.tenantId,
      storageId,
    });
  await t.run((ctx) =>
    ctx.db.patch(version._id, {
      browserReviewVisionStorageId: visionId,
      browserReviewReportStorageId: captureId,
      browserReviewScreenshots: [
        {
          storageId: visionId!,
          pageSlug: "home",
          viewportWidth: 1440,
          reducedMotion: false,
          sha256: "f".repeat(64),
          mimeType: "image/jpeg",
        },
      ],
    }),
  );
  expect(
    await t.action(makeFunctionReference<"action">("presenceBrowserRepair:run"), {
      tenantId: args.tenantId,
      projectId: args.projectId,
      version: 1,
    }),
  ).toEqual({ status: "repaired", version: 2 });
});
