// @vitest-environment node
//
// The media budget rail + the transactional JOB reservation (MEDIA-01, D10, plan 20-04).
//
// Every assertion here is $0: nothing in this file calls fal, OpenAI or Vercel. The `node`
// environment matches the research.test.ts / dispatch.test.ts harness idiom — convex-test's lazy
// module loader pulls every convex module, and some of them are "use node".
import retrierTest from "@convex-dev/action-retrier/test";
import type { Block, Scene, ShotType } from "@pikar/core/storyboard";
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
  MEDIA_VIDEO_SECONDS,
  type MediaSpec,
} from "@pikar/cost/media";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
// The reserve drives the REAL rate-limiter component (relative import — the packages block deep
// specifiers). guardrails.test.ts carries the same line for the same reason.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
// 33-05: `saveReelToVault` starts the ingest workflow, so the harness needs the workflow
// component (+ its inner workpool) registered — the research.test.ts pair, verbatim.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { hmacHex } from "./gmailAuth";
import { DEPLOYMENT_MEDIA_BUDGET_CENTS, MEDIA_DAILY_BUDGET_CENTS } from "./guardrails";
import { contentHash } from "./lib/hash";
import {
  buildSubmitBody,
  reserveJobInner,
  reserveSceneJobInner,
  type SubmittableSpec,
  sceneDeckOf,
  submitLine,
} from "./media";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;

/** A harness with the rate-limiter component registered — every reserve touches it. `auditCounts`
 *  joined it in 20-06: the landing writes an audit row, and `audit.log` mirrors every insert into
 *  the aggregate (calendar.test.ts carries the same pair of lines). */
/** Every harness handed out in this file, so `afterEach` can drain each one's scheduled tail.
 *  See the afterEach below for why that matters. */
const liveHarnesses: T[] = [];

function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  // 33-05: the vault save at the pipeline terminals calls `startIngest` (workflow.start).
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  // 25.1-01 (D2): every render is scheduled through the ActionRetrier now.
  retrierTest.register(t);
  liveHarnesses.push(t);
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
  {
    type = "AI" as ShotType,
    seconds = MEDIA_DEFAULT_VIDEO.seconds,
    chars = maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds),
  }: { type?: ShotType; seconds?: number; chars?: number } = {},
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

/** The reference job: six paid Sora blocks at the default duration, with captions. */
const JOB_41 = () => deck(6);
// 6 x $0.40 clips + 6 voice lines at 2 x 56 chars ($0.01008) + one rounded-up STT minute
// ($0.006) + the flat render, DOUBLED at its source to cover the one automatic retry sandbox
// (33-04: $0.02 -> $0.04 — a deliberate money change, noted in the playbook).
const JOB_41_USD = 2.45608;
const JOB_41_CENTS = 246;
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
        clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
    const clips =
      6 *
      MEDIA_DEFAULT_VIDEO.seconds *
      (MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model]?.[MEDIA_DEFAULT_VIDEO.resolution] ?? 0);
    const voice = 6 * ((2 * maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds)) / 1000) * 0.015; // 2x — rewrite allowance
    const stt = 1 * 0.006; // the sub-minute input is billed as one minute
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
    expect(all.every((r) => r.provider === "openai")).toBe(true);
    expect(all.every((r) => r.tenantId === A && r.planId === planId)).toBe(true);
    expect(all.every((r) => r.estUsd > 0)).toBe(true);
    expect(all.every((r) => r.promptHash.length === 64)).toBe(true);
    expect(all.every((r) => r.providerRequestId === undefined)).toBe(true);
    // The deck-wide captions row is not a block's row.
    expect(all.find((r) => r.kind === "stt")?.blockIndex).toBe(-1);
    // No render row: the render is a plan-row concern, with no falRequestId and no webhook.
    expect(all.some((r) => (r.kind as string) === "render")).toBe(false);
    // The resolution is PINNED on the row — never left to a provider default.
    const video = all.find((r) => r.kind === "video");
    expect(video?.spec).toMatchObject({
      kind: "video",
      resolution: MEDIA_DEFAULT_VIDEO.resolution,
      seconds: MEDIA_DEFAULT_VIDEO.seconds,
    });
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        }),
      ),
      ...blocks.map(
        (b): MediaSpec => ({
          kind: "tts",
          model: MEDIA_DEFAULT_VOICE.model,
          characters: b.narration.length,
        }),
      ),
      { kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes: 1 },
      { kind: "render" },
    ];
    const raw = chooseMediaBatch(onceOver, MEDIA_JOB_CAP_USD);
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    const oneVoicePass = (6 * maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds) * 0.015) / 1000;
    expect(res.estUsd - raw.value.estUsd).toBeCloseTo(oneVoicePass, 6);
  });
});

// ── the cap refusals ───────────────────────────────────────────────────────────────

describe("over_job_cap: the cap is bounded by the CLIPS", () => {
  test("12 default Sora blocks are refused — zero rows, zero consumption", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(12),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: true,
    });
    expect(res).toEqual({ ok: false, reason: "over_job_cap" });
    expect(await rows(t)).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(MEDIA_DAILY_BUDGET_CENTS);
  });

  test("eight default clips pass while nine cross the existing cap", () => {
    const at = (count: number): MediaSpec[] =>
      Array.from({ length: count }, () => ({
        kind: "video" as const,
        model: MEDIA_DEFAULT_VIDEO.model,
        resolution: MEDIA_DEFAULT_VIDEO.resolution,
        seconds: MEDIA_DEFAULT_VIDEO.seconds,
      }));
    expect(chooseMediaBatch(at(8), MEDIA_JOB_CAP_USD).ok).toBe(true);
    const over = chooseMediaBatch(at(9), MEDIA_JOB_CAP_USD);
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
      blocks: deck(3, { chars: maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds) + 1 }),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      blocks: deck(3, { chars: minCharsFor(MEDIA_DEFAULT_VIDEO.seconds) - 1 }),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: false,
    });
    expect(res).toEqual({ ok: false, reason: "narration_too_short" });
    expect(await rows(t)).toHaveLength(0);
  });

  test("the band travels with the block length — 56 at 4 s, not 168 at 12 s", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    // 120 characters clears the 12-second ceiling and BLOWS the 4-second one. A flat ceiling
    // would have let this reach a reservation and then hard-error in the render sandbox.
    //
    // 4 and 12, not 5 and 10: after the OpenAI cutover the pinned model's grid is [4,8,12], so a
    // 5-second deck is refused as `illegal_duration` before the band is ever consulted — which
    // would have made this test pass for the WRONG reason.
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: deck(3, { seconds: 4, chars: 120 }),
      clipSeconds: 4,
      withCaptions: false,
    });
    expect(res).toEqual({ ok: false, reason: "narration_too_long" });
    expect(120).toBeLessThan(maxCharsFor(12)); // not vacuous: the SAME line is legal at 12 s
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
      blocks: deck(3, { type, seconds: 4, chars: minCharsFor(4) }),
      clipSeconds: 4,
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
      ...deck(2, { type: "AI", seconds: 4, chars: minCharsFor(4) }),
      ...deck(1, { type: "TEXT", seconds: 4, chars: minCharsFor(4) }),
    ].map((b, i) => ({ ...b, index: i })),
    clipSeconds: 4,
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
  // A RENDERABLE deck now: 3 AI blocks at 4 s = 3 video lines + 3 voice lines + the flat render.
  // The voice lines are the sub-cent ones and they are what
  // per-line flooring would round up to a whole cent apiece.
  const res = await reserve(t, {
    tenantId: A,
    planId,
    blocks: deck(3, {
      type: "AI",
      seconds: MEDIA_DEFAULT_VIDEO.seconds,
      chars: minCharsFor(MEDIA_DEFAULT_VIDEO.seconds),
    }),
    clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: true,
    } as const;
    // Four jobs fit in the tenant window. The fifth cannot.
    for (let i = 0; i < 4; i++) expect((await reserve(t, job)).ok).toBe(true);
    const rowsBefore = (await rows(t)).length;
    expect(rowsBefore).toBe(4 * JOB_41_LINES);

    const res = await reserve(t, job);

    expect(res).toEqual({ ok: false, reason: "media_daily_exhausted" });
    expect((await rows(t)).length).toBe(rowsBefore); // all-or-nothing
    expect(await mediaLeft(t, A)).toBe(MEDIA_DAILY_BUDGET_CENTS - 4 * JOB_41_CENTS);
  });

  test("the KEYLESS ceiling refuses independently, with its own distinct reason", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const job = (tenantId: string) =>
      ({
        tenantId,
        planId,
        blocks: JOB_41(),
        clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
        withCaptions: true,
      }) as const;

    // Many tenants, each individually modest (3 jobs = 915 < its own 1000 allowance), together
    // exceeding the 10,000 ceiling. No single tenant is over its own window, so only the global
    // rail can refuse here.
    let sawCeiling = false;
    outer: for (let i = 0; i < 12 && !sawCeiling; i++) {
      for (let j = 0; j < 4; j++) {
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
    clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
    withCaptions: true,
  } as const;

  // Leave room for exactly one more job.
  for (let i = 0; i < 3; i++) expect((await reserve(t, job)).ok).toBe(true);
  const room = await mediaLeft(t, A);
  expect(room).toBe(MEDIA_DAILY_BUDGET_CENTS - 3 * JOB_41_CENTS);
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
  expect(await rows(t)).toHaveLength(4 * JOB_41_LINES);
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
        provider: s.kind === "video" || s.kind === "image" ? "wan" : "openai",
        kind: s.kind,
        model:
          s.kind === "video"
            ? MEDIA_DEFAULT_VIDEO.model
            : s.kind === "image"
              ? MEDIA_DEFAULT_IMAGE.model
              : s.kind === "stt"
                ? MEDIA_DEFAULT_STT.model
                : MEDIA_DEFAULT_VOICE.model,
        spec:
          s.kind === "video"
            ? {
                kind: "video",
                resolution: MEDIA_DEFAULT_VIDEO.resolution,
                seconds: MEDIA_DEFAULT_VIDEO.seconds,
              }
            : s.kind === "tts"
              ? { kind: "tts", characters: 280, voice: "nova", sampleRateHertz: 24000 }
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
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
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
  seconds: MEDIA_DEFAULT_VIDEO.seconds,
};
const TTS: SubmittableSpec = {
  kind: "tts",
  model: MEDIA_DEFAULT_VOICE.model,
  characters: 140,
  voice: MEDIA_DEFAULT_VOICE.voice,
  sampleRateHertz: MEDIA_DEFAULT_VOICE.sampleRateHertz,
};

/** Sora task accept, one distinct video id per call. A fresh Response per call is REQUIRED:
 *  a body is a single-read stream, so `mockResolvedValue(new Response(...))` would hand the same
 *  consumed object to call 2 and every test asserting N submits would be a lie. */
function acceptFetch() {
  let n = 0;
  return vi.fn().mockImplementation(() => {
    n += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ id: `req_${n}`, status: "queued" }), {
        status: 200,
      }),
    );
  });
}

