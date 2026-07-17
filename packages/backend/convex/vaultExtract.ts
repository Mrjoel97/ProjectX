"use node";

// Wave-0 stub — Lane 1 (lane-1/vault-extract) replaces this body with the real dispatcher:
// preCall gate → markExtracting → load bytes (ctx.storage.get, NEVER via args) → SMOKE:: sniff →
// pdf text-layer (unpdf) / hosted OCR (extractVisual shape) / office flatten
// (@pikar/vault/officeText) → scanText fail-closed → refs-only audit → ingestExtractedText seam.
// Exists NOW so codegen + the vaultUpload hook + Lane 3's sweep reference
// internal.vaultExtract.extractDoc from day one. NEVER imports llm.ts or vaultTranscribe.ts
// (§96 circular-inference rule — "use node" modules stay siblings, not imports).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const extractDoc = internalAction({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId }): Promise<null> => {
    await ctx.runMutation(internal.vault.markFailed, { vaultDocId, reason: "not_implemented" });
    return null;
  },
});
