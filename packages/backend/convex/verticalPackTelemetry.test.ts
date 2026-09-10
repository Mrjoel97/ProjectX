import { verticalSkillName } from "@pikar/core/verticalPacks";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

test("closed vertical event boundary rejects prose, malformed counts and cross-tenant refs", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const candidateId = await t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId: "a",
      name: verticalSkillName("legal"),
      version: 1,
      status: "candidate",
      rollbackEligible: false,
      body: "Private person's clause",
      authoredBody: "",
      author: "system",
      basedOnScope: "global",
      basedOnName: verticalSkillName("legal"),
      basedOnVersion: 1,
      createdAt: 1,
    }),
  );
  const args = {
    tenantId: "a",
    candidateId,
    verticalId: "legal" as const,
    event: "blocked" as const,
    reason: "not_released" as const,
  };
  await t.mutation(internal.verticalPackTelemetry.record, args);
  for (const extra of [
    { prompt: "Private person's clause" },
    { claimCount: -1 },
    { claimCount: NaN },
    { claimCount: 1, citedClaimCount: 2 },
    { reason: "alice@example.com" },
    { costBucket: "account balance 450" },
  ])
    await expect(
      t.mutation(internal.verticalPackTelemetry.record, { ...args, ...extra } as never),
    ).rejects.toThrow();
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, { ...args, tenantId: "b" }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    t.mutation(internal.verticalPackTelemetry.record, { ...args, verticalId: "hr" }),
  ).rejects.toThrow("NOT_FOUND");
  const rows = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toEqual({
    candidateId,
    verticalId: "legal",
    event: "blocked",
    reason: "not_released",
  });
  expect(JSON.stringify(rows)).not.toContain("Private person's clause");
  expect(
    (await t.withIdentity({ subject: "a" }).query(api.verticalPackTelemetry.summary, {}))
      .sampledEvents,
  ).toBe(1);
  expect(
    (await t.withIdentity({ subject: "b" }).query(api.verticalPackTelemetry.summary, {}))
      .sampledEvents,
  ).toBe(0);
});

test("aggregate samples are bounded and mark truncation without exposing payloads", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("audit", {
        tenantId: "a",
        correlationId: "seed",
        eventType: "vertical_pack.outcome",
        actor: "system",
        ts: i,
        payload: { event: "blocked", verticalId: "legal" },
      });
    await ctx.db.insert("audit", {
      tenantId: "b",
      correlationId: "seed",
      eventType: "vertical_pack.outcome",
      actor: "system",
      ts: 999,
      payload: { event: "run_completed", verticalId: "hr" },
    });
  });
  const summary = await t
    .withIdentity({ subject: "a" })
    .query(api.verticalPackTelemetry.summary, {});
  expect(summary).toMatchObject({
    partial: true,
    sampledEvents: 200,
    counts: { blocked: 200, run_completed: 0 },
  });
  expect(Object.keys(summary).sort()).toEqual(["counts", "partial", "sampledEvents"]);
});
