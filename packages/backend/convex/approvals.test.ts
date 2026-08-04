import { emptyScorecard } from "@pikar/core/growth/index";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const TENANT = "tenant_a";
const OTHER = "tenant_b";

type PlanStatus =
  | "collecting"
  | "proposed"
  | "approved"
  | "scheduled"
  | "delivering"
  | "done"
  | "canceled";

async function seedPlan(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  status: PlanStatus,
  createdAt: number,
  extra: Record<string, unknown> = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: `${tenantId}-${status}-${crypto.randomUUID()}`,
      status,
      recipients: ["private@example.com"],
      subject: "Private subject",
      body: "Private body",
      createdAt,
      ...extra,
    }),
  );
}

const firstPage = { numItems: 1, cursor: null };

describe("Approvals summary and plan lanes", () => {
  test("fails closed without identity and never projects foreign or raw plan content", async () => {
    const t = convexTest(schema, modules);
    await seedPlan(t, TENANT, "proposed", 100);
    await seedPlan(t, OTHER, "proposed", 200);

    await expect(t.query(api.approvals.summary, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      t.query(api.approvals.listAwaiting, { paginationOpts: firstPage }),
    ).rejects.toThrow(/UNAUTHENTICATED/);

    const page = await t
      .withIdentity({ subject: TENANT })
      .query(api.approvals.listAwaiting, { paginationOpts: { numItems: 10, cursor: null } });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.threadId).toContain(TENANT);
    expect(JSON.stringify(page)).not.toContain(OTHER);
    expect(JSON.stringify(page)).not.toContain("Private subject");
    expect(JSON.stringify(page)).not.toContain("Private body");
    expect(JSON.stringify(page)).not.toContain("private@example.com");
    expect(page.items[0]).not.toHaveProperty("tenantId");
    expect(page.items[0]).not.toHaveProperty("recipients");
  });

  test("one bounded summary powers the badge and reports an honest capped count", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 101; i++) await seedPlan(t, TENANT, "proposed", 1_000 + i);
    await seedPlan(t, OTHER, "proposed", 1);

    const summary = await t.withIdentity({ subject: TENANT }).query(api.approvals.summary, {});
    expect(summary).toEqual({
      awaitingCount: 100,
      awaitingCountCapped: true,
      oldestWaitingAt: 1_000,
    });
  });

  test("native cursors do not skip timestamp ties and keep tenant/status scoping", async () => {
    const t = convexTest(schema, modules);
    const ids = await Promise.all([
      seedPlan(t, TENANT, "proposed", 5_000),
      seedPlan(t, TENANT, "proposed", 5_000),
      seedPlan(t, TENANT, "proposed", 5_000),
    ]);
    await seedPlan(t, TENANT, "scheduled", 5_000);
    await seedPlan(t, OTHER, "proposed", 5_000);

    const asTenant = t.withIdentity({ subject: TENANT });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await asTenant.query(api.approvals.listAwaiting, {
        paginationOpts: { numItems: 1, cursor },
      });
      seen.push(...page.items.map((row) => row.planId));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toHaveLength(3);
  });

  test("scheduled, in-flight and cleared lanes expose exact or legacy-partial facts, never zero cost", async () => {
    const t = convexTest(schema, modules);
    await seedPlan(t, TENANT, "scheduled", 100, { sendAt: 10_000 });
    await seedPlan(t, TENANT, "delivering", 200, {
      recipientTotal: 4,
      sentCount: 2,
      failedCount: 1,
      queuedCount: 1,
      counterComplete: true,
    });
    await seedPlan(t, TENANT, "delivering", 300);
    await seedPlan(t, TENANT, "done", 400, {
      recipientTotal: 1,
      sentCount: 1,
      failedCount: 0,
      queuedCount: 0,
      counterComplete: true,
    });
    await seedPlan(t, TENANT, "canceled", 500);

    const asTenant = t.withIdentity({ subject: TENANT });
    const scheduled = await asTenant.query(api.approvals.listScheduled, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(scheduled.items[0]).toMatchObject({ scheduledAt: 10_000, recipientCount: 1 });

    const inFlight = await asTenant.query(api.approvals.listInFlight, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(inFlight.items.map((row) => row.progress.state).sort()).toEqual(["exact", "partial"]);
    expect(inFlight.items.find((row) => row.progress.state === "exact")?.progress).toEqual({
      state: "exact",
      total: 4,
      sent: 2,
      failed: 1,
      queued: 1,
    });

    const cleared = await asTenant.query(api.approvals.listCleared, {
      sinceMs: 0,
      limit: 10,
    });
    expect(cleared.items).toHaveLength(2);
    expect(cleared.items.every((row) => row.cost.state === "unknown")).toBe(true);
    expect(cleared.items.find((row) => row.status === "canceled")?.cancellation).toEqual({
      state: "legacy-unknown",
    });
  });
});

