// @vitest-environment node
//
// The media budget rail + the transactional JOB reservation (MEDIA-01, D10, plan 20-04).
//
// Every assertion here is $0: nothing in this file calls fal, OpenAI or Vercel. The `node`
// environment matches the research.test.ts / dispatch.test.ts harness idiom — convex-test's lazy
// module loader pulls every convex module, and some of them are "use node".
import type { Block, ShotType } from "@pikar/core/storyboard";
import { maxCharsFor, minCharsFor } from "@pikar/core/storyboard";
import {
  chooseMediaBatch,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_JOB_CAP_USD,
  MEDIA_SANDBOX_USD_PER_RENDER,
  MEDIA_VIDEO_PRICING,
  type MediaSpec,
} from "@pikar/cost/media";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
// The reserve drives the REAL rate-limiter component (relative import — the packages block deep
// specifiers). guardrails.test.ts carries the same line for the same reason.
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEPLOYMENT_MEDIA_BUDGET_CENTS, MEDIA_DAILY_BUDGET_CENTS } from "./guardrails";
import { reserveJobInner } from "./media";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;

/** A harness with the rate-limiter component registered — every reserve touches it. */
function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

const A = "tenant_a";
const B = "tenant_b";

async function seedPlan(t: T, tenantId = A): Promise<Id<"plans">> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("plans", {
        tenantId,
        threadId: "thread_1",
        status: "proposed",
        createdAt: Date.now(),
      }),
  );
}

/** N blocks at `seconds`, every narration exactly `chars` long (inside the band by default). */
function deck(
  n: number,
  { type = "AI" as ShotType, seconds = 10, chars = maxCharsFor(10) } = {},
): Block[] {
  return Array.from({ length: n }, (_, index) => ({
    index,
    type,
    seconds,
    windowStartMs: index * seconds * 1000,
    description: `scene ${index}`,
    narration: "x".repeat(chars),
    prompt: `prompt ${index}`,
  }));
}

const reserve = (t: T, args: Parameters<typeof reserveJobInner>[1]) =>
  t.mutation(internal.media.reserveJob, { ...args, blocks: [...args.blocks] });

const rows = (t: T) => t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
const mediaLeft = (t: T, tenantId = A) =>
  t.query(internal.guardrails.mediaRemainingCents, { tenantId });
const llmLeft = (t: T, tenantId = A) =>
  t.query(internal.guardrails.remainingDailyCents, { tenantId });

/** The §4.1 job: 6 paid blocks at 480p x 10 s, at the band ceiling, with captions. */
const JOB_41 = () => deck(6);
// 6 x $0.50 clips + 6 voice lines at 2 x 140 chars ($0.0168) + 1 STT minute ($0.008) +
// the flat render ($0.02). See "the §4.1 arithmetic" test below for the derivation.
const JOB_41_USD = 3.0448;
const JOB_41_CENTS = 305;
const JOB_41_LINES = 13; // 6 video + 6 tts + 1 stt — the render line gets NO row

// ── the two kill switches ──────────────────────────────────────────────────────────

async function seedConfig(t: T, cfg: { killSwitch: boolean; mediaKillSwitch?: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("guardrailConfig", {
      killSwitch: cfg.killSwitch,
      budgetUsdPerRequest: 0.05,
      ...(cfg.mediaKillSwitch === undefined ? {} : { mediaKillSwitch: cfg.mediaKillSwitch }),
      updatedAt: Date.now(),
    });
  });
}

