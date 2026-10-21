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
import { ONLINE_PRESENCE_TOOLS } from "@pikar/core/onlinePresence";
import {
  canonicalWebRecipeDefinition,
  WEB_RECIPE_BUNDLE_HASH,
  WEB_RECIPE_COMPILER_ID,
  WEB_RECIPE_DEFINITIONS,
} from "@pikar/core/webRecipes";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

test("shop intent persists as blocked requirements without creating a pretend shop", async () => {
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
    missing: [expect.objectContaining({ reason: "commerce_unavailable" })],
  });
  const row = await t
    .withIdentity({ subject: `${tenantId}|session` })
    .query(api.onlinePresence.sessionForThread, { threadId });
  expect(row?.status).toBe("blocked");
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
  const result = await t.mutation(internal.onlinePresence.buildProject, {
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
    t.mutation(internal.onlinePresence.buildProject, {
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
  const { t, tenantId, planId, session, brief } = await setup();
  await activeRecipe(t);
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief,
  });
  const built = await t.mutation(internal.onlinePresence.buildProject, {
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
  const repeated = await t.mutation(internal.onlinePresence.buildProject, {
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
  const rebuilt = await t.mutation(internal.onlinePresence.buildProject, {
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
    await t.mutation(internal.onlinePresence.buildProject, {
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
  const built = await t.mutation(internal.onlinePresence.buildProject, {
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

test("the real specialist loop reads context, saves a brief, and builds real versioned pages through its frozen tools", async () => {
  const { t, tenantId, planId, threadId, session, brief } = await setup();
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
  const script = [
    toolStep("readOnlinePresenceContext", {}),
    toolStep("saveOnlinePresenceBrief", { brief, expectedRevision: session.revision }),
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
  const actionCtx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
    runAction: t.action.bind(t),
  } as unknown as Parameters<typeof runSpecialistTurn>[0];
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
    "saveOnlinePresenceBrief",
    "buildOnlinePresenceProject",
  ]);
  const stored = await t.query(internal.onlinePresence.contextForTenant, { tenantId, planId });
  expect(stored.artifact?.version).toBe(1);
  expect(stored.artifact).not.toHaveProperty("approvedVersion");
  expect(stored.artifact).not.toHaveProperty("publishedVersion");
  const versions = await t.run((ctx) => ctx.db.query("webProjectVersions").collect());
  expect(versions[0]?.document.pages.length).toBeGreaterThan(1);
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
  const newSource = await vault(t, tenantId);
  const changed = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: stored.revision,
    brief: { ...brief, sourceRefs: [`vault:${newSource}`] },
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
  expect(formerReview?.sourceWarnings.some((warning) => warning.code === "private_source")).toBe(
    false,
  );
  const project = await t.run((ctx) => ctx.db.get(stored.artifact?.projectId as Id<"webProjects">));
  expect(project?.publishedVersion).toBeUndefined();
});
