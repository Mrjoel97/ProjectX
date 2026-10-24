// @vitest-environment node
//
// 25.1-01 (D1/D2): EVERY `renderReel` exit path leaves an honest terminal on the plan row.
//
// D1 was the primary silent stall of the media pipeline: `batchToRender` refusing meant a bare
// `return` BEFORE any status write, so the canvas said "assembling" forever and `media.retryRender`
// refused because it requires `renderStatus === "failed"`. The tests here are table-driven over the
// refusal classes and assert the exact reason STRING per class (mutation rule: transposing two
// reasons must redden), plus the dead letter and its redaction-safety (§4 — ids/counts/codes only).
//
// Everything runs offline at $0 through `MEDIA_SANDBOX_FIXTURE` (see media.test.ts — the seam is
// mandatory in every suite; a real `Sandbox.create` on Hobby is an outage, not a bill).

import type { RunId } from "@convex-dev/action-retrier";
import retrierTest from "@convex-dev/action-retrier/test";
import { pcm16ToWav } from "@pikar/core/captions";
import { MUSIC_BLOCK_INDEX, MUSIC_INPUT_NAME } from "@pikar/core/render";
import { MEDIA_DEFAULT_VIDEO, MEDIA_DEFAULT_VOICE, MEDIA_MUSIC_STOCK } from "@pikar/cost/media";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../../node_modules/@convex-dev/workpool/src/component/schema.js";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { contentHash } from "../lib/hash";
import schema from "../schema";

// Vite rewrites glob keys for files in THIS directory to "./x.ts" while the rest stay "../y/x.ts",
// and convex-test derives one shared prefix from the `_generated` key — so the siblings must be
// renamed back under "../render/" or their functions cannot be resolved.
const rawModules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([k, v]) => [
    k.startsWith("./") ? `../render/${k.slice(2)}` : k,
    v,
  ]),
);
const rateLimiterModules = import.meta.glob(
  "../../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;
const liveHarnesses: T[] = [];

/** The media.test.ts harness, verbatim, plus the action-retrier (D2 runs renderReel under it). */
function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  retrierTest.register(t);
  liveHarnesses.push(t);
  return t;
}

const A = "tenant_a";
const B = "tenant_b";
const T0 = 1_754_000_000_000;

function expectNoOwnedRenderPost(fetchMock: { mock: { calls: unknown[][] } }, batchId: string) {
  const owned = fetchMock.mock.calls.filter(([url, init]) => {
    if (String(url) !== "https://app.example.com/api/media/render") return false;
    const request = init as RequestInit | undefined;
    if (request?.method !== "POST" || typeof request.body !== "string") return false;
    try {
      return (JSON.parse(request.body) as { renderId?: string }).renderId === batchId;
    } catch {
      return false;
    }
  });
  expect(owned, "this batch must not purchase a render sandbox").toHaveLength(0);
}

test("the owned render assertion catches this batch's POST and ignores unrelated work", () => {
  const post = (batchId: string) => ({
    mock: {
      calls: [
        [
          "https://app.example.com/api/media/render",
          {
            method: "POST",
            body: JSON.stringify({ renderId: batchId }),
          },
        ],
      ],
    },
  });
  expect(() => expectNoOwnedRenderPost(post("mine"), "mine")).toThrow();
  expect(() => expectNoOwnedRenderPost(post("foreign"), "mine")).not.toThrow();
  expect(() =>
    expectNoOwnedRenderPost(
      { mock: { calls: [["https://openrouter.ai/api/v1/chat", {}]] } },
      "mine",
    ),
  ).not.toThrow();
});