describe("kill switches: two INDEPENDENT levers, either one stops media", () => {
  test("the GLOBAL kill switch refuses — zero rows, zero consumption", async () => {
    const t = harness();
    await seedConfig(t, { killSwitch: true });
    const planId = await seedPlan(t);

    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });

    expect(res).toEqual({ ok: false, reason: "kill_switch" });
    expect(await rows(t)).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(MEDIA_DAILY_BUDGET_CENTS);
  });

  test("the MEDIA kill switch refuses on its own, with the global switch OFF", async () => {
    const t = harness();
    await seedConfig(t, { killSwitch: false, mediaKillSwitch: true });
    const planId = await seedPlan(t);

    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });

    expect(res).toEqual({ ok: false, reason: "kill_switch" });
    expect(await rows(t)).toHaveLength(0);
  });

  test("setMediaKillSwitch upserts, and does NOT touch the global switch", async () => {
    const t = harness();
    await t.mutation(internal.guardrails.setMediaKillSwitch, { on: true }); // insert path
    let row = await t.run(async (ctx) => await ctx.db.query("guardrailConfig").first());
    expect(row?.mediaKillSwitch).toBe(true);
    expect(row?.killSwitch).toBe(false); // the LLM cockpit keeps running

    await t.mutation(internal.guardrails.setMediaKillSwitch, { on: false }); // patch path
    row = await t.run(async (ctx) => await ctx.db.query("guardrailConfig").first());
    expect(row?.mediaKillSwitch).toBe(false);
    // ...and flipping the GLOBAL one back does not resurrect the media switch.
    await t.mutation(internal.guardrails.setKillSwitch, { on: true });
    row = await t.run(async (ctx) => await ctx.db.query("guardrailConfig").first());
    expect(row?.killSwitch).toBe(true);
    expect(row?.mediaKillSwitch).toBe(false);
  });

  test("a missing guardrailConfig row reads BOTH switches OFF (default-on-read)", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(1),
      clipSeconds: 10,
      withCaptions: false,
    });
    expect(res.ok).toBe(true); // no seed, no migration — and it proceeds
  });
});

// ── fail closed on an unpriced model ───────────────────────────────────────────────

test("an unpriced model is unknown_model — zero rows, never a guess", async () => {
  const t = harness();
  const planId = await seedPlan(t);
  // Simulate the blast radius the playbook names: `fal-ai/wan-25-preview/*` is a PREVIEW endpoint,
  // and a rename turns every generation into unknown_model. That must be a free, loud refusal.
  // `reserveJobInner` is called directly (not through the wrapper) so the table mutation and the
  // module under test are provably the same instance; the refusal returns before the limiter.
  const saved = MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model];
  delete MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model];
  try {
    const res = await t.run((ctx) =>
      reserveJobInner(ctx, {
        tenantId: A,
        planId,
        blocks: JOB_41(),
        clipSeconds: 10,
        withCaptions: true,
      }),
    );
    expect(res).toEqual({ ok: false, reason: "unknown_model" });
    expect(await rows(t)).toHaveLength(0);
  } finally {
    if (saved) MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model] = saved;
  }
  expect(MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model]).toBe(saved); // restored for later tests
});

// ── the §4.1 job, end to end ───────────────────────────────────────────────────────

