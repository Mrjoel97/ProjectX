/// <reference types="vite/client" />

import {
  AUDIT_ARCHIVE_STATEMENT,
  TENANT_EXPORT_SCHEMA_VERSION,
  type TenantDataExport,
} from "@pikar/core";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const exportTenantData = makeFunctionReference<"query", Record<string, never>, TenantDataExport>(
  "tenantExport:exportTenantData",
);

async function seedTwoTenants() {
  const t = convexTest(schema, modules);
  const { tenantA, tenantB } = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("users", { email: "tenant-a@example.test" });
    const tenantB = await ctx.db.insert("users", { email: "tenant-b@example.test" });

    await ctx.db.insert("demoItems", { tenantId: tenantA, label: "A-only-row" });
    await ctx.db.insert("demoItems", { tenantId: tenantB, label: "B-secret-row" });
    await ctx.db.insert("gmailTokens", {
      tenantId: tenantA,
      refreshToken: "A_REFRESH_CROWN_JEWEL",
      accessToken: "A_ACCESS_CROWN_JEWEL",
      scope: "scope-one scope-two",
      updatedAt: 1_786_830_000_000,
    });
    await ctx.db.insert("microsoftCalendarTokens", {
      tenantId: tenantA,
      refreshToken: "MS_REFRESH_CROWN_JEWEL",
      accessToken: "MS_ACCESS_CROWN_JEWEL",
      expiresAt: 1_786_840_000_000,
      scope: "Calendars.ReadWrite Mail.Send Mail.Read",
      updatedAt: 1_786_830_100_000,
    });
    await ctx.db.insert("audit", {
      tenantId: tenantA,
      correlationId: "audit-not-personal-data",
      eventType: "test.event",
      actor: "test",
      payload: { ref: "row-ref" },
      ts: 1_786_830_200_000,
    });
    await ctx.db.insert("deadLetters", {
      tenantId: tenantA,
      correlationId: "dlq-ref",
      workflowId: "workflow-ref",
      payload: { ref: "row-ref" },
      error: "test",
      status: "new",
      createdAt: 1_786_830_300_000,
    });

    return { tenantA, tenantB };
  });
  return { t, tenantA, tenantB };
}

describe("tenant data export", () => {
  test("exports only the authenticated tenant and states the immutable-audit omission", async () => {
    const { t, tenantA } = await seedTwoTenants();

    const result = await t
      .withIdentity({ subject: `${tenantA}|export-session` })
      .query(exportTenantData, {});
    const bytes = JSON.stringify(result);

    expect(result.header).toMatchObject({
      schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
      tenantId: String(tenantA),
      auditArchive: AUDIT_ARCHIVE_STATEMENT,
    });
    expect(result.header.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(bytes).toContain("A-only-row");
    expect(bytes).toContain("tenant-a@example.test");
    expect(bytes).not.toContain("B-secret-row");
    expect(bytes).not.toContain("tenant-b@example.test");
    expect(result.omitted.audit).toMatch(/immutable/i);
    expect(result.omitted.deadLetters).toMatch(/audit|compliance/i);
  });

  test("reduces credential rows and contains no token material in the produced bytes", async () => {
    const { t, tenantA } = await seedTwoTenants();

    const result = await t
      .withIdentity({ subject: `${tenantA}|export-session` })
      .query(exportTenantData, {});
    const bytes = JSON.stringify(result);

    expect(result.tables.gmailTokens).toEqual([
      { connected: true, updatedAt: 1_786_830_000_000, scopeHalves: [9, 9] },
    ]);
    expect(result.tables.microsoftCalendarTokens).toEqual([
      { connected: true, updatedAt: 1_786_830_100_000, scopeHalves: [19, 9, 9] },
    ]);
    for (const secret of [
      "A_REFRESH_CROWN_JEWEL",
      "A_ACCESS_CROWN_JEWEL",
      "MS_REFRESH_CROWN_JEWEL",
      "MS_ACCESS_CROWN_JEWEL",
    ]) {
      expect(bytes).not.toContain(secret);
    }
    expect(bytes).not.toMatch(/refreshToken|accessToken/);
  });

  test("caps the total rows while reading pages rather than collecting tables", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await t.run(async (ctx) => {
      for (let i = 0; i < 140; i++) {
        await ctx.db.insert("demoItems", { tenantId: tenantA, label: `bounded-${i}` });
      }
    });

    const result = await t
      .withIdentity({ subject: `${tenantA}|export-session` })
      .query(exportTenantData, {});

    expect(result.limits.pageSize).toBeGreaterThan(0);
    expect(result.limits.totalRows).toBeLessThanOrEqual(128);
    expect(result.limits.truncated).toBe(true);
  });
});
