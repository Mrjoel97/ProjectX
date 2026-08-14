/**
 * The media JOB reservation (MEDIA-01, D10) — the ONE money gate for Phase 20.
 *
 * A per-request cap bounds NOTHING when a reel is N clips PLUS N voice takes PLUS an STT pass PLUS
 * a render: six 720p x 4 s Sora clips are six passing $0.40 requests and one $2.40 visual job. So
 * the whole JOB is estimated, capped and RESERVED in ONE serializable transaction, before a single
 * request exists.
 *
 * **This is the one place media DIVERGES from the LLM rail, deliberately.**
 * `guardrails.prepare` checks and `guardrails.recordSpend` consumes afterwards — safe there,
 * because LLM calls inside a turn are serial and an overshoot is cents. Here 13+ jobs are submitted
 * back-to-back and land minutes apart, so post-hoc recording would let all of them fire against a
 * window that had room for one. 20-PROVIDER-EVAL.md §4: *an LLM overshoot is cents, a media
 * overshoot is dollars.*
 *
 * Default runtime — NOT "use node". This module touches ctx.db; the provider calls need only
 * `fetch`, and `smoke.ts:234` records that a regular action already has `ctx.storage.store`.
 *
 * internalMutation from ./_generated/server is NOT banned by the import guard (the telemetry.ts
 * precedent). The tenant-facing canvas surface is plan 20-09's and uses the lib/functions.ts
 * wrappers (CLAUDE.md §2).
 */
import { concatWavTakes } from "@pikar/core/captions";
import type { Block, ShotType } from "@pikar/core/storyboard";
import {
  CLIP_SECONDS,
  isPaidBlock,
  MAX_CHARS_PER_BLOCK,
  maxCharsFor,
  minCharsFor,
  SHOT_TYPES,
} from "@pikar/core/storyboard";
import type { MediaSpec } from "@pikar/cost/media";
import {
  chooseMediaBatch,
  estimateMediaUsd,
  MEDIA_DEFAULT_IMAGE,
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_JOB_CAP_USD,
} from "@pikar/cost/media";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { getGuardrailConfig, mediaRemainingCentsInner, rateLimiter } from "./guardrails";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
// The plain-function half of the ledger writer: the limiter movement and its row must commit
// or fail together (FIN-01). A separate ctx.runMutation would be a second transaction.
import { ensureCoverage, recordMovement } from "./spendLedger";

/** Every way a job can be refused BEFORE a cent moves. Distinct codes because they send the user
 *  to distinct levers: rewrite a line, cut blocks, wait for tomorrow, or call the operator. */
export type ReserveRefusal =
  | "kill_switch"
  | "unknown_model"
  | "over_job_cap"
  | "illegal_duration"
  | "unrenderable_block"
  | "narration_too_long"
  | "narration_too_short"
  | "media_daily_exhausted"
  | "deployment_media_exhausted";

export type ReserveResult =
  | { ok: true; batchId: string; estUsd: number; estCents: number; lineCount: number }
  | { ok: false; reason: ReserveRefusal };

/** A provider line: the priced spec, its own fractional-USD estimate, and the `mediaJobs` row it
 *  becomes. The `render` line is deliberately NOT one of these — see below. */
type ProviderLine = {
  spec: MediaSpec;
  estUsd: number;
  row: Omit<Doc<"mediaJobs">, "_id" | "_creationTime">;
};

const CLIP_SECONDS_SET = new Set<number>(CLIP_SECONDS);
const standaloneImageSpec = (): Extract<MediaSpec, { kind: "image" }> => ({
  kind: "image",
  model: MEDIA_DEFAULT_IMAGE.model,
  width: MEDIA_DEFAULT_IMAGE.width,
  height: MEDIA_DEFAULT_IMAGE.height,
});

/** The shared budget transaction for every media deliverable. Callers construct fully-priced rows;
 * this function caps the complete batch, checks and consumes both spend windows, then inserts all
 * rows atomically. A standalone image is therefore not a second spending rail. */
async function reserveProviderLinesInner(
  ctx: MutationCtx,
  tenantId: string,
  batchId: string,
  lines: readonly ProviderLine[],
  specs: readonly MediaSpec[],
): Promise<ReserveResult> {
  // FIN-01: watching starts at the gate, not at the money (see ensureCoverage). A media job that
  // is refused for price or budget is still a tenant we can report a confident zero for.
  await ensureCoverage(ctx, tenantId, Date.now());

  // The cap, and the ONE flooring of cents (D12a). `chooseMediaBatch` floors the TOTAL exactly
  // once; the per-line `estUsd` values stay unfloored on their rows.
  const est = chooseMediaBatch(specs, MEDIA_JOB_CAP_USD);
  if (!est.ok) return { ok: false, reason: est.error.code };
  const { estUsd, estCents } = est.value;

  // CHECK BOTH, THEN CONSUME BOTH in this one serializable mutation. Tenant first, so a tenant that
  // is personally out is told so rather than blamed for a global pause.
  const tenantWindow = await rateLimiter.check(ctx, "mediaSpendCents", {
    key: tenantId,
    count: estCents,
  });
  if (!tenantWindow.ok) return { ok: false, reason: "media_daily_exhausted" };
  const deploymentWindow = await rateLimiter.check(ctx, "deploymentMediaSpendCents", {
    count: estCents,
  });
  if (!deploymentWindow.ok) return { ok: false, reason: "deployment_media_exhausted" };

  // CONSUME NOW, before any POST exists. There are deliberately no refunds: media's bounded,
  // spec-priced over-reservation is cents, not the folder-ingest rail's unknowable dollars.
  await rateLimiter.limit(ctx, "mediaSpendCents", {
    key: tenantId,
    count: estCents,
    reserve: true,
  });
  await rateLimiter.limit(ctx, "deploymentMediaSpendCents", { count: estCents, reserve: true });

  // FIN-01: ONE `reserved` movement for the WHOLE job, in this same transaction. Per-line rows
  // would not sum back to this number — `chooseMediaBatch` floors the TOTAL exactly once (D12a),
  // so the batch estimate is not the sum of the line estimates.
  //
  // DERIVED from `batchId`, not minted: `batchId` is server-minted per reservation and the approve
  // arm reserves inside the plan's proposed→approved CAS, so approve-once IS reserve-once. A
  // genuine second reservation gets a new batch and therefore its own row.
  // Guarded for the same reason the landing is: a batch that prices under a cent (a lone short
  // voice line) floors to 0, and a zero-cent movement is rejected — it would abort the reservation.
  if (estCents > 0) {
    await recordMovement(ctx, {
      tenantId,
      rail: "media",
      phase: "reserved",
      amountCents: estCents,
      correlationId: `mediabatch:${batchId}`,
      createdAt: Date.now(),
      // Every line of one batch belongs to one plan, so the first line names it. Read off the rows
      // rather than added as a parameter: a standalone image reaches this same function, and giving
      // it a planId argument it does not otherwise need would be a wider signature for no gain.
      planId: lines[0]?.row.planId,
      kind: "media_reserve",
    });
  }

  // Only now do rows exist. Every refusal above returned with zero inserts.
  for (const line of lines) await ctx.db.insert("mediaJobs", line.row);
  return { ok: true, batchId, estUsd, estCents, lineCount: lines.length };
}

/**
 * Reserve a WHOLE media job. Returns a governed refusal — it never throws for an expected stop.
 *
 * Called DIRECTLY (not via `runMutation`) by plan 20-07's approve arm, which runs inside
 * `executePlan` — itself a `tenantMutation`, and a Convex mutation cannot `runMutation`. Calling
 * this function keeps the reservation in the SAME transaction as the plan's `proposed → approved`
 * CAS, which is exactly the property that makes "approve once, reserve once" true. The
 * `reserveJob` wrapper below exists for the canvas path (20-09) and for tests.
 *
 * **Regenerate-one-block is a JOB OF ONE BLOCK through this identical path** — one video line, one
 * tts line, one render line, because regenerating a block invalidates the reel and forces a
 * re-render. No second rail, no second cap, no bypass.
 */
