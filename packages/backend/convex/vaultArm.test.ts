// 43-06 — THE VAULT ARM: one Approve settles every child, one cancel disarms them.
//
// ITS OWN FILE, and that is a deliberate structural choice rather than tidiness. These tests drive
// `persistNextStepMemo`, which starts a REAL vault-ingest workflow, and `cockpit.test.ts` is a
// 2400-line file where eight describes install fake timers and three different harnesses register
// three different component sets. Run inside it, these failed PROGRESSIVELY — the first two green,
// everything after red with `crypto is not defined`, a message pointing at `contentHash` and
// having nothing to do with it — and passed in isolation under `-t`. That difference is the whole
// diagnosis: the interference is cross-describe, not in the code under test. A file with one
// harness and one clock has neither problem, and the ADR-042 arm binding is worth reading on its
// own anyway.
import { CHANNELS, type Channel, isSchedulable } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_vault_arm";

type T = ReturnType<typeof convexTest>;
const harnesses = new Set<T>();

/**
 * Only what the VAULT arm touches: the workflow pair for the ingest `persistNextStepMemo` starts,
 * `auditCounts` for the `plan.canceled` / `plan.discarded` / `plan.published` rows, and
 * `rateLimiter` because the ingest reaches it. The 19-02/19-05 rule — every extra
 * `registerComponent` loads a whole module tree into another in-memory backend.
 */
function withVaultArm(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  harnesses.add(t);
  return t;
}

/** Every `persistNextStepMemo` starts an ingest workflow that outlives its test. Cancel the
 *  pending work and let the in-progress work finish, so nothing runs against a torn-down context.
 *  `cockpit.test.ts`'s `quiesceDeliveryHarness` is the shipped original this copies. */
afterEach(async () => {
  const live = [...harnesses];
  harnesses.clear();
  for (const t of live) {
    for (let pass = 0; pass < 20; pass += 1) {
      await t.run(async (ctx) => {
        for (const row of await ctx.db.system.query("_scheduled_functions").collect())
          if (row.state.kind === "pending") await ctx.scheduler.cancel(row._id);
      });
      await t.finishInProgressScheduledFunctions();
      const remaining = await t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (row) => row.state.kind === "pending" || row.state.kind === "inProgress",
        ),
      );
      if (remaining.length === 0) break;
    }
  }
});

