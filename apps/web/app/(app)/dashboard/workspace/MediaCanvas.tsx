"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { briefingSheet, capsTeal, snippetSheet, traceText, typeBadge } from "./cards";

/**
 * THE MEDIA CANVAS (MEDIA-01, D7, plan 20-10) — a media plan, seen.
 *
 * Not a new route, not a NAV entry, not a parallel rendering system: it mounts through the same
 * one-line `plan.kind` switch in `cards.tsx` that the memo and calendar cards mount through, and it
 * renders in the workspace right pane. The workspace's "Open canvas" tab (page.tsx) gives it the
 * whole pane on demand; it is the same component either way.
 *
 * **A dumb renderer that SELF-QUERIES** (the `SourceCard` idiom): it reads `byPlan`, `assetUrls`,
 * `reel` and `jobEstimate` itself rather than having them threaded through props. Four
 * subscriptions, and Convex dedupes them against anything else already reading the same rows.
 *
 * **NO POLLING. ANYWHERE.** A 10 s clip is 1-3 MINUTES of wall clock and the render adds 1-3 more,
 * so this surface must show meaningful state through several minutes of nothing arriving — but the
 * mechanism is Convex reactivity, which delivers the webhook's mutation and the render terminal's
 * patch to an open canvas with no ticker at all. `ActivityCard` records the same rule: *"measured
 * server-side … never a setInterval."* If you find yourself writing one, the bug is elsewhere.
 *
 * D7's ceiling, stated so it is not drifted past: no timeline, no transitions, no filters, no
 * layers, no masking, no music controls, no client-side rendering. Five editor affordances, and
 * nothing beyond them.
 */

type MediaPlan = {
  _id: string;
  mediaMode?: "reel" | "image" | null;
  imagePrompt?: string | null;
  artDirection?: ArtDirection | null;
  clipSeconds?: number | null;
};
type ArtDirection = {
  palette: string[];
  mood: string;
  lighting: string;
  composition: string;
  environment: string;
  texture: string;
  typography?: string;
  references: string[];
  avoid: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** `0:00–0:10`. The window a block OWNS, derived from the uniform clip length — D8 makes every
 *  window the same size, so this is arithmetic and never a stored string that could disagree. */
function windowLabel(index: number, clipSeconds: number): string {
  const at = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${at(index * clipSeconds)}–${at((index + 1) * clipSeconds)}`;
}

/**
 * THE VERDICT COPY, and this is a compliance statement rather than a style choice.
 *
 * `none_reported` means the provider reported NOTHING — **it is not "clean"**. Every Wan 2.5 video
 * and every voice take lands there, and rendering it as a pass would make a safety claim fal never
 * made. Never a green tick, and never colour alone (BRAND §6).
 */
const VERDICT_COPY: Record<string, string> = {
  checker_clear: "Provider safety check: passed",
  checker_flagged: "Provider safety check: flagged",
  provider_blocked: "Refused by the provider's content check",
  none_reported: "Not checked — this model reports no safety verdict",
};

/** Status copy per pipeline. A block is TWO jobs from two providers landing minutes apart, so the
 *  words differ: "Generating…" is wrong for audio and "Recording…" is wrong for video. */
const CLIP_COPY: Record<string, string> = {
  queued: "Clip: waiting to start",
  submitted: "Clip: generating… (usually 1–3 minutes)",
  succeeded: "Clip: ready",
  failed: "Clip: failed",
  blocked: "Clip: refused by the provider's content check",
};
const VOICE_COPY: Record<string, string> = {
  queued: "Voice: waiting to start",
  submitted: "Voice: recording the narration…",
  succeeded: "Voice: ready",
  failed: "Voice: failed",
  blocked: "Voice: refused by the provider's content check",
};

/** The refusal copy NAMES THE LEVER. A refusal the user cannot act on is a dead end, and the one
 *  whose cure is an edit gets that edit rendered right beside it (see `BlockTile`). */
function refusalText(
  refusal: { reason: string; blockIndex?: number; chars?: number },
  capCents: number,
  totalCents: number,
  maxChars: number,
): string {
  const block = refusal.blockIndex === undefined ? "A block" : `Block ${refusal.blockIndex + 1}`;
  switch (refusal.reason) {
    case "over_job_cap":
      return `This reel would cost ${money(totalCents)}, over the ${money(capCents)} per-reel limit — remove blocks or drop to 480p.`;
    case "illegal_duration":
      return "Every block must be 5 or 10 seconds.";
    case "narration_too_long":
      return `${block}'s narration is ${refusal.chars} characters — trim it to ${maxChars} or fewer, or the render will fail.`;
    case "narration_too_short":
      return `${block}'s narration is only ${refusal.chars} characters — too short to fill its window.`;
    case "unknown_model":
      return "This block names a model we can't price, so it won't run.";
    case "unrenderable_block":
      return `${block} has no clip to render — only VIDEO and IMAGE blocks can be generated today.`;
    case "kill_switch":
      return "Media generation is paused by the operator.";
    case "over_daily_budget":
      return "Today's media budget is spent. This resets tomorrow.";
    default:
      return "This reel can't be generated yet.";
  }
}

