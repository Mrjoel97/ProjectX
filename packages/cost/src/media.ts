/**
 * @pikar/cost/media — the media JOB estimator (MEDIA-01). Pure TS, Convex-free (CLAUDE.md §1).
 *
 * Mirrors cost.ts shape for shape: every function returns Result, so an unknown model, an
 * unpriceable duration or an over-cap job surfaces as Err (never NaN/undefined/throw) and the
 * adapter stops the request before a cent moves.
 *
 * THE UNIT IS THE JOB, not the shot and not the clip. A whole reel — clips + voice + captions STT
 * + the render — is priced and reserved as ONE number, because the reservation has to exist before
 * any provider request does.
 *
 * Three containment rules this module exists to enforce:
 *  1. Every table is keyed by the billing unit the vendor ACTUALLY charges on (submitted
 *     characters, generated images, video-seconds, input audio minutes). A model billed per
 *     GENERATED output duration or per COMPUTE second cannot be reserved and is therefore refused
 *     by construction — not by preference.
 *  2. A resolution missing from a model's row is `unknown_model`, NEVER a fallback to another
 *     tier. A priced resolution must be present on both the estimate and the provider request.
 *  3. The cents floor happens ONCE, on the batch total. See chooseMediaBatch.
 */
import { err, ok, type Result } from "@pikar/core/result";
import { CLIP_SECONDS } from "@pikar/core/storyboard";

export type VideoRes = "480p" | "720p" | "1080p";

/* ponytail: hand-maintained tables, sourced from legacy Alibaba Model Studio and current OpenAI pricing on
 * 2026-08-14. Reconciliation is the manual procedure in docs/playbooks/media.md. Upgrade path:
 * use a versioned machine-readable price feed if either provider publishes one. */

/** USD per video-second, per resolution. */
export const MEDIA_VIDEO_PRICING: Record<string, Partial<Record<VideoRes, number>>> = {
  "wan2.5-t2v-preview": { "480p": 0.05, "720p": 0.1, "1080p": 0.15 },
  "sora-2": { "720p": 0.1 },
};

/** Provider-supported generated durations. Kept model-specific so historical Wan rows remain
 *  priceable without allowing an unsupported duration to reach Sora. */
export const MEDIA_VIDEO_SECONDS: Record<string, readonly number[]> = {
  "wan2.5-t2v-preview": [5, 10],
  "sora-2": [4, 8, 12],
};

/** USD per successfully generated image. */
export const MEDIA_IMAGE_PRICING: Record<string, number> = {
  "wan2.5-t2i-preview": 0.03,
  // Conservative low-quality 1024x1536 reservation including a short prompt-input allowance.
  "gpt-image-2": 0.01,
};

/** USD per 1000 SUBMITTED characters. Character billing is the REQUIREMENT, not a preference: the
 *  job is reserved before any request exists, so a per-generated-second model cannot be priced. It
 *  OpenAI's legacy TTS tier is billed on submitted characters and is therefore pre-computable. */
export const MEDIA_TTS_PRICING: Record<string, number> = {
  "openai/tts-1": 0.015,
};

/** USD per INPUT audio MINUTE — estimable pre-flight because WE generated the audio and know its
 *  window count. */
export const MEDIA_STT_PRICING: Record<string, number> = {
  "openai/whisper-1": 0.006,
};

/** D10 — the ceiling on the WHOLE job: clips + voice + STT + render. Supersedes D4's
 *  per-request budget; there is deliberately no $1.00 constant left in this file to pull. */
export const MEDIA_JOB_CAP_USD = 3.5;

/* ponytail: a flat estimate, not metered per-render. Vercel does not expose per-sandbox billing at
 * request time. The ceiling is that a pathological render could cost more than this constant; the
 * upgrade path is `sandbox.usage` on the returned session object, reconciled in the manual D5
 * procedure in docs/playbooks/media.md. */
export const MEDIA_SANDBOX_USD_PER_RENDER = 0.02;

/** Sora 2's lowest supported tier and duration are pinned deliberately. Six four-second clips cost
 *  $2.40, leaving room under the existing whole-job cap for voice, captions and render. */
export const MEDIA_DEFAULT_VIDEO = {
  model: "sora-2",
  resolution: "720p",
  seconds: 4,
} as const;

export const MEDIA_DEFAULT_IMAGE = {
  model: "gpt-image-2",
  width: 1024,
  height: 1536,
} as const;

/** Voice and sample size are PINNED here, never left to a provider default: the vendor default is
 *  24000 Hz keeps render inputs deterministic. No pace/stretch parameter is submitted, ever. */
export const MEDIA_DEFAULT_VOICE = {
  model: "openai/tts-1",
  voice: "nova",
  sampleRateHertz: 24000,
} as const;

export const MEDIA_DEFAULT_STT = {
  model: "openai/whisper-1",
} as const;

export type MediaSpec =
  | { kind: "video"; model: string; resolution: VideoRes; seconds: number }
  | { kind: "image"; model: string; width: number; height: number }
  | { kind: "tts"; model: string; characters: number }
  | { kind: "stt"; model: string; audioMinutes: number }
  | { kind: "render" } // the flat sandbox constant — a cost line, not a provider call
  | { kind: "free" }; // SCREEN REC / TEXT — a block that costs nothing