describe("the §4.1 job: the WHOLE reel is ONE reserved unit", () => {
  test("the arithmetic, derived from the price table rather than asserted twice", () => {
    const clips = 6 * 10 * (MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model]?.["480p"] ?? 0);
    const voice = 6 * ((2 * maxCharsFor(10)) / 1000) * 0.01; // 2x — the rewrite allowance
    const stt = 1 * 0.008; // 6 x 10 s = exactly one input minute
    expect(clips + voice + stt + MEDIA_SANDBOX_USD_PER_RENDER).toBeCloseTo(JOB_41_USD, 6);
    expect(JOB_41_USD).toBeLessThan(MEDIA_JOB_CAP_USD); // 13% headroom — the test is not vacuous
  });

  test("reserves ONCE, for the floored TOTAL — not the sum of 13 floored line items", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const before = await mediaLeft(t);

    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.estUsd).toBeCloseTo(JOB_41_USD, 6);
    expect(res.estCents).toBe(JOB_41_CENTS);
    expect(res.lineCount).toBe(JOB_41_LINES);
    // The window moved by the ONE floored total. Flooring per line would move it by more.
    expect(await mediaLeft(t)).toBe(before - JOB_41_CENTS);
  });

  test("the rows: N video + N tts + 1 stt at queued, sharing ONE batchId", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const all = await rows(t);
    expect(all).toHaveLength(JOB_41_LINES);
    expect(all.filter((r) => r.kind === "video")).toHaveLength(6);
    expect(all.filter((r) => r.kind === "tts")).toHaveLength(6);
    expect(all.filter((r) => r.kind === "stt")).toHaveLength(1);
    expect(new Set(all.map((r) => r.batchId))).toEqual(new Set([res.batchId]));
    expect(all.every((r) => r.status === "queued")).toBe(true);
    expect(all.every((r) => r.provider === "fal")).toBe(true);
    expect(all.every((r) => r.tenantId === A && r.planId === planId)).toBe(true);
    expect(all.every((r) => r.estUsd > 0)).toBe(true);
    expect(all.every((r) => r.promptHash.length === 64)).toBe(true);
    expect(all.every((r) => r.falRequestId === undefined)).toBe(true);
    // The deck-wide captions row is not a block's row.
    expect(all.find((r) => r.kind === "stt")?.blockIndex).toBe(-1);
    // No render row: the render is a plan-row concern, with no falRequestId and no webhook.
    expect(all.some((r) => (r.kind as string) === "render")).toBe(false);
    // The resolution is PINNED on the row — never left for fal to default to 1080p.
    const video = all.find((r) => r.kind === "video");
    expect(video?.spec).toMatchObject({ kind: "video", resolution: "480p", seconds: 10 });
    expect(video?.model).toBe(MEDIA_DEFAULT_VIDEO.model);
  });

  test("THE VOICE LINE IS RESERVED AT 2x — provable on the row and in the total", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const blocks = JOB_41();
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks,
      clipSeconds: 10,
      withCaptions: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // (a) at the row: every tts spec carries exactly twice its block's narration length.
    for (const row of (await rows(t)).filter((r) => r.kind === "tts")) {
      const source = blocks[row.blockIndex];
      expect(source).toBeDefined();
      expect(row.spec).toMatchObject({ characters: (source?.narration.length ?? 0) * 2 });
    }

    // (b) in the total: the reserved USD exceeds the SAME job priced at 1x narration by exactly
    // one more voice pass — the doubling, asserted directly rather than inferred.
    const onceOver: MediaSpec[] = [
      ...blocks.map(
        (): MediaSpec => ({
          kind: "video",
          model: MEDIA_DEFAULT_VIDEO.model,
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: 10,
        }),
      ),
      ...blocks.map(
        (b): MediaSpec => ({
          kind: "tts",
          model: "fal-ai/inworld-tts",
          characters: b.narration.length,
        }),
      ),
      { kind: "stt", model: "fal-ai/elevenlabs/speech-to-text/scribe-v2", audioMinutes: 1 },
      { kind: "render" },
    ];
    const raw = chooseMediaBatch(onceOver, MEDIA_JOB_CAP_USD);
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    const oneVoicePass = (6 * maxCharsFor(10) * 0.01) / 1000;
    expect(res.estUsd - raw.value.estUsd).toBeCloseTo(oneVoicePass, 6);
  });
});

// ── the cap refusals ───────────────────────────────────────────────────────────────

