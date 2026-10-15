import type { StorageActionWriter } from "convex/server";
import type { MutationCtx } from "../convex/_generated/server";

/** Test-only fixture: model the trusted HTTP relay's receipt alongside its stored bytes. */
export async function seedOwnedUpload(
  ctx: Omit<MutationCtx, "storage"> & { storage: StorageActionWriter },
  tenantId: string,
  blob: Blob,
) {
  const storageId = await ctx.storage.store(blob);
  await ctx.db.insert("uploadReceipts", {
    tenantId,
    storageId,
    ticketHash: `fixture:${storageId}`,
    state: "complete",
    expiresAt: Number.MAX_SAFE_INTEGER,
    size: blob.size,
    mimeType: blob.type,
  });
  return storageId;
}
