"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  briefingSheet,
  capsTeal,
  snippetSheet,
  traceText,
  typeBadge,
  VaultDocButton,
} from "./cards";
import {
  adjustmentNotes,
  asVisualKind,
  BRIEF_LOCKED_NOTE,
  type Brief,
  type BriefChip,
  briefChips,
  briefRefusalText,
  citationView,
  DECK_ADJUSTED_LEDE,
  DECK_STALE_NOTE,
  type DeckAdjustment,
  type DeckSummary,
  deckStale,
  durationLabel,
  type EstimateView,
  estimateView,
  type FailureCard,
  type FailureFix,
  type FailureScene,
  failureCards,
  type HeroState,
  heroState,
  isPickableVideo,
  type JobEstimate,
  KIND_COST_NOTE,
  KIND_LABEL,
  type ProposalRefusal,
  pictureLine,
  pricedAsLine,
  proposalFailureCard,
  REPROPOSE_LABEL,
  REPROPOSE_MESSAGE,
  RETRY_PROPOSAL_MESSAGE,
  refusalText,
  ribbonShares,
  type SceneCitation,
  STALE_CLIP_NOTE,
  STALE_VOICE_NOTE,
  type StageState,
  type SummaryShot,
  salvageNote,
  type TrackerView,
  trackerView,
  usd,
  VERDICT_COPY,
  type VisualKind,
  variationView,
  voiceLine,
  windowLabel,
} from "./mediaCanvasView";
import { useSendCockpitMessage } from "./useSendCockpitMessage";

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
  /** 33-06, the tracker's last two inputs. The render plane arrives through `media.reel` (which is
   *  also where the url guarantee lives), but the CAPTION plane and the retry stamp are on the plan
   *  row itself — `plans.byThread` returns the whole document, so they are already here. Both are
   *  reactive for the same reason everything else on this surface is. */
  captionStatus?: string | null;
  renderRetriedAt?: number | null;
  /** 33-08. The caption plane's own reason CODE, for the degraded-deliverable card. A code by
   *  schema contract, never the burn's stderr (§4). */
  captionReason?: string | null;
  /** 33-07, the BRIEF plane and the VARIATION plane. All five arrive on the same plan document
   *  `plans.byThread` already returns — the chips row and the A/B region add no subscription. */
  brief?: Brief | null;
  briefChangedAt?: number | null;
  deckProposedAt?: number | null;
  shots?: SummaryShot[] | null;
  altShots?: SummaryShot[] | null;
  deckLockedAt?: number | null;
  /** 33-11 / 33-13: which sibling variation could not be built, and why. Present ONLY on a
   *  salvaged proposal, and the canvas is obliged to say so — see `ParserNotes`. */
  lostVariation?: { variation: string; reason: string } | null;
  /** 33.1-06: the music bed's licence line, when an Openverse track was laid under the reel. CC BY
   *  is free of charge and not free of duty; the owner chose the POST CAPTION as its home, so the
   *  canvas shows a copy-ready credit beside the finished reel. */
  musicCredit?: { attribution: string; sourceUrl: string } | null;
  /** 33-12 / 33-13: the seconds the PARSER moved to get the clips onto the provider's grid.
   *  Empty/absent on a deck the model got right — and never silent when it is not. */
  deckAdjustments?: DeckAdjustment[] | null;
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
              // Tested against the PAID set, not the free one, and that inversion is deliberate:
              // free kinds are the ones being added (stock now, whatever follows later) and every
              // one of them must default to dashed. Listing the free kinds instead means each new
              // one silently draws a solid "this cost money" edge until somebody notices.
              border:
                scene.visual === null ||
                scene.visual === "generated_video" ||
                scene.visual === "animated_image"
                  ? "1px solid var(--teal-600)"
                  : "1px dashed var(--rule)",
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

/** `threadId` is part of the card contract every plan-kind branch in `cards.tsx` is called with.
 *  The canvas still self-queries everything it READS from `plan._id`; the thread is needed only by
 *  33-07's re-propose button, which sends an ordinary chat message into THIS conversation rather
 *  than minting a second one. */
export function MediaCanvas({ plan, threadId }: { plan: MediaPlan; threadId?: string }) {
  return plan.mediaMode === "image" ? (
    <ImageCanvas plan={plan} />
  ) : (
    <ReelCanvas plan={plan} threadId={threadId} />
  );
}

/**
 * A REFUSED PROPOSAL, ON THE MEDIA SURFACE (33-13).
 *
 * The row this renders is `kind: "memo"` — `stageMediaPlan` set it and `persistStoryboard` never
 * moved it, because no deck parsed. Until now that meant it rendered as a memo card, with Approve
 * and Save over a reel that does not exist and no way forward; the owner hit it twice live and
 * described it as staring at a screen where nothing happens.
 *
 * It is the SAME `FailureCardBlock` the hero and the tiles use, given the same sheet the canvas
 * uses, so a person reading "the reel is held" and "I couldn't turn this into a usable storyboard"
 * is reading one story in one layout. No new vocabulary, no second card component.
 *
 * **The retry is an ORDINARY CHAT MESSAGE**, through `useSendCockpitMessage` — 33-07's rule
 * verbatim, and for its reason: this canvas has TWO mount points (`cards.tsx`'s plan-kind switch
 * and `page.tsx`'s CanvasPane), so a callback threaded down from a parent is two places to forget
 * it. `threadId` is required rather than optional-with-a-fallback: sending without one MINTS A NEW
 * THREAD, which moves the conversation out from under the canvas the user is looking at.
 */
