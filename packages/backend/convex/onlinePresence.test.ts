// @vitest-environment node
import { readFileSync } from "node:fs";
import { onlinePresenceSpecialistSkillBody } from "@pikar/contracts/skills/onlinePresenceSpecialist";
import {
  WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
  WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
  WEB_RECIPE_BROWSER_RUNNER,
  WEB_RECIPE_PROVENANCE_SCHEMA,
  WEB_RECIPE_REQUIRED_VIEWPORTS,
  WEB_RECIPE_UPSTREAM_PROVENANCE,
} from "@pikar/contracts/webRecipeSkill";
import type { WebDocument } from "@pikar/contracts/webRuntime";
import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import { ONLINE_PRESENCE_TOOLS } from "@pikar/core/onlinePresence";
import { renderDesignedWebDocument } from "@pikar/core/webDesignRenderer";
import { canonicalWebLayoutPlan } from "@pikar/core/webLayoutPlan";
import {
  canonicalWebRecipeDefinition,
  WEB_RECIPE_BUNDLE_HASH,
  WEB_RECIPE_COMPILER_ID,
  WEB_RECIPE_DEFINITIONS,
} from "@pikar/core/webRecipes";
import { canonicalWebDocument, sha256Bytes } from "@pikar/core/webRuntime";
import { type FunctionReference, getFunctionName, makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { artifactHashes } from "./lib/presencePublication";
import { runSpecialistTurn } from "./llm";
import schema from "./schema";
import { evaluateWebRecipeCandidate } from "./webRecipeEvals";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
async function setup(text = "Acme designs gardens for homeowners.") {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const threadId = "online-presence-test-thread";
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId, threadId });
  const session = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    threadId,
    planId,
    text,
  });
  const brief = {
    kind: "website",
    businessName: "Acme",
    headline: "Gardens designed around you",
    summary: "Garden design for homeowners.",
    audience: "Homeowners",
    sourceRefs: [session.sourceRef],
  };
  return { t, tenantId, threadId, planId, session, brief };
}
type Stack = Awaited<ReturnType<typeof setup>>;
/** OFFLINE provider fixture only. These hashes prove native finalization, never real provider
 * execution or browser quality. Production code cannot invoke this test helper. */
async function offlineProviderBuild(
  t: Stack["t"],
  args: {
    tenantId: string;
    planId: Id<"plans">;
    expectedRevision: number;
  },
) {
  const snapshot = await t.mutation(internal.onlinePresence.designSnapshot, args);
  if (!("document" in snapshot)) return t.mutation(internal.onlinePresence.buildProject, args);
  const digest = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
  const layoutPlan = canonicalWebLayoutPlan({
    version: 1,
    hero: "overlay-left",
    sectionLayout: "editorial-columns",
    services: "rows",
    gallery: "carousel",
    spacing: "relaxed",
    headingScale: "balanced",
    motion: "subtle",
  });
  const profile = { ...snapshot.recipeRef.designProfile, layoutPlan };
  if (!validateDesignProfileRef(profile)) throw Error("Invalid offline profile fixture");
  const runRef = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const identity = {
    tenantId: args.tenantId,
    planId: args.planId,
    revision: args.expectedRevision,
    runRef,
  };
  const stitchHash = digest("OFFLINE mocked Stitch reference"),
    kimiHash = digest("OFFLINE mocked Kimi plan");
  const hashes = artifactHashes(
    snapshot.document.pages.map((page) => ({
      pageSlug: page.slug,
      html: renderDesignedWebDocument(snapshot.document, profile, {
        slug: snapshot.slug,
        page: page.slug,
      }),
    })),
  );
  await t.mutation(makeFunctionReference<"mutation">("presenceDesignControl:claim"), {
    ...identity,
    workflow: true,
    sourceFingerprint: snapshot.sourceFingerprint,
  });
  await t.mutation(makeFunctionReference<"mutation">("presenceDesignControl:advance"), {
    ...identity,
    phase: "stitch_complete",
    designHash: stitchHash,
  });
  await t.mutation(makeFunctionReference<"mutation">("presenceDesignControl:advance"), {
    ...identity,
    phase: "kimi_complete",
    designHash: stitchHash,
    proposalHash: kimiHash,
    documentHash: sha256Bytes(new TextEncoder().encode(canonicalWebDocument(snapshot.document))),
    artifactsHash: digest(hashes),
  });
  return t.mutation(internal.onlinePresence.buildProject, {
    ...args,
    designCompletion: {
      profile,
      providerReceipt: {
        pipelineVersion: "stitch-kimi-required-v1",
        runRef,
        stitchHash,
        kimiHash,
        sourceFingerprint: snapshot.sourceFingerprint,
        briefHash: snapshot.briefHash,
        layoutHash: digest(layoutPlan),
        artifactHashes: hashes,
        pendingBrowser: true,
      },
    },
  });
}
async function vault(t: Stack["t"], tenantId: string, overrides: Record<string, unknown> = {}) {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business facts",
      kind: "upload",
      category: "operations",
      source: "upload",
      mimeType: "text/plain",
      size: 40,
      contentHash: "a".repeat(64),
      text: "Acme designs gardens.",
      status: "ready",
      createdAt: Date.now(),
      ...overrides,
    }),
  );
}

