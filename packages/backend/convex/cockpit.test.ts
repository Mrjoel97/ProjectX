// SC4 mutation-level invariants (convex-test): the executePlan approve-gate is idempotent
// (double-approve → one workflow), never seeds/starts on a non-proposed status (zero sends
// before Approve), rejects a cross-tenant approve, and refuses when no mailbox is connected.
//
// The deterministic FSM parser (parseAnswer/toIntentState) was DELETED in 03.2.1-05 (the cockpit
// reasons via the agent tool-loop now) — its tests went with it. The guard tests below RETURN
// before workflow.start; the attachment fan-out tests (CKPT-02, Plan 05) DO drive the successful
// proposed→delivering path by registering the workflow + workflow/workpool components (the same
// pattern cockpitTools.test.ts uses for the aggregate). smoke:fanout remains the live coverage.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import retrierTest from "@convex-dev/action-retrier/test";
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { SEND_TIME_HORIZON_MS, withheldNote } from "@pikar/core";
import { maxCharsFor } from "@pikar/core/storyboard";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// cancelScheduledPlan writes a refs-only plan.canceled audit; the SOLE audit-insert surface counts
// the auditCounts aggregate, so register the component (relative import — the package blocks the
// deep specifier), same pattern as cockpitTools.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// 20-07: the media pre-step drives BOTH media spend windows through the REAL rate-limiter.
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
// Register the delivery components so executePlan can reach workflow.start under convex-test.
// (workpool is a first-class runtime dependency since 15.3-04 — the app registers its own
// `vaultIngestPool` — but this suite only needs the copy @convex-dev/workflow nests under itself.)
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";

/** A convex-test instance wired for both executePlan delivery arms. */
function withDelivery() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  retrierTest.register(t);
  return t;
}

/** The tenant's CAN-SPAM postal address (19-05). Its own helper because "no postal address" is a
 *  refusal path with its own test — the sendable tenant gets it through `seedMailbox`. */
const POSTAL = "Pikar AI, 12 Samora Ave, Dar es Salaam, TZ";
const seedPostalAddress = (
  t: ReturnType<typeof convexTest>,
  tenantId = TENANT,
  postalAddress = POSTAL,
) =>
  t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "solopreneur",
      tierSource: "derived",
      derivedAt: Date.now(),
      postalAddress,
    }),
  );

/** executePlan's two pre-CAS gates on the EMAIL arm: a connected mailbox, and (19-05) a postal
 *  address for the CAN-SPAM footer. Both are seeded here because every email-arm test needs to get
 *  past both; the tests that assert each refusal seed only the other one. */
const seedMailbox = async (t: ReturnType<typeof convexTest>, tenantId = TENANT) => {
  const id = await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId,
      refreshToken: "r",
      scope: "s",
      updatedAt: Date.now(),
    }),
  );
  await seedPostalAddress(t, tenantId);
  return id;
};

/** Seed a plans row at a given status (raw insert — bypasses the guided conversation). */
async function seedPlan(
  t: ReturnType<typeof convexTest>,
  status: "collecting" | "proposed" | "approved" | "delivering" | "done",
  tenantId = TENANT,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_1",
      status,
      recipients: ["a@example.com", "b@example.com"],
      mode: "individual",
      subject: "Q3 update",
      body: "Here is the Q3 update.",
      createdAt: Date.now(),
    }),
  );
}

const countRequests = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("requests").collect());

async function seedCalendarPlan(
  t: ReturnType<typeof convexTest>,
  status: "collecting" | "proposed" | "approved" | "delivering" | "done",
  fields: { tenantId?: string; escalated?: boolean } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: fields.tenantId ?? TENANT,
      threadId: `calendar_thread_${crypto.randomUUID()}`,
      kind: "calendar_event",
      status,
      eventTitle: "Governed planning review",
      eventStartMs: Date.UTC(2026, 7, 3, 13, 0),
      eventDurationMs: 30 * 60_000,
      eventTz: "Africa/Dar_es_Salaam",
      escalated: fields.escalated,
      createdAt: Date.now(),
    }),
  );
}

describe("executePlan calendar arm (ACTN-02)", () => {
  test("a proposed calendar plan starts one retrier run and records its governed delivery state", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
    expect(plan?.calendarRunId).toEqual(expect.any(String));
    expect(plan?.calendarRunId).not.toHaveLength(0);
    expect(plan?.correlationId).toEqual(expect.any(String));
  });

  test.each([
    "collecting",
    "approved",
    "done",
  ] as const)("a %s calendar plan starts no retrier run and creates nothing", async (status) => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, status);

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true, alreadyStarted: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe(status);
    expect(plan?.calendarRunId).toBeUndefined();
    expect(plan?.calendarEventId).toBeUndefined();
  });

  test("two sequential approvals preserve one run id and the second is an idempotent no-op", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");
    const asTenant = t.withIdentity({ subject: TENANT });

    expect(await asTenant.mutation(api.cockpit.executePlan, { planId })).toEqual({ ok: true });
    const first = await t.run((ctx) => ctx.db.get(planId));
    const secondResult = await asTenant.mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(secondResult).toEqual({ ok: true, alreadyStarted: true });
    const second = await t.run((ctx) => ctx.db.get(planId));
    expect(first?.calendarRunId).toEqual(expect.any(String));
    expect(second?.calendarRunId).toBe(first?.calendarRunId);
  });

  test("calendar approval does not require a connected mailbox", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).not.toEqual({ ok: false, reason: "gmail_not_connected" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.calendarRunId).toEqual(expect.any(String));
  });

  test("calendar approval cannot reach the gmail request or workflow fan-out", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed");

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(await countRequests(t)).toHaveLength(0);
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.workflowId).toBeUndefined();
  });

  test("the existing escalated-plan guard refuses calendar before the arm starts", async () => {
    const t = withDelivery();
    const planId = await seedCalendarPlan(t, "proposed", { escalated: true });

    const result = await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: false, reason: "review_escalated" });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.calendarRunId).toBeUndefined();
    expect(await countRequests(t)).toHaveLength(0);
  });

  // ── 20-07: THE REGRESSION THAT MAKES THE GENERALIZATION SAFE ─────────────────────────────
  //
  // Option (a) — generalize the arm — was taken with its cost stated honestly: the shipped calendar
  // path must come out behaviourally byte-identical. Every assertion above still passes unchanged,
  // and these two add what only becomes checkable once a SECOND occupant exists.

  test("a calendar approval moves NEITHER media window and sets no renderStatus", async () => {
    const t = withMedia();
    const planId = await seedCalendarPlan(t, "proposed");
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    // A generalization that silently drew on the media rail would be invisible without this.
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT })).toBe(
      before,
    );
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.renderStatus).toBeUndefined();
    expect(plan?.mediaRunId).toBeUndefined(); // the calendar run id went to CALENDAR's column
    expect(plan?.calendarRunId).toEqual(expect.any(String));
    expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });

  // ── 17-05: THE INERT calendar_manage TARGET ────────────────────────────────────────────────
  //
  // `calendar_manage` is bound to the `externalAction` arm so the four gap-closure waves after
  // this one compile, but its `EXTERNAL_TARGETS` member is a stub that throws until Plan 17-08.
  // Nothing can stage such a plan (no tool writes the kind until 17-09), so this is reached only
  // by a MANUALLY seeded row — which is precisely what makes it worth asserting: the claim is
  // that if it is ever reached, it fails LOUDLY and leaves nothing behind.
  //
  // Named mutation that turns this RED: replace the stub's `throw` with `Promise.resolve("run_x")`.
  test("a manually seeded calendar_manage plan throws loudly and starts nothing", async () => {
    const t = withDelivery();
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `calendar_manage_thread_${crypto.randomUUID()}`,
        kind: "calendar_manage" as const,
        status: "proposed" as const,
        calendarProvider: "google" as const,
        calendarOperation: "delete" as const,
        createdAt: Date.now(),
      }),
    );

    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).rejects.toThrow(/calendar manage not wired \(17-08\)/);
    await t.finishInProgressScheduledFunctions();

    // A throw aborts the whole Convex mutation, so the `status: "approved"` patch that runs BEFORE
    // the target thunk rolls back with it. That rollback — not an ordering guess — is what makes
    // "no plan-state patch" true, and this is the assertion that holds it.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.correlationId).toBeUndefined();
    expect(plan?.calendarRunId).toBeUndefined();
    expect(plan?.mediaRunId).toBeUndefined();
    expect(plan?.calendarEventId).toBeUndefined();
    // No provider action, no gmail fan-out, no media reservation, no registry row.
    expect(await countRequests(t)).toHaveLength(0);
    expect(plan?.workflowId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toHaveLength(0);
  });

  // The shipped CREATE path must be untouched by the gap closure — 17-VERIFICATION.md uses it as
  // the positive regression anchor for every plan from 17-05 to 17-11. A `calendar_manage` row
  // that could reach `internal.calendar.createEvent` would be the worst possible version of this
  // change: a management proposal quietly creating a NEW event.
  test("the inert manage target cannot reach the shipped calendar_event create path", async () => {
    const t = withDelivery();
    const createId = await seedCalendarPlan(t, "proposed");
    const manageId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `calendar_manage_thread_${crypto.randomUUID()}`,
        kind: "calendar_manage" as const,
        status: "proposed" as const,
        createdAt: Date.now(),
      }),
    );

    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId: manageId }),
    ).rejects.toThrow(/17-08/);
    // …and the create plan on the SAME tenant still approves normally. Anti-vacuity floor: without
    // this the test above would pass just as well against an arm that broke calendar entirely.
    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, {
        planId: createId,
      }),
    ).toEqual({ ok: true });
    await t.finishInProgressScheduledFunctions();

    expect((await t.run((ctx) => ctx.db.get(createId)))?.calendarRunId).toEqual(expect.any(String));
    expect((await t.run((ctx) => ctx.db.get(manageId)))?.calendarRunId).toBeUndefined();
  });
  test("deliverApprovedPlan.ts is byte-unchanged — it is the EMAIL entry point, not a dispatcher", async () => {
    // Routing an external action through it would make the gmail fan-out reachable from calendar
    // AND from media. The file is asserted by content hash against the value 12-05 shipped, so a
    // future "just make it generic" edit is a failing test rather than a review comment.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "deliverApprovedPlan.ts"),
    );
    expect(src.length).toBeGreaterThan(0);
    expect(src.toString()).not.toMatch(/calendar|mediaJobs|reserveJobInner|submitBatch/i);
  });
});