export function MediaCanvas({ plan, threadId }: { plan: MediaPlan; threadId?: string }) {
  return plan.mediaMode === "image" ? (
    <ImageCanvas plan={plan} />
  ) : (
    <ReelCanvas plan={plan} threadId={threadId} />
  );
}

function ReelCanvas({ plan, threadId }: { plan: MediaPlan; threadId?: string }) {
  const planId = plan._id as never;
  const blocks = useQuery(api.media.byPlan, { planId });
  const assets = useQuery(api.media.assetUrls, { planId });
  const reel = useQuery(api.media.reel, { planId });
  const estimate = useQuery(api.media.jobEstimate, { planId });

  const generateReel = useMutation(api.media.generateReel);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The `approve()` / `busy` / `note` shape from `PlanCard`, verbatim: the busy flag makes a second
  // click a client-side no-op, and the server's own transition makes a double-generate spend once.
  async function generate() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await generateReel({ planId });
      if (!res?.ok) setNote(res?.reason ? `Not started: ${res.reason}.` : "Not started.");
    } finally {
      setBusy(false);
    }
  }

  const clipSeconds = plan.clipSeconds ?? 10;
  const art = plan.artDirection ?? null;
  const landed = (assets ?? []).filter((a) => a.url !== null).length;

  return (
    <div style={{ ...briefingSheet, padding: "1.15rem 1.25rem" }} data-testid="media-canvas">
      {art && <ArtDirectionHeader art={art} />}

      <ReelRegion reel={reel} landedAssets={landed} clipSeconds={clipSeconds} />

      <p style={{ ...capsTeal, margin: "1.4rem 0 0.7rem" }}>Storyboard</p>
      {blocks === undefined && <p style={dimText}>Loading the deck…</p>}
      {blocks?.length === 0 && <p style={dimText}>This plan has no blocks yet.</p>}
      <div style={{ display: "grid", gap: "0.9rem" }}>
        {(blocks ?? []).map((b, position) => (
          <BlockTile
            key={b.blockIndex}
            block={b}
            position={position}
            total={(blocks ?? []).length}
            planId={planId}
            clipSeconds={clipSeconds}
            asset={(assets ?? []).find((a) => a.blockIndex === b.blockIndex && a.kind === "video")}
            voiceAsset={(assets ?? []).find(
              (a) => a.blockIndex === b.blockIndex && a.kind === "tts",
            )}
            order={(blocks ?? []).map((x) => x.blockIndex)}
          />
        ))}
      </div>

      <EstimateGate
        estimate={estimate}
        busy={busy}
        note={note}
        onGenerate={() => void generate()}
        clipSeconds={clipSeconds}
        threadId={threadId}
      />
    </div>
  );
}

const IMAGE_STATUS: Record<string, string> = {
  queued: "Waiting to start",
  submitted: "Generating…",
  succeeded: "Ready",
  failed: "Generation failed",
  blocked: "Refused by the provider's content check",
};

/** A standalone image proposal and its reactive output. The signed URL comes only from the
 * tenant-guarded asset query; the provider URL never reaches this component. */
