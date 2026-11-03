import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { deletableTables, exportableTables } from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const createSpecialist = makeFunctionReference<"mutation">("customerSpecialists:create");
const saveWorkflow = makeFunctionReference<"mutation">("customerWorkflows:save");
const claimRun = makeFunctionReference<"mutation">("customerWorkflows:claim");
const exportData = makeFunctionReference<"query">("tenantExport:exportTenantData");
const deleteData = makeFunctionReference<"mutation">("tenantDelete:deleteTenantDataPage");

afterEach(() => vi.unstubAllEnvs());

test("native export and erasure cover workflow definitions and pinned run briefs only for their owner", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const [aId, bId] = await t.run(async (ctx) => [
    await ctx.db.insert("users", { name: "A" }),
    await ctx.db.insert("users", { name: "B" }),
  ]);
  vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", JSON.stringify([aId, bId]));
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: COCKPIT_AGENT_SKILL,
      version: 1,
      body: "Registered executor fixture",
      status: "active",
      createdAt: Date.now(),
    }),
  );
  for (const tenantId of [aId, bId]) {
    const client = t.withIdentity({ subject: tenantId });
    const marker = tenantId === aId ? "A_OWNED_WORKFLOW" : "B_PRIVATE_WORKFLOW";
    const specialist = await client.mutation(createSpecialist, {
      name: "Buyer advisor",
      objective: "Prepare a product report",
      audience: "Retail buyers",
      instructions: "Use product evidence",
      knowledgeDocumentIds: [],
    });
    const workflow = await client.mutation(saveWorkflow, {
      name: marker,
      specialistId: specialist.specialistId,
      specialistRevision: 1,
      steps: ["Write product positioning", "Explain the buyer fit"],
    });
    await t.mutation(claimRun, {
      tenantId,
      workflowId: workflow.id,
      expectedRevision: 1,
      brief: marker,
      requestId: "privacy-workflow-001",
    });
  }
  const a = t.withIdentity({ subject: aId });
  for (const table of ["customerWorkflows", "customerWorkflowRuns"] as const) {
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
    expect(JSON.stringify(page.table.rows)).toContain("A_OWNED_WORKFLOW");
    expect(JSON.stringify(page.table.rows)).not.toContain("B_PRIVATE_WORKFLOW");
    await t.mutation(deleteData, {
      tenantId: aId,
      userId: aId,
      cursor: { tableIndex: deletableTables().indexOf(table) },
    });
    const remaining = await t.run((ctx) => ctx.db.query(table).collect());
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.tenantId).toBe(bId);
  }
});
