import type { AuditPayload, PublicationAuditPayload } from "@pikar/contracts/audit";
import type { WebRecipeSkillName } from "@pikar/contracts/skill";
import type { ProjectKind, WebDocument } from "@pikar/contracts/webRuntime";
import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import {
  designedWebDocumentHash,
  renderDesignedWebDocumentBytes,
  WEB_DESIGN_RENDERER_VERSION,
} from "@pikar/core/webDesignRenderer";
import {
  canonicalWebDocument,
  hashWebDocument,
  renderWebDocumentBytes,
  validateWebDocument,
  WEB_RENDERER_VERSION,
} from "@pikar/core/webRuntime";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantMutation, tenantQuery } from "./lib/functions";

const projectKind = v.union(v.literal("site"), v.literal("landing"));
const documentInput = v.any();
type ProjectRow = {
  _id: Id<"webProjects">;
  tenantId: string;
  kind: ProjectKind;
  slug: string;
  title: string;
  publicHost: string;
  domainMode: "platform_path" | "custom_pending" | "custom_active";
  hostingDeclaration: {
    hosting:
      | "pikar_platform_path"
      | "tenant_custom_domain_pending"
      | "tenant_custom_domain_verified";
    source: "tenant_structured_content";
  };
  draftVersion?: number;
  approvedVersion?: number;
  approvedContentHash?: string;
  publishedVersion?: number;
  publishedContentHash?: string;
  recipeRef?: RecipeRef;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

type ScopedMutationCtx = MutationCtx & { tenantId: string; userId: string };

export type RecipeRef = {
  name: WebRecipeSkillName;
  version: number;
  skillId: string;
  bodyHash: string;
  definitionHash: string;
  inputHash: string;
  rendererVersion?: string;
  designProfile: {
    bundleHash: string;
    compilerHash: string;
    patternId: string;
    styleId: string;
    paletteId: string;
    typographyId: string;
    formProfileId: string;
    dials: { variance: number; motion: number; density: number };
    pageOverride?: string;
  };
};

function validSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64;
}

function validatedDocument(document: unknown, kind?: ProjectKind): WebDocument {
  const result = validateWebDocument(document);
  if (!result.ok || (kind !== undefined && result.value.kind !== kind))
    throw new Error("INVALID_WEB_DOCUMENT");
  // Canonical serialization is an intentional second boundary: it ensures the object persisted
  // in the document plane is the same closed AST that produced the artifact bytes.
  return JSON.parse(canonicalWebDocument(result.value)) as WebDocument;
}

function publicationPayload(args: {
  action: PublicationAuditPayload["action"];
  status: PublicationAuditPayload["status"];
  projectId: string;
  version?: number;
  contentHash?: string;
  previousVersion?: number;
  resultingVersion?: number;
  failure?: PublicationAuditPayload["failure"];
  actor: string;
  revision: number;
}): PublicationAuditPayload {
  return {
    action: args.action,
    status: args.status,
    projectId: args.projectId,
    ...(args.version === undefined ? {} : { version: args.version }),
    ...(args.contentHash === undefined ? {} : { contentHash: args.contentHash }),
    ...(args.previousVersion === undefined ? {} : { previousVersion: args.previousVersion }),
    ...(args.resultingVersion === undefined ? {} : { resultingVersion: args.resultingVersion }),
    ...(args.failure === undefined ? {} : { failure: args.failure }),
    actor: args.actor,
    revision: args.revision,
  };
}

async function receipt(
  ctx: MutationCtx,
  tenantId: string,
  action: PublicationAuditPayload["action"],
  payload: PublicationAuditPayload,
): Promise<void> {
  await appendAudit(ctx, {
    tenantId,
    correlationId: `web-publication:${payload.projectId}:${String(payload.revision)}`,
    eventType: `web.project.${action}`,
    actor: payload.actor,
    payload: payload as AuditPayload,
  });
}

export function runtimeReady(project: ProjectRow): boolean {
  // ponytail: storefront runtime remains dark until Phase 50's typed merchant-lifecycle
  // contract is implemented; no request, environment, tenant, owner or database flag upgrades it.
  if (project.kind === "storefront") return false;
  return (
    ((project.domainMode === "platform_path" &&
      project.hostingDeclaration.hosting === "pikar_platform_path") ||
      (project.domainMode === "custom_active" &&
        project.hostingDeclaration.hosting === "tenant_custom_domain_verified")) &&
    project.hostingDeclaration.source === "tenant_structured_content"
  );
}

