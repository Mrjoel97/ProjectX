// Business Evaluation Engine (BEVL-01) — convex-test over the SMOKE:: grounding seam (zero network).
// This file rides `vaultGroundHydrated`'s offline seam (`SMOKE::<docId,…>`): a grounding query that
// starts with the sentinel resolves the seed docs tenant-scoped, no embedding call. The engine then
// carries the prior Scorecard forward, grounds, runs the pure diagnose(), and persists ONE row.
import { serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
// The engine's refs-only evaluation.ran audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) so the REAL audit path runs
// under convex-test instead of throwing "component not registered" (the cockpitTools.test.ts idiom).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const THREAD = "thread_1";

/** convex-test instance with the auditCounts aggregate component registered. */
function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** A committed business-profile vault doc (round-trips through deserializeProfile) + financial lines. */
function profileDocText(withFinancials: boolean): string {
  const md = serializeProfile({
    name: "Acme Dog Training",
    oneLineDescription: "In-home dog training for busy urban owners.",
    persona: "solopreneur",
    stage: "early-revenue",
    offering: "6-week private obedience program",
    targetCustomer: "urban dog owners with new puppies",
    primaryGoals: ["more clients"],
    knownConstraints: [],
  });
  // Direct labeled figures → the honest financial scan fires (growth-os auto-pick).
  return withFinancials ? `${md}\n\nCAC: $150\nLTGP: $4500\n30-day cash: $200\n` : md;
}

/** Seed a groundable vault doc; return its id (the SMOKE:: seed). */
async function seedDoc(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  text: string,
): Promise<Id<"vaultDocuments">> {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business profile",
      kind: "brief",
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: text.length,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
}

describe("runEvaluation (BEVL-01 — grounded assessment persists a cited row)", () => {
  test("a grounded run persists a row with >=1 cited finding; byThread returns it", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));

    const result = await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    expect(result.findingCount).toBeGreaterThanOrEqual(1);

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    expect(row).not.toBeNull();
    expect(row?.framework).toBe("growth-os"); // financials present → growth-os auto-pick
    // Every finding carries a citation (SC #1) — a docId+title or an honest user-provided label.
    expect(row?.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of row?.findings ?? []) {
      expect(f.citationTitle).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(f.confidence);
    }
    // A grounded finding cites the seed doc.
    expect(row?.findings.some((f) => f.citationDocId === docId && f.source === "vault")).toBe(true);
  });
});

describe("recordScorecardAnswer (BEVL-01 — the 'store' persistence path)", () => {
  test("stores a user figure into the latest row's scorecard + userProvided[]", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(false));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    await t
      .withIdentity({ subject: TENANT })
      .mutation(api.evaluations.recordScorecardAnswer, {
        threadId: THREAD,
        field: "financials.cac",
        value: 150,
      });

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    expect(row?.scorecard.financials.cac).toBe(150);
    expect(row?.userProvided).toContain("financials.cac");
  });
});
