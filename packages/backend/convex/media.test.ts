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
  MEDIA_DEFAULT_IMAGE,
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_JOB_CAP_USD,
  MEDIA_SANDBOX_USD_PER_RENDER,
  MEDIA_VIDEO_PRICING,
  type MediaSpec,
} from "@pikar/cost/media";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
// The reserve drives the REAL rate-limiter component (relative import — the packages block deep
// specifiers). guardrails.test.ts carries the same line for the same reason.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { hmacHex } from "./gmailAuth";
import { DEPLOYMENT_MEDIA_BUDGET_CENTS, MEDIA_DAILY_BUDGET_CENTS } from "./guardrails";
import { contentHash } from "./lib/hash";
import { buildSubmitBody, reserveJobInner, type SubmittableSpec, submitLine } from "./media";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;

/** A harness with the rate-limiter component registered — every reserve touches it. `auditCounts`
 *  joined it in 20-06: the landing writes an audit row, and `audit.log` mirrors every insert into
 *  the aggregate (calendar.test.ts carries the same pair of lines). */
function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
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

// ── plan 20-05: the fal SUBMIT adapter ─────────────────────────────────────────────
//
// COMPILE-TIME NOTE, and it is half the point of this plan: `buildSubmitBody` takes
// `SubmittableSpec`, and its switch ends in `const _never: never = spec`. Deleting the `image` case
// is a `tsc` error here, not a runtime fallthrough. Plan 20-14 widened that alias with `"tts"` and
// plan 20-17 widens it with `"stt"` — the moment it does, the `never` arm goes RED until the
// matching case is written. A `default: return {}` would let a `tts` spec inherit the video arm's
// body, which is the money bug in a new costume.
//
// Everything below is $0: `fetch` is a spy in every test, and `FAL_FIXTURE` covers the rest.

const mediaSource = (
  import.meta.glob("./media.ts", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >
)["./media.ts"];
/** Comments stripped — the invariants below are about the CODE surface, and this module's prose
 *  legitimately NAMES the things it forbids (a poll, a wait, a provider default). */
const mediaCode = (mediaSource ?? "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "$1");

const VIDEO: SubmittableSpec = {
  kind: "video",
  model: MEDIA_DEFAULT_VIDEO.model,
  resolution: MEDIA_DEFAULT_VIDEO.resolution,
  seconds: 10,
};
const TTS: SubmittableSpec = {
  kind: "tts",
  model: MEDIA_DEFAULT_VOICE.model,
  characters: 140,
  voice: MEDIA_DEFAULT_VOICE.voice,
  sampleRateHertz: MEDIA_DEFAULT_VOICE.sampleRateHertz,
};
const HOOK = "https://example.convex.site/fal/callback/abc.def";

/** fal's queue accept, one distinct `request_id` per call. A fresh Response per call is REQUIRED:
 *  a body is a single-read stream, so `mockResolvedValue(new Response(...))` would hand the same
 *  consumed object to call 2 and every test asserting N submits would be a lie. */
function acceptFetch() {
  let n = 0;
  return vi.fn().mockImplementation(() => {
    n += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ request_id: `req_${n}`, status: "IN_QUEUE" }), { status: 200 }),
    );
  });
}

