/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SCHEMA = readFileSync(new URL("./schema.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n",
);

function tableBlock(name: string): string {
  const marker = `\n  ${name}: defineTable(`;
  const start = SCHEMA.indexOf(marker);
  expect(start, `${name} table must exist`).toBeGreaterThan(-1);
  const rest = SCHEMA.slice(start + marker.length);
  const next = rest.search(/\n  [A-Za-z][A-Za-z0-9]*: defineTable\(/);
  return `${marker}${next === -1 ? rest : rest.slice(0, next)}`;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ");
}

describe("Phase 26 additive dashboard schema", () => {
  test("pins cancellation, progress, and the tenant/status/time Approvals index", () => {
    const plans = compact(tableBlock("plans"));

    expect(plans).toContain(
      'cancelKind: v.optional( v.union(v.literal("scheduled_cancel"), v.literal("discarded")), )',
    );
    for (const field of [
      "canceledAt",
      "recipientTotal",
      "sentCount",
      "failedCount",
      "queuedCount",
    ]) {
      expect(plans).toContain(`${field}: v.optional(v.number())`);
    }
    expect(plans).toContain("counterComplete: v.optional(v.boolean())");
    expect(plans).toContain(
      '.index("by_tenant_status_createdAt", ["tenantId", "status", "createdAt"])',
    );
  });

  test("defines append-only spend facts and an explicit per-tenant coverage start", () => {
    const events = compact(tableBlock("spendEvents"));
    const coverage = compact(tableBlock("spendCoverage"));

    expect(events).toContain(
      'rail: v.union(v.literal("reasoning"), v.literal("media"), v.literal("ingest"))',
    );
    expect(events).toContain(
      'phase: v.union( v.literal("estimated"), v.literal("reserved"), v.literal("actual"), v.literal("refunded"), v.literal("adjustment"), )',
    );
    for (const required of [
      "tenantId: v.string()",
      "amountCents: v.number()",
      "correlationId: v.string()",
      "createdAt: v.number()",
    ]) {
      expect(events).toContain(required);
    }
    for (const optional of [
      'planId: v.optional(v.id("plans"))',
      'requestId: v.optional(v.id("requests"))',
      'folderId: v.optional(v.id("vaultFolders"))',
      'mediaJobId: v.optional(v.id("mediaJobs"))',
      "model: v.optional(v.string())",
      "kind: v.optional(v.string())",
    ]) {
      expect(events).toContain(optional);
    }
    expect(events).toContain(
      '.index("by_tenant_createdAt", ["tenantId", "createdAt"])',
    );
    expect(events).toContain(
      '.index("by_tenant_rail_createdAt", ["tenantId", "rail", "createdAt"])',
    );
    expect(events).toContain('.index("by_correlation", ["correlationId"])');

    expect(coverage).toContain("tenantId: v.string()");
    expect(coverage).toContain("coverageStartedAt: v.number()");
    expect(coverage).toContain('.index("by_tenant", ["tenantId"])');
  });

  test("pins the bounded time indexes and optional artifact provenance", () => {
    const vault = compact(tableBlock("vaultDocuments"));
    expect(vault).toContain("sourceThreadId: v.optional(v.string())");
    expect(vault).toContain('sourcePlanId: v.optional(v.id("plans"))');
    expect(vault).toContain(
      '.index("by_tenant_origin_createdAt", ["tenantId", "origin", "createdAt"])',
    );

    expect(compact(tableBlock("requests"))).toContain(
      '.index("by_tenant_status_createdAt", ["tenantId", "status", "createdAt"])',
    );
    for (const table of ["briefings", "feedback", "mediaJobs"]) {
      expect(compact(tableBlock(table))).toContain(
        '.index("by_tenant_createdAt", ["tenantId", "createdAt"])',
      );
    }
  });

  test("legacy plan and Vault rows still validate without Phase 26 fields", async () => {
    const t = convexTest(schema, modules);

    const [planId, vaultDocId] = await t.run(async (ctx) => {
      const planId = await ctx.db.insert("plans", {
        tenantId: "legacy-tenant",
        threadId: "legacy-thread",
        status: "canceled",
        createdAt: 1,
      });
      const vaultDocId = await ctx.db.insert("vaultDocuments", {
        tenantId: "legacy-tenant",
        title: "Legacy document",
        kind: "upload",
        category: "business",
        source: "upload",
        mimeType: "text/plain",
        size: 6,
        contentHash: "legacy-hash",
        status: "ready",
        createdAt: 1,
      });
      return [planId, vaultDocId] as const;
    });

    const [plan, vaultDoc] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(planId), ctx.db.get(vaultDocId)]),
    );
    expect(plan).toMatchObject({ status: "canceled" });
    expect(plan).not.toHaveProperty("cancelKind");
    expect(plan).not.toHaveProperty("counterComplete");
    expect(vaultDoc).toMatchObject({ title: "Legacy document" });
    expect(vaultDoc).not.toHaveProperty("sourceThreadId");
    expect(vaultDoc).not.toHaveProperty("sourcePlanId");
  });
});