function platformRuntimeHost(): string {
  try {
    const configured = new URL(process.env.CONVEX_SITE_URL ?? "");
    return configured.hostname.toLowerCase() || "pikar-platform";
  } catch {
    return "pikar-platform";
  }
}

async function appendVersion(
  ctx: MutationCtx,
  project: ProjectRow,
  document: unknown,
  createdBy: string,
  originRecipeRef?: RecipeRef,
): Promise<{ version: number; contentHash: string; byteLength: number }> {
  const validated = validatedDocument(document, project.kind);
  const previous = await ctx.db
    .query("webProjectVersions")
    .withIndex("by_tenant_project_version", (q) =>
      q.eq("tenantId", project.tenantId).eq("projectId", project._id),
    )
    .order("desc")
    .first();
  const recipeRef = originRecipeRef ?? previous?.recipeRef;
  const designed = recipeRef?.rendererVersion === WEB_DESIGN_RENDERER_VERSION;
  const profile = recipeRef?.designProfile;
  if (designed && !validateDesignProfileRef(profile)) throw new Error("WEB_DESIGN_PROFILE_INVALID");
  const contentHash = designed
    ? designedWebDocumentHash(validated, profile as Parameters<typeof designedWebDocumentHash>[1])
    : hashWebDocument(validated);
  const artifacts = validated.pages.map((page) => {
    const route = { slug: project.slug, page: page.slug };
    const bytes = designed
      ? renderDesignedWebDocumentBytes(
          validated,
          profile as Parameters<typeof renderDesignedWebDocumentBytes>[1],
          route,
        )
      : renderWebDocumentBytes(validated, route);
    return {
      pageSlug: page.slug,
      html: new TextDecoder().decode(bytes),
      byteLength: bytes.byteLength,
    };
  });
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0);
  if (totalBytes > 256 * 1024) throw new Error("INVALID_WEB_DOCUMENT");
  const version = (previous?.version ?? 0) + 1;
  await ctx.db.insert("webProjectVersions", {
    tenantId: project.tenantId,
    projectId: project._id,
    version,
    document: validated,
    contentHash,
    rendererVersion: designed ? WEB_DESIGN_RENDERER_VERSION : WEB_RENDERER_VERSION,
    artifactHtml: artifacts[0]?.html,
    artifacts,
    artifactByteLength: totalBytes,
    createdBy,
    createdAt: Date.now(),
    ...(previous ? { basedOnVersion: previous.version } : {}),
    sourceRefs: [],
    ...(originRecipeRef !== undefined
      ? { recipeRef: originRecipeRef }
      : previous?.recipeRef !== undefined
        ? { recipeRef: previous.recipeRef }
        : {}),
  });
  return { version, contentHash, byteLength: totalBytes };
}

