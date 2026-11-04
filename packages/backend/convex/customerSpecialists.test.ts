import { deletableTables, exportableTables } from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { getCustomerSpecialistVersion } from "./customerSpecialists";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const create = makeFunctionReference<"mutation">("customerSpecialists:create");
const update = makeFunctionReference<"mutation">("customerSpecialists:update");
const archive = makeFunctionReference<"mutation">("customerSpecialists:archive");
const list = makeFunctionReference<"query">("customerSpecialists:list");
const knowledgeChoices = makeFunctionReference<"query">("customerSpecialists:knowledgeChoices");
const definition = {
  name: "Retail buyer advisor",
  objective: "Prepare a product brief",
  audience: "Independent retailers",
  instructions: "Use product facts and approved positioning.",
  knowledgeDocumentIds: [],
};

function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}
beforeEach(() => vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", '["pilot_a","pilot_b"]'));
afterEach(() => vi.unstubAllEnvs());

test("ordinary tenants own their specialists and version edits reject stale writers", async () => {
  const t = setup();
  const a = t.withIdentity({ subject: "pilot_a" });
  const b = t.withIdentity({ subject: "pilot_b" });
  const first = await a.mutation(create, definition);
  expect(await a.mutation(create, definition)).toEqual(first);
  expect((await a.query(list, {})).specialists).toHaveLength(1);
  expect((await b.query(list, {})).specialists).toEqual([]);
  await expect(
    b.mutation(update, { ...definition, specialistId: first.specialistId, expectedRevision: 1 }),
  ).rejects.toThrow("SPECIALIST_UNAVAILABLE");
  const next = await a.mutation(update, {
    ...definition,
    specialistId: first.specialistId,
    expectedRevision: 1,
    audience: "Regional distributors",
  });
  expect(next.revision).toBe(2);
  await expect(
    a.mutation(update, { ...definition, specialistId: first.specialistId, expectedRevision: 1 }),
  ).rejects.toThrow("STALE_SPECIALIST");
  const old = await t.run((ctx) =>
    getCustomerSpecialistVersion(ctx, "pilot_a", first.specialistId, 1),
  );
  expect(old.audience).toBe("Independent retailers");
  await expect(
    t.run((ctx) =>
      getCustomerSpecialistVersion(ctx, "pilot_a", first.specialistId, 1, { requireCurrent: true }),
    ),
  ).rejects.toThrow("STALE_SPECIALIST");
  await a.mutation(archive, { specialistId: first.specialistId, expectedRevision: 2 });
  expect((await a.query(list, {})).specialists).toEqual([]);
  await expect(
    t.run((ctx) => getCustomerSpecialistVersion(ctx, "pilot_a", first.specialistId, 2)),
  ).rejects.toThrow("SPECIALIST_UNAVAILABLE");
});

test("pilot permission is enforced on writes, reads and pinned execution", async () => {
  const t = setup();
  const a = t.withIdentity({ subject: "pilot_a" });
  const outsider = t.withIdentity({ subject: "outside" });
  await expect(outsider.mutation(create, definition)).rejects.toThrow(
    "CUSTOMER_WORKFLOW_PILOT_DISABLED",
  );
  expect(await outsider.query(list, {})).toEqual({ enabled: false, specialists: [] });
  const first = await a.mutation(create, definition);
  vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", "[]");
  await expect(
    t.run((ctx) => getCustomerSpecialistVersion(ctx, "pilot_a", first.specialistId, 1)),
  ).rejects.toThrow("CUSTOMER_WORKFLOW_PILOT_DISABLED");
});

test("knowledge selections require current owned ready sources and fail after deletion", async () => {
  const t = setup();
  const a = t.withIdentity({ subject: "pilot_a" });
  const own = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "pilot_a",
      title: "Product facts",
      kind: "upload",
      category: "general",
      source: "upload",
      mimeType: "text/plain",
      size: 12,
      text: "Product facts",
      contentHash: "hash",
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  const foreign = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "pilot_b",
      title: "Private facts",
      kind: "upload",
      category: "general",
      source: "upload",
      mimeType: "text/plain",
      size: 12,
      text: "Private facts",
      contentHash: "hash",
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  await expect(
    a.mutation(create, { ...definition, knowledgeDocumentIds: [foreign] }),
  ).rejects.toThrow("SPECIALIST_KNOWLEDGE_UNAVAILABLE");
  const first = await a.mutation(create, { ...definition, knowledgeDocumentIds: [own] });
  const choices = await a.query(knowledgeChoices, {
    paginationOpts: { numItems: 12, cursor: null },
  });
  expect(choices.page).toEqual([{ _id: own, title: "Product facts" }]);
  await t.run((ctx) => ctx.db.delete(own));
  await expect(
    t.run((ctx) => getCustomerSpecialistVersion(ctx, "pilot_a", first.specialistId, 1)),
  ).rejects.toThrow("SPECIALIST_KNOWLEDGE_UNAVAILABLE");
});

test("native export and deletion include specialist definitions and revisions within the tenant", async () => {
  const t = setup();
  const [aId, bId] = await t.run(async (ctx) => [
    await ctx.db.insert("users", { name: "A" }),
    await ctx.db.insert("users", { name: "B" }),
  ]);
  vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", JSON.stringify([aId, bId]));
  const a = t.withIdentity({ subject: aId });
  const b = t.withIdentity({ subject: bId });
  await a.mutation(create, definition);
  await b.mutation(create, { ...definition, name: "B_PRIVATE_SPECIALIST" });
  const exportData = makeFunctionReference<"query">("tenantExport:exportTenantData");
  const deleteData = makeFunctionReference<"mutation">("tenantDelete:deleteTenantDataPage");
  for (const table of ["customerSpecialists", "customerSpecialistVersions"] as const) {
    const page = await a.query(exportData, {
      cursor: {
        tableIndex: exportableTables().indexOf(table),
        cursor: null,
        rowsExported: 0,
        tableRows: 0,
        truncated: false,
        generatedAt: new Date().toISOString(),
      },
    });
    expect(page.table.name).toBe(table);
    expect(JSON.stringify(page.table.rows)).toContain(definition.name);
    expect(JSON.stringify(page.table.rows)).not.toContain("B_PRIVATE_SPECIALIST");
    await t.mutation(deleteData, {
      tenantId: aId,
      userId: aId,
      cursor: { tableIndex: deletableTables().indexOf(table) },
    });
    const rows = await t.run((ctx) => ctx.db.query(table).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(bId);
  }
});
