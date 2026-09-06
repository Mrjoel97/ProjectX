/**
 * The render stage's PURE half (MEDIA-01, D11). Pure TS, Convex-free AND SDK-free (CLAUDE.md §1).
 *
 * Imported by BOTH the Next.js route handler that actually starts the sandbox
 * (`apps/web/app/api/media/render/route.ts`) and the Convex action that calls it
 * (`convex/render/renderReel.ts`), so every guarantee below is asserted ONCE and enforced twice.
 *
 * Two jobs, and they are the two directions of the same trust boundary:
 *   * `buildSandboxOptions` — what we hand the VM. The cross-tenant leak vectors are closed here.
 *   * `validateRenderReturn` / `reasonCodeFor` — what we accept back. Nothing a VM returns reaches
 *     a user without passing through this file.
 */

import {
  ASSEMBLY_VISUALS,
  type AssemblyError,
  type AssemblyReport,
  type AssemblyVisual,
  parseAssemblySidecar,
} from "./assembly";
import { MUSIC_MOODS, type MusicMood, TARGET_DURATIONS } from "./storyboard";

// ── The duration ceiling (plan 20-15 Task 1, settled 2026-08-02) ───────────────────────────────
//
// Under D11 the runner is a Vercel function, so the BINDING ceiling is the function's max duration
// — NOT Convex's 10-minute action limit. Owner confirmed the project is on **Pro**, where 300 s is
// permitted. The modelled render is 60-150 s, so this is ~2x headroom.

/** The route's `export const maxDuration`. The route re-exports this rather than restating it, so
 *  the number a test asserts against and the number Vercel enforces cannot drift apart. */
export const RENDER_MAX_DURATION_S = 300;

/** The sandbox's own timeout, STRICTLY BELOW the route's ceiling. The 60 s gap is teardown margin:
 *  the VM must be stopped by us rather than orphaned by the function being killed mid-`finally`. */
export const RENDER_SANDBOX_TIMEOUT_MS = 240_000;

/** 2 vCPU -> 4 GB RAM (Vercel allots 2048 MB per vCPU). The delta's 60-150 s render estimate is
 *  measured at this size; changing it invalidates the estimate and the ~$0.010/render figure. */
export const RENDER_SANDBOX_VCPUS = 2;

/** The shape `Sandbox.create` is called with. Declared HERE, structurally, rather than imported
 *  from `@vercel/sandbox` — this package must not gain that dependency (CLAUDE.md §1), and a
 *  structural type still makes the call site type-check against the SDK. */
export type SandboxOptions = {
  readonly source: { readonly type: "snapshot"; readonly snapshotId: string };
  readonly resources: { readonly vcpus: number };
  readonly timeout: number;
  readonly networkPolicy: "deny-all";
  readonly persistent: false;
};

/**
 * The sandbox options, as a pure function of the snapshot id and nothing else.
 *
 * **Why this is a function and not an inline object literal at the call site:** it is the same move
 * plan 20-05 makes with `buildSubmitBody` — *"the body is a function of the spec, and nothing
 * else."* An inline literal inside `await Sandbox.create({...})` can only be tested by calling the
 * SDK, which means a real VM, a real credential and a real cost. Factored out, the two structural
 * invariants below become plain object assertions that run offline at $0 — and a test can be
 * OBSERVED to go red when either one is deleted.
 *
 * `persistent: false` is MANDATORY and the SDK DEFAULT IS TRUE. Left unset, the SDK snapshots the
 * filesystem on stop and restores it on the next resume — so tenant A's clips, voice takes and
 * final.mp4 would survive into the VM that renders tenant B's reel. That is a cross-tenant data
 * leak created by an unset option, not by a bug. `name` is also never passed: a named sandbox is
 * resumable BY NAME, which is the whole persistence mechanism. The test asserts `"name" in opts`
 * is false, not that `opts.name` is undefined — an explicit `name: undefined` would pass the
 * weaker check and still hand the SDK a key.
 *
 * `deny-all` and a per-invocation ffmpeg download are mutually exclusive — which is exactly why the
 * snapshot exists (see `scripts/bake-sandbox-snapshot.mjs`). If a download fallback is ever needed,
 * the order is: download FIRST, then `sandbox.update({ networkPolicy: 'deny-all' })`, and ONLY THEN
 * `writeFiles` tenant bytes in. A `writeFiles` of tenant content ordered before the policy flip is
 * the warning sign.
 */
export function buildSandboxOptions(a: { snapshotId: string; timeoutMs?: number }): SandboxOptions {
  return {
    source: { type: "snapshot", snapshotId: a.snapshotId },
    resources: { vcpus: RENDER_SANDBOX_VCPUS },
    // Clamped, not merely defaulted: a caller passing a timeout at or above the route's ceiling
    // would orphan the VM, and this builder is the only place that invariant can be held for every
    // caller at once. `Math.min` is the whole enforcement.
    timeout: Math.min(a.timeoutMs ?? RENDER_SANDBOX_TIMEOUT_MS, RENDER_SANDBOX_TIMEOUT_MS),
    networkPolicy: "deny-all",
    persistent: false,
  };
}

// ── What goes IN: the filenames, and the ONE origin the runner may fetch from ──────────────────

/**
 * The input filename `assemble_final.sh` will look for, derived from the job row's OWN
 * `blockIndex` and `kind`.
 *
 * **The script discovers inputs BY INDEX, not from a manifest** (20-13): `<in>/block01.mp4` +
 * `<in>/voice01.wav`, **1-based, zero-padded to two digits**. Upstream passed positional
 * clip/voice pairs and needed an `--allow-mismatch` sanity check because "block03 + voice05" was
 * its #1 failure; deriving both names from the same counter makes that mismatch impossible
 * instead of detectable. This function is where that counter lives, so the two names cannot be
 * derived by two different pieces of code and drift.
 *
 * `blockIndex` is 0-based on the row (it indexes `plans.shots`); the script is 1-based. That +1 is
 * the entire reason this is a function and not a template literal at the call site.
 *
 * The voice extension is `.wav` because the submit arm PINS `sample_rate_hertz` to 24000 and the
 * landing plane records 24 kHz mono 16-bit PCM (`mediaComplete.ts:98-100`). If the TTS endpoint is
 * ever swapped for one returning mp3, this line and that constant move together.
 */
export function renderInputName(
  kind: "video" | "tts" | "image" | "card",
  blockIndex: number,
): string {
  const n = String(blockIndex + 1).padStart(2, "0");
  switch (kind) {
    case "video":
      return `block${n}.mp4`;
    // 20.2 wave 5. A still is `blockNN.png` — the SAME stem as a clip, because the assembler picks
    // the branch from the scene KIND it was given, not from what it found lying in the directory.
    // One stem per index is also what keeps "block03 + voice05" impossible.
    case "image":
      return `block${n}.png`;
    case "card":
      return `card${n}.txt`;
    case "tts":
      return `voice${n}.wav`;
  }
}

