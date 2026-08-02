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
import type { Block } from "@pikar/core/storyboard";
import { CLIP_SECONDS, isPaidBlock, maxCharsFor, minCharsFor } from "@pikar/core/storyboard";
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
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { getGuardrailConfig, rateLimiter } from "./guardrails";
import { contentHash } from "./lib/hash";

/** Every way a job can be refused BEFORE a cent moves. Distinct codes because they send the user
 *  to distinct levers: rewrite a line, cut blocks, wait for tomorrow, or call the operator. */
export type ReserveRefusal =
  | "kill_switch"
  | "unknown_model"
  | "over_job_cap"
  | "illegal_duration"
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
