import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { VERTICAL_CORPUS } from "@pikar/contracts/verticalEvalCorpus";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { utils, write } from "xlsx";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { collectObservations } from "../scripts/vertical-eval-collect.mjs";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const pin = {
  runId: "abcdef12-1234-4567-8123-123456789012" as const,
  caseId: VERTICAL_CORPUS.data[0].caseId,
  caseHash: VERTICAL_CORPUS.data[0].caseHash,
  requestHash: VERTICAL_CORPUS.data[0].requestHash,
  verticalId: "data" as const,
  candidateVersion: 1,
  bodyHash: hash("candidate body"),
};
afterEach(() => vi.unstubAllGlobals());
async function setup(verticalId = "data") {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: `vertical-${verticalId}`,
      version: 1,
      body: "candidate body",
      status: "candidate",
      createdAt: 1,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("NO_PROVIDER_CALLS");
    }),
  );
  return t;
}
function xlsxSource() {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([[-4], [7], [12]]), "Facts");
  return {
    ref: "fixture:data:owned-xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
    bytes: write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  };
}
describe("controlled vertical evaluation sources", () => {
  test.each([
    [2, "caseHash"],
    [2, "requestHash"],
    [39, "caseHash"],
    [39, "requestHash"],
  ] as const)("native preflight rejects case index %i changed %s before any provisioning or spend", async (badIndex, field) => {
    const t = await setup();
    const ids = Object.keys(VERTICAL_CORPUS);
    for (const id of ids.filter((id) => id !== "data"))
      await t.run((ctx) =>
        ctx.db.insert("skills", {
          name: `vertical-${id}`,
          version: 1,
          body: "candidate body",
          status: "candidate",
          createdAt: 1,
        }),
      );
    const fixtures = Object.fromEntries(
      ids.map((id) => [
        id,
        JSON.parse(
          readFileSync(
            new URL(`../scripts/vertical-eval-cases/${id}.json`, import.meta.url),
            "utf8",
          ),
        ),
      ]),
    );
    // Every real pin is accepted by the native query without provisioning a tenant.
    for (const [verticalId, cases] of Object.entries(VERTICAL_CORPUS))
      for (const item of cases)
        await t.query(internal.verticalEvalSources.preflight, {
          ...pin,
          verticalId: verticalId as typeof pin.verticalId,
          caseId: item.caseId,
          caseHash: item.caseHash,
          requestHash: item.requestHash,
        });
    const calls: string[] = [];
    const report = await collectObservations({
      candidates: ids.map((id) => ({
        name: `vertical-${id}`,
        candidateVersion: 1,
        bodyHash: pin.bodyHash,
      })),
      fixtures,
      capCents: 100,
      creditBillingOnly: true,
      runId: pin.runId,
      transport: async (name: string, args: typeof pin) => {
        calls.push(name);
        expect(name).toBe("verticalEvalSources:preflight");
        const submitted =
          calls.length === badIndex + 1 ? { ...args, [field]: hash("changed") } : args;
        return t.query(internal.verticalEvalSources.preflight, submitted);
      },
    });
    expect(report.status).toBe("observations-incomplete");
    expect(calls).toHaveLength(badIndex + 1);
    expect(report.manifest).toHaveLength(40);
    for (const table of [
      "vaultDocuments",
      "tenantProfiles",
      "plans",
      "spendEvents",
      "audit",
    ] as const)
      expect(await t.run((ctx) => ctx.db.query(table).collect())).toHaveLength(0);
  });
  test("real dataset bytes reach the owned deterministic profile, exact pins verify and unpaid cleanup retains audit", async () => {
    const t = await setup();
    const prepared = await t.action(internal.verticalEvalSources.provision, {
      ...pin,
      sources: [xlsxSource()],
      reviewReady: true,
    });
    const verified = await t.query(internal.verticalEvalSources.verifyCase, pin);
    expect(verified).toMatchObject(prepared);
    const profile = await t.action(internal.verticalData.profileOwnedDataset, {
      tenantId: prepared.tenantId,
      sourceDocId: prepared.sourceRefs[0]!.docId,
    });
    expect(profile.sheets[0]?.columns[0]?.numericRange).toEqual({ min: -4, max: 12 });
    expect(profile.sheets[0]?.rowCount).toBe(3);
    expect(profile.source.fileId).toBe(prepared.sourceRefs[0]!.docId);
    expect(fetch).not.toHaveBeenCalled();
    const doc = await t.run((ctx) => ctx.db.get(prepared.sourceRefs[0]!.docId));
    expect(await t.mutation(internal.verticalEvalSources.cleanup, pin)).toEqual({
      removedSourceCount: 1,
      auditRetained: true,
    });
    expect(await t.run((ctx) => ctx.storage.get(doc!.storageId!))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(prepared.planId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "vertical_eval.provisioned" }),
        expect.objectContaining({ eventType: "vertical_evidence.cleanup" }),
      ]),
    );
    await expect(
      t.action(internal.verticalEvalSources.provision, { ...pin, sources: [], reviewReady: true }),
    ).rejects.toThrow("NOT_FRESH");
  });
  test("text refs carry actual stored content hashes and mutation after provision is rejected", async () => {
    const t = await setup("product");
    const productPin = {
      ...pin,
      verticalId: "product" as const,
      caseId: VERTICAL_CORPUS.product[0].caseId,
      caseHash: VERTICAL_CORPUS.product[0].caseHash,
      requestHash: VERTICAL_CORPUS.product[0].requestHash,
    };
    const text = "Synthetic research: three observed sessions failed the export task.";
    const prepared = await t.action(internal.verticalEvalSources.provision, {
      ...productPin,
      sources: [
        {
          ref: "fixture:product:research",
          mimeType: "text/plain",
          bytes: new TextEncoder().encode(text).buffer,
        },
      ],
      reviewReady: true,
    });
    const doc = await t.run((ctx) => ctx.db.get(prepared.sourceRefs[0]!.docId));
    expect(doc).toMatchObject({
      tenantId: prepared.tenantId,
      title: "fixture:product:research",
      text,
      contentHash: hash(text),
      status: "ready",
    });
    expect(doc?.ragEntryId).toBeUndefined();
    const audit = await t.run((ctx) => ctx.db.query("audit").first());
    expect(JSON.stringify(audit?.payload)).not.toContain(text);
    await t.run((ctx) => ctx.db.patch(doc!._id, { text: "Changed evidence" }));
    await expect(t.query(internal.verticalEvalSources.verifyCase, productPin)).rejects.toThrow(
      "SOURCE_CHANGED",
    );
    await expect(
      t.query(internal.verticalEvalSources.verifyCase, {
        ...productPin,
        caseHash: hash("different fixture"),
      }),
    ).rejects.toThrow("PROVISION_MISMATCH");
  });
  test("foreign pins, duplicate refs, oversized data and wrong source formats fail before writes", async () => {
    const t = await setup();
    const input = { ...pin, sources: [xlsxSource()], reviewReady: true };
    await expect(
      t.action(internal.verticalEvalSources.provision, { ...input, runId: "customer" }),
    ).rejects.toThrow("INVALID_PIN");
    await expect(
      t.action(internal.verticalEvalSources.provision, { ...input, bodyHash: hash("wrong") }),
    ).rejects.toThrow("CANDIDATE_MISMATCH");
    await expect(
      t.action(internal.verticalEvalSources.provision, {
        ...input,
        sources: [{ ...input.sources[0]!, mimeType: "image/png" }],
      }),
    ).rejects.toThrow("SOURCE_FORMAT");
    await expect(
      t.action(internal.verticalEvalSources.provision, {
        ...input,
        sources: [input.sources[0]!, input.sources[0]!],
      }),
    ).rejects.toThrow("SOURCE_LIMIT");
    await expect(
      t.action(internal.verticalEvalSources.provision, {
        ...input,
        sources: [{ ...input.sources[0]!, bytes: new ArrayBuffer(1024 * 1024 + 1) }],
      }),
    ).rejects.toThrow("SOURCE_LIMIT");
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("tenantProfiles").collect())).toHaveLength(0);
  });
  test("cleanup refuses an executed artifact and preserves its sources", async () => {
    const t = await setup();
    const prepared = await t.action(internal.verticalEvalSources.provision, {
      ...pin,
      sources: [xlsxSource()],
      reviewReady: true,
    });
    await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: prepared.tenantId,
        title: "Observed output",
        kind: "document",
        category: "created",
        source: "agent",
        mimeType: "text/markdown",
        size: 1,
        contentHash: "observed",
        text: "result",
        status: "ready",
        createdAt: 2,
      }),
    );
    await expect(t.mutation(internal.verticalEvalSources.cleanup, pin)).rejects.toThrow(
      "EXECUTED_CLEANUP",
    );
    expect(await t.run((ctx) => ctx.db.get(prepared.sourceRefs[0]!.docId))).not.toBeNull();
    const ledgerId = await t.run((ctx) =>
      ctx.db.insert("spendEvents", {
        tenantId: prepared.tenantId,
        rail: "reasoning",
        phase: "actual",
        amountCents: 1,
        correlationId: "observed-eval-call",
        createdAt: 1,
      }),
    );
    const purged = await t.action(internal.verticalEvalSources.purgeCase, pin);
    expect(purged.done).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(prepared.sourceRefs[0]!.docId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ledgerId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([
      expect.objectContaining({
        eventType: "vertical_evidence.cleanup",
        tenantId: "control:vertical-eval-evidence:v1",
      }),
    ]);
  });
});
