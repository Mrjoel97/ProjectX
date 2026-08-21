// 25.1-02 (D3/D4) — the stuck-work watchdog sweep, convex-test.
//
// The two sweeps are driven DIRECTLY as the internal mutations `migrations.define` returns, in
// the documented one-off mode ({ cursor: null, oneBatchOnly: true }) — one batch runs
// synchronously with no component round-trip (the vaultSweep.test.ts idiom). The migrations
// component is registered anyway so the module graph loads clean.
//
// Fake timers throughout, for two reasons: `notifications.notify` schedules
// `notifyExternal.dispatch` (runAfter 0) which must never fire against a torn-down module runner,
// and every staleness threshold is asserted against a FROZEN clock so boundary cases are exact.
//
// Reason strings are asserted EXACTLY, per state class — transposing any two watchdog reasons
// must redden a test (the phase-19.1 transposition rule: swap, don't delete).

import retrierTest from "@convex-dev/action-retrier/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  CAPTION_STALL_MS,
  COLLECTING_FALLBACK_BODY,
  COLLECTING_STALL_MS,
  RENDER_STALL_MS,
  SUBMITTED_STALL_MS,
  WATCHDOG_CAPTION_REASON,
  WATCHDOG_JOB_REASON,
  WATCHDOG_NOTIFY_KIND,
  WATCHDOG_NOTIFY_MESSAGE,
  WATCHDOG_RENDER_REASON,
} from "./reliabilitySweep";
import schema from "./schema";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  // The arming-gate test stubs RELIABILITY_SWEEP_ARMED; without this the last stub ("1") outlives
  // it and any later test that walks into `runSweep` would silently be testing an ARMED sweep.
  vi.unstubAllEnvs();
});

// Raw sources for the cron-registration scan (the `worm.test.ts` idiom — edge-runtime has no
// node:fs, so Vite's raw loader is how a test reads a sibling module's text).
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const migrationsModules = import.meta.glob(
  "../node_modules/@convex-dev/migrations/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;

function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("migrations", migrationsSchema, migrationsModules);
  // `landResult`'s failure arm writes an audit line, and audit.log mirrors every insert into the
  // auditCounts aggregate (the media.test.ts registration pair). The retrier is registered because
  // `evaluateRenderTrigger`'s success arm schedules renders through it.
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  retrierTest.register(t);
  return t;
}

const A = "tenant_sweep_a";

/** One synchronous batch of the mediaJobs sweep (documented one-off mode). */
const runJobSweep = (t: T) =>
  t.mutation(internal.reliabilitySweep.sweepStuckMediaJobs, {
    cursor: null,
    batchSize: 100,
    dryRun: false,
    oneBatchOnly: true,
  });

/** One synchronous batch of the plans sweep. */
const runPlanSweep = (t: T) =>
  t.mutation(internal.reliabilitySweep.sweepStuckPlans, {
    cursor: null,
    batchSize: 100,
    dryRun: false,
    oneBatchOnly: true,
  });

const seedPlan = (t: T, fields: Partial<Doc<"plans">> = {}): Promise<Id<"plans">> =>
  t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: A,
      threadId: fields.threadId ?? "thread_sweep",
      status: "proposed",
      createdAt: Date.now(),
      ...fields,
    } as Doc<"plans">),
  );

const seedJob = (
  t: T,
  planId: Id<"plans">,
  fields: Partial<Doc<"mediaJobs">> = {},
): Promise<Id<"mediaJobs">> =>
  t.run((ctx) =>
    ctx.db.insert("mediaJobs", {
      tenantId: A,
      planId,
      batchId: "batch_1",
      blockIndex: 0,
      provider: "openai",
      kind: "video",
      model: "sora-2",
      spec: { kind: "video", resolution: "720p", seconds: 4 },
      promptHash: "hash",
      status: "submitted",
      estUsd: 0.1,
      createdAt: Date.now() - 2 * SUBMITTED_STALL_MS,
      updatedAt: Date.now() - 2 * SUBMITTED_STALL_MS,
      ...fields,
    } as Doc<"mediaJobs">),
  );

const watchdogNotifications = (t: T, tenantId = A) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter(
      (n) => n.tenantId === tenantId && n.kind === WATCHDOG_NOTIFY_KIND,
    ),
  );

const getPlan = (t: T, planId: Id<"plans">) => t.run((ctx) => ctx.db.get(planId));
const getJob = (t: T, jobId: Id<"mediaJobs">) => t.run((ctx) => ctx.db.get(jobId));

