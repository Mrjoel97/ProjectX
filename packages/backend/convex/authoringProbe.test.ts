// @vitest-environment node
import { AGENT_AUTHORABLE_SKILLS } from "@pikar/contracts/skill";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import limiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const seam = vi.hoisted(() => ({ steps: [] as unknown[], calls: 0 }));
vi.mock("./lib/models", async (importOriginal) => {
  const { MockLanguageModelV4 } = await import("ai/test");
  return {
    ...(await importOriginal<typeof import("./lib/models")>()),
    resolveModel: () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          seam.calls++;
          const step = seam.steps.shift();
          if (!step) throw new Error("UNEXPECTED_PROVIDER_CALL");
          if (step instanceof Error) throw step;
          return step as never;
        },
      }),
  };
});
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const agents = import.meta.glob("../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts");
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const limiters = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const result = (content: unknown[], reason = "stop", known = true) => ({
  content,
  finishReason: { unified: reason, raw: reason },
  usage,
  warnings: [],
  response: { body: known ? { usage: { cost: 0.001, is_byok: false } } : {} },
  providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
});
const text = () => result([{ type: "text", text: "Draft waiting for review." }]);
const tool = (toolName: string, input: unknown) =>
  result(
    [{ type: "tool-call", toolCallId: toolName, toolName, input: JSON.stringify(input) }],
    "tool-calls",
  );
async function setup(capCents = 200) {
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("GOLDEN_TAVILY_BILLING", "free");
  vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", "0");
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agents);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  t.registerComponent("rateLimiter", limiterSchema, limiters);
  await t.mutation(internal.skills.seedSkills, {});
  const userId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  const foreignId = await t.run((ctx) => ctx.db.insert("users", {}));
  const probe = await t.mutation(internal.authoringProbe.prepare, {
    userId,
    capCents,
    authorizationSha256: "a".repeat(64),
  });
  return { t, userId, foreignId, owner: t.withIdentity({ subject: userId }), ...probe };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  seam.calls = 0;
  seam.steps = [];
});

test("generic audit writes cannot forge control; expiry and alternate cockpit entries refuse without egress", async () => {
  const { t, owner, userId, threadId, budgetId } = await setup();
  for (const change of [
    { eventType: "authoring_probe.finished" },
    { tenantId: "control:authoring-probe:v1" },
    { correlationId: `authoring-probe:${budgetId}` },
  ])
    await expect(
      t.mutation(internal.audit.log, {
        tenantId: userId,
        correlationId: "ordinary",
        eventType: "ordinary",
        actor: "system",
        payload: {},
        ...change,
      }),
    ).rejects.toThrow("RESERVED_EVIDENCE_NAMESPACE");
  await expect(
    owner.action(api.cockpit.startWorkflowPack, { threadId, packId: "research", text: "Start" }),
  ).rejects.toThrow("ALTERNATE_ENTRY_REFUSED");
  await expect(
    owner.action(api.cockpit.startVerticalPack, { threadId, verticalId: "product", text: "Start" }),
  ).rejects.toThrow("ALTERNATE_ENTRY_REFUSED");
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["synthetic"])));
  await expect(
    owner.action(api.intake.attachToThread, {
      threadId,
      storageId,
      filename: "test.pdf",
      mimeType: "application/pdf",
      size: 9,
    }),
  ).rejects.toThrow("ALTERNATE_ENTRY_REFUSED");
  await expect(owner.action(api.intake.dictateToThread, { threadId, storageId })).rejects.toThrow(
    "ALTERNATE_ENTRY_REFUSED",
  );
  const plans = await t.run((ctx) =>
    ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", userId).eq("threadId", threadId))
      .collect(),
  );
  const plan = plans[0];
  if (!plan) throw new Error("missing plan");
  await expect(owner.mutation(api.cockpit.executePlan, { planId: plan._id })).rejects.toThrow(
    "ALTERNATE_ENTRY_REFUSED",
  );
  const envelope = await t.run((ctx) => ctx.db.get(budgetId));
  vi.spyOn(Date, "now").mockReturnValue((envelope?.evalEnvelope?.expiresAt ?? 0) + 1);
  await expect(
    owner.action(api.cockpit.sendCockpitMessage, { threadId, text: "Expired" }),
  ).rejects.toThrow("EXPIRED");
  expect(seam.calls).toBe(0);
});

