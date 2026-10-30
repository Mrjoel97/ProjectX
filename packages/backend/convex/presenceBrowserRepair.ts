import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import { assessWebBrowserQuality } from "@pikar/core/webBrowserQuality";
import {
  renderDesignedWebDocumentBytes,
  WEB_DESIGN_RENDERER_VERSION,
} from "@pikar/core/webDesignRenderer";
import { canonicalWebLayoutPlan, validateWebLayoutPlan } from "@pikar/core/webLayoutPlan";
import { assessWebQuality } from "@pikar/core/webQuality";
import { sha256Bytes, validateWebDocument } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import {
  artifactHashes,
  canonicalArtifactHashes,
  canonicalEvidenceHash,
  providerReceiptHash,
  validateProviderReceipt,
} from "./lib/presencePublication";
import { internalAction, internalMutation, lifecycleActionContext } from "./lib/tenantLifecycle";
import { prepareRequiredDesign } from "./onlinePresence";
import { reviseProjectWithVersion } from "./webProjects";

const digest = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
const scope = { tenantId: v.string(), projectId: v.id("webProjects"), version: v.number() };
const inputsRef = makeFunctionReference<"query">("presenceBrowserRepair:inputs");
const applyRef = makeFunctionReference<"mutation">("presenceBrowserRepair:apply");
/** A single follow-up for the measured v13 footer hit-area regression; never a general retry. */
function isFooterRendererUpgrade(version: any) {
  const prior = version.providerReceipt?.rendererRepair;
  return (
    version.version === 2 &&
    version.rendererVersion === "web-design-renderer-v13" &&
    String(WEB_DESIGN_RENDERER_VERSION) === "web-design-renderer-v14" &&
    !version.providerReceipt?.repair &&
    prior?.attempt === 1 &&
    prior.rendererVersion === "web-design-renderer-v13" &&
    prior.priorVersion === 1 &&
    !version.browserReviewVisionStorageId
  );
}
export const inputs = internalQuery({
  args: scope,
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
    if (
      !version?.providerReceipt ||
      version.providerReceipt.repair ||
      (version.providerReceipt.rendererRepair && !isFooterRendererUpgrade(version)) ||
      version.browserReview?.status !== "failed" ||
      version.browserReviewJob?.state !== "completed" ||
      !version.browserReviewReportStorageId
    )
      return null;
    for (const storageId of [
      version.browserReviewReportStorageId,
      ...(version.browserReviewVisionStorageId ? [version.browserReviewVisionStorageId] : []),
    ]) {
      const owned = await ctx.db
        .query("uploadReceipts")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique();
      if (owned?.tenantId !== args.tenantId || owned.state !== "complete") return null;
    }
    return version;
  },
});

/** A renderer upgrade may repair only measured touch-target failures, never stand in for vision. */
export function verifyRendererRepairEvidence(
  version: {
    contentHash: string;
    rendererVersion: string;
    providerReceipt: Parameters<typeof providerReceiptHash>[0];
    browserReview: { reportHash: string };
    browserReviewScreenshots?: { sha256: string }[];
  },
  capture: any,
) {
  if (
    (version.providerReceipt.rendererRepair && !isFooterRendererUpgrade(version)) ||
    version.rendererVersion === WEB_DESIGN_RENDERER_VERSION ||
    !/^web-design-renderer-v[0-9]+$/.test(version.rendererVersion) ||
    capture?.status !== "captured" ||
    capture.contentHash !== version.contentHash ||
    capture.providerReceiptHash !== providerReceiptHash(version.providerReceipt) ||
    !Array.isArray(capture.reports) ||
    !Array.isArray(capture.artifactHashes) ||
    canonicalArtifactHashes(capture.artifactHashes) !==
      canonicalArtifactHashes(version.providerReceipt.artifactHashes) ||
    !Array.isArray(capture.screenshots) ||
    JSON.stringify(capture.screenshots.map((s: { sha256: string }) => s.sha256)) !==
      JSON.stringify(version.browserReviewScreenshots?.map((s) => s.sha256))
  )
    throw Error("PRESENCE_RENDERER_REPAIR_EVIDENCE_INVALID");
  const assessment = assessWebBrowserQuality({
    pageSlugs: version.providerReceipt.artifactHashes.map((p) => p.pageSlug),
    reports: capture.reports,
  });
  if (
    assessment.status !== "fail" ||
    !assessment.issues.some((issue) => issue.code === "small_touch_targets") ||
    assessment.issues.some(
      (issue) =>
        issue.code !== "small_touch_targets" && issue.code !== "contrast_needs_visual_review",
    )
  )
    throw Error("PRESENCE_RENDERER_REPAIR_EVIDENCE_INVALID");
  const evidenceHash = digest(capture.reports);
  if (
    canonicalEvidenceHash({
      reports: capture.reports,
      fidelity: { matched: false, evidenceHash },
      visualContrast: { passed: false, evidenceHash },
      assessment,
    }) !== version.browserReview.reportHash
  )
    throw Error("PRESENCE_RENDERER_REPAIR_EVIDENCE_INVALID");
  return version.browserReview.reportHash;
}

