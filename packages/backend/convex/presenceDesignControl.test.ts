import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const fn = (name: string) => makeFunctionReference<"mutation">(`presenceDesignControl:${name}`);
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: "required-design",
  });
  await t.run((ctx) =>
    ctx.db.insert("onlinePresenceSessions", {
      tenantId,
      planId,
      threadId: "required-design",
      revision: 1,
      humanMessages: [],
      brief: { businessName: "Fieldwork" },
      sourceSnapshots: [{ ref: "source", revision: "source-v1" }],
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return { t, args: { tenantId, planId, revision: 1, runRef: "a".repeat(16) } };
}
afterEach(() => vi.unstubAllEnvs());
test("durable claim is owned and one-use; both provider stages required", async () => {
  const { t, args } = await setup();
  await expect(t.mutation(fn("claim"), { ...args, tenantId: "other" })).rejects.toThrow(
    "UNAVAILABLE",
  );
  const claim = await t.mutation(fn("claim"), args);
  expect(claim.spendingAuthorized).toBe(false);
  await expect(t.mutation(fn("claim"), args)).rejects.toThrow("ALREADY_CLAIMED");
  await expect(t.mutation(fn("advance"), { ...args, phase: "kimi_complete" })).rejects.toThrow(
    "PHASE_INVALID",
  );
  await t.mutation(fn("advance"), {
    ...args,
    phase: "stitch_complete",
    designHash: "b".repeat(64),
  });
  const complete = {
    ...args,
    phase: "kimi_complete",
    designHash: "b".repeat(64),
    proposalHash: "c".repeat(64),
    documentHash: "d".repeat(64),
    artifactsHash: "e".repeat(64),
  };
  await expect(
    t.mutation(fn("advance"), { ...complete, designHash: "f".repeat(64) }),
  ).rejects.toThrow("REFERENCE_CHANGED");
  expect(await t.mutation(fn("advance"), complete)).toEqual({
    candidateOnly: true,
    nativeBuildQualified: false,
    publicationAuthorized: false,
  });
  await expect(t.mutation(fn("advance"), complete)).rejects.toThrow("PHASE_INVALID");
});
test("a source or brief change invalidates pending evidence", async () => {
  const { t, args } = await setup();
  await t.mutation(fn("claim"), args);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("onlinePresenceSessions").first();
    await ctx.db.patch(row!._id, { brief: { businessName: "Changed" } });
  });
  await expect(
    t.mutation(fn("advance"), { ...args, phase: "stitch_complete", designHash: "b".repeat(64) }),
  ).rejects.toThrow("CONTEXT_CHANGED");
  expect(await t.mutation(fn("advance"), { ...args, phase: "stopped" })).toMatchObject({
    candidateOnly: true,
  });
});
test("generic audit writer cannot forge required provider evidence", async () => {
  const { t, args } = await setup();
  await expect(
    t.mutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: "presence-design:any",
      eventType: "presence_design.claimed",
      actor: "presence-design-control",
      payload: {},
    }),
  ).rejects.toThrow("RESERVED_EVIDENCE_NAMESPACE");
});
test("concrete staging action refuses real tenant billing before any provider call", async () => {
  const { t, args } = await setup();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://third-gecko-977.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://third-gecko-977.convex.site");
  await expect(
    t.action(makeFunctionReference<"action">("presenceRequiredRun:run"), {
      tenantId: args.tenantId,
      planId: args.planId,
      expectedRevision: 1,
      runRef: "a".repeat(8),
      billingBasis: "operator_confirmed_included_free_credits_no_paid_overage",
    }),
  ).rejects.toThrow("FIXTURE_TENANT_ONLY");
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});
