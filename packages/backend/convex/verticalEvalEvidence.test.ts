// @vitest-environment node
// Local authority/forgery tests. Ledger/model observations below are test DB fixtures, never runs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  hasPassingVerticalEvalEvidence,
  VERTICAL_EVAL_MODELS,
} from "@pikar/contracts/verticalEval";
import {
  VERTICAL_CORPUS,
  VERTICAL_CORPUS_SHA256,
  VERTICAL_EVALUATOR_SHA256,
} from "@pikar/contracts/verticalEvalCorpus";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { compileSources } from "../scripts/vertical-eval-sources.mjs";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { VERTICAL_EVAL_AUDIT_NAMESPACE } from "./audit";
import schema from "./schema";
import { hasNativeVerticalEvidence } from "./verticalEvalEvidence";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const limiters = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const runId = "12345678-1234-4123-8123-123456789abc";
const reply =
  "Observed input remains a draft. A human must review evidence and verify the proposed steps.";
const modelSeam = vi.hoisted(() => ({ script: [] as unknown[] }));
vi.mock("./lib/models", async (importOriginal) => {
  const { MockLanguageModelV4 } = await import("ai/test");
  return {
    ...(await importOriginal<typeof import("./lib/models")>()),
    resolveModel: () => new MockLanguageModelV4({ doGenerate: modelSeam.script as never }),
  };
});
const fixtures = JSON.parse(
  readFileSync(new URL("../scripts/vertical-eval-cases/engineering.json", import.meta.url), "utf8"),
);

async function setup(count = 1) {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  t.registerComponent("rateLimiter", rateLimiterSchema, limiters);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const owner = t.withIdentity({ subject: ownerId });
  const user = t.withIdentity({ subject: userId });
  await t.mutation(internal.skills.seedVerticalCandidates, {});
  const candidate = await t.run((ctx) =>
    ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", "vertical-engineering").eq("version", 1))
      .unique(),
  );
  if (!candidate) throw new Error("missing seeded candidate");
  const cases = [];
  for (const item of VERTICAL_CORPUS.engineering.slice(0, count)) {
    const fixture = fixtures.cases.find(
      (f: { id: string }) => `engineering-${f.id}` === item.caseId,
    );
    const pin = {
      runId,
      caseId: item.caseId,
      caseHash: item.caseHash,
      requestHash: item.requestHash,
      verticalId: "engineering" as const,
      candidateVersion: 1,
      bodyHash: sha(candidate.body),
    };
    const prepared = await t.action(internal.verticalEvalSources.provision, {
      ...pin,
      reviewReady: true,
      sources: compileSources("engineering", fixture),
    });
    cases.push({ pin, prepared });
  }
  const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: cases.map((c) => c.prepared.tenantId),
    capCents: 1000,
  });
  return { t, owner, user, candidate, cases, budgetId };
}
type Harness = Awaited<ReturnType<typeof setup>>;
async function observe(h: Harness, index = 0, modify?: (value: any) => void) {
  const c = h.cases[index];
  if (!c) throw new Error("missing case");
  const startId = await h.t.mutation(internal.verticalEvalEvidence.beginCase, {
    ...c.pin,
    budgetId: h.budgetId,
  });
  // Simulate the settled native ledger in the isolated DB, not a provider or a release assertion.
  await h.t.run(async (ctx) => {
    const correlationId = `evalcall:test-${index}`;
    const shared = {
      tenantId: c.prepared.tenantId,
      rail: "reasoning" as const,
      amountCents: 1,
      correlationId,
      model: VERTICAL_EVAL_MODELS[0],
      evalBudgetId: h.budgetId,
      createdAt: Date.now(),
    };
    await ctx.db.insert("spendEvents", { ...shared, phase: "reserved" });
    await ctx.db.insert("spendEvents", { ...shared, phase: "actual", evalActualUsd: 0.01 });
    await ctx.db.insert("agentSteps", {
      tenantId: c.prepared.tenantId,
      threadId: c.prepared.threadId,
      turnId: runId,
      tool: "searchVault",
      stepKey: "s1",
      phase: "done",
      startedAt: 1,
      endedAt: 2,
    });
  });
  const budget = await h.t.query(internal.guardrails.evalBudgetStatus, { budgetId: h.budgetId });
  const observation = {
    caseBinding: {
      tenantId: c.prepared.tenantId,
      threadId: c.prepared.threadId,
      planId: c.prepared.planId,
      candidateId: h.candidate._id,
      candidateVersion: 1,
      bodyHash: c.pin.bodyHash,
      requestHash: c.pin.requestHash,
    },
    caseHash: c.pin.caseHash,
    inputSha256: c.pin.requestHash,
    sourceMode: "fixed-owned-fixtures",
    releaseEvidenceRecorded: false,
    sourceReads: c.prepared.sourceRefs.map((s) => ({ docId: s.docId, chunkHash: s.hash })),
    budget,
    result: {
      ok: true,
      reply,
      outcome: "partial",
      version: 1,
      facts: {
        schemaVersion: 1,
        execution: "model",
        candidateId: h.candidate._id,
        candidateVersion: 1,
        candidateBodySha256: c.pin.bodyHash,
        planId: c.prepared.planId,
        runHash: sha(runId),
        inputSha256: c.pin.requestHash,
        configuredModelId: VERTICAL_EVAL_MODELS[0],
        configuredFallbackModelId: VERTICAL_EVAL_MODELS[1],
        actualModelId: VERTICAL_EVAL_MODELS[0],
        modelCostUsd: 0.01,
        costScope: "reserved_fixed_source_model_calls",
        ungrantedToolAttemptCount: 0,
        truncated: false,
        grounding: "vault_excerpt",
        attemptedAllowedTools: { searchVault: 1, saveAsDocument: 0 },
        completedAllowedTools: { searchVault: 1, saveAsDocument: 0 },
      },
    },
  };
  modify?.(observation);
  const receiptId = await h.t.mutation(internal.verticalEvalEvidence.sealCase, {
    startId,
    observation,
  });
  return { startId, receiptId, observation };
}
async function reviewArgs(h: Harness, receiptId: Id<"audit">) {
  const view = await h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId });
  return {
    receiptId,
    outputHash: sha(reply),
    sourceHashes: view.sources.map((s) => s.hash),
    outcome: "partial" as const,
    qualifiedRole: "owner" as const,
    decisions: view.criteria.map((criterion) => ({
      criterion,
      decision: "supported" as const,
      outputSpans: [
        { startByte: 0, endByte: new TextEncoder().encode(reply).length, sha256: sha(reply) },
      ],
      sourceDocIds: view.sources.map((s) => s.docId),
    })),
  };
}

