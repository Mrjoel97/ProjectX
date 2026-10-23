// @vitest-environment node
import { grantsFor } from "@pikar/core";
import type { ManagedServiceRuntimeScope } from "@pikar/core/managedServices";
import { getFunctionName } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { contentHash } from "./lib/hash";
import { buildCockpitTools, type ToolContext } from "./llm";
import schema from "./schema";

const scope: ManagedServiceRuntimeScope = {
  operationIds: ["social.prepare", "social.report"],
  accounts: [
    {
      provider: "buffer",
      connectionId: "buffer",
      accountId: "selected-channel",
      connectionRevision: 1,
    },
    {
      provider: "zernio",
      connectionId: "zernio",
      accountId: "selected-account",
      connectionRevision: 1,
    },
  ],
  skills: [
    {
      skillId: "cockpit",
      name: "cockpit-agent",
      version: 1,
      bodyHash: "a".repeat(64),
      tenantId: null,
    },
  ],
};
function fixture(selected: ManagedServiceRuntimeScope = scope) {
  let running = true;
  const runQuery = vi.fn(async (reference) => {
    if (getFunctionName(reference) === "managedServiceRuns:getExecutionContext") {
      if (!running) throw new Error("SERVICE_EXECUTION_UNAVAILABLE");
      return selected;
    }
    if (getFunctionName(reference) === "zernio:agentReport")
      return {
        state: "ready",
        provider: "zernio",
        metricScope: "post_lifetime",
        fetchedAt: 100,
        accounts: [
          { accountId: "selected-account", posts: [{ postId: "selected-post" }] },
          { accountId: "another-account", posts: [{ postId: "another-post" }] },
        ],
      };
    throw new Error("unexpected_query");
  });
  const runAction = vi.fn(async () => ({
    organization: "Tenant organization",
    channels: [
      { id: "selected-channel", name: "Selected channel" },
      { id: "another-channel", name: "Another channel" },
    ],
  }));
  const runMutation = vi.fn(async (_reference: unknown, _args: unknown) => "draft-id");
  const context: ToolContext = {
    ctx: { runQuery, runAction, runMutation } as never,
    tenantId: "tenant-a",
    threadId: "thread-a",
    rootRequestId: "turn-a",
    planId: "plan-a" as Id<"plans">,
    managedServiceRunId: "service-run" as Id<"managedServiceRuns">,
    managedServiceScope: selected,
  };
  const tools = buildCockpitTools(context, grantsFor({}));
  const execute = async (name: string, input: unknown = {}) => {
    const definition = (
      tools as unknown as Record<
        string,
        { execute?: (input: unknown, options: unknown) => Promise<unknown> }
      >
    )[name];
    if (!definition?.execute) throw new Error("tool_absent");
    return definition.execute(input, { toolCallId: "test-call", messages: [] });
  };
  return {
    tools,
    execute,
    context,
    runQuery,
    runAction,
    runMutation,
    stop: () => {
      running = false;
    },
  };
}
describe("native managed service runtime scope", () => {
  test("the actual Executive record contains only the fixed approved social tools", () => {
    const h = fixture();
    expect(Object.keys(h.tools).sort()).toEqual([
      "readBufferChannels",
      "readZernioEngagement",
      "stageBufferPost",
    ]);
    for (const forbidden of [
      "authorSkillCandidate",
      "dispatchMedia",
      "dispatchResearch",
      "draftBody",
      "replyToMessage",
      "readBufferEngagement",
      "proposePlan",
      "setRecipients",
    ])
      expect(h.tools).not.toHaveProperty(forbidden);
    const leaf = buildCockpitTools(
      h.context,
      grantsFor({ toolNames: ["stageBufferPost", "dispatchResearch"] }),
    );
    expect(Object.keys(leaf)).toEqual([]);
  });
  test("channel/report reads project only exact service account pins and preserve report limits", async () => {
    const h = fixture();
    expect(await h.execute("readBufferChannels")).toEqual({
      state: "ready",
      evidence: {
        organization: "Tenant organization",
        channels: [{ id: "selected-channel", name: "Selected channel" }],
      },
    });
    expect(await h.execute("readZernioEngagement")).toEqual({
      state: "ready",
      provider: "zernio",
      metricScope: "post_lifetime",
      fetchedAt: 100,
      accounts: [{ accountId: "selected-account", posts: [{ postId: "selected-post" }] }],
    });
    expect(
      h.runQuery.mock.calls.some(
        ([reference]) => getFunctionName(reference) === "managedServiceRuns:getExecutionContext",
      ),
    ).toBe(true);
  });
  test("draft staging refuses an unselected channel before mutation and forwards the native run fence", async () => {
    const h = fixture();
    const draft = {
      campaign: "Prepared campaign",
      channelId: "another-channel",
      text: "A draft",
      mode: "addToQueue",
    };
    await expect(h.execute("stageBufferPost", draft)).rejects.toThrow(
      "SERVICE_ACCOUNT_NOT_ALLOWED",
    );
    expect(h.runMutation).not.toHaveBeenCalled();
    expect(
      await h.execute("stageBufferPost", { ...draft, channelId: "selected-channel" }),
    ).toMatchObject({ state: "draft" });
    expect(h.runMutation.mock.calls[0]?.[1]).toMatchObject({
      tenantId: "tenant-a",
      channelId: "selected-channel",
      managedServiceRunId: "service-run",
    });
  });
  test("pause fences the next tool before any provider/read or local draft effect", async () => {
    const h = fixture();
    await h.execute("readBufferChannels");
    h.runAction.mockClear();
    h.stop();
    await expect(h.execute("readBufferChannels")).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
    await expect(
      h.execute("stageBufferPost", {
        campaign: "Draft",
        channelId: "selected-channel",
        text: "Draft",
        mode: "addToQueue",
      }),
    ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
    expect(h.runAction).not.toHaveBeenCalled();
    expect(h.runMutation).not.toHaveBeenCalled();
  });
});

test("the existing governed loop prepares a scoped draft/report and fences a later stopped cycle", async () => {
  // Native reads and draft persistence are disposable fixture adapters. This proves actual loop,
  // SDK/tool wiring and stop behavior, independently of native coordinator/persistence tests.
  let running = true;
  let stopAfterReport = false;
  let checks = 0;
  let selectedScope = scope;
  const staged: unknown[] = [];
  const modules = {
    ...import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]),
    "./managedServiceRuns.ts": async () => ({
      getExecutionContext: internalQuery({
        args: {
          tenantId: v.string(),
          runId: v.id("managedServiceRuns"),
          threadId: v.optional(v.string()),
          planId: v.optional(v.id("plans")),
        },
        handler: async () => {
          checks += 1;
          if (!running) throw new Error("SERVICE_EXECUTION_UNAVAILABLE");
          return selectedScope;
        },
      }),
    }),
    "./zernio.ts": async () => ({
      agentReport: internalQuery({
        args: { tenantId: v.string() },
        handler: async () => {
          if (stopAfterReport) running = false;
          return { state: "ready", accounts: [{ accountId: "selected-account", posts: [] }] };
        },
      }),
    }),
    "./bufferActions.ts": async () => ({
      agentChannels: internalAction({
        args: { tenantId: v.string() },
        handler: async () => ({
          organization: "Fixture organization",
          channels: [
            { id: "selected-channel", name: "Selected" },
            { id: "another-channel", name: "Other" },
          ],
        }),
      }),
    }),
    "./buffer.ts": async () => ({
      stageAgentPost: internalMutation({
        args: {
          tenantId: v.string(),
          managedServiceRunId: v.id("managedServiceRuns"),
          campaign: v.string(),
          channelId: v.string(),
          text: v.string(),
          mode: v.literal("addToQueue"),
        },
        handler: async (_ctx, args) => {
          staged.push(args);
          return "fixture-draft";
        },
      }),
    }),
  };
  const t = convexTest(schema, modules);
  t.registerComponent(
    "rateLimiter",
    rateLimiterSchema,
    import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts"),
  );
  t.registerComponent(
    "auditCounts",
    aggregateSchema,
    import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts"),
  );
  await t.mutation(internal.skills.seedSkills, {});
  const cockpit = await t.query(internal.skills.getActiveSkill, { name: "cockpit-agent" });
  selectedScope = {
    ...scope,
    skills: [
      {
        skillId: "fixture-cockpit",
        name: "cockpit-agent",
        version: cockpit.version,
        bodyHash: await contentHash(cockpit.body),
        tenantId: null,
      },
    ],
  };
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "tenant-a",
    threadId: "thread-a",
  });
  const runId = await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId: "tenant-a",
      serviceId: "fixture",
      revision: 1,
      goal: "Read selected engagement",
      operationIds: [...scope.operationIds],
      accounts: [...scope.accounts],
      skills: [...selectedScope.skills],
      budgetLimitCents: 100,
      controlState: "active",
      controlRevision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return ctx.db.insert("managedServiceRuns", {
      tenantId: "tenant-a",
      serviceId,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: 100,
      requestKey: "fixture",
      state: "running",
      threadId: "thread-a",
      planId,
      turnId: "turn-a",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
  for (const override of [{ model: "" }, { skillVersions: {} }]) {
    await expect(
      t.action(internal.llm.runCockpitAgent, {
        tenantId: "tenant-a",
        planId,
        threadId: "thread-a",
        turnId: "turn-a",
        managedServiceRunId: runId,
        text: "Prepare the service",
        ...override,
      }),
    ).rejects.toThrow("SERVICE_EXECUTION_CONTEXT_CONFLICT");
  }
  const toolStep = (name: string, input: unknown = {}) => ({
    content: [
      {
        type: "tool-call",
        toolCallId: `success-${name}`,
        toolName: name,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage,
    warnings: [],
  });
  const completed = await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "tenant-a",
    planId,
    threadId: "thread-a",
    turnId: "turn-a",
    managedServiceRunId: runId,
    primary: [
      toolStep("readBufferChannels"),
      toolStep("stageBufferPost", {
        campaign: "Fixture campaign",
        channelId: "selected-channel",
        text: "Review this draft",
        mode: "addToQueue",
      }),
      toolStep("readZernioEngagement"),
      {
        content: [
          { type: "text", text: "Your draft is ready for review; the cached report is available." },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    ],
  });
  expect(completed.reply).toBe("Your draft is ready for review; the cached report is available.");
  expect(staged).toEqual([
    {
      tenantId: "tenant-a",
      managedServiceRunId: runId,
      campaign: "Fixture campaign",
      channelId: "selected-channel",
      text: "Review this draft",
      mode: "addToQueue",
    },
  ]);
  const previousSpend = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  stopAfterReport = true;
  await expect(
    t.action(internal.llm.__runCockpitAgentWithScript, {
      tenantId: "tenant-a",
      planId,
      threadId: "thread-a",
      turnId: "turn-a",
      managedServiceRunId: runId,
      primary: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "report",
              toolName: "readZernioEngagement",
              input: "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "This model step must not run after stop." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ],
    }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  expect(checks).toBeGreaterThanOrEqual(5);
  const records = await t.run(async (ctx) => ({
    posts: await ctx.db.query("bufferPosts").collect(),
    spend: await ctx.db.query("spendEvents").collect(),
    plan: await ctx.db.get(planId),
  }));
  expect(records.posts).toEqual([]);
  expect(records.spend).toEqual(previousSpend);
  expect(records.plan?.status).toBe("collecting");
});
