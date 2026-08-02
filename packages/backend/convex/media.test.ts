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
import { api, internal } from "./_generated/api";
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

// ── The UNRENDERABLE-DECK guard (20-15 follow-up) ──────────────────────────────────────────────
//
// THIS TEST REPLACED A 13 x TEXT DECK, and the replacement is the point. The old
// "D12a AT THE RAIL" test reserved 13 unpaid TEXT blocks to show cent-flooring-once, and it
// PASSED — which is exactly the defect: an unpaid block gets no video line, so nothing writes its
// `blockNN.mp4`, and `assemble_final.sh` (which discovers inputs by index) can never assemble that
// deck. The deck sailed through the money gate and could never become a reel.
//
// The D12a arithmetic it proved is NOT lost: the pure "13 sub-cent lines → 1 cent, not 13" lives
// in `packages/cost/src/media.test.ts`, and the rail-level flooring-ONCE property is re-asserted
// below on a deck that can actually render.

test("an UNRENDERABLE deck is refused BEFORE a cent moves — zero rows, zero consumption", async () => {
  const t = harness();
  const planId = await seedPlan(t);
  const before = await mediaLeft(t);

  for (const type of ["TEXT", "SCREEN REC"] as const) {
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(3, { type, seconds: 5, chars: minCharsFor(5) }),
      clipSeconds: 5,
      withCaptions: false,
    });
    expect(res, `${type} deck was reserved`).toEqual({ ok: false, reason: "unrenderable_block" });
  }

  // A MIXED deck is refused too — one unrenderable block poisons the whole reel, because the
  // assembler asserts `--blocks N` and hard-errors on the first missing clip.
  const mixed = await reserve(t, {
    tenantId: A,
    planId,
    blocks: [
      ...deck(2, { type: "AI", seconds: 5, chars: minCharsFor(5) }),
      ...deck(1, { type: "TEXT", seconds: 5, chars: minCharsFor(5) }),
    ].map((b, i) => ({ ...b, index: i })),
    clipSeconds: 5,
    withCaptions: false,
  });
  expect(mixed).toEqual({ ok: false, reason: "unrenderable_block" });

  // The whole point: nothing was inserted and NO budget was consumed. Without this guard the
  // mixed deck above would have bought two AI clips for a reel that can never assemble.
  expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  expect(await mediaLeft(t)).toBe(before);
});

test("D12a AT THE RAIL: the batch total is rounded ONCE, not per line", async () => {
  const t = harness();
  const planId = await seedPlan(t);
  // A RENDERABLE deck now: 3 AI blocks at 5 s = 3 video lines + 3 voice lines + the flat render.
  // The voice lines are the sub-cent ones (2 x 43 = 86 chars, $0.00086 each) and they are what
  // per-line flooring would round up to a whole cent apiece.
  const res = await reserve(t, {
    tenantId: A,
    planId,
    blocks: deck(3, { type: "AI", seconds: 5, chars: minCharsFor(5) }),
    clipSeconds: 5,
    withCaptions: false,
  });

  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.lineCount).toBe(6); // 3 video + 3 tts; the render line has no row
  // Rounded ONCE, on the TOTAL. The direction is UP — over-reservation is the fail-closed bias
  // (`Math.max(1, Math.ceil(...))`, the same rule the no-refunds note in media.ts names). What
  // D12(a) forbids is not rounding up, it is rounding up THIRTEEN TIMES.
  expect(res.estCents).toBe(Math.ceil(res.estUsd * 100));
  expect(await mediaLeft(t)).toBe(MEDIA_DAILY_BUDGET_CENTS - res.estCents);

  // …and here is the thing per-line rounding would get wrong, stated as the property rather than
  // as a magnitude: the three voice lines are worth LESS THAN ONE CENT IN TOTAL, yet rounding each
  // one up individually charges three whole cents for them.
  const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
  const tts = rows.filter((r) => r.kind === "tts");
  expect(tts).toHaveLength(3);
  expect(tts.reduce((n, r) => n + r.estUsd, 0) * 100).toBeLessThan(1);

  const perLineRounded =
    rows.reduce((n, r) => n + Math.max(1, Math.ceil(r.estUsd * 100)), 0) +
    Math.ceil(MEDIA_SANDBOX_USD_PER_RENDER * 100);
  expect(perLineRounded).toBeGreaterThan(res.estCents);
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
const planRowOf = (t: T, planId: Id<"plans">) => t.run(async (ctx) => await ctx.db.get(planId));
/** Does the blob still exist? Resolved INSIDE the transaction — a Blob is not a Convex type and
 *  cannot be returned across the t.run boundary. */
const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.storage.get(id)) !== null);
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

// ── The render stage's Convex half (MEDIA-01, D11, plan 20-15) ────────────────────────────────
//
// Every test here runs through `MEDIA_SANDBOX_FIXTURE`, which is the DEFAULT in this suite and
// must stay that way: on Hobby an accidental real `Sandbox.create` burns a shared monthly
// Active-CPU allotment whose exhaustion PAUSES creation for 30 days — an OUTAGE, not a bill.
// `handleRenderRequest` itself (the route body) is asserted in `@pikar/core`'s render.test.ts,
// where the SDK is injected; what is asserted HERE is the Convex side: what may be rendered, the
// bearer-guarded blob route, and the render terminal.

