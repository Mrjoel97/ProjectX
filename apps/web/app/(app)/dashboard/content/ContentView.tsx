"use client";

// CONT-01 — the Content library (plan 26-13), the connected route over `api.content` (26-12).
//
// THE PAGE ADDS NO NEW BACKEND SURFACE. Every action ends in a function that already existed and is
// already guarded, and the card carries the ref each one needs:
//   • Open / download  → `api.vault.vaultDoc` + the Vault's own `PreviewModal`. That modal already
//     resolves markdown vs PDF bytes, truncation, missing originals, delete and retry, and it owns
//     its dialog behaviour (focus trap, Escape, scroll lock). Building a second artifact viewer here
//     would be the duplication this repo keeps deleting; the shipped precedent for opening one BY ID
//     is `workspace/cards.tsx`'s `VaultDocModal`, copied verbatim below.
//   • Play a reel      → `api.media.reel({ planId })`, and ONLY when the card says the playback is
//     proved. That query's non-null `url` IS the validated-assembly guarantee (D8), so a reel whose
//     plan lost its sidecar has no Play button rather than a dead one.
//   • Promote          → `api.vault.promoteToReference` DIRECTLY (26-11 owner decision, 2026-08-22 —
//     one guarded promotion surface, never an `api.content.*` re-wrap), then
//     `api.contentAudit.recordPromotion` for the refs-only `vault.promoted` row. Two calls, not a
//     wrapper: the guard runs once, in one place. See `contentAudit.ts` for why the audit lives
//     there and not in `vault.ts` (which is kept log-free by construction, ADR-025).
//   • Reuse            → the code-owned cockpit link the card already carries. A LINK, nothing else:
//     no copy, no attachment, no send, no dispatch. `content.ts` is read-only by construction, so
//     there is no reuse-side write to disable.
//
// WHAT IS DELIBERATELY ABSENT, and the component test asserts each one:
//   • no sent-mail lane, no recipient state — Reports owns the record of what happened;
//   • no research-brief card and no "Refresh Research" action — the Knowledge Vault owns cited
//     grounding material that goes stale, and already renders that staleness.
// Both moves are CONT-01 as amended on 2026-08-22. The page NAMES the new owner rather than silently
// dropping the category, because a reader who used to find sent mail here needs to know where it went.
import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import { PreviewModal } from "../vault/PreviewModal";

type ShelfPage = FunctionReturnType<typeof api.content.listArtifacts>;
export type ArtifactCardData = ShelfPage["items"][number];
type ShelfSummary = FunctionReturnType<typeof api.content.summary>;
export type Lane = ArtifactCardData["lane"];
type LaneFilter = Lane | "all";

