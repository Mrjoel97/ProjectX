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

/**
 * Whitespace-FREE, for a declaration the formatter is free to wrap.
 *
 * `compact` collapses runs of whitespace to one space, so it still sees the difference between
 * `v.optional( v.union(...), )` and `v.optional(v.union(...))` — which are the SAME schema, wrapped
 * two ways. A one-line declaration that grows past the print width (or shrinks back under it when
 * an unrelated field is renamed) then turns this suite red for a formatting change, which is what
 * happened on 2026-08-08: `b74c7af` collapsed `cancelKind` onto one line and broke a Phase-26 gate
 * without touching the schema's meaning. A source scan must pin the DECLARATION, not the print
 * width — use this for any assertion whose expected string spans a possible line break.
 */
function dense(value: string): string {
  // The trailing comma is part of the same problem: the formatter ADDS one when it wraps a call
  // across lines and REMOVES it when the call fits on one, so `("adjustment"),)` and
  // `("adjustment"))` are the identical declaration printed two ways.
  return value.replace(/\s+/g, "").replace(/,\)/g, ")");
}

describe("Phase 26 additive dashboard schema", () => {
  test("pins cancellation, progress, and the tenant/status/time Approvals index", () => {
    const plans = compact(tableBlock("plans"));

    expect(dense(plans)).toContain(
      dense('cancelKind: v.optional(v.union(v.literal("scheduled_cancel"), v.literal("discarded")))'),
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
    // Same trap as `cancelKind` above: this union is long enough that the formatter wraps it, and
    // a re-wrap is not a schema change. Pinned whitespace-free.
    expect(dense(events)).toContain(
      dense(
        'phase: v.union(v.literal("estimated"), v.literal("reserved"), v.literal("actual"), v.literal("refunded"), v.literal("adjustment"))',
      ),
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

  test("financeInputs holds only the five finance-ops fields, with a per-field statedAt", () => {
    const financeInputs = compact(tableBlock("financeInputs"));
    // The closed union, pinned whitespace-free — CAC and the other Hormozi inputs must never widen
    // this table (design §5, the storage-split rule).
    expect(dense(financeInputs)).toContain(
      dense(
        'field: v.union(v.literal("cashOnHand"), v.literal("monthlyOperatingCost"), v.literal("mrr"), v.literal("receivables"), v.literal("payables"))',
      ),
    );
    expect(financeInputs).toContain("tenantId: v.string()");
    expect(financeInputs).toContain("valueUsd: v.number()");
    expect(financeInputs).toContain("statedAt: v.number()");
    expect(financeInputs).toContain('.index("by_tenant", ["tenantId"])');
    expect(financeInputs).toContain('.index("by_tenant_field", ["tenantId", "field"])');
  });
});
