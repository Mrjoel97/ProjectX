import workpoolTest from "@convex-dev/workpool/test";
import { deletableTables } from "@pikar/core/tenantData";
import { makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import ragSchema from "../node_modules/@convex-dev/rag/dist/component/schema.js";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const ragModules = import.meta.glob(
  "../node_modules/@convex-dev/rag/src/component/**/!(*.test).ts",
);
// Test-only virtual component functions seed the installed component schema directly.
const seed = mutationGeneric({
  args: { tenant: v.string(), versions: v.number(), large: v.boolean() },
  handler: async (ctx, a) => {
    const namespaces = [];
    const entries = [];
    for (let version = 0; version < a.versions; version++) {
      const ns = await ctx.db.insert("namespaces", {
        namespace: a.tenant,
        version,
        modelId: "fixture",
        dimension: 128,
        filterNames: [],
        status:
          version === 0
            ? { kind: "ready" }
            : version === 1
              ? { kind: "pending" }
              : { kind: "replaced", replacedAt: 1 },
      });
      namespaces.push(ns);
      const entry = await ctx.db.insert("entries", {
        namespaceId: ns,
        version: 0,
        key: "orphan-without-vault-pointer",
        importance: 0.5,
        filterValues: [],
        status: { kind: "ready" },
      });
      entries.push(entry);
      for (let order = 0; order < (a.large ? 20 : 1); order++) {
        const contentId = await ctx.db.insert("content", {
          text: a.large ? "s".repeat(512 * 1024) : "synthetic content",
        });
        const embeddingId = await ctx.db.insert("vectors_128", {
          namespaceId: ns,
          vector: Array(129).fill(0),
        });
        await ctx.db.insert("chunks", {
          entryId: entry,
          order,
          namespaceId: ns,
          contentId,
          state: { kind: "ready", embeddingId },
        });
      }
    }
    return { namespaces, entries };
  },
});
const inspect = queryGeneric({
  args: { tenant: v.string() },
  handler: async (ctx, { tenant }) => {
    const namespaces = (await ctx.db.query("namespaces").collect()).filter(
      (x) => x.namespace === tenant,
    );
    const ids = namespaces.map((x) => x._id);
    return {
      namespaces: namespaces.length,
      entries: (await ctx.db.query("entries").collect()).filter((x) => ids.includes(x.namespaceId))
        .length,
      chunks: (await ctx.db.query("chunks").collect()).filter((x) => ids.includes(x.namespaceId))
        .length,
      vectors: (await ctx.db.query("vectors_128").collect()).filter((x) =>
        ids.includes(x.namespaceId),
      ).length,
      totalContent: (await ctx.db.query("content").collect()).length,
    };
  },
});
const fixtureApi = (
  components.rag as unknown as {
    fixture: {
      seed: ReturnType<
        typeof makeFunctionReference<
          "mutation",
          { tenant: string; versions: number; large: boolean },
          { namespaces: string[]; entries: string[] }
        >
      >;
      inspect: ReturnType<
        typeof makeFunctionReference<
          "query",
          { tenant: string },
          {
            namespaces: number;
            entries: number;
            chunks: number;
            vectors: number;
            totalContent: number;
          }
        >
      >;
    };
  }
).fixture;
const start = makeFunctionReference<"mutation", { tenantId: string }, null>("ragErasure:start");
const step = makeFunctionReference<"mutation", { tenantId: string }, null>("ragErasure:step");
function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  t.registerComponent("rag", ragSchema, {
    ...ragModules,
    "../node_modules/@convex-dev/rag/src/component/fixture.ts": async () => ({ seed, inspect }),
  });
  workpoolTest.register(t, "rag/workpool");
  return t;
}
afterEach(() => vi.useRealTimers());