function ImageCanvas({ plan }: { plan: MediaPlan }) {
  const planId = plan._id as never;
  const assets = useQuery(api.media.assetUrls, { planId });
  const estimate = useQuery(api.media.imageEstimate, { planId });
  const generateImage = useMutation(api.media.generateImage);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const asset = (assets ?? []).find((row) => row.kind === "image");
  const prompt = plan.imagePrompt?.trim() ?? "";
  const estimateReady = estimate !== undefined;
  const canGenerate =
    estimateReady && estimate.refusal === null && asset === undefined && !busy && prompt.length > 0;

  async function generate() {
    if (!canGenerate) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await generateImage({ planId });
      if (!result.ok) {
        setNote(
          result.reason === "already_started"
            ? "Generation has already started."
            : `Not started: ${result.reason.replaceAll("_", " ")}.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...briefingSheet, padding: "1rem 1.15rem" }} data-testid="image-canvas">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <p style={capsTeal}>Generated image</p>
        <span style={typeBadge}>IMAGE</span>
      </div>
      <p style={{ ...dimText, marginTop: "0.45rem" }} aria-live="polite">
        {asset
          ? (IMAGE_STATUS[asset.status] ?? asset.status)
          : "Proposal ready — not generated yet"}
        {asset?.url ? " · Synced to workspace history" : ""}
      </p>

      <div
        style={{
          marginTop: "0.8rem",
          minHeight: "14rem",
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--rule)",
          borderRadius: "0.7rem",
          background: "var(--canvas)",
          overflow: "hidden",
        }}
      >
        {asset?.url ? (
          /* biome-ignore lint/performance/noImgElement: Next Image's optimizer cannot safely
             retain or re-fetch this short-lived signed Convex bearer capability. */
          <img
            src={asset.url}
            alt={`Generated result for: ${prompt}`}
            style={{ display: "block", maxWidth: "100%", maxHeight: "34rem", objectFit: "contain" }}
          />
        ) : (
          <p style={{ ...dimText, padding: "1rem", textAlign: "center" }}>
            {asset?.status === "submitted"
              ? "fal is generating the image. It will appear here when the webhook lands."
              : asset?.status === "failed" || asset?.status === "blocked"
                ? IMAGE_STATUS[asset.status]
                : "The generated image will appear here."}
          </p>
        )}
      </div>

      <div style={snippetSheet}>{prompt}</div>
      {asset?.verdict && (
        <p style={{ ...dimText, marginTop: "0.55rem" }}>
          {VERDICT_COPY[asset.verdict] ?? "Not checked — no moderation verdict was reported"}
        </p>
      )}

      <div
        style={{ borderTop: "1px solid var(--rule)", marginTop: "0.9rem", paddingTop: "0.8rem" }}
      >
        <p style={capsTeal}>Cost</p>
        {!estimateReady ? (
          <p style={{ ...dimText, marginTop: "0.45rem" }}>Working out what this image costs…</p>
        ) : (
          <>
            <p style={{ ...dimText, marginTop: "0.45rem" }}>
              1 image · {estimate.width}×{estimate.height} · Flux Schnell
            </p>
            <p style={{ ...dimText, marginTop: "0.25rem" }}>
              Total {money(estimate.totalCents)} · {money(estimate.remainingCents)} of today's media
              budget remains.
            </p>
          </>
        )}
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => void generate()}
          data-testid="image-generate"
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem 1rem",
            borderRadius: "0.375rem",
            cursor: canGenerate ? "pointer" : "not-allowed",
            background: canGenerate ? "var(--teal-600)" : "var(--canvas)",
            color: canGenerate ? "#fff" : "var(--ink-soft)",
            border: canGenerate ? "none" : "1px solid var(--rule)",
            fontWeight: 600,
          }}
        >
          {busy ? "Starting…" : asset ? "Generation started" : "Generate image"}
        </button>
        {note && <p style={{ ...dimText, marginTop: "0.5rem" }}>{note}</p>}
      </div>
    </div>
  );
}

const dimText = { color: "var(--ink-soft)", fontSize: "0.85rem", margin: 0 } as const;
const sectionRule = {
  border: 0,
  borderTop: "1px solid var(--rule)",
  margin: "1.2rem 0 0",
} as const;

/** The art direction the model authored. **The palette hexes are CONTENT, not chrome** — they are
 *  the thing being shown, so they are legitimately inline styles; CLAUDE.md §10's "never hardcode a
 *  hex a token covers" is about product chrome and does not reach a swatch of the user's palette. */
function ArtDirectionHeader({ art }: { art: ArtDirection }) {
  return (
    <div>
      <p style={capsTeal}>Art direction</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.6rem 0 0.8rem" }}>
        {art.palette.map((hex) => (
          <span
            key={hex}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.75rem",
              color: "var(--ink-soft)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                borderRadius: "0.25rem",
                border: "1px solid var(--rule)",
                background: hex,
              }}
            />
            {/* The hex in TEXT beside the swatch: a colour named only by a colour is unreadable to
                anyone who cannot see it (BRAND §6, never meaning in colour alone). */}
            {hex}
          </span>
        ))}
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: "0.25rem 0.75rem",
          margin: 0,
        }}
      >
        {(
          [
            ["Mood", art.mood],
            ["Lighting", art.lighting],
            ["Composition", art.composition],
            ["Environment", art.environment],
            ["Texture", art.texture],
            ["Avoid", art.avoid],
          ] as const
        )
          .filter(([, value]) => Boolean(value))
          .map(([term, value]) => (
            <div key={term} style={{ display: "contents" }}>
              <dt style={{ ...dimText, fontWeight: 700 }}>{term}</dt>
              <dd style={{ ...dimText, ...traceText, margin: 0 }}>{value}</dd>
            </div>
          ))}
      </dl>
      <hr style={sectionRule} />
    </div>
  );
}

/**
 * THE REEL — the top-level artifact, as a BRAND Output card.
 *
 * FIVE states, and every one of them says what happened IN WORDS. A failed render in particular
 * gets a sentence, never a bare code and never a red dot: the person reading it has to know whether
 * to retry, rewrite a line, or call someone.
 */
function ReelRegion({
  reel,
  landedAssets,
  clipSeconds,
}: {
  reel:
    | {
        status: string | null;
        url: string | null;
        durationS: number | null;
        blockCount: number | null;
        gates: string[];
        reason: string | null;
      }
    | undefined;
  landedAssets: number;
  clipSeconds: number;
}) {
  const status = reel?.status ?? null;
  // THE OUT-OF-DATE STATE. `regenerateBlock` and every structural edit clear the render fields
  // (20-09), so a deck whose assets have landed but whose reel is back at `pending` is not
  // "waiting to start" — it is stale, and saying "not assembled yet" would be a lie the user can
  // watch. The two are indistinguishable from `renderStatus` alone; the landed count is what
  // separates them.
  const outOfDate = status === "pending" && landedAssets > 0;

  return (
    <div style={{ marginTop: "1.1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <p style={capsTeal}>Reel</p>
        <span style={typeBadge}>VIDEO</span>
      </div>

      <div aria-live="polite" style={{ marginTop: "0.6rem" }}>
        {status === null && <p style={dimText}>No reel has been requested for this plan yet.</p>}

        {status === "pending" && !outOfDate && (
          <p style={dimText}>
            Not assembled yet. The reel is built after every block's clip and voice have landed.
          </p>
        )}

        {outOfDate && (
          <p style={dimText}>
            The reel is out of date — the blocks have changed since it was assembled. Generate again
            to rebuild it.
          </p>
        )}

        {status === "rendering" && (
          <p style={dimText}>Assembling the reel… (usually 1–3 minutes)</p>
        )}

        {status === "rendered" && reel?.url && (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: the burned-in captions ARE the caption track
                (plan 20-17) — they are pixels in the video, so there is no WebVTT file to attach and
                a <track> element would point at nothing. */}
            <video
              controls
              src={reel.url}
              style={{ width: "100%", maxWidth: "22rem", borderRadius: "0.6rem", display: "block" }}
            />
            <p style={{ ...dimText, marginTop: "0.5rem" }}>
              {reel.blockCount} blocks · {Math.round(reel.durationS ?? 0)} seconds
              {reel.gates.includes("speech_within_window")
                ? " · every block's narration fits its window."
                : "."}
            </p>
          </>
        )}

        {/* A `rendered` status with no url means the sidecar did NOT validate — `media.reel`
            returns a url only when it did. D8: "a final video without an assembly.json was
            hand-assembled", so this is a governed refusal to publish, not a missing file. */}
        {status === "rendered" && !reel?.url && (
          <p style={dimText}>
            The render finished but did not produce a valid assembly record, so it was not
            published.
          </p>
        )}

        {status === "failed" && (
          <p style={dimText}>
            The reel could not be assembled
            {reel?.reason ? `: ${failureText(reel.reason, clipSeconds)}` : "."}
          </p>
        )}
      </div>
      <hr style={sectionRule} />
    </div>
  );
}

/** A render reasonCode, in words. The backend keeps a CLOSED union and never stores ffmpeg's prose
 *  (§4), so this map is where the sentence lives — an unrecognised code falls through to the code
 *  itself rather than being swallowed. */
function failureText(reason: string, clipSeconds: number): string {
  const map: Record<string, string> = {
    incomplete_batch:
      "one of the blocks never produced its clip or its voice, so there was nothing to assemble",
    not_all_succeeded: "not every block had landed when the render started",
    incomplete_blocks: "a block is missing either its clip or its voice take",
    speech_out_of_window: `a narration line runs longer than its ${clipSeconds}-second window — shorten it and regenerate`,
    clip_too_short: "a generated clip was shorter than its window",
    missing_narration: "a window came out silent",
    duration_mismatch: "the finished file was not the expected length",
    sandbox_timeout: "the render ran out of time",
    missing_binary: "the render environment is missing a required tool",
    route_unreachable: "the render service could not be reached",
    sidecar_rejected_on_return:
      "the render produced no valid assembly record, so nothing was published",
  };
  return map[reason] ?? reason;
}

type Block = {
  blockIndex: number;
  type: string;
  description: string;
  overlay: string | null;
  prompt: string;
  narration: string;
  narrationChars: number;
  maxChars: number;
  overCharLimit: boolean;
  clip: { status: string; verdict: string | null; model: string } | null;
  voice: { status: string; verdict: string | null; model: string } | null;
};

/**
 * ONE BLOCK, as the BRAND Output card (`BRAND.md:101-102`): a titled card with an UPPERCASE type
 * badge pill and the rendered artifact once it lands.
 *
 * **18-07 collision, resolved:** 18-07's `OutputCard` shipped first but is a THREAD-scoped
 * self-querying component for created vault docs, not a reusable card primitive — there was nothing
 * to import. This tile reuses its VISUAL vocabulary exactly (`briefingSheet`, `typeBadge`,
 * `capsTeal`, `snippetSheet`) so the two read as one system, and in particular reuses its badge
 * decision: **the teal goes in the FILL and the label stays `--ink`**, because `--teal-600` as
 * small text is ~2.9:1 and BRAND §6 bans it. Do not "restore" teal text here.
 *
 * TWO status rows, never one. The block is a pipeline of two jobs from two providers whose webhooks
 * land minutes apart, and a block whose voice is ready but whose clip is not MUST look different
 * from the reverse.
 */
function BlockTile({
  block,
  position,
  total,
  planId,
  clipSeconds,
  asset,
  voiceAsset,
  order,
}: {
  block: Block;
  position: number;
  total: number;
  planId: never;
  clipSeconds: number;
  asset?: { url: string | null; mimeType: string | null };
  voiceAsset?: { url: string | null };
  order: number[];
}) {
  const editPrompt = useMutation(api.media.editBlockPrompt);
  const editNarration = useMutation(api.media.editBlockNarration);
  const regenerate = useMutation(api.media.regenerateBlock);
  const reorder = useMutation(api.media.reorderBlocks);
  const remove = useMutation(api.media.deleteBlock);

  const [editing, setEditing] = useState<"prompt" | "narration" | null>(null);
  const [prompt, setPrompt] = useState(block.prompt);
  const [narration, setNarration] = useState(block.narration);
  const [busy, setBusy] = useState(false);

  const chars = narration.length;
  const over = chars > block.maxChars;

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  /** Swap this block with its neighbour. `order` is the CURRENT blockIndex sequence — the mutation
   *  takes the whole new order, so the swap is computed here and sent once. */
  function moved(delta: number): number[] {
    const next = [...order];
    const target = position + delta;
    const a = next[position];
    const b = next[target];
    if (a === undefined || b === undefined) return next;
    next[position] = b;
    next[target] = a;
    return next;
  }

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: "0.7rem",
        padding: "0.85rem 0.95rem",
        background: "var(--card)",
      }}
      data-testid="media-block-tile"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
        <span style={typeBadge}>{block.type.toUpperCase()}</span>
        <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
          Block {block.blockIndex + 1}
        </strong>
        <span style={dimText}>{windowLabel(position, clipSeconds)}</span>
      </div>

      <p style={{ ...dimText, ...traceText, margin: "0.5rem 0 0", color: "var(--ink)" }}>
        {block.description}
      </p>
      {block.overlay && (
        <p style={{ ...dimText, ...traceText, margin: "0.3rem 0 0" }}>Overlay: {block.overlay}</p>
      )}

      {/* The landed artifact. A voice take with no clip still renders — that is the whole point of
          two independent pipelines being visible. */}
      {asset?.url && (
        // biome-ignore lint/a11y/useMediaCaption: a generated block clip has no caption track — captions are burned into the finished reel downstream (20-17), never attached as WebVTT.
        <video
          controls
          src={asset.url}
          style={{
            width: "100%",
            maxWidth: "16rem",
            borderRadius: "0.5rem",
            display: "block",
            margin: "0.6rem 0 0",
          }}
        />
      )}
      {voiceAsset?.url && (
        // biome-ignore lint/a11y/useMediaCaption: the narration text is rendered directly below.
        <audio controls src={voiceAsset.url} style={{ width: "100%", margin: "0.5rem 0 0" }} />
      )}

      {/* Progress a screen reader can HEAR. A silent progress surface reproduces the "is it stuck?"
          complaint for non-sighted users through several minutes of nothing arriving (BRAND §6). */}
      <div aria-live="polite" style={{ display: "grid", gap: "0.35rem", marginTop: "0.6rem" }}>
        <div className="trace-line">
          <span style={traceText}>
            {block.clip
              ? (CLIP_COPY[block.clip.status] ?? `Clip: ${block.clip.status}`)
              : "Clip: not requested yet"}
          </span>
        </div>
        {block.clip?.verdict && (
          <div className="trace-line">
            <span style={traceText}>{VERDICT_COPY[block.clip.verdict] ?? block.clip.verdict}</span>
          </div>
        )}
        <div className="trace-line">
          <span style={traceText}>
            {block.voice
              ? (VOICE_COPY[block.voice.status] ?? `Voice: ${block.voice.status}`)
              : "Voice: not requested yet"}
          </span>
        </div>
        {block.voice?.verdict && (
          <div className="trace-line">
            <span style={traceText}>
              {VERDICT_COPY[block.voice.verdict] ?? block.voice.verdict}
            </span>
          </div>
        )}
      </div>

      {/* THE NARRATION, and its live character count. This control is the UI half of the
          pre-payment guard: `jobEstimate` refuses a deck whose narration is too long, and the cure
          has to be reachable from where the refusal is read. */}
      {editing === "narration" ? (
        <div style={{ marginTop: "0.7rem" }}>
          <textarea
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              fontSize: "0.85rem",
              padding: "0.5rem",
              borderRadius: "0.4rem",
              border: "1px solid var(--rule)",
              background: "var(--paper)",
              color: "var(--ink)",
            }}
          />
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}
          >
            {/* The COUNT is the signal, never colour alone — the amber is `--held-text` because
                `--held` is a fill token and fails contrast as text (BRAND §6). */}
            <span
              style={{
                fontSize: "0.78rem",
                color: over ? "var(--held-text)" : "var(--ink-soft)",
                fontWeight: over ? 700 : 400,
              }}
            >
              {chars} / {block.maxChars}
              {over ? " — too long to fit this window" : ""}
            </span>
            <button
              type="button"
              disabled={busy}
              style={ghostBtn}
              onClick={() =>
                void run(() => editNarration({ planId, blockIndex: block.blockIndex, narration }))
              }
            >
              Save
            </button>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => {
                setNarration(block.narration);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p style={{ ...dimText, ...traceText, margin: "0.6rem 0 0" }}>
          <span style={{ fontWeight: 700 }}>Narration: </span>
          {block.narration}
          <span
            style={{
              color: block.overCharLimit ? "var(--held-text)" : "var(--ink-soft)",
              fontWeight: block.overCharLimit ? 700 : 400,
            }}
          >
            {" "}
            ({block.narrationChars} / {block.maxChars}
            {block.overCharLimit ? " — too long" : ""})
          </span>
        </p>
      )}

      {editing === "prompt" && (
        <div style={{ marginTop: "0.7rem" }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              fontSize: "0.85rem",
              padding: "0.5rem",
              borderRadius: "0.4rem",
              border: "1px solid var(--rule)",
              background: "var(--paper)",
              color: "var(--ink)",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
            <button
              type="button"
              disabled={busy}
              style={ghostBtn}
              onClick={() =>
                void run(() => editPrompt({ planId, blockIndex: block.blockIndex, prompt }))
              }
            >
              Save
            </button>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => {
                setPrompt(block.prompt);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing === null && <div style={snippetSheet}>{block.prompt}</div>}

      {/* THE FIVE AFFORDANCES, labelled by what they cost. Four are free; regenerate SPENDS, and
          says so plus what else it invalidates. A control that can spend without showing that first
          is the one thing D7 forbids by name. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginTop: "0.7rem",
          alignItems: "center",
        }}
      >
        <span style={{ ...dimText, fontSize: "0.72rem" }}>Free:</span>
        <button type="button" style={ghostBtn} onClick={() => setEditing("prompt")}>
          Edit prompt
        </button>
        <button type="button" style={ghostBtn} onClick={() => setEditing("narration")}>
          Edit narration
        </button>
        <button
          type="button"
          disabled={busy || position === 0}
          style={ghostBtn}
          onClick={() => void run(() => reorder({ planId, order: moved(-1) }))}
        >
          Move up
        </button>
        <button
          type="button"
          disabled={busy || position === total - 1}
          style={ghostBtn}
          onClick={() => void run(() => reorder({ planId, order: moved(1) }))}
        >
          Move down
        </button>
        <button
          type="button"
          disabled={busy}
          style={ghostBtn}
          onClick={() => void run(() => remove({ planId, blockIndex: block.blockIndex }))}
        >
          Delete block
        </button>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginTop: "0.4rem",
          alignItems: "center",
        }}
      >
        <span style={{ ...dimText, fontSize: "0.72rem", fontWeight: 700 }}>Costs money:</span>
        <button
          type="button"
          disabled={busy}
          style={ghostBtn}
          onClick={() => void run(() => regenerate({ planId, blockIndex: block.blockIndex }))}
        >
          Regenerate this block
        </button>
        <span style={{ ...dimText, fontSize: "0.72rem" }}>
          Buys one new clip and voice take, and rebuilds the reel.
        </span>
      </div>
    </div>
  );
}

const ghostBtn = {
  padding: "0.3rem 0.6rem",
  borderRadius: "0.35rem",
  cursor: "pointer",
  fontSize: "0.78rem",
  border: "1px solid var(--rule)",
  background: "var(--paper)",
  color: "var(--ink)",
} as const;

/**
 * THE ESTIMATE GATE — D7's binding rule, and it takes FOUR lines rather than one total.
 *
 * *"The editor must not offer a control that can spend money without showing the estimate first."*
 * One number is not enough: the user has to see WHICH line is expensive before deciding to cut a
 * block, which is why `jobEstimate` itemises and this panel prints every line.
 *
 * The button is `disabled` until the estimate resolves — not merely un-styled, because a disabled
 * look on an enabled button is a click that spends money the user was told they could not.
 */
function EstimateGate({
  estimate,
  busy,
  note,
  onGenerate,
  clipSeconds,
  threadId,
}: {
  estimate:
    | {
        lines: Array<{ label: string; qty: number; unit: string; cents: number }>;
        totalCents: number;
        capCents: number;
        remainingCents: number;
        refusal: { reason: string; blockIndex?: number; chars?: number } | null;
      }
    | undefined;
  busy: boolean;
  note: string | null;
  onGenerate: () => void;
  clipSeconds: number;
  threadId?: string;
}) {
  const resolved = estimate !== undefined;
  const refusal = estimate?.refusal ?? null;
  const canGenerate = resolved && refusal === null && (estimate?.lines.length ?? 0) > 0 && !busy;
  const maxChars = clipSeconds === 5 ? 70 : 140;

  return (
    <div
      style={{ marginTop: "1.2rem", borderTop: "1px solid var(--rule)", paddingTop: "0.9rem" }}
      data-testid="media-estimate"
    >
      <p style={capsTeal}>Cost</p>
      {!resolved && (
        <p style={{ ...dimText, marginTop: "0.5rem" }}>Working out what this reel costs…</p>
      )}

      {resolved && (estimate?.lines.length ?? 0) > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0.6rem 0 0",
            display: "grid",
            gap: "0.25rem",
          }}
        >
          {estimate?.lines.map((line) => (
            <li
              key={line.label}
              style={{ ...dimText, display: "flex", justifyContent: "space-between", gap: "1rem" }}
            >
              <span style={traceText}>
                {line.label} · {line.qty} {line.unit}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(line.cents)}</span>
            </li>
          ))}
          <li
            style={{
              ...dimText,
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              color: "var(--ink)",
              fontWeight: 700,
              borderTop: "1px solid var(--rule)",
              paddingTop: "0.25rem",
            }}
          >
            <span>Total</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {money(estimate?.totalCents ?? 0)}
            </span>
          </li>
        </ul>
      )}

      {resolved && (
        <p style={{ ...dimText, marginTop: "0.5rem" }}>
          Priced at Wan 2.5, 480p, {clipSeconds} s per block ·{" "}
          {money(estimate?.remainingCents ?? 0)} of today's media budget remains.
        </p>
      )}

      {/* The refusal names the LEVER, and for the narration case the cure is the Edit narration
          control on the offending tile directly above. */}
      {refusal && (
        <p style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}>
          {refusalText(refusal, estimate?.capCents ?? 0, estimate?.totalCents ?? 0, maxChars)}
        </p>
      )}

      <button
        type="button"
        disabled={!canGenerate}
        onClick={onGenerate}
        data-testid="media-generate"
        style={{
          marginTop: "0.8rem",
          padding: "0.5rem 1rem",
          borderRadius: "0.375rem",
          cursor: canGenerate ? "pointer" : "not-allowed",
          background: canGenerate ? "var(--teal-600)" : "var(--canvas)",
          color: canGenerate ? "#fff" : "var(--ink-soft)",
          border: canGenerate ? "none" : "1px solid var(--rule)",
          fontWeight: 600,
        }}
      >
        {busy ? "Starting…" : "Generate reel"}
      </button>
      {note && <p style={{ ...dimText, marginTop: "0.5rem" }}>{note}</p>}
      {threadId === undefined && null}
    </div>
  );
}

/**
 * THE CANVAS PANE — the workspace's "Open canvas" tab.
 *
 * The same `MediaCanvas` component the `plan.kind` branch mounts, given the WHOLE right pane
 * instead of a card slot. That is the entire difference, and it is deliberate: two renderings of a
 * reel that could drift apart is exactly the "parallel rendering system" 20-10's objective rules
 * out. The tab is a viewport, not a second implementation.
 *
 * It self-queries the thread's plan for the same reason everything else here does — the toggle in
 * `page.tsx` then stays a boolean and knows nothing about media.
 *
 * The empty states are HONEST (BRAND §1/§5): a thread with no media plan says so and says what
 * would produce one, rather than rendering an encouraging shell around nothing.
 */
export function CanvasPane({ threadId }: { threadId?: string }) {
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");

  if (!threadId) {
    return (
      <p style={{ ...dimText, marginTop: "1rem" }}>
        Start a conversation first — the canvas shows the image or reel the agent is building for
        this thread.
      </p>
    );
  }
  if (plan === undefined) return <p style={{ ...dimText, marginTop: "1rem" }}>Loading…</p>;
  if (plan?.kind !== "media") {
    return (
      <p style={{ ...dimText, marginTop: "1rem" }} data-testid="canvas-empty">
        No image or reel in this thread yet. Ask the agent for an image or video; nothing is
        generated until you review the proposal and approve the cost.
      </p>
    );
  }
  return <MediaCanvas plan={plan as unknown as MediaPlan} threadId={threadId} />;
}
