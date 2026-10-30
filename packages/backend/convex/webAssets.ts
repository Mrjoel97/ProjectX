import type { WebDocument } from "@pikar/contracts/webRuntime";
import { collectWebAssetRefs, inspectWebAssetBytes, parseWebAssetRef } from "@pikar/core/webAssets";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tenantAction, tenantQuery } from "./lib/functions";
import {
  assertTenantWritable,
  internalAction,
  internalMutation,
  lifecycleActionContext,
} from "./lib/tenantLifecycle";
import { sealedIn } from "./vaultFolders";

const MAX_BYTES = 5 * 1024 * 1024;
const mimes = ["image/png", "image/jpeg", "image/webp"] as const;
const mimeValidator = v.union(
  v.literal("image/png"),
  v.literal("image/jpeg"),
  v.literal("image/webp"),
);
type DatabaseCtx = QueryCtx | MutationCtx;
type RasterMime = (typeof mimes)[number];
type Raster = ReturnType<typeof inspectWebAssetBytes>;
export type WebAssetSnapshot = {
  assetId: Id<"webAssets">;
  assetRef: string;
  contentHash: string;
  mimeType: RasterMime;
  byteLength: number;
  width: number;
  height: number;
  sourceRef: string;
};
export type WebAssetSummary = Omit<WebAssetSnapshot, "assetId"> & { title: string };
const sourceHash = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
const assetRefFor = (row: Doc<"webAssets">) => `webasset:${row._id}:${row.contentHash.slice(7)}`;
const summaryFor = (row: Doc<"webAssets">): WebAssetSummary => ({
  assetRef: assetRefFor(row),
  sourceRef: `vault:${row.vaultDocumentId}`,
  title: row.title,
  mimeType: row.mimeType,
  byteLength: row.byteLength,
  width: row.width,
  height: row.height,
  contentHash: row.contentHash,
});

function storageDigest(value: string): string | null {
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  try {
    const decoded = atob(value);
    return decoded.length === 32 && btoa(decoded) === value
      ? Array.from(decoded, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("")
      : null;
  } catch {
    return null;
  }
}
function metadataMatches(
  metadata: { size: number; contentType?: string; sha256: string } | null,
  raster: Raster,
) {
  return (
    !!metadata &&
    metadata.size === raster.byteLength &&
    (metadata.contentType === undefined || metadata.contentType === raster.mimeType) &&
    `sha256:${storageDigest(metadata.sha256)}` === raster.contentHash
  );
}

/** Image prompts/captions are not admitted as business facts by this metadata-only source. */
export async function imageSource(ctx: DatabaseCtx, tenantId: string, doc: Doc<"vaultDocuments">) {
  const mimeType = doc.storedMimeType ?? doc.mimeType;
  if (
    doc.tenantId !== tenantId ||
    doc.status !== "ready" ||
    !doc.storageId ||
    doc.driveOwnedByMe === false ||
    !(mimes as readonly string[]).includes(mimeType) ||
    (await sealedIn(ctx, [doc])).has(doc._id)
  )
    return null;
  const metadata = await ctx.db.system.get(doc.storageId);
  if (
    !metadata ||
    metadata.size < 12 ||
    metadata.size > MAX_BYTES ||
    (metadata.contentType !== undefined && metadata.contentType !== mimeType)
  )
    return null;
  return {
    sourceRef: `vault:${doc._id}`,
    title: doc.title.slice(0, 160),
    mimeType: mimeType as RasterMime,
    sourceRevision: sourceHash({
      docId: doc._id,
      storageId: doc.storageId,
      contentHash: doc.contentHash,
      mimeType,
      storageDigest: metadata.sha256,
    }),
    vaultDocumentId: doc._id,
    storageId: doc.storageId,
    byteLength: metadata.size,
  };
}

export async function listImageCandidates(ctx: DatabaseCtx, tenantId: string) {
  const docs: Doc<"vaultDocuments">[] = [];
  for (const mime of mimes)
    docs.push(
      ...(await ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_mime_status", (q) =>
          q.eq("tenantId", tenantId).eq("mimeType", mime).eq("status", "ready"),
        )
        .order("desc")
        .take(3)),
    );
  docs.push(
    ...(await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_kind_status", (q) =>
        q.eq("tenantId", tenantId).eq("kind", "image").eq("status", "ready"),
      )
      .order("desc")
      .take(3)),
  );
  const out: { sourceRef: string; title: string; mimeType: RasterMime; byteLength: number }[] = [];
  for (const doc of docs) {
    if (out.some((image) => image.sourceRef === `vault:${doc._id}`)) continue;
    const image = await imageSource(ctx, tenantId, doc);
    if (image)
      out.push({
        sourceRef: image.sourceRef,
        title: image.title,
        mimeType: image.mimeType,
        byteLength: image.byteLength,
      });
    if (out.length === 12) break;
  }
  return out;
}