afterEach(async () => {
  // Match media.test.ts: finish due workflow/ingest tails while their own test mocks still apply.
  // A zero-delay yield never starts the media poller's ten-second retry timers.
  for (const t of liveHarnesses.splice(0)) {
    for (let pass = 0; pass < 3; pass++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        await t.finishInProgressScheduledFunctions();
      } catch {
        /* Deliberately refused fixture work. */
      }
    }
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("caption scripts bind to the exact tenant and paid TTS batch", () => {
  async function seedCaptions(t: T, mismatchedTranscript = false) {
    const texts = ["Come back.", "Keep it close."];
    const seeded = await seedMidRender(t, {
      deckOverrides: { 0: { narration: texts[0] }, 1: { narration: texts[1] } },
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("mediaJobs")
        .withIndex("by_batch", (q) => q.eq("tenantId", A).eq("batchId", seeded.batchId))
        .collect();
      for (const row of rows.filter((row) => row.kind === "tts"))
        await ctx.db.patch(row._id, { promptHash: await contentHash(texts[row.blockIndex] ?? "") });
      const words = [
        { text: mismatchedTranscript ? "Go" : "Come", start: 0.1, end: 0.5, type: "word" },
        { text: "back", start: 0.5, end: 1, type: "word" },
        { text: "Keep", start: 2.74, end: 3.24, type: "word" },
        { text: "it", start: 3.24, end: 3.24, type: "word" },
        { text: "close", start: 3.5, end: 4, type: "word" },
      ];
      const sidecar = JSON.stringify({
        scene_count: 2,
        target_duration_s: 8,
        total_duration_s: 8,
        actual_duration_s: 8,
        gates: [],
        scenes: [0, 1].map((index) => ({
          index,
          start_s: index * 4,
          duration_s: 4,
          visual: "video",
          lead_silence_s: 0,
          speech_abs_s: index * 4 + 1,
          speech_dur_s: 2.5,
          overrun: false,
        })),
      });
      const renderStorageId = await ctx.storage.store(
        new Blob(["synthetic transport fixture"], { type: "video/mp4" }),
      );
      const sidecarStorageId = await ctx.storage.store(
        new Blob([sidecar], { type: "application/json" }),
      );
      const transcriptStorageId = await ctx.storage.store(
        new Blob([JSON.stringify({ words })], { type: "application/json" }),
      );
      await ctx.db.patch(seeded.planId, {
        renderStatus: "rendered",
        renderStorageId,
        sidecarStorageId,
        captionOffsetsS: [0, 3],
        captionStatus: "pending",
      });
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId: seeded.planId,
        batchId: seeded.batchId,
        blockIndex: -1,
        kind: "stt",
        provider: "openai",
        model: "openai/whisper-1",
        spec: { kind: "stt", audioMinutes: 0.1 },
        status: "succeeded",
        assetStorageId: transcriptStorageId,
        promptHash: "0".repeat(64),
        estUsd: 0.0006,
        createdAt: T0 + 1,
        updatedAt: T0 + 1,
      });
    });
    return seeded;
  }

  test("returns exact batch-verified scripts, and a foreign tenant gets no content", async () => {
    const t = harness(),
      { planId } = await seedCaptions(t);
    const job = await t.query(internal.render.renderReel.captionsToBurn, { tenantId: A, planId });
    expect(job?.expectedTakeTexts).toEqual(["Come back.", "Keep it close."]);
    expect(job?.alignmentReason).toBeUndefined();
    expect(
      await t.query(internal.render.renderReel.captionsToBurn, { tenantId: B, planId }),
    ).toBeNull();
  });

  test("an edited current deck cannot supply new alignment text for old paid audio", async () => {
    const t = harness(),
      { planId } = await seedCaptions(t);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      await ctx.db.patch(planId, {
        shots: plan?.shots?.map((shot) =>
          shot.index === 0 ? { ...shot, narration: "Altered private narration" } : shot,
        ),
      });
    });
    const job = await t.query(internal.render.renderReel.captionsToBurn, { tenantId: A, planId });
    expect(job?.alignmentReason).toBe("caption_script_binding_failed");
    expect(job?.expectedTakeTexts).toBeUndefined();
  });

  test("voice rows in another batch cannot prove the STT batch's script binding", async () => {
    const t = harness(),
      { planId, batchId } = await seedCaptions(t);
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("mediaJobs")
        .withIndex("by_batch", (q) => q.eq("tenantId", A).eq("batchId", batchId))
        .collect();
      for (const row of rows.filter((row) => row.kind === "tts"))
        await ctx.db.patch(row._id, { batchId: "unrelated_batch" });
    });
    const job = await t.query(internal.render.renderReel.captionsToBurn, { tenantId: A, planId });
    expect(job?.alignmentReason).toBe("caption_script_binding_failed");
  });

  test("exact transcript mismatch reaches an explicit degraded terminal before any render request", async () => {
    const t = harness(),
      { planId, batchId } = await seedCaptions(t, true);
    stubRenderEnv();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const outcome = await t.action(internal.render.renderReel.burnCaptions, {
      tenantId: A,
      planId,
    });
    expect(outcome).toEqual({ ok: false, reason: "caption_expected_text_mismatch" });
    expectNoOwnedRenderPost(request, batchId);
    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("rendered");
    expect(plan?.captionStatus).toBe("failed");
    expect(plan?.captionReason).toBe("caption_expected_text_mismatch");
    expect(JSON.stringify(await deadLetters(t))).not.toContain("Come back");
  });
});

function stubRenderEnv() {
  vi.stubEnv("Video_and_image_API_Key", "test-key");
  vi.stubEnv("WAN_API_BASE_URL", "https://workspace.ap-southeast-1.maas.aliyuncs.com");
  vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("MEDIA_RENDER_SECRET", "test-render-secret");
  vi.stubEnv("MEDIA_RENDER_URL", "https://app.example.com/api/media/render");
}

/** The card text a refusal must never leak — asserted ABSENT from every log-plane payload. */
const CARD_TEXT = "SECRET CARD COPY";

/** A fully-landed 2-block batch mid-render (`renderStatus: "rendering"`, as every schedule site
 *  leaves it), with per-scene deck overrides so each test can break exactly one thing. */
