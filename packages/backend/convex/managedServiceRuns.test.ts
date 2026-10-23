// @vitest-environment node
import { readFileSync } from "node:fs";
import type { WorkflowId } from "@convex-dev/workflow";
import { MANAGED_SERVICE_RUN_LIFETIME_MS } from "@pikar/core/managedServices";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { cockpitAgent } from "./cockpit";
import { contentHash } from "./lib/hash";
import { internalAction } from "./lib/tenantLifecycle";
import { buildManagedServiceTools } from "./managedServiceTools";
import schema from "./schema";

// Only the authoritative read-only admission result is mocked for future qualified environments.
// Native claims, CAS, component workflow, thread store, fences, and accounting stay real.
const flags = vi.hoisted(() => ({ admitted: false, calls: 0, fail: false, scripted: false }));
vi.mock("./managedServices", async (original) => ({
  ...(await original<typeof import("./managedServices")>()),
  managedServiceReadiness: async () => ({
    ready: flags.admitted,
    reasons: flags.admitted ? [] : ["operation_unqualified"],
  }),
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const fakeLLM = internalAction({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    text: v.string(),
    turnId: v.optional(v.string()),
    managedServiceRunId: v.optional(v.id("managedServiceRuns")),
  },
  handler: async (ctx, args) => {
    flags.calls++;
    if (flags.fail) throw new Error("PRIVATE_PROVIDER_FAILURE_NEEDLE");
    expect(args.managedServiceRunId).toBeDefined();
    if (flags.scripted) {
      const usage = {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      };
      return ctx.runAction(internal.llm.__runCockpitAgentWithScript, {
        tenantId: args.tenantId,
        planId: args.planId,
        threadId: args.threadId,
        turnId: args.turnId,
        managedServiceRunId: args.managedServiceRunId,
        primary: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "draft-once",
                toolName: "stageBufferPost",
                input: JSON.stringify({
                  campaign: "Synthetic campaign",
                  channelId: "aaaaaaaaaaaaaaaaaaaaaaaa",
                  text: "Prepared draft for human review",
                  mode: "addToQueue",
                }),
              },
            ],
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage,
            warnings: [],
          },
          {
            content: [{ type: "text", text: "ACTUAL_ASSISTANT_RESULT_NEEDLE" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage,
            warnings: [],
          },
        ],
      });
    }
    return { reply: "ACTUAL_ASSISTANT_RESULT_NEEDLE", costUsd: 0 };
  },
});
const harnesses: ReturnType<typeof convexTest>[] = [];
const ownedTimers = new Set<ReturnType<typeof setTimeout>>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
beforeEach(() => {
  flags.admitted = false;
  flags.calls = 0;
  flags.fail = false;
  flags.scripted = false;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const timer = realSetTimeout(() => {
      ownedTimers.delete(timer);
      callback(...args);
    }, delay);
    ownedTimers.add(timer);
    return timer;
  }) as typeof setTimeout);
});
afterEach(async () => {
  for (const t of harnesses.splice(0)) {
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect())
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    });
    await t.finishInProgressScheduledFunctions();
  }
  for (const timer of ownedTimers) realClearTimeout(timer);
  ownedTimers.clear();
  vi.restoreAllMocks();
});
async function terminal(t: ReturnType<typeof convexTest>, runId: Id<"managedServiceRuns">) {
  for (let i = 0; i < 200; i++) {
    const row = await t.run((ctx) => ctx.db.get(runId));
    if (row && row.state !== "claimed" && row.state !== "running") return row;
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
  throw new Error("LOCAL_WORKFLOW_DID_NOT_REACH_TERMINAL");
}
async function harness() {
  const t = convexTest(schema, {
    ...modules,
    "./llm.ts": async () => ({ ...(await import("./llm")), runCockpitAgent: fakeLLM }),
  });
  t.registerComponent("agent", agentSchema, agentModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent(
    "rateLimiter",
    rateLimiterSchema,
    import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts"),
  );
  harnesses.push(t);
  const a = await t.run((ctx) => ctx.db.insert("users", {}));
  const b = await t.run((ctx) => ctx.db.insert("users", {}));
  const asA = t.withIdentity({ subject: `${a}|a` }),
    asB = t.withIdentity({ subject: `${b}|b` });
  const skillId = await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: "cockpit-agent",
      version: 1,
      body: "REGISTRY_BODY_NEEDLE",
      evidence: JSON.stringify({ pass: true, skillVersions: { "cockpit-agent": 1 } }),
      status: "active",
      createdAt: 1,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("bufferConnections", {
      tenantId: a,
      connectionId: "owned",
      revision: 1,
      status: "connected",
      keyVersion: "v1",
      ciphertextB64: "CREDENTIAL_NEEDLE",
      ivB64: "private-iv",
      expiresAt: Date.now() + 100000,
      updatedAt: 1,
      organizationId: "org",
      channels: [
        { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "label", service: "linkedin", available: true },
      ],
      selectedChannelIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"],
      dailyReports: false,
      nextReportAt: 0,
    }),
  );
  const config = {
    serviceId: "social-marketing",
    expectedRevision: 0,
    goal: "USER_GOAL_NEEDLE",
    operationIds: ["social.prepare" as const],
    accounts: [
      {
        provider: "buffer" as const,
        connectionId: "owned",
        accountId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        connectionRevision: 1,
      },
    ],
    skills: [
      {
        skillId,
        name: "cockpit-agent",
        version: 1,
        bodyHash: await contentHash("REGISTRY_BODY_NEEDLE"),
        tenantId: null,
      },
    ],
    budgetLimitCents: 100,
  };
  const saved = await asA.mutation(api.managedServices.setup, config);
  const claimArgs = {
    tenantId: a,
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    requestKey: "one",
  };
  async function running() {
    flags.admitted = true;
    const claimed = await t.mutation(internal.managedServiceRuns.claim, claimArgs);
    const { threadId } = await t.run((ctx) => cockpitAgent.createThread(ctx, { userId: a }));
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: a,
        threadId,
        status: "collecting",
        createdAt: Date.now(),
      }),
    );
    await t.run((ctx) =>
      ctx.db.patch(claimed.runId, {
        state: "running",
        threadId,
        planId,
        turnId: "native-turn",
        workflowId: "workflow-ref",
      }),
    );
    return { runId: claimed.runId, threadId, planId };
  }
  const messages = (threadId: string) =>
    t.run((ctx) =>
      cockpitAgent.listMessages(ctx, { threadId, paginationOpts: { numItems: 100, cursor: null } }),
    );
  return { t, a, b, asA, asB, config, saved, claimArgs, running, messages };
}