/** Isolated database fixture only. These are test rows, never a deployed qualification receipt. */
async function activeRecipe(t: Stack["t"]) {
  const definition = WEB_RECIPE_DEFINITIONS.find((entry) => entry.id === "business-site");
  if (!definition) throw new Error("Missing business recipe");
  const id = await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: definition.registryName,
      version: 1,
      body: canonicalWebRecipeDefinition(definition),
      status: "active",
      createdAt: 1,
    }),
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("Missing recipe row");
  const evidence = evaluateWebRecipeCandidate(row, "online-presence-fixture", 1);
  const provenance = JSON.stringify({
    schemaVersion: WEB_RECIPE_PROVENANCE_SCHEMA,
    name: row.name,
    version: row.version,
    bodySha256: evidence.bodyHash,
    definitionHash: evidence.definitionHash,
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    compilerId: WEB_RECIPE_COMPILER_ID,
    skillVersions: { [row.name]: row.version },
    upstream: WEB_RECIPE_UPSTREAM_PROVENANCE[definition.registryName],
  });
  const browserEvidence = JSON.stringify({
    runner: WEB_RECIPE_BROWSER_RUNNER,
    runId: "online-presence-fixture",
    pass: true,
    authenticated: true,
    actorClass: "owner",
    route: "/ops",
    rendered: true,
    skillId: String(id),
    name: row.name,
    version: row.version,
    bodyHash: evidence.bodyHash,
    definitionHash: evidence.definitionHash,
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    evidenceRevision: WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
    viewports: WEB_RECIPE_REQUIRED_VIEWPORTS,
    casesPassed: 1,
    casesTotal: 1,
    revision: 1,
    outcomeRefs: WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
    transcriptHash: "b".repeat(64),
    ts: 1,
  });
  await t.run((ctx) =>
    ctx.db.patch(id, { evidence: JSON.stringify(evidence), provenance, browserEvidence }),
  );
}

test("actual human messages become source records; forged tenant and thread lineage is refused", async () => {
  const { t, tenantId, planId, threadId, session } = await setup();
  const context = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
  expect(context.sources).toContainEqual(
    expect.objectContaining({ ref: session.sourceRef, kind: "user", visibility: "unspecified" }),
  );
  await expect(
    t.query(internal.onlinePresence.contextForTenant, { tenantId: "another-tenant", planId }),
  ).rejects.toThrow("ONLINE_PRESENCE_UNAVAILABLE");
  await expect(
    t.mutation(internal.onlinePresence.ensureSession, {
      tenantId,
      planId,
      threadId: "other",
      text: "Forged",
    }),
  ).rejects.toThrow("ONLINE_PRESENCE_UNAVAILABLE");
  const stranger = await t.run((ctx) => ctx.db.insert("users", {}));
  expect(
    await t
      .withIdentity({ subject: `${stranger}|session` })
      .query(api.onlinePresence.sessionForThread, { threadId }),
  ).toBeNull();
});

test("the initial start/send handoff is idempotent while later repeated answers remain actual turns", async () => {
  const { t, tenantId, planId, threadId, session, brief } = await setup();
  expect(
    await t.mutation(internal.onlinePresence.ensureSession, {
      tenantId,
      planId,
      threadId,
      text: "Acme designs gardens for homeowners.",
    }),
  ).toEqual(session);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    brief,
    expectedRevision: session.revision,
  });
  const later = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    planId,
    threadId,
    text: "Acme designs gardens for homeowners.",
  });
  expect(later.revision).toBe(saved.revision + 1);
  expect(later.sourceRef).not.toBe(session.sourceRef);
});

