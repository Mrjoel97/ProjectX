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
      // 43-01b: `kind: "memo"` is what makes this row WORK rather than an empty chat. It had no
      // kind and no content, which is precisely the shape `holdsWork` now excludes — the fixture
      // was asserting the defect.
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "th2",
        status: "collecting",
        kind: "memo",
        createdAt: NOW - MIN,
      });
      // The shell `cockpit.ensureThreadAndPlan` mints for EVERY thread. It never leaves
      // `collecting`, so before 43-01b the count grew by one per conversation, for ever.
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "th4",
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

  it("a fan-out is ONE plan in flight, not one per worker", async () => {
    // 43-01. Before Phase 42 a thread held exactly one `plans` row, so counting rows and counting
    // work were the same thing. A fan-out now mints a root plus up to MAX_FAN_OUT children, all
    // `collecting` while their workers run — so this user-visible number inflated by up to 16x for
    // the duration of one dispatch. A child is a WORKER; the root already represents the team.
    // MUTATION that turns this red: drop `.filter(isRoot)` in blueprint.ts.
    const t = convexTest(schema, modules);
    const root = await t.run(async (ctx) => {
      const id = await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "team",
        status: "collecting",
        kind: "memo",
        createdAt: NOW - MIN,
      });
      for (let i = 0; i < 5; i++)
        await ctx.db.insert("plans", {
          tenantId: "tenantA",
          threadId: "team",
          parentPlanId: id,
          status: "collecting",
          kind: "memo",
          createdAt: NOW - MIN,
        });
      return id;
    });
    expect(root).toBeTruthy();

    const out = await t
      .withIdentity({ subject: "tenantA|s" })
      .query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.globals.plansInFlight).toBe(1);
  });

  it("an abandoned chat is not a plan in motion, but a half-composed email is", async () => {
    // 43-01b. BOTH halves matter and the second is the one that is easy to lose. `kind` ABSENT
    // means EMAIL (schema.ts), so a kind-only test would have dropped the row on this table a user
    // is most likely to be actively working in — the exact over-correction this pins against.
    // MUTATION that turns this red: `holdsWork = (p) => p.kind !== undefined`.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Three bare shells: three conversations someone asked a question in and walked away from.
      for (const threadId of ["c1", "c2", "c3"])
        await ctx.db.insert("plans", {
          tenantId: "tenantA",
          threadId,
          status: "collecting",
          createdAt: NOW - MIN,
        });
      // A half-composed email: no kind, but the user has typed into it.
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "c4",
        status: "collecting",
        subject: "Following up on our call",
        createdAt: NOW - MIN,
      });
    });

    const out = await t
      .withIdentity({ subject: "tenantA|s" })
      .query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.globals.plansInFlight).toBe(1);
  });

  it("the in-flight count is windowed like the two figures it is printed beside", async () => {
    // 43-01b. ADR-037 ended row recycling, so `proposed` accumulates for the life of the tenant and
    // an unbounded `.collect()` here would eventually breach the 8MiB query ceiling and throw the
    // whole Blueprint panel — this is a live `useQuery`. The window is also the honest reading: the
    // sentence already carried two 30-day figures beside this one.
    // MUTATION that turns this red: drop `.gt("createdAt", since)` from the in-flight loop.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "fresh",
        status: "proposed",
        kind: "memo",
        createdAt: NOW - MIN,
      });
      await ctx.db.insert("plans", {
        tenantId: "tenantA",
        threadId: "ancient",
        status: "proposed",
        kind: "memo",
        createdAt: NOW - 400 * 24 * 60 * MIN,
      });
    });

    const out = await t
      .withIdentity({ subject: "tenantA|s" })
      .query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.globals.plansInFlight).toBe(1);
  });
});
