// @vitest-environment node
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api } from "./_generated/api";
import schema from "./schema";

const modelTurn = vi.hoisted(() =>
  vi.fn(async (options: unknown) => ({
    content: [
      {
        type: "text",
        text: `# Buyer report\n\n${JSON.stringify(options).includes("linen jacket") ? "A linen jacket" : "A cotton shirt"}`,
      },
    ],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
    warnings: [],
    providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
    response: { body: { usage: { cost: 0.001, is_byok: false } } },
  })),
);
// Substitute only the network provider, retaining the actual agent loop and paid ledger middleware.
vi.mock("./lib/models", async (original) => ({
  ...(await original<typeof import("./lib/models")>()),
  resolveModel: () => ({
    specificationVersion: "v4",
    provider: "fixture",
    modelId: "fixture",
    supportedUrls: {},
    doGenerate: modelTurn,
    doStream: async () => {
      throw new Error("UNEXPECTED_STREAM");
    },
  }),
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const limiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
afterEach(() => {
  vi.unstubAllEnvs();
  modelTurn.mockClear();
});

test("ordinary customer runs twice into separate owned chats with actual PDF files and replay buys no work", async () => {
  vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", '["pilot_a"]');
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agentModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, limiterModules);
  const customer = t.withIdentity({ subject: "pilot_a" });
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: COCKPIT_AGENT_SKILL,
      version: 1,
      body: "Registered executor",
      status: "active",
      createdAt: Date.now(),
    }),
  );
  const specialist = await customer.mutation(
    makeFunctionReference<"mutation">("customerSpecialists:create"),
    {
      name: "Retail advisor",
      objective: "Explain product positioning",
      audience: "Retail buyers",
      instructions: "Use supplied product facts",
      knowledgeDocumentIds: [],
    },
  );
  const workflow = await customer.mutation(
    makeFunctionReference<"mutation">("customerWorkflows:save"),
    {
      name: "Retail report",
      specialistId: specialist.specialistId,
      specialistRevision: 1,
      steps: ["Explain the product", "Draft the buyer message"],
    },
  );
  const run = makeFunctionReference<"action">("customerWorkflowExecution:run");
  const input = {
    workflowId: workflow.id,
    expectedRevision: 1,
    brief: "A cotton shirt",
    requestId: "customer-run-shirt-001",
  };
  const first = await customer.action(run, input);
  expect(
    first.status,
    JSON.stringify(
      await t.run(async (ctx) => ({ runs: await ctx.db.query("customerWorkflowRuns").collect() })),
    ),
  ).toBe("completed");
  expect((await customer.action(run, input)).runId).toBe(first.runId);
  const second = await customer.action(run, {
    ...input,
    brief: "A linen jacket",
    requestId: "customer-run-jacket-002",
  });
  expect(second.status).toBe("completed");
  expect(second.threadId).not.toBe(first.threadId);
  expect(modelTurn).toHaveBeenCalledTimes(2);
  const runs = await t.run((ctx) => ctx.db.query("customerWorkflowRuns").collect());
  expect(runs).toHaveLength(2);
  for (const completed of runs) {
    expect(completed.reservationId).toBeDefined();
    expect(completed.modelCompleted).toBe(true);
  }
  const actualReceipts = await t.run((ctx) =>
    ctx.db
      .query("spendEvents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", "pilot_a"))
      .collect(),
  );
  expect(
    actualReceipts.filter((receipt) => receipt.phase === "actual" && receipt.kind === "paid_call"),
  ).toHaveLength(2);
  const docs = await t.run((ctx) =>
    ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", "pilot_a"))
      .collect(),
  );
  expect(docs).toHaveLength(2);
  expect(docs.map((doc) => doc.text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("cotton shirt"),
      expect.stringContaining("linen jacket"),
    ]),
  );
  for (const completed of [first, second]) {
    const inventory = await customer.query(api.workspaceArtifacts.list, {
      threadId: completed.threadId,
      stream: "documents",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const document = docs.find((doc) => doc.sourceThreadId === completed.threadId);
    expect(inventory.page).toEqual([
      expect.objectContaining({
        docId: document?._id,
        kind: "document",
        mimeType: "application/pdf",
      }),
    ]);
    const key = `doc:${document?._id}`;
    const download = await customer.query(api.workspaceArtifacts.download, {
      threadId: completed.threadId,
      key,
    });
    expect(download?.mimeType).toBe("application/pdf");
    expect(download?.url).toBeTruthy();
    expect(
      await t.withIdentity({ subject: "other_customer" }).query(api.workspaceArtifacts.download, {
        threadId: completed.threadId,
        key,
      }),
    ).toBeNull();
  }
  for (const doc of docs) {
    expect(doc.storageId).toBeDefined();
    const storageId = doc.storageId;
    if (!storageId) throw new Error("Missing generated PDF storage");
    const bytes = await t.run(async (ctx) => (await ctx.storage.get(storageId))?.text());
    expect(bytes?.startsWith("%PDF-")).toBe(true);
  }
});
