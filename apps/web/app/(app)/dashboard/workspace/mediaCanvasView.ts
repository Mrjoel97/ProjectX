/**
 * THE CANVAS'S PURE HALF (20.2 wave 6) — every derivation and every sentence the media canvas
 * renders, with no React and no Convex in sight.
 *
 * **Why it is a separate file.** `apps/web`'s runner is `.ts`-only and DOM-less on purpose
 * (`vitest.config.mts` says why: adding jsdom + testing-library is an upgrade path, not a side
 * effect). A guarantee left inside `MediaCanvas.tsx` can therefore only be asserted as SOURCE TEXT
 * — `expect(source).toContain(...)` — which is the shape this repo already has a named defect class
 * for (`green-tests-over-broken-capability`: mechanism coverage that survives the feature being
 * broken). Everything here is called by its own test with real inputs and real expected output, so
 * the assertions fail when the behaviour is wrong rather than when the phrasing moves.
 *
 * The rule for what belongs here: if it can be wrong on a Tuesday without anyone clicking anything
 * — an offset, a ceiling, a label, a refusal that names the wrong lever — it belongs here. Layout
 * and styling stay in the component.
 */

/** The four kinds a scene's picture can come from (`@pikar/core/storyboard`'s `VisualKind`). Typed
 *  structurally rather than imported so this module stays free of the backend's build graph; the
 *  `satisfies` tables below are what keep it honest if a member is ever added there. */
export type VisualKind = "generated_video" | "animated_image" | "uploaded_video" | "text_card";

/** `0:00`, `1:05`. Seconds are floored, never rounded, so consecutive windows cannot both claim
 *  the same second. */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The window a scene OWNS, from its own place on the timeline.
 *
 * The block contract derived this from `index x clipSeconds` because every window was the same
 * size. That arithmetic is exactly what 20.2 removed: a scene carries its own `startMs` and
 * `durationMs`, and re-deriving them from an index would put the label back on a uniform grid the
 * deck was never cut to.
 */
export const windowLabel = (startMs: number, durationMs: number): string =>
  `${clockLabel(startMs)}–${clockLabel(startMs + durationMs)}`;

/** `12s`, `1.5s`. A scene length is whole seconds in every deck the parser accepts; the decimal is
 *  for the ones it does not, so a malformed row reads as odd rather than as a rounded lie. */
export const durationLabel = (durationMs: number): string =>
  `${Number.isInteger(durationMs / 1000) ? durationMs / 1000 : (durationMs / 1000).toFixed(1)}s`;

/**
 * Each scene's share of the reel, for the ribbon's `flex-grow`.
 *
 * **The floor is the point.** A 2-second card inside a 60-second reel is 3% of the strip — a sliver
 * too thin to read a label in or to click. Every scene therefore gets at least `minShare` of the
 * width, and the remainder is distributed proportionally, so the ribbon stays honest about relative
 * length while remaining usable. A deck whose durations are all zero (or empty) returns equal
 * shares rather than `NaN` widths.
 */
export function ribbonShares(durationsMs: readonly number[], minShare = 0.05): number[] {
  const n = durationsMs.length;
  if (n === 0) return [];
  const total = durationsMs.reduce((sum, d) => sum + Math.max(0, d), 0);
  if (total <= 0) return durationsMs.map(() => 1 / n);
  // The floor cannot exceed an equal split, or the "remainder" below goes negative and the
  // proportions invert.
  const floor = Math.min(minShare, 1 / n);
  const free = 1 - floor * n;
  return durationsMs.map((d) => floor + (Math.max(0, d) / total) * free);
}

/** The badge on a tile and on its ribbon segment. Plain words: a person reading "GENERATED CLIP"
 *  knows it was bought, and "YOUR FOOTAGE" knows it was not. */
export const KIND_LABEL = {
  generated_video: "GENERATED CLIP",
  animated_image: "ANIMATED STILL",
  uploaded_video: "YOUR FOOTAGE",
  text_card: "TEXT CARD",
} as const satisfies Record<VisualKind, string>;

