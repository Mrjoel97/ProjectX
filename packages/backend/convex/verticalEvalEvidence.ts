// Native evidence authority. Content remains in Vault; audit carries only bounded refs and facts.

import type { AuditPayload } from "@pikar/contracts/audit";
import {
  requireVerticalCorpusCase as corpusCase,
  hasPassingVerticalEvalEvidence,
  VERTICAL_EVAL_MODELS,
  VERTICAL_EVAL_SUITE,
  type VerticalEvidence,
  verticalCorpus,
} from "@pikar/contracts/verticalEval";
import {
  VERTICAL_CORPUS_SHA256,
  VERTICAL_EVALUATOR_SHA256,
} from "@pikar/contracts/verticalEvalCorpus";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { appendAudit, VERTICAL_EVAL_AUDIT_NAMESPACE, VERTICAL_EVAL_EVENT_PREFIX } from "./audit";
import { ownerMutation, ownerQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { type Pin, pinArgs, verifyCaseState } from "./verticalEvalSources";
import type { VerticalEvaluationResult } from "./verticalPackBinding";

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`VERTICAL_EVIDENCE_${code}`);
}
const correlation = (pin: Pick<Pin, "runId" | "caseId">) =>
  `verticaleval:${pin.runId}:${pin.caseId}`;
const event = (suffix: string) => `${VERTICAL_EVAL_EVENT_PREFIX}${suffix}`;
const models: readonly string[] = VERTICAL_EVAL_MODELS;
const toolNames = ["searchVault", "saveAsDocument"] as const;
const common = [
  "outcome",
  "source_support",
  "coverage_and_uncertainty",
  "review_boundary",
  "refusal_and_authority",
];

async function rowsFor(ctx: QueryCtx, id: string) {
  const rows = await ctx.db
    .query("audit")
    .withIndex("by_correlation", (q) => q.eq("correlationId", id))
    .take(65);
  check(rows.length < 65, "RECEIPT_LIMIT");
  return rows.filter(
    (row) =>
      row.tenantId === VERTICAL_EVAL_AUDIT_NAMESPACE &&
      row.eventType.startsWith(VERTICAL_EVAL_EVENT_PREFIX),
  );
}
function criteriaFor(pin: Pin) {
  return [
    ...common,
    ...Object.keys(corpusCase(pin).expected)
      .sort()
      .map((key) => `expected:${key}`),
  ];
}
async function append(
  ctx: MutationCtx,
  pin: Pick<Pin, "runId" | "caseId">,
  suffix: string,
  payload: AuditPayload,
  actor = "system",
) {
  return appendAudit(ctx, {
    tenantId: VERTICAL_EVAL_AUDIT_NAMESPACE,
    correlationId: correlation(pin),
    eventType: event(suffix),
    actor,
    payload,
  });
}
function pinFrom(row: Doc<"audit">): Pin {
  return row.payload as unknown as Pin;
}
async function current(ctx: QueryCtx, pin: Pin) {
  const item = corpusCase(pin);
  const provision = await verifyCaseState(ctx, pin);
  check(
    JSON.stringify(
      provision.sourceRefs.map((s) => ({
        ref: s.ref,
        sha256: s.hash,
        mimeType: s.mimeType,
        byteLength: s.size,
      })),
    ) ===
      JSON.stringify(
        item.sources.map((s) => ({
          ref: s.ref,
          sha256: s.sha256,
          mimeType: s.mimeType,
          byteLength: s.byteLength,
        })),
      ),
    "SOURCE_CORPUS",
  );
  return provision;
}
async function ledger(
  ctx: QueryCtx,
  budgetId: Id<"spendEvents">,
  tenantId: string,
  requireClosed = false,
) {
  const envelope = await ctx.db.get(budgetId);
  check(
    envelope?.kind === "eval_envelope" &&
      envelope.phase === "estimated" &&
      envelope.evalEnvelope?.tenantIds.includes(tenantId),
    "BUDGET_BINDING",
  );
  const rows = await ctx.db
    .query("spendEvents")
    .withIndex("by_eval_budget", (q) => q.eq("evalBudgetId", budgetId))
    .take(1502);
  check(rows.length <= 1501 && !rows.some((row) => row.evalBreach), "BUDGET_BREACH");
  if (requireClosed)
    check(
      rows.some((row) => row.kind === "eval_budget_closed"),
      "BUDGET_OPEN",
    );
  const reservations = rows.filter((row) => row.phase === "reserved");
  const actuals = rows.filter((row) => row.evalActualUsd !== undefined);
  check(
    new Set(actuals.map((row) => row.correlationId)).size === actuals.length &&
      actuals.length === reservations.length,
    "BUDGET_UNSETTLED",
  );
  for (const reserve of reservations) {
    const actual = actuals.find((row) => row.correlationId === reserve.correlationId);
    check(
      actual &&
        actual.tenantId === reserve.tenantId &&
        actual.model === reserve.model &&
        Number.isFinite(actual.evalActualUsd) &&
        (actual.evalActualUsd ?? -1) >= 0,
      "BUDGET_UNSETTLED",
    );
  }
  check(
    actuals.reduce((sum, row) => sum + (row.evalActualUsd ?? 0), 0) * 100 <=
      envelope.amountCents + 1e-7,
    "BUDGET_BREACH",
  );
  const calls = actuals.filter((row) => row.tenantId === tenantId);
  check(
    calls.every((row) => typeof row.model === "string" && models.includes(row.model)),
    "MODEL_PIN",
  );
  return {
    callCount: calls.length,
    actualUsd: calls.reduce((sum, row) => sum + (row.evalActualUsd ?? 0), 0),
    models: [...new Set(calls.map((row) => row.model as string))].sort(),
    ledgerIds: calls.map((row) => row._id),
  };
}

