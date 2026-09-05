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
import { MUSIC_MOODS, type VisualKind } from "@pikar/core/storyboard";

export type VideoRes = "480p" | "720p" | "1080p";

/* ponytail: hand-maintained tables, sourced from legacy Alibaba Model Studio and current OpenAI pricing on
 * 2026-08-14. Reconciliation is the manual procedure in docs/playbooks/media.md. Upgrade path:
 * use a versioned machine-readable price feed if either provider publishes one. */

/** USD per video-second, per resolution. */
export const MEDIA_VIDEO_PRICING: Record<string, Partial<Record<VideoRes, number>>> = {
  // ── HISTORICAL ONLY, exactly like the two superseded image ids below. No submit path routes to
  // either of these since 33.1-05; they stay so `mediaJobs` rows written before their cutover are
  // still PRICEABLE. Neither is a FALLBACK: rule 2 forbids falling back to another row, and
  // nothing in the code can select a model that is not `MEDIA_DEFAULT_VIDEO.model`.
  "wan2.5-t2v-preview": { "480p": 0.05, "720p": 0.1, "1080p": 0.15 },

  // ── THE LIVE ROW (33.1-04). xAI's published rates, read 2026-08-30 and corroborated by a live
  // paid call the same day: `{duration: 5, resolution: "480p"}` returned `usage.cost` 0.25, which
  // is exactly 5 x $0.05. **No 1080p key**, because xAI publishes none — rule 2 makes that
  // `unknown_model` rather than a silent downgrade to the 720p tier. See ADR-027.
  "x-ai/grok-imagine-video": { "480p": 0.05, "720p": 0.07 },
};

/** Provider-supported generated durations. Kept model-specific so historical rows remain
 *  priceable without allowing an unsupported duration to reach the pinned model. */
export const MEDIA_VIDEO_SECONDS: Record<string, readonly number[]> = {
  "wan2.5-t2v-preview": [5, 10],
  // xAI's published grid is **1-15, any integer**, and it is written out rather than generated:
  // this is a money table, and fifteen integers read at a glance where `Array.from` does not.
  // The GRID is why grok was chosen — it retires `illegal_generated_duration` for every length a
  // model can sensibly ask for. `@pikar/core`'s `GENERATED_CLIP_SECONDS` is the second copy of
  // this same list and the two must move together; `media.test.ts` asserts they are equal.
  "x-ai/grok-imagine-video": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
};

/** USD per successfully generated image. */
export const MEDIA_IMAGE_PRICING: Record<string, number> = {
  // ── HISTORICAL ONLY. No submit path routes to either id; both are here so `mediaJobs` rows
  // written before their cutover stay PRICEABLE. An unpriceable historical row is a refused read
  // (`unknown_model`), not a cheaper one. Neither is a fallback: rule 2 forbids falling back to
  // another row, and nothing in the code can select these.
  "wan2.5-t2i-preview": 0.03,
  // The bare id, as submitted to api.openai.com/v1/images/generations before 33.1-03. The 0.01 was
  // self-described "conservative" — a guess made without a measurement, and 2x the real cost.
  "gpt-image-2": 0.01,

  // ── THE LIVE ROW. MEASURED, not estimated.
  // One real OpenRouter call on 2026-08-30 for `(1024x1536, quality: low, n: 1)` returned
  // `usage.cost` = **$0.004875** at a 27-token prompt, of which $0.004740 is the fixed image cost
  // (`image_tokens: 158`, constant for this geometry and quality) and $0.000135 the prompt.
  // Raw response, request body and command:
  //   .planning/phases/33.1-.../33.1-PRICE-EVIDENCE.md
  //
  // ROUNDED UP TO 0.006, and the gap is $0.001125 of deliberate headroom. This is a pre-request
  // RESERVATION on a no-refunds rail (rule 1), so it must be >= what the vendor actually charges,
  // and only the PROMPT half varies (at $0.000005/token). $0.001125 buys ~225 prompt tokens on top
  // of the probe's 27 — real scene prompts observed on 2026-08-30 ran ~40-55 tokens. A fractional-
  // cent measurement rounded DOWN would be silent drift, so the rounding is stated rather than
  // folded away.
  "openai/gpt-image-2": 0.006,
};

