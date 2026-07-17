"use node";

// Wave-0 stub — Lane 4 (lane-4/video-transcribe) replaces this body with the transcription rail:
// preCall gate → markExtracting → load bytes (ctx.storage.get, NEVER via args) →
// SMOKE::transcribe:: sniff → TRANSCRIBABLE_CONTAINER_MIME check (unsupported container →
// markFailed("unsupported_video_container"), honest failure) → experimental_transcribe
// (intake.ts transcribeAudio shape, duration-priced spend) → scanText fail-closed →
// refs-only audit → ingestExtractedText seam. Exists NOW so codegen + the vaultUpload hook +
// Lane 3's sweep reference internal.vaultTranscribe.transcribeDoc from day one. NEVER imports
// llm.ts or vaultExtract.ts (§96 circular-inference rule).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const transcribeDoc = internalAction({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId }): Promise<null> => {
    await ctx.runMutation(internal.vault.markFailed, { vaultDocId, reason: "not_implemented" });
    return null;
  },
});