test("the public cockpit refuses a service conversation registered as an authoring probe before any turn or model work", async () => {
  const { t, tenantId, planId, threadId, session } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("spendEvents", {
      tenantId,
      rail: "reasoning",
      phase: "reserved",
      amountCents: 100,
      correlationId: "online-presence-probe-fixture",
      createdAt: Date.now(),
      evalAuthoringProbe: { threadId, authorizationSha256: "a".repeat(64) },
    }),
  );
  await expect(
    t.withIdentity({ subject: `${tenantId}|session` }).action(api.cockpit.sendCockpitMessage, {
      threadId,
      text: "This turn must not reach the website agent.",
    }),
  ).rejects.toThrow("AUTHORING_PROBE_ALTERNATE_ENTRY_REFUSED");
  const after = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
  expect(after.revision).toBe(session.revision);
  expect(after.latestUserMessage).toBe("Acme designs gardens for homeowners.");
  expect(await t.run((ctx) => ctx.db.query("agentSteps").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("spendCoverage").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(1);
});

test("confirmed generated Blueprint is admitted; arbitrary generated or foreign Vault output is not", async () => {
  const { t, tenantId, planId } = await setup();
  const blueprint = await vault(t, tenantId, { kind: "business_blueprint", origin: "agent" });
  const generated = await vault(t, tenantId, { origin: "agent" });
  const foreign = await vault(t, "other-tenant");
  const shared = await vault(t, tenantId, { driveOwnedByMe: false });
  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "solopreneur",
      tierSource: "confirmed",
      derivedAt: 1,
      blueprintDocId: blueprint,
      blueprintConfirmedAt: 1,
    }),
  );
  const result = await t.query(internal.onlinePresence.contextForTenant, {
    tenantId,
    planId,
    sourceRefs: [`vault:${generated}`, `vault:${foreign}`, `vault:${shared}`],
  });
  expect(result.sources).toContainEqual(
    expect.objectContaining({
      ref: `vault:${blueprint}`,
      kind: "blueprint",
      visibility: "private",
    }),
  );
  expect(
    result.sources.some((source) =>
      [generated, foreign, shared].some((id) => source.ref === `vault:${id}`),
    ),
  ).toBe(false);
});

test("shop intent asks for catalogue facts without creating a pretend shop", async () => {
  const { t, tenantId, planId, session, brief, threadId } = await setup();
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, kind: "shop" },
  });
  expect(saved.ok).toBe(false);
  expect(saved.assessment).toMatchObject({
    ok: false,
    missing: [expect.objectContaining({ field: "catalogue", reason: "missing" })],
  });
  const row = await t
    .withIdentity({ subject: `${tenantId}|session` })
    .query(api.onlinePresence.sessionForThread, { threadId });
  expect(row?.status).toBe("collecting");
  expect(row?.brief.kind).toBe("shop");
  expect(await t.run((ctx) => ctx.db.query("webProjects").collect())).toEqual([]);
});

test("source ownership and session revision are checked at every save", async () => {
  const { t, tenantId, planId, session, brief } = await setup();
  const foreign = await vault(t, "other-tenant");
  const refused = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, sourceRefs: [`vault:${foreign}`] },
  });
  expect(refused.assessment).toMatchObject({
    ok: false,
    missing: [expect.objectContaining({ reason: "unknown_source" })],
  });
  await expect(
    t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: session.revision,
      brief,
    }),
  ).rejects.toThrow("STALE_REVISION");
});

test("a model cannot invent consent wording or a booking destination", async () => {
  const { t, tenantId, planId, session, brief } = await setup();
  for (const changed of [
    { contactConsent: "I consent to marketing." },
    { ctaLabel: "Book a consultation", ctaHref: "https://invented.example/booking" },
  ]) {
    const result = await t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: session.revision,
      brief: { ...brief, ...changed },
    });
    expect(result.ok).toBe(false);
    expect(result.assessment).toMatchObject({
      ok: false,
      missing: [expect.objectContaining({ reason: "missing" })],
    });
    expect(result.revision).toBe(session.revision);
  }
});