/** USD per 1000 SUBMITTED characters. Character billing is the REQUIREMENT, not a preference: the
 *  job is reserved before any request exists, so a per-generated-second model cannot be priced. It
 *  OpenAI's legacy TTS tier is billed on submitted characters and is therefore pre-computable. */
export const MEDIA_TTS_PRICING: Record<string, number> = {
  "openai/tts-1": 0.015,
  // 33.1. MEASURED, not read off a page, because this model is NOT billed per character — it is
  // billed per audio output TOKEN, and the reservation happens before any tokens exist. Two probes
  // on 2026-09-03 (`33.1-PRICE-EVIDENCE.md`): 47 chars -> $0.0002496 ($0.0053/1k), 104 chars ->
  // $0.0004344 ($0.0042/1k). 0.006 sits above BOTH with ~13% headroom, which is the direction a
  // reservation must err: a `reconciled: "repriced"` landing settles the real number afterwards,
  // and an over-estimate refunds while an under-estimate overspends the tenant's cap.
  "openai/gpt-audio-mini": 0.006,
};

/** USD per INPUT audio MINUTE — estimable pre-flight because WE generated the audio and know its
 *  window count. */
export const MEDIA_STT_PRICING: Record<string, number> = {
  "openai/whisper-1": 0.006,
};

/**
 * USD per TRACK, FLAT. The billing unit is the track, which is why this table can exist at all.
 *
 * $0 is not a placeholder and it is not "free by accident" — it is the PRICE of a fixed local
 * library of licence-cleared files baked into the render snapshot beside the font and ffmpeg
 * (`apps/web/scripts/bake-sandbox-snapshot.mjs`). There is no request, no vendor and no meter, so
 * the number is knowable before the job exists, which is the whole of rule 3.
 *
 * **A GENERATIVE MUSIC API COULD NOT LIVE HERE**, and that is the point of writing this down: every
 * one on the market bills per generated second or per compute second, neither of which is
 * pre-computable before the request, and a 30-second bed at generative rates is a material
 * fraction of `MEDIA_JOB_CAP_USD` on its own. Refused by construction, not by preference.
 *
 * ponytail: a fixed local library, not generated music. The ceiling is that every tenant's reel
 * draws from the same four beds, so two reels in the same niche can sound alike. The upgrade path
 * is a licensed catalogue API **if and only if it bills a flat rate per track** — at which point
 * this table gains a row per catalogue tier and nothing else in the rail moves. A per-second or
 * per-compute-second music vendor is not an upgrade path; it is a different rail.
 */
export const MEDIA_MUSIC_PRICING: Record<string, number> = {
  "library/v1": 0,
};

/**
 * USD per FETCHED ASSET, FLAT. A stock library's billing unit is the request, and the free tier's
 * rate for it is zero — published, not negotiated, and knowable before the job exists. That is the
 * whole of rule 3, and it is the same argument `MEDIA_MUSIC_PRICING` makes.
 *
 * **$0 IS A PRICE HERE, NOT AN ABSENCE OF ONE**, and the distinction has teeth: unlike the music
 * bed, a stock line DOES get a `mediaJobs` row, because bytes must be fetched and landed in
 * `_storage` before `assemble_final.sh` can read them. "Costs nothing" and "buys nothing" came
 * apart at this table. A stock scene buys a real asset, through the real pipeline, at zero.
 *
 * **KEPT SEPARATE FROM `MEDIA_VIDEO_PRICING` DELIBERATELY.** A `$0` row inside the paid video
 * table would mean one mistyped model string prices a Sora clip at nothing — the exact direction
 * of error the whole module is arranged against, and undetectable because the job would simply
 * reserve cheap and succeed. Two tables cost one extra `case`; one table costs a silent hole.
 *
 * ponytail: ONE provider, priced flat at its free tier. The ceiling is that a rate-limited or
 * unreachable library fails the scene (the fix menu then swaps it for a card or a still — no cent
 * is at risk, because none was reserved). The upgrade path is a second row here plus a second
 * fetcher branch — NOT a scoring router or a provider-selection abstraction, which is scope this
 * has not earned. A paid tier is an upgrade path only if it bills per ASSET at a published rate;
 * per-compute-second or per-bandwidth billing is not pre-computable and does not belong here.
 */