function stubMediaEnv() {
  vi.stubEnv("Video_and_image_API_Key", "test-key");
  vi.stubEnv("WAN_API_BASE_URL", "https://workspace.ap-southeast-1.maas.aliyuncs.com");
  vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
  vi.stubEnv("FAL_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
}

afterEach(async () => {
  // CROSS-TEST LEAK, and it is this file's own doing: 25.1-01 (D2) made every render a RETRIER
  // run, and a retrier run is a SCHEDULED FUNCTION. A test that asserts a render was scheduled and
  // then ends leaves that action in flight — it executes during a LATER test and calls the global
  // `fetch` that the later test stubbed for its own assertion. The symptom is a test that never
  // touches the network failing with "expected fetch 0 times, got 2", non-deterministically,
  // depending on which test happened to be running when the tail landed.
  //
  // Draining here — BEFORE the unstubs, so any call lands on the mock of the test that caused it —
  // keeps each test's async tail inside its own test. `finishInProgressScheduledFunctions` and not
  // `finishAllScheduledFunctions`: the media pollers reschedule themselves on a 10s delay, and
  // chasing those would never terminate.
  for (const t of liveHarnesses.splice(0)) {
    try {
      await t.finishInProgressScheduledFunctions();
    } catch {
      // A drained action may legitimately throw (a test that deliberately stubbed no render env).
      // Running it HERE rather than inside the next test is the entire point.
    }
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildSubmitBody: the body is a function of the PRICED spec, and nothing else", () => {
  test("the video body pins every priced Sora field", () => {
    expect(buildSubmitBody(VIDEO, "a lighthouse at dusk")).toEqual({
      model: MEDIA_DEFAULT_VIDEO.model,
      prompt: "a lighthouse at dusk",
      seconds: String(MEDIA_DEFAULT_VIDEO.seconds),
      size: "720x1280",
    });
  });

  test("duration remains the submitted OpenAI string enum", () => {
    const body = buildSubmitBody({ ...VIDEO, seconds: 8 }, "p");
    expect(body.seconds).toBe("8");
  });

  test("a DIFFERENT priced tier travels through unchanged — the field is not a hardcoded 480p", () => {
    // Not vacuous: were `resolution` dropped from the arm, the test above would still see the key
    // absent, but THIS one proves the value tracks the spec rather than a constant.
    expect(buildSubmitBody({ ...VIDEO, resolution: "1080p" }, "p").size).toBe("1080x1920");
    expect(buildSubmitBody({ ...VIDEO, resolution: "720p" }, "p").size).toBe("720x1280");
  });

  test("NO audio field is sent, on any video submit", () => {
    // The endpoint has no audio toggle (20-01 preflight): the only audio field is `audio_url` and
    // we never send one. A clip's own native track is ducked to SFXVOL 0.20 under the voice bed by
    // `render/assemble_final.sh`'s LEVEL LAW — Open Question 5 resolves at the assembler.
    const keys = Object.keys(buildSubmitBody(VIDEO, "p"));
    expect(keys.filter((k) => /audio/i.test(k))).toEqual([]);
  });

  test("the image body pins size, one output, and no rewrite/watermark", () => {
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
      model: MEDIA_DEFAULT_IMAGE.model,
      prompt: "a poster",
      n: 1,
      size: "1024x1536",
      quality: "low",
      output_format: "png",
    });
  });

  test("the switch ends in a `never` binding, and no `default` returns a body", () => {
    expect(mediaCode).toMatch(/const\s+_never\s*:\s*never\s*=\s*spec/);
    expect(mediaCode).not.toMatch(/default:\s*\n?\s*return\s*\{/);
  });

  // ── 20-14: the voiceover arm ──────────────────────────────────────────────────

  test("the OpenAI TTS body pins model, WAV, voice, and neutral speed", () => {
    // Exact equality, not a property spot-check: this single assertion is what makes the two
    // mutation checks below fire, and it is the only thing standing between D8 and a `speed` knob.
    expect(buildSubmitBody(TTS, "Six weeks, start to finish.")).toEqual({
      model: "tts-1",
      input: "Six weeks, start to finish.",
      voice: MEDIA_DEFAULT_VOICE.voice,
      response_format: "wav",
      speed: 1,
    });
  });

  test("NO time-stretch knob is submitted, under any name — delta pitfall 15's tripwire", () => {
    // `fal-ai/inworld-tts` has no `speed`/`rate` field at all, so D8's no-time-stretch rule is
    // enforced by the PROVIDER rather than by our discipline. This asserts we never start sending
    // one anyway — e.g. after a swap to `fal-ai/kokoro/*`, which exposes `speed: 0.1-5.0`.
    const body = buildSubmitBody(TTS, "p");
    expect(body.speed).toBe(1);
    expect(Object.keys(body).filter((k) => /tempo|setpts|stretch|pace/i.test(k))).toEqual([]);
  });

  test("the narration is submitted VERBATIM — never truncated, never re-wrapped", () => {
    // A silent truncation ships a voiceover missing its last words, with no error anywhere and a
    // clip that still renders. The submitted text is the text that was priced.
    const long = `${"y".repeat(139)}.`;
    expect(buildSubmitBody(TTS, long).input).toBe(long);
    const wrapped = "one.\n  two.\ttrailing space ";
    expect(buildSubmitBody(TTS, wrapped).input).toBe(wrapped);
  });

  test("the pinned fields track the SPEC, not a constant — a re-voiced row travels", () => {
    // Not vacuous: were `voice`/`sample_rate_hertz` read from MEDIA_DEFAULT_VOICE at the arm, the
    // assertions above would still pass and a row reserved under one voice could submit under
    // another after a constant bump. The row is the record of what was priced.
    const body = buildSubmitBody({ ...TTS, voice: "alloy", sampleRateHertz: 48000 }, "p");
    expect(body.voice).toBe("alloy");
  });
});

describe("OpenAI Sora submit contract", () => {
  test("missing visual key refuses before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(submitLine(VIDEO, "p")).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("submits an asynchronous Sora task with bearer auth and the priced body", async () => {
    const fetchMock = acceptFetch();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    expect(await submitLine(VIDEO, "a lighthouse")).toEqual({ ok: true, requestId: "req_1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/videos");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer openai-test-key");
    expect(Object.fromEntries((init.body as FormData).entries())).toEqual(
      buildSubmitBody(VIDEO, "a lighthouse"),
    );
  });

  test("fixture mode remains free but still requires configured credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    vi.stubEnv("MEDIA_PROVIDER_FIXTURE", "1");
    expect(await submitLine(VIDEO, "p")).toEqual({
      ok: true,
      requestId: expect.stringMatching(/^fixture-/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("GPT Image 2 decodes the returned PNG and keeps it off the job payload", async () => {
    const encoded = btoa(String.fromCharCode(137, 80, 78, 71));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: encoded }] }), {
        status: 200,
        headers: { "x-request-id": "image_req_1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    stubMediaEnv();
    const result = await submitLine(
      {
        kind: "image",
        model: MEDIA_DEFAULT_IMAGE.model,
        width: MEDIA_DEFAULT_IMAGE.width,
        height: MEDIA_DEFAULT_IMAGE.height,
      },
      "a baobab at dawn",
    );
    expect(result).toMatchObject({ ok: true, requestId: "image_req_1" });
    if (!result.ok) return;
    expect([...((result.asset?.bytes ?? new Uint8Array()) as Uint8Array)]).toEqual([
      137, 80, 78, 71,
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/generations");
  });
});

describe("OpenAI audio request bodies", () => {
  test("TTS pins neutral speed and WAV output", () => {
    expect(buildSubmitBody(TTS, "Narration")).toEqual({
      model: "tts-1",
      input: "Narration",
      voice: MEDIA_DEFAULT_VOICE.voice,
      response_format: "wav",
      speed: 1,
    });
  });
});

describe("WAN task landing", () => {
  test("a successful image task is copied into owned storage and lands the row", async () => {
    const t = harness();
    const planId = await seedPlanWithShots(t, deck(1));
    const jobId = await t.run((ctx) =>
      ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "wan-image",
        blockIndex: 0,
        provider: "wan",
        kind: "image",
        model: MEDIA_DEFAULT_IMAGE.model,
        spec: { kind: "image", width: 1080, height: 1920 },
        promptHash: "0".repeat(64),
        status: "submitted",
        providerRequestId: "task-1",
        estUsd: 0.03,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    stubMediaEnv();
    const png = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: "https://assets.oss-ap-southeast-1.aliyuncs.com/result.png" }],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.media.pollWanTask, { jobId, taskId: "task-1", attempt: 0 });

    const row = await jobRow(t, jobId);
    expect(row).toMatchObject({ status: "succeeded", mimeType: "image/png", bytes: 4 });
    expect(row?.assetStorageId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("OpenAI Sora task landing", () => {
  test("a completed video is downloaded from OpenAI and stored in the workspace", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const jobId = await t.run((ctx) =>
      ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "sora-video",
        blockIndex: 0,
        provider: "openai",
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        spec: {
          kind: "video",
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        },
        promptHash: "0".repeat(64),
        status: "submitted",
        providerRequestId: "video_1",
        estUsd: 0.4,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    stubMediaEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "video_1", status: "completed" })))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 0, 0, 24]), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.media.pollOpenAiVideoTask, {
      jobId,
      videoId: "video_1",
      attempt: 0,
    });

    expect(await jobRow(t, jobId)).toMatchObject({
      status: "succeeded",
      mimeType: "video/mp4",
      bytes: 4,
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.openai.com/v1/videos/video_1",
      "https://api.openai.com/v1/videos/video_1/content",
    ]);
  });
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

// ── the LANDING PLANE (plan 20-06, re-cut at 25.1-06) ──────────────────────────────
//
// Everything below runs at **$0**: rows are seeded directly and `landResult` is called as the
// mutation it is.
//
// **The `/fal/callback/*` route these tests used to drive is GONE** (25.1-06, D14): `submitLine`
// stopped handing a webhook URL to anyone at the ADR-017 cutover, so the route had no possible
// caller but somebody holding `FAL_WEBHOOK_SECRET`. Its 401/HMAC/timestamp/SSRF-host tests went
// with it — they proved a door that no longer exists. `landResult`'s own invariants (one audit row,
// the payload allow-list, reconciliation, retention) are what mattered and they are all still here,
// driven directly, which is also how the shipped code reaches them now.

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
            ? {
                kind: "video",
                resolution: MEDIA_DEFAULT_VIDEO.resolution,
                seconds: MEDIA_DEFAULT_VIDEO.seconds,
              }
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

const jobRow = (t: T, jobId: Id<"mediaJobs">) => t.run(async (ctx) => await ctx.db.get(jobId));
const planRowOf = (t: T, planId: Id<"plans">) => t.run(async (ctx) => await ctx.db.get(planId));
/** Does the blob still exist? Resolved INSIDE the transaction — a Blob is not a Convex type and
 *  cannot be returned across the t.run boundary. */
const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.storage.get(id)) !== null);
const auditRows = (t: T) => t.run(async (ctx) => await ctx.db.query("audit").collect());

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

  test("GPT Image 2 keeps its flat reservation across reported dimensions", async () => {
    const t = harness();
    stubMediaEnv();
    const { jobId } = await seedLandable(t, { kind: "image", estUsd: 0.01 });
    const before = await mediaLeft(t);

    await land(t, jobId, { width: 2160, height: 3840 });

    expect((await jobRow(t, jobId))?.actualCents).toBe(1);
    expect(await mediaLeft(t)).toBe(before);
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
  stubMediaEnv();
  const { jobId } = await seedLandable(t);
  // 25.1-06: driven through `landResult` directly. It used to go through `POST /fal/callback/*`,
  // which no longer exists — but the route was never what this test was about. The allow-list
  // belongs to the LANDING MUTATION, which is still the single writer of `media.landed` and is now
  // reached from `media.ts`'s poller and `reliabilitySweep`'s watchdog instead.
  await t.mutation(internal.mediaComplete.landResult, {
    jobId,
    outcome: {
      ok: true,
      assetStorageId: await t.run((ctx) => ctx.storage.store(new Blob([ASSET]))),
      assetHash: "b".repeat(64),
      mimeType: "video/mp4",
      bytes: ASSET.byteLength,
      moderation: null,
    },
  });

  const audit = await auditRows(t);
  expect(audit).toHaveLength(1);
  expect(audit[0]?.eventType).toBe("media.landed");
  // `row.provider` — the seeded row's own field, never anything a caller supplied.
  expect(audit[0]?.actor).toBe("fal");
  // A KEY-SET assertion, not an eyeball: a field added to the payload must be a deliberate edit
  // both here AND in llmRedaction.test.ts's allow-list scan.
  expect(Object.keys((audit[0]?.payload ?? {}) as object).sort()).toEqual(
    [
      "jobId",
      "batchId",
      "planId",
      "providerRequestId",
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
  scene_count: 2,
  target_duration_s: 2 * MEDIA_DEFAULT_VIDEO.seconds,
  total_duration_s: 2 * MEDIA_DEFAULT_VIDEO.seconds,
  actual_duration_s: 2 * MEDIA_DEFAULT_VIDEO.seconds,
  gates: ["speech_fits_the_reel", "no_time_stretch"],
  scenes: [
    {
      index: 0,
      start_s: 0,
      duration_s: MEDIA_DEFAULT_VIDEO.seconds,
      visual: "video",
      lead_silence_s: 0.3,
      speech_abs_s: 0.5,
      speech_dur_s: MEDIA_DEFAULT_VIDEO.seconds - 1,
      overrun: false,
    },
    {
      index: 1,
      start_s: MEDIA_DEFAULT_VIDEO.seconds,
      duration_s: MEDIA_DEFAULT_VIDEO.seconds,
      visual: "video",
      lead_silence_s: 0.3,
      speech_abs_s: MEDIA_DEFAULT_VIDEO.seconds + 0.5,
      speech_dur_s: MEDIA_DEFAULT_VIDEO.seconds - 1,
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
    /** Per-index patches onto the seeded deck rows — how a test asks for a scene deck. */
    deckOverrides?: Record<number, Record<string, unknown>>;
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
                ? {
                    kind: "video",
                    resolution: MEDIA_DEFAULT_VIDEO.resolution,
                    seconds: MEDIA_DEFAULT_VIDEO.seconds,
                  }
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
    // THE DECK, which `batchToRender` reads from 20.2 wave 5 onward. Production always has one —
    // the jobs exist BECAUSE a deck was reserved — and before wave 5 this helper got away without
    // it only because the jobs alone described a uniform reel. They no longer do: a card has no
    // job, and a silent scene has no take, so the shape has to come off the row.
    await ctx.db.patch(planId, {
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      shots: Array.from({ length: blocks }, (_, index) => ({
        index,
        type: "AI",
        seconds: MEDIA_DEFAULT_VIDEO.seconds,
        windowStartMs: index * MEDIA_DEFAULT_VIDEO.seconds * 1000,
        description: `scene ${index}`,
        narration: "x".repeat(40),
        prompt: `prompt ${index}`,
        ...(opts.deckOverrides?.[index] ?? {}),
      })),
    });
  });
  return { planId, batchId, tenantId, jobIds };
}

const planRow = (t: T, planId: Id<"plans">) => t.run(async (ctx) => await ctx.db.get(planId));

/** Store one blob and hand back its id — the fixture pair every success case needs. */
async function storeBlob(t: T, body: string | Uint8Array<ArrayBuffer>, type: string) {
  return await t.run(async (ctx) => await ctx.storage.store(new Blob([body], { type })));
}

// ── 20.2 wave 5: the SCENE money gate, and the narrowed renderability guard ─────────────────────

/** A scene, with the fields a reserve actually reads. */
const sc = (over: Partial<Scene> & { index: number; startMs: number; durationMs: number }): Scene =>
  ({
    visual: "generated_video",
    description: "d",
    narration: "x".repeat(40),
    prompt: "p",
    ...over,
  }) as Scene;

/** video:8 + image:6 + card:4 (silent) + upload:12 — one of every kind, summing to 30. */
const MIXED_SCENES = (): Scene[] => [
  sc({ index: 0, startMs: 0, durationMs: 8000, visual: "generated_video" }),
  sc({ index: 1, startMs: 8000, durationMs: 6000, visual: "animated_image" }),
  sc({
    index: 2,
    startMs: 14_000,
    durationMs: 4000,
    visual: "text_card",
    overlay: "Gone.",
    narration: "",
  }),
  sc({
    index: 3,
    startMs: 18_000,
    durationMs: 12_000,
    visual: "uploaded_video",
    asset: { source: "vault", docId: "doc_placeholder" },
  }),
];

const reserveScenes = (t: T, scenes: Scene[], over: Record<string, unknown> = {}) =>
  t.run(async (ctx) => {
    const planId = await ctx.db.insert("plans", {
      tenantId: A,
      threadId: "thread_scene",
      status: "proposed",
      createdAt: Date.now(),
    });
    return await reserveSceneJobInner(ctx, {
      tenantId: A,
      planId,
      scenes,
      targetDurationSeconds: 30,
      withCaptions: false,
      ...over,
    });
  });

describe("reserveSceneJobInner: what a scene deck BUYS, kind by kind", () => {
  test("one video line, one image line, and NOTHING for the card or the upload", async () => {
    const t = harness();
    const res = await reserveScenes(t, MIXED_SCENES());
    expect(res.ok, `refused: ${res.ok ? "" : res.reason}`).toBe(true);
    const inserted = await rows(t);
    // The whole point of the phase, as a table: a 30s reel that would have been four generated
    // clips is now one clip + one still + two free scenes.
    expect(inserted.filter((r) => r.kind === "video")).toHaveLength(1);
    expect(inserted.filter((r) => r.kind === "image")).toHaveLength(1);
    // Three narrated scenes → three takes. The silent card buys none.
    expect(
      inserted
        .filter((r) => r.kind === "tts")
        .map((r) => r.blockIndex)
        .sort(),
    ).toEqual([0, 1, 3]);
    expect(inserted.some((r) => r.blockIndex === 2)).toBe(false);
  });

  test("the video line is bought at ITS OWN length, not at a uniform clipSeconds", async () => {
    const t = harness();
    await reserveScenes(t, MIXED_SCENES());
    const video = (await rows(t)).find((r) => r.kind === "video");
    expect(video?.spec.kind === "video" && video.spec.seconds).toBe(8);
  });

  test("THE NARROWING, in the direction that costs money: a card with no words is refused", async () => {
    // `unrenderable_block` used to mean "unpaid". It now means "does not name what its picture is
    // built from" — and this is the case where the two disagree. A card with nothing to draw
    // renders a black rectangle that passes every downstream gate.
    const t = harness();
    const scenes = MIXED_SCENES();
    scenes[2] = sc({
      index: 2,
      startMs: 14_000,
      durationMs: 4000,
      visual: "text_card",
      narration: "",
    });
    expect(await reserveScenes(t, scenes)).toEqual({ ok: false, reason: "unrenderable_block" });
    expect(await rows(t)).toHaveLength(0); // and NOTHING was bought
  });

  test("…and an upload with no vault doc named, for the same reason", async () => {
    const t = harness();
    const scenes = MIXED_SCENES();
    scenes[3] = sc({ index: 3, startMs: 18_000, durationMs: 12_000, visual: "uploaded_video" });
    expect(await reserveScenes(t, scenes)).toEqual({ ok: false, reason: "unrenderable_block" });
    expect(await rows(t)).toHaveLength(0);
  });

  test("…but a card WITH words is bought around, where the block contract refused the deck", async () => {
    const t = harness();
    const res = await reserveScenes(t, MIXED_SCENES());
    expect(res.ok).toBe(true);
  });

  test("a deck that does not sum to its declared target is refused before a cent moves", async () => {
    const t = harness();
    const scenes = MIXED_SCENES();
    scenes[0] = sc({ index: 0, startMs: 0, durationMs: 4000, visual: "generated_video" }); // 26s
    expect(await reserveScenes(t, scenes)).toEqual({ ok: false, reason: "illegal_duration" });
    expect(await rows(t)).toHaveLength(0);
  });

  test("a generated clip off the provider's duration GRID is refused", async () => {
    const t = harness();
    const scenes = [
      sc({ index: 0, startMs: 0, durationMs: 7000, visual: "generated_video" }),
      sc({ index: 1, startMs: 7000, durationMs: 23_000, visual: "animated_image" }),
    ];
    expect(await reserveScenes(t, scenes)).toEqual({ ok: false, reason: "illegal_duration" });
  });

  test("the narration ceiling is the TAKE's window — a silent scene lends its duration", async () => {
    const t = harness();
    // Scene 0 is 8s and is followed by a SILENT 6s scene, so its line has 14s to be spoken in.
    // Under the old per-cell ceiling this length was a refusal.
    const scenes = [
      sc({
        index: 0,
        startMs: 0,
        durationMs: 8000,
        visual: "generated_video",
        narration: "x".repeat(maxCharsFor(13)),
      }),
      sc({
        index: 1,
        startMs: 8000,
        durationMs: 6000,
        visual: "text_card",
        overlay: "w",
        narration: "",
      }),
      sc({ index: 2, startMs: 14_000, durationMs: 16_000, visual: "animated_image" }),
    ];
    const res = await reserveScenes(t, scenes);
    expect(res.ok, `refused: ${res.ok ? "" : res.reason}`).toBe(true);
  });

  test("…and it is still a CEILING: a line past the next take's start is refused", async () => {
    const t = harness();
    const scenes = [
      sc({
        index: 0,
        startMs: 0,
        durationMs: 8000,
        visual: "generated_video",
        narration: "x".repeat(maxCharsFor(30) + 1),
      }),
      sc({ index: 1, startMs: 8000, durationMs: 22_000, visual: "animated_image" }),
    ];
    expect(await reserveScenes(t, scenes)).toEqual({ ok: false, reason: "narration_too_long" });
    expect(await rows(t)).toHaveLength(0);
  });

  test("captions are priced off the DECLARED length, not blocks x clipSeconds", async () => {
    const t = harness();
    await reserveScenes(t, MIXED_SCENES(), { withCaptions: true });
    const stt = (await rows(t)).find((r) => r.kind === "stt");
    expect(stt?.blockIndex).toBe(-1);
    expect(stt?.spec.kind === "stt" && stt.spec.audioMinutes).toBe(30 / 60);
  });

  test("the kill switch refuses a scene deck exactly as it refuses a block deck", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      const cfg = await ctx.db.query("guardrailConfig").first();
      if (cfg) await ctx.db.patch(cfg._id, { mediaKillSwitch: true });
      else
        await ctx.db.insert("guardrailConfig", {
          budgetUsdPerRequest: 5,
          killSwitch: false,
          mediaKillSwitch: true,
          updatedAt: Date.now(),
        });
    });
    expect(await reserveScenes(t, MIXED_SCENES())).toEqual({ ok: false, reason: "kill_switch" });
  });
});

describe("THE VAULT BRIDGE: an uploaded_video's bytes, and whose they are", () => {
  /** Scene 0 is a bought clip; scene 1 is the tenant's own footage from the vault. */
  async function seedUploadDeck(
    t: T,
    opts: { docTenant?: string; mimeType?: string; docId?: string } = {},
  ) {
    const batchId = "batch_upload";
    return await t.run(async (ctx) => {
      const vaultDocId = await ctx.db.insert("vaultDocuments", {
        tenantId: opts.docTenant ?? A,
        title: "b-roll",
        kind: "upload",
        category: "operations",
        source: "upload",
        mimeType: opts.mimeType ?? "video/mp4",
        size: 1024,
        contentHash: "a".repeat(64),
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" })),
        status: "ready",
        createdAt: T0,
      });
      const planId = await ctx.db.insert("plans", {
        tenantId: A,
        threadId: "thread_upload",
        status: "proposed",
        createdAt: Date.now(),
        targetDurationSeconds: 20,
        shots: [
          {
            index: 0,
            visual: "generated_video",
            seconds: 8,
            windowStartMs: 0,
            description: "d",
            narration: "x".repeat(40),
            prompt: "p",
          },
          {
            index: 1,
            visual: "uploaded_video",
            seconds: 12,
            windowStartMs: 8000,
            description: "d",
            narration: "x".repeat(40),
            prompt: "p",
            asset: { source: "vault", docId: opts.docId ?? vaultDocId },
          },
        ],
      });
      for (const [blockIndex, kinds] of [
        [0, ["video", "tts"]],
        [1, ["tts"]],
      ] as const) {
        for (const kind of kinds) {
          await ctx.db.insert("mediaJobs", {
            tenantId: A,
            planId,
            batchId,
            blockIndex,
            provider: "openai",
            kind,
            model: kind === "video" ? MEDIA_DEFAULT_VIDEO.model : MEDIA_DEFAULT_VOICE.model,
            spec:
              kind === "video"
                ? { kind: "video", resolution: MEDIA_DEFAULT_VIDEO.resolution, seconds: 8 }
                : { kind: "tts", characters: 80, voice: "Evelyn (en)", sampleRateHertz: 24000 },
            promptHash: "0".repeat(64),
            status: "succeeded",
            assetStorageId: await ctx.storage.store(
              new Blob([new Uint8Array([2])], { type: "video/mp4" }),
            ),
            mimeType: kind === "video" ? "video/mp4" : "audio/wav",
            estUsd: 0.1,
            createdAt: T0,
            updatedAt: T0,
          });
        }
      }
      return { planId, batchId, vaultDocId };
    });
  }

  const toRender = (t: T, batchId: string, tenantId = A) =>
    t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId, batchId }),
    );

  test("resolves the vault doc into the scene's OWN input slot — no job, no purchase", async () => {
    const t = harness();
    const { batchId, vaultDocId } = await seedUploadDeck(t);
    const res = await toRender(t, batchId);
    expect(res.ok, `refused: ${res.ok ? "" : res.reason}`).toBe(true);
    if (!res.ok) return;
    expect(res.value.scenes).toEqual([
      { kind: "video", seconds: 8 },
      { kind: "video", seconds: 12 },
    ]);
    // `block02.mp4` is served from the VAULT row, not from a mediaJobs row that was never bought.
    expect(res.value.inputs.find((i) => i.name === "block02.mp4")?.jobId).toBe(vaultDocId);
  });

  test("REFUSES a vault doc belonging to ANOTHER TENANT — asset.docId is model-authored", async () => {
    // The load-bearing test of this bridge. `asset.docId` reaches `batchToRender` off
    // `plans.shots`, which the specialist wrote — it is a caller-supplied id in every sense that
    // matters. Without the tenant check on the row, a deck could name any vault document in the
    // deployment and the runner would fetch it through the bearer-guarded blob route.
    const t = harness();
    const { batchId } = await seedUploadDeck(t, { docTenant: B });
    expect(await toRender(t, batchId)).toEqual({ ok: false, reason: "incomplete_blocks" });
  });

  test("REFUSES a vault doc that is not a video — the vault is not a file server", async () => {
    const t = harness();
    const { batchId } = await seedUploadDeck(t, { mimeType: "application/pdf" });
    expect(await toRender(t, batchId)).toEqual({ ok: false, reason: "incomplete_blocks" });
  });

  test("REFUSES a docId that is malformed or names another table — normalizeId fails closed", async () => {
    const t = harness();
    for (const docId of ["../../etc/passwd", "not_an_id", ""]) {
      const { batchId } = await seedUploadDeck(t, { docId });
      expect(await toRender(t, batchId), docId).toEqual({
        ok: false,
        reason: "incomplete_blocks",
      });
    }
  });

  test("the blob route serves a VIDEO vault doc and refuses every other document", async () => {
    // `resolveRenderAsset` deliberately has NO tenant check — it takes a raw id with no tenant to
    // check it against, exactly as the mediaJobs branch does, and `batchToRender` is the boundary.
    // The narrowing that bounds it instead is "video only": the vault holds a tenant's briefs and
    // contracts, and serving any document by id would be a far larger capability than a render
    // needs.
    const t = harness();
    const { vaultDocId } = await seedUploadDeck(t);
    const served = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.resolveRenderAsset, { raw: vaultDocId }),
    );
    expect(served?.mimeType).toBe("video/mp4");

    const pdfId = await t.run(
      async (ctx) =>
        await ctx.db.insert("vaultDocuments", {
          tenantId: A,
          title: "contract",
          kind: "upload",
          category: "operations",
          source: "upload",
          mimeType: "application/pdf",
          size: 10,
          contentHash: "b".repeat(64),
          storageId: await ctx.storage.store(new Blob(["x"], { type: "application/pdf" })),
          status: "ready",
          createdAt: T0,
        }),
    );
    expect(
      await t.run(
        async (ctx) =>
          await ctx.runQuery(internal.render.renderReel.resolveRenderAsset, { raw: pdfId }),
      ),
    ).toBeNull();
  });
});

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
    // The uniform BLOCK contract, expressed as scenes: N entries of `video:clipSeconds`, and the
    // declared length is their sum. It is not a second code path — it is the general one with
    // every entry equal, which is what keeps a live block deck rendering byte-identically.
    expect(res.value.scenes).toEqual(
      Array.from({ length: 3 }, () => ({ kind: "video", seconds: MEDIA_DEFAULT_VIDEO.seconds })),
    );
    expect(res.value.targetSeconds).toBe(3 * MEDIA_DEFAULT_VIDEO.seconds);
    expect(res.value.cards).toEqual([]);
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

  // ── 20.2 wave 6: A REGENERATE BATCH IS A PARTIAL BATCH, and it has to render ─────────────────
  //
  // `regenerateBlock` has shipped since 20-09 and buys ONE block's clip and voice into a NEW batch
  // — `media.test.ts:3526` pins exactly that ("1 video + 1 tts + 1 stt; NOT the whole four-block
  // deck"). Nothing pinned what happens NEXT, and what happened next is that the render refused:
  // the inputs were read from the batch alone, so every index the regenerate did not re-buy had no
  // job and the whole reel came back `incomplete_blocks`. The user paid for a clip AND lost the
  // published reel, because `reserveAndSchedule` clears the render in the same transaction.
  //
  // The fix is the one the deck already implies: a scene's picture and take are whatever LANDED for
  // that scene most recently on this plan, and the batch is only the trigger.
  test("a REGENERATE batch renders — the re-bought scene is new, the rest are reused from the plan", async () => {
    const t = harness();
    const { planId, tenantId } = await seedRenderable(t, { blocks: 3 });
    // The regenerate: a second batch carrying index 1 only, landed. Exactly what
    // `regenerateBlock` → `submitBatch` → the webhook leaves behind.
    const again = "batch_regen";
    const fresh = await t.run(async (ctx) => {
      const ids: Id<"mediaJobs">[] = [];
      for (const kind of ["video", "tts"] as const) {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([9])], { type: "video/mp4" }),
        );
        ids.push(
          await ctx.db.insert("mediaJobs", {
            tenantId,
            planId,
            batchId: again,
            blockIndex: 1,
            provider: "fal",
            kind,
            model: kind === "video" ? MEDIA_DEFAULT_VIDEO.model : MEDIA_DEFAULT_VOICE.model,
            spec:
              kind === "video"
                ? {
                    kind: "video",
                    resolution: MEDIA_DEFAULT_VIDEO.resolution,
                    seconds: MEDIA_DEFAULT_VIDEO.seconds,
                  }
                : { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 },
            promptHash: "0".repeat(64),
            status: "succeeded",
            assetStorageId: storageId,
            mimeType: kind === "video" ? "video/mp4" : "audio/wav",
            estUsd: 0.5,
            createdAt: T0 + 1_000,
            updatedAt: T0 + 1_000,
          }),
        );
      }
      return ids;
    });

    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, {
          tenantId,
          batchId: again,
        }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // All three scenes, in deck order — the reel is still three scenes long.
    expect(res.value.inputs.map((i) => i.name)).toEqual([
      "block01.mp4",
      "voice01.wav",
      "block02.mp4",
      "voice02.wav",
      "block03.mp4",
      "voice03.wav",
    ]);
    // …and scene 2 is the FRESH pair, not the one it replaced.
    expect(res.value.inputs[2]?.jobId).toBe(fresh[0]);
    expect(res.value.inputs[3]?.jobId).toBe(fresh[1]);
  });

  // The flow the regenerate button exists FOR: rewrite one prompt, re-buy that scene, keep the
  // rest. An edit in place leaves every index meaning what it meant, so it must NOT invalidate the
  // neighbours — if it did, the user would pay for a take and then be refused the render, which is
  // the same leak with an extra step.
  test("an edited prompt does NOT stale the deck — edit one scene, re-buy one scene, render", async () => {
    const t = harness();
    const { planId, tenantId } = await seedRenderable(t, { blocks: 3 });
    await asA(t).mutation(api.media.editBlockPrompt, {
      planId,
      blockIndex: 1,
      prompt: "a different second scene",
    });
    const again = "batch_regen_edit";
    await t.run(async (ctx) => {
      for (const kind of ["video", "tts"] as const) {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([9])], { type: "video/mp4" }),
        );
        await ctx.db.insert("mediaJobs", {
          tenantId,
          planId,
          batchId: again,
          blockIndex: 1,
          provider: "fal",
          kind,
          model: kind === "video" ? MEDIA_DEFAULT_VIDEO.model : MEDIA_DEFAULT_VOICE.model,
          spec:
            kind === "video"
              ? {
                  kind: "video",
                  resolution: MEDIA_DEFAULT_VIDEO.resolution,
                  seconds: MEDIA_DEFAULT_VIDEO.seconds,
                }
              : { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 },
          promptHash: "0".repeat(64),
          status: "succeeded",
          assetStorageId: storageId,
          mimeType: kind === "video" ? "video/mp4" : "audio/wav",
          estUsd: 0.5,
          createdAt: T0 + 1_000,
          updatedAt: T0 + 1_000,
        });
      }
    });

    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, {
          tenantId,
          batchId: again,
        }),
    );
    expect(res.ok).toBe(true);
  });

  test("REFUSES to reuse an asset bought before the deck was edited — the reorder trap", async () => {
    const t = harness();
    const { planId, tenantId } = await seedRenderable(t, { blocks: 3 });
    // A free structural edit AFTER the assets landed. `patchShots` clears the render and stamps the
    // deck's change time; scene 0's clip was bought against a deck that no longer exists, and
    // reusing it would put the wrong footage under the wrong scene with nothing on screen saying so.
    await asA(t).mutation(api.media.reorderBlocks, { planId, order: [2, 1, 0] });
    const again = "batch_regen_stale";
    await t.run(async (ctx) => {
      for (const kind of ["video", "tts"] as const) {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([9])], { type: "video/mp4" }),
        );
        await ctx.db.insert("mediaJobs", {
          tenantId,
          planId,
          batchId: again,
          blockIndex: 1,
          provider: "fal",
          kind,
          model: kind === "video" ? MEDIA_DEFAULT_VIDEO.model : MEDIA_DEFAULT_VOICE.model,
          spec:
            kind === "video"
              ? {
                  kind: "video",
                  resolution: MEDIA_DEFAULT_VIDEO.resolution,
                  seconds: MEDIA_DEFAULT_VIDEO.seconds,
                }
              : { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 },
          promptHash: "0".repeat(64),
          status: "succeeded",
          assetStorageId: storageId,
          mimeType: kind === "video" ? "video/mp4" : "audio/wav",
          estUsd: 0.5,
          createdAt: T0 + 1_000,
          updatedAt: T0 + 1_000,
        });
      }
    });

    const res = await t.run(
      async (ctx) =>
        await ctx.runQuery(internal.render.renderReel.batchToRender, {
          tenantId,
          batchId: again,
        }),
    );
    expect(res).toEqual({ ok: false, reason: "stale_inputs" });
  });
});