function stubMediaEnv() {
  vi.stubEnv("FAL_KEY", "test-key");
  vi.stubEnv("FAL_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildSubmitBody: the body is a function of the PRICED spec, and nothing else", () => {
  test("the video body is the spec field for field — nothing left for fal to default", () => {
    expect(buildSubmitBody(VIDEO, "a lighthouse at dusk")).toEqual({
      prompt: "a lighthouse at dusk",
      resolution: "480p",
      duration: "10",
      enable_prompt_expansion: false,
    });
  });

  test("`duration` is the STRING enum, not the number — the arithmetic type stops at the wire", () => {
    const body = buildSubmitBody({ ...VIDEO, seconds: 5 }, "p");
    expect(body.duration).toBe("5");
    expect(body.duration).not.toBe(5); // the submission that would 422 AFTER the reservation
  });

  test("a DIFFERENT priced tier travels through unchanged — the field is not a hardcoded 480p", () => {
    // Not vacuous: were `resolution` dropped from the arm, the test above would still see the key
    // absent, but THIS one proves the value tracks the spec rather than a constant.
    expect(buildSubmitBody({ ...VIDEO, resolution: "1080p" }, "p").resolution).toBe("1080p");
    expect(buildSubmitBody({ ...VIDEO, resolution: "720p" }, "p").resolution).toBe("720p");
  });

  test("NO audio field is sent, on any video submit", () => {
    // The endpoint has no audio toggle (20-01 preflight): the only audio field is `audio_url` and
    // we never send one. A clip's own native track is ducked to SFXVOL 0.20 under the voice bed by
    // `render/assemble_final.sh`'s LEVEL LAW — Open Question 5 resolves at the assembler.
    const keys = Object.keys(buildSubmitBody(VIDEO, "p"));
    expect(keys.filter((k) => /audio/i.test(k))).toEqual([]);
  });

  test("the image body maps width/height onto `image_size` and pins `num_images`", () => {
    expect(
      buildSubmitBody(
        {
          kind: "image",
          model: MEDIA_DEFAULT_IMAGE.model,
          width: MEDIA_DEFAULT_IMAGE.width,
          height: MEDIA_DEFAULT_IMAGE.height,
        },
        "a poster",
      ),
    ).toEqual({
      prompt: "a poster",
      // There is no width/height on this endpoint, and `num_images` is a STRAIGHT price multiplier
      // defaulting to 1 — omitting it would let a fal default multiply the invoice.
      image_size: { width: 1080, height: 1920 },
      num_images: 1,
    });
  });

  test("the switch ends in a `never` binding, and no `default` returns a body", () => {
    expect(mediaCode).toMatch(/const\s+_never\s*:\s*never\s*=\s*spec/);
    expect(mediaCode).not.toMatch(/default:\s*\n?\s*return\s*\{/);
  });

  // ── 20-14: the voiceover arm ──────────────────────────────────────────────────

  test("the tts body's key set is EXACTLY {text, voice, sample_rate_hertz}, 24000 pinned", () => {
    // Exact equality, not a property spot-check: this single assertion is what makes the two
    // mutation checks below fire, and it is the only thing standing between D8 and a `speed` knob.
    expect(buildSubmitBody(TTS, "Six weeks, start to finish.")).toEqual({
      text: "Six weeks, start to finish.",
      voice: "Evelyn (en)",
      // The vendor default is 48000. Unpinned it doubles the bytes reaching the render sandbox and
      // makes the resample step non-deterministic.
      sample_rate_hertz: 24000,
    });
  });

  test("NO time-stretch knob is submitted, under any name — delta pitfall 15's tripwire", () => {
    // `fal-ai/inworld-tts` has no `speed`/`rate` field at all, so D8's no-time-stretch rule is
    // enforced by the PROVIDER rather than by our discipline. This asserts we never start sending
    // one anyway — e.g. after a swap to `fal-ai/kokoro/*`, which exposes `speed: 0.1-5.0`.
    const keys = Object.keys(buildSubmitBody(TTS, "p"));
    expect(keys.filter((k) => /speed|rate|tempo|setpts|stretch|pace/i.test(k))).toEqual([
      "sample_rate_hertz", // the SAMPLE rate — a format field, not a pace field
    ]);
  });

  test("the narration is submitted VERBATIM — never truncated, never re-wrapped", () => {
    // A silent truncation ships a voiceover missing its last words, with no error anywhere and a
    // clip that still renders. The submitted text is the text that was priced.
    const long = `${"y".repeat(139)}.`;
    expect(buildSubmitBody(TTS, long).text).toBe(long);
    const wrapped = "one.\n  two.\ttrailing space ";
    expect(buildSubmitBody(TTS, wrapped).text).toBe(wrapped);
  });

  test("the pinned fields track the SPEC, not a constant — a re-voiced row travels", () => {
    // Not vacuous: were `voice`/`sample_rate_hertz` read from MEDIA_DEFAULT_VOICE at the arm, the
    // assertions above would still pass and a row reserved under one voice could submit under
    // another after a constant bump. The row is the record of what was priced.
    const body = buildSubmitBody({ ...TTS, voice: "Hank (en)", sampleRateHertz: 48000 }, "p");
    expect(body.voice).toBe("Hank (en)");
    expect(body.sample_rate_hertz).toBe(48000);
  });
});

describe("submitLine: fail-closed on the key, a CODE on failure, and never a wait", () => {
  test("FAL_KEY unset refuses BEFORE any fetch — the spy sees ZERO calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("FAL_KEY", "");
    await expect(submitLine(VIDEO, "p", HOOK)).rejects.toThrow(/FAL_KEY/);
    // The assertion that matters: not the message, but that nothing reached the network.
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("FAL_FIXTURE short-circuits with a synthetic id and ZERO fetches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    vi.stubEnv("FAL_FIXTURE", "1");
    const res = await submitLine(VIDEO, "p", HOOK);
    expect(res).toEqual({ ok: true, requestId: expect.stringMatching(/^fixture-/) });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("the fixture seam does NOT weaken the key check", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_FIXTURE", "1");
    await expect(submitLine(VIDEO, "p", HOOK)).rejects.toThrow(/FAL_KEY/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("the wire request: queue URL, webhook query param, Key header, spec-derived body", async () => {
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();

    expect(await submitLine(VIDEO, "a lighthouse", HOOK)).toEqual({ ok: true, requestId: "req_1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://queue.fal.run/${MEDIA_DEFAULT_VIDEO.model}?fal_webhook=${encodeURIComponent(HOOK)}`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Key test-key");
    expect(init.method).toBe("POST");
    // THE containment: the submitted JSON is `buildSubmitBody` of the priced spec, byte for byte.
    expect(JSON.parse(String(init.body))).toEqual(buildSubmitBody(VIDEO, "a lighthouse"));
  });

  test("a 422 is a CODE with `blocked` — and the provider's prose appears NOWHERE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              detail: [
                {
                  type: "content_policy_violation",
                  msg: "the prompt depicts a named public figure",
                },
              ],
            }),
            { status: 422 },
          ),
        ),
      ),
    );
    stubMediaEnv();

    const res = await submitLine(VIDEO, "p", HOOK);
    expect(res).toEqual({ ok: false, code: "content_policy_violation", blocked: true });
    expect(JSON.stringify(res)).not.toContain("public figure");
  });

  test("a top-level `type` discriminator is read too", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ type: "content_policy_violation" }), { status: 422 }),
          ),
        ),
    );
    stubMediaEnv();
    expect(await submitLine(VIDEO, "p", HOOK)).toEqual({
      ok: false,
      code: "content_policy_violation",
      blocked: true,
    });
  });

  test("a 5xx yields a DISTINCT, non-blocking code and never reads the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response("<html>upstream gateway exploded</html>", { status: 503 })),
        ),
    );
    stubMediaEnv();

    const res = await submitLine(VIDEO, "p", HOOK);
    expect(res).toEqual({ ok: false, code: "http_503", blocked: false });
    expect(res).not.toEqual({ ok: false, code: "content_policy_violation", blocked: true });
    expect(JSON.stringify(res)).not.toContain("gateway");
  });

  test("a transport throw is a code, not a rethrow — the message can carry the webhook HMAC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`ECONNRESET connecting to ${HOOK}`)),
    );
    stubMediaEnv();
    const res = await submitLine(VIDEO, "p", HOOK);
    expect(res).toEqual({ ok: false, code: "transport_error", blocked: false });
    expect(JSON.stringify(res)).not.toContain("callback");
  });

  test("a 200 with no request_id is a failure, never a silently-lost line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );
    stubMediaEnv();
    expect(await submitLine(VIDEO, "p", HOOK)).toEqual({
      ok: false,
      code: "no_request_id",
      blocked: false,
    });
  });
});

