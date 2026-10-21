/** Chat inventory is metadata only. Bytes and content are fetched for ONE selected reference. */
import { parseWorkspaceArtifactKey, type WorkspaceArtifact } from "@pikar/core/workspaceArtifacts";
import { type PaginationOptions, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

const PAGE_ROWS = 8;
// Four max-size Convex documents remain below the transaction's 16 MiB read ceiling.
const RESOLVE_CHUNK = 4;
const streamValidator = v.union(
  v.literal("documents"),
  v.literal("plans"),
  v.literal("campaigns"),
  v.literal("sources"),
);
type ScopedCtx = QueryCtx & { tenantId: string };

function projectDoc(d: Doc<"vaultDocuments">) {
  return {
    _id: d._id,
    _creationTime: d._creationTime,
    title: d.title,
    kind: d.kind,
    category: d.category,
    source: d.source,
    mimeType: d.mimeType,
    storedMimeType: d.storedMimeType,
    size: d.size,
    status: d.status,
    failureReason: d.failureReason,
    extractionTruncated: d.extractionTruncated,
    origin: d.origin,
    createdAt: d.createdAt,
    storageId: d.storageId,
    ragEntryId: d.ragEntryId,
    folderId: d.folderId,
    docType: d.docType,
    identityLine: d.identityLine,
    identityUserSet: d.identityUserSet,
  };
}

function docItem(
  d: Doc<"vaultDocuments">,
  key = `doc:${d._id}`,
  source = false,
): WorkspaceArtifact {
  return {
    key,
    kind: source ? "source" : "document",
    docId: d._id,
    title: d.title,
    createdAt: d.createdAt,
    status: d.status,
    mimeType: d.storedMimeType ?? d.mimeType,
    sizeBytes: d.size,
    ...(d.storageId ? { storageId: d.storageId } : {}),
  };
}

function mediaItem(plan: Doc<"plans">): WorkspaceArtifact | null {
  if (
    plan.kind !== "media" &&
    plan.mediaMode === undefined &&
    plan.proposalRefusal === undefined &&
    plan.artDirection === undefined &&
    plan.mediaCampaignId === undefined
  )
    return null;
  return {
    key: `plan:${plan._id}`,
    kind: "media",
    planId: plan._id,
    title: plan.subject || (plan.mediaMode === "image" ? "Image" : "Video"),
    createdAt: plan.createdAt,
    status: plan.renderStatus ?? plan.status,
    mimeType: plan.mediaMode === "image" ? "image/*" : "video/mp4",
  };
}

function planItems(plan: Doc<"plans">): WorkspaceArtifact[] {
  if (plan.parentPlanId !== undefined || plan.mediaCampaignId !== undefined) return [];
  const items: WorkspaceArtifact[] = [];
  const media = mediaItem(plan);
  if (media) items.push(media);
  for (const a of plan.attachments ?? [])
    items.push({
      key: `attachment:${plan._id}:${a.storageId}`,
      kind: "attachment",
      planId: plan._id,
      storageId: a.storageId,
      title: a.filename,
      createdAt: plan.createdAt,
      status: "ready",
      mimeType: a.mimeType,
      sizeBytes: a.size,
    });
  return items;
}

function campaignItem(c: Doc<"mediaCampaigns">): WorkspaceArtifact {
  return {
    key: `campaign:${c._id}`,
    kind: "campaign",
    campaignId: c._id,
    title: c.title,
    createdAt: c.createdAt,
    status: c.status,
  };
}

export const list = tenantQuery({
  args: { threadId: v.string(), stream: streamValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { threadId, stream, paginationOpts }) => {
    const opts: PaginationOptions = {
      ...paginationOpts,
      numItems: Math.min(PAGE_ROWS, Math.max(1, paginationOpts.numItems)),
      maximumRowsRead: PAGE_ROWS,
      maximumBytesRead: 8 * 1024 * 1024,
    };
    if (stream === "documents") {
      const result = await ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_sourceThread", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("sourceThreadId", threadId),
        )
        .order("desc")
        .paginate(opts);
      // Media artifacts belong to their plan/collection; indexing their docs would duplicate them.
      return {
        ...result,
        page: result.page
          .filter((d) => d.kind !== "image" && d.kind !== "reel")
          .map((d) => docItem(d)),
      };
    }
    if (stream === "campaigns") {
      const result = await ctx.db
        .query("mediaCampaigns")
        .withIndex("by_tenant_thread", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("threadId", threadId),
        )
        .order("desc")
        .paginate(opts);
      return { ...result, page: result.page.map(campaignItem) };
    }
    // Preserve Convex's native endCursor/pageStatus/splitCursor protocol. All refs in a row
    // travel together; truncating them behind a custom offset loses history on reactive inserts.
    // Convex caps a stored row at 1 MiB. Two rows and a 1 MiB read ceiling bound expansion,
    // including sparse pages, without reading any referenced document's content.
    const nested = { ...opts, numItems: 1, maximumRowsRead: 2, maximumBytesRead: 1024 * 1024 };
    const result =
      stream === "plans"
        ? await ctx.db
            .query("plans")
            .withIndex("by_thread_campaign", (q) =>
              q
                .eq("tenantId", ctx.tenantId)
                .eq("threadId", threadId)
                .eq("mediaCampaignId", undefined),
            )
            .order("desc")
            .paginate(nested)
        : await ctx.db
            .query("vaultSources")
            .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
            .order("desc")
            .paginate(nested);
    const page: WorkspaceArtifact[] =
      stream === "plans"
        ? (result.page as Doc<"plans">[]).flatMap(planItems)
        : (result.page as Doc<"vaultSources">[]).flatMap((row) =>
            row.docIds.map((docId, i) => ({
              key: `source:${row._id}:${docId}`,
              kind: row.role === "created" ? ("document" as const) : ("source" as const),
              docId,
              title: row.titles[i] ?? "Source document",
              createdAt: row.createdAt,
              status: row.role === "created" ? "ready" : "reference",
            })),
          );
    return { ...result, page };
  },
});

