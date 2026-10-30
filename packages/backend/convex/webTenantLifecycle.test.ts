import {
  deletableTables,
  type TenantDataExportPage,
  type TenantDeletionCursor,
  type TenantExportCursor,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const exportPage = makeFunctionReference<
  "query",
  { cursor?: TenantExportCursor },
  TenantDataExportPage
>("tenantExport:exportTenantData");
const deletePage = makeFunctionReference<
  "mutation",
  { tenantId: string; userId: Id<"users">; cursor: TenantDeletionCursor },
  { table: string; deleted: number; nextCursor: TenantDeletionCursor | null }
>("tenantDelete:deleteTenantDataPage");
const webTables = [
  "onlinePresenceSessions",
  "webSubmissions",
  "webMetrics",
  "webProjectVersions",
  "webProjects",
] as const;

test("native export and erasure include website/session content and stored artifact bytes without crossing tenants", async () => {
  const t = convexTest(schema, modules);
  const tenants = await t.run(async (ctx) => {
    const seed = async (marker: string) => {
      const tenantId = await ctx.db.insert("users", {
        email: `${marker.toLowerCase()}@example.test`,
      });
      const artifactStorageId = await ctx.storage.store(
        new Blob([`${marker}-stored-website`], { type: "text/html" }),
      );
      const projectId = await ctx.db.insert("webProjects", {
        tenantId,
        kind: "site",
        slug: marker.toLowerCase(),
        title: `${marker}-website`,
        publicHost: "sites.example",
        domainMode: "platform_path",
        hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
        draftVersion: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("webProjectVersions", {
        tenantId,
        projectId,
        version: 1,
        artifactStorageId,
        document: {
          kind: "site",
          title: `${marker}-document`,
          brand: { name: marker },
          navigation: [],
          pages: [
            {
              slug: "home",
              title: marker,
              nodes: [{ kind: "text", text: `${marker}-private-copy` }],
            },
          ],
        },
        contentHash: `sha256:${"a".repeat(64)}`,
        rendererVersion: "web-runtime-v3",
        artifactHtml: `<html>${marker}-inline-artifact</html>`,
        artifactByteLength: 64,
        createdBy: tenantId,
        createdAt: 1,
        sourceRefs: [],
      });
      const submissionId = await ctx.db.insert("webSubmissions", {
        tenantId,
        projectId,
        version: 1,
        formId: "contact",
        idempotencyKeyHash: `${marker}-idempotency-hash`,
        outcome: "accepted",
        createdAt: 1,
        expiresAt: 1000,
        abuseWindowExpiresAt: 100,
      });
      const metricId = await ctx.db.insert("webMetrics", {
        tenantId,
        projectId,
        version: 1,
        kind: "page_view",
        count: 7,
        windowStartedAt: 1,
        windowEndsAt: 100,
        updatedAt: 1,
      });
      const planId = await ctx.db.insert("plans", {
        tenantId,
        threadId: `${marker}-thread`,
        status: "collecting",
        createdAt: 1,
      });
      const sessionId = await ctx.db.insert("onlinePresenceSessions", {
        tenantId,
        projectId,
        planId,
        threadId: `${marker}-thread`,
        revision: 1,
        humanMessages: [
          { ref: `user:${marker}:1`, text: `${marker}-private-request`, sequence: 1 },
        ],
        brief: { note: `${marker}-private-brief` },
        status: "collecting",
        createdAt: 1,
        updatedAt: 1,
      });
      const auditId = await ctx.db.insert("audit", {
        tenantId,
        correlationId: `${marker}-audit`,
        eventType: "test.website",
        actor: "user",
        payload: { projectId },
        ts: 1,
      });
      return {
        tenantId,
        artifactStorageId,
        rowIds: [sessionId, submissionId, metricId, versionId, projectId],
        auditId,
      };
    };
    return { mine: await seed("MINE"), other: await seed("OTHER") };
  });

  let cursor: TenantExportCursor | undefined;
  const tables: Record<string, unknown[]> = {};
  const files: TenantDataExportPage["files"][number][] = [];
  do {
    const page = await t
      .withIdentity({ subject: `${tenants.mine.tenantId}|export` })
      .query(exportPage, cursor ? { cursor } : {});
    tables[page.table.name] = [...(tables[page.table.name] ?? []), ...page.table.rows];
    files.push(...page.files);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  for (const table of webTables) expect(tables[table]).toHaveLength(1);
  const exported = JSON.stringify(tables);
  for (const marker of [
    "MINE-private-request",
    "MINE-private-brief",
    "MINE-private-copy",
    "MINE-inline-artifact",
  ])
    expect(exported).toContain(marker);
  expect(exported).not.toContain("OTHER");
  expect(
    files.find((file) => file.storageId === String(tenants.mine.artifactStorageId))?.url,
  ).toBeTruthy();
  expect(files.some((file) => file.storageId === String(tenants.other.artifactStorageId))).toBe(
    false,
  );

  // Drive the native bounded deletion adapter for each newly introduced tenant-owned table.
  // Missing classification or a wrong storage field now fails on real rows/files, not metadata.
  for (const table of webTables) {
    const tableIndex = deletableTables().indexOf(table);
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    const result = await t.mutation(deletePage, {
      tenantId: tenants.mine.tenantId,
      userId: tenants.mine.tenantId,
      cursor: { tableIndex },
    });
    expect(result).toMatchObject({ table, deleted: 1 });
  }
  await t.run(async (ctx) => {
    for (const rowId of tenants.mine.rowIds) expect(await ctx.db.get(rowId)).toBeNull();
    for (const rowId of tenants.other.rowIds) expect(await ctx.db.get(rowId)).not.toBeNull();
    expect(await ctx.db.system.get("_storage", tenants.mine.artifactStorageId)).toBeNull();
    expect(await ctx.db.system.get("_storage", tenants.other.artifactStorageId)).not.toBeNull();
    expect(await ctx.db.get(tenants.mine.auditId)).not.toBeNull();
    expect(await ctx.db.get(tenants.other.auditId)).not.toBeNull();
  });
});