/** Exactly the names `renderInputName` can produce. The runner validates every filename it is
 *  handed against this before writing a byte — a name from a request body reaching `writeFiles`
 *  unchecked is a path traversal into the VM's filesystem. */
export const RENDER_INPUT_NAME =
  /^(?:block\d{2}\.(?:mp4|png)|voice\d{2}\.wav|card\d{2}\.txt|music\.(?:mp3|m4a|ogg|wav|flac))$/;

/** 33.1-06: the ONE music bed, fetched from a public library and shipped as an input like any
 *  stock still. The extension set is exactly what `assemble_final.sh` probes for in its baked
 *  library, so a fetched track and a baked one are the same thing to the assembler. */
export const RENDER_MUSIC_NAME = /^music\.(?:mp3|m4a|ogg|wav|flac)$/;
/** The input name the bed is shipped under. Openverse serves `audio/mpeg`, hence mp3. */
export const MUSIC_INPUT_NAME = "music.mp3";
/** Where the bed's stock row sits among a plan's `mediaJobs`: captions (`stt`) are `-1`, the
 *  deck's scenes are `0..n-1`, and the bed — deck-wide like captions — lives one below them. Both
 *  the writer (`media.reserveSceneJobInner`) and the reader (`renderReel.batchToRender`) import
 *  this rather than each spelling a number. */
export const MUSIC_BLOCK_INDEX = -2;

/** A card's name specifically, for the one input whose CONTENT travels in the request body rather
 *  than being resolved server-side from a job id. */
export const RENDER_CARD_NAME = /^card\d{2}\.txt$/;

/**
 * The ceiling on a text card's words.
 *
 * A card is a few lines on a 9:16 frame; anything approaching this is already unreadable at that
 * size. It is a bound on what crosses into the VM, not a style rule — and it is small deliberately,
 * because this is the ONLY input whose bytes come from the request body instead of from a
 * tenant-scoped job row.
 */
export const RENDER_MAX_CARD_CHARS = 512;

/**
 * Is this text safe to write into the VM as a card?
 *
 * `assemble_final.sh` already removes the injection half — `textfile=` (not `text=`) means no shell
 * or filtergraph escaping is involved, and `expansion=none` means drawtext will not EVALUATE
 * `%{...}` as an ffmpeg expression. What is left is the bytes themselves: a NUL truncates the file
 * for whatever reads it next, and other control characters are not glyphs anyone asked to burn into
 * a frame. Newline is the one that is meaningful — it is how a card gets two lines.
 *
 * REFUSED rather than sanitised. A silently stripped character is a card that renders differently
 * from the deck the owner approved, which is the failure mode this whole subsystem is arranged
 * against.
 */
export const isRenderableCardText = (text: string): boolean => {
  if (text.trim().length === 0 || text.length > RENDER_MAX_CARD_CHARS) return false;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    // A codepoint scan rather than a regex with escaped control ranges: the escaping is the part
    // that goes wrong, and what this actually says is one sentence.
    if (ch !== "\n" && (c < 0x20 || c === 0x7f)) return false;
  }
  return true;
};

/**
 * The ONE origin the render runner is permitted to fetch tenant bytes from: this deployment's own
 * Convex HTTP-actions origin, derived from the deployment URL rather than accepted from a request.
 *
 * **This is the SSRF guard.** `http.ts`'s fal webhook learned it the expensive way — an unguarded
 * fetch of a URL supplied by a third party is a fetch of whatever the caller names. Here the caller
 * is our own Convex action, but the rule does not soften for a trusted caller: the runner builds
 * every blob URL itself, from this origin plus a job id, so there is no URL in the request body at
 * all and nothing to validate.
 *
 * Convex's mapping: the HTTP-actions origin is the deployment URL with `.convex.cloud` replaced by
 * `.convex.site`. A LOCAL deployment is the same host on port 3211 instead of 3210 — which is why
 * this handles both rather than assuming a cloud deployment (this repo's `CONVEX_DEPLOYMENT` is
 * local, see CLAUDE.md §7).
 */
export function convexSiteOrigin(deploymentUrl: string): string {
  const url = new URL(deploymentUrl);
  if (url.hostname.endsWith(".convex.cloud")) {
    return `${url.protocol}//${url.hostname.replace(/\.convex\.cloud$/, ".convex.site")}`;
  }
  // Local backend: the HTTP-actions port is the deployment port + 1.
  if (url.port === "3210") return `${url.protocol}//${url.hostname}:3211`;
  throw new Error("Cannot derive the Convex site origin from this deployment URL");
}

// ── What comes BACK (the other direction of the same boundary) ─────────────────────────────────

/** A plausible finished reel: 6 x 10 s of 480p h264 lands around 5-15 MB. The floor catches a
 *  truncated or header-only file that still carries a valid `ftyp`; the ceiling is an abuse stop,
 *  not a budget. */
export const RENDER_MIN_BYTES = 200 * 1024;
export const RENDER_MAX_BYTES = 200 * 1024 * 1024;

export type RenderReturnError =
  | { code: "missing_output" }
  | { code: "empty_output" }
  | { code: "not_an_mp4" }
  | { code: "implausible_size"; bytes: number }
  | { code: "invalid_sidecar"; detail: AssemblyError | "missing" };

export type RenderReturn =
  | { ok: true; report: AssemblyReport }
  | ({ ok: false } & RenderReturnError);

/** ISO 14496-12: bytes 4..8 of an mp4 are the literal `ftyp` box type. Read as bytes, never by
 *  decoding the whole buffer to a string — a 200 MB `toString()` on untrusted input is its own
 *  problem. */
const hasFtypMagic = (mp4: Uint8Array): boolean =>
  mp4.length >= 8 &&
  mp4[4] === 0x66 && // f
  mp4[5] === 0x74 && // t
  mp4[6] === 0x79 && // y
  mp4[7] === 0x70; // p

/**
 * The mp4 half of the return check, on its own so the CAPTION burn (plan 20-17) is held to the
 * SAME bar as the assemble pass — same magic bytes, same size band, same codes.
 *
 * Returns the error, or `null` for "these bytes are a plausible mp4". Split out rather than
 * duplicated: a second copy of the size band is a second number to forget to update, and a caption
 * burn that skipped these checks would publish whatever the VM handed back over a reel that was
 * already validated.
 */
export function validateMp4Bytes(
  mp4: Uint8Array | null,
): ({ ok: false } & RenderReturnError) | null {
  if (mp4 === null) return { ok: false, code: "missing_output" };
  if (mp4.byteLength === 0) return { ok: false, code: "empty_output" };
  if (!hasFtypMagic(mp4)) return { ok: false, code: "not_an_mp4" };
  if (mp4.byteLength < RENDER_MIN_BYTES || mp4.byteLength > RENDER_MAX_BYTES) {
    return { ok: false, code: "implausible_size", bytes: mp4.byteLength };
  }
  return null;
}

