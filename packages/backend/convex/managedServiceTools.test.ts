// @vitest-environment node
import { grantsFor } from "@pikar/core";
import { getFunctionName } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { buildCockpitTools, type ToolContext } from "./llm";
import { buildManagedServiceTools } from "./managedServiceTools";

function fixture(userId: string | null = "tenant-a") {
  const config = {
    revision: 3,
    controlRevision: 4,
    goal: "Prepare my selected social channels",
    controlState: "active",
    readiness: { ready: true, reasons: [] },
  };
  const keys = new Set<string>();
  const brainState = { runId: "prior-run" };
  const runQuery = vi.fn(async (reference: unknown, _args: unknown) => {
    if (getFunctionName(reference as never) === "managedServices:status") return config;
    if (getFunctionName(reference as never) === "managedServiceRuns:list")
      return {
        items: [{ runId: "prior-run", state: "completed", threadId: "prior-thread" }],
        truncated: false,
      };
    if (getFunctionName(reference as never) === "serviceOutcomes:serviceBrainView")
      return {
        latestOutcome: {
          runId: brainState.runId,
          businessImprovement: "not_established",
          usefulness: "unreviewed",
        },
      };
    throw new Error("unexpected_query");
  });
  const runAction = vi.fn(async (reference: unknown, args: { requestKey: string }) => {
    expect(getFunctionName(reference as never)).toBe("managedServiceRuns:start");
    const existing = keys.has(args.requestKey);
    keys.add(args.requestKey);
    return { state: "running", existing, runId: "same-run", threadId: "new-thread" };
  });
  const ctx = {
    auth: {
      getUserIdentity: async () => (userId === null ? null : { subject: `${userId}|session` }),
    },
    runQuery,
    runAction,
  } as unknown as ActionCtx;
  const tools = buildManagedServiceTools(ctx, "tenant-a", "trusted-root-request");
  const execute = async (name: keyof typeof tools) => {
    const definition = tools[name];
    if (!definition?.execute) throw new Error("tool_absent");
    return definition.execute({}, { toolCallId: name, messages: [], context: {} });
  };
  return { ctx, tools, execute, runQuery, runAction, config, brainState };
}
describe("attended Executive service access", () => {
  test("separate native reads cannot attach a newer outcome to an older run", async () => {
    const h = fixture();
    h.brainState.runId = "newer-run";
    expect(await h.execute("readSocialService")).toMatchObject({
      brain: { latestOutcome: { runId: "newer-run" } },
      latestRun: { runId: "prior-run", outcome: null },
    });
    expect(h.runAction).not.toHaveBeenCalled();
  });
  test("reads the owned saved setup and latest native run without starting work", async () => {
    const h = fixture();
    expect(await h.execute("readSocialService")).toMatchObject({
      state: "ready",
      goal: h.config.goal,
      latestRun: { state: "completed", workspacePath: "/dashboard/workspace?thread=prior-thread" },
    });
    expect(h.runAction).not.toHaveBeenCalled();
    expect(h.runQuery.mock.calls.map(([reference]) => getFunctionName(reference as never))).toEqual(
      ["managedServices:status", "managedServiceRuns:list", "serviceOutcomes:serviceBrainView"],
    );
    expect(
      h.runQuery.mock.calls
        .slice(0, 2)
        .every(
          ([, args]) => JSON.stringify(args) === JSON.stringify({ serviceId: "social-marketing" }),
        ),
    ).toBe(true);
    expect(h.runQuery.mock.calls[2]?.[1]).toEqual({ serviceId: "social-marketing" });
  });
  test("uses the same public start action and stable trusted-root key with no model-owned authority", async () => {
    const h = fixture();
    expect(await h.execute("startSocialService")).toMatchObject({
      state: "running",
      existing: false,
      workspacePath: "/dashboard/workspace?thread=new-thread",
      publicationRequiresReview: true,
    });
    expect(await h.execute("startSocialService")).toMatchObject({
      state: "running",
      existing: true,
    });
    const first = h.runAction.mock.calls[0]?.[1];
    const second = h.runAction.mock.calls[1]?.[1];
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      serviceId: "social-marketing",
      expectedRevision: 3,
      expectedControlRevision: 4,
      requestKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "expectedControlRevision",
      "expectedRevision",
      "requestKey",
      "serviceId",
    ]);
  });
  test("unauthenticated or mismatched internal contexts cannot use an operator fallback", async () => {
    for (const userId of [null, "tenant-b"]) {
      const h = fixture(userId);
      await expect(h.execute("readSocialService")).rejects.toThrow(
        "SERVICE_AUTHENTICATION_REQUIRED",
      );
      await expect(h.execute("startSocialService")).rejects.toThrow(
        "SERVICE_AUTHENTICATION_REQUIRED",
      );
      expect(h.runQuery).not.toHaveBeenCalled();
      expect(h.runAction).not.toHaveBeenCalled();
    }
  });
  test("specialists, evaluation budgets, deterministic drivers and service turns cannot recurse", () => {
    const h = fixture();
    const base: ToolContext = {
      ctx: h.ctx,
      tenantId: "tenant-a",
      planId: "plan" as never,
      threadId: "thread",
      rootRequestId: "root",
      attendedServiceAccess: true,
    };
    expect(buildCockpitTools(base, grantsFor({}))).toHaveProperty("startSocialService");
    for (const context of [
      { ...base, evalBudgetId: "budget" as never },
      { ...base, attendedServiceAccess: false },
      { ...base, threadId: undefined },
      {
        ...base,
        managedServiceRunId: "run" as never,
        managedServiceScope: { operationIds: ["social.report" as const], accounts: [], skills: [] },
      },
    ]) {
      const tools = buildCockpitTools(context, grantsFor({}));
      expect(tools).not.toHaveProperty("readSocialService");
      expect(tools).not.toHaveProperty("startSocialService");
    }
    expect(
      buildCockpitTools(base, grantsFor({ toolNames: ["startSocialService"] })),
    ).not.toHaveProperty("startSocialService");
  });
});
