// The pulse layer's ONE read (living-map §3.1): tenant isolation + window math, over the
// dispatch trace (agentSteps) and the requests/plans content plane. Mirrors the harness
// idiom every convex test in this directory uses — a fresh `import.meta.glob` per file,
// no shared test.setup module exists in this codebase.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const seedStep = (tenantId: string, over: Record<string, unknown> = {}) => ({
  tenantId,
  threadId: "th1",
  turnId: "turn1",
  stepKey: `k${Math.random()}`,
  tool: "dispatchOfferArchitect" as const,
  phase: "done" as const,
  startedAt: NOW - 10 * MIN,
  endedAt: NOW - 5 * MIN,
  durationMs: 5 * MIN,
  ...over,
});

describe("blueprintPulse", () => {
  it("aggregates my dispatch steps and never a sibling tenant's", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("agentSteps", seedStep("tenantA"));
      await ctx.db.insert(
        "agentSteps",
        seedStep("tenantA", {
          phase: "running",
          startedAt: NOW - MIN,
          endedAt: undefined,
          durationMs: undefined,
        }),
      );
      await ctx.db.insert("agentSteps", seedStep("tenantB"));
    });
    const asA = t.withIdentity({ subject: "tenantA|s" });
    const out = await asA.query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.segments.offer?.runs30d).toBe(1);
    expect(out.segments.offer?.inFlight).toBe(1);
    expect(out.segments["money-model"]?.runs30d).toBe(0);
  });

  it("counts sent requests and done/in-flight plans tenant-wide", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("requests", {
        tenantId: "tenantA",
        correlationId: "c1",
        goal: "g",
        recipient: "r@x.com",
        status: "sent",
        attachmentRefs: [],
        createdAt: NOW - 10 * MIN,
      });
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "th1",
        status: "done",
        createdAt: NOW - 10 * MIN,
      });
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "th2",
        status: "collecting",
        createdAt: NOW - MIN,
      });
      await ctx.db.insert("plans", {
        tenantId: "tenantB",
        threadId: "th3",
        status: "done",
        createdAt: NOW - MIN,
      });
    });
    const asA = t.withIdentity({ subject: "tenantA|s" });
    const out = await asA.query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.globals).toEqual({ sent30d: 1, plansDone30d: 1, plansInFlight: 1 });
  });
});