test("the four thresholds are the pinned constants", () => {
  expect(SUBMITTED_STALL_MS).toBe(45 * 60_000);
  expect(RENDER_STALL_MS).toBe(60 * 60_000);
  expect(CAPTION_STALL_MS).toBe(30 * 60_000);
  expect(COLLECTING_STALL_MS).toBe(30 * 60_000);
});

// TRANSPOSITION HARDENING (phase 19.1 — swap, don't delete). The four reason strings are asserted
// EXACTLY at each terminal below; this pins that they are four DISTINCT strings, so a swap between
// two state classes cannot be absorbed by a shared literal.
test("each state class carries its OWN reason code", () => {
  const codes = [WATCHDOG_JOB_REASON, WATCHDOG_RENDER_REASON, WATCHDOG_CAPTION_REASON];
  expect(new Set(codes).size).toBe(codes.length);
});

// THE SWEEP IS ONLY REAL IF SOMETHING RUNS IT. Every behaviour below is driven by hand, so without
// this scan the whole suite could stay green while the watchdog never fires in production once —
// the `crons.ts registers worm-export` idiom (worm.test.ts), for the same reason.
describe("the cron actually registers the sweep", () => {
  const cronsSrc = (): string => {
    const entry = Object.entries(sources).find(([p]) => p.endsWith("/crons.ts"));
    if (!entry) throw new Error("missing convex source: crons.ts");
    return entry[1];
  };

  test("crons.ts runs reliability-sweep on an interval against internal.reliabilitySweep.runSweep", () => {
    const s = cronsSrc();
    expect(s).toMatch(/\.interval\(\s*["']reliability-sweep["']/);
    expect(s).toMatch(/\{\s*minutes:\s*30\s*\}/);
    expect(s).toMatch(/internal\.reliabilitySweep\.runSweep/);
  });

  // The cron is registered and fires; the ARMING GATE decides whether it writes. Both arms are
  // asserted because "ships dormant" is a claim about production behaviour, and an unproven guard
  // is exactly the vacuous pattern this phase kept finding (25.1-02, -03, -05, -06).
  test("runSweep is DORMANT unless RELIABILITY_SWEEP_ARMED is exactly \"1\"", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "pending",
      createdAt: now - 2 * SUBMITTED_STALL_MS,
    });
    const jobId = await seedJob(t, planId, { updatedAt: now - SUBMITTED_STALL_MS - 1 });

    // Unset: the cron still walks into the handler and returns without writing.
    vi.stubEnv("RELIABILITY_SWEEP_ARMED", "");
    await t.mutation(internal.reliabilitySweep.runSweep, {});
    expect((await getJob(t, jobId))?.status).toBe("submitted");
    expect(await watchdogNotifications(t)).toHaveLength(0);

    // Any other value is still dormant — only the exact literal arms it.
    vi.stubEnv("RELIABILITY_SWEEP_ARMED", "true");
    await t.mutation(internal.reliabilitySweep.runSweep, {});
    expect((await getJob(t, jobId))?.status).toBe("submitted");

    // Armed: the same stuck row now terminalizes.
    vi.stubEnv("RELIABILITY_SWEEP_ARMED", "1");
    await t.mutation(internal.reliabilitySweep.runSweep, {});
    expect((await getJob(t, jobId))?.status).toBe("failed");
  });

  test("crons.ts holds exactly FIVE jobs — a sixth is a deliberate edit here", () => {
    // A COUNT, not a ">= 1". A cron is unattended spend and unattended writes; the number of them
    // is a fact worth having to change on purpose.
    const jobs = [
      ...cronsSrc().matchAll(/\bcrons\.(daily|weekly|interval|hourly|monthly|cron)\(/g),
    ];
    expect(jobs).toHaveLength(5);
  });
});

describe("sweepStuckMediaJobs (D3 — severed poll chains)", () => {
  test("a submitted row past the threshold terminalizes failed with the watchdog reason, cascades the plan terminal, and notifies once", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "pending",
      createdAt: now - 2 * SUBMITTED_STALL_MS,
    });
    const jobId = await seedJob(t, planId, { updatedAt: now - SUBMITTED_STALL_MS - 1 });

    await runJobSweep(t);

    const job = await getJob(t, jobId);
    expect(job?.status).toBe("failed");
    expect(job?.failureReason).toBe(WATCHDOG_JOB_REASON);
    // The landing cascade: the render trigger sees a failed needed row with nothing in flight and
    // terminalizes the plan the honest way — the canvas can say `incomplete_batch` in words.
    const plan = await getPlan(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("incomplete_batch");

    const notes = await watchdogNotifications(t);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe(WATCHDOG_NOTIFY_MESSAGE);
  });

  test("two stuck rows on one plan produce ONE notification (deduped per plan per pass)", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, { kind: "media", createdAt: now - 2 * SUBMITTED_STALL_MS });
    const a = await seedJob(t, planId, { updatedAt: now - SUBMITTED_STALL_MS - 1 });
    const b = await seedJob(t, planId, {
      blockIndex: 1,
      updatedAt: now - SUBMITTED_STALL_MS - 1,
    });

    await runJobSweep(t);

    expect((await getJob(t, a))?.status).toBe("failed");
    expect((await getJob(t, b))?.status).toBe("failed");
    expect(await watchdogNotifications(t)).toHaveLength(1);
  });

  test("a submitted row AT the threshold boundary is untouched", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, { kind: "media" });
    const jobId = await seedJob(t, planId, { updatedAt: now - SUBMITTED_STALL_MS });

    await runJobSweep(t);

    const job = await getJob(t, jobId);
    expect(job?.status).toBe("submitted");
    expect(job?.failureReason).toBeUndefined();
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });

  test("queued and terminal rows are untouched however old they are", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, { kind: "media" });
    const queued = await seedJob(t, planId, {
      status: "queued",
      updatedAt: now - 10 * SUBMITTED_STALL_MS,
    });
    const done = await seedJob(t, planId, {
      blockIndex: 1,
      status: "succeeded",
      updatedAt: now - 10 * SUBMITTED_STALL_MS,
    });

    await runJobSweep(t);

    expect((await getJob(t, queued))?.status).toBe("queued");
    expect((await getJob(t, done))?.status).toBe("succeeded");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });

  test("the sweep is idempotent — a second pass changes nothing and re-notifies nothing", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, { kind: "media", createdAt: now - 2 * SUBMITTED_STALL_MS });
    await seedJob(t, planId, { updatedAt: now - SUBMITTED_STALL_MS - 1 });

    await runJobSweep(t);
    await runJobSweep(t);

    expect(await watchdogNotifications(t)).toHaveLength(1);
  });
});

