"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { briefingSheet, capsTeal, snippetSheet, traceText, typeBadge } from "./cards";
import {
  asVisualKind,
  durationLabel,
  failureText,
  isPickableVideo,
  KIND_COST_NOTE,
  KIND_LABEL,
  pictureLine,
  refusalText,
  ribbonShares,
  STALE_CLIP_NOTE,
  STALE_VOICE_NOTE,
  VERDICT_COPY,
  type VisualKind,
  voiceLine,
  windowLabel,
} from "./mediaCanvasView";

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
 * D7's ceiling, stated so it is not drifted past: no transitions, no filters, no layers, no
 * masking, no music controls, no client-side rendering. Six editor affordances now (20.2 wave 6
 * adds the vault picker, because an `uploaded_video` scene with no document named is unrenderable
 * and nothing else in the product can name it), and nothing beyond them.
 *
 * **On "no timeline" (20.2 wave 6).** D7 banned a timeline EDITOR — drag handles, trims, ripple.
 * The strip this canvas draws is a read-only picture of lengths the deck already declares, and it
 * exists because the scene contract made those lengths differ: under D8 every window was the same
 * size, so there was nothing to see. Nothing on the ribbon is draggable, and the five free edits
 * are still the only way to change the deck.
 */

type MediaPlan = {
  _id: string;
  mediaMode?: "reel" | "image" | null;
  imagePrompt?: string | null;
  artDirection?: ArtDirection | null;
  clipSeconds?: number | null;
  /** 20.2: the DECLARED reel length. Present on a scene deck and absent on a block one, which is
   *  what makes it the discriminator the estimate line reads. */
  targetDurationSeconds?: number | null;
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

/**
 * THE TIMELINE RIBBON (20.2 wave 6) — the reel's shape, at a glance.
 *
 * Every segment is as wide as its scene is long, which is the one thing a stack of equal cards
 * cannot show and the thing the scene contract made true: a deck is now 12 s of footage, 4 s of
 * card and 6 s of still, and "which of these is the long one" was previously unanswerable without
 * reading four headers.
 *
 * It is READ-ONLY (see the header note on D7). Nothing here is a control, so nothing here can
 * change the deck — the tiles below own every edit.
 *
 * Each segment carries its length and its kind AS TEXT. A segment distinguished only by a colour
 * would be meaning in colour alone (BRAND §6), and a 2-second card is too thin for a swatch to be
 * read anyway — which is also why `ribbonShares` gives every scene a minimum width.
 */
function TimelineRibbon({
  scenes,
}: {
  scenes: Array<{ blockIndex: number; visual: VisualKind | null; durationMs: number }>;
}) {
  const shares = ribbonShares(scenes.map((s) => s.durationMs));
  const totalMs = scenes.reduce((n, s) => n + s.durationMs, 0);

  return (
    <div style={{ marginTop: "1.1rem" }} data-testid="media-timeline">
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
        <p style={capsTeal}>Timeline</p>
        <span style={dimText}>
          {durationLabel(totalMs)} · {scenes.length} scenes
        </span>
      </div>
      <ol
        aria-label="The reel's scenes, in order, sized by their length"
        style={{
          display: "flex",
          gap: "0.15rem",
          listStyle: "none",
          margin: "0.55rem 0 0",
          padding: 0,
        }}
      >
        {scenes.map((scene, i) => (
          <li
            key={scene.blockIndex}
            title={`${scene.visual ? KIND_LABEL[scene.visual] : "BLOCK"} · ${durationLabel(scene.durationMs)}`}
            style={{
              flexGrow: shares[i] ?? 1,
              flexBasis: 0,
              minWidth: 0,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              padding: "0.4rem 0.35rem",
              borderRadius: "0.35rem",
              background: "var(--canvas)",
              // PAID vs FREE, and never by colour alone — the kind is written in the segment and
              // repeated on the tile below. A generated clip and a still are bought; a card and
              // the tenant's own footage are not, and a solid edge is how the expensive half of a
              // deck is visible before the estimate is read.
              border:
                scene.visual === "uploaded_video" || scene.visual === "text_card"
                  ? "1px dashed var(--rule)"
                  : "1px solid var(--teal-600)",
              fontSize: "0.7rem",
              color: "var(--ink-soft)",
            }}
          >
            <span style={{ display: "block", color: "var(--ink)", fontWeight: 700 }}>
              {durationLabel(scene.durationMs)}
            </span>
            {scene.visual ? KIND_LABEL[scene.visual] : `Block ${scene.blockIndex + 1}`}
          </li>
        ))}
      </ol>
      <hr style={sectionRule} />
    </div>
  );
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

  const clipSeconds = plan.clipSeconds ?? 4;
  const art = plan.artDirection ?? null;
  const landed = (assets ?? []).filter((a) => a.url !== null).length;
  // `visual` crosses the wire as a string (the closed set lives in `@pikar/core`, not in Convex's
  // validators), so it is narrowed ONCE here and every consumer below sees the union or `null`.
  const deck = (blocks ?? []).map((b) => ({ ...b, visual: asVisualKind(b.visual) }));

  // ONE deck's vocabulary, decided once. A row carries `visual` or it carries `type`, never both
  // (`media.sceneDeckOf`'s discriminator), so the whole surface can say "scene" or "block" without
  // eight sentences each guessing.
  const isScene = deck.some((b) => b.visual !== null);
  const noun = isScene ? ("scene" as const) : ("block" as const);

  // The vault list is fetched ONCE for the deck and only when a scene actually needs it — an
  // `uploaded_video` is the only kind whose picture comes from a document. `"skip"` keeps a deck
  // without one from subscribing to the vault at all.
  const needsPicker = deck.some((b) => b.visual === "uploaded_video");
  const vaultDocs = useQuery(api.vault.listVaultDocs, needsPicker ? {} : "skip");
  const videos = (vaultDocs ?? []).filter(isPickableVideo);

  return (
    // flexShrink 0: this sheet is a flex item of the fixed-height .pane-canvas section, and
    // briefingSheet's overflow:hidden flips the flex min-height auto->0 — without this the pane
    // crushes the sheet to the leftover viewport and clips the whole storyboard, unscrollably.
    <div
      style={{ ...briefingSheet, flexShrink: 0, padding: "1.15rem 1.25rem" }}
      data-testid="media-canvas"
    >
      {art && <ArtDirectionHeader art={art} />}

      <ReelRegion reel={reel} landedAssets={landed} noun={noun} />

      {isScene && deck.length > 0 && <TimelineRibbon scenes={deck} />}

      <p style={{ ...capsTeal, margin: "1.4rem 0 0.7rem" }}>Storyboard</p>
      {blocks === undefined && <p style={dimText}>Loading the deck…</p>}
      {deck.length === 0 && blocks !== undefined && (
        <p style={dimText}>This plan has no {noun}s yet.</p>
      )}
      <div style={{ display: "grid", gap: "0.9rem" }}>
        {deck.map((b, position) => (
          <SceneTile
            key={b.blockIndex}
            block={b}
            position={position}
            total={deck.length}
            planId={planId}
            noun={noun}
            clipSeconds={clipSeconds}
            asset={(assets ?? []).find(
              (a) => a.blockIndex === b.blockIndex && (a.kind === "video" || a.kind === "image"),
            )}
            voiceAsset={(assets ?? []).find(
              (a) => a.blockIndex === b.blockIndex && a.kind === "tts",
            )}
            order={deck.map((x) => x.blockIndex)}
            videos={videos}
          />
        ))}
      </div>

      <EstimateGate
        estimate={estimate}
        busy={busy}
        note={note}
        onGenerate={() => void generate()}
        noun={noun}
        clipSeconds={clipSeconds}
        targetSeconds={plan.targetDurationSeconds ?? null}
        sceneCount={deck.length}
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
  // `assetUrls` is oldest-first. A failed attempt remains immutable history, so the canvas must
  // render the latest attempt instead of getting pinned forever to the first failed row.
  const imageAttempts = (assets ?? []).filter((row) => row.kind === "image");
  const asset = imageAttempts.at(-1);
  const prompt = plan.imagePrompt?.trim() ?? "";
  const estimateReady = estimate !== undefined;
  const retryable = asset?.status === "failed" || asset?.status === "blocked";
  const canGenerate =
    estimateReady &&
    estimate.refusal === null &&
    (asset === undefined || retryable) &&
    !busy &&
    prompt.length > 0;

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
    // Same flexShrink 0 as the reel sheet above, same crush otherwise.
    <div
      style={{ ...briefingSheet, flexShrink: 0, padding: "1rem 1.15rem" }}
      data-testid="image-canvas"
    >
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
              ? "Wan is generating the image. It will appear here when the job completes."
              : asset?.status === "failed" || asset?.status === "blocked"
                ? `${IMAGE_STATUS[asset.status]}${asset.failureReason ? ` (${asset.failureReason.replaceAll("_", " ")})` : ""}. You can retry this reviewed prompt.`
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
              1 image · {estimate.width}×{estimate.height} · {estimate.model}
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
          {busy
            ? "Starting…"
            : retryable
              ? "Retry image"
              : asset
                ? "Generation started"
                : "Generate image"}
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
  noun,
}: {
  reel:
    | {
        status: string | null;
        url: string | null;
        durationS: number | null;
        sceneCount: number | null;
        gates: string[];
        reason: string | null;
      }
    | undefined;
  landedAssets: number;
  noun: "scene" | "block";
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
            Not assembled yet. The reel is built once every {noun}'s picture and voice have landed.
          </p>
        )}

        {outOfDate && (
          <p style={dimText}>
            The reel is out of date — the {noun}s have changed since it was assembled. Generate
            again to rebuild it.
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
              {reel.sceneCount} {noun}s · {Math.round(reel.durationS ?? 0)} seconds
              {reel.gates.includes("speech_within_window")
                ? " · every narration line fits before the next one."
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
            {reel?.reason ? `: ${failureText(reel.reason, noun)}` : "."}
          </p>
        )}
      </div>
      <hr style={sectionRule} />
    </div>
  );
}