export const MEDIA_STOCK_PRICING: Record<string, number> = {
  "pexels/v1": 0,
  // 33.1-06: the music bed's library. Openverse's audio index is CC-licensed and free; the price is
  // $0 per track, flat, like Pexels — and like Pexels the cost that is NOT zero is the licence
  // obligation: CC BY requires attribution, which the row carries and the reel's vault document
  // and canvas show. No key, anonymous rate limit 20/min and 200/day (read off the response
  // headers on 2026-09-04), which one bed per reel does not approach.
  "openverse/v1": 0,
};

/** The music bed's stock source. Kept beside `MEDIA_DEFAULT_STOCK` rather than inside it because
 *  the two libraries are searched differently: Pexels by a scene's prompt, Openverse by the deck's
 *  MOOD slug plus a fixed qualifier so a vocal track is not laid under narration. */
export const MEDIA_MUSIC_STOCK = {
  model: "openverse/v1",
  /** Appended to the mood in the search. Instrumental beds only — the narration is the voice. */
  qualifier: "instrumental",
  /** A track shorter than the reel would loop with an audible seam; the picker skips it. */
  minDurationSlackSeconds: 0,
} as const;

/** D10 — the ceiling on the WHOLE job: clips + voice + STT + render. Supersedes D4's
 *  per-request budget; there is deliberately no $1.00 constant left in this file to pull. */
export const MEDIA_JOB_CAP_USD = 3.5;

/**
 * The ceiling on TOTAL GENERATED VIDEO SECONDS in ONE reservation (33.1-04, ADR-027).
 *
 * **What it replaces.** Until 2026-08-30 "every legal reel mixes kinds" was ARITHMETIC: sora-2 made
 * only 4, 8 and 12 second clips, so no sum of them was 15 or 30, and a 60 cost $6.00 against the
 * $3.50 job cap. Grok's 1..15 grid is exactly what the phase bought — it retires
 * `illegal_generated_duration` — and it destroys that guarantee in passing: a 15 s all-generated
 * reel is $1.05 and a 30 s is $2.10, both comfortably under the cap. Kind-mixing would drop from
 * structural to advisory, and the only thing left advising it is skill-body prose that
 * `dispatch.ts` already records as "violated twice in six attempts, which is why this is code and
 * not another sentence in the body."
 *
 * **Why 12, derived rather than chosen.** It is the largest number that is below every target
 * duration AND keeps both shipped worked examples legal exactly as written:
 *  - `media-director.md`'s VARIATION A spends `4 + 8 = 12` generated seconds in a 30 s reel
 *    (VARIATION B spends 0). Twelve is the smallest value that does not require editing the body.
 *  - `media.fixtures.json`'s `reel30s.mixed` is `3 generated x 4 s = 12 s`, and the ADR's own
 *    worked economics land on the same number.
 *  - `12 < min(TARGET_DURATIONS) === 15`, which is what makes an all-generated reel impossible at
 *    EVERY target rather than only at 60 — including a target nobody has added yet.
 *  - At $0.07/s it ceilings generated spend at **$0.84** per reel whatever the target duration:
 *    24% of `MEDIA_JOB_CAP_USD`, leaving $2.66 for stills, voice, captions and render.
 *
 * **The uncomfortable part, said out loud: both of those decks sit EXACTLY on the boundary, with
 * zero slack.** A one-second nudge to either makes it illegal. That is why the boundary is
 * inclusive and why `media.test.ts` parses the shipped body and asserts its worked answer prices
 * under this constant — otherwise the body and the money boundary could drift apart in a commit
 * that touches neither. 13 and 15 were considered: 15 destroys the guarantee, 13 is a round number
 * with no argument behind it.
 *
 * **`MEDIA_JOB_CAP_USD` STAYS 3.50.** Lowering it below $2.10 to make the arithmetic work would
 * shrink every legitimate mixed reel's headroom, and ADR-026 is explicit that a successor needing
 * a cap change is a worse outcome wearing a migration's clothes.
 *
 * ponytail: one constant and a two-line check at the choke point every reservation and every
 * estimate already passes through. The ceiling is that this is a POLICY somebody can raise, where
 * what it replaces was an impossibility — ADR-027 §"What the mitigation is not" says so rather
 * than pretending otherwise. The upgrade path, if a long-form product ever needs more, is a
 * per-tenant limit read from `guardrails`, NOT a bigger constant.
 */
