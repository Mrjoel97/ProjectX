import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
test("agent authoring inspector detects an approved plan without counting foreign approvals", async () => {
  const t = convexTest(schema, modules);
  const planId = await t.run(async (ctx) => {
    await ctx.db.insert("plans", {
      tenantId: "tenant-b",
      threadId: "thread-b",
      status: "approved",
      createdAt: 1,
    });
    return ctx.db.insert("plans", {
      tenantId: "tenant-a",
      threadId: "thread-a",
      status: "collecting",
      createdAt: 1,
    });
  });
  const args = { tenantId: "tenant-a", sourceThreadId: "thread-a" };
  const before = await t.query(internal.smokeAssert.agentAuthoringStateForThread, args);
  expect(before.governance.approvedPlanCount).toBe(0);
  await t.run((ctx) => ctx.db.patch(planId, { status: "approved" }));
  const after = await t.query(internal.smokeAssert.agentAuthoringStateForThread, args);
  expect(after.governance.approvedPlanCount).toBe(1);
  expect(after.governance.sha256).not.toBe(before.governance.sha256);
});

test("agent authoring inspector distinguishes governing writes from incidental/foreign audit", async () => {
  const t = convexTest(schema, modules);
  const args = { tenantId: "tenant-a", sourceThreadId: "thread-a" };
  const before = await t.query(internal.smokeAssert.agentAuthoringStateForThread, args);
  await t.run(async (ctx) => {
    for (const [tenantId, eventType] of [
      ["tenant-a", "llm.called"],
      ["tenant-b", "skill.agent_candidate_activated"],
    ]) {
      await ctx.db.insert("audit", {
        tenantId: tenantId ?? "",
        correlationId: "ref",
        eventType: eventType ?? "",
        actor: "system",
        payload: { count: 1 },
        ts: 1,
      });
    }
  });
  expect(
    (await t.query(internal.smokeAssert.agentAuthoringStateForThread, args)).governance,
  ).toEqual(before.governance);
  await t.run((ctx) =>
    ctx.db.insert("audit", {
      tenantId: "tenant-a",
      correlationId: "ref",
      eventType: "skill.agent_candidate_activated",
      actor: "owner",
      payload: { count: 1 },
      ts: 2,
    }),
  );
  const after = await t.query(internal.smokeAssert.agentAuthoringStateForThread, args);
  expect(after.governance.auditCount).toBe(1);
  expect(after.governance.sha256).not.toBe(before.governance.sha256);
  expect(Object.keys(after.governance).sort()).toEqual([
    "approvedPlanCount",
    "auditCount",
    "requestCount",
    "sha256",
    "toolGrantSha256",
  ]);
  expect(after.governance.toolGrantSha256).toMatch(/^[a-f0-9]{64}$/);
});

test("agent authoring inspector refuses a partial audit scan", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("audit", {
        tenantId: "tenant-a",
        correlationId: `ref-${index}`,
        eventType: "llm.called",
        actor: "system",
        payload: { count: 1 },
        ts: index,
      });
  });
  await expect(
    t.query(internal.smokeAssert.agentAuthoringStateForThread, {
      tenantId: "tenant-a",
      sourceThreadId: "thread-a",
    }),
  ).rejects.toThrow("AGENT_INSPECTION_WINDOW_EXCEEDED");
});
