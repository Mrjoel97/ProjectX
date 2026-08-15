import {
  deletableTables,
  tenantTableScope,
  type DeletableTenantTable,
  type TenantDeletionCursor,
} from "@pikar/core/tenantData";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const TENANT_DELETE_BATCH_SIZE = 2;

/**
 * One bounded transaction in the tenant-erasure sequence. This adapter can only obtain table
 * names from deletableTables(); audit/global names are absent from its type and runtime source.
 * The public owner/revocation orchestration is layered over this primitive in Task 2.
 */
export const deleteTenantDataPage = internalMutation({
  args: {
    tenantId: v.string(),
    userId: v.id("users"),
    cursor: v.optional(v.object({ tableIndex: v.number() })),
  },
  handler: async (ctx, args): Promise<{
    table: DeletableTenantTable;
    deleted: number;
    nextCursor: TenantDeletionCursor | null;
  }> => {
    const tableIndex = args.cursor?.tableIndex ?? 0;
    if (!Number.isInteger(tableIndex) || tableIndex < 0) {
      throw new Error("INVALID_DELETE_CURSOR");
    }

    const tables = deletableTables();
    const table = tables[tableIndex];
    if (!table) throw new Error("INVALID_DELETE_CURSOR");

    if (tenantTableScope(table) === "identity") {
      const user = await ctx.db.get(args.userId);
      if (user && String(user._id) === args.tenantId) await ctx.db.delete(user._id);
      return { table, deleted: user && String(user._id) === args.tenantId ? 1 : 0, nextCursor: null };
    }

    const page = await ctx.db
      .query(table as Exclude<DeletableTenantTable, "users">)
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(TENANT_DELETE_BATCH_SIZE + 1);
    const rows = page.slice(0, TENANT_DELETE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete(row._id);

    return {
      table,
      deleted: rows.length,
      nextCursor: {
        tableIndex: page.length > TENANT_DELETE_BATCH_SIZE ? tableIndex : tableIndex + 1,
      },
    };
  },
});