/** One known renderer defect: v12 split headings and nested grid spacing. Content is unchanged. */
function isSplitRendererUpgrade(version: any) {
  const plan = version.recipeRef?.designProfile?.layoutPlan;
  return (
    version.rendererVersion === "web-design-renderer-v12" &&
    ["web-design-renderer-v13", "web-design-renderer-v14"].includes(
      String(WEB_DESIGN_RENDERER_VERSION),
    ) &&
    validateWebLayoutPlan(plan) &&
    plan.version === 2 &&
    plan.hero === "split"
  );
}
export function verifySplitRendererRepairEvidence(version: any, vision: any, capture: any) {
  if (
    !isSplitRendererUpgrade(version) ||
    capture?.status !== "captured" ||
    capture.contentHash !== version.contentHash ||
    capture.providerReceiptHash !== providerReceiptHash(version.providerReceipt) ||
    !Array.isArray(capture.artifactHashes) ||
    canonicalArtifactHashes(capture.artifactHashes) !==
      canonicalArtifactHashes(version.providerReceipt.artifactHashes) ||
    !Array.isArray(capture.screenshots) ||
    JSON.stringify(capture.screenshots.map((s: any) => s.sha256)) !==
      JSON.stringify(version.browserReviewScreenshots?.map((s: any) => s.sha256)) ||
    !vision ||
    vision.fidelity?.matched !== false ||
    typeof vision.visualContrast?.passed !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(vision.fidelity?.evidenceHash) ||
    vision.visualContrast.evidenceHash !== vision.fidelity.evidenceHash ||
    vision.contentHash !== version.contentHash ||
    vision.providerReceiptHash !== providerReceiptHash(version.providerReceipt) ||
    !Array.isArray(vision.issues) ||
    !vision.issues.length ||
    JSON.stringify(vision.screenshotHashes) !==
      JSON.stringify(version.browserReviewScreenshots?.map((s: any) => s.sha256)) ||
    !Array.isArray(capture.reports)
  )
    throw Error("PRESENCE_RENDERER_REPAIR_EVIDENCE_INVALID");
  const assessment = assessWebBrowserQuality({
    pageSlugs: version.providerReceipt.artifactHashes.map((p: any) => p.pageSlug),
    reports: capture.reports,
  });
  if (
    assessment.status === "fail" ||
    assessment.issues.some((issue) => issue.code !== "contrast_needs_visual_review") ||
    canonicalEvidenceHash({
      reports: capture.reports,
      fidelity: vision.fidelity,
      visualContrast: vision.visualContrast,
      assessment,
    }) !== version.browserReview.reportHash
  )
    throw Error("PRESENCE_RENDERER_REPAIR_EVIDENCE_INVALID");
  return {
    browserEvidenceHash: version.browserReview.reportHash,
    visionEvidenceHash: vision.fidelity.evidenceHash,
  };
}

/** Reconstruct the exact completed review before trusting a stored repair proposal. */
export function verifyRepairEvidence(
  version: {
    contentHash: string;
    providerReceipt: Parameters<typeof providerReceiptHash>[0];
    browserReview: { reportHash: string };
    browserReviewScreenshots?: { sha256: string }[];
  },
  vision: any,
  capture: any,
) {
  if (
    !vision ||
    !validateWebLayoutPlan(vision.repairPlan) ||
    !vision.fidelity ||
    !vision.visualContrast ||
    !/^[a-f0-9]{64}$/.test(vision.fidelity.evidenceHash) ||
    vision.visualContrast.evidenceHash !== vision.fidelity.evidenceHash ||
    vision.contentHash !== version.contentHash ||
    vision.providerReceiptHash !== providerReceiptHash(version.providerReceipt) ||
    !Array.isArray(capture?.reports) ||
    !Array.isArray(vision.screenshotHashes) ||
    JSON.stringify(vision.screenshotHashes) !==
      JSON.stringify(version.browserReviewScreenshots?.map((s) => s.sha256))
  )
    throw Error("PRESENCE_REPAIR_EVIDENCE_INVALID");
  const assessment = assessWebBrowserQuality({
    pageSlugs: version.providerReceipt.artifactHashes.map((p) => p.pageSlug),
    reports: capture.reports,
  });
  if (
    canonicalEvidenceHash({
      reports: capture.reports,
      fidelity: vision.fidelity,
      visualContrast: vision.visualContrast,
      assessment,
    }) !== version.browserReview.reportHash
  )
    throw Error("PRESENCE_REPAIR_EVIDENCE_INVALID");
  return {
    layoutPlan: canonicalWebLayoutPlan(vision.repairPlan),
    visionEvidenceHash: vision.fidelity.evidenceHash as string,
  };
}