describe("renderReel: fail-closed on the secret, then the offline seam", () => {
  test("an unset MEDIA_RENDER_SECRET refuses BEFORE any fetch exists", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubRenderEnv();
    vi.stubEnv("MEDIA_RENDER_SECRET", "");
    const { planId, batchId } = await seedRenderable(t);

    await expect(
      t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId }),
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
    const { planId, batchId } = await seedRenderable(t);
    await expect(
      t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId }),
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
        sceneCount: 2,
      }),
    );

    const out = await t.action(internal.render.renderReel.renderReel, {
      tenantId: A,
      planId,
      batchId,
    });
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
    const bad = JSON.parse(RENDER_SIDECAR) as { scenes: Array<{ overrun: boolean }> };
    const target = bad.scenes[1];
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
        sceneCount: 2,
      }),
    );

    const out = await t.action(internal.render.renderReel.renderReel, {
      tenantId: A,
      planId,
      batchId,
    });
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

    const out = await t.action(internal.render.renderReel.renderReel, {
      tenantId: A,
      planId,
      batchId,
    });
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
        sceneCount: 2,
      }),
    );
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId });

    const audit = (await auditRows(t)).filter((r) => r.eventType === "media.rendered");
    expect(audit).toHaveLength(1);
    // Kept in lockstep with llmRedaction.test.ts's MEDIA_AUDIT_ALLOWED — refs, hashes and counts.
    expect(Object.keys((audit[0]?.payload ?? {}) as object).sort()).toEqual(
      ["batchId", "planId", "sceneCount", "renderMs", "sidecarHash", "gatesPassed"].sort(),
    );
    expect(JSON.stringify(audit[0]?.payload)).not.toMatch(/url|href|http/i);
    // `gatesPassed` comes from the RE-VALIDATED sidecar, not from what the route claimed: the
    // fixture above returns `gates: []` and this is 2.
    const auditRow = audit[0];
    if (auditRow === undefined) throw new Error("expected media.composed audit row");
    expect((auditRow.payload as { gatesPassed: number }).gatesPassed).toBe(2);
  });

  test("a FAILED render writes no audit row at all — a stop is not an event to log", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { planId, batchId } = await seedRenderable(t);
    vi.stubEnv("MEDIA_SANDBOX_FIXTURE", JSON.stringify({ ok: false, code: "decode_failed" }));
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId });
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
  const clipSeconds = opts.clipSeconds ?? MEDIA_DEFAULT_VIDEO.seconds;
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

async function seedImagePlan(t: T, tenantId = A, prompt = "A sunlit baobab at dawn") {
  const planId = await seedPlan(t, tenantId);
  await t.run(async (ctx) =>
    ctx.db.patch(planId, { kind: "media", mediaMode: "image", imagePrompt: prompt }),
  );
  return { planId, prompt };
}

describe("standalone image: one reviewed prompt through the existing media rail", () => {
  test("estimate consumes nothing and exactly matches the reservation", async () => {
    const t = harness();
    const { planId, prompt } = await seedImagePlan(t);
    const before = await mediaLeft(t);

    const estimate = await asA(t).query(api.media.imageEstimate, { planId });
    expect(estimate).toMatchObject({
      model: MEDIA_DEFAULT_IMAGE.model,
      width: MEDIA_DEFAULT_IMAGE.width,
      height: MEDIA_DEFAULT_IMAGE.height,
      refusal: null,
    });
    expect(await mediaLeft(t)).toBe(before);
    expect(await rows(t)).toHaveLength(0);

    const generated = await asA(t).mutation(api.media.generateImage, { planId });
    expect(generated).toMatchObject({ ok: true, estCents: estimate.totalCents });
    expect(await mediaLeft(t)).toBe(before - estimate.totalCents);
    const [row] = await rows(t);
    expect(row).toMatchObject({
      kind: "image",
      model: MEDIA_DEFAULT_IMAGE.model,
      blockIndex: 0,
      spec: {
        kind: "image",
        width: MEDIA_DEFAULT_IMAGE.width,
        height: MEDIA_DEFAULT_IMAGE.height,
      },
    });
    expect(row?.promptHash).toBe(await contentHash(prompt));

    const batch = await t.query(internal.media.batchToSubmit, {
      tenantId: A,
      batchId: generated.ok ? generated.batchId : "unreachable",
    });
    expect(batch.imagePrompt).toBe(prompt);
    expect(batch.shots).toEqual([]);
  });

  test("a racing second click cannot reserve or insert twice", async () => {
    const t = harness();
    const { planId } = await seedImagePlan(t);
    const first = await asA(t).mutation(api.media.generateImage, { planId });
    expect(first.ok).toBe(true);
    const afterFirst = await mediaLeft(t);

    expect(await asA(t).mutation(api.media.generateImage, { planId })).toEqual({
      ok: false,
      reason: "already_started",
    });
    expect(await rows(t)).toHaveLength(1);
    expect(await mediaLeft(t)).toBe(afterFirst);
  });

  test("a terminal failed attempt can be retried, while the new active attempt stays single", async () => {
    const t = harness();
    const { planId } = await seedImagePlan(t);
    const first = await asA(t).mutation(api.media.generateImage, { planId });
    expect(first.ok).toBe(true);
    const [failed] = await rows(t);
    expect(failed).toBeTruthy();
    await t.run((ctx) =>
      ctx.db.patch(failed!._id, {
        status: "failed",
        failureReason: "AccessDenied",
        updatedAt: T0 + 1,
      }),
    );

    const retried = await asA(t).mutation(api.media.generateImage, { planId });
    expect(retried.ok).toBe(true);
    const attempts = (await rows(t)).filter((row) => row.kind === "image");
    expect(attempts).toHaveLength(2);
    expect(attempts.map((row) => row.status).sort()).toEqual(["failed", "queued"]);

    expect(await asA(t).mutation(api.media.generateImage, { planId })).toEqual({
      ok: false,
      reason: "already_started",
    });
    expect((await rows(t)).filter((row) => row.kind === "image")).toHaveLength(2);
  });

  test("25.1-03 (D8): a SUCCEEDED image never blocks the next one — only in-flight work does", async () => {
    const t = harness();
    const { planId } = await seedImagePlan(t);
    const first = await asA(t).mutation(api.media.generateImage, { planId });
    expect(first.ok).toBe(true);
    const [row] = await rows(t);

    // Nothing ever deletes `mediaJobs` rows, so a `succeeded` row is a PERMANENT lock: one image
    // per thread, for ever, with no message explaining why the button stopped working.
    await t.run((ctx) => ctx.db.patch(row!._id, { status: "succeeded", updatedAt: T0 + 1 }));
    expect(await asA(t).mutation(api.media.generateImage, { planId })).toMatchObject({ ok: true });
    expect((await rows(t)).filter((r) => r.kind === "image")).toHaveLength(2);

    // …and the guard still holds on GENUINELY in-flight work, in both of its states.
    for (const status of ["queued", "submitted"] as const) {
      const active = (await rows(t)).find((r) => r.status !== "succeeded");
      await t.run((ctx) => ctx.db.patch(active!._id, { status, updatedAt: T0 + 2 }));
      expect(await asA(t).mutation(api.media.generateImage, { planId })).toEqual({
        ok: false,
        reason: "already_started",
      });
      expect((await rows(t)).filter((r) => r.kind === "image")).toHaveLength(2);
    }
  });

  test("proposal staging is free and reset clears both image fields", async () => {
    const t = harness();
    const planId = await t.mutation(internal.plans.insertPlan, {
      tenantId: A,
      threadId: "image_thread",
    });
    const before = await mediaLeft(t);
    const staged = await t.mutation(internal.plans.stageImagePlan, {
      tenantId: A,
      threadId: "image_thread",
      prompt: "  Editorial portrait in indigo light  ",
    });
    expect(staged).toEqual({ ok: true, planId });
    expect(await planRowOf(t, planId)).toMatchObject({
      kind: "media",
      mediaMode: "image",
      imagePrompt: "Editorial portrait in indigo light",
      status: "proposed",
    });
    expect(await mediaLeft(t)).toBe(before);
    expect(await rows(t)).toHaveLength(0);

    await t.mutation(internal.plans.resetPlan, { planId });
    const reset = await planRowOf(t, planId);
    expect(reset?.mediaMode).toBeUndefined();
    expect(reset?.imagePrompt).toBeUndefined();
  });

  test("tenant boundaries cover both estimate and paid mutation", async () => {
    const t = harness();
    const { planId } = await seedImagePlan(t, A);
    expect(await asB(t).query(api.media.imageEstimate, { planId })).toMatchObject({
      totalCents: 0,
      refusal: "no_image_plan",
    });
    await expect(asB(t).mutation(api.media.generateImage, { planId })).rejects.toThrow(
      /plan not found/,
    );
    expect(await rows(t)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 25.1-03 (D5) — a generated IMAGE reaches the vault, or it is unreachable the moment the
// thread's plan row is recycled. Before this the bytes lived ONLY on `mediaJobs.assetStorageId`.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const imageDocs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("vaultDocuments").collect()).filter((d) => d.kind === "image"),
  );

/** Land one image row through the REAL `landResult`, as the webhook would. */
const landImage = async (t: T, jobId: Id<"mediaJobs">, mimeType = "image/png") => {
  const bytes = new Uint8Array([7, 7, 7, 7]);
  return await t.run(async (ctx) => {
    const assetStorageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
    await ctx.runMutation(internal.mediaComplete.landResult, {
      jobId,
      outcome: {
        ok: true,
        assetStorageId,
        assetHash: "e".repeat(64),
        mimeType,
        bytes: bytes.byteLength,
        moderation: null,
      },
    });
    return assetStorageId;
  });
};

/** A standalone-image plan with its ONE reserved row, ready to land — through the real
 *  `generateImage` money gate, so the row is exactly the one production creates. */
async function seedImageInFlight(t: T, tenantId = A, prompt = "A sunlit baobab at dawn") {
  const { planId } = await seedImagePlan(t, tenantId, prompt);
  const res = await (tenantId === A ? asA(t) : asB(t)).mutation(api.media.generateImage, {
    planId,
  });
  expect(res.ok).toBe(true);
  const row = await t.run(async (ctx) =>
    (await ctx.db.query("mediaJobs").collect()).find((r) => r.planId === planId),
  );
  return { planId, prompt, jobId: row?._id as Id<"mediaJobs"> };
}

describe("25.1-03 (D5) the generated image becomes a durable vault asset at its landing", () => {
  test("the landing saves ONE tenant-scoped doc: prompt as text, image bytes, job pointer", async () => {
    const t = harness();
    const { planId, prompt, jobId } = await seedImageInFlight(t);
    const stored = await landImage(t, jobId);

    const docs = await imageDocs(t);
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc?.tenantId).toBe(A);
    // The ROW is markdown (the prompt rides the embed rail); the BYTES are the image.
    expect(doc?.mimeType).toBe("text/markdown");
    expect(doc?.storedMimeType).toBe("image/png");
    expect(doc?.storageId).toBe(stored);
    expect(doc?.category).toBe("images");
    expect(doc?.text).toBe(prompt);
    expect(doc?.contentHash).toBe(await contentHash(prompt));
    expect(doc?.title).toContain(prompt);
    expect(doc?.status).toBe("processing");
    expect(doc?.sourcePlanId).toBe(planId);
    // The JOB carries the pointer — per JOB, not per plan: after D8 a plan holds several images.
    expect(await t.run(async (ctx) => (await ctx.db.get(jobId))?.vaultDocId)).toBe(doc?._id);
    // Refs and counts ONLY (§4) — never the prompt.
    const saved = (await auditRows(t)).filter((r) => r.eventType === "media.image_saved");
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0]?.payload as object).sort()).toEqual(["docId", "jobId", "planId"]);
    expect(JSON.stringify(saved[0]?.payload)).not.toContain("baobab");
  });

  test("a SECOND landing of the same job saves nothing more — the pointer is the guard", async () => {
    const t = harness();
    const { jobId } = await seedImageInFlight(t);
    await landImage(t, jobId);
    const first = await imageDocs(t);
    expect(first).toHaveLength(1);

    // The landing's own idempotency is the TERMINAL status check, so it is removed here: without
    // the doc pointer this second pass would file a second copy of the same image.
    await t.run(async (ctx) => await ctx.db.patch(jobId, { status: "submitted" }));
    await landImage(t, jobId);

    const after = await imageDocs(t);
    expect(after).toHaveLength(1);
    expect(after[0]?._id).toBe(first[0]?._id);
  });

  test("a REEL's scene still is NEVER vaulted — those bytes are a deleted intermediate", async () => {
    const t = harness();
    // No `mediaMode: "image"` — this is a reel whose scene happens to be a still. Its asset is
    // deleted by `deleteIntermediates` at the render terminal, so a doc would point at nothing.
    const { planId } = await seedDeck(t, { blocks: 1 });
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "batch_scene_still",
        blockIndex: 0,
        provider: "openai",
        kind: "image",
        model: MEDIA_DEFAULT_IMAGE.model,
        spec: {
          kind: "image",
          width: MEDIA_DEFAULT_IMAGE.width,
          height: MEDIA_DEFAULT_IMAGE.height,
        },
        promptHash: "0".repeat(64),
        status: "submitted",
        estUsd: 0.01,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    await landImage(t, jobId);
    expect(await imageDocs(t)).toHaveLength(0);

    // …and the MODE is what excludes it, not the absence of a prompt. `stageMediaPlan` resets the
    // row before staging a reel, so a reel carrying a leftover `imagePrompt` is unreachable today —
    // this pins the discriminator so a refactor that leans on the prompt alone reddens here.
    await t.run(async (ctx) =>
      ctx.db.patch(planId, { mediaMode: "reel", imagePrompt: "a leftover image prompt" }),
    );
    await t.run(async (ctx) => await ctx.db.patch(jobId, { status: "submitted" }));
    await landImage(t, jobId);
    expect(await imageDocs(t)).toHaveLength(0);
  });

  test("the doc belongs to the JOB's tenant, never the reader's", async () => {
    const t = harness();
    const { jobId } = await seedImageInFlight(t, B, "An indigo studio portrait");
    await landImage(t, jobId);
    const docs = await imageDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.tenantId).toBe(B);
  });

  test("a job pointing at a FOREIGN plan saves nothing — the prompt is never crossed over", async () => {
    const t = harness();
    // Only reachable through a bug, and that is the point: the doc's TEXT is the plan's prompt, so
    // a row whose tenant and whose plan disagree must file nothing rather than pick a side.
    const { planId } = await seedImagePlan(t, B, "B's private brief");
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "batch_crossed",
        blockIndex: 0,
        provider: "openai",
        kind: "image",
        model: MEDIA_DEFAULT_IMAGE.model,
        spec: {
          kind: "image",
          width: MEDIA_DEFAULT_IMAGE.width,
          height: MEDIA_DEFAULT_IMAGE.height,
        },
        promptHash: "0".repeat(64),
        status: "submitted",
        estUsd: 0.01,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    await landImage(t, jobId);
    expect(await imageDocs(t)).toHaveLength(0);
  });
});

describe("the canvas READ plane: two states per block, and a url only when it is earned", () => {
  // ── 20.2 wave 6: what a SCENE tile needs, and what it must not have to guess ─────────────────
  test("byPlan projects each scene's own kind, place and length — never index x clipSeconds", async () => {
    const t = harness();
    // 8 / 6 / 4 / 12, summing to 30. `clipSeconds` on this row is 12 (the longest scene), which is
    // exactly the number a tile must NOT size itself from.
    const { planId } = await seedSceneDeck(t);
    const rows = await asA(t).query(api.media.byPlan, { planId });
    expect(rows.map((r) => [r.visual, r.startMs, r.durationMs])).toEqual([
      ["generated_video", 0, 8000],
      ["animated_image", 8000, 6000],
      ["text_card", 14_000, 4000],
      ["generated_video", 18_000, 12_000],
    ]);
  });

  test("a scene's character ceiling is its TAKE's window, not the deck's longest scene", async () => {
    const t = harness();
    // Scene 2 is silent, so scene 1's line runs until scene 3 starts: 6 s + 4 s = 10 s of room,
    // where the deck-wide `clipSeconds` (12) would have promised more and the scene's own length
    // (6) less. Both wrong numbers are reachable; only one is the number the reserve applies.
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) => (s.index === 2 ? { ...s, narration: "" } : s));
      await ctx.db.patch(planId, { shots });
    });
    const rows = await asA(t).query(api.media.byPlan, { planId });
    expect(rows[1]?.maxChars).toBe(maxCharsFor(10));
    // …and the mutation that edits the line applies the SAME ceiling, or the count beside the
    // textarea would promise room the money gate then refuses.
    expect(
      await asA(t).mutation(api.media.editBlockNarration, {
        planId,
        blockIndex: 1,
        narration: "x".repeat(maxCharsFor(10) + 1),
      }),
    ).toMatchObject({ ok: false, reason: "narration_too_long", maxChars: maxCharsFor(10) });
  });

  test("a take bought for a line that has since been rewritten is reported STALE", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      );
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "b1",
        blockIndex: 0,
        provider: "openai",
        kind: "tts",
        model: MEDIA_DEFAULT_VOICE.model,
        spec: { kind: "tts", characters: 12, voice: "v", sampleRateHertz: 24000 },
        // Bought for the line the deck was written with.
        promptHash: await contentHash("line 0"),
        status: "succeeded",
        assetStorageId: storageId,
        estUsd: 0.01,
        createdAt: T0,
        updatedAt: T0,
      });
    });
    expect((await asA(t).query(api.media.byPlan, { planId }))[0]?.voiceStale).toBe(false);

    // The free edit. The take survives it — the render reuses it deliberately, because it is the
    // only audio that exists — so the tile is the only place a user can learn the reel still says
    // the old words.
    await asA(t).mutation(api.media.editBlockNarration, {
      planId,
      blockIndex: 0,
      narration: "something else entirely",
    });
    expect((await asA(t).query(api.media.byPlan, { planId }))[0]?.voiceStale).toBe(true);
  });

  test("byPlan reports the clip and the voice INDEPENDENTLY", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    // Block 0: voice landed, clip still in flight. Block 1: the reverse. A single merged status
    // could not tell these apart, and they arrive minutes apart through two different webhooks.
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "video/mp4" }),
      );
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
        ...base,
        blockIndex: 0,
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        spec: {
          kind: "video",
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        },
        status: "submitted",
      });
      await ctx.db.insert("mediaJobs", {
        ...base,
        blockIndex: 0,
        kind: "tts",
        model: MEDIA_DEFAULT_VOICE.model,
        spec: { kind: "tts", characters: 200, voice: "v", sampleRateHertz: 24000 },
        status: "succeeded",
        assetStorageId: storageId,
      });
      await ctx.db.insert("mediaJobs", {
        ...base,
        blockIndex: 1,
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        spec: {
          kind: "video",
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        },
        status: "succeeded",
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
        tenantId: A,
        planId,
        batchId: "b1",
        blockIndex: 0,
        provider: "fal",
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        spec: {
          kind: "video",
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        },
        promptHash: "0".repeat(64),
        status: "submitted",
        estUsd: 0.1,
        createdAt: T0,
        updatedAt: T0,
      });
    });
    const rows = await asA(t).query(api.media.assetUrls, { planId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBeNull();
    expect(rows[0]?.status).toBe("submitted");
  });

  test("reel returns a NULL url while the validated triple is absent, whatever the status", async () => {
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
        await ctx.db.patch(planId, {
          renderStatus: "failed",
          renderReason: "speech_out_of_window",
        }),
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
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "video/mp4" }),
      );
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
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "video/mp4" }),
      );
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
    // Wave 6 renamed the wire field; the ROW is a pre-wave-6 one carrying `blockCount`, and it
    // still reads. That fallback is the whole reason the schema widened rather than migrating.
    expect(r.sceneCount).toBe(3);
    expect(r.gates).toEqual(["no_time_stretch", "full_decode"]);
  });
});

