import { BUSINESS_BLUEPRINT_SKILL } from "@pikar/contracts/skill";
import {
  type BlueprintDiffRow,
  type BusinessBlueprint,
  type BusinessProfile,
  deserializeBlueprint,
  probesFor,
  SPINE_CHAR_CAP,
  serializeBlueprint,
  serializeProfile,
  statedFromProfile,
} from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { __collectGroundedSources } from "./blueprint";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const makeTest = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
};

async function seedBlueprintSkill(t: ReturnType<typeof makeTest>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("skills", {
      name: BUSINESS_BLUEPRINT_SKILL,
      version: 1,
      body: "Derive only source-backed candidates for the requested blueprint fields.",
      status: "active",
      createdAt: Date.now(),
    });
  });
}

const smokeDeriveArgs = {
  tenantId: "tenant_a",
  fields: ["offering"],
  sources: [
    {
      title: "owner-notes.md",
      text: "SMOKE::blueprint::offering|Spring water systems|0",
    },
  ],
};

async function insertVaultDocument(
  t: ReturnType<typeof makeTest>,
  options: {
    tenantId: string;
    kind?: string;
    text?: string | undefined;
    status?: "processing" | "ready";
  },
): Promise<Id<"vaultDocuments">> {
  const { tenantId, kind = "business_blueprint", status = "ready" } = options;
  const text = Object.hasOwn(options, "text") ? options.text : "# Business Blueprint";
  return await t.run(async (ctx) => {
    return await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business blueprint",
      kind,
      category: "business",
      source: "blueprint",
      mimeType: "text/markdown",
      size: text?.length ?? 0,
      contentHash: `${tenantId}-${kind}-${Date.now()}-${Math.random()}`,
      ...(text === undefined ? {} : { text }),
      status,
      createdAt: Date.now(),
    });
  });
}

async function insertTenantProfile(
  t: ReturnType<typeof makeTest>,
  tenantId: string,
  blueprint?: {
    docId: Id<"vaultDocuments">;
    sourceDocIds?: string[];
    confirmedAt?: number;
    draft?: string;
  },
): Promise<Id<"tenantProfiles">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "startup",
      tierSource: "derived",
      derivedAt: Date.now(),
      ...(blueprint
        ? {
            blueprintDocId: blueprint.docId,
            blueprintSourceDocIds: blueprint.sourceDocIds ?? [],
            blueprintConfirmedAt: blueprint.confirmedAt,
            blueprintDraft: blueprint.draft,
          }
        : {}),
    });
  });
}

const LIVE_BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme"], origin: "stated" },
  oneLineDescription: {
    values: ["A tenant-scoped business"],
    origin: "derived",
    source: "source-a.md",
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

const TYPED_PROFILE = {
  name: "Acme",
  oneLineDescription: "Spring-water systems for growing hotels.",
  persona: "startup",
  stage: "growing",
  offering: "Spring-water filtration systems",
  targetCustomer: "Independent hotels",
  primaryGoals: ["Reach 50 hotel customers"],
  knownConstraints: ["Founder-led sales"],
} satisfies BusinessProfile;

const FULL_LIVE_BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme"], origin: "stated" },
  oneLineDescription: { values: ["Old description"], origin: "stated" },
  stage: { values: ["growing"], origin: "stated" },
  tier: { values: ["startup"], origin: "stated" },
  offering: { values: ["Spring-water filtration systems"], origin: "stated" },
  targetCustomer: { values: ["Independent hotels"], origin: "stated" },
  revenueModel: {
    values: ["Installation plus maintenance"],
    origin: "derived",
    source: "pricing.md",
  },
  bindingConstraint: {
    values: ["Founder-led sales"],
    origin: "derived",
    source: "operating-plan.md",
  },
  primaryGoals: { values: ["Reach 50 hotel customers"], origin: "stated" },
  knownConstraints: { values: ["Founder-led sales"], origin: "stated" },
  entities: { values: ["Acme"], origin: "derived", source: "entity graph" },
} satisfies BusinessBlueprint);