export async function reserveJobInner(
  ctx: MutationCtx,
  a: {
    tenantId: string;
    planId: Id<"plans">;
    blocks: readonly Block[];
    clipSeconds: number;
    withCaptions: boolean;
  },
): Promise<ReserveResult> {
  // 0. FIN-01 coverage, ABOVE every refusal below — including the kill switch. This is the
  //    outermost media gate, and `reserveProviderLinesInner` (which also opens coverage, for the
  //    standalone-image entry point) is never reached once any check here returns. A tenant paused
  //    by the media kill switch must still report a CONFIDENT zero rather than `unknown`.
  await ensureCoverage(ctx, a.tenantId, Date.now());

  // 1. BOTH switches. They are independent by construction (a media pause must not stop the email
  //    cockpit) but an all-stop is an all-stop, so either one refuses here.
  const cfg = await getGuardrailConfig(ctx);
  if (cfg.killSwitch || cfg.mediaKillSwitch) return { ok: false, reason: "kill_switch" };

  // 2. A block length nobody prices. `chooseMediaBatch` would catch it too, but checking here means
  //    the narration band below is computed against a LEGAL window rather than a nonsense one.
  if (!CLIP_SECONDS_SET.has(a.clipSeconds)) return { ok: false, reason: "illegal_duration" };

  // 3. THE FREE PRE-FLIGHT GUARD, before anything else costs a thought.
  //    A narration line has a BAND, not a ceiling, and the band travels with the block length
  //    (103–140 at 10 s, 43–70 at 5 s). `assemble_final.sh` hard-errors on a take whose speech
  //    falls outside [clipSeconds - 1.4, clipSeconds] seconds — too short is as fatal as too long.
  //    **This check MUST live UPSTREAM of the reserve, not downstream:** the whole point is that an
  //    overrun is caught before payment rather than by `ffprobe` after $3.00 of clips have landed.
  //    A narration-length validation sitting downstream of the reservation is the warning sign.
  const minChars = minCharsFor(a.clipSeconds);
  const maxChars = maxCharsFor(a.clipSeconds);
  for (const block of a.blocks) {
    // 3a. CAN THIS DECK EVEN BECOME A REEL? An unpaid block gets NO video line (see the
    //     `isPaidBlock` branch below), so nothing ever writes its `blockNN.mp4` — and
    //     `assemble_final.sh` discovers inputs BY INDEX and hard-errors on a missing clip. A deck
    //     containing one would sail through this gate, spend real money on its AI blocks, and then
    //     be unable to assemble anything at all.
    //
    //     **That is why this check is HERE and not at the render.** `renderReel.batchToRender`
    //     also refuses it (`incomplete_blocks`), but by then the clips are bought. This is the
    //     same rule the narration band below is placed by: a condition that makes a render
    //     impossible must be caught UPSTREAM of the reservation, never downstream of it.
    //
    //     `storyboard.ts`'s PAID table calls TEXT "rendered by the assembler" and SCREEN REC "an
    //     instruction to the human". Neither is true of the assembler this repo actually harvested
    //     (20-13), which has no title-card path and no upload path. Until one exists, the honest
    //     behaviour is a free, loud refusal rather than a promise the renderer cannot keep.
    //
    //     ponytail: refuse, rather than build a title card. The ceiling is that a deck mixing an
    //     AI block with a TEXT card cannot be made at all; the upgrade path is a `drawtext` branch
    //     in `assemble_final.sh` for a clipless index (the font is ALREADY baked into the sandbox
    //     snapshot for 20-17), plus a regenerated mirror and its byte-identity drift test — at
    //     which point THIS guard narrows to "unpaid AND no overlay text" instead of disappearing.
    if (!isPaidBlock(block)) return { ok: false, reason: "unrenderable_block" };

    if (block.narration.length < minChars) return { ok: false, reason: "narration_too_short" };
    if (block.narration.length > maxChars) return { ok: false, reason: "narration_too_long" };
  }

  // 4. THE WHOLE JOB'S line items — this is what D10 changed. Every clip, every voice take, the
  //    captions STT and the render are ONE reserved unit.
  const now = Date.now();
  const batchId = crypto.randomUUID(); // server-minted, the cockpit.ts correlationId idiom
  const base = { tenantId: a.tenantId, planId: a.planId, batchId };
  const lines: ProviderLine[] = [];

  for (const block of a.blocks) {
    // One video line per PAID block. Model, resolution and duration are pinned from the same
    // OpenAI-backed spec that the cost rail prices; no provider default can change the invoice.
    if (isPaidBlock(block)) {
      const spec: MediaSpec = {
        kind: "video",
        model: MEDIA_DEFAULT_VIDEO.model,
        resolution: MEDIA_DEFAULT_VIDEO.resolution,
        seconds: a.clipSeconds,
      };
      const priced = estimateMediaUsd(spec);
      if (!priced.ok) return { ok: false, reason: priced.error.code }; // fail closed, never guess
      lines.push({
        spec,
        estUsd: priced.value,
        row: {
          ...base,
          provider: "openai",
          blockIndex: block.index,
          kind: "video",
          model: MEDIA_DEFAULT_VIDEO.model,
          spec: {
            kind: "video",
            resolution: MEDIA_DEFAULT_VIDEO.resolution,
            seconds: a.clipSeconds,
          },
          promptHash: await contentHash(block.prompt),
          status: "queued",
          estUsd: priced.value,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // One voice line per block — a TEXT or SCREEN REC block still has a spoken line over it.
    //
    // RESERVED AT TWICE THE CHARACTER ESTIMATE so ONE rewrite round is already paid for. The
    // provider returns no duration, so an overrunning line is only provable in the sandbox; when it
    // happens the cure is a rewrite and a re-voice, and a job that cannot afford its own cure would
    // strand a paid deck. At $0.012 the doubling is free, and the fail-closed direction is
    // over-reserving.
    const characters = block.narration.length * 2;
    const spec: MediaSpec = { kind: "tts", model: MEDIA_DEFAULT_VOICE.model, characters };
    const priced = estimateMediaUsd(spec);
    if (!priced.ok) return { ok: false, reason: priced.error.code };
    lines.push({
      spec,
      estUsd: priced.value,
      row: {
        ...base,
        provider: "openai",
        blockIndex: block.index,
        kind: "tts",
        model: MEDIA_DEFAULT_VOICE.model,
        spec: {
          kind: "tts",
          characters,
          voice: MEDIA_DEFAULT_VOICE.voice,
          sampleRateHertz: MEDIA_DEFAULT_VOICE.sampleRateHertz,
        },
        promptHash: await contentHash(block.narration),
        status: "queued",
        estUsd: priced.value,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  // One deck-wide captions pass. blockIndex -1: it belongs to the whole reel, not to a block.
  if (a.withCaptions) {
    const audioMinutes = (a.blocks.length * a.clipSeconds) / 60;
    const spec: MediaSpec = { kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes };
    const priced = estimateMediaUsd(spec);
    if (!priced.ok) return { ok: false, reason: priced.error.code };
    lines.push({
      spec,
      estUsd: priced.value,
      row: {
        ...base,
        provider: "openai",
        blockIndex: -1,
        kind: "stt",
        model: MEDIA_DEFAULT_STT.model,
        spec: { kind: "stt", audioMinutes },
        promptHash: await contentHash(a.blocks.map((b) => b.narration).join("\n")),
        status: "queued",
        estUsd: priced.value,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  // D10 — sandbox compute is a cost line too. Estimated at a flat constant because Vercel exposes
  // no per-sandbox billing at request time; the ceiling and its upgrade path are named on
  // MEDIA_SANDBOX_USD_PER_RENDER in the price table. It is reserved here so that a job that cannot
  // afford its own render is refused before its clips are bought. It gets NO `mediaJobs` row: the
  // render is a plan-row concern, with no falRequestId and no webhook.
  const specs: MediaSpec[] = [...lines.map((l) => l.spec), { kind: "render" }];

  // 5-9. The shared transaction floors the batch total once, checks and consumes BOTH windows, and
  // inserts only after every refusal has passed. The standalone image path calls this exact helper.
  return await reserveProviderLinesInner(ctx, a.tenantId, batchId, lines, specs);
}

/** Reserve one standalone image through the same media money transaction as a reel. */
export async function reserveImageInner(
  ctx: MutationCtx,
  a: { tenantId: string; planId: Id<"plans">; prompt: string },
): Promise<ReserveResult> {
  const cfg = await getGuardrailConfig(ctx);
  if (cfg.killSwitch || cfg.mediaKillSwitch) return { ok: false, reason: "kill_switch" };
  const spec = standaloneImageSpec();
  const priced = estimateMediaUsd(spec);
  if (!priced.ok) return { ok: false, reason: priced.error.code };
  const now = Date.now();
  const batchId = crypto.randomUUID();
  const line: ProviderLine = {
    spec,
    estUsd: priced.value,
    row: {
      tenantId: a.tenantId,
      planId: a.planId,
      batchId,
      provider: "openai",
      blockIndex: 0,
      kind: "image",
      model: MEDIA_DEFAULT_IMAGE.model,
      spec: {
        kind: "image",
        width: MEDIA_DEFAULT_IMAGE.width,
        height: MEDIA_DEFAULT_IMAGE.height,
      },
      promptHash: await contentHash(a.prompt),
      status: "queued",
      estUsd: priced.value,
      createdAt: now,
      updatedAt: now,
    },
  };
  return await reserveProviderLinesInner(ctx, a.tenantId, batchId, [line], [spec]);
}

/** The `internalMutation` face of `reserveJobInner`, for the canvas path (plan 20-09) and tests.
 *  20-07's approve arm calls `reserveJobInner` directly instead — see its doc comment. */
export const reserveJob = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    blocks: v.array(
      v.object({
        index: v.number(),
        // A CLOSED literal union, unlike `plans.shots[].type` which is v.string(). This is a money
        // gate: an unknown shot type must be a boundary rejection, not a block that silently
        // estimates to zero because `isPaidBlock` found no table entry for it.
        type: v.union(
          v.literal("AI"),
          v.literal("SCREEN REC"),
          v.literal("TEXT"),
          v.literal("VIDEO"),
        ),
        seconds: v.number(),
        windowStartMs: v.number(),
        description: v.string(),
        narration: v.string(),
        overlay: v.optional(v.string()),
        prompt: v.string(),
      }),
    ),
    clipSeconds: v.number(),
    withCaptions: v.boolean(),
  },
  handler: async (ctx, a): Promise<ReserveResult> => reserveJobInner(ctx, a),
});

// ── The D5 reconciliation READERS (plan 20-18) ─────────────────────────────────────────
//
// `docs/playbooks/media.md`'s D5 procedure asks two questions. These answer the first —
// *did the provider charge what we estimated?* — against real rows, in one command.
//
// Both are pure READS: no patch, no re-pricing of a stored row, no rate-limiter call. That is what
// makes them safe to run against production at any time, including mid-batch.

/** One `mediaJobs` row's kind, as the aggregate buckets it. */
type KindTotals = { estCents: number; actualCents: number; rowCount: number };

/**
 * The D5(a) aggregate. Operator:
 * `npx convex run media:spendForPeriod '{"tenantId":"…","sinceMs":…,"untilMs":…}'`
 * — then compare `actualCents` against fal's own billing page for the same window. A gap means the
 * price table is wrong, not that the meter is wrong: the meter records what the provider reported.
 *
 * THREE THINGS THAT WOULD OTHERWISE MAKE THIS NUMBER LIE, all handled here and all disclosed in
 * the payload rather than only in this comment:
 *
 *  1. **`estCents` is NOT the reserved amount.** The reservation was `chooseMediaBatch` over the
 *     whole batch INCLUDING the `render` line, floored to cents ONCE. The render line has no row.
 *     So reserved > Σ rows, by construction — hence `notes.reservedTotalNotDerivable`.
 *  2. **A `tts` row's `estUsd` is DOUBLE** (20-04 reserves voice at 2× so one rewrite round is
 *     pre-paid). est/actual ≈ 2 on voice is HEALTHY; without `notes.ttsReservedAt2x` that reads as
 *     a 100% overcharge.
 *  3. **`actualCents` is absent until a row lands**, and stays absent if it failed. Σ over the
 *     rows that have one therefore UNDER-reports unless the rest are counted — `unlanded` is that
 *     count, and a period with `unlanded > 0` is not final.
 *
 * Note `byKind` subtotals are each rounded once, so they may differ from `estCents` by a cent or
 * two. The TOTAL is the authoritative figure; the breakdown exists because a drift in ONE table row
 * is invisible in a single total.
 */
export const spendForPeriod = internalQuery({
  args: { tenantId: v.string(), sinceMs: v.number(), untilMs: v.number() },
  handler: async (
    ctx,
    a,
  ): Promise<{
    estCents: number;
    actualCents: number;
    rowCount: number;
    unlanded: number;
    byKind: Record<string, KindTotals>;
    notes: { ttsReservedAt2x: boolean; reservedTotalNotDerivable: true };
  }> => {
    // The index PREFIX is the tenant boundary — never a full-table scan, never a cross-tenant read.
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", a.tenantId))
      .collect();

    // HALF-OPEN [sinceMs, untilMs) so two adjacent periods never double-count a boundary row.
    const inPeriod = rows.filter((r) => r.createdAt >= a.sinceMs && r.createdAt < a.untilMs);

    const usdByKind = new Map<string, number>();
    const totals = new Map<string, { actualCents: number; rowCount: number }>();
    let estUsd = 0;
    let actualCents = 0;
    let unlanded = 0;

    for (const r of inPeriod) {
      estUsd += r.estUsd;
      usdByKind.set(r.kind, (usdByKind.get(r.kind) ?? 0) + r.estUsd);
      const bucket = totals.get(r.kind) ?? { actualCents: 0, rowCount: 0 };
      bucket.rowCount += 1;
      if (r.actualCents === undefined) {
        unlanded += 1; // in flight or failed — NOT free
      } else {
        actualCents += r.actualCents;
        bucket.actualCents += r.actualCents;
      }
      totals.set(r.kind, bucket);
    }

    const byKind: Record<string, KindTotals> = {};
    for (const [kind, bucket] of totals) {
      byKind[kind] = {
        estCents: Math.round((usdByKind.get(kind) ?? 0) * 100),
        actualCents: bucket.actualCents,
        rowCount: bucket.rowCount,
      };
    }

    return {
      // Rounded ONCE, on the total — the D12(a) discipline, at the reader this time.
      estCents: Math.round(estUsd * 100),
      actualCents,
      rowCount: inPeriod.length,
      unlanded,
      byKind,
      notes: {
        ttsReservedAt2x: inPeriod.some((r) => r.kind === "tts"),
        reservedTotalNotDerivable: true,
      },
    };
  },
});

/**
 * The D5 per-plan detail. Operator:
 * `npx convex run media:listJobs '{"tenantId":"…","planId":"<id>"}'`.
 *
 * A PROJECTION, not the raw row. `assetStorageId`, `assetHash`, `mimeType` and `bytes` are
 * deliberately omitted: an operator reconciling money has no use for storage handles, and a reader
 * that returns them is the easiest accidental route to a URL (§4 — no fal URL on any row or
 * payload, ever). `promptHash` stays: it is a redaction-safe ref and it is how a row is matched
 * back to its block.
 *
 * `actualCents` / `verdict` / `failureReason` are `| null` rather than optional so a JSON CLI dump
 * shows the ABSENCE explicitly instead of dropping the key. That absence is `unlanded` at row level.
 */
export const listJobs = internalQuery({
  args: { tenantId: v.string(), planId: v.id("plans") },
  handler: async (
    ctx,
    a,
  ): Promise<
    Array<{
      batchId: string;
      blockIndex: number;
      kind: string;
      model: string;
      status: string;
      estUsd: number;
      actualCents: number | null;
      verdict: string | null;
      failureReason: string | null;
      promptHash: string;
    }>
  > => {
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", a.tenantId).eq("planId", a.planId))
      .collect();

    return rows
      .sort((x, y) => x.blockIndex - y.blockIndex || x.kind.localeCompare(y.kind))
      .map((r) => ({
        batchId: r.batchId,
        blockIndex: r.blockIndex,
        kind: r.kind,
        model: r.model,
        status: r.status,
        estUsd: r.estUsd,
        actualCents: r.actualCents ?? null,
        verdict: r.verdict ?? null,
        failureReason: r.failureReason ?? null,
        promptHash: r.promptHash,
      }));
  },
});

// ── Media provider adapters ────────────────────────────────────────────────────────────
//
// Submit new visual and audio lines to OpenAI. GPT Image 2 returns image bytes synchronously;
// Sora returns a video id, so clips are polled and copied into Convex storage before their rows land.
// The legacy Wan poller remains only for tasks submitted before the provider cutover.

/** The `gmailAuth.requireEnv` idiom with a media-worded message. Provider credentials are Convex
 *  deployment env vars (`npx convex env set`), never client-visible variables. */
export function requireEnvMedia(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Media env not configured: ${name}`);
  return val;
}

/**
 * The kinds this adapter can POST **today**. Plan 20-14 added `"tts"`; plan 20-17 adds `"stt"`, and
 * until it does `"stt"` stays OUT of this alias — widening it is what turns the `never` arm in
 * `buildSubmitBody` red until the matching case is written. That is the whole mechanism — the
 * compiler, not a code review.
 *
 * It is deliberately NOT `MediaSpec`: `"render"` (the flat sandbox constant) and `"free"` (an
 * unpaid block) have no provider request at all, so an arm for them would be a lie.
 *
 * The `tts` member carries TWO fields the price table has no opinion about — `voice` and
 * `sampleRateHertz`. They are not priced dimensions, but they ARE pinned wire fields (see the arm),
 * so they ride on the submittable spec rather than being reached for at the POST. `characters` stays
 * because it is the priced dimension, exactly as `resolution` is for video.
 */
export type SubmittableSpec =
  | Extract<MediaSpec, { kind: "video" | "image" }>
  | (Extract<MediaSpec, { kind: "tts" }> & { voice: string; sampleRateHertz: number });

/**
 * The request body, as a pure function of the PRICED spec — pitfall 1, the money bug.
 *
 * Every dimension the price table keys on is set here, from the SAME spec object
 * `chooseMediaBatch` consumed. NEVER omit one and let a provider default it. If you add a priced
 * dimension to the table, add it here in the SAME commit. The `never` arm below makes that
 * requirement mechanical.
 */
export function buildSubmitBody(spec: SubmittableSpec, text: string): Record<string, unknown> {
  switch (spec.kind) {
    case "video":
      return {
        model: spec.model,
        prompt: text,
        seconds: String(spec.seconds),
        size: { "480p": "480x854", "720p": "720x1280", "1080p": "1080x1920" }[spec.resolution],
      };
    case "image":
      return {
        model: spec.model,
        prompt: text,
        n: 1,
        size: `${spec.width}x${spec.height}`,
        quality: "low",
        output_format: "png",
      };
    case "tts":
      return {
        model: spec.model.replace(/^openai\//, ""),
        input: text,
        voice: spec.voice,
        response_format: "wav",
        speed: 1,
      };
    default: {
      const _never: never = spec;
      throw new Error(`unhandled media kind: ${JSON.stringify(_never)}`);
    }
  }
}

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

/** A CODE, never the provider's prose (CLAUDE.md §4, the `calendar.ts:84` idiom). */
async function providerReasonCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      code?: unknown;
      error?: { code?: unknown };
      output?: { code?: unknown };
    };
    const candidate = body.code ?? body.error?.code ?? body.output?.code;
    return typeof candidate === "string" && SAFE_CODE.test(candidate)
      ? candidate
      : `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

/** `blocked` is the 422 arm — a non-retryable input refusal, which is a `provider_blocked` VERDICT
 *  on the row rather than a failure. Everything else is a plain failure the retrier may re-run. */
export type SubmitResult =
  | { ok: true; requestId: string; asset?: { bytes: Uint8Array<ArrayBuffer>; mimeType: string } }
  | { ok: false; code: string; blocked: boolean };

type VisualSpec = Extract<SubmittableSpec, { kind: "video" | "image" }>;

function wanBaseUrl(): string {
  const configured = requireEnvMedia("WAN_API_BASE_URL");
  const url = new URL(configured.startsWith("https://") ? configured : `https://${configured}`);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".maas.aliyuncs.com")) {
    throw new Error("Media env invalid: WAN_API_BASE_URL");
  }
  return url.origin;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Submit one new visual line to OpenAI. Images return their bytes synchronously; Sora returns an
 *  asynchronous video id which `pollOpenAiVideoTask` owns. */
export async function submitLine(
  spec: VisualSpec,
  text: string,
  _webhookUrl?: string,
): Promise<SubmitResult> {
  const key = requireEnvMedia("OPENAI_API_KEY");

  if (process.env.MEDIA_PROVIDER_FIXTURE || process.env.FAL_FIXTURE) {
    return spec.kind === "image"
      ? {
          ok: true,
          requestId: `fixture-${crypto.randomUUID()}`,
          asset: { bytes: new Uint8Array(new ArrayBuffer(16)), mimeType: "image/png" },
        }
      : { ok: true, requestId: `fixture-${crypto.randomUUID()}` };
  }

  let response: Response;
  try {
    const body = buildSubmitBody(spec, text);
    if (spec.kind === "video") {
      const form = new FormData();
      for (const [name, value] of Object.entries(body)) form.append(name, String(value));
      response = await fetch("https://api.openai.com/v1/videos", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
    } else {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  } catch {
    // The thrown error's message can carry the URL — and therefore the webhook's HMAC segment. A
    // code only; the exception itself is dropped on the floor.
    return { ok: false, code: "transport_error", blocked: false };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: await providerReasonCode(response),
      blocked: response.status === 400 || response.status === 422,
    };
  }

  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
    data?: Array<{ b64_json?: unknown }>;
  } | null;
  if (spec.kind === "image") {
    const encoded = body?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length === 0) {
      return { ok: false, code: "asset_missing", blocked: false };
    }
    return {
      ok: true,
      requestId: response.headers.get("x-request-id") ?? `openai-${crypto.randomUUID()}`,
      asset: { bytes: decodeBase64(encoded), mimeType: "image/png" },
    };
  }
  const requestId = body?.id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return { ok: false, code: "no_request_id", blocked: false };
  }
  // Returns holding a queue ticket; `pollOpenAiVideoTask` owns the later status requests.
  return { ok: true, requestId };
}

/** One `mediaJobs` row, reduced to what a submit needs. `promptHash` is deliberately absent: the
 *  TEXT comes from the content plane (`plans.shots`), never from the job row. */
type SubmitLine = {
  jobId: Id<"mediaJobs">;
  blockIndex: number;
  model: string;
  spec: Doc<"mediaJobs">["spec"];
};

/** The stored spec back into a typed `SubmittableSpec`, or `null` for a kind this plan does not
 *  wire. `spec.resolution` is `v.string()` on the row, so it is CHECKED here rather than cast —
 *  a money boundary does not get to assume. */
function toSubmittable(line: SubmitLine): SubmittableSpec | null {
  if (line.spec.kind === "video") {
    const resolution = line.spec.resolution;
    if (resolution !== "480p" && resolution !== "720p" && resolution !== "1080p") return null;
    return { kind: "video", model: line.model, resolution, seconds: line.spec.seconds };
  }
  if (line.spec.kind === "image") {
    return { kind: "image", model: line.model, width: line.spec.width, height: line.spec.height };
  }
  if (line.spec.kind === "tts") {
    // `voice` and `sampleRateHertz` come off the ROW, which is what the reservation wrote — not off
    // MEDIA_DEFAULT_VOICE. Reading the constant here would mean a row reserved under one voice could
    // be submitted under another after a constant bump, and the row is the record of what was priced.
    return {
      kind: "tts",
      model: line.model,
      characters: line.spec.characters,
      voice: line.spec.voice,
      sampleRateHertz: line.spec.sampleRateHertz,
    };
  }
  // `stt` is never submitted here. Its audio is the output of the TTS lines in this same batch;
  // `submitCaptions` owns its later multipart request after those lines have landed.
  return null;
}

/**
 * Which field of the block a kind SUBMITS. A table, not an `if`-chain: plan 20-17's `stt` line reads
 * NEITHER (it is keyed to the whole deck at `blockIndex: -1`), so a missing key here has to stay a
 * governed `missing_shot` rather than a silent fall-through to `prompt`.
 *
 * A `tts` line submitting `prompt` would voice the SHOT DESCRIPTION over the clip — fluent, plausible
 * and completely wrong, with nothing going red. That is why the fixture behind this has a prompt and
 * a narration that differ.
 */
const SUBMIT_TEXT: Record<string, (s: { prompt: string; narration: string }) => string> = {
  video: (s) => s.prompt,
  image: (s) => s.prompt,
  tts: (s) => s.narration,
};

/** The batch's rows AND the plan's shots in ONE read. Deliberately UNFILTERED by status: `claimLine`
 *  is the sole idempotency gate, and filtering here would mask its removal from the retry test. */
export const batchToSubmit = internalQuery({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<{
    lines: SubmitLine[];
    shots: Array<{ index: number; prompt: string; narration: string }>;
    imagePrompt: string | null;
  }> => {
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_batch", (q) => q.eq("tenantId", a.tenantId).eq("batchId", a.batchId))
      .collect();
    // The index PREFIX is the tenant boundary, so the planId below is this tenant's by construction.
    const planId = rows[0]?.planId;
    const plan = planId ? await ctx.db.get(planId) : null;
    return {
      lines: rows.map((r) => ({
        jobId: r._id,
        blockIndex: r.blockIndex,
        model: r.model,
        spec: r.spec,
      })),
      shots: (plan?.shots ?? []).map((s) => ({
        index: s.index,
        prompt: s.prompt,
        narration: s.narration,
      })),
      imagePrompt: plan?.mediaMode === "image" ? (plan.imagePrompt ?? null) : null,
    };
  },
});

/**
 * `queued → submitted`, in a serializable mutation, BEFORE the POST. Returns false if the row is
 * already past `queued`.
 *
 * **This is pitfall 5's whole fix.** The action-retrier re-runs a failed action, so a `submitBatch`
 * that dies on line 7 of 13 would re-POST lines 1–6 on retry — a real double spend against a window
 * already consumed. The finished-reel re-scope makes it sharper, not softer: a reel's batch is
 * ~2N+1 lines rather than N, so there is twice as much to double-spend.
 */
export const claimLine = internalMutation({
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId }): Promise<boolean> => {
    const row = await ctx.db.get(jobId);
    if (row?.status !== "queued") return false; // absent row included — a claim never invents one
    await ctx.db.patch(jobId, { status: "submitted", updatedAt: Date.now() });
    return true;
  },
});

/** The submit outcome onto the row. A CODE reaches `failureReason` — never provider prose, never
 *  the prompt, never the narration (CLAUDE.md §4). No fal URL is stored: plan 20-06 re-derives the
 *  webhook segment from the jobId, so there is nothing to leak. */
export const recordSubmission = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    result: v.union(
      v.object({ ok: v.literal(true), providerRequestId: v.string() }),
      v.object({ ok: v.literal(false), blocked: v.boolean(), code: v.string() }),
    ),
  },
  handler: async (ctx, { jobId, result }): Promise<null> => {
    const updatedAt = Date.now();
    if (result.ok) {
      await ctx.db.patch(jobId, { providerRequestId: result.providerRequestId, updatedAt });
    } else if (result.blocked) {
      // A 422 is an INPUT refusal — the line is finished, not retryable, and it says so.
      await ctx.db.patch(jobId, {
        status: "blocked",
        verdict: "provider_blocked",
        failureReason: result.code,
        updatedAt,
      });
    } else {
      await ctx.db.patch(jobId, { status: "failed", failureReason: result.code, updatedAt });
    }
    return null;
  },
});

export const jobForPoll = internalQuery({
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId }) => {
    const row = await ctx.db.get(jobId);
    if (!row) return null;
    return { kind: row.kind, spec: row.spec, status: row.status };
  },
});