export const run = internalAction({
  args: scope,
  handler: async (rawCtx, args): Promise<{ status: string; version?: number }> => {
    const ctx = { ...rawCtx, ...lifecycleActionContext(rawCtx, args.tenantId) };
    const version = await ctx.runQuery(inputsRef, args);
    if (!version) return { status: "stopped" };
    const captureBlob = await ctx.storage.get(version.browserReviewReportStorageId);
    if (!captureBlob || captureBlob.size > 3200000) return { status: "stopped" };
    const capture = JSON.parse(await captureBlob.text());
    if (!version.browserReviewVisionStorageId) {
      if (!validateWebLayoutPlan(version.recipeRef?.designProfile.layoutPlan))
        return { status: "stopped" };
      const browserEvidenceHash = verifyRendererRepairEvidence(version, capture);
      return ctx.runMutation(applyRef, {
        ...args,
        repairKind: "renderer",
        layoutPlan: version.recipeRef.designProfile.layoutPlan,
        browserEvidenceHash,
        reportStorageId: version.browserReviewReportStorageId,
        reportHash: version.browserReview.reportHash,
      });
    }
    const visionBlob = await ctx.storage.get(version.browserReviewVisionStorageId);
    if (!visionBlob || visionBlob.size > 100000) return { status: "stopped" };
    const vision = JSON.parse(await visionBlob.text());
    if (isSplitRendererUpgrade(version)) {
      const evidence = verifySplitRendererRepairEvidence(version, vision, capture);
      return ctx.runMutation(applyRef, {
        ...args,
        ...evidence,
        repairKind: "renderer",
        layoutPlan: version.recipeRef.designProfile.layoutPlan,
        visionStorageId: version.browserReviewVisionStorageId,
        reportStorageId: version.browserReviewReportStorageId,
        reportHash: version.browserReview.reportHash,
      });
    }
    if (!vision?.repairPlan) return { status: "stopped" };
    const evidence = verifyRepairEvidence(version, vision, capture);
    return ctx.runMutation(applyRef, {
      ...args,
      ...evidence,
      visionStorageId: version.browserReviewVisionStorageId,
      reportHash: version.browserReview.reportHash,
    });
  },
});