/**
 * The wire's `string | null` → the closed set, or `null`.
 *
 * `plans.shots[].visual` is `v.string()` in the schema (the closed set lives in `@pikar/core`, not
 * in Convex's validators), so what reaches the browser is a string. Narrowing it HERE, once, means
 * a kind this build does not ship renders as a plain undifferentiated row instead of indexing a
 * label map with `undefined` and printing "undefined" into a badge. Fail closed, and in one place.
 */
export const asVisualKind = (s: string | null | undefined): VisualKind | null =>
  s !== null && s !== undefined && s in KIND_LABEL ? (s as VisualKind) : null;

/** What each kind costs, in the one word a tile has room for. `null` where nothing is bought — and
 *  the tile says so rather than leaving the question open. */
export const KIND_COST_NOTE = {
  generated_video: "Bought as a clip at this scene's length.",
  animated_image: "One still, panned in the render — about a tenth of a clip.",
  uploaded_video: "Your own file. Nothing is bought for this scene.",
  text_card: "Drawn in the render. Nothing is bought for this scene.",
} as const satisfies Record<VisualKind, string>;

type JobFace = { status: string } | null;

/**
 * THE PICTURE ROW, per kind — and this is where the old canvas lied.
 *
 * Under the block contract every row had a clip job, so one `CLIP_COPY` map served everything and a
 * row with no job read "Clip: not requested yet" forever. Three of the four scene kinds have no
 * clip job and never will: a card is drawn by ffmpeg at render time, an upload is the tenant's own
 * file, and a still is a different job with a different word. A tile that says "waiting to start"
 * about a thing that will never start is the same defect as a spinner that never resolves.
 */
export function pictureLine(
  visual: VisualKind | null,
  clip: JobFace,
  asset: { docId: string } | null,
  assetTitle?: string | null,
): string {
  if (visual === "text_card")
    return "Card: drawn when the reel is assembled — nothing to generate.";
  if (visual === "uploaded_video") {
    return asset
      ? `Footage: ${assetTitle ?? "chosen from your vault"}`
      : "Footage: none chosen — pick a video from your vault below.";
  }
  const noun = visual === "animated_image" ? "Still" : "Clip";
  if (!clip) return `${noun}: not requested yet`;
  const copy: Record<string, string> = {
    queued: "waiting to start",
    submitted: visual === "animated_image" ? "generating…" : "generating… (usually 1–3 minutes)",
    succeeded: "ready",
    failed: "failed",
    blocked: "refused by the provider's content check",
  };
  return `${noun}: ${copy[clip.status] ?? clip.status}`;
}

/** The voice row. Silence is legal from wave 4 on, so a scene with no line says that it is silent
 *  rather than reporting a take that was never bought. */
export function voiceLine(narration: string, voice: JobFace): string {
  if (narration.trim() === "") return "Voice: silent scene — no narration to record.";
  if (!voice) return "Voice: not requested yet";
  const copy: Record<string, string> = {
    queued: "waiting to start",
    submitted: "recording the narration…",
    succeeded: "ready",
    failed: "failed",
    blocked: "refused by the provider's content check",
  };
  return `Voice: ${copy[voice.status] ?? voice.status}`;
}

/** **Bought for words that have since changed.** The render reuses a landed asset across a free
 *  edit deliberately — it is the only footage that exists — so this line is the ONLY place a user
 *  can learn the reel still shows, or says, the old thing. It names the cure, which is the paid
 *  control on the same tile. */
export const STALE_CLIP_NOTE =
  "This picture was bought before you last edited the prompt. Regenerate the scene to buy it again, or the reel keeps this one.";
export const STALE_VOICE_NOTE =
  "This take was recorded before you last edited the line. Regenerate the scene to re-record it, or the reel keeps the old words.";

/**
 * THE REFUSAL COPY, which NAMES THE LEVER.
 *
 * `noun` is "scene" or "block" — one deck's vocabulary, chosen once by the caller from whether the
 * rows carry a `visual`, rather than a phase-old word hardcoded into eight sentences.
 */