async function insertBusinessProfile(
  t: ReturnType<typeof makeTest>,
  tenantId: string,
  profile: BusinessProfile,
): Promise<Id<"vaultDocuments">> {
  return await insertVaultDocument(t, {
    tenantId,
    kind: "business_profile",
    text: serializeProfile(profile),
  });
}

async function rejectionData(promise: Promise<unknown>): Promise<{ code?: string }> {
  try {
    await promise;
  } catch (error) {
    return ((error as { data?: unknown }).data ?? {}) as { code?: string };
  }
  throw new Error("expected the call to reject");
}

const tenantRows = (t: ReturnType<typeof makeTest>, tenantId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
  );

const tenantVaultDocs = (t: ReturnType<typeof makeTest>, tenantId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
  );

const scheduledFunctions = (t: ReturnType<typeof makeTest>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

const blueprintConfirmedRows = (t: ReturnType<typeof makeTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("audit").collect()).filter(
      (row) => row.eventType === "blueprint.confirmed",
    ),
  );

type DraftBlob = {
  blueprint: BusinessBlueprint;
  diff: BlueprintDiffRow[];
  sourceDocIds: string[];
};

const confirmationDraft = (
  sourceDocIds: string[],
  derivedTargetCustomer = "Independent consultants",
): DraftBlob => {
  const statedTargetCustomer = {
    values: ["Independent hotels"],
    origin: "stated" as const,
  };
  const derived = {
    values: [derivedTargetCustomer],
    origin: "derived" as const,
    source: "market-research.md",
  };
  return {
    blueprint: {
      name: { values: ["Acme"], origin: "stated" },
      oneLineDescription: {
        values: ["Spring-water systems for growing hotels."],
        origin: "stated",
      },
      stage: { values: ["growing"], origin: "stated" },
      tier: { values: ["startup"], origin: "stated" },
      offering: {
        values: ["Spring-water filtration systems"],
        origin: "derived",
        source: "product-notes.md",
      },
      targetCustomer: statedTargetCustomer,
      revenueModel: null,
      bindingConstraint: null,
      primaryGoals: { values: ["Reach 50 hotel customers"], origin: "stated" },
      knownConstraints: { values: ["Founder-led sales"], origin: "stated" },
      entities: null,
    },
    diff: [
      {
        kind: "addition",
        field: "offering",
        derived: {
          values: ["Spring-water filtration systems"],
          origin: "derived",
          source: "product-notes.md",
        },
      },
      {
        kind: "contradiction",
        field: "targetCustomer",
        stated: statedTargetCustomer,
        derived,
      },
    ],
    sourceDocIds,
  };
};

async function writeDraftFixture(
  t: ReturnType<typeof makeTest>,
  tenantId: string,
  draft: DraftBlob,
): Promise<void> {
  await t.mutation(internal.blueprint.writeDraft, {
    tenantId,
    draftJson: JSON.stringify(draft),
  });
}

async function insertLiveBlueprint(
  t: ReturnType<typeof makeTest>,
  tenantId: string,
  {
    sourceDocIds = [],
    draft,
    text = LIVE_BLUEPRINT_TEXT,
  }: {
    sourceDocIds?: string[];
    draft?: string;
    text?: string;
  } = {},
): Promise<Id<"vaultDocuments">> {
  const docId = await insertVaultDocument(t, { tenantId, text });
  await insertTenantProfile(t, tenantId, {
    docId,
    sourceDocIds,
    confirmedAt: 1_725_000_000_000,
    draft,
  });
  return docId;
}