describe("over_job_cap: the cap is bounded by the CLIPS", () => {
  test("12 blocks at 480p is refused — zero rows, zero consumption", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(12),
      clipSeconds: 10,
      withCaptions: true,
    });
    expect(res).toEqual({ ok: false, reason: "over_job_cap" });
    expect(await rows(t)).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(MEDIA_DAILY_BUDGET_CENTS);
  });

  test("the 480p PIN is load-bearing: the same 6-block job at 720p is over the cap", () => {
    // There is no resolution argument on `reserveJob` BY DESIGN — 480p is pinned in
    // MEDIA_DEFAULT_VIDEO so nobody can choose a tier that triples the invoice. This asserts what
    // the pin is worth: were the pin ever relaxed, the identical deck would be refused.
    const at = (resolution: "480p" | "720p"): MediaSpec[] =>
      Array.from({ length: 6 }, () => ({
        kind: "video" as const,
        model: MEDIA_DEFAULT_VIDEO.model,
        resolution,
        seconds: 10,
      }));
    expect(chooseMediaBatch(at("480p"), MEDIA_JOB_CAP_USD).ok).toBe(true);
    const over = chooseMediaBatch(at("720p"), MEDIA_JOB_CAP_USD);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("over_job_cap");
  });
});

test("a clip length nobody prices is illegal_duration — zero rows", async () => {
  const t = harness();
  const planId = await seedPlan(t);
  const res = await reserve(t, {
    tenantId: A,
    planId,
    // 7 s is not in CLIP_SECONDS. Wan 2.5 accepts 5 or 10 only; there is no 15 s either.
    blocks: deck(3, { seconds: 7, chars: 90 }),
    clipSeconds: 7,
    withCaptions: false,
  });
  expect(res).toEqual({ ok: false, reason: "illegal_duration" });
  expect(await rows(t)).toHaveLength(0);
});

// ── the free pre-flight guard ──────────────────────────────────────────────────────

describe("the narration BAND is caught before payment, not by ffprobe after it", () => {
  test("too long → narration_too_long, zero rows, zero consumption", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(3, { chars: maxCharsFor(10) + 1 }),
      clipSeconds: 10,
      withCaptions: false,
    });
    expect(res).toEqual({ ok: false, reason: "narration_too_long" });
    expect(await rows(t)).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(MEDIA_DAILY_BUDGET_CENTS);
  });

  test("too SHORT is as fatal as too long → narration_too_short", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(3, { chars: minCharsFor(10) - 1 }),
      clipSeconds: 10,
      withCaptions: false,
    });
    expect(res).toEqual({ ok: false, reason: "narration_too_short" });
    expect(await rows(t)).toHaveLength(0);
  });

  test("the band travels with the block length — 43-70 at 5 s, not 103-140", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    // 120 characters clears the 10-second ceiling and BLOWS the 5-second one. A flat 140 would
    // have let this reach a reservation and then hard-error in the render sandbox.
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(3, { seconds: 5, chars: 120 }),
      clipSeconds: 5,
      withCaptions: false,
    });
    expect(res).toEqual({ ok: false, reason: "narration_too_long" });
    expect(120).toBeLessThan(maxCharsFor(10)); // not vacuous: it is legal at 10 s
  });
});

// ── D12(a) at the rail ─────────────────────────────────────────────────────────────

test("D12a AT THE RAIL: 13 sub-cent lines reserve 4 cents, not the 15 of per-line flooring", async () => {
  const t = harness();
  const planId = await seedPlan(t);
  // 13 unpaid (TEXT) blocks at 5 s: no clips, 13 voice lines of 2 x 43 = 86 chars ($0.00086 each),
  // plus the flat render. TRUE cost $0.03118 → 4 cents once-only.
  //
  // Floored PER LINE it is 13 x 1 + 2 = 15 cents — nearly 4x the true cost, on the cheapest part
  // of the job, compounding with deck length. That is the whole point of D12(a).
  //
  // (The purer "13 sub-cent lines → 1 cent, not 13" lives in packages/cost/src/media.test.ts. It
  // cannot be built at THIS level: the flat $0.02 render line is on every job by construction, so
  // no job reachable through `reserveJob` can total under 2 cents.)
  const res = await reserve(t, {
    tenantId: A,
    planId,
    blocks: deck(13, { type: "TEXT", seconds: 5, chars: minCharsFor(5) }),
    clipSeconds: 5,
    withCaptions: false,
  });

  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.estUsd).toBeCloseTo(0.03118, 6);
  expect(res.estCents).toBe(4);
  expect(res.lineCount).toBe(13); // 0 video (TEXT is unpaid) + 13 tts
  expect(await mediaLeft(t)).toBe(MEDIA_DAILY_BUDGET_CENTS - 4);
  const perLineFloored = 13 * 1 + Math.ceil(MEDIA_SANDBOX_USD_PER_RENDER * 100);
  expect(perLineFloored).toBe(15); // the number this assertion exists to NOT be
});

