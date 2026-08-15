import {
  AUDIT_ARCHIVE_STATEMENT,
  summarizeTenantCredential,
  TENANT_EXPORT_SCHEMA_VERSION,
  TENANT_TABLE_CLASSIFICATION,
  exportableTables,
  tenantTableScope,
  type DeletableTenantTable,
  type TenantDataExportPage,
} from "@pikar/core/tenantData";
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";

export const TENANT_EXPORT_PAGE_SIZE = 16;
export const TENANT_EXPORT_TOTAL_ROW_CAP = 128;

const omittedReason = (category: "global" | "audit_immutable", table: string): string => {
  if (category === "global") {
    return "Excluded: deployment-global configuration is not tenant data.";
  }
  if (table === "audit") {
    return `Excluded: immutable audit archive; it contains ${AUDIT_ARCHIVE_STATEMENT}`;
  }
  return "Excluded: refs-only audit/compliance operational records are not tenant content.";
};

export const exportTenantData = tenantQuery({
  args: {
    cursor: v.optional(
      v.object({
        tableIndex: v.number(),
        cursor: v.union(v.string(), v.null()),
        rowsExported: v.number(),
        generatedAt: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<TenantDataExportPage> => {
    const generatedAt = args.cursor?.generatedAt ?? new Date(Date.now()).toISOString();
    const tableIndex = args.cursor?.tableIndex ?? 0;
    const rowsExported = args.cursor?.rowsExported ?? 0;
    if (
      !Number.isInteger(tableIndex) ||
      tableIndex < 0 ||
      !Number.isInteger(rowsExported) ||
      rowsExported < 0 ||
      rowsExported > TENANT_EXPORT_TOTAL_ROW_CAP
    ) {
      throw new Error("INVALID_EXPORT_CURSOR");
    }

    const exportTables = exportableTables();
    const table = exportTables[tableIndex];
    if (!table) throw new Error("INVALID_EXPORT_CURSOR");

    const omitted: Record<string, string> = {};
    for (const [omittedTable, category] of Object.entries(TENANT_TABLE_CLASSIFICATION)) {
      if (category === "global" || category === "audit_immutable") {
        omitted[omittedTable] = omittedReason(category, omittedTable);
      }
    }

    const remaining = TENANT_EXPORT_TOTAL_ROW_CAP - rowsExported;
    let rows: readonly Record<string, unknown>[];
    let continueCursor: string | null = null;
    let tableDone = true;

    if (tenantTableScope(table) === "identity") {
      const user = await ctx.db.get(ctx.userId);
      rows = user && remaining > 0 ? [user] : [];
    } else {
      const page = await ctx.db
        .query(table as Exclude<DeletableTenantTable, "users">)
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .paginate({
          cursor: args.cursor?.cursor ?? null,
          numItems: Math.min(TENANT_EXPORT_PAGE_SIZE, remaining),
        });
      rows = page.page;
      continueCursor = page.continueCursor;
      tableDone = page.isDone;
    }

    const category = TENANT_TABLE_CLASSIFICATION[table];
    const shapedRows =
      category === "tenant_credential" ? rows.map(summarizeTenantCredential) : rows;
    const totalRows = rowsExported + shapedRows.length;
    const capReached = totalRows >= TENANT_EXPORT_TOTAL_ROW_CAP;
    const isLastTable = tableIndex === exportTables.length - 1;
    const nextCursor =
      capReached || (tableDone && isLastTable)
        ? null
        : {
            tableIndex: tableDone ? tableIndex + 1 : tableIndex,
            cursor: tableDone ? null : continueCursor,
            rowsExported: totalRows,
            generatedAt,
          };

    return {
      header: {
        schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
        generatedAt,
        tenantId: ctx.tenantId,
        auditArchive: AUDIT_ARCHIVE_STATEMENT,
      },
      table: { name: table, rows: shapedRows },
      omitted,
      nextCursor,
      limits: {
        pageSize: TENANT_EXPORT_PAGE_SIZE,
        totalRows,
        truncated: capReached && (!tableDone || !isLastTable),
      },
    };
  },
});
