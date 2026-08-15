import { deletableTables, type TenantDeletionCursor } from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const deleteTenantDataPage = makeFunctionReference<
  "mutation",
  { tenantId: string; userId: Id<"users">; cursor?: TenantDeletionCursor },
  {
    table: string;
    deleted: number;
    nextCursor: TenantDeletionCursor | null;
  }
>("tenantDelete:deleteTenantDataPage");
type ProviderResult = {
  provider: "google" | "microsoft";
  localRowDeleted: boolean;
  revokedAtProvider: boolean;
  failure: boolean;
};
const deleteTenantData = makeFunctionReference<
  "action",
  { confirmation: string },
  { deletedByTable: Record<string, number>; providers: ProviderResult[] }
>("tenantDelete:deleteTenantData");

afterEach(() => vi.unstubAllGlobals());

async function deleteAll(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  userId: Id<"users">,
  start?: TenantDeletionCursor,
) {
  let cursor = start;
  const counts: Record<string, number> = {};
  do {
    const page = await t.mutation(deleteTenantDataPage, {
      tenantId,
      userId,
      ...(cursor ? { cursor } : {}),
    });
    counts[page.table] = (counts[page.table] ?? 0) + page.deleted;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return counts;
}

async function seedTwoTenants() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const seeded = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("users", {
      email: "tenant-a-delete@example.test",
      owner: true,
    });
    const tenantB = await ctx.db.insert("users", {
      email: "tenant-b-keep@example.test",
      owner: true,
    });
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert("demoItems", { tenantId: tenantA, label: `A-delete-${i}` });
    }
    await ctx.db.insert("demoItems", { tenantId: tenantB, label: "B-must-survive" });
    const auditA = await ctx.db.insert("audit", {
      tenantId: tenantA,
      correlationId: "audit-a-immutable",
      eventType: "test.before_delete",
      actor: "test",
      payload: { ref: "audit-a" },
      ts: 1_786_830_200_000,
    });
    const auditB = await ctx.db.insert("audit", {
      tenantId: tenantB,
      correlationId: "audit-b-immutable",
      eventType: "test.before_delete",
      actor: "test",
      payload: { ref: "audit-b" },
      ts: 1_786_830_200_001,
    });
    return { tenantA, tenantB, auditA, auditB };
  });
  return { t, ...seeded };
}

describe("tenant data deletion pages", () => {
  test("cannot reach audit/global tables and preserves immutable audit rows", async () => {
    const { t, tenantA, auditA, auditB } = await seedTwoTenants();
    expect(deletableTables()).not.toContain("audit");

    await deleteAll(t, String(tenantA), tenantA);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(auditA)).toMatchObject({ correlationId: "audit-a-immutable" });
      expect(await ctx.db.get(auditB)).toMatchObject({ correlationId: "audit-b-immutable" });
      expect(await ctx.db.query("audit").collect()).toHaveLength(2);
    });
  });

  test("deletes bounded pages and resumes idempotently after interruption", async () => {
    const { t, tenantA } = await seedTwoTenants();
    const first = await t.mutation(deleteTenantDataPage, {
      tenantId: String(tenantA),
      userId: tenantA,
    });

    expect(first.deleted).toBeLessThanOrEqual(2);
    expect(first.nextCursor).not.toBeNull();
    const resumed = await deleteAll(
      t,
      String(tenantA),
      tenantA,
      first.nextCursor ?? undefined,
    );
    expect(Object.values(resumed).every((count) => count <= 5)).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tenantA)).toBeNull();
      expect(
        await ctx.db
          .query("demoItems")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
          .collect(),
      ).toEqual([]);
    });
  });

  test("never touches another tenant's rows", async () => {
    const { t, tenantA, tenantB } = await seedTwoTenants();

    await deleteAll(t, String(tenantA), tenantA);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tenantB)).toMatchObject({ email: "tenant-b-keep@example.test" });
      expect(
        await ctx.db
          .query("demoItems")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantB))
          .collect(),
      ).toHaveLength(1);
    });
  });

  test("succeeds quietly for a tenant with no owned rows beyond its user", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "empty-delete@example.test", owner: true }),
    );

    const counts = await deleteAll(t, String(userId), userId);

    expect(counts.users).toBe(1);
    expect(Object.entries(counts).filter(([table]) => table !== "users").every(([, n]) => n === 0)).toBe(
      true,
    );
  });
});

describe("tenant deletion provider truth", () => {
  test("reports the disconnect results per provider without token or content escape", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: tenantA,
        refreshToken: "GOOGLE_DELETE_CROWN_JEWEL",
        accessToken: "GOOGLE_ACCESS_CROWN_JEWEL",
        scope: "gmail.modify",
        updatedAt: 1,
      });
      await ctx.db.insert("microsoftCalendarTokens", {
        tenantId: tenantA,
        refreshToken: "MICROSOFT_DELETE_CROWN_JEWEL",
        accessToken: "MICROSOFT_ACCESS_CROWN_JEWEL",
        expiresAt: 2,
        scope: "Calendars.ReadWrite",
        updatedAt: 1,
      });
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });
    const bytes = JSON.stringify(result);

    expect(result.providers).toEqual([
      {
        provider: "google",
        localRowDeleted: true,
        revokedAtProvider: true,
        failure: false,
      },
      {
        provider: "microsoft",
        localRowDeleted: true,
        revokedAtProvider: false,
        failure: false,
      },
    ]);
    expect(bytes).not.toMatch(/refreshToken|accessToken|CROWN_JEWEL/);
    await t.run(async (ctx) => {
      const audits = await ctx.db.query("audit").collect();
      const completion = audits.filter((row) => row.eventType === "tenant.deleted");
      expect(completion).toHaveLength(1);
      expect(completion[0]?.payload).toMatchObject({
        deleted_demoItems: 5,
        deleted_users: 1,
        googleLocalRowDeleted: true,
        googleRevokedAtProvider: true,
        microsoftLocalRowDeleted: true,
        microsoftRevokedAtProvider: false,
      });
      expect(completion[0]?.payload.tenantIdHash).toMatch(/^[a-f0-9]{64}$/);
      const auditBytes = JSON.stringify(audits);
      expect(auditBytes).not.toMatch(/refreshToken|accessToken|CROWN_JEWEL/);
    });
  });

  test("continues local erasure and records failure when Google revocation throws", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: tenantA,
        refreshToken: "FAILURE_REFRESH_SECRET",
        accessToken: "FAILURE_ACCESS_SECRET",
        scope: "gmail.modify",
        updatedAt: 1,
      });
      await ctx.db.insert("microsoftCalendarTokens", {
        tenantId: tenantA,
        refreshToken: "MS_FAILURE_REFRESH_SECRET",
        accessToken: "MS_FAILURE_ACCESS_SECRET",
        expiresAt: 2,
        scope: "Calendars.ReadWrite",
        updatedAt: 1,
      });
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("provider token leak"))));

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    expect(result.providers[0]).toEqual({
      provider: "google",
      localRowDeleted: true,
      revokedAtProvider: false,
      failure: true,
    });
    expect(result.providers[1]).toEqual({
      provider: "microsoft",
      localRowDeleted: true,
      revokedAtProvider: false,
      failure: false,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("gmailTokens")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
          .unique(),
      ).toBeNull();
      expect(
        await ctx.db
          .query("microsoftCalendarTokens")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
          .unique(),
      ).toBeNull();
      expect(JSON.stringify(await ctx.db.query("audit").collect())).not.toContain(
        "provider token leak",
      );
    });
  });
});