async function seedMidRender(
  t: T,
  opts: {
    deckOverrides?: Record<number, Record<string, unknown>>;
    planPatch?: Record<string, unknown>;
    unlanded?: boolean;
  } = {},
) {
  const blocks = 2;
  const batchId = crypto.randomUUID();
  const planId = await t.run(
    async (ctx) =>
      await ctx.db.insert("plans", {
        tenantId: A,
        threadId: "thread_1",
        status: "proposed",
        createdAt: Date.now(),
      }),
  );
  await t.run(async (ctx) => {
    for (let i = 0; i < blocks; i++) {
      for (const kind of ["video", "tts"] as const) {
        const held = opts.unlanded === true && i === 0 && kind === "video";
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
        );
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
              : { kind: "tts", characters: 280, voice: "Evelyn (en)", sampleRateHertz: 24000 },
          promptHash: "0".repeat(64),
          status: held ? "submitted" : "succeeded",
          assetStorageId: held ? undefined : storageId,
          mimeType: kind === "video" ? "video/mp4" : "audio/wav",
          estUsd: 0.5,
          createdAt: T0,
          updatedAt: T0,
        });
      }
    }
    await ctx.db.patch(planId, {
      renderStatus: "rendering", // what every schedule site writes before the action runs
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
      ...(opts.planPatch ?? {}),
    });
  });
  return { planId, batchId };
}

const planRow = (t: T, planId: Id<"plans">) => t.run(async (ctx) => await ctx.db.get(planId));
const deadLetters = (t: T) => t.run(async (ctx) => await ctx.db.query("deadLetters").collect());