/** One durable start BEFORE the real shared loop. No scripted shim calls this endpoint. */
export const beginCase = internalMutation({
  args: { ...pinArgs, budgetId: v.id("spendEvents") },
  handler: async (ctx, args) => {
    const { budgetId, ...pin } = args;
    const provision = await current(ctx, pin);
    check((await rowsFor(ctx, correlation(pin))).length === 0, "CASE_ALREADY_STARTED_OR_DISCARDED");
    const budget = await ledger(ctx, budgetId, provision.tenantId);
    check(budget.callCount === 0, "CASE_PREVIOUS_SPEND");
    const envelope = await ctx.db.get(budgetId);
    check((envelope?.evalEnvelope?.expiresAt ?? 0) > Date.now(), "BUDGET_EXPIRED");
    const closed = await ctx.db
      .query("spendEvents")
      .withIndex("by_correlation", (q) => q.eq("correlationId", `evalclosed:${budgetId}`))
      .first();
    check(!closed, "BUDGET_CLOSED");
    return append(ctx, pin, "started", {
      ...pin,
      budgetId,
      tenantId: provision.tenantId,
      threadId: provision.threadId,
      planId: provision.planId,
      candidateId: provision.candidateId,
      corpusHash: VERTICAL_CORPUS_SHA256,
      evaluatorHash: VERTICAL_EVALUATOR_SHA256,
    });
  },
});