const RENDER_SECRET = "test-render-secret";

/** A sidecar the SHIPPED validator accepts, for the defence-in-depth re-check on return. */
const RENDER_SIDECAR = JSON.stringify({
  script: "assemble_final.sh",
  block_count: 2,
  clip_seconds: 10,
  total_duration_s: 20,
  actual_duration_s: 20,
  gates: ["speech_within_window", "no_time_stretch"],
  blocks: [
    {
      block_index: 0,
      window_start_s: 0,
      lead_silence_s: 0.3,
      speech_abs_s: 0.5,
      speech_dur_s: 9,
      overrun: false,
    },
    {
      block_index: 1,
      window_start_s: 10,
      lead_silence_s: 0.3,
      speech_abs_s: 10.5,
      speech_dur_s: 9,
      overrun: false,
    },
  ],
});

function stubRenderEnv() {
  stubMediaEnv();
  vi.stubEnv("MEDIA_RENDER_SECRET", RENDER_SECRET);
  vi.stubEnv("MEDIA_RENDER_URL", "https://app.example.com/api/media/render");
}

/** A batch of N blocks, every line LANDED — the only state a reel may be rendered from. */
async function seedRenderable(
  t: T,
  opts: {
    blocks?: number;
    tenantId?: string;
    batchId?: string;
    missVoice?: boolean;
    unlanded?: boolean;
  } = {},
) {
  const blocks = opts.blocks ?? 2;
  const tenantId = opts.tenantId ?? A;
  const batchId = opts.batchId ?? "batch_render";
  const planId = await seedPlan(t, tenantId);
  const jobIds: Id<"mediaJobs">[] = [];
  await t.run(async (ctx) => {
    for (let i = 0; i < blocks; i++) {
      for (const kind of ["video", "tts"] as const) {
        if (kind === "tts" && opts.missVoice && i === blocks - 1) continue;
        const held = opts.unlanded === true && i === 0 && kind === "video";
        // A DISTINCT blob per row, as production has — each fal asset is stored separately.
        // Sharing one id here hid the fact that the retention loop deletes per row, and it made
        // `storage.delete` throw on the second row of the batch.
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
        );
        jobIds.push(
          await ctx.db.insert("mediaJobs", {
            tenantId,
            planId,
            batchId,
            blockIndex: i,
            provider: "fal",
            kind,
            model: kind === "video" ? MEDIA_DEFAULT_VIDEO.model : MEDIA_DEFAULT_VOICE.model,
            spec:
              kind === "video"
                ? { kind: "video", resolution: "480p", seconds: 10 }
                : { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 },
            promptHash: "0".repeat(64),
            status: held ? "submitted" : "succeeded",
            assetStorageId: held ? undefined : storageId,
            mimeType: kind === "video" ? "video/mp4" : "audio/wav",
            estUsd: 0.5,
            createdAt: T0,
            updatedAt: T0,
          }),
        );
      }
    }
  });
  return { planId, batchId, tenantId, jobIds };
}

const planRow = (t: T, planId: Id<"plans">) => t.run(async (ctx) => await ctx.db.get(planId));

/** Store one blob and hand back its id — the fixture pair every success case needs. */
async function storeBlob(t: T, body: string | Uint8Array<ArrayBuffer>, type: string) {
  return await t.run(async (ctx) => await ctx.storage.store(new Blob([body], { type })));
}

describe("batchToRender: a reel is ALL-OR-NOTHING, and the refusal is free", () => {
  test("returns one input per clip AND per voice take, named the way the script discovers them", async () => {
    const t = harness();
    const { batchId } = await seedRenderable(t, { blocks: 3 });
    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId: A, batchId }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 1-based, zero-padded to two digits — 20-13 pinned these exact names.
    expect(res.value.inputs.map((i) => i.name)).toEqual([
      "block01.mp4",
      "voice01.wav",
      "block02.mp4",
      "voice02.wav",
      "block03.mp4",
      "voice03.wav",
    ]);
    expect(res.value.blockCount).toBe(3);
    expect(res.value.clipSeconds).toBe(10);
  });

  test("REFUSES a batch whose lines have not all landed — no sandbox is worth starting for it", async () => {
    const t = harness();
    const { batchId } = await seedRenderable(t, { unlanded: true });
    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId: A, batchId }),
    );
    expect(res).toEqual({ ok: false, reason: "not_all_succeeded" });
  });

  test("REFUSES a block that has a clip but no voice take — the assembler requires both", async () => {
    const t = harness();
    const { batchId } = await seedRenderable(t, { missVoice: true });
    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId: A, batchId }),
    );
    expect(res).toEqual({ ok: false, reason: "incomplete_blocks" });
  });

  test("is TENANT-SCOPED by the index prefix — B cannot render A's batch", async () => {
    const t = harness();
    const { batchId } = await seedRenderable(t);
    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId: B, batchId }),
    );
    expect(res).toEqual({ ok: false, reason: "empty_batch" });
  });
});