describe("blueprint live read plane", () => {
  test("returns the owning tenant's live blueprint", async () => {
    const t = makeTest();
    const docId = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      text: "# Acme Blueprint",
    });
    await insertTenantProfile(t, "tenant_a", {
      docId,
      sourceDocIds: ["source-a", "source-b"],
      confirmedAt: 1_725_000_000_000,
    });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toEqual({
      docId,
      text: "# Acme Blueprint",
      sourceDocIds: ["source-a", "source-b"],
      confirmedAt: 1_725_000_000_000,
    });
  });

  test("returns null when the tenant profile row is absent", async () => {
    const t = makeTest();

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_missing" }),
    ).resolves.toBeNull();
  });

  test("returns null when the tenant profile has no blueprint pointer", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });

  test("returns null when the pointed-to blueprint document was deleted", async () => {
    const t = makeTest();
    const docId = await insertVaultDocument(t, { tenantId: "tenant_a" });
    await insertTenantProfile(t, "tenant_a", { docId });
    await t.run(async (ctx) => {
      await ctx.db.delete(docId);
    });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });

  test("returns null when the pointed-to blueprint belongs to another tenant", async () => {
    const t = makeTest();
    const tenantADoc = await insertVaultDocument(t, { tenantId: "tenant_a" });
    await insertTenantProfile(t, "tenant_b", { docId: tenantADoc });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_b" }),
    ).resolves.toBeNull();
  });

  test.each([
    { kind: "business_profile", text: "# Not a blueprint" },
    { kind: "business_blueprint", text: undefined },
  ])("returns null for an invalid pointed-to document: %o", async ({ kind, text }) => {
    const t = makeTest();
    const docId = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind,
      text,
    });
    await insertTenantProfile(t, "tenant_a", { docId });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });
});

describe("blueprint top entities", () => {
  test("returns at most 20 tenant-scoped names ordered by descending degree", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      for (let degree = 0; degree < 25; degree += 1) {
        await ctx.db.insert("graphNodes", {
          tenantId: "tenant_a",
          type: "topic",
          name: `Entity ${degree}`,
          normalizedName: `entity-${degree}`,
          degree,
        });
      }
      await ctx.db.insert("graphNodes", {
        tenantId: "tenant_b",
        type: "topic",
        name: "Tenant B secret",
        normalizedName: "tenant-b-secret",
        degree: 10_000,
      });
    });

    const names = await t.query(internal.blueprint.topEntities, {
      tenantId: "tenant_a",
    });

    expect(names).toEqual(Array.from({ length: 20 }, (_, index) => `Entity ${24 - index}`));
    expect(names).not.toContain("Tenant B secret");
  });

  test("returns an empty list for a tenant with no graph", async () => {
    const t = makeTest();

    await expect(
      t.query(internal.blueprint.topEntities, { tenantId: "tenant_empty" }),
    ).resolves.toEqual([]);
  });
});

describe("blueprint spine and Stage-1 drift", () => {
  test("reports exactly one unincorporated ready document, then removes it when processing", async () => {
    const t = makeTest();
    const incorporatedA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "A",
    });
    const incorporatedB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "B",
    });
    const unincorporated = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "C",
    });
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: [incorporatedA, incorporatedB],
    });

    const stale = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(stale).toContain("⚠ 1 documents");

    await t.run(async (ctx) => {
      await ctx.db.patch(unincorporated, { status: "processing" });
    });
    const current = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(current).not.toContain("documents have been added");
  });

  test("uses a set difference when recorded source ids are stale", async () => {
    const t = makeTest();
    for (const text of ["A", "B", "C"]) {
      await insertVaultDocument(t, {
        tenantId: "tenant_a",
        kind: "upload",
        text,
      });
    }
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: ["deleted-source-a", "deleted-source-b"],
    });

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).toContain("⚠ 3 documents");
    expect(spine).not.toContain("⚠ 1 documents");
  });

  test("omits staleness when every ready source document is incorporated", async () => {
    const t = makeTest();
    const sourceIds = await Promise.all(
      ["A", "B", "C"].map((text) =>
        insertVaultDocument(t, {
          tenantId: "tenant_a",
          kind: "upload",
          text,
        }),
      ),
    );
    await insertLiveBlueprint(t, "tenant_a", { sourceDocIds: sourceIds });

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).not.toContain("documents have been added");
  });

  test("keeps live staleness unchanged when a draft exists", async () => {
    const t = makeTest();
    const incorporatedA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "A",
    });
    const incorporatedB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "B",
    });
    await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "C",
    });
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: [incorporatedA, incorporatedB],
      draft: JSON.stringify({
        blueprint: { unrelated: true },
        sourceDocIds: ["draft-covers-everything"],
      }),
    });

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).toContain("⚠ 1 documents");
  });

  test("returns null when the tenant has no live blueprint", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");
    await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "Ready but no blueprint exists",
    });

    await expect(
      t.query(internal.blueprint.spineForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });

  test("renders the marked spine within the dedicated character cap", async () => {
    const t = makeTest();
    await insertLiveBlueprint(t, "tenant_a");

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).toContain("[stated]");
    expect(spine).toContain("[source: source-a.md]");
    expect(spine?.length).toBeLessThanOrEqual(SPINE_CHAR_CAP);
  });

  test("reflects two unincorporated documents and then zero", async () => {
    const t = makeTest();
    const sourceA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "A",
    });
    const sourceB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "B",
    });
    await insertLiveBlueprint(t, "tenant_a");

    const stale = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(stale).toContain("⚠ 2 documents");

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("tenantProfiles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "tenant_a"))
        .unique();
      if (profile === null) throw new Error("missing fixture profile");
      await ctx.db.patch(profile._id, {
        blueprintSourceDocIds: [sourceA, sourceB],
      });
    });
    const current = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(current).not.toContain("documents have been added");
  });

  test("never returns another tenant's spine", async () => {
    const t = makeTest();
    const tenantADoc = await insertLiveBlueprint(t, "tenant_a");
    await insertTenantProfile(t, "tenant_b", { docId: tenantADoc });

    await expect(
      t.query(internal.blueprint.spineForTenant, { tenantId: "tenant_b" }),
    ).resolves.toBeNull();
  });
});

