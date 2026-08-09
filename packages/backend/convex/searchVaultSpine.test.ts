// @vitest-environment node
//
// BLPR-02 items 17/18: a confirmed Business Blueprint is standing context, not a search result.
// These tests drive the REAL searchVault tool through its action-context shim and pin the two
// regressions that would return if the spine were inserted into vaultGroundHydrated's arrays.
import { type BusinessBlueprint, serializeBlueprint } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
type T = ReturnType<typeof convexTest>;

const BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme"], origin: "stated" },
  oneLineDescription: {
    values: ["BLUEPRINT-ONLY-STANDING-CONTEXT"],
    origin: "derived",
    source: "owner-notes.md",
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

function newTest(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = newTest();
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT,
    threadId: "thread_blueprint_search",
  });
  return { t, planId };
}

async function seedConfirmedBlueprint(t: T): Promise<Id<"vaultDocuments">> {
  const docId = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Business blueprint",
      kind: "business_blueprint",
      category: "business",
      source: "blueprint",
      mimeType: "text/markdown",
      size: BLUEPRINT_TEXT.length,
      contentHash: "blueprint-search-spine",
      text: BLUEPRINT_TEXT,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId: TENANT,
      tier: "startup",
      tierSource: "derived",
      derivedAt: Date.now(),
      blueprintDocId: docId,
      blueprintSourceDocIds: [],
      blueprintConfirmedAt: Date.now(),
    }),
  );
  return docId;
}

const seedRetrievalDoc = (
  t: T,
  text: string,
  title = "Matched source",
): Promise<Id<"vaultDocuments">> =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title,
      kind: "upload",
      category: "business",
      source: "upload",
      mimeType: "text/plain",
      size: text.length,
      contentHash: "matched-search-source",
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );

const searchVault = (t: T, planId: Id<"plans">, query: string): Promise<string> =>
  t.action(internal.llm.__invokeCockpitTool, {
    tenantId: TENANT,
    planId,
    toolName: "searchVault",
    input: { query },
  });

const searchAudits = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) =>
        q.and(q.eq(q.field("tenantId"), TENANT), q.eq(q.field("eventType"), "vault.searched")),
      )
      .collect(),
  );

describe("searchVault with a confirmed Blueprint (BLPR-02)", () => {
  test("keeps the honest no-match and audits zero retrieval hits", async () => {
    const { t, planId } = await setup();
    await seedConfirmedBlueprint(t);

    const reply = await searchVault(t, planId, "SMOKE::");

    expect(reply).toContain("I don't have anything in your vault about that");
    expect(reply).not.toContain("Grounded in 1 document(s)");
    expect(await t.run((ctx) => ctx.db.query("vaultSources").first())).toBeNull();
    const rows = await searchAudits(t);
    expect(rows).toHaveLength(1);
    const auditRow = rows[0];
    if (auditRow === undefined) throw new Error("expected vault.searched audit row");
    expect((auditRow.payload as { resultCount: number }).resultCount).toBe(0);
  });

  test("shows only matched retrieval documents in the source card", async () => {
    const { t, planId } = await setup();
    const blueprintDocId = await seedConfirmedBlueprint(t);
    const retrievalDocId = await seedRetrievalDoc(t, "MATCHED-RETRIEVAL-CONTENT");

    const reply = await searchVault(t, planId, `SMOKE::${retrievalDocId}`);

    expect(reply).toContain("MATCHED-RETRIEVAL-CONTENT");
    expect(reply).not.toContain("BLUEPRINT-ONLY-STANDING-CONTEXT");
    expect(reply).toContain("Grounded in 1 document(s)");
    const source = await t.run((ctx) => ctx.db.query("vaultSources").first());
    expect(source?.docIds).toEqual([retrievalDocId]);
    expect(source?.docIds).not.toContain(blueprintDocId);
    expect(source?.titles).toEqual(["Matched source"]);
    expect(source?.count).toBe(1);
    const rows = await searchAudits(t);
    const auditRow = rows[0];
    if (auditRow === undefined) throw new Error("expected vault.searched audit row");
    expect((auditRow.payload as { resultCount: number }).resultCount).toBe(1);
  });
});