/**
 * Everything the sandbox returns, checked before anything is published.
 *
 * The VM is a trust boundary in BOTH directions: we put no credential in, and we take nothing on
 * faith out. Each failure gets its OWN code because each one sends an operator somewhere different
 * — a missing file means the script died, a bad magic number means it wrote something that is not
 * a video, and an invalid sidecar means the render was not governed.
 *
 * The sidecar check DELEGATES to the shipped `parseAssemblySidecar` rather than re-deriving its
 * rules. That matters for one case in particular: a syntactically valid sidecar reporting
 * `overrun: true` is D8's HARD ERROR arriving from the renderer, and `assembly.ts` already refuses
 * it. Publishing it anyway would mean shipping a reel whose narration overran its window — so this
 * function must NOT swallow that error into a warning.
 */
export function validateRenderReturn(a: {
  mp4: Uint8Array | null;
  sidecar: string | null;
}): RenderReturn {
  const mp4 = validateMp4Bytes(a.mp4);
  if (mp4) return mp4;
  if (a.sidecar === null) return { ok: false, code: "invalid_sidecar", detail: "missing" };

  const parsed = parseAssemblySidecar(a.sidecar);
  if (!parsed.ok) return { ok: false, code: "invalid_sidecar", detail: parsed.error };
  return { ok: true, report: parsed.value };
}

// ── ffmpeg's stderr, reduced to a code ─────────────────────────────────────────────────────────

/**
 * The CLOSED set of render reason codes. Every one is a route an operator takes:
 * `speech_out_of_window` -> rewrite the line and re-voice; `clip_too_short` -> regenerate the
 * block; `missing_binary` -> re-bake the snapshot; `sandbox_timeout` -> cut blocks or raise the
 * ceiling.
 */
export type RenderReasonCode =
  | "ok"
  | "bad_invocation"
  | "missing_binary"
  | "input_missing"
  | "speech_out_of_window"
  | "clip_too_short"
  | "missing_narration"
  | "duration_mismatch"
  | "no_audio_stream"
  | "decode_failed"
  | "sandbox_timeout"
  | "caption_track_empty"
  // 33.1-06: the two refusals the first rendered reel actually hit, both of which had collapsed
  // to `render_failed` — a clear ERROR line thrown away one hop before the person who needed it.
  | "card_font_missing"
  | "narration_overruns_reel"
  | "render_failed";

/** Anchored on `assemble_final.sh`'s OWN error wording, in order. Each pattern matches the fixed
 *  part of a message and never the interpolated part — a filename or a narration line sits in the
 *  gaps these patterns skip over. */
const STDERR_CODES: ReadonlyArray<readonly [RegExp, RenderReasonCode]> = [
  [/'(?:ffmpeg|ffprobe|awk)' not found/, "missing_binary"],
  [/not found:/, "input_missing"],
  [
    /--blocks N is REQUIRED|--blocks must be a positive integer|unsupported --clip-seconds|--target-seconds must be a positive integer|the assembler will not pad or trim to reach a target|unknown scene kind:|pass --scene OR --blocks|must be a positive whole number of seconds|unknown argument:|--subs was removed/,
    "bad_invocation",
  ],
  // 20.2 wave 4 replaced the per-cell speech band with two TIMELINE errors, and these patterns
  // must move with it. They did not in wave 4, which meant a line running past the reel came back
  // as the catch-all `render_failed` instead of the code that tells an operator to rewrite it.
  [/would be cut mid-word|two narrators would speak at once/, "speech_out_of_window"],
  [/a held still frame is not a scene/, "clip_too_short"],
  [/is NOT in the mix/, "missing_narration"],
  [/!= declared/, "duration_mismatch"],
  [/no readable audio stream|mismatched\/truncated audio/, "no_audio_stream"],
  [/failed decode validation/, "decode_failed"],
  // `burn_caps.sh`'s own wording (plan 20-17), anchored on the fixed part exactly as above.
  [/libass is missing/, "missing_binary"],
  // `assemble_final.sh`'s drawtext probe. Its message was NOT in this table when it first fired
  // (2026-08-15, the pipefail+SIGPIPE race) and surfaced as the catch-all `render_failed`.
  [/libfreetype is missing/, "missing_binary"],
  [/subtitle track is empty/, "caption_track_empty"],
  [/re-timed the video/, "duration_mismatch"],
  // The card branch refuses before drawing when no TrueType font is reachable — the first live
  // reel's actual cause. Environmental (an image/runner without the font), never the deck's.
  [/needs a TrueType font/, "card_font_missing"],
  // The ONE overrun the assembler still refuses (33.1-06): a take still speaking when the picture
  // track has ended. Nothing can delay it further; only a shorter line or a longer reel cures it.
  [/is still speaking at .* but the reel ends at/, "narration_overruns_reel"],
];

/** Codes the RUNNER produces before or around the sandbox, as distinct from the ones ffmpeg
 *  produces inside it. Kept in the same closed-union spirit: a reason is a code, always. */
export type RenderRunnerCode =
  | "unauthorized"
  | "not_configured"
  | "bad_request"
  | "input_fetch_failed"
  | "upload_failed";

/**
 * A CODE from a failed render, following `calendar.ts:84`'s reasonCode idiom.
 *
 * **ffmpeg's stderr contains file paths and, on a caption burn, narration text. It is CLAUDE.md §4
 * content and must never be persisted.** This function is the ONLY place a stderr string may be
 * READ, and it returns a value from the closed union above — the input can therefore not appear in
 * the output by construction, not by careful escaping. `stderr()` appearing anywhere else in the
 * render diff is the warning sign, and `llmRedaction.test.ts` scans for exactly that.
 */
export function reasonCodeFor(exitCode: number, stderrSample: string): RenderReasonCode {
  if (exitCode === 0) return "ok";
  for (const [pattern, code] of STDERR_CODES) {
    if (pattern.test(stderrSample)) return code;
  }
  // Shell conventions: 124 is `timeout`'s own code, 137 is SIGKILL (the VM being reaped), 143 is
  // SIGTERM. All three mean the render ran out of wall clock rather than failing a gate.
  if (exitCode === 124 || exitCode === 137 || exitCode === 143) return "sandbox_timeout";
  if (exitCode === 2) return "bad_invocation";
  return "render_failed";
}

/**
 * The CLOSED set of render-failure codes the ONE automatic retry may fire on (33-04) — a narrow,
 * documented supersession of 20-16's "a failed render does NOT retry" (see `media.md`). That rule's
 * reasoning stands for every code NOT in this list: a structural failure repeats, and a retry is a
 * second sandbox buying the same stderr.
 *
 * Membership means "plausibly environmental": the snapshot/env race (`missing_binary` — the
 * 2026-08-15 SIGPIPE class fired exactly here), the three transport legs around the sandbox
 * (`route_unreachable`, `input_fetch_failed`, `upload_failed`), a submit that never reached the
 * provider (`submit_failed`), and the catch-all `render_failed` — an UNMATCHED stderr is not
 * provably structural, so unknown-but-named gets its one retry. Everything else — the deterministic
 * ffmpeg codes, `sandbox_timeout` (the remedy is "cut blocks or raise the ceiling", not a re-roll),
 * and every route/runner DECISION (`unauthorized`, `bad_request`, `route_rejected`, ...) — fails
 * straight to the dead letter.
 *
 * Adding a member is a MONEY decision, not a patch: each retry is a sandbox the reserved render
 * line must cover (the line is doubled at `MEDIA_SANDBOX_USD_PER_RENDER` for exactly one).
 */