describe("jobEstimate: four itemised lines, and the SAME number the rail will consume", () => {
  test("itemises clips, voice, captions and render", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 3 });
    const est = await asA(t).query(api.media.jobEstimate, { planId });

    expect(est.lines.map((l) => l.label)).toEqual([
      "clips",
      "voice",
      "captions",
      "render (incl. one retry)",
    ]);
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
    const { planId } = await seedDeck(t, {
      blocks: 2,
      chars: maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds) + 46,
    });
    const est = await asA(t).query(api.media.jobEstimate, { planId });
    expect(est.refusal).toMatchObject({
      reason: "narration_too_long",
      blockIndex: 0,
      chars: maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds) + 46,
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
    const { planId } = await seedDeck(t, {
      blocks: 2,
      chars: maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds) + 46,
    });
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

  test("REGENERATING RESETS THE PIPELINE and HOLDS THE ARTIFACT — 33-05's rewrite of 20-09", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "video/mp4" }),
      );
      await ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: storageId,
        sidecarStorageId: storageId,
        sidecarHash: "a".repeat(64),
        renderedAt: T0,
        renderRetriedAt: T0,
        renderSummary: { durationS: 20, blockCount: 2, gates: ["g"] },
      });
    });

    await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 0 });

    // 20-09 unset the artifact fields here ("a stale final.mp4 is a lie"); 33-05 supersedes that:
    // the old final stays WATCHABLE through the regenerate (the canvas marks it out of date from
    // the landed count), and the blob is deleted only when the new final lands and nothing —
    // neither the plan nor the reel's vault doc — references it any more.
    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("pending");
    expect(plan?.renderStorageId).toBeDefined();
    expect(plan?.sidecarStorageId).toBeDefined();
    expect(plan?.renderSummary).toBeDefined();
    // The PIPELINE fields do reset — including the auto-retry spend, which the new reservation
    // re-bought (the render line is priced doubled), and the caption plane.
    expect(plan?.renderedAt).toBeUndefined();
    expect(plan?.renderRetriedAt).toBeUndefined();
    // …and the reel query keeps serving the held final.
    expect((await asA(t).query(api.media.reel, { planId })).url).toBeTruthy();
  });
});

describe("the FREE editor: five affordances, none of which costs a cent", () => {
  test("editing a prompt or a narration line costs nothing and clears the render", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    const before = await mediaLeft(t);
    await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: "rendered" }));

    expect(
      await asA(t).mutation(api.media.editBlockPrompt, { planId, blockIndex: 0, prompt: "new" }),
    ).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.shots?.[0]?.prompt).toBe("new");
    expect((await planRowOf(t, planId))?.renderStatus).toBe("pending");

    const line = "y".repeat(minCharsFor(MEDIA_DEFAULT_VIDEO.seconds));
    expect(
      await asA(t).mutation(api.media.editBlockNarration, {
        planId,
        blockIndex: 1,
        narration: line,
      }),
    ).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.shots?.[1]?.narration).toBe(line);

    expect(await mediaLeft(t)).toBe(before);
    expect(await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });

  test("an over-length narration edit is REFUSED with the same count the rail would report", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 1 });
    const tooLong = "z".repeat(maxCharsFor(MEDIA_DEFAULT_VIDEO.seconds) + 46);
    // Without this cure, `narration_too_long` from the rail is a dead end: the user is told the
    // line is too long and has no way to shorten it.
    expect(
      await asA(t).mutation(api.media.editBlockNarration, {
        planId,
        blockIndex: 0,
        narration: tooLong,
      }),
    ).toMatchObject({ ok: false, reason: "narration_too_long", chars: tooLong.length });
    expect((await planRowOf(t, planId))?.shots?.[0]?.narration).not.toBe(tooLong);
  });

  test("reorder permutes, renumbers and recomputes the windows — and rejects a non-permutation", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 3 });
    const promptsBefore = (await planRowOf(t, planId))?.shots?.map((s) => s.prompt);

    expect(await asA(t).mutation(api.media.reorderBlocks, { planId, order: [2, 0, 1] })).toEqual({
      ok: true,
    });
    const after = await planRowOf(t, planId);
    expect(after?.shots?.map((s) => s.prompt)).toEqual([
      promptsBefore?.[2],
      promptsBefore?.[0],
      promptsBefore?.[1],
    ]);
    expect(after?.shots?.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(after?.shots?.map((s) => s.windowStartMs)).toEqual([
      0,
      MEDIA_DEFAULT_VIDEO.seconds * 1000,
      MEDIA_DEFAULT_VIDEO.seconds * 2000,
    ]);

    for (const bad of [
      [0, 1],
      [0, 1, 5],
      [0, 0, 1],
    ]) {
      expect(await asA(t).mutation(api.media.reorderBlocks, { planId, order: bad })).toEqual({
        ok: false,
        reason: "not_a_permutation",
      });
    }
  });

  test("delete splices and renumbers, and refuses to empty the deck", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    expect(await asA(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 })).toEqual({
      ok: true,
    });
    expect((await planRowOf(t, planId))?.shots?.map((s) => s.index)).toEqual([0]);
    expect(await asA(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 })).toEqual({
      ok: false,
      reason: "last_block",
    });
  });

  test("a landed job keeps its OWN blockIndex across a reorder — the snapshot is authoritative", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "b1",
        blockIndex: 0,
        provider: "fal",
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        spec: {
          kind: "video",
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        },
        promptHash: "0".repeat(64),
        status: "succeeded",
        estUsd: 0.1,
        createdAt: T0,
        updatedAt: T0,
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
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "video/mp4" }),
      );
      await ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: storageId,
        sidecarStorageId: storageId,
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

    const line = "y".repeat(minCharsFor(MEDIA_DEFAULT_VIDEO.seconds));
    await expect(asB(t).mutation(api.media.generateReel, { planId })).rejects.toThrow(
      /plan not found/,
    );
    await expect(
      asB(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 0 }),
    ).rejects.toThrow(/plan not found/);
    await expect(
      asB(t).mutation(api.media.editBlockPrompt, { planId, blockIndex: 0, prompt: "x" }),
    ).rejects.toThrow(/plan not found/);
    await expect(
      asB(t).mutation(api.media.editBlockNarration, { planId, blockIndex: 0, narration: line }),
    ).rejects.toThrow(/plan not found/);
    await expect(
      asB(t).mutation(api.media.reorderBlocks, { planId, order: [1, 0] }),
    ).rejects.toThrow(/plan not found/);
    await expect(asB(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 })).rejects.toThrow(
      /plan not found/,
    );

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
    await ctx.db.patch(planId, {
      renderStatus: "pending",
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      // The DECK. `batchToRender` reads it from 20.2 wave 5 onward — the jobs alone no longer
      // describe a reel, because a card has no job and a silent scene has no take.
      shots: Array.from({ length: blocks }, (_, index) => ({
        index,
        type: "AI",
        seconds: MEDIA_DEFAULT_VIDEO.seconds,
        windowStartMs: index * MEDIA_DEFAULT_VIDEO.seconds * 1000,
        description: `scene ${index}`,
        narration: "x".repeat(40),
        prompt: `prompt ${index}`,
      })),
    });
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
                ? {
                    kind: "video",
                    resolution: MEDIA_DEFAULT_VIDEO.resolution,
                    seconds: MEDIA_DEFAULT_VIDEO.seconds,
                  }
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
        tenantId: A,
        planId,
        batchId,
        blockIndex: -1,
        provider: "fal",
        kind: "stt",
        model: MEDIA_DEFAULT_STT.model,
        spec: { kind: "stt", audioMinutes: 0.5 },
        promptHash: "0".repeat(64),
        status: "queued",
        estUsd: 0.01,
        createdAt: T0,
        updatedAt: T0,
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
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId });
    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    return { planId, rows };
  }

  test("a SUCCESSFUL render deletes every intermediate and unsets every field", async () => {
    const t = harness();
    const sidecarStorageId = await storeBlob(t, RENDER_SIDECAR, "application/json");
    const mp4StorageId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    const { planId, rows } = await renderThrough(t, {
      ok: true,
      mp4StorageId,
      sidecarStorageId,
      renderMs: 1000,
      gates: [],
      sceneCount: 2,
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
      ok: true,
      mp4StorageId,
      sidecarStorageId,
      renderMs: 1,
      gates: [],
      sceneCount: 2,
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
      sceneCount: 2,
      renderMs: 1,
      gatesPassed: 2,
      summary: { durationS: 20, sceneCount: 2, gates: ["g", "h"] },
    };
    const run = () =>
      t.run(async (ctx) =>
        ctx.runMutation(internal.render.renderReel.recordRender, {
          tenantId: A,
          planId,
          batchId: "batch_render",
          result,
        }),
      );
    await run();
    await expect(run()).resolves.not.toThrow(); // no "Delete on non-existent doc"
  });
});

// ── 33-04: ONE automatic render retry (transient codes only) + the manual button ───────────────
//
// A narrow, documented supersession of 20-16's "a failed render does NOT retry": the retry fires
// ONCE per plan, only on `TRANSIENT_RENDER_CODES`, guarded by the `renderRetriedAt` CAS inside
// `recordRender` itself. Everything else — deterministic codes, or a plan that already used its
// retry — takes the existing fail + dead-letter path byte-for-byte.

describe("33-04: the one auto-retry CAS and the manual retryRender", () => {
  /** A plan mid-render: batch fully landed and `markRendering` already ran. */
  async function seedMidRender(t: T) {
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: "rendering" }));
    return { planId, batchId };
  }
  const failWith = (t: T, planId: Id<"plans">, batchId: string, reason: string) =>
    t.run((ctx) =>
      ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: A,
        planId,
        batchId,
        result: { ok: false, reason },
      }),
    );
  // 25.1-01: renders are scheduled through the ActionRetrier COMPONENT, so the parent app's
  // `_scheduled_functions` no longer names renderReel. The observable is the run id the schedule
  // writes onto the plan row in the SAME mutation — a new schedule is a new `renderRunId`, and no
  // schedule leaves it untouched. The scheduled run itself still dies harmlessly at
  // `requireEnvMedia` with no render env stubbed (the retrier retries, then `onRenderComplete`
  // finds the plan already terminalized or not-`rendering` and writes nothing that these tests
  // read before their assertions run).
  const renderRunOf = async (t: T, planId: Id<"plans">) =>
    (await planRowOf(t, planId))?.renderRunId;
  const deadLetterRows = (t: T) => t.run((ctx) => ctx.db.query("deadLetters").collect());
  const auditsOf = (t: T, eventType: string) =>
    t.run((ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("eventType"), eventType))
        .collect(),
    );

  test("a TRANSIENT failure retries once: same batch rescheduled, no dead letter, status stays rendering", async () => {
    const t = harness();
    const { planId, batchId } = await seedMidRender(t);

    await failWith(t, planId, batchId, "render_failed");

    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("rendering"); // NOT failed — the canvas keeps saying "assembling"
    expect(plan?.renderRetriedAt).toBeDefined(); // the CAS is set in the SAME mutation
    expect(await deadLetterRows(t)).toHaveLength(0); // the retried attempt is not an operator page

    // The reschedule is a retrier run, recorded on the row; the audit row below pins WHICH batch.
    expect(await renderRunOf(t, planId)).toEqual(expect.any(String));

    // ONE audit row, refs/codes only (§4).
    const audits = await auditsOf(t, "media.render_retried");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({ planId, batchId, reasonCode: "render_failed" });
    expect(JSON.stringify(audits[0]?.payload)).not.toMatch(/url|href|http|\.mp4|\.wav/i);
  });

  test("THE CAP, observed on the mutation: a second transient failure dead-letters exactly as before", async () => {
    const t = harness();
    const { planId, batchId } = await seedMidRender(t);

    await failWith(t, planId, batchId, "render_failed"); // the retry
    const retryRun = await renderRunOf(t, planId);
    expect(retryRun).toEqual(expect.any(String));
    await failWith(t, planId, batchId, "render_failed"); // the retried attempt failing again

    // A version of this code that retries twice leaves the plan at `rendering` with a second
    // scheduled render and no dead letter — every assertion below goes red.
    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("render_failed");
    expect(await deadLetterRows(t)).toHaveLength(1); // ONE dead letter, from the SECOND failure only
    expect(await renderRunOf(t, planId)).toBe(retryRun); // still just the first retry's run
    expect(await auditsOf(t, "media.render_retried")).toHaveLength(1);

    // …and from `failed`, the manual button works: the user decides to spend the third sandbox.
    expect(await asA(t).mutation(api.media.retryRender, { planId })).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.renderStatus).toBe("rendering");
    expect((await planRowOf(t, planId))?.renderReason).toBeUndefined();
    expect(await renderRunOf(t, planId)).not.toBe(retryRun); // the manual retry is its OWN run
    expect(await auditsOf(t, "media.render_retry_manual")).toHaveLength(1);
  });

  test("a DETERMINISTIC code never auto-retries — straight to the dead letter, retry marker untouched", async () => {
    const t = harness();
    const { planId, batchId } = await seedMidRender(t);

    await failWith(t, planId, batchId, "duration_mismatch");

    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("duration_mismatch");
    expect(plan?.renderRetriedAt).toBeUndefined(); // the one retry is still unspent
    expect(await deadLetterRows(t)).toHaveLength(1);
    expect(await renderRunOf(t, planId)).toBeUndefined(); // nothing was scheduled
    expect(await auditsOf(t, "media.render_retried")).toHaveLength(0);
  });

  test("retryRender is FAILED-only and needs a batch: not_failed / nothing_to_render refusals", async () => {
    const t = harness();
    // A rendering plan is not retryable — the button only exists on the failure card.
    const { planId } = await seedMidRender(t);
    expect(await asA(t).mutation(api.media.retryRender, { planId })).toEqual({
      ok: false,
      reason: "not_failed",
    });

    // A failed plan with NO mediaJobs rows has no batch to re-render.
    const bare = await seedPlan(t, A);
    await t.run(async (ctx) =>
      ctx.db.patch(bare, { renderStatus: "failed", renderReason: "incomplete_batch" }),
    );
    expect(await asA(t).mutation(api.media.retryRender, { planId: bare })).toEqual({
      ok: false,
      reason: "nothing_to_render",
    });
    expect(await renderRunOf(t, planId)).toBeUndefined();
    expect(await renderRunOf(t, bare)).toBeUndefined();
  });

  test("retryRender re-fires the LATEST batch when a regenerate minted a newer one", async () => {
    const t = harness();
    const { planId } = await seedRenderable(t, { blocks: 2 });
    // A second, later batch for the same plan — the regenerate idiom.
    await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "batch_newer",
        blockIndex: 0,
        provider: "openai",
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        spec: {
          kind: "video",
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: MEDIA_DEFAULT_VIDEO.seconds,
        },
        promptHash: "d".repeat(64),
        status: "succeeded",
        estUsd: 0.4,
        createdAt: Date.now() + 60_000,
        updatedAt: Date.now() + 60_000,
      });
      await ctx.db.patch(planId, { renderStatus: "failed", renderReason: "render_failed" });
    });

    expect(await asA(t).mutation(api.media.retryRender, { planId })).toEqual({ ok: true });
    expect(await renderRunOf(t, planId)).toEqual(expect.any(String));
    // WHICH batch: the manual-retry audit row records it in the same mutation as the schedule.
    const audits = await auditsOf(t, "media.render_retry_manual");
    expect(audits[0]?.payload).toMatchObject({ planId, batchId: "batch_newer" });
  });
});

// ── 33-04: the fix-menu re-arm — a FREE fix resumes the held reel with no new landing ──────────
//
// `maybeStartRender` fires on LANDINGS. A held reel (failed sibling → `incomplete_batch`) whose
// failed scene is fixed by a free action (kind switch, vault asset pick) has no new landing, so
// the fix mutations re-evaluate the trigger themselves. The fixes are CONTENT-class (no
// `shotsChangedAt` stamp) — landed sibling assets stay fresh, so nothing already paid for is
// wasted (the locked "landed sibling work waits" decision).

