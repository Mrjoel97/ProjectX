// The tier CONTROL PLANE adapter (Phase 15.1 plan 02) under convex-test.
//
// What this file pins, in order: SC#2a (the tier/tierSource/derivedAt round-trip through
// `by_tenant`, tenant-scoped, both partitions non-empty), the "derivation is the ONLY writer"
// property, the design §10 "legacy tier stands until the facts are complete" behaviour, and the
// agentName trust boundary. Plan 02's tasks 2 and 3 extend it with the tier-change audit event and
// the legacy backfill.
//
// Component registration mirrors profileRedaction.test.ts (auditCounts + workflow + workpool — the
// audit insert feeds the aggregate) plus vaultSweep.test.ts's migrations registration, which the
// backfill needs.
import type { BusinessProfile, Persona } from "@pikar/core";
import { deriveTier, sanitizeAgentName, serializeProfile } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const migrationsModules = import.meta.glob(
  "../node_modules/@convex-dev/migrations/src/component/**/!(*.test).ts",
);

const TENANT_A = "tenant_tier_a";
const TENANT_B = "tenant_tier_b";

function setup(): TestConvex<typeof schema> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("migrations", migrationsSchema, migrationsModules);
  return t;
}

const asTenant = (t: TestConvex<typeof schema>, tenantId = TENANT_A) =>
  t.withIdentity({ subject: tenantId });

/** Read the tenant's row straight off the index (never through the function under test). */
const rowFor = (
  t: TestConvex<typeof schema>,
  tenantId: string,
): Promise<Doc<"tenantProfiles"> | null> =>
  t.run((ctx) =>
    ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique(),
  );

/** Every tenantProfiles row in the DB (the one-row-per-tenant invariant is asserted on this). */
const allRows = (t: TestConvex<typeof schema>): Promise<Doc<"tenantProfiles">[]> =>
  t.run((ctx) => ctx.db.query("tenantProfiles").collect());

// Complete fact sets, one per derivable tier. Full literals (no spread-over-a-base helper) so a
// mutation-check can see the field it flips — the 15.1-01 boundary-table convention.
const SOLO_FACTS = {
  headcount: 1,
  paidStaff: 0,
  revenueStage: "pre-revenue",
  funding: "bootstrapped",
  yearsOperating: 1,
} as const;

const SME_FACTS = {
  headcount: 12,
  paidStaff: 7,
  revenueStage: "steady-revenue",
  funding: "bootstrapped",
  yearsOperating: 6,
} as const;

