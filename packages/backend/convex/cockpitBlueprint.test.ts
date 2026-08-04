import { type BusinessBlueprint, serializeBlueprint } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const src = sources["./llm.ts"] ?? "";
// The module documents this seam and the old shape, so comments must not satisfy or trip the scan.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const TENANT_A = "tenant_blueprint_a";
const TENANT_B = "tenant_blueprint_b";
const TURN_TEXT = "draft an email to Bob";

const BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme Water"], origin: "stated" },
  oneLineDescription: {
    values: ["Water systems for independent hotels"],
    origin: "derived",
    source: "company-overview.md",
  },
  stage: null,
  tier: { values: ["startup"], origin: "stated" },
  offering: null,
  targetCustomer: null,
  revenueModel: null,
  bindingConstraint: null,
  primaryGoals: null,
  knownConstraints: null,
  entities: null,
} satisfies BusinessBlueprint);

const noSpinePrompt = (text: string): string => `Current email plan:
Recipients (reason about these by #index only):
  (none yet)
Subject: (not set)
Body drafted: no
Send mode: (not set)
Send time: (immediate on approve)
Attachments (reason about these by #index/filename):
  (none yet)

The user says: ${text}`;

const insertPlan = (t: ReturnType<typeof convexTest>, tenantId: string) =>
  t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: `thread-${tenantId}`,
  });

async function insertBlueprintDocument(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
): Promise<Id<"vaultDocuments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business blueprint",
      kind: "business_blueprint",
      category: "business",
      source: "blueprint",
      mimeType: "text/markdown",
      size: BLUEPRINT_TEXT.length,
      contentHash: `blueprint-${tenantId}`,
      text: BLUEPRINT_TEXT,
      status: "ready",
      createdAt: Date.now(),
    });
  });
}

async function insertConfirmedProfile(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  blueprintDocId: Id<"vaultDocuments">,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "startup",
      tierSource: "derived",
      derivedAt: Date.now(),
      blueprintDocId,
      blueprintSourceDocIds: [],
      blueprintConfirmedAt: Date.now(),
    });
  });
}

describe("cockpit business-blueprint turn prompt (BLPR-02, VALIDATION item 24)", () => {
  test("a no-tool turn carries the confirmed tenant blueprint through the real read chain", async () => {
    const t = convexTest(schema, modules);
    const docId = await insertBlueprintDocument(t, TENANT_A);
    await insertConfirmedProfile(t, TENANT_A, docId);
    const planId = await insertPlan(t, TENANT_A);

    const prompt = await t.action(internal.llm.__cockpitTurnPrompt, {
      tenantId: TENANT_A,
      planId,
      text: TURN_TEXT,
    });

    expect(prompt).toMatch(/^<business_blueprint>/);
    expect(prompt).toContain("Acme Water");
    expect(prompt).toContain("Current email plan:");
    expect(prompt.endsWith(`The user says: ${TURN_TEXT}`)).toBe(true);
  });

  test("a tenant with no blueprint gets the byte-identical legacy prompt", async () => {
    const t = convexTest(schema, modules);
    const planId = await insertPlan(t, TENANT_B);

    const prompt = await t.action(internal.llm.__cockpitTurnPrompt, {
      tenantId: TENANT_B,
      planId,
      text: TURN_TEXT,
    });

    expect(prompt).toBe(noSpinePrompt(TURN_TEXT));
    expect(prompt).not.toContain("<business_blueprint>");
  });

  test("cross-tenant: tenant B never carries tenant A's blueprint", async () => {
    const t = convexTest(schema, modules);
    const docId = await insertBlueprintDocument(t, TENANT_A);
    await insertConfirmedProfile(t, TENANT_A, docId);
    const planId = await insertPlan(t, TENANT_B);

    const prompt = await t.action(internal.llm.__cockpitTurnPrompt, {
      tenantId: TENANT_B,
      planId,
      text: TURN_TEXT,
    });

    expect(prompt).toBe(noSpinePrompt(TURN_TEXT));
    expect(prompt).not.toContain("Acme Water");
  });

  test("a dangling blueprint pointer fails open to the byte-identical legacy prompt", async () => {
    const t = convexTest(schema, modules);
    const docId = await insertBlueprintDocument(t, TENANT_A);
    await insertConfirmedProfile(t, TENANT_A, docId);
    await t.run(async (ctx) => {
      await ctx.db.delete(docId);
    });
    const planId = await insertPlan(t, TENANT_A);

    const prompt = await t.action(internal.llm.__cockpitTurnPrompt, {
      tenantId: TENANT_A,
      planId,
      text: TURN_TEXT,
    });

    expect(prompt).toBe(noSpinePrompt(TURN_TEXT));
    expect(prompt).not.toContain("<business_blueprint>");
  });

  test("production and the shim are pinned to exactly two shared-helper call sites", () => {
    expect(src.length).toBeGreaterThan(10_000);
    expect(code.match(/buildTurnPrompt\(\{/g) ?? []).toHaveLength(2);

    const production = code.slice(
      code.indexOf("export const runCockpitAgent"),
      code.indexOf("export const __invokeCockpitTool"),
    );
    const shim = code.slice(
      code.indexOf("export const __cockpitTurnPrompt"),
      code.indexOf("export const __runCockpitAgentWithScript"),
    );
    const spineRead =
      /spine\s*=\s*await ctx\.runQuery\(internal\.blueprint\.spineForTenant,\s*\{\s*tenantId\s*\}\)/;
    expect(production).toMatch(spineRead);
    expect(shim).toMatch(spineRead);
    expect(production).toMatch(/prompt:\s*buildTurnPrompt\(\{\s*spine,/);
    expect(shim).toMatch(/return buildTurnPrompt\(\{\s*spine,/);
  });
});