test("unqualified production admission stops public start before claims, threads or provider work", async () => {
  const { t, asA, claimArgs } = await harness();
  const { tenantId: _tenant, ...args } = claimArgs;
  await expect(asA.action(api.managedServiceRuns.start, args)).rejects.toThrow(
    "SERVICE_EXECUTION_UNAVAILABLE",
  );
  expect(await t.run((ctx) => ctx.db.query("managedServiceRuns").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("plans").collect())).toHaveLength(0);
  expect(flags.calls).toBe(0);
});

test("native duplicate claim is idempotent; other keys cannot overlap claimed, running or unknown work", async () => {
  const { t, claimArgs } = await harness();
  flags.admitted = true;
  const results = await Promise.all([
    t.mutation(internal.managedServiceRuns.claim, claimArgs),
    t.mutation(internal.managedServiceRuns.claim, claimArgs),
  ]);
  expect(results[0]?.runId).toBe(results[1]?.runId);
  expect(results.filter((r) => !r.existing)).toHaveLength(1);
  const runId = results[0]?.runId;
  if (!runId) throw new Error("NO_RUN");
  for (const state of ["claimed", "running", "unknown"] as const) {
    await t.run((ctx) => ctx.db.patch(runId, { state }));
    await expect(
      t.mutation(internal.managedServiceRuns.claim, { ...claimArgs, requestKey: state }),
    ).rejects.toThrow("SERVICE_RUN_ALREADY_PENDING");
  }
  expect(await t.run((ctx) => ctx.db.query("managedServiceRuns").collect())).toHaveLength(1);
});

