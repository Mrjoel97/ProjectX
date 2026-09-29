import type { HostingDeclaration, WebDocument } from "@pikar/contracts/webRuntime";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";

export type PublicPageResult =
  | {
      readonly state: "published";
      readonly html: string;
      readonly version: number;
      readonly contentHash: string;
      readonly projectId: string;
      readonly tenantId: string;
      readonly hostingDeclaration: HostingDeclaration;
    }
  | {
      readonly state: "not_found" | "unpublished" | "invalid_host" | "render_failed";
    };

/**
 * Resolve one exact public page from the authoritative published pointer. The caller supplies only
 * the request host/path. Tenant, project, version, bytes, and ownership declarations come from the
 * server-owned binding and immutable version row.
 */
export const resolvePage = internalQuery({
  args: { host: v.string(), slug: v.string(), page: v.string() },
  handler: async (ctx, args): Promise<PublicPageResult> => {
    const resolved = await ctx.runQuery(internal.webProjects.resolvePublished, {
      host: args.host.trim().toLowerCase(),
      slug: args.slug,
    });
    if (resolved.state !== "published") return { state: resolved.state };
    // Defense in depth: a malformed seeded pointer must not turn the private storefront kind into
    // an anonymous public response, even if a future resolver path is changed.
    if (resolved.project.kind === "storefront") return { state: "invalid_host" };
    const document = resolved.version.document as WebDocument;
    if (!document.pages.some((candidate) => candidate.slug === args.page))
      return { state: "not_found" };
    const artifact = resolved.version.artifacts?.find(
      (candidate) => candidate.pageSlug === args.page,
    );
    if (!artifact || new TextEncoder().encode(artifact.html).byteLength !== artifact.byteLength)
      return { state: "render_failed" };
    return {
      state: "published",
      html: artifact.html,
      version: resolved.version.version,
      contentHash: resolved.version.contentHash,
      projectId: String(resolved.project._id),
      tenantId: resolved.project.tenantId,
      hostingDeclaration: resolved.project.hostingDeclaration,
    };
  },
});