describe("renderReel: fail-closed on the secret, then the offline seam", () => {
  test("an unset MEDIA_RENDER_SECRET refuses BEFORE any fetch exists", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubRenderEnv();
    vi.stubEnv("MEDIA_RENDER_SECRET", "");
    const { batchId } = await seedRenderable(t);

    await expect(
      t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId }),
    ).rejects.toThrow(/MEDIA_RENDER_SECRET/);
    // The assertion that matters: a COUNT of zero, not merely the right message.
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("an unset MEDIA_RENDER_URL refuses the same way", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubRenderEnv();
    vi.stubEnv("MEDIA_RENDER_URL", "");
    const { batchId } = await seedRenderable(t);
    await expect(
      t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId }),
    ).rejects.toThrow(/MEDIA_RENDER_URL/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("with the fixture set, the whole path runs at $0 and NEVER issues a fetch", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubRenderEnv();
    const { planId, batchId } = await seedRenderable(t);
    const sidecarStorageId = await storeBlob(t, RENDER_SIDECAR, "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({
        ok: true,
        mp4StorageId,
        sidecarStorageId,
        renderMs: 91_000,
        gates: [],
        blockCount: 2,
      }),
    );

    const out = await t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId });
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("rendered");
    expect(plan?.renderStorageId).toBe(mp4StorageId);
    expect(plan?.sidecarStorageId).toBe(sidecarStorageId);
    expect(plan?.sidecarHash).toHaveLength(64);
    expect(plan?.renderReason).toBeUndefined();
  });

  test("DEFENCE IN DEPTH: a sidecar the route accepted but OUR validator rejects publishes nothing", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { planId, batchId } = await seedRenderable(t);
    // A sidecar reporting an overrun — D8's hard error. A compromised or buggy route could return
    // `ok: true` for it; re-validating from the bytes that actually landed in OUR storage is what
    // stops an ungoverned reel being published anyway.
    const bad = JSON.parse(RENDER_SIDECAR) as { blocks: Array<{ overrun: boolean }> };
    const target = bad.blocks[1];
    if (target) target.overrun = true;
    const sidecarStorageId = await storeBlob(t, JSON.stringify(bad), "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({
        ok: true,
        mp4StorageId,
        sidecarStorageId,
        renderMs: 1,
        gates: [],
        blockCount: 2,
      }),
    );

    const out = await t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId });
    expect(out).toEqual({ ok: false, reason: "sidecar_rejected_on_return" });
    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("sidecar_rejected_on_return");
    expect(plan?.renderStorageId).toBeUndefined();
  });

  test("a governed stop from the route lands its CODE and publishes nothing", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { planId, batchId } = await seedRenderable(t);
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({ ok: false, code: "speech_out_of_window" }),
    );

    const out = await t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId });
    expect(out).toEqual({ ok: false, reason: "speech_out_of_window" });
    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("speech_out_of_window");
    expect(plan?.renderStorageId).toBeUndefined();
    expect(plan?.sidecarStorageId).toBeUndefined();
  });

  test("exactly ONE audit row per successful render, and its keys are the allow-list", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { batchId } = await seedRenderable(t);
    const sidecarStorageId = await storeBlob(t, RENDER_SIDECAR, "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({
        ok: true,
        mp4StorageId,
        sidecarStorageId,
        renderMs: 91_000,
        gates: [],
        blockCount: 2,
      }),
    );
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId });

    const audit = (await auditRows(t)).filter((r) => r.eventType === "media.rendered");
    expect(audit).toHaveLength(1);
    // Kept in lockstep with llmRedaction.test.ts's MEDIA_AUDIT_ALLOWED — refs, hashes and counts.
    expect(Object.keys((audit[0]?.payload ?? {}) as object).sort()).toEqual(
      ["batchId", "planId", "blockCount", "renderMs", "sidecarHash", "gatesPassed"].sort(),
    );
    expect(JSON.stringify(audit[0]?.payload)).not.toMatch(/url|href|http/i);
    // `gatesPassed` comes from the RE-VALIDATED sidecar, not from what the route claimed: the
    // fixture above returns `gates: []` and this is 2.
    expect((audit[0]?.payload as { gatesPassed: number }).gatesPassed).toBe(2);
  });

  test("a FAILED render writes no audit row at all — a stop is not an event to log", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { batchId } = await seedRenderable(t);
    vi.stubEnv("MEDIA_SANDBOX_FIXTURE", JSON.stringify({ ok: false, code: "decode_failed" }));
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId });
    expect((await auditRows(t)).filter((r) => r.eventType === "media.rendered")).toHaveLength(0);
  });
});