async function storeAndLand(
  ctx: ActionCtx,
  jobId: Id<"mediaJobs">,
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  actual?: { resolution?: string; seconds?: number; width?: number; height?: number },
): Promise<void> {
  const assetStorageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
  await ctx.runMutation(internal.mediaComplete.landResult, {
    jobId,
    outcome: {
      ok: true,
      assetStorageId,
      assetHash: await contentHash(bytes),
      mimeType,
      bytes: bytes.byteLength,
      moderation: null,
      ...(actual ? { actual } : {}),
    },
  });
}

async function generateOpenAiVoice(
  text: string,
  spec: Extract<SubmittableSpec, { kind: "tts" }>,
): Promise<
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; requestId: string }
  | { ok: false; code: string; blocked: boolean }
> {
  const key = requireEnvMedia("OPENAI_API_KEY");
  if (process.env.MEDIA_PROVIDER_FIXTURE || process.env.FAL_FIXTURE) {
    return {
      ok: true,
      bytes: new Uint8Array(new ArrayBuffer(44)),
      requestId: `fixture-${crypto.randomUUID()}`,
    };
  }
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildSubmitBody(spec, text)),
    });
  } catch {
    return { ok: false, code: "transport_error", blocked: false };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: await providerReasonCode(response),
      blocked: response.status === 400 || response.status === 422,
    };
  }
  return {
    ok: true,
    bytes: new Uint8Array(await response.arrayBuffer()),
    requestId: response.headers.get("x-request-id") ?? `openai-${crypto.randomUUID()}`,
  };
}