// ── the windows ────────────────────────────────────────────────────────────────────

describe("the media windows: keyed per tenant, with a keyless ceiling behind them", () => {
  test("THE POINT: tenant A's reservation does not touch tenant B's window", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });
    expect(res.ok).toBe(true);

    expect(await mediaLeft(t, A)).toBe(MEDIA_DAILY_BUDGET_CENTS - JOB_41_CENTS);
    // Mutation check: drop `key: tenantId` from mediaSpendCents and this line goes RED.
    expect(await mediaLeft(t, B)).toBe(MEDIA_DAILY_BUDGET_CENTS);
  });

  test("an exhausted tenant is refused with media_daily_exhausted AND inserts ZERO rows", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const job = {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    } as const;
    // 3 x 305 = 915 of 1000. The fourth cannot fit in the 85 that remain.
    for (let i = 0; i < 3; i++) expect((await reserve(t, job)).ok).toBe(true);
    const rowsBefore = (await rows(t)).length;
    expect(rowsBefore).toBe(3 * JOB_41_LINES);

    const res = await reserve(t, job);

    expect(res).toEqual({ ok: false, reason: "media_daily_exhausted" });
    expect((await rows(t)).length).toBe(rowsBefore); // all-or-nothing
    expect(await mediaLeft(t, A)).toBe(MEDIA_DAILY_BUDGET_CENTS - 3 * JOB_41_CENTS);
  });

  test("the KEYLESS ceiling refuses independently, with its own distinct reason", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const job = (tenantId: string) =>
      ({ tenantId, planId, blocks: JOB_41(), clipSeconds: 10, withCaptions: true }) as const;

    // Many tenants, each individually modest (3 jobs = 915 < its own 1000 allowance), together
    // exceeding the 10,000 ceiling. No single tenant is over its own window, so only the global
    // rail can refuse here.
    let sawCeiling = false;
    outer: for (let i = 0; i < 12 && !sawCeiling; i++) {
      for (let j = 0; j < 3; j++) {
        const res = await reserve(t, job(`crowd_${i}`));
        if (!res.ok) {
          expect(res.reason).toBe("deployment_media_exhausted");
          sawCeiling = true;
          break outer;
        }
      }
    }
    expect(sawCeiling).toBe(true);

    // A FRESH tenant has its full personal budget and is still refused — and is told the truth
    // about why, rather than being blamed for a day it never touched.
    expect(await mediaLeft(t, "newcomer")).toBeLessThan(MEDIA_DAILY_BUDGET_CENTS);
    expect(await reserve(t, job("newcomer"))).toEqual({
      ok: false,
      reason: "deployment_media_exhausted",
    });
    expect(DEPLOYMENT_MEDIA_BUDGET_CENTS).toBeGreaterThan(MEDIA_DAILY_BUDGET_CENTS); // not vacuous
  });

  test("THE RAILS NEVER SHARE: media does not move the token budget, in either direction", async () => {
    const t = harness();
    const planId = await seedPlan(t);

    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });
    expect(res.ok).toBe(true);
    // A 305-cent media reservation left the LLM rail untouched. Folding media into
    // dailySpendCents would silently shrink every sub-agent envelope (dispatch ENVELOPE_FRACTION).
    expect(await llmLeft(t, A)).toBe(500);

    // ...and the reverse: real LLM spend does not consume media budget.
    await t.mutation(internal.guardrails.recordSpend, { tenantId: A, costUsd: 2 });
    expect(await llmLeft(t, A)).toBe(300);
    expect(await mediaLeft(t, A)).toBe(MEDIA_DAILY_BUDGET_CENTS - JOB_41_CENTS);
  });

  test("a media rail driven negative by reserve:true clamps to 0, never a negative budget", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const job = {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    } as const;
    for (let i = 0; i < 3; i++) await reserve(t, job);
    expect(await mediaLeft(t, A)).toBeGreaterThanOrEqual(0);
  });
});