describe("tenantProfile.saveFacts / get / forTenant (SC#2a)", () => {
  test("a complete fact set round-trips tier/tierSource/derivedAt and the facts as written", async () => {
    const t = setup();
    const before = Date.now();

    const res = await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SOLO_FACTS });
    expect(res).toMatchObject({ tier: "solopreneur", tierSource: "derived", changed: true });

    const after = Date.now();
    const got = await asTenant(t).query(api.tenantProfile.get, {});
    expect(got).not.toBeNull();
    expect(got?.tier).toBe("solopreneur");
    expect(got?.tierSource).toBe("derived");
    expect(got?.derivedAt).toBeGreaterThanOrEqual(before);
    expect(got?.derivedAt).toBeLessThanOrEqual(after);
    expect(got).toMatchObject(SOLO_FACTS);

    // Exactly ONE row for the tenant, read directly off the index.
    expect(await allRows(t)).toHaveLength(1);
    expect((await rowFor(t, TENANT_A))?.tier).toBe("solopreneur");
  });

  test("forTenant (the identity-less internal read) returns the same row, and null for an unknown tenant", async () => {
    const t = setup();
    await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });

    const row = await t.query(internal.tenantProfile.forTenant, { tenantId: TENANT_A });
    expect(row?.tier).toBe("sme");
    expect(await t.query(internal.tenantProfile.forTenant, { tenantId: "nobody" })).toBeNull();
  });

  test("tenant A's facts are invisible to tenant B (both partitions NON-EMPTY)", async () => {
    const t = setup();
    await asTenant(t, TENANT_A).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });
    await asTenant(t, TENANT_B).mutation(api.tenantProfile.saveFacts, { ...SOLO_FACTS });

    // Non-emptiness on BOTH sides: a zero-size partition passes a no-leakage check vacuously.
    const a = await asTenant(t, TENANT_A).query(api.tenantProfile.get, {});
    const b = await asTenant(t, TENANT_B).query(api.tenantProfile.get, {});
    expect(a?.tier).toBe("sme");
    expect(b?.tier).toBe("solopreneur");
    expect(a?.tenantId).toBe(TENANT_A);
    expect(b?.tenantId).toBe(TENANT_B);
    expect(a?.headcount).toBe(SME_FACTS.headcount);
    expect(b?.headcount).toBe(SOLO_FACTS.headcount);
    expect(await allRows(t)).toHaveLength(2);
  });

  test("derivation is the ONLY writer: an sme-shaped fact set writes tier sme with no tier argument in sight", async () => {
    const t = setup();
    const res = await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });
    expect(res.tier).toBe("sme");
    expect(res.tier).toBe(deriveTier(SME_FACTS)); // the same rule, not a re-implementation
    expect((await rowFor(t, TENANT_A))?.tier).toBe("sme");
  });

  test("incomplete facts on a tenant with NO row throw INCOMPLETE_FACTS and write nothing", async () => {
    const t = setup();
    await expect(
      asTenant(t).mutation(api.tenantProfile.saveFacts, { headcount: 3 }),
    ).rejects.toThrow(/INCOMPLETE_FACTS/);
    expect(await allRows(t)).toHaveLength(0);
  });

  test("incomplete facts on a tenant that HAS a row patch the facts and leave tier/tierSource/derivedAt alone (design §10)", async () => {
    const t = setup();
    const derivedAt = 1_700_000_000_000;
    await t.run((ctx) =>
      ctx.db.insert("tenantProfiles", {
        tenantId: TENANT_A,
        tier: "startup",
        tierSource: "legacy",
        derivedAt,
      }),
    );

    const res = await asTenant(t).mutation(api.tenantProfile.saveFacts, { headcount: 3 });
    expect(res).toMatchObject({ tier: "startup", tierSource: "legacy", changed: false });

    const row = await rowFor(t, TENANT_A);
    expect(row?.headcount).toBe(3); // the fact landed…
    expect(row?.tier).toBe("startup"); // …and the legacy tier STANDS
    expect(row?.tierSource).toBe("legacy");
    expect(row?.derivedAt).toBe(derivedAt);
    expect(await allRows(t)).toHaveLength(1);
  });

  test("agentName is sanitized on write (a prompt trust boundary, design §7)", async () => {
    const t = setup();
    const raw = `Ada\nBot${"x".repeat(200)}`;

    await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SOLO_FACTS, agentName: raw });

    const row = await rowFor(t, TENANT_A);
    expect(row?.agentName).not.toContain("\n");
    expect((row?.agentName ?? "").length).toBeLessThanOrEqual(40);
    expect(row?.agentName).toBe(sanitizeAgentName(raw)); // the shared rule, not a local copy
  });

  test("behaviorPreset persists and a later partial write does not clobber it", async () => {
    const t = setup();
    await asTenant(t).mutation(api.tenantProfile.saveFacts, {
      ...SOLO_FACTS,
      behaviorPreset: "coaching",
    });
    await asTenant(t).mutation(api.tenantProfile.saveFacts, { headcount: 2 });

    const row = await rowFor(t, TENANT_A);
    expect(row?.behaviorPreset).toBe("coaching");
    expect(row?.headcount).toBe(2);
  });
});

// ── Task 2: the tier-change event (SC#5c) and the operator-only enterprise grant (D6) ───────────