/** Poll one Alibaba Wan task; result URLs expire after 24 h, so successful bytes are stored here. */
export const pollWanTask = internalAction({
  args: { jobId: v.id("mediaJobs"), taskId: v.string(), attempt: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const key = requireEnvMedia("Video_and_image_API_Key");
    const baseUrl = wanBaseUrl();
    const row = await ctx.runQuery(internal.media.jobForPoll, { jobId: a.jobId });
    if (!row || row.status !== "submitted") return null;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(a.taskId)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch {
      if (a.attempt < 60) {
        await ctx.scheduler.runAfter(10_000, internal.media.pollWanTask, {
          ...a,
          attempt: a.attempt + 1,
        });
        return null;
      }
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "poll_transport_error" },
      });
      return null;
    }
    if (!response.ok) {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: await providerReasonCode(response) },
      });
      return null;
    }
    const body = (await response.json().catch(() => null)) as {
      output?: {
        task_status?: unknown;
        code?: unknown;
        video_url?: unknown;
        results?: Array<{ url?: unknown }>;
      };
      usage?: { duration?: unknown; SR?: unknown };
    } | null;
    const status = body?.output?.task_status;
    if (status === "PENDING" || status === "RUNNING") {
      if (a.attempt >= 60) {
        await ctx.runMutation(internal.mediaComplete.landResult, {
          jobId: a.jobId,
          outcome: { ok: false, code: "poll_timeout" },
        });
      } else {
        await ctx.scheduler.runAfter(10_000, internal.media.pollWanTask, {
          ...a,
          attempt: a.attempt + 1,
        });
      }
      return null;
    }
    if (status !== "SUCCEEDED") {
      const candidate = body?.output?.code;
      const code =
        typeof candidate === "string" && SAFE_CODE.test(candidate) ? candidate : "provider_failed";
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code },
      });
      return null;
    }
    const rawUrl = row.kind === "video" ? body?.output?.video_url : body?.output?.results?.[0]?.url;
    if (typeof rawUrl !== "string") {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "asset_url_missing" },
      });
      return null;
    }
    let assetUrl: URL;
    try {
      assetUrl = new URL(rawUrl);
    } catch {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "asset_url_invalid" },
      });
      return null;
    }
    if (assetUrl.protocol !== "https:" || !assetUrl.hostname.endsWith(".aliyuncs.com")) {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "asset_host_refused" },
      });
      return null;
    }
    let asset: Response;
    try {
      asset = await fetch(assetUrl);
    } catch {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "asset_transport_error" },
      });
      return null;
    }
    if (!asset.ok) {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: `asset_http_${asset.status}` },
      });
      return null;
    }
    const bytes = new Uint8Array(await asset.arrayBuffer());
    const actual =
      row.spec.kind === "video"
        ? {
            resolution:
              typeof body?.usage?.SR === "number" ? `${body.usage.SR}p` : row.spec.resolution,
            seconds:
              typeof body?.usage?.duration === "number" ? body.usage.duration : row.spec.seconds,
          }
        : row.spec.kind === "image"
          ? { width: row.spec.width, height: row.spec.height }
          : undefined;
    await storeAndLand(
      ctx,
      a.jobId,
      bytes,
      asset.headers.get("content-type") ?? (row.kind === "video" ? "video/mp4" : "image/png"),
      actual,
    );
    return null;
  },
});