describe("explicit native audio rendering and captions", () => {
  async function seedNative(t: T, mismatch = false) {
    const seeded = await seedMidRender(t, {
      planPatch: { mediaAudioMode: "native" },
      deckOverrides: {
        0: { visual: "generated_video", narration: "Come back." },
        1: { visual: "generated_video", narration: "Keep it close." },
      },
    });
    return await t.run(async (ctx) => {
      const rows = await ctx.db.query("mediaJobs").collect();
      for (const row of rows) {
        if (row.kind === "tts") await ctx.db.delete(row._id);
        else if (row.spec.kind === "video")
          await ctx.db.patch(row._id, {
            spec: { ...row.spec, generateAudio: true },
          });
      }
      const wav = new Uint8Array(pcm16ToWav(new Uint8Array(8 * 48000), 24000));
      const nativeCaptionAudioHash = await contentHash(wav);
      const nativeCaptionAudioStorageId = await ctx.storage.store(
        new Blob([wav], { type: "audio/wav" }),
      );
      const renderStorageId = await ctx.storage.store(
        new Blob(["native final"], { type: "video/mp4" }),
      );
      const sidecarStorageId = await ctx.storage.store(
        new Blob(
          [
            JSON.stringify({
              scene_count: 2,
              target_duration_s: 8,
              total_duration_s: 8,
              actual_duration_s: 8,
              gates: ["native_audio_at_scene_start"],
              scenes: [0, 1].map((index) => ({
                index,
                start_s: index * 4,
                duration_s: 4,
                visual: "video",
                lead_silence_s: 0,
                speech_abs_s: index * 4,
                speech_dur_s: 0,
                overrun: false,
              })),
            }),
          ],
          { type: "application/json" },
        ),
      );
      const words = [
        { text: mismatch ? "Go" : "Come", start: 0.2, end: 0.6, type: "word" },
        { text: "back", start: 0.7, end: 1, type: "word" },
        { text: "Keep", start: 4.3, end: 4.6, type: "word" },
        { text: "it", start: 4.7, end: 4.9, type: "word" },
        { text: "close", start: 5, end: 5.5, type: "word" },
      ];
      const transcriptStorageId = await ctx.storage.store(
        new Blob([JSON.stringify({ words })], { type: "application/json" }),
      );
      const sttId = await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId: seeded.planId,
        batchId: seeded.batchId,
        blockIndex: -1,
        kind: "stt",
        provider: "openai",
        model: "openai/whisper-1",
        spec: { kind: "stt", audioMinutes: 8 / 60 },
        status: "succeeded",
        assetStorageId: transcriptStorageId,
        promptHash: await contentHash("Come back.\nKeep it close."),
        nativeAudioHash: nativeCaptionAudioHash,
        estUsd: 0.006,
        createdAt: T0 + 1,
        updatedAt: T0 + 1,
      });
      await ctx.db.patch(seeded.planId, {
        renderStatus: "rendered",
        renderStorageId,
        sidecarStorageId,
        captionStatus: "pending",
        captionOffsetsS: [0],
        nativeCaptionAudioStorageId,
        nativeCaptionAudioHash,
        nativeCaptionBatchId: seeded.batchId,
        nativeCaptionRenderStorageId: renderStorageId,
      });
      return { ...seeded, renderStorageId, nativeCaptionAudioHash, sttId };
    });
  }
  test("new native plans render only native video inputs; legacy plans still require their TTS", async () => {
    const t = harness(),
      { batchId } = await seedNative(t);
    const inputs = await t.query(internal.render.renderReel.batchToRender, {
      tenantId: A,
      batchId,
    });
    expect(inputs.ok).toBe(true);
    if (!inputs.ok) return;
    expect(inputs.value.nativeAudio).toBe(true);
    expect(inputs.value.inputs.map((input) => input.name)).toEqual(["block01.mp4", "block02.mp4"]);
    expect(inputs.value.music).toBeUndefined();
    expect(
      await t.mutation(internal.render.renderReel.markRendering, {
        planId: inputs.value.planId,
        batchId,
      }),
    ).toBeNull();
    expect((await planRow(t, inputs.value.planId))?.renderStatus).toBe("rendering");
    const other = harness(),
      legacy = await seedMidRender(other);
    const old = await other.query(internal.render.renderReel.batchToRender, {
      tenantId: A,
      batchId: legacy.batchId,
    });
    expect(old.ok).toBe(true);
    if (old.ok)
      expect(old.value.inputs.filter((input) => input.name.startsWith("voice"))).toHaveLength(2);
  });
  test("a native plan refuses a clip reserved without native audio", async () => {
    const t = harness(),
      { batchId } = await seedNative(t);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("mediaJobs").collect()).find((job) => job.kind === "video");
      if (row?.spec.kind !== "video") throw new Error("Missing native fixture");
      await ctx.db.patch(row._id, { spec: { ...row.spec, generateAudio: false } });
    });
    expect(
      await t.query(internal.render.renderReel.batchToRender, { tenantId: A, batchId }),
    ).toEqual({ ok: false, reason: "stale_inputs" });
  });
  test("native captions bind the reviewed script, final, batch and actual audio fingerprint", async () => {
    const t = harness(),
      { planId, sttId } = await seedNative(t);
    const bound = await t.query(internal.render.renderReel.captionsToBurn, { tenantId: A, planId });
    expect(bound?.nativeAudio).toBe(true);
    expect(bound?.expectedTakeTexts).toEqual(["Come back.\nKeep it close."]);
    await t.run((ctx) => ctx.db.patch(sttId, { nativeAudioHash: "0".repeat(64) }));
    expect(
      (await t.query(internal.render.renderReel.captionsToBurn, { tenantId: A, planId }))
        ?.alignmentReason,
    ).toBe("caption_native_source_binding_failed");
  });
  test("an invented native word refuses checked captions and preserves the uncaptioned video", async () => {
    const t = harness(),
      { planId, renderStorageId, batchId } = await seedNative(t, true);
    stubRenderEnv();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(
      await t.action(internal.render.renderReel.burnCaptions, { tenantId: A, planId }),
    ).toEqual({ ok: false, reason: "caption_expected_text_mismatch" });
    expectNoOwnedRenderPost(request, batchId);
    const plan = await planRow(t, planId);
    expect(plan?.renderStorageId).toBe(renderStorageId);
    expect(plan?.captionStatus).toBe("failed");
  });
  test("matching native speech captions the final with its actual timeline", async () => {
    const t = harness(),
      { planId, renderStorageId } = await seedNative(t);
    stubRenderEnv();
    const captioned = await t.run((ctx) =>
      ctx.storage.store(new Blob(["captioned native"], { type: "video/mp4" })),
    );
    vi.stubEnv(
      "MEDIA_SANDBOX_FIXTURE",
      JSON.stringify({ ok: true, mp4StorageId: captioned, renderMs: 10 }),
    );
    expect(
      await t.action(internal.render.renderReel.burnCaptions, { tenantId: A, planId }),
    ).toEqual({ ok: true });
    const plan = await planRow(t, planId);
    expect(plan?.captionStatus).toBe("captioned");
    expect(plan?.renderStorageId).toBe(captioned);
    expect(plan?.renderStorageId).not.toBe(renderStorageId);
  });
  test("a late native caption burn cannot overwrite a newer final", async () => {
    const t = harness(),
      { planId, batchId, renderStorageId, nativeCaptionAudioHash } = await seedNative(t);
    const newer = await t.run((ctx) =>
      ctx.storage.store(new Blob(["newer final"], { type: "video/mp4" })),
    );
    await t.run((ctx) => ctx.db.patch(planId, { renderStorageId: newer }));
    await t.mutation(internal.render.renderReel.recordCaptionBurn, {
      tenantId: A,
      planId,
      batchId,
      nativeRenderStorageId: renderStorageId,
      nativeAudioHash: nativeCaptionAudioHash,
      result: { ok: true, captionedStorageId: renderStorageId, renderMs: 1 },
    });
    expect((await planRow(t, planId))?.renderStorageId).toBe(newer);
  });
  test("a partial native retry reuses the other scene's older successful clip", async () => {
    const t = harness(),
      { planId, batchId } = await seedNative(t);
    await t.run(async (ctx) => {
      const selected = (await ctx.db.query("mediaJobs").collect()).find(
        (row) => row.kind === "video" && row.blockIndex === 0,
      );
      if (!selected) throw new Error("Missing scene fixture");
      await ctx.db.patch(selected._id, { batchId: "native_partial", createdAt: T0 + 2 });
    });
    const result = await t.query(internal.render.renderReel.batchToRender, {
      tenantId: A,
      batchId: "native_partial",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.planId).toBe(planId);
    expect(result.value.inputs).toHaveLength(2);
    const batches = await t.run(
      async (ctx) =>
        await Promise.all(
          result.value.inputs.map(
            async (input) => (await ctx.db.get(input.jobId as Id<"mediaJobs">))?.batchId,
          ),
        ),
    );
    expect(new Set(batches)).toEqual(new Set(["native_partial", batchId]));
  });
  test("an older native render cannot replace a newer reservation and cleans only its unattached uploads", async () => {
    const t = harness(),
      { planId, batchId, renderStorageId } = await seedNative(t);
    const uploads = await t.run(async (ctx) => {
      await ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: "newer_native",
        blockIndex: -1,
        kind: "stt",
        provider: "openai",
        model: "openai/whisper-1",
        spec: { kind: "stt", audioMinutes: 1 },
        status: "queued",
        promptHash: "0".repeat(64),
        estUsd: 0.006,
        createdAt: T0 + 2,
        updatedAt: T0 + 2,
      });
      return await Promise.all(
        ["old video", "old sidecar", "old audio"].map((text) =>
          ctx.storage.store(new Blob([text])),
        ),
      );
    });
    const [oldVideo, oldSidecar, oldAudio] = uploads;
    if (!oldVideo || !oldSidecar || !oldAudio) throw new Error("Missing upload fixtures");
    expect(await t.mutation(internal.render.renderReel.markRendering, { planId, batchId })).toBe(
      false,
    );
    expect((await planRow(t, planId))?.renderStatus).toBe("rendered");
    await t.mutation(internal.render.renderReel.recordRender, {
      tenantId: A,
      planId,
      batchId,
      result: {
        ok: true,
        renderStorageId: oldVideo,
        sidecarStorageId: oldSidecar,
        nativeAudioStorageId: oldAudio,
        nativeAudioHash: "0".repeat(64),
        sidecarHash: "0".repeat(64),
        sceneCount: 2,
        renderMs: 1,
        gatesPassed: 1,
        summary: { durationS: 8, sceneCount: 2, gates: [] },
      },
    });
    expect((await planRow(t, planId))?.renderStorageId).toBe(renderStorageId);
    await t.run(async (ctx) => {
      for (const id of uploads) expect(await ctx.storage.get(id)).toBeNull();
      expect(await ctx.storage.get(renderStorageId)).not.toBeNull();
    });
  });
  test("a known partial native upload is cleaned without deleting the live held final", async () => {
    const t = harness(),
      { planId, batchId, renderStorageId } = await seedNative(t);
    const dangling = await t.run((ctx) => ctx.storage.store(new Blob(["unattached native PCM"])));
    const held = await planRow(t, planId);
    if (!held?.sidecarStorageId || !held.nativeCaptionAudioStorageId)
      throw new Error("Missing held native artifacts");
    await t.mutation(internal.render.renderReel.recordRender, {
      tenantId: A,
      planId,
      batchId,
      result: {
        ok: false,
        reason: "upload_failed",
        partialStorageIds: [dangling, held.sidecarStorageId, held.nativeCaptionAudioStorageId],
      },
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.get(dangling)).toBeNull();
      expect(await ctx.storage.get(renderStorageId)).not.toBeNull();
      expect(await ctx.storage.get(held.sidecarStorageId as Id<"_storage">)).not.toBeNull();
      const plan = await ctx.db.get(planId);
      if (!plan?.nativeCaptionAudioStorageId) throw new Error("Missing held native source");
      expect(await ctx.storage.get(plan.nativeCaptionAudioStorageId)).not.toBeNull();
    });
  });
});