export const sourceForPresence = internalQuery({
  args: { tenantId: v.string(), planId: v.id("plans"), sourceRef: v.string() },
  handler: async (ctx, args): Promise<Awaited<ReturnType<typeof imageSource>>> => {
    const plan = await ctx.db.get(args.planId);
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_plan", (q) => q.eq("tenantId", args.tenantId).eq("planId", args.planId))
      .unique();
    if (!plan || plan.tenantId !== args.tenantId || !session || session.threadId !== plan.threadId)
      throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
    const lifecycle = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", args.tenantId))
      .unique();
    if (lifecycle?.state !== undefined) throw new Error("TENANT_ERASURE_IN_PROGRESS");
    const id = args.sourceRef.startsWith("vault:")
      ? ctx.db.normalizeId("vaultDocuments", args.sourceRef.slice(6))
      : null;
    const doc = id ? await ctx.db.get(id) : null;
    return doc ? imageSource(ctx, args.tenantId, doc) : null;
  },
});

export const commitCopy = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    sourceRef: v.string(),
    sourceRevision: v.string(),
    storageId: v.id("_storage"),
    mimeType: mimeValidator,
    byteLength: v.number(),
    width: v.number(),
    height: v.number(),
    contentHash: v.string(),
  },
  handler: async (ctx, args): Promise<{ asset: WebAssetSummary; reused: boolean }> => {
    await assertTenantWritable(ctx, args.tenantId);
    const source = await ctx.runQuery(internal.webAssets.sourceForPresence, {
      tenantId: args.tenantId,
      planId: args.planId,
      sourceRef: args.sourceRef,
    });
    if (!source || source.sourceRevision !== args.sourceRevision)
      throw new Error("WEB_ASSET_SOURCE_CHANGED");
    const metadata = await ctx.db.system.get(args.storageId);
    if (
      !metadataMatches(metadata, args) ||
      !metadataMatches(await ctx.db.system.get(source.storageId), args) ||
      args.byteLength > MAX_BYTES ||
      !Number.isInteger(args.width) ||
      !Number.isInteger(args.height) ||
      args.width < 1 ||
      args.height < 1 ||
      args.width > 8192 ||
      args.height > 8192 ||
      args.width * args.height > 20_000_000
    )
      throw new Error("WEB_ASSET_INVALID");
    const receipt = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (
      !receipt ||
      receipt.tenantId !== args.tenantId ||
      !receipt.ticketHash.startsWith("generated:")
    )
      throw new Error("UPLOAD_NOT_OWNED");
    const existing = await ctx.db
      .query("webAssets")
      .withIndex("by_tenant_source", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("vaultDocumentId", source.vaultDocumentId)
          .eq("sourceRevision", args.sourceRevision),
      )
      .unique();
    if (existing) return { asset: summaryFor(existing), reused: true };
    const assetId = await ctx.db.insert("webAssets", {
      tenantId: args.tenantId,
      vaultDocumentId: source.vaultDocumentId,
      sourceRevision: source.sourceRevision,
      storageId: args.storageId,
      mimeType: args.mimeType,
      contentHash: args.contentHash,
      byteLength: args.byteLength,
      width: args.width,
      height: args.height,
      title: source.title,
      createdAt: Date.now(),
    });
    const row = await ctx.db.get(assetId);
    if (!row) throw new Error("WEB_ASSET_UNAVAILABLE");
    return { asset: summaryFor(row), reused: false };
  },
});

export const discardCopy = internalMutation({
  args: { tenantId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const receipt = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (
      !receipt ||
      receipt.tenantId !== args.tenantId ||
      !receipt.ticketHash.startsWith("generated:")
    )
      return;
    if (receipt.expiresAt === Number.MAX_SAFE_INTEGER) return;
    if (await ctx.db.system.get(args.storageId)) await ctx.storage.delete(args.storageId);
    await ctx.db.delete(receipt._id);
  },
});

