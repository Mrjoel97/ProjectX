"use client";

import { api } from "@pikar/backend/api";
import { DOC_TYPE_LABEL, type DocType } from "@pikar/core";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";
import { failureCopy } from "./failureCopy";
import { FileTextIcon, FolderIcon, GridIcon, ListIcon, SearchIcon } from "./icons";

// The browse grid (brand-024242 / brand-024258): a search bar, the N ITEMS count, a grid/list
// toggle, and the doc cards/rows off the reactive listVaultDocs. Search runs vault.vaultSearch
// (the hybrid rag primitive, category-scoped) and filters the metadata rows to its hits — so a
// result card still shows the full status/size. Per-item status badges reflect the row
// (pending_extraction / extracting / processing / ready / failed — the Phase-3.8 walk, all
// reactive off the subscription). Failed cards carry a Retry (vaultSweep.retryExtraction).
// Clicking a card opens the preview (Task 3).

export type VaultDoc = FunctionReturnType<typeof api.vault.listVaultDocs>[number];
/** A folder card's row. Same idiom as VaultDoc: the projection the backend already returns, never a
 *  hand-typed mirror of it. Carries the live counters sealed progress reads. */
export type VaultFolder = FunctionReturnType<typeof api.vaultFolders.listFolders>[number];

// status → badge palette (mirrors the cockpit cards idiom; no token covers these small semantic
// chips, so the literals stand — not a hex a token covers). The label text carries the meaning,
// never the color alone (BRAND §6).
function statusBadge(status: string): { bg: string; fg: string; label: string } {
  switch (status) {
    case "ready":
      return { bg: "#dcfce7", fg: "#166534", label: "ready" };
    case "processing":
      return { bg: "#fef3c7", fg: "#92400e", label: "processing" };
    case "pending_extraction":
      return { bg: "#f1f5f9", fg: "#334155", label: "pending" };
    case "extracting":
      return { bg: "#cffafe", fg: "#155e75", label: "extracting" };
    case "failed":
      return { bg: "#fee2e2", fg: "#991b1b", label: "failed" };
    default:
      return { bg: "#f1f5f9", fg: "#334155", label: status };
  }
}