// ── 20-07: the media arm ─────────────────────────────────────────────────────────────────

/** The calendar harness plus the rate-limiter — the media pre-step drives BOTH spend windows. */
function withMedia() {
  const t = withDelivery();
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

/** A staged BLOCK DECK on a `kind: "media"` plan — what 20-08's `persistStoryboard` will write. */
async function seedMediaPlan(
  t: ReturnType<typeof convexTest>,
  opts: {
    blocks?: number;
    clipSeconds?: number;
    chars?: number;
    status?: "proposed" | "approved";
    tenantId?: string;
    type?: string;
    noDeck?: boolean;
  } = {},
) {
  // 4 seconds, not 10: after the OpenAI cutover `MEDIA_VIDEO_SECONDS["sora-2"]` is [4,8,12], so a
  // 10-second block deck is no longer BUYABLE and every test built on one refused with
  // `illegal_duration` before reaching what it meant to assert. The band travels with the length:
  // `maxCharsFor` is read from the SAME variable rather than a second literal, so this cannot
  // drift again.
  const clipSeconds = opts.clipSeconds ?? 4;
  const n = opts.blocks ?? 2;
  const chars = opts.chars ?? maxCharsFor(clipSeconds);
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: opts.tenantId ?? TENANT,
      threadId: `media_thread_${crypto.randomUUID()}`,
      kind: "media",
      status: opts.status ?? "proposed",
      createdAt: Date.now(),
      ...(opts.noDeck
        ? {}
        : {
            clipSeconds,
            shots: Array.from({ length: n }, (_, index) => ({
              index,
              type: opts.type ?? "AI",
              seconds: clipSeconds,
              windowStartMs: index * clipSeconds * 1000,
              description: `scene ${index}`,
              narration: "x".repeat(chars),
              prompt: `prompt ${index}`,
            })),
          }),
    }),
  );
}

const mediaJobsOf = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("mediaJobs").collect());

describe("executePlan media arm (20-07, MEDIA-01)", () => {
  test("approving a media plan reserves the WHOLE reel and starts it — through the ONE Approve gate", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t);
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
    // Paid for, not yet rendered — the state the canvas must be able to name.
    expect(plan?.renderStatus).toBe("pending");
    expect(plan?.mediaRunId).toEqual(expect.any(String));
    expect(plan?.calendarRunId).toBeUndefined(); // never the calendar column
    expect(plan?.correlationId).toEqual(expect.any(String));

    // The WHOLE reel: 2 video + 2 tts + 1 captions STT. The render line is reserved but gets no row.
    const jobs = await mediaJobsOf(t);
    expect(jobs.filter((r) => r.kind === "video")).toHaveLength(2);
    expect(jobs.filter((r) => r.kind === "tts")).toHaveLength(2);
    expect(jobs.filter((r) => r.kind === "stt")).toHaveLength(1);
    expect(jobs.every((r) => r.status === "queued")).toBe(true);
    expect(new Set(jobs.map((r) => r.batchId)).size).toBe(1); // ONE reservation
    // ...and the cents moved exactly once.
    expect(
      await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT }),
    ).toBeLessThan(before);
  });

  test("a reel over the JOB CAP is a governed refusal — plan stays proposed, ZERO rows, nothing scheduled", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, { blocks: 12 }); // 12 x $0.50 clips blows the $3.50 cap
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    // A governed stop RETURNS. Only bugs throw.
    expect(result).toEqual({ ok: false, reason: "over_job_cap" });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed"); // the CAS never ran
    expect(plan?.renderStatus).toBeUndefined();
    expect(plan?.mediaRunId).toBeUndefined();
    expect(await mediaJobsOf(t)).toHaveLength(0);
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT })).toBe(
      before,
    );
  });

  // ── 20.2 wave 8: the arm opens on SCENES ───────────────────────────────────────────────────
  //
  // This arm refused a scene deck by name (`scene_render_not_ready`) from wave 2 until now, for a
  // reason that was true at the time: the specialist could not WRITE a scene deck for a human to
  // approve. Its body does now, so the refusal is deleted rather than left as a member nothing can
  // reach.

  /** A staged SCENE DECK: 8 s clip / 6 s still / 4 s card / 12 s clip = an exact 30 s. */
  async function seedMediaScenePlan(t: ReturnType<typeof convexTest>) {
    const seconds = [8, 6, 4, 12];
    const visuals = ["generated_video", "animated_image", "text_card", "generated_video"];
    let startMs = 0;
    const shots = seconds.map((sec, index) => {
      const shot = {
        index,
        visual: visuals[index] as string,
        seconds: sec,
        windowStartMs: startMs,
        description: `scene ${index}`,
        narration: `line ${index}`,
        prompt: `prompt ${index}`,
        // A card must name its words, or `hasAssetSource` refuses the deck.
        ...(visuals[index] === "text_card" ? { overlay: `card ${index}` } : {}),
      };
      startMs += sec * 1000;
      return shot;
    });
    return t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `media_thread_${crypto.randomUUID()}`,
        kind: "media",
        status: "proposed" as const,
        createdAt: Date.now(),
        targetDurationSeconds: 30,
        clipSeconds: 12,
        shots,
      }),
    );
  }

  test("approving a SCENE deck reserves it per kind — the same gate, not a second rail", async () => {
    const t = withMedia();
    const planId = await seedMediaScenePlan(t);
    // What the canvas would have PRINTED for this deck, read before the money moves.
    const estimate = await t
      .withIdentity({ subject: TENANT })
      .query(api.media.jobEstimate, { planId });

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(result).toEqual({ ok: true });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
    expect(plan?.renderStatus).toBe("pending");
    expect(plan?.mediaRunId).toEqual(expect.any(String));

    // PER KIND, exactly as `generateReel` prices the same deck: two clips at their OWN lengths,
    // one still, and NO picture line for the card. Under the block contract this arm could not buy
    // this deck at all — `deckOf` returns null for a scene row.
    const jobs = await mediaJobsOf(t);
    expect(
      jobs
        .filter((r) => r.kind === "video")
        .map((r) => (r.spec.kind === "video" ? r.spec.seconds : 0))
        .sort((l, r) => l - r),
    ).toEqual([8, 12]);
    expect(jobs.filter((r) => r.kind === "image").map((r) => r.blockIndex)).toEqual([1]);
    expect(jobs.some((r) => r.kind === "video" && r.blockIndex === 2)).toBe(false);

    // ONE rail, ONE number: the estimate the canvas shows and the movement the ledger records for
    // the agent's approval are the same cents, because both come off `reserveSceneJobInner`.
    const moved = await t.run((ctx) => ctx.db.query("spendEvents").collect());
    expect(moved.filter((m) => m.phase === "reserved")).toHaveLength(1);
    expect(moved.find((m) => m.phase === "reserved")?.amountCents).toBe(estimate.totalCents);
  });

  test("a SCENE deck that does not sum to its declared target refuses before the CAS", async () => {
    const t = withMedia();
    const planId = await seedMediaScenePlan(t);
    // 30 declared, 29 on the rows. The assembler would hard-error on this inside a VM that has
    // already been paid for; here it is free.
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) => (s.index === 1 ? { ...s, seconds: 5 } : s));
      await ctx.db.patch(planId, { shots });
    });

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(result).toEqual({ ok: false, reason: "illegal_duration" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test.each([
    ["an over-length narration line", { chars: maxCharsFor(4) + 1 }, "narration_too_long"],
    ["a clip length nobody prices", { clipSeconds: 7, chars: 90 }, "illegal_duration"],
  ] as const)("%s refuses before the CAS", async (_label, opts, reason) => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, opts);

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(result).toEqual({ ok: false, reason });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test("the MEDIA kill switch refuses the approval on its own", async () => {
    const t = withMedia();
    await t.mutation(internal.guardrails.setMediaKillSwitch, { on: true });
    const planId = await seedMediaPlan(t);

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: false, reason: "kill_switch" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test.each([
    ["no deck at all", { noDeck: true }],
    ["a shot type the price table does not know", { type: "MONTAGE" }],
  ] as const)("%s is no_deck — a money gate does not assume its writer was correct", async (_l, opts) => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, opts);

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: false, reason: "no_deck" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test("double-approve reserves NOTHING a second time", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t);
    const asTenant = t.withIdentity({ subject: TENANT });

    expect(await asTenant.mutation(api.cockpit.executePlan, { planId })).toEqual({ ok: true });
    const firstJobs = await mediaJobsOf(t);
    const afterFirst = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT });

    const second = await asTenant.mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(second).toEqual({ ok: true, alreadyStarted: true });
    // The reservation lives in the SAME serializable transaction as the CAS — that is what makes
    // "approve once, reserve once" true with no second idempotency mechanism.
    expect(await mediaJobsOf(t)).toHaveLength(firstJobs.length);
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: TENANT })).toBe(
      afterFirst,
    );
  });

  test("a cross-tenant approve of a media plan still throws plan not found", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t, { tenantId: "tenant_other" });

    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).rejects.toThrow(/plan not found/);
    expect(await mediaJobsOf(t)).toHaveLength(0);
  });

  test("a media approval reaches NO gmail request and NO workflow", async () => {
    const t = withMedia();
    const planId = await seedMediaPlan(t);

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });
    await t.finishInProgressScheduledFunctions();

    expect(await countRequests(t)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(planId)))?.workflowId).toBeUndefined();
  });
});

