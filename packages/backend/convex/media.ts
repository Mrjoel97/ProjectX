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
import { concatWavTakes, pcm16ToWav } from "@pikar/core/captions";
import { isRenderableCardText, MUSIC_BLOCK_INDEX } from "@pikar/core/render";
import type { Block, Scene, ShotType, VisualKind } from "@pikar/core/storyboard";
import {
  hasAssetSource,
  isPaidBlock,
  MAX_CHARS_PER_BLOCK,
  maxCharsFor,
  minCharsFor,
  narrationCeilingSeconds,
  narrationOverrunsReel,
  SHOT_TYPES,
  TARGET_DURATIONS,
  VISUAL_KINDS,
} from "@pikar/core/storyboard";
import type { MediaSpec } from "@pikar/cost/media";
import {
  chooseMediaBatch,
  estimateMediaUsd,
  MEDIA_DEFAULT_IMAGE,
  MEDIA_DEFAULT_MUSIC,
  MEDIA_DEFAULT_STOCK,
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_GENERATED_SECONDS_CAP,
  MEDIA_JOB_CAP_USD,
  MEDIA_MUSIC_STOCK,
  MEDIA_VIDEO_SECONDS,
  sceneVisualSpec,
} from "@pikar/cost/media";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { getGuardrailConfig, mediaRemainingCentsInner, rateLimiter } from "./guardrails";
import { retrier } from "./index";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { evaluateRenderTrigger } from "./mediaComplete";
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
  /** 33.1-04 — the reel is affordable but spends more than `MEDIA_GENERATED_SECONDS_CAP` on
   *  generated video. A DIFFERENT lever from `over_job_cap`: the cure is not "cut a scene", it is
   *  "swap a generated scene for an animated still or stock", which cost the same at any length.
   *  It exists because grok's 1..15 grid made an all-generated reel composable and affordable for
   *  the first time, removing an arithmetic guarantee this restores in code (ADR-027). */
  | "over_generated_seconds"
  | "unrenderable_block"
  /** 20.2 wave 6 — regenerating a scene that BUYS NOTHING. A `text_card` is drawn by ffmpeg and an
   *  `uploaded_video`'s bytes are already the tenant's, so a silent one of either has no provider
   *  line to reserve: there is literally nothing to re-buy. Editing its words and generating the
   *  reel is the whole cure, and saying so beats opening a $0 transaction that buys air. */
  | "nothing_to_regenerate"
  | "narration_too_long"
  | "narration_too_short"
  /** 33-03 — a picked-deck scene states a figure the user has not vouched for
   *  (`needsConfirmation` with no `confirmedAt`). The lever is `confirmClaim`, not a rewrite:
   *  the model proposes, only the owner vouches, and money is where that becomes structural. */
  | "unconfirmed_claims"
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

/**
 * Can the PINNED video model actually produce a block of this length?
 *
 * NOT `CLIP_SECONDS`. That constant is the DISPLAY set — deliberately wide ([4,5,8,10,12]) so a
 * deck proposed under an older provider still renders on the canvas. What may be BOUGHT is
 * whatever the model this code is about to submit to supports, which after the OpenAI cutover is
 * `MEDIA_VIDEO_SECONDS` (the sora-2 grid then; the row left in 33.2-06) = [4,8,12].
 *
 * The two drifted apart at the cutover and nothing noticed, because a 10-second deck still failed
 * — just three checks later, inside `estimateMediaUsd`, with the same code. ONE predicate, asked of
 * the provider table rather than of a constant, is what stops that recurring the next time the
 * pinned model changes.
 */
const isBuyableClipLength = (seconds: number): boolean =>
  MEDIA_VIDEO_SECONDS[MEDIA_DEFAULT_VIDEO.model]?.includes(seconds) ?? false;
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

  // 2. A block length THE PINNED MODEL cannot produce.
  //
  //    This checked `CLIP_SECONDS` until 20.2 found the hole, and the hole was real rather than
  //    theoretical: `CLIP_SECONDS` is [4,5,8,10,12] — deliberately WIDE, so a historical Wan deck
  //    still DISPLAYS — while `MEDIA_VIDEO_SECONDS` (the sora-2 grid then; the row left in 33.2-06) is [4,8,12]. After the OpenAI
  //    cutover a 10-second deck therefore parsed free, cleared THIS check, and was refused deeper
  //    in by `estimateMediaUsd` with the same `illegal_duration` code. Same outcome, wrong place,
  //    and it made `cockpit.test.ts` red for a reason that read like a pricing bug.
  //
  //    A display set and a purchasable set are different questions. This is the money gate, so it
  //    asks the second one — of the model it is actually about to submit to, never of a constant
  //    that has to be remembered when the provider changes.
  if (!isBuyableClipLength(a.clipSeconds)) return { ok: false, reason: "illegal_duration" };

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

/**
 * `reserveJobInner`'s SCENE twin (20.2 wave 5) — the money gate for a scene deck.
 *
 * Separate from `reserveJobInner` rather than a widened signature, and the reason is the same one
 * that keeps `deckOf` and `sceneDeckOf` apart: a plan carries one contract or the other, never
 * both, so a function that took either would spend its length asking which. The two SHARE the part
 * that actually moves money — `reserveProviderLinesInner` floors the batch total, checks and
 * consumes both windows, and inserts only after every refusal has passed — so there is exactly one
 * transaction, not two to keep in step.
 *
 * WHAT CHANGED FROM THE BLOCK PATH, and every one of these is why the twin exists:
 *
 *   * **A picture line is per-KIND, not per-paid-flag.** `generated_video` buys a clip at ITS OWN
 *     length; `animated_image` buys ONE still and the assembler pans across it (~a tenth of the
 *     cost, and frame-exact at any duration); `uploaded_video` and `text_card` buy nothing at all.
 *   * **`unrenderable_block` is NARROWED to `hasAssetSource`.** The old check refused every unpaid
 *     row, because an unpaid row had no clip and the assembler hard-errors on a missing input.
 *     Waves 3-5 removed that: a card is drawn, a still is panned, and an upload is fetched from
 *     the vault. What is still refused is a row that does not name what its picture is built from.
 *   * **A voice line only where there is a line to speak.** Silence is legal (wave 4), and
 *     reserving a tts call for an empty string would buy nothing and then fail to land.
 *   * **The narration ceiling is the TAKE's window, not the scene's.** `narrationCeilingSeconds`
 *     runs to the next NARRATED scene, so a silent scene lends its duration to the line before it.
 *     There is no floor any more — a short line is a pause, not a fault.
 *
 * **`only` — one scene, bought against the WHOLE deck's timeline (20.2 wave 6).** This is what
 * `regenerateBlock` needs and why it refused until now. A reel's length is the sum of its scenes,
 * so a one-scene reservation cannot be a one-scene DECK: the sum gate would refuse it, and the
 * narration ceiling would be measured against a neighbour that is not there. So the whole deck is
 * validated exactly as a full reservation validates it — every refusal a full buy would raise, a
 * partial buy raises too — and only the LINES are narrowed. The captions line still prices the
 * whole reel, because re-buying one scene re-renders and re-captions all of it.
 */
/** 33-03 — the first PICKED-DECK shot stating a figure the user has not vouched for, or null.
 *  ONE predicate for both money sites, so the estimate and the reserve cannot drift on what
 *  "unconfirmed" means. Reads shot elements (the row), never parser `Scene`s — parser output
 *  structurally cannot carry `confirmedAt`, so the row is the only place the answer exists. */
const firstUnconfirmedClaim = (
  shots:
    | readonly { index: number; needsConfirmation?: boolean; confirmedAt?: number }[]
    | undefined,
): { index: number } | null =>
  shots?.find((s) => s.needsConfirmation === true && s.confirmedAt === undefined) ?? null;

/**
 * The deck-wide music bed as a priced spec, or `null` when the deck declares no bed.
 *
 * ONE reader of `artDirection.music` for BOTH money sites — `reserveSceneJobInner` and
 * `jobEstimate` — which is the wave-5 co-location rule applied to a new line: the number the canvas
 * prints and the number the rail consumes come from the same three lines, so they cannot drift the
 * way the per-kind picture branches drifted while they were hand-copied at two call sites.
 *
 * A bed is DECK-WIDE, so it is priced on a partial buy too. Re-buying one scene re-renders the
 * whole reel, and the re-render lays the same bed down again — exactly the reasoning that already
 * keeps the captions line whole on a partial buy.
 */
const musicSpecOf = (plan: Doc<"plans"> | null): Extract<MediaSpec, { kind: "music" }> | null => {
  const mood = plan?.artDirection?.music;
  return mood === undefined ? null : { kind: "music", model: MEDIA_DEFAULT_MUSIC.model, mood };
};

