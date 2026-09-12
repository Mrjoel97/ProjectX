// @vitest-environment node
// Read-only recovery projections use isolated audit fixtures, not execution evidence.
import {
  VERTICAL_CORPUS,
  VERTICAL_CORPUS_SHA256,
  VERTICAL_EVALUATOR_SHA256,
} from "@pikar/contracts/verticalEvalCorpus";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { VERTICAL_EVAL_AUDIT_NAMESPACE } from "./audit";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const runId = "11111111-1111-4111-8111-111111111111";

describe("authenticated lost-response recovery", () => {
  test("recovers exact starts without claiming completion and preserves discarded history", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const owner = t.withIdentity({ subject: ownerId });
    const item = VERTICAL_CORPUS.engineering[0];
    const correlationId = `verticaleval:${runId}:${item.caseId}`;
    const startId = await t.run((ctx) =>
      ctx.db.insert("audit", {
        tenantId: VERTICAL_EVAL_AUDIT_NAMESPACE,
        correlationId,
        eventType: "vertical_evidence.started",
        actor: "system",
        ts: 1,
        payload: {
          corpusHash: VERTICAL_CORPUS_SHA256,
          evaluatorHash: VERTICAL_EVALUATOR_SHA256,
          caseHash: item.caseHash,
          requestHash: item.requestHash,
          secretCanary: "content-must-not-escape",
        },
      }),
    );
    const recovered = await owner.query(api.verticalEvalEvidence.inspectRun, { runId });
    expect(recovered.cases).toHaveLength(40);
    expect(recovered.cases.find((c) => c.caseId === item.caseId)).toMatchObject({
      startId,
      receiptId: null,
      stage: "started-outcome-unknown",
      currentPins: true,
      reviewAccepted: null,
    });
    expect(recovered.cases.filter((c) => c.stage === "not-started")).toHaveLength(39);
    expect(JSON.stringify(recovered)).not.toContain("content-must-not-escape");
    await t.run((ctx) =>
      ctx.db.insert("audit", {
        tenantId: VERTICAL_EVAL_AUDIT_NAMESPACE,
        correlationId,
        eventType: "vertical_evidence.cleanup",
        actor: "system",
        ts: 2,
        payload: {},
      }),
    );
    expect(
      (await owner.query(api.verticalEvalEvidence.inspectRun, { runId })).cases.find(
        (c) => c.caseId === item.caseId,
      ),
    ).toMatchObject({ startId, stage: "cleanup-authorized" });
  });
  test("does not mistake ordinary audit rows or stale pins for native current evidence", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const item = VERTICAL_CORPUS.engineering[0];
    await t.run(async (ctx) => {
      for (const tenantId of ["ordinary-tenant", VERTICAL_EVAL_AUDIT_NAMESPACE])
        await ctx.db.insert("audit", {
          tenantId,
          correlationId: `verticaleval:${runId}:${item.caseId}`,
          eventType:
            tenantId === "ordinary-tenant"
              ? "vertical_evidence.issued"
              : "vertical_evidence.started",
          actor: "system",
          ts: 1,
          payload: { evaluatorHash: "stale" },
        });
    });
    const owner = t.withIdentity({ subject: ownerId });
    expect(
      (await owner.query(api.verticalEvalEvidence.inspectRun, { runId })).cases.find(
        (c) => c.caseId === item.caseId,
      ),
    ).toMatchObject({ stage: "started-outcome-unknown", currentPins: false });
    await expect(
      owner.query(api.verticalEvalEvidence.inspectRun, { runId: "arbitrary-correlation" }),
    ).rejects.toThrow("RUN_ID");
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await expect(
      t.withIdentity({ subject: userId }).query(api.verticalEvalEvidence.inspectRun, { runId }),
    ).rejects.toThrow("OWNER_REQUIRED");
  });
});
