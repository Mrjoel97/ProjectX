import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { profileDataset } from "@pikar/core/dataProfile";
import { readDataWorkbook } from "@pikar/vault/dataWorkbook";
import { describe, expect, test, vi } from "vitest";
import { inspectPreparation } from "../scripts/run-eval-vertical.mjs";
import { collectObservations } from "../scripts/vertical-eval-collect.mjs";
import { compileSources } from "../scripts/vertical-eval-sources.mjs";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const candidates = inspectPreparation();
const fixtures = Object.fromEntries(
  candidates.map((candidate) => {
    const id = candidate.name.replace("vertical-", "");
    return [
      id,
      JSON.parse(
        readFileSync(new URL(`../scripts/vertical-eval-cases/${id}.json`, import.meta.url), "utf8"),
      ),
    ];
  }),
);
const runId = "abcdef12-1234-4567-8123-123456789012";
describe("vertical source compiler and collection coordination", () => {
  test.each([
    "provision",
    "evaluateCase",
  ])("lost %s response preserves remote state despite clean accounting", async (operation) => {
    const call = transport();
    const fault = vi.fn(async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, args);
      if (name.endsWith(`:${operation}`)) throw new Error("lost-remote-response");
      return result;
    });
    const checkpoints: unknown[] = [];
    const report = await collectObservations({
      candidates,
      fixtures,
      capCents: 500,
      creditBillingOnly: true,
      transport: fault,
      runId,
      checkpoint: async (...args: unknown[]) => {
        checkpoints.push(structuredClone(args[0]));
      },
    });
    expect(report.remoteOutcomeKnown).toBe(false);
    expect(fault.mock.calls.some(([name]) => name.endsWith(":purgeCase"))).toBe(false);
    expect(checkpoints[0]).toMatchObject({ manifest: expect.any(Array), observations: [] });
    expect(report.manifest).toHaveLength(40);
    expect(report.manifest[0]?.pin.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });
  test("real Data recipes produce observed numeric and truncation/formula facts; image metadata stays missing", () => {
    for (const fixture of fixtures.data.cases) {
      for (const source of compileSources("data", fixture)) {
        const profile = profileDataset({
          source: {
            fileId: source.ref,
            contentHash: "fixture",
            format: "xlsx",
            byteLength: source.bytes.byteLength,
          },
          ...readDataWorkbook(new Uint8Array(source.bytes), "xlsx"),
        });
        if (fixture.id === "typed-xlsx-profile")
          expect(profile.sheets[0]?.columns[0]?.numericRange).toEqual({ min: -4, max: 12 });
        if (fixture.id === "truncated-multisheet")
          expect(profile.warnings).toEqual(
            expect.arrayContaining([
              "rows_truncated",
              "sheets_truncated",
              "mixed_types",
              "mixed_currencies",
            ]),
          );
        if (fixture.id === "cached-formula-and-active-content")
          expect(profile.warnings).toEqual(
            expect.arrayContaining([
              "formula_cached_values_only",
              "formula_without_cached_value",
              "macros_not_executed",
              "external_links_not_followed",
            ]),
          );
      }
    }
    expect(
      compileSources(
        "design",
        fixtures.design.cases.find((item: { id: string }) => item.id === "image-not-accessible"),
      ),
    ).toEqual([]);
  });

  function transport(unsettledCount = 0, rawReply = "") {
    const prepared = new Map<
      string,
      {
        tenantId: string;
        threadId: string;
        planId: string;
        candidateId: string;
        sourceRefs: { ref: string; docId: string; hash: string }[];
      }
    >();
    const budget = {
      budgetId: "budget-id",
      capCents: 500,
      expired: false,
      breached: false,
      remainingCents: 500,
      actualUsd: 0,
      callCount: unsettledCount,
      settledCount: 0,
      unsettledCount,
      unresolvedCents: unsettledCount * 54,
    };
    return vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name.endsWith(":preflight")) return { candidateId: `candidate-${args.verticalId}` };
      if (name.endsWith(":provision")) {
        const row = {
          tenantId: `packeval-abcdef12-${args.caseId}`,
          threadId: `verticaleval:${args.runId}:${args.caseId}`,
          planId: `plan-${args.caseId}`,
          candidateId: `candidate-${args.verticalId}`,
          sourceRefs: (args.sources as { ref: string; bytes: ArrayBuffer }[]).map(
            (source, index) => ({
              ref: source.ref,
              docId: `doc-${args.caseId}-${index}`,
              hash: createHash("sha256").update(new Uint8Array(source.bytes)).digest("hex"),
            }),
          ),
        };
        prepared.set(String(args.caseId), row);
        return row;
      }
      if (name.endsWith(":openEvalBudget")) return "budget-id";
      if (name.endsWith(":evalBudgetStatus")) return budget;
      if (name.endsWith(":purgeCase")) return { done: true };
      if (name.endsWith(":evaluateCase")) {
        const row = prepared.get(String(args.caseId));
        if (!row) throw new Error("Missing provision");
        return {
          caseHash: String(args.caseHash),
          inputSha256: hash(String(args.text)),
          sourceMode: "fixed-owned-fixtures",
          releaseEvidenceRecorded: false,
          sourceReads: [],
          budget,
          caseBinding: {
            tenantId: row.tenantId,
            threadId: row.threadId,
            planId: row.planId,
            candidateId: row.candidateId,
            candidateVersion: Number(args.candidateVersion),
            bodyHash: String(args.bodyHash),
            requestHash: hash(String(args.text)),
          },
          result: { ok: false, reason: "missing-source", ...(rawReply ? { reply: rawReply } : {}) },
        };
      }
      throw new Error(`Unexpected transport ${name}`);
    });
  }
  test("all cases share one budget, observed blocked remains blocked, checkpoint precedes every cleanup", async () => {
    const call = transport();
    const checkpoint = vi.fn(async () => {});
    const report = await collectObservations({
      candidates,
      fixtures,
      capCents: 500,
      creditBillingOnly: true,
      transport: call,
      runId,
      checkpoint,
    });
    expect(report.status).toBe("observations-collected-review-required");
    expect(report.observations).toHaveLength(40);
    for (const item of report.observations)
      expect(item.observation).toMatchObject({
        mechanicalOutcome: "blocked",
        blockedReason: "missing-source",
      });
    expect(report.releaseEvidenceRecorded).toBe(false);
    const calls = call.mock.calls;
    const open = calls.filter(([name]) => name.endsWith(":openEvalBudget"));
    expect(open).toHaveLength(1);
    expect(open[0]?.[1].tenantIds).toHaveLength(40);
    const lastEvaluate = calls.map(([name]) => name.endsWith(":evaluateCase")).lastIndexOf(true);
    const firstPurge = calls.findIndex(([name]) => name.endsWith(":purgeCase"));
    expect(firstPurge).toBeGreaterThan(lastEvaluate);
    expect(checkpoint.mock.invocationCallOrder.at(-1)).toBeLessThan(
      call.mock.invocationCallOrder[firstPurge] ?? 0,
    );
    expect(calls.some(([name]) => /seedCandidates|record.*Evidence|activate/.test(name))).toBe(
      false,
    );
  });
  test("unknown charges preserve all case state and missing credit billing attestation performs no call", async () => {
    const call = transport(1);
    const report = await collectObservations({
      candidates,
      fixtures,
      capCents: 500,
      creditBillingOnly: true,
      transport: call,
      runId,
    });
    expect(report.status).toBe("observations-incomplete");
    expect(call.mock.calls.some(([name]) => name.endsWith(":purgeCase"))).toBe(false);
    expect(report.cleanup.every((item) => item.done === false)).toBe(true);
    call.mockClear();
    await expect(
      collectObservations({ candidates, fixtures, capCents: 500, transport: call, runId }),
    ).rejects.toThrow("CREDIT_BILLING");
    expect(call).not.toHaveBeenCalled();
    await expect(
      collectObservations({
        candidates,
        fixtures,
        capCents: 1001,
        creditBillingOnly: true,
        transport: call,
        runId,
      }),
    ).rejects.toThrow("1–1000");
    expect(call).not.toHaveBeenCalled();
  });
  test("archives rejected raw output separately and retains artifacts when archival fails", async () => {
    const rawReply = "Synthetic unqualified output must remain reviewable.";
    const call = transport(0, rawReply);
    const saveOutput = vi.fn(async ({ markdown, sha256 }: { markdown: string; sha256: string }) => {
      expect(markdown).toBe(rawReply);
      expect(sha256).toBe(hash(rawReply));
      return { outputRef: ".tmp/synthetic-output.md" };
    });
    const report = await collectObservations({
      candidates,
      fixtures,
      capCents: 500,
      creditBillingOnly: true,
      transport: call,
      runId,
      saveOutput,
    });
    expect(report.status).toBe("observations-incomplete");
    expect(report.outputArchives).toEqual([
      {
        caseId: "data-typed-xlsx-profile",
        outputRef: ".tmp/synthetic-output.md",
        sha256: hash(rawReply),
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(rawReply);
    call.mockClear();
    const retained = await collectObservations({
      candidates,
      fixtures,
      capCents: 500,
      creditBillingOnly: true,
      transport: call,
      runId,
      saveOutput: async () => {
        throw new Error("secret-error-never-report");
      },
    });
    expect(call.mock.calls.some(([name]) => name.endsWith(":purgeCase"))).toBe(false);
    expect(JSON.stringify(retained)).not.toContain("secret-error");
  });
});