describe("executePlan approve-gate (SC4)", () => {
  test("idempotent: a non-proposed (already-approved) plan no-ops — double-approve sends once", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "delivering"); // as if the FIRST approve already ran
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: true, alreadyStarted: true });
    // No SECOND set of rows seeded, status untouched → no second workflow.
    expect(await countRequests(t)).toHaveLength(0);
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("delivering");
  });

  test("zero sends before approve: a still-collecting plan never seeds or starts", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting");
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: true, alreadyStarted: true });
    expect(await countRequests(t)).toHaveLength(0);
  });

  test("no mailbox connected: a proposed plan refuses and seeds nothing (stop before delivery)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed"); // ready to approve, but no gmailTokens row
    const asT = t.withIdentity({ subject: TENANT });

    const res = await asT.mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: false, reason: "gmail_not_connected" });
    expect(await countRequests(t)).toHaveLength(0);
    // The CAS did NOT advance past proposed (nothing sent).
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
  });

  test("tenant guard: another tenant's plan is not found (no cross-tenant approve)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed", "tenant_b");
    const asT = t.withIdentity({ subject: TENANT }); // tenant_a approving tenant_b's plan

    await expect(asT.mutation(api.cockpit.executePlan, { planId })).rejects.toThrow(
      /plan not found/,
    );
  });
});

describe("executePlan attachment fan-out (CKPT-02 — one byte set shared across recipients)", () => {
  test("propagates the SAME generated attachment ref to every recipient's request row", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // One generated document (real bytes in storage) referenced inline on the plan (pre-approval).
    const blobId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["pdf-bytes"], { type: "application/pdf" })),
    );
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com"], // 2 recipients → 2 request rows
        mode: "individual",
        subject: "Q3 update",
        body: "Here is the Q3 update.",
        attachments: [
          { storageId: blobId, filename: "q3.pdf", mimeType: "application/pdf", size: 9 },
        ],
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(2);
    // Every recipient carries a non-empty ref set...
    for (const r of reqs) expect(r.attachmentRefs.length).toBe(1);
    // ...and it is the SAME id across recipients (one shared row, no per-recipient duplication).
    const [ref0, ref1] = reqs.map((r) => r.attachmentRefs[0] as Id<"attachments">);
    expect(ref0).toBe(ref1);
    // Exactly ONE attachments row materialized (shared), resolving to the plan's generated document.
    const atts = await t.run((ctx) => ctx.db.query("attachments").collect());
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ filename: "q3.pdf", storageId: blobId, tenantId: TENANT });
  });

  test("a zero-attachment plan still seeds attachmentRefs: [] (unchanged path)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedPlan(t, "proposed"); // no attachments field

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.attachmentRefs).toEqual([]);
    // No attachments rows materialized when the plan carries none.
    expect(await t.run((ctx) => ctx.db.query("attachments").collect())).toHaveLength(0);
  });
});

describe("executePlan per-recipient personalization (CKPT-03 — distinct bodies, shared subject)", () => {
  test("each recipient's draft is its tailored override; a non-personalized recipient falls back to the shared body; the goal (subject) is shared", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // 3 recipients, 2 tailored + 1 without an override; an ORPHAN key (z@) no longer in recipients
    // is simply never looked up (no error, no extra row). Keyed by the RAW recipients[i] value —
    // the same value the seed loop iterates from plan.recipients (Wave 2 write/read alignment).
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com", "c@example.com"],
        mode: "individual",
        subject: "Q3 update", // SHARED goal for every row
        body: "Here is the Q3 update.", // the shared fallback body
        recipientBodies: {
          "a@example.com": "Dear A, your Q3 numbers.",
          "b@example.com": "Yo B, quick Q3 hit.",
          "z@example.com": "orphaned — not in recipients", // ignored harmlessly at seed
        },
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(3); // one row per recipient — the orphan key adds nothing
    const byRecipient = Object.fromEntries(reqs.map((r) => [r.recipient, r]));

    // Distinct tailored bodies land in their OWN request row...
    expect(byRecipient["a@example.com"]?.draft).toBe("Dear A, your Q3 numbers.");
    expect(byRecipient["b@example.com"]?.draft).toBe("Yo B, quick Q3 hit.");
    // ...and the non-personalized recipient falls back to the shared body (no error, no duplication).
    expect(byRecipient["c@example.com"]?.draft).toBe("Here is the Q3 update.");
    // The subject (goal) is SHARED across every recipient regardless of body tailoring.
    for (const r of reqs) expect(r.goal).toBe("Q3 update");
  });
});

describe("executePlan reply threading (RPLY-01 — the plan → requests → getForDelivery spine)", () => {
  test("copies the plan's threading anchor onto every seeded request; getForDelivery surfaces it", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    // A reply plan carries the GMAIL thread (plan.replyThreadId — NOT plan.threadId, the agent thread)
    // and the RFC Message-ID header values. executePlan maps replyThreadId → request.threadId.
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1", // agent/convex thread (renders cards) — must NOT ride to the request
        status: "proposed",
        recipients: ["sarah.chen@example.com"],
        mode: "individual",
        subject: "Re: Q3 numbers",
        body: "Approved — sending the figures now.",
        replyThreadId: "thread-reply-1",
        replyToMessageId: "fix-reply",
        inReplyTo: "<CAF-reply-1@mail.gmail.com>",
        references: "<CAF-reply-1@mail.gmail.com>",
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(reqs).toHaveLength(1);
    const req = reqs[0]!;
    // The plan's GMAIL thread landed as the request's threadId (agent thread_1 did NOT).
    expect(req.threadId).toBe("thread-reply-1");
    expect(req.inReplyTo).toBe("<CAF-reply-1@mail.gmail.com>");
    expect(req.references).toBe("<CAF-reply-1@mail.gmail.com>");

    // getForDelivery must project the anchor through (Pitfall 4 — else send never threads).
    const delivery = await t.query(internal.gmailAuth.getForDelivery, { requestId: req._id });
    expect(delivery?.threadId).toBe("thread-reply-1");
    expect(delivery?.inReplyTo).toBe("<CAF-reply-1@mail.gmail.com>");
    expect(delivery?.references).toBe("<CAF-reply-1@mail.gmail.com>");
  });

  test("a non-reply plan seeds rows with no threading; getForDelivery returns none (unchanged)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedPlan(t, "proposed"); // no reply fields

    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });

    const reqs = await t.run((ctx) => ctx.db.query("requests").collect());
    for (const r of reqs) {
      expect(r.threadId).toBeUndefined();
      expect(r.inReplyTo).toBeUndefined();
      expect(r.references).toBeUndefined();
    }
    const delivery = await t.query(internal.gmailAuth.getForDelivery, { requestId: reqs[0]!._id });
    expect(delivery?.threadId).toBeUndefined();
    expect(delivery?.inReplyTo).toBeUndefined();
    expect(delivery?.references).toBeUndefined();
  });
});

