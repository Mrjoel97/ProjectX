/**
 * The media JOB reservation (MEDIA-01, D10) — the ONE money gate for Phase 20.
 *
 * A per-request cap bounds NOTHING when a reel is N clips PLUS N voice takes PLUS an STT pass PLUS
 * a render: six 480p x 10 s clips are six passing $0.50 requests and one $3.00 job. So the whole
 * JOB is estimated, capped and RESERVED in ONE serializable transaction, before a single fal
 * request exists.
 *
 * **This is the one place media DIVERGES from the LLM rail, deliberately.**
 * `guardrails.prepare` checks and `guardrails.recordSpend` consumes afterwards — safe there,
 * because LLM calls inside a turn are serial and an overshoot is cents. Here 13+ jobs are submitted
 * back-to-back and land minutes apart, so post-hoc recording would let all of them fire against a
 * window that had room for one. 20-PROVIDER-EVAL.md §4: *an LLM overshoot is cents, a media
 * overshoot is dollars.*
 *
 * Default runtime — NOT "use node". This module touches ctx.db; the later fal calls need only
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
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_JOB_CAP_USD,
} from "@pikar/cost/media";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { hmacHex } from "./gmailAuth";
import { getGuardrailConfig, mediaRemainingCentsInner, rateLimiter } from "./guardrails";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

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
  const base = { tenantId: a.tenantId, planId: a.planId, batchId, provider: "fal" as const };
  const lines: ProviderLine[] = [];

  for (const block of a.blocks) {
    // One video line per PAID block. `model` and `resolution` are PINNED from MEDIA_DEFAULT_VIDEO
    // and never left for fal to default — Wan 2.5 defaults to 1080p, so an estimate computed at
    // 480p against a submit that omitted the resolution under-reports by 3x.
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

  // 5. The cap, and the ONE flooring of cents (D12a). `chooseMediaBatch` floors the TOTAL exactly
  //    once, so `estCents` is the single number that moves both windows; the per-line `estUsd`
  //    values go onto the rows unfloored. Flooring per line would reserve 13 cents for a 13-line
  //    sub-cent job instead of 1.
  const est = chooseMediaBatch(specs, MEDIA_JOB_CAP_USD);
  if (!est.ok) return { ok: false, reason: est.error.code };
  const { estUsd, estCents } = est.value;

  // 6-8. CHECK BOTH, THEN CONSUME BOTH — in THIS mutation, which is ONE serializable transaction.
  // That is what makes the guarantee: two concurrent jobs cannot both pass a check against a window
  // neither has consumed. Splitting the check from the limit across an action boundary is the exact
  // defect this whole function exists to prevent. Tenant FIRST, so a tenant that is personally out
  // is told so rather than blamed for a global pause (the `guardrails.prepare` ordering, verbatim).
  const tenantWindow = await rateLimiter.check(ctx, "mediaSpendCents", {
    key: a.tenantId,
    count: estCents,
  });
  if (!tenantWindow.ok) return { ok: false, reason: "media_daily_exhausted" };
  const deploymentWindow = await rateLimiter.check(ctx, "deploymentMediaSpendCents", {
    count: estCents,
  });
  if (!deploymentWindow.ok) return { ok: false, reason: "deployment_media_exhausted" };

  // CONSUME NOW, before any POST exists.
  // ponytail: no refunds. If 3 of 6 blocks come back provider_blocked, the reserved cents stay
  // consumed. Over-reservation is the fail-closed bias, same as `Math.max(1, Math.ceil(...))`.
  // Refunding turns a rate-limiter window into a ledger; if drift ever proves material the upgrade
  // path is a real spend table, not a credit call.
  await rateLimiter.limit(ctx, "mediaSpendCents", {
    key: a.tenantId,
    count: estCents,
    reserve: true,
  });
  await rateLimiter.limit(ctx, "deploymentMediaSpendCents", { count: estCents, reserve: true });

  // 9. Only now do rows exist. Every refusal above returned with ZERO inserts — the transaction is
  //    all-or-nothing by construction, not by cleanup.
  for (const line of lines) await ctx.db.insert("mediaJobs", line.row);

  return { ok: true, batchId, estUsd, estCents, lineCount: lines.length };
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

// ── The fal SUBMIT adapter (plan 20-05) ────────────────────────────────────────────────
//
// Submit a reserved line to fal's QUEUE with a per-job authenticated webhook, and return. Nothing
// below this line waits for a clip: a 10 s Wan 2.5 render is 1–3 MINUTES of wall clock, and plan
// 20-06's webhook is what lands it.

/** The `gmailAuth.requireEnv` IDIOM with a media-worded message — a "Gmail OAuth env not
 *  configured" throw on a fal submit sends an operator to the wrong runbook. Both media secrets are
 *  DEPLOYMENT env vars (`npx convex env set`), never `.env.local`. */
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
  | (Extract<MediaSpec, { kind: "tts" }> & { voice: string; sampleRateHertz: number })
  // `audioUrl` is not a priced dimension either — `audioMinutes` is. It rides here for the same
  // reason `voice` does: it is a pinned wire field, and the alternative is reaching for it at the
  // POST. It is NOT on the stored spec: it does not exist until the takes have landed and been
  // concatenated, which is why `toSubmittable` still returns null for an `stt` row.
  | (Extract<MediaSpec, { kind: "stt" }> & { audioUrl: string });

