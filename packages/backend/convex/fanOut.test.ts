// @vitest-environment edge-runtime
//
// THE GOVERNED FAN-OUT (42-03, G6) — ADR-037 (a root is an artifact, a child is a worker) and
// ADR-038 (a fan-out narrows to what the rail can fund).
//
// Two of the tests below exist because two independent adversarial reviewers found the defects
// they pin, before a line of the implementation was written. Both are named at their test.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_FAN_OUT, narrowFanOut } from "./lib/dispatchShared";
import { ROOT_SCAN } from "./lib/planRow";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/*.ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/*.ts",
);

const TENANT = "tenant_fanout";
const THREAD = "thread_fanout";

type T = ReturnType<typeof convexTest>;

function newTest(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** A staged ROOT — exactly what `stageResearchPlan` leaves for the tool to fan out from. */
async function stagedRoot(t: T): Promise<Id<"plans">> {
  return t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId: TENANT,
      threadId: THREAD,
      status: "collecting",
      kind: "memo",
      recipients: [],
      subject: "Team: what should I fix first?",
      body: "",
      createdAt: Date.now(),
    }),
  );
}

const childrenOf = (t: T, parentPlanId: Id<"plans">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("plans").collect()).filter((p) => p.parentPlanId === parentPlanId),
  );

const UMBRELLA = "What should I fix first before launch?";

/** Routes only, every one carrying the SAME sub-question. That is deliberate: it is the shape
 *  ADR-037 could express, so every pre-ADR-040 assertion below keeps its exact meaning — and
 *  the repeated-route test still proves the identical-paid-turn guard, because same route AND
 *  same question is precisely what the pair dedupe collapses. */
const startTeam = (t: T, planId: Id<"plans">, routes: string[]) =>
  startTeamAssign(
    t,
    planId,
    routes.map((route) => ({ route, question: UMBRELLA })),
  );

/** ADR-040: the real shape. A child is a route AND its own sub-question. */
const startTeamAssign = (
  t: T,
  planId: Id<"plans">,
  assignments: { route: string; question: string }[],
) =>
  t.mutation(internal.dispatchRun.startTeamRun, {
    tenantId: TENANT,
    threadId: THREAD,
    planId,
    assignments,
    question: UMBRELLA,
    rootRequestId: "root-fanout-1",
  });

/** Cancel whatever the fan-out queued — the queued starters would otherwise reach a real gateway. */
async function cancelQueued(t: T): Promise<void> {
  const rows = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  for (const row of rows) await t.run((ctx) => ctx.scheduler.cancel(row._id));
}

// ── The arithmetic, alone. This is where ADR-037 was wrong. ───────────────────────────────────
describe("narrowFanOut — the money rule, as pure arithmetic (ADR-038)", () => {
  test("a share is NEVER zero while any worker runs — the interval ADR-037 missed", () => {
    // ADR-037 Decision 6 reasoned about the single point rootEnvelope === 0 and concluded a zero
    // share fails closed. It does not: `governedDispatch` reads `envelopeCents > 0 ? … : derive`,
    // so a child handed 0 takes the DERIVE branch and is granted the FULL rail share. And
    // floor(root/n) is 0 across the whole interval root < n, not just at root === 0. Five workers
    // on a 4-cent envelope would each have received 4 cents — five times the budget being divided.
    // MUTATION that turns this red: drop `rootEnvelopeCents` from the Math.min.
    for (let rootEnvelope = 0; rootEnvelope <= 40; rootEnvelope++) {
      // Widened past MAX_FAN_OUT (15) by ADR-040 so the range actually CROSSES the cap. At 8 it
      // stopped short of it, and an exhaustive test that never reaches the bound it is checking
      // proves the arithmetic on one side of the interesting point only.
      for (let routeCount = 1; routeCount <= 20; routeCount++) {
        const { workerCount, shareCents } = narrowFanOut(routeCount, rootEnvelope);
        if (workerCount === 0) {
          expect(rootEnvelope, `n=0 only when the rail is empty`).toBe(0);
          continue;
        }
        expect(
          shareCents,
          `share must fund the worker (root=${rootEnvelope}, n=${routeCount})`,
        ).toBeGreaterThanOrEqual(1);
        // The division is a real division: the workers together never exceed the root envelope.
        expect(shareCents * workerCount).toBeLessThanOrEqual(rootEnvelope);
      }
    }
  });

  test("it NARROWS rather than refusing — the owner's decision, not the adversary's", () => {
    // A rail that can fund two workers buys two answers, not none. This is the clause ADR-038
    // chose over the fail-closed alternative, and it is the difference between a smaller answer
    // and a dead end on the surface where a user is most likely to be mid-task.
    expect(narrowFanOut(5, 3)).toEqual({ workerCount: 3, shareCents: 1 });
    expect(narrowFanOut(5, 2)).toEqual({ workerCount: 2, shareCents: 1 });
    // And it never invents workers the model did not ask for, or exceeds the depth-1 cap.
    expect(narrowFanOut(2, 1000).workerCount).toBe(2);
    expect(narrowFanOut(99, 1000).workerCount).toBe(MAX_FAN_OUT);
  });

  test("an empty rail funds nobody — the one place fail-closed is still right", () => {
    expect(narrowFanOut(5, 0)).toEqual({ workerCount: 0, shareCents: 0 });
  });
});