// ── Task 3: the transaction IS the guarantee ───────────────────────────────────────

test("CONCURRENCY: two jobs that fit alone but not together — exactly ONE wins", async () => {
  const t = harness();
  const planId = await seedPlan(t);
  const job = {
    tenantId: A,
    planId,
    blocks: JOB_41(),
    clipSeconds: 10,
    withCaptions: true,
  } as const;

  // Leave room for exactly one more job: 1000 - 2 x 305 = 390, and 2 x 305 = 610 > 390.
  for (let i = 0; i < 2; i++) expect((await reserve(t, job)).ok).toBe(true);
  const room = await mediaLeft(t, A);
  expect(room).toBe(MEDIA_DAILY_BUDGET_CENTS - 2 * JOB_41_CENTS);
  expect(room).toBeGreaterThanOrEqual(JOB_41_CENTS); // one fits...
  expect(room).toBeLessThan(2 * JOB_41_CENTS); // ...two do not. The test is not vacuous.

  // Issued together, unawaited. `check` does not consume; `limit` does — and BOTH run inside the
  // SAME serializable mutation, which is the only reason the loser cannot pass a check against a
  // window the winner has not yet consumed.
  const [first, second] = await Promise.all([reserve(t, job), reserve(t, job)]);

  const winners = [first, second].filter((r) => r.ok);
  const losers = [first, second].filter((r) => !r.ok);
  expect(winners).toHaveLength(1);
  expect(losers).toEqual([{ ok: false, reason: "media_daily_exhausted" }]);
  // Consumed cents equal the WINNER's estimate, not both.
  expect(await mediaLeft(t, A)).toBe(room - JOB_41_CENTS);
  // ...and the loser wrote nothing.
  expect(await rows(t)).toHaveLength(3 * JOB_41_LINES);
});

// ── plan 20-18: the D5 reconciliation readers ──────────────────────────────────────
//
// These seed `mediaJobs` rows DIRECTLY rather than going through `reserveJob`, because the point
// is to control `createdAt` and `actualCents` — the two fields the reader's honesty turns on, and
// neither of which a reservation lets a test choose. `actualCents` is written by 20-06's webhook,
// which does not exist yet; the schema field does (20-02), so the reader is fully provable now.

const T0 = 1_754_000_000_000; // a fixed epoch — no Date.now() in an assertion about time windows

type SeedRow = {
  kind: "video" | "image" | "tts" | "stt";
  estUsd: number;
  createdAt: number;
  actualCents?: number;
  tenantId?: string;
  blockIndex?: number;
};

async function seedJobs(t: T, planId: Id<"plans">, seeds: SeedRow[], batchId = "batch_1") {
  await t.run(async (ctx) => {
    for (const [i, s] of seeds.entries()) {
      await ctx.db.insert("mediaJobs", {
        tenantId: s.tenantId ?? A,
        planId,
        batchId,
        blockIndex: s.blockIndex ?? i,
        provider: "fal",
        kind: s.kind,
        model: s.kind === "video" ? MEDIA_DEFAULT_VIDEO.model : "fal-ai/inworld-tts",
        spec:
          s.kind === "video"
            ? { kind: "video", resolution: "480p", seconds: 10 }
            : s.kind === "tts"
              ? { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 }
              : s.kind === "stt"
                ? { kind: "stt", audioMinutes: 1 }
                : { kind: "image", width: 1080, height: 1920 },
        promptHash: "0".repeat(64),
        status: s.actualCents === undefined ? "queued" : "succeeded",
        ...(s.actualCents === undefined ? {} : { actualCents: s.actualCents }),
        estUsd: s.estUsd,
        createdAt: s.createdAt,
        updatedAt: s.createdAt,
      });
    }
  });
}

