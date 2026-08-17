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

// The ONE import this module has, and it is a VALUE rather than a type for a reason: the length
// chip's options must BE the closed set `media.editBrief` validates against, or the control can
// produce an `illegal_duration` refusal the UI could have made unreachable. `@pikar/core` is a
// pure-TS workspace package with no dependencies of its own (CLAUDE.md §1) — importing it does not
// pull the backend's build graph in here, which is what the note below is about.
import {
  type DeckContract,
  deckRefusalClause,
  GENERATED_CLIP_SECONDS,
  TARGET_DURATIONS,
} from "@pikar/core/storyboard";

/** The four kinds a scene's picture can come from (`@pikar/core/storyboard`'s `VisualKind`). Typed
 *  structurally rather than imported so this module stays free of the backend's build graph; the
 *  `satisfies` tables below are what keep it honest if a member is ever added there. */
export type VisualKind = "generated_video" | "animated_image" | "uploaded_video" | "text_card";

/** Cents → `$1.12`. The ONE money formatter this surface has, and deliberately the only arithmetic
 *  it is allowed to do: every number it prints was computed by `jobEstimate` on the server, against
 *  the same price table the reserve consumes. A second sum here would be a second estimate. */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

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
 *  the tile says so rather than leaving the question open.
 *
 *  33-06 corrected the still's ratio: it read "about a tenth of a clip", which understated the only
 *  cost lever a user has by 4x. The measured table (`storyboard.ts`, 20.2 wave 7 / ADR-019) is
 *  $0.40 for a 4 s generated clip and $0.01 for a still at ANY length — a FORTIETH. */
export const KIND_COST_NOTE = {
  generated_video: "Bought as a clip at this scene's length.",
  animated_image: "One still, panned in the render — about a fortieth of a clip.",
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
  const money = usd;
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
    // ── 33-06: four codes that existed on the rail with no sentence on the canvas ───────────────
    // 33-03's confirm gate. The lever is NOT a rewrite: the model proposed a figure and only the
    // owner may vouch for it, so the sentence points at the badge that does the vouching.
    case "unconfirmed_claims":
      return `${which} states a figure you haven't confirmed. Confirm the flagged claim on that ${o.noun}, or rewrite the line, before generating.`;
    // 33-02's deck lock. Not a fault — a boundary, and the sentence says where the edits went.
    case "deck_locked":
      return `This storyboard was locked when you generated the reel. From here, changes happen on the canvas ${o.noun} by ${o.noun}, and each one is paid.`;
    case "no_alternate":
      return "There's no second storyboard to switch to for this plan.";
    // ── 33-08: the FIX MENU's own refusals ──────────────────────────────────────────────────────
    // A card must name its words. This one is reachable only if the overlay field is submitted
    // empty — the arm asks first — so it is the backstop rather than the expected path.
    case "no_overlay":
      return "A text card needs its words — type what it should say, then use the card.";
    // `retryRender` is FAILED-only. A reel that re-fired between the render and the click has
    // moved on, and saying so beats a button that silently does nothing.
    case "not_failed":
      return "This reel isn't in a failed state any more, so there's nothing to retry.";
    case "no_block":
    case "no_deck":
      return `That ${o.noun} isn't on this plan any more.`;
    case "unknown_visual":
      return "That isn't a kind this build can render.";
    // `confirmClaim`'s guard. The badge only appears on a flagged scene, so this fires only if the
    // flag cleared underneath the click.
    case "not_a_claim":
      return `There's no flagged figure on this ${o.noun} to confirm.`;
    // 33-04's manual retry with no batch behind it.
    case "nothing_to_render":
      return "Nothing has been generated for this plan yet, so there's nothing to re-assemble — generate the reel first.";
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
    // ── 33-08: the other three closed vocabularies a card has to speak ─────────────────────────
    // The RETRIER's terminal (`onSubmitComplete`). Neither of these is the provider's opinion of
    // the request — they are the request never getting there — so neither is a rewrite lever.
    submit_canceled: "the request was canceled before the provider started it",
    submit_failed: "the request never reached the provider",
    // The CAPTIONS plane. `maybeStartCaptions` refuses a transcript whose source takes are
    // missing; `submitCaptions` fails on the transcript itself.
    incomplete_takes: `a ${noun}'s voice take never landed, so there was nothing to transcribe`,
    transcript_failed: "the narration could not be transcribed",
    caption_track_empty: "the transcript came back empty, so there was nothing to burn in",
    // Runner-side codes (`RenderRunnerCode`), which land in the same field as ffmpeg's.
    unauthorized: "the render service rejected our credentials",
    not_configured: "the render service is not configured on this deployment",
    bad_request: "the render service refused the request as malformed",
    input_fetch_failed: "the render could not fetch one of its inputs",
    upload_failed: "the finished file could not be stored",
    bad_invocation: "the assembler was called with arguments it does not accept",
    input_missing: "one of the render's input files was not there",
    no_audio_stream: "one of the audio inputs had no readable sound in it",
    decode_failed: "one of the inputs failed to decode",
    render_failed: "the render failed without a more specific cause",
    empty_batch: "there was nothing in the batch to render",
  };
  return map[reason] ?? reason;
}

/**
 * The same map, but as a SENTENCE — an unknown code falls back to a generic clause instead of to
 * itself.
 *
 * `failureText` deliberately falls through to the raw code so nothing is swallowed, which is right
 * for a detail line and wrong for prose: a card whose headline reads "The reel could not be
 * assembled: http_502" has put a support string in front of a person. Every card therefore renders
 * the code ONCE, as its own subordinate `detailCode` line, and speaks in words above it.
 */