describe("sweepStuckPlans — render plane (D3)", () => {
  test("a stale rendering plan terminalizes failed with the EXACT watchdog render reason and notifies", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "rendering",
      createdAt: now - 2 * RENDER_STALL_MS,
    });
    await seedJob(t, planId, {
      status: "succeeded",
      createdAt: now - 2 * RENDER_STALL_MS,
      updatedAt: now - RENDER_STALL_MS - 1,
    });

    await runPlanSweep(t);

    const plan = await getPlan(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe(WATCHDOG_RENDER_REASON);
    expect(plan?.renderedAt).toBeDefined();
    expect(await watchdogNotifications(t)).toHaveLength(1);
  });

  test("a rendering plan with recent job activity is untouched (boundary)", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "rendering",
      createdAt: now - 2 * RENDER_STALL_MS,
    });
    await seedJob(t, planId, {
      status: "succeeded",
      createdAt: now - 2 * RENDER_STALL_MS,
      updatedAt: now - RENDER_STALL_MS, // exactly at the boundary — NOT past it
    });

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.renderStatus).toBe("rendering");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });

  test("a recent automatic retry (renderRetriedAt) keeps a rendering plan alive past old landings", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "rendering",
      createdAt: now - 3 * RENDER_STALL_MS,
      renderRetriedAt: now - 1_000,
    });
    await seedJob(t, planId, {
      status: "succeeded",
      createdAt: now - 3 * RENDER_STALL_MS,
      updatedAt: now - 3 * RENDER_STALL_MS,
    });

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.renderStatus).toBe("rendering");
  });

  test("a recent MANUAL retry (its audit line) keeps a rendering plan alive past old landings", async () => {
    // `media.retryRender` stamps no plan field — its `media.render_retry_manual` audit row
    // (correlationId = batchId) is the only clock a manual retry leaves behind.
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "rendering",
      createdAt: now - 3 * RENDER_STALL_MS,
    });
    await seedJob(t, planId, {
      status: "succeeded",
      createdAt: now - 3 * RENDER_STALL_MS,
      updatedAt: now - 3 * RENDER_STALL_MS,
    });
    await t.run((ctx) =>
      ctx.db.insert("audit", {
        tenantId: A,
        correlationId: "batch_1",
        eventType: "media.render_retry_manual",
        actor: A,
        payload: { planId, batchId: "batch_1" },
        ts: now - 1_000,
      }),
    );

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.renderStatus).toBe("rendering");
  });

  test("a stale ARMED pending plan (all landings terminal, trigger severed) terminalizes with the watchdog reason", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "pending",
      createdAt: now - 2 * RENDER_STALL_MS,
    });
    await seedJob(t, planId, {
      status: "succeeded",
      createdAt: now - 2 * RENDER_STALL_MS,
      updatedAt: now - RENDER_STALL_MS - 1,
    });

    await runPlanSweep(t);

    const plan = await getPlan(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe(WATCHDOG_RENDER_REASON);
    expect(await watchdogNotifications(t)).toHaveLength(1);
  });

  test("an UN-ARMED pending plan (no jobs) is never swept", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "pending",
      createdAt: now - 10 * RENDER_STALL_MS,
    });

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.renderStatus).toBe("pending");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });

  test("a pending DECK-HOLD (a scene still naming no asset source) is an interactive state, not a stall", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "pending",
      createdAt: now - 2 * RENDER_STALL_MS,
      shots: [
        {
          index: 0,
          visual: "text_card",
          overlay: "", // hasAssetSource === false — the fix-menu hold
          seconds: 5,
          windowStartMs: 0,
          description: "d",
          prompt: "p",
          narration: "",
        },
      ],
    });
    await seedJob(t, planId, {
      status: "succeeded",
      createdAt: now - 2 * RENDER_STALL_MS,
      updatedAt: now - 2 * RENDER_STALL_MS,
    });

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.renderStatus).toBe("pending");
  });

  test("a pending plan with a job still in flight is the JOB sweep's problem, not this one's", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "pending",
      createdAt: now - 2 * RENDER_STALL_MS,
    });
    // STALE BY THE CLOCK AND STILL IN FLIGHT — deliberately, because a fresh `updatedAt` would
    // make this test pass on the staleness check alone and prove nothing about the in-flight guard
    // it exists to cover (caught by mutation: deleting `inFlight` left the whole suite green).
    // A long Sora video legitimately sits at `submitted` for a long time; terminalizing its plan
    // while a landing is still coming is the race this guard prevents.
    await seedJob(t, planId, {
      status: "submitted",
      createdAt: now - 2 * RENDER_STALL_MS,
      updatedAt: now - 2 * RENDER_STALL_MS,
    });

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.renderStatus).toBe("pending");
  });
});