/**
 * The request body, as a pure function of the PRICED spec — pitfall 1, the money bug.
 *
 * Every dimension the price table keys on is set here, from the SAME spec object
 * `chooseMediaBatch` consumed. NEVER omit one and let fal default it: `wan-25-preview` defaults to
 * 1080p, which is 3× the 480p rate, and the estimate would silently under-report with no test going
 * red. If you add a priced dimension to the table, add it here in the SAME commit. The `never` arm
 * below is what makes that "same commit" mechanical rather than remembered.
 *
 * Field names are the ones read vendor-direct from `fal.ai/api/openapi/queue/openapi.json` in plan
 * 20-01's preflight — not from memory.
 */
export function buildSubmitBody(spec: SubmittableSpec, text: string): Record<string, unknown> {
  switch (spec.kind) {
    case "video":
      return {
        prompt: text,
        resolution: spec.resolution,
        // A STRING enum ["5","10"] on this endpoint. Submitting the NUMBER 10 fails schema
        // validation — after the reservation has already been taken. `MediaSpec.seconds` is a
        // number because it is arithmetic; this is the boundary where it becomes the wire type.
        duration: String(spec.seconds),
        // Defaults TRUE: a model-side rewrite of our prompt. Pinned off, or the prompt we priced is
        // not the prompt that ran.
        enable_prompt_expansion: false,
        // NOTE — there is no audio toggle on this endpoint (preflight, 20-01). Wan 2.5 generates
        // native audio and the only audio field is `audio_url`, which we never send. The clip's own
        // diegetic track is not a conflict: `render/assemble_final.sh` ducks it to SFXVOL 0.20
        // under the voice bed by its LEVEL LAW. Research Open Question 5 resolves THERE, not here.
      };
    case "image":
      return {
        prompt: text,
        // There is no `width`/`height` on this endpoint. `image_size` takes a preset name OR a
        // {width,height} object; `MediaSpec.image` keeps width/height because that is what
        // megapixels are computed from, and this is the ONLY place they are mapped.
        image_size: { width: spec.width, height: spec.height },
        // Defaults to 1 and is a STRAIGHT price multiplier — pinned, same rule as `resolution`.
        num_images: 1,
      };
    case "tts":
      return {
        text,
        // `voice` and `sample_rate_hertz` are PINNED, never defaulted — the same rule `resolution`
        // is pinned by, for the same reason. The vendor default is 48000 Hz, which doubles the bytes
        // that have to reach the render sandbox and makes the ffmpeg resample step non-deterministic.
        //
        // And note what is NOT here: there is no `speed` / `rate` field on this endpoint, and that
        // is a FEATURE. D8 forbids time-stretch, and the obvious "fix" for a voice line that overruns
        // its window is to speed it up. `fal-ai/inworld-tts` makes that structurally impossible. If
        // this model is ever swapped, re-read this comment first: the `fal-ai/kokoro` family exposes
        // `speed: 0.1-5.0` and swapping to it would re-open the hole. (Spelled without a trailing
        // glob on purpose: a literal slash-star inside a LINE comment opens a block comment as far
        // as `media.test.ts`'s comment-stripping scans are concerned, and silently eats the code
        // between here and the next star-slash — including the `never` guard below.)
        voice: spec.voice,
        sample_rate_hertz: spec.sampleRateHertz,
      };
    case "stt":
      return {
        // The ONLY field. And note what is deliberately absent: `keyterms`. It costs +30% on
        // scribe-v2's per-minute rate — a priced dimension that would be paid on every reel to
        // improve the spelling of words we did not know in advance. If it is ever added, the price
        // table gains a keyterms multiplier in the SAME commit, or the estimate is a lie.
        audio_url: spec.audioUrl,
      };
    default: {
      const _never: never = spec;
      throw new Error(`unhandled media kind: ${JSON.stringify(_never)}`);
    }
  }
}

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