/** Shared server-only project/version write seam for recipe-created projects. */
export async function createProjectWithVersion(
  ctx: ScopedMutationCtx,
  args: {
    kind: ProjectKind;
    slug: string;
    title: string;
    document: unknown;
    recipeRef?: RecipeRef;
    createdBy: string;
  },
): Promise<{
  projectId: Id<"webProjects">;
  version: number;
  contentHash: string;
  revision: number;
}> {
  if (!validSlug(args.slug) || args.title.trim().length === 0)
    throw new Error("INVALID_WEB_PROJECT");
  const existing = await ctx.db
    .query("webProjects")
    .withIndex("by_tenant_slug", (q) => q.eq("tenantId", ctx.tenantId).eq("slug", args.slug))
    .first();
  if (existing) throw new Error("WEB_PROJECT_EXISTS");
  const now = Date.now();
  const publicHost = platformRuntimeHost();
  const projectId = await ctx.db.insert("webProjects", {
    tenantId: ctx.tenantId,
    kind: args.kind,
    slug: args.slug,
    title: args.title.trim(),
    publicHost,
    domainMode: "platform_path",
    hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  const version = await appendVersion(
    ctx,
    {
      _id: projectId,
      tenantId: ctx.tenantId,
      kind: args.kind,
      slug: args.slug,
      title: args.title.trim(),
      publicHost,
      domainMode: "platform_path",
      hostingDeclaration: {
        hosting: "pikar_platform_path",
        source: "tenant_structured_content",
      },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    args.document,
    args.createdBy,
    args.recipeRef,
  );
  await ctx.db.patch(projectId, {
    draftVersion: version.version,
    revision: 2,
    updatedAt: Date.now(),
  });
  return { projectId, ...version, revision: 2 };
}

export const createDraft = tenantMutation({
  args: {
    kind: projectKind,
    slug: v.string(),
    title: v.string(),
    document: documentInput,
  },
  handler: async (ctx, args) => {
    return createProjectWithVersion(ctx, {
      kind: args.kind,
      slug: args.slug,
      title: args.title,
      document: args.document,
      createdBy: ctx.userId,
    });
  },
});

export const saveDraft = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    document: documentInput,
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectRow | null;
    if (!project || project.tenantId !== ctx.tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
    if (args.expectedRevision !== undefined && args.expectedRevision !== project.revision)
      throw new Error("STALE_REVISION");
    const version = await appendVersion(ctx, project, args.document, ctx.userId);
    const revision = project.revision + 1;
    await ctx.db.patch(args.projectId, {
      draftVersion: version.version,
      approvedVersion: undefined,
      approvedContentHash: undefined,
      revision,
      updatedAt: Date.now(),
    });
    return { projectId: args.projectId, ...version, revision };
  },
});

export const approveVersion = tenantMutation({
  args: { projectId: v.id("webProjects"), version: v.number(), contentHash: v.string() },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectRow | null;
    if (!project || project.tenantId !== ctx.tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
    const version = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId).eq("version", args.version),
      )
      .first();
    if (!version || version.contentHash !== args.contentHash)
      throw new Error("VERSION_HASH_MISMATCH");
    await ctx.db.patch(args.projectId, {
      approvedVersion: args.version,
      approvedContentHash: args.contentHash,
      revision: project.revision + 1,
      updatedAt: Date.now(),
    });
    return {
      ok: true,
      version: args.version,
      contentHash: args.contentHash,
      revision: project.revision + 1,
    };
  },
});

async function publish(
  ctx: MutationCtx,
  project: ProjectRow,
  args: {
    version: number;
    contentHash: string;
    expectedRevision: number;
    action: "publish" | "update" | "rollback";
  },
  actor: string,
): Promise<{
  ok: boolean;
  code?: string;
  version?: number;
  contentHash?: string;
  revision: number;
}> {
  const fail = async (failure: PublicationAuditPayload["failure"], code: string) => {
    await receipt(
      ctx,
      project.tenantId,
      args.action,
      publicationPayload({
        action: args.action,
        status: "failed",
        projectId: project._id,
        version: args.version,
        contentHash: args.contentHash,
        failure,
        actor,
        revision: project.revision,
      }),
    );
    return { ok: false, code, revision: project.revision };
  };
  if (project.kind === "storefront") return fail("unavailable", "COMMERCE_UNAVAILABLE");
  if (args.expectedRevision !== project.revision) return fail("stale_revision", "STALE_REVISION");
  if (!runtimeReady(project)) return fail("unavailable", "RUNTIME_UNAVAILABLE");
  const competingBindings = await ctx.db
    .query("webProjects")
    .withIndex("by_host_slug", (q) =>
      q.eq("publicHost", project.publicHost).eq("slug", project.slug),
    )
    .take(2);
  if (competingBindings.some((candidate) => candidate._id !== project._id))
    return fail("unavailable", "AMBIGUOUS_PUBLIC_BINDING");
  if (project.approvedVersion !== args.version || project.approvedContentHash !== args.contentHash)
    return fail("not_approved", "NOT_APPROVED");
  const version = await ctx.db
    .query("webProjectVersions")
    .withIndex("by_tenant_project_version", (q) =>
      q.eq("tenantId", project.tenantId).eq("projectId", project._id).eq("version", args.version),
    )
    .first();
  if (!version || version.contentHash !== args.contentHash)
    return fail("render_failed", "VERSION_UNAVAILABLE");
  const revision = project.revision + 1;
  await ctx.db.patch(project._id, {
    publishedVersion: args.version,
    publishedContentHash: args.contentHash,
    revision,
    updatedAt: Date.now(),
  });
  await receipt(
    ctx,
    project.tenantId,
    args.action,
    publicationPayload({
      action: args.action,
      status: "published",
      projectId: project._id,
      version: args.version,
      contentHash: args.contentHash,
      previousVersion: project.publishedVersion,
      resultingVersion: args.version,
      actor,
      revision,
    }),
  );
  return { ok: true, version: args.version, contentHash: args.contentHash, revision };
}

