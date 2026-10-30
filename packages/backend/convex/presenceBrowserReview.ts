import { webAssetPath } from "@pikar/core/webAssets";
import { assessWebBrowserQuality, type WebBrowserPageReport } from "@pikar/core/webBrowserQuality";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import {
  artifactHashes,
  canonicalArtifactHashes,
  canonicalEvidenceHash,
  providerReceiptHash,
  validateProviderReceipt,
} from "./lib/presencePublication";
import { internalMutation } from "./lib/tenantLifecycle";
import { resolveDocumentAssets } from "./webAssets";

const scope = { tenantId: v.string(), versionId: v.id("webProjectVersions") };

/** Fresh owned inputs for the autonomous worker, including only immutable asset references. */
export const runtimeInputs = internalQuery({
  args: { tenantId: v.string(), projectId: v.id("webProjects"), version: v.number() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== args.tenantId || project.draftVersion !== args.version)
      return null;
    const version = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", args.tenantId).eq("projectId", args.projectId).eq("version", args.version),
      )
      .unique();
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", args.tenantId).eq("projectId", args.projectId),
      )
      .unique();
    if (
      !version?.providerReceipt ||
      !version.artifacts ||
      !session ||
      session.projectVersion !== args.version ||
      session.projectContentHash !== version.contentHash ||
      !version.recipeRef?.designProfile.layoutPlan
    )
      return null;
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    const snapshots = await resolveDocumentAssets(ctx, args.tenantId, version.document);
    const assets = await Promise.all(
      snapshots.map(async (asset) => {
        const row = await ctx.db.get(asset.assetId);
        if (!row || row.tenantId !== args.tenantId)
          throw Error("PRESENCE_REVIEW_ASSET_UNAVAILABLE");
        const url = await ctx.storage.getUrl(row.storageId);
        const path = webAssetPath(asset.assetRef, project.slug);
        const digest = /^sha256:([a-f0-9]{64})$/.exec(asset.contentHash)?.[1];
        if (!url || !path || !digest) throw Error("PRESENCE_REVIEW_ASSET_UNAVAILABLE");
        return { path, url, sha256: digest, mimeType: asset.mimeType };
      }),
    );
    return {
      versionId: version._id,
      document: version.document,
      contentHash: version.contentHash,
      providerReceiptHash: providerReceiptHash(version.providerReceipt),
      providerReceipt: version.providerReceipt,
      artifacts: version.artifacts,
      routeSlug: project.slug,
      assets,
      planId: session.planId,
      revision: session.revision,
      layoutPlan: version.recipeRef.designProfile.layoutPlan,
      job: version.browserReviewJob,
      review: version.browserReview,
    };
  },
});

export const claim = internalMutation({
  args: { ...scope, runRef: v.string(), contentHash: v.string(), providerReceiptHash: v.string() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      !version.providerReceipt ||
      version.contentHash !== args.contentHash ||
      providerReceiptHash(version.providerReceipt) !== args.providerReceiptHash
    )
      throw Error("PRESENCE_REVIEW_STALE");
    if (version.browserReviewJob) return false;
    await ctx.db.patch(version._id, {
      browserReviewJob: { runRef: args.runRef, state: "running", startedAt: Date.now() },
    });
    return true;
  },
});