test("a same-thread consent-only brief explicitly clears an earlier unsupported mailto CTA", async () => {
  const consent = "I consent to Acme contacting me about my inquiry.";
  const { t, tenantId, planId, session, brief, threadId } = await setup(
    `Acme designs gardens. Use an email inquiry form. ${consent}`,
  );
  const refused = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: {
      ...brief,
      contactConsent: consent,
      ctaLabel: "Inquire now",
      ctaHref: "mailto:inquiry@example.com",
    },
  });
  expect(refused.ok).toBe(false);
  const before = await t
    .withIdentity({ subject: `${tenantId}|session` })
    .query(api.onlinePresence.sessionForThread, { threadId });
  expect(before?.brief.ctaHref).toBe("mailto:inquiry@example.com");
  const stillRefused = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: refused.revision,
    brief: { ...brief, contactConsent: consent },
  });
  expect(stillRefused.ok).toBe(false);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: stillRefused.revision,
    brief: { ...brief, contactConsent: consent },
    clearFields: ["ctaLabel", "ctaHref"],
  });
  expect(saved.ok).toBe(true);
  const after = await t
    .withIdentity({ subject: `${tenantId}|session` })
    .query(api.onlinePresence.sessionForThread, { threadId });
  expect(after?.brief).toMatchObject({ contactConsent: consent });
  expect(after?.brief).not.toHaveProperty("ctaLabel");
  expect(after?.brief).not.toHaveProperty("ctaHref");
  expect(after?.status).toBe("ready");
});

test("clear operations reject duplicates, partial pairs, conflicts, unknown fields and stale revisions", async () => {
  const { t, tenantId, planId, session, brief } = await setup();
  for (const clearFields of [["media", "media"], ["ctaHref"], ["ctaLabel"], ["about"]] as const) {
    const saved = await t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: session.revision,
      brief: { ...brief, about: "Acme designs gardens." },
      clearFields: [...clearFields],
    });
    expect(saved.ok).toBe(false);
    expect(saved.revision).toBe(session.revision);
  }
  await expect(
    t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: session.revision,
      brief,
      clearFields: ["headline"] as never,
    }),
  ).rejects.toThrow();
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief,
  });
  expect(saved.ok).toBe(true);
  await expect(
    t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: session.revision,
      brief,
      clearFields: ["media"],
    }),
  ).rejects.toThrow("STALE_REVISION");
});

test("brand color must be explicit in selected business evidence and survives actual materialization", async () => {
  const { t, tenantId, planId, session, brief } = await setup(
    "Acme designs gardens. Our existing brand color is #246B58.",
  );
  const refused = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, design: { artDirection: "studio", primaryColor: "#112233" } },
  });
  expect(refused.ok).toBe(false);
  expect(refused.assessment).toMatchObject({
    ok: false,
    missing: [expect.objectContaining({ field: "design.primaryColor", reason: "missing" })],
  });
  expect(refused.revision).toBe(session.revision);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, design: { artDirection: "studio", primaryColor: "#246b58" } },
  });
  expect(saved.ok).toBe(true);
  await activeRecipe(t);
  const built = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: saved.revision,
  });
  expect(built.ok).toBe(true);
  const versions = await t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  expect(versions[0]?.document.brand.primaryColor).toBe("#246b58");
  expect(versions[0]?.recipeRef?.designProfile.artDirection).toBe("studio");
  const row = await t.run((ctx) => ctx.db.query("onlinePresenceSessions").first());
  if (!row) throw new Error("Missing service session");
  await t.run((ctx) =>
    ctx.db.patch(row._id, {
      brief: { ...brief, design: { artDirection: "technical", primaryColor: "#112233" } },
    }),
  );
  expect(
    await offlineProviderBuild(t, {
      tenantId,
      planId,
      expectedRevision: built.revision,
    }),
  ).toMatchObject({ ok: false, reason: "brand_color_not_sourced" });
});

test("a six-digit prefix of an eight-digit color is not a sourced brand color", async () => {
  const { t, tenantId, planId, session, brief } = await setup(
    "Acme designs gardens. A document contains #11223344.",
  );
  const result = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, design: { primaryColor: "#112233" } },
  });
  expect(result.ok).toBe(false);
  expect(result.assessment).toMatchObject({
    ok: false,
    missing: [expect.objectContaining({ field: "design.primaryColor" })],
  });
});