describe("33-04: fix-menu re-arm — free fixes resume the held reel", () => {
  // 25.1-01: renders go through the ActionRetrier component (see `renderRunOf` above), so
  // "scheduled" is observed as the run id the trigger writes onto the plan row.
  const renderRunOf = async (t: T, planId: Id<"plans">) =>
    (await planRowOf(t, planId))?.renderRunId;

  /** A scene-deck plan mid-pipeline: batch submitted, ready for landings to drive the REAL
   *  trigger. Rows per the deck: video@0, image@1, (card@2 has no job), video@3, tts everywhere. */
  async function seedHeldScenario(t: T, batchId = "batch_fix") {
    const { planId } = await seedSceneDeck(t); // [generated, animated_image, text_card, generated]
    await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: "pending" }));
    const jobIds: Record<string, Id<"mediaJobs">> = {};
    await t.run(async (ctx) => {
      const insert = async (key: string, kind: "video" | "image" | "tts", blockIndex: number) => {
        jobIds[key] = await ctx.db.insert("mediaJobs", {
          tenantId: A,
          planId,
          batchId,
          blockIndex,
          provider: kind === "tts" ? "openai" : "wan",
          kind,
          model:
            kind === "video"
              ? MEDIA_DEFAULT_VIDEO.model
              : kind === "image"
                ? MEDIA_DEFAULT_IMAGE.model
                : MEDIA_DEFAULT_VOICE.model,
          spec:
            kind === "video"
              ? {
                  kind: "video",
                  resolution: MEDIA_DEFAULT_VIDEO.resolution,
                  seconds: MEDIA_DEFAULT_VIDEO.seconds,
                }
              : kind === "image"
                ? { kind: "image", width: 1080, height: 1920 }
                : { kind: "tts", characters: 20, voice: "nova", sampleRateHertz: 24000 },
          promptHash: "e".repeat(64),
          status: "submitted",
          estUsd: 0.1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      };
      await insert("video0", "video", 0);
      await insert("image1", "image", 1);
      await insert("video3", "video", 3);
      for (const i of [0, 1, 2, 3]) await insert(`tts${i}`, "tts", i);
    });
    // The failed clip lands FIRST, the healthy siblings after — the LAST landing runs the real
    // trigger and writes the hold.
    await land(t, jobIds.video0 as Id<"mediaJobs">, false);
    for (const key of ["image1", "video3", "tts0", "tts1", "tts2", "tts3"]) {
      await land(t, jobIds[key] as Id<"mediaJobs">);
    }
    return { planId, batchId };
  }

  test("setSceneVisual is a CONTENT-class kind switch: overlay set, no stamp, confirmation survives", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    // A confirmed claim on scene 0 — the kind switch does not touch narration, so it must survive.
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      await ctx.db.patch(planId, {
        shots: (plan?.shots ?? []).map((s) =>
          s.index === 0 ? { ...s, needsConfirmation: true, confirmedAt: 111 } : s,
        ),
      });
    });

    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 0,
        visual: "text_card",
        overlay: "Q3 revenue grew 40%",
      }),
    ).toEqual({ ok: true });

    const plan = await planRowOf(t, planId);
    expect(plan?.shots?.[0]?.visual).toBe("text_card");
    expect(plan?.shots?.[0]?.overlay).toBe("Q3 revenue grew 40%");
    expect(plan?.shots?.[0]?.confirmedAt).toBe(111); // the user's vouch stands — words unchanged
    expect(plan?.shots?.[0]?.narration).toBe("line 0");
    // CONTENT-class: no structural stamp, so landed sibling assets stay fresh (the locked
    // "nothing is wasted" decision) — batchToRender must not refuse stale_inputs after a fix.
    expect(plan?.shotsChangedAt).toBeUndefined();
    // …and the render was cleared like every deck edit clears it.
    expect(plan?.renderStatus).toBe("pending");
  });

  test("setSceneVisual refusals: unknown kind, unknown scene, card without words, block deck", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 0,
        visual: "hologram",
      }),
    ).toEqual({ ok: false, reason: "unknown_visual" });
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 99,
        visual: "text_card",
        overlay: "words",
      }),
    ).toEqual({ ok: false, reason: "no_block" });
    // A card with nothing to draw is a black rectangle — the same rule `hasAssetSource` applies.
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 0,
        visual: "text_card",
      }),
    ).toEqual({ ok: false, reason: "no_overlay" });

    // A BLOCK deck has no visual kinds to switch — refuse rather than corrupt the contract.
    const { planId: blockPlan } = await seedDeck(t);
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId: blockPlan,
        sceneIndex: 0,
        visual: "text_card",
        overlay: "words",
      }),
    ).toEqual({ ok: false, reason: "no_deck" });
  });

  test("PITFALL 6 end-to-end: failed clip holds the reel; switch-to-card re-arms and renders, siblings reused", async () => {
    const t = harness();
    const { planId, batchId } = await seedHeldScenario(t);

    // The real trigger wrote the hold: a failed paid scene HOLDS the reel (structural, 20-16).
    const held = await planRowOf(t, planId);
    expect(held?.renderStatus).toBe("failed");
    expect(held?.renderReason).toBe("incomplete_batch");
    expect(held?.renderRunId).toBeUndefined();

    // The FREE fix: scene 0 becomes a text card. No new landing exists — the mutation itself must
    // re-arm the trigger in the same transaction.
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 0,
        visual: "text_card",
        overlay: "The launch, in one card",
      }),
    ).toEqual({ ok: true });

    const rearmed = await planRowOf(t, planId);
    expect(rearmed?.renderStatus).toBe("rendering"); // re-armed AND scheduled, not just reset
    expect(rearmed?.renderReason).toBeUndefined();
    expect(rearmed?.renderRunId).toEqual(expect.any(String)); // a real retrier run was started
    // …against WHICH batch is proven behaviorally just below: batchToRender over this batch
    // succeeds, which is what the scheduled run will read.

    // …and the render it scheduled can actually BUILD: batchToRender reads the fixed deck, takes
    // the landed siblings (fresh — the fix was content-class) and the failed clip's absence is
    // irrelevant because a card needs no job. Not stale_inputs, not not_all_succeeded.
    const batch = await t.run((ctx) =>
      ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId: A, batchId }),
    );
    expect(batch).toMatchObject({ ok: true });
    if (batch.ok) {
      expect(batch.value.scenes[0]).toMatchObject({ kind: "card" });
      expect(batch.value.cards.some((c) => c.text === "The launch, in one card")).toBe(true);
    }
  });

  test("switch to uploaded_video WITHOUT an asset holds honestly; setSceneAsset then resumes", async () => {
    const t = harness();
    const { planId, batchId } = await seedHeldScenario(t);

    // Fix arm 1: kind switch to uploaded_video. There is no asset yet, so the reel must NOT be
    // sent to a render that is known to refuse — it stays held, in words, and the fix menu stays.
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 0,
        visual: "uploaded_video",
      }),
    ).toEqual({ ok: true });
    const stillHeld = await planRowOf(t, planId);
    expect(stillHeld?.renderStatus).toBe("failed");
    expect(stillHeld?.renderReason).toBe("incomplete_batch");
    expect(stillHeld?.renderRunId).toBeUndefined();

    // Fix arm 2: the vault pick — the asset arrives, and THIS mutation re-arms the render.
    const videoId = await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: A,
        title: "b-roll",
        kind: "upload",
        category: "videos",
        source: "upload",
        size: 1,
        contentHash: "f".repeat(64),
        status: "ready",
        createdAt: Date.now(),
        mimeType: "video/mp4",
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" })),
      }),
    );
    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 0,
        vaultDocId: videoId,
      }),
    ).toEqual({ ok: true });

    const resumed = await planRowOf(t, planId);
    expect(resumed?.renderStatus).toBe("rendering");
    expect(resumed?.renderRunId).toEqual(expect.any(String));

    const batch = await t.run((ctx) =>
      ctx.runQuery(internal.render.renderReel.batchToRender, { tenantId: A, batchId }),
    );
    expect(batch).toMatchObject({ ok: true });
  });

  test("a fix on a plan that is NOT held does not schedule anything — landing behavior unchanged", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: "pending" }));
    expect(
      await asA(t).mutation(api.media.setSceneVisual, {
        planId,
        sceneIndex: 0,
        visual: "text_card",
        overlay: "words",
      }),
    ).toEqual({ ok: true });
    expect((await planRowOf(t, planId))?.renderStatus).toBe("pending");
    expect(await renderRunOf(t, planId)).toBeUndefined();
  });
});

// ── CAPTIONS: the transcript, the trigger, the burn and the narrowed retention (plan 20-17) ────
//
// Everything here runs offline at $0. `FAL_FIXTURE` covers the transcript submit and
// `MEDIA_SANDBOX_FIXTURE` the burn — the same two seams the rest of the phase uses.

/** A minimal canonical 24 kHz mono 16-bit PCM wav, which is what the landing plane records a voice
 *  take as. `concatWavTakes` parses this for real; a blob of arbitrary bytes would not be a take. */
function wavBytes(samples: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const view = new DataView(buf.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return buf;
}

/** A sidecar the shipped validator ACCEPTS, with real per-block speech anchors — the rebase is
 *  arithmetic on these, so a fixture that skipped them would prove nothing. */
function sidecarFor(blocks: number, clipSeconds = MEDIA_DEFAULT_VIDEO.seconds): string {
  return JSON.stringify({
    script: "assemble_final.sh",
    scene_count: blocks,
    target_duration_s: blocks * clipSeconds,
    total_duration_s: blocks * clipSeconds,
    actual_duration_s: blocks * clipSeconds,
    gates: ["speech_fits_the_reel"],
    scenes: Array.from({ length: blocks }, (_, i) => ({
      index: i,
      start_s: i * clipSeconds,
      duration_s: clipSeconds,
      visual: "video",
      lead_silence_s: 0.5,
      speech_abs_s: i * clipSeconds + 0.5,
      speech_dur_s: Math.max(0.5, clipSeconds - 1),
      overrun: false,
    })),
  });
}

/** A batch with captions reserved: N landed clips, N landed WAV takes, and one queued `stt` line
 *  at blockIndex -1 — exactly what `reserveJobInner` writes for `withCaptions`. */
async function seedCaptionable(
  t: T,
  opts: { blocks?: number; batchId?: string; takesLanded?: boolean } = {},
) {
  const blocks = opts.blocks ?? 2;
  const batchId = opts.batchId ?? "batch_caps";
  const { planId, jobIds } = await seedInFlight(t, { blocks, batchId });
  const sttJobId = await t.run(async (ctx) => {
    for (const id of jobIds) {
      const row = await ctx.db.get(id as Id<"mediaJobs">);
      if (row?.kind !== "tts") continue;
      const storageId = await ctx.storage.store(
        new Blob([wavBytes(24_000)], { type: "audio/wav" }),
      );
      // `takesLanded` is the difference between the TRIGGER's precondition (rows still in flight,
      // so landing one is what fires it) and the SUBMIT's (the takes already exist, because that
      // is the only state from which a transcript can be bought).
      await ctx.db.patch(id as Id<"mediaJobs">, {
        assetStorageId: storageId,
        ...(opts.takesLanded ? { status: "succeeded" as const } : {}),
      });
    }
    return await ctx.db.insert("mediaJobs", {
      tenantId: A,
      planId,
      batchId,
      blockIndex: -1,
      provider: "openai",
      kind: "stt",
      model: MEDIA_DEFAULT_STT.model,
      spec: { kind: "stt", audioMinutes: 0.5 },
      promptHash: "0".repeat(64),
      status: "queued",
      estUsd: 0.006,
      createdAt: T0,
      updatedAt: T0,
    });
  });
  return { planId, batchId, jobIds, sttJobId };
}

describe("OpenAI caption submission", () => {
  test("clean voice audio is sent as multipart and word timestamps land in owned storage", async () => {
    const t = harness();
    const { batchId, planId, sttJobId } = await seedCaptionable(t, {
      blocks: 2,
      takesLanded: true,
    });
    stubMediaEnv();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ words: [{ word: "Hello", start: 0.1, end: 0.5 }] }), {
          status: 200,
          headers: { "x-request-id": "openai-stt-1" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.action(internal.media.submitCaptions, { tenantId: A, batchId })).toEqual({
      ok: true,
    });

    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("OpenAI transcription was not called");
    const [, init] = firstCall;
    if (!init) throw new Error("OpenAI transcription request options were missing");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("timestamp_granularities[]")).toBe("word");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect((await planRow(t, planId))?.captionOffsetsS).toEqual([0, 1]);
    expect(await jobRow(t, sttJobId)).toMatchObject({
      provider: "openai",
      providerRequestId: "openai-stt-1",
      status: "succeeded",
      mimeType: "application/json",
    });
  });
});

describe("the captions TRIGGER: the last VOICE take starts it, in parallel with the render", () => {
  test("the last tts landing moves the plan to transcribing, and the render starts too", async () => {
    const t = harness();
    const { planId, jobIds } = await seedCaptionable(t, { blocks: 2 });
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    const plan = await planRow(t, planId);
    expect(plan?.captionStatus).toBe("transcribing");
    // Neither waits for the other: a transcript needs the takes, not final.mp4.
    expect(plan?.renderStatus).toBe("rendering");
  });

  test("a deck WITHOUT captions never gains a caption status - 20-16's behaviour, untouched", async () => {
    const t = harness();
    const { planId, jobIds } = await seedInFlight(t, { blocks: 1 });
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    expect((await planRow(t, planId))?.captionStatus).toBeUndefined();
  });

  test("a FAILED voice take says incomplete_takes rather than leaving stt queued forever", async () => {
    const t = harness();
    const { planId, jobIds, sttJobId } = await seedCaptionable(t, { blocks: 2 });
    const ttsIds = await t.run(async (ctx) => {
      const out: Id<"mediaJobs">[] = [];
      for (const id of jobIds) {
        const row = await ctx.db.get(id as Id<"mediaJobs">);
        if (row?.kind === "tts") out.push(id as Id<"mediaJobs">);
      }
      return out;
    });
    await land(t, ttsIds[0] as Id<"mediaJobs">, false);
    for (const id of jobIds.filter((j) => j !== ttsIds[0])) await land(t, id as Id<"mediaJobs">);

    const plan = await planRow(t, planId);
    expect(plan?.captionStatus).toBe("failed");
    expect(plan?.captionReason).toBe("incomplete_takes");
    expect((await jobRow(t, sttJobId))?.status).toBe("queued"); // never submitted, never spent
  });

  test("a re-delivered webhook cannot submit twice - the status transition IS the guard", async () => {
    const t = harness();
    const { planId, jobIds } = await seedCaptionable(t, { blocks: 1 });
    for (const id of jobIds) await land(t, id as Id<"mediaJobs">);
    expect((await planRow(t, planId))?.captionStatus).toBe("transcribing");
    await land(t, jobIds[0] as Id<"mediaJobs">);
    expect((await planRow(t, planId))?.captionStatus).toBe("transcribing");
  });
});

describe("the caption BURN terminal: a failure degrades the reel, it never unpublishes it", () => {
  /** A reel that is PUBLISHED and whose transcript has landed — the only state a burn runs from. */
  async function seedBurnable(t: T, opts: { words?: unknown[] } = {}) {
    const { planId, batchId, jobIds, sttJobId } = await seedCaptionable(t, {
      blocks: 2,
      takesLanded: true,
    });
    const reelId = await storeBlob(t, new Uint8Array([1, 2, 3]), "video/mp4");
    const sidecarId = await storeBlob(t, sidecarFor(2), "application/json");
    const transcriptId = await storeBlob(
      t,
      JSON.stringify({
        words: opts.words ?? [
          { text: "hello", start: 0.5, end: 0.9, type: "word" },
          { text: "there", start: 1.5, end: 1.9, type: "word" },
        ],
      }),
      "application/json",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: reelId,
        sidecarStorageId: sidecarId,
        captionStatus: "burning",
        captionOffsetsS: [0, 1],
      });
      await ctx.db.patch(sttJobId, { status: "succeeded", assetStorageId: transcriptId });
    });
    return { planId, batchId, jobIds, sttJobId, reelId, sidecarId };
  }

  test("a SUCCESSFUL burn repoints the reel, deletes the uncaptioned cut, and captions the plan", async () => {
    const t = harness();
    const { planId, reelId } = await seedBurnable(t);
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({ ok: true, mp4StorageId: "PLACEHOLDER", renderMs: 4200 }),
    );
    // The fixture needs a REAL storage id for the repoint to be observable.
    const captionedId = await storeBlob(t, new Uint8Array([9, 9, 9]), "video/mp4");
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({ ok: true, mp4StorageId: captionedId, renderMs: 4200 }),
    );

    expect(
      await t.action(internal.render.renderReel.burnCaptions, { tenantId: A, planId }),
    ).toEqual({ ok: true });

    const plan = await planRow(t, planId);
    expect(plan?.captionStatus).toBe("captioned");
    expect(plan?.renderStatus).toBe("rendered"); // untouched by the caption plane, always
    expect(plan?.renderStorageId).toBe(captionedId);
    // The uncaptioned cut is gone, and the sidecar — the proof of a governed render — is not.
    expect(await blobExists(t, reelId)).toBe(false);
    expect(await blobExists(t, plan?.sidecarStorageId as Id<"_storage">)).toBe(true);
  });

  test("a FAILED burn leaves the UNCAPTIONED reel published, with a code and a dead letter", async () => {
    const t = harness();
    const { planId, reelId } = await seedBurnable(t);
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    vi.stubEnv("MEDIA_SANDBOX_FIXTURE", JSON.stringify({ ok: false, code: "missing_binary" }));

    expect(
      await t.action(internal.render.renderReel.burnCaptions, { tenantId: A, planId }),
    ).toEqual({ ok: false, reason: "missing_binary" });

    const plan = await planRow(t, planId);
    // THE HALF THAT MATTERS: a missing caption track is a degraded deliverable; an unpublished
    // reel is no deliverable. `renderStatus` and `renderStorageId` are both exactly as they were.
    expect(plan?.renderStatus).toBe("rendered");
    expect(plan?.renderStorageId).toBe(reelId);
    expect(plan?.captionStatus).toBe("failed");
    expect(plan?.captionReason).toBe("missing_binary");
    expect(await blobExists(t, reelId)).toBe(true);

    const letters = await t.run(async (ctx) => await ctx.db.query("deadLetters").collect());
    expect(letters).toHaveLength(1);
    expect(letters[0]?.workflowId).toBe("media.captions");
    // Refs and codes ONLY (CLAUDE.md §4) — no ffmpeg output, no narration, no filename.
    expect(Object.keys(letters[0]?.payload as object).sort()).toEqual([
      "batchId",
      "planId",
      "reasonCode",
    ]);
  });

  test("a transcript with no usable words never buys a sandbox", async () => {
    const t = harness();
    const { planId } = await seedBurnable(t, {
      // Everything the .ass writer drops: spacing and the provider describing the audio.
      words: [
        { text: " ", start: 0.5, end: 0.6, type: "spacing" },
        { text: "(music)", start: 0.6, end: 0.9, type: "audio_event" },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubRenderEnv(); // no MEDIA_SANDBOX_FIXTURE: a real POST would be attempted if it got that far

    expect(
      await t.action(internal.render.renderReel.burnCaptions, { tenantId: A, planId }),
    ).toEqual({ ok: false, reason: "caption_track_empty" });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect((await planRow(t, planId))?.renderStatus).toBe("rendered");
  });

  test("another tenant's plan id resolves to nothing — the check is on the row", async () => {
    const t = harness();
    const { planId } = await seedBurnable(t);
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    expect(
      await t.action(internal.render.renderReel.burnCaptions, { tenantId: B, planId }),
    ).toEqual({ ok: false, reason: "caption_inputs_missing" });
  });
});

describe("the NARROWED retention rule (plan 20-17 over 20-16)", () => {
  /** Drive the render terminal over a batch that DOES reserve captions. */
  async function renderWithCaptions(t: T) {
    const { planId, batchId, sttJobId } = await seedCaptionable(t, {
      blocks: 2,
      takesLanded: true,
    });
    await t.run(async (ctx) => {
      // Every renderable line landed, as `batchToRender` requires.
      for (const row of await ctx.db.query("mediaJobs").collect()) {
        if (row.kind === "video") {
          const id = await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
          );
          await ctx.db.patch(row._id, { status: "succeeded", assetStorageId: id });
        }
      }
      await ctx.db.patch(planId, { captionStatus: "transcribing" });
    });
    const mp4 = await storeBlob(t, new Uint8Array([1, 2, 3]), "video/mp4");
    const sidecar = await storeBlob(t, sidecarFor(2), "application/json");
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({
        ok: true,
        mp4StorageId: mp4,
        sidecarStorageId: sidecar,
        renderMs: 1000,
        gates: ["speech_within_window"],
        sceneCount: 2,
      }),
    );
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId });
    return { planId, batchId, sttJobId };
  }

  test("with captions OWED, the voice takes SURVIVE the render — they are the transcript's source", async () => {
    const t = harness();
    await renderWithCaptions(t);
    const takes = (await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect())).filter(
      (r) => r.kind === "tts",
    );
    expect(takes.length).toBeGreaterThan(0);
    for (const take of takes) {
      expect(
        take.assetStorageId,
        "a voice take was deleted before its transcript was burned",
      ).toBeDefined();
    }
  });

  test("…and they are deleted at the CAPTION terminal instead, once the final artifact exists", async () => {
    const t = harness();
    const { planId } = await renderWithCaptions(t);
    const transcriptId = await storeBlob(
      t,
      JSON.stringify({ words: [{ text: "hi", start: 0.5, end: 0.9, type: "word" }] }),
      "application/json",
    );
    const captionedId = await storeBlob(t, new Uint8Array([9, 9, 9]), "video/mp4");
    await t.run(async (ctx) => {
      const stt = (await ctx.db.query("mediaJobs").collect()).find((r) => r.kind === "stt");
      if (stt) await ctx.db.patch(stt._id, { status: "succeeded", assetStorageId: transcriptId });
      await ctx.db.patch(planId, { captionStatus: "burning", captionOffsetsS: [0, 1] });
    });
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({ ok: true, mp4StorageId: captionedId, renderMs: 100 }),
    );
    await t.action(internal.render.renderReel.burnCaptions, { tenantId: A, planId });

    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    for (const row of rows) {
      expect(row.assetStorageId, `${row.kind} survived the caption terminal`).toBeUndefined();
    }
  });

  test("with captions NOT reserved, the render deletes them exactly as 20-16 did", async () => {
    const t = harness();
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    const mp4 = await storeBlob(t, new Uint8Array([1, 2, 3]), "video/mp4");
    const sidecar = await storeBlob(t, sidecarFor(2), "application/json");
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({
        ok: true,
        mp4StorageId: mp4,
        sidecarStorageId: sidecar,
        renderMs: 1000,
        gates: ["speech_within_window"],
        sceneCount: 2,
      }),
    );
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId });

    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.assetStorageId,
        "20-16's rule regressed for a deck with no captions",
      ).toBeUndefined();
    }
  });
});