export const recordCapture = internalMutation({
  args: {
    ...scope,
    runRef: v.string(),
    reportStorageId: v.id("_storage"),
    screenshots: v.array(
      v.object({
        storageId: v.id("_storage"),
        pageSlug: v.string(),
        viewportWidth: v.number(),
        reducedMotion: v.boolean(),
        sha256: v.string(),
        mimeType: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      version.browserReviewJob?.runRef !== args.runRef ||
      version.browserReviewJob.state !== "running"
    )
      throw Error("PRESENCE_REVIEW_JOB_UNAVAILABLE");
    if (!args.screenshots.length || args.screenshots.length > 24)
      throw Error("PRESENCE_REVIEW_CAPTURE_INVALID");
    for (const storageId of [
      args.reportStorageId,
      ...args.screenshots.map((image) => image.storageId),
    ]) {
      const owned = await ctx.db
        .query("uploadReceipts")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique();
      if (owned?.tenantId !== args.tenantId || owned.state !== "complete")
        throw Error("PRESENCE_REVIEW_CAPTURE_NOT_OWNED");
    }
    await ctx.db.patch(version._id, {
      browserReviewReportStorageId: args.reportStorageId,
      browserReviewScreenshots: args.screenshots,
      browserReviewJob: { ...version.browserReviewJob, state: "captured" },
    });
  },
});

export const finishJob = internalMutation({
  args: {
    ...scope,
    runRef: v.string(),
    state: v.union(v.literal("completed"), v.literal("failed")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      version.browserReviewJob?.runRef !== args.runRef
    )
      throw Error("PRESENCE_REVIEW_JOB_UNAVAILABLE");
    await ctx.db.patch(version._id, {
      browserReviewJob: {
        ...version.browserReviewJob,
        state: args.state,
        ...(args.reason ? { reason: args.reason.slice(0, 160) } : {}),
      },
    });
  },
});

export const recordVision = internalMutation({
  args: { ...scope, runRef: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    const receipt = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      version.browserReviewJob?.runRef !== args.runRef ||
      version.browserReviewJob.state !== "captured" ||
      receipt?.tenantId !== args.tenantId ||
      receipt.state !== "complete"
    )
      throw Error("PRESENCE_VISION_EVIDENCE_UNAVAILABLE");
    await ctx.db.patch(version._id, { browserReviewVisionStorageId: args.storageId });
  },
});

/** Private worker input: never exposes reference blobs or unapproved pages publicly. */
export const inputs = internalQuery({
  args: scope,
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      !version.providerReceipt ||
      !version.artifacts
    )
      return null;
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    return {
      versionId: version._id,
      contentHash: version.contentHash,
      providerReceiptHash: providerReceiptHash(version.providerReceipt),
      artifacts: version.artifacts,
      providerReceipt: version.providerReceipt,
    };
  },
});

/** Only a trusted server worker can submit reports. Client status flags are never accepted. */
export const complete = internalMutation({
  args: {
    ...scope,
    contentHash: v.string(),
    providerReceiptHash: v.string(),
    artifactHashes: v.array(v.object({ pageSlug: v.string(), contentHash: v.string() })),
    reports: v.any(),
    fidelity: v.object({ matched: v.boolean(), evidenceHash: v.string() }),
    // Separate trusted screenshot review for backgrounds that computed CSS cannot measure.
    visualContrast: v.optional(v.object({ passed: v.boolean(), evidenceHash: v.string() })),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      !version.providerReceipt ||
      !version.artifacts
    )
      throw Error("PRESENCE_REVIEW_SCOPE_MISMATCH");
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    const hashes = artifactHashes(version.artifacts);
    if (
      args.contentHash !== version.contentHash ||
      args.providerReceiptHash !== providerReceiptHash(version.providerReceipt) ||
      canonicalArtifactHashes(args.artifactHashes) !== canonicalArtifactHashes(hashes)
    )
      throw Error("PRESENCE_REVIEW_STALE");
    if (
      !Array.isArray(args.reports) ||
      args.reports.length > 150 ||
      !/^[a-f0-9]{64}$/.test(args.fidelity.evidenceHash) ||
      (args.visualContrast !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.visualContrast.evidenceHash))
    )
      throw Error("PRESENCE_REVIEW_INVALID");
    const assessment = assessWebBrowserQuality({
      pageSlugs: hashes.map((page) => page.pageSlug),
      reports: args.reports as WebBrowserPageReport[],
    });
    const visualContrastResolved =
      assessment.status === "needs_review" &&
      assessment.issues.length > 0 &&
      assessment.issues.every(
        (issue) =>
          issue.code === "contrast_needs_visual_review" && issue.severity === "needs_review",
      ) &&
      args.visualContrast?.passed === true;
    const status =
      (assessment.status === "pass" || visualContrastResolved) &&
      args.fidelity.matched &&
      args.visualContrast?.passed !== false
        ? ("passed" as const)
        : ("failed" as const);
    const reportHash = canonicalEvidenceHash({
      reports: args.reports,
      fidelity: args.fidelity,
      visualContrast: args.visualContrast,
      assessment,
    });
    await ctx.db.patch(version._id, {
      browserReview: {
        contentHash: version.contentHash,
        providerReceiptHash: args.providerReceiptHash,
        artifactHashes: hashes,
        status,
        reportHash,
        checkedAt: Date.now(),
      },
    });
    return { status, assessment };
  },
});