test("source changes between saved brief and materialization stop before any project write", async () => {
  const { t, tenantId, planId, session, brief } = await setup();
  const doc = await vault(t, tenantId);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, sourceRefs: [`vault:${doc}`] },
  });
  expect(saved.ok).toBe(true);
  await t.run((ctx) => ctx.db.patch(doc, { text: "Acme now serves a different audience." }));
  const result = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: saved.revision,
  });
  expect(result).toMatchObject({ ok: false, reason: "source_revision_changed" });
  expect(await t.run((ctx) => ctx.db.query("webProjects").collect())).toEqual([]);
});

test("missing active qualification fails closed; deleting tenants cannot create or revise a session", async () => {
  const { t, tenantId, planId, session, brief, threadId } = await setup();
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief,
  });
  await expect(
    offlineProviderBuild(t, {
      tenantId,
      planId,
      expectedRevision: saved.revision,
    }),
  ).rejects.toThrow("WEB_RECIPE_UNAVAILABLE");
  await t.run((ctx) =>
    ctx.db.insert("authRevocations", {
      userId: tenantId,
      state: "deleting",
      expiresAt: Date.now() + 60000,
    }),
  );
  await expect(
    t.mutation(internal.onlinePresence.ensureSession, {
      tenantId,
      planId,
      threadId,
      text: "Continue",
    }),
  ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  await expect(
    t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: saved.revision,
      brief,
    }),
  ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
});

test("a qualified build produces real multiple pages and immutable provenance, with idempotent retries", async () => {
  const {
    t,
    tenantId,
    planId,
    session,
    brief: baseBrief,
  } = await setup(
    "Acme designs gardens for homeowners. Services include planting plans. Acme guides projects from the first layout to the planting plan.",
  );
  const brief = {
    ...baseBrief,
    services: ["Planting plans"],
    about: "Acme guides projects from the first layout to the planting plan.",
  };
  await activeRecipe(t);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief,
  });
  // An active native recipe alone cannot bypass the mandatory provider chain.
  expect(
    await t.mutation(internal.onlinePresence.buildProject, {
      tenantId,
      planId,
      expectedRevision: saved.revision,
    }),
  ).toMatchObject({ ok: false, reason: "required_design_pipeline" });
  expect(await t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toEqual([]);
  const built = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: saved.revision,
  });
  expect(built.ok).toBe(true);
  if (!built.artifact) throw new Error("Missing real artifact");
  const rows = await t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.document.pages.length).toBeGreaterThan(1);
  expect(rows[0]?.sourceRefs).toEqual([expect.stringMatching(/^user:[^#]+#[a-f0-9]{64}$/)]);
  expect(rows[0]?.sourceRefs[0]?.startsWith(`${brief.sourceRefs[0]}#`)).toBe(true);
  expect(rows[0]?.recipeRef?.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  const repeated = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: built.revision,
  });
  expect(repeated.artifact).toEqual(built.artifact);
  expect(await t.run((ctx) => ctx.db.query("webProjects").collect())).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toHaveLength(1);
  await t.run((ctx) =>
    ctx.db.patch(built.artifact?.projectId as Id<"webProjects">, {
      approvedVersion: built.artifact?.version,
      approvedContentHash: "0".repeat(64),
      publishedVersion: built.artifact?.version,
      publishedContentHash: "0".repeat(64),
    }),
  );
  const context = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
  expect(context.artifact).not.toHaveProperty("approvedVersion");
  expect(context.artifact).not.toHaveProperty("publishedVersion");
  const revised = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: built.revision,
    brief: { ...brief, headline: "Outdoor spaces for everyday life" },
  });
  const rebuilt = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: revised.revision,
  });
  expect(rebuilt.artifact?.projectId).toBe(built.artifact.projectId);
  expect(rebuilt.artifact?.version).toBe(2);
  expect(rebuilt.artifact).not.toHaveProperty("approvedVersion");
  const versions = await t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  expect(versions[1]?.recipeRef?.inputHash).not.toBe(versions[0]?.recipeRef?.inputHash);
  const latest = versions.find((entry) => entry.version === 2);
  if (!latest) throw new Error("Missing rebuilt version");
  await t.run((ctx) => ctx.db.delete(latest._id));
  expect(
    (await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId })).artifact,
  ).toBeNull();
  expect(
    await offlineProviderBuild(t, {
      tenantId,
      planId,
      expectedRevision: rebuilt.revision,
    }),
  ).toMatchObject({ ok: false, reason: "project_missing" });
});