/** A CODE, never the provider's prose (CLAUDE.md §4, the `calendar.ts:84` idiom). Only a 422 body
 *  is parsed at all, and only its `type` discriminator: a 5xx body is a stack trace as often as not,
 *  so it is never read — its status alone becomes the code. */
async function falReasonCode(response: Response): Promise<string> {
  if (response.status !== 422) return `http_${response.status}`;
  try {
    const body = (await response.json()) as { type?: unknown; detail?: unknown };
    const nested = Array.isArray(body.detail)
      ? (body.detail[0] as { type?: unknown } | undefined)
      : undefined;
    const candidate = typeof body.type === "string" ? body.type : nested?.type;
    return typeof candidate === "string" && SAFE_CODE.test(candidate) ? candidate : "http_422";
  } catch {
    return "http_422";
  }
}

/** `blocked` is the 422 arm — a non-retryable input refusal, which is a `provider_blocked` VERDICT
 *  on the row rather than a failure. Everything else is a plain failure the retrier may re-run. */
export type SubmitResult =
  | { ok: true; requestId: string }
  | { ok: false; code: string; blocked: boolean };

/** POST one line to fal's queue. Pure over (spec, text, webhookUrl) apart from the two env reads. */
export async function submitLine(
  spec: SubmittableSpec,
  text: string,
  webhookUrl: string,
): Promise<SubmitResult> {
  // THE FIRST STATEMENT, deliberately. No key, no request — fail-closed by construction rather than
  // by the ordering happening to be right today. media.test.ts asserts the fetch spy saw ZERO calls,
  // not merely that the message was right.
  const key = requireEnvMedia("FAL_KEY");

  /* ponytail: FAL_FIXTURE is the offline seam that lets the whole submit → webhook → land path be
   * exercised at $0 (the `llm.ts:922` `render=fail::` precedent). It sits AFTER the key check on
   * purpose, so "no key" stays the same refusal in fixture mode as in production. Remove it only
   * when a hermetic fal mock exists; until then this is the reason no test in Phase 20 spends
   * money. */
  if (process.env.FAL_FIXTURE) return { ok: true, requestId: `fixture-${crypto.randomUUID()}` };

  let response: Response;
  try {
    response = await fetch(
      `https://queue.fal.run/${spec.model}?fal_webhook=${encodeURIComponent(webhookUrl)}`,
      {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildSubmitBody(spec, text)),
      },
    );
  } catch {
    // The thrown error's message can carry the URL — and therefore the webhook's HMAC segment. A
    // code only; the exception itself is dropped on the floor.
    return { ok: false, code: "transport_error", blocked: false };
  }

  if (!response.ok) {
    return { ok: false, code: await falReasonCode(response), blocked: response.status === 422 };
  }

  const body = (await response.json().catch(() => null)) as { request_id?: unknown } | null;
  const requestId = body?.request_id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return { ok: false, code: "no_request_id", blocked: false };
  }
  // Returns HERE, holding a queue ticket. No status_url read, no wait loop, no second request.
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
  // "stt" is submittable (`buildSubmitBody` has its arm) but NEVER from here. Its `audio_url` does
  // not exist yet at `submitBatch` time — the audio it transcribes is the OUTPUT of the tts lines in
  // this same batch. `submitCaptions` owns it, after those lines have landed. Returning null keeps
  // the row at `queued` and unclaimed until then, which is exactly what this return did for `tts`
  // before plan 20-14 wired it.
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
      v.object({ ok: v.literal(true), falRequestId: v.string() }),
      v.object({ ok: v.literal(false), blocked: v.boolean(), code: v.string() }),
    ),
  },
  handler: async (ctx, { jobId, result }): Promise<null> => {
    const updatedAt = Date.now();
    if (result.ok) {
      await ctx.db.patch(jobId, { falRequestId: result.falRequestId, updatedAt });
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

/**
 * Submit a whole reserved batch. Idempotent per line, and it NEVER waits.
 *
 * Both env reads are hoisted above the loop on purpose: a missing `FAL_WEBHOOK_SECRET` must refuse
 * the batch before line 1 claims itself, not halfway through one.
 */
export const submitBatch = internalAction({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<{ submitted: number; blocked: number; failed: number; skipped: number }> => {
    const siteUrl = requireEnvMedia("CONVEX_SITE_URL");
    const secret = requireEnvMedia("FAL_WEBHOOK_SECRET");
    const { lines, shots } = await ctx.runQuery(internal.media.batchToSubmit, a);
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

      // The `gmailAuth.buildAuthorizeUrl:59` construction verbatim, per JOB ROW rather than per
      // tenant: the segment binds to ONE `mediaJobs` row, so a leaked URL buys an attacker one
      // already-finished job. Nothing is stored — plan 20-06 re-derives this exact string.
      const webhookUrl = `${siteUrl}/fal/callback/${line.jobId}.${await hmacHex(line.jobId, secret)}`;

      // The content plane, by kind: a video/image line submits the block's PROMPT, a `tts` line its
      // NARRATION. Either way the text goes to fal and to nothing else — never an audit row, never a
      // log, never onto the job row (only its `promptHash` lives there).
      const shot = shots.find((s) => s.index === line.blockIndex);
      const text = shot && SUBMIT_TEXT[spec.kind]?.(shot);
      if (text === undefined) {
        await ctx.runMutation(internal.media.recordSubmission, {
          jobId: line.jobId,
          result: { ok: false, blocked: false, code: "missing_shot" },
        });
        tally.failed += 1;
        continue;
      }

      const res = await submitLine(spec, text, webhookUrl);
      await ctx.runMutation(internal.media.recordSubmission, {
        jobId: line.jobId,
        result: res.ok
          ? { ok: true, falRequestId: res.requestId }
          : { ok: false, blocked: res.blocked, code: res.code },
      });
      if (res.ok) tally.submitted += 1;
      else if (res.blocked) tally.blocked += 1;
      else tally.failed += 1;
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

/**
 * The audio, as a `data:` URI.
 *
 * **DEVIATION FROM THE PLAN, recorded here because it is a trust-boundary decision.** 20-17 says to
 * POST the bytes to fal's file-upload endpoint and submit the returned fal-hosted URL. The BINDING
 * requirement behind that instruction is *"a Convex signed storage URL is NEVER handed to a third
 * party"* — `plans.attachmentUrls`' header calls such a URL a bearer capability — and a data URI
 * satisfies it completely: no URL of ours exists, so none can be handed over.
 *
 * Why this and not the upload: fal's upload endpoint is a multi-step protocol (initiate → PUT →
 * derive) whose exact shape could NOT be confirmed vendor-direct in this session, and the delta
 * (§3.2) records only that it "returns a fal-hosted URL". Guessing a protocol at a money boundary
 * fails at the first live call and buys nothing over the documented data-URI form, which is ONE
 * request on a path already built. It also removes a ceiling the plan expected to have to record:
 * with no upload there is no copy of tenant audio sitting in fal's storage under a retention policy
 * we do not control. The bytes still reach fal — that is what transcription is — but they live only
 * for the request.
 *
 * ponytail: upgrade path if a reel ever outgrows the body cap below (a longer deck, or a switch to
 * 48 kHz takes): fal's file-upload endpoint, confirmed against its OpenAPI spec first, submitted the
 * same way. The seam is this one function.
 */
export function audioDataUri(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  // Chunked: `String.fromCharCode(...bytes)` on a 3 MB array blows the argument limit.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

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
      v.object({ ok: v.literal(true), falRequestId: v.string() }),
      v.object({ ok: v.literal(false), blocked: v.boolean(), code: v.string() }),
    ),
  },
  handler: async (ctx, a): Promise<null> => {
    const updatedAt = Date.now();
    if (a.result.ok) {
      await ctx.db.patch(a.planId, { captionOffsetsS: a.offsetsS });
      await ctx.db.patch(a.jobId, { falRequestId: a.result.falRequestId, updatedAt });
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
    // ALL THREE env reads FIRST, before a single tenant byte is READ, let alone sent — the 20-05
    // rule taken one step further than `submitLine` needs it. `FAL_KEY` is re-read inside
    // `submitLine` and would refuse there anyway, but only after this action had already pulled
    // every voice take out of storage and concatenated them. Refusing here means a deployment
    // missing its key does no work at all. `media.test.ts` asserts a fetch-call count of ZERO.
    requireEnvMedia("FAL_KEY");
    const siteUrl = requireEnvMedia("CONVEX_SITE_URL");
    const secret = requireEnvMedia("FAL_WEBHOOK_SECRET");

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

    const webhookUrl = `${siteUrl}/fal/callback/${job.sttJobId}.${await hmacHex(job.sttJobId, secret)}`;
    const res = await submitLine(
      {
        kind: "stt",
        model: job.model,
        // MEASURED off the audio actually being sent, not copied from the reservation. `stt` is an
        // EXACT_SPEND kind because we generated this audio and therefore already know its length —
        // reading the estimate back here instead would make that claim circular.
        audioMinutes: joined.value.durationS / 60,
        audioUrl: audioDataUri(joined.value.wav, "audio/wav"),
      },
      "", // an stt line submits no text — the audio IS the input
      webhookUrl,
    );
    await ctx.runMutation(internal.media.recordCaptionSubmission, {
      planId: job.planId,
      jobId: job.sttJobId,
      offsetsS: joined.value.offsetsS,
      result: res.ok
        ? { ok: true, falRequestId: res.requestId }
        : { ok: false, blocked: res.blocked, code: res.code },
    });
    return res.ok ? { ok: true } : { ok: false, code: res.code };
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

    const maxChars = plan.clipSeconds === undefined ? MAX_CHARS_PER_BLOCK : maxCharsFor(plan.clipSeconds);
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
      rows.map(async (r) => ({
        blockIndex: r.blockIndex,
        kind: r.kind,
        mimeType: r.mimeType ?? null,
        status: r.status,
        verdict: r.verdict ?? null,
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

/** Reserve + schedule, shared by the two paid entry points. Returns the governed refusal rather
 *  than throwing — a refusal is an answer, not an error. */
async function reserveAndSchedule(
  ctx: MutationCtx,
  a: { tenantId: string; planId: Id<"plans">; blocks: readonly Block[]; clipSeconds: number },
): Promise<{ ok: true; batchId: string; estCents: number } | { ok: false; reason: ReserveRefusal }> {
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
    if (!shots.some((s) => s.index === blockIndex)) return { ok: false as const, reason: "no_block" };
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
    if (!shots.some((s) => s.index === blockIndex)) return { ok: false as const, reason: "no_block" };

    const maxChars =
      plan.clipSeconds === undefined ? MAX_CHARS_PER_BLOCK : maxCharsFor(plan.clipSeconds);
    if (narration.length > maxChars) {
      return { ok: false as const, reason: "narration_too_long", chars: narration.length, maxChars };
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
    if (!shots.some((s) => s.index === blockIndex)) return { ok: false as const, reason: "no_block" };
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
