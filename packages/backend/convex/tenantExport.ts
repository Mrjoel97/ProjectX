import {
  AUDIT_ARCHIVE_STATEMENT,
  type DeletableTenantTable,
  exportableTables,
  summarizeTenantCredential,
  TENANT_EXPORT_SCHEMA_VERSION,
  TENANT_TABLE_CLASSIFICATION,
  type TenantDataExportPage,
  tenantTableScope,
} from "@pikar/core/tenantData";
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";

export const TENANT_EXPORT_PAGE_SIZE = 256;
/**
 * The budget is PER TABLE, not global. `exportableTables()` is a fixed order in which the two
 * highest-volume tables (`agentSteps`, `telemetry`) sit ahead of most business data, so a single
 * global budget spends itself on those two and exports contacts/goals/proposals/vaultDocuments as
 * nothing — the coverage a "portable record of your data" claim depends on becomes an artefact of
 * table ordering. A per-table cap makes every table representable; the global cap below stays only
 * as a memory bound on the single JSON blob the browser assembles.
 */
export const TENANT_EXPORT_ROWS_PER_TABLE = 500;
export const TENANT_EXPORT_TOTAL_ROW_CAP = 20_000;

const omittedReason = (
  category: "global" | "audit_immutable" | "admission_plane",
  table: string,
): string => {
  if (category === "global") {
    return "Excluded: deployment-global configuration is not tenant data.";
  }
  if (category === "admission_plane") {
    // Deliberately NOT the "not tenant data" wording: these rows DO hold this person's email.
    // They are omitted because they are keyed by email and precede the tenant, so this
    // tenant-scoped export cannot address them — not because there is nothing of theirs in them.
    return "Excluded: beta admission records are keyed by email address and precede any tenant, so this tenant-scoped export cannot reach them.";
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
        tableRows: v.number(),
        truncated: v.boolean(),
        generatedAt: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<TenantDataExportPage> => {
    const generatedAt = args.cursor?.generatedAt ?? new Date(Date.now()).toISOString();
    const tableIndex = args.cursor?.tableIndex ?? 0;
    const rowsExported = args.cursor?.rowsExported ?? 0;
    const tableRows = args.cursor?.tableRows ?? 0;
    // `>=` not `>`: a legitimate cursor is never minted at either ceiling (the page that reaches
    // one returns `nextCursor: null`), so an at-ceiling cursor is necessarily forged, and letting
    // it through would compute a `remaining` of 0 and hand `paginate` a `numItems` of 0.
    if (
      !Number.isInteger(tableIndex) ||
      tableIndex < 0 ||
      !Number.isInteger(rowsExported) ||
      rowsExported < 0 ||
      rowsExported >= TENANT_EXPORT_TOTAL_ROW_CAP ||
      !Number.isInteger(tableRows) ||
      tableRows < 0 ||
      tableRows >= TENANT_EXPORT_ROWS_PER_TABLE
    ) {
      throw new Error("INVALID_EXPORT_CURSOR");
    }

    const exportTables = exportableTables();
    const table = exportTables[tableIndex];
    if (!table) throw new Error("INVALID_EXPORT_CURSOR");

    const omitted: Record<string, string> = {};
    for (const [omittedTable, category] of Object.entries(TENANT_TABLE_CLASSIFICATION)) {
      if (
        category === "global" ||
        category === "audit_immutable" ||
        category === "admission_plane"
      ) {
        omitted[omittedTable] = omittedReason(category, omittedTable);
      }
    }

    const remaining = Math.min(
      TENANT_EXPORT_ROWS_PER_TABLE - tableRows,
      TENANT_EXPORT_TOTAL_ROW_CAP - rowsExported,
    );
    let rows: readonly Record<string, unknown>[];
    let continueCursor: string | null = null;
    let tableDone = true;

    if (tenantTableScope(table) === "identity") {
      const user = await ctx.db.get(ctx.userId);
      rows = user ? [user] : [];
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
    const tableRowsAfter = tableRows + shapedRows.length;
    // Only a table with rows STILL UNREAD is truncated. One that ends exactly on its budget is
    // complete, and saying otherwise would cry wolf on every 500-row table.
    const tableCapped = !tableDone && tableRowsAfter >= TENANT_EXPORT_ROWS_PER_TABLE;
    const totalCapped = totalRows >= TENANT_EXPORT_TOTAL_ROW_CAP;
    // Move on when the table is exhausted OR has spent its own budget.
    const advance = tableDone || tableCapped;
    const isLastTable = tableIndex === exportTables.length - 1;
    const finished = advance && isLastTable;
    // Sticky. The client overwrites `limits` with each page, so a truncation that happened twenty
    // pages ago has to travel forward in the cursor or it vanishes from the final envelope.
    const truncated =
      (args.cursor?.truncated ?? false) || tableCapped || (totalCapped && !finished);
    const nextCursor =
      totalCapped || finished
        ? null
        : {
            tableIndex: advance ? tableIndex + 1 : tableIndex,
            cursor: advance ? null : continueCursor,
            rowsExported: totalRows,
            tableRows: advance ? 0 : tableRowsAfter,
            truncated,
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
        truncated,
      },
    };
  },
});
