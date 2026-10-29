// @vitest-environment node
import { getFunctionName } from "convex/server";
import { expect, test, vi } from "vitest";
import { execute } from "./managedServiceExecution";

function fixture() {
  const events: string[] = [];
  const context = {
    tenantId: "tenant-a",
    runId: "run-a",
    threadId: "thread-a",
    planId: "plan-a",
    turnId: "turn-a",
    goal: "Report",
    operationIds: ["social.report"],
    accounts: [
      {
        provider: "zernio",
        connectionId: "connection-a",
        accountId: "account-a",
        connectionRevision: 3,
      },
    ],
  };
  const connection = {
    status: "connected",
    connectionId: "connection-a",
    revision: 7,
    grantRevision: 3,
    selectedAccountIds: ["account-a"],
    dailyReports: false,
  };
  const report = {
    state: "ready",
    fetchedAt: Date.now() - 1000,
    fromDate: "2026-10-01",
    toDate: "2026-10-27",
    accounts: [
      {
        accountId: "account-a",
        platform: "tiktok",
        posts: [{ postId: "post-a", source: "external", metrics: { views: 12 }, updatedAt: null }],
      },
    ],
  };
  let refreshState = "updated";
  let afterRefresh = () => {};
  let stopped = false;
  const runQuery = vi.fn(async (ref) => {
    const name = getFunctionName(ref);
    events.push(name);
    if (name === "managedServiceRuns:getExecutionContext") {
      if (stopped) throw new Error("stopped");
      return context;
    }
    if (name === "zernio:connection") return { ...connection };
    if (name === "zernio:agentReport") return report;
    throw new Error(`unexpected ${name}`);
  });
  const runAction = vi.fn(async (ref) => {
    const name = getFunctionName(ref);
    events.push(name);
    if (name === "zernioActions:refreshScheduled") {
      afterRefresh();
      return { state: refreshState };
    }
    if (name === "llm:runCockpitAgent") return { reply: "Report ready", blocked: false };
    throw new Error(`unexpected ${name}`);
  });
  const runMutation = vi.fn(async (_reference: unknown, _args: unknown) => null);
  const run = () =>
    (execute as unknown as { _handler(ctx: unknown, args: unknown): Promise<null> })._handler(
      { runQuery, runAction, runMutation, storage: {} },
      { tenantId: "tenant-a", runId: "run-a" },
    );
  return {
    run,
    events,
    connection,
    context,
    report,
    runMutation,
    setRefresh: (value: string) => {
      refreshState = value;
    },
    onRefresh: (fn: () => void) => {
      afterRefresh = fn;
    },
    stop: () => {
      stopped = true;
    },
  };
}

test("report refresh runs before the agent with independent daily reporting disabled", async () => {
  const f = fixture();
  await f.run();
  expect(f.connection.dailyReports).toBe(false);
  expect(f.events).toEqual([
    "managedServiceRuns:getExecutionContext",
    "zernio:connection",
    "zernioActions:refreshScheduled",
    "managedServiceRuns:getExecutionContext",
    "zernio:connection",
    "zernio:agentReport",
    "llm:runCockpitAgent",
  ]);
  expect(f.runMutation.mock.calls[0]?.[1]).toMatchObject({ outcome: "completed" });
});

test("fresh cache preserves its source timestamp when refresh is throttled", async () => {
  const f = fixture();
  const fetchedAt = f.report.fetchedAt;
  f.setRefresh("not_due_or_connection_changed");
  await f.run();
  expect(f.events).toContain("llm:runCockpitAgent");
  expect(f.report.fetchedAt).toBe(fetchedAt);
});

test.each([
  "stale",
  "not_refreshed",
  "unavailable",
])("%s reports stop before any paid agent turn", async (state) => {
  const f = fixture();
  f.report.state = state;
  await f.run();
  expect(f.events).not.toContain("llm:runCockpitAgent");
  expect(f.runMutation.mock.calls[0]?.[1]).toMatchObject({ outcome: "governed_stop" });
});

test.each([
  "grant",
  "selection",
  "revision",
  "pause",
  "failure",
])("%s change during refresh stops execution", async (change) => {
  const f = fixture();
  f.onRefresh(() => {
    if (change === "grant") f.connection.grantRevision++;
    if (change === "selection") f.connection.selectedAccountIds.push("other");
    if (change === "revision") f.connection.revision++;
    if (change === "pause") f.stop();
  });
  if (change === "failure") f.setRefresh("reauth_required");
  await f.run();
  expect(f.events).not.toContain("llm:runCockpitAgent");
});

test("extra selected accounts cannot widen the service's upstream read", async () => {
  const f = fixture();
  f.connection.selectedAccountIds.push("other");
  await f.run();
  expect(f.events).not.toContain("zernioActions:refreshScheduled");
});

test("preparation-only work does not call Zernio", async () => {
  const f = fixture();
  f.context.operationIds = ["social.prepare"];
  await f.run();
  expect(f.events).toEqual(["managedServiceRuns:getExecutionContext", "llm:runCockpitAgent"]);
});

test("completed report persists grounded narrative beside an agent's draft without another agent call", async () => {
  const f = fixture();
  await f.run();
  const saved = f.runMutation.mock.calls[0]?.[1] as { reply: string };
  expect(saved.reply).toContain("Report ready");
  expect(saved.reply).toContain("Engagement evidence");
  expect(saved.reply).toContain("views: 12");
  expect(saved.reply).toContain("likes: unavailable");
  expect(saved.reply).toContain(new Date(f.report.fetchedAt).toISOString());
  expect(saved.reply).toContain("/dashboard/marketing");
  expect(f.events.filter((e) => e === "llm:runCockpitAgent")).toHaveLength(1);
});

test("prepare-only replies do not invent a report appendix", async () => {
  const f = fixture();
  f.context.operationIds = ["social.prepare"];
  await f.run();
  expect(f.runMutation.mock.calls[0]?.[1]).toMatchObject({ reply: "Report ready" });
});
