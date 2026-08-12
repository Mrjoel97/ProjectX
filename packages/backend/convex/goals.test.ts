// Mirrors the harness idiom every convex test in this directory uses — a fresh
// `import.meta.glob` per file, no shared test.setup module exists in this codebase
// (see blueprintPulse.test.ts). No `/// <reference types="vite/client" />`: no other
// convex/*.test.ts in this repo carries it and `import.meta.glob` typechecks fine without it.
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
// `addGoal`/`setGoalStatus` write `internal.audit.log`, which maintains the auditCounts
// aggregate (audit.ts:40) — the component must be registered or the real insert path throws
// `Component "auditCounts" is not registered". Same idiom as audit.test.ts/blueprint.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const makeTest = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
};

describe("goals", () => {
  it("adds a goal, lists it, and never leaks a sibling tenant's", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("goals", {
        tenantId: "tenantB",
        segmentId: "offer",
        text: "tenantB's goal",
        status: "active",
        createdAt: Date.now(),
        statusChangedAt: Date.now(),
      });
    });
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    const { id } = await asA.mutation(api.goals.addGoal, {
      segmentId: "offer",
      text: "Ship the new pricing page",
    });
    const goals = await asA.query(api.goals.listGoals, {});
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ id, segmentId: "offer", text: "Ship the new pricing page" });
  });

  it("rejects an unknown segmentId", async () => {
    const t = makeTest();
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    await expect(
      asA.mutation(api.goals.addGoal, { segmentId: "nope", text: "Whatever" }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects a second level of nesting", async () => {
    const t = makeTest();
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    const { id: parentId } = await asA.mutation(api.goals.addGoal, {
      segmentId: "offer",
      text: "Parent goal",
    });
    const { id: childId } = await asA.mutation(api.goals.addGoal, {
      segmentId: "offer",
      text: "Child goal",
      parentId,
    });
    await expect(
      asA.mutation(api.goals.addGoal, {
        segmentId: "offer",
        text: "Grandchild goal",
        parentId: childId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("stamps statusChangedAt on transition so cycle time is measurable", async () => {
    const t = makeTest();
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    const { id } = await asA.mutation(api.goals.addGoal, {
      segmentId: "offer",
      text: "Close the pilot",
    });
    const before = Date.now();
    const result = await asA.mutation(api.goals.setGoalStatus, { id, status: "achieved" });
    expect(result).toEqual({ ok: true });
    const goals = await asA.query(api.goals.listGoals, {});
    const goal = goals.find((g) => g.id === id);
    expect(goal?.status).toBe("achieved");
    expect(goal?.statusChangedAt).toBeGreaterThanOrEqual(goal?.createdAt ?? 0);
    expect(goal?.statusChangedAt).toBeGreaterThanOrEqual(before);
  });

  it("cannot touch another tenant's goal", async () => {
    const t = makeTest();
    const asB = t.withIdentity({ subject: "tenantB|s", issuer: "test" });
    const { id } = await asB.mutation(api.goals.addGoal, {
      segmentId: "offer",
      text: "tenantB's goal",
    });
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    await expect(asA.mutation(api.goals.setGoalStatus, { id, status: "achieved" })).rejects.toThrow(
      ConvexError,
    );
  });

  it("cannot nest a goal under another tenant's goal", async () => {
    const t = makeTest();
    const asB = t.withIdentity({ subject: "tenantB|s", issuer: "test" });
    const { id: parentId } = await asB.mutation(api.goals.addGoal, {
      segmentId: "offer",
      text: "tenantB's goal",
    });
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    await expect(
      asA.mutation(api.goals.addGoal, {
        segmentId: "offer",
        text: "tenantA's child goal",
        parentId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