describe("blueprint candidate synthesis", () => {
  test("fails closed before the offline seam when the registry skill is unseeded", async () => {
    const t = makeTest();

    await expect(t.action(internal.blueprint.deriveCandidates, smokeDeriveArgs)).rejects.toThrow(
      /NO_ACTIVE_SKILL/,
    );
  });

  test("returns both guardrail refusals as governed stops", async () => {
    const killSwitchTest = makeTest();
    await seedBlueprintSkill(killSwitchTest);
    await killSwitchTest.mutation(internal.guardrails.setKillSwitch, { on: true });

    await expect(
      killSwitchTest.action(internal.blueprint.deriveCandidates, smokeDeriveArgs),
    ).resolves.toEqual({ ok: false, reason: "kill_switch" });

    const budgetTest = makeTest();
    await seedBlueprintSkill(budgetTest);
    await budgetTest.mutation(internal.guardrails.recordSpend, {
      tenantId: "tenant_a",
      costUsd: 10,
    });

    await expect(
      budgetTest.action(internal.blueprint.deriveCandidates, smokeDeriveArgs),
    ).resolves.toEqual({ ok: false, reason: "daily_budget_exhausted" });
  });

  test("returns deterministic source-indexed candidates from the offline seam without spend", async () => {
    const t = makeTest();
    await seedBlueprintSkill(t);
    const before = await t.query(internal.guardrails.remainingDailyCents, { tenantId: "tenant_a" });

    await expect(t.action(internal.blueprint.deriveCandidates, smokeDeriveArgs)).resolves.toEqual({
      ok: true,
      candidates: [
        {
          field: "offering",
          values: ["Spring water systems"],
          sourceIndex: 0,
        },
      ],
    });

    await expect(
      t.query(internal.guardrails.remainingDailyCents, { tenantId: "tenant_a" }),
    ).resolves.toBe(before);
  });
});

