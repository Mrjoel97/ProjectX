import {
  deletableTables,
  exportableTables,
  type TenantDataExportPage,
  type TenantExportCursor,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isTrustedFunnelStorageUrl } from "./funnels";
import { contentHash } from "./lib/hash";
import schema from "./schema";

// Native generated references are compile-time witnesses for public/internal parity.
const createLink = api.funnels.create;
const listLinks = api.funnels.list;
const deactivateLink = api.funnels.deactivate;
const resolveLink = internal.funnels.resolveAndIncrement;
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://some-deployment.convex.site");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://some-deployment.convex.cloud");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function linkFixture() {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const data = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("users", { owner: false });
    const foreign = await ctx.db.insert("users", { owner: false });
    const storageId = await ctx.storage.store(new Blob(["fixed bytes"]));
    const doc = await ctx.db.insert("vaultDocuments", {
      tenantId: tenant,
      title: "Fixture",
      kind: "upload",
      category: "general",
      source: "upload",
      mimeType: "text/plain",
      size: 11,
      contentHash: "hash",
      status: "ready",
      createdAt: 1,
      storageId,
    });
    return { tenant, foreign, storageId, doc };
  });
  return {
    t,
    ...data,
    client: t.withIdentity({ subject: `${data.tenant}|test` }),
    other: t.withIdentity({ subject: `${data.foreign}|test` }),
  };
}

