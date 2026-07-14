// Inbound intake DB adapter (INTK-02/03) — a normal DB module, NOT "use node". Holds every
// read/write `intake.ts`'s "use node" actions reach via ctx.runQuery/ctx.runMutation (CLAUDE.md
// §2/§96: a "use node" action has no ctx.db). Mirrors requests.ts's generateUploadUrl precedent
// for the tenant-scoped upload door; the artifact CRUD is internal-only (intake.ts is the sole
// caller — no client ever mutates an intakeArtifacts row directly).
//
// `extracted` (when present) holds REDACTED safeText ONLY (CLAUDE.md §4) — intake.ts never
// writes raw extracted text here.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";

const KIND = v.union(
  v.literal("image"),
  v.literal("pdf"),
  v.literal("audio"),
  v.literal("document"),
  v.literal("unknown"),
);

const STATUS = v.union(
  v.literal("uploaded"),
  v.literal("extracting"),
  v.literal("extracted"),
  v.literal("failed"),
);

/** Upload-first: the client PUTs the file/audio blob to this URL, then calls
 *  intake.attachToThread/dictateToThread with the resulting storageId. */
export const generateUploadUrl = tenantMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Insert the artifact row at status="uploaded" (intake.ts's "use node" action has no ctx.db). */
export const insertArtifact = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    kind: KIND,
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("intakeArtifacts", { ...args, status: "uploaded", createdAt: Date.now() }),
});

/** Patch status/extracted. Only supplied fields are written (drop-undefined — mirrors
 *  plans.patchPlan) so a status-only patch never clobbers a previously-written extracted field. */
export const patchArtifact = internalMutation({
  args: {
    artifactId: v.id("intakeArtifacts"),
    status: v.optional(STATUS),
    extracted: v.optional(v.string()),
  },
  handler: async (ctx, { artifactId, ...patch }) => {
    const fields = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(artifactId, fields);
  },
});

/** Thread-scoped artifact list (tenant-guarded — feeds a future intake UI, Plan 05). */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) =>
    await ctx.db
      .query("intakeArtifacts")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .collect(),
});

/** One artifact by id (internal — intake.ts's "use node" action reads it via ctx.runQuery). */
export const getArtifact = internalQuery({
  args: { artifactId: v.id("intakeArtifacts") },
  handler: async (ctx, { artifactId }) => await ctx.db.get(artifactId),
});