test("SC2: nothing in media.ts polls fal or waits for a terminal status", () => {
  for (const token of ["status_url", "response_url", "cancel_url", "setTimeout", "setInterval"]) {
    expect(mediaCode, `media.ts waits on ${token}`).not.toContain(token);
  }
  expect(mediaCode).not.toMatch(/while\s*\(/);
  expect(mediaCode).toContain("queue.fal.run"); // not vacuous: the submit really is in this file
});

// ── submitBatch ────────────────────────────────────────────────────────────────────

async function seedPlanWithShots(t: T, blocks: Block[], tenantId = A): Promise<Id<"plans">> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("plans", {
        tenantId,
        threadId: "thread_1",
        status: "proposed",
        createdAt: Date.now(),
        shots: blocks.map((b) => ({
          index: b.index,
          type: b.type,
          seconds: b.seconds,
          windowStartMs: b.windowStartMs,
          description: b.description,
          prompt: b.prompt,
          narration: b.narration,
        })),
      }),
  );
}

/** A reserved 2-block batch: 2 video lines + 2 tts lines, all four submittable as of plan 20-14. */
async function reservedBatch(t: T) {
  const blocks = deck(2);
  const planId = await seedPlanWithShots(t, blocks);
  const res = await reserve(t, {
    tenantId: A,
    planId,
    blocks,
    clipSeconds: 10,
    withCaptions: false,
  });
  if (!res.ok) throw new Error(`reserve failed: ${res.reason}`);
  return { blocks, planId, batchId: res.batchId };
}