// ── styles ────────────────────────────────────────────────────────────────────────────
// Inline `CSSProperties`, matching FinanceView/PipelineView: the mockup's class names
// (`.art`, `.artgrid`, `.filt`, `.pill`) do not exist in `globals.css`, and the app deliberately
// has no component library (BRAND §8.3). `minmax(0, 1fr)` on every grid — a grid's implicit column
// is `auto`, which refuses to shrink below its widest item, and that is what clipped the Cost
// Console at 390px (26-10).
const stack: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "0.9rem",
};
const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1rem",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 7%, transparent)",
  minWidth: 0,
};
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
const button: CSSProperties = {
  minHeight: "2.5rem",
  borderRadius: "999px",
  padding: "0.5rem 1.1rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
const primary: CSSProperties = {
  ...button,
  borderColor: "var(--teal-600)",
  background: "var(--teal-600)",
  color: "var(--card)",
};
/** A disabled `button` still reads as pressable without this (the PipelineView note). */
const disabledLook: CSSProperties = { cursor: "not-allowed", opacity: 0.48 };
const pill: CSSProperties = {
  display: "inline-block",
  borderRadius: "999px",
  padding: "0.15rem 0.6rem",
  fontSize: "0.66rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  border: "1px solid var(--rule)",
  color: "var(--ink-soft)",
  background: "var(--canvas)",
};

// ── pure helpers and presentational components (exported for the DOM-free runner) ──────
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only.
// Anything below that calls a hook is module-private on purpose; the exports render to a string.

export const CONTENT_STATE_COPY = {
  loading: "Loading your library…",
  empty: "Nothing on the shelf yet. Documents, memos and reels land here as Pikar makes them.",
  partial: "More artifacts exist than this page shows.",
  busy: "Working…",
  error: "Couldn’t load your library. Retry when the connection is ready.",
  refusal: "That action is not available on this artifact. Nothing changed.",
  processing: "Filing this into your reference material…",
} as const;

export type ContentState = keyof typeof CONTENT_STATE_COPY;

export const LANE_LABELS: Record<LaneFilter, string> = {
  all: "All",
  document: "Documents",
  image: "Images",
  memo: "Memos",
  reel: "Reels",
};

/**
 * THE ONE-WAY WARNING. Promotion patches `origin` to `agent_promoted`, and `patchCreatedDoc`
 * refuses any row whose `origin !== "agent"` — so the assistant can never revise this document in
 * the thread again, and the only reversal is deleting it (ADR-025 records that ceiling as accepted).
 * Saying so BEFORE the click is the whole reason this is a confirm step rather than a button.
 */
export const PROMOTION_ONE_WAY =
  "Promoting a document makes it reference material the assistant can cite — it can no longer be " +
  "rewritten in this conversation.";

/** An honest count: a capped lane says "50+", never a wrong exact number. */
export function countLabel(count: number, capped: boolean): string {
  return capped ? `${count}+` : String(count);
}

/** Date only, in a NAMED zone the caller supplies (26-01: never server-local, never implicit). */
export function formatDay(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(epochMs));
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const LANE_BADGE: Record<Lane, string> = {
  document: "Doc",
  image: "Image",
  memo: "Memo",
  reel: "Reel",
};

/** The type badge: what the row IS, plus what the bytes are when those differ. */
export function typeBadge(card: ArtifactCardData): string {
  const suffix = card.bytes.state === "available" ? bytesLabel(card.bytes.mimeType) : null;
  const lane = LANE_BADGE[card.lane];
  return suffix === null ? lane : `${lane} · ${suffix}`;
}

function bytesLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "video/mp4") return "MP4";
  if (mimeType.startsWith("image/")) return mimeType.slice("image/".length).toUpperCase();
  if (mimeType.startsWith("text/")) return "Text";
  return mimeType.split("/").pop()?.toUpperCase() ?? "File";
}

/** Why a reel cannot be played, in the user's words. Never silent, never a dead Play button. */
export function reelUnprovedCopy(
  reason: "no-plan" | "no-bytes" | "no-sidecar" | "superseded",
): string {
  switch (reason) {
    case "no-plan":
      return "The conversation that made this reel is gone, so it can’t be played from here.";
    case "no-bytes":
      return "This reel has no finished video yet. Open the canvas to see where it stopped.";
    case "no-sidecar":
      return "This reel is being made again, so the finished cut isn’t the current one.";
    case "superseded":
      return "This conversation has since rendered a newer reel, so this one can’t be played here.";
  }
}

/** One accessible, screen-reader-announced notice per page state. */
export function ContentStateNotice({
  state,
  children,
}: {
  state: ContentState;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-content-state={state}
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.85rem 1rem",
        color: "var(--ink-soft)",
        background: "color-mix(in srgb, var(--card) 70%, transparent)",
      }}
    >
      {children ?? CONTENT_STATE_COPY[state]}
    </div>
  );
}

/**
 * Where the two moved categories went.
 *
 * A shelf that silently stopped showing sent email would just look broken to anyone who remembers
 * it being here. Reports has no route yet, so it is NAMED and not linked — the nav's own rule is no
 * dead links. The Knowledge Vault does exist, so research briefs get a real one.
 */
export function WhereItLivesNote() {
  return (
    <div style={{ ...card, background: "var(--canvas)", boxShadow: "none" }}>
      <p style={{ ...muted, fontSize: "0.88rem" }} data-testid="moved-surfaces">
        Sent email is a record of what happened rather than something you reuse, so it belongs to{" "}
        <strong>Reports</strong> (coming). Research briefs are cited material that goes stale, so
        they live in your{" "}
        <Link href="/dashboard/vault" style={{ color: "var(--teal-900)", fontWeight: 600 }}>
          Knowledge Vault
        </Link>
        , which already shows you how fresh they are.
      </p>
    </div>
  );
}

