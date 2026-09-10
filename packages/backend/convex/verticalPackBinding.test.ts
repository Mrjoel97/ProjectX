// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { VERTICAL_CANDIDATES } from "@pikar/contracts/skills/verticalCandidates";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  hasRetrievedVerticalSource,
  verticalOutcomeFor,
  verticalToolFacts,
} from "./verticalPackBinding";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const textStep = {
  content: [{ type: "text", text: "Draft requires source review." }],
  finishReason: { unified: "stop", raw: "stop" },
  usage,
  warnings: [],
};
const toolStep = (toolName: string, input: unknown) => ({
  content: [{ type: "tool-call", toolCallId: toolName, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage,
  warnings: [],
});

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  const tenantId = String(user);
  await t.run(async (ctx) => {
    await ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "sme",
      tierSource: "confirmed",
      derivedAt: 1,
      verticalPreferences: { needs: ["product"], reviewReady: ["product"] },
    });
    await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Reference",
      kind: "document",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 4,
      contentHash: "h",
      text: "Reference evidence",
      status: "ready",
      createdAt: 1,
    });
  });
  await t.mutation(internal.skills.seedVerticalCandidates, {});
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: "vertical-test",
  });
  const args = {
    tenantId,
    verticalId: "product" as const,
    planId,
    threadId: "vertical-test",
    runId: "vertical-run",
    text: "Review this draft",
    previewVersion: 1,
  };
  return { t, tenantId, user, args };
}