// ── 26-08: LEDGER PARITY FOR THE MEDIA RAIL ────────────────────────────────────────────
//
// The third and last rail. Media differs from reasoning and ingest in one structural way that
// shapes every assertion below: **this rail has no refund at all, by design.** `reserveJobInner`
// consumes the whole job's estimate up front and `landResult` consumes only a POSITIVE delta;
// nothing ever credits the window back (plan 20-04's `ponytail:` no-refunds rule — media's
// over-reservation is bounded cents, not the ingest rail's unknowable dollars).
//
// So the ledger's job here is NOT to mirror the limiter cent for cent. It records what each line
// actually COST, while the limiter records what it still needed to CONSUME. The difference is
// exactly the never-returned over-reservation, and `aggregateSpend` already has the vocabulary for
// it: `unlanded`. That is the honest answer, and it is why "an unlanded line is never counted as
// zero actual spend" is a requirement rather than a nicety.
//
// Both sites are REPLAYABLE (an approve CAS, a re-delivered fal webhook), so both DERIVE their
// correlation from refs. Neither mints a nonce — that is the reasoning-rail rule and it is wrong
// here (see docs/playbooks/guardrails.md §"Phase 26").
describe("ledger parity: the media rail reserves whole and lands per line", () => {
  const events = (t: T) => t.run((ctx) => ctx.db.query("spendEvents").collect());

  test("reserving a job writes ONE reserved movement for the WHOLE job, on the batch", async () => {
    const t = harness();
    const planId = await seedPlan(t);

    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");

    const rowsOut = await events(t);
    expect(rowsOut).toHaveLength(1);
    expect(rowsOut[0]).toMatchObject({
      tenantId: A,
      rail: "media",
      phase: "reserved",
      // THE WHOLE JOB, once — not one row per line. The batch floor was applied across all 13
      // lines exactly once (D12a), so per-line reserved rows would not sum back to this number.
      amountCents: JOB_41_CENTS,
      correlationId: `mediabatch:${res.batchId}`,
      planId,
    });
    expect(res.lineCount).toBe(JOB_41_LINES); // non-vacuity: this really is a many-line job
  });

  test("a refused reservation writes no movement at all", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const job = {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: true,
    } as const;

    // Drain the tenant's media window through the REAL rail rather than a test-only door, then ask
    // for one more. 305c a job against a 1000c window, so the fourth is the one that cannot fit.
    let refused: Awaited<ReturnType<typeof reserve>> | null = null;
    for (let i = 0; i < 5 && refused === null; i += 1) {
      const res = await reserve(t, { ...job, blocks: JOB_41() });
      if (!res.ok) refused = res;
    }
    expect(
      refused,
      "the window never refused — the drain loop is not exercising the cap",
    ).not.toBeNull();
    expect(refused?.ok).toBe(false);

    // Exactly the successful reservations are recorded, and the refusal added nothing.
    const reserved = (await events(t)).filter((r) => r.phase === "reserved");
    expect(reserved).toHaveLength(4);
    expect(reserved.reduce((sum, r) => sum + r.amountCents, 0)).toBe(JOB_41_CENTS * 4);
  });

  test("even a REFUSED media job opens coverage — a refusal is a confident zero", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    await t.run((ctx) =>
      ctx.db.insert("guardrailConfig", {
        killSwitch: false,
        mediaKillSwitch: true,
        budgetUsdPerRequest: 0.05,
        updatedAt: Date.now(),
      }),
    );

    const refused = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: true,
    });

    expect(refused).toMatchObject({ ok: false, reason: "kill_switch" });
    expect(await events(t)).toHaveLength(0); // a governed stop is not a spend
    // ...but we WERE watching, and we know for certain nothing was spent. Without this, a tenant
    // paused by the media kill switch would report `unknown` for the whole pause.
    expect(await t.query(internal.spendLedger.coverage, { tenantId: A })).toBeGreaterThan(0);
  });

  test("each landed line writes ONE actual movement carrying that line's own cents", async () => {
    const t = harness();
    const { jobIds } = await seedInFlight(t, { blocks: 2 });

    await land(t, jobIds[0]!);

    const actuals = (await events(t)).filter((r) => r.phase === "actual");
    expect(actuals).toHaveLength(1);
    const landed = await t.run((ctx) => ctx.db.get(jobIds[0]!));
    expect(actuals[0]).toMatchObject({
      rail: "media",
      phase: "actual",
      // The LINE's reconciled cost, which is what the row now carries — not the batch estimate
      // and not the delta the limiter consumed.
      amountCents: landed?.actualCents,
      mediaJobId: jobIds[0],
    });
    expect(landed?.actualCents).toBeGreaterThan(0); // the assertion above is not vacuous
  });

  test("every line of ONE batch lands its own movement — they must not share a correlation", async () => {
    const t = harness();
    const { jobIds } = await seedInFlight(t, { blocks: 2 });
    expect(jobIds.length).toBeGreaterThan(1); // non-vacuity: there really are sibling lines

    for (const jobId of jobIds) await land(t, jobId);

    // THE UNDER-COUNT THIS RAIL IS MOST EXPOSED TO. Every line of a batch shares one `batchId`, so
    // a batch-scoped correlation would make the FIRST landing suppress every sibling as a replay —
    // a 13-line reel would record one clip and lose the other twelve. Replay identity is
    // (tenant, correlation, phase), and `reserved` vs `actual` differ, so the collision with the
    // reservation row is NOT what saves us here: the job id in the string is.
    const actuals = (await events(t)).filter((r) => r.phase === "actual");
    expect(actuals).toHaveLength(jobIds.length);
    expect(new Set(actuals.map((r) => r.correlationId)).size).toBe(jobIds.length);
  });

  test("a re-delivered webhook writes no second actual movement", async () => {
    const t = harness();
    const { jobIds } = await seedInFlight(t, { blocks: 2 });

    await land(t, jobIds[0]!);
    await land(t, jobIds[0]!); // fal retries; the row is already terminal

    expect((await events(t)).filter((r) => r.phase === "actual")).toHaveLength(1);
  });

  test("a FAILED line writes NO actual movement — it stays unlanded, not zero", async () => {
    const t = harness();
    const { jobIds } = await seedInFlight(t, { blocks: 2 });

    await land(t, jobIds[0]!, false); // provider error
    await land(t, jobIds[1]!, true); // and a sibling that really landed

    // Nothing landed for the failed line, so nothing is recorded as landed. A zero-cent row is
    // rejected outright by validateSpendMovement anyway, and writing one would claim the line cost
    // nothing when in truth its share of the reservation was consumed and never returned.
    //
    // The sibling is what makes this non-vacuous: the assertion is "ONE actual, from the line that
    // succeeded", not "no actuals at all", which would pass on a rail that records nothing.
    const actuals = (await events(t)).filter((r) => r.phase === "actual");
    expect(actuals).toHaveLength(1);
    expect(actuals[0]?.mediaJobId).toBe(jobIds[1]);
    expect((await t.run((ctx) => ctx.db.get(jobIds[0]!)))?.status).toBe("failed");
  });

  test("the never-refunded over-reservation reads as unlanded, not as returned money", async () => {
    const t = harness();
    const planId = await seedPlan(t);
    const res = await reserve(t, {
      tenantId: A,
      planId,
      blocks: JOB_41(),
      clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
      withCaptions: true,
    });
    if (!res.ok) throw new Error("expected ok");

    const movements = await events(t);
    const reserved = movements
      .filter((r) => r.phase === "reserved")
      .reduce((sum, r) => sum + r.amountCents, 0);
    const refunded = movements.filter((r) => r.phase === "refunded");

    expect(reserved).toBe(JOB_41_CENTS);
    // THE MEDIA RAIL NEVER REFUNDS. If a refund movement ever appears here, either the rail grew
    // a credit path (a real design change that must be argued, not slipped in) or something is
    // minting money into the ledger that the limiter never returned.
    expect(refunded).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE SCENE TIMELINE reaches the adapters (phase 20.2, wave 2)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** A SCENE-shaped deck on the plan row: `visual` instead of `type`, per-scene `seconds`, and a
 *  `windowStartMs` that is a RUNNING SUM rather than a uniform grid. Durations deliberately
 *  disagree — a fixture where they happened to match could not tell the two arithmetics apart. */
async function seedSceneDeck(
  t: T,
  opts: { tenantId?: string; seconds?: number[]; target?: number; visuals?: string[] } = {},
) {
  const tenantId = opts.tenantId ?? A;
  const seconds = opts.seconds ?? [8, 6, 4, 12];
  const visuals = opts.visuals ?? [
    "generated_video",
    "animated_image",
    "text_card",
    "generated_video",
  ];
  const planId = await seedPlan(t, tenantId);
  let startMs = 0;
  const shots = seconds.map((sec, i) => {
    const shot = {
      index: i,
      visual: visuals[i] ?? "generated_video",
      seconds: sec,
      windowStartMs: startMs,
      description: `scene ${i}`,
      prompt: `prompt ${i}`,
      narration: `line ${i}`,
      // A card must name its words or `hasAssetSource` refuses it — the narrowed guard is about
      // naming the SOURCE, and a card with nothing to draw is a black rectangle.
      ...((visuals[i] ?? "") === "text_card" ? { overlay: `card ${i}` } : {}),
    };
    startMs += sec * 1000;
    return shot;
  });
  await t.run(async (ctx) =>
    ctx.db.patch(planId, {
      targetDurationSeconds: opts.target ?? seconds.reduce((n, x) => n + x, 0),
      clipSeconds: Math.max(...seconds),
      shots,
    }),
  );
  return { planId, seconds, shots };
}

describe("20.2 wave 2 — the ordering arithmetic is a RUNNING SUM", () => {
  test("reorder recomputes offsets from each scene's OWN length, not index * clipSeconds", async () => {
    const t = harness();
    // 8 / 6 / 4 / 12 reordered to 12 / 4 / 8 / 6 must give offsets 0 / 12000 / 16000 / 24000.
    // The old `index * clipSeconds` arithmetic would have written 0 / 12000 / 24000 / 36000 off
    // the deck-wide clipSeconds (12) — a grid none of these scenes was cut to, and a 36-second
    // offset inside a 30-second reel.
    const { planId } = await seedSceneDeck(t);

    expect(await asA(t).mutation(api.media.reorderBlocks, { planId, order: [3, 2, 0, 1] })).toEqual(
      { ok: true },
    );

    const after = await planRowOf(t, planId);
    expect(after?.shots?.map((x) => x.seconds)).toEqual([12, 4, 8, 6]);
    expect(after?.shots?.map((x) => x.windowStartMs)).toEqual([0, 12_000, 16_000, 24_000]);
    expect(after?.shots?.map((x) => x.index)).toEqual([0, 1, 2, 3]);
  });

  test("delete re-closes the timeline — no hole where the removed scene was", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    expect(await asA(t).mutation(api.media.deleteBlock, { planId, blockIndex: 1 })).toEqual({
      ok: true,
    });
    const after = await planRowOf(t, planId);
    // 8 / 4 / 12 — the 6-second scene is gone and everything after it moved UP by exactly 6s.
    expect(after?.shots?.map((x) => x.seconds)).toEqual([8, 4, 12]);
    expect(after?.shots?.map((x) => x.windowStartMs)).toEqual([0, 8_000, 12_000]);
  });

  test("a UNIFORM deck is byte-identical under the new arithmetic — this is a generalisation", async () => {
    const t = harness();
    const { planId, clipSeconds } = await seedDeck(t, { blocks: 3 });
    await asA(t).mutation(api.media.reorderBlocks, { planId, order: [2, 1, 0] });
    const after = await planRowOf(t, planId);
    expect(after?.shots?.map((x) => x.windowStartMs)).toEqual([
      0,
      clipSeconds * 1000,
      clipSeconds * 2000,
    ]);
  });
});

describe("20.2 wave 5 — THE SCENE GATE OPENS: a scene deck is finally buyable", () => {
  test("generateReel RESERVES it, priced per kind rather than at a uniform clipSeconds", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok, `refused: ${res.ok ? "" : res.reason}`).toBe(true);
    const inserted = await t.run((ctx) => ctx.db.query("mediaJobs").collect());
    // 8s clip + 6s still + 4s card + 12s clip: TWO video lines, ONE image, NO line for the card.
    // Under the block contract this deck could not be bought at all.
    expect(
      inserted
        .filter((r) => r.kind === "video")
        .map((r) => r.blockIndex)
        .sort(),
    ).toEqual([0, 3]);
    expect(inserted.filter((r) => r.kind === "image").map((r) => r.blockIndex)).toEqual([1]);
    expect(inserted.some((r) => r.kind === "video" && r.blockIndex === 2)).toBe(false);
  });

  test("each generated clip is bought at ITS OWN length — the ~60% overcharge that would have been", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await asA(t).mutation(api.media.generateReel, { planId });
    const secs = (await t.run((ctx) => ctx.db.query("mediaJobs").collect()))
      .filter((r) => r.kind === "video")
      .map((r) => (r.spec.kind === "video" ? r.spec.seconds : 0))
      .sort((l, r) => l - r);
    // If `deckOf` ever read a scene row, both would be priced at the deck-wide `clipSeconds` (12).
    expect(secs).toEqual([8, 12]);
  });

  test("the canvas estimate opens in the SAME commit — a working button behind a refusing estimate spends money nothing showed", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    const estimate = await asA(t).query(api.media.jobEstimate, { planId });
    expect(estimate.refusal).toBeNull();
    expect(estimate.totalCents).toBeGreaterThan(0);
    // ONE LINE PER PAID KIND (wave 7). The blended `pictures` row wave 5 printed hid the only
    // lever the user has: 20 s of generated clip is $2.00 and the still beside it is $0.01.
    expect(estimate.lines.map((l) => l.label)).toEqual([
      "clips",
      "stills",
      "voice",
      "captions",
      "render (incl. one retry)",
    ]);
    const line = (label: string) => estimate.lines.find((l) => l.label === label);
    expect(line("clips")?.qty).toBe(2);
    expect(line("clips")?.cents).toBe(200); // 8 s + 12 s at $0.10 a second
    expect(line("stills")?.qty).toBe(1);
    expect(line("stills")?.cents).toBe(1); // ONE still, whatever its scene's length
    // 33-04: the render line is DOUBLED at its one source so the retry sandbox is reserved, not
    // silent drift on the no-refunds rail. Both money sites read the same constant; this pins the
    // estimate side, and `res.estCents === estimate.totalCents` below pins the reservation side.
    expect(line("render (incl. one retry)")?.cents).toBe(
      Math.round(MEDIA_SANDBOX_USD_PER_RENDER * 100),
    );
    expect(MEDIA_SANDBOX_USD_PER_RENDER).toBe(0.04);
    // The card buys nothing, so it has no line at all — not a zero-cent row to scan past.
  });

  test("the estimate and the reservation agree — the canvas names the number it will charge", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    const estimate = await asA(t).query(api.media.jobEstimate, { planId });
    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.estCents).toBe(estimate.totalCents);
  });

  test("a card with NO words refuses the whole deck, and buys nothing", async () => {
    const t = harness();
    // The narrowed guard in the direction that matters: `unrenderable_block` no longer means
    // "unpaid", it means "does not name what its picture is built from".
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) =>
        s.visual === "text_card" ? { ...s, overlay: undefined } : s,
      );
      await ctx.db.patch(planId, { shots });
    });
    const before = await t.query(internal.guardrails.mediaRemainingCents, { tenantId: A });
    expect(await asA(t).mutation(api.media.generateReel, { planId })).toEqual({
      ok: false,
      reason: "unrenderable_block",
    });
    expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
    expect(await t.query(internal.guardrails.mediaRemainingCents, { tenantId: A })).toBe(before);
  });

  // The AGENT's approve arm opened in wave 8 and its test moved to `cockpit.test.ts`, which is
  // where that mutation's harness lives — reaching `EXTERNAL_TARGETS` needs the action-retrier
  // component this file deliberately does not mount. `scene_render_not_ready` is gone with it.

  // ── 20.2 wave 6: regenerating ONE scene, against the WHOLE deck's timeline ───────────────────
  test("regenerating ONE scene buys that scene ALONE — and is priced against the whole deck", async () => {
    const t = harness();
    // 8 s generated_video / 6 s animated_image / 4 s text_card / 12 s generated_video = 30 s.
    const { planId } = await seedSceneDeck(t);
    const res = await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 1 });
    expect(res.ok).toBe(true);

    const rows = await t.run(async (ctx) => await ctx.db.query("mediaJobs").collect());
    // Scene 1's still and its take, plus the deck-wide captions line at index -1. NOT the other
    // three scenes, and in particular not scene 3's $0.40 clip.
    expect(rows.map((r) => `${r.blockIndex}:${r.kind}`).sort()).toEqual([
      "-1:stt",
      "1:image",
      "1:tts",
    ]);
    // The captions line prices the WHOLE reel, because re-buying one scene re-renders and
    // re-captions all thirty seconds of it.
    expect(rows.find((r) => r.kind === "stt")?.spec).toEqual({
      kind: "stt",
      audioMinutes: 30 / 60,
    });
  });

  test("a partial buy still refuses on a NEIGHBOUR's broken row — the deck is validated whole", async () => {
    const t = harness();
    // Scene 2 is a card with no words: `hasAssetSource` refuses it, and it is not the scene being
    // re-bought. Reserving anyway would take the money and hand the render a deck it cannot build.
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) => (s.index === 2 ? { ...s, overlay: "  " } : s));
      await ctx.db.patch(planId, { shots });
    });
    expect(await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 0 })).toEqual({
      ok: false,
      reason: "unrenderable_block",
    });
    expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });

  // ── 20.2 wave 6: the vault picker, checked where the refusal is free ─────────────────────────
  test("setSceneAsset points an upload at a vault VIDEO, and refuses everything else", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t, {
      visuals: ["uploaded_video", "animated_image", "text_card", "generated_video"],
    });
    const { videoId, pdfId, foreignId } = await t.run(async (ctx) => {
      const store = async (type: string) =>
        await ctx.storage.store(new Blob([new Uint8Array([1])], { type }));
      const base = {
        title: "t",
        kind: "upload",
        category: "other",
        source: "upload",
        size: 1,
        contentHash: "f".repeat(64),
        status: "ready" as const,
        createdAt: T0,
      };
      return {
        videoId: await ctx.db.insert("vaultDocuments", {
          ...base,
          tenantId: A,
          mimeType: "video/mp4",
          storageId: await store("video/mp4"),
        }),
        pdfId: await ctx.db.insert("vaultDocuments", {
          ...base,
          tenantId: A,
          mimeType: "application/pdf",
          storageId: await store("application/pdf"),
        }),
        // Another tenant's video. The whole reason this check is on the ROW.
        foreignId: await ctx.db.insert("vaultDocuments", {
          ...base,
          tenantId: B,
          mimeType: "video/mp4",
          storageId: await store("video/mp4"),
        }),
      };
    });

    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 0,
        vaultDocId: videoId,
      }),
    ).toEqual({ ok: true });
    const shot = (await planRowOf(t, planId))?.shots?.[0];
    expect(shot?.asset).toEqual({ source: "vault", docId: videoId });

    // A document that is not a video would clear the money gate — an upload buys nothing — and
    // then hard-error inside a sandbox the deck has already paid for.
    expect(
      await asA(t).mutation(api.media.setSceneAsset, { planId, blockIndex: 0, vaultDocId: pdfId }),
    ).toEqual({ ok: false, reason: "not_a_video" });
    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 0,
        vaultDocId: foreignId,
      }),
    ).toEqual({ ok: false, reason: "no_document" });
    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 0,
        vaultDocId: "not-an-id",
      }),
    ).toEqual({ ok: false, reason: "no_document" });
    // …and a scene whose picture is generated has no asset to point anywhere.
    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 3,
        vaultDocId: videoId,
      }),
    ).toEqual({ ok: false, reason: "not_an_upload" });
    // The one accepted write stands; four refusals changed nothing.
    expect((await planRowOf(t, planId))?.shots?.[0]?.asset).toEqual({
      source: "vault",
      docId: videoId,
    });
  });

  test("a scene with NOTHING to buy says so — it does not open a transaction for air", async () => {
    const t = harness();
    // A silent text card: drawn by ffmpeg, no clip, no take, nothing to re-buy. The cure is to
    // edit its words and generate the reel, and the refusal has to say which.
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) => (s.index === 2 ? { ...s, narration: "" } : s));
      await ctx.db.patch(planId, { shots });
    });
    expect(await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 2 })).toEqual({
      ok: false,
      reason: "nothing_to_regenerate",
    });
    expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toHaveLength(0);
  });
});

describe("20.2 wave 2 — the money gate asks the PROVIDER what it can buy", () => {
  test("a clip length the pinned model cannot produce refuses BEFORE any pricing", async () => {
    const t = harness();
    // 10 seconds is in `CLIP_SECONDS` (the display set) and NOT in the Sora grid. Before 20.2 it
    // cleared this gate and was refused three checks later inside `estimateMediaUsd` — same code,
    // wrong place, and it read like a pricing bug.
    const { planId } = await seedDeck(t, { clipSeconds: 10, chars: 90 });
    expect(await asA(t).mutation(api.media.generateReel, { planId })).toEqual({
      ok: false,
      reason: "illegal_duration",
    });
  });

  test("the canvas estimate names the SAME refusal, so the button explains itself", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { clipSeconds: 10, chars: 90 });
    const estimate = await asA(t).query(api.media.jobEstimate, { planId });
    expect(estimate.refusal).toEqual({ reason: "illegal_duration" });
  });

  test("every duration the pinned model DOES support is buyable", async () => {
    for (const seconds of MEDIA_VIDEO_SECONDS[MEDIA_DEFAULT_VIDEO.model] ?? []) {
      const t = harness();
      const { planId } = await seedDeck(t, {
        blocks: 1,
        clipSeconds: seconds,
        chars: minCharsFor(seconds),
      });
      const estimate = await asA(t).query(api.media.jobEstimate, { planId });
      expect(estimate.refusal).toBeNull();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 33-02 — the BRIEF plane and the TWO-DECK variation plane
// ═════════════════════════════════════════════════════════════════════════════════════════════

const BRIEF = {
  topic: "solar for smallholders",
  durationSeconds: 30,
  audience: "model-guessed farmers",
  tone: "warm",
  defaulted: ["audience", "tone"],
};

/** A second, deliberately DIFFERENT scene deck parked as the alternate: a 12 s clip + a 3 s
 *  still (15 s total, both lengths the pinned models accept) against the primary's 8/6/4/12
 *  (30 s) — so a swapped estimate, target and narration set are all distinguishable. */
async function seedAltDeck(t: T, planId: Id<"plans">) {
  const seconds = [12, 3];
  const visuals = ["generated_video", "animated_image"];
  let startMs = 0;
  const altShots = seconds.map((sec, i) => {
    const shot = {
      index: i,
      visual: visuals[i] ?? "generated_video",
      seconds: sec,
      windowStartMs: startMs,
      description: `alt scene ${i}`,
      prompt: `alt prompt ${i}`,
      narration: `alt line ${i}`,
    };
    startMs += sec * 1000;
    return shot;
  });
  await t.run(async (ctx) => ctx.db.patch(planId, { altShots, altTargetDurationSeconds: 15 }));
  return altShots;
}

describe("33-02 editBrief: a chip edit patches the BRIEF plane and nothing else", () => {
  test("merges the patch, strips edited fields from `defaulted`, stamps briefChangedAt — and never moves the money contract", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t); // targetDurationSeconds 30, shots 8/6/4/12
    await t.run(async (ctx) => ctx.db.patch(planId, { brief: BRIEF }));
    const shotsBefore = (await planRowOf(t, planId))?.shots;

    expect(
      await asA(t).mutation(api.media.editBrief, {
        planId,
        patch: { durationSeconds: 60, audience: "smallholder co-ops" },
      }),
    ).toEqual({ ok: true });

    const plan = await planRowOf(t, planId);
    expect(plan?.brief).toMatchObject({
      topic: BRIEF.topic, // unedited chips stand
      durationSeconds: 60, // the USER'S ask moved…
      audience: "smallholder co-ops",
      tone: BRIEF.tone,
      defaulted: ["tone"], // …and `audience` is no longer a model guess
    });
    expect(plan?.briefChangedAt).toBeTypeOf("number");
    // THE INVARIANT: the deck's own money contract is byte-untouched. A brief/deck divergence is
    // exactly what the stale badge expresses — never an estimate refusal, never a silent re-deck.
    expect(plan?.targetDurationSeconds).toBe(30);
    expect(plan?.shots).toEqual(shotsBefore);
    expect(plan?.shotsChangedAt).toBeUndefined();
  });

  test("a duration outside the presets refuses illegal_duration and writes NOTHING", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => ctx.db.patch(planId, { brief: BRIEF }));
    expect(
      await asA(t).mutation(api.media.editBrief, { planId, patch: { durationSeconds: 45 } }),
    ).toEqual({ ok: false, reason: "illegal_duration" });
    const plan = await planRowOf(t, planId);
    expect(plan?.brief).toEqual(BRIEF);
    expect(plan?.briefChangedAt).toBeUndefined();
  });

  test("a locked deck refuses deck_locked — post-Generate edits are canvas-only, on the paid rail", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => ctx.db.patch(planId, { brief: BRIEF, deckLockedAt: 1 }));
    expect(
      await asA(t).mutation(api.media.editBrief, { planId, patch: { topic: "something else" } }),
    ).toEqual({ ok: false, reason: "deck_locked" });
    expect((await planRowOf(t, planId))?.brief).toEqual(BRIEF);
  });

  test("a plan that never had a brief refuses no_brief rather than inventing one", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    expect(await asA(t).mutation(api.media.editBrief, { planId, patch: { topic: "x" } })).toEqual({
      ok: false,
      reason: "no_brief",
    });
    expect((await planRowOf(t, planId))?.brief).toBeUndefined();
  });

  test("tenant B's edit THROWS — writes throw where reads return empty", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t, { tenantId: A });
    await t.run(async (ctx) => ctx.db.patch(planId, { brief: BRIEF }));
    await expect(
      asB(t).mutation(api.media.editBrief, { planId, patch: { topic: "stolen" } }),
    ).rejects.toThrow(/plan not found/);
  });
});

