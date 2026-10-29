import { inspectWebAssetBytes } from "@pikar/core/webAssets";
import type { WebBrowserPageReport } from "@pikar/core/webBrowserQuality";
import { materializeWebRecipeWithProvenance } from "@pikar/core/webRecipes";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
  artifactHashes,
  presencePublicationReady,
  providerReceiptHash,
} from "./lib/presencePublication";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const inputs = makeFunctionReference<"query">("presenceBrowserReview:inputs");
const complete = makeFunctionReference<"mutation">("presenceBrowserReview:complete");
// Synthetic browser measurements exercise admission only, never deployed visual evidence.
function reports(): WebBrowserPageReport[] {
  return [
    { width: 1440, reduced: false },
    { width: 390, reduced: false },
    { width: 390, reduced: true },
  ].map((mode) => ({
    version: "web-browser-quality-v1",
    pageSlug: "home",
    pathname: "/p/fixture/home",
    viewportWidth: mode.width,
    documentWidth: mode.width,
    reducedMotion: mode.reduced,
    complete: true,
    readyState: "complete",
    images: { total: 1, loaded: 1, missingAlt: 0 },
    headings: { h1: 1, empty: 0, clipped: 0 },
    links: { total: 1, brokenAnchors: [], hrefs: ["/p/fixture/home"] },
    touchTargets: { total: 1, tooSmall: 0 },
    textContrast: { checked: 2, failed: 0, unknown: 0, minimumRatio: 7 },
    motion: {
      activeAnimations: 0,
      nontrivialDurations: mode.reduced ? 0 : 1,
      smoothScroll: !mode.reduced,
    },
  }));
}
async function fixture() {
  const t = convexTest(schema, modules);
  const tenantId = "offline-browser-review-tenant";
  const artifacts = [
    {
      pageSlug: "home",
      html: "<!doctype html><html><body><h1>Offline fixture</h1></body></html>",
      byteLength: 75,
    },
  ];
  const receipt = {
    pipelineVersion: "stitch-kimi-required-v1" as const,
    runRef: "offline-review-1",
    stitchHash: "a".repeat(64),
    kimiHash: "b".repeat(64),
    sourceFingerprint: "c".repeat(64),
    briefHash: "d".repeat(64),
    layoutHash: "e".repeat(64),
    artifactHashes: artifactHashes(artifacts),
    pendingBrowser: true as const,
  };
  const versionId = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("webProjects", {
      tenantId,
      kind: "site",
      slug: "fixture",
      title: "Offline fixture",
      publicHost: "fixture.invalid",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return ctx.db.insert("webProjectVersions", {
      tenantId,
      projectId,
      version: 1,
      document: {},
      contentHash: "f".repeat(64),
      rendererVersion: "offline-fixture",
      artifacts,
      artifactByteLength: 75,
      createdBy: tenantId,
      createdAt: 1,
      sourceRefs: [],
      providerReceipt: receipt,
      requiresProviderReview: true,
    });
  });
  const args = {
    tenantId,
    versionId,
    contentHash: "f".repeat(64),
    providerReceiptHash: providerReceiptHash(receipt),
    artifactHashes: artifactHashes(artifacts),
    reports: reports(),
    fidelity: { matched: true, evidenceHash: "1".repeat(64) },
  };
  const ready = async () => {
    const version = await t.run((ctx) => ctx.db.get(versionId));
    if (!version) throw Error("Offline fixture missing");
    return presencePublicationReady(version);
  };
  return { t, args, ready };
}