test("request/config/control and unsupported operations reject even in a future admitted environment", async () => {
  const { t, asA, config, claimArgs } = await harness();
  flags.admitted = true;
  await expect(
    t.mutation(internal.managedServiceRuns.claim, { ...claimArgs, expectedControlRevision: 9 }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  await expect(
    t.mutation(internal.managedServiceRuns.claim, {
      ...claimArgs,
      requestKey: "user content with spaces",
    }),
  ).rejects.toThrow("SERVICE_INVALID_REQUEST_KEY");
  await asA.mutation(api.managedServices.setup, {
    ...config,
    expectedRevision: 1,
    operationIds: ["workflow.pack.run"],
  });
  await expect(
    t.mutation(internal.managedServiceRuns.claim, {
      ...claimArgs,
      expectedRevision: 2,
      expectedControlRevision: 2,
    }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
});

test("execution context binds tenant/run/plan/thread and never returns credentials or prompt bodies", async () => {
  const { t, a, b, running, asB } = await harness();
  const run = await running();
  const context = await t.query(internal.managedServiceRuns.getExecutionContext, {
    tenantId: a,
    ...run,
  });
  expect(context.operationIds).toEqual(["social.prepare"]);
  expect(context.budgetLimitCents).toBe(100);
  expect(JSON.stringify(context)).not.toMatch(/CREDENTIAL_NEEDLE|REGISTRY_BODY_NEEDLE/);
  for (const args of [
    { tenantId: b, ...run },
    { tenantId: a, ...run, threadId: "wrong" },
  ])
    await expect(t.query(internal.managedServiceRuns.getExecutionContext, args)).rejects.toThrow(
      "SERVICE_EXECUTION_UNAVAILABLE",
    );
  expect(await asB.query(api.managedServiceRuns.status, { runId: run.runId })).toBeNull();
  await t.run((ctx) => ctx.db.patch(run.planId, { tenantId: b }));
  await expect(
    t.query(internal.managedServiceRuns.getExecutionContext, { tenantId: a, ...run }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
});

test("stop/resume fences old callbacks and clean paused work ends stopped rather than unrecoverable unknown", async () => {
  const { t, a, asA, running } = await harness();
  const run = await running();
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    action: "pause",
  });
  await expect(
    t.query(internal.managedServiceRuns.getExecutionContext, { tenantId: a, ...run }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  await t.mutation(internal.managedServiceRuns.finish, {
    tenantId: a,
    runId: run.runId,
    outcome: "execution_uncertain",
  });
  expect(await asA.query(api.managedServiceRuns.status, { runId: run.runId })).toMatchObject({
    state: "stopped",
    terminalCode: "control_changed",
  });
  await expect(
    asA.mutation(api.managedServices.setControl, {
      serviceId: "social-marketing",
      expectedRevision: 1,
      expectedControlRevision: 1,
      action: "resume",
    }),
  ).rejects.toThrow("SERVICE_STALE_REVISION");
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 2,
    action: "resume",
  });
  await expect(
    t.query(internal.managedServiceRuns.getExecutionContext, { tenantId: a, ...run }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  await expect(
    asA.mutation(api.managedServices.setControl, {
      serviceId: "social-marketing",
      expectedRevision: 1,
      expectedControlRevision: 3,
      action: "resume",
    }),
  ).rejects.toThrow("SERVICE_INVALID_CONTROL");
});

test("unknown paid hold wins over stop and prevents false completion or new work", async () => {
  const { t, a, asA, running, claimArgs, messages } = await harness();
  const run = await running();
  await t.run((ctx) =>
    ctx.db.insert("spendEvents", {
      tenantId: a,
      managedServiceRunId: run.runId,
      correlationId: "accepted-once",
      rail: "reasoning",
      phase: "reserved",
      amountCents: 5,
      kind: "paid_call",
      createdAt: Date.now(),
    }),
  );
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    action: "stop",
  });
  await t.mutation(internal.managedServiceRuns.finish, {
    tenantId: a,
    runId: run.runId,
    outcome: "completed",
    reply: "MUST_NOT_PUBLISH",
  });
  expect(await asA.query(api.managedServiceRuns.status, { runId: run.runId })).toMatchObject({
    state: "unknown",
  });
  expect((await messages(run.threadId)).page).toHaveLength(0);
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 2,
    action: "resume",
  });
  await expect(
    t.mutation(internal.managedServiceRuns.claim, {
      ...claimArgs,
      expectedControlRevision: 3,
      requestKey: "new",
    }),
  ).rejects.toThrow("SERVICE_RUN_ALREADY_PENDING");
});

test("worker reuses existing loop once and stores the actual result only in the owned thread", async () => {
  const { t, a, asA, running, messages } = await harness();
  const run = await running();
  await t.action(internal.managedServiceExecution.execute, { tenantId: a, runId: run.runId });
  expect(flags.calls).toBe(1);
  expect(await asA.query(api.managedServiceRuns.status, { runId: run.runId })).toMatchObject({
    state: "completed",
  });
  expect(JSON.stringify((await messages(run.threadId)).page)).toContain(
    "ACTUAL_ASSISTANT_RESULT_NEEDLE",
  );
  const native = await t.run((ctx) => ctx.db.get(run.runId));
  expect(JSON.stringify(native)).not.toContain("ACTUAL_ASSISTANT_RESULT_NEEDLE");
  await t.mutation(internal.managedServiceRuns.finish, {
    tenantId: a,
    runId: run.runId,
    outcome: "completed",
    reply: "DUPLICATE",
  });
  expect((await messages(run.threadId)).page).toHaveLength(1);
});

test("worker/provider failure stays unknown with no raw error/result disclosure or retry", async () => {
  const { t, a, asA, running, messages } = await harness();
  const run = await running();
  flags.fail = true;
  await t.action(internal.managedServiceExecution.execute, { tenantId: a, runId: run.runId });
  const status = await asA.query(api.managedServiceRuns.status, { runId: run.runId });
  expect(status).toMatchObject({ state: "unknown", terminalCode: "execution_uncertain" });
  expect(flags.calls).toBe(1);
  expect(JSON.stringify(status)).not.toContain("PRIVATE_PROVIDER_FAILURE");
  expect((await messages(run.threadId)).page).toHaveLength(0);
});

test("atomic Buffer draft gate rejects stale controls between tool observation and mutation", async () => {
  const { t, a, asA, running } = await harness();
  const run = await running();
  await t.query(internal.managedServiceRuns.getExecutionContext, { tenantId: a, ...run });
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    action: "stop",
  });
  await expect(
    t.mutation(internal.buffer.stageAgentPost, {
      tenantId: a,
      managedServiceRunId: run.runId,
      campaign: "campaign",
      channelId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      text: "draft",
      mode: "addToQueue",
    }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  expect(await t.run((ctx) => ctx.db.query("bufferPosts").collect())).toHaveLength(0);
});

test("late workflow terminal cannot overwrite a known terminal or accept a different workflow", async () => {
  const { t, a, asA, running } = await harness();
  const run = await running();
  await t.mutation(internal.managedServiceRuns.onComplete, {
    workflowId: "other" as WorkflowId,
    context: { tenantId: a, runId: run.runId },
    result: { kind: "failed", error: "private" },
  });
  expect(await asA.query(api.managedServiceRuns.status, { runId: run.runId })).toMatchObject({
    state: "running",
  });
  await t.action(internal.managedServiceExecution.execute, { tenantId: a, runId: run.runId });
  await t.mutation(internal.managedServiceRuns.onComplete, {
    workflowId: "workflow-ref" as WorkflowId,
    context: { tenantId: a, runId: run.runId },
    result: { kind: "failed", error: "private" },
  });
  expect(await asA.query(api.managedServiceRuns.status, { runId: run.runId })).toMatchObject({
    state: "completed",
  });
});

test("public start binds one owned thread and durable once-only workflow; duplicate start never reruns", async () => {
  const { t, asA, claimArgs, messages } = await harness();
  flags.admitted = true;
  flags.scripted = true;
  const { tenantId: _tenant, ...args } = claimArgs;
  const started = await asA.action(api.managedServiceRuns.start, args);
  const again = await asA.action(api.managedServiceRuns.start, args);
  expect(again.runId).toBe(started.runId);
  expect(again.existing).toBe(true);
  await terminal(t, started.runId);
  expect(flags.calls).toBe(1);
  expect(await asA.query(api.managedServiceRuns.status, { runId: started.runId })).toMatchObject({
    state: "completed",
  });
  if (!started.threadId) throw new Error("NO_THREAD");
  const text = JSON.stringify((await messages(started.threadId)).page);
  expect(text).toContain("USER_GOAL_NEEDLE");
  expect(text).toContain("ACTUAL_ASSISTANT_RESULT_NEEDLE");
  expect(await t.run((ctx) => ctx.db.query("plans").collect())).toHaveLength(1);
  const posts = await t.run((ctx) => ctx.db.query("bufferPosts").collect());
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ status: "draft", text: "Prepared draft for human review" });
  expect(posts[0]).not.toHaveProperty("managedServiceRunId");
});