export const prepareForPresence = internalAction({
  args: { tenantId: v.string(), planId: v.id("plans"), sourceRefs: v.array(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ assets: WebAssetSummary[]; rejected: { sourceRef: string; code: string }[] }> => {
    if (
      args.sourceRefs.length < 1 ||
      args.sourceRefs.length > 6 ||
      new Set(args.sourceRefs).size !== args.sourceRefs.length ||
      args.sourceRefs.some((ref) => ref.length > 256)
    )
      throw new Error("WEB_ASSET_SELECTION_INVALID");
    const assets: WebAssetSummary[] = [];
    const rejected: { sourceRef: string; code: string }[] = [];
    const ownedStorage = lifecycleActionContext(ctx, args.tenantId).storage;
    for (const sourceRef of args.sourceRefs) {
      let copy: Id<"_storage"> | undefined;
      try {
        const source = await ctx.runQuery(internal.webAssets.sourceForPresence, {
          tenantId: args.tenantId,
          planId: args.planId,
          sourceRef,
        });
        if (!source) {
          rejected.push({ sourceRef, code: "WEB_ASSET_SOURCE_UNAVAILABLE" });
          continue;
        }
        const blob = await ctx.storage.get(source.storageId);
        if (!blob || blob.size !== source.byteLength || blob.size > MAX_BYTES)
          throw new Error("WEB_ASSET_INVALID");
        const buffer = await blob.arrayBuffer();
        const raster = inspectWebAssetBytes(new Uint8Array(buffer), source.mimeType);
        copy = await ownedStorage.store(new Blob([buffer], { type: raster.mimeType }));
        const result = await ctx.runMutation(internal.webAssets.commitCopy, {
          tenantId: args.tenantId,
          planId: args.planId,
          sourceRef,
          sourceRevision: source.sourceRevision,
          storageId: copy,
          ...raster,
        });
        assets.push(result.asset);
        if (result.reused)
          await ctx.runMutation(internal.webAssets.discardCopy, {
            tenantId: args.tenantId,
            storageId: copy,
          });
      } catch {
        if (copy)
          await ctx.runMutation(internal.webAssets.discardCopy, {
            tenantId: args.tenantId,
            storageId: copy,
          });
        rejected.push({ sourceRef, code: "WEB_ASSET_UNAVAILABLE" });
      }
    }
    return { assets, rejected };
  },
});

export async function resolveDocumentAssets(
  ctx: DatabaseCtx,
  tenantId: string,
  document: WebDocument,
): Promise<WebAssetSnapshot[]> {
  const out: WebAssetSnapshot[] = [];
  for (const assetRef of collectWebAssetRefs(document)) {
    const ref = parseWebAssetRef(assetRef);
    const id = ref ? ctx.db.normalizeId("webAssets", ref.assetId) : null;
    const row = id ? await ctx.db.get(id) : null;
    if (
      !ref ||
      !row ||
      row.tenantId !== tenantId ||
      row.contentHash !== ref.contentHash ||
      !metadataMatches(await ctx.db.system.get(row.storageId), row)
    )
      throw new Error("WEB_ASSET_UNAVAILABLE");
    const { title: _title, ...snapshot } = summaryFor(row);
    out.push({ assetId: row._id, ...snapshot });
  }
  return out;
}

async function ownedVersion(
  ctx: DatabaseCtx,
  tenantId: string,
  projectId: Id<"webProjects">,
  version: number,
) {
  const project = await ctx.db.get(projectId);
  if (!project || project.tenantId !== tenantId) throw new Error("WEB_PROJECT_UNAVAILABLE");
  const row = await ctx.db
    .query("webProjectVersions")
    .withIndex("by_tenant_project_version", (q) =>
      q.eq("tenantId", tenantId).eq("projectId", projectId).eq("version", version),
    )
    .unique();
  if (!row) throw new Error("VERSION_UNAVAILABLE");
  return row;
}
export const listVersionAssets = tenantQuery({
  args: { projectId: v.id("webProjects"), version: v.number() },
  handler: async (ctx, args) =>
    (await ownedVersion(ctx, ctx.tenantId, args.projectId, args.version)).assetSnapshots ?? [],
});
export const previewSource = internalQuery({
  args: {
    tenantId: v.string(),
    projectId: v.id("webProjects"),
    version: v.number(),
    assetRef: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ storageId: Id<"_storage">; snapshot: WebAssetSnapshot }> => {
    const version = await ownedVersion(ctx, args.tenantId, args.projectId, args.version);
    const snapshot = version.assetSnapshots?.find((asset) => asset.assetRef === args.assetRef);
    const row = snapshot ? await ctx.db.get(snapshot.assetId) : null;
    if (
      !snapshot ||
      !row ||
      row.tenantId !== args.tenantId ||
      row.contentHash !== snapshot.contentHash
    )
      throw new Error("WEB_ASSET_UNAVAILABLE");
    const lifecycle = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", args.tenantId))
      .unique();
    if (lifecycle?.state !== undefined) throw new Error("TENANT_ERASURE_IN_PROGRESS");
    return { storageId: row.storageId, snapshot };
  },
});
export const previewAsset = tenantAction({
  args: { projectId: v.id("webProjects"), version: v.number(), assetRef: v.string() },
  handler: async (ctx, args): Promise<{ assetRef: string; dataUrl: string }> => {
    const source = await ctx.runQuery(internal.webAssets.previewSource, {
      ...args,
      tenantId: ctx.tenantId,
    });
    const blob = await ctx.storage.get(source.storageId);
    if (!blob || blob.size > MAX_BYTES) throw new Error("WEB_ASSET_UNAVAILABLE");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const raster = inspectWebAssetBytes(bytes, source.snapshot.mimeType);
    if (raster.contentHash !== source.snapshot.contentHash)
      throw new Error("WEB_ASSET_UNAVAILABLE");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 16384)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    return { assetRef: args.assetRef, dataUrl: `data:${raster.mimeType};base64,${btoa(binary)}` };
  },
});