/** Three DISTINCT codes, because they send the user to three different levers:
 *  - `unknown_model`     — nothing in the table prices this model+resolution. Fail closed.
 *  - `over_job_cap`      — priced fine, but the reel is too big. Cut blocks or drop resolution.
 *  - `illegal_duration`  — a submitted dimension that cannot be priced at all: a clip length
 *                          outside the selected model's supported set, or a non-finite/negative
 *                          count. Collapsing this into
 *                          `unknown_model` would lie about a model we price perfectly well. */
export type MediaCostError = { code: "unknown_model" | "over_job_cap" | "illegal_duration" };

const CLIP_SET = new Set<number>(CLIP_SECONDS);
const counted = (...ns: number[]) => ns.every((n) => Number.isFinite(n) && n >= 0);

/** Prices ONE line item in FRACTIONAL USD. Never floors, never rounds to cents — that happens
 *  once, in chooseMediaBatch. */
export function estimateMediaUsd(spec: MediaSpec): Result<number, MediaCostError> {
  switch (spec.kind) {
    case "video": {
      const row = MEDIA_VIDEO_PRICING[spec.model];
      if (!row) return err({ code: "unknown_model" });
      if (!CLIP_SET.has(spec.seconds)) return err({ code: "illegal_duration" });
      if (!MEDIA_VIDEO_SECONDS[spec.model]?.includes(spec.seconds)) {
        return err({ code: "illegal_duration" });
      }
      const perSecond = row[spec.resolution];
      // A missing resolution is unknown_model — never a fallback to a cheaper tier.
      if (perSecond === undefined) return err({ code: "unknown_model" });
      return ok(perSecond * spec.seconds);
    }
    case "image": {
      const perMegapixel = MEDIA_IMAGE_PRICING[spec.model];
      if (perMegapixel === undefined) return err({ code: "unknown_model" });
      if (!counted(spec.width, spec.height)) return err({ code: "illegal_duration" });
      return ok(perMegapixel);
    }
    case "tts": {
      const perThousand = MEDIA_TTS_PRICING[spec.model];
      if (perThousand === undefined) return err({ code: "unknown_model" });
      if (!counted(spec.characters)) return err({ code: "illegal_duration" });
      // NO rounding of the thousands: the vendor bills submitted characters, and rounding 1,200
      // chars up to 2,000 would inflate every deck's voice line by ~66%.
      return ok((spec.characters / 1000) * perThousand);
    }
    case "stt": {
      const perMinute = MEDIA_STT_PRICING[spec.model];
      if (perMinute === undefined) return err({ code: "unknown_model" });
      if (!counted(spec.audioMinutes)) return err({ code: "illegal_duration" });
      // Whole INPUT minutes, rounded up — the vendor's unit is a minute, so a 30-second reel still
      // buys one. Fail-closed bias, and it is bounded: a whole extra minute is $0.008, 0.2% of the
      // job cap. Deliberate deviation from the plan, which pinned only the exact 1-minute case.
      return ok(Math.ceil(spec.audioMinutes) * perMinute);
    }
    case "render":
      return ok(MEDIA_SANDBOX_USD_PER_RENDER);
    case "free":
      return ok(0);
  }
}

/** Sums N line items in FRACTIONAL USD. Never floors. Never rounds. ANY member's Err propagates —
 *  a job with one unpriceable line is not a cheaper job, it is a refused job. */
export function estimateBatchUsd(specs: readonly MediaSpec[]): Result<number, MediaCostError> {
  let usd = 0;
  for (const spec of specs) {
    const one = estimateMediaUsd(spec);
    if (!one.ok) return one; // fail closed
    usd += one.value;
  }
  return ok(usd);
}

/**
 * The ONLY place cents are floored, and it happens ONCE, on the total.
 *
 * D12(a), and it is the point of this module. `chooseModel:134`'s `Math.max(1, Math.ceil(usd *
 * 100))` is the right fail-closed bias for ONE line item and the WRONG one applied per item across
 * a batch: six voice lines of $0.002 are $0.012 — 2 cents — but floored per line they reserve
 * 6 cents. A 5x over-reservation on the cheapest part of the job, compounding with deck length and
 * again when captions add a thirteenth line.
 *
 * Returns BOTH numbers because they live in different places: `mediaJobs.estUsd` stores the
 * per-line estimate in fractional USD (plan 20-02), and only the batch's RESERVATION is expressed
 * in cents (plan 20-04).
 */
export function chooseMediaBatch(
  specs: readonly MediaSpec[],
  capUsd: number,
): Result<{ estUsd: number; estCents: number }, MediaCostError> {
  const est = estimateBatchUsd(specs);
  if (!est.ok) return est;
  if (!Number.isFinite(capUsd) || capUsd <= 0 || est.value > capUsd) {
    return err({ code: "over_job_cap" });
  }
  // Integer cents, fail-closed bias: a sub-cent job still costs 1 cent of budget. ONCE.
  return ok({ estUsd: est.value, estCents: Math.max(1, Math.ceil(est.value * 100)) });
}
