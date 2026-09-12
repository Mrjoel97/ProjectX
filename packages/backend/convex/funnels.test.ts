import {
  deletableTables,
  exportableTables,
  type TenantDataExportPage,
  type TenantExportCursor,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Schema is the production validator, not a text snapshot. Behavioral API cases follow in31-02.
const tables = schema.tables as unknown as Record<
  string,
  {
    validator: { fields: Record<string, { kind: string; tableName?: string }> };
    indexes: { indexDescriptor: string; fields: string[] }[];
  }
>;
function funnelTable() {
  const table = tables.funnels;
  if (!table) throw new Error("funnels schema missing");
  return table;
}
describe("Phase31 aggregate-only funnel schema", () => {
  test("stores one fixed source and trusted artifact refs, never raw tokens or event metadata", () => {
    expect(tables.funnels).toBeDefined();
    expect(Object.keys(funnelTable().validator.fields).sort()).toEqual(
      [
        "tenantId",
        "vaultDocId",
        "storageId",
        "title",
        "source",
        "tokenHash",
        "status",
        "createdAt",
        "deactivatedAt",
        "visits",
        "claims",
        "downloads",
      ].sort(),
    );
    expect(funnelTable().validator.fields.vaultDocId).toMatchObject({
      kind: "id",
      tableName: "vaultDocuments",
    });
    expect(funnelTable().validator.fields.storageId).toMatchObject({
      kind: "id",
      tableName: "_storage",
    });
    for (const count of ["visits", "claims", "downloads"])
      expect(funnelTable().validator.fields[count]?.kind).toBe("float64");
    expect(funnelTable().validator.fields.source?.kind).toBe("string");
  });
  test("has bounded tenant/token lookups and no funnel event or visitor tables", () => {
    expect(tables.funnels).toBeDefined();
    expect(
      funnelTable().indexes.map(({ indexDescriptor, fields }) => ({
        name: indexDescriptor,
        fields,
      })),
    ).toEqual([
      { name: "by_tenant", fields: ["tenantId", "createdAt"] },
      { name: "by_token_hash", fields: ["tokenHash"] },
    ]);
    expect(Object.keys(tables).filter((name) => /^funnel/i.test(name))).toEqual(["funnels"]);
  });
});

test("native export and erasure include only this tenant's funnel and its retained bytes", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const fixture = await t.run(async (ctx) => {
    const a = await ctx.db.insert("users", {});
    const b = await ctx.db.insert("users", {});
    const rows = [];
    for (const tenantId of [a, b]) {
      const storageId = await ctx.storage.store(new Blob(["owned funnel artifact"]));
      const vaultDocId = await ctx.db.insert("vaultDocuments", {
        tenantId,
        title: "Fixture",
        kind: "upload",
        category: "general",
        source: "upload",
        mimeType: "text/plain",
        size: 20,
        contentHash: "fixture",
        status: "ready",
        createdAt: 1,
      });
      const id = await ctx.db.insert("funnels", {
        tenantId,
        vaultDocId,
        storageId,
        title: tenantId === a ? "A link" : "B link",
        source: "newsletter",
        tokenHash: `hash-${tenantId}`,
        status: "active",
        createdAt: 1,
        visits: 3,
        claims: 2,
        downloads: 1,
      });
      // A link's fixed bytes remain erasable even when its Vault reference no longer exists.
      await ctx.db.delete(vaultDocId);
      rows.push({ id, storageId });
    }
    return { a, b, rows };
  });
  const exportRef = makeFunctionReference<
    "query",
    { cursor?: TenantExportCursor },
    TenantDataExportPage
  >("tenantExport:exportTenantData");
  const exported = await t.withIdentity({ subject: `${fixture.a}|test` }).query(exportRef, {
    cursor: {
      tableIndex: exportableTables().indexOf("funnels"),
      cursor: null,
      rowsExported: 0,
      tableRows: 0,
      truncated: false,
      generatedAt: new Date().toISOString(),
    },
  });
  expect(exported.table.name).toBe("funnels");
  expect(exported.table.rows).toHaveLength(1);
  expect(exported.table.rows[0]).toMatchObject({
    title: "A link",
    source: "newsletter",
    visits: 3,
    claims: 2,
    downloads: 1,
  });
  const deleteRef = makeFunctionReference<
    "mutation",
    { tenantId: string; userId: Id<"users">; cursor: { tableIndex: number } },
    { deleted: number }
  >("tenantDelete:deleteTenantDataPage");
  const removed = await t.mutation(deleteRef, {
    tenantId: fixture.a,
    userId: fixture.a,
    cursor: { tableIndex: deletableTables().indexOf("funnels") },
  });
  expect(removed.deleted).toBe(1);
  const [mine, foreign] = fixture.rows;
  if (!mine || !foreign) throw new Error("two tenant fixture required");
  await t.run(async (ctx) => {
    expect(await ctx.db.get(mine.id)).toBeNull();
    expect(await ctx.storage.get(mine.storageId)).toBeNull();
    expect(await ctx.db.get(foreign.id)).not.toBeNull();
    expect(await ctx.storage.get(foreign.storageId)).not.toBeNull();
  });
});