export const MEDIA_GENERATED_SECONDS_CAP = 12;

/* ponytail: a flat estimate, not metered per-render. Vercel does not expose per-sandbox billing at
 * request time. The ceiling is that a pathological render could cost more than this constant; the
 * upgrade path is `sandbox.usage` on the returned session object, reconciled in the manual D5
 * procedure in docs/playbooks/media.md.
 *
 * 33-04: DOUBLED ($0.02 -> $0.04) to reserve the ONE automatic retry sandbox
 * (`TRANSIENT_RENDER_CODES`) up front — on a no-refunds rail an unreserved second sandbox would be
 * silent cents drift. A rare THIRD sandbox (manual retry after the auto retry) is accepted,
 * documented drift, never silent — see the retry section of docs/playbooks/media.md. This is the
 * single source both `jobEstimate` and the reserves read; the estimate line says
 * "render (incl. one retry)" so the coverage is explicit on screen. */
export const MEDIA_SANDBOX_USD_PER_RENDER = 0.04;

/** ROUTE-QUALIFIED, like the image pin: since 33.1-05 the video plane posts to OpenRouter, which
 *  keys on `x-ai/grok-imagine-video`. This string, `MEDIA_VIDEO_PRICING`'s live key,
 *  `MEDIA_VIDEO_SECONDS`'s live key and `media.fixtures.json`'s video id are four copies of one
 *  value and must move together — the fixture-parity test is what enforces that.
 *
 *  720p and 4 s are KEPT from the sora-2 pin. At $0.07/s six four-second clips are $1.68 against
 *  the unchanged $3.50 cap (they were $2.40 on sora-2), so the successor leaves MORE room for
 *  voice, captions and render, not less — the test ADR-026 sets for a migration.
 *
 *  480p exists in the row and is deliberately NOT pinned: dropping the tier is a picture-quality
 *  decision and improvements do not ride in on a migration (33.1-PRICE-EVIDENCE.md makes the same
 *  argument for the still's geometry). */
export const MEDIA_DEFAULT_VIDEO = {
  model: "x-ai/grok-imagine-video",
  resolution: "720p",
  seconds: 4,
} as const;

/** ROUTE-QUALIFIED deliberately: since 33.1-03 the still plane posts to OpenRouter, which keys on
 *  `openai/gpt-image-2`, and `buildSubmitBody`'s image arm sends `spec.model` through UNSTRIPPED.
 *  This string, `MEDIA_IMAGE_PRICING`'s live key and `media.fixtures.json`'s image `id` are three
 *  copies of one value and must move together — the fixture-parity test is what enforces that. */
export const MEDIA_DEFAULT_IMAGE = {
  model: "openai/gpt-image-2",
  width: 1024,
  height: 1536,
} as const;

/** Voice and sample size are PINNED here, never left to a provider default: the vendor default is
 *  24000 Hz keeps render inputs deterministic. No pace/stretch parameter is submitted, ever. */