// ── The mint. This is the FATAL both adversaries found. ───────────────────────────────────────
describe("startTeamRun — what a child is at birth", () => {
  test("EVERY child is born `kind: 'memo'` with a subject and a parent", async () => {
    // THE FATAL, found by two independent reviewers before implementation. `insertPlan` used to
    // write no `kind`, because every caller patched it in a SECOND transaction — which a fan-out
    // minting n children in one mutation cannot do. A child without `kind: "memo"` is discarded by
    // THREE fail-closed gates: `landSpecialistResult`'s CAS, the sibling flip that reads it, and
    // `reliabilitySweep`'s `collectingPlane`. The paid memo vanishes, the parent hangs at
    // `collecting` for ever, and every join test below would still pass if it seeded children by
    // hand. That is why this test comes FIRST and reads the row back.
    // MUTATION that turns this red: drop `kind: "memo"` from startTeamRun's insertPlan call.
    const t = newTest();
    const planId = await stagedRoot(t);

    const res = await startTeam(t, planId, ["offer-architect", "lead-engine"]);
    expect(res.ok).toBe(true);

    const kids = await childrenOf(t, planId);
    expect(kids).toHaveLength(2);
    for (const kid of kids) {
      expect(kid.kind).toBe("memo");
      expect(kid.status).toBe("collecting");
      expect(kid.subject && kid.subject.length > 0).toBe(true);
      expect(kid.parentPlanId).toBe(planId);
      expect(kid.threadId).toBe(THREAD);
    }
    // The headings are what `fanOutMemoBody` will use — the route survives to the parent memo
    // WITHOUT anyone parsing it back out of rendered prose.
    // ADR-040: the heading carries the ROUTE and the sub-question, because two children may now
    // share a route and two identical section headings in the assembled memo would leave the
    // reader unable to tell which answer came from which question.
    expect(kids.map((k) => k.subject).sort()).toEqual([
      `Lead engine — ${UMBRELLA}`,
      `Offer architect — ${UMBRELLA}`,
    ]);
    await cancelQueued(t);
  });

  test("every worker is scheduled with a REAL envelope and never with 0", async () => {
    // A child passing 0 silently re-derives the full 25% rail and the division is gone with no
    // test failing — `governedDispatch` cannot tell "no envelope yet" from "a divided envelope of
    // zero". This is the integration half of the arithmetic test above.
    const t = newTest();
    const planId = await stagedRoot(t);
    await startTeam(t, planId, ["offer-architect", "lead-engine", "money-model-designer"]);

    const queued = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(queued).toHaveLength(3);
    const args = queued.map((q) => q.args[0] as Record<string, unknown>);
    for (const a of args) {
      expect(a.envelopeCents).toBeGreaterThanOrEqual(1);
      expect(a.spentCents).toBe(0);
      expect(a.depth).toBe(1);
      expect(a.ancestry).toEqual([]);
      expect(a.parentAgentId).toBe("executive");
      // ONE lineage key for the tree, distinct plan ids per worker — the pairing that is exactly
      // why the root request id is minted rather than derived from planId.
      expect(a.rootRequestId).toBe("root-fanout-1");
    }
    expect(new Set(args.map((a) => String(a.planId))).size).toBe(3);
    // Every worker gets the SAME share: it is one division, done once, at the mint.
    expect(new Set(args.map((a) => a.envelopeCents)).size).toBe(1);
    await cancelQueued(t);
  });

  test("a repeated route ON ONE QUESTION buys ONE worker, not five paid turns", async () => {
    // The guard ADR-040 had to PRESERVE while raising the cap. Four copies of `research` all
    // asking the same thing are four identical paid turns for one answer, and the cycle guard
    // cannot catch it: `wouldCycle` is evaluated per child against an EMPTY ancestry, so it
    // never fires between siblings. The pair dedupe is the only guard.
    // MUTATION that turns this red: dedupe on `route` alone in `legalAssignments`, or drop the
    // `seen` set entirely.
    const t = newTest();
    const planId = await stagedRoot(t);
    const res = await startTeam(t, planId, ["research", "research", "research", "research"]);
    expect(res.ok && res.workerCount).toBe(1);
    expect(await childrenOf(t, planId)).toHaveLength(1);
    await cancelQueued(t);
  });

  test("unknown routes are dropped and `media` is refused at the door", async () => {
    // ADR-008: the model supplies the vocabulary of its REQUEST, never the vocabulary of what runs.
    // `media` is excluded deliberately — a media dispatch runs `groundMediaBrief`, a PAID turn with
    // no envelope check, so N media children would be N full-price passes outside every ceiling.
    const t = newTest();
    const planId = await stagedRoot(t);
    const res = await startTeam(t, planId, ["media", "not-a-route", "", "offer-architect"]);
    expect(res.ok && res.workerCount).toBe(1);
    const kids = await childrenOf(t, planId);
    expect(kids.map((k) => k.subject)).toEqual([`Offer architect \u2014 ${UMBRELLA}`]);
    await cancelQueued(t);
  });

  test("no legal route at all mints NOTHING and refuses in words", async () => {
    const t = newTest();
    const planId = await stagedRoot(t);
    const res = await startTeam(t, planId, ["media", "nonsense"]);
    expect(res.ok).toBe(false);
    expect(await childrenOf(t, planId)).toHaveLength(0);
    // A governed stop is a paused conversation, and it never names a reason code to the user.
    expect(res.ok === false && res.reply).toMatch(/specialists/i);
    expect(res.ok === false && res.reply).not.toMatch(/budget_exhausted|unknown_route|envelope/);
  });
});