export function refusalText(
  refusal: { reason: string; blockIndex?: number; chars?: number },
  o: { capCents: number; totalCents: number; maxChars: number; noun: "scene" | "block" },
): string {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const which =
    refusal.blockIndex === undefined
      ? `A ${o.noun}`
      : `${o.noun === "scene" ? "Scene" : "Block"} ${refusal.blockIndex + 1}`;
  switch (refusal.reason) {
    case "over_job_cap":
      return `This reel would cost ${money(o.totalCents)}, over the ${money(o.capCents)} per-reel limit — cut a ${o.noun}, or swap a generated clip for an animated still.`;
    case "illegal_duration":
      return o.noun === "scene"
        ? "The scenes don't add up to the reel's declared length, or a generated clip isn't 4, 8 or 12 seconds — the only lengths the model produces."
        : "Every block must be 5 or 10 seconds.";
    case "narration_too_long":
      return `${which}'s narration is ${refusal.chars} characters — trim it to ${o.maxChars} or fewer, or it runs into the next line.`;
    case "narration_too_short":
      return `${which}'s narration is only ${refusal.chars} characters — too short to fill its window.`;
    case "unknown_model":
      return `This ${o.noun} names a model we can't price, so it won't run.`;
    // 20.2 wave 5 NARROWED this from "unpaid" to "names no source". The old sentence — "only VIDEO
    // and IMAGE blocks can be generated today" — was wrong twice over: `IMAGE` was never a
    // `ShotType`, and a card and an upload are both renderable now.
    case "unrenderable_block":
      return `${which} doesn't say what its picture is made from — a text card needs its words, and your own footage needs a video picked from the vault.`;
    case "nothing_to_regenerate":
      return `There's nothing to buy again for ${which.toLowerCase()} — it's drawn from what you already have. Edit it and generate the reel.`;
    case "kill_switch":
      return "Media generation is paused by the operator.";
    case "over_daily_budget":
    case "media_daily_exhausted":
      return "Today's media budget is spent. This resets tomorrow.";
    case "deployment_media_exhausted":
      return "The deployment's media budget is spent. This is an operator limit.";
    default:
      return "This reel can't be generated yet.";
  }
}

/** A render reasonCode, in words. The backend keeps a CLOSED union and never stores ffmpeg's prose
 *  (§4), so this map is where the sentence lives — an unrecognised code falls through to the code
 *  itself rather than being swallowed. */
export function failureText(reason: string, noun: "scene" | "block"): string {
  const map: Record<string, string> = {
    incomplete_batch: `one of the ${noun}s never produced its picture or its voice, so there was nothing to assemble`,
    not_all_succeeded: `not every ${noun} had landed when the render started`,
    incomplete_blocks: `a ${noun} is missing its picture or its voice take`,
    // 20.2 wave 6. The one refusal whose cure is neither a retry nor an edit.
    stale_inputs: `some of the footage was bought before you reordered or trimmed the deck, so it belongs to ${noun}s that have moved — generate the reel again to re-buy it`,
    speech_out_of_window: "a narration line runs into the next one — shorten it and generate again",
    clip_too_short: "a generated clip was shorter than its window",
    missing_narration: "a window came out silent",
    duration_mismatch: "the finished file was not the expected length",
    sandbox_timeout: "the render ran out of time",
    missing_binary: "the render environment is missing a required tool",
    route_unreachable: "the render service could not be reached",
    route_rejected: "the render service refused the request",
    sidecar_rejected_on_return:
      "the render produced no valid assembly record, so nothing was published",
  };
  return map[reason] ?? reason;
}

/**
 * THE VERDICT COPY, and this is a compliance statement rather than a style choice.
 *
 * `none_reported` means the provider reported NOTHING — **it is not "clean"**. Every Sora 2 video
 * and every voice take lands there, and rendering it as a pass would make a safety claim the
 * provider never made. Never a green tick, and never colour alone (BRAND §6).
 */
export const VERDICT_COPY: Record<string, string> = {
  checker_clear: "Provider safety check: passed",
  checker_flagged: "Provider safety check: flagged",
  provider_blocked: "Refused by the provider's content check",
  none_reported: "Not checked — this model reports no safety verdict",
};

/** Is this document usable as an `uploaded_video` scene's source? The SAME narrowing the render
 *  applies (`resolveRenderAsset` serves `video/*` only, and `batchToRender` refuses anything else),
 *  stated once here so the picker cannot offer a document the render would then reject. */
export const isPickableVideo = (doc: { mimeType?: string | null; status?: string }): boolean =>
  (doc.mimeType ?? "").startsWith("video/") && doc.status !== "failed";