export const resolvePublishedAsset = internalQuery({
  args: { host: v.string(), slug: v.string(), assetId: v.string(), digest: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ storageId: Id<"_storage">; snapshot: WebAssetSnapshot } | null> => {
    const published = await ctx.runQuery(internal.webProjects.resolvePublished, {
      host: args.host,
      slug: args.slug,
    });
    if (published.state !== "published") return null;
    const snapshot = published.version.assetSnapshots?.find(
      (asset: WebAssetSnapshot) =>
        asset.assetId === args.assetId && asset.contentHash === `sha256:${args.digest}`,
    );
    const row = snapshot ? await ctx.db.get(snapshot.assetId) : null;
    if (
      !snapshot ||
      !row ||
      row.tenantId !== published.project.tenantId ||
      row.contentHash !== snapshot.contentHash ||
      !collectWebAssetRefs(published.version.document as WebDocument).includes(snapshot.assetRef) ||
      !metadataMatches(await ctx.db.system.get(row.storageId), row)
    )
      return null;
    return { storageId: row.storageId, snapshot };
  },
});

/** Called by the existing /p/ GET handler before page resolution; no storage capability is exposed. */
export async function servePublishedAsset(ctx: ActionCtx, request: Request): Promise<Response> {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const closed = () => new Response(null, { status: 404, headers });
  if (request.method !== "GET" && request.method !== "HEAD") return closed();
  const url = new URL(request.url);
  const match = /^\/p\/([a-z0-9-]+)\/assets\/([A-Za-z0-9_-]{1,96})\/([a-f0-9]{64})$/.exec(
    url.pathname,
  );
  if (!match?.[1] || !match[2] || !match[3] || url.search) return closed();
  try {
    const args = {
      host: url.host.toLowerCase(),
      slug: match[1],
      assetId: match[2],
      digest: match[3],
    };
    const source = await ctx.runQuery(internal.webAssets.resolvePublishedAsset, args);
    if (!source) return closed();
    const blob = await ctx.storage.get(source.storageId);
    // Intake inspected the full raster and froze this copy. The resolver compares the immutable
    // storage SHA/size to that attestation on every request, so repeated CRC/hash work adds no
    // authority. Still check the actual returned blob length before releasing it.
    if (!blob || blob.size !== source.snapshot.byteLength || blob.size > MAX_BYTES) return closed();
    // Storage reads happen outside a transaction; recheck the public head before releasing bytes.
    const current = await ctx.runQuery(internal.webAssets.resolvePublishedAsset, args);
    if (
      !current ||
      current.storageId !== source.storageId ||
      current.snapshot.assetRef !== source.snapshot.assetRef
    )
      return closed();
    return new Response(request.method === "HEAD" ? null : blob, {
      headers: {
        ...headers,
        "Content-Type": source.snapshot.mimeType,
        "Content-Length": String(source.snapshot.byteLength),
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return closed();
  }
}