test("attended run age bounds reject expired/future starts without blocking accounting or status", async () => {
  const { t, a, asA, running } = await harness();
  const run = await running();
  for (const createdAt of [Date.now() - MANAGED_SERVICE_RUN_LIFETIME_MS, Date.now() + 60000]) {
    await t.run((ctx) => ctx.db.patch(run.runId, { createdAt }));
    await expect(
      t.query(internal.managedServiceRuns.getExecutionContext, { tenantId: a, ...run }),
    ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  }
  await t.action(internal.managedServiceExecution.execute, { tenantId: a, runId: run.runId });
  expect(flags.calls).toBe(0);
  expect(await asA.query(api.managedServiceRuns.status, { runId: run.runId })).toMatchObject({
    state: "stopped",
  });
});

test("ordinary agent start tool reaches the same authenticated public start and deduplicates its root request", async () => {
  const { t, a, asA } = await harness();
  flags.admitted = true;
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        subject: `${a}|native-session`,
        tokenIdentifier: "fixture",
        issuer: "fixture",
      }),
    },
    runQuery: asA.query,
    runAction: asA.action,
  } as ActionCtx;
  const tools = buildManagedServiceTools(ctx, String(a), "trusted-attended-root");
  const tool = tools.startSocialService;
  if (!tool?.execute) throw new Error("MISSING_START_TOOL");
  const first = await tool.execute({}, { toolCallId: "first", messages: [] });
  const duplicate = await tool.execute({}, { toolCallId: "again", messages: [] });
  expect(first).toMatchObject({ publicationRequiresReview: true, existing: false });
  expect(duplicate).toMatchObject({ existing: true });
  const runs = await t.run((ctx) => ctx.db.query("managedServiceRuns").collect());
  expect(runs).toHaveLength(1);
  const run = runs[0];
  if (!run) throw new Error("MISSING_RUN");
  await terminal(t, run._id);
  expect(flags.calls).toBe(1);
  expect(await t.run((ctx) => ctx.db.query("plans").collect())).toHaveLength(1);
});