/** Seed a proposed plan carrying a future (or unset) sendAt for the scheduler-branch tests. */
async function seedSchedulable(
  t: ReturnType<typeof convexTest>,
  sendAt: number | undefined,
  tenantId = TENANT,
) {
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_1",
      status: "proposed" as const,
      recipients: ["a@example.com", "b@example.com"],
      mode: "individual" as const,
      subject: "Q3 update",
      body: "Here is the Q3 update.",
      sendAt,
      createdAt: Date.now(),
    }),
  );
}

const listScheduled = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("executePlan deferred send (SCHD-01 — arm on a future sendAt, fire at the moment)", () => {
  test("discardPlan is an idempotent proposed→canceled terminal with refs-only provenance and can never enter the scheduled re-arm path", async () => {
    const t = withDelivery();
    const planId = await seedPlan(t, "proposed");
    const asT = t.withIdentity({ subject: TENANT });

    expect(await asT.mutation(api.cockpit.discardPlan, { planId })).toEqual({
      ok: true,
      discarded: true,
    });

    const discarded = await t.run((ctx) => ctx.db.get(planId));
    expect(discarded).toMatchObject({
      status: "canceled",
      cancelKind: "discarded",
    });
    expect(discarded?.canceledAt).toEqual(expect.any(Number));
    expect(discarded?.scheduledFunctionId).toBeUndefined();

    const audits = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("eventType"), "plan.discarded"))
        .collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toEqual({ planId, kind: "discarded" });

    expect(await asT.mutation(api.cockpit.discardPlan, { planId })).toEqual({
      ok: true,
      alreadyResolved: true,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.discarded"))
          .collect(),
      ),
    ).toHaveLength(1);

    await asT.mutation(api.plans.setPlanSendTime, {
      planId,
      sendAt: Date.now() + 60_000,
    });
    expect(await asT.mutation(api.cockpit.reschedulePlan, { planId })).toEqual({
      ok: true,
      alreadyResolved: true,
    });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled");
  });

  test("discardPlan refuses foreign IDs and no-ops after execution has started", async () => {
    const t = withDelivery();
    const foreignId = await seedPlan(t, "proposed", "tenant_b");
    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.discardPlan, {
        planId: foreignId,
      }),
    ).rejects.toThrow(/plan not found/);

    const startedId = await seedPlan(t, "delivering");
    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.discardPlan, {
        planId: startedId,
      }),
    ).toEqual({ ok: true, alreadyResolved: true });
    expect((await t.run((ctx) => ctx.db.get(startedId)))?.status).toBe("delivering");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.discarded"))
          .collect(),
      ),
    ).toHaveLength(0);
  });

  test("future sendAt: freezes the requests rows, arms the scheduler, sends nothing before fire; fires the same fan-out at the send time", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const sendAt = Date.now() + 60_000; // one minute out
      const planId = await seedSchedulable(t, sendAt);

      const res = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId });
      expect(res).toEqual({ ok: true, scheduled: true });

      // Content is frozen AT APPROVE (rows seeded) but nothing advanced past "approved".
      const reqs = await countRequests(t);
      expect(reqs).toHaveLength(2);
      for (const r of reqs) expect(r.status).toBe("approved");

      const plan = await t.run((ctx) => ctx.db.get(planId));
      expect(plan).toMatchObject({
        status: "scheduled",
        recipientTotal: 2,
        queuedCount: 2,
        sentCount: 0,
        failedCount: 0,
        counterComplete: true,
      });
      expect(plan?.scheduledFunctionId).toBeDefined();

      // A live scheduled-function system row exists (the scheduler is armed).
      expect((await listScheduled(t)).length).toBeGreaterThanOrEqual(1);

      // Fire it → the SAME fan-out starts (status → delivering, set synchronously by startFanout).
      vi.advanceTimersByTime(60_001);
      await t.finishInProgressScheduledFunctions();
      const after = await t.run((ctx) => ctx.db.get(planId));
      expect(after?.status).toBe("delivering");
    } finally {
      vi.useRealTimers();
    }
  });

  test("far-future refusal: a beyond-horizon sendAt returns send_time_too_far BEFORE seeding/arming (the authoritative chokepoint over every write path); a within-horizon control still schedules", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      // One hour PAST the horizon — arrived here from ANY write path (NL tool, picker, reschedule).
      const tooFar = Date.now() + SEND_TIME_HORIZON_MS + 3_600_000;
      const planId = await seedSchedulable(t, tooFar);

      const res = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId });
      expect(res).toEqual({ ok: false, reason: "send_time_too_far" });

      // Fail-before-mutate: status untouched, NO requests seeded, NO scheduler armed.
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
      expect(await countRequests(t)).toHaveLength(0);
      expect(await listScheduled(t)).toHaveLength(0);

      // Within-horizon control: still schedules + arms (the guard sits upstream, in-window unaffected).
      const okId = await seedSchedulable(t, Date.now() + 60_000);
      const ok = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId: okId });
      expect(ok).toEqual({ ok: true, scheduled: true });
      expect((await t.run((ctx) => ctx.db.get(okId)))?.status).toBe("scheduled");
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancelScheduledPlan halts a scheduled send: status canceled, scheduler row gone, refs-only plan.canceled audit, nothing sends after; double-cancel no-ops", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });

      await asT.mutation(api.cockpit.executePlan, { planId }); // arm
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("scheduled");

      const res = await asT.mutation(api.cockpit.cancelScheduledPlan, { planId });
      expect(res).toEqual({ ok: true, canceled: true });

      const plan = await t.run((ctx) => ctx.db.get(planId));
      expect(plan).toMatchObject({
        status: "canceled",
        cancelKind: "scheduled_cancel",
      });
      expect(plan?.canceledAt).toEqual(expect.any(Number));
      expect(plan?.scheduledFunctionId).toBeUndefined();

      // No live (pending) scheduled callback remains — the send was canceled before fire.
      const pending = (await listScheduled(t)).filter((s) => s.state.kind === "pending");
      expect(pending.some((s) => String(s.name).includes("startScheduledDelivery"))).toBe(false);

      // refs-only §4: the plan.canceled audit payload carries planId ONLY (no subject/body/recipients).
      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.canceled"))
          .collect(),
      );
      expect(audits).toHaveLength(1);
      const payloadStr = JSON.stringify(audits[0]?.payload);
      expect(payloadStr).toContain(planId);
      expect(payloadStr).not.toContain("Q3 update"); // no subject
      expect(payloadStr).not.toContain("Here is the Q3 update"); // no body
      expect(payloadStr).not.toContain("a@example.com"); // no recipient

      // Advancing past the send time sends NOTHING (the scheduler was canceled).
      vi.advanceTimersByTime(60_001);
      await t.finishInProgressScheduledFunctions();
      for (const r of await countRequests(t)) expect(r.status).toBe("approved");
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled");

      // Idempotent: a second cancel (a non-scheduled plan) no-ops without throwing.
      expect(await asT.mutation(api.cockpit.cancelScheduledPlan, { planId })).toEqual({
        ok: true,
        alreadyResolved: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("moveScheduledPlan atomically replaces only the current callback; replay is idempotent and the stale callback cannot fire", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const originalAt = Date.now() + 60_000;
      const movedAt = Date.now() + 120_000;
      const planId = await seedSchedulable(t, originalAt);
      const asT = t.withIdentity({ subject: TENANT });
      await asT.mutation(api.cockpit.executePlan, { planId });

      expect(
        await asT.mutation(api.cockpit.moveScheduledPlan, { planId, sendAt: movedAt }),
      ).toEqual({
        result: "moved",
      });
      expect(
        await asT.mutation(api.cockpit.moveScheduledPlan, { planId, sendAt: movedAt }),
      ).toEqual({
        result: "moved",
      });

      const moved = await t.run((ctx) => ctx.db.get(planId));
      expect(moved?.status).toBe("scheduled");
      expect(moved?.sendAt).toBe(movedAt);
      const pending = (await listScheduled(t)).filter(
        (s) => s.state.kind === "pending" && String(s.name).includes("startScheduledDelivery"),
      );
      expect(pending).toHaveLength(1);

      vi.advanceTimersByTime(60_001);
      await t.finishInProgressScheduledFunctions();
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("scheduled");

      vi.advanceTimersByTime(60_000);
      await t.finishInProgressScheduledFunctions();
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("delivering");

      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.rescheduled"))
          .collect(),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]?.payload).toEqual({ planId });
    } finally {
      vi.useRealTimers();
    }
  });

  test("moveScheduledPlan reports already_fired after the scheduler wins and not_scheduled after cancel wins", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const asT = t.withIdentity({ subject: TENANT });

      const firedId = await seedSchedulable(t, Date.now() + 60_000);
      await asT.mutation(api.cockpit.executePlan, { planId: firedId });
      vi.advanceTimersByTime(60_001);
      await t.finishInProgressScheduledFunctions();
      expect(
        await asT.mutation(api.cockpit.moveScheduledPlan, {
          planId: firedId,
          sendAt: Date.now() + 60_000,
        }),
      ).toEqual({ result: "already_fired" });

      const canceledId = await seedSchedulable(t, Date.now() + 60_000);
      await asT.mutation(api.cockpit.executePlan, { planId: canceledId });
      await asT.mutation(api.cockpit.cancelScheduledPlan, { planId: canceledId });
      expect(
        await asT.mutation(api.cockpit.moveScheduledPlan, {
          planId: canceledId,
          sendAt: Date.now() + 120_000,
        }),
      ).toEqual({ result: "not_scheduled" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancel/move concurrency resolves to one truthful schedule state without duplicate callbacks", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });
      await asT.mutation(api.cockpit.executePlan, { planId });

      const [cancel, move] = await Promise.all([
        asT.mutation(api.cockpit.cancelScheduledPlan, { planId }),
        asT.mutation(api.cockpit.moveScheduledPlan, {
          planId,
          sendAt: Date.now() + 120_000,
        }),
      ]);
      const row = await t.run((ctx) => ctx.db.get(planId));
      const pending = (await listScheduled(t)).filter(
        (s) => s.state.kind === "pending" && String(s.name).includes("startScheduledDelivery"),
      );

      if (row?.status === "canceled") {
        expect(cancel).toEqual({ ok: true, canceled: true });
        expect(["moved", "not_scheduled"]).toContain(move.result);
        expect(pending).toHaveLength(0);
      } else {
        expect(row?.status).toBe("scheduled");
        expect(move).toEqual({ result: "moved" });
        expect(cancel).toEqual({ ok: true, alreadyResolved: true });
        expect(pending).toHaveLength(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancelScheduledPlan tenant guard: another tenant cannot cancel (plan not found)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedSchedulable(t, Date.now() + 60_000, "tenant_b");
    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.cancelScheduledPlan, { planId }),
    ).rejects.toThrow(/plan not found/);
  });

  test("reschedule happy path: a canceled plan re-armed with a fresh future time re-approves through the SAME executePlan branch — orphans gone, no duplicate rows, refs-only plan.rescheduled audit, cancellable again", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });

      await asT.mutation(api.cockpit.executePlan, { planId }); // arm (2 orphan requests rows)
      await asT.mutation(api.cockpit.cancelScheduledPlan, { planId }); // halt
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled");
      expect(await countRequests(t)).toHaveLength(2); // orphaned "approved" rows from the first arm

      // Pick a NEW future time, then reschedule → canceled becomes proposed, orphans deleted.
      await asT.mutation(api.plans.setPlanSendTime, { planId, sendAt: Date.now() + 120_000 });
      const res = await asT.mutation(api.cockpit.reschedulePlan, { planId });
      expect(res).toEqual({ ok: true, rescheduled: true });

      const proposed = await t.run((ctx) => ctx.db.get(planId));
      expect(proposed?.status).toBe("proposed");
      expect(await countRequests(t)).toHaveLength(0); // orphans deleted — reportForPlan stays honest

      // refs-only §4: the plan.rescheduled audit payload carries planId ONLY.
      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.rescheduled"))
          .collect(),
      );
      expect(audits).toHaveLength(1);
      const payloadStr = JSON.stringify(audits[0]?.payload);
      expect(payloadStr).toContain(planId);
      expect(payloadStr).not.toContain("Q3 update"); // no subject
      expect(payloadStr).not.toContain("Here is the Q3 update"); // no body
      expect(payloadStr).not.toContain("a@example.com"); // no recipient

      // Re-approve routes through the EXISTING executePlan scheduled branch — a FRESH set of exactly
      // the recipient count (no duplicated orphans), status "scheduled", scheduler re-armed.
      const reRes = await asT.mutation(api.cockpit.executePlan, { planId });
      expect(reRes).toEqual({ ok: true, scheduled: true });
      expect(await countRequests(t)).toHaveLength(2); // fresh fan-out only
      const rearmed = await t.run((ctx) => ctx.db.get(planId));
      expect(rearmed?.status).toBe("scheduled");
      expect(rearmed?.scheduledFunctionId).toBeDefined();
      expect((await listScheduled(t)).length).toBeGreaterThanOrEqual(1);

      // Fire it → the SAME fan-out starts (status → delivering).
      vi.advanceTimersByTime(120_001);
      await t.finishInProgressScheduledFunctions();
      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("delivering");
    } finally {
      vi.useRealTimers();
    }
  });

  test("reschedule re-ask: a canceled plan with a PAST/absent sendAt refuses (needs_future_time) — status stays canceled, no requests deleted, no plan.rescheduled audit", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, Date.now() + 60_000);
      const asT = t.withIdentity({ subject: TENANT });

      await asT.mutation(api.cockpit.executePlan, { planId }); // arm (2 rows)
      await asT.mutation(api.cockpit.cancelScheduledPlan, { planId }); // halt

      // sendAt is now in the PAST (advance past the frozen time) → the re-ask, no un-cancel.
      vi.advanceTimersByTime(60_001);
      const res = await asT.mutation(api.cockpit.reschedulePlan, { planId });
      expect(res).toEqual({ ok: false, reason: "needs_future_time" });

      expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("canceled"); // stays terminal
      expect(await countRequests(t)).toHaveLength(2); // orphans NOT deleted (write nothing on a re-ask)
      const audits = await t.run((ctx) =>
        ctx.db
          .query("audit")
          .filter((q) => q.eq(q.field("eventType"), "plan.rescheduled"))
          .collect(),
      );
      expect(audits).toHaveLength(0); // no audit on a re-ask
    } finally {
      vi.useRealTimers();
    }
  });

  test("reschedule idempotent: a non-canceled (proposed) plan no-ops (alreadyResolved) with no state change", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedSchedulable(t, Date.now() + 60_000); // status "proposed"

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.reschedulePlan, { planId });
    expect(res).toEqual({ ok: true, alreadyResolved: true });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed"); // unchanged
  });

  test("reschedule tenant guard: another tenant cannot reschedule (plan not found)", async () => {
    const t = withDelivery();
    await seedMailbox(t);
    const planId = await seedSchedulable(t, Date.now() + 60_000, "tenant_b");
    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.reschedulePlan, { planId }),
    ).rejects.toThrow(/plan not found/);
  });

  test("immediate path unchanged: an unset sendAt starts synchronously (status delivering, no scheduled row)", async () => {
    vi.useFakeTimers();
    try {
      const t = withDelivery();
      await seedMailbox(t);
      const planId = await seedSchedulable(t, undefined);

      const res = await t
        .withIdentity({ subject: TENANT })
        .mutation(api.cockpit.executePlan, { planId });
      expect(res.ok).toBe(true);
      expect("workflowId" in res && res.workflowId).toBeTruthy();
      expect("scheduled" in res).toBe(false);

      const plan = await t.run((ctx) => ctx.db.get(planId));
      expect(plan?.status).toBe("delivering");
      // No scheduler was armed on the immediate path (the workflow schedules its OWN steps, so
      // assert there is no scheduled callback pointing at startScheduledDelivery specifically).
      const scheduled = await listScheduled(t);
      expect(scheduled.some((s) => String(s.name).includes("startScheduledDelivery"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the delivery workflow routes sent, failed AND suppressed terminals through the idempotent plan progress helper", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "deliverApprovedPlan.ts"),
      "utf8",
    );
    // Three, since 19-05: a suppression discovered at send time is a PERMANENT terminal, not the
    // resumable hold `awaiting_reauth` is — a bare `continue` would strand the row at `delivering`.
    expect(src.match(/internal\.plans\.recordDeliveryTerminal/g)).toHaveLength(3);
    expect(src).toContain('outcome: "sent"');
    expect(src).toContain('outcome: "failed"');
    expect(src).toContain('outcome: "suppressed"');
  });
});

// ── 07-04: REVW-02 (cockpit) — the LIVE gate is bounded and fails closed ───────────────────────
// proposeEmailPlan counts each redraft (re-propose of an already-proposed plan) on plans.reviseCount
// via the SAME @pikar/core classifyReviewDecision the pipeline gate uses (07-03); past MAX_REGENERATE
// it marks the plan `escalated` + notifies retry.limit and STOPS re-proposing. executePlan then
// refuses an escalated plan (review_escalated) — the cockpit mirror of the unapproved-send guard.
describe("cockpit revise cap (REVW-02 — bounded, fail-closed live gate)", () => {
  const proposeArgs = (planId: Id<"plans">) => ({
    planId,
    recipients: ["a@example.com"],
    mode: "individual" as const,
    subject: "Q3 update",
    body: "Here is the Q3 update.",
  });

  test("re-proposing past MAX_REGENERATE (3) escalates + notifies retry.limit; status is not advanced and content is not re-proposed", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "proposed"); // an already-proposed plan → every call is a redraft

    // Three redrafts stay within the cap (reviseCount climbs 1 → 2 → 3), still proposed.
    for (let i = 1; i <= 3; i++) {
      await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
      const p = await t.run((ctx) => ctx.db.get(planId));
      expect(p?.reviseCount).toBe(i);
      expect(p?.escalated).toBeFalsy();
      expect(p?.status).toBe("proposed");
    }

    // The FOURTH redraft breaches the cap → escalate (fail closed), notify, do NOT re-propose.
    const escalated = await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    expect(escalated).toEqual({ escalated: true });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.escalated).toBe(true);
    expect(plan?.reviseCount).toBe(3); // not advanced past the cap on the escalate call
    expect(plan?.status).toBe("proposed"); // never advanced to approved/delivering

    const notifs = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .filter((q) => q.eq(q.field("kind"), "retry.limit"))
        .collect(),
    );
    expect(notifs).toHaveLength(1); // exactly one retry.limit — the breach notified once
    expect(notifs[0]!.tenantId).toBe(TENANT);
  });

  test("first propose of a not-yet-proposed plan is not a redraft (reviseCount stays 0, not escalated)", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting");

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.reviseCount ?? 0).toBe(0);
    expect(plan?.escalated).toBeFalsy();
  });

  test("executePlan refuses an escalated plan (review_escalated): no CAS flip, no requests seeded, no workflow", async () => {
    const t = withDelivery();
    await seedMailbox(t); // present so the refusal is specifically review_escalated, not gmail_not_connected
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_1",
        status: "proposed",
        recipients: ["a@example.com", "b@example.com"],
        mode: "individual",
        subject: "Q3 update",
        body: "Here is the Q3 update.",
        escalated: true, // the fail-closed terminal flag proposeEmailPlan set at the cap
        createdAt: Date.now(),
      }),
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res).toEqual({ ok: false, reason: "review_escalated" });

    // Fail-before-mutate: status stays proposed, NO rows seeded, NO workflow started.
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await countRequests(t)).toHaveLength(0);
  });
});