describe("blueprint draft build", () => {
  test("refuses a tenant with no tier row before any write or spend (item 12)", async () => {
    const t = makeTest();
    await insertBusinessProfile(t, "tenant_missing", TYPED_PROFILE);
    const rowsBefore = await tenantRows(t, "tenant_missing");
    const spendBefore = await t.query(internal.guardrails.remainingDailyCents, {
      tenantId: "tenant_a",
    });

    const refused = await rejectionData(
      t.withIdentity({ subject: "tenant_missing" }).action(api.blueprint.buildBlueprintDraft, {}),
    );
    const directWriteRefused = await rejectionData(
      t.mutation(internal.blueprint.writeDraft, {
        tenantId: "tenant_missing",
        draftJson: "{}",
      }),
    );

    expect(refused.code).toBe("NO_TENANT_PROFILE");
    expect(directWriteRefused.code).toBe("NO_TENANT_PROFILE");
    expect(await tenantRows(t, "tenant_missing")).toEqual(rowsBefore);
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: "tenant_a" })).toBe(
      spendBefore,
    );
  });

  test("a fully typed profile edit reuses live derived fields with no probe, model call, or vault write", async () => {
    const t = makeTest();
    const profileDocId = await insertBusinessProfile(t, "tenant_a", TYPED_PROFILE);
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: [profileDocId],
      text: FULL_LIVE_BLUEPRINT_TEXT,
    });
    await t.run((ctx) =>
      ctx.db.insert("graphNodes", {
        tenantId: "tenant_a",
        type: "organization",
        name: "Acme",
        normalizedName: "acme",
        degree: 10,
      }),
    );
    const vaultCountBefore = (await tenantVaultDocs(t, "tenant_a")).length;
    const spendBefore = await t.query(internal.guardrails.remainingDailyCents, {
      tenantId: "tenant_a",
    });

    await expect(
      t.withIdentity({ subject: "tenant_a" }).action(api.blueprint.buildBlueprintDraft, {}),
    ).resolves.toEqual({
      ok: true,
      additions: 0,
      contradictions: 0,
      dropped: 0,
      sourceDocCount: 0,
    });

    const [firstRow] = await tenantRows(t, "tenant_a");
    expect(firstRow?.blueprintDraft).toBeTruthy();
    expect(firstRow?.blueprintSourceDocIds).toEqual([profileDocId]);
    expect((await tenantVaultDocs(t, "tenant_a")).length).toBe(vaultCountBefore);
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: "tenant_a" })).toBe(
      spendBefore,
    );

    const firstDraft = firstRow?.blueprintDraft;
    await t.run((ctx) =>
      ctx.db.patch(profileDocId, {
        text: serializeProfile({
          ...TYPED_PROFILE,
          oneLineDescription: "A one-line edit that must stay free.",
        }),
      }),
    );
    await t.withIdentity({ subject: "tenant_a" }).action(api.blueprint.buildBlueprintDraft, {});

    const [secondRow] = await tenantRows(t, "tenant_a");
    expect(secondRow?.blueprintDraft).not.toBe(firstDraft);
    expect(secondRow?.blueprintSourceDocIds).toEqual([profileDocId]);
    expect((await tenantVaultDocs(t, "tenant_a")).length).toBe(vaultCountBefore);
    const draft = JSON.parse(secondRow?.blueprintDraft ?? "{}") as {
      blueprint?: BusinessBlueprint;
      sourceDocIds?: string[];
    };
    expect(draft.blueprint?.oneLineDescription?.values).toEqual([
      "A one-line edit that must stay free.",
    ]);
    expect(draft.sourceDocIds).toEqual([profileDocId]);
  });

  test("grounds sparse-profile probes in closed-field order and dedupes sources by doc id", async () => {
    const sparse = { ...TYPED_PROFILE, offering: "", targetCustomer: "" };
    const probes = probesFor(statedFromProfile(sparse, "startup", []));
    const calls: string[] = [];

    const sources = await __collectGroundedSources(probes, async (query) => {
      calls.push(query);
      return {
        docIds: ["shared-doc", `doc-${calls.length}`],
        titles: ["Shared source", `Source ${calls.length}`],
        chunks: ["First stable passage", `Passage ${calls.length}`],
      };
    });

    expect(calls).toEqual(probes.map(({ query }) => query));
    expect(probes.map(({ field }) => field)).toEqual([
      "offering",
      "targetCustomer",
      "revenueModel",
      "bindingConstraint",
    ]);
    expect(sources.map(({ docId }) => docId)).toEqual([
      "shared-doc",
      "doc-1",
      "doc-2",
      "doc-3",
      "doc-4",
    ]);
    expect(sources[0]).toEqual({
      docId: "shared-doc",
      title: "Shared source",
      text: "First stable passage",
    });
  });
});

