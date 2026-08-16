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
  const voiceStates = scenes.filter((s) => s.narration.trim() !== "").map((s) => faceState(s.voice));

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
  return { mode: "tracker", reason: landed && status === "pending" ? "out_of_date" : "never_built" };
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