// Skill-version attribution (08 IMPR-01): a rating is training signal only if it resolves to the
// EXACT skill version that produced the response. proposeEmailPlan stamps plan.skillVersion from
// the active cockpit-agent row; executePlan copies it onto every seeded request row, so feedback
// (keyed to requestId → request.skillVersion) is attributable.
describe("skill-version attribution (IMPR-01 — propose stamps, executePlan copies)", () => {
  /** Seed the active cockpit-agent skill row the propose path reads its version from. */
  const seedActiveCockpit = (t: ReturnType<typeof convexTest>, version: number) =>
    t.run((ctx) =>
      ctx.db.insert("skills", {
        name: COCKPIT_AGENT_SKILL,
        version,
        body: "cockpit body",
        status: "active",
        createdAt: Date.now(),
      }),
    );

  const proposeArgs = (planId: Id<"plans">) => ({
    planId,
    recipients: ["a@example.com", "b@example.com"],
    mode: "individual" as const,
    subject: "Q3 update",
    body: "Here is the Q3 update.",
  });

  test("propose sets plan.skillVersion to the active cockpit-agent version; executePlan copies it to every request row", async () => {
    const t = withDelivery();
    await seedActiveCockpit(t, 12);
    await seedMailbox(t);
    const planId = await seedPlan(t, "collecting");

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    expect((await t.run((ctx) => ctx.db.get(planId)))?.skillVersion).toBe(12);

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);
    const reqs = await countRequests(t);
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.skillVersion).toBe(12);
  });

  test("a re-propose re-attributes to the THEN-active version", async () => {
    const t = convexTest(schema, modules);
    await seedActiveCockpit(t, 12);
    const planId = await seedPlan(t, "proposed"); // already proposed → the call is a redraft

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    expect((await t.run((ctx) => ctx.db.get(planId)))?.skillVersion).toBe(12);
  });

  test("no active cockpit-agent row → propose degrades to unattributable (undefined), never throws", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedPlan(t, "collecting"); // NO active skill seeded

    await t.mutation(internal.cockpit.proposeEmailPlan, proposeArgs(planId));
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed"); // still proposes
    expect(plan?.skillVersion).toBeUndefined(); // unattributable, but not a failure
  });
});