export function ProposalFailureCanvas({
  refusal,
  threadId,
}: {
  refusal: ProposalRefusal;
  threadId?: string;
}) {
  const send = useSendCockpitMessage();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const card = proposalFailureCard(refusal);

  async function retry() {
    if (busy || !threadId) return;
    setBusy(true);
    setNote(null);
    try {
      await send({ threadId, text: RETRY_PROPOSAL_MESSAGE });
    } catch {
      setNote("That couldn't be sent. Nothing was asked for again — try once more.");
    } finally {
      setBusy(false);
    }
  }

  if (card === null) return null;

  return (
    // flexShrink 0 for the same reason the reel canvas carries it: this sheet is a flex item of
    // the fixed-height .pane-canvas section, whose overflow:hidden flips the flex min-height.
    <div
      style={{ ...briefingSheet, flexShrink: 0, padding: "1.15rem 1.25rem" }}
      data-testid="media-proposal-failure"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <p style={capsTeal}>Reel</p>
        <span style={typeBadge}>VIDEO</span>
      </div>
      <FailureCardBlock
        card={card}
        // No thread, no send — so the button says so by being disabled rather than by failing.
        busy={busy || !threadId}
        onFix={(fix) => {
          if (fix.arm === "retry_proposal") void retry();
        }}
      />
      {note && (
        <p
          role="status"
          style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function ReelCanvas({ plan, threadId }: { plan: MediaPlan; threadId?: string }) {
  const planId = plan._id as never;
  const blocks = useQuery(api.media.byPlan, { planId });
  const assets = useQuery(api.media.assetUrls, { planId });
  const reel = useQuery(api.media.reel, { planId });
  const estimate = useQuery(api.media.jobEstimate, { planId });
  // 33-08. A fifth subscription, and the only read on this surface whose answer is about
  // PROVENANCE rather than about state: `verified` is the server's tenant check on a
  // model-authored docId, and it is the reason a citation may become a link at all.
  const cites = useQuery(api.media.sceneCitations, { planId });

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
  // `visual` crosses the wire as a string (the closed set lives in `@pikar/core`, not in Convex's
  // validators), so it is narrowed ONCE here and every consumer below sees the union or `null`.
  const deck = (blocks ?? []).map((b) => ({ ...b, visual: asVisualKind(b.visual) }));

  // ONE deck's vocabulary, decided once. A row carries `visual` or it carries `type`, never both
  // (`media.sceneDeckOf`'s discriminator), so the whole surface can say "scene" or "block" without
  // eight sentences each guessing.
  const isScene = deck.some((b) => b.visual !== null);
  const noun = isScene ? ("scene" as const) : ("block" as const);

  // ── THE THREE DERIVATIONS (33-06) ──────────────────────────────────────────────────────────
  // Everything the hero, the tracker and the cost control render is decided in `mediaCanvasView`
  // and called here. This file gets the JSX and the event wiring, and nothing else: the runner in
  // `apps/web` is DOM-less, so a decision left in a `.tsx` can only ever be asserted as source
  // text — the shape this repo has a named defect class for.
  // ONE array for both folds (33-08): `FailureScene` is `TrackerScene` with the money and the code
  // on each face, so the tracker and the cards structurally cannot disagree about which scene
  // failed. Two arrays built from the same rows is how that drift starts.
  const trackerScenes: FailureScene[] = deck.map((b) => ({
    blockIndex: b.blockIndex,
    visual: b.visual,
    narration: b.narration,
    clip: b.clip,
    voice: b.voice,
  }));
  const tracker = trackerView(
    trackerScenes,
    reel?.status,
    plan.captionStatus,
    plan.renderRetriedAt,
  );
  const hero = heroState(
    { renderStatus: reel?.status ?? null, renderReason: reel?.reason ?? null },
    trackerScenes,
    reel?.url,
  );
  // The ceiling a refusal quotes. On a scene deck it is the TAKE's window and varies per scene, so
  // the estimate's own `chars` and the tile's counter are the precise numbers; this is the fallback
  // for a block deck, where every window is the same size.
  const cost = estimateView(estimate as JobEstimate | undefined, {
    noun,
    maxChars: Math.round(clipSeconds * 14),
  });

  // The vault list is fetched ONCE for the deck and only when a scene actually needs it — an
  // `uploaded_video` is the only kind whose picture comes from a document. `"skip"` keeps a deck
  // without one from subscribing to the vault at all.
  const needsPicker = deck.some((b) => b.visual === "uploaded_video");
  const vaultDocs = useQuery(api.vault.listVaultDocs, needsPicker ? {} : "skip");
  const videos = (vaultDocs ?? []).filter(isPickableVideo);

  // ── THE BRIEF AND THE VARIATION PLANES (33-07) ─────────────────────────────────────────────
  // Both fold off the plan document that is already here. `deckLockedAt` is the ONE input both
  // read, and it is why the chips go read-only and the switcher disappears at the same instant
  // Generate buys the deck.
  const locked = plan.deckLockedAt !== undefined && plan.deckLockedAt !== null;
  const chips = briefChips(plan.brief, locked);
  const stale = deckStale(plan.briefChangedAt, plan.deckProposedAt);
  const variations = variationView(plan);

  // ── THE CITATION AND FAILURE PLANES (33-08) ────────────────────────────────────────────────
  // Both are folds over reads already on this component. `heroState` still decides WHICH mode the
  // hero is in; `failureCards` decides what the held/failed modes actually SAY, which is why the
  // hero renders cards when there are any and falls back to the mode sentence when there are not
  // (a `rendered`-with-no-url refusal is a failed hero with no failed row behind it).
  const citations = citationView(cites);
  const failures = failureCards(
    {
      renderStatus: reel?.status ?? null,
      renderReason: reel?.reason ?? null,
      renderRetriedAt: plan.renderRetriedAt,
      captionStatus: plan.captionStatus,
      captionReason: plan.captionReason,
    },
    trackerScenes,
    estimate as JobEstimate | undefined,
  );
  const heroFailures = failures.filter((c) => c.where === "hero");

  return (
    // flexShrink 0: this sheet is a flex item of the fixed-height .pane-canvas section, and
    // briefingSheet's overflow:hidden flips the flex min-height auto->0 — without this the pane
    // crushes the sheet to the leftover viewport and clips the whole storyboard, unscrollably.
    <div
      style={{ ...briefingSheet, flexShrink: 0, padding: "1.15rem 1.25rem" }}
      data-testid="media-canvas"
    >
      {/* THE BRIEF READS FIRST. Everything under it is an ANSWER to it, so a mis-parsed ask is
          visible before a person spends time judging the storyboard that came out of it. */}
      <BriefRow planId={planId} threadId={threadId} chips={chips} locked={locked} stale={stale} />

      {/* WHAT THE PARSER DID (33-13). Between the ask and the answer, because it changes what
          the answer IS — and never behind a disclosure widget. */}
      <ParserNotes
        salvage={salvageNote(plan.lostVariation)}
        adjusted={adjustmentNotes(plan.deckAdjustments, plan.targetDurationSeconds)}
      />

      {/* THE TWO PROPOSALS, side by side — between the ask and the answer, and gone after
          Generate. */}
      <VariationCompare planId={planId} view={variations} noun={noun} />

      {/* HERO, and it is the same slot for the whole lifecycle — tracker, then reel, then
          both during a regenerate. Nothing below it moves when the render lands. */}
      <ReelHero
        hero={hero}
        tracker={tracker}
        reel={reel}
        noun={noun}
        cards={heroFailures}
        planId={planId}
        musicCredit={plan.musicCredit}
      />

      <GenerateBar
        view={cost}
        pricedAs={pricedAsLine(plan.targetDurationSeconds ?? null, deck.length, clipSeconds)}
        busy={busy}
        note={note}
        blockLine={citations.blockLine}
        onGenerate={() => void generate()}
      />

      {/* THE STRIP: the ribbon, the art direction and the per-scene tiles, in that order. Every
          affordance the tiles carried is unchanged — they moved, they did not change. */}
      {isScene && deck.length > 0 && <TimelineRibbon scenes={deck} />}

      {art && <ArtDirectionHeader art={art} />}

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
            citation={citations.byScene[b.blockIndex]}
            failure={failures.find((c) => c.where === "scene" && c.sceneIndex === b.blockIndex)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * WHAT THE PARSER DID TO THIS PROPOSAL (33-13) — the salvage, and every second it moved.
 *
 * It sits directly under the brief and above everything else, and it is NOT inside a `<details>`:
 * both facts here change what the storyboard below actually IS, and a disclosure a person has to
 * open is one most people never read. That is the whole difference between disclosed and silent.
 *
 * `aria-live="polite"` for the same reason the failure cards carry it: a proposal lands reactively
 * under a user who may already be looking at the canvas.
 */
function ParserNotes({ salvage, adjusted }: { salvage: string | null; adjusted: string[] }) {
  if (salvage === null && adjusted.length === 0) return null;
  return (
    <div
      aria-live="polite"
      data-testid="media-parser-notes"
      style={{
        border: "1px solid var(--rule)",
        borderRadius: "0.55rem",
        background: "var(--card)",
        padding: "0.6rem 0.7rem",
        margin: "0.6rem 0 0",
        display: "grid",
        gap: "0.3rem",
      }}
    >
      {/* --held-text, not --held: amber on paper fails WCAG as text (BRAND §6), and the words
          carry the meaning either way — nothing here is signalled by colour alone. */}
      {salvage && (
        <p style={{ ...dimText, color: "var(--held-text)", fontWeight: 600 }}>{salvage}</p>
      )}
      {adjusted.length > 0 && (
        <>
          <p style={{ ...dimText, color: "var(--held-text)", fontWeight: 600 }}>
            {DECK_ADJUSTED_LEDE}
          </p>
          <ul style={{ listStyle: "disc", margin: 0, padding: "0 0 0 1.1rem", display: "grid" }}>
            {adjusted.map((line) => (
              <li key={line} style={{ ...dimText, fontSize: "0.78rem" }}>
                {line}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** `media.editBrief`'s patch, structurally. Only the brief plane — the deck's own
 *  `targetDurationSeconds` is the money contract and nothing here can reach it. */
type BriefPatch = {
  topic?: string;
  durationSeconds?: number;
  audience?: string;
  tone?: string;
  brandVoice?: string;
};

/**
 * THE BRIEF ROW (33-07) — the chips, the stale badge, and the one free way back to a proposal.
 *
 * **Two surfaces, one brief.** The chat captured it; this is where it can be read back and
 * corrected. It renders ABOVE the hero because everything below is an answer to it, and a
 * mis-parsed ask is worth catching before a person spends attention judging the storyboard it
 * produced.
 *
 * **NOTHING HERE AUTO-FIRES.** Editing a chip calls `editBrief` and stops — it never triggers a
 * proposal, because a proposal is a model turn and a model turn is money. The badge plus the
 * button are the entire affordance, and the button is a CLICK (D7's rule, verbatim).
 *
 * **The re-propose is an ORDINARY CHAT MESSAGE.** It goes through `useSendCockpitMessage` — the
 * same hook `ChatPane`'s composer, `cards.tsx`'s regenerate and four other surfaces use — with a
 * canned text and THIS thread's id. A second UI→dispatch entry point is the named anti-pattern
 * here: it would be a second door into the agent loop with its own guardrail, spend and clock
 * behaviour to keep in sync, and the hook exists precisely so a new caller cannot be born
 * clockless. The turn lands in the transcript like any other, which is also why the canned text
 * reads like something a person could have typed.
 *
 * Every string on this surface comes from `mediaCanvasView`; this function is markup and wiring.
 */
function BriefRow({
  planId,
  threadId,
  chips,
  locked,
  stale,
}: {
  planId: never;
  threadId?: string;
  chips: BriefChip[];
  locked: boolean;
  stale: boolean;
}) {
  const editBrief = useMutation(api.media.editBrief);
  const send = useSendCockpitMessage();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function commit(patch: BriefPatch) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await editBrief({ planId, patch });
      if (res.ok) setEditing(null);
      else setNote(briefRefusalText(res.reason));
    } finally {
      setBusy(false);
    }
  }

  // The canned turn. `threadId` is required, not optional-with-a-fallback: sending without one
  // MINTS A NEW THREAD, which would move the conversation out from under the canvas the user is
  // looking at. No thread, no button.
  async function repropose() {
    if (busy || !threadId) return;
    setBusy(true);
    setNote(null);
    try {
      await send({ threadId, text: REPROPOSE_MESSAGE });
    } catch {
      setNote("That couldn't be sent. Nothing was re-proposed — try again.");
    } finally {
      setBusy(false);
    }
  }

  // No brief, no row. `briefChips` returns `[]` for the same reason `editBrief` refuses
  // `no_brief`: a chip row over nothing would read a client-side default back as the user's ask.
  if (chips.length === 0) return null;

  return (
    <div data-testid="media-brief" style={{ marginBottom: "0.2rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
        <p style={capsTeal}>Brief</p>
        {locked && <span style={dimText}>Locked</span>}
      </div>

      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          listStyle: "none",
          margin: "0.55rem 0 0",
          padding: 0,
        }}
      >
        {chips.map((chip) => (
          <li
            key={chip.field}
            style={{
              border: "1px solid var(--rule)",
              borderRadius: "0.5rem",
              padding: "0.45rem 0.6rem",
              background: "var(--card)",
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            <p style={{ ...capsTeal, color: "var(--ink-soft)", fontSize: "0.6rem" }}>
              {chip.label}
              {/* REQUIRED is a WORD, never an asterisk and never colour (BRAND §6). Only two
                  chips carry it — the other three are an idea-stage tenant's blanks, and
                  Phase 11 admitted those users on purpose. */}
              {chip.required ? " · required" : ""}
            </p>

            {chip.options.length > 0 ? (
              /* THE LENGTH PRESET. A native `<fieldset>` (the platform's own grouping element,
                 which is why biome refuses a `role="group"` div here) holding the same
                 `aria-pressed` two-state buttons the workspace's canvas toggle uses: the pressed
                 state is announced, and there is no free-entry field to type an unpriceable
                 number into. Its chrome is reset — the chip is already the visible border. */
              <fieldset
                aria-label="Reel length"
                style={{
                  display: "flex",
                  gap: "0.25rem",
                  marginTop: "0.3rem",
                  border: 0,
                  padding: 0,
                  margin: "0.3rem 0 0",
                  minWidth: 0,
                }}
              >
                {chip.options.map((option) => (
                  <button
                    key={option.seconds}
                    type="button"
                    aria-pressed={option.current}
                    disabled={busy || !chip.editable}
                    data-testid="brief-duration-option"
                    onClick={() => void commit({ durationSeconds: option.seconds })}
                    style={{
                      ...ghostBtn,
                      cursor: chip.editable ? "pointer" : "default",
                      fontWeight: option.current ? 700 : 400,
                      // Teal as a FILL with white text — never as small teal text (BRAND §6).
                      background: option.current ? "var(--teal-600)" : "var(--paper)",
                      color: option.current ? "#fff" : "var(--ink)",
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </fieldset>
            ) : editing === chip.field ? (
              <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.3rem" }}>
                <input
                  id={`brief-${chip.field}`}
                  aria-label={chip.label}
                  value={draft}
                  placeholder={chip.placeholder}
                  onChange={(e) => setDraft(e.target.value)}
                  style={{
                    fontSize: "0.82rem",
                    padding: "0.25rem 0.4rem",
                    borderRadius: "0.35rem",
                    border: "1px solid var(--rule)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    minWidth: "10rem",
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  style={ghostBtn}
                  onClick={() => void commit(briefPatch(chip.field, draft))}
                >
                  Save
                </button>
                <button type="button" style={ghostBtn} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!chip.editable}
                data-testid="brief-chip-edit"
                aria-label={`Edit ${chip.label}`}
                onClick={() => {
                  setDraft(chip.value);
                  setEditing(chip.field);
                }}
                style={{
                  ...ghostBtn,
                  marginTop: "0.3rem",
                  border: "none",
                  padding: "0.1rem 0",
                  background: "transparent",
                  cursor: chip.editable ? "pointer" : "default",
                  textAlign: "left",
                  maxWidth: "18rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: chip.value === "" ? "var(--ink-soft)" : "var(--ink)",
                }}
              >
                {chip.value === "" ? chip.placeholder : chip.value}
              </button>
            )}

            {/* THE DEFAULTED MARKER — the model's word, not the user's, said in words. Editing
                the chip is what clears it (`editBrief` drops the field from `defaulted`). */}
            {chip.marker && (
              <p style={{ ...dimText, fontSize: "0.68rem", margin: "0.2rem 0 0" }}>{chip.marker}</p>
            )}
            {/* Cost discoverability, in the KIND_COST_NOTE idiom: on the chip when 60 s is the
                current ask, on the option when it is not — so it is read either way, once. */}
            {chip.note && (
              <p style={{ ...dimText, fontSize: "0.68rem", margin: "0.2rem 0 0" }}>{chip.note}</p>
            )}
            {chip.options.map(
              (option) =>
                option.note && (
                  <p
                    key={option.seconds}
                    style={{ ...dimText, fontSize: "0.68rem", margin: "0.2rem 0 0" }}
                  >
                    {option.note}
                  </p>
                ),
            )}
          </li>
        ))}
      </ul>

      {locked && <p style={{ ...dimText, marginTop: "0.5rem" }}>{BRIEF_LOCKED_NOTE}</p>}

      {/* THE STALE BADGE. It appears because a stamp moved, and it does exactly nothing else —
          the button beside it is the only thing that spends. */}
      {stale && !locked && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            flexWrap: "wrap",
            marginTop: "0.6rem",
          }}
          data-testid="media-brief-stale"
        >
          <span style={{ ...dimText, color: "var(--held-text)", fontWeight: 600 }}>
            {DECK_STALE_NOTE}
          </span>
          <button
            type="button"
            disabled={busy || !threadId}
            style={ghostBtn}
            data-testid="media-repropose"
            onClick={() => void repropose()}
          >
            {busy ? "Sending…" : REPROPOSE_LABEL}
          </button>
        </div>
      )}

      {note && (
        <p
          role="status"
          style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}
        >
          {note}
        </p>
      )}
      <hr style={sectionRule} />
    </div>
  );
}

/** A refusal that names no money, in the canvas's ONE refusal vocabulary. The fix menu and the
 *  retry button both answer in codes `refusalText` already speaks; the zero context is what says
 *  "this refusal quotes no total", exactly as the deck switcher's does. */
const fixRefusal = (reason: string, noun: "scene" | "block"): string =>
  refusalText({ reason }, { capCents: 0, totalCents: 0, maxChars: 0, noun });

/** The four free-text brief fields → a typed patch. Spelt out rather than computed from the key
 *  so the mutation's arg shape is checked at compile time instead of cast past. */
function briefPatch(field: string, value: string): BriefPatch {
  return field === "topic"
    ? { topic: value }
    : field === "audience"
      ? { audience: value }
      : field === "tone"
        ? { tone: value }
        : { brandVoice: value };
}

/**
 * THE A/B COMPARE REGION (33-07) — two proposals, side by side, until Generate.
 *
 * The PICKED deck is summarised here and drawn in full by the strip below; the ALTERNATE has only
 * this card, because a second full storyboard would double the page for a deck the user is
 * deciding whether to look at. Both summaries come from ONE fold (`deckSummary`), so the two
 * halves cannot count differently.
 *
 * **After Generate the region is ABSENT, not disabled.** `generateReel` discards `altShots` in the
 * same patch that stamps `deckLockedAt`, and `variationView` returns a null alternate for any
 * locked plan — so there is nothing here to grey out. A greyed switch would be a control that can
 * only ever answer `deck_locked`.
 *
 * Switching needs no estimate wiring: `switchDeck` swaps `shots`, and `jobEstimate` prices
 * whatever is in `shots`. The headline follows on its own subscription.
 *
 * NO CROSS-DECK SCENE MIXING. Deferred by decision — the per-scene editor already covers it by
 * hand, and a merge UI is a second deck model to keep consistent with the money path.
 */
function VariationCompare({
  planId,
  view,
  noun,
}: {
  planId: never;
  view: ReturnType<typeof variationView>;
  noun: "scene" | "block";
}) {
  const switchDeck = useMutation(api.media.switchDeck);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function swap() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await switchDeck({ planId });
      // The rail's own sentences for these two codes (33-06 added both) — one vocabulary for a
      // refusal, wherever it is read. Neither arm of `no_alternate`/`deck_locked` quotes money.
      if (!res.ok) {
        setNote(
          refusalText({ reason: res.reason }, { capCents: 0, totalCents: 0, maxChars: 0, noun }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (!view.hasAlternate || view.picked === null || view.alternate === null) return null;

  return (
    <div data-testid="media-variations">
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
        <p style={capsTeal}>Two storyboards</p>
        <span style={dimText}>
          Pick one before you generate — after that, the other is gone and every change is paid.
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gap: "0.6rem",
          margin: "0.55rem 0 0",
          gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
        }}
      >
        <DeckCard summary={view.picked} title="Showing now" />
        <DeckCard
          summary={view.alternate}
          title="The other one"
          action={
            <button
              type="button"
              disabled={busy || !view.canSwitch}
              style={ghostBtn}
              data-testid="media-switch-deck"
              onClick={() => void swap()}
            >
              {busy ? "Switching…" : "Switch to this storyboard"}
            </button>
          }
        />
      </div>
      {note && (
        <p
          role="status"
          style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}
        >
          {note}
        </p>
      )}
      <hr style={sectionRule} />
    </div>
  );
}

/** One deck, compactly. The kind mix uses `KIND_LABEL`'s own words, so this card and the tiles
 *  below it name the same things — and it is what makes the cheap deck visibly the cheap one. */
function DeckCard({
  summary,
  title,
  action,
}: {
  summary: DeckSummary;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: "0.6rem",
        background: "var(--card)",
        padding: "0.7rem 0.8rem",
        display: "grid",
        gap: "0.3rem",
        alignContent: "start",
      }}
    >
      <p style={{ ...capsTeal, color: "var(--ink)" }}>{title}</p>
      <p style={{ ...dimText, ...traceText, color: "var(--ink)" }}>{summary.concept}</p>
      <p style={{ ...dimText, fontSize: "0.75rem" }}>
        {summary.sceneCount} scenes · {summary.duration}
      </p>
      <p style={{ ...dimText, fontSize: "0.72rem" }}>{summary.kindMix}</p>
      {action}
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
              Total {usd(estimate.totalCents)} · {usd(estimate.remainingCents)} of today's media
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

/** A stage's state, in ink. Colour is the SECOND signal, never the only one (BRAND §6): every mark
 *  below is a word as well, and `--teal-600` is a fill colour rather than a text colour at 2.9:1 —
 *  an active stage takes `--teal-900`. */
const STAGE_TONE: Record<StageState, string> = {
  pending: "var(--ink-soft)",
  active: "var(--teal-900)",
  done: "var(--released)",
  failed: "var(--held-text)",
  skipped: "var(--ink-soft)",
};
const STAGE_MARK: Record<StageState, string> = {
  pending: "Waiting",
  active: "Working",
  done: "Done",
  failed: "Failed",
  skipped: "Not needed",
};

/**
 * THE PIPELINE TRACKER — what the hero slot holds until there is a reel to play.
 *
 * NO POLLING and no spinner. Every stage below moves because a Convex subscription delivered a
 * webhook's mutation or the render terminal's patch, which is the mechanism this whole surface is
 * built on; the fold that turns those rows into stages is `trackerView`, and it is tested by being
 * called. What lives here is the markup.
 */
function PipelineTracker({ view, compact }: { view: TrackerView; compact?: boolean }) {
  return (
    <div aria-live="polite" data-testid="media-tracker" style={{ display: "grid", gap: "0.5rem" }}>
      <ol
        style={{
          display: "grid",
          gap: "0.4rem",
          listStyle: "none",
          margin: 0,
          padding: 0,
          gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
        }}
      >
        {view.stages.map((stage) => (
          <li
            key={stage.key}
            style={{
              borderTop: `2px solid ${STAGE_TONE[stage.state]}`,
              paddingTop: "0.35rem",
              minWidth: 0,
            }}
          >
            <p style={{ ...capsTeal, color: "var(--ink)" }}>{stage.label}</p>
            <p
              style={{
                ...dimText,
                fontSize: "0.72rem",
                fontWeight: 700,
                color: STAGE_TONE[stage.state],
              }}
            >
              {STAGE_MARK[stage.state]}
            </p>
            <p style={{ ...dimText, fontSize: "0.75rem" }}>{stage.detail}</p>
          </li>
        ))}
      </ol>

      {/* THE PER-SCENE LANDING ROWS. Two providers' webhooks land minutes apart, so a scene whose
          voice is ready and whose picture is not must look different from the reverse — the same
          reason the tiles below carry two status rows rather than one. */}
      {!compact && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.15rem" }}>
          {view.scenes.map((row) => (
            <li key={row.blockIndex} style={{ ...dimText, fontSize: "0.75rem" }}>
              <span style={{ color: "var(--ink)", fontWeight: 700 }}>{row.label}</span> ·{" "}
              <span style={{ color: STAGE_TONE[row.picture.state] }}>
                picture {row.picture.text}
              </span>{" "}
              · <span style={{ color: STAGE_TONE[row.voice.state] }}>voice {row.voice.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * THE HERO — one slot, the whole lifecycle.
 *
 * The slot exists from the moment a deck is picked and never moves: it holds the tracker before the
 * reel exists, the reel afterwards, and BOTH during a regenerate (33-05 holds the old final's
 * validated artifact triple precisely so the user is not left staring at a gap for three minutes).
 * A layout that swapped a text region for a player when the render landed would jump the strip
 * below it down the page at the least convenient moment.
 *
 * **The player is four native attributes.** `autoPlay muted loop playsInline` is exactly the locked
 * "muted autoplay loop, tap for sound" decision, and `controls` is the tap: every browser's own
 * unmute button, keyboard-operable, with no player library and no component library (BRAND §8.3).
 */
function ReelHero({
  hero,
  tracker,
  reel,
  noun,
  cards,
  planId,
  musicCredit,
}: {
  hero: HeroState;
  tracker: TrackerView;
  reel: { durationS: number | null; sceneCount: number | null; gates: string[] } | undefined;
  noun: "scene" | "block";
  /** 33.1-06: the bed's licence line, shown beside the finished reel as a copy-ready caption credit. */
  musicCredit?: { attribution: string } | null;
  /** The reel's OWN failures (33-08) — render, held, captions. Empty for every healthy state, and
   *  also for the one failed state that has no failed row behind it (`rendered` with no url is a
   *  governed refusal to publish), which is why `hero.sentence` remains the fallback. */
  cards: FailureCard[];
  planId: never;
}) {
  const retryRender = useMutation(api.media.retryRender);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The ONE arm a reel-level card can carry. It is FREE to the user: 33-04 doubled the render line
  // precisely so a second sandbox is already paid for, and the card says so rather than leaving
  // "is this going to cost me again?" to be guessed.
  async function retry() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await retryRender({ planId });
      if (!res.ok) {
        setNote(
          refusalText({ reason: res.reason }, { capCents: 0, totalCents: 0, maxChars: 0, noun }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "0.2rem" }} data-testid="media-hero">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <p style={capsTeal}>Reel</p>
        <span style={typeBadge}>VIDEO</span>
      </div>

      <div
        style={{
          marginTop: "0.6rem",
          borderRadius: "0.6rem",
          border: "1px solid var(--rule)",
          background: "var(--canvas)",
          padding: "0.85rem",
          minHeight: "9rem",
        }}
      >
        {hero.mode === "video" && (
          <>
            <div style={{ position: "relative" }}>
              {/* NO <track>, and no suppression needed for it any more: the burned-in captions ARE
                  the caption track (plan 20-17) — they are pixels in the video, so there is no
                  WebVTT file to attach — and `muted` takes this element out of useMediaCaption's
                  scope entirely, which is why the old biome-ignore here now has no effect. */}
              <video
                autoPlay
                muted
                loop
                playsInline
                controls
                src={hero.url}
                data-testid="media-final"
                style={{
                  width: "100%",
                  maxWidth: "22rem",
                  borderRadius: "0.5rem",
                  display: "block",
                  background: "var(--ink)",
                }}
              />
              {hero.regenerating && (
                <div
                  style={{
                    marginTop: "0.6rem",
                    borderRadius: "0.5rem",
                    border: "1px dashed var(--rule)",
                    background: "var(--card)",
                    padding: "0.6rem",
                  }}
                >
                  <PipelineTracker view={tracker} compact />
                </div>
              )}
            </div>
            {hero.note && (
              <p style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)" }}>
                {hero.note}
              </p>
            )}
            {/* 33.1-06: the bed's licence line. CC BY is free of charge, not free of duty — the
                owner chose the post caption as its home, so this is the copy-ready credit, and
                the `Music:` prefix is what a viewer expects to read there. Also saved with the
                reel in the vault. Never hidden: a credited track without its credit is a breach. */}
            {musicCredit && (
              <p style={{ ...dimText, marginTop: "0.5rem" }} data-testid="media-music-credit">
                Add to your caption — <strong>Music:</strong> {musicCredit.attribution}
              </p>
            )}
            {reel?.sceneCount !== null && reel?.sceneCount !== undefined && (
              <p style={{ ...dimText, marginTop: "0.5rem" }}>
                {reel.sceneCount} {noun}s · {Math.round(reel.durationS ?? 0)} seconds
                {reel.gates.includes("speech_within_window")
                  ? " · every narration line fits before the next one."
                  : "."}
              </p>
            )}
          </>
        )}

        {hero.mode === "tracker" && (
          <>
            {hero.reason === "out_of_date" && (
              <p style={{ ...dimText, marginBottom: "0.6rem", color: "var(--held-text)" }}>
                The reel is out of date — the {noun}s have changed since it was last assembled.
                Generate again to rebuild it.
              </p>
            )}
            <PipelineTracker view={tracker} />
          </>
        )}

        {/* HELD and FAILED both keep the tracker underneath: the card says what stopped and what
            fixes it, and the stages say how far it got. 33-08 replaced the bare sentence with the
            cards — except where there is no card to render, which is the `rendered`-with-no-url
            refusal: a failed hero with no failed row anywhere behind it. */}
        {(hero.mode === "held" || hero.mode === "failed") && cards.length === 0 && (
          <p
            style={{
              ...dimText,
              color: "var(--held-text)",
              fontWeight: 600,
              marginBottom: "0.6rem",
            }}
            data-testid="media-hero-failure"
          >
            {hero.sentence}
          </p>
        )}

        {/* The reel's own cards, in the hero: the render/held card, then the caption card. A
            CAPTION failure appears here even over a PLAYING reel — the reel stands, and 20-17's
            rule is that a caption failure never unpublishes it, so the card reports a degraded
            deliverable rather than replacing the player. */}
        {cards.map((card) => (
          <FailureCardBlock
            key={card.key}
            card={card}
            busy={busy}
            // Retry is the ONLY arm a reel-level card carries; matching on it rather than
            // assuming it means a future arm cannot silently inherit this handler.
            onFix={(fix) => {
              if (fix.arm === "retry_render") void retry();
            }}
          />
        ))}
        {note && (
          <p
            role="status"
            style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}
          >
            {note}
          </p>
        )}

        {(hero.mode === "held" || hero.mode === "failed") && <PipelineTracker view={tracker} />}
      </div>
      <hr style={sectionRule} />
    </div>
  );
}

/** One row of `media.byPlan` — a BLOCK row (`type`, `visual: null`) or a 20.2 SCENE row. The two
 *  are one shape here on purpose: a tile renders whichever it was handed, and `visual` is the
 *  discriminator (`media.byPlan`'s own comment says why that projection is safe HERE and nowhere
 *  on the money path). */
/** One `mediaJobs` row as `media.byPlan`'s `faceOf` projects it. */
type JobFaceRow = {
  status: string;
  verdict: string | null;
  model: string;
  estUsd: number;
  actualCents: number | null;
  failureReason: string | null;
};

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
  /** 33-08 widened both faces with `media.byPlan`'s money and its reason CODE — the sunk-cost and
   *  detail-line inputs. They travel on the SAME face whose status the card is describing, which
   *  is why the code is not read off `assetUrls` instead. */
  clip: JobFaceRow | null;
  voice: JobFaceRow | null;
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
  citation,
  failure,
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
  citation?: SceneCitation;
  failure?: FailureCard;
}) {
  const editPrompt = useMutation(api.media.editBlockPrompt);
  const editNarration = useMutation(api.media.editBlockNarration);
  const regenerate = useMutation(api.media.regenerateBlock);
  const reorder = useMutation(api.media.reorderBlocks);
  const remove = useMutation(api.media.deleteBlock);
  const setAsset = useMutation(api.media.setSceneAsset);
  const confirmClaim = useMutation(api.media.confirmClaim);
  const setVisual = useMutation(api.media.setSceneVisual);

  // The fix menu's own message and its own draft, kept apart from the picker's `note` above: they
  // are two independent controls on one tile, and sharing one slot would let a picker refusal
  // overwrite a fix refusal the user is still reading.
  const [fixNote, setFixNote] = useState<string | null>(null);
  /** `null` = not asking. A text card must NAME ITS WORDS (`setSceneVisual` answers `no_overlay`
   *  otherwise), so the arm opens this field for a scene that has no overlay yet instead of firing
   *  a mutation whose refusal was knowable. */
  const [cardWords, setCardWords] = useState<string | null>(null);

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
  // A STOCK SCENE BUYS A PICTURE LINE, at zero. That reads like a contradiction and it is the
  // whole shape of the kind: the fetch needs a `mediaJobs` row, the row needs a reservation, and
  // the reservation is what "Regenerate" is. Omitting stock here would hide the button that makes
  // the fix menu's own "Swap it for free stock footage" arm actually produce a picture — set the
  // kind, then offer no way to land it. `uploaded_video` and `text_card` stay out because they
  // genuinely buy nothing: the vault already holds one, and ffmpeg draws the other.
  const buysPicture =
    block.visual === null ||
    block.visual === "generated_video" ||
    block.visual === "animated_image" ||
    block.visual === "stock_video" ||
    block.visual === "stock_image";
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

  /** The fix menu's dispatch (33-08). One arm per locked option, and each arm is the mutation that
   *  already exists for it — the card supplies the WORDS and the PRICE, never a new write path.
   *
   *  Every refusal comes back through `refusalText`, the canvas's one refusal vocabulary, so a
   *  `no_overlay` or an `over_daily_budget` reads the same here as it does on the estimate rail. */
  function applyFix(fix: FailureFix) {
    setFixNote(null);
    if (fix.arm === "regenerate") {
      void run(async () => {
        const res = await regenerate({ planId, blockIndex: block.blockIndex });
        if (!res.ok) setFixNote(fixRefusal(res.reason, noun));
      });
      return;
    }
    // The one arm that needs an answer before it can fire.
    if (fix.arm === "text_card" && (block.overlay ?? "").trim() === "") {
      setCardWords("");
      return;
    }
    void run(async () => {
      const res = await setVisual({ planId, sceneIndex: block.blockIndex, visual: fix.arm });
      if (!res.ok) setFixNote(fixRefusal(res.reason, noun));
    });
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

      {/* THE FIX MENU (33-08) — first thing on a broken tile, because on a held reel this is the
          only control that ends the hold. The card names the price of every arm; the free ones are
          free because they buy nothing, not because we are being generous. */}
      {failure && <FailureCardBlock card={failure} busy={busy} onFix={applyFix} />}
      {cardWords !== null && (
        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
          <input
            id={`scene-card-words-${block.blockIndex}`}
            aria-label="What the text card should say"
            value={cardWords}
            placeholder="What the card should say"
            onChange={(e) => setCardWords(e.target.value)}
            style={{
              fontSize: "0.82rem",
              padding: "0.25rem 0.4rem",
              borderRadius: "0.35rem",
              border: "1px solid var(--rule)",
              background: "var(--paper)",
              color: "var(--ink)",
              minWidth: "12rem",
            }}
          />
          <button
            type="button"
            disabled={busy}
            style={ghostBtn}
            data-testid="scene-card-words-save"
            onClick={() =>
              void run(async () => {
                const res = await setVisual({
                  planId,
                  sceneIndex: block.blockIndex,
                  visual: "text_card",
                  overlay: cardWords,
                });
                if (res.ok) setCardWords(null);
                else setFixNote(fixRefusal(res.reason, noun));
              })
            }
          >
            Use this card
          </button>
          <button type="button" style={ghostBtn} onClick={() => setCardWords(null)}>
            Cancel
          </button>
        </div>
      )}
      {fixNote && (
        <p
          role="status"
          style={{ ...dimText, marginTop: "0.4rem", color: "var(--held-text)", fontWeight: 600 }}
        >
          {fixNote}
        </p>
      )}

      <p style={{ ...dimText, ...traceText, margin: "0.5rem 0 0", color: "var(--ink)" }}>
        {block.description}
      </p>
      {block.overlay && (
        <p style={{ ...dimText, ...traceText, margin: "0.3rem 0 0" }}>Overlay: {block.overlay}</p>
      )}

      {/* THE CITATION (33-08) — where this scene's figure came from, and whose word it is.
          Absent entirely for a scene that claims nothing: creative copy needs no source, and a
          provenance affordance on a hook would train the user to ignore the ones that matter. */}
      {citation && (
        <div
          style={{ margin: "0.45rem 0 0", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}
          data-testid="scene-citation"
        >
          {/* The state IN WORDS first, never a coloured dot (BRAND §6). */}
          <span style={{ ...dimText, fontSize: "0.72rem", fontWeight: 700 }}>
            {citation.kind === "cited"
              ? "Source:"
              : citation.kind === "confirmed"
                ? "Confirmed:"
                : citation.kind === "needs_confirmation"
                  ? "Needs your confirmation:"
                  : "Unverified source:"}
          </span>
          {citation.link ? (
            /* The vault's own preview, through `cards.tsx`'s existing button — the ONLY path,
               and it reaches `api.vault.vaultDoc`, which answers `null` for a document that is
               not this tenant's. A `verified:false` citation has no `link` at all, so this
               branch cannot be entered from a foreign id (`citationView`'s rule 1). Teal-900
               rather than teal-600 and UNDERLINED: small teal-600 text is ~2.9:1 (BRAND §6), and
               an affordance signalled by colour alone is no affordance. */
            <VaultDocButton
              docId={citation.link.docId}
              testId="scene-citation-doc"
              style={{
                fontSize: "0.72rem",
                color: "var(--teal-900)",
                textDecoration: "underline",
              }}
            >
              {citation.link.title}
            </VaultDocButton>
          ) : (
            <span style={{ ...dimText, ...traceText, fontSize: "0.72rem" }}>{citation.label}</span>
          )}
          {citation.link && citation.kind !== "cited" && (
            <span style={{ ...dimText, ...traceText, fontSize: "0.72rem" }}>{citation.label}</span>
          )}
          {/* THE PROVENANCE FRONT DOOR. `confirmClaim` takes the plan and the scene and nothing
              else — actor and timestamp come from the authenticated context — so this click is
              structurally the only way a model-authored figure becomes the owner's word. */}
          {citation.action && (
            <button
              type="button"
              disabled={busy}
              style={ghostBtn}
              data-testid="scene-citation-confirm"
              onClick={() => void run(() => confirmClaim({ planId, sceneIndex: block.blockIndex }))}
            >
              {citation.action}
            </button>
          )}
        </div>
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
            {/* WHAT IT BUYS, per kind — a still is ~a FORTIETH of a clip (measured, wave 7: $0.01
                vs $0.40 at 4 s; this comment said "a tenth" until 33-06), and a silent scene has no
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

/**
 * ONE FAILURE, AS A CARD (33-08) — what happened, what it already cost, what fixing it costs.
 *
 * The same component in the hero (the reel's own failures) and on a tile (a scene's), because a
 * user reading "the reel is held" and then "this scene's picture failed" is reading one story and
 * two layouts would make it two.
 *
 * **The code is present and subordinate.** `detailCode` renders in `.trace-line` — the mono,
 * dimmed idiom this tile already uses for its status rows — because the person who needs
 * `sandbox_timeout` is opening a support ticket, and the person who needs "the render ran out of
 * time" is everyone else. What it never does is appear inside the headline: the card models
 * already guarantee that (`failureClause`), and this markup has no way to reintroduce it.
 *
 * `aria-live="polite"` because these cards APPEAR — a webhook lands, a render terminal patches, and
 * the region changes under a user who may not be looking at it.
 */
function FailureCardBlock({
  card,
  busy,
  onFix,
}: {
  card: FailureCard;
  busy: boolean;
  onFix: (fix: FailureFix) => void;
}) {
  return (
    <div
      aria-live="polite"
      data-testid="media-failure-card"
      style={{
        border: "1px solid var(--rule)",
        borderRadius: "0.55rem",
        background: "var(--card)",
        padding: "0.65rem 0.75rem",
        display: "grid",
        gap: "0.35rem",
        margin: "0.5rem 0 0",
      }}
    >
      <p style={{ ...dimText, color: "var(--held-text)", fontWeight: 600 }}>{card.headline}</p>
      {/* SPENT, never pending. `UNLANDED_RESOLVES.media === false` is what makes that wording a
          fact rather than a tone choice. */}
      {card.sunkLine && <p style={{ ...dimText, fontSize: "0.75rem" }}>{card.sunkLine}</p>}

      {card.fixes.length > 0 && (
        <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.15rem" }}>
          {card.fixes.map((fix) => (
            <div
              key={fix.arm}
              style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}
            >
              <button
                type="button"
                disabled={busy}
                style={ghostBtn}
                data-testid={`media-fix-${fix.arm}`}
                onClick={() => onFix(fix)}
              >
                {fix.label}
              </button>
              {/* FREE vs PAID in the same slot on every arm, so the cheap fix is visible without
                  reading three sentences — the 40x lever again, at the moment it matters most. */}
              <span
                style={{
                  ...dimText,
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "var(--ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fix.priceLabel}
              </span>
              {fix.note && (
                <span style={{ ...dimText, ...traceText, fontSize: "0.72rem" }}>{fix.note}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {card.detailCode && (
        <div className="trace-line">
          <span style={traceText}>{card.detailCode}</span>
        </div>
      )}
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
 * THE GENERATE CONTROL — D7's binding rule, now as ONE headline over an expandable breakdown.
 *
 * *"The editor must not offer a control that can spend money without showing the estimate first."*
 * 20-10 met that with four always-open lines, which met the letter and lost the number: the total —
 * the thing a person decides on — read as one row of five. 33-06 promotes it to a headline beside
 * the button and demotes the itemisation into a `<details>`, WITHOUT losing it, because the 40x
 * clip-vs-still lever only exists in the lines.
 *
 * `<details>`/`<summary>` is a native disclosure widget: keyboard-operable and screen-reader
 * announced with no state, no library, and no ARIA of our own (BRAND §8.3).
 *
 * Every string and both booleans come from `estimateView`. The button is `disabled` from the same
 * derivation that produces the sentence explaining why — a disabled look on an enabled button is a
 * click that spends money the user was told they could not.
 */
function GenerateBar({
  view,
  pricedAs,
  busy,
  note,
  blockLine,
  onGenerate,
}: {
  view: EstimateView;
  pricedAs: string;
  busy: boolean;
  note: string | null;
  /** 33-08. The COUNT of unconfirmed claims, which `jobEstimate`'s refusal cannot give — it names
   *  only the first offending scene. The refusal sentence stays the authoritative "why"; this is
   *  "how many more". */
  blockLine: string | null;
  onGenerate: () => void;
}) {
  const canGenerate = !view.generateDisabled && !busy;

  return (
    <div
      style={{ marginTop: "1rem", borderTop: "1px solid var(--rule)", paddingTop: "0.9rem" }}
      data-testid="media-estimate"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div>
          <p style={capsTeal}>Cost</p>
          {/* The BRAND §3 stat value: one big number, one small caps label above it. */}
          <p
            style={{
              margin: "0.15rem 0 0",
              fontSize: "1.6rem",
              fontWeight: 700,
              color: "var(--ink)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
            data-testid="media-total"
          >
            {view.headline}
          </p>
        </div>
        <button
          type="button"
          disabled={!canGenerate}
          onClick={onGenerate}
          data-testid="media-generate"
          style={{
            padding: "0.6rem 1.15rem",
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
      </div>

      {view.lines.length > 0 && (
        <details style={{ marginTop: "0.6rem" }}>
          <summary style={{ ...dimText, cursor: "pointer", fontSize: "0.8rem" }}>
            What makes up {view.headline}
          </summary>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0.5rem 0 0",
              display: "grid",
              gap: "0.3rem",
            }}
          >
            {view.lines.map((line) => (
              <li key={line.label}>
                <div
                  style={{
                    ...dimText,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <span style={traceText}>
                    {line.label} · {line.detail}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{line.amount}</span>
                </div>
                {line.note && (
                  <p style={{ ...dimText, fontSize: "0.72rem", margin: "0.1rem 0 0" }}>
                    {line.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p style={{ ...dimText, marginTop: "0.5rem" }}>
            {pricedAs} · {view.remaining}
          </p>
        </details>
      )}

      {/* The refusal names the LEVER, and for the narration case the cure is the Edit narration
          control on the offending tile in the strip above. */}
      {view.refusalSentence && (
        <p style={{ ...dimText, marginTop: "0.5rem", color: "var(--held-text)", fontWeight: 600 }}>
          {view.refusalSentence}
        </p>
      )}
      {/* WHAT WOULD UNBLOCK IT, beside the button that is blocked. The refusal above names the
          first scene; this names the size of the job, so a deck with four flagged figures does
          not read as one. */}
      {blockLine && (
        <p style={{ ...dimText, marginTop: "0.35rem" }} data-testid="media-confirm-block">
          {blockLine}
        </p>
      )}
      {view.lines.length === 0 && view.refusalSentence === null && (
        <p style={{ ...dimText, marginTop: "0.5rem" }}>{view.remaining}</p>
      )}
      {note && <p style={{ ...dimText, marginTop: "0.5rem" }}>{note}</p>}
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
  // 33-13, and it MUST be ahead of the kind check: a refused proposal is `kind: "memo"`, so the
  // empty-thread message below would tell a user whose run just failed that they never asked.
  if (plan?.proposalRefusal) {
    return <ProposalFailureCanvas refusal={plan.proposalRefusal} threadId={threadId} />;
  }
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
