// Phase 34 — Goal Engine v0, "the agenda speaks" (G13, ADR-033). convex-test over seeded review
// rows: the weekly sync stages ONE proposal through the real actOnGap spine, the lifecycle survives
// the weekly rewrite, and the Command Center read is bounded, cited, goal-linked and tenant-scoped.
//
// The seeded gap routes to "document-analyst" — NOT a registered specialist — so `applyActOnGap`
// takes the deterministic memo terminal and no specialist is dispatched under test. The dispatch
// terminal is dispatch.test.ts's job; both terminals call `markAgendaProposed` at the same seam.
import { REVIEW_THREAD_ID } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_agenda_a";
const OTHER = "tenant_agenda_b";
const GAP = {
  label: "No owner is named for retention",
  leverageRank: 2,
  route: "document-analyst",
  playbook: "retention-owner",
  reason: "The report names the problem but never who acts on it",
  proofMetric: "A named owner and a review date",
};
const KEY = `${GAP.route}/${GAP.playbook}`;

function newTest() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** One weekly review row on the pinned thread, stamped at `at`. */
async function seedReview(
  t: ReturnType<typeof convexTest>,
  at: number,
  opts: {
    gaps?: (typeof GAP)[];
    asks?: { section: string; needs: string }[];
    tenant?: string;
  } = {},
) {
  const tenantId = opts.tenant ?? TENANT;
  const id = await t.mutation(internal.evaluations.insertEvaluation, {
    tenantId,
    threadId: REVIEW_THREAD_ID,
    framework: "growth-os",
    findings: [
      {
        label: "Churn concentrates in month two",
        section: "financials",
        citationTitle: "Quarterly report",
        confidence: "high",
        source: "vault",
      },
    ],
    gaps: opts.gaps ?? [GAP],
    notEnoughData: opts.asks ?? [],
    scorecard: {},
    userProvided: [],
    verdict: "gaps",
  });
  // insertEvaluation stamps Date.now(); pin the clock so "previous" and "came back" are exact.
  await t.run((ctx) => ctx.db.patch(id, { createdAt: at }));
  return id;
}

const sync = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.mutation(internal.agenda.syncFromReview, { tenantId });

const rowsOf = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.run((ctx) =>
    ctx.db
      .query("agenda")
      .filter((q) => q.eq(q.field("tenantId"), tenantId))
      .collect(),
  );

const planOf = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: TENANT }).query(api.plans.byThread, { threadId: REVIEW_THREAD_ID });

describe("the weekly sync stages ONE proposal through the actOnGap spine", () => {
  test("first review: the gap opens, is staged as a proposed memo, and the row records its plan", async () => {
    const t = newTest();
    await seedReview(t, 1_000);
    expect(await sync(t)).toEqual({ staged: true });
    const [row] = await rowsOf(t);
    expect(row?.key).toBe(KEY);
    expect(row?.status).toBe("proposed");
    const plan = await planOf(t);
    expect(plan?.kind).toBe("memo");
    expect(plan?.status).toBe("proposed"); // parked at the gate — nothing executed
    expect(row?.planId).toBe(plan?._id);
    const requests = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(requests).toHaveLength(0);
  });

  test("a second week with the proposal still waiting stages nothing and keeps the same plan", async () => {
    const t = newTest();
    await seedReview(t, 1_000);
    await sync(t);
    const first = await planOf(t);
    await seedReview(t, 2_000);
    expect(await sync(t)).toEqual({ staged: false });
    expect((await planOf(t))?._id).toBe(first?._id);
    expect((await rowsOf(t))[0]?.status).toBe("proposed");
  });

  test("an approved proposal reads as acted at once; if the gap is still there next week it is recurring and re-proposed", async () => {
    const t = newTest();
    await seedReview(t, 1_000);
    await sync(t);
    const plan = await planOf(t);
    if (!plan) throw new Error("no plan");
    await t.run((ctx) => ctx.db.patch(plan._id, { status: "done" }));
    // Read-time derivation — Tuesday, before any sync.
    const view = await t.withIdentity({ subject: TENANT }).query(api.agenda.current, {});
    expect(view?.items[0]?.status).toBe("acted");
    await seedReview(t, 2_000);
    expect(await sync(t)).toEqual({ staged: true });
    const [row] = await rowsOf(t);
    expect(row?.status).toBe("proposed"); // recurring → staged again
    expect((await planOf(t))?.status).toBe("proposed"); // the one row, recycled
  });

  test("a dismissal holds while the gap persists, and lifts once it closed and came back", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedReview(t, 1_000, { gaps: [] });
    await sync(t); // nothing to open yet
    await seedReview(t, 2_000);
    // Open the row WITHOUT staging: sync would stage it, so insert the open row the way sync does
    // on a plan_busy week — then dismiss it.
    await t.run((ctx) =>
      ctx.db.insert("agenda", {
        tenantId: TENANT,
        key: KEY,
        label: GAP.label,
        route: GAP.route,
        playbook: GAP.playbook,
        leverageRank: GAP.leverageRank,
        status: "open",
        gapIndex: 0,
        firstSeenAt: 2_000,
        lastSeenAt: 2_000,
        statusChangedAt: 2_000,
      }),
    );
    expect(await asT.mutation(api.agenda.dismiss, { key: KEY })).toEqual({ ok: true });
    expect(await sync(t)).toEqual({ staged: false }); // dismissed is the user's word
    expect((await asT.query(api.agenda.current, {}))?.items).toHaveLength(0);
    // The gap closes for a week …
    await seedReview(t, 3_000, { gaps: [] });
    expect(await sync(t)).toEqual({ staged: false });
    expect((await rowsOf(t))[0]?.status).toBe("dismissed");
    // … and comes back: recurring, and proposed again.
    await seedReview(t, 4_000);
    expect(await sync(t)).toEqual({ staged: true });
    expect((await rowsOf(t))[0]?.status).toBe("proposed");
  });

  test("dismiss refuses a proposal that is waiting at the gate", async () => {
    const t = newTest();
    await seedReview(t, 1_000);
    await sync(t);
    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.agenda.dismiss, { key: KEY });
    expect(res).toEqual({ ok: false });
    expect((await rowsOf(t))[0]?.status).toBe("proposed");
  });

  test("the review card's own Act on this marks the same row proposed (one seam, two doors)", async () => {
    const t = newTest();
    await seedReview(t, 1_000);
    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.evaluations.actOnGap, { threadId: REVIEW_THREAD_ID, gapIndex: 0 });
    expect(res.ok).toBe(true);
    const [row] = await rowsOf(t);
    expect(row?.status).toBe("proposed"); // upserted — no Monday sync had created it
    expect(row?.lastSeenAt).toBe(1_000);
  });
});