export const MEDIA_DEFAULT_VOICE = {
  // 33.1: OpenRouter serves NO model on `/audio/speech` — probed 2026-09-03, every candidate
  // including `openai/gpt-audio` came back "does not exist" — so the voice plane moved to the
  // chat-audio route instead of a like-for-like endpoint swap. Fully QUALIFIED, like
  // `MEDIA_DEFAULT_IMAGE.model`: OpenRouter routes on the vendor prefix and the tts arm of
  // `buildSubmitBody` no longer strips it.
  model: "openai/gpt-audio-mini",
  // `nova` survives the move — probed 3/3 on the chat-audio route. Pinned, never a provider
  // default, and 24000 Hz is exactly what that route's `pcm16` stream emits, so nothing resamples.
  voice: "nova",
  sampleRateHertz: 24000,
} as const;

export const MEDIA_DEFAULT_STT = {
  model: "openai/whisper-1",
} as const;

/** The library version, PINNED here the way every other provider spec is pinned. Bumping it is a
 *  re-bake plus a row in `MEDIA_MUSIC_PRICING`, never a silent swap of what a mood sounds like. */
export const MEDIA_DEFAULT_MUSIC = {
  model: "library/v1",
} as const;

/**
 * The stock library, PINNED like every other provider spec.
 *
 * `orientation` and `minDurationSlackSeconds` are HERE rather than at the fetch site because both
 * are things `assemble_final.sh` will hard-fail on, and a constant the assembler's behaviour
 * depends on belongs beside the price it is pinned with:
 *
 *  * **`orientation: "portrait"`** — the assembler probes `W`/`H`/`FPS` off the FIRST video scene
 *    (`assemble_final.sh`, "GEOMETRY comes from the first VIDEO scene"). Stock libraries are
 *    landscape by default, so a deck whose opening video scene is stock would silently retune the
 *    WHOLE reel to 1920x1080 and letterbox every still and card after it. Nothing would error.
 *  * **`minDurationSlackSeconds`** — the assembler ERRORS when a clip is shorter than its scene by
 *    more than 0.5s ("a held still frame is not a scene"). A generated clip is always exactly its
 *    grid length and an upload is the tenant's own pick, so nothing has ever reached that gate.
 *    Stock is whatever the library has, so the SEARCH must exclude anything too short — matching
 *    the assembler's own tolerance exactly, from one constant, rather than two numbers that drift.
 */
export const MEDIA_DEFAULT_STOCK = {
  model: "pexels/v1",
  orientation: "portrait",
  minDurationSlackSeconds: 0.5,
} as const;

export type MediaSpec =
  | { kind: "video"; model: string; resolution: VideoRes; seconds: number }
  | { kind: "image"; model: string; width: number; height: number }
  | { kind: "tts"; model: string; characters: number }
  | { kind: "stt"; model: string; audioMinutes: number }
  /** The deck-wide music bed. A $0 line, and it IS a line: it is reserved with the rest of the job
   *  so the invoice names every input the reel was built from, including the ones that cost
   *  nothing. Like `render` it buys no provider call, so it gets no `mediaJobs` row — see
   *  `reserveSceneJobInner`. */
  | { kind: "music"; model: string; mood: string }
  /** One fetched stock asset. `media` is what the BYTES are — it becomes the `mediaJobs.kind`, so
   *  `renderReel`'s slot map keeps reading `video`/`image` and needs no stock case at all.
   *  `seconds` is the scene's window: the fetcher uses it to exclude clips the assembler would
   *  refuse as too short, and it is carried on the row so a re-submit asks the same question. */
  /** 33.1-06: `audio` is the MUSIC BED fetched from a public library (Openverse) — the same $0
   *  stock idiom as a Pexels still, one row, landed bytes, and the reel-length `seconds` the
   *  picker uses to skip tracks shorter than the reel. */
  | { kind: "stock"; model: string; media: "video" | "image" | "audio"; seconds: number }
  | { kind: "render" } // the flat sandbox constant — a cost line, not a provider call
  | { kind: "free" }; // a scene whose picture costs nothing — see SCENE_VISUAL_LINE