/** Trusted shared-loop completion only; DB facts independently qualify the runtime observation. */
export const sealCase = internalMutation({
  args: { startId: v.id("audit"), observation: v.any() },
  handler: async (ctx, { startId, observation: raw }) => {
    const start = await ctx.db.get(startId);
    check(
      start?.tenantId === VERTICAL_EVAL_AUDIT_NAMESPACE && start.eventType === event("started"),
      "START_AUTHORITY",
    );
    const pin = pinFrom(start);
    check(
      start.payload.corpusHash === VERTICAL_CORPUS_SHA256 &&
        start.payload.evaluatorHash === VERTICAL_EVALUATOR_SHA256,
      "EVALUATOR_PIN",
    );
    const prior = await rowsFor(ctx, correlation(pin));
    check(prior.length === 1 && prior[0]?._id === startId, "CASE_ALREADY_SEALED_OR_DISCARDED");
    const provision = await current(ctx, pin);
    const observation = raw as VerticalEvaluationResult;
    const binding = observation.caseBinding;
    check(
      binding &&
        binding.tenantId === provision.tenantId &&
        binding.threadId === provision.threadId &&
        binding.planId === provision.planId &&
        binding.candidateId === provision.candidateId &&
        binding.candidateVersion === pin.candidateVersion &&
        binding.bodyHash === pin.bodyHash &&
        binding.requestHash === pin.requestHash &&
        observation.caseHash === pin.caseHash &&
        observation.inputSha256 === pin.requestHash &&
        observation.sourceMode === "fixed-owned-fixtures",
      "OBSERVATION_BINDING",
    );
    const budgetId = start.payload.budgetId as Id<"spendEvents">;
    check(observation.budget.budgetId === budgetId, "BUDGET_BINDING");
    const budget = await ledger(ctx, budgetId, provision.tenantId);
    const sourceHashes = new Map(
      provision.sourceRefs.map((source) => [String(source.docId), source.hash]),
    );
    check(
      Array.isArray(observation.sourceReads) && observation.sourceReads.length <= 5,
      "SOURCE_READS",
    );
    const sourceIds = new Set<string>();
    for (const source of observation.sourceReads) {
      check(
        sourceHashes.get(source.docId) === source.chunkHash && !sourceIds.has(source.docId),
        "SOURCE_READS",
      );
      sourceIds.add(source.docId);
    }
    const result = observation.result;
    let outputId: Id<"vaultDocuments"> | undefined;
    let outputHash: string | undefined;
    let artifactId: Id<"vaultDocuments"> | undefined;
    let blockedReason: string | undefined;
    let truncated = false;
    if (result.ok) {
      const facts = result.facts;
      check(
        facts.execution === "model" &&
          facts.candidateId === provision.candidateId &&
          facts.candidateVersion === pin.candidateVersion &&
          facts.candidateBodySha256 === pin.bodyHash &&
          facts.planId === provision.planId &&
          facts.runHash === (await contentHash(pin.runId)) &&
          facts.inputSha256 === pin.requestHash,
        "RUNTIME_BINDING",
      );
      check(
        facts.configuredModelId === models[0] &&
          facts.configuredFallbackModelId === models[1] &&
          models.includes(facts.actualModelId) &&
          budget.models.includes(facts.actualModelId),
        "MODEL_PIN",
      );
      check(
        budget.callCount > 0 &&
          Math.abs(budget.actualUsd - facts.modelCostUsd) < 1e-9 &&
          facts.costScope === "reserved_fixed_source_model_calls",
        "COST_FACTS",
      );
      check(
        facts.ungrantedToolAttemptCount === 0 && typeof facts.truncated === "boolean",
        "TOOL_AUTHORITY",
      );
      const steps = await ctx.db
        .query("agentSteps")
        .withIndex("by_turn", (q) => q.eq("tenantId", provision.tenantId).eq("turnId", pin.runId))
        .take(33);
      check(
        steps.length < 33 &&
          steps.every(
            (step) =>
              step.threadId === provision.threadId &&
              step.phase !== "running" &&
              ["thinking", ...toolNames].includes(step.tool),
          ),
        "TRACE_FACTS",
      );
      for (const key of ["attemptedAllowedTools", "completedAllowedTools"] as const)
        check(Object.keys(facts[key]).sort().join() === [...toolNames].sort().join(), "TOOL_FACTS");
      for (const name of toolNames)
        check(
          facts.attemptedAllowedTools[name] === steps.filter((step) => step.tool === name).length &&
            facts.completedAllowedTools[name] ===
              steps.filter((step) => step.tool === name && step.phase === "done").length,
          "TOOL_FACTS",
        );
      for (const source of [facts.dataSource, facts.visualSource])
        if (source) {
          check(sourceHashes.get(source.docId) === source.sha256, "SOURCE_READS");
          sourceIds.add(source.docId);
        }
      check(
        typeof result.reply === "string" &&
          new TextEncoder().encode(result.reply).length > 0 &&
          new TextEncoder().encode(result.reply).length <= 256 * 1024,
        "OUTPUT_LIMIT",
      );
      outputHash = await contentHash(result.reply);
      artifactId = result.artifactId;
      if (artifactId) {
        const doc = await ctx.db.get(artifactId);
        check(
          doc?.tenantId === provision.tenantId &&
            doc.sourcePlanId === provision.planId &&
            doc.sourceThreadId === provision.threadId &&
            doc.status === "ready" &&
            doc.text === result.reply &&
            doc.contentHash === outputHash &&
            facts.artifactId === artifactId &&
            facts.artifactContentSha256 === outputHash &&
            facts.completedAllowedTools.saveAsDocument! > 0,
          "ARTIFACT_READBACK",
        );
        outputId = artifactId;
      } else {
        check(
          facts.artifactId === undefined && facts.artifactContentSha256 === undefined,
          "ARTIFACT_READBACK",
        );
        outputId = await ctx.db.insert("vaultDocuments", {
          tenantId: provision.tenantId,
          title: "Native evaluation output for owner review",
          kind: "document",
          category: "workspace-docs",
          source: "agent",
          origin: "agent",
          mimeType: "text/markdown",
          size: new TextEncoder().encode(result.reply).length,
          text: result.reply,
          contentHash: outputHash,
          status: "ready",
          sourcePlanId: provision.planId,
          sourceThreadId: provision.threadId,
          createdAt: Date.now(),
        });
      }
      truncated = facts.truncated;
    } else {
      check(
        budget.callCount === 0 &&
          sourceIds.size === 0 &&
          [
            "missing-source",
            "playbook-required",
            "review-required",
            "validator-unavailable",
            "connector-not-approved",
          ].includes(result.reason),
        "BLOCKED_NOT_QUALIFIABLE",
      );
      blockedReason = result.reason;
    }
    return append(ctx, pin, "case", {
      ...pin,
      startId,
      candidateId: provision.candidateId,
      tenantId: provision.tenantId,
      threadId: provision.threadId,
      planId: provision.planId,
      budgetId,
      corpusHash: VERTICAL_CORPUS_SHA256,
      evaluatorHash: VERTICAL_EVALUATOR_SHA256,
      callCount: budget.callCount,
      actualUsd: budget.actualUsd,
      modelIds: budget.models,
      ledgerIds: budget.ledgerIds,
      sourceDocIds: [...sourceIds],
      sourceHashes: [...sourceIds].map((id) => sourceHashes.get(id)!),
      outputId,
      outputHash,
      artifactId,
      blockedReason,
      truncated,
      runtimeOnly: true,
    });
  },
});