test("direct-video driver is contained and unrelated owner work cannot prevent probe closure", async () => {
  const { t, owner, userId, threadId, budgetId } = await setup();
  await owner.action(api.cockpit.sendCockpitMessage, {
    threadId,
    text: "Create a short video about this business.",
  });
  expect(seam.calls).toBe(0);
  expect(await t.query(internal.authoringProbe.inspect, { budgetId })).toMatchObject({
    containmentRefusals: 1,
    finished: 1,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("plans", {
      tenantId: userId,
      threadId: "unrelated",
      kind: "memo",
      status: "collecting",
      createdAt: 1,
    });
    for (let i = 0; i < 34; i++)
      await ctx.db.insert("vaultDocuments", {
        tenantId: userId,
        title: "Unrelated",
        kind: "document",
        category: "created",
        source: "agent",
        mimeType: "text/plain",
        contentHash: "unrelated",
        size: 1,
        status: "ready",
        createdAt: 1,
      });
  });
  const ownPlan = await t.run((ctx) =>
    ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", userId).eq("threadId", threadId))
      .first(),
  );
  if (!ownPlan) throw new Error("missing own plan");
  await t.run((ctx) => ctx.db.patch(ownPlan._id, { kind: "memo" }));
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "GRAPH_NOT_SETTLED",
  );
  await t.run((ctx) => ctx.db.patch(ownPlan._id, { kind: undefined }));
  await expect(
    t.mutation(internal.guardrails.closeEvalBudget, { budgetId }),
  ).resolves.toMatchObject({ closed: true });
  await expect(
    owner.action(api.cockpit.startWorkflowPack, {
      threadId,
      packId: "research",
      text: "After closure",
    }),
  ).rejects.toThrow("ALTERNATE_ENTRY_REFUSED");
});

test("supported nested text drafter consumes the same aggregate envelope", async () => {
  const { t, owner, userId, threadId, budgetId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId: userId,
      refreshToken: "offline-test-not-a-real-token",
      scope: "test",
      updatedAt: 1,
    }),
  );
  seam.steps = [
    tool("draftBody", { intent: "Write a short hello." }),
    result([
      { type: "text", text: JSON.stringify({ subject: "Hello", body: "Hello from the test." }) },
    ]),
    text(),
  ];
  await owner.action(api.cockpit.sendCockpitMessage, {
    threadId,
    text: "Draft an email saying hello.",
  });
  expect(seam.calls).toBe(3);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    callCount: 3,
    settledCount: 3,
    actualUsd: 0.003,
  });
  expect(await t.query(internal.authoringProbe.inspect, { budgetId })).toMatchObject({
    containmentRefusals: 0,
    finished: 1,
  });
});