describe("33-02 switchDeck: the unpicked deck swaps in atomically, until Generate locks the choice", () => {
  test("swaps shots↔altShots AND the two targets, stamps shotsChangedAt, clears the render", async () => {
    const t = harness();
    const { planId, shots } = await seedSceneDeck(t);
    const altShots = await seedAltDeck(t, planId);
    await t.run(async (ctx) => ctx.db.patch(planId, { renderStatus: "rendered" }));

    expect(await asA(t).mutation(api.media.switchDeck, { planId })).toEqual({ ok: true });

    const plan = await planRowOf(t, planId);
    expect(plan?.shots).toEqual(altShots);
    expect(plan?.targetDurationSeconds).toBe(15);
    expect(plan?.altShots).toEqual(shots);
    expect(plan?.altTargetDurationSeconds).toBe(30);
    // Structural stamp: landed assets belong to the deck that BOUGHT them, so invalidating the
    // reuse window on a switch is correct, not collateral damage.
    expect(plan?.shotsChangedAt).toBeTypeOf("number");
    // …and the render pipeline resets. (33-05: the artifact fields are HELD, not unset — the
    // other deck's reel stays watchable, labelled out of date, until a new final replaces it.)
    expect(plan?.renderStatus).toBe("pending");
  });

  test("switching twice round-trips the decks byte-for-byte", async () => {
    const t = harness();
    const { planId, shots } = await seedSceneDeck(t);
    const altShots = await seedAltDeck(t, planId);
    await asA(t).mutation(api.media.switchDeck, { planId });
    await asA(t).mutation(api.media.switchDeck, { planId });
    const plan = await planRowOf(t, planId);
    expect(plan?.shots).toEqual(shots);
    expect(plan?.targetDurationSeconds).toBe(30);
    expect(plan?.altShots).toEqual(altShots);
    expect(plan?.altTargetDurationSeconds).toBe(15);
  });

  test("sceneDeckOf and jobEstimate always read plans.shots — the money path never learns variations exist", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await seedAltDeck(t, planId);

    // Before the switch: the picked deck is 8 s + 12 s of paid clip → 200 cents of clips.
    const before = await asA(t).query(api.media.jobEstimate, { planId });
    expect(before.lines.find((l) => l.label === "clips")?.cents).toBe(200);

    await asA(t).mutation(api.media.switchDeck, { planId });

    // After: the SAME query, textually untouched by this plan, prices the formerly-alternate deck
    // (one 12 s clip → 120 cents) because `plans.shots` IS the picked deck.
    const row = await planRowOf(t, planId);
    const deck = row ? sceneDeckOf(row) : null;
    expect(deck?.targetDurationSeconds).toBe(15);
    expect(deck?.scenes.map((s) => s.narration)).toEqual(["alt line 0", "alt line 1"]);
    const after = await asA(t).query(api.media.jobEstimate, { planId });
    expect(after.refusal).toBeNull();
    expect(after.lines.find((l) => l.label === "clips")?.cents).toBe(120);
  });

  test("no_alternate when there is nothing to switch to", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    expect(await asA(t).mutation(api.media.switchDeck, { planId })).toEqual({
      ok: false,
      reason: "no_alternate",
    });
  });

  test("deck_locked once Generate has bought against the picked deck", async () => {
    const t = harness();
    const { planId, shots } = await seedSceneDeck(t);
    await seedAltDeck(t, planId);
    await t.run(async (ctx) => ctx.db.patch(planId, { deckLockedAt: 1 }));
    expect(await asA(t).mutation(api.media.switchDeck, { planId })).toEqual({
      ok: false,
      reason: "deck_locked",
    });
    expect((await planRowOf(t, planId))?.shots).toEqual(shots);
  });

  test("tenant B's switch THROWS", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t, { tenantId: A });
    await seedAltDeck(t, planId);
    await expect(asB(t).mutation(api.media.switchDeck, { planId })).rejects.toThrow(
      /plan not found/,
    );
  });
});

describe("33-02 confirmClaim: the provenance front door — confirmation is the USER'S word only", () => {
  /** Scene 1 carries a cited claim awaiting the user's word. The narration is deliberately
   *  distinctive so the audit-redaction test can scan for it. */
  async function seedClaim(t: T) {
    const { planId } = await seedSceneDeck(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) =>
        s.index === 1
          ? {
              ...s,
              narration: "REVENUE-GREW-BY-40-PERCENT",
              source: { docId: "doc123", title: "Q3 board deck" },
              needsConfirmation: true,
            }
          : s,
      );
      await ctx.db.patch(planId, { shots });
    });
    return planId;
  }

  test("confirm writes confirmedAt from the authenticated context — args carry only planId + sceneIndex", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await t.run(async (ctx) => ctx.db.patch(planId, { renderStatus: "rendered" }));

    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 })).toEqual({
      ok: true,
    });

    const plan = await planRowOf(t, planId);
    expect(plan?.shots?.[1]?.confirmedAt).toBeTypeOf("number");
    expect(plan?.shots?.[1]?.needsConfirmation).toBe(true); // the flag survives; the timestamp answers it
    // NOT a structural deck edit, and NOT a content change: no staleness stamp, no render clear.
    expect(plan?.shotsChangedAt).toBeUndefined();
    expect(plan?.renderStatus).toBe("rendered");
  });

  test("the arg validator structurally cannot carry an actor or a timestamp", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await expect(
      asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1, confirmedAt: 5 } as never),
    ).rejects.toThrow(/Unexpected field `confirmedAt`/);
    await expect(
      asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1, actor: "model" } as never),
    ).rejects.toThrow(/Unexpected field `actor`/);
    expect((await planRowOf(t, planId))?.shots?.[1]?.confirmedAt).toBeUndefined();
  });

  test("re-confirming is idempotent, a missing scene is no_block, an unclaimed scene is not_a_claim", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 })).toEqual({
      ok: true,
    });
    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 })).toEqual({
      ok: true,
    });
    expect((await planRowOf(t, planId))?.shots?.[1]?.confirmedAt).toBeTypeOf("number");
    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 9 })).toEqual({
      ok: false,
      reason: "no_block",
    });
    // Scene 0 states no figure — confirming it would mint a confirmation with nothing to confirm.
    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 0 })).toEqual({
      ok: false,
      reason: "not_a_claim",
    });
    expect((await planRowOf(t, planId))?.shots?.[0]?.confirmedAt).toBeUndefined();
  });

  test("ONE audit row, refs only — never the claim text, the title, or the narration", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 });
    const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());
    const confirms = rows.filter((r) => r.eventType === "media.claim_confirmed");
    expect(confirms).toHaveLength(1);
    // The KEY SET is pinned sorted, so an added payload field fails here (the cash.ts idiom).
    expect(Object.keys(confirms[0]?.payload ?? {}).sort()).toEqual(["planId", "sceneIndex"]);
    expect(confirms[0]?.payload).toEqual({ planId, sceneIndex: 1 });
    // §4: the serialized row must not carry content-plane text.
    const serialized = JSON.stringify(confirms[0]);
    expect(serialized).not.toContain("REVENUE-GREW-BY-40-PERCENT");
    expect(serialized).not.toContain("Q3 board deck");
  });

  test("editing the confirmed scene's narration CLEARS its confirmation — a changed claim is unconfirmed", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 });

    expect(
      await asA(t).mutation(api.media.editBlockNarration, {
        planId,
        blockIndex: 1,
        narration: "REVENUE-GREW-BY-90-PERCENT",
      }),
    ).toEqual({ ok: true });

    const shot = (await planRowOf(t, planId))?.shots?.[1];
    expect(shot?.confirmedAt).toBeUndefined(); // the user vouched for the OLD words
    expect(shot?.needsConfirmation).toBe(true); // …and the new words still state a figure
    expect(shot?.source).toEqual({ docId: "doc123", title: "Q3 board deck" });
  });

  test("re-writing the SAME narration leaves the confirmation standing — nothing changed to unconfirm", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 });
    await asA(t).mutation(api.media.editBlockNarration, {
      planId,
      blockIndex: 1,
      narration: "REVENUE-GREW-BY-40-PERCENT",
    });
    expect((await planRowOf(t, planId))?.shots?.[1]?.confirmedAt).toBeTypeOf("number");
  });

  test("reorder and delete leave a sibling's confirmation riding its OWN scene", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 });

    await asA(t).mutation(api.media.reorderBlocks, { planId, order: [3, 1, 0, 2] });
    let confirmed = (await planRowOf(t, planId))?.shots?.find(
      (s) => s.narration === "REVENUE-GREW-BY-40-PERCENT",
    );
    expect(confirmed?.confirmedAt).toBeTypeOf("number");
    expect(confirmed?.source).toEqual({ docId: "doc123", title: "Q3 board deck" });

    // Deleting a DIFFERENT scene renumbers through patchShots; the claim keeps its fields.
    await asA(t).mutation(api.media.deleteBlock, { planId, blockIndex: 0 });
    confirmed = (await planRowOf(t, planId))?.shots?.find(
      (s) => s.narration === "REVENUE-GREW-BY-40-PERCENT",
    );
    expect(confirmed?.confirmedAt).toBeTypeOf("number");
  });

  test("tenant B's confirm THROWS", async () => {
    const t = harness();
    const planId = await seedClaim(t);
    await expect(
      asB(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 }),
    ).rejects.toThrow(/plan not found/);
  });
});

// ── 33-03: the unconfirmed_claims gate — the estimate and the reserve open TOGETHER ─────────────
//
// An unconfirmed factual claim blocks BOTH money sites with the same refusal: the number the
// canvas shows and the button beside it open together or not at all (the wave-5 co-location rule).
// The reserve-side check is the one that matters under mutation: deleting it must send a test RED
// because a reservation SUCCEEDS with an unconfirmed claim — money moved is the red.

/** Mark the given scene indices as stating unvouched figures. */
async function flagClaims(t: T, planId: Id<"plans">, indices: number[]) {
  await t.run(async (ctx) => {
    const plan = await ctx.db.get(planId);
    const shots = (plan?.shots ?? []).map((s) =>
      indices.includes(s.index) ? { ...s, needsConfirmation: true } : s,
    );
    await ctx.db.patch(planId, { shots });
  });
}

describe("33-03 the confirm gate: unconfirmed claims block the estimate AND the reservation", () => {
  test("jobEstimate refuses unconfirmed_claims, naming the FIRST offending scene — free, before the button", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await flagClaims(t, planId, [1, 3]);
    const estimate = await asA(t).query(api.media.jobEstimate, { planId });
    expect(estimate.refusal).toEqual({ reason: "unconfirmed_claims", blockIndex: 1 });
    expect(estimate.totalCents).toBe(0);
  });

  test("generateReel refuses the SAME way — zero rows, zero cents moved (the reserve-side observer)", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await flagClaims(t, planId, [1]);
    const before = await mediaLeft(t);
    expect(await asA(t).mutation(api.media.generateReel, { planId })).toEqual({
      ok: false,
      reason: "unconfirmed_claims",
    });
    expect(await rows(t)).toHaveLength(0);
    expect(await mediaLeft(t)).toBe(before);
  });

  test("regenerateBlock refuses too — the gate is deck-wide at the reserve, not a generateReel wrapper", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await flagClaims(t, planId, [3]);
    // Re-buying scene 1 while scene 3 states an unvouched figure: the deck is validated WHOLE,
    // exactly as every other reserve refusal is.
    expect(await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 1 })).toEqual({
      ok: false,
      reason: "unconfirmed_claims",
    });
    expect(await rows(t)).toHaveLength(0);
  });

  test("confirmClaim on every flagged scene clears the refusal REACTIVELY, and the same deck reserves", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await flagClaims(t, planId, [1, 3]);
    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 1 })).toEqual({
      ok: true,
    });
    // One of two confirmed: still blocked, now naming the remaining scene.
    expect((await asA(t).query(api.media.jobEstimate, { planId })).refusal).toEqual({
      reason: "unconfirmed_claims",
      blockIndex: 3,
    });
    expect(await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 3 })).toEqual({
      ok: true,
    });

    const estimate = await asA(t).query(api.media.jobEstimate, { planId });
    expect(estimate.refusal).toBeNull();
    expect(estimate.totalCents).toBeGreaterThan(0);
    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok, `refused: ${res.ok ? "" : res.reason}`).toBe(true);
    if (!res.ok) return;
    // The pinned agreement survives the gate: the number shown IS the number reserved.
    expect(res.estCents).toBe(estimate.totalCents);
  });

  test("a deck with NO flagged scenes is untouched by the gate — v2 decks price exactly as before", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    expect((await asA(t).query(api.media.jobEstimate, { planId })).refusal).toBeNull();
    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok).toBe(true);
  });
});

// ── 33-03: Generate LOCKS the pick and DISCARDS the alternate; money tracks plans.shots alone ───

describe("33-03 generateReel: the point of no return for variations", () => {
  test("a successful Generate stamps deckLockedAt and deletes the alternate, in the same mutation", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    await seedAltDeck(t, planId);

    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok, `refused: ${res.ok ? "" : res.reason}`).toBe(true);

    const plan = await planRowOf(t, planId);
    expect(plan?.deckLockedAt).toBeTypeOf("number");
    // The locked discard decision: the unpicked deck is gone, not parked forever beside a bought
    // one it can no longer replace.
    expect(plan?.altShots).toBeUndefined();
    expect(plan?.altTargetDurationSeconds).toBeUndefined();
    // …and the lock is live: the choice can no longer be swapped.
    expect(await asA(t).mutation(api.media.switchDeck, { planId })).toEqual({
      ok: false,
      reason: "deck_locked",
    });
  });

  test("a REFUSED Generate locks nothing and discards nothing — the refusal is free", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    const altShots = await seedAltDeck(t, planId);
    await flagClaims(t, planId, [1]);

    expect(await asA(t).mutation(api.media.generateReel, { planId })).toEqual({
      ok: false,
      reason: "unconfirmed_claims",
    });
    const plan = await planRowOf(t, planId);
    expect(plan?.deckLockedAt).toBeUndefined();
    expect(plan?.altShots).toEqual(altShots);
    expect(plan?.altTargetDurationSeconds).toBe(15);
  });

  test("PICKED-DECK-ONLY: a parked alternate moves NEITHER the estimate NOR the reservation", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t);
    // The number with NO alternate anywhere — the pure picked-deck price.
    const alone = await asA(t).query(api.media.jobEstimate, { planId });
    expect(alone.refusal).toBeNull();

    // Park a genuinely different deck (15s, 120¢ of clips vs the picked deck's 200¢).
    await seedAltDeck(t, planId);
    const parked = await asA(t).query(api.media.jobEstimate, { planId });
    expect(parked.totalCents).toBe(alone.totalCents);
    expect(parked.lines).toEqual(alone.lines);

    // …and the reservation charges that SAME number: one estimate, one reservation, both over
    // plans.shots only. The alternate is priced by nothing.
    const res = await asA(t).mutation(api.media.generateReel, { planId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.estCents).toBe(alone.totalCents);
  });
});

describe("33-03 sceneCitations: model-authored docIds are checked where they are consumed", () => {
  /** Scenes 0..3; 0 cites the tenant's own doc, 1 cites a FOREIGN doc, 2 is an uncited claim. */
  async function seedCitedDeck(t: T) {
    const { planId } = await seedSceneDeck(t);
    const { ownId, foreignId } = await t.run(async (ctx) => {
      const base = {
        title: "t",
        kind: "upload",
        category: "other",
        source: "upload",
        mimeType: "application/pdf",
        size: 1,
        contentHash: "f".repeat(64),
        status: "ready" as const,
        createdAt: T0,
      };
      return {
        ownId: await ctx.db.insert("vaultDocuments", { ...base, tenantId: A }),
        foreignId: await ctx.db.insert("vaultDocuments", { ...base, tenantId: B }),
      };
    });
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) => {
        if (s.index === 0)
          return { ...s, source: { docId: ownId, title: "The pricing one-pager" } };
        if (s.index === 1) {
          return { ...s, source: { docId: foreignId, title: "Someone else's deck" } };
        }
        if (s.index === 2) return { ...s, needsConfirmation: true };
        return s;
      });
      await ctx.db.patch(planId, { shots });
    });
    return { planId, ownId, foreignId };
  }

  test("own doc verifies; a FOREIGN docId is inert (verified:false) — never a valid citation", async () => {
    const t = harness();
    const { planId, ownId, foreignId } = await seedCitedDeck(t);
    const cites = await asA(t).query(api.media.sceneCitations, { planId });
    // One entry per scene that claims anything; the unclaimed scene 3 has no row.
    expect(cites.map((c) => c.sceneIndex)).toEqual([0, 1, 2]);
    expect(cites[0]).toEqual({
      sceneIndex: 0,
      docId: ownId,
      // "t" — the VAULT ROW's title, not the model's "The pricing one-pager". This assertion used
      // to expect the model's string and so quietly enshrined the laundering hole closed below.
      title: "t",
      verified: true,
      needsConfirmation: false,
      confirmedAt: null,
    });
    // The model wrote another tenant's id: the row exists, the citation does not verify.
    expect(cites[1]).toMatchObject({ docId: foreignId, verified: false });
    // An unverified claim with no doc at all: nothing to link, owner must vouch.
    expect(cites[2]).toEqual({
      sceneIndex: 2,
      docId: null,
      title: null,
      verified: false,
      needsConfirmation: true,
      confirmedAt: null,
    });
  });

  test("a MALFORMED docId fails closed, and a confirmation shows on the entry", async () => {
    const t = harness();
    const { planId } = await seedCitedDeck(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      const shots = (plan?.shots ?? []).map((s) =>
        s.index === 0 ? { ...s, source: { docId: "not_a_real_id", title: "Forged" } } : s,
      );
      await ctx.db.patch(planId, { shots });
    });
    await asA(t).mutation(api.media.confirmClaim, { planId, sceneIndex: 2 });

    const cites = await asA(t).query(api.media.sceneCitations, { planId });
    expect(cites[0]).toMatchObject({ docId: "not_a_real_id", verified: false });
    expect(cites[2]?.confirmedAt).toBeTypeOf("number");
  });

  test("tenant B reads NOTHING off A's plan — reads return empty where writes throw", async () => {
    const t = harness();
    const { planId } = await seedCitedDeck(t);
    expect(await asB(t).query(api.media.sceneCitations, { planId })).toEqual([]);
  });

  // 33-08 finding, closed here: `verified` only ever answered "is this docId yours?" while the
  // TITLE beside it stayed the string the MODEL wrote. A model could cite a real owned document
  // under an invented name — verified:true, genuine docId, fabricated label — and the canvas would
  // render the invented name as the source of the figure. That is the provenance-laundering shape
  // one door past the figure gate: the FIGURE is gated by confirmClaim, the SOURCE LABEL was not.
  // A verified citation's title now comes off the vault row itself; the model's string survives
  // only where there is no owned document to contradict it.
  test("a VERIFIED citation's title comes from the vault row, never from the model", async () => {
    const t = harness();
    const { planId, ownId, foreignId } = await seedCitedDeck(t);
    // The seeded document is really called "t". The model claimed "The pricing one-pager".
    const cites = await asA(t).query(api.media.sceneCitations, { planId });
    expect(cites[0]).toMatchObject({ docId: ownId, verified: true, title: "t" });
    // Unverified rows keep the model's string — there is no owned row to take a title from, and
    // blanking it would hide WHAT was claimed from the owner being asked to vouch for it.
    expect(cites[1]).toMatchObject({
      docId: foreignId,
      verified: false,
      title: "Someone else's deck",
    });
  });

  test("renaming the vault doc renames the citation — the label tracks the document", async () => {
    const t = harness();
    const { planId, ownId } = await seedCitedDeck(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ownId, { title: "Pricing v4 (final)" });
    });
    const cites = await asA(t).query(api.media.sceneCitations, { planId });
    expect(cites[0]).toMatchObject({ verified: true, title: "Pricing v4 (final)" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 33-05 — the finished reel becomes a DURABLE VAULT ASSET, and the old final is HELD
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** A scene plan with a published uncaptioned reel and two cited scenes (one own, one FOREIGN) —
 *  the state the caption terminal fires from. */
async function seedSaveable(t: T) {
  const { planId } = await seedSceneDeck(t);
  const { ownId, foreignId } = await t.run(async (ctx) => {
    const base = {
      title: "t",
      kind: "upload",
      category: "other",
      source: "upload",
      mimeType: "application/pdf",
      size: 1,
      contentHash: "f".repeat(64),
      status: "ready" as const,
      createdAt: T0,
    };
    return {
      ownId: await ctx.db.insert("vaultDocuments", { ...base, tenantId: A }),
      foreignId: await ctx.db.insert("vaultDocuments", { ...base, tenantId: B }),
    };
  });
  const reelId = await storeBlob(t, new Uint8Array([1, 2, 3]), "video/mp4");
  const sidecarId = await storeBlob(t, sidecarFor(4), "application/json");
  await t.run(async (ctx) => {
    const plan = await ctx.db.get(planId);
    const shots = (plan?.shots ?? []).map((s) => {
      if (s.index === 0) {
        return { ...s, source: { docId: ownId, title: "The pricing one-pager" }, confirmedAt: T0 };
      }
      if (s.index === 1) return { ...s, source: { docId: foreignId, title: "Someone else's" } };
      return s;
    });
    await ctx.db.patch(planId, {
      shots,
      brief: {
        topic: "Autumn launch teaser",
        durationSeconds: 30,
        defaulted: [],
      },
      renderStatus: "rendered",
      renderStorageId: reelId,
      sidecarStorageId: sidecarId,
      renderSummary: { durationS: 30, sceneCount: 4, gates: ["g"] },
    });
  });
  return { planId, ownId, foreignId, reelId, sidecarId };
}

const reelDocs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("vaultDocuments").collect()).filter((d) => d.kind === "reel"),
  );