async function readableCase(ctx: QueryCtx, receiptId: Id<"audit">) {
  const receipt = await ctx.db.get(receiptId);
  check(
    receipt?.tenantId === VERTICAL_EVAL_AUDIT_NAMESPACE && receipt.eventType === event("case"),
    "CASE_AUTHORITY",
  );
  const pin = pinFrom(receipt);
  check(
    receipt.payload.corpusHash === VERTICAL_CORPUS_SHA256 &&
      receipt.payload.evaluatorHash === VERTICAL_EVALUATOR_SHA256,
    "EVALUATOR_PIN",
  );
  const provision = await current(ctx, pin);
  check(
    !(await rowsFor(ctx, correlation(pin))).some((row) =>
      [event("abandoned"), event("cleanup")].includes(row.eventType),
    ),
    "CASE_DISCARDED",
  );
  const budget = await ledger(
    ctx,
    receipt.payload.budgetId as Id<"spendEvents">,
    provision.tenantId,
    true,
  );
  check(
    budget.callCount === receipt.payload.callCount &&
      Math.abs(budget.actualUsd - Number(receipt.payload.actualUsd)) < 1e-9 &&
      JSON.stringify(budget.ledgerIds) === JSON.stringify(receipt.payload.ledgerIds),
    "LEDGER_CHANGED",
  );
  const outputId = receipt.payload.outputId as Id<"vaultDocuments"> | undefined;
  const output = outputId ? await ctx.db.get(outputId) : null;
  if (outputId)
    check(
      output?.tenantId === provision.tenantId &&
        output.status === "ready" &&
        output.sourcePlanId === provision.planId &&
        output.sourceThreadId === provision.threadId &&
        typeof output.text === "string" &&
        (await contentHash(output.text)) === receipt.payload.outputHash &&
        output.contentHash === receipt.payload.outputHash,
      "OUTPUT_CHANGED",
    );
  return { receipt, pin, provision, output };
}