// ── D1: every batchToRender refusal class ends at renderStatus "failed" + its OWN reason ────────

describe("D1: a batchToRender refusal writes a failed terminal + dead letter, never a silent return", () => {
  /** One row per refusal class from 25.1-RESEARCH D1. `reason` is asserted as the EXACT string —
   *  a version of the terminal that writes the wrong class's code must redden. */
  const CASES: Array<{
    name: string;
    reason: string;
    seed: (t: T) => Promise<{ planId: Id<"plans">; batchId: string }>;
  }> = [
    {
      name: "non-contiguous scene indices",
      reason: "incomplete_blocks",
      seed: (t) => seedMidRender(t, { deckOverrides: { 1: { index: 5 } } }),
    },
    {
      name: "bad seconds (non-integer)",
      reason: "incomplete_blocks",
      seed: (t) => seedMidRender(t, { deckOverrides: { 1: { seconds: 2.5 } } }),
    },
    {
      name: "unknown visual kind",
      reason: "incomplete_blocks",
      seed: (t) => seedMidRender(t, { deckOverrides: { 1: { visual: "hologram" } } }),
    },
    {
      name: "stale inputs (deck edited after the assets landed)",
      reason: "stale_inputs",
      seed: (t) => seedMidRender(t, { planPatch: { shotsChangedAt: T0 + 1 } }),
    },
    {
      name: "vault doc missing (malformed id)",
      reason: "incomplete_blocks",
      seed: (t) =>
        seedMidRender(t, {
          deckOverrides: {
            0: { visual: "uploaded_video", asset: { source: "vault", docId: "not_an_id" } },
          },
        }),
    },
    {
      name: "vault doc belongs to a FOREIGN tenant",
      reason: "incomplete_blocks",
      seed: async (t) => {
        const docId = await t.run(async (ctx) =>
          ctx.db.insert("vaultDocuments", {
            tenantId: B,
            title: "foreign",
            kind: "upload",
            category: "videos",
            source: "upload",
            size: 1,
            contentHash: "f".repeat(64),
            status: "ready",
            createdAt: Date.now(),
            mimeType: "video/mp4",
            storageId: await ctx.storage.store(
              new Blob([new Uint8Array([1])], { type: "video/mp4" }),
            ),
          }),
        );
        return seedMidRender(t, {
          deckOverrides: {
            0: { visual: "uploaded_video", asset: { source: "vault", docId: String(docId) } },
          },
        });
      },
    },
    {
      name: "vault doc whose bytes are not video",
      reason: "incomplete_blocks",
      seed: async (t) => {
        const docId = await t.run(async (ctx) =>
          ctx.db.insert("vaultDocuments", {
            tenantId: A,
            title: "a pdf",
            kind: "upload",
            category: "documents",
            source: "upload",
            size: 1,
            contentHash: "e".repeat(64),
            status: "ready",
            createdAt: Date.now(),
            mimeType: "application/pdf",
            storageId: await ctx.storage.store(
              new Blob([new Uint8Array([1])], { type: "application/pdf" }),
            ),
          }),
        );
        return seedMidRender(t, {
          deckOverrides: {
            0: { visual: "uploaded_video", asset: { source: "vault", docId: String(docId) } },
          },
        });
      },
    },
    {
      name: "unrenderable card text",
      reason: "incomplete_blocks",
      seed: (t) =>
        seedMidRender(t, {
          deckOverrides: { 0: { visual: "text_card", overlay: "   ", narration: "" } },
        }),
    },
    {
      name: "a bought job at an index the deck does not have",
      reason: "incomplete_blocks",
      seed: async (t) => {
        const seeded = await seedMidRender(t);
        await t.run(async (ctx) => {
          await ctx.db.insert("mediaJobs", {
            tenantId: A,
            planId: seeded.planId,
            batchId: seeded.batchId,
            blockIndex: 7,
            provider: "fal",
            kind: "video",
            model: MEDIA_DEFAULT_VIDEO.model,
            spec: {
              kind: "video",
              resolution: MEDIA_DEFAULT_VIDEO.resolution,
              seconds: MEDIA_DEFAULT_VIDEO.seconds,
            },
            promptHash: "1".repeat(64),
            status: "succeeded",
            assetStorageId: await ctx.storage.store(
              new Blob([new Uint8Array([1])], { type: "video/mp4" }),
            ),
            mimeType: "video/mp4",
            estUsd: 0.5,
            createdAt: T0,
            updatedAt: T0,
          });
        });
        return seeded;
      },
    },
    {
      name: "scene seconds do not sum to the declared target",
      reason: "incomplete_blocks",
      seed: (t) => seedMidRender(t, { planPatch: { targetDurationSeconds: 999 } }),
    },
    {
      name: "a job still in flight",
      reason: "not_all_succeeded",
      seed: (t) => seedMidRender(t, { unlanded: true }),
    },
    {
      name: "an empty batch (no renderable rows at all)",
      reason: "empty_batch",
      seed: async (t) => {
        const planId = await t.run(
          async (ctx) =>
            await ctx.db.insert("plans", {
              tenantId: A,
              threadId: "thread_1",
              status: "proposed",
              renderStatus: "rendering",
              createdAt: Date.now(),
            }),
        );
        return { planId, batchId: "batch_with_no_rows" };
      },
    },
  ];

  test.each(CASES)("$name → failed + '$reason' + one dead letter", async ({ reason, seed }) => {
    const t = harness();
    // Refusals are decided BEFORE any request exists — a fetch here is a bug, not a mock gap.
    const fetchMock = vi.fn(() => {
      throw new Error("a refusal must never reach the render route");
    });
    vi.stubGlobal("fetch", fetchMock);
    stubRenderEnv();
    const { planId, batchId } = await seed(t);

    const out = await t.action(internal.render.renderReel.renderReel, {
      tenantId: A,
      planId,
      batchId,
    });
    expect(out).toEqual({ ok: false, reason });
    expectNoOwnedRenderPost(fetchMock, batchId);

    // The terminal the canvas and retryRender can act on — never eternal "assembling".
    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe(reason); // the EXACT class, not merely "failed"
    expect(plan?.renderedAt).toBeDefined();

    // ONE dead letter, refs/codes ONLY (§4) — no prompt, no narration, no card text.
    const rows = await deadLetters(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: A,
      workflowId: "media.render",
      status: "new",
      error: reason,
    });
    expect(Object.keys((rows[0]?.payload ?? {}) as object).sort()).toEqual(
      ["batchId", "planId", "reasonCode"].sort(),
    );
    expect((rows[0]?.payload as { reasonCode?: string })?.reasonCode).toBe(reason);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toMatch(/prompt \d|x{10,}|scene \d/); // deck content stays out
    expect(serialized).not.toMatch(new RegExp(CARD_TEXT));
  });

  test("the refusal terminal leaves retryRender's precondition reachable", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { planId, batchId } = await seedMidRender(t, {
      planPatch: { shotsChangedAt: T0 + 1 },
    });
    await t.action(internal.render.renderReel.renderReel, { tenantId: A, planId, batchId });
    // `retryRender` requires exactly this state (media.ts) — before 25.1-01 the plan sat at
    // "rendering" forever and the button refused with `not_failed`.
    expect((await planRow(t, planId))?.renderStatus).toBe("failed");
  });

  test("a batch that CAN render is untouched by the refusal branch", async () => {
    const t = harness();
    vi.stubGlobal("fetch", vi.fn());
    stubRenderEnv();
    const { planId, batchId } = await seedMidRender(t);
    const sidecar = JSON.stringify({
      script: "assemble_final.sh",
      scene_count: 2,
      target_duration_s: 2 * MEDIA_DEFAULT_VIDEO.seconds,
      total_duration_s: 2 * MEDIA_DEFAULT_VIDEO.seconds,
      actual_duration_s: 2 * MEDIA_DEFAULT_VIDEO.seconds,
      gates: ["speech_fits_the_reel"],
      scenes: [0, 1].map((index) => ({
        index,
        start_s: index * MEDIA_DEFAULT_VIDEO.seconds,
        duration_s: MEDIA_DEFAULT_VIDEO.seconds,
        visual: "video",
        lead_silence_s: 0.3,
        speech_abs_s: index * MEDIA_DEFAULT_VIDEO.seconds + 0.5,
        speech_dur_s: MEDIA_DEFAULT_VIDEO.seconds - 1,
        overrun: false,
      })),
    });
    const sidecarStorageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob([sidecar], { type: "application/json" })),
    );
    const mp4StorageId = await t.run(
      async (ctx) =>
        await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "video/mp4" })),
    );
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
    expect((await planRow(t, planId))?.renderStatus).toBe("rendered");
    expect(await deadLetters(t)).toHaveLength(0);
  });
});

