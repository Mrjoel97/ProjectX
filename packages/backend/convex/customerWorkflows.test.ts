import { DOCUMENT_DRAFTER_SKILL } from "@pikar/contracts/skill";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const createSpecialist = makeFunctionReference<"mutation">("customerSpecialists:create");
const save = makeFunctionReference<"mutation">("customerWorkflows:save");
const list = makeFunctionReference<"query">("customerWorkflows:list");
const claim = makeFunctionReference<"mutation">("customerWorkflows:claim");
const bind = makeFunctionReference<"mutation">("customerWorkflows:bindThread");
const context = makeFunctionReference<"query">("customerWorkflows:executionContext");
const markStarted = makeFunctionReference<"mutation">("customerWorkflows:markAgentStarted");
const finish = makeFunctionReference<"mutation">("customerWorkflows:finish");
const recordResult = makeFunctionReference<"mutation">("customerWorkflows:recordResult");
const recordReservation = makeFunctionReference<"mutation">("customerWorkflows:recordReservation");
const reconcile = makeFunctionReference<"mutation">("customerWorkflows:reconcile");

beforeEach(() => vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", '["pilot_a","pilot_b"]'));
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const a = t.withIdentity({ subject: "pilot_a" });
  const b = t.withIdentity({ subject: "pilot_b" });
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: DOCUMENT_DRAFTER_SKILL,
      version: 1,
      body: "Registered executor",
      status: "active",
      createdAt: Date.now(),
    }),
  );
  const specialist = await a.mutation(createSpecialist, {
    name: "Buyer advisor",
    objective: "Write buyer reports",
    audience: "Retailers",
    instructions: "Use product evidence",
    knowledgeDocumentIds: [],
  });
  const definition = {
    name: "Buyer report",
    specialistId: specialist.specialistId,
    specialistRevision: 1,
    steps: ["Explain the product", "Summarize retail positioning"],
  };
  const workflow = await a.mutation(save, definition);
  const request = {
    tenantId: "pilot_a",
    workflowId: workflow.id,
    expectedRevision: 1,
    brief: "Product A is a cotton shirt",
    requestId: "request-product-a-001",
  };
  return { t, a, b, definition, workflow, request };
}

test("ordinary customer creates a workflow, owns edits, and preserves the approved run snapshot", async () => {
  const { t, a, b, definition, workflow, request } = await fixture();
  expect((await a.query(list, {})).workflows).toHaveLength(1);
  expect((await b.query(list, {})).workflows).toEqual([]);
  await expect(
    b.mutation(save, { ...definition, id: workflow.id, expectedRevision: 1 }),
  ).rejects.toThrow();
  const run = await t.mutation(claim, request);
  expect(run.claimed).toBe(true);
  expect((await t.mutation(claim, request)).claimed).toBe(false);
  await expect(t.mutation(claim, { ...request, brief: "changed product" })).rejects.toThrow(
    "WORKFLOW_REQUEST_CHANGED",
  );
  await expect(
    t.mutation(claim, { ...request, requestId: "request-product-a-002" }),
  ).rejects.toThrow("WORKFLOW_RUN_UNRESOLVED");
  await a.mutation(save, {
    ...definition,
    id: workflow.id,
    expectedRevision: 1,
    steps: ["A different report"],
  });
  const row = await t.run((ctx) => ctx.db.get(run._id as Id<"customerWorkflowRuns">));
  expect(row?.steps).toEqual(definition.steps);
  expect(row?.workflowRevision).toBe(1);
});

