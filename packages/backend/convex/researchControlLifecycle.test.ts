import {
  deletableTables,
  exportableTables,
  type TenantDataExportPage,
  type TenantExportCursor,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const row = (tenantId: string) => ({
  tenantId,
  requestId: "00000000-0000-4000-8000-000000000001",
  limit: 2,
  attempts: ["00000000-0000-4000-8000-000000000002"],
  expiresAt: 1,
  closed: true,
});

test("native export and erasure reach research controls and preserve the other tenant", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const f = await t.run(async (ctx) => {
    const a = await ctx.db.insert("users", {});
    const b = await ctx.db.insert("users", {});
    const mine = await ctx.db.insert("researchControls", row(a));
    const other = await ctx.db.insert("researchControls", row(b));
    return { a, b, mine, other };
  });
  const exportRef = makeFunctionReference<
    "query",
    { cursor?: TenantExportCursor },
    TenantDataExportPage
  >("tenantExport:exportTenantData");
  const exported = await t.withIdentity({ subject: `${f.a}|test` }).query(exportRef, {
    cursor: {
      tableIndex: exportableTables().indexOf("researchControls"),
      cursor: null,
      rowsExported: 0,
      tableRows: 0,
      truncated: false,
      generatedAt: new Date().toISOString(),
    },
  });
  expect(exported.table.name).toBe("researchControls");
  expect(exported.table.rows).toHaveLength(1);
  expect(exported.table.rows[0]).toMatchObject(row(f.a));
  const deleted = await t.mutation(internal.tenantDelete.deleteTenantDataPage, {
    tenantId: f.a,
    userId: f.a,
    cursor: { tableIndex: deletableTables().indexOf("researchControls") },
  });
  expect(deleted.deleted).toBe(1);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(f.mine)).toBeNull();
    expect(await ctx.db.get(f.other)).toMatchObject(row(f.b));
  });
});

test("native exact evaluation cleanup removes controls without deleting a neighboring allowance", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const tenantId = "eval-research-lifecycle";
  const ids = await t.run(async (ctx) => ({
    mine: await ctx.db.insert("researchControls", row(tenantId)),
    other: await ctx.db.insert("researchControls", row(`${tenantId}-neighbor`)),
  }));
  await expect(
    t.mutation(internal.tenantDelete.purgeEvalTenant, { tenantId: "real-tenant", exact: true }),
  ).rejects.toThrow("NOT_AN_EVAL_TENANT");
  const result = await t.mutation(internal.tenantDelete.purgeEvalTenant, { tenantId, exact: true });
  expect(result.deleted).toBe(1);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.mine)).toBeNull();
    expect(await ctx.db.get(ids.other)).toMatchObject(row(`${tenantId}-neighbor`));
  });
});