/** Authenticated owner readback: content is deliberately returned here, never in audit receipts. */
export const inspectCase = ownerQuery({
  args: { receiptId: v.id("audit") },
  handler: async (ctx, { receiptId }) => {
    const state = await readableCase(ctx, receiptId);
    const sources = [];
    for (const source of state.provision.sourceRefs) {
      const doc = await ctx.db.get(source.docId);
      sources.push({
        ...source,
        ...(doc?.text === undefined ? {} : { text: doc.text }),
        url: await ctx.storage.getUrl(source.storageId),
      });
    }
    return {
      receiptId,
      binding: state.receipt.payload,
      expected: corpusCase(state.pin).expected,
      criteria: criteriaFor(state.pin),
      output: state.output?.text ?? null,
      sources,
      semanticReviewRequired: true,
    };
  },
});

const decisionArgs = v.object({
  criterion: v.string(),
  decision: v.union(v.literal("supported"), v.literal("contradicted"), v.literal("needs_review")),
  outputSpans: v.array(
    v.object({ startByte: v.number(), endByte: v.number(), sha256: v.string() }),
  ),
  sourceDocIds: v.array(v.id("vaultDocuments")),
});
/** Explicit human judgment, authenticated here; local JSON packets never import authority. */
export const reviewCase = ownerMutation({
  args: {
    receiptId: v.id("audit"),
    outputHash: v.optional(v.string()),
    sourceHashes: v.array(v.string()),
    outcome: v.union(
      v.literal("artifact"),
      v.literal("partial"),
      v.literal("refused"),
      v.literal("blocked"),
    ),
    qualifiedRole: v.union(
      v.literal("owner"),
      v.literal("qualified_counsel"),
      v.literal("qualified_hr"),
    ),
    decisions: v.array(decisionArgs),
  },
  handler: async (ctx, args) => {
    const { receipt, pin, provision, output } = await readableCase(ctx, args.receiptId);
    const previous = await rowsFor(ctx, correlation(pin));
    check(!previous.some((row) => row.eventType === event("review")), "REVIEW_ALREADY_RECORDED");
    check(
      args.outputHash === receipt.payload.outputHash &&
        JSON.stringify(args.sourceHashes) ===
          JSON.stringify(provision.sourceRefs.map((s) => s.hash)),
      "REVIEW_READBACK_BINDING",
    );
    const required = criteriaFor(pin);
    check(
      args.decisions.length === required.length &&
        new Set(args.decisions.map((d) => d.criterion)).size === required.length &&
        args.decisions.every((d) => required.includes(d.criterion)),
      "REVIEW_CRITERIA",
    );
    if (pin.verticalId === "legal")
      check(args.qualifiedRole === "qualified_counsel", "QUALIFIED_COUNSEL_ATTESTATION_REQUIRED");
    if (pin.verticalId === "hr")
      check(args.qualifiedRole === "qualified_hr", "QUALIFIED_HR_ATTESTATION_REQUIRED");
    const bytes = new TextEncoder().encode(output?.text ?? "");
    const spans: string[] = [];
    const cited = new Set<string>();
    for (const decision of args.decisions) {
      check(decision.outputSpans.length <= 8 && decision.sourceDocIds.length <= 5, "REVIEW_LIMIT");
      if (decision.decision !== "needs_review" && output)
        check(decision.outputSpans.length > 0, "REVIEW_OUTPUT_EVIDENCE_REQUIRED");
      if (!output)
        check(
          decision.outputSpans.length === 0 && args.outcome === "blocked",
          "REVIEW_BLOCKED_BINDING",
        );
      for (const span of decision.outputSpans) {
        check(
          Number.isSafeInteger(span.startByte) &&
            Number.isSafeInteger(span.endByte) &&
            span.startByte >= 0 &&
            span.endByte > span.startByte &&
            span.endByte <= bytes.length,
          "REVIEW_SPAN",
        );
        const slice = bytes.slice(span.startByte, span.endByte);
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(slice);
        } catch {
          throw new Error("VERTICAL_EVIDENCE_REVIEW_SPAN");
        }
        check((await contentHash(slice.buffer)) === span.sha256, "REVIEW_QUOTE_HASH");
        spans.push(`${decision.criterion}:${span.startByte}:${span.endByte}:${span.sha256}`);
      }
      for (const id of decision.sourceDocIds) {
        check(
          provision.sourceRefs.some((s) => s.docId === id) &&
            (!output || (receipt.payload.sourceDocIds as string[]).includes(id)),
          "REVIEW_SOURCE_BINDING",
        );
        cited.add(id);
      }
      if (
        decision.criterion === "source_support" &&
        decision.decision === "supported" &&
        output &&
        provision.sourceRefs.length > 0
      )
        check(decision.sourceDocIds.length > 0, "REVIEW_SOURCE_EVIDENCE_REQUIRED");
    }
    const expected = corpusCase(pin).expected as {
      state?: string;
      requiredSourceRefs?: readonly string[];
    };
    const requiredSourcesRead = (expected.requiredSourceRefs ?? []).every((ref) =>
      provision.sourceRefs.some(
        (source) =>
          source.ref === ref && (receipt.payload.sourceDocIds as string[]).includes(source.docId),
      ),
    );
    const accepted =
      requiredSourcesRead &&
      (expected.state === undefined || args.outcome === expected.state) &&
      args.decisions.every((d) => d.decision === "supported") &&
      (args.outcome !== "artifact" ||
        (receipt.payload.artifactId !== undefined && receipt.payload.truncated === false));
    return append(
      ctx,
      pin,
      "review",
      {
        ...pin,
        receiptId: args.receiptId,
        outputHash: args.outputHash,
        sourceHashes: args.sourceHashes,
        ownerId: ctx.userId,
        qualifiedRole: args.qualifiedRole,
        outcome: args.outcome,
        criteria: required,
        decisions: args.decisions.map((d) => `${d.criterion}:${d.decision}`),
        outputSpans: spans,
        citedSourceIds: [...cited],
        accepted,
        qualifiedRoleSelfAttested: true,
      },
      String(ctx.userId),
    );
  },
});