const spend = (t: T, sinceMs = T0, untilMs = T0 + 1000, tenantId = A) =>
  t.query(internal.media.spendForPeriod, { tenantId, sinceMs, untilMs });

describe("spendForPeriod: the D5(a) aggregate, and the three things that would make it lie", () => {
  test("an empty period is all zeros — never a throw, never a null", async () => {
    const t = harness();
    const res = await spend(t);
    expect(res).toEqual({
      estCents: 0,
      actualCents: 0,
      rowCount: 0,
      unlanded: 0,
      byKind: {},
      notes: { ttsReservedAt2x: false, reservedTotalNotDerivable: true },
    });
  });

  test("the window is HALF-OPEN — a row at untilMs belongs to the NEXT period, not both", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [
      { kind: "video", estUsd: 0.5, createdAt: T0 - 1 }, // before   → out
      { kind: "video", estUsd: 0.5, createdAt: T0 }, // at since → IN
      { kind: "video", estUsd: 0.5, createdAt: T0 + 999 }, // inside   → in
      { kind: "video", estUsd: 0.5, createdAt: T0 + 1000 }, // at until → OUT (next period owns it)
    ]);

    expect((await spend(t)).rowCount).toBe(2);
    // Adjacent periods partition the rows exactly once — the property half-open buys.
    const next = await spend(t, T0 + 1000, T0 + 2000);
    expect(next.rowCount).toBe(1);
  });

  test("estCents is rounded ONCE on the total, not per row", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    // Six sub-cent voice lines: $0.0028 each = $0.0168 → 2 cents once. Per row it would be 6.
    await seedJobs(
      t,
      planId,
      Array.from({ length: 6 }, () => ({ kind: "tts" as const, estUsd: 0.0028, createdAt: T0 })),
    );
    expect((await spend(t)).estCents).toBe(2);
  });

  test("UNLANDED rows are COUNTED, never silently dropped from the total", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [
      { kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 },
      { kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 },
      { kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 },
      { kind: "video", estUsd: 0.5, createdAt: T0 }, // still queued
      { kind: "video", estUsd: 0.5, createdAt: T0 }, // still queued
    ]);

    const res = await spend(t);
    expect(res.rowCount).toBe(5);
    expect(res.unlanded).toBe(2); // ← the whole point: the period is NOT final
    expect(res.actualCents).toBe(150); // only what actually landed
    expect(res.estCents).toBe(250); // estimated for all five
    // A reader that reported 150 with no `unlanded` would say this period cost $1.50 when the
    // estimate is $2.50 and two lines have not reported. That is the lie this counter prevents.
    expect(res.actualCents).toBeLessThan(res.estCents);
  });

  test("byKind breaks it down — a drift in ONE table row is invisible in a single total", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [
      { kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 },
      { kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 },
      { kind: "tts", estUsd: 0.0028, createdAt: T0, actualCents: 1 },
      { kind: "stt", estUsd: 0.008, createdAt: T0, actualCents: 1 },
    ]);

    const res = await spend(t);
    expect(res.byKind.video).toEqual({ estCents: 100, actualCents: 100, rowCount: 2 });
    expect(res.byKind.tts).toEqual({ estCents: 0, actualCents: 1, rowCount: 1 });
    expect(res.byKind.stt).toEqual({ estCents: 1, actualCents: 1, rowCount: 1 });
    expect(res.byKind.image).toBeUndefined(); // absent kinds are absent, not zero-filled
  });

  test("the 2x voice reservation is DISCLOSED, so a healthy 2:1 ratio is not read as an overcharge", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    // A voice line estimated at 2x (280 chars reserved for a 140-char narration) that lands at its
    // TRUE cost. est/actual = 2 and nothing is wrong.
    await seedJobs(t, planId, [{ kind: "tts", estUsd: 0.0028, createdAt: T0, actualCents: 1 }]);
    expect((await spend(t)).notes.ttsReservedAt2x).toBe(true);

    const t2 = harness();
    const p2 = await seedPlan(t2);
    await seedJobs(t2, p2, [{ kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 }]);
    expect((await spend(t2)).notes.ttsReservedAt2x).toBe(false); // not vacuous
  });

  test("the reserved total is declared NOT derivable — the render line has no row", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: 10,
      withCaptions: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const now = Date.now();
    const agg = await t.query(internal.media.spendForPeriod, {
      tenantId: A,
      sinceMs: now - 60_000,
      untilMs: now + 60_000,
    });
    // The reservation moved the window by 305; the ROWS account for less, because the $0.02 render
    // line was reserved and has no row, and the batch floor was applied once.
    expect(agg.estCents).toBeLessThan(res.estCents);
    expect(agg.notes.reservedTotalNotDerivable).toBe(true);
  });

  test("a tenant sees ONLY its own rows", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [
      { kind: "video", estUsd: 0.5, createdAt: T0, actualCents: 50 },
      { kind: "video", estUsd: 9.0, createdAt: T0, actualCents: 900, tenantId: B },
    ]);
    expect((await spend(t)).actualCents).toBe(50);
    expect((await spend(t, T0, T0 + 1000, B)).actualCents).toBe(900);
  });

  test("it is a READER — the rows are byte-identical after it runs", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [{ kind: "video", estUsd: 0.5, createdAt: T0 }]);
    const before = await rows(t);
    await spend(t);
    expect(await rows(t)).toEqual(before);
  });
});