test("actual supplied inquiry wording and booking URL produce a working structured draft without invented inputs", async () => {
  const consent = "I agree to be contacted about my inquiry.";
  const ctaHref = "https://example.com/consultation";
  const { t, tenantId, planId, session, brief } = await setup(
    `Acme designs gardens. Use ${ctaHref}. Inquiry wording: ${consent}`,
  );
  await activeRecipe(t);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: { ...brief, ctaLabel: "Book a consultation", ctaHref, contactConsent: consent },
  });
  expect(saved.ok).toBe(true);
  const built = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: saved.revision,
  });
  expect(built.ok).toBe(true);
  const versions = await t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  const nodes =
    versions[0]?.document.pages.flatMap((page: { nodes: unknown[] }) => page.nodes) ?? [];
  expect(nodes).toContainEqual(
    expect.objectContaining({ kind: "cta", target: { kind: "https", url: ctaHref } }),
  );
  expect(nodes).toContainEqual(expect.objectContaining({ kind: "form", consent }));
});

test("the runner calls the existing bounded skill loop and exposes no publication or human-source tool", () => {
  const runner = readFileSync(new URL("./onlinePresenceRun.ts", import.meta.url), "utf8");
  expect(runner).toContain("runSpecialistTurn(ctx");
  expect(runner).toContain("internal.guardrails.preCall");
  expect(runner).toContain("toolNames: ONLINE_PRESENCE_TOOLS");
  expect(runner).not.toContain("generateText(");
  const adapter = readFileSync(new URL("./onlinePresence.ts", import.meta.url), "utf8");
  expect(adapter).not.toContain("approveVersion(");
  expect(adapter).not.toContain("publishVersion(");
});

test("routing lookup is tenant-bound and source excerpts have a fixed content budget", async () => {
  const { t, tenantId, planId } = await setup();
  const lookup = await t.query(internal.onlinePresence.lookupSession, { tenantId, planId });
  expect(lookup?.sessionId).toBeTruthy();
  const otherPlan = await t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: "another-thread",
  });
  expect(
    await t.query(internal.onlinePresence.lookupSession, { tenantId, planId: otherPlan }),
  ).toBeNull();
  await expect(
    t.query(internal.onlinePresence.lookupSession, { tenantId: "other-tenant", planId }),
  ).rejects.toThrow("ONLINE_PRESENCE_UNAVAILABLE");
  const ids: Id<"vaultDocuments">[] = [];
  for (let index = 0; index < 6; index++)
    ids.push(await vault(t, tenantId, { text: `${index}: ${"x".repeat(9000)}` }));
  const context = await t.query(internal.onlinePresence.contextForTenant, {
    tenantId,
    planId,
    sourceRefs: ids.map((id) => `vault:${id}`),
  });
  expect(
    context.sources.reduce((total, source) => total + source.text.length, 0),
  ).toBeLessThanOrEqual(24000);
  expect(context.sources.some((source) => source.truncated)).toBe(true);
  const selected = await t.query(internal.onlinePresence.contextForTenant, {
    tenantId,
    planId,
    sourceRefs: [`vault:${ids.at(-1)}`],
  });
  expect(
    selected.sources.find((source) => source.ref === `vault:${ids.at(-1)}`)?.text,
  ).toHaveLength(6000);
  expect(context.latestUserMessage).toBe("Acme designs gardens for homeowners.");
});