/** Poll one OpenAI Sora job and copy the completed MP4 into tenant storage. The content endpoint
 *  is called immediately after completion because provider-side job assets are not our durable
 *  workspace artifact. */
export const pollOpenAiVideoTask = internalAction({
  args: { jobId: v.id("mediaJobs"), videoId: v.string(), attempt: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const key = requireEnvMedia("OPENAI_API_KEY");
    const row = await ctx.runQuery(internal.media.jobForPoll, { jobId: a.jobId });
    if (!row || row.status !== "submitted" || row.spec.kind !== "video") return null;

    let response: Response;
    try {
      response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(a.videoId)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch {
      if (a.attempt < 180) {
        await ctx.scheduler.runAfter(10_000, internal.media.pollOpenAiVideoTask, {
          ...a,
          attempt: a.attempt + 1,
        });
        return null;
      }
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "poll_transport_error" },
      });
      return null;
    }
    if (!response.ok) {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: await providerReasonCode(response) },
      });
      return null;
    }
    const body = (await response.json().catch(() => null)) as {
      status?: unknown;
      error?: { code?: unknown };
    } | null;
    const status = body?.status;
    if (status === "queued" || status === "in_progress") {
      if (a.attempt >= 180) {
        await ctx.runMutation(internal.mediaComplete.landResult, {
          jobId: a.jobId,
          outcome: { ok: false, code: "poll_timeout" },
        });
      } else {
        await ctx.scheduler.runAfter(10_000, internal.media.pollOpenAiVideoTask, {
          ...a,
          attempt: a.attempt + 1,
        });
      }
      return null;
    }
    if (status !== "completed") {
      const candidate = body?.error?.code;
      const code =
        typeof candidate === "string" && SAFE_CODE.test(candidate) ? candidate : "provider_failed";
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code },
      });
      return null;
    }

    let asset: Response;
    try {
      asset = await fetch(
        `https://api.openai.com/v1/videos/${encodeURIComponent(a.videoId)}/content`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
    } catch {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: "asset_transport_error" },
      });
      return null;
    }
    if (!asset.ok) {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code: `asset_http_${asset.status}` },
      });
      return null;
    }
    await storeAndLand(
      ctx,
      a.jobId,
      new Uint8Array(await asset.arrayBuffer()),
      asset.headers.get("content-type") ?? "video/mp4",
      { resolution: row.spec.resolution, seconds: row.spec.seconds },
    );
    return null;
  },
});

/**
 * Submit a whole reserved batch. Idempotent per line, and it NEVER waits.
 *
 * Provider credentials are checked by the matching adapter before its network request.
 */
export const submitBatch = internalAction({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<{ submitted: number; blocked: number; failed: number; skipped: number }> => {
    const { lines, shots, imagePrompt } = await ctx.runQuery(internal.media.batchToSubmit, a);
    const tally = { submitted: 0, blocked: 0, failed: 0, skipped: 0 };

    for (const line of lines) {
      // A kind this plan does not wire is left AT `queued` and never claimed, so 20-14 and 20-17
      // pick their rows up untouched. Checking BEFORE the claim is what keeps that true.
      const spec = toSubmittable(line);
      if (!spec) {
        tally.skipped += 1;
        continue;
      }

      if (!(await ctx.runMutation(internal.media.claimLine, { jobId: line.jobId }))) {
        tally.skipped += 1; // already submitted/succeeded/failed/blocked — a retry costs nothing
        continue;
      }

      // The content plane, by kind: a video/image line submits the block's PROMPT, a `tts` line its
      // NARRATION. The text goes to its provider and to nothing else — never an audit row, never a
      // log, never onto the job row (only its `promptHash` lives there).
      const shot = shots.find((s) => s.index === line.blockIndex);
      const text =
        spec.kind === "image" && imagePrompt ? imagePrompt : shot && SUBMIT_TEXT[spec.kind]?.(shot);
      if (text === undefined) {
        await ctx.runMutation(internal.media.recordSubmission, {
          jobId: line.jobId,
          result: { ok: false, blocked: false, code: "missing_shot" },
        });
        tally.failed += 1;
        continue;
      }

      if (spec.kind === "tts") {
        const voice = await generateOpenAiVoice(text, spec);
        if (!voice.ok) {
          await ctx.runMutation(internal.media.recordSubmission, {
            jobId: line.jobId,
            result: { ok: false, blocked: voice.blocked, code: voice.code },
          });
          if (voice.blocked) tally.blocked += 1;
          else tally.failed += 1;
          continue;
        }
        await ctx.runMutation(internal.media.recordSubmission, {
          jobId: line.jobId,
          result: { ok: true, providerRequestId: voice.requestId },
        });
        await storeAndLand(ctx, line.jobId, voice.bytes, "audio/wav");
        tally.submitted += 1;
        continue;
      }
      const res = await submitLine(spec, text);
      if (!res.ok) {
        await ctx.runMutation(internal.media.recordSubmission, {
          jobId: line.jobId,
          result: { ok: false, blocked: res.blocked, code: res.code },
        });
        if (res.blocked) tally.blocked += 1;
        else tally.failed += 1;
        continue;
      }
      await ctx.runMutation(internal.media.recordSubmission, {
        jobId: line.jobId,
        result: { ok: true, providerRequestId: res.requestId },
      });
      if (spec.kind === "image") {
        if (!res.asset) {
          await ctx.runMutation(internal.mediaComplete.landResult, {
            jobId: line.jobId,
            outcome: { ok: false, code: "asset_missing" },
          });
          tally.failed += 1;
          continue;
        }
        await storeAndLand(ctx, line.jobId, res.asset.bytes, res.asset.mimeType, {
          width: spec.width,
          height: spec.height,
        });
      } else {
        await ctx.scheduler.runAfter(10_000, internal.media.pollOpenAiVideoTask, {
          jobId: line.jobId,
          videoId: res.requestId,
          attempt: 0,
        });
      }
      tally.submitted += 1;
    }
    return tally;
  },
});

// ── The CAPTIONS submit (plan 20-17) ───────────────────────────────────────────────────────────
//
// The one media line whose INPUT is another line's OUTPUT: the transcript is taken from the clean
// voice takes this same batch just produced. That is why it is not in `submitBatch` — at submit
// time the audio does not exist yet.
//
// ONE request for the whole reel, not one per take. That is not a choice this plan gets to make
// freely: `reserveJobInner` already creates exactly ONE `stt` line at `blockIndex: -1`, priced at
// the whole deck's audio minutes. N requests would spend one reservation N times.
//
// **Captions are timed on the CLEAN takes, never the mixed bed.** The upstream in-assembler Whisper
// path was removed on 2026-07-29 for transcribing music and SFX under the speech and swallowing
// words, and D8 forbids re-merging assembly and captions. So this reads the tts assets, NOT
// `final.mp4` — which is also why it does not wait for the render and the render does not wait for
// it.

/** The ceiling on the concatenated takes, before base64. A 6x10s reel at the pinned 24 kHz mono
 *  16-bit is ~2.9 MB, so this is ~2x headroom — and a refusal here is a governed stop with a code,
 *  never a 413 discovered after the reservation was spent. */
export const MAX_STT_AUDIO_BYTES = 6 * 1024 * 1024;