describe("six dormant native vertical candidates", () => {
  test("Design requires actual owned image input and reports its byte hash without claiming pixel interpretation", async () => {
    const { t, args, tenantId } = await setup();
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("tenantProfiles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique();
      await ctx.db.patch(profile!._id, {
        verticalPreferences: { needs: ["design"], reviewReady: ["design"] },
      });
    });
    const run = () =>
      t.action(internal.verticalPackBinding.__runWithScript, {
        ...args,
        verticalId: "design",
        primary: [textStep],
      });
    expect(await run()).toMatchObject({ ok: false, reason: "missing-source" });
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const sourceDocId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([imageBytes], { type: "image/png" }));
      return ctx.db.insert("vaultDocuments", {
        tenantId,
        title: "Synthetic pixel",
        kind: "upload",
        category: "my-uploads",
        source: "upload",
        mimeType: "image/png",
        storageId,
        size: imageBytes.length,
        contentHash: "metadata-not-pixel-proof",
        status: "ready",
        createdAt: 1,
      });
    });
    expect(await run()).toMatchObject({
      ok: true,
      outcome: "partial",
      facts: {
        execution: "scripted",
        grounding: "owned_image_input",
        visualSource: {
          docId: sourceDocId,
          sha256: createHash("sha256").update(imageBytes).digest("hex"),
        },
      },
    });
  });

  test("fixed-source evaluation traverses real owned files, reserved calls and an actual artifact without recording a release pass", async () => {
    const { t } = await setup();
    const sourceText = "Synthetic research: three observed users could not find Export.";
    const requestText = "Review the controlled research and save a draft with source references.";
    const pin = {
      runId: "00112233-4455-4677-8899-aabbccddeeff",
      caseId: "grounded-product",
      caseHash: createHash("sha256").update("controlled product case").digest("hex"),
      verticalId: "product" as const,
      candidateVersion: 1,
      bodyHash: VERTICAL_CANDIDATES["vertical-product"].provenance.bodySha256,
    };
    const provision = await t.action(internal.verticalEvalSources.provision, {
      ...pin,
      requestHash: createHash("sha256").update(requestText).digest("hex"),
      sources: [
        {
          ref: "fixture:product:research",
          mimeType: "text/plain",
          bytes: new TextEncoder().encode(sourceText).buffer,
        },
      ],
      reviewReady: true,
    });
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [provision.tenantId],
      capCents: 100,
    });
    const paidStep = (step: typeof textStep | ReturnType<typeof toolStep>) => ({
      ...step,
      providerMetadata: { openrouter: { usage: { cost: 0.000123 } } },
    });
    const observed = await t.action(internal.verticalPackBinding.__evaluateCaseWithScript, {
      ...pin,
      budgetId,
      text: requestText,
      primary: [
        paidStep(toolStep("searchVault", { query: "Export" })),
        paidStep(toolStep("saveAsDocument", { title: "Observed review" })),
        paidStep(textStep),
      ],
    });
    expect(observed.result).toMatchObject({
      ok: true,
      outcome: "useful",
      facts: {
        execution: "scripted",
        grounding: "vault_excerpt",
        costScope: "reserved_fixed_source_model_calls",
        completedAllowedTools: { searchVault: 1, saveAsDocument: 1 },
      },
    });
    expect(observed.sourceReads).toEqual([
      {
        docId: provision.sourceRefs[0]!.docId,
        chunkHash: createHash("sha256").update(sourceText).digest("hex"),
      },
    ]);
    expect(observed.budget).toMatchObject({ callCount: 3, settledCount: 3, unsettledCount: 0 });
    expect(observed.budget.actualUsd).toBeCloseTo(0.000369);
    expect(observed.releaseEvidenceRecorded).toBe(false);
    expect(JSON.stringify(observed.sourceReads)).not.toContain(sourceText);
    const candidates = await t.run((ctx) => ctx.db.query("skills").collect());
    expect(
      candidates.every(
        (row) => row.status === "candidate" && !row.evidence && !row.browserEvidence,
      ),
    ).toBe(true);
    await expect(
      t.action(internal.verticalPackBinding.__evaluateCaseWithScript, {
        ...pin,
        caseHash: "f".repeat(64),
        budgetId,
        text: "Changed fixture",
        primary: [paidStep(textStep)],
      }),
    ).rejects.toThrow("PROVISION_MISMATCH");
    expect((await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).callCount).toBe(3);
    await expect(
      t.action(internal.verticalPackBinding.__evaluateCaseWithScript, {
        ...pin,
        budgetId,
        text: "A different request with the original case hash",
        primary: [paidStep(textStep)],
      }),
    ).rejects.toThrow("PROVISION_MISMATCH");
    expect((await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).callCount).toBe(3);
  });

  test("tool observations count unknown attempts without retaining model-authored names", () => {
    const facts = verticalToolFacts(
      ["searchVault", "saveAsDocument"],
      ["searchVault", "searchVault", "untrusted private tool text"],
      [{ tool: "searchVault" }],
    );
    expect(facts).toEqual({
      attemptedAllowedTools: { searchVault: 2, saveAsDocument: 0 },
      completedAllowedTools: { searchVault: 1, saveAsDocument: 0 },
      ungrantedToolAttemptCount: 1,
    });
    expect(JSON.stringify(facts)).not.toContain("untrusted private tool text");
  });
  test("a grounded document workflow is useful only after the artifact exists", () => {
    const grounded = {
      reply: "Grounded draft",
      truncated: false,
      declaredUnsupported: false,
      runtimeMissing: 0,
    };
    expect(verticalOutcomeFor({ ...grounded, artifactSaved: false })).toBe("partial");
    expect(verticalOutcomeFor({ ...grounded, artifactSaved: true })).toBe("useful");
    expect(verticalOutcomeFor({ ...grounded, runtimeMissing: 1, artifactSaved: true })).toBe(
      "partial",
    );
  });
  test("empty and failed search results cannot imply grounded usefulness", () => {
    const result = (output: string) => [{ tool: "searchVault", output }];
    expect(hasRetrievedVerticalSource([])).toBe(false);
    expect(
      hasRetrievedVerticalSource(
        result('<vault_context note="reference">\n\n</vault_context>\nGrounded in 1 document(s)'),
      ),
    ).toBe(false);
    expect(
      hasRetrievedVerticalSource(
        result(
          '<vault_context note="reference">\n[Title]\n\n</vault_context>\nGrounded in 1 document(s)',
        ),
      ),
    ).toBe(false);
    expect(
      hasRetrievedVerticalSource(
        result(
          '<vault_context note="reference">\n[Title]\nActual source excerpt\n</vault_context>\nGrounded in 1 document(s)',
        ),
      ),
    ).toBe(true);
  });
  test("mirrors bind actual canonical LF bytes and all six publish idempotently without activation", async () => {
    const { t } = await setup();
    expect(Object.keys(VERTICAL_CANDIDATES)).toHaveLength(6);
    for (const [name, candidate] of Object.entries(VERTICAL_CANDIDATES)) {
      const body = readFileSync(
        new URL(`../../contracts/packs/vertical/${name.slice(9)}/skill.md`, import.meta.url),
        "utf8",
      ).replace(/\r\n/g, "\n");
      expect(candidate.body).toBe(body);
      expect(createHash("sha256").update(body).digest("hex")).toBe(candidate.provenance.bodySha256);
      await expect(t.mutation(internal.skills.activateSkill, { name, version: 1 })).rejects.toThrow(
        "PACK_GATE",
      );
    }
    expect(
      (await t.mutation(internal.skills.seedVerticalCandidates, {})).every((row) => !row.inserted),
    ).toBe(true);
    const rows = await t.run((ctx) => ctx.db.query("skills").collect());
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.status === "candidate")).toBe(true);
  });

  test("changed bytes require matching provenance and allocate only that stream", async () => {
    const { t } = await setup();
    const candidate = VERTICAL_CANDIDATES["vertical-product"];
    const body = `${candidate.body}\nReviewed revision.\n`;
    const provenance = { ...candidate.provenance, skillVersions: { "vertical-product": 2 } };
    await expect(
      t.mutation(internal.skills.publishPackCandidate, {
        name: "vertical-product",
        body,
        provenance: JSON.stringify(provenance),
      }),
    ).rejects.toThrow("BODY_HASH_MISMATCH");
    expect(
      await t.mutation(internal.skills.publishPackCandidate, {
        name: "vertical-product",
        body,
        provenance: JSON.stringify({
          ...provenance,
          bodySha256: createHash("sha256").update(body).digest("hex"),
        }),
      }),
    ).toMatchObject({ version: 2, inserted: true });
    expect(
      (await t.run((ctx) => ctx.db.query("skills").collect())).filter(
        (row) => row.name !== "vertical-product",
      ),
    ).toHaveLength(5);
  });

  test("ordinary starts stay hidden and non-owner exact previews are rejected before thread writes", async () => {
    const { t, user } = await setup();
    const asUser = t.withIdentity({ subject: user });
    expect(
      await asUser.action(api.cockpit.startVerticalPack, { verticalId: "product", text: "Review" }),
    ).toMatchObject({ ok: false });
    await expect(
      asUser.action(api.cockpit.startVerticalPack, {
        verticalId: "product",
        text: "Review",
        previewVersion: 1,
      }),
    ).rejects.toThrow("OWNER_REQUIRED");
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
  });

  test("same runtime exact pin produces refs-only actual preview outcome; forbidden tools do not run", async () => {
    const { t, args } = await setup();
    const result = await t.action(internal.verticalPackBinding.__runWithScript, {
      ...args,
      primary: [
        toolStep("dispatchResearch", { question: "Forbidden" }),
        toolStep("proposePlan", {}),
        textStep,
      ],
    });
    expect(result).toMatchObject({ ok: true, version: 1, outcome: "partial" });
    const steps = await t.run((ctx) => ctx.db.query("agentSteps").collect());
    expect(steps.some((row) => ["dispatchResearch", "proposePlan"].includes(row.tool))).toBe(false);
    const events = await t.run((ctx) => ctx.db.query("audit").collect());
    const outcome = events.find((row) => row.eventType === "vertical_pack.outcome");
    expect(outcome?.payload).toMatchObject({
      event: "run_completed",
      preview: true,
      outcome: "partial",
    });
    expect(JSON.stringify(events)).not.toContain("Draft requires source review");
  });

  test("the native leaf save tool creates the actual reply artifact and records exact candidate lineage", async () => {
    const { t, args, user } = await setup();
    const result = await t.action(internal.verticalPackBinding.__runWithScript, {
      ...args,
      primary: [toolStep("saveAsDocument", { title: "Product review draft" }), textStep],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected saved draft");
    expect(result.artifactId).toBeDefined();
    const artifact = await t.run((ctx) => ctx.db.get(result.artifactId!));
    expect(artifact).toMatchObject({
      tenantId: args.tenantId,
      title: "Product review draft",
      text: "Draft requires source review.",
    });
    expect(result.facts).toMatchObject({
      execution: "scripted",
      planId: args.planId,
      candidateVersion: 1,
      candidateBodySha256: VERTICAL_CANDIDATES["vertical-product"].provenance.bodySha256,
      artifactId: result.artifactId,
      artifactContentSha256: artifact?.contentHash,
      grounding: "none",
      completedAllowedTools: { searchVault: 0, saveAsDocument: 1 },
    });
    expect(result.facts.runHash).toBe(createHash("sha256").update(args.runId).digest("hex"));
    expect(JSON.stringify(result.facts)).not.toContain("Draft requires source review.");
    const events = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(events.find((row) => row.payload?.event === "artifact_created")?.payload).toMatchObject({
      artifactId: result.artifactId,
      preview: true,
    });
    expect(
      await t.query(internal.verticalPacks.prepare, {
        tenantId: args.tenantId,
        verticalId: "product",
      }),
    ).toMatchObject({ ok: false, reason: "insufficient-repeat-use" });
    await t
      .withIdentity({ subject: user })
      .mutation(api.verticalPacks.setDisabled, { verticalId: "product", disabled: true });
    expect(
      await t
        .withIdentity({ subject: user })
        .query(api.vault.vaultDocText, { vaultDocId: result.artifactId! }),
    ).toMatchObject({ text: "Draft requires source review." });
  });

  test("two explicitly confirmed prior artifacts bootstrap demand without releasing a candidate", async () => {
    const { t, user, tenantId } = await setup();
    const asUser = t.withIdentity({ subject: user });
    const docs = await t.run(async (ctx) => {
      const existing = (await ctx.db.query("vaultDocuments").collect())[0];
      if (!existing) throw new Error("missing fixture");
      const second = await ctx.db.insert("vaultDocuments", {
        tenantId,
        title: "Second prior workflow",
        kind: "document",
        category: "workspace-docs",
        source: "agent",
        mimeType: "text/markdown",
        size: 10,
        contentHash: "h2",
        text: "Prior artifact",
        status: "ready",
        createdAt: 1,
      });
      return [existing._id, second] as [typeof existing._id, typeof second];
    });
    const prepare = () =>
      t.query(internal.verticalPacks.prepare, { tenantId, verticalId: "product" });
    expect(await prepare()).toMatchObject({ reason: "insufficient-repeat-use" });
    await asUser.mutation(api.verticalPacks.configure, {
      needs: ["product"],
      reviewReady: ["product"],
      confirmWorkload: { verticalId: "product", artifactIds: docs },
    });
    expect(await prepare()).toMatchObject({ ok: false, reason: "not-released" });
    const profile = await t.run((ctx) =>
      ctx.db
        .query("tenantProfiles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique(),
    );
    expect(profile?.verticalPreferences?.confirmedWorkloads?.[0]).toMatchObject({
      verticalId: "product",
      artifactIds: docs,
      confirmedAt: expect.any(Number),
    });
    // Historical confirmation survives source retirement; current source availability is independently gated.
    await t.run((ctx) => ctx.db.delete(docs[1]));
    expect(await prepare()).toMatchObject({ reason: "not-released" });
    expect((await asUser.query(api.verticalPacks.discover, {})).recommendations).toEqual([]);
  });

  test("workload confirmation rejects duplicate, foreign and sealed artifact refs", async () => {
    const { t, user, tenantId } = await setup();
    const asUser = t.withIdentity({ subject: user });
    const ids = await t.run(async (ctx) => {
      const doc = (await ctx.db.query("vaultDocuments").collect())[0];
      if (!doc) throw new Error("missing fixture");
      const own = doc._id;
      const add = (owner: string) =>
        ctx.db.insert("vaultDocuments", {
          tenantId: owner,
          title: "Prior",
          kind: "document",
          category: "workspace-docs",
          source: "agent",
          mimeType: "text/markdown",
          size: 1,
          contentHash: "h",
          text: "Prior",
          status: "ready",
          createdAt: 1,
        });
      const foreign = await add("foreign");
      const sealed = await add(tenantId);
      const folderId = await ctx.db.insert("vaultFolders", {
        tenantId,
        name: "sealed",
        source: "upload",
        status: "ingesting",
        memberCount: 2,
        terminalCount: 1,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 0,
        createdAt: 1,
      });
      await ctx.db.patch(sealed, { folderId });
      return { own, foreign, sealed };
    });
    const confirm = (artifactIds: (typeof ids.own)[]) =>
      asUser.mutation(api.verticalPacks.configure, {
        needs: ["product"],
        reviewReady: ["product"],
        confirmWorkload: { verticalId: "product", artifactIds },
      });
    await expect(confirm([ids.own, ids.own])).rejects.toThrow("TWO_DISTINCT_ARTIFACTS_REQUIRED");
    await expect(confirm([ids.own, ids.foreign])).rejects.toThrow("NOT_FOUND");
    await expect(confirm([ids.own, ids.sealed])).rejects.toThrow("SOURCE_SEALED");
    expect(
      await t.query(internal.verticalPacks.prepare, { tenantId, verticalId: "product" }),
    ).toMatchObject({ reason: "insufficient-repeat-use" });
  });

  test("disabled, foreign plan and missing-source starts stop before spend even with exact preview pins", async () => {
    const { t, args, tenantId, user } = await setup();
    const run = () =>
      t.action(internal.verticalPackBinding.__runWithScript, { ...args, primary: [textStep] });
    await t
      .withIdentity({ subject: user })
      .mutation(api.verticalPacks.setDisabled, { verticalId: "product", disabled: true });
    expect(await run()).toMatchObject({ ok: false, reason: "disabled" });
    expect(
      await t.action(internal.verticalPackBinding.__runWithScript, {
        ...args,
        tenantId: "foreign",
        primary: [textStep],
      }),
    ).toMatchObject({ ok: false, reason: "not-found" });
    await t
      .withIdentity({ subject: user })
      .mutation(api.verticalPacks.setDisabled, { verticalId: "product", disabled: false });
    await t.run(async (ctx) => {
      for (const doc of await ctx.db.query("vaultDocuments").collect())
        await ctx.db.delete(doc._id);
    });
    expect(
      await t.query(internal.verticalPacks.prepare, {
        tenantId,
        verticalId: "product",
        previewVersion: 1,
      }),
    ).toMatchObject({ ok: false, reason: "missing-source" });
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
  });
});
