// The governed sub-agent dispatcher (DISP-01).
//
// Wave 0 (15-01): the anti-silent-failure guard, and nothing else. 15-03 fills this file with the
// real dispatch suite (depth cap, cycle refusal, envelope, lineage, two-tenant isolation).
//
// WHY this one assertion earns its place: the `agentSteps.tool` union is CLOSED, and the step row
// is inserted from inside an SDK tool callback. A missing literal throws there — and the SDK
// SWALLOWS it. Prod gets a blank activity card while every other test in this repo stays green
// (the searchVault / evaluateBusiness comments in schema.ts warn about exactly this). The only
// thing that catches it is an insert of each literal against the REAL schema.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const DISPATCH_STEP_TOOLS = [
  "dispatchOfferArchitect",
  "dispatchMoneyModelDesigner",
  "dispatchLeadEngine",
] as const;

test.each(DISPATCH_STEP_TOOLS)("agentSteps accepts the %s literal", async (tool) => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) =>
    ctx.db.insert("agentSteps", {
      tenantId: "tenant_a",
      threadId: "th",
      turnId: "turn",
      stepKey: `k_${tool}`,
      tool,
      phase: "running",
      startedAt: Date.now(),
    }),
  );
  // The insert not throwing IS the assertion; read it back so the test cannot pass vacuously
  // if `insert` ever stops validating.
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ tool, phase: "running" });
});
