"use node";

// Authenticated human edit of one native vertical artifact. Rendering is staged before the
// atomic CAS; neither candidate state nor external delivery is touched.
import { markdownToSheets } from "@pikar/core";
import { sheetsToXlsx } from "@pikar/vault/sheets";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { markdownToPdf } from "./llm";

const EDIT_CHAR_CAP = 25_000;

export const save = tenantAction({
  args: { artifactId: v.id("vaultDocuments"), markdown: v.string() },
  handler: async (ctx, { artifactId, markdown }): Promise<{ saved: true }> => {
    if (!markdown.trim() || markdown.length > EDIT_CHAR_CAP)
      throw new Error("ARTIFACT_EDIT_BOUNDS");
    const prior = await ctx.runQuery(internal.verticalPacks.editPreparation, {
      tenantId: ctx.tenantId,
      artifactId,
    });
    if (!prior) throw new Error("ARTIFACT_ORIGIN_UNVERIFIED");
    if (prior.text === markdown) throw new Error("ARTIFACT_EDIT_UNCHANGED");

    let storageId: Id<"_storage"> | undefined;
    if (prior.form === "long") {
      const bytes = (await markdownToPdf(prior.title, markdown)) as BlobPart;
      storageId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
    } else if (prior.form === "sheet") {
      const rows = markdownToSheets(markdown);
      if (rows.length === 0) throw new Error("ARTIFACT_EDIT_NO_TABLE");
      const bytes = sheetsToXlsx(rows) as BlobPart;
      storageId = await ctx.storage.store(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
    }

    try {
      await ctx.runMutation(internal.verticalPacks.commitEdit, {
        tenantId: ctx.tenantId,
        artifactId,
        expectedContentHash: prior.contentHash,
        markdown,
        contentHash: await contentHash(markdown),
        form: prior.form,
        storageId,
      });
    } catch (error) {
      if (storageId) await ctx.storage.delete(storageId);
      throw error;
    }
    return { saved: true };
  },
});