async function resolveReference(ctx: ScopedCtx, threadId: string, key: string) {
  const ref = parseWorkspaceArtifactKey(key);
  if (!ref) return null;
  if (ref.kind === "document" || ref.kind === "source") {
    const docId = ctx.db.normalizeId("vaultDocuments", ref.kind === "source" ? ref.docId : ref.id);
    if (!docId) return null;
    let isReference = false;
    if (ref.kind === "source") {
      const rowId = ctx.db.normalizeId("vaultSources", ref.id);
      const row = rowId ? await ctx.db.get(rowId) : null;
      if (
        !row ||
        row.tenantId !== ctx.tenantId ||
        row.threadId !== threadId ||
        !row.docIds.includes(docId)
      )
        return null;
      isReference = row.role === undefined;
    }
    const doc = await ctx.db.get(docId);
    if (
      !doc ||
      doc.tenantId !== ctx.tenantId ||
      (ref.kind === "document" &&
        (doc.sourceThreadId !== threadId || doc.kind === "image" || doc.kind === "reel"))
    )
      return null;
    return {
      kind: "document" as const,
      doc: projectDoc(doc),
      item: docItem(doc, key, isReference),
    };
  }
  if (ref.kind === "campaign") {
    const id = ctx.db.normalizeId("mediaCampaigns", ref.id);
    const campaign = id ? await ctx.db.get(id) : null;
    if (!campaign || campaign.tenantId !== ctx.tenantId || campaign.threadId !== threadId)
      return null;
    return { kind: "campaign" as const, campaignId: campaign._id, item: campaignItem(campaign) };
  }
  const id = ctx.db.normalizeId("plans", ref.id);
  const plan = id ? await ctx.db.get(id) : null;
  if (
    !plan ||
    plan.tenantId !== ctx.tenantId ||
    plan.threadId !== threadId ||
    plan.parentPlanId !== undefined
  )
    return null;
  if (plan.mediaCampaignId !== undefined) {
    if (ref.kind !== "media") return null;
    const campaign = await ctx.db.get(plan.mediaCampaignId);
    if (
      !campaign ||
      campaign.tenantId !== ctx.tenantId ||
      campaign.threadId !== threadId ||
      !campaign.items.some((item) => item.planId === plan._id)
    )
      return null;
  }
  if (ref.kind === "media") {
    const item = mediaItem(plan);
    return item ? { kind: "media" as const, planId: plan._id, item } : null;
  }
  const attachment = plan.attachments?.find((a) => a.storageId === ref.storageId);
  return attachment
    ? {
        kind: "attachment" as const,
        planId: plan._id,
        attachment,
        item: planItems(plan).find((item) => item.key === key) as WorkspaceArtifact,
      }
    : null;
}

export const resolve = tenantQuery({
  args: { threadId: v.string(), key: v.string() },
  handler: async (ctx, { threadId, key }) => resolveReference(ctx, threadId, key),
});

/** Small batches: arbitrary full-size rows count against Convex's read budget. */
export const resolveKeys = tenantQuery({
  args: { threadId: v.string(), keys: v.array(v.string()) },
  handler: async (ctx, { threadId, keys }) => {
    if (keys.length > RESOLVE_CHUNK) throw new Error("INVALID_WORKSPACE_KEYS");
    const items: WorkspaceArtifact[] = [];
    for (const key of keys) {
      const resolved = await resolveReference(ctx, threadId, key);
      if (resolved) items.push(resolved.item);
    }
    return items;
  },
});

/** No URL is minted until the human selects this exact owned chat artifact. */
export const download = tenantQuery({
  args: { threadId: v.string(), key: v.string() },
  handler: async (ctx, { threadId, key }) => {
    const resolved = await resolveReference(ctx, threadId, key);
    if (!resolved || (resolved.kind !== "attachment" && resolved.kind !== "document")) return null;
    const storageId =
      resolved.kind === "attachment" ? resolved.attachment.storageId : resolved.doc.storageId;
    if (!storageId) return null;
    const url = await ctx.storage.getUrl(storageId);
    return url
      ? {
          url,
          filename: resolved.item.title,
          mimeType: resolved.item.mimeType ?? "application/octet-stream",
        }
      : null;
  },
});