/** One row of `media.byPlan` — a BLOCK row (`type`, `visual: null`) or a 20.2 SCENE row. The two
 *  are one shape here on purpose: a tile renders whichever it was handed, and `visual` is the
 *  discriminator (`media.byPlan`'s own comment says why that projection is safe HERE and nowhere
 *  on the money path). */
type Block = {
  blockIndex: number;
  type: string;
  visual: VisualKind | null;
  startMs: number;
  durationMs: number;
  asset: { source: "vault"; docId: string } | null;
  description: string;
  overlay: string | null;
  prompt: string;
  narration: string;
  narrationChars: number;
  maxChars: number;
  overCharLimit: boolean;
  clip: { status: string; verdict: string | null; model: string } | null;
  voice: { status: string; verdict: string | null; model: string } | null;
  /** Bought for text that has since been edited. See `mediaCanvasView`'s stale notes — the render
   *  reuses the old asset deliberately, so the tile is the only place this is visible. */
  clipStale: boolean;
  voiceStale: boolean;
};

/** A vault document the picker may offer. Projected by `vault.listVaultDocs`; narrowed to video by
 *  `isPickableVideo`, which is the same narrowing the render applies. */
type VaultVideo = { _id: string; title: string; mimeType?: string | null; status?: string };

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
function SceneTile({
  block,
  position,
  total,
  planId,
  noun,
  clipSeconds,
  asset,
  voiceAsset,
  order,
  videos,
}: {
  block: Block;
  position: number;
  total: number;
  planId: never;
  noun: "scene" | "block";
  clipSeconds: number;
  asset?: { url: string | null; mimeType: string | null };
  voiceAsset?: { url: string | null };
  order: number[];
  videos: VaultVideo[];
}) {
  const editPrompt = useMutation(api.media.editBlockPrompt);
  const editNarration = useMutation(api.media.editBlockNarration);
  const regenerate = useMutation(api.media.regenerateBlock);
  const reorder = useMutation(api.media.reorderBlocks);
  const remove = useMutation(api.media.deleteBlock);
  const setAsset = useMutation(api.media.setSceneAsset);

  const [editing, setEditing] = useState<"prompt" | "narration" | null>(null);
  const [prompt, setPrompt] = useState(block.prompt);
  const [narration, setNarration] = useState(block.narration);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const chars = narration.length;
  const over = chars > block.maxChars;
  const chosen = videos.find((v) => v._id === block.asset?.docId);

  // **A CONTROL THAT CANNOT SPEND MUST NOT LOOK LIKE ONE.** Three of the four scene kinds buy
  // nothing on their own: a card is drawn in the render, an upload is already the tenant's. Such a
  // scene has something to re-buy only if it has a line to re-record. Offering "Regenerate" anyway
  // would send a click to a mutation that answers `nothing_to_regenerate` — a refusal the tile
  // could have known without asking.
  const buysPicture =
    block.visual === null ||
    block.visual === "generated_video" ||
    block.visual === "animated_image";
  const buysSomething = buysPicture || block.narration.trim() !== "";

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
        <span style={typeBadge}>
          {block.visual ? KIND_LABEL[block.visual] : block.type.toUpperCase()}
        </span>
        <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
          {noun === "scene" ? "Scene" : "Block"} {block.blockIndex + 1}
        </strong>
        {/* THE WINDOW, from this scene's OWN offset and length. `index x clipSeconds` was the
            uniform contract's arithmetic and it is wrong the moment two scenes differ. */}
        <span style={dimText}>
          {windowLabel(block.startMs, block.durationMs)} · {durationLabel(block.durationMs)}
        </span>
      </div>
      {block.visual && (
        <p style={{ ...dimText, fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
          {KIND_COST_NOTE[block.visual]}
        </p>
      )}

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
            {pictureLine(block.visual, block.clip, block.asset, chosen?.title)}
          </span>
        </div>
        {block.clip?.verdict && (
          <div className="trace-line">
            <span style={traceText}>{VERDICT_COPY[block.clip.verdict] ?? block.clip.verdict}</span>
          </div>
        )}
        {block.clipStale && (
          <div className="trace-line">
            <span style={{ ...traceText, color: "var(--held-text)", fontWeight: 600 }}>
              {STALE_CLIP_NOTE}
            </span>
          </div>
        )}
        <div className="trace-line">
          <span style={traceText}>{voiceLine(block.narration, block.voice)}</span>
        </div>
        {block.voice?.verdict && (
          <div className="trace-line">
            <span style={traceText}>
              {VERDICT_COPY[block.voice.verdict] ?? block.voice.verdict}
            </span>
          </div>
        )}
        {block.voiceStale && (
          <div className="trace-line">
            <span style={{ ...traceText, color: "var(--held-text)", fontWeight: 600 }}>
              {STALE_VOICE_NOTE}
            </span>
          </div>
        )}
      </div>

      {/* THE VAULT PICKER (20.2 wave 6) — the sixth affordance, and the only thing in the product
          that can make an `uploaded_video` scene renderable. Vault-only by the contract wave 1
          shipped: `Scene.asset` has one member, so the file arrives through the vault's existing
          upload path and this control only points at it. FREE — it buys nothing, which is the
          whole reason this kind exists beside a $0.40 generated clip. */}
      {block.visual === "uploaded_video" && (
        <div style={{ marginTop: "0.65rem" }}>
          <label
            htmlFor={`scene-asset-${block.blockIndex}`}
            style={{ ...dimText, fontSize: "0.72rem", display: "block", marginBottom: "0.3rem" }}
          >
            Your footage for this scene
          </label>
          <select
            id={`scene-asset-${block.blockIndex}`}
            value={block.asset?.docId ?? ""}
            disabled={busy || videos.length === 0}
            data-testid="scene-asset-picker"
            onChange={(e) => {
              const vaultDocId = e.target.value;
              if (!vaultDocId) return;
              setNote(null);
              void run(async () => {
                const res = await setAsset({ planId, blockIndex: block.blockIndex, vaultDocId });
                // The refusals are the render's own rules, applied where they are free — a
                // document that is not a video would clear the money gate and then fail in the
                // sandbox. Say which rule, never a bare "failed".
                if (!res.ok) {
                  setNote(
                    res.reason === "not_a_video"
                      ? "That document isn't a video, so it can't be a scene."
                      : "That document isn't available any more.",
                  );
                }
              });
            }}
            style={{
              width: "100%",
              maxWidth: "22rem",
              padding: "0.35rem 0.4rem",
              borderRadius: "0.35rem",
              border: "1px solid var(--rule)",
              background: "var(--paper)",
              color: "var(--ink)",
              fontSize: "0.8rem",
            }}
          >
            <option value="">
              {videos.length === 0
                ? "No videos in your vault yet — upload one there first"
                : "Choose a video from your vault…"}
            </option>
            {videos.map((v) => (
              <option key={v._id} value={v._id}>
                {v.title}
              </option>
            ))}
          </select>
          {/* An HONEST empty state (BRAND §1/§5): the cure is in another route, so it is named. */}
          {videos.length === 0 && (
            <p style={{ ...dimText, fontSize: "0.72rem", marginTop: "0.3rem" }}>
              Upload the clip in the vault, then choose it here. Nothing is bought for this scene.
            </p>
          )}
          {note && (
            <p
              style={{
                ...dimText,
                fontSize: "0.72rem",
                marginTop: "0.3rem",
                color: "var(--held-text)",
              }}
            >
              {note}
            </p>
          )}
        </div>
      )}

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
          Delete {noun}
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
        {buysSomething ? (
          <>
            <span style={{ ...dimText, fontSize: "0.72rem", fontWeight: 700 }}>Costs money:</span>
            <button
              type="button"
              disabled={busy}
              style={ghostBtn}
              onClick={() => void run(() => regenerate({ planId, blockIndex: block.blockIndex }))}
            >
              Regenerate this {noun}
            </button>
            {/* WHAT IT BUYS, per kind — a still is ~a tenth of a clip, and a silent scene has no
                take to re-record. A single sentence for all four would over-state three of them. */}
            <span style={{ ...dimText, fontSize: "0.72rem" }}>
              Buys{" "}
              {[
                block.visual === "animated_image"
                  ? "one new still"
                  : buysPicture
                    ? "one new clip"
                    : null,
                block.narration.trim() === "" ? null : "one new voice take",
              ]
                .filter(Boolean)
                .join(" and ")}
              , and rebuilds the reel. The other {noun}s are kept.
            </span>
          </>
        ) : (
          <span style={{ ...dimText, fontSize: "0.72rem" }}>
            Nothing to buy for this {noun} — edit it above and generate the reel.
          </span>
        )}
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
  noun,
  clipSeconds,
  targetSeconds,
  sceneCount,
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
  noun: "scene" | "block";
  clipSeconds: number;
  targetSeconds: number | null;
  sceneCount: number;
  threadId?: string;
}) {
  const resolved = estimate !== undefined;
  const refusal = estimate?.refusal ?? null;
  const canGenerate = resolved && refusal === null && (estimate?.lines.length ?? 0) > 0 && !busy;
  // The ceiling the refusal quotes. On a scene deck it is the TAKE's window and varies per scene,
  // so the estimate's own `chars` and the tile's counter are the precise numbers; this is the
  // fallback for a block deck, where every window is the same size.
  const maxChars = Math.round(clipSeconds * 14);

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
          {/* A SCENE deck has no single clip length — that arithmetic is what this phase removed —
              so it is priced as a reel of N scenes, and only a block deck quotes seconds-per-block. */}
          {targetSeconds === null
            ? `Priced at OpenAI Sora 2, 720p, ${clipSeconds} s per block`
            : `A ${targetSeconds}-second reel of ${sceneCount} scenes, priced per scene`}{" "}
          · {money(estimate?.remainingCents ?? 0)} of today's media budget remains.
        </p>
      )}

      {/* The refusal names the LEVER, and for the narration case the cure is the Edit narration
          control on the offending tile directly above. */}
      {refusal && (
        <p style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}>
          {refusalText(refusal, {
            capCents: estimate?.capCents ?? 0,
            totalCents: estimate?.totalCents ?? 0,
            maxChars,
            noun,
          })}
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
