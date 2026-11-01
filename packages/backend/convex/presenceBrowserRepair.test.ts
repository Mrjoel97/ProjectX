import {
  WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
  WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
  WEB_RECIPE_BROWSER_RUNNER,
  WEB_RECIPE_PROVENANCE_SCHEMA,
  WEB_RECIPE_REQUIRED_VIEWPORTS,
  WEB_RECIPE_UPSTREAM_PROVENANCE,
} from "@pikar/contracts/webRecipeSkill";
import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import { assessWebBrowserQuality, type WebBrowserPageReport } from "@pikar/core/webBrowserQuality";
import {
  renderDesignedWebDocument,
  WEB_DESIGN_RENDERER_VERSION,
} from "@pikar/core/webDesignRenderer";
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
import {
  verifyRendererRepairEvidence,
  verifyRepairEvidence,
  verifySplitRendererRepairEvidence,
} from "./presenceBrowserRepair";
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
    split?: boolean;
  },
) {
  const { split, ...buildArgs } = args;
  const snapshot = await t.mutation(internal.onlinePresence.designSnapshot, buildArgs);
  if (!("document" in snapshot)) return t.mutation(internal.onlinePresence.buildProject, buildArgs);
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
  const profile = {
    ...snapshot.recipeRef.designProfile,
    layoutPlan: split
      ? canonicalWebLayoutPlan({
          ...layoutPlan,
          version: 2,
          hero: "split",
          designTokens: {
            colors: {
              paper: "#ffffff",
              card: "#ffffff",
              ink: "#111111",
              muted: "#555555",
              accent: "#552233",
              rule: "#dddddd",
            },
            typography: { heading: "editorial-serif", body: "humanist-sans" },
            spacing: { contentWidth: 1100, sectionGap: 64, copyMeasure: 60, heroMinHeight: 440 },
            footer: "light",
          },
        })
      : layoutPlan,
  };
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
    ...buildArgs,
    designCompletion: {
      profile,
      providerReceipt: {
        pipelineVersion: "stitch-kimi-required-v1",
        runRef,
        stitchHash,
        kimiHash,
        sourceFingerprint: snapshot.sourceFingerprint,
        briefHash: snapshot.briefHash,
        layoutHash: digest(profile.layoutPlan),
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
async function repairFixture(split = false) {
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
    split,
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

async function rendererRepairFixture(split = false) {
  const f = await repairFixture(split);
  const reports: WebBrowserPageReport[] = f.version.providerReceipt!.artifactHashes.flatMap(
    ({ pageSlug }) =>
      [
        { width: 1440, reduced: false },
        { width: 390, reduced: false },
        { width: 390, reduced: true },
      ].map((mode) => ({
        version: "web-browser-quality-v1",
        pageSlug,
        pathname: `/p/fixture/${pageSlug}`,
        viewportWidth: mode.width,
        documentWidth: mode.width,
        reducedMotion: mode.reduced,
        complete: true,
        readyState: "complete",
        images: { total: 1, loaded: 1, missingAlt: 0 },
        headings: { h1: 1, empty: 0, clipped: 0 },
        links: { total: 1, brokenAnchors: [], hrefs: [`/p/fixture/${pageSlug}`] },
        touchTargets: { total: 1, tooSmall: 1 },
        textContrast: { checked: 2, failed: 0, unknown: 1, minimumRatio: 7 },
        motion: { activeAnimations: 0, nontrivialDurations: 0, smoothScroll: false },
      })),
  );
  const screenshotHashes = reports.map((_r, i) => digest(i));
  const capture = {
    status: "captured",
    contentHash: f.version.contentHash,
    providerReceiptHash: providerReceiptHash(f.version.providerReceipt!),
    artifactHashes: f.version.providerReceipt!.artifactHashes,
    reports,
    screenshots: screenshotHashes.map((sha256) => ({ sha256 })),
  };
  const evidenceHash = digest(reports);
  await f.t.mutation(makeFunctionReference<"mutation">("presenceBrowserReview:complete"), {
    tenantId: f.tenantId,
    versionId: f.version._id,
    contentHash: f.version.contentHash,
    providerReceiptHash: capture.providerReceiptHash,
    artifactHashes: capture.artifactHashes,
    reports,
    fidelity: { matched: false, evidenceHash },
    visualContrast: { passed: false, evidenceHash },
  });
  const captureId = await f.t.run((ctx) => ctx.storage.store(new Blob([JSON.stringify(capture)])));
  await f.t.mutation(internal.lib.tenantLifecycle.ownGeneratedStorage, {
    tenantId: f.tenantId,
    storageId: captureId,
  });
  await f.t.run((ctx) =>
    ctx.db.patch(f.version._id, {
      rendererVersion: "web-design-renderer-v9",
      browserReviewVisionStorageId: undefined,
      browserReviewReportStorageId: captureId,
      recipeRef: { ...f.version.recipeRef!, rendererVersion: "web-design-renderer-v9" },
      browserReviewScreenshots: reports.map((r, i) => ({
        storageId: captureId,
        pageSlug: r.pageSlug!,
        viewportWidth: r.viewportWidth,
        reducedMotion: r.reducedMotion,
        sha256: screenshotHashes[i]!,
        mimeType: "image/jpeg",
      })),
    }),
  );
  const version = await f.t.run((ctx) => ctx.db.get(f.version._id));
  return {
    ...f,
    version: version!,
    capture,
    captureId,
    runArgs: { tenantId: f.tenantId, projectId: f.version.projectId, version: 1 },
  };
}

test("owned target-only browser failure rerenders once without vision and requires a fresh review", async () => {
  const f = await rendererRepairFixture();
  const run = makeFunctionReference<"action">("presenceBrowserRepair:run");
  expect(await f.t.action(run, f.runArgs)).toEqual({ status: "repaired", version: 2 });
  const versions = await f.t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  const old = versions.find((v) => v.version === 1)!,
    next = versions.find((v) => v.version === 2)!;
  expect(old).toEqual(f.version);
  expect(next.document).toEqual(old.document);
  expect(next.recipeRef).toEqual(old.recipeRef);
  expect(next.rendererVersion).toBe(WEB_DESIGN_RENDERER_VERSION);
  expect(next.providerReceipt?.rendererRepair).toEqual({
    priorVersion: 1,
    browserEvidenceHash: old.browserReview!.reportHash,
    rendererVersion: WEB_DESIGN_RENDERER_VERSION,
    attempt: 1,
  });
  expect(next.providerReceipt?.repair).toBeUndefined();
  expect(next.browserReview).toBeUndefined();
  expect(presencePublicationReady(next)).toBe(false);
  expect(await f.t.action(run, f.runArgs)).toEqual({ status: "stopped" });
  expect(await f.t.action(run, { ...f.runArgs, version: 2 })).toEqual({ status: "stopped" });
  expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});

test("renderer repair refuses unrelated failures, changed evidence and current renderer", async () => {
  const f = await rendererRepairFixture();
  const bound = {
    ...f.version,
    providerReceipt: f.version.providerReceipt!,
    browserReview: f.version.browserReview!,
  };
  expect(verifyRendererRepairEvidence(bound, f.capture)).toBe(f.version.browserReview!.reportHash);
  for (const capture of [
    { ...f.capture, contentHash: "changed" },
    { ...f.capture, screenshots: [] },
    {
      ...f.capture,
      reports: f.capture.reports.map((r) => ({ ...r, documentWidth: r.viewportWidth + 20 })),
    },
    {
      ...f.capture,
      reports: f.capture.reports.map((r) => ({ ...r, touchTargets: { total: 1, tooSmall: 0 } })),
    },
    { ...f.capture, artifactHashes: [] },
  ])
    expect(() => verifyRendererRepairEvidence(bound, capture)).toThrow(
      "PRESENCE_RENDERER_REPAIR_EVIDENCE_INVALID",
    );
  expect(() =>
    verifyRendererRepairEvidence(
      { ...bound, rendererVersion: WEB_DESIGN_RENDERER_VERSION },
      f.capture,
    ),
  ).toThrow();
  expect(() =>
    verifyRendererRepairEvidence(
      { ...bound, browserReview: { reportHash: "a".repeat(64) } },
      f.capture,
    ),
  ).toThrow();
});

test("renderer repair requires owned reports and unchanged authoritative sources", async () => {
  const f = await rendererRepairFixture();
  const run = makeFunctionReference<"action">("presenceBrowserRepair:run");
  expect(await f.t.action(run, { ...f.runArgs, tenantId: "foreign" })).toEqual({
    status: "stopped",
  });
  await f.t.run(async (ctx) => {
    const owned = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", f.captureId))
      .unique();
    await ctx.db.patch(owned!._id, { tenantId: "foreign" });
  });
  expect(await f.t.action(run, f.runArgs)).toEqual({ status: "stopped" });
  await f.t.run(async (ctx) => {
    const owned = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", f.captureId))
      .unique();
    await ctx.db.patch(owned!._id, { tenantId: f.tenantId });
    const session = await ctx.db.query("onlinePresenceSessions").first();
    await ctx.db.patch(session!._id, { sourceSnapshots: [{ ref: "source", revision: "changed" }] });
  });
  await expect(f.t.action(run, f.runArgs)).rejects.toThrow("PRESENCE_REPAIR_SOURCES_CHANGED");
  expect(await f.t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toHaveLength(1);
});

async function splitRepairFixture() {
  const f = await rendererRepairFixture(true);
  const reports = f.capture.reports.map((r) => ({ ...r, touchTargets: { total: 1, tooSmall: 0 } }));
  const capture = { ...f.capture, reports };
  const vision = {
    contentHash: f.version.contentHash,
    providerReceiptHash: capture.providerReceiptHash,
    screenshotHashes: capture.screenshots.map((s) => s.sha256),
    fidelity: { matched: false, evidenceHash: "e".repeat(64) },
    visualContrast: { passed: false, evidenceHash: "e".repeat(64) },
    issues: ["home: white split heading and excessive section gap"],
  };
  const ids = await f.t.run(async (ctx) => ({
    capture: await ctx.storage.store(new Blob([JSON.stringify(capture)])),
    vision: await ctx.storage.store(new Blob([JSON.stringify(vision)])),
  }));
  for (const storageId of Object.values(ids))
    await f.t.mutation(internal.lib.tenantLifecycle.ownGeneratedStorage, {
      tenantId: f.tenantId,
      storageId,
    });
  await f.t.mutation(makeFunctionReference<"mutation">("presenceBrowserReview:complete"), {
    tenantId: f.tenantId,
    versionId: f.version._id,
    contentHash: f.version.contentHash,
    providerReceiptHash: capture.providerReceiptHash,
    artifactHashes: capture.artifactHashes,
    reports,
    fidelity: vision.fidelity,
    visualContrast: vision.visualContrast,
  });
  await f.t.run((ctx) =>
    ctx.db.patch(f.version._id, {
      rendererVersion: "web-design-renderer-v12",
      recipeRef: { ...f.version.recipeRef!, rendererVersion: "web-design-renderer-v12" },
      browserReviewReportStorageId: ids.capture,
      browserReviewVisionStorageId: ids.vision,
    }),
  );
  const version = await f.t.run((ctx) => ctx.db.get(f.version._id));
  return { ...f, version: version!, capture, vision, ids };
}
test("known v12 split defect rerenders from owned failed vision without a model plan, preserving content", async () => {
  const f = await splitRepairFixture();
  expect(f.vision).not.toHaveProperty("repairPlan");
  if (
    !["web-design-renderer-v13", "web-design-renderer-v14"].includes(
      String(WEB_DESIGN_RENDERER_VERSION),
    )
  ) {
    expect(
      await f.t.action(makeFunctionReference<"action">("presenceBrowserRepair:run"), f.runArgs),
    ).toEqual({ status: "stopped" });
    return;
  }
  expect(
    await f.t.action(makeFunctionReference<"action">("presenceBrowserRepair:run"), f.runArgs),
  ).toEqual({ status: "repaired", version: 2 });
  const rows = await f.t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  const old = rows.find((v) => v.version === 1)!,
    next = rows.find((v) => v.version === 2)!;
  expect(old).toEqual(f.version);
  expect(next.document).toEqual(old.document);
  expect(next.recipeRef).toEqual(old.recipeRef);
  expect(next.providerReceipt?.layoutHash).toBe(old.providerReceipt?.layoutHash);
  expect(next.providerReceipt?.rendererRepair?.browserEvidenceHash).toBe(
    old.browserReview?.reportHash,
  );
  expect(next.browserReview).toBeUndefined();
  expect(presencePublicationReady(next)).toBe(false);
  expect(
    await f.t.action(makeFunctionReference<"action">("presenceBrowserRepair:run"), f.runArgs),
  ).toEqual({ status: "stopped" });
});
test("split upgrade rejects stale, unowned, current renderer and mismatched actual evidence", async () => {
  const f = await splitRepairFixture();
  if (
    ["web-design-renderer-v13", "web-design-renderer-v14"].includes(
      String(WEB_DESIGN_RENDERER_VERSION),
    )
  )
    expect(
      verifySplitRendererRepairEvidence(f.version, f.vision, f.capture).browserEvidenceHash,
    ).toBe(f.version.browserReview?.reportHash);
  else expect(() => verifySplitRendererRepairEvidence(f.version, f.vision, f.capture)).toThrow();
  for (const vision of [
    { ...f.vision, fidelity: { ...f.vision.fidelity, matched: true } },
    { ...f.vision, contentHash: "bad" },
    { ...f.vision, screenshotHashes: [] },
    { ...f.vision, issues: [] },
  ])
    expect(() => verifySplitRendererRepairEvidence(f.version, vision, f.capture)).toThrow();
  for (const capture of [
    { ...f.capture, artifactHashes: [] },
    { ...f.capture, screenshots: [] },
    { ...f.capture, reports: f.capture.reports.map((r) => ({ ...r, documentWidth: 2000 })) },
  ])
    expect(() => verifySplitRendererRepairEvidence(f.version, f.vision, capture)).toThrow();
  expect(() =>
    verifySplitRendererRepairEvidence(
      { ...f.version, rendererVersion: WEB_DESIGN_RENDERER_VERSION },
      f.vision,
      f.capture,
    ),
  ).toThrow();
  await f.t.run(async (ctx) => {
    const receipt = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", f.ids.vision))
      .unique();
    await ctx.db.patch(receipt!._id, { tenantId: "foreign" });
  });
  expect(
    await f.t.action(makeFunctionReference<"action">("presenceBrowserRepair:run"), f.runArgs),
  ).toEqual({ status: "stopped" });
});

async function footerFollowupFixture() {
  const f = await rendererRepairFixture(true);
  const receipt = {
    ...f.version.providerReceipt!,
    rendererRepair: {
      priorVersion: 1,
      browserEvidenceHash: "d".repeat(64),
      rendererVersion: "web-design-renderer-v13",
      attempt: 1 as const,
    },
  };
  const capture = { ...f.capture, providerReceiptHash: providerReceiptHash(receipt) };
  const captureId = await f.t.run((ctx) => ctx.storage.store(new Blob([JSON.stringify(capture)])));
  await f.t.mutation(internal.lib.tenantLifecycle.ownGeneratedStorage, {
    tenantId: f.tenantId,
    storageId: captureId,
  });
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.version._id, {
      version: 2,
      rendererVersion: "web-design-renderer-v13",
      providerReceipt: receipt,
      browserReviewReportStorageId: captureId,
      browserReview: {
        ...f.version.browserReview!,
        providerReceiptHash: providerReceiptHash(receipt),
      },
    });
    await ctx.db.patch(f.version.projectId, { draftVersion: 2 });
    const session = await ctx.db.query("onlinePresenceSessions").first();
    await ctx.db.patch(session!._id, { projectVersion: 2 });
  });
  const version = await f.t.run((ctx) => ctx.db.get(f.version._id));
  return { ...f, version: version!, capture, captureId, runArgs: { ...f.runArgs, version: 2 } };
}
test("one v13 footer follow-up appends v3 with attempt2 and leaves the previous draft immutable", async () => {
  const f = await footerFollowupFixture();
  const run = makeFunctionReference<"action">("presenceBrowserRepair:run");
  if (String(WEB_DESIGN_RENDERER_VERSION) !== "web-design-renderer-v14") {
    expect(await f.t.action(run, f.runArgs)).toEqual({ status: "stopped" });
    return;
  }
  expect(await f.t.action(run, f.runArgs)).toEqual({ status: "repaired", version: 3 });
  const rows = await f.t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  const old = rows.find((v) => v.version === 2)!,
    next = rows.find((v) => v.version === 3)!;
  expect(old).toEqual(f.version);
  expect(next.document).toEqual(old.document);
  expect(next.recipeRef).toEqual(old.recipeRef);
  expect(next.providerReceipt?.rendererRepair).toEqual({
    priorVersion: 2,
    browserEvidenceHash: old.browserReview!.reportHash,
    rendererVersion: "web-design-renderer-v14",
    attempt: 2,
  });
  expect(next.browserReview).toBeUndefined();
  expect(presencePublicationReady(next)).toBe(false);
  expect(await f.t.action(run, { ...f.runArgs, version: 3 })).toEqual({ status: "stopped" });
});
test("footer follow-up rejects other lineages, additional attempts and unrelated DOM failures", async () => {
  const f = await footerFollowupFixture();
  for (const prior of [
    { ...f.version.providerReceipt!.rendererRepair!, attempt: 2 },
    { ...f.version.providerReceipt!.rendererRepair!, rendererVersion: "web-design-renderer-v12" },
    { ...f.version.providerReceipt!.rendererRepair!, priorVersion: 2 },
  ]) {
    const version = {
      ...f.version,
      providerReceipt: { ...f.version.providerReceipt!, rendererRepair: prior },
    };
    expect(() => verifyRendererRepairEvidence(version as never, f.capture)).toThrow();
  }
  expect(() =>
    verifyRendererRepairEvidence(
      {
        ...f.version,
        providerReceipt: f.version.providerReceipt!,
        browserReview: f.version.browserReview!,
      },
      { ...f.capture, reports: f.capture.reports.map((r) => ({ ...r, documentWidth: 2000 })) },
    ),
  ).toThrow();
  const run = makeFunctionReference<"action">("presenceBrowserRepair:run");
  expect(await f.t.action(run, { ...f.runArgs, tenantId: "foreign" })).toEqual({
    status: "stopped",
  });
});

async function visualRevisionFixture() {
  const f = await repairFixture(true);
  await f.t.run((ctx) => ctx.db.patch(f.tenantId, { emailVerificationTime: 1 }));
  await f.t.run((ctx) =>
    ctx.db.patch(f.version._id, {
      rendererVersion: "web-design-renderer-v14",
      recipeRef: { ...f.version.recipeRef!, rendererVersion: "web-design-renderer-v14" },
    }),
  );
  const project = await f.t.run((ctx) => ctx.db.get(f.version.projectId));
  const session = await f.t.run((ctx) => ctx.db.query("onlinePresenceSessions").first());
  return {
    ...f,
    user: f.t.withIdentity({ subject: f.tenantId }),
    requestArgs: {
      projectId: f.version.projectId,
      expectedProjectRevision: project!.revision,
      expectedSessionRevision: session!.revision,
      expectedVersion: 1,
      expectedContentHash: f.version.contentHash,
    },
  };
}
test("explicit authenticated visual revision preserves design provenance and appends a pending new draft", async () => {
  const f = await visualRevisionFixture();
  const request = makeFunctionReference<"mutation">("presenceVisualRevision:request");
  const result = await f.user.mutation(request, f.requestArgs);
  expect(result.version).toBe(2);
  const rows = await f.t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  const old = rows.find((v) => v.version === 1)!,
    next = rows.find((v) => v.version === 2)!;
  expect(next.document).toEqual(old.document);
  expect(next.recipeRef).toEqual(old.recipeRef);
  expect(next.providerReceipt?.layoutHash).toBe(old.providerReceipt?.layoutHash);
  expect(next.providerReceipt?.rendererRevision).toEqual({
    priorVersion: 1,
    priorContentHash: old.contentHash,
    priorProviderReceiptHash: providerReceiptHash(old.providerReceipt!),
    rendererVersion: WEB_DESIGN_RENDERER_VERSION,
    requestedBy: f.tenantId,
  });
  expect(next.browserReview).toBeUndefined();
  expect(presencePublicationReady(next)).toBe(false);
  await expect(f.user.mutation(request, f.requestArgs)).rejects.toThrow("PRESENCE_REVISION_STALE");
});
test("visual revision rejects unauthenticated, foreign, stale, malformed lineage and changed sources", async () => {
  const f = await visualRevisionFixture();
  const request = makeFunctionReference<"mutation">("presenceVisualRevision:request");
  await expect(f.t.mutation(request, f.requestArgs)).rejects.toThrow("UNAUTHENTICATED");
  const other = await f.t.run((ctx) => ctx.db.insert("users", { emailVerificationTime: 1 }));
  await expect(
    f.t.withIdentity({ subject: other }).mutation(request, f.requestArgs),
  ).rejects.toThrow("PRESENCE_REVISION_UNAVAILABLE");
  for (const change of [
    { expectedContentHash: "wrong" },
    { expectedSessionRevision: 99 },
    { expectedProjectRevision: 99 },
  ])
    await expect(f.user.mutation(request, { ...f.requestArgs, ...change })).rejects.toThrow(
      "PRESENCE_REVISION_STALE",
    );
  await f.t.run((ctx) =>
    ctx.db.patch(f.version._id, {
      providerReceipt: { ...f.version.providerReceipt!, layoutHash: "a".repeat(64) },
    }),
  );
  await expect(f.user.mutation(request, f.requestArgs)).rejects.toThrow(
    "PRESENCE_REVISION_PROFILE_INVALID",
  );
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.version._id, { providerReceipt: f.version.providerReceipt });
    const session = await ctx.db.query("onlinePresenceSessions").first();
    await ctx.db.patch(session!._id, { sourceSnapshots: [{ ref: "bad", revision: "changed" }] });
  });
  await expect(f.user.mutation(request, f.requestArgs)).rejects.toThrow(
    "PRESENCE_REVISION_SOURCES_CHANGED",
  );
});
