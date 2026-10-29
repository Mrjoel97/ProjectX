import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  const tenantId = "customer-website";
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId, threadId: "website" });
  const session = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    planId,
    threadId: "website",
    text: "Build my business website",
  });
  return {
    t,
    args: {
      tenantId,
      model: "or/moonshotai/kimi-k3.1-pro",
      callId: crypto.randomUUID(),
      ceilingCents: 428,
      websiteDesign: { planId, revision: session.revision, runRef: "abc12345abc12345" },
    },
  };
}
test("ordinary tenant website call preserves unknown hold across new run identities", async () => {
  const { t, args } = await setup();
  const id = await t.mutation(internal.guardrails.reservePaidCall, args);
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).toMatchObject({ tenantId: "customer-website", amountCents: 428, phase: "reserved" });
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, {
      ...args,
      callId: crypto.randomUUID(),
      websiteDesign: { ...args.websiteDesign, runRef: "abc12345abc12346" },
    }),
  ).rejects.toThrow("PRIOR_HOLD");
  await t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: args.tenantId,
    reservationId: id,
    costUsd: 0.04,
  });
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, callId: crypto.randomUUID() }),
  ).resolves.toBeTruthy();
});
test("wrong tenant, stale revision, under-reservation and unscoped Kimi refuse", async () => {
  const { t, args } = await setup();
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, tenantId: "other" }),
  ).rejects.toThrow("CONTEXT_CHANGED");
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, {
      ...args,
      websiteDesign: { ...args.websiteDesign, revision: args.websiteDesign.revision + 1 },
    }),
  ).rejects.toThrow("CONTEXT_CHANGED");
  await expect(
    t.mutation(internal.guardrails.reservePaidCall, { ...args, ceilingCents: 1 }),
  ).rejects.toThrow("ADMISSION_INVALID");
  const { websiteDesign: _scope, ...unscoped } = args;
  await expect(t.mutation(internal.guardrails.reservePaidCall, unscoped)).rejects.toThrow(
    "MODEL_SCOPE_INVALID",
  );
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});