// ══ 43-06: ONE APPROVE SETTLES EVERY CHILD, ONE CANCEL DISARMS THEM ═══════════════════════════
//
// `withFanoutOnly` because `persistNextStepMemo` starts the vault-ingest workflow, and nothing
// here touches the email arm — the 19-02/19-05 lesson: every extra registerComponent loads another
// module tree into a second in-memory backend and crashes the shared vitest fork.
describe("executePlan — a batch parent settles its children (43-06, ADR-039 D5)", () => {
  const THREAD_B = "thread_batch_43_06";

  async function seedBatch(
    t: ReturnType<typeof convexTest>,
    kids: { sendAt?: number }[],
  ): Promise<{ parent: Id<"plans">; children: Id<"plans">[] }> {
    return t.run(async (ctx) => {
      const parent = await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: THREAD_B,
        kind: "memo",
        status: "proposed",
        channel: "vault",
        subject: "September pricing post",
        body: "# September pricing post\n\n## Numbers\n\nDraft A.",
        createdAt: Date.now(),
      });
      const children: Id<"plans">[] = [];
      for (const [i, kid] of kids.entries())
        children.push(
          await ctx.db.insert("plans", {
            tenantId: TENANT,
            threadId: THREAD_B,
            parentPlanId: parent,
            kind: "memo",
            status: "approved", // what landSpecialistResult leaves a landed child at
            channel: "vault",
            subject: `September pricing post — variant ${i}`,
            body: `Draft ${i}.`,
            ...(kid.sendAt === undefined ? {} : { sendAt: kid.sendAt }),
            createdAt: Date.now(),
          }),
        );
      return { parent, children };
    });
  }

  const vaultDocs = (t: ReturnType<typeof convexTest>) =>
    t.run((ctx) => ctx.db.query("vaultDocuments").collect());

  const approve = (t: ReturnType<typeof convexTest>, planId: Id<"plans">) =>
    t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });

  // THE HIGHEST-CONSEQUENCE ASSERTION IN THIS PHASE. An arm that only handled the children
  // carrying a `sendAt` would leave the rest at `approved` — one of exactly two statuses invisible
  // to every approvals query — and the parent would then reach `done`. A 15-variant batch where
  // the user timed three would file three documents, silently discard twelve FULLY BILLED drafts,
  // and read finished.
  // MUTATION: delete the `child.sendAt === undefined` publish branch in `armOrPublishChildren`
  // → 0 documents from the unscheduled children. Red.
  test("an unscheduled variant PUBLISHES NOW; a scheduled one is armed", async () => {
    const t = withVaultArm();
    const at = Date.now() + 60 * 60 * 1000;
    const { parent, children } = await seedBatch(t, [{}, {}, { sendAt: at }]);

    expect(await approve(t, parent)).toEqual({ ok: true, scheduled: true });

    const docs = await vaultDocs(t);
    expect(docs).toHaveLength(2);
    // PROVENANCE (43-04): a content batch is not a next-step memo from an evaluation.
    for (const doc of docs) expect(doc.kind).toBe("content_draft");

    const rows = await t.run(async (ctx) => Promise.all(children.map((id) => ctx.db.get(id))));
    expect(rows.filter((r) => r?.status === "done")).toHaveLength(2);
    expect(rows.filter((r) => r?.status === "scheduled")).toHaveLength(1);
    // The parent must NOT take `done` while a child is armed: `cancelScheduledPlan` CASes on
    // `scheduled` and `discardPlan` on `proposed`, so a `done` parent is unreachable from both.
    expect((await t.run((ctx) => ctx.db.get(parent)))?.status).toBe("scheduled");
  });

  // NON-VACUITY for the parent status: with NO child armed the parent finishes, so `scheduled` is
  // not a blanket outcome.
  test("with every variant unscheduled the parent reaches done", async () => {
    const t = withVaultArm();
    const { parent } = await seedBatch(t, [{}, {}]);
    expect(await approve(t, parent)).toEqual({ ok: true });
    expect(await vaultDocs(t)).toHaveLength(2);
    expect((await t.run((ctx) => ctx.db.get(parent)))?.status).toBe("done");
  });

  // A BATCH PARENT SAVES NOTHING OF ITS OWN. Its body is already the assembly of its children, so
  // publishing it too would file the whole batch twice — 2 children must yield 2 documents, not 3.
  // This catches a `persistNextStepMemo(ctx, plan)` left behind on the parent path.
  test("the parent files no document of its own", async () => {
    const t = withVaultArm();
    const { parent } = await seedBatch(t, [{}, {}]);
    await approve(t, parent);
    const docs = await vaultDocs(t);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.sourcePlanId)).not.toContain(parent);
  });

  // A CHILDLESS vault memo carrying its OWN time. Before the flip `setPlanSendTime` refused this;
  // the flip made it legal, and without the first branch of the memo terminal the row would
  // publish IMMEDIATELY and drop the time it just accepted — ADR-039 D3's prohibition surviving
  // the very flip meant to honour it.
  // MUTATION: delete that branch → `{ ok: true }` and status `done`. Red.
  test("a childless vault memo with its own sendAt is ARMED, not published now", async () => {
    const t = withVaultArm();
    const at = Date.now() + 60 * 60 * 1000;
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_solo_vault",
        kind: "memo",
        status: "proposed",
        channel: "vault",
        subject: "One piece",
        body: "Draft.",
        sendAt: at,
        createdAt: Date.now(),
      }),
    );
    expect(await approve(t, planId)).toEqual({ ok: true, scheduled: true });
    const row = await t.run((ctx) => ctx.db.get(planId));
    expect(row?.status).toBe("scheduled");
    expect(row?.scheduledFunctionId).toBeDefined();
    expect(await vaultDocs(t)).toHaveLength(0);
  });

  // BYTE-IDENTITY for the ordinary single memo: no children, no sendAt, still saves and finishes,
  // and still files as a next-step memo rather than a content draft.
  test("an ordinary childless memo is unchanged", async () => {
    const t = withVaultArm();
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_plain_memo",
        kind: "memo",
        status: "proposed",
        body: "Call the supplier on Monday.",
        createdAt: Date.now(),
      }),
    );
    expect(await approve(t, planId)).toEqual({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("done");
    const docs = await vaultDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.kind).toBe("next_step_memo");
  });

  // ── the cancel walk ──────────────────────────────────────────────────────────────────────────
  //
  // MUTATION: delete the `continue` guard in `cancelFanOutChildren` → `scheduler.cancel` throws on
  // the already-fired child's committed id, the WHOLE mutation rolls back, and every sibling stays
  // armed while the cancel reads as a plain failure.
  test("cancelling the parent disarms every live child and leaves a fired one alone", async () => {
    const t = withVaultArm();
    const at = Date.now() + 60 * 60 * 1000;
    const { parent, children } = await seedBatch(t, [{ sendAt: at }, { sendAt: at }, {}]);
    await approve(t, parent);
    // children[2] carried no time, so it PUBLISHED at approve and is already `done` — the
    // committed-callback shape `scheduler.cancel` throws on.
    expect((await t.run((ctx) => ctx.db.get(children[2] as Id<"plans">)))?.status).toBe("done");

    expect(
      await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.cancelScheduledPlan, { planId: parent }),
    ).toEqual({ ok: true, canceled: true });

    const rows = await t.run(async (ctx) => Promise.all(children.map((id) => ctx.db.get(id))));
    expect(rows.filter((r) => r?.status === "canceled")).toHaveLength(2);
    for (const row of rows.filter((r) => r?.status === "canceled")) {
      expect(row?.cancelKind).toBe("scheduled_cancel");
      expect(row?.scheduledFunctionId).toBeUndefined();
    }
    // The published one is untouched.
    expect(rows.filter((r) => r?.status === "done")).toHaveLength(1);

    // NOTHING IS STILL ARMED. Asserting on the plan rows alone stays green when the walk is
    // deleted — the system table is what actually goes red.
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(pending.filter((row) => row.state.kind === "pending")).toHaveLength(0);
  });

  // The discard arm: a batch discarded BEFORE approve has children at `approved` carrying no
  // timer, so the scheduler half is a no-op and only the STATUS half does anything. Without it,
  // fifteen children keep reading `approved` — invisible to every approvals query.
  // MUTATION: drop the `cancelFanOutChildren` call from `discardPlan` → children stay `approved`.
  test("discarding a proposed batch cancels its children too", async () => {
    const t = withVaultArm();
    const { parent, children } = await seedBatch(t, [{}, {}]);

    expect(
      await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.discardPlan, { planId: parent }),
    ).toEqual({ ok: true, discarded: true });

    const rows = await t.run(async (ctx) => Promise.all(children.map((id) => ctx.db.get(id))));
    for (const row of rows) {
      expect(row?.status).toBe("canceled");
      expect(row?.cancelKind).toBe("discarded");
    }
    expect(await vaultDocs(t)).toHaveLength(0);
  });
});

