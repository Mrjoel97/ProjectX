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
import { MEDIA_DEFAULT_VIDEO, MEDIA_DEFAULT_VOICE } from "@pikar/cost/media";
import type { RunId } from "@convex-dev/action-retrier";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import retrierTest from "@convex-dev/action-retrier/test";
import aggregateSchema from "../../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../../node_modules/@convex-dev/workpool/src/component/schema.js";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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

/** The media.test.ts harness, verbatim, plus the action-retrier (D2 runs renderReel under it). */
function harness(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  retrierTest.register(t);
  return t;
}

const A = "tenant_a";
const B = "tenant_b";
const T0 = 1_754_000_000_000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubRenderEnv() {
  vi.stubEnv("Video_and_image_API_Key", "test-key");
  vi.stubEnv("WAN_API_BASE_URL", "https://workspace.ap-southeast-1.maas.aliyuncs.com");
  vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
  vi.stubEnv("FAL_WEBHOOK_SECRET", "test-secret");
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
  const batchId = "batch_render";
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
    expect(fetchMock).toHaveBeenCalledTimes(0);

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
    expect((rows[0]?.payload as { reasonCode: string }).reasonCode).toBe(reason);
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
      async (ctx) =>
        await ctx.storage.store(new Blob([sidecar], { type: "application/json" })),
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

  test.each(["failed", "rendered"] as const)(
    "IDEMPOTENT: a plan already at '%s' is left alone — no second terminal, no dead letter",
    async (renderStatus) => {
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
    },
  );

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