describe("Approvals decisions and blocked summary", () => {
  test("projects only code-owned scorecard questions and validates field-specific answer types", async () => {
    const t = convexTest(schema, modules);
    const scorecard = structuredClone(emptyScorecard);
    scorecard.financials.cac = 125;
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: TENANT,
        threadId: "thread-a",
        framework: "growth-os",
        findings: [],
        gaps: [],
        notEnoughData: [{ section: "financials", needs: "attacker-controlled prompt" }],
        scorecard,
        userProvided: [],
        verdict: "insufficient",
        createdAt: 1_000,
      });
      await ctx.db.insert("evaluations", {
        tenantId: OTHER,
        threadId: "thread-b",
        framework: "growth-os",
        findings: [],
        gaps: [],
        notEnoughData: [{ section: "financials", needs: "secret other tenant prompt" }],
        scorecard: emptyScorecard,
        userProvided: [],
        verdict: "insufficient",
        createdAt: 2_000,
      });
    });

    const asTenant = t.withIdentity({ subject: TENANT });
    const decisions = await asTenant.query(api.approvals.listDecisions, { limit: 10 });
    expect(decisions.items.map((item) => item.field)).toEqual([
      "financials.ltgp",
      "financials.thirtyDayCashPerCustomer",
      "modelCard.thirtyDayPayback",
    ]);
    expect(JSON.stringify(decisions)).not.toContain("attacker-controlled prompt");
    expect(JSON.stringify(decisions)).not.toContain("secret other tenant prompt");
    expect(decisions.items.map((item) => item.valueType)).toEqual(["number", "number", "boolean"]);

    await asTenant.mutation(api.approvals.answerDecision, {
      threadId: "thread-a",
      answer: { field: "financials.ltgp", value: 900 },
    });
    await expect(
      asTenant.mutation(api.approvals.answerDecision, {
        threadId: "thread-a",
        answer: { field: "financials.ltgp", value: false } as never,
      }),
    ).rejects.toThrow();
    await expect(
      asTenant.mutation(api.approvals.answerDecision, {
        threadId: "thread-a",
        answer: { field: "scorecard.__proto__.polluted", value: 1 } as never,
      }),
    ).rejects.toThrow();
    await expect(
      asTenant.mutation(api.approvals.answerDecision, {
        threadId: "thread-b",
        answer: { field: "financials.ltgp", value: 900 },
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("evaluations")
        .withIndex("by_tenant_thread", (q) => q.eq("tenantId", TENANT).eq("threadId", "thread-a"))
        .order("desc")
        .first(),
    );
    expect((stored?.scorecard as typeof emptyScorecard).financials.ltgp).toBe(900);
  });

  test("blocked summary is capped, tenant-isolated, links to Ops and reveals no DLQ content", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 21; i++) {
        await ctx.db.insert("deadLetters", {
          tenantId: TENANT,
          correlationId: `cid-${i}`,
          workflowId: `wf-${i}`,
          payload: { email: "secret@example.com", body: "secret body" },
          error: "PII secret@example.com",
          status: "new",
          createdAt: 1_000 + i,
        });
      }
      await ctx.db.insert("deadLetters", {
        tenantId: OTHER,
        correlationId: "foreign-cid",
        workflowId: "foreign-wf",
        payload: { body: "foreign secret" },
        error: "foreign error",
        status: "new",
        createdAt: 3_000,
      });
    });

    const blocked = await t.withIdentity({ subject: TENANT }).query(api.approvals.blockedSummary, {});
    expect(blocked).toEqual({
      count: 20,
      countCapped: true,
      oldestCreatedAt: 1_000,
      newestCreatedAt: 1_020,
      href: "/ops",
    });
    expect(JSON.stringify(blocked)).not.toMatch(/secret|payload|error|correlation|workflow|foreign/i);
  });
});