// ══ ADR-042 D4 — EVERY SCHEDULABLE CHANNEL HAS AN ARM ═════════════════════════════════════════
//
// THE REPLACEMENT for the assertion 43-06 deleted from `packages/core/src/channel.test.ts`. That
// one said "at least one channel is unschedulable, so the refusal has a reachable subject", and it
// expired the moment `vault` was flipped. This asks the HAZARD instead — can every channel that
// CLAIMS to be schedulable actually be scheduled — and that question stays falsifiable for ever.
//
// It could not live in `packages/core`: proving a channel has an arm needs `convex/`, and core must
// never import it (§1). This is exactly why ADR-042 D4 puts the binding on the backend side.
//
// IT ASSERTS AN ARTIFACT, NEVER A STATUS. A status-only assertion goes GREEN on the mis-arming
// case — a vault row armed onto the EMAIL callback reaches `done` too, having published nothing.
// The vault case therefore asserts a `vaultDocuments` row whose `sourcePlanId` is this plan, which
// no other plan's document can satisfy.
/** `startScheduledDelivery`'s args, spelled out because a Convex `FunctionReference` is not a
 *  function type and `Parameters<>` does not apply to it. */
type DeliveryCallbackArgs = {
  planId: Id<"plans">;
  tenantId: string;
  requestIds: Id<"requests">[];
  correlationIds: string[];
  planCid: string;
  scheduledFor?: number;
};