/** FOUR DISTINCT codes, because they send the user to four different levers:
 *  - `unknown_model`     — nothing in the table prices this model+resolution. Fail closed.
 *  - `over_job_cap`      — priced fine, but the reel is too big. Cut blocks or drop resolution.
 *  - `illegal_duration`  — a submitted dimension that cannot be priced at all: a clip length
 *                          outside the selected model's supported set, or a non-finite/negative
 *                          count. Collapsing this into
 *                          `unknown_model` would lie about a model we price perfectly well.
 *  - `over_generated_seconds` — the reel is affordable but spends more than
 *                          `MEDIA_GENERATED_SECONDS_CAP` on generated video. A DIFFERENT lever
 *                          from `over_job_cap`: the cure is not "cut a scene", it is "swap a
 *                          generated scene for an animated still or stock", which costs the same
 *                          at any length. Kept separate for exactly that reason. */
export type MediaCostError = {
  code: "unknown_model" | "over_job_cap" | "illegal_duration" | "over_generated_seconds";
};

const counted = (...ns: number[]) => ns.every((n) => Number.isFinite(n) && n >= 0);

/** Prices ONE line item in FRACTIONAL USD. Never floors, never rounds to cents — that happens
 *  once, in chooseMediaBatch. */
export function estimateMediaUsd(spec: MediaSpec): Result<number, MediaCostError> {
  switch (spec.kind) {
    case "video": {
      const row = MEDIA_VIDEO_PRICING[spec.model];
      if (!row) return err({ code: "unknown_model" });
      // The GRID is asked of the model we are about to submit to — never of `CLIP_SECONDS`, which
      // was the block era's DISPLAY set ([4,5,8,10,12]) and is wider than any real provider row.
      // Checking both said the same thing twice and tied the money path to a constant the scene
      // contract deprecates (20.2 §3, "not blocks x clipSeconds").
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
    case "music": {
      const perTrack = MEDIA_MUSIC_PRICING[spec.model];
      if (perTrack === undefined) return err({ code: "unknown_model" });
      // The MOOD is checked here as well as at the parser, and deliberately so: this module is the
      // gate money passes through, and "the caller already validated it" is the assumption every
      // pricing hole in this file was written to remove. A mood outside the set names no track in
      // the baked library, so there is nothing to price — `unknown_model`, the same code a missing
      // resolution gets, and never a fallback to some other bed.
      if (!(MUSIC_MOODS as readonly string[]).includes(spec.mood)) {
        return err({ code: "unknown_model" });
      }
      return ok(perTrack);
    }
    case "stock": {
      const perAsset = MEDIA_STOCK_PRICING[spec.model];
      if (perAsset === undefined) return err({ code: "unknown_model" });
      // A stock CLIP has to cover its scene, and the length is the only submitted dimension that
      // can make it unpriceable — an infinite or negative window names no search we could run.
      // Checked for both media so a still's window stays a real number on the row.
      if (!counted(spec.seconds)) return err({ code: "illegal_duration" });
      return ok(perAsset);
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
  // THE GENERATED-SECONDS CEILING (33.1-04), beside the job cap and before any cents exist.
  // Here rather than at a caller because this is the ONE gate `reserveJobInner`,
  // `reserveSceneJobInner`, `jobEstimate` and `imageEstimate` all pass through — so the estimate
  // the canvas prints and the reservation that spends agree by construction. It is UNIFORM: block
  // decks are generated-video by construction and are checked too. Passing a per-caller ceiling
  // was rejected — a cap a deck shape can route around is not a cap (ADR-027).
  const generatedSeconds = specs.reduce((n, s) => n + (s.kind === "video" ? s.seconds : 0), 0);
  if (generatedSeconds > MEDIA_GENERATED_SECONDS_CAP) {
    return err({ code: "over_generated_seconds" });
  }
  if (!Number.isFinite(capUsd) || capUsd <= 0 || est.value > capUsd) {
    return err({ code: "over_job_cap" });
  }
  // Integer cents, fail-closed bias: a sub-cent job still costs 1 cent of budget. ONCE.
  return ok({ estUsd: est.value, estCents: Math.max(1, Math.ceil(est.value * 100)) });
}

/* --- THE SCENE-KIND PRICE TABLE (20.2 §2.3) -------------------------------------------------- */

/**
 * What ONE scene of each visual kind buys from a provider.
 *
 * `null` is not "free by accident". A `text_card` is drawn by ffmpeg inside a sandbox we already
 * pay the flat render constant for, and an `uploaded_video`'s bytes are already the tenant's — so
 * neither has a provider line to reserve at all. That is the whole cost lever of the scene
 * contract: the same 30 seconds of screen time costs $1.24 or $2.80+ depending on which rows the
 * deck picks.
 *
 * It is a TABLE, and it lives in the pure package, because three callers must agree on it: the
 * RESERVATION (`reserveSceneJobInner`), the ESTIMATE the canvas prints before the button is
 * clickable (`jobEstimate`), and the ADR's arithmetic. They drifted while the branches were
 * copy-pasted at two Convex call sites.
 */
export const SCENE_VISUAL_LINE = {
  generated_video: "video",
  animated_image: "image",
  uploaded_video: null,
  text_card: null,
  // NOT `null`. A stock scene buys nothing in money and a real asset in bytes, so it needs a LINE
  // (to reserve, to submit, to land) at a price of zero. `null` here would mean no `mediaJobs` row,
  // no fetch, and a render that refuses `incomplete_blocks` forever with no way to fix it.
  stock_video: "stock",
  stock_image: "stock",
} as const satisfies Record<VisualKind, "video" | "image" | "stock" | null>;

/** The picture line a scene buys. `render`/`tts`/`stt`/`free` are deck-wide or narration-driven and
 *  are therefore NOT scene-kind decisions. */
export type SceneVisualSpec = Extract<MediaSpec, { kind: "video" | "image" | "stock" }>;

/**
 * Prices ONE scene's picture: the spec to submit and its fractional USD, or `null` for a kind that
 * buys nothing. Err propagates unchanged — an off-grid `generated_video` is `illegal_duration`
 * here, at the free gate, rather than inside a sandbox that has already been bought.
 *
 * The duration grid is enforced by `estimateMediaUsd` against the PINNED model's own row, so a
 * model swap moves the constraint by itself. `animated_image` is priced per IMAGE and its
 * `seconds` is deliberately unused: one still is one still whether it pans for 2 s or 12 s, which
 * is exactly why the cheap kinds are the only way to hit a 15 s or 30 s target (see the ADR).
 */
export function sceneVisualSpec(
  visual: VisualKind,
  seconds: number,
): Result<{ spec: SceneVisualSpec; usd: number } | null, MediaCostError> {
  const line = SCENE_VISUAL_LINE[visual];
  if (line === null) return ok(null);
  const spec: SceneVisualSpec =
    line === "stock"
      ? {
          kind: "stock",
          model: MEDIA_DEFAULT_STOCK.model,
          // The BYTES, off the deck kind — this becomes `mediaJobs.kind`, which is why the row
          // stays a four-member union and the render's slot map never learns the word "stock".
          media: visual === "stock_video" ? "video" : "image",
          seconds,
        }
      : line === "video"
        ? {
            kind: "video",
            model: MEDIA_DEFAULT_VIDEO.model,
            resolution: MEDIA_DEFAULT_VIDEO.resolution,
            seconds,
          }
        : {
            kind: "image",
            model: MEDIA_DEFAULT_IMAGE.model,
            width: MEDIA_DEFAULT_IMAGE.width,
            height: MEDIA_DEFAULT_IMAGE.height,
          };
  const priced = estimateMediaUsd(spec);
  return priced.ok ? ok({ spec, usd: priced.value }) : err(priced.error);
}