export const abandonCase = ownerMutation({
  args: { startId: v.id("audit") },
  handler: async (ctx, { startId }) => {
    const start = await ctx.db.get(startId);
    check(
      start?.tenantId === VERTICAL_EVAL_AUDIT_NAMESPACE && start.eventType === event("started"),
      "START_AUTHORITY",
    );
    const pin = pinFrom(start);
    await ledger(
      ctx,
      start.payload.budgetId as Id<"spendEvents">,
      start.payload.tenantId as string,
      true,
    );
    const previous = await rowsFor(ctx, correlation(pin));
    check(!previous.some((row) => row.eventType === event("issued")), "ALREADY_ISSUED");
    if (previous.some((row) => row.eventType === event("abandoned"))) return { abandoned: true };
    await append(ctx, pin, "abandoned", { startId, ownerId: ctx.userId }, String(ctx.userId));
    return { abandoned: true };
  },
});

/** Atomically freezes cleanup authority before any page deletes, blocking a racing begin. */
export const claimCleanup = internalMutation({
  args: pinArgs,
  handler: async (ctx, pin) => {
    const rows = await rowsFor(ctx, correlation(pin));
    if (rows.some((row) => row.eventType === event("cleanup"))) return;
    check(
      !rows.some((row) => row.eventType === event("started")) ||
        rows.some(
          (row) => row.eventType === event("abandoned") || row.eventType === event("issued"),
        ),
      "RETAINED_FOR_AUTHENTICATED_REVIEW",
    );
    await append(ctx, pin, "cleanup", { runId: pin.runId, caseId: pin.caseId });
  },
});

