// The promotion audit row (CONT-01, plan 26-13). Refs-only, tenant-scoped, provenance read off the
// row rather than accepted from the caller.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// `audit.log` maintains the auditCounts aggregate, so the component must be registered or the REAL
// insert path throws `Component "auditCounts" is not registered`. Relative import — the package
// blocks the deep specifier. Same idiom as audit/cash/calendar tests.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

/** A backend whose audit insert path can actually run. */
function withAudit() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}
const TENANT = "tenant_a";
const OTHER = "tenant_b";

async function seedDoc(
  t: ReturnType<typeof convexTest>,
  over: {
    tenantId?: string;
    title?: string;
    sourceThreadId?: string;
    sourcePlanId?: Id<"plans">;
  } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: over.tenantId ?? TENANT,
      title: over.title ?? "SECRET-DOCUMENT-TITLE",
      kind: "created_document",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 10,
      contentHash: "hash",
      status: "ready",
      origin: "agent",
      text: "RAW-BODY-THAT-MUST-NEVER-BE-AUDITED",
      createdAt: 1,
      ...(over.sourceThreadId === undefined ? {} : { sourceThreadId: over.sourceThreadId }),
      ...(over.sourcePlanId === undefined ? {} : { sourcePlanId: over.sourcePlanId }),
    }),
  );
}

const auditRows = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.query("audit").collect());

describe("vault.promoted — the caller's audit row", () => {
  test("carries refs, ids and the result enum, and never the title or body", async () => {
    const t = withAudit();
    const planId = await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread-1",
        status: "done",
        recipients: [],
        subject: "s",
        body: "b",
        createdAt: 1,
      }),
    );
    const docId = await seedDoc(t, { sourceThreadId: "thread-1", sourcePlanId: planId });

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.contentAudit.recordPromotion, { vaultDocId: docId, result: "processing" });
    expect(res).toEqual({ logged: true });

    const rows = await auditRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT,
      eventType: "vault.promoted",
      actor: "user",
      // The same correlation id `promoteToReference` gives its ingest workflow, so the two join.
      correlationId: `vault:promote:${docId}`,
      payload: {
        vaultDocId: String(docId),
        sourceThreadId: "thread-1",
        sourcePlanId: String(planId),
        result: "processing",
      },
    });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("SECRET-DOCUMENT-TITLE");
    expect(serialized).not.toContain("RAW-BODY-THAT-MUST-NEVER-BE-AUDITED");
  });

  test("legacy rows audit an explicit null provenance rather than omitting it", async () => {
    const t = withAudit();
    const docId = await seedDoc(t);
    await t.withIdentity({ subject: TENANT }).mutation(api.contentAudit.recordPromotion, {
      vaultDocId: docId,
      result: "already_promoted",
    });
    const rows = await auditRows(t);
    expect(rows[0]?.payload).toMatchObject({ sourceThreadId: null, sourcePlanId: null });
  });

  test("another tenant's id writes nothing and is indistinguishable from a missing row", async () => {
    const t = withAudit();
    const foreign = await seedDoc(t, { tenantId: OTHER, sourceThreadId: "FOREIGN-THREAD" });

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.contentAudit.recordPromotion, { vaultDocId: foreign, result: "processing" });
    expect(res).toEqual({ logged: false });
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("fails closed without an identity", async () => {
    const t = withAudit();
    const docId = await seedDoc(t);
    await expect(
      t.mutation(api.contentAudit.recordPromotion, { vaultDocId: docId, result: "processing" }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    expect(await auditRows(t)).toHaveLength(0);
  });
});