describe("native vertical exact-version issuer", () => {
  test("a complete-shaped JSON pass with an ordinary audit ID cannot forge native issuance", async () => {
    const h = await setup();
    await h.t.run(async (ctx) => {
      const issuanceId = await ctx.db.insert("audit", {
        tenantId: String(h.candidate._id),
        eventType: "ordinary.fixture",
        correlationId: "fake",
        actor: "system",
        payload: {},
        ts: Date.now(),
      });
      const core = {
        schemaVersion: 1,
        kind: "native-owner-reviewed-vertical",
        name: h.candidate.name,
        version: 1,
        candidateId: h.candidate._id,
        bodyHash: sha(h.candidate.body),
        runId,
        corpusHash: VERTICAL_CORPUS_SHA256,
        evaluatorHash: VERTICAL_EVALUATOR_SHA256,
        caseHashes: VERTICAL_CORPUS.engineering.map((c) => c.caseHash),
        caseReceiptIds: VERTICAL_CORPUS.engineering.map((_, i) => `case-${i}`),
        reviewReceiptIds: VERTICAL_CORPUS.engineering.map((_, i) => `review-${i}`),
        modelIds: [VERTICAL_EVAL_MODELS[0]],
        budgetId: h.budgetId,
        passed: true,
      };
      const evidence = JSON.stringify({ ...core, issuanceId });
      expect(hasPassingVerticalEvalEvidence(evidence, h.candidate.name, 1)).toBe(true);
      await ctx.db.patch(h.candidate._id, { evidence });
      const candidate = await ctx.db.get(h.candidate._id);
      if (!candidate) throw new Error("missing candidate");
      expect(await hasNativeVerticalEvidence(ctx, candidate)).toBe(false);
    });
  });
  test("real shared SDK loop with transport-only shim seals zero-tool partial output and actual settled cost", async () => {
    const h = await setup();
    modelSeam.script = [
      {
        content: [{ type: "text", text: reply }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
        providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
      },
    ];
    const c = h.cases[0]!;
    const { requestHash: _, ...pin } = c.pin;
    const result = await h.t.action(internal.verticalPackBinding.evaluateCase, {
      ...pin,
      budgetId: h.budgetId,
      text: fixtures.cases[0].input.request,
    });
    expect(result.nativeCaseReceiptId).toBeTypeOf("string");
    expect(result.budget).toMatchObject({
      callCount: 1,
      settledCount: 1,
      actualUsd: 0.001,
      unsettledCount: 0,
    });
    expect(result.result).toMatchObject({
      ok: true,
      reply,
      facts: { execution: "model", attemptedAllowedTools: { searchVault: 0, saveAsDocument: 0 } },
    });
    expect(result.releaseEvidenceRecorded).toBe(false);
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    expect(
      await h.owner.query(api.verticalEvalEvidence.inspectCase, {
        receiptId: result.nativeCaseReceiptId!,
      }),
    ).toMatchObject({ output: reply });
  });
  test("real SDK tool callbacks, fixed source read and saved artifact agree with the native receipt", async () => {
    const h = await setup();
    const usage = {
      inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const metadata = {
      usage,
      warnings: [],
      providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
    };
    const tool = (name: string, input: unknown) => ({
      ...metadata,
      content: [
        { type: "tool-call", toolCallId: name, toolName: name, input: JSON.stringify(input) },
      ],
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
    });
    modelSeam.script = [
      tool("searchVault", { query: "architecture" }),
      tool("saveAsDocument", { title: "Review draft" }),
      {
        ...metadata,
        content: [{ type: "text", text: reply }],
        finishReason: { unified: "stop", raw: "stop" },
      },
    ];
    const c = h.cases[0]!;
    const { requestHash: _, ...pin } = c.pin;
    const result = await h.t.action(internal.verticalPackBinding.evaluateCase, {
      ...pin,
      budgetId: h.budgetId,
      text: fixtures.cases[0].input.request,
    });
    expect(result.result).toMatchObject({
      ok: true,
      outcome: "useful",
      facts: {
        attemptedAllowedTools: { searchVault: 1, saveAsDocument: 1 },
        completedAllowedTools: { searchVault: 1, saveAsDocument: 1 },
      },
    });
    expect(result.budget).toMatchObject({ callCount: 3, settledCount: 3, actualUsd: 0.003 });
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    const view = await h.owner.query(api.verticalEvalEvidence.inspectCase, {
      receiptId: result.nativeCaseReceiptId!,
    });
    expect(view.output).toBe(reply);
    expect(view.binding.artifactId).toBeTypeOf("string");
    expect(view.binding.sourceDocIds).toEqual(c.prepared.sourceRefs.map((s) => s.docId));
  });
  test("complete current corpus + authenticated explicit reviews issue evidence without activation; later cleanup preserves authority", async () => {
    const h = await setup(VERTICAL_CORPUS.engineering.length);
    const receipts = [];
    for (let i = 0; i < h.cases.length; i++) receipts.push(await observe(h, i));
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    for (const { receiptId } of receipts)
      await h.owner.mutation(api.verticalEvalEvidence.reviewCase, await reviewArgs(h, receiptId));
    const issued = await h.owner.mutation(api.verticalEvalEvidence.finalize, {
      runId,
      name: h.candidate.name,
      version: 1,
    });
    expect(issued.activated).toBe(false);
    await h.t.run(async (ctx) => {
      const candidate = await ctx.db.get(h.candidate._id);
      expect(candidate?.status).toBe("candidate");
      if (!candidate) throw new Error("missing candidate");
      expect(await hasNativeVerticalEvidence(ctx, candidate)).toBe(true);
      const audit = await ctx.db
        .query("audit")
        .withIndex("by_tenant_ts", (q) => q.eq("tenantId", VERTICAL_EVAL_AUDIT_NAMESPACE))
        .collect();
      expect(JSON.stringify(audit)).not.toContain(reply);
      expect(audit.every((row) => row.exportVersion === 2)).toBe(true);
    });
    await h.t.action(internal.verticalEvalSources.purgeCase, h.cases[0]!.pin);
    await h.t.run(async (ctx) => {
      const candidate = await ctx.db.get(h.candidate._id);
      expect(candidate && (await hasNativeVerticalEvidence(ctx, candidate))).toBe(true);
    });
  });

  test("native receipt is not a pass; filtered corpus and missing human reviews remain closed", async () => {
    const h = await setup();
    const { receiptId } = await observe(h);
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    await expect(
      h.owner.mutation(api.verticalEvalEvidence.finalize, {
        runId,
        name: h.candidate.name,
        version: 1,
      }),
    ).rejects.toThrow("CORPUS_INCOMPLETE");
    await h.owner.mutation(api.verticalEvalEvidence.reviewCase, await reviewArgs(h, receiptId));
    await expect(
      h.owner.mutation(api.verticalEvalEvidence.finalize, {
        runId,
        name: h.candidate.name,
        version: 1,
      }),
    ).rejects.toThrow("CORPUS_INCOMPLETE");
    await expect(
      h.t.action(internal.verticalEvalSources.purgeCase, h.cases[0]!.pin),
    ).rejects.toThrow("RETAINED_FOR_AUTHENTICATED_REVIEW");
    await expect(
      h.t.mutation(internal.tenantDelete.purgeEvalTenant, {
        tenantId: h.cases[0]!.prepared.tenantId,
        exact: true,
      }),
    ).rejects.toThrow("REQUIRES_NATIVE_CLEANUP");
    await expect(
      h.t.mutation(internal.tenantDelete.purgeEvalTenant, { tenantId: "packeval-12345678-" }),
    ).rejects.toThrow("REQUIRES_NATIVE_CLEANUP");
  });

  test("contradicted authenticated review blocks full corpus; native start cannot be replayed", async () => {
    const h = await setup(VERTICAL_CORPUS.engineering.length);
    const receipts = [];
    for (let i = 0; i < h.cases.length; i++) receipts.push(await observe(h, i));
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    for (let i = 0; i < receipts.length; i++) {
      const args = await reviewArgs(h, receipts[i]!.receiptId);
      const decisions = args.decisions.map((d, j) =>
        i === 0 && j === 0 ? { ...d, decision: "contradicted" as const } : d,
      );
      await h.owner.mutation(api.verticalEvalEvidence.reviewCase, { ...args, decisions });
    }
    await expect(
      h.owner.mutation(api.verticalEvalEvidence.finalize, {
        runId,
        name: h.candidate.name,
        version: 1,
      }),
    ).rejects.toThrow("REVIEW_NOT_ACCEPTED");
    await expect(
      h.t.mutation(internal.verticalEvalEvidence.beginCase, {
        ...h.cases[0]!.pin,
        budgetId: h.budgetId,
      }),
    ).rejects.toThrow("ALREADY_STARTED");
  });

  test("stale output/body/evaluator and tenant-mismatched source bytes invalidate review", async () => {
    for (const kind of ["output", "body", "evaluator", "source-tenant"]) {
      const h = await setup();
      const { receiptId } = await observe(h);
      await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
      await h.t.run(async (ctx) => {
        const receipt = await ctx.db.get(receiptId);
        if (!receipt) throw new Error("missing receipt");
        if (kind === "output")
          await ctx.db.patch(receipt.payload.outputId as Id<"vaultDocuments">, { text: "changed" });
        if (kind === "body")
          await ctx.db.patch(h.candidate._id, { body: `${h.candidate.body}\nchanged` });
        if (kind === "evaluator")
          await ctx.db.patch(receiptId, {
            payload: { ...receipt.payload, evaluatorHash: "a".repeat(64) },
          });
        if (kind === "source-tenant")
          await ctx.db.patch(h.cases[0]!.prepared.sourceRefs[0]!.docId, { tenantId: "other" });
      });
      await expect(
        h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId }),
      ).rejects.toThrow();
    }
  });

  test.each([
    "scripted",
    "wrong-cost",
    "wrong-plan",
    "wrong-source",
    "wrong-model",
    "ungranted-tool",
    "artifact-forgery",
  ])("rejects %s runtime facts", async (kind) => {
    const h = await setup();
    await expect(
      observe(h, 0, (value) => {
        const facts = value.result.facts;
        if (kind === "scripted") facts.execution = "scripted";
        if (kind === "wrong-cost") facts.modelCostUsd = 0;
        if (kind === "wrong-plan") value.caseBinding.planId = "wrong";
        if (kind === "wrong-source") value.sourceReads[0].chunkHash = "a".repeat(64);
        if (kind === "wrong-model") facts.actualModelId = "provider/unknown";
        if (kind === "ungranted-tool") facts.ungrantedToolAttemptCount = 1;
        if (kind === "artifact-forgery") facts.artifactId = "invented";
      }),
    ).rejects.toThrow("VERTICAL_EVIDENCE_");
  });

  test("owner source URLs require exact provisioned storage and reject an unrelated blob", async () => {
    const h = await setup();
    const { receiptId } = await observe(h);
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    const view = await h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId });
    const source = view.sources[0];
    if (!source) throw new Error("missing source fixture");
    expect(source.url).toBe(await h.t.run((ctx) => ctx.storage.getUrl(source.storageId)));
    expect(typeof source.url).toBe("string");
    await expect(h.user.query(api.verticalEvalEvidence.inspectCase, { receiptId })).rejects.toThrow(
      "OWNER_REQUIRED",
    );
    await expect(h.t.query(api.verticalEvalEvidence.inspectCase, { receiptId })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await h.t.run(async (ctx) => {
      const unrelated = await ctx.storage.store(
        new Blob(["unrelated tenant content"], { type: "text/plain" }),
      );
      await ctx.db.patch(source.docId, { storageId: unrelated });
    });
    await expect(
      h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId }),
    ).rejects.toThrow("VERTICAL_EVAL_SOURCE_CHANGED");
  });

  test("owners only, exact quote hashes, actual readback, and no generic evidence/log injection", async () => {
    const h = await setup();
    const { receiptId } = await observe(h);
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    await expect(h.user.query(api.verticalEvalEvidence.inspectCase, { receiptId })).rejects.toThrow(
      "OWNER_REQUIRED",
    );
    await expect(h.t.query(api.verticalEvalEvidence.inspectCase, { receiptId })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    const args = await reviewArgs(h, receiptId);
    await expect(h.user.mutation(api.verticalEvalEvidence.reviewCase, args)).rejects.toThrow(
      "OWNER_REQUIRED",
    );
    args.decisions[0]!.outputSpans[0]!.sha256 = "a".repeat(64);
    await expect(h.owner.mutation(api.verticalEvalEvidence.reviewCase, args)).rejects.toThrow(
      "QUOTE_HASH",
    );
    await expect(
      h.t.mutation(internal.skills.recordEvalEvidence, {
        name: h.candidate.name,
        version: 1,
        evidence: "{}",
      }),
    ).rejects.toThrow("NATIVE_ISSUER_REQUIRED");
    for (const payload of [
      { tenantId: VERTICAL_EVAL_AUDIT_NAMESPACE, eventType: "other" },
      { tenantId: "user", eventType: "vertical_evidence.issuance" },
    ])
      await expect(
        h.t.mutation(internal.audit.log, {
          ...payload,
          actor: "system",
          correlationId: "forgery",
          payload: {},
        }),
      ).rejects.toThrow("RESERVED_EVIDENCE_NAMESPACE");
    const source = h.cases[0]!.prepared.sourceRefs[0]!;
    await h.t.run((ctx) => ctx.db.patch(source.docId, { text: "tampered" }));
    await expect(
      h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId }),
    ).rejects.toThrow("SOURCE_CHANGED");
  });

  test("abandonment is explicit authenticated cleanup authority and can never issue", async () => {
    const h = await setup();
    const observed = await observe(h);
    await expect(
      h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId: observed.receiptId }),
    ).rejects.toThrow("BUDGET_OPEN");
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    await h.owner.mutation(api.verticalEvalEvidence.abandonCase, { startId: observed.startId });
    expect(await h.t.action(internal.verticalEvalSources.purgeCase, h.cases[0]!.pin)).toMatchObject(
      { done: true },
    );
    await expect(
      h.owner.query(api.verticalEvalEvidence.inspectCase, { receiptId: observed.receiptId }),
    ).rejects.toThrow();
  });

  test("budget closure is idempotent and terminal; unsettled reservations prevent closing", async () => {
    const h = await setup();
    await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId });
    expect(
      await h.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h.budgetId }),
    ).toEqual({ budgetId: h.budgetId, closed: true });
    await expect(
      h.t.mutation(internal.guardrails.reserveEvalCall, {
        tenantId: h.cases[0]!.prepared.tenantId,
        budgetId: h.budgetId,
        callId: "12345678-1234-4123-8123-123456789abd",
        model: VERTICAL_EVAL_MODELS[0],
        outputTokens: 8192,
      }),
    ).rejects.toThrow("EVAL_BUDGET_CLOSED");
    const h2 = await setup();
    await h2.t.run((ctx) =>
      ctx.db.insert("spendEvents", {
        tenantId: h2.cases[0]!.prepared.tenantId,
        rail: "reasoning",
        phase: "reserved",
        amountCents: 1,
        correlationId: "unsettled",
        evalBudgetId: h2.budgetId,
        createdAt: Date.now(),
      }),
    );
    await expect(
      h2.t.mutation(internal.guardrails.closeEvalBudget, { budgetId: h2.budgetId }),
    ).rejects.toThrow("NOT_SETTLED");
  });
});