test("completion requires an owned real output and a second product receives an independent run", async () => {
  const { t, workflow, request } = await fixture();
  const run = await t.mutation(claim, request);
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "pilot_a",
    threadId: "workflow-thread",
  });
  await t.mutation(bind, {
    tenantId: "pilot_a",
    runId: run._id,
    threadId: "workflow-thread",
    planId,
  });
  const snapshot = await t.query(context, { tenantId: "pilot_a", runId: run._id });
  expect(snapshot.brief).toContain("Product A");
  await expect(t.query(context, { tenantId: "pilot_b", runId: run._id })).rejects.toThrow();
  await t.mutation(markStarted, { tenantId: "pilot_a", runId: run._id });
  await t.mutation(recordResult, {
    tenantId: "pilot_a",
    runId: run._id,
    resultHash: "a".repeat(64),
    incomplete: false,
  });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["pdf bytes"])));
  const outputDocumentId = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "pilot_a",
      sourceThreadId: "workflow-thread",
      sourcePlanId: planId,
      title: "Buyer report",
      kind: "created_document",
      origin: "agent",
      category: "general",
      source: "upload",
      mimeType: "application/pdf",
      size: 9,
      contentHash: "a".repeat(64),
      status: "ready",
      storageId,
      createdAt: Date.now(),
    }),
  );
  expect((await t.mutation(finish, { tenantId: "pilot_a", runId: run._id })).status).toBe(
    "completed",
  );
  expect(
    (await t.run((ctx) => ctx.db.get(run._id as Id<"customerWorkflowRuns">)))?.outputDocumentId,
  ).toBe(outputDocumentId);
  const next = await t.mutation(claim, {
    ...request,
    workflowId: workflow.id,
    brief: "Product B is a linen shirt",
    requestId: "request-product-b-001",
  });
  expect(next._id).not.toBe(run._id);
  expect(next.claimed).toBe(true);
});

test("uncertain paid attempts stay blocked until their authoritative ledger settles", async () => {
  const { t, a, request } = await fixture();
  const run = await t.mutation(claim, request);
  await t.mutation(markStarted, { tenantId: "pilot_a", runId: run._id });
  const reservationId = await t.run((ctx) =>
    ctx.db.insert("spendEvents", {
      tenantId: "pilot_a",
      rail: "reasoning",
      phase: "reserved",
      amountCents: 10,
      correlationId: "paid-call-one",
      kind: "paid_call",
      createdAt: Date.now(),
    }),
  );
  await t.mutation(recordReservation, { tenantId: "pilot_a", runId: run._id, reservationId });
  expect((await t.mutation(finish, { tenantId: "pilot_a", runId: run._id })).status).toBe(
    "needs_review",
  );
  expect((await t.mutation(claim, request)).claimed).toBe(false);
  await expect(t.mutation(claim, { ...request, requestId: "another-request-001" })).rejects.toThrow(
    "WORKFLOW_RUN_UNRESOLVED",
  );
  expect((await a.mutation(reconcile, { runId: run._id })).status).toBe("needs_review");
  await t.run((ctx) =>
    ctx.db.insert("spendEvents", {
      tenantId: "pilot_a",
      rail: "reasoning",
      phase: "actual",
      amountCents: 3,
      correlationId: "paid-call-one",
      kind: "paid_call",
      evalActualUsd: 0.03,
      createdAt: Date.now(),
    }),
  );
  expect((await a.mutation(reconcile, { runId: run._id })).status).toBe("failed");
  vi.stubEnv("CUSTOMER_WORKFLOWS_PILOT_TENANTS", "[]");
  await expect(t.mutation(claim, request)).rejects.toThrow("CUSTOMER_WORKFLOW_PILOT_DISABLED");
});

test("status checks cannot release a live attempt, and a known partial response permits a deliberate new run", async () => {
  const { t, a, request } = await fixture();
  const run = await t.mutation(claim, request);
  expect((await a.mutation(reconcile, { runId: run._id })).status).toBe("running");
  await t.mutation(markStarted, { tenantId: "pilot_a", runId: run._id });
  await t.mutation(recordResult, {
    tenantId: "pilot_a",
    runId: run._id,
    resultHash: "b".repeat(64),
    incomplete: true,
  });
  expect((await t.mutation(finish, { tenantId: "pilot_a", runId: run._id })).status).toBe("failed");
  expect((await t.mutation(claim, { ...request, requestId: "deliberate-rerun-001" })).claimed).toBe(
    true,
  );
});