describe("sweepStuckPlans — caption plane (D3)", () => {
  test("a stranded transcribing plan terminalizes captionStatus failed with the EXACT caption reason, render plane untouched", async () => {
    const t = harness();
    const now = Date.now();
    const planId = await seedPlan(t, {
      kind: "media",
      renderStatus: "rendered",
      captionStatus: "transcribing",
      createdAt: now - 2 * CAPTION_STALL_MS,
    });
    await seedJob(t, planId, {
      kind: "stt",
      spec: { kind: "stt", audioMinutes: 1 },
      status: "succeeded",
      createdAt: now - 2 * CAPTION_STALL_MS,
      updatedAt: now - CAPTION_STALL_MS - 1,
    });

    await runPlanSweep(t);

    const plan = await getPlan(t, planId);
    expect(plan?.captionStatus).toBe("failed");
    expect(plan?.captionReason).toBe(WATCHDOG_CAPTION_REASON);
    expect(plan?.renderStatus).toBe("rendered"); // a failed burn must leave the reel standing
    expect(await watchdogNotifications(t)).toHaveLength(1);
  });

  test("fresh transcribing, in-flight stt, and a reel still rendering are all untouched", async () => {
    const t = harness();
    const now = Date.now();
    // (1) fresh — at the boundary, not past it
    const fresh = await seedPlan(t, {
      threadId: "th_fresh",
      kind: "media",
      renderStatus: "rendered",
      captionStatus: "transcribing",
      createdAt: now - CAPTION_STALL_MS,
    });
    await seedJob(t, fresh, {
      kind: "stt",
      batchId: "b_fresh",
      spec: { kind: "stt", audioMinutes: 1 },
      status: "succeeded",
      createdAt: now - CAPTION_STALL_MS,
      updatedAt: now - CAPTION_STALL_MS,
    });
    // (2) stt still in flight — the JOB sweep owns it (its landing fails the caption plane)
    const inflight = await seedPlan(t, {
      threadId: "th_inflight",
      kind: "media",
      renderStatus: "rendered",
      captionStatus: "transcribing",
      createdAt: now - 2 * CAPTION_STALL_MS,
    });
    await seedJob(t, inflight, {
      kind: "stt",
      batchId: "b_inflight",
      spec: { kind: "stt", audioMinutes: 1 },
      status: "submitted",
      createdAt: now - 2 * CAPTION_STALL_MS,
      // STALE by the clock, so the in-flight guard is the ONLY thing saving it (see the render
      // plane's twin above — same mutation finding).
      updatedAt: now - 2 * CAPTION_STALL_MS,
    });
    // (3) reel still rendering — transcribing legitimately WAITS for the render terminal
    const waiting = await seedPlan(t, {
      threadId: "th_waiting",
      kind: "media",
      renderStatus: "rendering",
      captionStatus: "transcribing",
      createdAt: now - 2 * CAPTION_STALL_MS,
      renderRetriedAt: now - 1_000, // render plane itself is fresh
    });
    await seedJob(t, waiting, {
      kind: "stt",
      batchId: "b_waiting",
      spec: { kind: "stt", audioMinutes: 1 },
      status: "succeeded",
      createdAt: now - 2 * CAPTION_STALL_MS,
      updatedAt: now - 2 * CAPTION_STALL_MS,
    });

    await runPlanSweep(t);

    expect((await getPlan(t, fresh))?.captionStatus).toBe("transcribing");
    expect((await getPlan(t, inflight))?.captionStatus).toBe("transcribing");
    expect((await getPlan(t, waiting))?.captionStatus).toBe("transcribing");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });
});