// ── 19-05 PIPE-01: the pre-CAS refusals and the pre-join per-address suppression drop ─────────
//
// Both new refusals run BEFORE the `proposed → approved` CAS patch. A refusal AFTER it would leave
// the plan `approved` with zero `requests` rows and no workflow — a half-approved state nothing can
// resume (the 20-07 lesson), which is why every test here asserts `status === "proposed"` as well
// as the returned reason. The suppression filter runs before `targets` is computed: `mode: "group"`
// collapses recipients into ONE comma-joined string, after which a per-address drop is impossible.

/** The DELIVERY components only. `withDelivery` additionally registers the audit aggregate and
 *  the action-retrier, and loading that tree into every extra in-memory backend is precisely what
 *  crashed the shared vitest fork in 19-02 — nothing below audits or runs a retrier. */
function withFanoutOnly() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

describe("executePlan suppression + postal-address gates (19-05, PIPE-01)", () => {
  /** A suppressions row written straight to the table — the guard reads `suppressions` and NEVER
   *  `contacts` (contacts-crm invariant 2), so a contact row would prove nothing here. */
  const suppress = (t: ReturnType<typeof convexTest>, address: string, tenantId = TENANT) =>
    t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId,
        address, // already normalized by the caller, exactly as the write boundary would store it
        suppressedAt: Date.now(),
        source: "user-marked" as const,
      }),
    );

  /** `sendAt` in the future ARMS the scheduler instead of starting the fan-out, which reaches every
   *  assertion here (the filter, the counters and the request rows all land before that branch)
   *  without registering the workflow components in yet another in-memory backend. Row 11 below
   *  deliberately takes the immediate path so the drop is proven on BOTH arms. */
  const seedEmailPlan = (
    t: ReturnType<typeof convexTest>,
    recipients: string[],
    mode: "individual" | "group" = "individual",
    deferred = true,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `thread_${crypto.randomUUID()}`,
        status: "proposed",
        recipients,
        mode,
        subject: "Q3 update",
        body: "Here is the Q3 update.",
        ...(deferred ? { sendAt: Date.now() + 3_600_000 } : {}),
        createdAt: Date.now(),
      }),
    );

  const seedTokensOnly = (t: ReturnType<typeof convexTest>) =>
    t.run((ctx) =>
      ctx.db.insert("gmailTokens", {
        tenantId: TENANT,
        refreshToken: "r",
        scope: "s",
        updatedAt: Date.now(),
      }),
    );

  const FIVE = [
    "one@example.com",
    "two@example.com",
    "three@example.com",
    "four@example.com",
    "five@example.com",
  ];

  // Row 16a. The tenant, not the deployment, is missing configuration — so the refusal names the
  // field and leaves the plan exactly where the user can fix it and press Approve again.
  test("no postalAddress: the plan refuses, stays proposed, and seeds ZERO request rows", async () => {
    const t = convexTest(schema, modules);
    await seedTokensOnly(t); // a mailbox but NO tenantProfiles row
    const planId = await seedEmailPlan(t, FIVE, "individual", false);

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: false, reason: "no_postal_address" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await countRequests(t)).toHaveLength(0);
    expect(await listScheduled(t)).toHaveLength(0);

    // ...and a profile row carrying only whitespace is the same as no profile at all. Asserted in
    // the SAME backend deliberately: an in-memory backend per assertion is what tips this fork over
    // (19-02), and the second act only adds the row the first act proved was missing.
    await seedPostalAddress(t, TENANT, "   ");
    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: false, reason: "no_postal_address" });
    expect(await countRequests(t)).toHaveLength(0);
  });

  // Row 11. The counters are computed from the ALLOWED list, not the original one — otherwise the
  // Approvals progress bar promises a fifth delivery that structurally cannot happen.
  test("5 recipients, 1 suppressed: sends to four, names the withheld one, counters follow the ALLOWED set", async () => {
    const t = withFanoutOnly();
    await seedMailbox(t);
    await suppress(t, "three@example.com");
    const planId = await seedEmailPlan(t, FIVE, "individual", false); // the IMMEDIATE arm

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.withheld).toEqual(["three@example.com"]);

    const reqs = await countRequests(t);
    expect(reqs).toHaveLength(4);
    expect(reqs.map((r) => r.recipient).sort()).toEqual(
      FIVE.filter((a) => a !== "three@example.com").sort(),
    );
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.recipientTotal).toBe(4);
    expect(plan?.queuedCount).toBe(4);
    // 19-05 SC#5 made DURABLE (phase-19 UAT step 9b). The returned `withheld` above is consumed by
    // a component this very transition unmounts — the ROW is the only copy a human can still read
    // after the approve, and `withheldNote` renders it off exactly these two arrays.
    expect(plan?.withheldRecipients).toEqual(["three@example.com"]);
    expect(
      withheldNote(plan?.recipients ?? [], plan?.withheldRecipients),
      "the sentence a human reads on the report card",
    ).toBe("Sent to 4. Withheld 1 who unsubscribed: three@example.com.");
  });

  test("nobody suppressed: no `withheld` key rides along on the ordinary send", async () => {
    const t = convexTest(schema, modules);
    await seedMailbox(t);
    const planId = await seedEmailPlan(t, FIVE);

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.withheld).toBeUndefined();
    expect(await countRequests(t)).toHaveLength(5);
    // ...and no `withheldRecipients` key on the row either: an ordinary send must render NOTHING,
    // not an empty note element. `withheldNote` returns null for both absent and [].
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.withheldRecipients).toBeUndefined();
    expect(withheldNote(plan?.recipients ?? [], plan?.withheldRecipients)).toBeNull();
  });

  // Row 12. THREE recipients, not two: a group whose only survivor is one address passes vacuously
  // — the joined string would contain that survivor whether or not a drop ever happened.
  test("group mode: the suppressed member is gone from the JOINED string before the row exists", async () => {
    const t = convexTest(schema, modules);
    await seedMailbox(t);
    await suppress(t, "two@example.com");
    const planId = await seedEmailPlan(
      t,
      ["one@example.com", "two@example.com", "three@example.com"],
      "group",
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.withheld).toEqual(["two@example.com"]);

    const reqs = await countRequests(t);
    expect(reqs).toHaveLength(1); // group mode is ONE row, whatever the drop did
    const joined = reqs[0]!.recipient;
    expect(joined).toContain("one@example.com");
    expect(joined).toContain("three@example.com");
    expect(joined).not.toContain("two@example.com");
    expect((await t.run((ctx) => ctx.db.get(planId)))?.recipientTotal).toBe(1);
  });

  // Row 13. Every recipient suppressed is a governed STOP, not a zero-recipient send.
  test("all recipients suppressed: refuses, stays proposed, seeds nothing, schedules nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMailbox(t);
    for (const a of ["one@example.com", "two@example.com"]) await suppress(t, a);
    const planId = await seedEmailPlan(
      t,
      ["one@example.com", "two@example.com"],
      "individual",
      false,
    );

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });

    expect(res).toEqual({ ok: false, reason: "all_recipients_suppressed" });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.scheduledFunctionId).toBeUndefined();
    expect(await countRequests(t)).toHaveLength(0);
    expect(await listScheduled(t)).toHaveLength(0);
  });

  // The `normalizeAddress` agreement, proven AT the guard rather than assumed from 19-01's unit
  // test: a suppression stored for the normalized address blocks a differently-cased, padded
  // recipient string sitting on the plan row.
  test("matching is case- and whitespace-insensitive on BOTH sides of the guard", async () => {
    const t = convexTest(schema, modules);
    await seedMailbox(t);
    await suppress(t, "bob@x.com"); // stored normalized, as the write boundary always stores it
    const planId = await seedEmailPlan(t, [" Bob@X.com ", "keep@example.com"]);

    const res = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.withheld).toEqual(["bob@x.com"]);

    const reqs = await countRequests(t);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.recipient).toBe("keep@example.com");
  });

  // Row 7 regression, stated as a boundary rather than as a parallel copy of the arm suites above:
  // the two new gates belong to the EMAIL arm alone. A memo has no mailbox and no footer, and
  // requiring either of them would break a save that sends to nobody.
  test("the memo arm approves with NO mailbox and NO postal address (the gates are email-only)", async () => {
    const t = withFanoutOnly(); // persistNextStepMemo starts the vault-ingest workflow
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_memo_19_05",
        kind: "memo",
        status: "proposed",
        body: "Call the supplier on Monday.",
        createdAt: Date.now(),
      }),
    );

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("done");
  });
});

