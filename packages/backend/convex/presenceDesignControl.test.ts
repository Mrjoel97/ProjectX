import { sha256Bytes } from "@pikar/core/webRuntime";
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

async function recoverySetup(
  options: {
    project?: boolean;
    uncertain?: boolean;
    duplicateGeneration?: boolean;
    workflow?: boolean;
  } = {},
) {
  const { t, args } = await setup();
  const sourceFingerprint = sha256Bytes(
    new TextEncoder().encode(JSON.stringify([{ ref: "source", revision: "source-v1" }])),
  );
  await t.mutation(fn("claim"), { ...args, workflow: options.workflow ?? true, sourceFingerprint });
  const attempt = (payload: Record<string, string | number | boolean>) =>
    t.mutation(fn("attempt"), { ...args, payload });
  if (options.project !== false) await attempt({ projectRef: "projects/owned_project" });
  await attempt({ provider: "stitch", operation: "generate_screen_from_text" });
  if (options.duplicateGeneration)
    await attempt({ provider: "stitch", operation: "generate_screen_from_text" });
  await attempt({
    provider: "stitch",
    operation: "generate_screen_from_text",
    outcome: "complete",
  });
  await attempt({
    stopped: true,
    reconciliationRequired: options.uncertain ?? true,
    phase: "claimed",
  });
  return { t, args, attempt };
}

test("Stitch recovery returns null before any run and grants one owned read-only recovery", async () => {
  const fresh = await setup();
  expect(await fresh.t.mutation(fn("claimStitchRecovery"), fresh.args)).toBeNull();
  const { t, args } = await recoverySetup();
  expect(await t.mutation(fn("claimStitchRecovery"), args)).toEqual({
    projectName: "projects/owned_project",
  });
  const audits = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(audits.filter((row) => row.payload.recoveryClaimed === true)).toHaveLength(1);
  await expect(t.mutation(fn("claimStitchRecovery"), args)).rejects.toThrow("RECOVERY_UNAVAILABLE");
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});

test.each([
  { project: false },
  { uncertain: false },
  { duplicateGeneration: true },
  { workflow: false },
])("Stitch recovery rejects an unproven provider history: %j", async (options) => {
  const { t, args } = await recoverySetup(options);
  await expect(t.mutation(fn("claimStitchRecovery"), args)).rejects.toThrow("RECOVERY_UNAVAILABLE");
  const audits = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(audits.some((row) => row.payload.recoveryClaimed === true)).toBe(false);
});

test("Stitch recovery rejects foreign tenants, stale revision and changed sources", async () => {
  const { t, args } = await recoverySetup();
  await expect(
    t.mutation(fn("claimStitchRecovery"), { ...args, tenantId: "foreign" }),
  ).rejects.toThrow("UNAVAILABLE");
  await expect(t.mutation(fn("claimStitchRecovery"), { ...args, revision: 2 })).rejects.toThrow(
    "CONTEXT_CHANGED",
  );
  await t.run(async (ctx) => {
    const session = await ctx.db.query("onlinePresenceSessions").first();
    await ctx.db.patch(session!._id, { sourceSnapshots: [{ ref: "source", revision: "changed" }] });
  });
  await expect(t.mutation(fn("claimStitchRecovery"), args)).rejects.toThrow("RECOVERY_UNAVAILABLE");
});

test("Stitch recovery refuses competing projects and completed provider phases", async () => {
  const competing = await recoverySetup();
  await competing.attempt({ projectRef: "projects/other_project" });
  await competing.attempt({ stopped: true, reconciliationRequired: true, phase: "claimed" });
  await expect(competing.t.mutation(fn("claimStitchRecovery"), competing.args)).rejects.toThrow(
    "RECOVERY_UNAVAILABLE",
  );
  const advanced = await recoverySetup();
  await advanced.t.mutation(fn("advance"), {
    ...advanced.args,
    phase: "stitch_complete",
    designHash: "b".repeat(64),
  });
  await expect(advanced.t.mutation(fn("claimStitchRecovery"), advanced.args)).rejects.toThrow(
    "RECOVERY_UNAVAILABLE",
  );
});
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