/** Everything the captions submit needs, read through the tenant-prefixed index. */
export const captionsToSubmit = internalQuery({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<{
    sttJobId: Id<"mediaJobs">;
    planId: Id<"plans">;
    model: string;
    takes: Array<{ blockIndex: number; storageId: Id<"_storage"> }>;
  } | null> => {
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_batch", (q) => q.eq("tenantId", a.tenantId).eq("batchId", a.batchId))
      .collect();
    const stt = rows.find((r) => r.kind === "stt");
    if (!stt) return null; // captions were not reserved for this deck — nothing to do, not an error
    const takes = rows
      .filter((r) => r.kind === "tts" && r.status === "succeeded" && r.assetStorageId !== undefined)
      .sort((l, r) => l.blockIndex - r.blockIndex)
      .map((r) => ({ blockIndex: r.blockIndex, storageId: r.assetStorageId as Id<"_storage"> }));
    if (takes.length === 0) return null;
    return { sttJobId: stt._id, planId: stt.planId, model: stt.model, takes };
  },
});

/** The take offsets onto the plan row, in the SAME mutation that records the submission — they are
 *  two halves of one fact ("this is the audio that was sent"), and a transcript whose offsets were
 *  never written is a transcript that cannot be rebased. */
export const recordCaptionSubmission = internalMutation({
  args: {
    planId: v.id("plans"),
    jobId: v.id("mediaJobs"),
    offsetsS: v.array(v.number()),
    result: v.union(
      v.object({ ok: v.literal(true), providerRequestId: v.string() }),
      v.object({ ok: v.literal(false), blocked: v.boolean(), code: v.string() }),
    ),
  },
  handler: async (ctx, a): Promise<null> => {
    const updatedAt = Date.now();
    if (a.result.ok) {
      await ctx.db.patch(a.planId, { captionOffsetsS: a.offsetsS });
      await ctx.db.patch(a.jobId, { providerRequestId: a.result.providerRequestId, updatedAt });
      return null;
    }
    // A caption failure NEVER touches `renderStatus` — the uncaptioned reel stays published.
    await ctx.db.patch(a.planId, { captionStatus: "failed", captionReason: a.result.code });
    await ctx.db.patch(a.jobId, {
      status: a.result.blocked ? "blocked" : "failed",
      ...(a.result.blocked ? { verdict: "provider_blocked" as const } : {}),
      failureReason: a.result.code,
      updatedAt,
    });
    return null;
  },
});

/**
 * Submit the reel's ONE captions line: concatenate the clean takes, transcribe them, return.
 *
 * Scheduled from `mediaComplete.maybeStartCaptions` the moment the last voice take lands — in
 * PARALLEL with the render, because a transcript needs the takes and the sidecar's anchors, never
 * `final.mp4`.
 */
export const submitCaptions = internalAction({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; code?: string }> => {
    // Refuse before reading tenant audio when the existing OpenAI credential is absent.
    const key = requireEnvMedia("OPENAI_API_KEY");

    const job = await ctx.runQuery(internal.media.captionsToSubmit, a);
    if (!job) return { ok: false, code: "no_captions_line" };
    // The same idempotency gate every other line goes through: `queued → submitted` in a
    // serializable mutation, so a retried action cannot re-POST a line that is already in flight.
    if (!(await ctx.runMutation(internal.media.claimLine, { jobId: job.sttJobId }))) {
      return { ok: false, code: "already_claimed" };
    }

    const takes: Uint8Array[] = [];
    for (const take of job.takes) {
      const blob = await ctx.storage.get(take.storageId);
      if (!blob) {
        await ctx.runMutation(internal.media.recordCaptionSubmission, {
          planId: job.planId,
          jobId: job.sttJobId,
          offsetsS: [],
          result: { ok: false, blocked: false, code: "take_missing" },
        });
        return { ok: false, code: "take_missing" };
      }
      takes.push(new Uint8Array(await blob.arrayBuffer()));
    }

    const joined = concatWavTakes(takes);
    const fail = async (code: string) => {
      await ctx.runMutation(internal.media.recordCaptionSubmission, {
        planId: job.planId,
        jobId: job.sttJobId,
        offsetsS: [],
        result: { ok: false, blocked: false, code },
      });
      return { ok: false, code };
    };
    if (!joined.ok) return await fail(joined.error.code);
    if (joined.value.wav.byteLength > MAX_STT_AUDIO_BYTES) return await fail("audio_too_large");

    const form = new FormData();
    const wav = new Uint8Array(joined.value.wav.byteLength);
    wav.set(joined.value.wav);
    form.append("file", new Blob([wav], { type: "audio/wav" }), "reel-voice.wav");
    form.append("model", job.model.replace(/^openai\//, ""));
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
    } catch {
      return await fail("transport_error");
    }
    if (!response.ok) return await fail(await providerReasonCode(response));
    const body = (await response.json().catch(() => null)) as {
      words?: Array<{ word?: unknown; start?: unknown; end?: unknown }>;
    } | null;
    if (!Array.isArray(body?.words)) return await fail("transcript_words_missing");
    const words = body.words.flatMap((word) =>
      typeof word.word === "string" &&
      typeof word.start === "number" &&
      typeof word.end === "number"
        ? [{ text: word.word, start: word.start, end: word.end, type: "word" }]
        : [],
    );
    if (words.length === 0) return await fail("transcript_words_missing");
    const requestId = response.headers.get("x-request-id") ?? `openai-${crypto.randomUUID()}`;
    await ctx.runMutation(internal.media.recordCaptionSubmission, {
      planId: job.planId,
      jobId: job.sttJobId,
      offsetsS: joined.value.offsetsS,
      result: { ok: true, providerRequestId: requestId },
    });
    const transcript = new TextEncoder().encode(JSON.stringify({ words }));
    await storeAndLand(ctx, job.sttJobId, transcript, "application/json");
    return { ok: true };
  },
});

// ── The CANVAS plane (plan 20-09) ──────────────────────────────────────────────────────────────
//
// What the canvas reads, what it may spend, and what it may edit for free.
//
// D7's binding rule — *"the editor must not offer a control that can spend money without showing
// the estimate first"* — is a BACKEND requirement before it is a UI one, which is why `jobEstimate`
// lives here and itemises. A UI that computed its own total and a rail that computed another is
// exactly the drift this phase exists to prevent, so `jobEstimate` builds the SAME spec list
// `reserveJobInner` builds, from the SAME price table, and a test asserts the two numbers are equal
// rather than eyeballing them.
//
// CLAUDE.md §2: every function below is a `tenantQuery`/`tenantMutation` from `lib/functions.ts`.
// READS return `[]`/null for a foreign tenant; WRITES throw (`cockpit.ts:531`'s rule).

/** The owning plan, or null when the caller is not its tenant. ONE guard, so a new canvas function
 *  cannot accidentally ship without it. */
async function ownedPlan(
  ctx: QueryCtx,
  planId: Id<"plans">,
  tenantId: string,
): Promise<Doc<"plans"> | null> {
  const plan = await ctx.db.get(planId);
  return plan && plan.tenantId === tenantId ? plan : null;
}

/** The write-side face of the same guard. Writes THROW where reads return empty — the
 *  `cockpit.ts:531` no-cross-tenant rule, verbatim, including the message. */
async function ownedPlanOrThrow(
  ctx: MutationCtx,
  planId: Id<"plans">,
  tenantId: string,
): Promise<Doc<"plans">> {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.tenantId !== tenantId) throw new Error("plan not found");
  return plan;
}

/**
 * CLEAR THE RENDER. **One helper, six callers**, and that is deliberate: six copies of a four-field
 * unset is exactly how one of them ends up missing a field, and the guarantee it enforces — a
 * canvas can never show a stale `final.mp4` beside a block that has since changed — is the kind of
 * lie a user would only discover by watching the whole reel.
 *
 * Convex unsets a field by patching it to `undefined`.
 */
async function clearRender(ctx: MutationCtx, planId: Id<"plans">): Promise<void> {
  await ctx.db.patch(planId, {
    renderStatus: "pending",
    renderStorageId: undefined,
    sidecarStorageId: undefined,
    sidecarHash: undefined,
    renderReason: undefined,
    renderedAt: undefined,
    // Added when `renderSummary` was — and the test for this helper caught its absence, which is
    // the exact "six copies, one of them missing a field" failure the helper exists to prevent.
    renderSummary: undefined,
  });
}

/** The deck as `reserveJobInner` wants it, or null when the plan carries nothing reservable. The
 *  `cockpit.ts:668` boundary check verbatim — a money gate does not assume its writer was correct. */
function deckOf(plan: Doc<"plans">): readonly Block[] | null {
  const shots = plan.shots ?? [];
  if (shots.length === 0 || plan.clipSeconds === undefined) return null;
  if (!shots.every((s) => (SHOT_TYPES as readonly string[]).includes(s.type))) return null;
  return shots.map((s) => ({ ...s, type: s.type as ShotType }));
}

/** One `mediaJobs` row reduced to what a tile shows. NO url — that is `assetUrls`' job alone. */
type JobFace = {
  status: string;
  verdict: string | null;
  model: string;
  estUsd: number;
  actualCents: number | null;
};

const faceOf = (row: Doc<"mediaJobs"> | undefined): JobFace | null =>
  row
    ? {
        status: row.status,
        verdict: row.verdict ?? null,
        model: row.model,
        estUsd: row.estUsd,
        actualCents: row.actualCents ?? null,
      }
    : null;

/**
 * One entry PER BLOCK, carrying TWO INDEPENDENT STATES.
 *
 * A block whose voice has landed but whose clip has not must be distinguishable from one where the
 * reverse is true — a single merged status cannot express that, and the two arrive minutes apart
 * through two different providers' webhooks. The tile shows both.
 *
 * No URL here by construction: `assetUrls` is the only read that mints a bearer capability, and a
 * query that mints one should be the smallest possible surface.
 */