describe("sweepStuckPlans — dead specialist dispatch (D4)", () => {
  test("a dispatch-owned collecting row with NO live dispatch becomes a proposed memo + notification", async () => {
    const t = harness();
    const planId = await seedPlan(t, {
      threadId: "th_dead_dispatch",
      status: "collecting",
      kind: "memo",
      recipients: [],
      subject: "Next step: fix the funnel",
      body: "",
      createdAt: Date.now() - COLLECTING_STALL_MS - 1,
    });

    await runPlanSweep(t);

    const plan = await getPlan(t, planId);
    expect(plan?.status).toBe("proposed"); // PlanCard renders at proposed — visible again
    expect(plan?.kind).toBe("memo");
    expect(plan?.body).toBe(COLLECTING_FALLBACK_BODY);
    expect(await watchdogNotifications(t)).toHaveLength(1);
  });

  // NOTE the AGED `createdAt`: without it this test would pass on the threshold alone and prove
  // nothing about the liveness check it exists to cover.
  test("a collecting row whose dispatch is STILL SCHEDULED is a live run, not a stall", async () => {
    const t = harness();
    const planId = await seedPlan(t, {
      threadId: "th_live_dispatch",
      status: "collecting",
      kind: "memo",
      recipients: [],
      subject: "Next step: fix the funnel",
      body: "",
      createdAt: Date.now() - 10 * COLLECTING_STALL_MS,
    });
    await t.run((ctx) =>
      ctx.scheduler.runAfter(60_000, internal.dispatch.runSpecialist, {
        tenantId: A,
        threadId: "th_live_dispatch",
        planId,
        gapIndex: 0,
        route: "growth",
        rootRequestId: "root_1",
        parentAgentId: "executive",
        depth: 1,
        ancestry: [],
        envelopeCents: 0,
        spentCents: 0,
      }),
    );

    await runPlanSweep(t);

    const plan = await getPlan(t, planId);
    expect(plan?.status).toBe("collecting");
    expect(plan?.body).toBe("");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });

  // THE BOUNDARY, and it is the one that protects a live turn: a dispatch is staged and its action
  // scheduled in the SAME transaction, so a freshly-staged row has a scheduled function to find.
  // The clock is the cheap pre-filter that keeps the scheduler scan off every plan in the table —
  // a row AT the threshold is not past it, and is not read.
  test("a collecting memo row AT the threshold is untouched even with no dispatch alive", async () => {
    const t = harness();
    const planId = await seedPlan(t, {
      threadId: "th_fresh_dispatch",
      status: "collecting",
      kind: "memo",
      recipients: [],
      subject: "Next step: fix the funnel",
      body: "",
      createdAt: Date.now() - COLLECTING_STALL_MS,
    });

    await runPlanSweep(t);

    const plan = await getPlan(t, planId);
    expect(plan?.status).toBe("collecting");
    expect(plan?.body).toBe("");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });

  test("an ordinary conversation's collecting row (no memo kind) is NEVER touched", async () => {
    const t = harness();
    const planId = await seedPlan(t, {
      threadId: "th_conversation",
      status: "collecting",
      recipients: [],
      createdAt: Date.now() - 7 * 24 * 60 * 60_000, // a week-old live chat is still a live chat
    });

    await runPlanSweep(t);

    expect((await getPlan(t, planId))?.status).toBe("collecting");
    expect(await watchdogNotifications(t)).toHaveLength(0);
  });
});