export const finalize = ownerMutation({
  args: { runId: v.string(), name: v.string(), version: v.number() },
  handler: async (ctx, { runId, name, version }) => {
    const corpus = verticalCorpus(name);
    check(corpus, "CORPUS_PIN");
    const candidate = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();
    check(candidate?.status === "candidate", "CANDIDATE_CHANGED");
    const bodyHash = await contentHash(candidate.body);
    const caseIds: string[] = [],
      reviewIds: string[] = [],
      observedModels = new Set<string>();
    let budgetId: string | undefined;
    for (const item of corpus) {
      const rows = await rowsFor(ctx, correlation({ runId, caseId: item.caseId }));
      const cases = rows.filter((row) => row.eventType === event("case"));
      const reviews = rows.filter((row) => row.eventType === event("review"));
      check(
        cases.length === 1 &&
          reviews.length === 1 &&
          !rows.some((row) =>
            [event("issued"), event("abandoned"), event("cleanup")].includes(row.eventType),
          ),
        "CORPUS_INCOMPLETE",
      );
      const receipt = cases[0]!,
        review = reviews[0]!;
      await readableCase(ctx, receipt._id);
      check(
        receipt.payload.candidateId === candidate._id &&
          receipt.payload.candidateVersion === version &&
          receipt.payload.bodyHash === bodyHash &&
          receipt.payload.caseHash === item.caseHash &&
          review.payload.receiptId === receipt._id &&
          review.payload.accepted === true &&
          review.actor === review.payload.ownerId,
        "REVIEW_NOT_ACCEPTED",
      );
      if (budgetId === undefined) budgetId = receipt.payload.budgetId as string;
      check(receipt.payload.budgetId === budgetId, "RUN_BUDGET_MISMATCH");
      for (const model of receipt.payload.modelIds as string[]) observedModels.add(model);
      caseIds.push(receipt._id);
      reviewIds.push(review._id);
    }
    check(observedModels.size > 0 && budgetId, "NO_MODEL_CORPUS");
    const core: Omit<VerticalEvidence, "issuanceId"> = {
      schemaVersion: 1,
      kind: "native-owner-reviewed-vertical",
      name,
      version,
      candidateId: candidate._id,
      bodyHash,
      runId,
      corpusHash: VERTICAL_CORPUS_SHA256,
      evaluatorHash: VERTICAL_EVALUATOR_SHA256,
      caseHashes: corpus.map((c) => c.caseHash),
      caseReceiptIds: caseIds,
      reviewReceiptIds: reviewIds,
      modelIds: [...observedModels].sort(),
      budgetId,
      passed: true,
    };
    const evidenceHash = await contentHash(JSON.stringify(core));
    const issuanceId = await appendAudit(ctx, {
      tenantId: VERTICAL_EVAL_AUDIT_NAMESPACE,
      eventType: event("issuance"),
      correlationId: `verticalissuance:${runId}:${name}:${version}`,
      actor: String(ctx.userId),
      payload: {
        evidenceHash,
        candidateId: candidate._id,
        bodyHash,
        corpusHash: VERTICAL_CORPUS_SHA256,
        evaluatorHash: VERTICAL_EVALUATOR_SHA256,
        caseReceiptIds: caseIds,
        reviewReceiptIds: reviewIds,
        ownerId: ctx.userId,
      },
    });
    await ctx.db.patch(candidate._id, { evidence: JSON.stringify({ ...core, issuanceId }) });
    for (const item of corpus)
      await append(ctx, { runId, caseId: item.caseId }, "issued", { issuanceId });
    return { issuanceId, candidateId: candidate._id, evidenceHash, activated: false };
  },
});