test("private review inputs and completion enforce tenant isolation", async () => {
  const { t, args, ready } = await fixture();
  expect(await t.query(inputs, { tenantId: "other", versionId: args.versionId })).toBeNull();
  await expect(t.mutation(complete, { ...args, tenantId: "other" })).rejects.toThrow(
    "SCOPE_MISMATCH",
  );
  expect(await ready()).toBe(false);
  expect(
    await t.query(inputs, { tenantId: args.tenantId, versionId: args.versionId }),
  ).toMatchObject({ contentHash: args.contentHash, providerReceiptHash: args.providerReceiptHash });
});
test("stale content, artifact and provider receipt identities cannot qualify", async () => {
  const { t, args, ready } = await fixture();
  for (const patch of [
    { contentHash: "0".repeat(64) },
    { providerReceiptHash: "0".repeat(64) },
    { artifactHashes: [{ pageSlug: "home", contentHash: "0".repeat(64) }] },
  ]) {
    await expect(t.mutation(complete, { ...args, ...patch })).rejects.toThrow("REVIEW_STALE");
  }
  expect(await ready()).toBe(false);
});
test("missing or incomplete browser reports never pass even when fidelity is marked matched", async () => {
  const { t, args, ready } = await fixture();
  for (const evidence of [[], reports().slice(0, 2)]) {
    expect(await t.mutation(complete, { ...args, reports: evidence })).toMatchObject({
      status: "failed",
    });
    expect(await ready()).toBe(false);
  }
  await expect(t.mutation(complete, { ...args, reports: { status: "passed" } })).rejects.toThrow(
    "REVIEW_INVALID",
  );
});
test("unknown contrast and unmatched design fidelity remain unqualified", async () => {
  const { t, args, ready } = await fixture();
  const unknown = reports().map((report) => ({
    ...report,
    textContrast: { ...report.textContrast, unknown: 1 },
  }));
  expect(await t.mutation(complete, { ...args, reports: unknown })).toMatchObject({
    status: "failed",
    assessment: { status: "needs_review" },
  });
  expect(await ready()).toBe(false);
  expect(
    await t.mutation(complete, { ...args, fidelity: { ...args.fidelity, matched: false } }),
  ).toMatchObject({ status: "failed" });
  expect(await ready()).toBe(false);
});
test("complete synthetic desktop/mobile/reduced reports bind exact bytes for publication gating", async () => {
  const { t, args, ready } = await fixture();
  expect(await ready()).toBe(false);
  expect(await t.mutation(complete, args)).toMatchObject({
    status: "passed",
    assessment: { status: "pass" },
  });
  expect(await ready()).toBe(true);
  const version = await t.run((ctx) => ctx.db.get(args.versionId));
  if (!version) throw Error("Offline fixture missing");
  expect(version.browserReview?.reportHash).toMatch(/^[a-f0-9]{64}$/);
  expect(presencePublicationReady({ ...version, contentHash: "0".repeat(64) })).toBe(false);
  expect(
    presencePublicationReady({ ...version, artifacts: [{ pageSlug: "home", html: "edited" }] }),
  ).toBe(false);
});

test("separate trusted visual contrast evidence can resolve only unknown photographic contrast", async () => {
  const { t, args, ready } = await fixture();
  const unknown = reports().map((report) => ({
    ...report,
    textContrast: { ...report.textContrast, unknown: 1 },
  }));
  const visualContrast = { passed: true, evidenceHash: "2".repeat(64) };
  expect(await t.mutation(complete, { ...args, reports: unknown, visualContrast })).toMatchObject({
    status: "passed",
    assessment: { status: "needs_review" },
  });
  expect(await ready()).toBe(true);
  const first = await t.run((ctx) => ctx.db.get(args.versionId));
  await t.mutation(complete, {
    ...args,
    reports: unknown,
    visualContrast: { ...visualContrast, evidenceHash: "3".repeat(64) },
  });
  const second = await t.run((ctx) => ctx.db.get(args.versionId));
  expect(second?.browserReview?.reportHash).not.toBe(first?.browserReview?.reportHash);
  expect(
    await t.mutation(complete, {
      ...args,
      reports: unknown,
      visualContrast,
      fidelity: { ...args.fidelity, matched: false },
    }),
  ).toMatchObject({ status: "failed" });
  expect(await ready()).toBe(false);
});

test("visual contrast evidence never overrides failed measurements or an adverse visual finding", async () => {
  const { t, args, ready } = await fixture();
  const visualContrast = { passed: true, evidenceHash: "2".repeat(64) };
  const failed = reports().map((report) => ({
    ...report,
    documentWidth: report.viewportWidth + 40,
    textContrast: { ...report.textContrast, unknown: 1 },
  }));
  expect(await t.mutation(complete, { ...args, reports: failed, visualContrast })).toMatchObject({
    status: "failed",
    assessment: { status: "fail" },
  });
  expect(await ready()).toBe(false);
  expect(
    await t.mutation(complete, { ...args, visualContrast: { ...visualContrast, passed: false } }),
  ).toMatchObject({ status: "failed" });
  expect(await ready()).toBe(false);
});