describe("blueprint confirmation gate", () => {
  test("keeps a draft out of the spine, then confirms and re-confirms one ready non-ingested document in place", async () => {
    const t = makeTest();
    const profileDocId = await insertBusinessProfile(t, "tenant_a", TYPED_PROFILE);
    const sourceA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "Product notes",
    });
    const sourceB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "Market research",
    });
    await insertTenantProfile(t, "tenant_a");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("tenantProfiles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "tenant_a"))
        .unique();
      if (!row) throw new Error("missing tenant profile fixture");
      await ctx.db.patch(row._id, { blueprintSourceDocIds: ["previous-live-source"] });
    });
    const profileTextBefore = await t.run(async (ctx) => (await ctx.db.get(profileDocId))?.text);
    const firstDraft = confirmationDraft([sourceA, sourceB]);
    await writeDraftFixture(t, "tenant_a", firstDraft);

    await expect(
      t.query(internal.blueprint.spineForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
    expect((await tenantRows(t, "tenant_a"))[0]?.blueprintSourceDocIds).toEqual([
      "previous-live-source",
    ]);

    const asTenantA = t.withIdentity({ subject: "tenant_a" });
    const first = await asTenantA.mutation(api.blueprint.confirmBlueprint, {
      acceptedContradictions: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`Expected blueprint confirmation, got ${first.reason}`);

    const rowsAfterFirst = await tenantRows(t, "tenant_a");
    const rowAfterFirst = rowsAfterFirst[0];
    const blueprintDocsAfterFirst = (await tenantVaultDocs(t, "tenant_a")).filter(
      (doc) => doc.kind === "business_blueprint",
    );
    expect(blueprintDocsAfterFirst).toHaveLength(1);
    const firstBlueprintDoc = blueprintDocsAfterFirst[0];
    expect(firstBlueprintDoc?._id).toBe(first.docId);
    expect(firstBlueprintDoc?.status).toBe("ready");
    expect(firstBlueprintDoc?.ragEntryId).toBeUndefined();
    expect(deserializeBlueprint(firstBlueprintDoc?.text ?? "").targetCustomer?.values).toEqual([
      "Independent hotels",
    ]);
    expect(rowAfterFirst?.blueprintDocId).toBe(firstBlueprintDoc?._id);
    expect(rowAfterFirst?.blueprintSourceDocIds).toEqual([sourceA, sourceB]);
    expect(rowAfterFirst?.blueprintConfirmedAt).toEqual(expect.any(Number));
    expect(rowAfterFirst?.blueprintDraft).toBeUndefined();
    expect(rowAfterFirst?.blueprintDraftAt).toBeUndefined();
    expect(await scheduledFunctions(t)).toHaveLength(0);

    const secondDraft = confirmationDraft([sourceB], "Boutique consultancies");
    await writeDraftFixture(t, "tenant_a", secondDraft);
    const second = await asTenantA.mutation(api.blueprint.confirmBlueprint, {
      acceptedContradictions: ["targetCustomer"],
    });
    expect(second).toEqual({ ok: true, docId: firstBlueprintDoc?._id });

    const blueprintDocsAfterSecond = (await tenantVaultDocs(t, "tenant_a")).filter(
      (doc) => doc.kind === "business_blueprint",
    );
    expect(blueprintDocsAfterSecond).toHaveLength(1);
    expect(blueprintDocsAfterSecond[0]?._id).toBe(firstBlueprintDoc?._id);
    expect(deserializeBlueprint(blueprintDocsAfterSecond[0]?.text ?? "").targetCustomer).toEqual({
      values: ["Boutique consultancies"],
      origin: "derived",
      source: "market-research.md",
    });
    expect((await tenantRows(t, "tenant_a"))[0]?.blueprintSourceDocIds).toEqual([sourceB]);
    expect(await t.run(async (ctx) => (await ctx.db.get(profileDocId))?.text)).toBe(
      profileTextBefore,
    );
    expect(await scheduledFunctions(t)).toHaveLength(0);
  });

  test("returns a no-op refusal when no draft exists", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");

    await expect(
      t.withIdentity({ subject: "tenant_a" }).mutation(api.blueprint.confirmBlueprint, {
        acceptedContradictions: [],
      }),
    ).resolves.toEqual({ ok: false, reason: "no_draft" });
    expect(await tenantVaultDocs(t, "tenant_a")).toHaveLength(0);
  });

  test("rejects an unknown accepted field without consuming the draft", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");
    await writeDraftFixture(t, "tenant_a", confirmationDraft([]));

    await expect(
      t.withIdentity({ subject: "tenant_a" }).mutation(api.blueprint.confirmBlueprint, {
        acceptedContradictions: ["browser-invented-field"],
      }),
    ).rejects.toThrow(/INVALID_BLUEPRINT_FIELD/);
    expect((await tenantRows(t, "tenant_a"))[0]?.blueprintDraft).toBeTruthy();
    expect(await tenantVaultDocs(t, "tenant_a")).toHaveLength(0);
  });

  test("confirming tenant B never reads or changes tenant A's draft or document", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");
    await insertTenantProfile(t, "tenant_b");
    const tenantADraft = confirmationDraft([], "Tenant A confidential audience");
    const tenantBDraft = confirmationDraft([], "Tenant B audience");
    await writeDraftFixture(t, "tenant_a", tenantADraft);
    await writeDraftFixture(t, "tenant_b", tenantBDraft);
    const tenantABefore = (await tenantRows(t, "tenant_a"))[0]?.blueprintDraft;

    await t.withIdentity({ subject: "tenant_b" }).mutation(api.blueprint.confirmBlueprint, {
      acceptedContradictions: ["targetCustomer"],
    });

    expect((await tenantRows(t, "tenant_a"))[0]?.blueprintDraft).toBe(tenantABefore);
    expect(
      (await tenantVaultDocs(t, "tenant_a")).filter((doc) => doc.kind === "business_blueprint"),
    ).toHaveLength(0);
    const tenantBDoc = (await tenantVaultDocs(t, "tenant_b")).find(
      (doc) => doc.kind === "business_blueprint",
    );
    expect(deserializeBlueprint(tenantBDoc?.text ?? "").targetCustomer?.values).toEqual([
      "Tenant B audience",
    ]);
  });
});