describe("the Command Center read is bounded, cited, goal-linked and tenant-scoped", () => {
  test("no review yet → null; a review with nothing on it → empty lists, not an error", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    expect(await asT.query(api.agenda.current, {})).toBeNull();
    await seedReview(t, 1_000, { gaps: [] });
    await sync(t);
    expect(await asT.query(api.agenda.current, {})).toEqual({
      reviewedAt: 1_000,
      items: [],
      asks: [],
    });
  });

  test("an item carries the review's citations, the gap's own reason, and the goal it blocks", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    const gap = { ...GAP, route: "money-model-designer", playbook: "cash-in-30" };
    await seedReview(t, 1_000, { gaps: [gap] });
    await t.run(async (ctx) => {
      await ctx.db.insert("goals", {
        tenantId: TENANT,
        segmentId: "money-model",
        text: "Break even on each new client within 30 days",
        status: "active",
        createdAt: 1,
        statusChangedAt: 1,
      });
      await ctx.db.insert("goals", {
        tenantId: OTHER,
        segmentId: "money-model",
        text: "Someone else's goal",
        status: "active",
        createdAt: 1,
        statusChangedAt: 1,
      });
      // Open, un-staged (a registered route would dispatch under sync — insert the row directly).
      await ctx.db.insert("agenda", {
        tenantId: TENANT,
        key: `${gap.route}/${gap.playbook}`,
        label: gap.label,
        route: gap.route,
        playbook: gap.playbook,
        leverageRank: gap.leverageRank,
        status: "open",
        gapIndex: 0,
        firstSeenAt: 1_000,
        lastSeenAt: 1_000,
        statusChangedAt: 1_000,
      });
    });
    const view = await asT.query(api.agenda.current, {});
    expect(view?.items).toHaveLength(1);
    const item = view?.items[0];
    expect(item?.status).toBe("open");
    expect(item?.reason).toBe(GAP.reason);
    expect(item?.citations).toEqual(["Quarterly report"]);
    expect(item?.goal).toBe("Break even on each new client within 30 days");
    // The other tenant sees nothing of it.
    expect(await t.withIdentity({ subject: OTHER }).query(api.agenda.current, {})).toBeNull();
  });

  test("asks fill the remaining slots, never more than three rows in total", async () => {
    const t = newTest();
    const asks = ["cac", "ltgp", "cash30", "churn"].map((f) => ({
      section: "financials",
      needs: `What is your ${f}?`,
    }));
    await seedReview(t, 1_000, { asks });
    await sync(t); // one gap → proposed
    const view = await t.withIdentity({ subject: TENANT }).query(api.agenda.current, {});
    expect(view?.items).toHaveLength(1);
    expect(view?.asks).toHaveLength(2);
    expect(view?.asks[0]?.needs).toBe("What is your cac?");
  });

  test("a row from an OLDER review is not current, even if it was never resolved", async () => {
    const t = newTest();
    await seedReview(t, 1_000);
    await sync(t);
    await seedReview(t, 2_000, { gaps: [] }); // the gap closed
    await sync(t);
    const view = await t.withIdentity({ subject: TENANT }).query(api.agenda.current, {});
    expect(view?.items).toHaveLength(0);
    expect((await rowsOf(t))[0]?.status).toBe("proposed"); // history kept, not shown
  });
});