export const byPlan = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (!plan) return [];

    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", ctx.tenantId).eq("planId", planId))
      .collect();

    const maxChars =
      plan.clipSeconds === undefined ? MAX_CHARS_PER_BLOCK : maxCharsFor(plan.clipSeconds);
    return (plan.shots ?? []).map((shot) => {
      // The job's OWN blockIndex is authoritative, never the array position — see the reorder
      // ceiling on `reorderBlocks`.
      const mine = rows.filter((r) => r.blockIndex === shot.index);
      return {
        blockIndex: shot.index,
        type: shot.type,
        description: shot.description,
        overlay: shot.overlay ?? null,
        prompt: shot.prompt,
        narration: shot.narration,
        narrationChars: shot.narration.length,
        maxChars,
        overCharLimit: shot.narration.length > maxChars,
        clip: faceOf(mine.find((r) => r.kind === "video")),
        voice: faceOf(mine.find((r) => r.kind === "tts")),
      };
    });
  },
});

/**
 * The per-asset signed URLs.
 *
 * **A storage URL is a BEARER CAPABILITY**, so it is ONLY ever returned from this tenant-guarded
 * query and NEVER logged (CLAUDE.md §4) — `plans.attachmentUrls`' header comment, carried across
 * because the rule is the reason this query exists. A caller whose identity ≠ `plan.tenantId` gets
 * an empty array, never another tenant's signed URL.
 *
 * A line with no asset yet yields a NULL url rather than an omitted row: the canvas needs to render
 * a pending tile, and an absent row and a pending one are different things.
 */
export const assetUrls = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (!plan) return [];

    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", ctx.tenantId).eq("planId", planId))
      .collect();

    return await Promise.all(
      rows
        .sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime)
        .map(async (r) => ({
          blockIndex: r.blockIndex,
          kind: r.kind,
          mimeType: r.mimeType ?? null,
          status: r.status,
          verdict: r.verdict ?? null,
          failureReason: r.failureReason ?? null,
          createdAt: r.createdAt,
          url: r.assetStorageId ? await ctx.storage.getUrl(r.assetStorageId) : null,
        })),
    );
  },
});

/**
 * The finished reel.
 *
 * **A `url` is non-null ONLY when the sidecar validated.** That is the guarantee this query exists
 * to make: D8's rule is *"a final video without an assembly.json was hand-assembled"*, so a render
 * that produced no valid governance record produces no reel here either — even if
 * `renderStorageId` is set.
 *
 * `gates` and `durationS` come back as DATA, not prose. The wording lives in the canvas (20-10),
 * because BRAND copy is a UI concern; what lives here is the guarantee about the url.
 */
export const reel = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const empty = {
      status: null as string | null,
      url: null as string | null,
      durationS: null as number | null,
      blockCount: null as number | null,
      gates: [] as string[],
      reason: null as string | null,
    };
    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (!plan) return empty;

    const base = { ...empty, status: plan.renderStatus ?? null, reason: plan.renderReason ?? null };

    // **THE URL GUARANTEE, and where it actually comes from.** `renderSummary` is written by
    // `recordRender` ONLY on the success arm, in the same patch as the two storage ids, and ONLY
    // after `parseAssemblySidecar` accepted the bytes that landed in our storage. So requiring all
    // four here is requiring the sidecar to have validated — the check is at the WRITE, which is
    // the only place it can be, because `ctx.storage` in a query is a `StorageReader` with `getUrl`
    // and no way to read a blob at all.
    if (
      plan.renderStatus !== "rendered" ||
      !plan.renderStorageId ||
      !plan.sidecarStorageId ||
      !plan.renderSummary
    ) {
      return base;
    }

    return {
      ...base,
      url: await ctx.storage.getUrl(plan.renderStorageId),
      durationS: plan.renderSummary.durationS,
      blockCount: plan.renderSummary.blockCount,
      gates: [...plan.renderSummary.gates],
    };
  },
});

/** One itemised cost line, as the canvas prints it. */
type EstimateLine = { label: string; qty: number; unit: string; cents: number };

/**
 * THE ITEMISED ESTIMATE — four labelled lines, not one total.
 *
 * D7 says the estimate must be on screen before the button is clickable; the re-scope makes that a
 * harder requirement, because the thing being bought is no longer "N clips" but a reel with four
 * cost lines. **A single total is not enough: the user must be able to see WHICH line is the
 * expensive one before deciding to cut a block.**
 *
 * It reuses `chooseMediaBatch` and builds the SAME spec list `reserveJobInner` builds — including
 * the 2× voice multiplier and the flat render constant — so the number on screen and the number
 * the rail consumes cannot drift. `media.test.ts` asserts they are equal for the same deck.
 *
 * **This query consumes NOTHING.** It is a query and cannot.
 */
export const jobEstimate = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (
    ctx,
    { planId },
  ): Promise<{
    lines: EstimateLine[];
    totalCents: number;
    capCents: number;
    remainingCents: number;
    refusal: { reason: ReserveRefusal; blockIndex?: number; chars?: number } | null;
  }> => {
    const capCents = Math.round(MEDIA_JOB_CAP_USD * 100);
    const remainingCents = await mediaRemainingCentsInner(ctx, ctx.tenantId);
    const empty = { lines: [], totalCents: 0, capCents, remainingCents, refusal: null };

    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (!plan) return empty;
    const blocks = deckOf(plan);
    const clipSeconds = plan.clipSeconds;
    if (!blocks || clipSeconds === undefined) return empty;

    // The SAME pre-flight refusals `reserveJobInner` applies, in the same order, so the canvas can
    // name the lever BEFORE the button is pressed rather than after.
    if (!CLIP_SECONDS_SET.has(clipSeconds)) {
      return { ...empty, refusal: { reason: "illegal_duration" } };
    }
    for (const b of blocks) {
      if (!isPaidBlock(b)) {
        return { ...empty, refusal: { reason: "unrenderable_block", blockIndex: b.index } };
      }
      if (b.narration.length > maxCharsFor(clipSeconds)) {
        return {
          ...empty,
          refusal: {
            reason: "narration_too_long",
            blockIndex: b.index,
            chars: b.narration.length,
          },
        };
      }
      if (b.narration.length < minCharsFor(clipSeconds)) {
        return {
          ...empty,
          refusal: {
            reason: "narration_too_short",
            blockIndex: b.index,
            chars: b.narration.length,
          },
        };
      }
    }

    const specs: MediaSpec[] = [];
    let clipCount = 0;
    let voiceChars = 0;
    for (const b of blocks) {
      if (isPaidBlock(b)) {
        clipCount += 1;
        specs.push({
          kind: "video",
          model: MEDIA_DEFAULT_VIDEO.model,
          resolution: MEDIA_DEFAULT_VIDEO.resolution,
          seconds: clipSeconds,
        });
      }
      const characters = b.narration.length * 2; // the 2x rewrite allowance, as reserved
      voiceChars += characters;
      specs.push({ kind: "tts", model: MEDIA_DEFAULT_VOICE.model, characters });
    }
    const audioMinutes = (blocks.length * clipSeconds) / 60;
    specs.push({ kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes });
    specs.push({ kind: "render" });

    const priced = chooseMediaBatch(specs, MEDIA_JOB_CAP_USD);
    if (!priced.ok) return { ...empty, refusal: { reason: priced.error.code } };

    /** A line's own subtotal, rounded ONCE for display. The authoritative number is `totalCents`
     *  (the batch total, rounded once by `chooseMediaBatch`), so the four lines may differ from it
     *  by a cent — the canvas prints the total, not the sum of the lines. */
    const subtotal = (of: MediaSpec[]): number =>
      Math.round(
        of.reduce((n, s) => {
          const p = estimateMediaUsd(s);
          return n + (p.ok ? p.value : 0);
        }, 0) * 100,
      );

    const lines: EstimateLine[] = [
      {
        label: "clips",
        qty: clipCount,
        unit: `${clipSeconds}s ${MEDIA_DEFAULT_VIDEO.resolution}`,
        cents: subtotal(specs.filter((s) => s.kind === "video")),
      },
      {
        label: "voice",
        qty: blocks.length,
        unit: `${voiceChars} chars`,
        cents: subtotal(specs.filter((s) => s.kind === "tts")),
      },
      {
        label: "captions",
        qty: 1,
        unit: `${audioMinutes.toFixed(2)} min`,
        cents: subtotal(specs.filter((s) => s.kind === "stt")),
      },
      {
        label: "render",
        qty: 1,
        unit: "sandbox",
        cents: subtotal(specs.filter((s) => s.kind === "render")),
      },
    ];

    return { lines, totalCents: priced.value.estCents, capCents, remainingCents, refusal: null };
  },
});

/** The standalone image estimate. It builds the exact pinned spec consumed by
 * `reserveImageInner`, consumes nothing, and exposes the shared media-window remainder. */
export const imageEstimate = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const capCents = Math.round(MEDIA_JOB_CAP_USD * 100);
    const remainingCents = await mediaRemainingCentsInner(ctx, ctx.tenantId);
    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (plan?.mediaMode !== "image" || !plan.imagePrompt) {
      return {
        model: MEDIA_DEFAULT_IMAGE.model,
        width: MEDIA_DEFAULT_IMAGE.width,
        height: MEDIA_DEFAULT_IMAGE.height,
        totalCents: 0,
        capCents,
        remainingCents,
        refusal: "no_image_plan" as const,
      };
    }
    const priced = chooseMediaBatch([standaloneImageSpec()], MEDIA_JOB_CAP_USD);
    if (!priced.ok) {
      return {
        model: MEDIA_DEFAULT_IMAGE.model,
        width: MEDIA_DEFAULT_IMAGE.width,
        height: MEDIA_DEFAULT_IMAGE.height,
        totalCents: 0,
        capCents,
        remainingCents,
        refusal: priced.error.code,
      };
    }
    return {
      model: MEDIA_DEFAULT_IMAGE.model,
      width: MEDIA_DEFAULT_IMAGE.width,
      height: MEDIA_DEFAULT_IMAGE.height,
      totalCents: priced.value.estCents,
      capCents,
      remainingCents,
      refusal: null,
    };
  },
});