const burn = (
  t: T,
  planId: Id<"plans">,
  result:
    | { ok: true; captionedStorageId: Id<"_storage">; renderMs: number }
    | { ok: false; reason: string },
) =>
  t.run(async (ctx) =>
    ctx.runMutation(internal.render.renderReel.recordCaptionBurn, {
      tenantId: A,
      planId,
      batchId: "batch_save",
      result,
    }),
  );

describe("33-05 saveReelToVault: one vault doc per plan, at every pipeline terminal", () => {
  test("the caption terminal saves the reel: transcript text, refs-only tenant-verified citations", async () => {
    const t = harness();
    const { planId, ownId, foreignId } = await seedSaveable(t);
    const capId = await storeBlob(t, new Uint8Array([9]), "video/mp4");
    await burn(t, planId, { ok: true, captionedStorageId: capId, renderMs: 1 });

    const docs = await reelDocs(t);
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    // The ROW is markdown (searchable — rides the embed rail); the BYTES are the final mp4.
    expect(doc?.mimeType).toBe("text/markdown");
    expect(doc?.storedMimeType).toBe("video/mp4");
    expect(doc?.storageId).toBe(capId);
    expect(doc?.status).toBe("processing");
    expect(doc?.title).toContain("Autumn launch teaser");
    // The transcript IS the narration, in scene order — zero paid work.
    expect(doc?.text).toBe("line 0\n\nline 1\n\nline 2\n\nline 3");
    expect(doc?.contentHash).toBe(await contentHash("line 0\n\nline 1\n\nline 2\n\nline 3"));
    // Refs-only citation metadata (§4): ids, hashes and timestamps — never the claim text.
    expect(doc?.reelMeta?.planId).toBe(planId);
    expect(doc?.reelMeta?.citations).toEqual([
      {
        sceneIndex: 0,
        docId: ownId,
        claimHash: await contentHash("line 0"),
        confirmedAt: T0,
      },
    ]);
    // The FOREIGN docId the model wrote is skipped, never persisted as if it verified.
    expect(JSON.stringify(doc?.reelMeta)).not.toContain(foreignId);
    // The plan carries the ref — the upsert key for every later completion.
    expect((await planRowOf(t, planId))?.reelVaultDocId).toBe(doc?._id);

    const saved = (await auditRows(t)).filter((r) => r.eventType === "media.reel_saved");
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0]?.payload as object).sort()).toEqual([
      "citations",
      "docId",
      "planId",
    ]);
    expect((saved[0]?.payload as { citations: number } | undefined)?.citations).toBe(1);
  });

  test("UPSERT idempotence: a second completion PATCHES the same doc — never a second row", async () => {
    const t = harness();
    const { planId } = await seedSaveable(t);
    const capA = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    await burn(t, planId, { ok: true, captionedStorageId: capA, renderMs: 1 });

    // A re-render lands and its burn completes with a NEW captioned cut.
    const finalB = await storeBlob(t, new Uint8Array([2]), "video/mp4");
    await t.run(async (ctx) => ctx.db.patch(planId, { renderStorageId: finalB }));
    const capB = await storeBlob(t, new Uint8Array([3]), "video/mp4");
    await burn(t, planId, { ok: true, captionedStorageId: capB, renderMs: 1 });

    const docs = await reelDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.storageId).toBe(capB);
    expect(docs[0]?.status).toBe("processing");
  });

  test("a FAILED burn still saves the degraded uncaptioned reel — it is the deliverable", async () => {
    const t = harness();
    const { planId, reelId } = await seedSaveable(t);
    await burn(t, planId, { ok: false, reason: "missing_binary" });

    const docs = await reelDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.storageId).toBe(reelId);
  });

  test("a deck with NO caption line saves at the RENDER terminal — no burn will ever come", async () => {
    const t = harness();
    // seedRenderable reserves no `stt` row: captions were never bought for this deck.
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    const mp4 = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    const sidecar = await storeBlob(t, RENDER_SIDECAR, "application/json");
    await t.run(async (ctx) =>
      ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: A,
        planId,
        batchId,
        result: {
          ok: true,
          renderStorageId: mp4,
          sidecarStorageId: sidecar,
          sidecarHash: "c".repeat(64),
          sceneCount: 2,
          renderMs: 1,
          gatesPassed: 1,
          summary: { durationS: 20, sceneCount: 2, gates: ["g"] },
        },
      }),
    );
    const docs = await reelDocs(t);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.storageId).toBe(mp4);
  });

  // 25.1-03 (D6): this test asserted the OPPOSITE until the reel-vault gate was found to be a
  // guaranteed miss. Captions are pinned on for every reel (`cockpit.ts`, `media.ts`), so
  // `captionsComing` was true at every render terminal that ever ran — and a caption pass that
  // stalls or is swept never reaches the burn terminal, so the reel was published and NEVER
  // vaulted. The save now happens at the render terminal too; the upsert makes the two converge.
  test("captions OWED → the render terminal SAVES ANYWAY, and the burn RE-POINTS the same doc", async () => {
    const t = harness();
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId,
        blockIndex: -1,
        provider: "openai",
        kind: "stt",
        model: MEDIA_DEFAULT_STT.model,
        spec: { kind: "stt", audioMinutes: 0.5 },
        promptHash: "0".repeat(64),
        status: "queued",
        estUsd: 0.006,
        createdAt: T0,
        updatedAt: T0,
      });
    });
    const mp4 = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    const sidecar = await storeBlob(t, RENDER_SIDECAR, "application/json");
    await t.run(async (ctx) =>
      ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: A,
        planId,
        batchId,
        result: {
          ok: true,
          renderStorageId: mp4,
          sidecarStorageId: sidecar,
          sidecarHash: "c".repeat(64),
          sceneCount: 2,
          renderMs: 1,
          gatesPassed: 1,
          summary: { durationS: 20, sceneCount: 2, gates: ["g"] },
        },
      }),
    );
    const atRender = await reelDocs(t);
    expect(atRender).toHaveLength(1);
    expect(atRender[0]?.storageId).toBe(mp4);

    // The burn lands later over the captioned cut: the SAME doc repoints, and the uncaptioned
    // blob it used to hold is deleted — one doc per plan, no second row, no leaked mp4.
    const captioned = await storeBlob(t, new Uint8Array([2]), "video/mp4");
    await t.run(async (ctx) =>
      ctx.runMutation(internal.render.renderReel.recordCaptionBurn, {
        tenantId: A,
        planId,
        batchId,
        result: { ok: true, captionedStorageId: captioned, renderMs: 1 },
      }),
    );
    const afterBurn = await reelDocs(t);
    expect(afterBurn).toHaveLength(1);
    expect(afterBurn[0]?._id).toBe(atRender[0]?._id);
    expect(afterBurn[0]?.storageId).toBe(captioned);
    expect(await blobExists(t, mp4)).toBe(false);
  });

  // ── 25.1-03 (D7): a SECOND reel in the same thread must not destroy the first ───────────────
  test("after a reset the next reel gets its OWN doc — reel #1's doc and mp4 both survive", async () => {
    const t = harness();
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    const render = (mp4: Id<"_storage">) =>
      t.run(async (ctx) =>
        ctx.runMutation(internal.render.renderReel.recordRender, {
          tenantId: A,
          planId,
          batchId,
          result: {
            ok: true,
            renderStorageId: mp4,
            sidecarStorageId: await ctx.storage.store(
              new Blob([RENDER_SIDECAR], { type: "application/json" }),
            ),
            sidecarHash: "c".repeat(64),
            sceneCount: 2,
            renderMs: 1,
            gatesPassed: 1,
            summary: { durationS: 20, sceneCount: 2, gates: ["g"] },
          },
        }),
      );

    const mp4One = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    await render(mp4One);
    const [docOne] = await reelDocs(t);
    expect(docOne?.storageId).toBe(mp4One);

    // "Start over" in the same thread. `stageMediaPlan` recycles the row through `resetPlan`, and
    // the deck the next proposal writes lands on the very same plan.
    await t.mutation(internal.plans.resetPlan, { planId });
    const { shots } = await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      return { shots: plan?.shots };
    });
    expect(shots).toBeUndefined();
    await t.run(async (ctx) =>
      ctx.db.patch(planId, {
        clipSeconds: MEDIA_DEFAULT_VIDEO.seconds,
        shots: [
          {
            index: 0,
            type: "AI",
            seconds: MEDIA_DEFAULT_VIDEO.seconds,
            windowStartMs: 0,
            description: "a different reel entirely",
            narration: "the second reel",
            prompt: "p",
          },
        ],
      }),
    );

    const mp4Two = await storeBlob(t, new Uint8Array([2]), "video/mp4");
    await render(mp4Two);

    const docs = await reelDocs(t);
    expect(docs).toHaveLength(2);
    const first = docs.find((d) => d._id === docOne?._id);
    expect(first?.storageId).toBe(mp4One); // never repointed at the new reel
    expect(await blobExists(t, mp4One)).toBe(true); // …and never eaten by the orphan cleanup
    expect(docs.find((d) => d._id !== docOne?._id)?.storageId).toBe(mp4Two);
  });
});

describe("33-05 the OLD final is held until the new one lands", () => {
  test("regenerate resets the render plane but KEEPS the old final playable", async () => {
    const t = harness();
    const { planId } = await seedDeck(t, { blocks: 2 });
    const oldFinal = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    const sidecar = await storeBlob(t, RENDER_SIDECAR, "application/json");
    await t.run(async (ctx) =>
      ctx.db.patch(planId, {
        renderStatus: "rendered",
        renderStorageId: oldFinal,
        sidecarStorageId: sidecar,
        sidecarHash: "a".repeat(64),
        renderedAt: T0,
        renderSummary: { durationS: 20, blockCount: 2, gates: ["g"] },
        captionStatus: "captioned",
        captionOffsetsS: [0, 1],
      }),
    );

    await asA(t).mutation(api.media.regenerateBlock, { planId, blockIndex: 0 });

    const plan = await planRowOf(t, planId);
    expect(plan?.renderStatus).toBe("pending");
    // The artifact fields are KEPT: the canvas separates stale-reel from never-built by landed
    // count, and the old final must stay watchable until the new one lands.
    expect(plan?.renderStorageId).toBe(oldFinal);
    expect(plan?.sidecarStorageId).toBe(sidecar);
    expect(plan?.renderSummary).toBeDefined();
    // The CAPTION plane resets with the render plane — a new pipeline must be able to caption,
    // and a stale `captioned` would make `maybeStartCaptions` skip the new batch forever.
    expect(plan?.captionStatus).toBeUndefined();
    expect(plan?.captionOffsetsS).toBeUndefined();
    // …and the reel query keeps serving the governed url: the triple IS the guarantee.
    expect((await asA(t).query(api.media.reel, { planId })).url).toBeTruthy();
    expect(await blobExists(t, oldFinal)).toBe(true);
  });

  test("the reel query serves the HELD final through pending/rendering/failed", async () => {
    const t = harness();
    const { planId } = await seedDeck(t);
    const finalId = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    await t.run(async (ctx) =>
      ctx.db.patch(planId, {
        renderStorageId: finalId,
        sidecarStorageId: finalId,
        renderSummary: { durationS: 20, sceneCount: 3, gates: ["g"] },
      }),
    );
    for (const status of ["pending", "rendering", "failed"] as const) {
      await t.run(async (ctx) => await ctx.db.patch(planId, { renderStatus: status }));
      const r = await asA(t).query(api.media.reel, { planId });
      expect(r.status).toBe(status); // the state is still reported honestly…
      expect(r.url).toBeTruthy(); // …but the held final stays watchable throughout
    }
  });

  test("the NEW final lands: plan and vault doc repoint, the old blob is deleted", async () => {
    const t = harness();
    // No `stt` in the batch → the render terminal is the save terminal (no captions ever).
    const { planId, batchId } = await seedRenderable(t, { blocks: 2 });
    const record = (mp4: Id<"_storage">, sidecar: Id<"_storage">) =>
      t.run(async (ctx) =>
        ctx.runMutation(internal.render.renderReel.recordRender, {
          tenantId: A,
          planId,
          batchId,
          result: {
            ok: true,
            renderStorageId: mp4,
            sidecarStorageId: sidecar,
            sidecarHash: "c".repeat(64),
            sceneCount: 2,
            renderMs: 1,
            gatesPassed: 1,
            summary: { durationS: 20, sceneCount: 2, gates: ["g"] },
          },
        }),
      );
    const mp4A = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    await record(mp4A, await storeBlob(t, RENDER_SIDECAR, "application/json"));
    expect((await reelDocs(t))[0]?.storageId).toBe(mp4A);

    const mp4B = await storeBlob(t, new Uint8Array([2]), "video/mp4");
    await record(mp4B, await storeBlob(t, RENDER_SIDECAR, "application/json"));

    expect((await planRowOf(t, planId))?.renderStorageId).toBe(mp4B);
    expect((await reelDocs(t))[0]?.storageId).toBe(mp4B);
    // The old final is orphaned by BOTH repoints, and only then deleted — never leaked.
    expect(await blobExists(t, mp4A)).toBe(false);
    expect(await blobExists(t, mp4B)).toBe(true);
  });

  // 25.1-03 (D6) CHANGED THIS TEST'S SUBJECT. It used to assert that a re-render with captions
  // pending left the vault doc on the PREVIOUS captioned cut until the burn landed. With the
  // render terminal saving unconditionally, the doc now tracks the plan's CURRENT final at every
  // terminal — vault and plan can no longer disagree — and the superseded cut is released one
  // terminal earlier. What is still pinned, and is the part that matters: ONE doc per plan, and
  // never a blob deleted while the plan or the doc still points at it.
  test("captions OWED: the vault doc tracks the plan's current final at BOTH terminals", async () => {
    const t = harness();
    const { planId, reelId } = await seedSaveable(t);
    // Pipeline #1 completes at the caption terminal; the vault doc points at capA.
    const capA = await storeBlob(t, new Uint8Array([1]), "video/mp4");
    await burn(t, planId, { ok: true, captionedStorageId: capA, renderMs: 1 });
    expect(await blobExists(t, reelId)).toBe(false); // uncaptioned #1 already cleaned up

    // A regenerate starts: clearRender resets status + caption plane, HOLDS the artifacts.
    await t.run(async (ctx) => {
      await ctx.db.patch(planId, { renderStatus: "pending", captionStatus: undefined });
      // The new batch reserved captions — an `stt` line exists, so a burn is coming.
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "batch_save",
        blockIndex: -1,
        provider: "openai",
        kind: "stt",
        model: MEDIA_DEFAULT_STT.model,
        spec: { kind: "stt", audioMinutes: 0.5 },
        promptHash: "0".repeat(64),
        status: "queued",
        estUsd: 0.006,
        createdAt: T0,
        updatedAt: T0,
      });
    });

    // The new UNCAPTIONED final lands. The vault doc must NOT be repointed yet — and the old
    // captioned final it references must survive this terminal.
    const mp4B = await storeBlob(t, new Uint8Array([2]), "video/mp4");
    await t.run(async (ctx) =>
      ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: A,
        planId,
        batchId: "batch_save",
        result: {
          ok: true,
          renderStorageId: mp4B,
          sidecarStorageId: mp4B,
          sidecarHash: "c".repeat(64),
          sceneCount: 4,
          renderMs: 1,
          gatesPassed: 1,
          summary: { durationS: 30, sceneCount: 4, gates: ["g"] },
        },
      }),
    );
    expect((await planRowOf(t, planId))?.renderStorageId).toBe(mp4B);
    expect(await reelDocs(t)).toHaveLength(1); // still ONE doc — the upsert converged
    expect((await reelDocs(t))[0]?.storageId).toBe(mp4B); // …repointed at what the plan now says
    expect(await blobExists(t, capA)).toBe(false); // the superseded cut: nothing points at it
    expect(await blobExists(t, mp4B)).toBe(true); // the live one is never a delete candidate

    // The burn completes: plan and doc repoint to capB, and the uncaptioned mp4B goes.
    const capB = await storeBlob(t, new Uint8Array([3]), "video/mp4");
    await burn(t, planId, { ok: true, captionedStorageId: capB, renderMs: 1 });
    expect((await planRowOf(t, planId))?.renderStorageId).toBe(capB);
    expect(await reelDocs(t)).toHaveLength(1);
    expect((await reelDocs(t))[0]?.storageId).toBe(capB);
    expect(await blobExists(t, mp4B)).toBe(false);
    expect(await blobExists(t, capB)).toBe(true);
  });
});

describe("33-05 a saved reel is REUSABLE FOOTAGE — pickable equals renderable", () => {
  test("setSceneAsset accepts the reel shape (markdown row, mp4 bytes) and the blob route serves it", async () => {
    const t = harness();
    const { planId } = await seedSceneDeck(t, {
      visuals: ["uploaded_video", "generated_video", "text_card", "generated_video"],
    });
    const bytes = await storeBlob(t, new Uint8Array([7]), "video/mp4");
    const reelDocId = await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: A,
        title: "Reel: last month's teaser",
        kind: "reel",
        category: "workspace-docs",
        source: "media",
        mimeType: "text/markdown",
        storedMimeType: "video/mp4",
        storageId: bytes,
        size: 1,
        contentHash: "f".repeat(64),
        status: "processing",
        createdAt: T0,
      }),
    );

    // The picker's mutation takes it — `storedMimeType ?? mimeType` is what the bytes are.
    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 0,
        vaultDocId: reelDocId,
      }),
    ).toEqual({ ok: true });

    // …and the blob route serves those bytes as VIDEO, so the render can fetch them.
    const served = await t.run(async (ctx) =>
      ctx.runQuery(internal.render.renderReel.resolveRenderAsset, { raw: reelDocId }),
    );
    expect(served).toEqual({ assetStorageId: bytes, mimeType: "video/mp4" });

    // A markdown doc whose STORED bytes are not video (the createDocument PDF shape) stays
    // refused — the widen admits exactly the reel shape, nothing broader.
    const pdfBytes = await storeBlob(t, new Uint8Array([1]), "application/pdf");
    const plainDocId = await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: A,
        title: "notes",
        kind: "brief",
        category: "workspace-docs",
        source: "paste",
        mimeType: "text/markdown",
        storedMimeType: "application/pdf",
        storageId: pdfBytes,
        size: 1,
        contentHash: "e".repeat(64),
        status: "ready",
        createdAt: T0,
      }),
    );
    expect(
      await asA(t).mutation(api.media.setSceneAsset, {
        planId,
        blockIndex: 0,
        vaultDocId: plainDocId,
      }),
    ).toEqual({ ok: false, reason: "not_a_video" });
    expect(
      await t.run(async (ctx) =>
        ctx.runQuery(internal.render.renderReel.resolveRenderAsset, { raw: plainDocId }),
      ),
    ).toBeNull();
  });
});