export const GENERIC_FAILURE_CLAUSE = "something went wrong that we have no plainer word for";
export function failureClause(reason: string | null | undefined, noun: "scene" | "block"): string {
  if (!reason) return GENERIC_FAILURE_CLAUSE;
  const said = failureText(reason, noun);
  return said === reason ? GENERIC_FAILURE_CLAUSE : said;
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

// ── 33-06 — THE PIPELINE TRACKER AND THE HERO SLOT ─────────────────────────────────────────────
//
// **One layout for the whole lifecycle.** The hero slot exists from the moment a deck is picked; it
// holds the tracker before the reel exists and the reel afterwards, so nothing on the canvas jumps
// when a render lands. What goes in it is decided HERE, by `heroState`, because "which of five
// states is this plan in" is precisely the kind of thing that can be wrong on a Tuesday.
//
// **NO POLLING, and the tracker is why that stays true.** A clip is 1–3 minutes and the render adds
// 1–3 more, so the surface must show meaningful movement through several minutes of nothing
// arriving. Every input below is already a reactive `tenantQuery` read (`byPlan`'s two job faces,
// the plan row's `renderStatus`/`captionStatus`/`renderRetriedAt`) — Convex delivers the webhook's
// mutation to an open canvas with no ticker at all. There is no clock in this module for the same
// reason there is none in the component: a `setInterval` here would mean the bug is elsewhere.

/** A stage's, or a scene row's, state. `skipped` is a first-class member and the one that matters:
 *  a deck that buys no picture, or a silent scene, must not sit at "waiting" forever about a job
 *  that will never be requested. */
export type StageState = "pending" | "active" | "done" | "failed" | "skipped";

/** One scene, as the tracker needs it — a structural subset of a `media.byPlan` row. The two job
 *  faces stay SEPARATE fields because they are two providers' webhooks landing minutes apart, and a
 *  scene whose voice is ready but whose picture is not must look different from the reverse. */
export type TrackerScene = {
  blockIndex: number;
  visual: VisualKind | null;
  narration: string;
  clip: { status: string } | null;
  voice: { status: string } | null;
};

export type TrackerStage = {
  key: "generate" | "voice" | "assemble" | "captions";
  label: string;
  state: StageState;
  detail: string;
};

export type TrackerRow = {
  blockIndex: number;
  label: string;
  picture: { state: StageState; text: string };
  voice: { state: StageState; text: string };
};

export type TrackerView = { stages: TrackerStage[]; scenes: TrackerRow[] };

/** Does this scene BUY a picture? Only two of the four kinds do — a card is drawn by ffmpeg at
 *  render time and an upload is the tenant's own file — which is what makes "skipped" a real state
 *  rather than a rounding of "pending". A `null` visual is a block-contract row, and those always
 *  bought one. */
const buysPicture = (visual: VisualKind | null): boolean =>
  visual === null || visual === "generated_video" || visual === "animated_image";

/** One job face → its state. `null` is "not requested yet", not "missing": the reserve has not run.
 *  A `queued` job HAS been reserved, so the stage it belongs to is genuinely underway. An unknown
 *  provider status counts as active rather than as done — never a terminal we did not observe. */
const faceState = (face: { status: string } | null): StageState =>
  face === null
    ? "pending"
    : face.status === "succeeded"
      ? "done"
      : face.status === "failed" || face.status === "blocked"
        ? "failed"
        : "active";

const FACE_TEXT: Record<StageState, string> = {
  pending: "not started",
  active: "working…",
  done: "ready",
  failed: "failed",
  skipped: "nothing to buy",
};

/** Roll a column of per-scene states into its stage. Failure WINS — a stage with one refused scene
 *  is not "still working", and saying so is what sends the user to the fix menu instead of to a
 *  wait that will never end. An empty column is `skipped`, never `done`: nothing happened. */
function rollUp(states: readonly StageState[]): StageState {
  if (states.length === 0) return "skipped";
  if (states.includes("failed")) return "failed";
  if (states.every((s) => s === "done")) return "done";
  if (states.some((s) => s === "done" || s === "active")) return "active";
  return "pending";
}

/** `1 of 2 ready.` — the count, not the word. "Working…" through four minutes of a three-scene deck
 *  tells a user nothing; "2 of 3 ready" tells them the thing is moving and roughly how far. */
function countDetail(states: readonly StageState[], noun: string): string {
  const done = states.filter((s) => s === "done").length;
  const failed = states.filter((s) => s === "failed").length;
  if (failed > 0) return `${failed} of ${states.length} failed — fix the ${noun} below.`;
  if (done === states.length) return `All ${states.length} ready.`;
  if (done === 0) return "Not started.";
  return `${done} of ${states.length} ready.`;
}

const CAPTION_DETAIL: Record<string, { state: StageState; detail: string }> = {
  pending: { state: "pending", detail: "Burned in once the reel is assembled." },
  transcribing: { state: "active", detail: "Transcribing the narration…" },
  burning: { state: "active", detail: "Burning the captions in…" },
  captioned: { state: "done", detail: "Burned in." },
  // 20-17's rule, said out loud: a caption failure NEVER unpublishes the reel.
  failed: { state: "failed", detail: "The captions failed — the reel is published without them." },
};

/**
 * THE FOUR-STAGE SPINE: generate → voice → assemble → captions.
 *
 * A fold over inputs that are all already on screen elsewhere, gathered into the one sentence a
 * person waiting three minutes actually wants: which stage is this in, and how far through.
 *
 * `renderRetriedAt` is read for exactly one thing, and it is an honesty requirement rather than a
 * decoration: 33-04 grants ONE automatic retry that leaves `renderStatus: "rendering"` standing, so
 * without this the second sandbox is indistinguishable from the first taking a long time.
 */
export function trackerView(
  scenes: readonly TrackerScene[],
  renderStatus: string | null | undefined,
  captionStatus: string | null | undefined,
  renderRetriedAt: number | null | undefined,
): TrackerView {
  const noun = scenes.some((s) => s.visual !== null) ? "scene" : "block";

  const pictureStates = scenes.filter((s) => buysPicture(s.visual)).map((s) => faceState(s.clip));
  const voiceStates = scenes
    .filter((s) => s.narration.trim() !== "")
    .map((s) => faceState(s.voice));

  const generate = rollUp(pictureStates);
  const voice = rollUp(voiceStates);

  const assembleState: StageState =
    renderStatus === "rendering"
      ? "active"
      : renderStatus === "rendered"
        ? "done"
        : renderStatus === "failed"
          ? "failed"
          : "pending";

  // A deck with no narration is never transcribed — `maybeStartCaptions` never fires, so a
  // `captionStatus` of `pending` on a silent deck means "never", not "soon".
  const caption =
    voiceStates.length === 0
      ? { state: "skipped" as StageState, detail: "Silent reel — nothing to caption." }
      : (CAPTION_DETAIL[captionStatus ?? "pending"] ?? {
          state: "pending" as StageState,
          detail: captionStatus ?? "Burned in once the reel is assembled.",
        });

  return {
    stages: [
      {
        key: "generate",
        label: "Pictures",
        state: generate,
        detail:
          generate === "skipped"
            ? `Nothing to generate — every ${noun} uses your own footage or a text card.`
            : countDetail(pictureStates, noun),
      },
      {
        key: "voice",
        label: "Voice",
        state: voice,
        detail:
          voice === "skipped"
            ? "Silent reel — no narration to record."
            : countDetail(voiceStates, noun),
      },
      {
        key: "assemble",
        label: "Assemble",
        state: assembleState,
        detail:
          assembleState === "active"
            ? renderRetriedAt
              ? "Retrying the assembly — the first attempt failed. (usually 1–3 minutes)"
              : "Assembling the reel… (usually 1–3 minutes)"
            : assembleState === "done"
              ? "Assembled."
              : assembleState === "failed"
                ? "The assembly failed."
                : `Starts once every ${noun}'s picture and voice have landed.`,
      },
      { key: "captions", label: "Captions", state: caption.state, detail: caption.detail },
    ],
    scenes: scenes.map((s, i) => {
      const picture: StageState = buysPicture(s.visual) ? faceState(s.clip) : "skipped";
      const take: StageState = s.narration.trim() === "" ? "skipped" : faceState(s.voice);
      return {
        blockIndex: s.blockIndex,
        label: `${noun === "scene" ? "Scene" : "Block"} ${i + 1}`,
        picture: {
          state: picture,
          text: picture === "skipped" && s.visual !== null ? "nothing to buy" : FACE_TEXT[picture],
        },
        voice: { state: take, text: take === "skipped" ? "silent" : FACE_TEXT[take] },
      };
    }),
  };
}

/** `jobEstimate`'s exact return, structurally. Not imported from the backend on purpose — the point
 *  of typing it here is that a shape change over there shows up as a red test here rather than as a
 *  silently-empty panel. */
export type JobEstimate = {
  lines: Array<{ label: string; qty: number; unit: string; cents: number }>;
  totalCents: number;
  capCents: number;
  remainingCents: number;
  refusal: { reason: string; blockIndex?: number; chars?: number } | null;
};

export type EstimateView = {
  /** The one prominent number. `—` while the query is in flight, which is also the state that keeps
   *  Generate disabled: a button that can spend before the estimate lands breaks D7. */
  headline: string;
  lines: Array<{ label: string; detail: string; amount: string; note: string | null }>;
  remaining: string;
  refusalSentence: string | null;
  generateDisabled: boolean;
};

/**
 * THE ESTIMATE, AS THE CANVAS SHOWS IT — one headline, an expandable breakdown underneath.
 *
 * **It REFORMATS. It never recomputes.** `jobEstimate` builds the same spec list `reserveJobInner`
 * builds and prices it off the same table, so its `totalCents` is the number the rail will actually
 * consume; re-adding the lines here would produce a second, subtly different estimate — and the
 * render line in particular is priced as a constant that no line-sum reproduces. The only
 * arithmetic in this function is cents→USD.
 *
 * `noun`/`maxChars` are the deck's vocabulary and its narration ceiling, which the estimate does not
 * carry — they exist solely to hand `refusalText` what it needs, and touch no number.
 */
export function estimateView(
  est: JobEstimate | undefined,
  o: { noun: "scene" | "block"; maxChars: number },
): EstimateView {
  if (est === undefined) {
    return {
      headline: "—",
      lines: [],
      remaining: "Working out what this reel costs…",
      refusalSentence: null,
      generateDisabled: true,
    };
  }

  const refusalSentence =
    est.refusal === null
      ? null
      : refusalText(est.refusal, {
          capCents: est.capCents,
          totalCents: est.totalCents,
          maxChars: o.maxChars,
          noun: o.noun,
        });

  return {
    headline: usd(est.totalCents),
    lines: est.lines.map((line) => ({
      // The estimate's OWN label, verbatim — including 33-04's "render (incl. one retry)", which is
      // the only place the doubled render constant is visible to the person paying for it.
      label: line.label,
      detail: `${line.qty} × ${line.unit}`,
      amount: usd(line.cents),
      // The 40x lever, on the line it applies to. A blended "pictures" row hid it (wave 7's finding)
      // and so does an itemised one that says nothing: knowing WHICH line is expensive is only
      // useful next to knowing what the cheaper kind costs.
      note:
        line.label === "clips"
          ? "A generated clip costs about 40× an animated still — switching one is the biggest lever here."
          : null,
    })),
    remaining: `${usd(est.remainingCents)} of today's media budget remains.`,
    refusalSentence,
    // Three independent reasons not to spend: the number has not landed, the rail already refused,
    // or there is nothing to buy. Each disables the SAME button, so the .tsx asks one question.
    generateDisabled: est.refusal !== null || est.lines.length === 0,
  };
}

/** WHAT IS BEING PRICED, in the deck's own terms. A scene deck has no single clip length — that
 *  arithmetic is what 20.2 removed — so it is priced as a reel of N scenes, and only a block deck
 *  quotes seconds-per-block. It lives here rather than in the component for the module's own rule:
 *  a sentence that picks between two shapes is a decision, and decisions are testable. */
export const pricedAsLine = (
  targetSeconds: number | null,
  sceneCount: number,
  clipSeconds: number,
): string =>
  targetSeconds === null
    ? `Priced at OpenAI Sora 2, 720p, ${clipSeconds} s per block`
    : `A ${targetSeconds}-second reel of ${sceneCount} scenes, priced per scene`;

/** What the hero slot holds. A discriminated union rather than five booleans, because "playing the
 *  old final AND showing the tracker" is a real state and two booleans would also permit three that
 *  are not. */
export type HeroState =
  | { mode: "tracker"; reason: "never_built" | "out_of_date" }
  /** The final plays. `regenerating` puts the tracker OVER it rather than instead of it — 33-05
   *  holds the validated artifact triple through a re-render precisely so this is possible. */
  | { mode: "video"; url: string; regenerating: boolean; note: string | null }
  /** A hole in the deck. The cure is a per-scene fix (33-04's fix menu), never a retry. */
  | { mode: "held"; sentence: string }
  | { mode: "failed"; sentence: string };

/** The failure codes that mean A SCENE NEVER LANDED — the reel is HELD rather than broken, and the
 *  fix menu on the offending tile is what ends the hold (33-04's re-arm table). Every other code is
 *  a render-side failure whose lever is Retry render. */
const HELD_REASONS = new Set(["incomplete_batch", "not_all_succeeded", "incomplete_blocks"]);

/**
 * WHICH ONE THING THE HERO SHOWS.
 *
 * Two traps are preserved here because both are states a shipped canvas got wrong:
 *
 * 1. **Stale vs never-built are the SAME `renderStatus`.** Both are `pending`; only a landed asset
 *    separates them, and "not assembled yet" on a stale reel is a lie the user can watch.
 * 2. **`rendered` with NO url is a governed REFUSAL to publish, not a missing file.** `media.reel`
 *    returns a url only when the assembly sidecar validated (D8), so this arm says so in words.
 */
export function heroState(
  plan: { renderStatus?: string | null; renderReason?: string | null },
  scenes: readonly TrackerScene[],
  videoUrl: string | null | undefined,
): HeroState {
  const noun = scenes.some((s) => s.visual !== null) ? ("scene" as const) : ("block" as const);
  const status = plan.renderStatus ?? null;
  const reason = plan.renderReason ?? null;

  if (videoUrl) {
    // 33-05: the triple is HELD through a regenerate, so a url can arrive with any status. Only
    // `rendered` means "this is the current one"; everything else is the PREVIOUS reel, and the
    // note says which and why rather than letting it pass as current.
    const note =
      status === "rendered"
        ? null
        : status === "rendering"
          ? "This is the previous reel — the new one is being assembled now."
          : status === "failed"
            ? `This is the previous reel. The new one could not be assembled${reason ? `: ${failureText(reason, noun)}` : "."}`
            : `This is the previous reel — the ${noun}s have changed since it was assembled. Generate again to rebuild it.`;
    return { mode: "video", url: videoUrl, regenerating: status === "rendering", note };
  }

  if (status === "rendered") {
    return {
      mode: "failed",
      sentence:
        "The render finished but did not produce a valid assembly record, so it was not published.",
    };
  }

  if (status === "failed") {
    const what = reason ? failureText(reason, noun) : null;
    return reason !== null && HELD_REASONS.has(reason)
      ? {
          mode: "held",
          sentence: `The reel is held: ${what}. Fix the ${noun} below and it picks up where it stopped.`,
        }
      : {
          mode: "failed",
          sentence: `The reel could not be assembled${what ? `: ${what}` : "."}`,
        };
  }

  // `pending`, `rendering` with no url, or nothing requested at all — the tracker owns the slot.
  const landed = scenes.some(
    (s) => s.clip?.status === "succeeded" || s.voice?.status === "succeeded",
  );
  return {
    mode: "tracker",
    reason: landed && status === "pending" ? "out_of_date" : "never_built",
  };
}

// ── 33-07 — THE BRIEF CHIPS, THE STALE BADGE AND THE TWO-DECK SWITCHER ────────────────────────
//
// **Two surfaces, one brief.** The chat captured it; the canvas is where it can be READ and
// corrected, so the chips are the canvas's account of what was captured and the only place a
// mis-parse is visible before money is spent.
//
// Three rules the derivations below exist to hold, each of which a component could quietly break:
//
// 1. **Only topic and length may block.** `audience`/`tone`/`brandVoice` are exactly the fields an
//    idea-stage tenant cannot fill (Phase 11's sparse start), and a chip row that demanded them
//    would re-gate the users Phase 11 deliberately admitted.
// 2. **A defaulted field is not the user's word, and must say so.** `brief.defaulted` names the
//    fields the model filled in; a chip that renders them identically to a stated one is the
//    provenance-laundering shape this repo already has a defect class for.
// 3. **Length is a preset, never a field.** `editBrief` validates against `TARGET_DURATIONS`, so a
//    control built from anything else can produce an `illegal_duration` the UI could have
//    prevented. Building the options FROM that constant makes the refusal unreachable.

/** The brief plane, structurally (`plans.brief`). `defaulted` is the model-authored-fields list. */
export type Brief = {
  topic: string;
  durationSeconds: number;
  audience?: string | null;
  tone?: string | null;
  brandVoice?: string | null;
  defaulted: readonly string[];
};

export type BriefChipField = "topic" | "durationSeconds" | "audience" | "tone" | "brandVoice";

/** One preset on the length control. `current` is here rather than compared in the `.tsx` so the
 *  selected state is decided once, by the same function that built the list. */
export type BriefOption = { seconds: number; label: string; note: string | null; current: boolean };

export type BriefChip = {
  field: BriefChipField;
  label: string;
  /** The captured value AS TEXT — `""` when nothing was captured, which is a legal resting state
   *  for the three optional fields and never a blocker. */
  value: string;
  required: boolean;
  /** The model filled this in; the user has not stated it. */
  defaulted: boolean;
  /** The marker a defaulted chip carries, else `null`. A WORD, never a colour (BRAND §6). */
  marker: string | null;
  /** False from Generate on — `editBrief` answers `deck_locked` from then on, and a control that
   *  can only buy a refusal must not look like a control. */
  editable: boolean;
  /** What an empty chip says. */
  placeholder: string;
  /** Cost discoverability on the chip itself, in the `KIND_COST_NOTE` idiom. */
  note: string | null;
  /** The preset options. NON-EMPTY ONLY on the length chip; `[]` is what tells the component to
   *  render a text input, so "which fields are free text" is decided here too. */
  options: BriefOption[];
};

export const BRIEF_DEFAULTED_MARKER = "from your profile";
export const BRIEF_OPTIONAL_HINT = "Optional — the agent fills this in if you leave it.";
export const BRIEF_LOCKED_NOTE =
  "This brief was locked when you generated the reel. From here, changes happen scene by scene on the canvas, and each one is paid.";
/** The 60 s note. The multiple is of the FOOTAGE (60/15), which is arithmetic on the presets
 *  themselves — not a price claim — and the second clause names the same lever the clips line and
 *  `KIND_COST_NOTE` name, because that is the one a user can actually pull. */
export const DURATION_COST_NOTE =
  "60 seconds is four times the footage of 15 — the most to fill, and the most to buy unless you lean on stills and cards.";

const CHIP_LABEL: Record<BriefChipField, string> = {
  topic: "Topic",
  durationSeconds: "Length",
  audience: "Audience",
  tone: "Tone",
  brandVoice: "Brand voice",
};

/**
 * THE BRIEF, AS CHIPS — ordered, marked, and blocking on two fields only.
 *
 * No brief → no chips. `editBrief` refuses `no_brief` for the same reason: a chip row built over
 * nothing would let a client-side default be read back as "what the user asked for".
 */
export function briefChips(brief: Brief | null | undefined, deckLocked: boolean): BriefChip[] {
  if (!brief) return [];
  const editable = !deckLocked;
  const marked = (field: BriefChipField): boolean => brief.defaulted.includes(field);

  const text = (
    field: Exclude<BriefChipField, "durationSeconds">,
    required: boolean,
  ): BriefChip => {
    const value = (field === "topic" ? brief.topic : brief[field]) ?? "";
    return {
      field,
      label: CHIP_LABEL[field],
      value,
      required,
      defaulted: marked(field),
      marker: marked(field) ? BRIEF_DEFAULTED_MARKER : null,
      editable,
      placeholder: required ? "What the reel is about" : BRIEF_OPTIONAL_HINT,
      note: null,
      options: [],
    };
  };

  return [
    text("topic", true),
    {
      field: "durationSeconds",
      label: CHIP_LABEL.durationSeconds,
      value: `${brief.durationSeconds} seconds`,
      required: true,
      defaulted: marked("durationSeconds"),
      marker: marked("durationSeconds") ? BRIEF_DEFAULTED_MARKER : null,
      editable,
      placeholder: "",
      // ONE carrier, never two. The note is on the CHIP when 60 is the current ask (read without
      // opening anything) and on the OPTION when it is not (read before it is chosen) — so the
      // component renders both slots unconditionally and the sentence still appears exactly once.
      note: brief.durationSeconds === 60 ? DURATION_COST_NOTE : null,
      options: TARGET_DURATIONS.map((seconds) => ({
        seconds,
        label: `${seconds}s`,
        note: seconds === 60 && seconds !== brief.durationSeconds ? DURATION_COST_NOTE : null,
        current: seconds === brief.durationSeconds,
      })),
    },
    text("audience", false),
    text("tone", false),
    text("brandVoice", false),
  ];
}

/** `editBrief`'s refusals, in words. Two of the three are unreachable from a correctly built chip
 *  row — the row does not render without a brief, and the length control is built from
 *  `TARGET_DURATIONS` — so this map is the fail-closed backstop rather than the expected path. It
 *  lives here, not in the component, for the module's own rule: a sentence a user reads is a thing
 *  that can be wrong without anyone clicking. */
export function briefRefusalText(reason: string): string {
  switch (reason) {
    case "deck_locked":
      return BRIEF_LOCKED_NOTE;
    case "illegal_duration":
      return `A reel is ${TARGET_DURATIONS.slice(0, -1).join(", ")} or ${TARGET_DURATIONS.at(-1)} seconds long — nothing between.`;
    case "no_brief":
      return "There's no brief on this plan yet, so there's nothing to edit here.";
    default:
      return "That change could not be saved. Nothing was altered.";
  }
}

export const DECK_STALE_NOTE = "Brief changed — storyboards may be out of date.";
export const REPROPOSE_LABEL = "Re-propose (free)";
/** The canned turn. It goes through the ORDINARY chat send path (`useSendCockpitMessage`), so it
 *  lands in the transcript like any other message and must read like one a person could have typed
 *  — a second UI→dispatch entry point is the named anti-pattern this replaces. */
export const REPROPOSE_MESSAGE = "Re-propose storyboards for the updated brief.";

/**
 * IS THE DECK BEHIND THE BRIEF?
 *
 * True iff BOTH stamps exist and the brief moved last. An absent stamp is never stale, and both
 * absences are real states: an unedited brief (`briefChangedAt` unset) and a brief with no deck
 * proposed yet (`deckProposedAt` unset) must each read as "nothing has drifted", not as a badge
 * over an empty canvas. Equal stamps are the propose-then-stamp case, not an edit.
 *
 * NOTHING auto-fires from this. The badge and the button are the whole affordance — the re-propose
 * costs a model turn, and D7's rule is that a spend follows a click.
 */
export const deckStale = (
  briefChangedAt: number | null | undefined,
  deckProposedAt: number | null | undefined,
): boolean =>
  typeof briefChangedAt === "number" &&
  typeof deckProposedAt === "number" &&
  briefChangedAt > deckProposedAt;

/** One deck element, as a summary needs it — a structural subset of `plans.shots[]`/`altShots[]`. */
export type SummaryShot = { visual?: string | null; seconds: number; description: string };

export type DeckSummary = {
  /** The opening scene's description — the shortest honest answer to "what is this one?". */
  concept: string;
  sceneCount: number;
  /** `2 × ANIMATED STILL · 1 × TEXT CARD`, in `KIND_LABEL`'s own words so the compare card and the
   *  tiles below it name the same things. */
  kindMix: string;
  duration: string;
};

/**
 * ONE FOLD, USED TWICE — which is the whole point.
 *
 * A compare region whose two halves are built by two pieces of code is a region where one side can
 * count scenes while the other counts shots, or one totals the real durations while the other
 * quotes the declared target. The duration here is the SUM of the deck's own scene lengths (the
 * ribbon's arithmetic), never `targetDurationSeconds`: a deck that does not add up to its declared
 * length is exactly the thing a user comparing two proposals needs to see.
 */
export function deckSummary(shots: readonly SummaryShot[] | null | undefined): DeckSummary | null {
  if (!shots || shots.length === 0) return null;
  const counts = new Map<string, number>();
  for (const s of shots) {
    const kind = asVisualKind(s.visual);
    const label = kind ? KIND_LABEL[kind] : "BLOCK";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return {
    concept: shots[0]?.description.trim() ?? "",
    sceneCount: shots.length,
    kindMix: [...counts].map(([label, n]) => `${n} × ${label}`).join(" · "),
    duration: durationLabel(shots.reduce((ms, s) => ms + s.seconds * 1000, 0)),
  };
}

export type VariationView = {
  hasAlternate: boolean;
  locked: boolean;
  canSwitch: boolean;
  picked: DeckSummary | null;
  alternate: DeckSummary | null;
};

/**
 * THE A/B REGION'S WHOLE STATE.
 *
 * `locked` wins over everything. `generateReel` clears `altShots` in the same patch that stamps
 * `deckLockedAt`, so a locked plan with an alternate should not exist — but `switchDeck` answers
 * `deck_locked` BEFORE it looks for one, and a canvas that rendered the compare card off a stale
 * row would be offering a control that can only ever refuse. The alternate is `null` when locked,
 * so the region is simply absent after Generate rather than present-and-disabled.
 */
export function variationView(plan: {
  shots?: readonly SummaryShot[] | null;
  altShots?: readonly SummaryShot[] | null;
  deckLockedAt?: number | null;
}): VariationView {
  const locked = plan.deckLockedAt !== undefined && plan.deckLockedAt !== null;
  const hasAlternate = !locked && Boolean(plan.altShots && plan.altShots.length > 0);
  return {
    hasAlternate,
    locked,
    canSwitch: hasAlternate,
    picked: deckSummary(plan.shots),
    alternate: hasAlternate ? deckSummary(plan.altShots) : null,
  };
}

/** Is this document usable as an `uploaded_video` scene's source? The SAME narrowing the render
 *  applies (`resolveRenderAsset` serves `video/*` only, and `batchToRender` refuses anything else),
 *  stated once here so the picker cannot offer a document the render would then reject.
 *
 *  33-05: the check is over WHAT THE BYTES ARE — `storedMimeType ?? mimeType`, the same fallback
 *  the render now uses. A saved reel is a markdown row (the searchable transcript) carrying mp4
 *  bytes, and it is immediately reusable as footage; a plain video upload is unchanged. */
export const isPickableVideo = (doc: {
  mimeType?: string | null;
  storedMimeType?: string | null;
  status?: string;
}): boolean =>
  (doc.storedMimeType ?? doc.mimeType ?? "").startsWith("video/") && doc.status !== "failed";

// ── 33-08 — THE CITATIONS AND THE FAILURE CARDS ───────────────────────────────────────────────
//
// The last two canvas surfaces, and both of them are about being right on somebody else's behalf:
// one about whose WORD a figure is, the other about whose MONEY is already gone.
//
// Three rules the derivations below exist to hold:
//
// 1. **A citation is a link only when the document is genuinely this tenant's.** `sceneCitations`
//    returns `verified:false` for a foreign, malformed or deleted docId — deliberately
//    indistinguishable from each other so a probing model learns nothing — and a UI that minted a
//    `PreviewModal` link off one would be offering a cross-tenant click-through.
// 2. **Only the OWNER vouches.** A model-authored figure becomes the user's word through the
//    confirm click and nothing else, so the badge is a request rather than a decoration — and a
//    scene the backend never flagged gets NO confirm button, because `confirmClaim` would answer
//    `not_a_claim` and a control that can only refuse must not look like a control (33-07's rule).
// 3. **Media money never resolves.** `UNLANDED_RESOLVES.media === false`: a failed line's
//    reservation is spent, permanently, and `actualCents` "stays absent if it failed"
//    (`media.ts`). So a failed face's cost is its ESTIMATE and a landed one's is its ACTUAL, and
//    neither may ever be rendered as pending.

/** One row of `media.sceneCitations`. `title`/`docId` are MODEL-AUTHORED text; `verified` is the
 *  server's answer to "is that id a document of yours?", checked where the id is consumed. */
export type Citation = {
  sceneIndex: number;
  docId: string | null;
  title: string | null;
  verified: boolean;
  needsConfirmation: boolean;
  confirmedAt: number | null;
};

export type SceneCitation = {
  sceneIndex: number;
  /** `unverified` is a FOURTH state the plan did not name, and it is not a rounding of
   *  `needs_confirmation`: the backend's confirm gate keys on `needsConfirmation`, so a scene with
   *  only a bad source has nothing confirmable and does not block Generate. Rendering it as "needs
   *  your confirmation" would promise a button that refuses and a gate that is not there. */
  kind: "cited" | "unverified" | "needs_confirmation" | "confirmed";
  /** The doc, ONLY when verified. `null` is inert by construction — see rule 1. */
  link: { title: string; docId: string } | null;
  label: string;
  /** The confirm control's words, or `null` when there is nothing this scene can confirm. */
  action: string | null;
};

export type CitationView = {
  /** Keyed by `sceneIndex`, because a tile knows its own index and nothing else. An ABSENT entry
   *  is the "claims nothing" state — `sceneCitations` omits those scenes, and inventing an empty
   *  chip for them would put a provenance affordance on creative copy that needs none. */
  byScene: Record<number, SceneCitation>;
  unconfirmedCount: number;
  /** The sentence beside the disabled Generate button. `jobEstimate`'s `unconfirmed_claims`
   *  refusal stays the authoritative copy; this one is the COUNT, which the refusal cannot give
   *  (it names only the first offending scene). */
  blockLine: string | null;
};

export const CONFIRM_ACTION = "This is my number — confirm";
export const UNVERIFIED_LABEL = "Source not in your vault — this citation can't be checked.";
export const NEEDS_CONFIRMATION_LABEL =
  "The agent wrote this figure. Confirm it to make it your word.";
export const CONFIRMED_LABEL = "You confirmed this figure.";

export function citationView(citations: readonly Citation[] | null | undefined): CitationView {
  const byScene: Record<number, SceneCitation> = {};
  let unconfirmedCount = 0;

  for (const c of citations ?? []) {
    // The link is decided ONCE, before any branch, so no arm can accidentally mint one from an
    // unverified row — the property is structural rather than repeated in four places.
    const link =
      c.verified && c.docId !== null && c.title !== null
        ? { title: c.title, docId: c.docId }
        : null;
    const kind: SceneCitation["kind"] = c.needsConfirmation
      ? c.confirmedAt !== null
        ? "confirmed"
        : "needs_confirmation"
      : link !== null
        ? "cited"
        : "unverified";
    if (kind === "needs_confirmation") unconfirmedCount += 1;
    byScene[c.sceneIndex] = {
      sceneIndex: c.sceneIndex,
      kind,
      link,
      label:
        kind === "cited"
          ? (link?.title ?? "")
          : kind === "confirmed"
            ? CONFIRMED_LABEL
            : kind === "needs_confirmation"
              ? NEEDS_CONFIRMATION_LABEL
              : UNVERIFIED_LABEL,
      action: kind === "needs_confirmation" ? CONFIRM_ACTION : null,
    };
  }

  return {
    byScene,
    unconfirmedCount,
    blockLine:
      unconfirmedCount === 0
        ? null
        : `Confirm ${unconfirmedCount} claim${unconfirmedCount === 1 ? "" : "s"} to enable Generate.`,
  };
}

/** A job face with its money and its code. A superset of `TrackerScene`'s face, so ONE array
 *  serves both folds — the tracker and the cards cannot disagree about which scene failed.
 *
 *  `failureReason` is a CODE by schema contract (`mediaJobs.failureReason`: "a CODE only … never
 *  provider prose"), which is what makes it safe to render at all. */
export type FailureFace = {
  status: string;
  failureReason: string | null;
  estUsd: number;
  actualCents: number | null;
};

export type FailureScene = Omit<TrackerScene, "clip" | "voice"> & {
  clip: FailureFace | null;
  voice: FailureFace | null;
};

export type FixArm =
  | "regenerate"
  | "text_card"
  | "animated_image"
  | "uploaded_video"
  | "retry_render"
  /** 33-13. The PROPOSAL stage's only arm: re-ask the specialist. It buys no media at all, which
   *  is why it is the one arm whose price label is unconditional. */
  | "retry_proposal";

export type FailureFix = {
  arm: FixArm;
  label: string;
  /** FREE vs PAID is never implicit. Every arm says which it is, in the same slot. */
  priceLabel: string;
  note: string | null;
};

export type FailureCard = {
  key: string;
  /** `hero` cards describe the REEL and render in the hero slot; `scene` cards render on their
   *  tile, where the levers already live. */
  where: "hero" | "scene";
  sceneIndex: number | null;
  headline: string;
  sceneRef: string | null;
  /** What this scene's attempt already cost, phrased as spent. `null` on a reel-level card: the
   *  render's own money is a reserved line, and quoting a scene's spend there is the wrong
   *  ledger. */
  sunkLine: string | null;
  fixes: FailureFix[];
  /** The support vocabulary, verbatim and subordinate. Never inside the prose above. */
  detailCode: string | null;
};

const FAILED = (f: FailureFace | null): boolean =>
  f !== null && (f.status === "failed" || f.status === "blocked");

/**
 * WHAT THIS FACE HAS ALREADY COST, and the branch is the no-refunds rule.
 *
 * A LANDED row reconciled to `actualCents` — the exact bill. A row that failed has no
 * `actualCents` and never will (`media.ts`: "absent until a row lands, and stays absent if it
 * failed"), so its reservation IS the cost: `UNLANDED_RESOLVES.media` is `false`, which is the
 * ledger's way of saying that money is not coming back.
 */
const faceCents = (f: FailureFace | null): number =>
  f === null ? 0 : (f.actualCents ?? Math.round(f.estUsd * 100));

/** What re-buying this scene reserves, from the rows' OWN reserved prices. Not a re-pricing: these
 *  are the numbers `chooseMediaBatch` produced for these exact specs, and `regenerateBlock` hands
 *  the same specs back to the same table. */
const sceneEstCents = (s: FailureScene): number =>
  Math.round(((s.clip?.estUsd ?? 0) + (s.voice?.estUsd ?? 0)) * 100);

/** The kinds a failed picture can be swapped TO, cheapest-consequence first. `generated_video` is
 *  absent on purpose: switching to it buys the same thing that just failed. */
const SWAP_ARMS = [
  {
    arm: "text_card" as const,
    label: "Replace it with a text card",
    priceLabel: "free",
    note: "A card is drawn when the reel is assembled, so nothing is bought and the reel can finish.",
  },
  {
    arm: "animated_image" as const,
    label: "Switch it to an animated still",
    priceLabel: "free to switch",
    note: "The still itself is bought when you regenerate — about a fortieth of a generated clip.",
  },
  {
    arm: "uploaded_video" as const,
    label: "Use your own footage",
    priceLabel: "free",
    note: "Nothing is bought for this scene — pick the video on this scene below.",
  },
];

/** The codes that mean A SCENE NEVER LANDED (`HELD_REASONS`, above) — the reel is HELD and the
 *  lever is that scene's fix menu. A "Retry render" here would buy a second sandbox over the same
 *  hole, which is the exact spend 33-04 exists to prevent. */

/**
 * EVERY ACTIVE FAILURE, AS A CARD.
 *
 * Hero cards first (the reel's own state is read before its scenes'), then one card per failed
 * scene in deck order. A deck with nothing wrong returns `[]`, so the component renders the region
 * or not off `.length` rather than off five booleans.
 */
export function failureCards(
  plan: {
    renderStatus?: string | null;
    renderReason?: string | null;
    renderRetriedAt?: number | null;
    captionStatus?: string | null;
    captionReason?: string | null;
  },
  scenes: readonly FailureScene[],
  estimate: JobEstimate | undefined,
): FailureCard[] {
  const noun = scenes.some((s) => s.visual !== null) ? ("scene" as const) : ("block" as const);
  const word = noun === "scene" ? "Scene" : "Block";
  const cards: FailureCard[] = [];

  // The estimate's OWN render line, never a constant of ours: `regenerateBlock` reserves a render
  // alongside the scene (a changed scene makes the published mp4 stale), so a retry price that
  // omitted it would understate the bill — the one direction a money label must never err in.
  const renderCents = estimate?.lines.find((l) => l.label.startsWith("render"))?.cents ?? null;

  const failedScenes = scenes
    .map((s, position) => ({ s, position }))
    .filter(({ s }) => FAILED(s.clip) || FAILED(s.voice));

  // ── THE REEL'S OWN CARDS ────────────────────────────────────────────────────────────────────
  if (plan.renderStatus === "failed") {
    const reason = plan.renderReason ?? null;
    const clause = failureClause(reason, noun);
    if (reason !== null && HELD_REASONS.has(reason)) {
      const first = failedScenes[0];
      const ref = first ? `${word} ${first.position + 1}` : null;
      cards.push({
        key: "hero-held",
        where: "hero",
        sceneIndex: first?.s.blockIndex ?? null,
        headline: `The reel is held — ${clause}. ${
          ref
            ? `Fix ${ref} below and it picks up where it stopped.`
            : `Fix the ${noun} below and it picks up where it stopped.`
        }`,
        sceneRef: ref,
        sunkLine: null,
        // No arm of its own, deliberately: the levers are on the scene's card, and a second copy
        // of them here would be two controls for one fix.
        fixes: [],
        detailCode: reason,
      });
    } else {
      cards.push({
        key: "hero-render",
        where: "hero",
        sceneIndex: null,
        headline: `The reel could not be assembled — ${clause}.`,
        sceneRef: null,
        sunkLine: null,
        fixes: [
          {
            arm: "retry_render",
            label: "Retry render",
            priceLabel: "free — the compute was already reserved",
            note: plan.renderRetriedAt
              ? "The first attempt already retried automatically, so this is a third sandbox on the same reserved line."
              : null,
          },
        ],
        detailCode: reason,
      });
    }
  }

  // 20-17's rule, said to the user: a caption failure NEVER unpublishes the reel. There is no
  // re-burn mutation, so this card carries no arm — it reports a degraded deliverable rather than
  // offering a fix that does not exist.
  if (plan.captionStatus === "failed") {
    cards.push({
      key: "hero-captions",
      where: "hero",
      sceneIndex: null,
      headline: `The reel is published without its captions — ${failureClause(plan.captionReason, noun)}.`,
      sceneRef: null,
      sunkLine: null,
      fixes: [],
      detailCode: plan.captionReason ?? null,
    });
  }

  // ── THE PER-SCENE CARDS ─────────────────────────────────────────────────────────────────────
  for (const { s, position } of failedScenes) {
    const pictureFailed = FAILED(s.clip);
    const voiceFailed = FAILED(s.voice);
    const pictureWord = s.visual === "animated_image" ? "still" : "picture";
    const said = (f: FailureFace | null, what: string): string =>
      f?.status === "blocked"
        ? `its ${what} was refused by the provider's content check`
        : `its ${what} failed`;

    const parts = [
      pictureFailed ? said(s.clip, pictureWord) : null,
      voiceFailed ? said(s.voice, "voice take") : null,
    ].filter((p): p is string => p !== null);
    // The CODE becomes a sentence when the vocabulary knows it, and stays out of the prose when it
    // does not — the detail line below carries it either way.
    const known = [
      pictureFailed ? s.clip?.failureReason : null,
      voiceFailed ? s.voice?.failureReason : null,
    ].find((r) => r != null && failureText(r, noun) !== r);
    const because = known ? ` — ${failureText(known, noun)}` : "";

    cards.push({
      key: `scene-${s.blockIndex}`,
      where: "scene",
      sceneIndex: s.blockIndex,
      headline: `This ${noun}: ${parts.join(" and ")}${because}.`,
      sceneRef: `${word} ${position + 1}`,
      sunkLine: `This ${noun}'s attempt cost ${usd(faceCents(s.clip) + faceCents(s.voice))} — a failed line is never refunded, so that money is spent either way.`,
      fixes: [
        {
          arm: "regenerate",
          label: `Buy this ${noun} again`,
          priceLabel:
            renderCents === null
              ? `${usd(sceneEstCents(s))} adds, plus the re-assembly`
              : `${usd(sceneEstCents(s) + renderCents)} adds`,
          note: `Buys this ${noun}'s picture and voice again and re-assembles the reel. The other ${noun}s are kept.`,
        },
        // A KIND SWITCH ONLY HELPS A PICTURE. If the take is what failed, a text card changes
        // nothing about the missing voice — offering it would be a free click that fixes nothing.
        ...(pictureFailed ? SWAP_ARMS.filter((a) => a.arm !== s.visual) : []),
      ],
      detailCode:
        [
          pictureFailed && s.clip?.failureReason ? `picture: ${s.clip.failureReason}` : null,
          voiceFailed && s.voice?.failureReason ? `voice: ${s.voice.failureReason}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
    });
  }

  return cards;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 33-13 — THE PROPOSAL STAGE, IN THE SAME VOCABULARY AS THE RENDER STAGE
//
// The owner asked for a reel twice and got a dead end both times: the deck refused, the row landed
// as a memo, and the card offered **Approve** and **Save** — two acts that mean nothing over a reel
// that does not exist — with the only way forward buried in prose. In their words: *"the user just
// stays there and stares at the screen where nothing happens."*
//
// Nothing new was needed to fix it. The RENDER stage has spoken this language since 33-04/33-08 —
// a card that names the stage, says the cause in words, prices every way out and carries the code
// underneath — so the proposal stage speaks it too, through the SAME `FailureCard` shape and the
// SAME component. The one new arm re-asks the specialist through the cockpit's own send path.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** `plans.proposalRefusal`, structurally. `contract` crosses the wire as a string (the closed set
 *  lives in `@pikar/core`), so it is narrowed here rather than trusted. */
export type ProposalRefusal = {
  reason: string;
  contract: string;
  variation?: string | null;
};

export const RETRY_PROPOSAL_LABEL = "Try again";

/** The canned turn the retry sends. It reads like something a person could have typed, because it
 *  lands in the transcript as an ordinary message — the same rule 33-07's re-propose follows. */
export const RETRY_PROPOSAL_MESSAGE =
  "That storyboard didn't come out usable — try the reel again from the same brief.";

/**
 * A REFUSED PROPOSAL, AS A CARD.
 *
 * `null` for a row with no refusal on it, so the caller renders this or not off one value — an
 * ordinary memo stays an ordinary memo.
 *
 * The CONTRACT picks the sentence. `no_deck` means "no scene deck" under one parser and "no block
 * deck" under the other, and guessing between them is how a card tells a user the wrong thing
 * about what the model wrote; the backend stores which parser refused for exactly this reason.
 */
export function proposalFailureCard(
  refusal: ProposalRefusal | null | undefined,
): FailureCard | null {
  if (!refusal) return null;
  const contract: DeckContract = refusal.contract === "block" ? "block" : "scene";
  // The code becomes a SENTENCE here and stays out of the headline — an unknown code falls back to
  // the generic clause rather than putting a support string in front of a person (33-08's rule).
  const clause = deckRefusalClause(contract, refusal.reason);
  const which = refusal.variation ? ` variation ${refusal.variation.toUpperCase()}:` : "";
  return {
    key: "proposal-refused",
    where: "hero",
    sceneIndex: null,
    headline: `I couldn't turn this into a usable storyboard —${which} ${clause}.`,
    sceneRef: null,
    // NOT a money figure, and deliberately so: this stage refuses BEFORE any reservation exists,
    // so there is no `estUsd` to quote and quoting one would invent a bill. What the user needs to
    // know at this moment is that the failure cost them nothing.
    sunkLine: "No video, voice or render was bought — this stopped before anything was generated.",
    fixes: [
      {
        arm: "retry_proposal",
        label: RETRY_PROPOSAL_LABEL,
        priceLabel: "free — nothing was generated",
        note: "Asks for a fresh storyboard from the same brief. Nothing is bought until you approve the cost.",
      },
    ],
    detailCode: refusal.variation
      ? `${refusal.reason} · variation ${refusal.variation}`
      : refusal.reason,
  };
}

/**
 * THE SALVAGE, SAID OUT LOUD (33-13, disclosing 33-11).
 *
 * 33-11 stopped one refusing variation from killing its good sibling — the survivor is proposed
 * ALONE and `plans.lostVariation` records which sibling was lost and why. That row exists to be
 * READ. A user who was promised two storyboards and silently handed one has been told something
 * untrue by omission, and would never know to ask for the other.
 *
 * The surviving letter is DERIVED (`a` <-> `b`), not stored, because the variation plane is
 * exactly two decks by construction — `parseVariations` has no third letter to produce. Naming
 * both is the point: a sentence that only names the loss leaves the reader guessing which of the
 * two is on their screen.
 */
export function salvageNote(
  lost: { variation: string; reason: string } | null | undefined,
): string | null {
  if (!lost) return null;
  const lostLetter = lost.variation.toUpperCase() === "A" ? "A" : "B";
  const keptLetter = lostLetter === "A" ? "B" : "A";
  // Always the SCENE contract: variations exist only under it (`parseVariations` runs
  // `parseSceneDeck` on each slice and nothing else).
  const clause = deckRefusalClause("scene", lost.reason);
  return `Only one of the two storyboards could be built: variation ${keptLetter} is the one below, and variation ${lostLetter} fell through because ${clause}. Ask me to redo the variations if you want the choice back.`;
}

/** `plans.deckAdjustments`, structurally (`SceneAdjustment` on the wire). `why` is a string here
 *  for the same reason `visual` is: the closed set lives in `@pikar/core`, not in Convex. */
export type DeckAdjustment = {
  sceneIndex: number;
  fromSeconds: number;
  toSeconds: number;
  why: string;
};

export const DECK_ADJUSTED_LEDE =
  "I had to change some scene lengths before this reel could be built:";

/**
 * EVERY SECOND THE PARSER MOVED (33-13, disclosing 33-12).
 *
 * 33-12 snaps an off-grid `generated_video` scene DOWN to a length the provider can actually make
 * and gives the freed seconds to the last non-generated scene, so the reel still runs as long as
 * the user asked. That is the parser REWRITING the user's reel, and the committed rule is that it
 * must never be silent: a quiet rewrite is the same defect class as an invented provenance — the
 * change may be right, but the person who asked for it has to be told.
 *
 * The DIRECTION is in the verb ("shortened from 10s to 8s"), not just in two numbers, because a
 * pair of numbers under swapped labels reads perfectly and says the opposite thing. An unknown
 * `why` still reports the seconds: the disclosure is not conditional on our vocabulary.
 */
export function adjustmentNotes(
  adjustments: readonly DeckAdjustment[] | null | undefined,
  targetDurationSeconds: number | null | undefined,
): string[] {
  if (!adjustments || adjustments.length === 0) return [];
  // The legal lengths come from the SAME constant the parser snaps to, so this sentence cannot
  // name a set the repair does not actually use.
  const legal = GENERATED_CLIP_SECONDS.join(", ").replace(/, (\d+)$/, " or $1");
  return adjustments.map((a) => {
    const moved = `${a.fromSeconds}s to ${a.toSeconds}s`;
    const verb = a.toSeconds < a.fromSeconds ? "shortened" : "lengthened";
    const head = `Scene ${a.sceneIndex + 1} ${verb} from ${moved}`;
    if (a.why === "grid") return `${head} — the generator only makes ${legal} second clips.`;
    if (a.why === "rebalance") {
      // No declared length, no number: `targetDurationSeconds` is absent on a block deck, and a
      // reel length invented here would be a claim about the deck that nothing on it supports.
      return targetDurationSeconds == null
        ? `${head} — the seconds freed above went back into it, so the reel is still its full length.`
        : `${head} — the seconds freed above went back into it, so the reel is still ${targetDurationSeconds} seconds.`;
    }
    // The narration repair trades seconds between two scenes, and the pair is emitted receiver-
    // first — so the donor's sentence can point AT the one above it, the way `rebalance` does.
    // Reading the direction off the numbers rather than off a second `why` is what keeps the two
    // halves from ever swapping sentences.
    if (a.why === "narration") {
      return a.toSeconds > a.fromSeconds
        ? `${head} — so its spoken line has room to finish before the next one starts.`
        : `${head} — those seconds went to the scene above, so its line has room to finish.`;
    }
    return `${head}.`;
  });
}