test("native registration requires an existing owner; two serialized turn slots never replenish", async () => {
  const { t, userId, foreignId, threadId, budgetId } = await setup();
  await expect(
    t.mutation(internal.authoringProbe.prepare, {
      userId: foreignId,
      capCents: 100,
      authorizationSha256: "b".repeat(64),
    }),
  ).rejects.toThrow("OWNER_REQUIRED");
  await expect(
    t.mutation(internal.authoringProbe.prepare, {
      userId,
      capCents: 100,
      authorizationSha256: "a".repeat(64),
    }),
  ).rejects.toThrow("ALREADY_REGISTERED");
  const first = "00000000-0000-4000-8000-000000000001",
    second = "00000000-0000-4000-8000-000000000002";
  const claims = await Promise.allSettled(
    [first, second].map((turnId) =>
      t.mutation(internal.authoringProbe.claimTurn, { tenantId: userId, threadId, turnId }),
    ),
  );
  expect(claims.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winning = claims[0]?.status === "fulfilled" ? first : second;
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "TURN_UNRESOLVED",
  );
  await t.mutation(internal.authoringProbe.finishTurn, {
    tenantId: userId,
    budgetId,
    turnId: winning,
    failed: false,
  });
  const next = "00000000-0000-4000-8000-000000000003";
  await t.mutation(internal.authoringProbe.claimTurn, { tenantId: userId, threadId, turnId: next });
  await t.mutation(internal.authoringProbe.finishTurn, {
    tenantId: userId,
    budgetId,
    turnId: next,
    failed: false,
  });
  await expect(
    t.mutation(internal.authoringProbe.claimTurn, {
      tenantId: userId,
      threadId,
      turnId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("TURN_LIMIT");
  await t.mutation(internal.guardrails.closeEvalBudget, { budgetId });
  await expect(
    t.mutation(internal.authoringProbe.claimTurn, {
      tenantId: userId,
      threadId,
      turnId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("CLOSED");
  expect(seam.calls).toBe(0);
});

test("ordinary authenticated UI authors one inert candidate under the native envelope; containment is separately visible", async () => {
  const { t, owner, userId, foreignId, threadId, budgetId } = await setup();
  seam.steps = [
    tool("authorSkillCandidate", {
      name: AGENT_AUTHORABLE_SKILLS[0],
      authoredBody: "Use concise three-item recommendations for this synthetic business.",
    }),
    text(),
    tool("evaluateBusiness", {}),
    text(),
  ];
  await expect(
    t
      .withIdentity({ subject: foreignId })
      .action(api.cockpit.sendCockpitMessage, { threadId, text: "Foreign request" }),
  ).rejects.toThrow();
  expect(seam.calls).toBe(0);
  await owner.action(api.cockpit.sendCockpitMessage, {
    threadId,
    text: "Save one inert adaptation for review.",
  });
  const candidates = await t.run((ctx) =>
    ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant", (q) => q.eq("tenantId", userId))
      .collect(),
  );
  expect(candidates.filter((c) => c.author === "agent" && c.status === "candidate")).toHaveLength(
    1,
  );
  await owner.action(api.cockpit.sendCockpitMessage, { threadId, text: "Attempt another action." });
  expect(await t.query(internal.authoringProbe.inspect, { budgetId })).toMatchObject({
    started: 2,
    finished: 2,
    containmentRefusals: 1,
    policyAcceptanceEstablished: false,
  });
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    callCount: 4,
    settledCount: 4,
    actualUsd: 0.004,
    unsettledCount: 0,
  });
  await expect(
    owner.action(api.cockpit.sendCockpitMessage, { threadId, text: "Third request" }),
  ).rejects.toThrow("TURN_LIMIT");
  expect(seam.calls).toBe(4);
});

test("too-small aggregate cap prevents the provider call and unknown usage retains its hold", async () => {
  const { t, owner, threadId, budgetId } = await setup(1);
  seam.steps = [text()];
  await owner.action(api.cockpit.sendCockpitMessage, { threadId, text: "Save a draft." });
  expect(seam.calls).toBe(0);
  expect(await t.query(internal.authoringProbe.inspect, { budgetId })).toMatchObject({ failed: 1 });
  const fresh = await setup();
  seam.steps = [result([{ type: "text", text: "Unknown cost." }], "stop", false)];
  await fresh.owner.action(api.cockpit.sendCockpitMessage, {
    threadId: fresh.threadId,
    text: "Save a draft.",
  });
  expect(
    await fresh.t.query(internal.guardrails.evalBudgetStatus, { budgetId: fresh.budgetId }),
  ).toMatchObject({ unsettledCount: 1 });
  await expect(
    fresh.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: fresh.budgetId }),
  ).rejects.toThrow("NOT_SETTLED");
  await expect(
    fresh.owner.action(api.cockpit.sendCockpitMessage, {
      threadId: fresh.threadId,
      text: "Continue",
    }),
  ).rejects.toThrow("PROVIDER_UNRESOLVED");
});

test("ambiguous primary response retains its hold without fallback or another root turn", async () => {
  const { t, owner, threadId, budgetId } = await setup();
  const timeout = new Error("Synthetic timeout");
  timeout.name = "TimeoutError";
  seam.steps = [timeout, text()];
  await owner.action(api.cockpit.sendCockpitMessage, { threadId, text: "Save an adaptation." });
  expect(seam.calls).toBe(1);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    callCount: 1,
    settledCount: 0,
    unsettledCount: 1,
  });
  await expect(
    owner.action(api.cockpit.sendCockpitMessage, { threadId, text: "Continue" }),
  ).rejects.toThrow("PROVIDER_UNRESOLVED");
});