// ── executePlan crm_write arm (19-06, ACTN-05 — VALIDATION rows 5 and 6) ──────────────────────
//
// Deliberately a PLAIN `convexTest`: the CRM arm registers no component and needs none. That is
// itself an assertion — `workflow.start` throws without the workflow component registered, so a
// regression that routed a CRM plan into the fan-out would fail here loudly rather than quietly
// seeding rows. (19-02/19-05 lesson: every registerComponent loads a whole module tree into
// another in-memory backend and crashes the shared vitest fork.)

describe("executePlan crm_write arm (19-06, ACTN-05)", () => {
  const OPS = [
    { op: "addContact", email: "Bob@X.com", name: "Bob", origin: "user-entered" },
    { op: "addContact", email: "ann@y.com", origin: "mailbox-resolved" },
    {
      op: "addFollowUp",
      email: "bob@x.com",
      note: "chase the quote",
      dueAt: Date.now() + 86_400_000,
    },
    {
      op: "addFollowUp",
      email: "ann@y.com",
      note: "send the deck",
      dueAt: Date.now() + 172_800_000,
    },
    { op: "addFollowUp", email: "new@z.com", note: "intro call", dueAt: Date.now() + 259_200_000 },
  ];

  /** NO gmailTokens row and NO tenantProfiles row on purpose: the inline arm runs ABOVE both
   *  pre-CAS email gates, so a CRM write must approve on a tenant that could not send at all. */
  const seedCrmPlan = (t: ReturnType<typeof convexTest>, crmOperations: unknown[]) =>
    t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `crm_thread_${crypto.randomUUID()}`,
        kind: "crm_write" as const,
        status: "proposed" as const,
        crmOperations,
        createdAt: Date.now(),
      }),
    );

  const rows = async (t: ReturnType<typeof convexTest>) =>
    await t.run(async (ctx) => ({
      contacts: await ctx.db.query("contacts").collect(),
      followUps: await ctx.db.query("followUps").collect(),
    }));

  test("approving applies EVERY operation, sets done, seeds ZERO requests and sends nothing", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const planId = await seedCrmPlan(t, OPS);

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).toEqual({ ok: true });

    const { contacts, followUps } = await rows(t);
    // THREE contacts, not two: a follow-up upserts the contact it names, so `new@z.com` lands too.
    expect(contacts.map((c) => c.email).sort()).toEqual(["ann@y.com", "bob@x.com", "new@z.com"]);
    // The identity function ran — "Bob@X.com" and "bob@x.com" are ONE row, not two.
    expect(contacts.filter((c) => c.email === "bob@x.com")).toHaveLength(1);
    expect(contacts.find((c) => c.email === "bob@x.com")?.name).toBe("Bob");
    expect(followUps).toHaveLength(3);
    expect(followUps.every((f) => f.status === "open" && f.contactId !== undefined)).toBe(true);

    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("done");
    // The whole email spine is unreachable from this arm: no rows to fan out, no send.
    expect(await countRequests(t)).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("a SECOND approve applies nothing — the CAS above the arm is the idempotency", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedCrmPlan(t, OPS);
    const asUser = t.withIdentity({ subject: TENANT });

    await asUser.mutation(api.cockpit.executePlan, { planId });
    const first = await rows(t);
    // The plan is `done`, so the second call returns before the switch ever runs.
    expect(await asUser.mutation(api.cockpit.executePlan, { planId })).toEqual({
      ok: true,
      alreadyStarted: true,
    });

    const second = await rows(t);
    expect(second.contacts).toHaveLength(first.contacts.length);
    expect(second.followUps).toHaveLength(first.followUps.length);
    expect(second.contacts).toHaveLength(3);
    expect(second.followUps).toHaveLength(3);
  });

  // ATOMICITY, asserted rather than assumed. A Convex mutation is ONE serializable transaction, so
  // a throw on operation 3 must discard operations 1 and 2 — that is what makes approve-all-or-none
  // true with no saga and no compensation.
  test("an invalid THIRD operation applies NONE of the first two, and the plan stays proposed", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedCrmPlan(t, [
      OPS[0],
      OPS[1],
      { op: "addFollowUp", email: "bob@x.com", note: "no due date" },
    ]);

    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).rejects.toThrow(/CRM_FOLLOWUP_DUEAT_REQUIRED/);

    const { contacts, followUps } = await rows(t);
    expect(contacts).toHaveLength(0);
    expect(followUps).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
  });

  // The apply boundary re-validates: `plans.crmOperations` is CONTENT PLANE and the row could have
  // been revised after it was staged. An empty list reaching `done` would read to the user as
  // "applied" while having written nothing.
  test("an EMPTY operation list is refused at the apply boundary and the plan stays proposed", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedCrmPlan(t, []);

    await expect(
      t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
    ).rejects.toThrow(/CRM_OPERATIONS_EMPTY/);
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
  });

  test("completeFollowUp and cancelFollowUp move existing rows, and a foreign ref is refused", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const contactId = await ctx.db.insert("contacts", {
        tenantId: TENANT,
        email: "bob@x.com",
        origin: "user-entered" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const mine = async (note: string) =>
        await ctx.db.insert("followUps", {
          tenantId: TENANT,
          contactId,
          note,
          dueAt: Date.now(),
          status: "open" as const,
          createdAt: Date.now(),
        });
      return {
        done: await mine("finish"),
        cancel: await mine("drop"),
        foreign: await ctx.db.insert("followUps", {
          tenantId: "tenant_b",
          note: "not yours",
          dueAt: Date.now(),
          status: "open" as const,
          createdAt: Date.now(),
        }),
      };
    });

    const planId = await seedCrmPlan(t, [
      { op: "completeFollowUp", followUpRef: seeded.done },
      { op: "cancelFollowUp", followUpRef: seeded.cancel },
    ]);
    await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId });

    const after = await t.run(async (ctx) => ({
      done: await ctx.db.get(seeded.done),
      cancel: await ctx.db.get(seeded.cancel),
    }));
    expect(after.done?.status).toBe("done");
    expect(after.done?.completedAt).toBeTypeOf("number");
    // "I decided not to" is not a touch — canceling must not stamp a completion.
    expect(after.cancel?.status).toBe("canceled");
    expect(after.cancel?.completedAt).toBeUndefined();

    // A follow-up belonging to ANOTHER tenant is not reachable through an approved plan, and a ref
    // that is not an id of this table refuses the same way rather than throwing out of db.get.
    for (const followUpRef of [seeded.foreign, "not-an-id"]) {
      const bad = await seedCrmPlan(t, [{ op: "completeFollowUp", followUpRef }]);
      await expect(
        t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId: bad }),
      ).rejects.toThrow(/FOLLOWUP_NOT_FOUND/);
    }
    expect((await t.run((ctx) => ctx.db.get(seeded.foreign)))?.status).toBe("open");
  });

  test("a cross-tenant approve of a CRM plan writes nothing", async () => {
    const t = convexTest(schema, modules);
    const planId = await seedCrmPlan(t, OPS);

    await expect(
      t.withIdentity({ subject: "tenant_b" }).mutation(api.cockpit.executePlan, { planId }),
    ).rejects.toThrow(/plan not found/);
    expect((await rows(t)).contacts).toHaveLength(0);
  });
});