test("empty native Vault starts durable cleanup of orphan entries across all versions, preserving foreign tenant and fence", async () => {
  const t = setup();
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  await t.mutation(fixtureApi.seed, { tenant: user, versions: 3, large: false });
  await t.mutation(fixtureApi.seed, { tenant: "foreign", versions: 1, large: false });
  await t.mutation(internal.authRevocations.beginErasure, { userId: user });
  const args = {
    tenantId: user,
    userId: user,
    cursor: { tableIndex: deletableTables().indexOf("vaultDocuments") },
  };
  await t.mutation(internal.tenantDelete.deleteTenantDataPage, args);
  await t.mutation(internal.tenantDelete.deleteTenantDataPage, args);
  const queued = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(queued).toHaveLength(1);
  // Terminal identity removal must not remove the cleanup checkpoint.
  await t.run(async (ctx) => {
    const fence = await ctx.db.query("authRevocations").first();
    if (!fence) throw new Error("Missing fixture fence");
    await ctx.db.patch(fence._id, { state: "deleted" });
    await ctx.db.delete(user);
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toEqual({
    namespaces: 0,
    entries: 0,
    chunks: 0,
    vectors: 0,
    totalContent: 1,
  });
  expect(await t.query(fixtureApi.inspect, { tenant: "foreign" })).toEqual({
    namespaces: 1,
    entries: 1,
    chunks: 1,
    vectors: 1,
    totalContent: 1,
  });
  const fence = await t.run((ctx) => ctx.db.query("authRevocations").first());
  expect(fence?.state).toBe("deleted");
  expect(fence?.ragCleanup).toEqual({ state: "complete" });
  await t.mutation(start, { tenantId: user });
  await t.mutation(step, { tenantId: user });
  expect(await t.query(fixtureApi.inspect, { tenant: "foreign" })).toMatchObject({
    namespaces: 1,
    entries: 1,
  });
});

test("large component chunk deletion continues durably and repeated polls never restart its delete", async () => {
  const t = setup();
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  const fixture = await t.mutation(fixtureApi.seed, { tenant: user, versions: 1, large: true });
  await t.mutation(internal.authRevocations.beginErasure, { userId: user });
  await t.mutation(start, { tenantId: user });
  await t.mutation(step, { tenantId: user });
  const before = await t.query(fixtureApi.inspect, { tenant: user });
  expect(before.entries).toBe(1);
  expect(before.chunks).toBeGreaterThan(0);
  expect(before.chunks).toBeLessThan(20);
  await t.mutation(step, { tenantId: user });
  await t.mutation(step, { tenantId: user });
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toEqual(before);
  expect(
    (await t.run((ctx) => ctx.db.query("authRevocations").first()))?.ragCleanup?.pendingEntryId,
  ).toBe(fixture.entries[0]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toEqual({
    namespaces: 0,
    entries: 0,
    chunks: 0,
    vectors: 0,
    totalContent: 0,
  });
});

test("live identities and reset-only markers cannot authorize RAG erasure", async () => {
  const t = setup();
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  await t.mutation(fixtureApi.seed, { tenant: user, versions: 1, large: false });
  await expect(t.mutation(start, { tenantId: user })).rejects.toThrow("TENANT_ERASURE_REQUIRED");
  await t.run((ctx) =>
    ctx.db.insert("authRevocations", {
      userId: user,
      expiresAt: Date.now() + 3600000,
      requireLiveSession: true,
    }),
  );
  await expect(t.mutation(start, { tenantId: user })).rejects.toThrow("TENANT_ERASURE_REQUIRED");
  await expect(t.mutation(step, { tenantId: user })).rejects.toThrow("TENANT_ERASURE_REQUIRED");
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toMatchObject({
    namespaces: 1,
    entries: 1,
    chunks: 1,
  });
});

test("stalled component work stops after sixty polls and resume only observes its eventual completion", async () => {
  const t = setup();
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  const fixture = await t.mutation(fixtureApi.seed, { tenant: user, versions: 1, large: false });
  await t.run((ctx) =>
    ctx.db.insert("authRevocations", {
      userId: user,
      state: "deleted",
      expiresAt: Number.MAX_SAFE_INTEGER,
      ragCleanup: { state: "pending", pendingEntryId: fixture.entries[0], polls: 0 },
    }),
  );
  for (let i = 0; i < 60; i++) await t.mutation(step, { tenantId: user });
  expect((await t.run((ctx) => ctx.db.query("authRevocations").first()))?.ragCleanup).toEqual({
    state: "stalled",
    pendingEntryId: fixture.entries[0],
    polls: 60,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toMatchObject({
    namespaces: 1,
    entries: 1,
    chunks: 1,
  });
  await t.mutation(start, { tenantId: user });
  await t.mutation(step, { tenantId: user });
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toMatchObject({
    entries: 1,
    chunks: 1,
  });
  // Represents the original component operation recovering independently; start never invokes it.
  const entryId = fixture.entries[0];
  if (!entryId) throw new Error("Missing fixture entry");
  await t.mutation(components.rag.entries.deleteAsync, {
    entryId,
    startOrder: 0,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(fixtureApi.inspect, { tenant: user })).toEqual({
    namespaces: 0,
    entries: 0,
    chunks: 0,
    vectors: 0,
    totalContent: 0,
  });
  expect((await t.run((ctx) => ctx.db.query("authRevocations").first()))?.ragCleanup).toEqual({
    state: "complete",
  });
});