describe("blueprint confirmation audit", () => {
  test("pins the refs/counts-only key set and exact counts (VALIDATION item 13)", async () => {
    const t = makeTest();
    const sourceA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "Source A",
    });
    const sourceB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "Source B",
    });
    await insertTenantProfile(t, "tenant_a");
    await writeDraftFixture(
      t,
      "tenant_a",
      confirmationDraft([sourceA, sourceB], "Independent consultants"),
    );

    const confirmed = await t
      .withIdentity({ subject: "tenant_a" })
      .mutation(api.blueprint.confirmBlueprint, {
        acceptedContradictions: ["targetCustomer"],
      });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(`Expected blueprint confirmation, got ${confirmed.reason}`);

    const rows = await blueprintConfirmedRows(t);
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "additionsApplied",
      "contradictionsAccepted",
      "docId",
      "fieldCount",
      "sourceDocCount",
    ]);
    expect(payload).toEqual({
      docId: confirmed.docId,
      sourceDocCount: 2,
      fieldCount: 8,
      additionsApplied: 1,
      contradictionsAccepted: 1,
    });
    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).toContain("docId");
    expect(payloadJson).not.toContain("Independent consultants");
    expect(rows[0]?.tenantId).toBe("tenant_a");
    expect(rows[0]?.actor).toBe("user");
  });
});