export const apply = internalMutation({
  args: {
    ...scope,
    layoutPlan: v.any(),
    repairKind: v.optional(v.literal("renderer")),
    browserEvidenceHash: v.optional(v.string()),
    reportStorageId: v.optional(v.id("_storage")),
    visionEvidenceHash: v.optional(v.string()),
    visionStorageId: v.optional(v.id("_storage")),
    reportHash: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== args.tenantId || project.draftVersion !== args.version)
      throw Error("PRESENCE_REPAIR_STALE");
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
      version.providerReceipt.repair ||
      (version.providerReceipt.rendererRepair && !isFooterRendererUpgrade(version)) ||
      !version.artifacts ||
      !version.recipeRef ||
      !session ||
      session.projectVersion !== args.version ||
      session.projectContentHash !== version.contentHash ||
      version.browserReview?.status !== "failed" ||
      version.browserReviewJob?.state !== "completed" ||
      version.browserReview.reportHash !== args.reportHash ||
      !validateWebLayoutPlan(args.layoutPlan) ||
      (args.repairKind === "renderer"
        ? (version.browserReviewVisionStorageId !== undefined
            ? !isSplitRendererUpgrade(version) ||
              args.visionStorageId !== version.browserReviewVisionStorageId ||
              !/^[a-f0-9]{64}$/.test(args.visionEvidenceHash ?? "")
            : args.visionStorageId !== undefined || args.visionEvidenceHash !== undefined) ||
          version.rendererVersion === WEB_DESIGN_RENDERER_VERSION ||
          args.reportStorageId !== version.browserReviewReportStorageId ||
          !args.reportStorageId ||
          args.browserEvidenceHash !== args.reportHash ||
          !/^[a-f0-9]{64}$/.test(args.browserEvidenceHash ?? "") ||
          digest(canonicalWebLayoutPlan(args.layoutPlan)) !== version.providerReceipt.layoutHash
        : version.browserReviewVisionStorageId !== args.visionStorageId ||
          !args.visionStorageId ||
          !/^[a-f0-9]{64}$/.test(args.visionEvidenceHash ?? "") ||
          args.browserEvidenceHash !== undefined ||
          args.reportStorageId !== undefined)
    )
      throw Error("PRESENCE_REPAIR_UNAVAILABLE");
    if (args.repairKind === "renderer") {
      for (const storageId of [
        args.reportStorageId,
        ...(args.visionStorageId ? [args.visionStorageId] : []),
      ]) {
        if (!storageId) throw Error("PRESENCE_REPAIR_UNAVAILABLE");
        const owned = await ctx.db
          .query("uploadReceipts")
          .withIndex("by_storage", (q) => q.eq("storageId", storageId))
          .unique();
        if (owned?.tenantId !== args.tenantId || owned.state !== "complete")
          throw Error("PRESENCE_REPAIR_UNAVAILABLE");
      }
    }
    const snapshot = await prepareRequiredDesign(ctx, {
      tenantId: args.tenantId,
      planId: session.planId,
      expectedRevision: session.revision,
    });
    if (
      !snapshot.ok ||
      !("artifact" in snapshot) ||
      snapshot.artifact?.contentHash !== version.contentHash
    )
      throw Error("PRESENCE_REPAIR_SOURCES_CHANGED");
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    const layoutPlan = canonicalWebLayoutPlan(args.layoutPlan);
    if (!args.repairKind && digest(layoutPlan) === version.providerReceipt.layoutHash)
      return { status: "stopped" };
    const validated = validateWebDocument(version.document);
    if (!validated.ok) throw Error("PRESENCE_REPAIR_DOCUMENT_INVALID");
    const document = validated.value;
    const recipeRef = {
      ...version.recipeRef,
      designProfile: { ...version.recipeRef.designProfile, layoutPlan },
    };
    if (!validateDesignProfileRef(recipeRef.designProfile))
      throw Error("PRESENCE_REPAIR_PROFILE_INVALID");
    const profile = recipeRef.designProfile;
    const artifacts = document.pages.map((page) => ({
      pageSlug: page.slug,
      html: new TextDecoder().decode(
        renderDesignedWebDocumentBytes(document, profile, {
          slug: project.slug,
          page: page.slug,
        }),
      ),
    }));
    if (!assessWebQuality({ document, artifacts, routeSlug: project.slug }).ok)
      throw Error("PRESENCE_REPAIR_QUALITY_FAILED");
    const providerReceipt = {
      ...version.providerReceipt,
      layoutHash: digest(layoutPlan),
      artifactHashes: artifactHashes(artifacts),
      ...(args.repairKind === "renderer"
        ? {
            rendererRepair: {
              priorVersion: args.version,
              browserEvidenceHash: args.browserEvidenceHash!,
              rendererVersion: WEB_DESIGN_RENDERER_VERSION,
              attempt: isFooterRendererUpgrade(version) ? (2 as const) : (1 as const),
            },
          }
        : {
            repair: {
              priorVersion: args.version,
              visionEvidenceHash: args.visionEvidenceHash!,
              attempt: 1 as const,
            },
          }),
    };
    const result = await reviseProjectWithVersion(
      Object.assign(ctx, { tenantId: args.tenantId, userId: args.tenantId }),
      {
        projectId: args.projectId,
        document,
        expectedRevision: project.revision,
        createdBy: args.tenantId,
        recipeRef,
        providerReceipt,
        sourceRefs: version.sourceRefs,
        sourceWarnings: version.sourceWarnings,
      },
    );
    await ctx.db.patch(session._id, {
      projectVersion: result.version,
      projectContentHash: result.contentHash,
      status: "awaiting_review",
      revision: session.revision + 1,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("presenceBrowserRun:run"), {
      tenantId: args.tenantId,
      projectId: args.projectId,
      version: result.version,
    });
    return { status: "repaired", version: result.version };
  },
});
