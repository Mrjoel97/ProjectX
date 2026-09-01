import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REVENUE_EVENT_KINDS } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { REVENUE_COUNT_MAX } from "./revenueTelemetry";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const base = {
  tenantId: "tenant-a",
  packId: "revenue" as const,
  runId: "rev:run-1",
  event: "connector_read" as const,
  provider: "quickbooks" as const,
  status: "partial" as const,
  sourceExpectedCount: 4,
  sourceAvailableCount: 3,
  itemCount: 12,
  pageCount: 2,
  retryCount: 1,
  capped: false,
  partial: true,
  coverage: "partial" as const,
};

function leaves(value: unknown, path = "$):"): { path: string; value: unknown }[] {
  if (value === null || typeof value !== "object") return [{ path, value }];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    leaves(nested, `${path}.${key}`),
  );
}

describe("Phase 28 revenue telemetry uses the shared workflowPackEvents plane", () => {
  test("the exact closed Phase 28 vocabulary is accepted by the landed recorder", async () => {
    expect(REVENUE_EVENT_KINDS).toEqual([
      "connector_lifecycle",
      "connector_read",
      "workflow_completed",
      "finance_computed",
      "reminder_staged",
      "plan_decided",
      "recovery_observed",
    ]);

    const t = convexTest(schema, modules);
    for (const [index, event] of REVENUE_EVENT_KINDS.entries()) {
      const common = {
        tenantId: base.tenantId,
        packId: base.packId,
        runId: `rev:event-${index}`,
        event,
      };
      await t.mutation(internal.workflowPackEventLog.record, {
        ...common,
        ...(event === "connector_lifecycle"
          ? { provider: "hubspot" as const, status: "connected" as const }
          : {}),
        ...(event === "connector_read" ? base : {}),
        ...(event === "workflow_completed"
          ? { workflow: "revenue-specialist" as const, outcome: "useful" as const }
          : {}),
        ...(event === "finance_computed"
          ? {
              workflow: "revenue-cash-flow" as const,
              coverage: "complete" as const,
              confidence: "high" as const,
            }
          : {}),
        ...(event === "reminder_staged"
          ? { workflow: "revenue-invoice-reminder" as const, itemCount: 2 }
          : {}),
        ...(event === "plan_decided" ? { status: "approved" as const } : {}),
        ...(event === "recovery_observed"
          ? {
              provider: "stripe" as const,
              status: "paid" as const,
              subjectRef: "rev:item-42",
              observedAt: 1_800_000_000_000,
            }
          : {}),
      });
    }

    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows).toHaveLength(REVENUE_EVENT_KINDS.length);
    expect(rows.map((row) => row.event)).toEqual(REVENUE_EVENT_KINDS);
  });

  test("duplicate terminal emission is idempotent per tenant, run and event", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.workflowPackEventLog.record, base);
    const duplicate = await t.mutation(internal.workflowPackEventLog.record, base);

    expect(duplicate).toBe(first);
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toHaveLength(1);
  });

  test("recovery requires a later provider observation, never a draft or send inference", async () => {
    const t = convexTest(schema, modules);
    const invalid = [
      { status: "staged", subjectRef: "rev:item-1", observedAt: 100 },
      { status: "paid", subjectRef: "rev:item-1" },
      { status: "paid", observedAt: 100 },
    ];

    for (const fields of invalid) {
      await expect(
        t.mutation(internal.workflowPackEventLog.record, {
          tenantId: "tenant-a",
          packId: "revenue",
          runId: `rev:invalid-${crypto.randomUUID()}`,
          event: "recovery_observed",
          provider: "stripe",
          ...fields,
        } as never),
      ).rejects.toThrow();
    }
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toEqual([]);
  });

  test("counts and opaque refs are bounded at the shared write boundary", async () => {
    const t = convexTest(schema, modules);
    for (const mutation of [
      { ...base, runId: "Ada Lovelace" },
      { ...base, runId: "rev:negative", itemCount: -1 },
      { ...base, runId: "rev:fraction", itemCount: 1.5 },
      { ...base, runId: "rev:huge", itemCount: REVENUE_COUNT_MAX + 1 },
    ]) {
      await expect(t.mutation(internal.workflowPackEventLog.record, mutation)).rejects.toThrow();
    }
  });

  test.each([
    ["customerName", "Ada Lovelace"],
    ["message", "Please pay invoice 42"],
    ["description", "Overdue consulting invoice"],
    ["amountMinor", 420_000],
    ["currency", "USD"],
    ["accessToken", "secret-token"],
    ["credentials", { secret: "raw" }],
    ["rawPayload", { customer: { name: "Ada" } }],
    ["durationMs", 123],
    ["latencyMs", 123],
    ["costUsd", 1.25],
    ["amountCents", 125],
  ])("recursively refuses forbidden %s content or canonical-owner fields", async (field, value) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.workflowPackEventLog.record, { ...base, [field]: value } as never),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toEqual([]);
  });

  test("stored rows contain only bounded leaves and no content-shaped field names", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.workflowPackEventLog.record, base);
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());

    const forbiddenKey =
      /(?:name|email|message|body|subject|description|amount|currency|token|credential|payload|cost|latency|duration)/i;
    for (const leaf of leaves(rows)) {
      expect(leaf.path, `forbidden path ${leaf.path}`).not.toMatch(forbiddenKey);
      if (typeof leaf.value === "string") expect(leaf.value.length).toBeLessThanOrEqual(128);
    }
  });

  test("the revenue helper has no table insert and delegates to the shared recorder", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./revenueTelemetry.ts", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toContain('db.insert("workflowPackEvents"');
    expect(src).toContain("workflowPackEventLog.record");
  });
});