describe("submitBatch: idempotent per line, and it returns without waiting", () => {
  test("TWO consecutive runs issue exactly N fetches — not 2N", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { batchId } = await reservedBatch(t);

    const first = await t.action(internal.media.submitBatch, { tenantId: A, batchId });
    // 2 video + 2 tts, all four through the SAME loop, the SAME claim and the SAME secret.
    expect(first).toEqual({ submitted: 4, blocked: 0, failed: 0, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const second = await t.action(internal.media.submitBatch, { tenantId: A, batchId });
    expect(second).toEqual({ submitted: 0, blocked: 0, failed: 0, skipped: 4 });
    // Mutation check: delete the `claimLine` call from the loop and this line reads 8.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("the rows after a submit: video AND voice claimed + ticketed, off one reservation", async () => {
    const t = harness();
    vi.stubGlobal("fetch", acceptFetch());
    stubMediaEnv();
    await reservedBatch(t);
    const batchId = (await rows(t))[0]?.batchId ?? "";
    await t.action(internal.media.submitBatch, { tenantId: A, batchId });

    const all = await rows(t);
    const video = all.filter((r) => r.kind === "video");
    const tts = all.filter((r) => r.kind === "tts");
    expect(video.every((r) => r.status === "submitted")).toBe(true);
    expect(tts.every((r) => r.status === "submitted")).toBe(true);
    // Four DISTINCT tickets — no line reused another's, and the voice lines are real submissions.
    expect(new Set(all.map((r) => r.falRequestId)).size).toBe(4);
    expect(all.every((r) => r.falRequestId !== undefined)).toBe(true);
  });

  test("A VOICE LINE SUBMITS `narration`, NEVER `prompt` — the copy-paste this test exists for", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    // `deck()` gives every block a prompt (`prompt 0`) that DIFFERS from its narration ("x"*140),
    // so an arm that copied the video branch would voice the shot description over the clip —
    // fluent, plausible, and completely wrong, with nothing else going red.
    // Distinct narrations per block (still inside the 103-140 band at 10 s), so this also proves
    // the read is INDEXED by block rather than "some narration off the deck".
    const blocks = deck(2).map((b) => ({ ...b, narration: `${"x".repeat(139)}${b.index}` }));
    const planId = await seedPlanWithShots(t, blocks);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks,
      clipSeconds: 10,
      withCaptions: false,
    });
    if (!res.ok) throw new Error(`reserve failed: ${res.reason}`);
    await t.action(internal.media.submitBatch, { tenantId: A, batchId: res.batchId });

    const bodies = (fetchMock.mock.calls as Array<[string, RequestInit]>).map(
      ([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>,
    );
    const voice = bodies.filter((b) => "text" in b);
    const clips = bodies.filter((b) => "prompt" in b);
    expect(voice).toHaveLength(2); // not vacuous — both kinds really were submitted
    expect(clips).toHaveLength(2);

    expect(voice.map((b) => b.text).sort()).toEqual(blocks.map((b) => b.narration).sort());
    expect(clips.map((b) => b.prompt).sort()).toEqual(["prompt 0", "prompt 1"]);
    // THE assertion: no voice take carries a shot description.
    expect(voice.some((b) => String(b.text).startsWith("prompt "))).toBe(false);
  });

  test("the webhook segment is the buildAuthorizeUrl construction, per JOB ROW", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { batchId } = await reservedBatch(t);
    await t.action(internal.media.submitBatch, { tenantId: A, batchId });

    const [url] = fetchMock.mock.calls[0] as [string];
    const hook = new URL(url).searchParams.get("fal_webhook") ?? "";
    expect(hook.startsWith("https://example.convex.site/fal/callback/")).toBe(true);

    // Plan 20-06 RE-DERIVES this segment rather than reading a stored hash — so it must be
    // re-derivable here, character for character, from the jobId alone.
    const segment = hook.split("/").pop() ?? "";
    const dot = segment.lastIndexOf(".");
    const jobId = segment.slice(0, dot);
    expect(segment.slice(dot + 1)).toBe(await hmacHex(jobId, "test-secret"));
    // ...and the id in it is a REAL row of this batch, not a batch id or a plan id.
    expect((await rows(t)).some((r) => r._id === jobId)).toBe(true);

    // Two lines, two DIFFERENT segments — the URL binds to one job, never to the tenant.
    const [url2] = fetchMock.mock.calls[1] as [string];
    expect(new URL(url2).searchParams.get("fal_webhook")).not.toBe(hook);
  });

  test("a 422 blocks ONE line and leaves its sibling alone", async () => {
    const t = harness();
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        n += 1;
        return Promise.resolve(
          n === 1
            ? new Response(JSON.stringify({ request_id: "req_1" }), { status: 200 })
            : new Response(JSON.stringify({ type: "content_policy_violation" }), { status: 422 }),
        );
      }),
    );
    stubMediaEnv();
    const { batchId } = await reservedBatch(t);

    // Line 1 (video block 0) is accepted; every later line 422s — including the voice lines, which
    // now ride the same loop. The point is unchanged: a blocked line does not touch its sibling.
    expect(await t.action(internal.media.submitBatch, { tenantId: A, batchId })).toEqual({
      submitted: 1,
      blocked: 3,
      failed: 0,
      skipped: 0,
    });

    const video = (await rows(t)).filter((r) => r.kind === "video");
    const ok = video.find((r) => r.blockIndex === 0);
    const bad = video.find((r) => r.blockIndex === 1);
    expect(ok).toMatchObject({ status: "submitted", falRequestId: "req_1" });
    expect(ok?.verdict).toBeUndefined();
    expect(bad).toMatchObject({
      status: "blocked",
      verdict: "provider_blocked",
      failureReason: "content_policy_violation",
    });
  });

  test("a 5xx fails the line with a code, and the retrier may re-run the action for free", async () => {
    const t = harness();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("boom", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { batchId } = await reservedBatch(t);

    expect(await t.action(internal.media.submitBatch, { tenantId: A, batchId })).toEqual({
      submitted: 0,
      blocked: 0,
      failed: 4,
      skipped: 0,
    });
    expect((await rows(t)).filter((r) => r.status === "failed")).toHaveLength(4);
    // The claim already happened, so the retrier's re-run POSTs nothing — the failure is recorded
    // once and does NOT buy a second attempt at the provider's expense.
    await t.action(internal.media.submitBatch, { tenantId: A, batchId });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("a batch whose plan has no shots fails the line with a code, never an empty prompt", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const planId = await seedPlan(t); // seeded WITHOUT shots
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(1),
      clipSeconds: 10,
      withCaptions: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(
      await t.action(internal.media.submitBatch, { tenantId: A, batchId: res.batchId }),
    ).toEqual({ submitted: 0, blocked: 0, failed: 2, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    // BOTH kinds refuse the same way. A voice line with no block to read is the sharper case: an
    // empty `text` is a valid request that bills for nothing and returns silence.
    for (const kind of ["video", "tts"] as const) {
      expect((await rows(t)).find((r) => r.kind === kind), kind).toMatchObject({
        status: "failed",
        failureReason: "missing_shot",
      });
    }
  });

  test("a missing FAL_WEBHOOK_SECRET refuses the batch BEFORE line 1 is claimed", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    vi.stubEnv("FAL_WEBHOOK_SECRET", "");
    const { batchId } = await reservedBatch(t);

    await expect(t.action(internal.media.submitBatch, { tenantId: A, batchId })).rejects.toThrow(
      /FAL_WEBHOOK_SECRET/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    // Nothing was claimed — every row is still exactly where the reservation left it.
    expect((await rows(t)).every((r) => r.status === "queued")).toBe(true);
  });

  test("FAL_FIXTURE drives the whole batch at $0 — zero fetches, real rows, real tickets", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    vi.stubEnv("FAL_FIXTURE", "1");
    const { batchId } = await reservedBatch(t);

    expect(await t.action(internal.media.submitBatch, { tenantId: A, batchId })).toEqual({
      submitted: 4,
      blocked: 0,
      failed: 0,
      skipped: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    // The voice lines take the SAME $0 seam as the clips — no second fixture branch was added.
    expect((await rows(t)).every((r) => r.falRequestId?.startsWith("fixture-"))).toBe(true);
  });

  test("a cross-tenant batchId submits NOTHING", async () => {
    const t = harness();
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { batchId } = await reservedBatch(t);

    expect(await t.action(internal.media.submitBatch, { tenantId: B, batchId })).toEqual({
      submitted: 0,
      blocked: 0,
      failed: 0,
      skipped: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect((await rows(t)).every((r) => r.status === "queued")).toBe(true);
  });
});

// ── plan 20-06: the fal CALLBACK and the landing plane ─────────────────────────────
//
// Every callback body here is synthesized locally and every asset download is a spy. **$0.**
//
// The route is exercised through `t.fetch` against the REAL `http.ts` router, so the HMAC segment,
// the timestamp window and the 401s are the shipped code paths — not a re-implementation.

const SECRET = "test-secret";
/** Enough "bytes" to prove a store happened and a hash was taken over the real content. */
const ASSET = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

/** A `submitted` row — the state 20-05's `submitBatch` leaves a line in. Seeded directly rather
 *  than reserved: these tests need to choose `kind`, `spec` and `estUsd`, and an `image` row is not
 *  reachable through `reserveJob` at all. */
async function seedLandable(
  t: T,
  opts: {
    kind?: "video" | "image" | "tts" | "stt";
    spec?: Doc<"mediaJobs">["spec"];
    estUsd?: number;
    tenantId?: string;
    clipSeconds?: number;
  } = {},
) {
  const kind = opts.kind ?? "video";
  const planId = await seedPlan(t, opts.tenantId ?? A);
  // 20-14's overrun net measures against the plan's own block length, and SKIPS when there is none.
  // Left unset by default so every pre-existing landing test keeps the shape it was written against.
  if (opts.clipSeconds !== undefined) {
    await t.run(async (ctx) => await ctx.db.patch(planId, { clipSeconds: opts.clipSeconds }));
  }
  const jobId = await t.run(
    async (ctx) =>
      await ctx.db.insert("mediaJobs", {
        tenantId: opts.tenantId ?? A,
        planId,
        batchId: "batch_land",
        blockIndex: 0,
        provider: "fal",
        kind,
        model:
          kind === "video"
            ? MEDIA_DEFAULT_VIDEO.model
            : kind === "image"
              ? MEDIA_DEFAULT_IMAGE.model
              : kind === "stt"
                ? MEDIA_DEFAULT_STT.model
                : MEDIA_DEFAULT_VOICE.model,
        spec:
          opts.spec ??
          (kind === "video"
            ? { kind: "video", resolution: "480p", seconds: 10 }
            : kind === "image"
              ? { kind: "image", width: 1080, height: 1920 }
              : { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 }),
        promptHash: "0".repeat(64),
        status: "submitted",
        falRequestId: "req_1",
        estUsd: opts.estUsd ?? 0.5,
        createdAt: T0,
        updatedAt: T0,
      }),
  );
  return { planId, jobId };
}

const signed = async (jobId: string) => `${jobId}.${await hmacHex(jobId, SECRET)}`;

function post(t: T, segment: string, body: unknown, tsSeconds?: number) {
  return t.fetch(`/fal/callback/${segment}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fal-webhook-timestamp": String(tsSeconds ?? Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify(body),
  });
}

const VIDEO_OK = {
  status: "OK",
  payload: {
    video: {
      url: "https://v3.fal.media/files/panda/clip.mp4",
      content_type: "video/mp4",
      file_name: "clip.mp4",
      file_size: 8,
    },
  },
};
const imageOk = (nsfw: boolean[], width = 1080, height = 1920) => ({
  status: "OK",
  payload: {
    images: [
      { url: "https://v3.fal.media/files/panda/a.png", content_type: "image/png", width, height },
    ],
    seed: 1,
    has_nsfw_concepts: nsfw,
  },
});

/** The asset download. `t.fetch` dispatches into the router in-process rather than through the
 *  global, so stubbing `fetch` intercepts only the handler's own outbound call. */
function assetFetch(type = "video/mp4") {
  return vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(ASSET, { status: 200, headers: { "content-type": type } })),
    );
}

const jobRow = (t: T, jobId: Id<"mediaJobs">) => t.run(async (ctx) => await ctx.db.get(jobId));
const auditRows = (t: T) => t.run(async (ctx) => await ctx.db.query("audit").collect());

describe("POST /fal/callback/* : fail-closed 401, and NOTHING security-relevant from the body", () => {
  test("a wrong digest is 401 and the row is BYTE-unchanged", async () => {
    const t = harness();
    const fetchMock = assetFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { jobId } = await seedLandable(t);
    const before = await jobRow(t, jobId);

    expect((await post(t, `${jobId}.${"0".repeat(64)}`, VIDEO_OK)).status).toBe(401);
    expect(await jobRow(t, jobId)).toEqual(before);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("a segment with no digest at all is 401", async () => {
    const t = harness();
    vi.stubGlobal("fetch", assetFetch());
    stubMediaEnv();
    const { jobId } = await seedLandable(t);
    expect((await post(t, String(jobId), VIDEO_OK)).status).toBe(401);
    expect((await post(t, "", VIDEO_OK)).status).toBe(401);
    expect((await jobRow(t, jobId))?.status).toBe("submitted");
  });

  test("an UNSET FAL_WEBHOOK_SECRET is 401 — the fail-closed env guard", async () => {
    const t = harness();
    vi.stubGlobal("fetch", assetFetch());
    stubMediaEnv();
    const { jobId } = await seedLandable(t);
    const segment = await signed(jobId); // signed with the REAL secret...
    vi.stubEnv("FAL_WEBHOOK_SECRET", ""); // ...which the deployment then does not have

    // Mutation check: delete `if (!secret) return null` from resolveJob and this goes RED — an
    // unset secret would let `hmacHex(raw, "")` produce a digest anyone can compute.
    expect((await post(t, segment, VIDEO_OK)).status).toBe(401);
    expect((await jobRow(t, jobId))?.status).toBe("submitted");
  });

  test("an id that does not normalizeId to a mediaJobs row is 401 — db.get is never reached", async () => {
    const t = harness();
    vi.stubGlobal("fetch", assetFetch());
    stubMediaEnv();
    const { planId } = await seedLandable(t);

    // Garbage, and a WELL-FORMED id from a FOREIGN table. Both refuse.
    expect((await post(t, await signed("not-an-id"), VIDEO_OK)).status).toBe(401);
    expect((await post(t, await signed(planId), VIDEO_OK)).status).toBe(401);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("a timestamp outside +/-300 s is 401 — replay of a captured URL+body dies here", async () => {
    const t = harness();
    vi.stubGlobal("fetch", assetFetch());
    stubMediaEnv();
    const { jobId } = await seedLandable(t);
    const segment = await signed(jobId);
    const now = Math.floor(Date.now() / 1000);

    expect((await post(t, segment, VIDEO_OK, now - 301)).status).toBe(401);
    expect((await post(t, segment, VIDEO_OK, now + 301)).status).toBe(401);
    expect((await jobRow(t, jobId))?.status).toBe("submitted");
    // Not vacuous: the SAME request inside the window lands.
    expect((await post(t, segment, VIDEO_OK, now - 299)).status).toBe(200);
    expect((await jobRow(t, jobId))?.status).toBe("succeeded");
  });

  test("an ABSENT timestamp header is a refusal, not a pass", async () => {
    const t = harness();
    vi.stubGlobal("fetch", assetFetch());
    stubMediaEnv();
    const { jobId } = await seedLandable(t);
    const res = await t.fetch(`/fal/callback/${await signed(jobId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VIDEO_OK),
    });
    expect(res.status).toBe(401);
    expect((await jobRow(t, jobId))?.status).toBe("submitted");
  });
});

describe("the happy path: the bytes land, the URL does not", () => {
  test("a video OK stores the bytes and lands none_reported — NEVER checker_clear", async () => {
    const t = harness();
    const fetchMock = assetFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { jobId } = await seedLandable(t);

    expect((await post(t, await signed(jobId), VIDEO_OK)).status).toBe(200);

    const row = await jobRow(t, jobId);
    expect(row).toMatchObject({
      status: "succeeded",
      // Wan 2.5 publishes NO per-output moderation field. Calling this clear/passed/safe would be
      // a compliance claim fal never made.
      verdict: "none_reported",
      mimeType: "video/mp4",
      bytes: ASSET.byteLength,
    });
    expect(row?.assetStorageId).toBeDefined();
    expect(row?.assetHash).toBe(await contentHash(ASSET));
    // The bytes really are in storage, not merely referenced.
    expect(
      await t.run((ctx) => ctx.storage.getUrl(row?.assetStorageId ?? ("" as Id<"_storage">))),
    ).not.toBeNull();

    // Mutation check target: make the no-moderation video yield checker_clear and this goes RED.
    expect(row?.verdict).not.toBe("checker_clear");

    // NO fal URL survives anywhere on the row. Downloading here is what makes that structural.
    expect(JSON.stringify(row)).not.toMatch(/fal\.media|https?:/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://v3.fal.media/files/panda/clip.mp4");
  });

  test("has_nsfw_concepts drives checker_clear and checker_flagged — both reachable", async () => {
    for (const [flags, verdict] of [
      [[false], "checker_clear"],
      [[true], "checker_flagged"],
    ] as const) {
      const t = harness();
      vi.stubGlobal("fetch", assetFetch("image/png"));
      stubMediaEnv();
      const { jobId } = await seedLandable(t, { kind: "image", estUsd: 0.009 });
      expect((await post(t, await signed(jobId), imageOk([...flags]))).status).toBe(200);
      expect((await jobRow(t, jobId))?.verdict).toBe(verdict);
    }
  });

  test("status ERROR fails the row with a CODE — fal's prose appears nowhere", async () => {
    const t = harness();
    const fetchMock = assetFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { jobId } = await seedLandable(t);

    const res = await post(t, await signed(jobId), {
      status: "ERROR",
      error: "Invalid input: the prompt names a real living person",
    });
    expect(res.status).toBe(200);

    const row = await jobRow(t, jobId);
    expect(row).toMatchObject({ status: "failed", failureReason: "provider_error" });
    expect(row?.assetStorageId).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("living person");
    expect(JSON.stringify(await auditRows(t))).not.toContain("living person");
    expect(fetchMock).toHaveBeenCalledTimes(0); // nothing was downloaded
  });

  test("an UNHANDLED kind fails with a code rather than probing the body for a url", async () => {
    const t = harness();
    const fetchMock = assetFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    // An `stt` row — plan 20-17's arm, and the only kind left without one now that 20-14 wired
    // `tts`. The body deliberately CARRIES a findable url.
    const { jobId } = await seedLandable(t, {
      kind: "stt",
      spec: { kind: "stt", audioMinutes: 1 },
      estUsd: 0.008,
    });

    expect(
      (
        await post(t, await signed(jobId), {
          status: "OK",
          payload: { text: "a transcript", url: "https://v3.fal.media/files/panda/t.json" },
        })
      ).status,
    ).toBe(200);
    expect(await jobRow(t, jobId)).toMatchObject({
      status: "failed",
      failureReason: "unhandled_kind",
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("a non-fal asset host is REFUSED before any fetch — the SSRF gate", async () => {
    const t = harness();
    const fetchMock = assetFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const control = await seedLandable(t);

    for (const url of [
      "https://fal.media.evil.com/x.mp4", // the suffix LOOKS right; the host is not
      "http://v3.fal.media/x.mp4", // plaintext
      "https://169.254.169.254/latest/meta-data/", // the cloud metadata endpoint
      "file:///etc/passwd",
    ]) {
      const fresh = await seedLandable(t);
      const res = await post(t, await signed(fresh.jobId), {
        status: "OK",
        payload: { video: { url } },
      });
      expect(res.status).toBe(200);
      expect((await jobRow(t, fresh.jobId))?.failureReason, url).toMatch(
        /asset_host_refused|bad_asset_url/,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect((await jobRow(t, control.jobId))?.status).toBe("submitted"); // the untouched control
  });

  test("a re-delivered webhook is IDEMPOTENT: no second store, no second spend, no second audit", async () => {
    const t = harness();
    const fetchMock = assetFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "image", estUsd: 0.009 });
    const segment = await signed(jobId);

    expect((await post(t, segment, imageOk([false], 2160, 3840))).status).toBe(200);
    const after = await jobRow(t, jobId);
    const left = await mediaLeft(t);
    expect(await auditRows(t)).toHaveLength(1);

    // At-least-once delivery: the same callback, again.
    expect((await post(t, segment, imageOk([false], 2160, 3840))).status).toBe(200);
    expect(await jobRow(t, jobId)).toEqual(after); // byte-identical row
    expect(await mediaLeft(t)).toBe(left); // the window did not move a second time
    expect(await auditRows(t)).toHaveLength(1); // and no second log line
    expect(fetchMock).toHaveBeenCalledTimes(1); // and no second download
  });

  // ── 20-14: the voice take lands through the SAME code, and that is the claim ──────

  const AUDIO_OK = {
    status: "OK",
    payload: {
      audio: {
        url: "https://v3.fal.media/files/panda/take.wav",
        content_type: "audio/wav",
        file_name: "take.wav",
        file_size: 8,
      },
    },
  };

  test("an AUDIO take lands exactly like a video one — the generic path really is generic", async () => {
    const t = harness();
    const fetchMock = assetFetch("audio/wav");
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "tts", estUsd: 0.0028, clipSeconds: 10 });
    const before = await mediaLeft(t);

    expect((await post(t, await signed(jobId), AUDIO_OK)).status).toBe(200);

    const row = await jobRow(t, jobId);
    expect(row).toMatchObject({
      status: "succeeded",
      // inworld-tts publishes NO moderation field either. "Audio is obviously fine" is exactly the
      // reasoning that would put a compliance claim fal never made onto a row.
      verdict: "none_reported",
      mimeType: "audio/wav",
      bytes: ASSET.byteLength,
    });
    expect(row?.assetHash).toBe(await contentHash(ASSET));
    expect(row?.assetStorageId).toBeDefined();
    // The URL dies at the route here too.
    expect(JSON.stringify(row)).not.toMatch(/fal\.media|https?:/);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://v3.fal.media/files/panda/take.wav");

    // Spend is EXACT by construction (`EXACT_SPEND_KINDS`) — the response carries no duration and
    // no character count, so there is nothing to reconcile and both windows move by exactly 0.
    expect(row?.actualCents).toBe(Math.round(0.0028 * 100));
    expect(await mediaLeft(t)).toBe(before);
    const payload = (await auditRows(t))[0]?.payload as Record<string, unknown>;
    expect(payload.reconciled).toBe("exact_by_construction");
  });

  test("a re-delivered AUDIO callback is idempotent — no second store, no second spend", async () => {
    const t = harness();
    const fetchMock = assetFetch("audio/wav");
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "tts", estUsd: 0.0028, clipSeconds: 10 });
    const segment = await signed(jobId);

    expect((await post(t, segment, AUDIO_OK)).status).toBe(200);
    const after = await jobRow(t, jobId);
    const left = await mediaLeft(t);

    expect((await post(t, segment, AUDIO_OK)).status).toBe(200);
    expect(await jobRow(t, jobId)).toEqual(after);
    expect(await mediaLeft(t)).toBe(left);
    expect(await auditRows(t)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a grossly over-long take is take_too_long and does NOT mark the block ready", async () => {
    const t = harness();
    // 24 kHz mono 16-bit PCM is ~48 KB/s, so 12 s of budget (10 + 2 grace) is ~576,000 bytes.
    // 900,000 implies ~18.75 s — an overrun no ffprobe has run yet to catch.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(new Uint8Array(900_000), {
              status: 200,
              headers: { "content-type": "audio/wav" },
            }),
          ),
        ),
    );
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "tts", estUsd: 0.0028, clipSeconds: 10 });

    expect((await post(t, await signed(jobId), AUDIO_OK)).status).toBe(200);

    const row = await jobRow(t, jobId);
    expect(row).toMatchObject({ status: "failed", failureReason: "take_too_long" });
    // The reel is left UN-RENDERABLE rather than rendering with a word cut off — D8's hard-error
    // direction. Nothing is marked ready and no verdict is claimed.
    expect(row?.verdict).toBeUndefined();
    expect(row?.actualCents).toBeUndefined();
  });

  test("a take INSIDE its window is untouched by the heuristic — it is not a blanket refusal", async () => {
    const t = harness();
    // ~500,000 bytes is ~10.4 s, inside 10 + 2. Not vacuous against the test above: the ONLY
    // difference between the two is the byte count.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(new Uint8Array(500_000), {
              status: 200,
              headers: { "content-type": "audio/wav" },
            }),
          ),
        ),
    );
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "tts", estUsd: 0.0028, clipSeconds: 10 });

    expect((await post(t, await signed(jobId), AUDIO_OK)).status).toBe(200);
    expect(await jobRow(t, jobId)).toMatchObject({ status: "succeeded", verdict: "none_reported" });
  });

  test("a plan with NO clipSeconds SKIPS the net — never 'zero seconds, therefore too long'", async () => {
    const t = harness();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(new Uint8Array(900_000), {
              status: 200,
              headers: { "content-type": "audio/wav" },
            }),
          ),
        ),
    );
    stubMediaEnv();
    // No `clipSeconds` — there is no window to measure against, so there is nothing to compare.
    const { jobId } = await seedLandable(t, { kind: "tts", estUsd: 0.0028 });

    expect((await post(t, await signed(jobId), AUDIO_OK)).status).toBe(200);
    expect((await jobRow(t, jobId))?.status).toBe("succeeded");
  });
});