test("pausing an unbound claim closes only that no-paid claim; explicit resume permits a fresh request", async () => {
  const { t, a, asA, claimArgs } = await harness();
  flags.admitted = true;
  const first = await t.mutation(internal.managedServiceRuns.claim, claimArgs);
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    action: "stop",
  });
  expect(await asA.query(api.managedServiceRuns.status, { runId: first.runId })).toMatchObject({
    state: "stopped",
  });
  await asA.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 2,
    action: "resume",
  });
  const next = await t.mutation(internal.managedServiceRuns.claim, {
    ...claimArgs,
    expectedControlRevision: 3,
    requestKey: "fresh-attended-start",
  });
  expect(next.runId).not.toBe(first.runId);
  expect(flags.calls).toBe(0);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("spendEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", a))
        .collect(),
    ),
  ).toHaveLength(0);
});

test("setup options expose only labelled owned selected pins and a qualified registry identity", async () => {
  const { asA, asB } = await harness();
  const options = await asA.query(api.managedServices.setupOptions, {});
  expect(options.accounts).toHaveLength(1);
  expect(options.accounts[0]).toMatchObject({
    accountId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    label: "label",
    available: true,
  });
  expect(options.skills).toHaveLength(1);
  expect(JSON.stringify(options)).not.toMatch(/CREDENTIAL_NEEDLE|REGISTRY_BODY_NEEDLE|private-iv/);
  expect((await asB.query(api.managedServices.setupOptions, {})).accounts).toEqual([]);
});

test("durable paid action has retry:false and no alternate engine/provider path", () => {
  const source = readFileSync(new URL("./managedServiceRuns.ts", import.meta.url), "utf8");
  expect(source.match(/step\.runAction\(/g)).toHaveLength(1);
  expect(source).toMatch(
    /step\.runAction\(internal\.managedServiceExecution\.execute, args, \{ retry: false \}\)/,
  );
  const worker = readFileSync(new URL("./managedServiceExecution.ts", import.meta.url), "utf8");
  expect(worker).toContain("internal.llm.runCockpitAgent");
  expect(worker).not.toMatch(/generateText|fetch\(|new Agent|skillVersions:/);
});
