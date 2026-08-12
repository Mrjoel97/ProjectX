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

const insertFigure = (t: ReturnType<typeof convexTest>, tenantId: string) =>
  t.run(async (ctx) => {
    await ctx.db.insert("financeInputs", {
      tenantId,
      field: "cashOnHand" as const,
      valueUsd: 38_500,
      statedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      origin: "stated" as const,
      actor: "user" as const,
      basis: "finance panel",
    });
  });

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

  // WHOLE-BRANCH REVIEW C1 (and its re-review). The skill body tells the model its context carries
  // a `Finance:` line; before this it did not, because `financeSpineLine` had no callers. It rides
  // the TURN PROMPT — joined here and nowhere else, because the blueprint spine's own query doubles
  // as `evaluations.ts`'s grounding chunk and would capture these figures (see
  // `evaluations.test.ts`'s "the finance line never reaches the grounding corpus").
  test("the finance line rides the turn prompt beside the blueprint", async () => {
    const t = convexTest(schema, modules);
    const docId = await insertBlueprintDocument(t, TENANT_A);
    await insertConfirmedProfile(t, TENANT_A, docId);
    await insertFigure(t, TENANT_A);
    const planId = await insertPlan(t, TENANT_A);

    const prompt = await t.action(internal.llm.__cockpitTurnPrompt, {
      tenantId: TENANT_A,
      planId,
      text: TURN_TEXT,
    });

    expect(prompt).toMatch(/^<business_blueprint>/);
    expect(prompt).toContain("Acme Water");
    expect(prompt).toContain("Finance: cashOnHand 38500(");
    expect(prompt.endsWith(`The user says: ${TURN_TEXT}`)).toBe(true);
  });

  // The early-return case the whole two-channel split exists to serve: figures but no confirmed
  // blueprint — the ordinary state of a new account. A single `spineForTenant` string could not
  // express this without also leaking into the grounding corpus.
  test("a tenant with figures and NO blueprint still gets the finance line", async () => {
    const t = convexTest(schema, modules);
    await insertFigure(t, TENANT_B);
    const planId = await insertPlan(t, TENANT_B);

    const prompt = await t.action(internal.llm.__cockpitTurnPrompt, {
      tenantId: TENANT_B,
      planId,
      text: TURN_TEXT,
    });

    expect(prompt).not.toContain("<business_blueprint>");
    expect(prompt).toContain("Finance: cashOnHand 38500(");
    expect(prompt.endsWith(`The user says: ${TURN_TEXT}`)).toBe(true);
  });

  test("a tenant with neither is still byte-identical to the legacy prompt", async () => {
    const t = convexTest(schema, modules);
    const planId = await insertPlan(t, TENANT_B);

    expect(
      await t.action(internal.llm.__cockpitTurnPrompt, {
        tenantId: TENANT_B,
        planId,
        text: TURN_TEXT,
      }),
    ).toBe(noSpinePrompt(TURN_TEXT));
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
    // The SECOND channel, read separately on both sites. A future edit that "tidies" this by
    // appending the finance line to `spineForTenant` instead re-opens the grounding-corpus leak.
    const financeRead =
      /finance\s*=\s*await ctx\.runQuery\(internal\.cash\.financeSpineFor,\s*\{\s*tenantId\s*\}\)/;
    expect(production).toMatch(financeRead);
    expect(shim).toMatch(financeRead);
    expect(production).toMatch(/prompt:\s*buildTurnPrompt\(\{\s*spine,\s*finance,/);
    expect(shim).toMatch(/return buildTurnPrompt\(\{\s*spine,\s*finance,/);
  });
});