export const publishVersion = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    version: v.number(),
    contentHash: v.string(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectRow | null;
    if (!project || project.tenantId !== ctx.tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
    return publish(ctx, project, { ...args, action: "publish" }, String(ctx.userId));
  },
});

export const updateVersion = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    version: v.number(),
    contentHash: v.string(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectRow | null;
    if (!project || project.tenantId !== ctx.tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
    return publish(ctx, project, { ...args, action: "update" }, String(ctx.userId));
  },
});

export const unpublish = tenantMutation({
  args: { projectId: v.id("webProjects"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectRow | null;
    if (!project || project.tenantId !== ctx.tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
    if (project.kind === "storefront")
      return { ok: false, code: "COMMERCE_UNAVAILABLE", revision: project.revision };
    const actor = String(ctx.userId);
    if (project.revision !== args.expectedRevision) {
      await receipt(
        ctx,
        ctx.tenantId,
        "unpublish",
        publicationPayload({
          action: "unpublish",
          status: "failed",
          projectId: String(args.projectId),
          failure: "stale_revision",
          actor,
          revision: project.revision,
        }),
      );
      return { ok: false, code: "STALE_REVISION", revision: project.revision };
    }
    const revision = project.revision + 1;
    await ctx.db.patch(args.projectId, {
      publishedVersion: undefined,
      publishedContentHash: undefined,
      revision,
      updatedAt: Date.now(),
    });
    await receipt(
      ctx,
      ctx.tenantId,
      "unpublish",
      publicationPayload({
        action: "unpublish",
        status: "unpublished",
        projectId: String(args.projectId),
        previousVersion: project.publishedVersion,
        actor,
        revision,
      }),
    );
    return { ok: true, revision };
  },
});

export const rollback = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    version: v.number(),
    contentHash: v.string(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectRow | null;
    if (!project || project.tenantId !== ctx.tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
    return publish(ctx, project, { ...args, action: "rollback" }, String(ctx.userId));
  },
});

export const getProject = tenantQuery({
  args: { projectId: v.id("webProjects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId || project.kind === "storefront") return null;
    return project;
  },
});

export const listProjects = tenantQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("webProjects")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .filter((q) => q.neq(q.field("kind"), "storefront"))
      .order("desc")
      .take(100),
});

export const getVersion = tenantQuery({
  args: { projectId: v.id("webProjects"), version: v.number() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId || project.kind === "storefront") return null;
    return ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId).eq("version", args.version),
      )
      .first();
  },
});

export const listVersions = tenantQuery({
  args: { projectId: v.id("webProjects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId || project.kind === "storefront") return [];
    return ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId),
      )
      .order("desc")
      .take(50);
  },
});

/** Internal server-owned host resolver; no caller-selected tenant id crosses this boundary. */
export const resolvePublished = internalQuery({
  args: { host: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const host = args.host.trim().toLowerCase();
    const matches = await ctx.db
      .query("webProjects")
      .withIndex("by_host_slug", (q) => q.eq("publicHost", host).eq("slug", args.slug))
      .take(2);
    if (matches.length > 1) return { state: "invalid_host" as const };
    if (matches.length === 0) {
      const sameSlug = await ctx.db
        .query("webProjects")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .first();
      return { state: sameSlug ? ("invalid_host" as const) : ("not_found" as const) };
    }
    const project = matches[0];
    if (!project || project.kind === "storefront" || !runtimeReady(project))
      return { state: "invalid_host" as const };
    if (project.publishedVersion === undefined) return { state: "unpublished" as const };
    const version = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q
          .eq("tenantId", project.tenantId)
          .eq("projectId", project._id)
          .eq("version", project.publishedVersion!),
      )
      .first();
    if (
      !version ||
      version.contentHash !== project.publishedContentHash ||
      !version.artifacts ||
      version.artifacts.length !== (version.document as WebDocument).pages.length
    )
      return { state: "render_failed" as const };
    return { state: "published" as const, project, version };
  },
});

// Retention constants are exported for the form adapter and playbook checks; lifecycle code never
// treats them as proof of unique visitors or a provider/domain readiness claim.
export { ABUSE_BUCKET_RETENTION_MS, IDEMPOTENCY_RETENTION_MS } from "@pikar/core/webRuntime";
