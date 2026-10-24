import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { startStandingServiceRun } from "./managedServiceRecurrenceExecution";

const agent = vi.hoisted(() => ({ createThread: vi.fn() }));
vi.mock("./cockpit", () => ({ cockpitAgent: agent }));
beforeEach(() => agent.createThread.mockReset().mockResolvedValue({ threadId: "native-thread" }));

const args = { tenantId: "tenant-a", runId: "run-a" as Id<"managedServiceRuns"> };
function fixture(failAt?: string) {
  const mutations: Array<{ name: string; args: unknown }> = [];
  const queries: string[] = [];
  const ctx = {
    runQuery: vi.fn(async (ref) => {
      const name = getFunctionName(ref);
      queries.push(name);
      if (name === failAt) throw new Error("FENCED");
      if (name !== "managedServiceRuns:claimedGoal") throw new Error("PUBLIC_QUERY_FORBIDDEN");
      return { goal: "Prepare approved content" };
    }),
    runMutation: vi.fn(async (ref, value) => {
      const name = getFunctionName(ref);
      mutations.push({ name, args: value });
      if (name === failAt) throw new Error("UNKNOWN_STARTUP_RESULT");
      return name === "plans:insertPlan" ? "native-plan" : null;
    }),
    runAction: vi.fn(() => {
      throw new Error("PAID_ACTION_FORBIDDEN");
    }),
  };
  return { ctx, mutations, queries };
}

test("authless native startup binds only the claimed tenant/run using existing workflow startup", async () => {
  const f = fixture();
  await startStandingServiceRun(f.ctx as unknown as ActionCtx, args);
  expect(f.queries).toEqual(["managedServiceRuns:claimedGoal"]);
  expect(agent.createThread).toHaveBeenCalledExactlyOnceWith(f.ctx, {
    userId: "tenant-a",
    title: "Prepare approved content",
  });
  expect(f.mutations).toEqual([
    { name: "plans:insertPlan", args: { tenantId: "tenant-a", threadId: "native-thread" } },
    {
      name: "managedServiceRuns:bindAndStart",
      args: { ...args, threadId: "native-thread", planId: "native-plan" },
    },
  ]);
  expect(f.ctx.runAction).not.toHaveBeenCalled();
});

test.each([
  "managedServiceRuns:claimedGoal",
  "plans:insertPlan",
  "managedServiceRuns:bindAndStart",
])("a refused or uncertain %s startup records setup failure once and never retries", async (failAt) => {
  const f = fixture(failAt);
  await startStandingServiceRun(f.ctx as unknown as ActionCtx, args);
  expect(f.mutations.filter((row) => row.name === "managedServiceRuns:setupFailed")).toEqual([
    { name: "managedServiceRuns:setupFailed", args },
  ]);
  expect(f.mutations.filter((row) => row.name === failAt).length).toBeLessThanOrEqual(1);
  expect(agent.createThread.mock.calls.length).toBeLessThanOrEqual(1);
  expect(f.ctx.runAction).not.toHaveBeenCalled();
});