const MB = 1024 * 1024;
export function fmtSize(n: number): string {
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** What a document is CALLED on screen (VALT-12): its identity line — *"2025 P&L"* — when it has
 *  one, its filename otherwise. Exported so the card, the modal heading and every sibling pill's
 *  accessible name name the SAME thing; an aria-label that still said the filename while the card
 *  showed the identity would be the mismatch BRAND §6 forbids.
 *
 *  This is the DISPLAY name only. Wherever the filename IS the thing — the downloaded file, an
 *  `<img alt>` — `doc.title` stays untouched. */
export const docLabel = (d: VaultDoc): string => d.identityLine || d.title;

/** WHERE a card's sibling pill sits (grid ⇒ bottom-right, list ⇒ vertically centred right) — the
 *  failed-card Retry placement, split out from the pill's own shape so a folder card can anchor a
 *  ROW of pills in that spot. A document card never needs two at once (failed ⇒ no discuss); a
 *  folder that is still ingesting shows both Cancel and the wait control. */
function pillAnchor(view: "grid" | "list"): React.CSSProperties {
  return {
    position: "absolute",
    right: "0.85rem",
    ...(view === "grid" ? { bottom: "0.85rem" } : { top: "50%", transform: "translateY(-50%)" }),
  };
}

/** The pill's own shape, position-free. */
const pillShape: React.CSSProperties = {
  padding: "0.2rem 0.7rem",
  borderRadius: "999px",
  border: "none",
  fontSize: "0.72rem",
  fontWeight: 700,
  textDecoration: "none",
  lineHeight: 1.6,
};

/** Shared geometry for the "Discuss by voice" pill so the enabled link and the disabled wait state
 *  occupy the identical spot — the control must not move as the status flips under the user. */
function discussPillStyle(view: "grid" | "list"): React.CSSProperties {
  return { ...pillAnchor(view), ...pillShape };
}

/** `label` overrides the palette's own word so a folder can say "12 of 300 read" in an EXISTING
 *  palette. Deliberately not a new palette entry: the "processing" swatch is amber-looking
 *  (#fef3c7/#92400e) and no new element on this surface may argue about amber (BRAND §2). The count
 *  carries the meaning, never the colour (BRAND §6). */
function StatusChip({ status, label }: { status: string; label?: string }) {
  const b = statusBadge(status);
  return (
    <span
      style={{
        background: b.bg,
        color: b.fg,
        padding: "0.1rem 0.5rem",
        borderRadius: "0.375rem",
        fontSize: "0.72rem",
        fontWeight: 700,
      }}
    >
      {label ?? b.label}
    </span>
  );
}

/**
 * SEALED PROGRESS, off the folder row's LIVE counters. `listFolders` is a live Convex query, so
 * `terminalCount` climbing 0 → memberCount re-renders this chip on its own — do NOT add a poll, a
 * timer or a second query here either (the ban at the Discuss gate below applies surface-wide).
 * Every arm reuses an existing statusBadge key; no new hex is introduced.
 */
function folderChip(f: VaultFolder): { status: string; label: string } {
  switch (f.status) {
    case "ingesting":
      return { status: "pending_extraction", label: `${f.terminalCount} of ${f.memberCount} read` };
    case "complete":
      return {
        status: "ready",
        label: f.failedCount
          ? `${f.memberCount} documents · ${f.failedCount} failed`
          : `${f.memberCount} documents`,
      };
    case "refused":
      return { status: "failed", label: "refused" };
    default: // "reserving" — falls to statusBadge's neutral default palette
      return { status: f.status, label: "preparing" };
  }
}

/** PROVENANCE (ACTN-04): agent-authored vs user-uploaded, at a glance. Same markup and geometry as
 *  StatusChip so the two read as one row of chips; the LABEL carries the meaning, never the colour
 *  (BRAND §6). Teal tint + --ink text rather than --teal-600 text (~2.9:1, banned for small text by
 *  §6), and never --held — amber is the approval gate's alone (§2). Covers both `agent` and
 *  `agent_promoted`, which is why the gate is `origin !== undefined` and not an equality test. */
function OriginChip() {
  return (
    <span
      style={{
        background: "color-mix(in srgb, var(--teal-400) 30%, var(--card))",
        color: "var(--ink)",
        padding: "0.1rem 0.5rem",
        borderRadius: "0.375rem",
        fontSize: "0.72rem",
        fontWeight: 700,
      }}
    >
      AGENT
    </span>
  );
}

/** The machine-derived document TYPE (VALT-12), reading as one row of chips with the two above.
 *  Neutral paper tint rather than OriginChip's teal, so the two do not read as the same axis; the
 *  LABEL carries the meaning, never the colour (BRAND §6), and no amber is spent here (§2).
 *
 *  ABSENT and `"unclassified"` both render NOTHING — the card falls back to the filename for both,
 *  and only the folder digest's manifest distinguishes "never classified" from "classified and
 *  unplaceable". A chip reading "Unclassified" on every pre-15.3 row would be noise, not honesty. */
function DocTypeChip({ docType }: { docType: DocType }) {
  return (
    <span
      style={{
        background: "var(--canvas)",
        color: "var(--ink-soft)",
        border: "1px solid var(--rule)",
        padding: "0.1rem 0.5rem",
        borderRadius: "0.375rem",
        fontSize: "0.72rem",
        fontWeight: 700,
      }}
    >
      {DOC_TYPE_LABEL[docType]}
    </span>
  );
}

export function DocGrid({
  docs,
  category,
  folders,
  onOpen,
  onOpenFolder,
}: {
  docs: VaultDoc[];
  category: string;
  /** PRESENCE IS THE SCOPE SIGNAL: an array (possibly empty) at the top level, OMITTED inside a
   *  folder — a folder holds documents, not folders. That is what lets the empty state say "This
   *  folder is empty." with no extra prop. */
  folders?: VaultFolder[];
  onOpen?: (doc: VaultDoc) => void;
  onOpenFolder?: (folderId: VaultFolder["_id"]) => void;
}) {
  const search = useAction(api.vault.vaultSearch);
  const retry = useMutation(api.vaultSweep.retryExtraction);
  const cancelFolder = useMutation(api.vaultFolders.cancelFolder);
  const [query, setQuery] = useState("");
  const [hitIds, setHitIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [searching, setSearching] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Deliberately NOT retryingId: that is a GLOBAL one-at-a-time lock, so sharing it would
  // cross-disable every failed document's Retry while a folder cancel is in flight.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const folderCount = folders?.length ?? 0;

  async function runCancel(f: VaultFolder) {
    setCancellingId(f._id);
    try {
      await cancelFolder({ folderId: f._id }); // the card vanishes reactively via the subscription
    } finally {
      setCancellingId(null);
    }
  }

  async function runRetry(doc: VaultDoc) {
    setRetryingId(doc._id);
    try {
      await retry({ vaultDocId: doc._id }); // the chip flips reactively via the subscription
    } finally {
      setRetryingId(null);
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setHitIds(null);
      return;
    }
    setSearching(true);
    try {
      const results = await search({ query: q, category });
      setHitIds(new Set(results.map((r) => r._id)));
    } finally {
      setSearching(false);
    }
  }

  // The rows to show: all category docs, or (when a search ran) only its hits — full metadata kept.
  // ponytail: KNOWN CEILING — agent-CREATED documents (origin set) BROWSE here for free, because
  //  listVaultDocs collects the tenant partition with no kind/status/origin filter, but they will
  //  NEVER appear in this search box: vault.vaultSearch is the same rag primitive as grounding and
  //  created artifacts are deliberately never ingested (that absence IS the retrieval exclusion,
  //  vault.ts insertCreatedDoc). Upgrade path: a ~3-line title-substring fallback right here,
  //  unioned into hitIds. Accepted for beta — do NOT "fix" it by ingesting. Owner question, open in
  //  plan 18-09's gate.
  const rows = useMemo(
    () => (hitIds ? docs.filter((d) => hitIds.has(d._id)) : docs),
    [docs, hitIds],
  );

  return (
    <div>
      <div
        className="clay-card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.75rem 1rem",
          borderRadius: "1rem",
        }}
      >
        <span aria-hidden="true" style={{ color: "var(--ink-soft)", display: "inline-flex" }}>
          <SearchIcon />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
          onBlur={() => {
            if (!query.trim()) setHitIds(null);
          }}
          placeholder="Search my uploads…"
          aria-label="Search my uploads"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: "1rem",
            color: "var(--ink)",
          }}
        />
        {searching && (
          <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>Searching…</span>
        )}
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-soft)",
          }}
        >
          {/* Folder cards share this grid, so "N ITEMS" alone would describe only part of what is
              on screen. Both counts, named. */}
          {folderCount > 0 ? `${folderCount} FOLDER${folderCount === 1 ? "" : "S"} · ` : ""}
          {rows.length} ITEM{rows.length === 1 ? "" : "S"}
        </span>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {(["grid", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-label={`${v} view`}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2rem",
                height: "2rem",
                borderRadius: "0.5rem",
                border: "1px solid var(--rule)",
                cursor: "pointer",
                background: view === v ? "var(--teal-600)" : "transparent",
                color: view === v ? "#fff" : "var(--ink-soft)",
              }}
            >
              {v === "grid" ? <GridIcon /> : <ListIcon />}
            </button>
          ))}
        </div>
      </div>

      {/* A SEARCH THAT MATCHED NO DOCUMENT MUST SAY SO EVEN WHEN FOLDER CARDS REMAIN ON SCREEN.
          The zero test below is "nothing at all to show", which is right for the grid — but it also
          meant that at the top level with folders present, a query matching nothing rendered three
          folder cards and NO explanation. Folders are not searched (`rows` is filtered by `hitIds`,
          `folders` is not), so the user saw cards after a search and was never told the search came
          back empty — the one state they are most likely to misread (BRAND §1). */}
      {hitIds && rows.length === 0 && folderCount > 0 && (
        <p style={{ color: "var(--ink-soft)", textAlign: "center", margin: "1.25rem 0 0" }}>
          No documents match. Folders aren&rsquo;t searched — open one to search inside it.
        </p>
      )}

      {/* The zero test is "nothing at all to show", not "no documents" — gating on rows.length
          alone would suppress the whole grid container and with it every folder card. */}
      {rows.length === 0 && folderCount === 0 ? (
        <p style={{ color: "var(--ink-soft)", textAlign: "center", margin: "2.5rem 0" }}>
          {hitIds
            ? // Inside a folder the tabs are gone, so there is no category to be talking about.
              // OUTSIDE one the wording stays BYTE-IDENTICAL to pre-15.3-07 — "a tenant with no
              // folders sees a vault page identical to today's" includes the words.
              folders === undefined
              ? "No matches here."
              : "No matches in this category."
            : folders === undefined
              ? "This folder is empty."
              : "No documents yet — upload a file or paste a Brain Dump."}
        </p>
      ) : (
        <div
          style={
            view === "grid"
              ? {
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
                  gap: "1rem",
                  marginTop: "1rem",
                }
              : { display: "grid", gap: "0.5rem", marginTop: "1rem" }
          }
        >
          {/* FOLDER CARDS — the SAME card unit, in the SAME grid container, with FolderIcon in
              place of FileTextIcon. Not a FolderGrid and not a grid-CSS change: a folder is a
              thing in the vault, so it sits in the vault's grid.

              NO `href` and NO enabled Discuss ANYWHERE on this branch. A folder is not a grounded
              document — its digest is; drill in and discuss a document. While the folder is still
              being read the card carries the REAL disabled wait control instead (same pattern as
              the doc cards below), never a link the reader can tab to and get nothing from. */}
          {folders?.map((f) => {
            const chip = folderChip(f);
            const sealed = f.status === "reserving" || f.status === "ingesting";
            return (
              <div key={f._id} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => onOpenFolder?.(f._id)}
                  className="clay-card"
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    textAlign: "left",
                    width: "100%",
                    height: view === "grid" ? "100%" : undefined,
                    padding: "1rem",
                    // In list view the pill row sits vertically centred at the right — reserve room.
                    paddingRight: view === "list" && sealed ? "11rem" : "1rem",
                    borderRadius: "0.85rem",
                    cursor: onOpenFolder ? "pointer" : "default",
                    flexDirection: view === "grid" ? "column" : "row",
                    alignItems: view === "grid" ? "flex-start" : "center",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="clay-badge"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "2.5rem",
                      height: "2.5rem",
                      borderRadius: "0.6rem",
                      background: "color-mix(in srgb, var(--teal-400) 30%, var(--card))",
                      color: "var(--teal-600)",
                      flex: "none",
                    }}
                  >
                    <FolderIcon />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, maxWidth: "100%" }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: 600,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={f.name}
                    >
                      {f.name}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                      {f.source === "drive" ? "Google Drive folder" : "Uploaded folder"}
                    </span>
                  </span>
                  <span style={{ display: "inline-flex", gap: "0.35rem", flex: "none" }}>
                    <StatusChip status={chip.status} label={chip.label} />
                  </span>
                </button>
                {sealed && (
                  // A ROW, because unlike a document card these two controls coexist: a folder
                  // being read is both cancellable and not yet discussable.
                  <span
                    style={{ ...pillAnchor(view), display: "inline-flex", gap: "0.35rem" }}
                  >
                    <button
                      type="button"
                      onClick={() => void runCancel(f)}
                      disabled={cancellingId !== null}
                      aria-label={`Cancel folder upload: ${f.name}`}
                      style={{
                        ...pillShape,
                        cursor: cancellingId ? "default" : "pointer",
                        background: "var(--teal-600)",
                        color: "#fff",
                        opacity: cancellingId === f._id ? 0.6 : 1,
                      }}
                    >
                      Cancel
                    </button>
                    {/* A REAL disabled button — never a Link with pointer-events:none, which a
                        screen reader reads as an actionable link that does nothing. */}
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title="Still reading this folder — its documents become available as they finish"
                      aria-label={`Still reading ${f.name} — ${f.terminalCount} of ${f.memberCount} documents read`}
                      style={{
                        ...pillShape,
                        background: "var(--rule)",
                        color: "var(--ink-soft)",
                        cursor: "default",
                      }}
                    >
                      Reading…
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          {rows.map((doc) => (
            // A relative wrapper so the failed-card Retry is a SIBLING button (never nested
            // inside the card button — invalid HTML + broken keyboard order), absolutely
            // positioned over the card's free corner.
            <div key={doc._id} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => onOpen?.(doc)}
                className="clay-card"
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  textAlign: "left",
                  width: "100%",
                  height: view === "grid" ? "100%" : undefined,
                  padding: "1rem",
                  // In list view the Retry sits vertically centered at the right — reserve room.
                  paddingRight: view === "list" && doc.status === "failed" ? "5rem" : "1rem",
                  borderRadius: "0.85rem",
                  cursor: onOpen ? "pointer" : "default",
                  flexDirection: view === "grid" ? "column" : "row",
                  alignItems: view === "grid" ? "flex-start" : "center",
                }}
              >
                <span
                  aria-hidden="true"
                  className="clay-badge"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "2.5rem",
                    height: "2.5rem",
                    borderRadius: "0.6rem",
                    background: "color-mix(in srgb, var(--teal-400) 30%, var(--card))",
                    color: "var(--teal-600)",
                    flex: "none",
                  }}
                >
                  <FileTextIcon />
                </span>
                {/* maxWidth caps the cross-axis shrink-to-fit in grid (column) view — without it a
                  nowrap title sizes this span to the full filename width and paints past the card. */}
                <span style={{ flex: 1, minWidth: 0, maxWidth: "100%" }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 600,
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={doc.title}
                  >
                    {docLabel(doc)}
                  </span>
                  {/* The filename joins the secondary line ONLY when the identity line displaced it
                      above — otherwise this would read "invoice.pdf · invoice.pdf · 12 KB". Same
                      ellipsis treatment as the primary: this line now carries a filename, and a long
                      one would paint past the card without it. */}
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.8rem",
                      color: "var(--ink-soft)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {doc.identityLine ? `${doc.title} · ${fmtSize(doc.size)}` : fmtSize(doc.size)}
                  </span>
                  {/* What happened, in the user's words — the same failureCopy map PreviewModal
                      renders, so the card and the panel can never disagree. The raw reason code is
                      never shown (§4: it is a refs-only label); it rides in `title=` only.
                      Rendered as card TEXT rather than an aria-label on purpose: an aria-label on
                      the card button would REPLACE its whole accessible name and take the filename
                      with it. As text content a screen reader reads it in full even though the
                      visual line is ellipsis-truncated to keep the card one line taller, not two. */}
                  {doc.status === "failed" && (
                    <span
                      title={failureCopy(doc.failureReason).title}
                      style={{
                        display: "block",
                        marginTop: "0.15rem",
                        maxWidth: "100%",
                        fontSize: "0.75rem",
                        color: "var(--ink-soft)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {failureCopy(doc.failureReason).title}
                    </span>
                  )}
                </span>
                <span style={{ display: "inline-flex", gap: "0.35rem", flex: "none" }}>
                  {doc.docType !== undefined && doc.docType !== "unclassified" && (
                    <DocTypeChip docType={doc.docType} />
                  )}
                  {doc.origin !== undefined && <OriginChip />}
                  <StatusChip status={doc.status} />
                </span>
              </button>
              {/* "Discuss by voice" (DOCV-01). A SIBLING of the card button, never nested inside it —
                  the card itself is a <button>, so a nested link/button is invalid HTML and wrecks
                  keyboard order. Same absolute-positioning trick the failed-card Retry already uses,
                  and the two can share the corner because their statuses are mutually exclusive
                  (failed ⇒ no discuss; ready/processing ⇒ no retry).

                  THE GATE IS SUBSCRIPTION-DRIVEN. `listVaultDocs` is a live Convex query returning
                  whole rows, so when extraction finishes and `status` flips to "ready" this control
                  re-renders enabled ON ITS OWN. Do NOT add a poll, a timer, or a second query to
                  "make it update" — it already does. */}
              {doc.status === "ready" && (
                <Link
                  href={`/dashboard/voice?doc=${doc._id}`}
                  aria-label={`Discuss by voice: ${docLabel(doc)}`}
                  style={{ ...discussPillStyle(view), background: "var(--teal-600)", color: "#fff" }}
                >
                  Discuss
                </Link>
              )}
              {(doc.status === "processing" ||
                doc.status === "extracting" ||
                doc.status === "pending_extraction") && (
                // A REAL disabled button, not a Link with pointer-events:none — the latter is
                // invisible to a screen reader, which would read an actionable link that does
                // nothing. Never open a grounded conversation the agent cannot ground yet, and never
                // burn capped 15-minute session time on a document still being read.
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Still reading your document — this becomes available when it's ready"
                  aria-label={`Still reading ${docLabel(doc)} — voice discussion not ready yet`}
                  style={{
                    ...discussPillStyle(view),
                    background: "var(--rule)",
                    color: "var(--ink-soft)",
                    cursor: "default",
                  }}
                >
                  Reading…
                </button>
              )}
              {doc.status === "failed" && (
                <button
                  type="button"
                  onClick={() => void runRetry(doc)}
                  disabled={retryingId !== null}
                  aria-label={`Retry extraction: ${docLabel(doc)}`}
                  style={{
                    position: "absolute",
                    right: "0.85rem",
                    ...(view === "grid"
                      ? { bottom: "0.85rem" }
                      : { top: "50%", transform: "translateY(-50%)" }),
                    padding: "0.2rem 0.7rem",
                    borderRadius: "999px",
                    border: "none",
                    cursor: retryingId ? "default" : "pointer",
                    background: "var(--teal-600)",
                    color: "#fff",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    opacity: retryingId === doc._id ? 0.6 : 1,
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