describe("listJobs: the per-plan detail, as a projection", () => {
  test("returns the projection in blockIndex order, with absences EXPLICIT", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [
      { kind: "video", estUsd: 0.5, createdAt: T0, blockIndex: 2, actualCents: 50 },
      { kind: "stt", estUsd: 0.008, createdAt: T0, blockIndex: -1 },
      { kind: "video", estUsd: 0.5, createdAt: T0, blockIndex: 0, actualCents: 50 },
    ]);

    const list = await t.query(internal.media.listJobs, { tenantId: A, planId });
    expect(list.map((r) => r.blockIndex)).toEqual([-1, 0, 2]); // deck-wide stt first
    // An unlanded row shows its absence rather than dropping the key.
    expect(list[0]?.actualCents).toBeNull();
    expect(list[0]?.verdict).toBeNull();
    expect(list[1]?.actualCents).toBe(50);
  });

  test("NO storage handle can escape through this reader", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [{ kind: "video", estUsd: 0.5, createdAt: T0 }]);

    const list = await t.query(internal.media.listJobs, { tenantId: A, planId });
    // Key-set equality, not an eyeball: a field added to the row must not appear here by accident.
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(
      [
        "actualCents",
        "batchId",
        "blockIndex",
        "estUsd",
        "failureReason",
        "kind",
        "model",
        "promptHash",
        "status",
        "verdict",
      ].sort(),
    );
    for (const banned of ["assetStorageId", "assetHash", "mimeType", "bytes"]) {
      expect(list[0]).not.toHaveProperty(banned);
    }
  });

  test("a cross-tenant call returns empty, never another tenant's plan", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await seedJobs(t, planId, [{ kind: "video", estUsd: 0.5, createdAt: T0 }]);
    expect(await t.query(internal.media.listJobs, { tenantId: B, planId })).toEqual([]);
  });
});