// ── D2: renderReel runs under the ActionRetrier — a crash after markRendering terminalizes ──────

describe("D2: onRenderComplete — the retrier terminal for a crashed renderReel run", () => {
  const RUN_ID = "render-run-1" as RunId;
  const seedPlanAt = (t: T, over: Record<string, unknown> = {}) =>
    t.run(
      async (ctx) =>
        await ctx.db.insert("plans", {
          tenantId: A,
          threadId: "thread_1",
          status: "proposed",
          renderStatus: "rendering",
          renderRunId: RUN_ID,
          createdAt: Date.now(),
          ...over,
        }),
    );

  test("a FAILED run terminalizes a still-rendering plan: failed + render_crashed + dead letter", async () => {
    const t = harness();
    const planId = await seedPlanAt(t);

    await t.mutation(internal.mediaComplete.onRenderComplete, {
      runId: RUN_ID,
      // The retrier's error string can carry a URL or an env name — it must NEVER be persisted.
      result: { type: "failed", error: "fetch https://secret.example failed OPENAI_API_KEY" },
    });

    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("render_crashed"); // a CODE, never the error string
    expect(plan?.renderedAt).toBeDefined();

    const rows = await deadLetters(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: A,
      workflowId: "media.render",
      status: "new",
      error: "render_crashed",
    });
    expect(Object.keys((rows[0]?.payload ?? {}) as object).sort()).toEqual(
      ["planId", "reasonCode"].sort(),
    );
    // §4: nothing from the retrier's error crosses into the log plane.
    expect(JSON.stringify(rows[0])).not.toMatch(/http|OPENAI|secret\.example/i);
  });

  test("a CANCELED run writes its own code", async () => {
    const t = harness();
    const planId = await seedPlanAt(t);
    await t.mutation(internal.mediaComplete.onRenderComplete, {
      runId: RUN_ID,
      result: { type: "canceled" },
    });
    expect((await planRow(t, planId))?.renderReason).toBe("render_canceled");
  });

  test("a SUCCESS result writes nothing — renderReel owns its own terminals", async () => {
    const t = harness();
    const planId = await seedPlanAt(t);
    await t.mutation(internal.mediaComplete.onRenderComplete, {
      runId: RUN_ID,
      result: { type: "success", returnValue: { ok: true } },
    });
    expect((await planRow(t, planId))?.renderStatus).toBe("rendering"); // untouched
    expect(await deadLetters(t)).toHaveLength(0);
  });

  test.each([
    "failed",
    "rendered",
  ] as const)("IDEMPOTENT: a plan already at '%s' is left alone — no second terminal, no dead letter", async (renderStatus) => {
    const t = harness();
    const planId = await seedPlanAt(t, { renderStatus, renderReason: "route_rejected" });
    await t.mutation(internal.mediaComplete.onRenderComplete, {
      runId: RUN_ID,
      result: { type: "failed", error: "late delivery" },
    });
    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe(renderStatus);
    expect(plan?.renderReason).toBe("route_rejected"); // the FIRST terminal's reason stands
    expect(await deadLetters(t)).toHaveLength(0);
  });

  test("an unknown runId resolves no plan and writes nothing", async () => {
    const t = harness();
    await seedPlanAt(t); // a plan exists, but under a DIFFERENT run id
    await t.mutation(internal.mediaComplete.onRenderComplete, {
      runId: "some-other-run" as RunId,
      result: { type: "failed", error: "x" },
    });
    expect(await deadLetters(t)).toHaveLength(0);
  });
});

