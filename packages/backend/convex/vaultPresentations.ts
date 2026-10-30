import { type PresentationSpec, validatePresentationSpec } from "@pikar/core/presentation";
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";
import { internalMutation } from "./lib/tenantLifecycle";

/** The preview is an optional view; the owned PPTX remains the original deliverable. */
export const byDoc = tenantQuery({
  args: { docId: v.id("vaultDocuments") },
  handler: async (ctx, { docId }): Promise<PresentationSpec | null> => {
    const doc = await ctx.db.get(docId);
    if (
      !doc ||
      doc.tenantId !== ctx.tenantId ||
      doc.storedMimeType !==
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
      return null;
    const row = await ctx.db
      .query("vaultPresentations")
      .withIndex("by_doc", (q) => q.eq("tenantId", ctx.tenantId).eq("docId", docId))
      .unique();
    return row ? validatePresentationSpec(JSON.parse(row.spec)) : null;
  },
});

export const upsert = internalMutation({
  args: {
    tenantId: v.string(),
    docId: v.id("vaultDocuments"),
    spec: v.string(),
    expectedStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { tenantId, docId, spec, expectedStorageId }): Promise<void> => {
    if (new TextEncoder().encode(spec).length > 128 * 1024)
      throw new Error("presentation_preview_too_large");
    const doc = await ctx.db.get(docId);
    if (
      !doc ||
      doc.tenantId !== tenantId ||
      doc.origin !== "agent" ||
      !doc.storageId ||
      doc.storedMimeType !==
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
      throw new Error("presentation_not_owned");
    if (expectedStorageId && doc.storageId !== expectedStorageId)
      throw new Error("stale_presentation_preview");
    const clean = JSON.stringify(validatePresentationSpec(JSON.parse(spec)));
    const existing = await ctx.db
      .query("vaultPresentations")
      .withIndex("by_doc", (q) => q.eq("tenantId", tenantId).eq("docId", docId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { spec: clean });
    else await ctx.db.insert("vaultPresentations", { tenantId, docId, spec: clean });
  },
});