export const TRANSIENT_RENDER_CODES = [
  "missing_binary",
  "route_unreachable",
  "input_fetch_failed",
  "upload_failed",
  "submit_failed",
  "render_failed",
] as const;

const TRANSIENT_SET = new Set<string>(TRANSIENT_RENDER_CODES);

/** Membership in the closed list above, and NOTHING else — an unknown string returns false, so a
 *  future code cannot inherit a retry it was never granted. */
export function isTransientRenderCode(code: string): boolean {
  return TRANSIENT_SET.has(code);
}

/**
 * Does the deck still need what this job row was buying? (33-04, the fix-menu re-arm.)
 *
 * A failed job holds the reel (`incomplete_batch`) — but a FREE fix (kind switch to a card, vault
 * asset pick) changes the DECK, not the batch, so the failed row keeps existing. This predicate is
 * what lets both the render trigger and `batchToRender` ignore a terminal row whose scene no
 * longer wants that kind of picture, without ever loosening the rule for rows the deck still
 * depends on. ONE function for both call sites, so the trigger and the builder cannot disagree
 * about what "needed" means.
 *
 * `shot === undefined` — the deck shrank past this row's index; the row is history, not a hold.
 * A BLOCK row (no `visual`) is a video by construction, exactly as `assemblerKindOf` reads it.
 */
export function deckStillNeedsJob(
  shot: { visual?: string; narration: string } | undefined,
  kind: "video" | "image" | "tts",
): boolean {
  if (shot === undefined) return false;
  if (kind === "tts") return shot.narration.trim() !== "";
  if (kind === "image") return WANTS_IMAGE_ROW.has(shot.visual ?? "");
  return shot.visual === undefined || WANTS_VIDEO_ROW.has(shot.visual);
}

/* Which deck kinds expect a LANDED `mediaJobs` row of each sort. Sets rather than a `||` chain
 * because this predicate is compile-SILENT: it string-compares `visual`, so a new `VisualKind`
 * that buys a row is not a type error here — it is a deck whose scene reports "needs no job",
 * which lets the render trigger fire before its bytes have landed and holds the reel at
 * `incomplete_blocks` with no lever. That is exactly what `stock_video`/`stock_image` would have
 * done. `renderInputName.test.ts` iterates `VISUAL_KINDS` against these two sets so the next kind
 * is caught by a red test instead of by a held reel.
 *
 * The kinds absent from BOTH are the ones that land no bytes at all: `uploaded_video` (resolved
 * from the vault at render time) and `text_card` (drawn in the sandbox). */
const WANTS_VIDEO_ROW = new Set(["generated_video", "stock_video"]);
const WANTS_IMAGE_ROW = new Set(["animated_image", "stock_image"]);

/**
 * Does this scene land a `mediaJobs` picture row AT ALL — of either kind?
 *
 * `deckStillNeedsJob` asks this per row kind because the render trigger holds a row at a time; the
 * canvas tracker asks it per SCENE, to decide whether a scene's picture face is a real state or the
 * words "nothing to buy". Same question, and it must have the same answer — so it is derived from
 * the same two sets rather than re-listed, which is the mistake this exists to close.
 *
 * **It is the PIPELINE question, deliberately not the money one.** `PAID_VISUAL`
 * (`storyboard.ts`) says stock is free, and stock still lands a row — "'Unpaid' and 'no provider
 * line' came apart here", in that table's own words. The tracker used to answer with a re-listed
 * copy of the PAID set, so a stock scene whose fetch FAILED was drawn as "nothing to buy", was left
 * out of the Pictures count entirely, and the stage read `Done — All 2 ready` over a hole. The
 * render trigger, reading the sets below, correctly refused to buy a sandbox and held the reel at
 * `incomplete_batch` — so the screen named a scene to fix whose own row said there was nothing
 * wrong with it. A held reel with no visible lever is the worst state this canvas can reach.
 *
 * `undefined`/`null` is a block-contract row, which is a video by construction — the same reading
 * `deckStillNeedsJob` and `assemblerKindOf` give it.
 */
export const landsPictureRow = (visual: string | null | undefined): boolean =>
  visual === undefined ||
  visual === null ||
  WANTS_VIDEO_ROW.has(visual) ||
  WANTS_IMAGE_ROW.has(visual);

/* ── TEXT-CARD COLOUR (the deck's own palette, finally reaching the frame) ──────────────────────
 *
 * A card was black-and-white until this existed, while the deck it belongs to carried a palette
 * the specialist chose, the parser validated and the owner approved on screen. Nothing was missing
 * from the renderer; the wire simply stopped three-quarters of the way.
 *
 * **THESE STRINGS ARE INTERPOLATED INTO AN FFMPEG FILTERGRAPH**, which is why the shape is fixed
 * here rather than at the shell. A card's WORDS are safe by construction — `textfile=` keeps them
 * out of the filter string and `expansion=none` stops `%{...}` being evaluated — but a colour has
 * to be written INTO that string, so it is the first model-derived value that ever reaches it.
 * Everything below produces `0x` plus exactly six hex digits or nothing at all; `parseBody` then
 * re-checks the same shape at the route, and the script bounds the charset a third time. None of
 * the three makes the others redundant.
 */

/** `0xRRGGBB`, and nothing else, ever. The one shape allowed near the filtergraph. */
export const CARD_COLOR = /^0x[0-9A-Fa-f]{6}$/;

/** Today's card, and the fallback whenever a palette yields no usable colour — a block deck has no
 *  art direction at all, and a scene deck may have a palette written in words. Unchanged output
 *  for every reel that was renderable before this existed. */
export const CARD_DEFAULT_BG = "0x000000";
export const CARD_DEFAULT_INK = "0xFFFFFF";

/** The first 6-digit hex anywhere in a palette entry, normalised. The parser deliberately does NOT
 *  validate the palette (`storyboard.ts`: "the palette rule is the SKILL BODY's to teach, not this
 *  parser's"), so entries arrive as `#1B4B43`, `1B4B43`, or `teal (#1B4B43)` — and sometimes as
 *  `warm amber`, which yields nothing and must not become a colour. */
const hexIn = (entry: string): string | null => {
  const m = /(?:^|[^0-9A-Fa-f])([0-9A-Fa-f]{6})(?![0-9A-Fa-f])/.exec(entry);
  return m?.[1] ? `0x${m[1].toUpperCase()}` : null;
};

/** WCAG relative luminance. Needed rather than a cheap average because "is this dark?" decides
 *  whether the words on top of it are readable, and green reads far lighter than blue at the same
 *  average. Unreadable text is an accessibility failure, not a styling preference. */