describe("blueprint state and draft discard", () => {
  test("returns none, live, live_stale, then draft with the persisted diff taking precedence", async () => {
    const noneTest = makeTest();
    await expect(
      noneTest.withIdentity({ subject: "tenant_none" }).query(api.blueprint.blueprintState, {}),
    ).resolves.toEqual({
      state: "none",
      live: null,
      draft: null,
      diff: [],
      unincorporatedCount: 0,
      confirmedAt: null,
    });

    const t = makeTest();
    await insertLiveBlueprint(t, "tenant_a");
    const asTenantA = t.withIdentity({ subject: "tenant_a" });
    const live = await asTenantA.query(api.blueprint.blueprintState, {});
    expect(live.state).toBe("live");
    expect(live.live?.name?.values).toEqual(["Acme"]);
    expect(live.draft).toBeNull();
    expect(live.diff).toEqual([]);
    expect(live.unincorporatedCount).toBe(0);
    expect(live.confirmedAt).toBe(1_725_000_000_000);

    const newSource = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "New unincorporated evidence",
    });
    const stale = await asTenantA.query(api.blueprint.blueprintState, {});
    expect(stale.state).toBe("live_stale");
    expect(stale.unincorporatedCount).toBe(1);

    const persistedDraft = confirmationDraft([newSource], "Independent consultants");
    await writeDraftFixture(t, "tenant_a", persistedDraft);
    const draft = await asTenantA.query(api.blueprint.blueprintState, {});
    expect(draft.state).toBe("draft");
    expect(draft.live?.name?.values).toEqual(["Acme"]);
    expect(draft.draft).toEqual(persistedDraft.blueprint);
    expect(draft.diff).toEqual(persistedDraft.diff);
    expect(draft.unincorporatedCount).toBe(1);
  });

  test("discard clears only draft fields and returns to the underlying live state", async () => {
    const t = makeTest();
    const liveDocId = await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: ["previous-live-source"],
    });
    await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "New unincorporated evidence",
    });
    await writeDraftFixture(t, "tenant_a", confirmationDraft(["draft-only-source"]));
    const before = (await tenantRows(t, "tenant_a"))[0];

    await expect(
      t.withIdentity({ subject: "tenant_a" }).mutation(api.blueprint.discardDraft, {}),
    ).resolves.toEqual({ ok: true });

    const after = (await tenantRows(t, "tenant_a"))[0];
    expect(after?.blueprintDraft).toBeUndefined();
    expect(after?.blueprintDraftAt).toBeUndefined();
    expect(after?.blueprintDocId).toBe(liveDocId);
    expect(after?.blueprintDocId).toBe(before?.blueprintDocId);
    expect(after?.blueprintSourceDocIds).toEqual(["previous-live-source"]);
    expect(after?.blueprintSourceDocIds).toEqual(before?.blueprintSourceDocIds);
    await expect(
      t.withIdentity({ subject: "tenant_a" }).query(api.blueprint.blueprintState, {}),
    ).resolves.toMatchObject({ state: "live_stale", draft: null, diff: [] });
    expect(await blueprintConfirmedRows(t)).toHaveLength(0);
  });

  test("discard returns none without a live document and never throws for a missing row", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");
    await writeDraftFixture(t, "tenant_a", confirmationDraft([]));

    await expect(
      t.withIdentity({ subject: "tenant_a" }).mutation(api.blueprint.discardDraft, {}),
    ).resolves.toEqual({ ok: true });
    await expect(
      t.withIdentity({ subject: "tenant_a" }).query(api.blueprint.blueprintState, {}),
    ).resolves.toMatchObject({ state: "none", live: null, draft: null });
    await expect(
      t.withIdentity({ subject: "tenant_missing" }).mutation(api.blueprint.discardDraft, {}),
    ).resolves.toEqual({ ok: false });
  });

  test("tenant B state never contains tenant A's live or draft content", async () => {
    const t = makeTest();
    await insertLiveBlueprint(t, "tenant_a");
    await writeDraftFixture(t, "tenant_a", confirmationDraft([], "Tenant A confidential audience"));

    const tenantB = await t
      .withIdentity({ subject: "tenant_b" })
      .query(api.blueprint.blueprintState, {});
    expect(tenantB).toEqual({
      state: "none",
      live: null,
      draft: null,
      diff: [],
      unincorporatedCount: 0,
      confirmedAt: null,
    });
    expect(JSON.stringify(tenantB)).not.toContain("Tenant A confidential audience");
  });
});