describe("every schedulable channel has an arm (ADR-042 D4)", () => {
  type ArmCase = {
    /** The row shape this channel's arm consumes. */
    seed: (t: T) => Promise<Id<"plans">>;
    /** What must exist after the timer fires. Throws or returns false to fail. */
    fired: (t: T, planId: Id<"plans">) => Promise<boolean>;
  };

  // `satisfies Record<Channel, ArmCase>` is the mechanism, not decoration: adding a member to
  // CHANNELS without giving it a case here is a COMPILE error in this file, which is what makes
  // "a channel marked schedulable with no arm" impossible to land quietly.
  const ARM_CASES = {
    email: {
      // The email arm has real prerequisites the vault arm does not: a connected mailbox and a
      // CAN-SPAM postal address. Seeding them here rather than skipping the case is the point —
      // a binding that only ever exercised `vault` would prove nothing about the channel switch.
      seed: async (t) => {
        await t.run((ctx) =>
          ctx.db.insert("gmailTokens", {
            tenantId: TENANT,
            refreshToken: "r",
            scope: "s",
            updatedAt: Date.now(),
          }),
        );
        await t.run((ctx) =>
          ctx.db.insert("tenantProfiles", {
            tenantId: TENANT,
            tier: "solopreneur",
            tierSource: "derived",
            derivedAt: Date.now(),
            postalAddress: "Pikar AI, 12 Samora Ave, Dar es Salaam, TZ",
          }),
        );
        return t.run((ctx) =>
          ctx.db.insert("plans", {
            tenantId: TENANT,
            threadId: "thread_arm_email",
            status: "proposed",
            channel: "email",
            recipients: ["a@example.com"],
            subject: "Q3 update",
            body: "Body.",
            createdAt: Date.now(),
          }),
        );
      },
      fired: async (t, planId) => {
        const row = await t.run((ctx) => ctx.db.get(planId));
        // The email arm's artifact is a started delivery workflow, which stamps `workflowId`.
        return row?.workflowId !== undefined;
      },
    },
    vault: {
      seed: (t) =>
        t.run((ctx) =>
          ctx.db.insert("plans", {
            tenantId: TENANT,
            threadId: "thread_arm_vault",
            kind: "memo",
            status: "proposed",
            channel: "vault",
            subject: "One piece",
            body: "Draft.",
            createdAt: Date.now(),
          }),
        ),
      fired: async (t, planId) => {
        const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
        // THE ARTIFACT, not the status: `sourcePlanId` is unsatisfiable by another plan's document.
        return docs.some((d) => d.sourcePlanId === planId);
      },
    },
  } satisfies Record<Channel, ArmCase>;

  const schedulable = CHANNELS.filter(isSchedulable);

  // NON-VACUITY FLOOR. If nothing is schedulable the `test.each` below runs zero cases and the
  // suite reports green over a queue that cannot queue anything.
  test("at least one channel is schedulable, so the binding below has subjects", () => {
    expect(schedulable.length).toBeGreaterThan(0);
  });

  // MUTATION A (red on today's tree, one character): mark a channel `schedulable: true` in
  // CHANNEL_SPECS without writing its arm in `startScheduledDelivery` — this test gains a case
  // whose `fired` never becomes true.
  // MUTATION B: delete the `case "vault"` arm from `startScheduledDelivery`'s switch — the vault
  // row falls to `startFanout`, reaches `done` with zero requests, and `fired` returns false.
  // A status-only assertion would have gone GREEN on B; that is the whole reason for `fired`.
  test.each(schedulable)("%s: setPlanSendTime -> Approve -> fire -> artifact", async (channel) => {
    const t = withVaultArm();
    const armCase = ARM_CASES[channel];
    const planId = await armCase.seed(t);

    // FIXTURE HONESTY: the row really is on the channel this case claims.
    expect((await t.run((ctx) => ctx.db.get(planId)))?.channel).toBe(channel);

    const at = Date.now() + 60 * 60 * 1000;
    const asTenant = t.withIdentity({ subject: TENANT });
    expect(await asTenant.mutation(api.plans.setPlanSendTime, { planId, sendAt: at })).toEqual({
      ok: true,
    });
    expect(await asTenant.mutation(api.cockpit.executePlan, { planId })).toEqual({
      ok: true,
      scheduled: true,
    });

    const armed = await t.run((ctx) => ctx.db.get(planId));
    expect(armed?.status).toBe("scheduled");
    expect(armed?.scheduledFunctionId).toBeDefined();

    // FIRE WITH THE ARGS THE ARM ACTUALLY REGISTERED, read out of `_scheduled_functions` rather
    // than fabricated here. Hand-built args prove only that the terminal works when handed a
    // correct shape; these prove the ARM built that shape. (Fabricating `requestIds: []` for the
    // email case tripped `EMPTY_FANOUT` — the guard was right and the fixture was wrong, which is
    // itself the argument for reading the real thing.)
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const armedCall = pending.find(
      (row) => (row.args[0] as { planId?: string } | undefined)?.planId === planId,
    );
    expect(armedCall, "the arm registered no callback for this plan").toBeDefined();
    await t.mutation(
      internal.cockpit.startScheduledDelivery,
      armedCall?.args[0] as DeliveryCallbackArgs,
    );

    expect(await armCase.fired(t, planId)).toBe(true);
  });
});