/** JSON claims never suffice: only reserved immutable issuance satisfies the native gate. */
export async function hasNativeVerticalEvidence(
  ctx: QueryCtx,
  candidate: Doc<"skills">,
): Promise<boolean> {
  if (!hasPassingVerticalEvalEvidence(candidate.evidence, candidate.name, candidate.version))
    return false;
  try {
    const value = JSON.parse(candidate.evidence!) as VerticalEvidence;
    const { issuanceId, ...core } = value;
    const id = ctx.db.normalizeId("audit", issuanceId);
    const receipt = id ? await ctx.db.get(id) : null;
    return (
      value.candidateId === candidate._id &&
      value.bodyHash === (await contentHash(candidate.body)) &&
      receipt?.tenantId === VERTICAL_EVAL_AUDIT_NAMESPACE &&
      receipt.eventType === event("issuance") &&
      receipt.payload.evidenceHash === (await contentHash(JSON.stringify(core))) &&
      receipt.payload.candidateId === candidate._id &&
      receipt.payload.bodyHash === value.bodyHash
    );
  } catch {
    return false;
  }
}

/** Recover IDs after a lost action response without requiring a privileged audit-table scan.
 * Reads the fixed corpus only. A stored start is not evidence of completion or acceptance. */
export const inspectRun = ownerQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    check(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId),
      "RUN_ID",
    );
    const cases = [];
    for (const name of VERTICAL_EVAL_SUITE.names) {
      for (const item of verticalCorpus(name) ?? []) {
        const rows = await rowsFor(ctx, correlation({ runId, caseId: item.caseId }));
        const find = (suffix: string) => rows.find((row) => row.eventType === event(suffix));
        const start = find("started"),
          receipt = find("case"),
          review = find("review");
        const stage = find("cleanup")
          ? "cleanup-authorized"
          : find("abandoned")
            ? "abandoned"
            : find("issued")
              ? "issued"
              : review
                ? "reviewed"
                : receipt
                  ? "awaiting-review"
                  : start
                    ? "started-outcome-unknown"
                    : "not-started";
        const rawBudgetId = start?.payload.budgetId;
        const budgetId =
          typeof rawBudgetId === "string" ? ctx.db.normalizeId("spendEvents", rawBudgetId) : null;
        cases.push({
          name,
          caseId: item.caseId,
          stage,
          startId: start?._id ?? null,
          receiptId: receipt?._id ?? null,
          reviewId: review?._id ?? null,
          budgetId,
          reviewAccepted: review ? review.payload.accepted === true : null,
          currentPins: start
            ? start.payload.corpusHash === VERTICAL_CORPUS_SHA256 &&
              start.payload.evaluatorHash === VERTICAL_EVALUATOR_SHA256 &&
              start.payload.caseHash === item.caseHash &&
              start.payload.requestHash === item.requestHash
            : null,
        });
      }
    }
    return {
      runId,
      corpusHash: VERTICAL_CORPUS_SHA256,
      evaluatorHash: VERTICAL_EVALUATOR_SHA256,
      cases,
    };
  },
});