describe("native funnel lifecycle", () => {
  test("actual revision seam never repoints a link and old-byte cleanup invalidates without a count", async () => {
    const f = await linkFixture();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.doc, { origin: "agent" });
      await ctx.db.insert("vaultSources", {
        tenantId: f.tenant,
        threadId: "revise",
        docIds: [f.doc],
        titles: ["Fixture"],
        count: 1,
        role: "created",
        form: "long",
        createdAt: 1,
      });
    });
    const made = await f.client.mutation(createLink, {
      vaultDocId: f.doc,
      title: "Guide",
      source: "web",
    });
    const replacement = await f.t.run((ctx) => ctx.storage.store(new Blob(["replacement"])));
    const revise = makeFunctionReference<
      "mutation",
      {
        tenantId: string;
        threadId: string;
        index: number;
        title: string;
        form: "long";
        markdown: string;
        contentHash: string;
        storageId: Id<"_storage">;
      },
      { ok: boolean; oldStorageId?: Id<"_storage"> }
    >("vault:patchCreatedDoc");
    const result = await f.t.mutation(revise, {
      tenantId: f.tenant,
      threadId: "revise",
      index: 1,
      title: "Revised",
      form: "long",
      markdown: "replacement",
      contentHash: "revised",
      storageId: replacement,
    });
    expect(result).toEqual({ ok: true, oldStorageId: f.storageId });
    const oldLocation = await f.t.run((ctx) => ctx.storage.getUrl(f.storageId));
    expect(await f.t.mutation(resolveLink, { token: made.token, stage: "download" })).toEqual({
      location: oldLocation,
    });
    // The real drafter deletes the oldStorageId after patchCreatedDoc returns it.
    await f.t.run((ctx) => ctx.storage.delete(f.storageId));
    expect(await f.t.mutation(resolveLink, { token: made.token, stage: "download" })).toBeNull();
    expect((await f.client.query(listLinks, {})).items[0]?.counters?.downloads).toBe(1);
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(replacement)) !== null)).toBe(true);
  });
  test("deleting the actual Vault document makes its funnel unavailable", async () => {
    const f = await linkFixture();
    const made = await f.client.mutation(createLink, {
      vaultDocId: f.doc,
      title: "Guide",
      source: "web",
    });
    const remove = makeFunctionReference<
      "mutation",
      { vaultDocId: Id<"vaultDocuments"> },
      { ok: boolean }
    >("vault:deleteVaultDoc");
    expect(await f.client.mutation(remove, { vaultDocId: f.doc })).toEqual({ ok: true });
    expect(await f.t.mutation(resolveLink, { token: made.token, stage: "visit" })).toBeNull();
    expect((await f.client.query(listLinks, {})).items[0]?.counters?.visits).toBe(0);
  });
  test("ordinary authenticated tenant creates32random bytes with one-time secret disclosure", async () => {
    const f = await linkFixture();
    const rng = vi.spyOn(crypto, "getRandomValues");
    const made = await f.client.mutation(createLink, {
      vaultDocId: f.doc,
      title: "  Guide  ",
      source: " Newsletter ",
    });
    expect(rng.mock.calls.some(([bytes]) => bytes?.byteLength === 32)).toBe(true);
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(made.token, "base64url")).toHaveLength(32);
    for (const stage of ["visit", "claim", "download"] as const)
      expect(made.urls[stage]).toBe(
        `https://some-deployment.convex.site/f/${made.token}/${stage}?s=newsletter`,
      );
    const row = await f.t.run((ctx) => ctx.db.get(made.id));
    expect(row?.tokenHash).toBe(await contentHash(`pikar:funnel:v1:${made.token}`));
    expect(JSON.stringify(row)).not.toContain(made.token);
    const listed = await f.client.query(listLinks, {});
    expect(listed.items[0]).toMatchObject({
      source: "newsletter",
      counters: { visits: 0, claims: 0, downloads: 0 },
    });
    expect(JSON.stringify(listed)).not.toContain(made.token);
    expect(JSON.stringify(listed)).not.toContain(row?.tokenHash ?? "missing");
    expect((await f.other.query(listLinks, {})).items).toEqual([]);
  });
  test("auth, tenant, input and missing bytes fail before creating rows", async () => {
    const f = await linkFixture();
    const args = { vaultDocId: f.doc, title: "Guide", source: "web" };
    await expect(f.t.mutation(createLink, args)).rejects.toThrow();
    await expect(f.t.query(listLinks, {})).rejects.toThrow();
    await expect(f.other.mutation(createLink, args)).rejects.toThrow("ARTIFACT_UNAVAILABLE");
    for (const source of ["", "x".repeat(65), "https://evil"])
      await expect(f.client.mutation(createLink, { ...args, source })).rejects.toThrow(
        "INVALID_FUNNEL_INPUT",
      );
    await expect(
      f.client.mutation(createLink, { ...args, title: "x".repeat(121) }),
    ).rejects.toThrow("INVALID_FUNNEL_INPUT");
    await f.t.run((ctx) => ctx.storage.delete(f.storageId));
    await expect(f.client.mutation(createLink, args)).rejects.toThrow("ARTIFACT_UNAVAILABLE");
    expect((await f.client.query(listLinks, {})).items).toHaveLength(0);
  });
  test("each independent stage counts one request, public source cannot change attribution", async () => {
    const f = await linkFixture();
    const made = await f.client.mutation(createLink, {
      vaultDocId: f.doc,
      title: "Guide",
      source: "web",
    });
    const location = await f.t.run((ctx) => ctx.storage.getUrl(f.storageId));
    for (const stage of ["download", "visit", "claim"])
      expect(
        await f.t.mutation(resolveLink, { token: made.token, stage, source: "another-source" }),
      ).toEqual({ location });
    const calls = await Promise.all(
      Array.from({ length: 12 }, () =>
        f.t.mutation(resolveLink, { token: made.token, stage: "visit" }),
      ),
    );
    expect(calls.every(Boolean)).toBe(true);
    expect((await f.client.query(listLinks, {})).items[0]).toMatchObject({
      source: "web",
      counters: { visits: 13, claims: 1, downloads: 1 },
    });
    await f.t.run(async (ctx) => {
      const next = await ctx.storage.store(new Blob(["new bytes"]));
      await ctx.db.patch(f.doc, { storageId: next });
    });
    expect(await f.t.mutation(resolveLink, { token: made.token, stage: "visit" })).toEqual({
      location,
    });
  });
  test("unknown, malformed, unsafe counters and unavailable assets never count", async () => {
    const f = await linkFixture();
    const made = await f.client.mutation(createLink, {
      vaultDocId: f.doc,
      title: "Guide",
      source: "web",
    });
    for (const args of [
      { token: "x", stage: "visit" },
      { token: "a".repeat(43), stage: "visit" },
      { token: made.token, stage: "Visit" },
      { token: made.token, stage: "visit", source: "x".repeat(65) },
    ])
      expect(await f.t.mutation(resolveLink, args)).toBeNull();
    for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await f.t.run((ctx) => ctx.db.patch(made.id, { visits: bad }));
      expect(await f.t.mutation(resolveLink, { token: made.token, stage: "visit" })).toBeNull();
      expect((await f.t.run((ctx) => ctx.db.get(made.id)))?.visits).toBe(bad);
    }
    await f.t.run(async (ctx) => {
      await ctx.db.patch(made.id, { visits: 0 });
      await ctx.storage.delete(f.storageId);
    });
    expect(await f.t.mutation(resolveLink, { token: made.token, stage: "visit" })).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(made.id)))?.visits).toBe(0);
  });
  test("deactivation is tenant-scoped and idempotent, with every stage unavailable afterward", async () => {
    const f = await linkFixture();
    const made = await f.client.mutation(createLink, {
      vaultDocId: f.doc,
      title: "Guide",
      source: "web",
    });
    await expect(f.other.mutation(deactivateLink, { id: made.id })).rejects.toThrow(
      "FUNNEL_UNAVAILABLE",
    );
    await expect(f.t.mutation(deactivateLink, { id: made.id })).rejects.toThrow();
    expect(await f.client.mutation(deactivateLink, { id: made.id })).toEqual({ changed: true });
    expect(await f.client.mutation(deactivateLink, { id: made.id })).toEqual({ changed: false });
    for (const stage of ["visit", "claim", "download"])
      expect(await f.t.mutation(resolveLink, { token: made.token, stage })).toBeNull();
    expect((await f.client.query(listLinks, {})).items[0]?.counters).toEqual({
      visits: 0,
      claims: 0,
      downloads: 0,
    });
    expect(await f.t.run((ctx) => ctx.storage.getUrl(f.storageId))).not.toBeNull();
  });
  test("trusted storage URL boundary refuses arbitrary destinations", () => {
    expect(isTrustedFunnelStorageUrl("https://some-deployment.convex.cloud/api/storage/id")).toBe(
      true,
    );
    for (const url of [
      "https://evil.test/api/storage/id",
      "http://some-deployment.convex.cloud/api/storage/id",
      "https://some-deployment.convex.cloud/not-storage",
      "https://user@some-deployment.convex.cloud/api/storage/id",
    ])
      expect(isTrustedFunnelStorageUrl(url)).toBe(false);
  });
});

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