/** Seed a tier row DIRECTLY (never through saveFacts, which would emit its own change event). */
const seedRow = (
  t: TestConvex<typeof schema>,
  tenantId: string,
  patch: Partial<Doc<"tenantProfiles">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      ...SOLO_FACTS,
      tier: "solopreneur",
      tierSource: "derived",
      derivedAt: 1_700_000_000_000,
      ...patch,
    }),
  );

const tierChangedRows = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("audit").collect()).filter((r) => r.eventType === "tenant.tier_changed"),
  );

/**
 * The §4 scan surface is the audit PAYLOADS, deliberately not the whole rows: `ts` / `_creationTime`
 * are 13-digit epoch millis that contain an arbitrary two-digit needle a large fraction of the time,
 * so scanning the whole row would be a coin-flip flake AND a weaker assertion (a real leak drowned
 * in timestamp noise). The payload is where CLAUDE.md §4 actually lives.
 */
const auditPayloadJson = (t: TestConvex<typeof schema>): Promise<string> =>
  t.run(async (ctx) =>
    JSON.stringify((await ctx.db.query("audit").collect()).map((r) => r.payload)),
  );

describe("the tier change event (SC#5c)", () => {
  test("a tier change event is written exactly once, with four enum/count keys and nothing else", async () => {
    const t = setup();
    await seedRow(t, TENANT_A);

    await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });

    const rows = await tierChangedRows(t);
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as Record<string, unknown>;
    // The KEY SET, sorted — not `toHaveProperty`, which passes for any superset, and the superset
    // is exactly the leak.
    expect(Object.keys(payload).sort()).toEqual(["factsChanged", "from", "tierSource", "to"]);
    expect(payload.from).toBe("solopreneur");
    expect(payload.to).toBe("sme");
    expect(payload.tierSource).toBe("derived");
    expect(rows[0]?.tenantId).toBe(TENANT_A);
    expect(rows[0]?.actor).toBe("user");
  });

  test("no fact VALUE reaches the audit payload (CLAUDE.md §4)", async () => {
    const t = setup();
    await seedRow(t, TENANT_A);

    // Distinctive values no enum, tier or count can coincide with.
    await asTenant(t).mutation(api.tenantProfile.saveFacts, {
      ...SME_FACTS,
      headcount: 137,
      yearsOperating: 41,
    });

    const payloads = await auditPayloadJson(t);
    expect(payloads).toContain("tier"); // non-vacuity: we ARE scanning a populated payload
    expect(payloads).not.toContain("137");
    expect(payloads).not.toContain("41");

    // `factsChanged` is a COUNT (the `populatedFieldCount` precedent), never a value.
    const payload = (await tierChangedRows(t))[0]?.payload as Record<string, unknown>;
    expect(typeof payload.factsChanged).toBe("number");
    expect(payload.factsChanged as number).toBeLessThanOrEqual(5);
  });

  test("no event when the tier does NOT move", async () => {
    const t = setup();
    await seedRow(t, TENANT_A);

    await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });
    expect(await tierChangedRows(t)).toHaveLength(1);

    // Same facts again — derivedAt may be refreshed; the EVENT is for a CHANGE.
    await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });
    expect(await tierChangedRows(t)).toHaveLength(1);
    expect((await rowFor(t, TENANT_A))?.tier).toBe("sme");
  });

  test("the first derivation over a legacy row is a change and IS logged", async () => {
    const t = setup();
    await seedRow(t, TENANT_A, { tierSource: "legacy", tier: "solopreneur" });

    await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });

    const rows = await tierChangedRows(t);
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as Record<string, unknown>;
    expect(payload.from).toBe("solopreneur");
    expect((await rowFor(t, TENANT_A))?.tierSource).toBe("derived");
  });
});