describe("GET /media/blob/* : the same fail-closed bearer, and everything from the ROW", () => {
  const get = (t: T, segment: string, auth?: string) =>
    t.fetch(`/media/blob/${segment}`, {
      method: "GET",
      headers: auth === undefined ? {} : { Authorization: auth },
    });

  test("no bearer, a wrong bearer, and an UNSET secret are all 401", async () => {
    const t = harness();
    stubRenderEnv();
    const { jobIds } = await seedRenderable(t);
    const id = String(jobIds[0]);

    expect((await get(t, id)).status).toBe(401);
    expect((await get(t, id, "Bearer wrong")).status).toBe(401);

    // Mutation check: drop the `!expected` half and this goes RED. `undefined`, NOT `""` — the
    // empty string makes the template `"Bearer "`, and a trailing space is untypeable because
    // header values are trimmed on the way in, so a `""` stub would pass even with the guard
    // removed and prove nothing. `Bearer undefined` is the string a caller can actually send, and
    // it is the exact fail-open `http.ts:92`'s `!expected` half exists to close. Observed red.
    vi.stubEnv("MEDIA_RENDER_SECRET", undefined);
    expect((await get(t, id, "Bearer undefined")).status).toBe(401);
    expect((await get(t, id, `Bearer ${RENDER_SECRET}`)).status).toBe(401);
  });

  test("serves the bytes for a resolved, SUCCEEDED row, with the row's own MIME type", async () => {
    const t = harness();
    stubRenderEnv();
    const { jobIds } = await seedRenderable(t);
    const res = await get(t, String(jobIds[0]), `Bearer ${RENDER_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("404s for garbage, for a FOREIGN-TABLE id, and for a row that has not succeeded", async () => {
    const t = harness();
    stubRenderEnv();
    const { planId, jobIds } = await seedRenderable(t, { unlanded: true });
    const auth = `Bearer ${RENDER_SECRET}`;

    // `normalizeId` refuses both — db.get is never reached with an id from another table.
    expect((await get(t, "not-an-id", auth)).status).toBe(404);
    expect((await get(t, String(planId), auth)).status).toBe(404);
    // Seeded `unlanded`, so block 0's video row is `submitted` with no assetStorageId.
    expect((await get(t, String(jobIds[0]), auth)).status).toBe(404);
  });
});

// ── The CANVAS plane (plan 20-09) ──────────────────────────────────────────────────────────────
//
// Five tenant-guarded reads, six tenant-guarded writes, and the BETA-05 isolation assertion that
// ships WITH the surface rather than after it. Reads return []/null for a foreign tenant; writes
// throw. Every test is $0.

const asA = (t: T) => t.withIdentity({ subject: A });
const asB = (t: T) => t.withIdentity({ subject: B });

/** A plan carrying a real deck, which is what every canvas function reads. */
async function seedDeck(
  t: T,
  opts: { tenantId?: string; blocks?: number; clipSeconds?: number; chars?: number } = {},
) {
  const tenantId = opts.tenantId ?? A;
  const clipSeconds = opts.clipSeconds ?? 10;
  const n = opts.blocks ?? 3;
  const planId = await seedPlan(t, tenantId);
  const shots = Array.from({ length: n }, (_, i) => ({
    index: i,
    type: "AI" as const,
    seconds: clipSeconds,
    windowStartMs: i * clipSeconds * 1000,
    description: `shot ${i}`,
    prompt: `prompt ${i}`,
    narration: "x".repeat(opts.chars ?? minCharsFor(clipSeconds)),
  }));
  await t.run(async (ctx) => await ctx.db.patch(planId, { clipSeconds, shots }));
  return { planId, clipSeconds, shots };
}

describe("the canvas READ plane: two states per block, and a url only when it is earned", () => {
  test("byPlan reports the clip and the voice INDEPENDENTLY", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    // Block 0: voice landed, clip still in flight. Block 1: the reverse. A single merged status
    // could not tell these apart, and they arrive minutes apart through two different webhooks.
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" }));
      const base = {
        tenantId: A,
        planId,
        batchId: "b1",
        provider: "fal" as const,
        promptHash: "0".repeat(64),
        estUsd: 0.1,
        createdAt: T0,
        updatedAt: T0,
      };
      await ctx.db.insert("mediaJobs", {
        ...base, blockIndex: 0, kind: "video", model: MEDIA_DEFAULT_VIDEO.model,
        spec: { kind: "video", resolution: "480p", seconds: 10 }, status: "submitted",
      });
      await ctx.db.insert("mediaJobs", {
        ...base, blockIndex: 0, kind: "tts", model: MEDIA_DEFAULT_VOICE.model,
        spec: { kind: "tts", characters: 200, voice: "v", sampleRateHertz: 24000 },
        status: "succeeded", assetStorageId: storageId,
      });
      await ctx.db.insert("mediaJobs", {
        ...base, blockIndex: 1, kind: "video", model: MEDIA_DEFAULT_VIDEO.model,
        spec: { kind: "video", resolution: "480p", seconds: 10 }, status: "succeeded",
        assetStorageId: storageId,
      });
    });

    const rows = await asA(t).query(api.media.byPlan, { planId });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.clip?.status).toBe("submitted");
    expect(rows[0]?.voice?.status).toBe("succeeded");
    expect(rows[1]?.clip?.status).toBe("succeeded");
    expect(rows[1]?.voice).toBeNull(); // no voice row yet — absent, not "pending"
    // NO url on this read by construction: assetUrls is the only bearer-minting surface.
    expect(JSON.stringify(rows)).not.toMatch(/url/i);
  });

  test("byPlan carries the narration and its count against the live ceiling", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 1, clipSeconds: 5, chars: minCharsFor(5) });
    const rows = await asA(t).query(api.media.byPlan, { planId });
    expect(rows[0]?.narrationChars).toBe(minCharsFor(5));
    expect(rows[0]?.maxChars).toBe(maxCharsFor(5)); // the 5 s band, not the flat 140
    expect(rows[0]?.overCharLimit).toBe(false);
  });

  test("assetUrls yields a NULL url for a line with no asset — a pending tile is not an absent one", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A, planId, batchId: "b1", blockIndex: 0, provider: "fal", kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model, spec: { kind: "video", resolution: "480p", seconds: 10 },
        promptHash: "0".repeat(64), status: "submitted", estUsd: 0.1, createdAt: T0, updatedAt: T0,
      });
    });
    const rows = await asA(t).query(api.media.assetUrls, { planId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBeNull();
    expect(rows[0]?.status).toBe("submitted");
  });

  test("reel returns a NULL url for every status that is not `rendered`", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    for (const status of ["pending", "rendering", "failed"] as const) {
      await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: status }));
      const r = await asA(t).query(api.media.reel, { planId });
      expect(r.status).toBe(status);
      expect(r.url).toBeNull();
    }
  });

  test("reel surfaces the FAILURE REASON, so the canvas can say what happened in words", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch(planId, { renderStatus: "failed", renderReason: "speech_out_of_window" }),
    );
    const r = await asA(t).query(api.media.reel, { planId });
    expect(r).toMatchObject({ status: "failed", url: null, reason: "speech_out_of_window" });
  });

  test("a `rendered` row WITHOUT a renderSummary still yields no url — the sidecar guarantee", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    // `recordRender` writes renderSummary in the SAME patch as the two ids, and only after the
    // sidecar parsed. A row hand-patched to `rendered` therefore cannot surface a reel.
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" }));
      await ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: storageId,
        sidecarStorageId: storageId,
      });
    });
    expect((await asA(t).query(api.media.reel, { planId })).url).toBeNull();
  });

  test("a fully-recorded render surfaces the url, the duration and the gate list", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" }));
      await ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: storageId,
        sidecarStorageId: storageId,
        renderSummary: { durationS: 30, blockCount: 3, gates: ["no_time_stretch", "full_decode"] },
      });
    });
    const r = await asA(t).query(api.media.reel, { planId });
    expect(r.url).toBeTruthy();
    expect(r.durationS).toBe(30);
    expect(r.blockCount).toBe(3);
    expect(r.gates).toEqual(["no_time_stretch", "full_decode"]);
  });
});

describe("jobEstimate: four itemised lines, and the SAME number the rail will consume", () => {
  test("itemises clips, voice, captions and render", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 3 });
    const est = await asA(t).query(api.media.jobEstimate, { planId });

    expect(est.lines.map((l) => l.label)).toEqual(["clips", "voice", "captions", "render"]);
    expect(est.lines[0]?.qty).toBe(3);
    expect(est.lines[1]?.qty).toBe(3);
    expect(est.totalCents).toBeGreaterThan(0);
    expect(est.capCents).toBe(Math.round(MEDIA_JOB_CAP_USD * 100));
    expect(est.refusal).toBeNull();
    // The expensive line must be visible AS a line — that is the whole reason this itemises.
    expect(est.lines[0]?.cents).toBeGreaterThan(est.lines[1]?.cents ?? 0);
  });

  test("THE ANTI-DRIFT ASSERTION: the estimate equals what reserveJobInner actually consumes", async () => {
    const t = harness();
    const { planId, clipSeconds, shots } = await seedDeck(t, { blocks: 4 });
    const est = await asA(t).query(api.media.jobEstimate, { planId });

    // The SAME deck through the rail. A UI that computes its own total and a rail that computes
    // another is the drift this phase exists to prevent, so this is asserted directly and not
    // by eyeball.
    const reserved = await reserve(t, {
      tenantId: A,
      planId,
      blocks: shots,
      clipSeconds,
      withCaptions: true,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(est.totalCents).toBe(reserved.estCents);
  });

  test("jobEstimate CONSUMES NOTHING — it is a query and cannot", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    const before = await mediaLeft(t);
    await asA(t).query(api.media.jobEstimate, { planId });
    await asA(t).query(api.media.jobEstimate, { planId });
    expect(await mediaLeft(t)).toBe(before);
    expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });

  test("names the LEVER: an over-length line comes back with its block index and count", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2, chars: maxCharsFor(10) + 46 });
    const est = await asA(t).query(api.media.jobEstimate, { planId });
    expect(est.refusal).toMatchObject({
      reason: "narration_too_long",
      blockIndex: 0,
      chars: maxCharsFor(10) + 46,
    });
    expect(est.totalCents).toBe(0); // nothing to price until the lever is pulled
  });

  test("names the UNRENDERABLE block too, before the button is ever pressed", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s, i) => (i === 1 ? { ...s, type: "TEXT" } : s));
      await ctx.db.patch(planId, { shots });
    });
    expect(await asA(t).query(api.media.jobEstimate, { planId })).toMatchObject({
      refusal: { reason: "unrenderable_block", blockIndex: 1 },
    });
  });
});

describe("the PAID write plane: one money gate, and a regenerate that cannot leave a stale reel", () => {
  test("generateReel reserves the whole job and schedules the submit", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 3 });
    const before = await mediaLeft(t);

    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await mediaLeft(t)).toBe(before - res.estCents);
    // 3 video + 3 tts + 1 stt. The render line has no row, by construction.
    expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(7);
    expect((await planRowOf(t, planId))?.renderStatus).toBe("pending");
  });

  test("a REFUSED generate schedules nothing and consumes nothing", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2, chars: maxCharsFor(10) + 46 });
    const before = await mediaLeft(t);

    expect(await asA(t).mutation(api.media.generateReel, { planId })).toEqual({
      ok: false,
      reason: "narration_too_long",
    });
    expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(before);
  });

  test("regenerateBlock is a JOB OF ONE BLOCK — clip, voice AND render", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 4 });
    const res = await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 2 });
    expect(res.ok).toBe(true);

    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    expect(rows).toHaveLength(3); // 1 video + 1 tts + 1 stt; NOT the whole four-block deck
    expect(new Set(rows.map((r) => r.blockIndex))).toEqual(new Set([2, -1]));
  });

  test("REGENERATING CLEARS THE RENDER — every artifact field, in the same transaction", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" }));
      await ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: storageId,
        sidecarStorageId: storageId,
        sidecarHash: "a".repeat(64),
        renderedAt: T0,
        renderSummary: { durationS: 20, blockCount: 2, gates: ["g"] },
      });
    });

    await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 0 });

    // A canvas showing a stale final.mp4 beside a freshly regenerated block is lying to the user,
    // and it is a lie they would only find by watching the whole reel.
    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("pending");
    expect(plan?.renderStorageId).toBeUndefined();
    expect(plan?.sidecarStorageId).toBeUndefined();
    expect(plan?.sidecarHash).toBeUndefined();
    expect(plan?.renderedAt).toBeUndefined();
    expect(plan?.renderSummary).toBeUndefined();
    // …and the reel query agrees, which is the property the user actually experiences.
    expect((await asA(t).query(api.media.reel, { planId })).url).toBeNull();
  });
});

describe("the FREE editor: five affordances, none of which costs a cent", () => {
  test("editing a prompt or a narration line costs nothing and clears the render", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    const before = await mediaLeft(t);
    await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: "rendered" }));

    expect(await asA(t).mutation(api.media.editBlockPrompt, { planId, blockIndex: 0, prompt: "new" })).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.shots?.[0]?.prompt).toBe("new");
    expect((await planRowOf(t, planId))?.renderStatus).toBe("pending");

    const line = "y".repeat(minCharsFor(10));
    expect(await asA(t).mutation(api.media.editBlockNarration, { planId, blockIndex: 1, narration: line })).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.shots?.[1]?.narration).toBe(line);

    expect(await mediaLeft(t)).toBe(before);
    expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });

  test("an over-length narration edit is REFUSED with the same count the rail would report", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 1 });
    const tooLong = "z".repeat(maxCharsFor(10) + 46);
    // Without this cure, `narration_too_long` from the rail is a dead end: the user is told the
    // line is too long and has no way to shorten it.
    expect(
      await asA(t).mutation(api.media.editBlockNarration, { planId, blockIndex: 0, narration: tooLong }),
    ).toMatchObject({ ok: false, reason: "narration_too_long", chars: tooLong.length });
    expect((await planRowOf(t, planId))?.shots?.[0]?.narration).not.toBe(tooLong);
  });

  test("reorder permutes, renumbers and recomputes the windows — and rejects a non-permutation", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 3 });
    const promptsBefore = (await planRowOf(t, planId))?.shots?.map((s) => s.prompt);

    expect(await asA(t).mutation(api.media.reorderBlocks, { planId, order: [2, 0, 1] })).toEqual({ ok: true });
    const after = await planRowOf(t, planId);
    expect(after?.shots?.map((s) => s.prompt)).toEqual([
      promptsBefore?.[2], promptsBefore?.[0], promptsBefore?.[1],
    ]);
    expect(after?.shots?.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(after?.shots?.map((s) => s.windowStartMs)).toEqual([0, 10_000, 20_000]);

    for (const bad of [[0, 1], [0, 1, 5], [0, 0, 1]]) {
      expect(await asA(t).mutation(api.media.reorderBlocks, { planId, order: bad })).toEqual({
        ok: false, reason: "not_a_permutation",
      });
    }
  });

  test("delete splices and renumbers, and refuses to empty the deck", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    expect(await asA(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 })).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.shots?.map((s) => s.index)).toEqual([0]);
    expect(await asA(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 })).toEqual({
      ok: false, reason: "last_block",
    });
  });

  test("a landed job keeps its OWN blockIndex across a reorder — the snapshot is authoritative", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A, planId, batchId: "b1", blockIndex: 0, provider: "fal", kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model, spec: { kind: "video", resolution: "480p", seconds: 10 },
        promptHash: "0".repeat(64), status: "succeeded", estUsd: 0.1, createdAt: T0, updatedAt: T0,
      });
    });
    await asA(t).mutation(api.media.reorderBlocks, { planId, order: [1, 0] });
    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    // Re-pointing a landed asset at a different block's tile would be worse than leaving it.
    expect(rows[0]?.blockIndex).toBe(0);
  });
});

describe("BETA-05 ISOLATION: tenant B cannot read, spend or edit tenant A's canvas", () => {
  test("every READ returns empty for the wrong tenant", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { tenantId: A, blocks: 2 });
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" }));
      await ctx.db.patch(planId, {
        renderStatus: "rendered", renderStorageId: storageId, sidecarStorageId: storageId,
        renderSummary: { durationS: 20, blockCount: 2, gates: ["g"] },
      });
    });

    // A sees it…
    expect(await asA(t).query(api.media.byPlan, { planId })).toHaveLength(2);
    expect((await asA(t).query(api.media.reel, { planId })).url).toBeTruthy();

    // …and B gets NOTHING, including no signed URL.
    // MUTATION CHECK: drop `plan.tenantId !== ctx.tenantId` from assetUrls and this goes RED.
    expect(await asB(t).query(api.media.byPlan, { planId })).toEqual([]);
    expect(await asB(t).query(api.media.assetUrls, { planId })).toEqual([]);
    const bReel = await asB(t).query(api.media.reel, { planId });
    expect(bReel.url).toBeNull();
    expect(bReel.status).toBeNull();
    expect((await asB(t).query(api.media.jobEstimate, { planId })).totalCents).toBe(0);
  });

  test("every WRITE throws for the wrong tenant — reads return [], writes throw", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { tenantId: A, blocks: 2 });
    const before = await mediaLeft(t);

    const line = "y".repeat(minCharsFor(10));
    await expect(asB(t).mutation(api.media.generateReel, { planId })).rejects.toThrow(/plan not found/);
    await expect(asB(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 0 })).rejects.toThrow(/plan not found/);
    await expect(asB(t).mutation(api.media.editBlockPrompt, { planId, blockIndex: 0, prompt: "x" })).rejects.toThrow(/plan not found/);
    await expect(asB(t).mutation(api.media.editBlockNarration, { planId, blockIndex: 0, narration: line })).rejects.toThrow(/plan not found/);
    await expect(asB(t).mutation(api.media.reorderBlocks, { planId, order: [1, 0] })).rejects.toThrow(/plan not found/);
    await expect(asB(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 })).rejects.toThrow(/plan not found/);

    // Nothing moved: no rows, no budget, no edits.
    expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(before);
    expect((await planRowOf(t, planId))?.shots?.[0]?.prompt).toBe("prompt 0");
  });

  test("an UNAUTHENTICATED caller reaches none of it", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    await expect(t.query(api.media.byPlan, { planId })).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.mutation(api.media.generateReel, { planId })).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

// ── The RENDER TRIGGER and D12(b) RETENTION (plan 20-16) ──────────────────────────────────────
//
// The last landing starts the render. There is no chain, no poller and no ticker — `landResult`
// already runs on every arrival inside a serializable mutation, so the `pending -> rendering`
// transition IS the once-only guard.

/** A batch mid-flight: every renderable row still `submitted`, the plan at `pending`. */
async function seedInFlight(t: T, opts: { blocks?: number; batchId?: string } = {}) {
  const blocks = opts.blocks ?? 2;
  const batchId = opts.batchId ?? "batch_trigger";
  const planId = await seedPlan(t, A);
  const jobIds: Id<"mediaJobs">[] = [];
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, { renderStatus: "pending", clipSeconds: 10 });
    for (let i = 0; i < blocks; i++) {
      for (const kind of ["video", "tts"] as const) {
        jobIds.push(
          await ctx.db.insert("mediaJobs", {
            tenantId: A,
            planId,
            batchId,
            blockIndex: i,
            provider: "fal",
            kind,
            model: kind === "video" ? MEDIA_DEFAULT_VIDEO.model : MEDIA_DEFAULT_VOICE.model,
            spec:
              kind === "video"
                ? { kind: "video", resolution: "480p", seconds: 10 }
                : { kind: "tts", characters: 100, voice: "v", sampleRateHertz: 24000 },
            promptHash: "0".repeat(64),
            status: "submitted",
            falRequestId: `req_${i}_${kind}`,
            estUsd: 0.1,
            createdAt: T0,
            updatedAt: T0,
          }),
        );
      }
    }
  });
  return { planId, batchId, jobIds };
}

/** Land one row through the real `landResult`, as the webhook would. */
const land = (t: T, jobId: Id<"mediaJobs">, ok = true) =>
  t.run(
    async (ctx) =>
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId,
        outcome: ok
          ? {
              ok: true,
              assetStorageId: await ctx.storage.store(
                new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
              ),
              assetHash: "b".repeat(64),
              mimeType: "video/mp4",
              bytes: 3,
              moderation: null,
            }
          : { ok: false, code: "provider_error" },
      }),
  );

describe("the render TRIGGER: the last landing starts it, exactly once, with no poller", () => {
  test("an EARLIER landing schedules nothing and leaves the status at pending", async () => {
    const t = harness();
    const { planId, jobIds } = await seedInFlight(t, { blocks: 2 });
    await land(t, jobIds[0] as Id<"mediaJobs">);
    expect((await planRowOf(t, planId))?.renderStatus).toBe("pending");
  });

  test("the LAST landing moves pending -> rendering", async () => {
    const t = harness();
    const { planId, jobIds } = await seedInFlight(t, { blocks: 2 });
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    expect((await planRowOf(t, planId))?.renderStatus).toBe("rendering");
  });

  test("A SECOND arrival cannot start a second render — the transition IS the guard", async () => {
    const t = harness();
    const { planId, jobIds } = await seedInFlight(t, { blocks: 1 });
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    expect((await planRowOf(t, planId))?.renderStatus).toBe("rendering");

    // A re-delivered webhook for an already-terminal row. A double render is a double sandbox.
    await land(t, jobIds[0] as Id<"mediaJobs">);
    expect((await planRowOf(t, planId))?.renderStatus).toBe("rendering");
  });

  test("a FAILED sibling means incomplete_batch and NO render — the sandbox is never bought", async () => {
    const t = harness();
    const { planId, jobIds } = await seedInFlight(t, { blocks: 2 });
    await land(t, jobIds[0] as Id<"mediaJobs">, false); // the clip fails
    for (const id of jobIds.slice(1)) await land(t, id as Id<"mediaJobs">);

    // D8's fixed-window contract makes a missing clip a HARD ERROR, so this render is already
    // known to fail. Finding that out in the sandbox costs a sandbox.
    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("incomplete_batch");
    expect(plan?.renderStorageId).toBeUndefined();
  });

  test("a pending STT line does NOT hold the reel hostage — captions are POST-assembly (D8)", async () => {
    const t = harness();
    const { planId, batchId, jobIds } = await seedInFlight(t, { blocks: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A, planId, batchId, blockIndex: -1, provider: "fal", kind: "stt",
        model: MEDIA_DEFAULT_STT.model, spec: { kind: "stt", audioMinutes: 0.5 },
        promptHash: "0".repeat(64), status: "queued", estUsd: 0.01, createdAt: T0, updatedAt: T0,
      });
    });
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    // The STT row is still `queued` and the render fired anyway, on the video+tts set alone.
    expect((await planRowOf(t, planId))?.renderStatus).toBe("rendering");
  });

  test("a batch whose plan was never approved for a render is left alone", async () => {
    const t = harness();
    const { planId, jobIds } = await seedInFlight(t, { blocks: 1 });
    await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: undefined }));
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    expect((await planRowOf(t, planId))?.renderStatus).toBeUndefined();
  });
});

describe("D12(b) RETENTION: delete on success, KEEP on failure", () => {
  /** Drive a full render through the offline seam and return the batch's rows afterwards. */
  async function renderThrough(t: T, fixture: Record<string, unknown>) {
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    vi.stubEnv("MEDIA_SANDBOX_FIXTURE", JSON.stringify(fixture));
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, batchId });
    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    return { planId, rows };
  }

  test("a SUCCESSFUL render deletes every intermediate and unsets every field", async () => {
    const t = harness();
    const sidecarStorageId = await storeBlob(t, RENDER_SIDECAR, "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    const { planId, rows } = await renderThrough(t, {
      ok: true, mp4StorageId, sidecarStorageId, renderMs: 1000, gates: [], blockCount: 2,
    });

    // The FIELDS are unset…
    expect(rows.every((r) => r.assetStorageId === undefined)).toBe(true);
    expect(rows.length).toBeGreaterThan(0); // …and the scan is not vacuous.

    // The DELIVERABLE is kept — deleting it would delete the thing the user asked for.
    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("rendered");
    // Existence is resolved INSIDE the transaction: a Blob is not a Convex type and cannot cross
    // the t.run boundary.
    expect(await blobExists(t, mp4StorageId)).toBe(true);
    expect(await blobExists(t, sidecarStorageId)).toBe(true);
  });

  test("a FAILED render KEEPS every intermediate — the half that is easy to get backwards", async () => {
    const t = harness();
    const { planId, rows } = await renderThrough(t, { ok: false, code: "decode_failed" });

    // The intermediates are the only debugging evidence a failed render leaves.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.assetStorageId !== undefined)).toBe(true);
    for (const r of rows) {
      expect(r.assetStorageId).toBeDefined();
      if (r.assetStorageId) expect(await blobExists(t, r.assetStorageId)).toBe(true);
    }
    expect((await planRowOf(t, planId))?.renderStatus).toBe("failed");
  });

  test("a FAILED render writes ONE dead letter, refs and codes only", async () => {
    const t = harness();
    await renderThrough(t, { ok: false, code: "speech_out_of_window" });
    const dl = await t.run(async (ctx) => await ctx.db.query("deadLetters").collect());
    expect(dl).toHaveLength(1);
    expect(Object.keys((dl[0]?.payload ?? {}) as object).sort()).toEqual(
      ["batchId", "planId", "reasonCode"].sort(),
    );
    // No ffmpeg output, no filename, no narration, no URL.
    expect(JSON.stringify(dl[0]?.payload)).not.toMatch(/url|href|http|\.mp4|\.wav/i);
    expect(dl[0]?.error).toBe("speech_out_of_window");
  });

  test("a SUCCESSFUL render writes no dead letter at all", async () => {
    const t = harness();
    const sidecarStorageId = await storeBlob(t, RENDER_SIDECAR, "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    await renderThrough(t, {
      ok: true, mp4StorageId, sidecarStorageId, renderMs: 1, gates: [], blockCount: 2,
    });
    expect(await t.run(async (ctx) => await ctx.db.query("deadLetters").collect())).toHaveLength(0);
  });

  test("the deletion is IDEMPOTENT — a second terminal over a cleaned batch is a no-op", async () => {
    const t = harness();
    const sidecarStorageId = await storeBlob(t, RENDER_SIDECAR, "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    const { planId } = await seedRenderable(t, { blocks: 2 });

    const result = {
      ok: true as const,
      renderStorageId: mp4StorageId,
      sidecarStorageId,
      sidecarHash: "c".repeat(64),
      blockCount: 2,
      renderMs: 1,
      gatesPassed: 2,
      summary: { durationS: 20, blockCount: 2, gates: ["g", "h"] },
    };
    const run = () =>
      t.run(async (ctx) =>
        ctx.runMutation(internal.render.renderReel.recordRender, {
          tenantId: A, planId, batchId: "batch_render", result,
        }),
      );
    await run();
    await expect(run()).resolves.not.toThrow(); // no "Delete on non-existent doc"
  });
});