// ── The join: many workers, ONE approval card. ────────────────────────────────────────────────
describe("the fan-out lands as exactly one approval (ADR-037 Decision 4)", () => {
  /** Land a child the way `landSpecialistResult` does on the real path. */
  const land = (t: T, planId: Id<"plans">, body: string) =>
    t.mutation(internal.evaluations.landSpecialistResult, {
      tenantId: TENANT,
      threadId: THREAD,
      planId,
      gapIndex: 0,
      route: "offer-architect",
      body,
      incomplete: false,
    });

  test("the parent waits for the last worker, then becomes ONE card", async () => {
    // MUTATION that turns this red: flip the parent on every child landing rather than on the last.
    const t = newTest();
    const planId = await stagedRoot(t);
    await startTeam(t, planId, ["offer-architect", "lead-engine", "money-model-designer"]);
    await cancelQueued(t);
    const kids = await childrenOf(t, planId);
    expect(kids).toHaveLength(3);

    await land(t, kids[0]!._id, "First answer.");
    await land(t, kids[1]!._id, "Second answer.");
    // Two down, one running: nothing is approvable yet, and NOTHING is in the inbox.
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("collecting");
    const mid = await t
      .withIdentity({ subject: TENANT })
      .query(api.approvals.listAwaiting, { paginationOpts: { numItems: 25, cursor: null } });
    expect(mid.items).toHaveLength(0);

    await land(t, kids[2]!._id, "Third answer.");

    const parent = await t.run((ctx) => ctx.db.get(planId));
    expect(parent?.status).toBe("proposed");
    // The assembled artifact carries every worker's answer, in mint order, under its own heading.
    expect(parent?.body).toContain("## Offer architect");
    expect(parent?.body).toContain("## Lead engine");
    expect(parent?.body).toContain("First answer.");
    expect(parent?.body).toContain("Third answer.");

    // EXACTLY ONE card for the whole team, and the workers are invisible to the inbox.
    const after = await t
      .withIdentity({ subject: TENANT })
      .query(api.approvals.listAwaiting, { paginationOpts: { numItems: 25, cursor: null } });
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.planId).toBe(planId);
    for (const kid of await childrenOf(t, planId)) expect(kid.status).toBe("approved");
  });

  test("a worker that produced nothing still counts, and still gets its section", async () => {
    // Dropping a failed worker would make the assembled artifact silently narrower than the
    // question that was asked — a partial answer wearing a complete one's clothes.
    const t = newTest();
    const planId = await stagedRoot(t);
    await startTeam(t, planId, ["offer-architect", "lead-engine"]);
    await cancelQueued(t);
    const kids = await childrenOf(t, planId);

    await land(t, kids[0]!._id, "A real answer.");
    await t.mutation(internal.evaluations.landSpecialistResult, {
      tenantId: TENANT,
      threadId: THREAD,
      planId: kids[1]!._id,
      gapIndex: 0,
      route: "lead-engine",
      incomplete: false,
      fallbackReason: "error",
      fallbackBody: "# Research\n\nThe run stopped before it produced anything.",
    });

    const parent = await t.run((ctx) => ctx.db.get(planId));
    expect(parent?.status).toBe("proposed");
    expect(parent?.body).toContain("## Lead engine");
    expect(parent?.body).toContain("stopped before it produced anything");
  });
});