test("malformed visual contrast evidence cannot write a passing receipt", async () => {
  const { t, args, ready } = await fixture();
  for (const evidenceHash of ["", "not-a-hash", "z".repeat(64), "2".repeat(63)]) {
    await expect(
      t.mutation(complete, { ...args, visualContrast: { passed: true, evidenceHash } }),
    ).rejects.toThrow("REVIEW_INVALID");
  }
  expect(await ready()).toBe(false);
});

test("runtime asset inputs expose the raw verified digest matching the immutable asset path", async () => {
  const { t, args } = await fixture();
  const imageBytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const raster = inspectWebAssetBytes(imageBytes, "image/png");
  const seeded = await t.run(async (ctx) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw Error("Offline fixture missing");
    const storageId = await ctx.storage.store(new Blob([imageBytes], { type: "image/png" }));
    const vaultDocumentId = await ctx.db.insert("vaultDocuments", {
      tenantId: args.tenantId,
      title: "Owned image",
      kind: "upload",
      category: "media",
      source: "upload",
      mimeType: "image/png",
      storageId,
      contentHash: raster.contentHash,
      size: imageBytes.length,
      status: "ready",
      createdAt: 1,
    });
    const assetId = await ctx.db.insert("webAssets", {
      tenantId: args.tenantId,
      vaultDocumentId,
      storageId,
      sourceRevision: "fixture-v1",
      ...raster,
      title: "Owned image",
      createdAt: 1,
    });
    const assetRef = `webasset:${assetId}:${raster.contentHash.slice(7)}`;
    const materialized = materializeWebRecipeWithProvenance("business-site", {
      brandName: "Fixture",
      headline: "Owned image",
      summary: "A fixture",
      services: ["Design"],
      about: "A fixture business",
      contactConsent: "I agree to hear from the publisher.",
    });
    await ctx.db.patch(version._id, {
      document: {
        ...materialized.document,
        pages: [
          {
            ...materialized.document.pages[0],
            nodes: [
              { kind: "media", storageRef: assetRef, alt: "Owned test image", placement: "hero" },
            ],
          },
        ],
      },
      recipeRef: {
        name: "web-recipe-business-site",
        version: 1,
        skillId: "fixture",
        bodyHash: "a".repeat(64),
        definitionHash: "b".repeat(64),
        inputHash: materialized.inputHash,
        designProfile: {
          ...materialized.designProfile,
          layoutPlan: {
            version: 1,
            hero: "overlay-left",
            sectionLayout: "stacked",
            services: "rows",
            gallery: "grid",
            spacing: "relaxed",
            headingScale: "balanced",
            motion: "subtle",
          },
        },
      },
    });
    await ctx.db.patch(version.projectId, { draftVersion: 1 });
    const planId = await ctx.db.insert("plans", {
      tenantId: args.tenantId,
      threadId: "asset-review",
      status: "collecting",
      createdAt: 1,
    });
    await ctx.db.insert("onlinePresenceSessions", {
      tenantId: args.tenantId,
      planId,
      threadId: "asset-review",
      revision: 1,
      humanMessages: [],
      status: "awaiting_review",
      projectId: version.projectId,
      projectVersion: 1,
      projectContentHash: version.contentHash,
      createdAt: 1,
      updatedAt: 1,
    });
    return { projectId: version.projectId, assetId };
  });
  const result = await t.query(
    makeFunctionReference<"query">("presenceBrowserReview:runtimeInputs"),
    { tenantId: args.tenantId, projectId: seeded.projectId, version: 1 },
  );
  expect(result?.assets).toHaveLength(1);
  expect(result.assets[0]).toMatchObject({
    sha256: raster.contentHash.slice(7),
    path: `/p/fixture/assets/${seeded.assetId}/${raster.contentHash.slice(7)}`,
    mimeType: "image/png",
  });
  expect(result.assets[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.assets[0].url).toBeTruthy();
  await t.run((ctx) => ctx.db.patch(seeded.assetId, { tenantId: "other" }));
  await expect(
    t.query(makeFunctionReference<"query">("presenceBrowserReview:runtimeInputs"), {
      tenantId: args.tenantId,
      projectId: seeded.projectId,
      version: 1,
    }),
  ).rejects.toThrow("WEB_ASSET_UNAVAILABLE");
});
