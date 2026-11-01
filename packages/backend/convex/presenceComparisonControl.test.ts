import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { COMPARISON_NAMESPACE } from "./presenceComparisonControl";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const fn = (name: string) => makeFunctionReference<"mutation">(`presenceComparisonControl:${name}`);
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}
beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://third-gecko-977.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://third-gecko-977.convex.site");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("operator comparison control", () => {
  test("prepare creates and reuses only its candidate; it never activates or alters existing skills", async () => {
    const t = harness();
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "existing-production-skill",
        version: 7,
        body: "Existing body",
        status: "active",
        createdAt: 1,
      }),
    );
    const first = await t.mutation(fn("prepare"), {}),
      second = await t.mutation(fn("prepare"), {});
    expect(first).toEqual(second);
    expect(first.candidateOnly).toBe(true);
    const skills = await t.run((ctx) => ctx.db.query("skills").collect());
    expect(skills).toHaveLength(2);
    expect(skills.find((skill) => skill.name === "website-design-proposal")).toMatchObject({
      status: "candidate",
      version: 1,
    });
    expect(skills.find((skill) => skill.name === "existing-production-skill")).toMatchObject({
      status: "active",
      version: 7,
      body: "Existing body",
    });
  });
  test("a claim is one-use and concurrent callers cannot open a second global run", async () => {
    const t = harness();
    const results = await Promise.allSettled([
      t.mutation(fn("claim"), { runRef: "ab12cd34" }),
      t.mutation(fn("claim"), { runRef: "de56fa78" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const claimed = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .withIndex("by_tenant_ts", (q) => q.eq("tenantId", COMPARISON_NAMESPACE))
        .collect(),
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.payload).toMatchObject({ capCents: 450 });
    const runRef = claimed[0]!.correlationId.split(":")[1]!;
    await t.mutation(fn("record"), {
      runRef,
      event: "stopped",
      payload: { outputCount: 0, reconciliationRequired: false },
    });
    await expect(t.mutation(fn("claim"), { runRef })).rejects.toThrow("ALREADY_CLAIMED");
  });
  test("unknown provider state remains an open claim even when it incurred no monetary hold", async () => {
    const t = harness();
    await t.mutation(fn("claim"), { runRef: "ab12cd34" });
    await t.mutation(fn("record"), {
      runRef: "ab12cd34",
      event: "opened",
      payload: {
        providerRef: "stitch",
        reconciliationRequired: true,
        outcome: "unknown",
        outputCount: 2,
      },
    });
    await expect(t.mutation(fn("claim"), { runRef: "de56fa78" })).rejects.toThrow("PRIOR_RUN_OPEN");
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
    const events = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .withIndex("by_tenant_ts", (q) => q.eq("tenantId", COMPARISON_NAMESPACE))
        .collect(),
    );
    expect(
      events.some(
        (event) =>
          event.eventType === "presence_comparison.completed" ||
          event.eventType === "presence_comparison.stopped",
      ),
    ).toBe(false);
  });
  test("the original five-dollar authority includes prior actual spending before a new 450-cent envelope", async () => {
    const t = harness();
    await t.run((ctx) =>
      ctx.db.insert("spendEvents", {
        tenantId: "historical-native",
        rail: "reasoning",
        phase: "actual",
        amountCents: 51,
        evalActualUsd: 0.51,
        correlationId: "prior-authorized-call",
        kind: "eval_model",
        createdAt: 1,
      }),
    );
    await expect(t.mutation(fn("claim"), { runRef: "ab12cd34" })).rejects.toThrow(
      "ORIGINAL_TOTAL_EXHAUSTED",
    );
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });
  test("prior unknown money holds and unclosed envelopes refuse admission before any claim", async () => {
    for (const kind of ["hold", "envelope"]) {
      const t = harness();
      await t.run((ctx) =>
        ctx.db.insert("spendEvents", {
          tenantId: "historical-eval",
          rail: "reasoning",
          phase: kind === "hold" ? "reserved" : "estimated",
          amountCents: 450,
          correlationId: `prior-${kind}`,
          kind: kind === "hold" ? "eval_model" : "eval_envelope",
          createdAt: 1,
        }),
      );
      await expect(t.mutation(fn("claim"), { runRef: "ab12cd34" })).rejects.toThrow(
        kind === "hold" ? "PRIOR_HOLD" : "PRIOR_OPEN_BUDGET",
      );
      expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
    }
  });
  test("generic audit writes cannot forge comparison tenant, event or correlation evidence", async () => {
    const t = harness(),
      log = makeFunctionReference<"mutation">("audit:log");
    for (const patch of [
      { tenantId: COMPARISON_NAMESPACE },
      { eventType: "presence_comparison.completed" },
      { correlationId: "presence-comparison:ab12cd34" },
    ]) {
      await expect(
        t.mutation(log, {
          tenantId: "synthetic-other",
          eventType: "ordinary.event",
          correlationId: "ordinary-correlation",
          actor: "operator",
          payload: { outputCount: 3 },
          ...patch,
        }),
      ).rejects.toThrow("RESERVED_EVIDENCE_NAMESPACE");
    }
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });
  test("wrong deployment and invalid run references refuse without network or ledger writes", async () => {
    const t = harness(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(t.mutation(fn("claim"), { runRef: "arbitrary-customer" })).rejects.toThrow(
      "ID_INVALID",
    );
    vi.stubEnv("CONVEX_CLOUD_URL", "https://production.convex.cloud");
    await expect(t.mutation(fn("claim"), { runRef: "ab12cd34" })).rejects.toThrow(
      "DEDICATED_STAGE_REQUIRED",
    );
    await expect(t.mutation(fn("prepare"), {})).rejects.toThrow("DEDICATED_STAGE_REQUIRED");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });
});