// ── The watchdog: a dead worker must not strand the team. ─────────────────────────────────────
describe("reliabilitySweep resolves a fan-out (ADR-037 Decision 4)", () => {
  test("a stalled CHILD lands `approved` and releases the parent", async () => {
    // Un-branched, the sweep would patch a stalled child to `proposed` — a SECOND card in the
    // inbox for work the parent already represents — and never re-run the sibling check, so the
    // parent would sit at `collecting` for ever, invisible and blocking every future dispatch on
    // the thread through `isOpenRoot`.
    // MUTATION that turns this red: remove the `parentPlanId` branch from the collecting sweep.
    const t = newTest();
    const planId = await stagedRoot(t);
    await startTeam(t, planId, ["offer-architect", "lead-engine"]);
    await cancelQueued(t);
    const kids = await childrenOf(t, planId);

    await t.mutation(internal.evaluations.landSpecialistResult, {
      tenantId: TENANT,
      threadId: THREAD,
      planId: kids[0]!._id,
      gapIndex: 0,
      route: "offer-architect",
      body: "Landed normally.",
      incomplete: false,
    });
    // The other worker died: age it past the stall window, with no live run behind it.
    await t.run((ctx) => ctx.db.patch(kids[1]!._id, { createdAt: 1 }));
    await t.run((ctx) => ctx.db.patch(planId, { createdAt: 1 }));

    await t.mutation(internal.reliabilitySweep.sweepStuckPlans, {
      cursor: null,
      batchSize: 100,
      dryRun: false,
      oneBatchOnly: true,
    });

    const swept = await t.run((ctx) => ctx.db.get(kids[1]!._id));
    expect(swept?.status).toBe("approved"); // the CHILD terminal, never `proposed`
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
  });

  test("a parent with a LIVE worker is left alone", async () => {
    // The parent has no workflow of its own, so `dispatchLive` cannot see that its children are
    // running. Without the exemption the sweep would resolve a healthy, in-flight fan-out.
    const t = newTest();
    const planId = await stagedRoot(t);
    await startTeam(t, planId, ["offer-architect", "lead-engine"]);
    await cancelQueued(t);
    await t.run((ctx) => ctx.db.patch(planId, { createdAt: 1 }));

    await t.mutation(internal.reliabilitySweep.sweepStuckPlans, {
      cursor: null,
      batchSize: 100,
      dryRun: false,
      oneBatchOnly: true,
    });

    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("collecting");
  });
});