/** The filter chips. Counts come from `content.summary`, capped and honest about it. */
export function LaneFilters({
  summary,
  active,
  onSelect,
}: {
  summary: ShelfSummary | undefined;
  active: LaneFilter;
  onSelect: (lane: LaneFilter) => void;
}) {
  const counts: Record<LaneFilter, { count: number; capped: boolean } | null> = {
    all: summary ? summary.total : null,
    document: summary ? summary.lanes.document : null,
    image: summary ? summary.lanes.image : null,
    memo: summary ? summary.lanes.memo : null,
    reel: summary ? summary.lanes.reel : null,
  };
  return (
    // A native `<fieldset>` — the platform's own grouping element, which is why biome refuses a
    // `role="group"` div here (the MediaCanvas length-preset idiom, verbatim). Chrome reset; the
    // chips are the visible affordance.
    <fieldset
      aria-label="Filter artifacts"
      style={{
        display: "flex",
        gap: "0.4rem",
        flexWrap: "wrap",
        border: 0,
        padding: 0,
        margin: 0,
        minWidth: 0,
      }}
    >
      {(["all", "document", "image", "memo", "reel"] as const).map((lane) => {
        const entry = counts[lane];
        const selected = lane === active;
        return (
          <button
            key={lane}
            type="button"
            aria-pressed={selected}
            data-lane={lane}
            onClick={() => onSelect(lane)}
            style={{
              ...button,
              minHeight: "2.2rem",
              padding: "0.35rem 0.9rem",
              fontSize: "0.82rem",
              ...(selected
                ? {
                    borderColor: "var(--teal-600)",
                    background: "var(--teal-600)",
                    color: "var(--card)",
                  }
                : {}),
            }}
          >
            {LANE_LABELS[lane]}
            {entry === null ? null : (
              <span style={{ marginLeft: "0.45rem", fontVariantNumeric: "tabular-nums" }}>
                {countLabel(entry.count, entry.capped)}
              </span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * The honest result line for a filtered page.
 *
 * "3 matches" is a number with no scale. The shelf reads a bounded window and matches inside it, so
 * the sentence has to say how much was looked at — otherwise "nothing found" is indistinguishable
 * from "nothing found ON THIS PAGE", which is the exact failure the bound contract exists to stop.
 */
export function searchSummary(matched: number, scanned: number, more: boolean): string {
  const head =
    matched === 0
      ? `No titles match in the ${scanned} newest`
      : `${matched} of the ${scanned} newest ${scanned === 1 ? "artifact matches" : "artifacts match"}`;
  return more ? `${head} — there are older ones on the next page.` : `${head}.`;
}

/** Title search. A plain controlled input; the debounce is the query's own reactivity. */
export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ ...caps, fontSize: "0.62rem" }}>Search</span>
      <input
        type="search"
        value={value}
        placeholder="Titles…"
        data-testid="content-search"
        onChange={(event) => onChange(event.target.value)}
        style={{
          ...button,
          cursor: "text",
          fontWeight: 400,
          minWidth: "11rem",
          maxWidth: "100%",
        }}
      />
    </label>
  );
}

export type ArtifactActions = {
  open: (card: ArtifactCardData) => void;
  play: (card: ArtifactCardData) => void;
  askPromote: (card: ArtifactCardData) => void;
  confirmPromote: (card: ArtifactCardData) => void;
  cancelPromote: () => void;
};

/**
 * ONE artifact card. Pure: every action arrives as a handler, so this renders in the DOM-free runner
 * and the component test can assert exactly which controls a given row is offered.
 */
export function ArtifactCard({
  card: item,
  actions,
  timeZone,
  confirming,
  busy,
  note,
  playing,
  player,
  thumbnail,
}: {
  card: ArtifactCardData;
  actions: ArtifactActions;
  timeZone: string;
  confirming: boolean;
  busy: boolean;
  note: string | null;
  playing: boolean;
  player?: ReactNode;
  /** Rendered for an image card only, and only by a parent that fetched its URL on demand. */
  thumbnail?: ReactNode;
}) {
  const promotable = item.promotion.state === "eligible" || item.promotion.state === "retry";
  const proved = item.reel?.playback.state === "proved";
  return (
    <article
      style={card}
      data-testid="artifact-card"
      data-lane={item.lane}
      data-doc-id={item.vaultDocId}
    >
      <div style={{ display: "grid", gap: "0.5rem", minWidth: 0 }}>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={pill}>{typeBadge(item)}</span>
          {item.promotion.state === "promoted" ? (
            <span style={{ ...pill, borderColor: "var(--released)", color: "var(--released)" }}>
              Reference material
            </span>
          ) : null}
          {item.status !== "ready" ? (
            <span style={{ ...pill, borderColor: "var(--rule)" }} data-status={item.status}>
              {item.status === "failed" ? "Failed" : item.status.replace(/_/g, " ")}
            </span>
          ) : null}
        </div>

        {item.lane === "image" ? thumbnail : null}

        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
          {item.title}
        </h3>

        <p style={{ ...muted, fontSize: "0.8rem" }}>
          {formatDay(item.createdAt, timeZone)} · {formatBytes(item.sizeBytes)} ·{" "}
          {item.provenance.state === "known"
            ? "from a conversation you can reopen"
            : "from before Pikar recorded which conversation made it"}
        </p>

        {item.status === "failed" && item.failureReason ? (
          <ContentStateNotice state="refusal">
            This could not be filed: {item.failureReason}
          </ContentStateNotice>
        ) : null}
        {item.status === "processing" ? <ContentStateNotice state="processing" /> : null}

        {item.lane === "reel" && item.reel && item.reel.playback.state === "unproved" ? (
          <ContentStateNotice state="refusal">
            {reelUnprovedCopy(item.reel.playback.reason)}
          </ContentStateNotice>
        ) : null}

        {playing ? player : null}

        {confirming ? (
          <div
            style={{
              ...card,
              background: "var(--canvas)",
              boxShadow: "none",
              display: "grid",
              gap: "0.6rem",
            }}
            data-testid="promote-confirm"
          >
            <p style={{ ...muted, fontSize: "0.86rem" }}>{PROMOTION_ONE_WAY}</p>
            <p style={{ ...muted, fontSize: "0.86rem" }}>
              This cannot be undone — the only way back is deleting the artifact.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                style={busy ? { ...primary, ...disabledLook } : primary}
                disabled={busy}
                data-testid="promote-confirm-button"
                onClick={() => actions.confirmPromote(item)}
              >
                {busy ? CONTENT_STATE_COPY.busy : "Promote to reference"}
              </button>
              <button type="button" style={button} onClick={actions.cancelPromote} disabled={busy}>
                Keep it editable
              </button>
            </div>
          </div>
        ) : null}

        {note ? <ContentStateNotice state="refusal">{note}</ContentStateNotice> : null}

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {item.lane === "reel" ? (
            proved ? (
              <button
                type="button"
                style={primary}
                data-testid="play-reel"
                onClick={() => actions.play(item)}
              >
                {playing ? "Hide" : "Play"}
              </button>
            ) : null
          ) : (
            <button
              type="button"
              style={primary}
              data-testid="open-artifact"
              onClick={() => actions.open(item)}
            >
              {item.lane === "memo" ? "Read" : "Open"}
            </button>
          )}

          {item.reel?.canvasHref ? (
            <Link href={item.reel.canvasHref} style={button} data-testid="open-canvas">
              Open canvas
            </Link>
          ) : null}

          {item.reuse.state === "available" ? (
            <Link href={item.reuse.href} style={button} data-testid="reuse-artifact">
              Reuse in the cockpit
            </Link>
          ) : (
            <span
              style={{ ...button, ...disabledLook }}
              aria-disabled="true"
              data-testid="reuse-unavailable"
            >
              No conversation recorded
            </span>
          )}

          {promotable && !confirming ? (
            <button
              type="button"
              style={button}
              data-testid="promote-artifact"
              onClick={() => actions.askPromote(item)}
            >
              {item.promotion.state === "retry" ? "Try promoting again" : "Promote to reference"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// ── connected pieces (hooks live below this line) ─────────────────────────────────────

/** The browser's IANA zone, the documented v1 fallback until the tenant profile owns one (26-01). */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Open ONE artifact over the shelf. Copied from `workspace/cards.tsx`'s `VaultDocModal`: the card
 * holds an id and nothing else, so the row is fetched HERE, on demand, and only while the modal is
 * open — no signed URL is ever minted for a card nobody clicked. `null` (deleted, or another
 * tenant's) renders nothing rather than asserting the artifact exists because a stale card names it.
 */
function ArtifactModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const doc = useQuery(api.vault.vaultDoc, { vaultDocId: docId });
  if (doc === undefined || doc === null) return null;
  return <PreviewModal doc={doc} onClose={onClose} />;
}

/**
 * The reel player, and the reason it is not the `PreviewModal` branch that would also work.
 *
 * `PreviewModal` would happily play the reel row's own bytes through `vault.vaultDownloadUrl`. That
 * is right for the Knowledge Vault, which shows you your files. It is wrong here: Content presents
 * GOVERNED artifacts, and `api.media.reel` is the query whose non-null `url` means the assembly
 * record validated (D8 — "a final video without an assembly.json was hand-assembled"). A null url
 * on a card the shelf marked proved is a real disagreement, and it says so rather than showing a
 * broken frame.
 */
function ReelPlayer({ planId }: { planId: string }) {
  const reel = useQuery(api.media.reel, { planId: planId as never });
  if (reel === undefined) return <ContentStateNotice state="loading" />;
  if (reel.url === null) {
    return (
      <ContentStateNotice state="refusal">
        The finished cut is no longer available for this reel.
      </ContentStateNotice>
    );
  }
  return (
    // The captions are BURNED INTO THE PIXELS (plan 20-17), so there is no WebVTT file to attach —
    // the same reason MediaCanvas's player carries no track.
    // biome-ignore lint/a11y/useMediaCaption: burned-in captions, no sidecar track exists
    <video
      controls
      playsInline
      src={reel.url}
      data-testid="reel-player"
      style={{
        width: "100%",
        maxWidth: "22rem",
        borderRadius: "0.5rem",
        display: "block",
        background: "var(--ink)",
      }}
    />
  );
}

/**
 * An image card's preview.
 *
 * The URL is minted PER VISIBLE CARD, through the Vault's own ownership-checked reader, and only
 * for the image lane — a card the user has actually been shown. That is the same rule the modal and
 * the reel player follow, one step earlier: a shelf of 24 documents subscribes to nothing, and a
 * shelf of 24 images subscribes to exactly the 24 it is drawing. A null URL means the metadata
 * points at bytes that are gone, and the card says so rather than drawing a broken frame.
 */
function ImageThumb({ vaultDocId, title }: { vaultDocId: string; title: string }) {
  const url = useQuery(api.vault.vaultDownloadUrl, {
    vaultDocId: vaultDocId as never,
  });
  if (url === undefined) {
    return (
      <div
        style={{ height: "8rem", borderRadius: "0.65rem", background: "var(--canvas)" }}
        aria-hidden="true"
      />
    );
  }
  if (url === null) {
    return (
      <ContentStateNotice state="refusal">The picture is no longer stored.</ContentStateNotice>
    );
  }
  return (
    // A signed, short-lived storage URL is not a static asset: next/image would need the Convex
    // host whitelisted in next.config and would then cache a URL that expires. The Vault's own
    // PreviewModal renders stored images the same way, for the same reason.
    // biome-ignore lint/performance/noImgElement: signed storage URL, not an optimisable asset
    <img
      src={url}
      alt={title}
      data-testid="image-thumb"
      style={{
        width: "100%",
        height: "8rem",
        objectFit: "cover",
        borderRadius: "0.65rem",
        display: "block",
        background: "var(--canvas)",
      }}
    />
  );
}

const PAGE_SIZE = 24;

function ContentShelf() {
  const [lane, setLane] = useState<LaneFilter>("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const timeZone = useMemo(browserTimeZone, []);

  const summary = useQuery(api.content.summary, {});
  const page = useQuery(api.content.listArtifacts, {
    limit: PAGE_SIZE,
    ...(lane === "all" ? {} : { lane }),
    ...(cursor === null ? {} : { cursor }),
    ...(query.trim() === "" ? {} : { query }),
  });

  // The single guarded promotion surface, called directly (26-11), and its caller-side audit row.
  const promote = useMutation(api.vault.promoteToReference);
  const recordPromotion = useMutation(api.contentAudit.recordPromotion);

  function selectLane(next: LaneFilter) {
    setLane(next);
    setCursor(null); // a cursor from one lane means nothing in another
    setConfirmingId(null);
    setNote(null);
  }

  function search(next: string) {
    setQuery(next);
    // Same rule as the lane filter: a cursor names a position in one result set, so carrying it
    // into another would page through a shelf the user is no longer looking at.
    setCursor(null);
  }

  async function confirmPromote(item: ArtifactCardData) {
    if (busyId !== null) return;
    setBusyId(item.vaultDocId);
    setNote(null);
    try {
      const result = await promote({ vaultDocId: item.vaultDocId });
      // The audit is a SEPARATE call, deliberately (contentAudit.ts's header). It reports what the
      // promotion returned; it never decides anything, so a failure here must not read as a failed
      // promotion — the artifact really was promoted.
      const outcome = result.ok ? result.state : result.reason;
      try {
        await recordPromotion({ vaultDocId: item.vaultDocId, result: outcome });
      } catch {
        /* the row's own origin + the ingest trail remain the record (ADR-025) */
      }
      if (!result.ok) {
        setNote({ id: item.vaultDocId, text: CONTENT_STATE_COPY.refusal });
      }
      setConfirmingId(null);
    } catch {
      setNote({ id: item.vaultDocId, text: CONTENT_STATE_COPY.error });
    } finally {
      setBusyId(null);
    }
  }

  const actions: ArtifactActions = {
    open: (item) => setOpenId(item.vaultDocId),
    play: (item) => setPlayingId((open) => (open === item.vaultDocId ? null : item.vaultDocId)),
    askPromote: (item) => {
      setConfirmingId(item.vaultDocId);
      setNote(null);
    },
    confirmPromote: (item) => void confirmPromote(item),
    cancelPromote: () => setConfirmingId(null),
  };

  return (
    <div style={stack}>
      <div
        style={{
          display: "flex",
          gap: "0.65rem",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <LaneFilters summary={summary} active={lane} onSelect={selectLane} />
        <SearchBox value={query} onChange={search} />
      </div>
      <WhereItLivesNote />

      {page === undefined ? <ContentStateNotice state="loading" /> : null}
      {page !== undefined && page.items.length === 0 ? (
        <ContentStateNotice state="empty">
          {query.trim() === "" ? undefined : searchSummary(page.items.length, page.scanned, true)}
        </ContentStateNotice>
      ) : null}
      {page !== undefined && page.items.length > 0 && query.trim() !== "" ? (
        <p style={{ ...muted, fontSize: "0.82rem" }} data-testid="search-summary">
          {searchSummary(page.items.length, page.scanned, page.bound.partial)}
        </p>
      ) : null}

      {page !== undefined && page.items.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: "0.9rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 17rem), 1fr))",
          }}
        >
          {page.items.map((item) => (
            <ArtifactCard
              key={item.vaultDocId}
              card={item}
              actions={actions}
              timeZone={timeZone}
              confirming={confirmingId === item.vaultDocId}
              busy={busyId === item.vaultDocId}
              note={note?.id === item.vaultDocId ? note.text : null}
              playing={playingId === item.vaultDocId}
              player={
                item.reel?.planId ? <ReelPlayer planId={item.reel.planId as string} /> : undefined
              }
              thumbnail={
                item.lane === "image" ? (
                  <ImageThumb vaultDocId={item.vaultDocId} title={item.title} />
                ) : undefined
              }
            />
          ))}
        </div>
      ) : null}

      {page !== undefined && (page.bound.partial || cursor !== null) ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <ContentStateNotice state="partial" />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" style={button} onClick={() => setCursor(null)}>
              First page
            </button>
            <button
              type="button"
              style={page.bound.nextCursor === null ? { ...button, ...disabledLook } : button}
              disabled={page.bound.nextCursor === null}
              onClick={() => setCursor(page.bound.nextCursor)}
            >
              Next page
            </button>
          </div>
        </div>
      ) : null}

      {openId !== null ? <ArtifactModal docId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

class ContentErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Content view failed", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ ...stack, padding: "1.5rem 0" }}>
        <ContentStateNotice state="error" />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" style={primary} onClick={() => window.location.reload()}>
            Retry
          </button>
          <Link href="/dashboard/workspace" style={button}>
            Back to workspace
          </Link>
        </div>
      </div>
    );
  }
}

export function ContentView() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "1.5rem",
        padding: "1.5rem 0",
      }}
    >
      <header style={{ display: "grid", gap: "0.65rem" }}>
        <p style={caps}>Everything Pikar has made</p>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)",
          }}
        >
          Your content library
        </h1>
        <p style={muted}>
          Documents, memos and reels — one shelf for the things you would reuse, instead of hunting
          for the conversation that made them.
        </p>
      </header>
      <ContentErrorBoundary>
        <ContentShelf />
      </ContentErrorBoundary>
    </div>
  );
}
