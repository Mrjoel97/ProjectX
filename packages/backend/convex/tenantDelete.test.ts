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
    const resumed = await deleteAll(t, String(tenantA), tenantA, first.nextCursor ?? undefined);
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
    expect(
      Object.entries(counts)
        .filter(([table]) => table !== "users")
        .every(([, n]) => n === 0),
    ).toBe(true);
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("provider token leak"))),
    );

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

// GOVN-03: erasure is a RIGHT every user holds over their own data (GDPR Art. 17), not an
// administrative privilege of the deployment owner. Every other fixture in this file seeds
// `owner: true`, which made the `authorizeTenantDeletion` owner clause unreachable — the suite was
// 6/6 green while the control was broken for every real signup. Production request
// `9a23216e3f16ebe8` threw `OWNER_REQUIRED` at `tenantDelete.ts:48` with `databaseWriteBytes: 0`.
// `owner` is `v.optional(v.boolean())`, so omitting it below is exactly what a real signup looks
// like — that omission is the whole point of the fixture and must not be "tidied up".
describe("tenant deletion is the tenant's own right, not an owner privilege", () => {
  test("a NON-owner tenant erases its own data and still cannot reach another tenant's", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    const { tenantA, tenantB } = await t.run(async (ctx) => {
      const tenantA = await ctx.db.insert("users", { email: "non-owner@example.test" });
      const tenantB = await ctx.db.insert("users", { email: "bystander@example.test" });
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("demoItems", { tenantId: tenantA, label: `A-erase-${i}` });
      }
      await ctx.db.insert("demoItems", { tenantId: tenantB, label: "B-must-survive" });
      return { tenantA, tenantB };
    });

    const result = await t
      .withIdentity({ subject: `${tenantA}|non-owner-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    expect(result.deletedByTable.demoItems).toBe(3);
    expect(result.deletedByTable.users).toBe(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tenantA)).toBeNull();
      // the negative that matters: a non-owner erasure must not widen into anyone else's data
      expect(await ctx.db.get(tenantB)).not.toBeNull();
      const survivors = await ctx.db.query("demoItems").collect();
      expect(survivors.map((row) => row.label)).toEqual(["B-must-survive"]);

      // the completion record must not claim an owner performed this
      const completion = (await ctx.db.query("audit").collect()).filter(
        (row) => row.eventType === "tenant.deleted",
      );
      expect(completion).toHaveLength(1);
      expect(completion[0]?.actor).toBe("user");
    });
  });
});
