import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
/** Read current slots, never an entire plan's immutable attempt history. */
export async function currentMediaJobs(
  ctx: Pick<QueryCtx, "db">,
  tenantId: string,
  plan: Doc<"plans">,
  succeededOnly = false,
): Promise<Doc<"mediaJobs">[]> {
  const indexes = [...new Set([0, -1, -2, ...(plan.shots ?? []).map((s) => s.index)])];
  if (indexes.length > 103) throw new Error("MEDIA_DECK_TOO_LARGE");
  const rows: Doc<"mediaJobs">[] = [];
  for (const blockIndex of indexes)
    for (const kind of ["video", "image", "tts", "stt", "audio"] as const) {
      const row = succeededOnly
        ? await ctx.db
            .query("mediaJobs")
            .withIndex("by_plan_slot_kind_status_created", (q) =>
              q
                .eq("tenantId", tenantId)
                .eq("planId", plan._id)
                .eq("blockIndex", blockIndex)
                .eq("kind", kind)
                .eq("status", "succeeded"),
            )
            .order("desc")
            .first()
        : await ctx.db
            .query("mediaJobs")
            .withIndex("by_plan_slot_kind_created", (q) =>
              q
                .eq("tenantId", tenantId)
                .eq("planId", plan._id)
                .eq("blockIndex", blockIndex)
                .eq("kind", kind),
            )
            .order("desc")
            .first();
      if (row) rows.push(row);
    }
  return rows;
}
/** Indexed active-status lookups avoid scanning terminal attempt history. */
export async function activeMediaJobs(
  ctx: Pick<QueryCtx, "db">,
  tenantId: string,
  planId: Id<"plans">,
): Promise<Doc<"mediaJobs">[]> {
  const out: Doc<"mediaJobs">[] = [];
  for (const status of ["queued", "submitted"] as const) {
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan_status", (q) =>
        q.eq("tenantId", tenantId).eq("planId", planId).eq("status", status),
      )
      .take(101);
    if (rows.length > 100) throw new Error("MEDIA_ACTIVE_BATCH_TOO_LARGE");
    out.push(...rows);
  }
  return out;
}

/** Reservation writers bound one batch to100 lines; overflow is corruption, never a partial batch. */
export async function readMediaBatch(
  ctx: Pick<QueryCtx, "db">,
  tenantId: string,
  batchId: string,
): Promise<Doc<"mediaJobs">[]> {
  const rows = await ctx.db
    .query("mediaJobs")
    .withIndex("by_batch", (q) => q.eq("tenantId", tenantId).eq("batchId", batchId))
    .take(101);
  if (rows.length > 100) throw new Error("MEDIA_BATCH_TOO_LARGE");
  return rows;
}
