// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const TENANT = "tenant_a";

async function insertBoundRows(
  t: ReturnType<typeof convexTest>,
  over: { tenantId?: string; dependencyStatus?: "materializing" | "canceled" } = {},
) {
  const tenantId = over.tenantId ?? TENANT;
  return t.run(async (ctx) => {
    const planId = await ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_1",
      status: "collecting",
      kind: "memo",
      recipients: [],
      researchDeliverable: {
        requestId: "request_1",
        format: "pdf",
        status: over.dependencyStatus ?? "materializing",
        sourceContentHash: "hash_1",
      },
      createdAt: Date.now(),
    });
    const docId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Exact findings",
      kind: "web_research",
      category: "workspace-docs",
      source: "web_research",
      mimeType: "text/markdown",
      size: 10,
      contentHash: "hash_1",
      text: "# Exact findings",
      status: "processing",
      sourcePlanId: planId,
      createdAt: Date.now(),
    });
    const plan = await ctx.db.get(planId);
    if (!plan?.researchDeliverable) throw new Error("research dependency missing");
    await ctx.db.patch(planId, {
      researchDeliverable: { ...plan.researchDeliverable, sourceVaultDocId: docId },
    });
    return { planId, docId };
  });
}

describe("research PDF dependency", () => {
  test("omitted and memo stay memo-only while pdf freezes the authenticated request id", async () => {
    const t = convexTest(schema, modules);
    const omitted = await t.mutation(internal.plans.stageResearchPlan, {
      tenantId: TENANT,
      threadId: "omitted",
      subject: "Research",
    });
    const memo = await t.mutation(internal.plans.stageResearchPlan, {
      tenantId: TENANT,
      threadId: "memo",
      subject: "Research",
      deliverable: "memo",
    });
    const pdf = await t.mutation(internal.plans.stageResearchPlan, {
      tenantId: TENANT,
      threadId: "pdf",
      subject: "Research",
      deliverable: "pdf",
      rootRequestId: "trusted_request",
    });
    if (!omitted.ok || !memo.ok || !pdf.ok) throw new Error("unexpected staging refusal");
    const rows = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(omitted.planId), ctx.db.get(memo.planId), ctx.db.get(pdf.planId)]),
    );
    expect(rows[0]?.researchDeliverable).toBeUndefined();
    expect(rows[1]?.researchDeliverable).toBeUndefined();
    expect(rows[2]?.researchDeliverable).toEqual({
      requestId: "trusted_request",
      format: "pdf",
      status: "pending",
    });
  });

  test("reset cancellation is terminal even while the plan returns to collecting", async () => {
    const t = convexTest(schema, modules);
    const { planId } = await insertBoundRows(t);
    await t.mutation(internal.plans.resetPlan, { planId });
    const changed = await t.mutation(internal.researchDeliverable.refuse, {
      tenantId: TENANT,
      planId,
      requestId: "request_1",
      reason: "research_failed",
    });
    const plan = await t.run(async (ctx) => ctx.db.get(planId));
    expect(changed).toBe(false);
    expect(plan?.status).toBe("collecting");
    expect(plan?.researchDeliverable).toMatchObject({
      status: "canceled",
      reason: "plan_canceled",
    });
  });

  test("same-row attach is exact and replay-idempotent", async () => {
    const t = convexTest(schema, modules);
    const { planId, docId } = await insertBoundRows(t);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["pdf"], { type: "application/pdf" })),
    );
    const args = {
      tenantId: TENANT,
      planId,
      requestId: "request_1",
      sourceVaultDocId: docId,
      sourceContentHash: "hash_1",
      storageId,
    };
    expect(await t.mutation(internal.vault.attachResearchPdf, args)).toEqual({
      ok: true,
      reused: false,
      storageId,
    });
    expect(await t.mutation(internal.vault.attachResearchPdf, args)).toEqual({
      ok: true,
      reused: true,
      storageId,
    });
    const [plan, doc] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(planId), ctx.db.get(docId)]),
    );
    expect(plan?.researchDeliverable?.status).toBe("ready");
    expect(doc).toMatchObject({
      storageId,
      storedMimeType: "application/pdf",
      mimeType: "text/markdown",
      contentHash: "hash_1",
      text: "# Exact findings",
    });
  });

  test("a foreign or mismatched source returns no storage capability", async () => {
    const t = convexTest(schema, modules);
    const { planId, docId } = await insertBoundRows(t);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["pdf"], { type: "application/pdf" })),
    );
    const result = await t.mutation(internal.vault.attachResearchPdf, {
      tenantId: "tenant_b",
      planId,
      requestId: "request_1",
      sourceVaultDocId: docId,
      sourceContentHash: "hash_1",
      storageId,
    });
    expect(result).toEqual({ ok: false, reason: "source_mismatch" });
    expect("storageId" in result).toBe(false);
  });

  test("wrong-document and refused replays cannot alter a closed dependency", async () => {
    const t = convexTest(schema, modules);
    const { planId, docId } = await insertBoundRows(t);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["pdf"], { type: "application/pdf" })),
    );
    await t.mutation(internal.vault.attachResearchPdf, {
      tenantId: TENANT,
      planId,
      requestId: "request_1",
      sourceVaultDocId: docId,
      sourceContentHash: "hash_1",
      storageId,
    });
    const wrongDocId = await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Wrong findings",
        kind: "web_research",
        category: "workspace-docs",
        source: "web_research",
        mimeType: "text/markdown",
        size: 5,
        contentHash: "wrong_hash",
        text: "wrong",
        status: "processing",
        sourcePlanId: planId,
        createdAt: Date.now(),
      }),
    );
    expect(
      await t.mutation(internal.researchDeliverable.start, {
        tenantId: TENANT,
        planId,
        requestId: "request_1",
        sourceVaultDocId: wrongDocId,
      }),
    ).toEqual({ ok: false, reason: "source_mismatch" });
    expect((await t.run(async (ctx) => ctx.db.get(planId)))?.researchDeliverable?.status).toBe(
      "ready",
    );

    const second = await insertBoundRows(t);
    await t.mutation(internal.researchDeliverable.refuse, {
      tenantId: TENANT,
      planId: second.planId,
      requestId: "request_1",
      reason: "research_incomplete",
    });
    expect(
      await t.mutation(internal.researchDeliverable.refuse, {
        tenantId: TENANT,
        planId: second.planId,
        requestId: "request_1",
        reason: "research_failed",
      }),
    ).toBe(false);
    expect(
      (await t.run(async (ctx) => ctx.db.get(second.planId)))?.researchDeliverable,
    ).toMatchObject({ status: "refused", reason: "research_incomplete" });
  });

  test("the durable boundary refuses a deliverable on a non-research run", async () => {
    const t = convexTest(schema, modules);
    const planId = await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "collecting",
        createdAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(internal.dispatchRun.startDispatchRun, {
        kind: "specialist",
        tenantId: TENANT,
        threadId: "thread_1",
        planId,
        gapIndex: 0,
        route: "ops",
        rootRequestId: "request_1",
        parentAgentId: "executive",
        depth: 1,
        ancestry: [],
        envelopeCents: 1,
        spentCents: 0,
        researchDeliverable: "pdf",
      }),
    ).rejects.toThrow("RESEARCH_DELIVERABLE_REQUIRES_RESEARCH_KIND");
  });
});