describe("grantEnterprise (D6, operator-only)", () => {
  test("the grant writes enterprise/admin and logs one tier change", async () => {
    const t = setup();
    await seedRow(t, TENANT_A);

    const res = await t.mutation(internal.tenantProfile.grantEnterprise, { tenantId: TENANT_A });
    expect(res).toMatchObject({ tier: "enterprise", tierSource: "admin", changed: true });

    const row = await rowFor(t, TENANT_A);
    expect(row?.tier).toBe("enterprise");
    expect(row?.tierSource).toBe("admin");

    const rows = await tierChangedRows(t);
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["factsChanged", "from", "tierSource", "to"]);
    expect(payload.to).toBe("enterprise");
    expect(payload.tierSource).toBe("admin");
  });

  test("a granted enterprise SURVIVES a later facts edit, and logs nothing", async () => {
    const t = setup();
    await seedRow(t, TENANT_A);
    await t.mutation(internal.tenantProfile.grantEnterprise, { tenantId: TENANT_A });
    expect(await tierChangedRows(t)).toHaveLength(1);

    // Solopreneur-shaped facts: a naive re-derivation would downgrade the operator grant.
    const res = await asTenant(t).mutation(api.tenantProfile.saveFacts, { ...SOLO_FACTS });
    expect(res).toMatchObject({ tier: "enterprise", tierSource: "admin", changed: false });

    const row = await rowFor(t, TENANT_A);
    expect(row?.tier).toBe("enterprise");
    expect(row?.tierSource).toBe("admin");
    expect(row?.headcount).toBe(SOLO_FACTS.headcount); // the FACTS did land
    expect(await tierChangedRows(t)).toHaveLength(1); // …and NO new event
  });

  test("the grant upserts a tenant that has no row at all", async () => {
    const t = setup();
    const res = await t.mutation(internal.tenantProfile.grantEnterprise, { tenantId: TENANT_B });
    expect(res.changed).toBe(true);

    const row = await rowFor(t, TENANT_B);
    expect(row?.tier).toBe("enterprise");
    expect(row?.tierSource).toBe("admin");
    expect(row?.headcount).toBeUndefined();
    expect((await tierChangedRows(t))[0]?.payload).toMatchObject({ from: null });
  });
});

// ── Task 3: the legacy backfill (SC#6a / SC#6b, design §10) ─────────────────────────────────────

const TENANT_LEGACY_SOLO = "tenant_legacy_solo";
const TENANT_LEGACY_SME = "tenant_legacy_sme";
const TENANT_FAILED_DOC = "tenant_failed_doc";
const TENANT_NON_PROFILE = "tenant_non_profile";
const TENANT_TWO_DOCS = "tenant_two_docs";

const profileFor = (persona: Persona): BusinessProfile => ({
  name: "Northwind",
  oneLineDescription: "A legacy tenant onboarded before the tier existed.",
  persona,
  stage: "operating",
  offering: "Consulting",
  targetCustomer: "SMBs",
  primaryGoals: ["grow"],
  knownConstraints: ["time"],
});

/** Seed a committed `business_profile` vault doc — the ONLY record a pre-15.1 tenant's tier has. */
const seedProfileDoc = (
  t: TestConvex<typeof schema>,
  tenantId: string,
  persona: Persona,
  overrides: Record<string, unknown> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business profile",
      kind: "business_profile",
      category: "my-business",
      source: "onboarding",
      mimeType: "text/markdown",
      size: 1,
      contentHash: `c-${tenantId}-${Math.random()}`,
      text: serializeProfile(profileFor(persona)),
      status: "ready",
      createdAt: Date.now(),
      ...overrides,
    }),
  );

/** One synchronous batch — the documented one-off mode, the vaultSweep.test.ts invocation shape. */
const runBackfill = (t: TestConvex<typeof schema>) =>
  t.mutation(internal.tenantProfile.backfillLegacyTier, {
    cursor: null,
    batchSize: 100,
    dryRun: false,
    oneBatchOnly: true,
  });

/** Everything the backfill queued. convex-test flushes due scheduled work in the BACKGROUND, so a
 *  test that leaves a production job queued has a hidden OPENAI_API_KEY dependency (15-04's race). */
const queuedJobs = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.db.system
      .query("_scheduled_functions")
      .collect()
      .then((jobs) =>
        jobs.filter((j) => j.state.kind === "pending" || j.state.kind === "inProgress"),
      ),
  );