/** Reserve + schedule, shared by the two paid entry points. Returns the governed refusal rather
 *  than throwing — a refusal is an answer, not an error. */
async function reserveAndSchedule(
  ctx: MutationCtx,
  a: { tenantId: string; planId: Id<"plans">; blocks: readonly Block[]; clipSeconds: number },
): Promise<
  { ok: true; batchId: string; estCents: number } | { ok: false; reason: ReserveRefusal }
> {
  const reserved = await reserveJobInner(ctx, {
    tenantId: a.tenantId,
    planId: a.planId,
    blocks: a.blocks,
    clipSeconds: a.clipSeconds,
    // PINNED true, the `cockpit.ts:681` reasoning verbatim: the fail-closed direction is
    // over-reserving, and an unused STT line costs $0.008 while an unreserved one that IS used is
    // spend outside the rail.
    withCaptions: true,
  });
  if (!reserved.ok) return { ok: false, reason: reserved.reason }; // nothing scheduled, zero rows

  // The render-clear rides in the SAME mutation as the reservation, so there is no scheduler tick
  // during which a published reel coexists with the blocks that have just been re-bought.
  await clearRender(ctx, a.planId);
  await ctx.scheduler.runAfter(0, internal.media.submitBatch, {
    tenantId: a.tenantId,
    batchId: reserved.batchId,
  });
  return { ok: true, batchId: reserved.batchId, estCents: reserved.estCents };
}

/** Generate the WHOLE reel — the canvas's paid entry point, through the identical money gate the
 *  approve arm uses. No second rail, no second cap, no bypass. */
export const generateReel = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const blocks = deckOf(plan);
    if (!blocks || plan.clipSeconds === undefined) return { ok: false as const, reason: "no_deck" };
    return await reserveAndSchedule(ctx, {
      tenantId: ctx.tenantId,
      planId,
      blocks,
      clipSeconds: plan.clipSeconds,
    });
  },
});

/** Generate one reviewed still image. The serializable active/successful-row check is the
 * server-side double-click guard. A terminal failed/blocked attempt may be retried by a fresh
 * human click; its immutable row remains as history and the retry receives a new reservation. */
export const generateImage = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const prompt = plan.mediaMode === "image" ? plan.imagePrompt?.trim() : undefined;
    if (!prompt) return { ok: false as const, reason: "no_image_plan" as const };
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", ctx.tenantId).eq("planId", planId))
      .collect();
    if (
      rows.some(
        (row) =>
          row.kind === "image" &&
          (row.status === "queued" || row.status === "submitted" || row.status === "succeeded"),
      )
    ) {
      return { ok: false as const, reason: "already_started" as const };
    }
    const reserved = await reserveImageInner(ctx, { tenantId: ctx.tenantId, planId, prompt });
    if (!reserved.ok) return { ok: false as const, reason: reserved.reason };
    await ctx.scheduler.runAfter(0, internal.media.submitBatch, {
      tenantId: ctx.tenantId,
      batchId: reserved.batchId,
    });
    return { ok: true as const, batchId: reserved.batchId, estCents: reserved.estCents };
  },
});

/**
 * Regenerate ONE block.
 *
 * **A job of one block — clip, voice and render.** No second rail, no second cap, no bypass: the
 * job cap and the daily window are the same two numbers whether the reel is 1 block or 6. And it
 * reserves a RENDER, because a changed block means the published mp4 is stale and the reel must be
 * assembled again — a regenerate that skipped the render line would be cheaper and wrong.
 *
 * The previous rows and their stored assets are LEFT ALONE. This is history, not mutation.
 */
export const regenerateBlock = tenantMutation({
  args: { planId: v.id("plans"), blockIndex: v.number() },
  handler: async (ctx, { planId, blockIndex }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const blocks = deckOf(plan);
    if (!blocks || plan.clipSeconds === undefined) return { ok: false as const, reason: "no_deck" };
    const one = blocks.find((b) => b.index === blockIndex);
    if (!one) return { ok: false as const, reason: "no_deck" };
    return await reserveAndSchedule(ctx, {
      tenantId: ctx.tenantId,
      planId,
      blocks: [one],
      clipSeconds: plan.clipSeconds,
    });
  },
});

// ── The FREE editor. Five affordances, and that is D7's floor AND its ceiling ──────────────────
//
// Edit a prompt, edit a narration line, regenerate one block, reorder, delete. **Nothing else.** No
// timeline, transitions, filters, layers, masking, music, or client-side rendering. If a reviewer
// asks for one, it is a deferred idea and not a small addition.
//
// None of these touches `mediaJobs` or any budget window. All of them CLEAR THE RENDER, through the
// one shared helper: a reel assembled from a different block order — or from a line that has since
// been rewritten — is not the reel on screen.

/** Patch one element of `plans.shots`, renumber, and clear the render. The single write path the
 *  five editor mutations share. */
async function patchShots(
  ctx: MutationCtx,
  planId: Id<"plans">,
  plan: Doc<"plans">,
  next: NonNullable<Doc<"plans">["shots"]>,
): Promise<void> {
  const clipMs = (plan.clipSeconds ?? 0) * 1000;
  await ctx.db.patch(planId, {
    shots: next.map((s, i) => ({ ...s, index: i, windowStartMs: i * clipMs })),
  });
  await clearRender(ctx, planId);
}

export const editBlockPrompt = tenantMutation({
  args: { planId: v.id("plans"), blockIndex: v.number(), prompt: v.string() },
  handler: async (ctx, { planId, blockIndex, prompt }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const shots = plan.shots ?? [];
    if (!shots.some((s) => s.index === blockIndex))
      return { ok: false as const, reason: "no_block" };
    await patchShots(
      ctx,
      planId,
      plan,
      shots.map((s) => (s.index === blockIndex ? { ...s, prompt } : s)),
    );
    return { ok: true as const };
  },
});

/**
 * Edit the block's SPOKEN line.
 *
 * **This is the UI half of the pre-payment guard, not scope creep.** `reserveJobInner` refuses a
 * deck whose narration falls outside the band — and without this mutation that refusal has no cure:
 * a user told *"block 4's line is 186 characters"* with no way to shorten it is stuck.
 *
 * It refuses an over-length line with the SAME reason and the SAME count the rail would return, so
 * the two never disagree about what is too long.
 */
export const editBlockNarration = tenantMutation({
  args: { planId: v.id("plans"), blockIndex: v.number(), narration: v.string() },
  handler: async (ctx, { planId, blockIndex, narration }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const shots = plan.shots ?? [];
    if (!shots.some((s) => s.index === blockIndex))
      return { ok: false as const, reason: "no_block" };

    const maxChars =
      plan.clipSeconds === undefined ? MAX_CHARS_PER_BLOCK : maxCharsFor(plan.clipSeconds);
    if (narration.length > maxChars) {
      return {
        ok: false as const,
        reason: "narration_too_long",
        chars: narration.length,
        maxChars,
      };
    }
    await patchShots(
      ctx,
      planId,
      plan,
      shots.map((s) => (s.index === blockIndex ? { ...s, narration } : s)),
    );
    return { ok: true as const };
  },
});

/**
 * Permute the deck.
 *
 * ponytail: a reorder after submit leaves in-flight jobs pointing at their ORIGINAL index —
 * `mediaJobs.blockIndex` is a snapshot taken at reserve time, and `byPlan` renders a job under the
 * block it was reserved for. That is deliberate: the alternative is re-pointing a landed asset at a
 * different block's tile, which is worse. Upgrade path if it ever confuses anyone: a stable
 * per-block id instead of an array index — a schema change, not a UI one.
 */
export const reorderBlocks = tenantMutation({
  args: { planId: v.id("plans"), order: v.array(v.number()) },
  handler: async (ctx, { planId, order }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const shots = plan.shots ?? [];

    // A PERMUTATION of the existing indices, or nothing. Anything else would silently drop or
    // duplicate a block, and a deck with a hole hard-errors at the assembler.
    const existing = [...shots.map((s) => s.index)].sort((x, y) => x - y);
    const asked = [...order].sort((x, y) => x - y);
    if (
      order.length !== shots.length ||
      existing.some((v, i) => v !== asked[i]) ||
      new Set(order).size !== order.length
    ) {
      return { ok: false as const, reason: "not_a_permutation" };
    }

    const byIndex = new Map(shots.map((s) => [s.index, s]));
    const next = order.map((i) => byIndex.get(i)).filter((s) => s !== undefined);
    await patchShots(ctx, planId, plan, next);
    return { ok: true as const };
  },
});

export const deleteBlock = tenantMutation({
  args: { planId: v.id("plans"), blockIndex: v.number() },
  handler: async (ctx, { planId, blockIndex }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const shots = plan.shots ?? [];
    if (!shots.some((s) => s.index === blockIndex))
      return { ok: false as const, reason: "no_block" };
    if (shots.length === 1) return { ok: false as const, reason: "last_block" };
    await patchShots(
      ctx,
      planId,
      plan,
      shots.filter((s) => s.index !== blockIndex),
    );
    return { ok: true as const };
  },
});
