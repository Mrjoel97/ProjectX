// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { qualifyVerticalObservation } from "../scripts/vertical-eval-observations.mjs";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function sample() {
  const pin = {
    runId: "abcdef12-1234-4567-8123-123456789012",
    caseId: "visible-artifact",
    verticalId: "design",
    caseHash: hash("case"),
    requestHash: hash("PRIVATE REQUEST"),
    bodyHash: hash("body"),
    candidateVersion: 1,
    budgetId: "budget1",
  };
  const provision = {
    tenantId: "packeval-abcdef12-visible-artifact",
    threadId: `verticaleval:${pin.runId}:${pin.caseId}`,
    planId: "plan1",
    candidateId: "candidate1",
    sourceRefs: [{ ref: "fixture:design:image", docId: "doc1", hash: hash("pixels") }],
  };
  const budgetBefore = {
    budgetId: pin.budgetId,
    capCents: 500,
    expired: false,
    breached: false,
    remainingCents: 500,
    actualUsd: 0,
    callCount: 0,
    settledCount: 0,
    unsettledCount: 0,
    unresolvedCents: 0,
  };
  const reply = "PRIVATE OBSERVED REPLY\r\nExact bytes matter.";
  const observation = {
    caseHash: pin.caseHash,
    inputSha256: pin.requestHash,
    sourceMode: "fixed-owned-fixtures",
    releaseEvidenceRecorded: false,
    caseBinding: {
      tenantId: provision.tenantId,
      threadId: provision.threadId,
      planId: provision.planId,
      candidateId: provision.candidateId,
      candidateVersion: 1,
      bodyHash: pin.bodyHash,
      requestHash: pin.requestHash,
    },
    sourceReads: [] as { docId: string; chunkHash: string }[],
    budget: {
      ...budgetBefore,
      remainingCents: 499,
      actualUsd: 0.01,
      callCount: 1,
      settledCount: 1,
    },
    result: {
      ok: true,
      reply,
      version: 1,
      outcome: "useful",
      artifactId: "artifact1",
      facts: {
        schemaVersion: 1,
        runHash: hash(pin.runId),
        inputSha256: pin.requestHash,
        planId: provision.planId,
        candidateId: provision.candidateId,
        candidateVersion: 1,
        candidateBodySha256: pin.bodyHash,
        execution: "model",
        configuredModelId: "or/openai/gpt-5.6-luna",
        configuredFallbackModelId: "or/openai/gpt-4.1-mini",
        actualModelId: "or/openai/gpt-5.6-luna",
        modelCostUsd: 0.01,
        costScope: "reserved_fixed_source_model_calls",
        attemptedAllowedTools: { searchVault: 0, saveAsDocument: 1 },
        completedAllowedTools: { searchVault: 0, saveAsDocument: 1 },
        ungrantedToolAttemptCount: 0,
        truncated: false,
        grounding: "owned_image_input",
        visualSource: { docId: "doc1", sha256: hash("pixels") },
        artifactId: "artifact1",
        artifactContentSha256: hash(reply),
      },
    },
  };
  return { pin, provision, observation, budgetBefore, execution: "model" };
}

