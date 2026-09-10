"use node";

// Trusted native preparation only: no public action, network URL, model call or artifact write.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { contentHash } from "./lib/hash";

export const VISUAL_FILE_LIMIT_BYTES = 1024 * 1024;

export type OwnedScreenshot = {
  bytes: ArrayBuffer;
  mimeType: "image/png" | "image/jpeg";
  sourceDocId: Id<"vaultDocuments">;
  sha256: string;
  byteLength: number;
};

/** Magic identifies the supported container, not a successful pixel decode. The provider
 * still must decode the image; no dimensions or visual acceptance are inferred here. */
function imageMime(bytes: Uint8Array): OwnedScreenshot["mimeType"] | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > png.length && png.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** Callers must apply their own exact candidate/capability gates before model execution.
 * Hashes bind the stored bytes, never Vault's potentially text-derived contentHash. */
export const readOwnedScreenshot = internalAction({
  args: {
    tenantId: v.string(),
    sourceDocId: v.id("vaultDocuments"),
    expectedSha256: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, sourceDocId, expectedSha256 }): Promise<OwnedScreenshot> => {
    if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new Error("VISUAL_EXPECTED_HASH_INVALID");
    }
    const doc = await ctx.runQuery(internal.vault.getDocForExtraction, {
      tenantId,
      vaultDocId: sourceDocId,
    });
    if (doc.status !== "ready" || !doc.storageId) throw new Error("VISUAL_SOURCE_NOT_READY");
    const sealed = await ctx.runQuery(internal.vaultFolders.sealedDocIds, {
      tenantId,
      docIds: [sourceDocId],
    });
    if (sealed.length) throw new Error("VISUAL_SOURCE_SEALED");
    if (doc.mimeType !== "image/png" && doc.mimeType !== "image/jpeg") {
      throw new Error("VISUAL_FORMAT_UNSUPPORTED");
    }
    const blob = await ctx.storage.get(doc.storageId);
    if (!blob) throw new Error("VISUAL_SOURCE_MISSING");
    // Never trust caller-supplied Vault.size; bound storage materialization itself.
    if (blob.size > VISUAL_FILE_LIMIT_BYTES) throw new Error("VISUAL_FILE_TOO_LARGE");
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength > VISUAL_FILE_LIMIT_BYTES) throw new Error("VISUAL_FILE_TOO_LARGE");
    const mimeType = imageMime(new Uint8Array(bytes));
    if (!mimeType) throw new Error("VISUAL_FORMAT_UNSUPPORTED");
    if (mimeType !== doc.mimeType) throw new Error("VISUAL_MIME_MISMATCH");
    const sha256 = await contentHash(bytes);
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
      throw new Error("VISUAL_SOURCE_CHANGED");
    }
    return { bytes, mimeType, sourceDocId, sha256, byteLength: bytes.byteLength };
  },
});