const luminance = (color: string): number => {
  const channel = (i: number): number => {
    const v = Number.parseInt(color.slice(2 + i * 2, 4 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
};

/**
 * The deck's palette → the two colours a card is drawn with.
 *
 * The BACKGROUND comes from the palette, because that is the brand signal a viewer actually reads.
 * The INK does NOT: it is computed as whichever of black or white contrasts more with that
 * background. Picking the ink from the palette too would look more designed and would eventually
 * put a mid-tone on a mid-tone, which is a card nobody can read — and the deck would still pass
 * every gate, because the file decodes and the duration is right.
 *
 * ponytail: two colours and a computed ink, not a themed layout engine. The ceiling is that every
 * card in a reel looks the same and the palette's other entries are unused. The upgrade path is a
 * per-scene accent drawn from `palette[1]` — at which point THIS function grows a third return
 * value and nothing else in the chain moves.
 */
export function cardColorsOf(palette: readonly string[] | undefined): {
  bg: string;
  ink: string;
} {
  const bg = (palette ?? []).map(hexIn).find((c): c is string => c !== null);
  if (bg === null || bg === undefined) return { bg: CARD_DEFAULT_BG, ink: CARD_DEFAULT_INK };
  // 0.179 is the standard crossover: above it black wins the contrast ratio, below it white does.
  return { bg, ink: luminance(bg) > 0.179 ? "0x000000" : "0xFFFFFF" };
}

// ── The RUNNER: the route handler's whole body, with the SDK injected ──────────────────────────
//
// The Next.js route file is a ~20-line adapter over this function (CLAUDE.md §1: domain logic in
// `packages/*`, the framework file is thin). That split is not tidiness — it is the ONLY way the
// security behaviour is testable. `apps/web` has no unit-test runner, and every assertion that
// matters here ("a bad bearer creates NO sandbox", "nothing forbidden crosses in", "an untrusted
// return publishes nothing") is a statement about control flow that a Playwright test cannot make
// and a real `Sandbox.create` would charge for. With the SDK injected, all of it runs at $0.

/** The slice of `@vercel/sandbox`'s Sandbox this runner uses. Structural, so the real SDK object
 *  satisfies it without this package ever depending on the SDK. `content` is a `Uint8Array` rather
 *  than a `Buffer` so core stays Node-free; the adapter wraps. */
export type SandboxLike = {
  mkDir(path: string): Promise<void>;
  writeFiles(files: Array<{ path: string; content: Bytes }>): Promise<void>;
  runCommand(
    cmd: string,
    args?: string[],
  ): Promise<{ exitCode: number; stderr(): Promise<string> }>;
  readFileToBuffer(file: { path: string }): Promise<Bytes | null>;
  stop(): Promise<unknown>;
};

/** Bytes backed by a real `ArrayBuffer`, which is what a Node `Buffer`, `TextEncoder.encode` and
 *  `new Uint8Array(await res.arrayBuffer())` all produce. TS 5.9 made `Uint8Array` generic over
 *  its buffer, and a bare `Uint8Array` is the SharedArrayBuffer-permitting supertype that `Blob`
 *  and `BodyInit` reject. Naming it once beats an `as` cast at every boundary. */
type Bytes = Uint8Array<ArrayBuffer>;

export type RenderDeps = {
  /** `MEDIA_RENDER_SECRET`. `undefined` means UNSET, which is a 401 — never a skipped check. */
  secret: string | undefined;
  /** `MEDIA_SANDBOX_SNAPSHOT_ID`. Unset is a governed stop, not a sandbox without ffmpeg. */
  snapshotId: string | undefined;
  /** The Convex deployment URL (`NEXT_PUBLIC_CONVEX_URL`). BOTH origins are derived from it, so
   *  no origin is ever taken from a request body. */
  deploymentUrl: string | undefined;
  createSandbox: (options: SandboxOptions) => Promise<SandboxLike>;
  fetch: typeof globalThis.fetch;
  /** The assemble script's bytes. Passed in rather than imported so this package does not reach
   *  into `packages/backend` — and so a test can prove the script is written to the VM. */
  assembleScript: string;
  /** The caption burn's bytes, same contract (plan 20-17). */
  burnScript: string;
};

/** The `.ass` track is the ONLY content this endpoint has ever accepted in a request body, and it
 *  is capped for the same reason every other input is: a 200 MB "subtitle track" is not a subtitle
 *  track. A 60 s reel's track is a few kilobytes. */
export const CAPTION_MAX_ASS_BYTES = 512 * 1024;

/** The filenames the burn pass uses. Built HERE, never taken from the body: caption mode carries no
 *  filename at all, which is a whole class of path-traversal that cannot reach it. */
export const CAPTION_IN_NAME = "final.mp4";
export const CAPTION_SUBS_NAME = "caps.ass";
export const CAPTION_OUT_NAME = "out/final.captioned.mp4";

type RenderRequestBody =
  | {
      mode: "assemble";
      renderId: string;
      /** The DECLARED reel length. The scenes must sum to it, here and in the script. */
      targetSeconds: number;
      /** The reel, in order. Order IS the index — the same rule the deck parser follows. */
      scenes: Array<{ kind: AssemblyVisual; seconds: number }>;
      inputs: Array<{ name: string; jobId: string }>;
      /** Text cards: the only input whose bytes come from the body rather than a job row. */
      cards: Array<{ name: string; text: string }>;
      /** The music bed's mood slug, or absent for a reel with no bed. NOT an input: the bytes are
       *  baked into the sandbox snapshot, so nothing is fetched, written or uploaded for it — this
       *  is a name the script resolves against its own library. That is why it is not in
       *  `RENDER_INPUT_NAME` and needs no path guard here beyond the closed set. */
      music?: MusicMood;
      /** 33.1-06: the FETCHED bed's input name (`music.mp3`). Unlike `music`, this IS an input —
       *  it must also appear in `inputs`, so its bytes are resolved server-side from a job row
       *  like every stock still — and the assembler is told the track is already in `in/` rather
       *  than left to probe a library the snapshot never had. The mood still travels in `music`
       *  for the sidecar and the log line. */
      musicFile?: string;
      /** The card palette, already resolved to two `0xRRGGBB` strings by `cardColorsOf`. Resolved
       *  UPSTREAM rather than sending the raw palette: the deck's palette is model-authored free
       *  text and these two values are interpolated into a filtergraph, so the narrowing happens
       *  once, in one tested function, instead of at whichever end happens to look. Absent means
       *  the black-and-white card every reel had before. */
      card?: { bg: string; ink: string };
      uploadUrls: { mp4: string; sidecar: string };
    }
  | {
      mode: "caption";
      renderId: string;
      /** The opaque id the blob route resolves to the published `final.mp4`. */
      sourceId: string;
      ass: string;
      uploadUrls: { mp4: string };
    };

/** The reel lengths the deck header, the price table and the assembler agree on. A target outside
 *  this set is a reel nobody priced — the same closed-set rule `clipSeconds` used to carry. */
const TARGET_SECONDS_SET = new Set<number>(TARGET_DURATIONS);

/** The three kinds of picture the assembler can build, as the script names them. */
const SCENE_KIND_SET = new Set<string>(ASSEMBLY_VISUALS);

/** The mood slugs the baked library can be asked for. Closed here as well as at the parser and the
 *  price table, and the reason is the reason every closed set in this file is repeated: this one is
 *  applied to a value arriving in a REQUEST BODY, and "the caller already checked" is not a
 *  property of a body. The slug is interpolated into a path inside the VM. */
const MUSIC_MOOD_SET = new Set<string>(MUSIC_MOODS);

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Shape-validate the body. Every refusal is `bad_request` with NO echo of what was wrong — the
 *  body is the one thing here that could carry content, and a validation message is a classic way
 *  to reflect it straight back out (§4). */
function parseBody(raw: unknown, uploadOrigin: string): RenderRequestBody | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (!isStr(b.renderId)) return null;

  /** Same guard both modes need: an upload URL must be on the origin WE derived, never one we were
   *  handed — the write-direction SSRF guard. */
  const sameOrigin = (url: unknown): url is string => {
    if (!isStr(url)) return false;
    try {
      return new URL(url).origin === uploadOrigin;
    } catch {
      return false;
    }
  };

  // CAPTION MODE (plan 20-17). Deliberately validated FIRST and completely separately: it shares
  // the bearer, the sandbox options and the return checks with assemble, and shares NONE of its
  // input shape. Threading one optional field through the assemble validator would have made every
  // assemble-mode guard conditional, which is how a guard stops holding.
  if (b.mode === "caption") {
    // An id, not a name and not a path — it is only ever appended to OUR origin.
    if (!isStr(b.sourceId) || !/^[A-Za-z0-9_-]{1,64}$/.test(b.sourceId)) return null;
    if (!isStr(b.ass) || b.ass.length > CAPTION_MAX_ASS_BYTES) return null;
    const up = b.uploadUrls;
    if (up === null || typeof up !== "object") return null;
    const { mp4 } = up as Record<string, unknown>;
    if (!sameOrigin(mp4)) return null;
    return {
      mode: "caption",
      renderId: b.renderId,
      sourceId: b.sourceId,
      ass: b.ass,
      uploadUrls: { mp4 },
    };
  }

  // ASSEMBLE MODE, on the SCENE contract (20.2 wave 5). `blockCount` + `clipSeconds` described a
  // reel of N identical windows and cannot describe this one, so they are gone rather than
  // defaulted — a caller still sending them is a stale Convex deployment, and defaulting would let
  // it render a reel of the wrong shape instead of being told.
  if (typeof b.targetSeconds !== "number" || !TARGET_SECONDS_SET.has(b.targetSeconds)) return null;
  if (!Array.isArray(b.scenes) || b.scenes.length === 0) return null;
  if (!Array.isArray(b.inputs) || b.inputs.length === 0) return null;

  const scenes: Array<{ kind: AssemblyVisual; seconds: number }> = [];
  let summed = 0;
  for (const entry of b.scenes) {
    if (entry === null || typeof entry !== "object") return null;
    const { kind, seconds } = entry as Record<string, unknown>;
    if (!isStr(kind) || !SCENE_KIND_SET.has(kind)) return null;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1) return null;
    summed += seconds;
    scenes.push({ kind: kind as AssemblyVisual, seconds });
  }
  // The script asserts this too, and refuses before doing any work. Asserting it HERE as well is
  // the cheaper of the two failures by a whole sandbox: a deck that does not add up to what it
  // declared never gets a VM at all.
  if (summed !== b.targetSeconds) return null;

  const inputs: Array<{ name: string; jobId: string }> = [];
  for (const entry of b.inputs) {
    if (entry === null || typeof entry !== "object") return null;
    const { name, jobId } = entry as Record<string, unknown>;
    // THE PATH-TRAVERSAL GUARD. A filename from a request body reaching `writeFiles` unchecked
    // writes wherever the caller names — including over `assemble_final.sh` itself, which would
    // make this endpoint arbitrary code execution inside the VM.
    if (!isStr(name) || !RENDER_INPUT_NAME.test(name)) return null;
    // A card's bytes come from `cards`, never from a job id. A `cardNN.txt` arriving here would
    // otherwise be fetched from the blob route, which resolves job ids — so the two lists must not
    // overlap, or a caller could name a card and be handed some other tenant-scoped asset's bytes.
    if (RENDER_CARD_NAME.test(name)) return null;
    // A Convex id is opaque; it only ever gets appended to OUR origin, so the guard it needs is
    // "no path characters", not "is a valid id".
    if (!isStr(jobId) || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return null;
    inputs.push({ name, jobId });
  }

  // THE CARDS — the ONLY input whose CONTENT travels in the request body. Everything else here is
  // a job id resolved server-side against a tenant-scoped row; a card is model-authored text with
  // no row of its own, so it is bounded here instead: a card filename (nothing else), and text
  // that is printable. `assemble_final.sh` handles the other half with `textfile=` and
  // `expansion=none`, which is what stops those words being evaluated as an ffmpeg expression.
  const cards: Array<{ name: string; text: string }> = [];
  const rawCards = b.cards === undefined ? [] : b.cards;
  if (!Array.isArray(rawCards)) return null;
  for (const entry of rawCards) {
    if (entry === null || typeof entry !== "object") return null;
    const { name, text } = entry as Record<string, unknown>;
    if (!isStr(name) || !RENDER_CARD_NAME.test(name)) return null;
    if (typeof text !== "string" || !isRenderableCardText(text)) return null;
    cards.push({ name, text });
  }

  // EVERY SCENE MUST HAVE ITS INPUT, checked before a VM exists. The script discovers inputs by
  // index and hard-errors on the first one missing — which is a $0.01 sandbox spent to learn
  // something derivable from the body. A `card` scene is satisfied by `cards`, never by `inputs`.
  const present = new Set([...inputs.map((i) => i.name), ...cards.map((c) => c.name)]);
  for (const [i, scene] of scenes.entries()) {
    if (!present.has(renderInputName(scene.kind, i))) return null;
  }
  const names = [...inputs.map((i) => i.name), ...cards.map((c) => c.name)];
  if (new Set(names).size !== names.length) return null; // one file, one writer

  // THE MUSIC BED. Absent is the normal case and is not a refusal; PRESENT and outside the closed
  // set IS a refusal, rather than being dropped to "no bed". A slug we do not recognise means the
  // caller and this runner disagree about the library — most likely a Convex deployment newer than
  // the web one — and rendering a silently bedless reel would hide that behind a finished file.
  // The script bounds the charset again on its own side; neither check makes the other redundant.
  if (b.music !== undefined && (!isStr(b.music) || !MUSIC_MOOD_SET.has(b.music))) return null;
  const music = b.music as MusicMood | undefined;

  // 33.1-06: the fetched bed. A closed name (no path characters, by regex), and it must be one of
  // the inputs above — a `musicFile` that names a file nobody fetched would make the assembler
  // fail on a missing track after every other input had landed. Refused here, before a VM.
  if (b.musicFile !== undefined) {
    if (!isStr(b.musicFile) || !RENDER_MUSIC_NAME.test(b.musicFile)) return null;
    if (!inputs.some((i) => i.name === b.musicFile)) return null;
  }
  const musicFile = b.musicFile as string | undefined;

  // THE CARD PALETTE, and this is a TRUST BOUNDARY rather than a format check. Both values are
  // written into an ffmpeg filtergraph inside the VM, so the shape is re-asserted here even though
  // `cardColorsOf` can only produce it: this runner validates what it was SENT, never what it
  // assumes the sender computed. A malformed pair is a refused render, not a card quietly drawn in
  // the default colours — the same reasoning as the music slug directly above.
  let card: { bg: string; ink: string } | undefined;
  if (b.card !== undefined) {
    const c = b.card as Record<string, unknown> | null;
    if (c === null || typeof c !== "object") return null;
    if (!isStr(c.bg) || !isStr(c.ink)) return null;
    if (!CARD_COLOR.test(c.bg) || !CARD_COLOR.test(c.ink)) return null;
    card = { bg: c.bg, ink: c.ink };
  }

  const up = b.uploadUrls;
  if (up === null || typeof up !== "object") return null;
  const { mp4, sidecar } = up as Record<string, unknown>;
  // The WRITE-direction SSRF guard. These URLs come from the body (Convex mints them per render),
  // so the runner POSTs bytes to them — and must not POST a tenant's reel to a host of the
  // caller's choosing. Their origin has to be the deployment we derived, not one we were handed.
  if (!sameOrigin(mp4) || !sameOrigin(sidecar)) return null;

  return {
    mode: "assemble",
    renderId: b.renderId,
    targetSeconds: b.targetSeconds,
    scenes,
    inputs,
    cards,
    ...(music === undefined ? {} : { music }),
    ...(musicFile === undefined ? {} : { musicFile }),
    ...(card === undefined ? {} : { card }),
    uploadUrls: { mp4, sidecar },
  };
}

/** Constant-time bearer comparison. `timingSafeEqual` needs equal lengths, so both sides are
 *  hashed first — which also removes the length leak. Injected hash-free: a plain char-fold is
 *  enough here and keeps this package dependency-free.
 *
 *  ponytail: a fold-and-compare over the full length of BOTH strings, rather than `node:crypto`'s
 *  `timingSafeEqual`. It is constant-time in the same sense (no early exit, every character read)
 *  and it keeps `packages/core` free of a Node import, which is what lets this whole runner be
 *  imported by a test that is not running under Node's crypto. Upgrade path if this endpoint ever
 *  guards something more valuable than a render: `crypto.timingSafeEqual` over two SHA-256
 *  digests, in the adapter. */
function bearerMatches(header: string, expected: string): boolean {
  const want = `Bearer ${expected}`;
  let diff = header.length ^ want.length;
  const n = Math.max(header.length, want.length);
  for (let i = 0; i < n; i++) {
    diff |=
      (i < header.length ? header.charCodeAt(i) : 0) ^ (i < want.length ? want.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/** Bytes up through one of the single-use, write-only URLs Convex minted. **The MIME type is
 *  OURS** — passed as a literal by the caller, never read from the VM's response. Module-level so
 *  the assemble pass and the caption burn upload through the same four lines. */
async function uploadTo(
  fetchFn: typeof globalThis.fetch,
  url: string,
  bytes: Bytes,
  type: string,
): Promise<string | null> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": type },
    // A Blob rather than the raw view: it is the shipped storage idiom (`http.ts:301` stores
    // `new Blob([bytes], { type: mimeType })`) and it carries OUR asserted type on the body as
    // well as the header.
    body: new Blob([bytes], { type }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const parsed = (await res.json().catch(() => null)) as { storageId?: unknown } | null;
  return isStr(parsed?.storageId) ? parsed.storageId : null;
}

const jsonStop = (code: RenderRunnerCode | RenderReasonCode | RenderReturnError["code"]) =>
  // A 200 with `ok: false`: a governed stop, not a transport failure. The Convex side records the
  // reason instead of the action-retrier re-running a deterministic failure at $0.02 a go.
  Response.json({ ok: false, code }, { status: 200 });

/**
 * THE CAPTION BURN (plan 20-17) — the route's second mode, and deliberately the same sandbox.
 *
 * `buildSandboxOptions` is REUSED UNCHANGED rather than a second literal being written here: a
 * second sandbox-creation path is a second place for `persistent: false` to go missing, which is a
 * cross-tenant leak created by an unset option. `render.test.ts` asserts the two modes produce an
 * identical options object for exactly that reason.
 *
 * **This is the one thing that crosses INTO the VM that the assemble pass never sends: NARRATION
 * TEXT.** The `.ass` track is model-authored words, and burning captions means putting them on
 * screen — there is no version of this stage that keeps them out. What still never crosses: any
 * credential, any tenant id, any fal URL, any signed storage URL. The track is escaped by
 * `@pikar/core/captions`' `toAss` before it gets here, so it cannot carry style-override markup.
 */
async function burnCaptions(
  body: Extract<RenderRequestBody, { mode: "caption" }>,
  deps: RenderDeps,
  snapshotId: string,
  fetchBlob: (id: string) => Promise<Bytes | null>,
): Promise<Response> {
  const source = await fetchBlob(body.sourceId);
  if (!source) return jsonStop("input_fetch_failed");

  const startedAt = Date.now();
  const sandbox = await deps.createSandbox(
    buildSandboxOptions({ snapshotId, timeoutMs: RENDER_SANDBOX_TIMEOUT_MS }),
  );
  try {
    await sandbox.mkDir("in");
    await sandbox.writeFiles([
      { path: `in/${CAPTION_IN_NAME}`, content: source },
      { path: `in/${CAPTION_SUBS_NAME}`, content: new TextEncoder().encode(body.ass) },
      { path: "burn_caps.sh", content: new TextEncoder().encode(deps.burnScript) },
    ]);

    const run = await sandbox.runCommand("sh", ["burn_caps.sh"]);
    if (run.exitCode !== 0) {
      // stderr here can contain NARRATION (the `subtitles=` filter echoes the track it choked on),
      // which makes `reasonCodeFor` load-bearing rather than tidy. The string is read once, in
      // that function, and only a member of a closed union comes back out.
      return jsonStop(reasonCodeFor(run.exitCode, await run.stderr()));
    }

    const mp4 = await sandbox.readFileToBuffer({ path: CAPTION_OUT_NAME });
    // The SAME bar as the assemble pass. A burn that returns something implausible publishes
    // nothing, and the uncaptioned reel stays exactly where it is.
    const bad = validateMp4Bytes(mp4);
    if (bad || !mp4) return jsonStop(bad ? bad.code : "missing_output");

    const mp4StorageId = await uploadTo(deps.fetch, body.uploadUrls.mp4, mp4, "video/mp4");
    if (!mp4StorageId) return jsonStop("upload_failed");
    // No sidecar: the caption pass does not re-govern the render, it re-encodes a reel that was
    // already proven. The ORIGINAL sidecar stays the record, untouched.
    return Response.json({ ok: true, mp4StorageId, renderMs: Date.now() - startedAt });
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

/**
 * The render runner. Bearer in, validated artifacts out, and a sandbox that is a trust boundary in
 * both directions.
 *
 * WHAT NEVER CROSSES INTO THE VM, by construction rather than by review: no `FAL_KEY`, no
 * `OPENAI_API_KEY`, no Vercel credential, no `tenantId`, no fal URL, no signed storage read-URL,
 * no prompt and no narration. The runner passes `env` to neither `create` nor `runCommand`, and the
 * only bytes written in are the media itself and the assemble script. **The route — not the
 * sandbox — does every fetch**, which is what lets the VM stay on `deny-all`.
 */
export async function handleRenderRequest(req: Request, deps: RenderDeps): Promise<Response> {
  // 1. THE BEARER, FIRST, FAIL CLOSED. `http.ts:84-97`'s `/skillopt/export` shape run in the
  //    opposite direction — Convex is the CALLER here and this route is the guarded side. The
  //    difference that justifies the constant-time compare: unlike `/skillopt/export`, this
  //    endpoint is reachable from the public internet on every deployment.
  if (!deps.secret || !bearerMatches(req.headers.get("Authorization") ?? "", deps.secret)) {
    // Nothing has been parsed and no sandbox exists at this point, which is the assertion the
    // test makes: the create spy's call count is 0.
    return new Response("unauthorized", { status: 401 });
  }
  if (!deps.snapshotId || !deps.deploymentUrl) return jsonStop("not_configured");

  let blobOrigin: string;
  let uploadOrigin: string;
  try {
    blobOrigin = convexSiteOrigin(deps.deploymentUrl);
    uploadOrigin = new URL(deps.deploymentUrl).origin;
  } catch {
    return jsonStop("not_configured");
  }

  const body = parseBody(await req.json().catch(() => null), uploadOrigin);
  if (!body) return jsonStop("bad_request");

  // 2. FETCH THE BYTES HERE, from our own origin, with the same bearer. The URL is BUILT, never
  //    accepted — see `convexSiteOrigin`.
  const fetchBlob = async (id: string): Promise<Bytes | null> => {
    const res = await deps
      .fetch(`${blobOrigin}/media/blob/${id}`, {
        headers: { Authorization: `Bearer ${deps.secret}` },
      })
      .catch(() => null);
    return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  };

  if (body.mode === "caption") return await burnCaptions(body, deps, deps.snapshotId, fetchBlob);

  const files: Array<{ path: string; content: Bytes }> = [];
  for (const input of body.inputs) {
    const content = await fetchBlob(input.jobId);
    if (!content) return jsonStop("input_fetch_failed");
    files.push({ path: `in/${input.name}`, content });
  }
  // A card's words never round-trip through storage — there is no asset to fetch, the text IS the
  // input. `parseBody` has already bounded both the name and the bytes; this is the write.
  for (const card of body.cards) {
    files.push({ path: `in/${card.name}`, content: new TextEncoder().encode(card.text) });
  }

  const startedAt = Date.now();
  const sandbox = await deps.createSandbox(
    buildSandboxOptions({ snapshotId: deps.snapshotId, timeoutMs: RENDER_SANDBOX_TIMEOUT_MS }),
  );
  try {
    await sandbox.mkDir("in");
    // ONE `writeFiles` call for everything. Each call is a control-plane round trip, and a 13-file
    // reel is 13 of them if this is done in a loop.
    await sandbox.writeFiles([
      ...files,
      { path: "assemble_final.sh", content: new TextEncoder().encode(deps.assembleScript) },
    ]);

    // `--scene KIND:SECONDS` per scene, IN ORDER, plus the declared total. Order is the reel's
    // order and the index — the script derives every filename from the same loop counter, which is
    // what makes "block03 + voice05" impossible rather than merely detectable.
    const run = await sandbox.runCommand("sh", [
      "assemble_final.sh",
      ...body.scenes.flatMap((s) => ["--scene", `${s.kind}:${s.seconds}`]),
      "--target-seconds",
      String(body.targetSeconds),
      // The bed, by MOOD. No file was written for it above and none needs to be: the library is
      // baked into the snapshot, so this is a name the script looks up, not bytes we ship.
      ...(body.music === undefined ? [] : ["--music", body.music]),
      // 33.1-06: the fetched bed sits in `in/` with the other inputs; the script takes it over
      // its library lookup. Relative, like every other path the script is handed.
      ...(body.musicFile === undefined ? [] : ["--music-file", `in/${body.musicFile}`]),
      ...(body.card === undefined ? [] : ["--card-bg", body.card.bg, "--card-ink", body.card.ink]),
    ]);
    if (run.exitCode !== 0) {
      // THE ONLY READ OF stderr IN THIS SYSTEM, and it goes straight into a code. See
      // `reasonCodeFor` — the string is never returned, logged or stored.
      return jsonStop(reasonCodeFor(run.exitCode, await run.stderr()));
    }

    const mp4 = await sandbox.readFileToBuffer({ path: "out/final.mp4" });
    const sidecarBytes = await sandbox.readFileToBuffer({
      path: "out/final.mp4.assembly.json",
    });
    const checked = validateRenderReturn({
      mp4,
      sidecar: sidecarBytes ? new TextDecoder().decode(sidecarBytes) : null,
    });
    // The second half of the condition is unreachable given the first — `validateRenderReturn`
    // rejects a null mp4 and a null sidecar — but it is what narrows both to non-null for the
    // uploads below, without an `as` cast asserting something the type system cannot see.
    if (!checked.ok || !mp4 || !sidecarBytes) {
      return jsonStop(checked.ok ? "missing_output" : checked.code);
    }

    // 3. Up through the two single-use, write-only, short-lived URLs Convex minted. **The MIME
    //    type is OURS** — asserted here as a literal, never read from the VM's response.
    const mp4StorageId = await uploadTo(deps.fetch, body.uploadUrls.mp4, mp4, "video/mp4");
    const sidecarStorageId = await uploadTo(
      deps.fetch,
      body.uploadUrls.sidecar,
      sidecarBytes,
      "application/json",
    );
    if (!mp4StorageId || !sidecarStorageId) return jsonStop("upload_failed");

    // Small JSON only. The bytes never travel in this response — 10 MB would meet the platform's
    // response-body limit, and the upload URLs are the shipped ingest idiom anyway.
    return Response.json({
      ok: true,
      mp4StorageId,
      sidecarStorageId,
      renderMs: Date.now() - startedAt,
      gates: checked.report.gates,
      sceneCount: checked.report.sceneCount,
    });
  } finally {
    // ALWAYS. Vercel's own cost guidance: "Stop sandboxes promptly rather than waiting for
    // timeout." On Hobby an orphaned VM eats a shared monthly allotment whose exhaustion is a
    // 30-day OUTAGE, not a bill.
    await sandbox.stop().catch(() => {});
  }
}