test("the real specialist loop prepares owned imagery, saves a brief, and builds real versioned pages through its frozen tools", async () => {
  const consent = "I consent to Acme contacting me about my inquiry.";
  const { t, tenantId, planId, threadId, session, brief } = await setup(
    `Acme designs gardens. Our established brand color is #246B58. Services include planting plans and garden layouts. Acme guides projects from the first layout to the planting plan. ${consent}`,
  );
  const image = new Uint8Array(
    readFileSync(
      new URL("../../../apps/web/e2e/fixtures/online-presence/design-study.png", import.meta.url),
    ),
  );
  const imageSource = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([image], { type: "image/png" }));
    const id = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Garden illustration",
      source: "upload",
      kind: "upload",
      category: "media",
      mimeType: "image/png",
      size: image.length,
      contentHash: "owned-source-version",
      storageId,
      status: "ready",
      createdAt: 1,
    });
    return { sourceRef: `vault:${id}`, storageId };
  });
  await activeRecipe(t);
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: "online-presence-specialist",
      version: 1,
      body: onlinePresenceSpecialistSkillBody,
      status: "active",
      createdAt: 1,
    }),
  );
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
  const toolStep = (toolName: string, input: unknown) => ({
    content: [
      {
        type: "tool-call",
        toolCallId: `presence-${toolName}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage,
    warnings: [],
  });
  const actionCtx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
    // Exercise the actual specialist tools but replace only paid design execution with the
    // explicitly offline durable provider fixture; all unrelated actions remain real.
    runAction: (reference: FunctionReference<"action">, args: unknown) =>
      getFunctionName(reference) === "onlinePresenceDesign:build"
        ? offlineProviderBuild(t, args as Parameters<typeof offlineProviderBuild>[1])
        : t.action(reference, args as never),
  } as unknown as Parameters<typeof runSpecialistTurn>[0];
  // The first real tool turn materializes the opaque ref. The following turn exercises a safe
  // preparation retry and supplies exactly that server-produced asset in the model's brief.
  const preparation = await runSpecialistTurn(actionCtx, {
    tenantId,
    planId,
    threadId,
    turnId: "online-presence-image-preparation",
    skillName: "online-presence-specialist",
    toolNames: ONLINE_PRESENCE_TOOLS,
    prompt: "Prepare the owned garden illustration for my website.",
    mockScript: {
      primary: [
        toolStep("readOnlinePresenceContext", {}),
        toolStep("prepareOnlinePresenceAssets", { sourceRefs: [imageSource.sourceRef] }),
        {
          content: [{ type: "text", text: "The image is prepared for the private draft." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ],
    },
  });
  expect(preparation.toolTrace).toEqual([
    "readOnlinePresenceContext",
    "prepareOnlinePresenceAssets",
  ]);
  const assets = await t.run((ctx) => ctx.db.query("webAssets").collect());
  expect(assets).toHaveLength(1);
  const asset = assets[0];
  if (!asset) throw new Error("Actual image preparation did not complete");
  expect(asset.storageId).not.toBe(imageSource.storageId);
  const assetRef = `webasset:${asset._id}:${asset.contentHash.slice(7)}`;
  const designedBrief = {
    ...brief,
    sourceRefs: [...brief.sourceRefs, imageSource.sourceRef],
    services: ["Planting plans"],
    about: "Acme guides projects from the first layout to the planting plan.",
    contactConsent: consent,
    design: { artDirection: "studio", primaryColor: "#246b58" },
    media: {
      hero: {
        storageRef: assetRef,
        alt: "An illustration of planting in a garden",
        crop: "cover",
        aspect: "landscape",
      },
    },
  };
  const script = [
    toolStep("readOnlinePresenceContext", {}),
    toolStep("prepareOnlinePresenceAssets", { sourceRefs: [imageSource.sourceRef] }),
    toolStep("saveOnlinePresenceBrief", {
      brief: designedBrief,
      expectedRevision: session.revision,
    }),
    toolStep("buildOnlinePresenceProject", { expectedRevision: session.revision + 1 }),
    {
      content: [
        { type: "text", text: "Your private website draft is ready for exact-version review." },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    },
  ];
  const result = await runSpecialistTurn(actionCtx, {
    tenantId,
    planId,
    threadId,
    turnId: "online-presence-scripted-turn",
    skillName: "online-presence-specialist",
    toolNames: ONLINE_PRESENCE_TOOLS,
    prompt: "Create my private business website from the supplied business facts.",
    mockScript: { primary: script },
  });
  expect(result.truncated).toBe(false);
  expect(result.toolTrace).toEqual([
    "readOnlinePresenceContext",
    "prepareOnlinePresenceAssets",
    "saveOnlinePresenceBrief",
    "buildOnlinePresenceProject",
  ]);
  const stored = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
  expect(stored.artifact?.version).toBe(1);
  expect(stored.artifact).not.toHaveProperty("approvedVersion");
  expect(stored.artifact).not.toHaveProperty("publishedVersion");
  const versions = await t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  expect(versions[0]?.document.pages.length).toBeGreaterThan(1);
  expect(versions[0]?.document.brand.primaryColor).toBe("#246b58");
  expect(versions[0]?.recipeRef?.designProfile.artDirection).toBe("studio");
  expect(versions[0]?.assetSnapshots).toContainEqual(
    expect.objectContaining({
      assetRef,
      sourceRef: imageSource.sourceRef,
      contentHash: asset.contentHash,
    }),
  );
  expect(versions[0]?.artifacts?.[0]?.html).toContain(`data-asset-ref="${assetRef}"`);
  expect(versions[0]?.sourceWarnings).toContainEqual({
    code: "private_source",
    sourceRef: imageSource.sourceRef,
  });
  expect(versions[0]?.sourceWarnings).toContainEqual({
    code: "publication_permission_unset",
    sourceRef: session.sourceRef,
  });
  const userReview = await t
    .withIdentity({ subject: `${tenantId}|session` })
    .query(api.onlinePresence.sessionForProject, {
      projectId: stored.artifact?.projectId as Id<"webProjects">,
      version: 1,
    });
  expect(userReview?.sourceRefs).toEqual(versions[0]?.sourceRefs);
  expect(userReview?.sourceWarnings).toEqual(versions[0]?.sourceWarnings);
  let latestRevision = stored.revision;
  for (const change of [
    { services: ["Planting plans", "Garden layouts"] },
    { headline: "Gardens with room to grow" },
  ]) {
    const saved = await t.mutation(internal.onlinePresence.saveBrief, {
      tenantId,
      planId,
      expectedRevision: latestRevision,
      brief: { ...brief, ...change },
    });
    expect(saved.ok).toBe(true);
    const unbuilt = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
    expect(unbuilt.briefBuilt).toBe(false);
    expect(unbuilt.artifact?.version).toBe(latestRevision === stored.revision ? 1 : 2);
    expect(unbuilt.brief).toMatchObject({
      media: designedBrief.media,
      about: designedBrief.about,
      contactConsent: consent,
    });
    const built = await offlineProviderBuild(t, {
      tenantId,
      planId,
      expectedRevision: saved.revision,
    });
    expect(built.ok).toBe(true);
    latestRevision = built.revision;
    const current = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
    expect(current.briefBuilt).toBe(true);
    const projectId = stored.artifact?.projectId;
    const builtVersion = built.artifact?.version;
    if (!projectId || builtVersion === undefined)
      throw new Error("Expected an exact built receipt");
    const version = await t.run((ctx) =>
      ctx.db
        .query("webProjectVersions")
        .withIndex("by_tenant_project_version", (q) =>
          q.eq("tenantId", tenantId).eq("projectId", projectId).eq("version", builtVersion),
        )
        .unique(),
    );
    const document = version?.document as WebDocument | undefined;
    expect(document?.pages.map((page) => page.slug)).toEqual([
      "home",
      "about",
      "services",
      "contact",
    ]);
    expect(version?.assetSnapshots?.map((snapshot) => snapshot.assetRef)).toEqual([assetRef]);
    expect(document?.pages.find((page) => page.slug === "services")?.nodes).toContainEqual(
      expect.objectContaining({
        kind: "section",
        id: "services",
        children: [
          { kind: "text", text: "Planting plans" },
          { kind: "text", text: "Garden layouts" },
        ],
      }),
    );
  }
  const newSource = await vault(t, tenantId);
  const changed = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: latestRevision,
    brief: { ...brief, sourceRefs: [...brief.sourceRefs, `vault:${newSource}`] },
  });
  expect(changed.assessment.warnings).toContainEqual({
    code: "private_source",
    sourceRef: `vault:${newSource}`,
  });
  const formerReview = await t
    .withIdentity({ subject: `${tenantId}|session` })
    .query(api.onlinePresence.sessionForProject, {
      projectId: stored.artifact?.projectId as Id<"webProjects">,
      version: 1,
    });
  expect(formerReview?.sourceWarnings).toEqual(userReview?.sourceWarnings);
  expect(
    formerReview?.sourceWarnings.some(
      (warning) => warning.code === "private_source" && warning.sourceRef === `vault:${newSource}`,
    ),
  ).toBe(false);
  const project = await t.run((ctx) => ctx.db.get(stored.artifact?.projectId as Id<"webProjects">));
  expect(project?.publishedVersion).toBeUndefined();
  await t.run((ctx) => ctx.db.patch(asset.vaultDocumentId, { tenantId: "other-tenant" }));
  const unavailable = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: changed.revision,
    brief: { ...brief, headline: "Keep the existing illustration" },
  });
  expect(unavailable.ok).toBe(false);
  const refusedBuild = await offlineProviderBuild(t, {
    tenantId,
    planId,
    expectedRevision: unavailable.revision,
  });
  expect(refusedBuild.ok).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toHaveLength(3);
});
