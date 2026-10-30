// @vitest-environment node
import type { WebBrowserPageReport } from "@pikar/core/webBrowserQuality";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import limiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import {
  artifactHashes,
  providerReceiptHash,
  presencePublicationReady,
} from "./lib/presencePublication";
import { reviewPresenceScreenshots } from "./lib/presenceVisionReview";
import schema from "./schema";

// Browser measurements and vision transport are synthetic; no browser or model runs here.
// Durable jobs, generated-storage ownership, review completion and ordinary budgets are real.
const state = vi.hoisted(() => ({ source: null as any, snapshotOkay: true, capture: null as any }));
vi.mock("./presenceBrowserReview", async (original) => {
  const real = await original<typeof import("./presenceBrowserReview")>();
  const { internalQuery } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...real,
    runtimeInputs: internalQuery({
      args: { tenantId: v.string(), projectId: v.id("webProjects"), version: v.number() },
      handler: async () => state.source,
    }),
  };
});
vi.mock("./onlinePresence", async () => {
  const { internalMutation } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    designSnapshot: internalMutation({
      args: { tenantId: v.string(), planId: v.id("plans"), expectedRevision: v.number() },
      handler: async () => ({
        ok: state.snapshotOkay,
        artifact: { contentHash: state.snapshotOkay ? state.source.contentHash : "changed" },
      }),
    }),
  };
});
vi.mock("./lib/presenceVisionReview", () => ({ reviewPresenceScreenshots: vi.fn() }));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const limiters = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const run = makeFunctionReference<"action">("presenceBrowserRun:run");
const modes = [
  { width: 1440, reduced: false },
  { width: 390, reduced: false },
  { width: 390, reduced: true },
];
const reports = (): WebBrowserPageReport[] =>
  modes.map((mode) => ({
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
beforeEach(() => {
  state.snapshotOkay = true;
  state.source = null;
  state.capture = null;
  vi.stubEnv("PRESENCE_BROWSER_REVIEW_URL", "https://fixture.vercel.app/api/presence/review");
  vi.stubEnv("PRESENCE_BROWSER_REVIEW_SECRET", "s".repeat(32));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(state.capture)),
  );
  vi.mocked(reviewPresenceScreenshots).mockReset();
  vi.mocked(reviewPresenceScreenshots).mockImplementation(async (args) => {
    await args.beforeCall();
    const reservationId = await args.ctx.runMutation(internal.guardrails.reservePaidCall, {
      tenantId: args.tenantId,
      callId: crypto.randomUUID(),
      model: "or/moonshotai/kimi-k3.1-pro",
      ceilingCents: 428,
      websiteDesign: { planId: args.planId, revision: args.revision, runRef: args.runRef },
    });
    await args.ctx.runMutation(internal.guardrails.settlePaidCall, {
      tenantId: args.tenantId,
      reservationId,
      costUsd: 0.01,
    });
    return {
      fidelity: { matched: true, evidenceHash: "1".repeat(64) },
      visualContrast: { passed: true, evidenceHash: "2".repeat(64) },
      issues: [],
      costUsd: 0.01,
    };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", limiterSchema, limiters);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId, threadId: "browser-run" });
  const artifacts = [
    {
      pageSlug: "home",
      html: "<!doctype html><html><body><h1>Offline fixture</h1></body></html>",
      byteLength: 75,
    },
  ];
  const document = {
    kind: "site",
    title: "Offline fixture",
    brand: { name: "Fixture" },
    navigation: [{ label: "Home", path: "/home" }],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [{ kind: "hero", heading: "Only authoritative heading" }],
      },
    ],
  };
  const referenceId = await t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" })),
  );
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
    stitchImageStorageId: referenceId,
  };
  const projectId = await t.run((ctx) =>
    ctx.db.insert("webProjects", {
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
    }),
  );
  const versionId = await t.run((ctx) =>
    ctx.db.insert("webProjectVersions", {
      tenantId,
      projectId,
      version: 1,
      document,
      contentHash: "f".repeat(64),
      rendererVersion: "offline-fixture",
      artifacts,
      artifactByteLength: 75,
      createdBy: tenantId,
      createdAt: 1,
      sourceRefs: [],
      providerReceipt: receipt,
      requiresProviderReview: true,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("onlinePresenceSessions", {
      tenantId,
      planId,
      threadId: "browser-run",
      revision: 1,
      humanMessages: [],
      brief: { businessName: "Fixture" },
      sourceSnapshots: [{ ref: "fixture", revision: "v1" }],
      status: "awaiting_review",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  state.source = {
    versionId,
    document,
    contentHash: "f".repeat(64),
    providerReceiptHash: providerReceiptHash(receipt),
    providerReceipt: receipt,
    artifacts,
    routeSlug: "fixture",
    assets: [],
    planId,
    revision: 1,
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
  };
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  state.capture = {
    status: "captured",
    contentHash: state.source.contentHash,
    providerReceiptHash: state.source.providerReceiptHash,
    artifactHashes: artifactHashes(artifacts),
    reports: reports(),
    screenshots: modes.map((mode) => ({
      pageSlug: "home",
      viewportWidth: mode.width,
      reducedMotion: mode.reduced,
      mimeType: "image/jpeg",
      sha256: sha256Bytes(image),
      base64: Buffer.from(image).toString("base64"),
    })),
  };
  return { t, args: { tenantId, projectId, version: 1 }, versionId };
}
test("no worker configuration performs no HTTP, job claim or vision spending", async () => {
  const { t, args, versionId } = await setup();
  vi.stubEnv("PRESENCE_BROWSER_REVIEW_URL", "");
  expect(await t.action(run, args)).toEqual({
    status: "pending",
    reason: "browser_worker_unconfigured",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(reviewPresenceScreenshots).not.toHaveBeenCalled();
  expect((await t.run((ctx) => ctx.db.get(versionId)))?.browserReviewJob).toBeUndefined();
});
test("stale governing sources stop before worker HTTP", async () => {
  const { t, args, versionId } = await setup();
  state.snapshotOkay = false;
  expect((await t.action(run, args)).status).toBe("failed");
  expect(fetch).not.toHaveBeenCalled();
  expect(reviewPresenceScreenshots).not.toHaveBeenCalled();
  expect((await t.run((ctx) => ctx.db.get(versionId)))?.browserReviewJob?.state).toBe("failed");
});
test.each([
  "artifact",
  "screenshot",
])("wrong %s hash cannot become captured evidence or trigger vision", async (kind) => {
  const { t, args, versionId } = await setup();
  if (kind === "artifact") state.capture.artifactHashes[0].contentHash = "0".repeat(64);
  else state.capture.screenshots[0].sha256 = "0".repeat(64);
  expect((await t.action(run, args)).status).toBe("failed");
  expect(reviewPresenceScreenshots).not.toHaveBeenCalled();
  expect(
    (await t.run((ctx) => ctx.db.get(versionId)))?.browserReviewReportStorageId,
  ).toBeUndefined();
});
test("duplicate attempt does not capture or spend twice", async () => {
  const { t, args } = await setup();
  expect((await t.action(run, args)).status).toBe("passed");
  expect(await t.action(run, args)).toEqual({
    status: "pending",
    reason: "review_already_attempted",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(reviewPresenceScreenshots).toHaveBeenCalledTimes(1);
});
test("bad DOM measurements persist owned evidence but skip vision spend and remain private", async () => {
  const { t, args, versionId } = await setup();
  state.capture.reports[0].documentWidth = 1600;
  expect((await t.action(run, args)).status).toBe("failed");
  expect(reviewPresenceScreenshots).not.toHaveBeenCalled();
  const version = await t.run((ctx) => ctx.db.get(versionId));
  expect(version?.browserReview?.status).toBe("failed");
  expect(presencePublicationReady(version!)).toBe(false);
  const receipts = await t.run((ctx) => ctx.db.query("uploadReceipts").collect());
  expect(receipts.filter((r) => r.tenantId === args.tenantId)).toHaveLength(4);
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});
test("valid exact report plus billed vision passes with tenant-owned evidence", async () => {
  const { t, args, versionId } = await setup();
  expect((await t.action(run, args)).status).toBe("passed");
  expect(vi.mocked(reviewPresenceScreenshots).mock.calls[0]![0].authoritativeDocument).toEqual(
    state.source.document,
  );
  const version = await t.run((ctx) => ctx.db.get(versionId));
  expect(version?.browserReviewJob?.state).toBe("completed");
  expect(presencePublicationReady(version!)).toBe(true);
  const receipts = await t.run((ctx) => ctx.db.query("uploadReceipts").collect());
  expect(receipts.filter((r) => r.tenantId === args.tenantId)).toHaveLength(5);
  for (const storageId of [
    version!.browserReviewReportStorageId,
    version!.browserReviewVisionStorageId,
    ...version!.browserReviewScreenshots!.map((s) => s.storageId),
  ]) {
    expect(receipts.find((r) => r.storageId === storageId)).toMatchObject({
      tenantId: args.tenantId,
      state: "complete",
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
  }
  const spend = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(spend.some((row) => row.phase === "reserved" && row.tenantId === args.tenantId)).toBe(
    true,
  );
  expect(spend.some((row) => row.phase === "actual" && row.tenantId === args.tenantId)).toBe(true);
});