describe("D2: a non-JSON 200 from the render route is a failed terminal, not an uncaught throw", () => {
  test.each([
    ["an HTML error page", "<html>bad gateway</html>"],
    ["a JSON body that is not an object", "null"],
  ])("%s → failed + route_bad_response + dead letter", async (_name, body) => {
    const t = harness();
    stubRenderEnv();
    // NO fixture: the real fetch path runs, and the route answers 200 with an unusable body.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const { planId, batchId } = await seedMidRender(t);

    const out = await t.action(internal.render.renderReel.renderReel, {
      tenantId: A,
      planId,
      batchId,
    });
    expect(out).toEqual({ ok: false, reason: "route_bad_response" });

    const plan = await planRow(t, planId);
    expect(plan?.renderStatus).toBe("failed");
    expect(plan?.renderReason).toBe("route_bad_response");
    const rows = await deadLetters(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.error).toBe("route_bad_response");
  });
});

// ── 33.1-06: the music bed is an OPTIONAL input — present when landed, never waited on ──────────
//
// The bed used to come from a baked library and had no row. It is now fetched from Openverse onto
// a $0 stock row at MUSIC_BLOCK_INDEX. The property the old design bought — "a reel never waits on
// its music" — is kept by construction here: `batchToRender` reads the bed row if it has landed and
// says nothing about it otherwise. A failed or missing bed is a bedless reel (the assembler's WARN
// path), never a refusal and never a stall.
describe("33.1-06: the music bed is optional — shipped when landed, silently absent otherwise", () => {
  const ART = {
    palette: ["#0B4F4A deep teal"],
    mood: "Quietly confident.",
    lighting: "Warm golden light from camera left.",
    composition: "Off-centre right.",
    environment: "A small office.",
    texture: "35mm grain.",
    references: ["Gregory Crewdson"],
    avoid: "No stock-footage handshakes.",
  };
  const bedRow = (t: T, planId: Id<"plans">, landed: boolean) =>
    t.run(async (ctx) => {
      const storageId = landed
        ? await ctx.storage.store(new Blob([new Uint8Array([9, 9, 9])], { type: "audio/mpeg" }))
        : undefined;
      const source = await ctx.db
        .query("mediaJobs")
        .withIndex("by_plan_created", (q) => q.eq("tenantId", A).eq("planId", planId))
        .first();
      if (!source) throw new Error("Missing bed fixture batch");
      return ctx.db.insert("mediaJobs", {
        tenantId: A,
        planId,
        batchId: source.batchId,
        blockIndex: MUSIC_BLOCK_INDEX,
        provider: "stock",
        kind: "audio",
        model: MEDIA_MUSIC_STOCK.model,
        spec: { kind: "stock", media: "audio", seconds: 16 },
        promptHash: "0".repeat(64),
        status: landed ? "succeeded" : "failed",
        ...(landed
          ? { assetStorageId: storageId, mimeType: "audio/mpeg" }
          : { failureReason: "stock_no_match" }),
        estUsd: 0,
        createdAt: T0,
        updatedAt: T0,
      });
    });
  const inputsOf = (t: T, batchId: string) =>
    t.query(internal.render.renderReel.batchToRender, { tenantId: A, batchId });

  test("a LANDED bed becomes the music.mp3 input and musicFile — the assembler is told where it is", async () => {
    const t = harness();
    const { planId, batchId } = await seedMidRender(t, {
      planPatch: { artDirection: { ...ART, music: "upbeat" } },
    });
    const jobId = await bedRow(t, planId, true);
    const r = await inputsOf(t, batchId);
    expect(r.ok, `refused: ${r.ok ? "" : r.reason}`).toBe(true);
    if (!r.ok) return;
    expect(r.value.music).toBe("upbeat");
    expect(r.value.musicFile).toBe(MUSIC_INPUT_NAME);
    expect(r.value.inputs).toContainEqual({ name: MUSIC_INPUT_NAME, jobId });
  });

  test("a FAILED bed is a bedless reel — the batch still renders and nothing names a track", async () => {
    const t = harness();
    const { planId, batchId } = await seedMidRender(t, {
      planPatch: { artDirection: { ...ART, music: "upbeat" } },
    });
    await bedRow(t, planId, false);
    const r = await inputsOf(t, batchId);
    expect(r.ok, `refused: ${r.ok ? "" : r.reason}`).toBe(true);
    if (!r.ok) return;
    expect(r.value.music).toBe("upbeat"); // the mood still reaches the sidecar
    expect(r.value.musicFile).toBeUndefined();
    expect(r.value.inputs.some((i) => i.name === MUSIC_INPUT_NAME)).toBe(false);
  });

  test("no mood declared means no bed input, even if a stray audio row landed", async () => {
    const t = harness();
    const { planId, batchId } = await seedMidRender(t);
    await bedRow(t, planId, true);
    const r = await inputsOf(t, batchId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.musicFile).toBeUndefined();
    expect(r.value.inputs.some((i) => i.name === MUSIC_INPUT_NAME)).toBe(false);
  });
});