describe("mechanical vertical observations, never semantic acceptance", () => {
  test("binds real facts and returns only refs/hashes/counts with mandatory review", () => {
    const input = sample();
    const output = qualifyVerticalObservation(input);
    expect(output).toMatchObject({
      mechanicalOutcome: "useful",
      semanticReviewRequired: true,
      releasePassed: false,
      modelEvaluated: true,
      artifactContentSha256: hash(input.observation.result.reply),
    });
    expect(JSON.stringify(output)).not.toContain("PRIVATE");
    expect(output).not.toHaveProperty("reply");
    expect(output).not.toHaveProperty("passed");
  });

  test.each([
    [
      "case hash",
      (s: ReturnType<typeof sample>) => {
        s.observation.caseHash = hash("wrong");
      },
    ],
    [
      "request hash",
      (s: ReturnType<typeof sample>) => {
        s.observation.inputSha256 = hash("wrong");
      },
    ],
    [
      "body hash",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.candidateBodySha256 = hash("wrong");
      },
    ],
    [
      "version",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.candidateVersion = 2;
      },
    ],
    [
      "candidate",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.candidateId = "foreignCandidate";
      },
    ],
    [
      "plan",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.planId = "foreignPlan";
      },
    ],
    [
      "tenant",
      (s: ReturnType<typeof sample>) => {
        s.observation.caseBinding.tenantId = "foreignTenant";
      },
    ],
    [
      "provision tenant",
      (s: ReturnType<typeof sample>) => {
        s.provision.tenantId = "foreignTenant";
      },
    ],
    [
      "thread",
      (s: ReturnType<typeof sample>) => {
        s.observation.caseBinding.threadId += "wrong";
      },
    ],
    [
      "image id",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.visualSource.docId = "foreignImage";
      },
    ],
    [
      "image hash",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.visualSource.sha256 = hash("wrong");
      },
    ],
    [
      "source read",
      (s: ReturnType<typeof sample>) => {
        s.observation.sourceReads = [{ docId: "foreignDoc", chunkHash: hash("pixels") }];
      },
    ],
    [
      "scripted as model",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.execution = "scripted";
      },
    ],
    [
      "unknown model",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.actualModelId = "or/unknown";
      },
    ],
    [
      "artifact id",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.artifactId = "foreignArtifact";
      },
    ],
    [
      "artifact hash",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.artifactContentSha256 = hash("wrong");
      },
    ],
    [
      "normalized artifact hash",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.artifactContentSha256 = hash(
          s.observation.result.reply.replace(/\r\n/g, "\n"),
        );
      },
    ],
    [
      "NaN cost",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.modelCostUsd = Number.NaN;
      },
    ],
    [
      "different case spend",
      (s: ReturnType<typeof sample>) => {
        s.observation.budget.actualUsd = 0.02;
      },
    ],
    [
      "budget id",
      (s: ReturnType<typeof sample>) => {
        s.observation.budget.budgetId = "foreignBudget";
      },
    ],
    [
      "unsettled",
      (s: ReturnType<typeof sample>) => {
        s.observation.budget.unsettledCount = 1;
      },
    ],
    [
      "unresolved",
      (s: ReturnType<typeof sample>) => {
        s.observation.budget.unresolvedCents = 1;
      },
    ],
    [
      "breach",
      (s: ReturnType<typeof sample>) => {
        s.observation.budget.breached = true;
      },
    ],
    [
      "tool count",
      (s: ReturnType<typeof sample>) => {
        s.observation.result.facts.completedAllowedTools.searchVault = 1;
      },
    ],
    [
      "release receipt",
      (s: ReturnType<typeof sample>) => {
        s.observation.releaseEvidenceRecorded = true;
      },
    ],
  ])("rejects stale/mismatched %s", (_name, mutate) => {
    const input = sample();
    mutate(input);
    expect(() => qualifyVerticalObservation(input)).toThrow(/VERTICAL_OBSERVATION_/);
  });

  test("missing fields and expanded tool authority fail closed", () => {
    for (const field of ["modelCostUsd", "artifactContentSha256", "truncated"]) {
      const input = sample();
      Reflect.deleteProperty(input.observation.result.facts, field);
      expect(() => qualifyVerticalObservation(input)).toThrow(/VERTICAL_OBSERVATION_/);
    }
    const input = sample();
    Object.assign(input.observation.result.facts.attemptedAllowedTools, { sendEmail: 1 });
    expect(() => qualifyVerticalObservation(input)).toThrow("TOOL_COUNTS");
    const noBaseline = sample();
    Reflect.deleteProperty(noBaseline, "budgetBefore");
    expect(() => qualifyVerticalObservation(noBaseline)).toThrow("MODEL_COST");
  });

  test("truncation or an ungranted attempt downgrades useful to mechanically partial", () => {
    const input = sample();
    input.observation.result.facts.truncated = true;
    expect(qualifyVerticalObservation(input)).toMatchObject({
      mechanicalOutcome: "partial",
      releasePassed: false,
    });
    input.observation.result.facts.truncated = false;
    input.observation.result.facts.ungrantedToolAttemptCount = 1;
    expect(qualifyVerticalObservation(input).mechanicalOutcome).toBe("partial");
  });

  test("scripted fixtures remain labelled non-model and never masquerade as paid evidence", () => {
    const input = sample();
    input.execution = "scripted";
    input.observation.result.facts.execution = "scripted";
    input.observation.result.facts.modelCostUsd = 0;
    input.observation.budget = { ...input.budgetBefore };
    expect(qualifyVerticalObservation(input)).toMatchObject({
      execution: "scripted",
      modelEvaluated: false,
      semanticReviewRequired: true,
      releasePassed: false,
    });
  });

  test("blocked cases preserve exact pins, reject cross-plan bindings and contain no invented model facts", () => {
    const input = sample();
    const blocked = {
      ...input,
      observation: {
        ...input.observation,
        budget: { ...input.budgetBefore },
        result: { ok: false, reason: "missing-source" },
      },
    };
    expect(qualifyVerticalObservation(blocked)).toMatchObject({
      mechanicalOutcome: "blocked",
      blockedReason: "missing-source",
      candidateId: "candidate1",
      planId: "plan1",
      requestHash: input.pin.requestHash,
      modelEvaluated: false,
      releasePassed: false,
    });
    blocked.observation.caseBinding.planId = "foreignPlan";
    expect(() => qualifyVerticalObservation(blocked)).toThrow("CASE_BINDING");
  });

  test("Data facts bind the deterministic reader hash, text facts bind actual tool reads", () => {
    const input = sample();
    input.pin.verticalId = "data";
    input.provision.sourceRefs = [
      { ref: "fixture:data:dataset", docId: "doc1", hash: hash("pixels") },
    ];
    const facts = input.observation.result.facts;
    Object.assign(facts, { dataSource: facts.visualSource, grounding: "deterministic_dataset" });
    Reflect.deleteProperty(facts, "visualSource");
    expect(qualifyVerticalObservation(input)).toHaveProperty("dataSource.sha256", hash("pixels"));
    input.pin.verticalId = "product";
    input.provision.sourceRefs = [
      { ref: "fixture:product:research", docId: "doc1", hash: hash("pixels") },
    ];
    Reflect.deleteProperty(facts, "dataSource");
    facts.grounding = "vault_excerpt";
    input.observation.sourceReads = [{ docId: "doc1", chunkHash: hash("pixels") }];
    facts.attemptedAllowedTools.searchVault = 1;
    facts.completedAllowedTools.searchVault = 1;
    expect(qualifyVerticalObservation(input).sourceReads).toEqual(input.observation.sourceReads);
    input.observation.sourceReads = [{ docId: "doc1", chunkHash: hash("changed source") }];
    expect(() => qualifyVerticalObservation(input)).toThrow("SOURCE_READS");
  });
});