const cancelQueued = async (t: TestConvex<typeof schema>) => {
  const jobs = await queuedJobs(t);
  await t.run(async (ctx) => {
    for (const j of jobs) await ctx.scheduler.cancel(j._id);
  });
  return jobs;
};

describe("the legacy backfill (SC#6a / SC#6b)", () => {
  test("legacy backfill writes one legacy row per onboarded tenant and skips failed / non-profile docs", async () => {
    const t = setup();
    await seedProfileDoc(t, TENANT_LEGACY_SOLO, "solopreneur");
    await seedProfileDoc(t, TENANT_LEGACY_SME, "sme");
    await seedProfileDoc(t, TENANT_FAILED_DOC, "startup", { status: "failed" });
    await seedProfileDoc(t, TENANT_NON_PROFILE, "startup", { kind: "upload" });

    await runBackfill(t);

    const rows = await allRows(t);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tierSource).toBe("legacy");
      expect(row.derivedAt).toBeGreaterThan(0);
      // A legacy row has NO facts by definition (design §10 — no forced re-onboarding).
      expect(row.headcount).toBeUndefined();
      expect(row.paidStaff).toBeUndefined();
      expect(row.revenueStage).toBeUndefined();
      expect(row.funding).toBeUndefined();
      expect(row.yearsOperating).toBeUndefined();
    }
    // The tier is recovered from that tenant's OWN markdown persona.
    expect((await rowFor(t, TENANT_LEGACY_SOLO))?.tier).toBe("solopreneur");
    expect((await rowFor(t, TENANT_LEGACY_SME))?.tier).toBe("sme");
    expect(await rowFor(t, TENANT_FAILED_DOC)).toBeNull();
    expect(await rowFor(t, TENANT_NON_PROFILE)).toBeNull();

    // A backfill that queued production work would be a hidden OPENAI_API_KEY dependency.
    expect(await cancelQueued(t)).toHaveLength(0);
  });

  test("backfill is idempotent: a second run adds nothing and keeps the same row ids", async () => {
    const t = setup();
    await seedProfileDoc(t, TENANT_LEGACY_SOLO, "solopreneur");
    await seedProfileDoc(t, TENANT_LEGACY_SME, "sme");

    await runBackfill(t);
    const firstIds = (await allRows(t)).map((r) => r._id).sort();
    expect(firstIds).toHaveLength(2);

    await runBackfill(t);
    const secondIds = (await allRows(t)).map((r) => r._id).sort();
    expect(secondIds).toEqual(firstIds);

    await cancelQueued(t);
  });

  test("backfill never reverts a real derivation to legacy", async () => {
    const t = setup();
    await seedProfileDoc(t, TENANT_LEGACY_SOLO, "solopreneur");
    await runBackfill(t);
    expect((await rowFor(t, TENANT_LEGACY_SOLO))?.tierSource).toBe("legacy");

    // The tenant completes the facts — the row becomes authoritative.
    await asTenant(t, TENANT_LEGACY_SOLO).mutation(api.tenantProfile.saveFacts, { ...SME_FACTS });
    expect((await rowFor(t, TENANT_LEGACY_SOLO))?.tierSource).toBe("derived");

    // A THIRD backfill run must leave that alone.
    await runBackfill(t);
    const row = await rowFor(t, TENANT_LEGACY_SOLO);
    expect(row?.tierSource).toBe("derived");
    expect(row?.tier).toBe("sme");
    expect(await allRows(t)).toHaveLength(1);

    await cancelQueued(t);
  });

  test("a tenant with TWO profile docs still ends with exactly ONE row", async () => {
    const t = setup();
    await seedProfileDoc(t, TENANT_TWO_DOCS, "startup");
    await seedProfileDoc(t, TENANT_TWO_DOCS, "startup");

    await runBackfill(t);

    expect(await allRows(t)).toHaveLength(1);
    expect((await rowFor(t, TENANT_TWO_DOCS))?.tier).toBe("startup");

    await cancelQueued(t);
  });
});