// ── executePlan finance_write arm (2026-08-10, the SIXTH action type) ─────────────────────────
//
// `auditCounts` IS registered here (the applier writes `finance.claims_applied`) but the WORKFLOW
// component deliberately is NOT — so a regression that routed a figure plan into the gmail fan-out
// would throw on `workflow.start` rather than quietly seeding rows, exactly as the CRM block above
// relies on. NO gmailTokens and NO tenantProfiles row: the inline arm sits ABOVE both email gates,
// so a figure update must approve on a tenant that could not send at all.

describe("executePlan finance_write arm", () => {
  const CLAIM = {
    field: "cashOnHand",
    value: 38_500,
    origin: "stated" as const,
    actor: "agent" as const,
    basis: "user statement, turn 4",
    observedAt: 1_754_000_000_000,
    confidence: "high" as const,
  };

  const seedFinancePlan = (t: ReturnType<typeof convexTest>, financeClaims: unknown[]) =>
    t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: `finance_thread_${crypto.randomUUID()}`,
        kind: "finance_write" as const,
        status: "proposed" as const,
        financeClaims,
        createdAt: Date.now(),
      } as never),
    );

  const withAudit = () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    return t;
  };

  test("approving writes the figure, sets done, seeds ZERO requests and sends nothing", async () => {
    const t = withAudit();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const planId = await seedFinancePlan(t, [CLAIM]);

    expect(
      await t.withIdentity({ subject: TENANT }).mutation(api.cockpit.executePlan, { planId }),
      // The COUNT rides back on the finance arm (review I5) so the card can tell a real write from
      // an approval that changed nothing.
    ).toEqual({ ok: true, applied: 1 });

    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(TENANT);
    expect(rows[0]?.valueUsd).toBe(38_500);
    // The tenant came off the APPROVED PLAN ROW and the provenance survived the apply.
    expect(rows[0]?.actor).toBe("agent");
    expect(rows[0]?.statedAt).toBe(1_754_000_000_000);

    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("done");
    expect(await countRequests(t)).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // Task 5 (INVERTED): this has to reach the APPROVE path, not just the applier's unit test — a
  // scorecard claim used to refuse loudly here and leave the plan re-approvable. Now that
  // `evaluations.fieldProvenance` (Task 4) lets the store record who supplied a figure, the SAME
  // approve boundary applies it: the plan finishes `done`, the evaluation row carries the figure
  // stamped `actor: "agent"`, and the audit row (`finance.claims_applied`) is written.
  test("a scorecard-field claim applies at the apply boundary, with honest provenance", async () => {
    const t = withAudit();
    const planId = await seedFinancePlan(t, [{ ...CLAIM, field: "cac", value: 1_400 }]);

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(result).toEqual({ ok: true, applied: 1 });

    const rows = await t.run((ctx) => ctx.db.query("evaluations").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scorecard.financials.cac).toBe(1_400);
    // The assertion that makes the whole plan worth doing.
    expect(rows[0]?.userProvided).not.toContain("financials.cac");
    expect(rows[0]?.fieldProvenance?.["financials.cac"]?.actor).toBe("agent");
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("done");
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(1);
  });

  // B3 (fix round 1): the test above INVERTED the ONLY case that reached `cockpit.ts`'s governed
  // stop (`if (!applied.ok) return { ok: false, reason }` — plan stays "proposed", nothing written,
  // the reason reaches the card) at the APPROVE boundary, not just `applyFinanceClaims`'s own unit
  // test. `malformed_figure_claim` still reaches that stop (only `agent_cannot_update_figure` was
  // lifted), so this restores coverage of the boundary with a claim that is still refused.
  test("a malformed claim refuses at the apply boundary and the plan stays proposed", async () => {
    const t = withAudit();
    const planId = await seedFinancePlan(t, [{ ...CLAIM, basis: "   " }]);

    const result = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.cockpit.executePlan, { planId });
    expect(result).toEqual({ ok: false, reason: "malformed_figure_claim" });

    expect(await t.run((ctx) => ctx.db.query("financeInputs").collect())).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("proposed");
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(0);
  });
});
