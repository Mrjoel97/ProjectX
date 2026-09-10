"use node";

// Operator preview and trusted deterministic preparation only. No skill activation or paid call.
import { DATA_PROFILE_LIMITS, type DataProfile, profileDataset } from "@pikar/core/dataProfile";
import { readDataWorkbook } from "@pikar/vault/dataWorkbook";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { ownerAction } from "./lib/functions";
import { contentHash } from "./lib/hash";

async function prepareProfile(
  ctx: ActionCtx,
  tenantId: string,
  sourceDocId: Id<"vaultDocuments">,
  hasHeader = false,
): Promise<DataProfile> {
  const doc = await ctx.runQuery(internal.vault.getDocForExtraction, {
    tenantId,
    vaultDocId: sourceDocId,
  });
  if (doc.status !== "ready" || !doc.storageId) throw new Error("DATA_SOURCE_NOT_READY");
  const sealed = await ctx.runQuery(internal.vaultFolders.sealedDocIds, {
    tenantId,
    docIds: [sourceDocId],
  });
  if (sealed.length) throw new Error("DATA_SOURCE_SEALED");
  const format =
    doc.mimeType === "text/csv" || doc.mimeType === "application/csv"
      ? "csv"
      : doc.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ? "xlsx"
        : null;
  if (!format) throw new Error("DATA_FORMAT_UNSUPPORTED");
  const blob = await ctx.storage.get(doc.storageId);
  if (!blob) throw new Error("DATA_SOURCE_MISSING");
  if (blob.size > DATA_PROFILE_LIMITS.fileBytes) throw new Error("DATA_FILE_TOO_LARGE");
  const buffer = await blob.arrayBuffer();
  const workbook = readDataWorkbook(new Uint8Array(buffer), format, hasHeader);
  return profileDataset({
    source: {
      fileId: sourceDocId,
      contentHash: await contentHash(buffer),
      byteLength: buffer.byteLength,
      format,
    },
    ...workbook,
  });
}

/** Native pack callers must apply their own exact-version evidence and capability gates first. */
export const profileOwnedDataset = internalAction({
  args: {
    tenantId: v.string(),
    sourceDocId: v.id("vaultDocuments"),
    hasHeader: v.optional(v.boolean()),
  },
  handler: async (ctx, { tenantId, sourceDocId, hasHeader }): Promise<DataProfile> =>
    prepareProfile(ctx, tenantId, sourceDocId, hasHeader),
});

/** Engineering verification: exact owned file, existing owner auth, no model/warehouse authority.
 * The artifact records deterministic evidence; it is not evidence that a candidate skill passed. */
export const previewDataset = ownerAction({
  args: { sourceDocId: v.id("vaultDocuments"), hasHeader: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { sourceDocId, hasHeader },
  ): Promise<{
    artifactId: Id<"vaultDocuments">;
    sourceDocId: Id<"vaultDocuments">;
    rowCount: number;
    warningCount: number;
  }> => {
    const profile = await prepareProfile(ctx, ctx.tenantId, sourceDocId, hasHeader);
    const markdown = [
      "# Data profile — operator preview",
      "",
      "Deterministic file profile. Human review required. No candidate skill, formula, macro, external link or warehouse query was executed.",
      "",
      "Numbers describe observed cells only. CSV values retain their original text types. See coverage and warnings before interpreting the profile.",
      "",
      "```json",
      JSON.stringify(profile, null, 2),
      "```",
    ].join("\n");
    const artifactId: Id<"vaultDocuments"> = await ctx.runMutation(
      internal.vault.insertCreatedDoc,
      {
        tenantId: ctx.tenantId,
        title: "Data profile — operator preview",
        form: "long",
        markdown,
        contentHash: await contentHash(markdown),
      },
    );
    return {
      artifactId,
      sourceDocId,
      rowCount: profile.rowCount,
      warningCount: profile.warnings.length,
    };
  },
});