describe("reconciliation: SKIPPED when there is nothing to reconcile, re-priced when there is", () => {
  const land = async (t: T, jobId: Id<"mediaJobs">, actual?: Record<string, number | string>) =>
    await t.mutation(internal.mediaComplete.landResult, {
      jobId,
      outcome: {
        ok: true,
        // A REAL storage id: v.id("_storage") is validated, so a placeholder string is rejected at
        // the boundary — which is the validator doing its job.
        assetStorageId: await t.run((ctx) => ctx.storage.store(new Blob([ASSET]))),
        assetHash: "a".repeat(64),
        mimeType: "application/octet-stream",
        bytes: 8,
        moderation: null,
        ...(actual === undefined ? {} : { actual }),
      },
    });

  test("an EXACT_SPEND kind is SKIPPED, not faked — window delta exactly 0", async () => {
    const t = harness();
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "tts", estUsd: 0.0028 });
    const before = await mediaLeft(t);

    await land(t, jobId);

    expect((await jobRow(t, jobId))?.actualCents).toBe(Math.round(0.0028 * 100));
    expect(await mediaLeft(t)).toBe(before); // not one cent

    // The distinction the set exists for, made OBSERVABLE. Mutation check: remove "tts" from
    // EXACT_SPEND_KINDS and this flips to "reprice_failed" — the landing would be GUESSING an
    // actual from a value inworld-tts never returns. (The window delta stays 0 either way, which
    // is why the plan's stated window-based mutation check could not fire — see the summary.)
    const payload = (await auditRows(t))[0]?.payload as Record<string, unknown>;
    expect(payload.reconciled).toBe("exact_by_construction");
  });

  test("a re-price UPWARD consumes exactly the delta, on BOTH windows", async () => {
    const t = harness();
    stubMediaEnv();
    // Submitted 1080x1920 = 2.07 MP -> ceil 3 MP -> $0.009 -> 1 cent.
    const { jobId } = await seedLandable(t, { kind: "image", estUsd: 0.009 });
    const before = await mediaLeft(t);

    // fal returned 2160x3840 = 8.29 MP -> ceil 9 MP -> $0.027 -> 3 cents.
    await land(t, jobId, { width: 2160, height: 3840 });

    expect((await jobRow(t, jobId))?.actualCents).toBe(3);
    expect(await mediaLeft(t)).toBe(before - 2); // 3 - 1, and not 3
    const payload = (await auditRows(t))[0]?.payload as Record<string, unknown>;
    expect(payload.reconciled).toBe("repriced");
  });

  test("actual <= est consumes NOTHING and refunds NOTHING", async () => {
    const t = harness();
    stubMediaEnv();
    // Reserved as if 4K, delivered at the submitted size — a real over-reservation.
    const { jobId } = await seedLandable(t, { kind: "image", estUsd: 0.027 });
    const before = await mediaLeft(t);

    await land(t, jobId, { width: 1080, height: 1920 });

    expect((await jobRow(t, jobId))?.actualCents).toBe(1); // the honest actual is recorded...
    expect(await mediaLeft(t)).toBe(before); // ...and the window is NOT credited back
  });

  test("a re-price the TABLE cannot do is recorded, never silently trusted", async () => {
    const t = harness();
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "video", estUsd: 0.5 });
    // fal claims a tier the price table has no row for. That is DRIFT and must be visible.
    await land(t, jobId, { resolution: "4k" });

    const payload = (await auditRows(t))[0]?.payload as Record<string, unknown>;
    expect(payload.reconciled).toBe("reprice_failed");
    expect(payload.resolution).toBe("4k"); // the drift itself reaches the log plane
    expect((await jobRow(t, jobId))?.actualCents).toBe(50); // falls back to the estimate, recorded
  });
});

test("exactly ONE audit row per landing, and its keys are the allow-list", async () => {
  const t = harness();
  vi.stubGlobal("fetch", assetFetch());
  stubMediaEnv();
  const { jobId } = await seedLandable(t);
  await post(t, await signed(jobId), VIDEO_OK);

  const audit = await auditRows(t);
  expect(audit).toHaveLength(1);
  expect(audit[0]?.eventType).toBe("media.landed");
  expect(audit[0]?.actor).toBe("fal");
  // A KEY-SET assertion, not an eyeball: a field added to the payload must be a deliberate edit
  // both here AND in llmRedaction.test.ts's allow-list scan.
  expect(Object.keys((audit[0]?.payload ?? {}) as object).sort()).toEqual(
    [
      "jobId",
      "batchId",
      "planId",
      "falRequestId",
      "kind",
      "model",
      "promptHash",
      "estCents",
      "assetHash",
      "verdict",
      "actualCents",
      "reconciled",
      "resolution",
    ].sort(),
  );
  expect(JSON.stringify(audit[0]?.payload)).not.toMatch(/url|href|http/i);
});