export async function reserveSceneJobInner(
  ctx: MutationCtx,
  a: {
    tenantId: string;
    planId: Id<"plans">;
    scenes: readonly Scene[];
    targetDurationSeconds: number;
    withCaptions: boolean;
    /** A scene INDEX. Absent buys the whole deck; present buys that scene alone. */
    only?: number;
  },
): Promise<ReserveResult> {
  // Same order as the block path, and for the same reasons — coverage above every refusal, then
  // both kill switches, then the free checks, then the lines.
  await ensureCoverage(ctx, a.tenantId, Date.now());
  const cfg = await getGuardrailConfig(ctx);
  if (cfg.killSwitch || cfg.mediaKillSwitch) return { ok: false, reason: "kill_switch" };
  if (a.scenes.length === 0) return { ok: false, reason: "unrenderable_block" };

  // The deck must add up to what it declared. The assembler asserts this too and refuses before
  // any work — but that refusal is inside a VM that has already been paid for, and this one is
  // free. Same rule that puts the narration ceiling here rather than downstream.
  const summed = a.scenes.reduce((n, s) => n + s.durationMs, 0) / 1000;
  if (summed !== a.targetDurationSeconds) return { ok: false, reason: "illegal_duration" };

  // 33-03 — the confirm gate, in the SAME position of the same pre-flight order as `jobEstimate`'s
  // (the wave-5 co-location rule: the number on screen and the button refuse together). Checked
  // off the ROW rather than the passed scenes, and deck-wide like every other refusal here — a
  // partial buy against a deck with an unvouched figure is still money against that deck. Reading
  // it HERE means no caller can hand this function a deck that skips the gate.
  const planRow = await ctx.db.get(a.planId);
  const claim = firstUnconfirmedClaim(
    planRow && planRow.tenantId === a.tenantId ? planRow.shots : undefined,
  );
  if (claim) return { ok: false, reason: "unconfirmed_claims" };

  // THE ONE NARRATION GATE ON THE MONEY PATH, over the WHOLE deck rather than scene by scene.
  // The only overrun the assembler still cannot resolve is speech that is still running when the
  // reel ends, and reaching it requires a cascade of displaced takes — so it is a property of the
  // deck, not of any one line. Same function the parser uses, deliberately: two gates with two
  // models of the same renderer is how a deck gets accepted by one and refused by the other.
  const overrun = narrationOverrunsReel(a.scenes, a.targetDurationSeconds);
  if (overrun) return { ok: false, reason: overrun.reason };

  const now = Date.now();
  const batchId = crypto.randomUUID();
  const base = { tenantId: a.tenantId, planId: a.planId, batchId };
  const lines: ProviderLine[] = [];

  for (const [i, scene] of a.scenes.entries()) {
    // THE NARROWED GUARD. A row that does not name its own source can never produce pixels, and
    // finding that out in the VM costs the whole deck.
    if (!hasAssetSource(scene)) return { ok: false, reason: "unrenderable_block" };

    // EVERY scene is validated; only the chosen one is BOUGHT. The refusals above and below stay
    // deck-wide on purpose — a partial buy that ignored a neighbour's broken row would reserve
    // successfully and then be refused by the render, which is the failure mode wave 6 exists to
    // remove rather than reproduce one function to the left.
    const buying = a.only === undefined || scene.index === a.only;
    /** A provider line, kept only if this scene is the one being bought. The refusals stay where
     *  they were; this is the ONLY thing `only` changes. */
    const buy = (line: ProviderLine): void => {
      if (buying) lines.push(line);
    };
    const seconds = scene.durationMs / 1000;

    // THE PICTURE, off the scene-kind price table (20.2 wave 7) rather than a branch per kind
    // written out at every money site. The provider's duration GRID is enforced inside it, against
    // the model we are about to submit to rather than against the wider display set — the hole 20.2
    // found in the block path's `isBuyableClipLength`.
    const picture = sceneVisualSpec(scene.visual, seconds);
    if (!picture.ok) return { ok: false, reason: picture.error.code }; // fail closed, never guess
    if (picture.value !== null) {
      const { spec, usd } = picture.value;
      buy({
        spec,
        estUsd: usd,
        row: {
          ...base,
          // THE ROW SAYS WHAT THE BYTES ARE; THE SPEC SAYS WHAT THE MONEY IS. They agree for the
          // two bought kinds and deliberately diverge for stock: a stock line is `spec.kind
          // "stock"` (its own $0 price table, its own fetcher) landing as `kind: "video"` or
          // `"image"` (an ordinary asset, in the slot the render already reads). Folding them
          // together in either direction is the mistake — one way the render grows a stock case,
          // the other way a free fetch is priced from the paid video table.
          provider: spec.kind === "stock" ? "stock" : "openai",
          blockIndex: scene.index,
          kind: spec.kind === "stock" ? spec.media : spec.kind,
          model: spec.model,
          spec:
            spec.kind === "stock"
              ? { kind: "stock", media: spec.media, seconds: spec.seconds }
              : spec.kind === "video"
                ? { kind: "video", resolution: spec.resolution, seconds: spec.seconds }
                : { kind: "image", width: spec.width, height: spec.height },
          promptHash: await contentHash(scene.prompt),
          status: "queued",
          estUsd: usd,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    // A `null` picture line is a kind that buys NOTHING: an `uploaded_video`'s bytes are already
    // the tenant's (resolved from the vault at render time) and a `text_card` is drawn by ffmpeg
    // inside a sandbox the flat render line already pays for.

    // THE VOICE TAKE, only where there is a line.
    //
    // 33.1-06 moved this check OUT of the per-scene loop and up to `narrationOverrunsReel`, run
    // once over the whole deck below-of-here in this same function. Two reasons, and the first is
    // correctness rather than tidiness: the surviving failure — speech still running when the reel
    // ends — is reachable only through a CASCADE of displaced takes, so it cannot be decided one
    // scene at a time. The second is that this gate and `parseSceneDeck`'s now share ONE model of
    // what the assembler does, and a reservation that refuses what the parser accepted would
    // strand a deck between two gates that disagree.
    //
    // It stays upstream of payment for the reason it always was: an overrun is otherwise only
    // provable inside a sandbox that has already been bought.
    if (scene.narration !== "") {
      // Doubled for the same reason the block path doubles: ONE rewrite round is pre-paid, because
      // the provider returns no duration and a job that cannot afford its own cure strands a paid
      // deck. At $0.012 the doubling is free and the fail-closed direction is over-reserving.
      const characters = scene.narration.length * 2;
      const spec: MediaSpec = { kind: "tts", model: MEDIA_DEFAULT_VOICE.model, characters };
      const priced = estimateMediaUsd(spec);
      if (!priced.ok) return { ok: false, reason: priced.error.code };
      buy({
        spec,
        estUsd: priced.value,
        row: {
          ...base,
          provider: "openai",
          blockIndex: scene.index,
          kind: "tts",
          model: MEDIA_DEFAULT_VOICE.model,
          spec: {
            kind: "tts",
            characters,
            voice: MEDIA_DEFAULT_VOICE.voice,
            sampleRateHertz: MEDIA_DEFAULT_VOICE.sampleRateHertz,
          },
          promptHash: await contentHash(scene.narration),
          status: "queued",
          estUsd: priced.value,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }

  // THE GENERATED-SECONDS CEILING, MEASURED OVER THE WHOLE DECK (33.1-04).
  //
  // `chooseMediaBatch` enforces it too, and on a FULL buy that is the same question asked twice.
  // On a PARTIAL buy it is not: `lines` is narrowed to the chosen scene, so the specs the batch
  // sees carry only that scene's seconds — and a deck spending 24 generated seconds, refused as a
  // whole reel, could be bought one scene at a time through `regenerateBlock` (which requires no
  // prior batch) until the entire deck had been paid for. Measured, not theorised: with only the
  // batch check in place, scene 0 of a 12 + 12 + 6 deck reserved successfully.
  //
  // Deck-wide is the rule this function already states for every other refusal — "every refusal a
  // full buy would raise, a partial buy raises too; only the LINES are narrowed" — so this is that
  // rule applied to one more gate rather than a new kind of check.
  //
  // AFTER the scene loop, deliberately: a scene the provider cannot make at ANY price is
  // `illegal_duration`, which names a different and more actionable lever. Every length above the
  // grid is also above this ceiling, so checking the ceiling first would make `illegal_duration`
  // unreachable for a generated scene and report "too much video" about a clip that cannot be
  // bought at all. Nothing has been spent either way — both are free refusals.
  const deckGeneratedSeconds = a.scenes.reduce(
    (n, s) => n + (s.visual === "generated_video" ? s.durationMs / 1000 : 0),
    0,
  );
  if (deckGeneratedSeconds > MEDIA_GENERATED_SECONDS_CAP) {
    return { ok: false, reason: "over_generated_seconds" };
  }

  // A deck of nothing but free scenes and no narration has nothing to reserve and nothing to
  // render into: refuse rather than open a money transaction with an empty line list. On a PARTIAL
  // buy the same emptiness means something else entirely — the deck is fine and this one scene
  // simply has nothing to purchase — so it is named separately rather than told the deck is
  // unrenderable when it is not.
  if (lines.length === 0) {
    return {
      ok: false,
      reason: a.only === undefined ? "unrenderable_block" : "nothing_to_regenerate",
    };
  }

  // One deck-wide captions pass, priced against the DECLARED length rather than
  // `blocks × clipSeconds` — the arithmetic that no longer describes a reel.
  if (a.withCaptions) {
    const audioMinutes = a.targetDurationSeconds / 60;
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
        promptHash: await contentHash(a.scenes.map((s) => s.narration).join("\n")),
        status: "queued",
        estUsd: priced.value,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  // THE MUSIC BED (deck-wide, $0) — a SPEC, never a `mediaJobs` row, and the distinction is
  // load-bearing rather than tidy. `renderReel.batchToRender` refuses a batch unless every row
  // reached `succeeded` with landed bytes; a music row buys no provider call, so it would sit
  // `queued` forever and the reel would never render at all. The `render` line has exactly this
  // shape for exactly this reason — priced, capped and reserved with the job, with no row, no
  // provider request and no webhook. A $0 line is still a line: it belongs on the invoice because
  // the reel was built from it.
  //
  // Priced through `estimateMediaUsd` like every other line, so an unpriceable mood is a REFUSED
  // job rather than a quietly bedless one — "a job with one unpriceable line is not a cheaper job."
  // In practice the parser's closed set makes that unreachable; this is the gate that makes it
  // unreachable rather than merely unlikely.
  const music = musicSpecOf(planRow && planRow.tenantId === a.tenantId ? planRow : null);
  // 33.1-06: THE BED'S BYTES. The $0 `music` line above still names the bed on the invoice; this
  // is the stock ROW that fetches it (Openverse, `provider: "stock"`, `kind: "audio"`), exactly as
  // a Pexels still is a row. It goes FIRST so `submitBatch` fetches it before the paid lines —
  // seconds of work — and it has landed by the time the last take does. Deck-wide, so it sits at
  // MUSIC_BLOCK_INDEX beside captions at -1, outside every scene index. Its `seconds` is the reel:
  // the picker skips a track that would need a loop seam inside it.
  if (music !== null) {
    const bedSpec: MediaSpec = {
      kind: "stock",
      model: MEDIA_MUSIC_STOCK.model,
      media: "audio",
      seconds: a.targetDurationSeconds,
    };
    const priced = estimateMediaUsd(bedSpec);
    if (!priced.ok) return { ok: false, reason: priced.error.code };
    lines.unshift({
      spec: bedSpec,
      estUsd: priced.value,
      row: {
        ...base,
        provider: "stock",
        blockIndex: MUSIC_BLOCK_INDEX,
        kind: "audio",
        model: MEDIA_MUSIC_STOCK.model,
        spec: { kind: "stock", media: "audio", seconds: a.targetDurationSeconds },
        promptHash: await contentHash(music.mood),
        status: "queued",
        estUsd: priced.value,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  const specs: MediaSpec[] = [
    ...lines.map((l) => l.spec),
    ...(music === null ? [] : [music]),
    { kind: "render" },
  ];
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
// Submit new visual and audio lines. As of 33.1-06 EVERY PAID PLANE IS ON OPENROUTER and reads
// OPENROUTER_API_KEY. `OPENAI_API_KEY` survives for exactly one thing, named at the bottom of this
// note, and nothing that submits work reads it:
//   - image  -> OPENROUTER, `openrouter.ai/api/v1/images`, on OPENROUTER_API_KEY. Bytes come back
//               synchronously in `data[0].b64_json`, byte-identically to the OpenAI shape it
//               replaced (measured 2026-08-30, see 33.1-PRICE-EVIDENCE.md).
//   - video  -> OPENROUTER, `openrouter.ai/api/v1/videos`, on OPENROUTER_API_KEY. Asynchronous:
//               a 202 hands back an id, and `pollOpenRouterVideoTask` owns everything after it.
//               Moved here by 33.1-05 because OpenAI WITHDRAWS its Videos API on 2026-09-24 — an
//               ENDPOINT withdrawal, so there was no same-vendor row to move to (ADR-027).
//   - tts    -> OPENROUTER, `openrouter.ai/api/v1/chat/completions`. NOT `/audio/speech`: that
//               route exists on OpenRouter and accepts NO model at all (four probed 2026-09-03,
//               including `openai/gpt-audio`, which IS in the catalogue). So the voice plane rides
//               a chat model with an audio modality, `stream: true` is mandatory, and the take is
//               refused unless the transcript matches the script — ADR-028.
//   - stt    -> OPENROUTER, `openrouter.ai/api/v1/audio/transcriptions`, with full per-word
//               timestamps at the same $0.0060/minute OpenAI charges. ADR-028 stated the OPPOSITE
//               and ADR-029 corrects it: the `/models` catalogue lists CHAT models only, so a
//               transcription model is absent from it while being perfectly serviceable at the
//               endpoint. **Do not conclude from that catalogue that an audio route is missing.**
// The OpenAI API hostname no longer appears in this file. 33.2-06 deleted the retained Sora poller: the
// endpoint it polled is withdrawn on 2026-09-24, the only sora-2 row in any deployment is
// `succeeded`, and the owner retired the model. `media.test.ts` holds a source scan against the
// hostname coming back — and STILL asserts routing on the RESOLVED url handed to `fetch`, because a
// scan proves spelling, not routing.
//
// ONE poller is retained beside the live one, for the reason it always was: `pollWanTask`
// (pre-Sora cutover) lets a job submitted before a cutover still land. It is not a fallback and
// no submit path reaches it.
//
// ponytail: two near-identical pollers, one per vendor generation — not a provider registry.
// Upgrade path: extract a shared poller only when a THIRD arrives AND all three agree branch for
// branch. OpenRouter's status vocabulary is `pending -> completed|failed`; a premature
// generalisation over that difference is exactly how a poller lands `provider_failed` on a job
// that was merely pending.

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
      // OpenRouter's field names, MEASURED on 2026-08-30 (33.1-PRICE-EVIDENCE.md), not Sora's:
      // `duration` (a NUMBER, not `String(seconds)`) and `resolution` (the tier, not a WxH `size`).
      // All three priced dimensions — model, resolution, seconds — are here, per this function's
      // contract above.
      //
      // `aspect_ratio` is a PINNED WIRE FIELD, the video twin of `voice` on the tts arm: the price
      // table has no opinion about it, but the reel is 1080x1920 and a clip composed for any other
      // ratio gets reshaped by the assembler. "9:16" reproduces exactly the geometry Sora's
      // `720x1280` requested, so the migration changes the transport and not the picture.
      //
      // NOT sent: `generate_audio`, and NOT because Grok is silent — that earlier claim (also in
      // ADR-027) was wrong. The first rendered clip came back with a stereo AAC track of a
      // presenter SPEAKING, peaking at 0 dBFS and louder than the narration take, and the
      // assembler mixed it in as a "diegetic bed" under the voice: two voices at once. The audio
      // is unrequested, unpriced (the table sees model, resolution and seconds) and unwanted under
      // a narrated scene, so `assemble_final.sh` now drops a clip's own audio wherever the deck
      // speaks over it and keeps it only for a silent scene. Whether the route accepts an
      // audio-off flag is unknown — `/models/.../endpoints` lists chat parameters only, the ADR-029
      // lesson — and a paid probe is the only way to find out. Not sending one costs nothing.
      return {
        model: spec.model,
        prompt: text,
        duration: spec.seconds,
        resolution: spec.resolution,
        aspect_ratio: "9:16",
      };
    case "image":
      // NO `.replace(/^openai\//, "")` here, and that asymmetry with the `tts` arm below is the
      // point: `tts` posts to OpenAI's OWN API, which does not know a route prefix, while this arm
      // posts to OpenRouter, which does. Stripping here would send `gpt-image-2` to a gateway that
      // has never heard of that id.
      //
      // `size` and NOT `aspect_ratio`, and never both. Measured 2026-08-30 (33.1-PRICE-EVIDENCE.md):
      // they are NOT interchangeable — `aspect_ratio: "9:16"` returns 864x1536 at $0.003735, `size`
      // returns 1024x1536 at $0.004875. `size` reproduces MEDIA_DEFAULT_IMAGE's exact geometry, so
      // the migration changes the transport and not the picture. (The 9:16 option is both cheaper
      // and better-composed for a 1080x1920 reel; it is deferred to its own phase because it changes
      // what every generated still LOOKS like, and improvements do not ride in on a migration.)
      return {
        model: spec.model,
        prompt: text,
        n: 1,
        size: `${spec.width}x${spec.height}`,
        quality: "low",
        output_format: "png",
      };
    case "tts":
      // 33.1 — THE CHAT-AUDIO ROUTE, NOT `/audio/speech`. OpenRouter accepts no model at all on
      // that endpoint (probed), so the voice plane rides `/chat/completions` with an audio
      // modality. Four consequences are wire facts rather than choices:
      //   * `model` is UNSTRIPPED. OpenRouter routes on the `openai/` prefix; the old arm removed
      //     it because it was posting to OpenAI's own host. Same lesson as `openai/gpt-image-2`.
      //   * `stream: true` is MANDATORY — without it the API answers 400 "Audio output requires
      //     stream: true". The reader in `generateOpenRouterVoice` exists for this reason alone.
      //   * `pcm16` is HEADERLESS, so `pcm16ToWav` gives it the RIFF header everything downstream
      //     expects. `wav` is not an option on this route.
      //   * NO `speed`. There was a `speed: 1` here; a pace parameter is banned outright (a
      //     time-stretch the assembler refuses), and this route has no such field to send anyway.
      // The system line is what keeps a CHAT model reading instead of replying — see the prompt
      // note in `generateOpenRouterVoice`, and the verbatim check that does not trust it.
      return {
        model: spec.model,
        stream: true,
        modalities: ["text", "audio"],
        audio: { voice: spec.voice, format: "pcm16" },
        messages: [
          { role: "system", content: TTS_VERBATIM_SYSTEM },
          { role: "user", content: text },
        ],
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
  | {
      ok: true;
      requestId: string;
      asset?: { bytes: Uint8Array<ArrayBuffer>; mimeType: string };
      /** 33.1-06: the licence line a CC-licensed stock track carries. Only the music bed sets it —
       *  Pexels assets need no credit; a CC BY track is not usable without one. Public attribution
       *  data, written to the plan so the owner has it for the post caption. */
      credit?: MusicCredit;
    }
  | { ok: false; code: string; blocked: boolean };

export type MusicCredit = {
  title: string;
  creator: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  attribution: string;
};

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

/** Submit one new visual line. BOTH kinds go to OpenRouter as of 33.1-05: images return their bytes
 *  synchronously in the same response, video returns an asynchronous id which
 *  `pollOpenRouterVideoTask` owns. The credential follows the vendor, not the function — and with
 *  one vendor for both visual kinds there is now one credential. */
export async function submitLine(spec: VisualSpec, text: string): Promise<SubmitResult> {
  // Deliberately still ABOVE the fixture short-circuit: "fixture mode is free but still requires
  // configured credentials" is an existing invariant with its own test, and an offline run that
  // stops proving the credential exists is an offline run that stops catching the misconfiguration
  // it was there to catch.
  //
  // 33.1-03 keyed this on `spec.kind` because the two visual kinds then had two vendors. 33.1-05
  // moved the second one, so the ternary would now select the same value on both arms — a branch
  // that cannot differ is a branch that hides the fact. One read, one vendor.
  const key = requireEnvMedia("OPENROUTER_API_KEY");

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
    // One host, two paths, both JSON. The `FormData` the video arm used to build is gone with the
    // endpoint that wanted it: OpenAI's Videos API was multipart, OpenRouter's is not.
    response = await fetch(
      spec.kind === "video"
        ? "https://openrouter.ai/api/v1/videos"
        : "https://openrouter.ai/api/v1/images",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch {
    // The thrown error's message can carry the request URL and its auth context. A code only; the
    // exception itself is dropped on the floor.
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
      // The 2026-08-30 probe did NOT record whether OpenRouter returns `x-request-id`, so this
      // fallback is load-bearing rather than decorative — and it must not name OpenAI.
      requestId: response.headers.get("x-request-id") ?? `openrouter-${crypto.randomUUID()}`,
      asset: { bytes: decodeBase64(encoded), mimeType: "image/png" },
    };
  }
  const requestId = body?.id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return { ok: false, code: "no_request_id", blocked: false };
  }
  // Returns holding a queue ticket; `pollOpenRouterVideoTask` owns the later status requests.
  return { ok: true, requestId };
}

/** One `mediaJobs` row, reduced to what a submit needs. `promptHash` is deliberately absent: the
 *  TEXT comes from the content plane (`plans.shots`), never from the job row. */
type SubmitLine = {
  jobId: Id<"mediaJobs">;
  blockIndex: number;
  model: string;
  spec: Doc<"mediaJobs">["spec"];
  /** WHO supplies the bytes, and therefore which adapter this line is routed to. Read BEFORE the
   *  spec in `submitBatch`: a stock line's spec is its own kind, but routing on the spec would put
   *  the decision one field away from the one that names the vendor. */
  provider: Doc<"mediaJobs">["provider"];
};

/** The stored spec back into a typed `SubmittableSpec`, or `null` for a kind this plan does not
 *  wire. `spec.resolution` is `v.string()` on the row, so it is CHECKED here rather than cast —
 *  a money boundary does not get to assume. */
function toSubmittable(line: SubmitLine): SubmittableSpec | null {
  // BELT AND BRACES, and the same reason `resolution` is checked rather than cast just below: a
  // money boundary does not get to assume. `submitBatch` routes stock away before it reaches here,
  // so this line is unreachable by construction — and if construction ever slips, the failure it
  // prevents is a row whose model is `pexels/v1` being POSTed to OpenAI as a paid generation.
  if (line.provider === "stock") return null;
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
  // A stock line's prompt IS its search query — the same field, read the same way, from the same
  // content plane. `hasAssetSource` refuses a stock scene with a blank one upstream of the money,
  // so nothing reaches here to ask a library for "".
  stock: (s) => s.prompt,
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
    /** 33.1-06: the bed's mood — the music stock line's search text. */
    musicMood: string | null;
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
        provider: r.provider,
      })),
      shots: (plan?.shots ?? []).map((s) => ({
        index: s.index,
        prompt: s.prompt,
        narration: s.narration,
      })),
      imagePrompt: plan?.mediaMode === "image" ? (plan.imagePrompt ?? null) : null,
      // 33.1-06: the bed's mood is the SEARCH for the music stock line, the way a stock scene's
      // prompt is the search for its picture. Read here, beside the other submit-time text.
      musicMood: plan?.artDirection?.music ?? null,
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
 *  the prompt, never the narration (CLAUDE.md §4). No provider URL is stored: the poller re-derives
 *  everything it needs from the jobId and the stored request id, so there is nothing to leak. */
/** 33.1-06: the bed's licence line onto its PLAN. Idempotent (a re-submit rewrites the same
 *  fields), tenant-checked through the job row, and written BEFORE the bytes land so an action
 *  that dies between the two leaves the obligation visible rather than a credited-nothing. */
export const recordMusicCredit = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    credit: v.object({
      title: v.string(),
      creator: v.string(),
      license: v.string(),
      licenseUrl: v.string(),
      sourceUrl: v.string(),
      attribution: v.string(),
    }),
  },
  handler: async (ctx, { jobId, credit }): Promise<null> => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const plan = await ctx.db.get(job.planId);
    if (!plan || plan.tenantId !== job.tenantId) return null;
    await ctx.db.patch(plan._id, { musicCredit: credit });
    return null;
  },
});

/**
 * `blocked` means NOT RETRYABLE. It does not mean the provider judged the content, and the two must
 * not be conflated on the row: `verdict` is rendered as a safety statement (`VERDICT_COPY`), so a
 * `provider_blocked` stamped on a line the provider never saw is a claim nobody made. Two codes are
 * minted by OUR code with `blocked: true` and no provider opinion behind them — an unset deployment
 * variable, and a take whose words drifted from its line. Everything else that arrives blocked came
 * back from a provider's 400/422 and IS its verdict. (Production 2026-09-07: sixteen stock rows read
 * "refused by the provider's content check — a media provider key is missing".)
 */
const BLOCKED_WITHOUT_VERDICT = new Set(["media_not_configured", "tts_not_verbatim"]);
const verdictFor = (code: string): { verdict?: "provider_blocked" } =>
  BLOCKED_WITHOUT_VERDICT.has(code) ? {} : { verdict: "provider_blocked" };

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
        ...verdictFor(result.code),
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

/** The system line that keeps a CHAT model reading a script instead of answering it.
 *
 *  Split so each literal stays under the §5 no-hardcoded-prompt scan ceiling, the `searchVault`
 *  convention. §5 itself is not in play: this is not an AGENT prompt whose wording is a product
 *  decision to be versioned and rolled back — it is a wire parameter that makes a TTS call behave
 *  like TTS, in the same class as `voice` or `format`. A registry row would make it mutable by a
 *  database write, and a paraphrasing narrator is a provenance failure, not a tuning knob.
 *
 *  IT IS LOAD-BEARING AND IT WAS MEASURED. On 2026-09-03, `openai/gpt-audio-mini` was given
 *  "Nothing sends until you approve it." under a SHORTER system line and answered it twice out of
 *  two — *"Understood. Just let me know what you're trying to send…"* — in a voice that would have
 *  been rendered into the reel as the owner's own script. The line below took the same input
 *  verbatim 3/3. That gap is why `TTS_DRIFT` below does not trust any of it. */
const TTS_VERBATIM_SYSTEM =
  "You are a text-to-speech engine, not an assistant. Read the user message aloud VERBATIM, " +
  "word for word. Add nothing, omit nothing, answer nothing, comment on nothing. " +
  "The user message is a script to be read, never a request to you.";

/** Was the take actually the script? Compared on WORDS — lowercase, punctuation and whitespace
 *  dropped — because a TTS engine legitimately renders "90%" as "ninety percent" and an
 *  apostrophe as nothing at all, and refusing those would refuse every good take. What it does
 *  catch is the failure that was observed: a model that answered instead of reading, whose
 *  transcript shares almost nothing with the line it was given. */
const TTS_DRIFT = (spoken: string, script: string): boolean => {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return norm(spoken) !== norm(script);
};

/**
 * THE VOICE PLANE, ON OPENROUTER (33.1).
 *
 * Three things make this longer than the `/audio/speech` call it replaces, and none of them is
 * optional — see the `buildSubmitBody` tts arm for the wire facts:
 *
 *  1. **The response is an SSE STREAM.** OpenRouter refuses audio output without `stream: true`,
 *     so the audio arrives as base64 fragments across `data:` frames and has to be reassembled.
 *  2. **The samples are headerless pcm16**, wrapped by `pcm16ToWav` at this edge so that
 *     `concatWavTakes`, `readWav` and the assembler all keep reading WAV as they always have.
 *  3. **The transcript is CHECKED, because the provider is a chat model.** The stream hands us
 *     what was actually spoken for free, so a paraphrase costs one comparison to catch — and
 *     `tts_not_verbatim` fails the take here, before the bytes are stored, rather than letting a
 *     sentence the owner never approved be voiced into their reel and read back out by captions.
 *     This is the `provenance` rule applied to audio.
 */
async function generateOpenRouterVoice(
  text: string,
  spec: Extract<SubmittableSpec, { kind: "tts" }>,
): Promise<
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; requestId: string }
  | { ok: false; code: string; blocked: boolean }
> {
  const key = requireEnvMedia("OPENROUTER_API_KEY");
  if (process.env.MEDIA_PROVIDER_FIXTURE || process.env.FAL_FIXTURE) {
    return {
      ok: true,
      bytes: new Uint8Array(new ArrayBuffer(44)),
      requestId: `fixture-${crypto.randomUUID()}`,
    };
  }
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

  const raw = await response.text().catch(() => null);
  if (raw === null) return { ok: false, code: "transport_error", blocked: false };

  // The frames carry `delta.audio.{data,transcript}`. A malformed frame is SKIPPED rather than
  // fatal — OpenRouter also emits `: OPENROUTER PROCESSING` comment lines and a `[DONE]` sentinel,
  // and treating either as corruption would fail every healthy call.
  let b64 = "";
  let spoken = "";
  let streamId: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;
    let frame: {
      id?: unknown;
      choices?: Array<{ delta?: { audio?: { data?: unknown; transcript?: unknown } } }>;
    };
    try {
      frame = JSON.parse(payload);
    } catch {
      continue;
    }
    if (streamId === null && typeof frame.id === "string") streamId = frame.id;
    const audio = frame.choices?.[0]?.delta?.audio;
    if (typeof audio?.data === "string") b64 += audio.data;
    if (typeof audio?.transcript === "string") spoken += audio.transcript;
  }

  // No samples is a FAILURE, never a silent take. A zero-length voice line would assemble into a
  // reel with a scene that says nothing and no error anywhere — the defect class this repo bans.
  if (b64 === "") return { ok: false, code: "tts_no_audio", blocked: false };

  // `blocked: true` — retrying cannot help. The model produced sound and it was the wrong words;
  // the same request would drift again, and the take must go back to the owner as a failure.
  if (TTS_DRIFT(spoken, text)) return { ok: false, code: "tts_not_verbatim", blocked: true };

  const pcm = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return {
    ok: true,
    bytes: pcm16ToWav(pcm, spec.sampleRateHertz) as Uint8Array<ArrayBuffer>,
    requestId: streamId ?? `openrouter-${crypto.randomUUID()}`,
  };
}

// ── The STOCK adapter (free library footage and stills) ────────────────────────────────────────
//
// The one adapter that generates nothing. It SEARCHES a free library with the scene's own prompt,
// picks one asset by rules that are entirely about what `assemble_final.sh` can accept, and copies
// the bytes into Convex storage. Two hops, both fail-closed: nothing here retries, guesses a
// fallback asset, or relaxes a filter to find a match.
//
// It costs $0 and it is still a reserved LINE with a real `mediaJobs` row (see
// `MEDIA_STOCK_PRICING`), so it lands, fails and is retried through exactly the machinery every
// paid line uses. There is no second rail.
//
// **LICENSING.** The Pexels licence permits commercial use of these assets inside a composed work
// with no attribution required, and forbids redistributing them UNALTERED as a standalone product.
// A reel is a composed work; a stock clip is never delivered on its own by this pipeline. The
// provider's own id is kept on the row as `providerRequestId` (`pexels:<id>`) so any frame in any
// finished reel can be traced back to what it was cut from — the `asset.docId` rule applied to a
// third party's bytes.

/** The ceiling on ONE fetched asset, before it reaches Convex storage.
 *
 *  A stock library will happily serve a 4K master. Six of those is most of a gigabyte crossing
 *  into a render sandbox we pay a flat constant for, so the size is BOUNDED rather than trusted —
 *  the `MAX_STT_AUDIO_BYTES` idiom. The picker below already prefers a file near the reel's own
 *  720x1280 tier, so this is the backstop for a library that offers nothing small, not the
 *  everyday path. Over it is a governed `stock_asset_too_large`, never a truncated file. */
export const MAX_STOCK_ASSET_BYTES = 24 * 1024 * 1024;

/** How many search results to consider before giving up. Deliberately small: these are ranked by
 *  relevance, and an asset 30 places down is not "the picture the deck asked for" — it is whatever
 *  happened to be long enough. Refusing is the better outcome; the fix menu can swap the scene. */
const STOCK_SEARCH_PER_PAGE = 15;

/** One asset from the free stock library, or a governed code. Synchronous — bytes come back on
 *  this call, like the image and voice adapters and unlike video, so there is no poller. */
/**
 * 33.1-06 — THE MUSIC BED, from Openverse. The Pexels idiom exactly: search, pick, download,
 * cap, land. No key: Openverse's audio index is anonymous at 20/min and 200/day, read off its
 * response headers on 2026-09-04 — one bed per reel does not approach either.
 *
 * `license_type=commercial` is the whole licence gate: only tracks the library marks usable in a
 * commercial reel are searched at all, so a non-commercial CC BY-NC track can never be picked.
 * What survives that filter is CC BY, which is free of charge and NOT free of duty — the
 * attribution string the library supplies is returned as `credit` and lands on the plan.
 * The `instrumental` qualifier is not decoration: a track with vocals under narration is two
 * voices, the exact defect ADR-030 just removed for generated clips.
 */
async function fetchStockMusic(mood: string, seconds: number): Promise<SubmitResult> {
  if (process.env.MEDIA_PROVIDER_FIXTURE || process.env.FAL_FIXTURE) {
    return {
      ok: true,
      requestId: `fixture-music-${crypto.randomUUID()}`,
      asset: { bytes: new Uint8Array(new ArrayBuffer(64)), mimeType: "audio/mpeg" },
      credit: {
        title: "Fixture Bed",
        creator: "Fixture",
        license: "by",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourceUrl: "https://example.invalid/fixture",
        attribution: '"Fixture Bed" by Fixture is licensed under CC BY 4.0.',
      },
    };
  }
  const url = new URL("https://api.openverse.org/v1/audio/");
  url.searchParams.set("q", `${mood} ${MEDIA_MUSIC_STOCK.qualifier}`);
  url.searchParams.set("category", "music");
  url.searchParams.set("license_type", "commercial");
  url.searchParams.set("page_size", String(STOCK_SEARCH_PER_PAGE));
  let search: Response;
  try {
    search = await fetch(url, { headers: { "User-Agent": OPENVERSE_USER_AGENT } });
  } catch {
    return { ok: false, code: "transport_error", blocked: false };
  }
  if (!search.ok) {
    return { ok: false, code: await providerReasonCode(search), blocked: search.status === 400 };
  }
  let picked: ReturnType<typeof pickStockAudio>;
  try {
    picked = pickStockAudio((await search.json()) as Record<string, unknown>, seconds);
  } catch {
    return { ok: false, code: "stock_bad_response", blocked: false };
  }
  if (picked === null) return { ok: false, code: "stock_no_match", blocked: false };
  let file: Response;
  try {
    file = await fetch(picked.link);
  } catch {
    return { ok: false, code: "transport_error", blocked: false };
  }
  if (!file.ok) return { ok: false, code: `stock_fetch_${file.status}`, blocked: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, code: "stock_empty_asset", blocked: false };
  if (bytes.byteLength > MAX_STOCK_ASSET_BYTES) {
    return { ok: false, code: "stock_asset_too_large", blocked: false };
  }
  return {
    ok: true,
    requestId: `openverse:${picked.assetId}`,
    asset: { bytes, mimeType: file.headers.get("content-type") ?? "audio/mpeg" },
    credit: picked.credit,
  };
}

/** Openverse asks callers to identify themselves; a fixed, honest string, never a tenant's. */
const OPENVERSE_USER_AGENT = "pikar-ai/1.0 (media bed; https://pikar.ai)";

/**
 * Openverse's audio rows -> the first track long enough to lie under the whole reel, with its
 * licence line. Exported for the unit tests, the way `pickStockVideo` is.
 *
 * The rules are the assembler's and the licence's, not taste:
 *  - **long enough**: the bed is looped with `-stream_loop -1` and trimmed to the reel, and a
 *    loop seam inside a 15-second reel is audible; a track shorter than the reel is skipped.
 *  - **downloadable**: a row with no `url` cannot be fetched; skipped, never guessed at.
 *  - **credited**: a row with no `attribution` cannot be used under CC BY at all; skipped. The
 *    library writes that line, so the credit the owner copies is the licence's own wording.
 */
export function pickStockAudio(
  body: Record<string, unknown>,
  seconds: number,
): { link: string; assetId: string; credit: MusicCredit } | null {
  const results = body.results;
  if (!Array.isArray(results)) throw new Error("shape");
  const floorMs = (seconds - MEDIA_MUSIC_STOCK.minDurationSlackSeconds) * 1000;
  for (const raw of results) {
    const r = raw as Record<string, unknown>;
    if (typeof r.duration !== "number" || r.duration < floorMs) continue;
    if (typeof r.url !== "string" || !r.url.startsWith("https://")) continue;
    if (typeof r.id !== "string" && typeof r.id !== "number") continue;
    if (typeof r.attribution !== "string" || r.attribution.trim() === "") continue;
    const str = (k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
    return {
      link: r.url,
      assetId: String(r.id),
      credit: {
        title: str("title"),
        creator: str("creator"),
        license: `${str("license")} ${str("license_version")}`.trim(),
        licenseUrl: str("license_url"),
        sourceUrl: str("foreign_landing_url"),
        attribution: r.attribution.trim(),
      },
    };
  }
  return null;
}

async function fetchStock(
  spec: { media: string; seconds: number },
  query: string,
): Promise<SubmitResult> {
  const key = requireEnvMedia("PEXELS_API_KEY");
  if (process.env.MEDIA_PROVIDER_FIXTURE || process.env.FAL_FIXTURE) {
    return {
      ok: true,
      requestId: `fixture-stock-${crypto.randomUUID()}`,
      asset: {
        bytes: new Uint8Array(new ArrayBuffer(64)),
        mimeType: spec.media === "video" ? "video/mp4" : "image/jpeg",
      },
    };
  }

  const isVideo = spec.media === "video";
  const url = new URL(
    isVideo ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search",
  );
  url.searchParams.set("query", query);
  // PINNED, not defaulted. The assembler takes the reel's geometry from its first video scene, so
  // a landscape stock clip silently retunes the whole reel — see MEDIA_DEFAULT_STOCK.
  url.searchParams.set("orientation", MEDIA_DEFAULT_STOCK.orientation);
  url.searchParams.set("per_page", String(STOCK_SEARCH_PER_PAGE));

  let search: Response;
  try {
    search = await fetch(url, { headers: { Authorization: key } });
  } catch {
    return { ok: false, code: "transport_error", blocked: false };
  }
  if (!search.ok) {
    // A rate-limited free tier is a plain failure the retrier may re-run, never a `blocked`
    // verdict: nothing about the DECK was refused. 400 is our own malformed query and is not
    // retryable, so it takes the blocked arm exactly as it does for a generated line.
    return { ok: false, code: await providerReasonCode(search), blocked: search.status === 400 };
  }

  let link: string;
  let assetId: string;
  try {
    const body = (await search.json()) as Record<string, unknown>;
    const picked = isVideo ? pickStockVideo(body, spec.seconds) : pickStockPhoto(body);
    if (picked === null) return { ok: false, code: "stock_no_match", blocked: false };
    ({ link, assetId } = picked);
  } catch {
    return { ok: false, code: "stock_bad_response", blocked: false };
  }

  let file: Response;
  try {
    file = await fetch(link);
  } catch {
    return { ok: false, code: "transport_error", blocked: false };
  }
  if (!file.ok) return { ok: false, code: `stock_fetch_${file.status}`, blocked: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, code: "stock_empty_asset", blocked: false };
  if (bytes.byteLength > MAX_STOCK_ASSET_BYTES) {
    return { ok: false, code: "stock_asset_too_large", blocked: false };
  }
  return {
    ok: true,
    requestId: `pexels:${assetId}`,
    // The CONTENT-TYPE as served, not as guessed from the URL. `storeAndLand` writes it onto the
    // row and the render route serves it back; a wrong mime is a file the sandbox cannot decode.
    asset: {
      bytes,
      mimeType: file.headers.get("content-type") ?? (isVideo ? "video/mp4" : "image/jpeg"),
    },
  };
}

/**
 * The first clip that can COVER its scene, and the rendition of it closest to the reel's own tier.
 *
 * Two rules, both of them the assembler's rather than anyone's taste:
 *
 *  1. **Duration.** `assemble_final.sh` hard-errors when a clip is shorter than its scene by more
 *     than `minDurationSlackSeconds` — "a held still frame is not a scene". A generated clip is
 *     always exactly its grid length, so nothing has ever reached that gate; a stock clip is
 *     whatever the library has. Filtering HERE means a too-short match is a refused scene the fix
 *     menu can swap, instead of a hard render failure after every other input has landed.
 *  2. **Rendition.** The reel is 720x1280, so the file nearest that height is chosen rather than
 *     the largest. This is what keeps `MAX_STOCK_ASSET_BYTES` a backstop instead of a wall.
 *
 * Exported for the test: this is real selection logic over a shape we do not control, and it is
 * the half of the adapter worth pinning without a network.
 */
export function pickStockVideo(
  body: Record<string, unknown>,
  seconds: number,
): { link: string; assetId: string } | null {
  const videos = body.videos;
  if (!Array.isArray(videos)) throw new Error("shape");
  const floor = seconds - MEDIA_DEFAULT_STOCK.minDurationSlackSeconds;
  for (const raw of videos) {
    const video = raw as { id?: unknown; duration?: unknown; video_files?: unknown };
    if (typeof video.duration !== "number" || video.duration < floor) continue;
    if (typeof video.id !== "number" && typeof video.id !== "string") continue;
    if (!Array.isArray(video.video_files)) continue;
    const files = video.video_files
      .map((f) => f as { link?: unknown; file_type?: unknown; height?: unknown; width?: unknown })
      .filter(
        (f): f is { link: string; height: number; width: number } =>
          typeof f.link === "string" &&
          typeof f.height === "number" &&
          typeof f.width === "number" &&
          f.file_type === "video/mp4",
      )
      // Portrait renditions first — a landscape file from a portrait-filtered result would still
      // set the reel's geometry, which is the failure the orientation parameter exists to prevent.
      .sort(
        (l, r) =>
          Number(r.height >= r.width) - Number(l.height >= l.width) ||
          Math.abs(l.height - 1280) - Math.abs(r.height - 1280),
      );
    const best = files[0];
    if (best) return { link: best.link, assetId: String(video.id) };
  }
  return null;
}

/**
 * The top photo, at the rendition the Ken Burns path actually needs.
 *
 * `large2x` before `portrait`: the assembler upscales a still 4x before `zoompan` so the crop
 * window can step in quarter-pixels, and the library's `portrait` rendition is a fixed 800x1200
 * crop that would be doing that from well under the output tier. `original` is last because it can
 * be a 25-megapixel master — inside the byte cap it is simply slower for no visible gain.
 */
export function pickStockPhoto(
  body: Record<string, unknown>,
): { link: string; assetId: string } | null {
  const photos = body.photos;
  if (!Array.isArray(photos)) throw new Error("shape");
  for (const raw of photos) {
    const photo = raw as { id?: unknown; src?: Record<string, unknown> };
    if (typeof photo.id !== "number" && typeof photo.id !== "string") continue;
    const src = photo.src ?? {};
    const link = ["large2x", "large", "portrait", "original"]
      .map((k) => src[k])
      .find((u): u is string => typeof u === "string" && u.length > 0);
    if (link) return { link, assetId: String(photo.id) };
  }
  return null;
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

/**
 * THE LIVE VIDEO POLLER. Poll one OpenRouter video job and copy the completed MP4 into tenant
 * storage. The content endpoint is called immediately after completion because provider-side job
 * assets are not our durable workspace artifact.
 *
 * **Every URL here is CONSTRUCTED from the id we hold, and no URL from the provider's response is
 * ever fetched.** The 2026-08-30 probe settled why that is the right call rather than a paranoid
 * one: the response's `unsigned_urls[0]` is, despite the name, an ordinary authenticated endpoint —
 * fetching it without our bearer returns 401 — so following it would mean sending our credential to
 * whatever host a provider response named. `GET /videos/{id}/content?index=0`, which we build, was
 * measured returning the same 4 471 786 bytes of `ftypisom` MP4. Not accepting a foreign value is
 * strictly stronger than host-checking one, and here it costs nothing. `polling_url` is likewise
 * absent from this function's args on purpose.
 *
 * **This is NOT a branch-for-branch copy of the (deleted) Sora poller, and the difference is the whole
 * reason it is a separate function.** Sora emits `queued | in_progress | completed | failed`;
 * OpenRouter emitted only `pending` then `completed` across nine measured polls — `pending` is on
 * NEITHER of Sora's in-progress names. So this poller inverts the test: it treats `completed` and
 * `failed` as the only terminal states and reschedules on ANYTHING else. Enumerating an
 * in-progress allow-list, as the Sora poller does, would land `provider_failed` on the very first
 * poll of every job — a fully green suite over a pipeline that never delivers a single video.
 * Fail-open toward retrying is safe here only because the 180-attempt ceiling below bounds it: an
 * unrecognised state costs a delay and then `poll_timeout`, never an unbounded loop.
 */
export const pollOpenRouterVideoTask = internalAction({
  args: { jobId: v.id("mediaJobs"), videoId: v.string(), attempt: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const key = requireEnvMedia("OPENROUTER_API_KEY");
    const row = await ctx.runQuery(internal.media.jobForPoll, { jobId: a.jobId });
    // The CAS that makes a duplicate schedule free: only a still-`submitted` video row is polled.
    if (!row || row.status !== "submitted" || row.spec.kind !== "video") return null;

    const base = `https://openrouter.ai/api/v1/videos/${encodeURIComponent(a.videoId)}`;

    let response: Response;
    try {
      response = await fetch(base, { headers: { Authorization: `Bearer ${key}` } });
    } catch {
      if (a.attempt < 180) {
        await ctx.scheduler.runAfter(10_000, internal.media.pollOpenRouterVideoTask, {
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

    if (status === "failed") {
      const candidate = body?.error?.code;
      const code =
        typeof candidate === "string" && SAFE_CODE.test(candidate) ? candidate : "provider_failed";
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: a.jobId,
        outcome: { ok: false, code },
      });
      return null;
    }
    // NOT `completed` and NOT `failed` — including `pending`, an unparseable body, and any status
    // this vendor adds later. Reschedule; the ceiling is what keeps that safe.
    if (status !== "completed") {
      if (a.attempt >= 180) {
        await ctx.runMutation(internal.mediaComplete.landResult, {
          jobId: a.jobId,
          outcome: { ok: false, code: "poll_timeout" },
        });
      } else {
        await ctx.scheduler.runAfter(10_000, internal.media.pollOpenRouterVideoTask, {
          ...a,
          attempt: a.attempt + 1,
        });
      }
      return null;
    }

    let asset: Response;
    try {
      asset = await fetch(`${base}/content?index=0`, {
        headers: { Authorization: `Bearer ${key}` },
      });
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
    const { lines, shots, imagePrompt, musicMood } = await ctx.runQuery(
      internal.media.batchToSubmit,
      a,
    );
    const tally = { submitted: 0, blocked: 0, failed: 0, skipped: 0 };

    for (const line of lines) {
      // ── ONE TRY AROUND THE WHOLE LINE, AND IT IS NOT DEFENSIVE PADDING ────────────────────
      //
      // Observed live 2026-09-03: a deck with free stock scenes on a deployment with no
      // `PEXELS_API_KEY` reached `fetchStock`, which calls `requireEnvMedia` and THROWS — after
      // `claimLine` had already moved the row out of `queued`. The action died, no
      // `recordSubmission` ran, and the reel sat at "Waiting" forever with no failure anywhere on
      // screen or in the ledger. **A silent stall is strictly worse than a failure**, and it is
      // worse than the throw was meant to be: `requireEnvMedia` throws to fail CLOSED before a cent
      // moves, which it still does — the throw simply must not also strand the row it claimed.
      //
      // Caught HERE rather than converted inside each adapter, because every adapter has the same
      // shape (claim, then a call that may throw) and a fix applied adapter-by-adapter is the
      // repair that reaches two sites of three. `submitLine` and `generateOpenRouterVoice` still
      // throw on a missing credential, and their tests still assert it.
      try {
        // ── STOCK, ROUTED BY PROVIDER AND ROUTED FIRST ──────────────────────────────────────
        //
        // Before `toSubmittable`, which deliberately refuses a stock line: reaching it would leave
        // the row `queued` forever and the reel would never render. Kept as its own arm rather than
        // threaded through the paid path below — six duplicated lines, against nullable narrowing
        // running through twenty lines of code that spends real money. The paid path is untouched.
        if (line.provider === "stock" && line.spec.kind === "stock") {
          const stock = line.spec;
          if (!(await ctx.runMutation(internal.media.claimLine, { jobId: line.jobId }))) {
            tally.skipped += 1;
            continue;
          }
          // 33.1-06: the MUSIC BED is a stock line too — deck-wide, searched by the art direction's
          // mood rather than a scene's prompt, from Openverse rather than Pexels.
          const isBed = stock.media === "audio";
          const stockShot = isBed ? undefined : shots.find((s) => s.index === line.blockIndex);
          const query = isBed
            ? (musicMood ?? undefined)
            : stockShot && SUBMIT_TEXT.stock?.(stockShot);
          if (query === undefined) {
            await ctx.runMutation(internal.media.recordSubmission, {
              jobId: line.jobId,
              result: { ok: false, blocked: false, code: "missing_shot" },
            });
            tally.failed += 1;
            continue;
          }
          const found = isBed
            ? await fetchStockMusic(query, stock.seconds)
            : await fetchStock(stock, query);
          if (found.ok && found.credit) {
            // The licence line rides on the PLAN (the canvas and the vault document read it there),
            // written before the bytes land so a crash between the two leaves the duty visible.
            await ctx.runMutation(internal.media.recordMusicCredit, {
              jobId: line.jobId,
              credit: found.credit,
            });
          }
          if (!found.ok) {
            await ctx.runMutation(internal.media.recordSubmission, {
              jobId: line.jobId,
              result: { ok: false, blocked: found.blocked, code: found.code },
            });
            if (found.blocked) tally.blocked += 1;
            else tally.failed += 1;
            continue;
          }
          await ctx.runMutation(internal.media.recordSubmission, {
            jobId: line.jobId,
            result: { ok: true, providerRequestId: found.requestId },
          });
          if (!found.asset) {
            // Structurally unreachable — `fetchStock` never returns ok without bytes — but the
            // landing plane treats "succeeded with no asset" as an impossible state that refuses the
            // render, so it is named here rather than left to become one.
            await ctx.runMutation(internal.mediaComplete.landResult, {
              jobId: line.jobId,
              outcome: { ok: false, code: "asset_missing" },
            });
            tally.failed += 1;
            continue;
          }
          await storeAndLand(ctx, line.jobId, found.asset.bytes, found.asset.mimeType);
          tally.submitted += 1;
          continue;
        }

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
          spec.kind === "image" && imagePrompt
            ? imagePrompt
            : shot && SUBMIT_TEXT[spec.kind]?.(shot);
        if (text === undefined) {
          await ctx.runMutation(internal.media.recordSubmission, {
            jobId: line.jobId,
            result: { ok: false, blocked: false, code: "missing_shot" },
          });
          tally.failed += 1;
          continue;
        }

        if (spec.kind === "tts") {
          const voice = await generateOpenRouterVoice(text, spec);
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
          await ctx.scheduler.runAfter(10_000, internal.media.pollOpenRouterVideoTask, {
            jobId: line.jobId,
            videoId: res.requestId,
            attempt: 0,
          });
        }
        tally.submitted += 1;
      } catch (err) {
        // The row is CLAIMED by the time anything in here can throw — both arms claim before they
        // call an adapter — so it must be given a terminal state or it is stranded: `claimLine`
        // will not re-claim it and no retry can reach it again.
        //
        // §4: the CODE only, never the provider's or the runtime's prose. A thrown message can
        // carry a url, a request body, or a fragment of the narration it was submitting.
        // `media_not_configured` is the one case worth naming precisely, because it is an
        // OPERATOR fault with an operator fix and it reads very differently from a provider
        // outage. `blocked: true` on it: retrying an unset deployment variable cannot help.
        const missingEnv = err instanceof Error && /Media env not configured/.test(err.message);
        await ctx.runMutation(internal.media.recordSubmission, {
          jobId: line.jobId,
          result: {
            ok: false,
            blocked: missingEnv,
            code: missingEnv ? "media_not_configured" : "submit_threw",
          },
        });
        if (missingEnv) tally.blocked += 1;
        else tally.failed += 1;
      }
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
      ...(a.result.blocked ? verdictFor(a.result.code) : {}),
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
    // 33.1-06: OpenRouter, like every other paid plane. It DOES serve whisper-1 with word
    // timestamps — see the note on the fetch below for why that took a second look.
    const key = requireEnvMedia("OPENROUTER_API_KEY");

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
    // UNSTRIPPED. The strip existed because this posted to OpenAI's own API, which does not know
    // a route prefix. OpenRouter DOES route on it — `whisper-1` bare is rejected there, and
    // `openai/whisper-1` is accepted. Third arm to learn this, after image and tts.
    form.append("model", job.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    let response: Response;
    try {
      // WHY THIS IS NOT ON OPENAI'S OWN HOST ANY MORE, and why the first look said it had to be:
      // OpenRouter's `/models` catalogue lists CHAT models only, so grepping it for a Whisper
      // turns up nothing and invites the conclusion that transcription cannot move. It can. The
      // catalogue is not the API surface — probed 2026-09-03, `openai/whisper-1` here returns
      // `verbose_json` with complete per-word `start`/`end`, 9/9 well-formed, at $0.0060/minute,
      // which is the SAME rate as OpenAI's, hence no change to MEDIA_STT_PRICING.
      response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
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
    const requestId = response.headers.get("x-request-id") ?? `openrouter-${crypto.randomUUID()}`;
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
 * RESET THE RENDER PLANE. **One helper, six callers**, and that is deliberate: six copies of the
 * same multi-field patch is exactly how one of them ends up missing a field.
 *
 * **33-05 REWROTE WHAT "CLEAR" MEANS — the old final is HELD, not dropped.** Until this wave the
 * artifact fields were unset here, on the argument that a canvas showing a stale `final.mp4`
 * beside a changed deck is a lie. That unset had two costs the phase-33 contract refuses: the
 * canvas goes DARK for the whole regenerate (the "old final keeps playing" must-have), and the
 * orphaned blob was never deleted — a silent leak. Now:
 *   - `renderStatus` returns to `pending` and the failure fields clear — the PIPELINE resets;
 *   - `renderStorageId` / `sidecarStorageId` / `sidecarHash` / `renderSummary` are KEPT — the
 *     validated triple stays servable (`media.reel`), and the stale-vs-never-built distinction is
 *     the canvas's landed-asset count (ReelRegion's `outOfDate`), which already exists;
 *   - the old blob is deleted by the NEXT success terminal (`deleteOrphanedFinals` in
 *     `render/renderReel.ts`), once neither the plan nor the reel's vault doc references it;
 *   - the CAPTION plane resets too: a stale `captioned`/`failed` would make `maybeStartCaptions`
 *     skip the new batch's reserved caption line forever;
 *   - `renderRetriedAt` resets: every reservation prices the render line DOUBLED ("incl. one
 *     retry"), so a new purchase carries a fresh automatic retry. Manual `retryRender` still
 *     never resets it — that path buys nothing.
 *
 * Convex unsets a field by patching it to `undefined`.
 */
async function clearRender(ctx: MutationCtx, planId: Id<"plans">): Promise<void> {
  await ctx.db.patch(planId, {
    renderStatus: "pending",
    renderReason: undefined,
    renderedAt: undefined,
    renderRetriedAt: undefined,
    captionStatus: undefined,
    captionReason: undefined,
    captionOffsetsS: undefined,
  });
}

/** The deck as `reserveJobInner` wants it, or null when the plan carries nothing reservable. The
 *  `cockpit.ts:668` boundary check verbatim — a money gate does not assume its writer was correct. */
export function deckOf(plan: Doc<"plans">): readonly Block[] | null {
  const shots = plan.shots ?? [];
  if (shots.length === 0 || plan.clipSeconds === undefined) return null;
  // 20.2: `type` is now optional on the row, and a SCENE row does not write it. That absence is
  // load-bearing rather than incidental — it is what stops a scene deck being read here as a block
  // deck and priced at a uniform `clipSeconds` it was never written against. Fail closed.
  if (
    !shots.every((s) => s.type !== undefined && (SHOT_TYPES as readonly string[]).includes(s.type))
  )
    return null;
  return shots.map((s) => ({
    index: s.index,
    type: s.type as ShotType,
    seconds: s.seconds,
    windowStartMs: s.windowStartMs,
    description: s.description,
    ...(s.overlay === undefined ? {} : { overlay: s.overlay }),
    prompt: s.prompt,
    narration: s.narration,
  }));
}

/**
 * The scene deck as `Scene[]`, or null (20.2).
 *
 * `deckOf`'s twin, and the two are MUTUALLY EXCLUSIVE by construction: a row carries `type` or
 * `visual`, never both, so exactly one of these functions can return non-null for a given plan.
 * That is why neither needs to know about the other.
 *
 * `startMs` and `durationMs` are read straight off `windowStartMs` and `seconds` rather than
 * re-derived from an index — those two columns ARE the timeline, and re-deriving them is the
 * uniform-grid assumption this phase exists to remove.
 */
export function sceneDeckOf(
  plan: Doc<"plans">,
): { targetDurationSeconds: number; scenes: Scene[] } | null {
  const shots = plan.shots ?? [];
  if (shots.length === 0 || plan.targetDurationSeconds === undefined) return null;
  if (
    !shots.every(
      (s) => s.visual !== undefined && (VISUAL_KINDS as readonly string[]).includes(s.visual),
    )
  ) {
    return null;
  }
  return {
    targetDurationSeconds: plan.targetDurationSeconds,
    scenes: shots.map((s) => ({
      index: s.index,
      startMs: s.windowStartMs,
      durationMs: s.seconds * 1000,
      visual: s.visual as VisualKind,
      ...(s.asset === undefined ? {} : { asset: s.asset }),
      description: s.description,
      narration: s.narration,
      ...(s.overlay === undefined ? {} : { overlay: s.overlay }),
      prompt: s.prompt,
    })),
  };
}

/** One `mediaJobs` row reduced to what a tile shows. NO url — that is `assetUrls`' job alone. */
type JobFace = {
  status: string;
  verdict: string | null;
  model: string;
  estUsd: number;
  actualCents: number | null;
  /** 33-08 — the failure CODE, on the same face whose `status` the canvas is describing.
   *
   *  `assetUrls` also carries it, and reading it from THERE would have been a change-free option
   *  and a wrong one: that query returns every attempt oldest-first while this face is one chosen
   *  row, so on a regenerated scene the two can name different attempts. A card that says "failed"
   *  from one row and prints the other row's code is a support ticket built by hand.
   *
   *  Safe to project by the same rule that lets it be stored: `mediaJobs.failureReason` is a CODE
   *  (the `calendar.ts:84` idiom, schema-commented) — never provider prose (§4). */
  failureReason: string | null;
};

const faceOf = (row: Doc<"mediaJobs"> | undefined): JobFace | null =>
  row
    ? {
        status: row.status,
        verdict: row.verdict ?? null,
        model: row.model,
        estUsd: row.estUsd,
        actualCents: row.actualCents ?? null,
        failureReason: row.failureReason ?? null,
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

    const deckMaxChars =
      plan.clipSeconds === undefined ? MAX_CHARS_PER_BLOCK : maxCharsFor(plan.clipSeconds);
    // 20.2 wave 6 — on a SCENE deck the narration ceiling is the TAKE's window, not the deck's
    // longest scene. `clipSeconds` on a scene row is the longest scene (`persistSceneDeck` says
    // so), which is loose in both directions: it lets the canvas accept a line the money gate will
    // refuse, and it under-states the room a line before a silent scene actually has. The canvas
    // has to show the number the reserve will apply, or the count beside the textarea is a guess.
    const sceneDeck = sceneDeckOf(plan);
    return await Promise.all(
      (plan.shots ?? []).map(async (shot, position) => {
        // The job's OWN blockIndex is authoritative, never the array position — see the reorder
        // ceiling on `reorderBlocks`.
        const mine = rows.filter((r) => r.blockIndex === shot.index);
        const clipRow = mine.find((r) => r.kind === "video" || r.kind === "image");
        const voiceRow = mine.find((r) => r.kind === "tts");
        const maxChars = sceneDeck
          ? maxCharsFor(narrationCeilingSeconds(sceneDeck.scenes, position))
          : deckMaxChars;
        return {
          blockIndex: shot.index,
          // DISPLAY ONLY, and the one place the two closed sets are allowed to meet. A block row
          // carries `type`, a 20.2 scene row carries `visual`, and a tile has to label whichever it
          // was handed. Collapsing them is safe HERE precisely because it is safe nowhere else:
          // `deckOf` keeps them apart on the money path, where reading a scene as a block would
          // price it at the wrong duration. This is a projection for a caption.
          type: shot.type ?? shot.visual ?? "",
          /** 20.2 wave 6, and NOT the same field as `type` above. The canvas branches on the KIND
           *  — a card has no clip to wait for, an upload needs a vault document, a still is panned
           *  rather than generated — so it needs the closed set itself, not a label. `null` on a
           *  block row, which is what makes "is this a scene deck?" answerable on the client. */
          visual: shot.visual ?? null,
          /** THIS scene's own place on the timeline. The canvas sizes its tiles from them, so they
           *  come off the row rather than being re-derived from an index and a deck-wide length —
           *  that arithmetic is the uniform contract this phase removed. */
          startMs: shot.windowStartMs,
          durationMs: shot.seconds * 1000,
          /** The vault document an `uploaded_video` names, so the picker can show what is chosen
           *  and the tile can say when nothing is. A REF, never bytes and never a URL. */
          asset: shot.asset ?? null,
          description: shot.description,
          overlay: shot.overlay ?? null,
          prompt: shot.prompt,
          narration: shot.narration,
          narrationChars: shot.narration.length,
          maxChars,
          overCharLimit: shot.narration.length > maxChars,
          clip: faceOf(clipRow),
          voice: faceOf(voiceRow),
          /** **BOUGHT FOR TEXT THAT HAS SINCE CHANGED.** A landed asset survives a free edit — the
           *  render reuses it, deliberately, because it is the only footage that exists (see
           *  `batchToRender`'s `stale_inputs` note). That makes it the one thing about a reel a
           *  user cannot otherwise see: the tile says "your line changed since this take was
           *  recorded", and the cure is the regenerate control right beside it. The comparison is
           *  the job's own `promptHash` against the shot's current text — the same hash the
           *  reserve wrote, so it cannot drift from what was actually bought. */
          clipStale: clipRow ? clipRow.promptHash !== (await contentHash(shot.prompt)) : false,
          voiceStale: voiceRow
            ? voiceRow.promptHash !== (await contentHash(shot.narration))
            : false,
        };
      }),
    );
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
      sceneCount: null as number | null,
      gates: [] as string[],
      reason: null as string | null,
    };
    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (!plan) return empty;

    const base = { ...empty, status: plan.renderStatus ?? null, reason: plan.renderReason ?? null };

    // **THE URL GUARANTEE, and where it actually comes from.** `renderSummary` is written by
    // `recordRender` ONLY on the success arm, in the same patch as the two storage ids, and ONLY
    // after `parseAssemblySidecar` accepted the bytes that landed in our storage. So requiring all
    // THREE here is requiring the sidecar to have validated — the check is at the WRITE, which is
    // the only place it can be, because `ctx.storage` in a query is a `StorageReader` with `getUrl`
    // and no way to read a blob at all.
    //
    // 33-05: `renderStatus` is deliberately NOT part of the guarantee any more. `clearRender`
    // HOLDS the artifact triple through a regenerate, so a plan at `pending`/`rendering`/`failed`
    // with the triple intact is a plan whose OLD governed final is still the thing to show — the
    // status is reported beside it and the canvas says "out of date" from the landed count.
    if (!plan.renderStorageId || !plan.sidecarStorageId || !plan.renderSummary) {
      return base;
    }

    return {
      ...base,
      url: await ctx.storage.getUrl(plan.renderStorageId),
      durationS: plan.renderSummary.durationS,
      // One name on the wire, both names in the store: a reel rendered before wave 6 wrote
      // `blockCount` for the same count, and it is a published artifact rather than something to
      // migrate. The canvas says "scenes" either way.
      sceneCount: plan.renderSummary.sceneCount ?? plan.renderSummary.blockCount ?? null,
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
    // 20.2 wave 5 — the scene gate OPENS here in the same commit it opens at `generateReel`, and
    // that co-location is the point: a working Generate button behind a refusing estimate would
    // spend money the canvas never showed. The whole purpose of this query is to name the number
    // BEFORE the button is pressed, so the two must open together or not at all.
    const sceneDeck = sceneDeckOf(plan);
    if (sceneDeck !== null) {
      const { scenes, targetDurationSeconds } = sceneDeck;

      // The SAME pre-flight refusals `reserveSceneJobInner` applies, in the same order.
      if (scenes.reduce((n, s) => n + s.durationMs, 0) / 1000 !== targetDurationSeconds) {
        return { ...empty, refusal: { reason: "illegal_duration" } };
      }
      // 33-03 — the confirm gate OPENS here in the same position it opens at the reserve, FREE:
      // the block happens where every other block happens, before the button. `blockIndex` names
      // the first offending scene so the canvas can point at the chip to confirm.
      const claim = firstUnconfirmedClaim(plan.shots);
      if (claim) {
        return { ...empty, refusal: { reason: "unconfirmed_claims", blockIndex: claim.index } };
      }
      const specs: MediaSpec[] = [];
      let clipSecondsTotal = 0;
      let voiceChars = 0;
      for (const [i, s] of scenes.entries()) {
        if (!hasAssetSource(s)) {
          return { ...empty, refusal: { reason: "unrenderable_block", blockIndex: s.index } };
        }
        const seconds = s.durationMs / 1000;
        // The SAME table `reserveSceneJobInner` reserves from, so the number on screen and the
        // number the rail consumes cannot drift — that used to be two hand-copied branches.
        const picture = sceneVisualSpec(s.visual, seconds);
        if (!picture.ok) return { ...empty, refusal: { reason: picture.error.code } };
        if (picture.value !== null) {
          specs.push(picture.value.spec);
          if (picture.value.spec.kind === "video") clipSecondsTotal += seconds;
        }
        if (s.narration !== "") {
          const availableSeconds = narrationCeilingSeconds(scenes, i);
          if (s.narration.length > maxCharsFor(availableSeconds)) {
            return {
              ...empty,
              refusal: {
                reason: "narration_too_long",
                blockIndex: s.index,
                chars: s.narration.length,
              },
            };
          }
          const characters = s.narration.length * 2; // the 2x rewrite allowance, as reserved
          voiceChars += characters;
          specs.push({ kind: "tts", model: MEDIA_DEFAULT_VOICE.model, characters });
        }
      }
      const audioMinutes = targetDurationSeconds / 60;
      specs.push({ kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes });
      // The SAME reader `reserveSceneJobInner` uses, in the same position of the same order — so
      // the estimate and the reserve cannot disagree about whether this deck has a bed.
      const music = musicSpecOf(plan);
      if (music !== null) specs.push(music);
      specs.push({ kind: "render" });

      const priced = chooseMediaBatch(specs, MEDIA_JOB_CAP_USD);
      if (!priced.ok) return { ...empty, refusal: { reason: priced.error.code } };
      const sub = (of: MediaSpec[]): number =>
        Math.round(
          of.reduce((n, x) => {
            const p = estimateMediaUsd(x);
            return n + (p.ok ? p.value : 0);
          }, 0) * 100,
        );
      const voiceCount = scenes.filter((s) => s.narration !== "").length;
      const clips = specs.filter((x) => x.kind === "video");
      const stills = specs.filter((x) => x.kind === "image");
      const stock = specs.filter((x) => x.kind === "stock");
      const stockClips = stock.filter((x) => x.kind === "stock" && x.media === "video").length;
      return {
        // ONE LINE PER PAID KIND (wave 7). Wave 5 printed a blended `pictures` row because the
        // price table did not exist yet; a generated clip is 40x a still, so the blend hid the only
        // lever the user has. D7's requirement is that the estimate names WHICH line is expensive
        // BEFORE the button is clickable, and a mixed deck's expensive line is always the clips.
        // A kind the deck does not use is omitted rather than printed at zero. `uploaded_video` and
        // `text_card` have no line at all — they buy nothing, and the ribbon above already shows
        // them.
        lines: [
          ...(clips.length > 0
            ? [
                {
                  label: "clips",
                  qty: clips.length,
                  unit: `${clipSecondsTotal}s of ${targetDurationSeconds}s ${MEDIA_DEFAULT_VIDEO.resolution}`,
                  cents: sub(clips),
                },
              ]
            : []),
          ...(stills.length > 0
            ? [{ label: "stills", qty: stills.length, unit: "pan/zoom", cents: sub(stills) }]
            : []),
          // PRINTED AT ZERO when the deck uses stock, for the music line's reason: this is not "a
          // kind the deck does not use", it is a kind the deck DOES use that happens to cost
          // nothing. It is also the one line that teaches the lever — an owner reading "stock 3
          // free" beside "clips 1 $0.40" can see what swapping the next clip would save.
          ...(stock.length > 0
            ? [
                {
                  label: "stock",
                  qty: stock.length,
                  unit: `${stockClips} clip${stockClips === 1 ? "" : "s"}, ${stock.length - stockClips} still${stock.length - stockClips === 1 ? "" : "s"}`,
                  cents: sub(stock),
                },
              ]
            : []),
          {
            label: "voice",
            qty: voiceCount,
            unit: `${voiceChars} chars`,
            cents: sub(specs.filter((x) => x.kind === "tts")),
          },
          {
            label: "captions",
            qty: 1,
            unit: `${audioMinutes.toFixed(2)} min`,
            cents: sub(specs.filter((x) => x.kind === "stt")),
          },
          // PRINTED AT ZERO, deliberately breaking the "omit a kind the deck does not use" rule
          // above — because it is not the same rule. A kind the deck does not use has no line;
          // a bed the deck DOES declare has a line that happens to cost nothing, and hiding it
          // would make the reel look like it was built from fewer inputs than it was. The owner
          // should be able to read the estimate and see the bed they approved.
          ...(music !== null
            ? [{ label: "music", qty: 1, unit: `${music.mood} bed`, cents: sub([music]) }]
            : []),
          // 33-04: the label names what the doubled constant covers — one auto-retry sandbox.
          {
            label: "render (incl. one retry)",
            qty: 1,
            unit: "sandbox",
            cents: sub([{ kind: "render" }]),
          },
        ],
        totalCents: priced.value.estCents,
        capCents,
        remainingCents,
        refusal: null,
      };
    }
    const blocks = deckOf(plan);
    const clipSeconds = plan.clipSeconds;
    if (!blocks || clipSeconds === undefined) return empty;

    // The SAME pre-flight refusals `reserveJobInner` applies, in the same order, so the canvas can
    // name the lever BEFORE the button is pressed rather than after.
    if (!isBuyableClipLength(clipSeconds)) {
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
        // 33-04: the label names what the doubled constant covers — one auto-retry sandbox.
        label: "render (incl. one retry)",
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
  a: {
    tenantId: string;
    planId: Id<"plans">;
    /** ONE contract or the other, never both — the same discriminator `deckOf` / `sceneDeckOf`
     *  already enforce on the row. Passed in rather than re-read here so the caller's own refusal
     *  ("this plan has no deck at all") stays the caller's. */
    deck:
      | { kind: "block"; blocks: readonly Block[]; clipSeconds: number }
      | {
          kind: "scene";
          scenes: readonly Scene[];
          targetDurationSeconds: number;
          /** 20.2 wave 6 — buy ONE scene of this deck. The block arm expresses the same thing by
           *  passing a one-element `blocks`, which a scene deck cannot do: its scenes have to sum
           *  to the declared target, so the whole timeline goes in and the purchase is narrowed. */
          only?: number;
        };
  },
): Promise<
  { ok: true; batchId: string; estCents: number } | { ok: false; reason: ReserveRefusal }
> {
  // PINNED true in both arms, the `cockpit.ts:681` reasoning verbatim: the fail-closed direction is
  // over-reserving, and an unused STT line costs $0.008 while an unreserved one that IS used is
  // spend outside the rail.
  const reserved =
    a.deck.kind === "scene"
      ? await reserveSceneJobInner(ctx, {
          tenantId: a.tenantId,
          planId: a.planId,
          scenes: a.deck.scenes,
          targetDurationSeconds: a.deck.targetDurationSeconds,
          withCaptions: true,
          ...(a.deck.only === undefined ? {} : { only: a.deck.only }),
        })
      : await reserveJobInner(ctx, {
          tenantId: a.tenantId,
          planId: a.planId,
          blocks: a.deck.blocks,
          clipSeconds: a.deck.clipSeconds,
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
    // 20.2 wave 5 — THE SCENE GATE OPENS. Wave 2 put a `scene_render_not_ready` refusal here
    // because a scene deck reaching `deckOf` returns null and would have refused as `no_deck`,
    // which was a lie: the deck parsed and was on screen. Everything it was waiting for now
    // exists — the assembler builds three kinds of scene, the sidecar describes them, and
    // `reserveSceneJobInner` prices them per kind. This is where a scene deck becomes BUYABLE.
    const sceneDeck = sceneDeckOf(plan);
    let res: Awaited<ReturnType<typeof reserveAndSchedule>>;
    if (sceneDeck !== null) {
      res = await reserveAndSchedule(ctx, {
        tenantId: ctx.tenantId,
        planId,
        deck: { kind: "scene", ...sceneDeck },
      });
      // 33-03 — GENERATE IS THE POINT OF NO RETURN for variations, in the SAME transaction as the
      // reservation: the pick is bought, so it locks (`switchDeck`/`editBrief` refuse from here),
      // and the unpicked deck is DISCARDED rather than parked forever beside a deck it can no
      // longer replace. `undefined` deletes on a direct patch. A refusal locks and discards
      // NOTHING — the refusal is free, and the choice is still the user's.
      if (res.ok) {
        await ctx.db.patch(planId, {
          deckLockedAt: Date.now(),
          altShots: undefined,
          altTargetDurationSeconds: undefined,
        });
      }
    } else {
      const blocks = deckOf(plan);
      if (!blocks || plan.clipSeconds === undefined)
        return { ok: false as const, reason: "no_deck" };
      res = await reserveAndSchedule(ctx, {
        tenantId: ctx.tenantId,
        planId,
        deck: { kind: "block", blocks, clipSeconds: plan.clipSeconds },
      });
    }
    // 33.2-04 — GENERATE IS THE APPROVAL. This is the canvas's paid entry point and it bought the
    // whole reel, yet the plan stayed `proposed`: the approvals page kept listing it under
    // "awaiting" with an Approve button whose media pre-step would have reserved the ENTIRE deck a
    // second time (owner-reported 2026-09-05 on a rendered reel — the double approval was also a
    // double bill waiting to happen). The plan row now says what `cockpit.executePlan`'s media arm
    // says at the same point: `delivering` (the reservation already set `renderStatus: "pending"`),
    // and `recordRender` closes it to `done`. `executePlan`'s CAS refuses anything but `proposed`,
    // so the card can no longer be approved twice from either door.
    if (res.ok) await ctx.db.patch(planId, { status: "delivering" });
    return res;
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
    // IN-FLIGHT ONLY (25.1-03, D8). `succeeded` used to sit in this set, and NOTHING ever deletes a
    // `mediaJobs` row — so the first image a plan produced locked the button for ever, with the
    // canvas saying only "already started" about work that had finished. A finished image is
    // history (the `failed`/`blocked` reasoning in the doc comment above, one rung further); it is
    // now durably in the vault (D5), so generating another cannot lose it either. The double-click
    // guard this exists for lives entirely in the two non-terminal states.
    if (
      rows.some(
        (row) => row.kind === "image" && (row.status === "queued" || row.status === "submitted"),
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
    // 20.2 wave 6 — THE SCENE ARM OPENS. Re-buying one scene in isolation would reserve a batch
    // whose scenes do not add up to the declared target, so the WHOLE timeline is handed to the
    // reserve and only the purchase is narrowed (`only`). The render then takes this scene's new
    // asset and its neighbours' existing ones off the plan — see `batchToRender`, which until this
    // wave read the batch alone and refused every partial buy, block decks included.
    const sceneDeck = sceneDeckOf(plan);
    if (sceneDeck !== null) {
      if (!sceneDeck.scenes.some((s) => s.index === blockIndex)) {
        return { ok: false as const, reason: "no_deck" as const };
      }
      return await reserveAndSchedule(ctx, {
        tenantId: ctx.tenantId,
        planId,
        deck: { kind: "scene", ...sceneDeck, only: blockIndex },
      });
    }
    const blocks = deckOf(plan);
    if (!blocks || plan.clipSeconds === undefined) return { ok: false as const, reason: "no_deck" };
    const one = blocks.find((b) => b.index === blockIndex);
    if (!one) return { ok: false as const, reason: "no_deck" };
    return await reserveAndSchedule(ctx, {
      tenantId: ctx.tenantId,
      planId,
      deck: { kind: "block", blocks: [one], clipSeconds: plan.clipSeconds },
    });
  },
});

/**
 * The manual "Retry render" button (33-04) — FAILED-only, free to the user.
 *
 * No new reservation and no new landing: it re-fires `renderReel` over the assets the plan already
 * paid for, exactly as the automatic retry does. Compute is covered by the doubled render line
 * (`MEDIA_SANDBOX_USD_PER_RENDER`); a rare THIRD sandbox — a manual retry after the auto retry
 * already fired — is accepted, documented drift (playbook), never silent. `renderRetriedAt` is
 * deliberately NOT cleared: the automatic retry stays once-per-plan even across manual attempts.
 *
 * The failed→rendering transition in this serializable mutation is the CAS (the
 * `pending → rendering` idiom): a double-click cannot schedule two renders, because the second
 * click finds `rendering` and refuses.
 */
export const retryRender = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    if (plan.renderStatus !== "failed")
      return { ok: false as const, reason: "not_failed" as const };
    // The LATEST batch is the one whose landings describe the current deck — `batchToRender` reads
    // inputs off the whole plan anyway, so the batch is only the trigger handle here.
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", ctx.tenantId).eq("planId", planId))
      .collect();
    const latest = rows.reduce<Doc<"mediaJobs"> | null>(
      (best, r) => (best === null || r.createdAt > best.createdAt ? r : best),
      null,
    );
    if (!latest) return { ok: false as const, reason: "nothing_to_render" as const };

    // 25.1-01 (D2): under the retrier, never a bare runAfter — the run id lands on the plan in the
    // SAME mutation so a crashed retry still terminalizes (`mediaComplete.onRenderComplete`).
    const runId = await retrier.run(
      ctx,
      internal.render.renderReel.renderReel,
      { tenantId: ctx.tenantId, planId, batchId: latest.batchId },
      { onComplete: internal.mediaComplete.onRenderComplete },
    );
    await ctx.db.patch(planId, {
      renderStatus: "rendering",
      renderReason: undefined,
      renderRunId: String(runId),
    });
    // Insert-only, refs only (§4): WHICH plan and WHICH batch — never a reason string the user
    // typed, never a URL.
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: latest.batchId,
      eventType: "media.render_retry_manual",
      actor: ctx.tenantId,
      payload: { planId, batchId: latest.batchId },
    });
    return { ok: true as const };
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

/**
 * Patch one element of `plans.shots`, renumber, and clear the render. The single write path the
 * five editor mutations share.
 *
 * **20.2 — the offsets are a RUNNING SUM of each shot's own length, not `index × clipSeconds`.**
 * The old arithmetic read the deck-wide `clipSeconds`, which is only the truth when every shot is
 * the same length; on a scene deck a reorder or a delete would have rewritten every offset to a
 * uniform grid the shots were never cut to, silently desynchronising the whole timeline from the
 * narration anchors. The new form is identical for a uniform deck by construction — `seconds` is
 * `clipSeconds` on every block row — so this is a generalisation, not a behaviour change, and the
 * block-contract tests pin that.
 *
 * The `plan` argument is gone with the arithmetic that needed it.
 */
async function patchShots(
  ctx: MutationCtx,
  planId: Id<"plans">,
  next: NonNullable<Doc<"plans">["shots"]>,
): Promise<void> {
  let startMs = 0;
  const renumbered = next.map((s, i) => {
    const shot = { ...s, index: i, windowStartMs: startMs };
    startMs += s.seconds * 1000;
    return shot;
  });

  // **STRUCTURAL vs CONTENT, and the difference is money (20.2 wave 6).**
  //
  // `shotsChangedAt` is what makes a landed asset un-reusable by the next render
  // (`batchToRender`'s `stale_inputs`), so stamping it on the wrong edits is expensive in both
  // directions. A REORDER or a DELETE moves a scene out from under the index its clip was bought
  // at — reusing that clip would put the wrong footage under the right caption, so the whole deck
  // must be bought again. An edited prompt or narration line changes ONE scene in place and every
  // index still means what it meant, so the neighbours' assets stay valid: without this
  // distinction the commonest flow there is — edit a line, regenerate that scene — would buy a
  // take and then refuse the render, which is the same money leak this wave came to close.
  //
  // The discriminator is `next`'s own indices: a content edit maps the deck in place, so they are
  // already `0..n-1`; a permutation or a deletion is the only way they are not. No flag to pass,
  // and no caller that can forget to.
  const structural = next.some((s, i) => s.index !== i);
  await ctx.db.patch(planId, {
    shots: renumbered,
    ...(structural ? { shotsChangedAt: Date.now() } : {}),
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

    // The SAME ceiling the reserve will apply — on a scene deck that is the take's window
    // (`narrationCeilingSeconds`), not the deck's longest scene. Using the loose deck-wide number
    // here would let this mutation accept a line `reserveSceneJobInner` then refuses as
    // `narration_too_long`, which is precisely the disagreement this function exists to prevent.
    const sceneDeck = sceneDeckOf(plan);
    const position = (plan.shots ?? []).findIndex((s) => s.index === blockIndex);
    const maxChars = sceneDeck
      ? maxCharsFor(narrationCeilingSeconds(sceneDeck.scenes, position))
      : plan.clipSeconds === undefined
        ? MAX_CHARS_PER_BLOCK
        : maxCharsFor(plan.clipSeconds);
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
      // 33-02: a CHANGED claim is unconfirmed. The user vouched for the OLD words, so a real
      // narration change drops `confirmedAt` (and only then — re-saving the same line changes
      // nothing to unconfirm); `needsConfirmation` and `source` stand, because the new words
      // still state a figure from the same document. This scene only: siblings ride `patchShots`
      // untouched. If an overlay editor ever lands, its content change must clear the same way.
      shots.map((s) => {
        if (s.index !== blockIndex) return s;
        if (s.confirmedAt === undefined || narration === s.narration) return { ...s, narration };
        const { confirmedAt: _cleared, ...rest } = s;
        return { ...rest, narration };
      }),
    );
    return { ok: true as const };
  },
});

/**
 * Choose the vault document an `uploaded_video` scene renders (20.2 wave 6) — the sixth editor
 * affordance, and the only one this phase adds.
 *
 * **It is an editor control, not a new ingest surface.** §7's open question 1 was answered by the
 * contract wave 1 shipped: `Scene.asset` has one member, `{ source: "vault", docId }`, so the file
 * arrives through the vault's existing upload path and this mutation only POINTS at it. A direct
 * upload from the canvas would be a second `source` member plus its own ingest, which is a decision
 * rather than a patch.
 *
 * **Everything the render will demand is checked HERE, where the refusal is free.** The doc must
 * exist, be this tenant's, have bytes, and be a video — the same narrowing `batchToRender` and
 * `resolveRenderAsset` apply. Letting a PDF be chosen would clear the money gate (an upload buys
 * nothing, so nothing refuses) and then hard-error in the sandbox with the deck already paid for.
 *
 * `vaultDocId` is a plain string normalised here, not a `v.id`: it is the same id the vault surface
 * hands the browser, and a malformed one must land on the same fail-closed return as a foreign one
 * rather than throwing a different error and distinguishing the two.
 */
export const setSceneAsset = tenantMutation({
  args: { planId: v.id("plans"), blockIndex: v.number(), vaultDocId: v.string() },
  handler: async (ctx, { planId, blockIndex, vaultDocId }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const shots = plan.shots ?? [];
    const shot = shots.find((s) => s.index === blockIndex);
    if (!shot) return { ok: false as const, reason: "no_block" as const };
    // Only the kind that HAS an asset. Writing one onto a generated scene would be a field the
    // renderer ignores and the canvas then displays — a lie with no consumer.
    if (shot.visual !== "uploaded_video") {
      return { ok: false as const, reason: "not_an_upload" as const };
    }
    const docId = ctx.db.normalizeId("vaultDocuments", vaultDocId);
    if (!docId) return { ok: false as const, reason: "no_document" as const };
    const doc = await ctx.db.get(docId);
    if (!doc || doc.tenantId !== ctx.tenantId || !doc.storageId) {
      return { ok: false as const, reason: "no_document" as const };
    }
    // 33-05: `storedMimeType ?? mimeType` — what the BYTES are. A saved reel (markdown row, mp4
    // bytes) is legal footage; the picker (`isPickableVideo`) and the render (`batchToRender`,
    // `resolveRenderAsset`) apply the same fallback, so pickable stays equal to renderable.
    if (!(doc.storedMimeType ?? doc.mimeType).startsWith("video/")) {
      return { ok: false as const, reason: "not_a_video" as const };
    }
    await patchShots(
      ctx,
      planId,
      shots.map((s) =>
        s.index === blockIndex ? { ...s, asset: { source: "vault" as const, docId } } : s,
      ),
    );
    // 33-04: a vault pick is a fix-menu arm — if this scene's failure was holding the reel, the
    // pick is what un-holds it, and no landing will ever re-fire the trigger for a free fix.
    await rearmAfterFix(ctx, ctx.tenantId, plan);
    return { ok: true as const };
  },
});

/**
 * Switch one scene's VISUAL KIND (33-04) — the fix-menu's "make it cheaper / make it free" arm,
 * and an ordinary editor affordance before Generate.
 *
 * **CONTENT-class on purpose, and the classification is the locked decision:** the switch maps the
 * deck in place (indices untouched), so `patchShots` does NOT stamp `shotsChangedAt` — landed
 * sibling assets stay fresh and the next render reuses them (`batchToRender` would otherwise
 * refuse `stale_inputs` and the siblings' paid work would be wasted, exactly what "landed sibling
 * work waits — nothing is wasted" forbids). A kind switch does not touch the narration, so a
 * confirmed claim's `confirmedAt` SURVIVES — the user vouched for the words, and the words are
 * unchanged.
 *
 * The overlay rule is `hasAssetSource`'s rule: a card must name its words, so switching to
 * `text_card` demands renderable overlay text (given here or already on the scene). Switching to
 * `uploaded_video` needs no asset YET — the re-arm below keeps the reel held, in words, until
 * `setSceneAsset` names the footage.
 */
export const setSceneVisual = tenantMutation({
  args: {
    planId: v.id("plans"),
    sceneIndex: v.number(),
    visual: v.string(),
    overlay: v.optional(v.string()),
  },
  handler: async (ctx, { planId, sceneIndex, visual, overlay }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    // A closed vocabulary, checked before anything else — a kind this renderer does not ship must
    // never be written onto a row `assemblerKindOf` will later refuse.
    if (!(VISUAL_KINDS as readonly string[]).includes(visual)) {
      return { ok: false as const, reason: "unknown_visual" as const };
    }
    // Kinds exist on the SCENE contract only. Writing one onto a block deck would make the row
    // half-scene, half-block — a shape no reader owns.
    if (sceneDeckOf(plan) === null) return { ok: false as const, reason: "no_deck" as const };
    const shots = plan.shots ?? [];
    const shot = shots.find((s) => s.index === sceneIndex);
    if (!shot) return { ok: false as const, reason: "no_block" as const };
    const nextOverlay = overlay !== undefined ? overlay.trim() : shot.overlay;
    if (visual === "text_card" && !isRenderableCardText((nextOverlay ?? "").trim())) {
      return { ok: false as const, reason: "no_overlay" as const };
    }
    await patchShots(
      ctx,
      planId,
      shots.map((s) =>
        s.index === sceneIndex
          ? { ...s, visual, ...(overlay === undefined ? {} : { overlay: overlay.trim() }) }
          : s,
      ),
    );
    await rearmAfterFix(ctx, ctx.tenantId, plan);
    return { ok: true as const };
  },
});

/**
 * The fix-menu RE-ARM (33-04, research pitfall 6). `maybeStartRender` fires on LANDINGS; a held
 * reel (`failed`/`incomplete_batch`) whose failed scene is fixed by a FREE action has no new
 * landing, so nothing would ever re-fire the trigger and the reel stays held forever. The fix
 * mutations therefore re-evaluate the trigger themselves, in the SAME mutation as the fix.
 *
 * `before` is the plan row as it stood BEFORE the fix's `patchShots` (whose `clearRender` resets
 * `renderStatus` to `pending` — which is what lets `evaluateRenderTrigger` run at all). Gated on
 * the held state so an ordinary pre-Generate edit schedules nothing. Paid fixes
 * (`regenerateBlock`) need no re-arm: their landings re-fire the trigger naturally.
 */
async function rearmAfterFix(
  ctx: MutationCtx,
  tenantId: string,
  before: Doc<"plans">,
): Promise<void> {
  if (before.renderStatus !== "failed" || before.renderReason !== "incomplete_batch") return;
  const rows = await ctx.db
    .query("mediaJobs")
    .withIndex("by_plan", (q) => q.eq("tenantId", tenantId).eq("planId", before._id))
    .collect();
  const latest = rows.reduce<Doc<"mediaJobs"> | null>(
    (best, r) => (best === null || r.createdAt > best.createdAt ? r : best),
    null,
  );
  if (!latest) return;
  await evaluateRenderTrigger(ctx, { tenantId, planId: before._id, batchId: latest.batchId });
}

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
    await patchShots(ctx, planId, next);
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
      shots.filter((s) => s.index !== blockIndex),
    );
    return { ok: true as const };
  },
});

// ── 33-02: the BRIEF plane and the TWO-DECK variation plane ────────────────────────────────────
//
// Two governed writes, and one rule shared by both: `plans.shots` IS the picked deck. The money
// path (`sceneDeckOf`, `jobEstimate`, the reserves) is textually untouched by this plan and never
// learns variations exist — it prices whatever is in `shots`, which is always the picked deck.

/**
 * Edit a brief chip. Patches ONLY the brief plane: `brief.durationSeconds` is the USER'S ask, the
 * deck's own `targetDurationSeconds` remains the money contract, and a divergence between the two
 * renders as the stale badge (`briefChangedAt > deckProposedAt`) — never as an estimate refusal
 * and never as a silent re-deck. Fields named in the patch stop being `defaulted`: a chip the
 * user has touched is the user's word, whatever its value.
 */
export const editBrief = tenantMutation({
  args: {
    planId: v.id("plans"),
    patch: v.object({
      topic: v.optional(v.string()),
      durationSeconds: v.optional(v.number()),
      audience: v.optional(v.string()),
      tone: v.optional(v.string()),
      brandVoice: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { planId, patch }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    // No brief, nothing to edit — the chips only render off an existing brief, and inventing one
    // here would launder a client-supplied object into "what the user asked for".
    if (plan.brief === undefined) return { ok: false as const, reason: "no_brief" as const };
    // Post-Generate the choice is bought; brief edits from then on are canvas-only, paid-rail.
    if (plan.deckLockedAt !== undefined) {
      return { ok: false as const, reason: "deck_locked" as const };
    }
    if (
      patch.durationSeconds !== undefined &&
      !(TARGET_DURATIONS as readonly number[]).includes(patch.durationSeconds)
    ) {
      return { ok: false as const, reason: "illegal_duration" as const };
    }
    const edited = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
    await ctx.db.patch(planId, {
      brief: {
        ...plan.brief,
        ...Object.fromEntries(edited.map((k) => [k, patch[k as keyof typeof patch]])),
        defaulted: plan.brief.defaulted.filter((f) => !edited.includes(f)),
      },
      briefChangedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Swap the picked deck for the parked alternate — `shots`↔`altShots` and
 * `targetDurationSeconds`↔`altTargetDurationSeconds`, in ONE patch, until Generate locks the
 * choice (`deckLockedAt`).
 *
 * The stamp is STRUCTURAL and deliberate: landed assets belong to the deck that bought them, so
 * `shotsChangedAt` making them un-reusable (`batchToRender`'s `stale_inputs`) is correct here,
 * not the money leak the content/structural split exists to prevent. Not `patchShots` — the
 * alternate's indices are already 0..n-1, which that helper would read as a content edit.
 */
export const switchDeck = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    // The LOCK answers first (33-03): after Generate the alternate is discarded, so a locked plan
    // has no altShots either — but "the choice is bought" is the truthful refusal, and the one
    // that names the real ceiling. `no_alternate` is for a plan that never had a second deck.
    if (plan.deckLockedAt !== undefined) {
      return { ok: false as const, reason: "deck_locked" as const };
    }
    if (plan.altShots === undefined) return { ok: false as const, reason: "no_alternate" as const };
    await ctx.db.patch(planId, {
      shots: plan.altShots,
      altShots: plan.shots,
      targetDurationSeconds: plan.altTargetDurationSeconds,
      altTargetDurationSeconds: plan.targetDurationSeconds,
      shotsChangedAt: Date.now(),
    });
    // The rendered reel — if any — is the OTHER deck's artifact; showing it beside this deck
    // would be the exact stale-final.mp4 lie `clearRender` exists to prevent.
    await clearRender(ctx, planId);
    return { ok: true as const };
  },
});

/**
 * Confirm a cited claim — the provenance front door (33-02).
 *
 * **The args are `planId` + `sceneIndex` and NOTHING else, and that is the security property.**
 * Actor and timestamp derive from the authenticated tenant context (the schema.ts `authorUserId`
 * idiom: "derived from authenticated identity, never from args"). The model has NO mutation that
 * can set `confirmedAt`, and this validator structurally cannot be handed one — the
 * provenance-laundering door stays shut at the arg shape, not at a runtime check.
 *
 * A DIRECT targeted patch, deliberately not `patchShots`: confirmation is not a structural deck
 * edit (no `shotsChangedAt` — landed assets stay reusable) and not a content change (no render
 * clear — the reel on screen is still the reel the user confirmed a claim inside).
 */
export const confirmClaim = tenantMutation({
  args: { planId: v.id("plans"), sceneIndex: v.number() },
  handler: async (ctx, { planId, sceneIndex }) => {
    const plan = await ownedPlanOrThrow(ctx, planId, ctx.tenantId);
    const shots = plan.shots ?? [];
    const shot = shots.find((s) => s.index === sceneIndex);
    if (!shot) return { ok: false as const, reason: "no_block" as const };
    // A scene that states no figure has nothing to confirm — minting a confirmation here would
    // let "the user vouched for this" appear on a scene no one was ever asked about.
    if (shot.needsConfirmation !== true) {
      return { ok: false as const, reason: "not_a_claim" as const };
    }
    await ctx.db.patch(planId, {
      shots: shots.map((s) => (s.index === sceneIndex ? { ...s, confirmedAt: Date.now() } : s)),
    });
    // Insert-only, refs only (§4): WHICH scene of WHICH plan — never the claim text, never the
    // source title. A fresh correlation id, the `blueprint.confirmed` idiom: the confirmation is
    // its own event, not a step of some other flow's lineage.
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "media.claim_confirmed",
      actor: ctx.tenantId,
      payload: { planId, sceneIndex },
    });
    return { ok: true as const };
  },
});

/**
 * The picked deck's citation plane, one entry per scene that claims anything (33-03).
 *
 * **`source.docId` is MODEL-AUTHORED text, and this is where it is checked** — the `asset.docId`
 * precedent (`setSceneAsset`): ownership is verified where the id is CONSUMED, never trusted at
 * the write. `verified` is "this doc exists AND is this tenant's"; a foreign, malformed or deleted
 * id comes back `verified: false`, which the canvas renders as unverified — never a clickable
 * citation. `normalizeId` failing closed on garbage is the same door as a real id in the wrong
 * tenant, deliberately: the two must be indistinguishable to a probing model.
 *
 * No URL is minted here — titles and ids only. PreviewModal does its own access check when the
 * user opens the document.
 */
export const sceneCitations = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ownedPlan(ctx, planId, ctx.tenantId);
    if (!plan) return [];
    const out: {
      sceneIndex: number;
      docId: string | null;
      title: string | null;
      verified: boolean;
      needsConfirmation: boolean;
      confirmedAt: number | null;
    }[] = [];
    for (const s of plan.shots ?? []) {
      if (s.source === undefined && s.needsConfirmation !== true) continue; // claims nothing
      let verified = false;
      // The title a VERIFIED citation is rendered under comes off the vault row, never off the
      // model's string: `verified` only ever answered "is this docId yours?", so a model could
      // cite a real owned document under an invented name and the canvas would print the invented
      // name as the source of the figure. The figure is gated by `confirmClaim`; the label beside
      // it was not. An unverified row keeps the model's string — there is no owned document to
      // take a title from, and blanking it would hide WHAT was claimed from the owner being asked
      // to vouch for it.
      let verifiedTitle: string | null = null;
      if (s.source !== undefined) {
        const docId = ctx.db.normalizeId("vaultDocuments", s.source.docId);
        const doc = docId === null ? null : await ctx.db.get(docId);
        verified = doc !== null && doc.tenantId === ctx.tenantId;
        if (verified && doc !== null) verifiedTitle = doc.title;
      }
      out.push({
        sceneIndex: s.index,
        docId: s.source?.docId ?? null,
        title: verifiedTitle ?? s.source?.title ?? null,
        verified,
        needsConfirmation: s.needsConfirmation === true,
        confirmedAt: s.confirmedAt ?? null,
      });
    }
    return out;
  },
});
