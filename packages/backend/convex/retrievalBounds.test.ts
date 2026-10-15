import type { PaginationResult } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { activeMediaJobs, currentMediaJobs } from "./lib/mediaRead";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("requests paginate complete history by time across statuses and isolate tenants", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ subject: "tenantA" });
  await t.run(async (ctx) => {
    for (let i = 0; i < 235; i++)
      await ctx.db.insert("requests", {
        tenantId: "tenantA",
        correlationId: String(i),
        goal: String(i),
        recipient: "owner@example.test",
        status: i % 2 ? "sent" : "submitted",
        attachmentRefs: [],
        createdAt: i,
      });
    await ctx.db.insert("requests", {
      tenantId: "tenantB",
      correlationId: "foreign",
      goal: "foreign",
      recipient: "other@example.test",
      status: "sent",
      attachmentRefs: [],
      createdAt: 1000,
    });
  });
  const seen: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const p: PaginationResult<Doc<"requests">> = await a.query(api.requests.listPage, {
      paginationOpts: { cursor, numItems: 1000 },
    });
    expect(p.page.length).toBeLessThanOrEqual(100);
    seen.push(...p.page.map((r) => r.goal));
    if (p.isDone) break;
    cursor = p.continueCursor;
  }
  expect(seen).toEqual(Array.from({ length: 235 }, (_, i) => String(234 - i)));
  expect(await a.query(api.requests.list, {})).toHaveLength(100);
});

test("media current slots and paid period pages survive long immutable attempt histories", async () => {
  const t = convexTest(schema, modules);
  const planId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("plans", {
      tenantId: "tenantA",
      threadId: "t",
      status: "proposed",
      createdAt: 0,
    });
    for (let i = 0; i < 520; i++)
      await ctx.db.insert("mediaJobs", {
        tenantId: "tenantA",
        planId: id,
        batchId: String(i),
        blockIndex: 0,
        provider: "openai",
        kind: "image",
        model: "test",
        spec: { kind: "image", width: 10, height: 10 },
        promptHash: String(i),
        status: i === 519 ? "queued" : "succeeded",
        estUsd: 0.0004,
        actualCents: 1,
        createdAt: i,
        updatedAt: i,
      });
    return id;
  });
  await t.run(async (ctx) => {
    const plan = await ctx.db.get(planId);
    if (!plan) throw Error("missing");
    expect((await currentMediaJobs(ctx, "tenantA", plan)).map((r) => r.promptHash)).toEqual([
      "519",
    ]);
    expect((await currentMediaJobs(ctx, "tenantA", plan, true)).map((r) => r.promptHash)).toEqual([
      "518",
    ]);
    expect(await activeMediaJobs(ctx, "tenantA", planId)).toHaveLength(1);
  });
  const first = await t.query(internal.media.spendForPeriod, {
    tenantId: "tenantA",
    sinceMs: 0,
    untilMs: 1000,
  });
  expect(first.rowCount).toBe(500);
  expect(first.isDone).toBe(false);
  const last = await t.query(internal.media.spendForPeriod, {
    tenantId: "tenantA",
    sinceMs: 0,
    untilMs: 1000,
    cursor: first.continueCursor,
  });
  expect(last.isDone).toBe(true);
  expect(last.rowCount).toBe(20);
  expect(first.actualCents + last.actualCents).toBe(520);
  expect(Math.round((first.estUsd + last.estUsd) * 100)).toBe(21);
});

test("document graph preview discloses truncation and deletion completes in bounded pages", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const a = t.withIdentity({ subject: "tenantA" });
    const docId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("vaultDocuments", {
        tenantId: "tenantA",
        title: "doc",
        kind: "upload",
        category: "my-uploads",
        source: "upload",
        mimeType: "text/plain",
        size: 1,
        contentHash: "h",
        status: "ready",
        createdAt: 0,
      });
      const left = await ctx.db.insert("graphNodes", {
        tenantId: "tenantA",
        type: "topic",
        name: "left",
        normalizedName: "left",
        degree: 300,
      });
      const right = await ctx.db.insert("graphNodes", {
        tenantId: "tenantA",
        type: "topic",
        name: "right",
        normalizedName: "right",
        degree: 300,
      });
      for (let i = 0; i < 300; i++)
        await ctx.db.insert("graphEdges", {
          tenantId: "tenantA",
          fromNodeId: left,
          toNodeId: right,
          rel: String(i),
          sourceDocId: id,
        });
      return id;
    });
    const preview = await a.query(api.vault.docEntities, { vaultDocId: docId });
    expect(preview.edges).toHaveLength(256);
    expect(preview.truncated).toBe(true);
    await a.mutation(api.vault.deleteVaultDoc, { vaultDocId: docId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(docId)).toBeNull();
      expect(await ctx.db.query("graphEdges").collect()).toEqual([]);
      expect(await ctx.db.query("graphNodes").collect()).toEqual([]);
    });
  } finally {
    vi.useRealTimers();
  }
});
test("legacy101-recipient report remains fully accessible through pages and foreign plan refuses", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ subject: "tenantA" });
  const planId = await t.run(async (ctx) => {
    const plan = await ctx.db.insert("plans", {
      tenantId: "tenantA",
      threadId: "legacy",
      status: "done",
      createdAt: 0,
    });
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("requests", {
        tenantId: "tenantA",
        planId: plan,
        correlationId: "legacy" + i,
        goal: "legacy",
        recipient: "recipient" + i + "@example.test",
        status: "failed",
        attachmentRefs: [],
        createdAt: i,
      });
    return plan;
  });
  const seen: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { page: { recipient: string }[]; isDone: boolean; continueCursor: string } =
      await a.query(api.plans.reportPage, { planId, paginationOpts: { cursor, numItems: 200 } });
    expect(page.page.length).toBeLessThanOrEqual(50);
    seen.push(...page.page.map((r) => r.recipient));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(seen).toHaveLength(101);
  expect(new Set(seen).size).toBe(101);
  expect(
    (
      await t
        .withIdentity({ subject: "tenantB" })
        .query(api.plans.reportPage, { planId, paginationOpts: { cursor: null, numItems: 50 } })
    ).page,
  ).toEqual([]);
  await expect(a.query(api.plans.reportForPlan, { planId })).rejects.toThrow();
});
