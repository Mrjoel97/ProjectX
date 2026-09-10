// Observation collection is a PAID diagnostic, never semantic release evidence.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { convexToJson, jsonToConvex } from "convex/values";
import { must } from "./smokeRun.mjs";
import { qualifyVerticalObservation } from "./vertical-eval-observations.mjs";
import { compileSources, sourceManifest } from "./vertical-eval-sources.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
export const cliTransport = async (name, args) => {
  const json = convexToJson(args);
  // Native argv, never a shell. Refuse before invoking if the Windows command-line bound cannot fit.
  assert(JSON.stringify(json).length <= 26000, "VERTICAL_EVAL_CLI_ARGUMENT_LIMIT");
  const output = must(name, json, { redactErrors: true }); // no paid retry or raw provider stderr
  assert(output.trim(), "VERTICAL_EVAL_EMPTY_RESULT");
  return jsonToConvex(JSON.parse(output));
};

export async function collectObservations({
  candidates,
  fixtures,
  capCents,
  creditBillingOnly = false,
  transport = cliTransport,
  runId = randomUUID(),
  checkpoint = async () => {},
  saveOutput = /** @type {(input:{runId:string,caseId:string,markdown:string,sha256:string})=>Promise<{outputRef:string}>} */ (
    async () => {
      throw new Error("OUTPUT_ARCHIVE_REQUIRED");
    }
  ),
}) {
  assert.equal(
    creditBillingOnly,
    true,
    "CREDIT_BILLING_ATTESTATION_REQUIRED: external BYOK provider billing is not bounded",
  );
  assert(
    Number.isSafeInteger(capCents) && capCents > 0 && capCents <= 1000,
    "explicit cap of 1–1000 cents required",
  );
  const cases = candidates.flatMap((candidate) => {
    const id = candidate.name.replace(/^vertical-/, "");
    return fixtures[id].cases.map((fixture) => {
      const input = typeof fixture.input === "string" ? { request: fixture.input } : fixture.input;
      const sources = compileSources(id, fixture);
      const { sources: _sources, request, ...context } = input;
      const text = Object.keys(context).length
        ? `${request}\n\nSupplied fixture context:\n${JSON.stringify(context)}`
        : request;
      const pin = {
        runId,
        caseId: `${id}-${fixture.id}`,
        caseHash: sha(JSON.stringify(fixture)),
        verticalId: id,
        candidateVersion: candidate.candidateVersion,
        bodyHash: candidate.bodyHash,
        requestHash: sha(text),
      };
      assert(pin.caseId.length <= 64, "native case id limit");
      const provision = {
        ...pin,
        sources,
        reviewReady: true,
        ...(input.legalPlaybookRef === undefined
          ? {}
          : { legalPlaybookRef: input.legalPlaybookRef }),
      };
      assert(
        JSON.stringify(convexToJson(provision)).length <= 26000,
        "VERTICAL_EVAL_CLI_ARGUMENT_LIMIT",
      );
      // Context is fixture INPUT, never expected states or assertions. Actual source bodies stay in Vault.
      return { pin, provision, text, sourceManifest: sourceManifest(sources) };
    });
  });
  assert(cases.length > 0, "empty run refused");
  const report = {
    status: "observations-incomplete",
    runId,
    sourceMode: "fixed-owned-fixtures",
    semanticReviewRequired: true,
    releaseEvidenceRecorded: false,
    activated: false,
    accountingRetained: true,
    capCents,
    billingScope: "operator-attested-openrouter-credits-only",
    manifest: cases.map((item) => ({ pin: item.pin, sourceManifest: item.sourceManifest })),
    remoteOutcomeKnown: true,
    observations:
      /** @type {Array<{caseId:string,caseHash:string,sourceManifest:ReturnType<typeof sourceManifest>,observation:Record<string,unknown>}>} */ ([]),
    cleanup: /** @type {Array<{caseId:string,done:boolean,reason?:string}>} */ ([]),
    outputArchives: /** @type {Array<{caseId:string,outputRef:string,sha256:string}>} */ ([]),
    budget: null,
  };
  const provisioned = [];
  const attempted = [];
  let budgetId;
  let outputsArchived = true;
  let remoteOutcomeKnown = true;
  try {
    await checkpoint(report); // full takeover authority exists before the first remote mutation
    // Every exact candidate must exist before writing any fixtures. No publication or activation.
    for (const item of cases)
      item.preflight = await transport("verticalEvalSources:preflight", item.pin);
    for (const item of cases) {
      attempted.push(item); // a lost CLI response may follow a committed provision; still attempt cleanup
      remoteOutcomeKnown = false;
      const prepared = await transport("verticalEvalSources:provision", item.provision);
      assert.equal(prepared.candidateId, item.preflight.candidateId, "candidate readback mismatch");
      assert.deepEqual(
        prepared.sourceRefs.map((source) => ({ ref: source.ref, hash: source.hash })),
        item.sourceManifest.map((source) => ({ ref: source.ref, hash: source.sha256 })),
        "source readback mismatch",
      );
      provisioned.push({ ...item, prepared });
      remoteOutcomeKnown = true;
    }
    remoteOutcomeKnown = false;
    budgetId = await transport("guardrails:openEvalBudget", {
      tenantIds: provisioned.map((item) => item.prepared.tenantId),
      capCents,
    });
    assert(typeof budgetId === "string" && budgetId.length > 0, "budget receipt missing");
    remoteOutcomeKnown = true;
    for (const item of provisioned) {
      const budgetBefore = await transport("guardrails:evalBudgetStatus", { budgetId });
      const { requestHash: _requestHash, ...executionPin } = item.pin;
      outputsArchived = false; // a lost action response may still have persisted an artifact
      remoteOutcomeKnown = false;
      const observation = await transport("verticalPackBinding:evaluateCase", {
        ...executionPin,
        budgetId,
        text: item.text,
      });
      // Keep actual output for review even when mechanical qualification rejects this result.
      if (typeof observation.result?.reply === "string") {
        outputsArchived = false;
        const reply = observation.result.reply;
        const outputSha256 = sha(reply);
        const archived = await saveOutput({
          runId,
          caseId: item.pin.caseId,
          markdown: reply,
          sha256: outputSha256,
        });
        assert(
          typeof archived.outputRef === "string" && archived.outputRef.length > 0,
          "output archive receipt missing",
        );
        report.outputArchives.push({
          caseId: item.pin.caseId,
          outputRef: archived.outputRef,
          sha256: outputSha256,
        });
        outputsArchived = true;
      }
      const qualified = qualifyVerticalObservation({
        pin: { ...item.pin, budgetId },
        provision: item.prepared,
        observation,
        execution: "model",
        budgetBefore,
      });
      outputsArchived = true; // qualified blocked results prove no output; executed results were archived above
      remoteOutcomeKnown = true;
      report.observations.push({
        caseId: item.pin.caseId,
        caseHash: item.pin.caseHash,
        sourceManifest: item.sourceManifest,
        observation: qualified,
      });
      await checkpoint(report);
    }
    report.status = "observations-collected-review-required";
  } catch {
    report.failureCode = "COLLECTION_OPERATION_FAILED";
  } finally {
    if (budgetId) {
      try {
        report.budget = await transport("guardrails:evalBudgetStatus", { budgetId });
        assert(
          typeof report.budget.breached === "boolean" &&
            Number.isSafeInteger(report.budget.unsettledCount) &&
            Number.isFinite(report.budget.actualUsd),
          "incomplete budget observations",
        );
        if (report.budget.breached || report.budget.unsettledCount > 0)
          report.status = "observations-incomplete";
      } catch {
        report.budgetStatusUnavailable = true;
        report.status = "observations-incomplete";
      }
    }
    let checkpointSaved = true;
    report.remoteOutcomeKnown = remoteOutcomeKnown;
    try {
      await checkpoint(report);
    } catch {
      checkpointSaved = false;
      report.status = "observations-incomplete";
    }
    const quiescent =
      !budgetId ||
      (report.budget &&
        report.budget.breached === false &&
        report.budget.unsettledCount === 0 &&
        Number.isFinite(report.budget.actualUsd));
    for (const item of attempted) {
      if (!checkpointSaved || !quiescent || !outputsArchived || !remoteOutcomeKnown) {
        report.cleanup.push({
          caseId: item.pin.caseId,
          done: false,
          reason: "RETAINED_UNTIL_ACCOUNTING_AND_CHECKPOINT_VERIFIED",
        });
        continue;
      }
      try {
        remoteOutcomeKnown = false;
        const result = await transport("verticalEvalSources:purgeCase", item.pin);
        assert.equal(result.done, true);
        remoteOutcomeKnown = true;
        report.cleanup.push({ caseId: item.pin.caseId, done: true });
      } catch {
        report.cleanup.push({
          caseId: item.pin.caseId,
          done: false,
          reason: "CLEANUP_FAILED_REQUIRES_REVIEW",
        });
        report.status = "observations-incomplete";
      }
    }
    report.remoteOutcomeKnown = remoteOutcomeKnown;
  }
  return report;
}
