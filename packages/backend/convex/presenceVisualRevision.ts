import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import {
  renderDesignedWebDocumentBytes,
  WEB_DESIGN_RENDERER_VERSION,
} from "@pikar/core/webDesignRenderer";
import { canonicalWebLayoutPlan, validateWebLayoutPlan } from "@pikar/core/webLayoutPlan";
import { assessWebQuality } from "@pikar/core/webQuality";
import { sha256Bytes, validateWebDocument } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { tenantMutation } from "./lib/functions";
import {
  artifactHashes,
  providerReceiptHash,
  validateProviderReceipt,
} from "./lib/presencePublication";
import { prepareRequiredDesign } from "./onlinePresence";
import { reviseProjectWithVersion } from "./webProjects";

/** Explicit tenant-owner edit: re-render existing source and design, never replay provider generation. */
export const request = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    expectedProjectRevision: v.number(),
    expectedSessionRevision: v.number(),
    expectedVersion: v.number(),
    expectedContentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(ctx.userId);
    if (
      ctx.userId !== ctx.tenantId ||
      !actor ||
      !("emailVerificationTime" in actor) ||
      !actor.emailVerificationTime
    )
      throw Error("PRESENCE_REVISION_UNAUTHORIZED");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId) throw Error("PRESENCE_REVISION_UNAVAILABLE");
    if (
      project.revision !== args.expectedProjectRevision ||
      project.draftVersion !== args.expectedVersion
    )
      throw Error("PRESENCE_REVISION_STALE");
    const version = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("projectId", args.projectId)
          .eq("version", args.expectedVersion),
      )
      .unique();
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId),
      )
      .unique();
    if (
      !version ||
      !session ||
      session.revision !== args.expectedSessionRevision ||
      session.projectVersion !== version.version ||
      session.projectContentHash !== version.contentHash ||
      version.contentHash !== args.expectedContentHash
    )
      throw Error("PRESENCE_REVISION_STALE");
    if (
      !version.providerReceipt ||
      !version.artifacts ||
      !version.recipeRef ||
      version.rendererVersion === WEB_DESIGN_RENDERER_VERSION ||
      version.browserReview?.status !== "failed" ||
      version.browserReviewJob?.state !== "completed"
    )
      throw Error("PRESENCE_REVISION_UNAVAILABLE");
    const latest = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", project._id),
      )
      .order("desc")
      .first();
    if (latest?._id !== version._id) throw Error("PRESENCE_REVISION_STALE");
    const profile = version.recipeRef.designProfile;
    if (
      !validateDesignProfileRef(profile) ||
      !validateWebLayoutPlan(profile.layoutPlan) ||
      sha256Bytes(
        new TextEncoder().encode(JSON.stringify(canonicalWebLayoutPlan(profile.layoutPlan))),
      ) !== version.providerReceipt.layoutHash
    )
      throw Error("PRESENCE_REVISION_PROFILE_INVALID");
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    if (
      version.browserReview.contentHash !== version.contentHash ||
      version.browserReview.providerReceiptHash !== providerReceiptHash(version.providerReceipt)
    )
      throw Error("PRESENCE_REVISION_EVIDENCE_STALE");
    const snapshot = await prepareRequiredDesign(ctx, {
      tenantId: ctx.tenantId,
      planId: session.planId,
      expectedRevision: session.revision,
    });
    if (
      !snapshot.ok ||
      !("artifact" in snapshot) ||
      snapshot.artifact?.contentHash !== version.contentHash
    )
      throw Error("PRESENCE_REVISION_SOURCES_CHANGED");
    const validated = validateWebDocument(version.document);
    if (!validated.ok) throw Error("PRESENCE_REVISION_DOCUMENT_INVALID");
    const document = validated.value;
    const artifacts = document.pages.map((page) => ({
      pageSlug: page.slug,
      html: new TextDecoder().decode(
        renderDesignedWebDocumentBytes(document, profile, { slug: project.slug, page: page.slug }),
      ),
    }));
    if (!assessWebQuality({ document, artifacts, routeSlug: project.slug }).ok)
      throw Error("PRESENCE_REVISION_QUALITY_FAILED");
    const receipt = {
      ...version.providerReceipt,
      artifactHashes: artifactHashes(artifacts),
      rendererRevision: {
        priorVersion: version.version,
        priorContentHash: version.contentHash,
        priorProviderReceiptHash: providerReceiptHash(version.providerReceipt),
        rendererVersion: WEB_DESIGN_RENDERER_VERSION,
        requestedBy: ctx.userId,
      },
    };
    const result = await reviseProjectWithVersion(ctx, {
      projectId: project._id,
      expectedRevision: project.revision,
      document,
      createdBy: ctx.userId,
      recipeRef: version.recipeRef,
      sourceRefs: version.sourceRefs,
      sourceWarnings: version.sourceWarnings,
      providerReceipt: receipt,
    });
    await ctx.db.patch(session._id, {
      projectVersion: result.version,
      projectContentHash: result.contentHash,
      status: "awaiting_review",
      revision: session.revision + 1,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("presenceBrowserRun:run"), {
      tenantId: ctx.tenantId,
      projectId: project._id,
      version: result.version,
    });
    return { status: "revised" as const, ...result };
  },
});