// ── ADR-040: a child is an ASSIGNMENT, and that is what makes the cap mean anything. ──────────
describe("startTeamRun — one route, several questions", () => {
  test("the SAME route on DIFFERENT questions buys a worker each", async () => {
    // The whole of ADR-040 in one assertion. Under ADR-037 this returned ONE worker, because a
    // child was a route and the dedupe collapsed by route — so `MAX_FAN_OUT` was decorative and
    // `SPECIALIST_ROUTES` (six members, `media` refused) was the real bound at five.
    // MUTATION that turns this red: dedupe on `route` alone in `legalAssignments`.
    const t = newTest();
    const planId = await stagedRoot(t);
    const res = await startTeamAssign(t, planId, [
      { route: "research", question: "What do competitors charge?" },
      { route: "research", question: "What do buyers complain about?" },
      { route: "research", question: "Which channels do they use?" },
    ]);
    expect(res.ok && res.workerCount).toBe(3);
    const kids = await childrenOf(t, planId);
    expect(kids).toHaveLength(3);
    // Every heading is DISTINCT. Three sections all headed `Research` would give the assembled
    // parent memo three indistinguishable headings and the reader could not tell which answer
    // belonged to which question.
    expect(new Set(kids.map((k) => k.subject)).size).toBe(3);
    await cancelQueued(t);
  });

  test("each worker is briefed with ITS OWN question, never the umbrella one", async () => {
    // The failure this catches is silent and expensive: brief all N with the umbrella question and
    // you have re-created the identical-paid-turn case ONE LAYER DOWN, where no dedupe can see it —
    // N distinct children, N distinct rows, N identical model turns.
    // MUTATION that turns this red: pass `a.question` instead of `child.question` in startTeamRun.
    const t = newTest();
    const planId = await stagedRoot(t);
    await startTeamAssign(t, planId, [
      { route: "research", question: "What do competitors charge?" },
      { route: "lead-engine", question: "Where are leads leaking?" },
    ]);
    const queued = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const asked = queued
      .map((r) => (r.args[0] as { question?: string } | undefined)?.question)
      .filter((q): q is string => typeof q === "string");
    expect(asked).toHaveLength(2);
    expect(new Set(asked)).toEqual(
      new Set(["What do competitors charge?", "Where are leads leaking?"]),
    );
    expect(asked).not.toContain(UMBRELLA);
    await cancelQueued(t);
  });

  test("a blank sub-question is DROPPED, never defaulted to the umbrella question", async () => {
    // Defaulting would quietly re-create the identical-turn case wearing a route the caller really
    // did ask for. Dropping is the fail-closed direction: the user gets a smaller team, not a
    // duplicate paid turn. MUTATION: `question || a.question` in `legalAssignments`.
    const t = newTest();
    const planId = await stagedRoot(t);
    const res = await startTeamAssign(t, planId, [
      { route: "research", question: "   " },
      { route: "lead-engine", question: "Where are leads leaking?" },
    ]);
    expect(res.ok && res.workerCount).toBe(1);
    await cancelQueued(t);
  });

  test("MAX_FAN_OUT is the ceiling and it BINDS — 20 distinct assignments start 15", async () => {
    // Before ADR-040 no input could reach this cap, so it was never the thing that stopped a
    // fan-out. It is now the real bound on how many PAID TURNS one Approve can buy.
    const t = newTest();
    const planId = await stagedRoot(t);
    const res = await startTeamAssign(
      t,
      planId,
      Array.from({ length: 20 }, (_, i) => ({ route: "research", question: `Question ${i}?` })),
    );
    expect(res.ok && res.workerCount).toBe(MAX_FAN_OUT);
    expect(res.ok && res.requested).toBe(20);
    expect(await childrenOf(t, planId)).toHaveLength(MAX_FAN_OUT);
    await cancelQueued(t);
  });

  test("ROOT_SCAN still clears a FULL fan-out — the coupling, not either number", async () => {
    // ROOT_SCAN was the literal 20 while MAX_FAN_OUT was 5, and its safety was argued in PROSE.
    // Raising the cap to 15 left 16 rows of burial against a window of 20 — still correct, and
    // correct by luck rather than by construction. This pins the RELATIONSHIP, so raising the cap
    // again cannot quietly push a root out of its own read.
    // MUTATION that turns this red: `export const ROOT_SCAN = 20;` back as a literal.
    expect(ROOT_SCAN).toBeGreaterThan(MAX_FAN_OUT + 1);
  });
});
