"use client";

import { api } from "@pikar/backend/api";
import { DOC_TYPE_LABEL, type DocType } from "@pikar/core";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { failureCopy } from "./failureCopy";
import { FileTextIcon, FolderIcon, GridIcon, ListIcon, SearchIcon } from "./icons";
import { FolderOpenControl } from "./VaultBrowseControls";
import {
  deriveVaultViewState,
  type VaultContentState,
  type VaultSearchState,
} from "./vaultViewState";

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
type MoveDocId = FunctionArgs<typeof api.vaultFolders.moveDocuments>["docIds"][number];
type MoveFolderId = FunctionArgs<typeof api.vaultFolders.moveDocuments>["folderId"];

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

function VaultContentNotice({
  state,
  onClearSearch,
  onRetrySearch,
}: {
  state: VaultContentState;
  onClearSearch: () => void;
  onRetrySearch: () => void;
}) {
  switch (state.kind) {
    case "ready":
      return null;
    case "initial-loading":
      return (
        <section className="vault-state" aria-live="polite">
          <p className="caps-label">Loading vault</p>
          <h2>Gathering your documents…</h2>
        </section>
      );
    case "list-error":
      return (
        <section className="vault-state vault-state-error" role="alert">
          <p className="caps-label">Vault unavailable</p>
          <h2>We couldn&rsquo;t load your documents.</h2>
          <p>{state.message}</p>
        </section>
      );
    case "search-loading":
      return (
        <section className="vault-state vault-state-compact" aria-live="polite">
          Searching for &ldquo;{state.query}&rdquo;…
        </section>
      );
    case "search-error":
      return (
        <section className="vault-state vault-state-error vault-state-compact" role="alert">
          <div>
            <strong>Search didn&rsquo;t finish.</strong>
            <p>{state.message}</p>
          </div>
          <div className="vault-state-actions">
            <button
              type="button"
              className="vault-button vault-button-primary"
              onClick={onRetrySearch}
            >
              Try again
            </button>
            <button type="button" className="vault-button" onClick={onClearSearch}>
              Clear search
            </button>
          </div>
        </section>
      );
    case "root-empty":
      return (
        <section className="vault-state">
          <p className="caps-label">Your source library</p>
          <h2>No documents yet.</h2>
          <p>
            Upload a file, choose a folder, or import from Drive to give your agents grounded
            context.
          </p>
        </section>
      );
    case "category-empty":
      return (
        <section className="vault-state">
          <p className="caps-label">Category empty</p>
          <h2>No documents in this category.</h2>
          <p>Choose another category or add a source from the actions above.</p>
        </section>
      );
    case "folder-empty":
      return (
        <section className="vault-state">
          <p className="caps-label">Folder empty</p>
          <h2>This folder has no documents.</h2>
          <p>Return to all documents to choose another folder or add a new source.</p>
        </section>
      );
    case "no-results":
      return (
        <section className="vault-state vault-state-compact" aria-live="polite">
          <div>
            <strong>No documents match &ldquo;{state.query}&rdquo;.</strong>
            <p>Folders are not searched. Open one to search inside it.</p>
          </div>
          <button type="button" className="vault-button" onClick={onClearSearch}>
            Clear search
          </button>
        </section>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function DocGrid({
  docs,
  category,
  folderId,
  loading = false,
  totalCount,
  folders,
  moveTargets = [],
  onOpen,
  onOpenFolder,
}: {
  docs: VaultDoc[];
  category: string;
  folderId?: VaultFolder["_id"];
  loading?: boolean;
  /** Bounded root count. It distinguishes an empty category from a truly empty Vault; it is never
   *  displayed as an exact category count. */
  totalCount: number;
  /** PRESENCE IS THE SCOPE SIGNAL: an array (possibly empty) at the top level, OMITTED inside a
   *  folder — a folder holds documents, not folders. That is what lets the empty state say "This
   *  folder is empty." with no extra prop. */
  folders?: VaultFolder[];
  /** All organizational folders, including while drilled into one. `folders` above remains the
   * root-card presence signal; this separate list powers the move destination selector. */
  moveTargets?: VaultFolder[];
  onOpen?: (doc: VaultDoc) => void;
  onOpenFolder?: (folderId: VaultFolder["_id"]) => void;
}) {
  const search = useAction(api.vault.vaultSearch);
  const retry = useMutation(api.vaultSweep.retryExtraction);
  const cancelFolder = useMutation(api.vaultFolders.cancelFolder);
  const createOrganizationalFolder = useMutation(api.vaultFolders.createOrganizationalFolder);
  const moveDocuments = useMutation(api.vaultFolders.moveDocuments);
  const [query, setQuery] = useState("");
  const [hitIds, setHitIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [searchState, setSearchState] = useState<VaultSearchState>({ kind: "idle" });
  const searchSequence = useRef(0);
  const activeSearchIdentity = useRef<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Deliberately NOT retryingId: that is a GLOBAL one-at-a-time lock, so sharing it would
  // cross-disable every failed document's Retry while a folder cancel is in flight.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // Two-click delete for a filing folder: the first click ARMS, the second removes. No native
  // confirm() (it blocks the tab and cannot be styled or read by the same a11y path as the rest of
  // this grid), and no modal for a two-word decision that removes no documents.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [folderName, setFolderName] = useState("");
  const [destination, setDestination] = useState<string>("");
  const [organizing, setOrganizing] = useState<"create" | "move" | null>(null);
  const [organizeNotice, setOrganizeNotice] = useState<string | null>(null);
  const folderCount = folders?.length ?? 0;
  const organizationalFolders = moveTargets.filter((folder) => folder.organizational === true);
  const organizationalIds = new Set(organizationalFolders.map((folder) => String(folder._id)));
  const scopeIdentity = `${category}:${folderId ?? "root"}`;

  // Folder/category changes invalidate both the result set and every response still in flight.
  // The identity carries folderId explicitly so a response from folder A cannot paint folder B.
  useEffect(() => {
    void scopeIdentity;
    searchSequence.current += 1;
    activeSearchIdentity.current = null;
    setQuery("");
    setHitIds(null);
    setSearchState({ kind: "idle" });
    setSelectionMode(false);
    setSelectedIds(new Set());
    setOrganizeNotice(null);
  }, [scopeIdentity]);

  const canSelectDoc = (doc: VaultDoc): boolean =>
    !doc.folderId || organizationalIds.has(String(doc.folderId));

  function toggleSelected(doc: VaultDoc) {
    if (!canSelectDoc(doc)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(doc._id)) next.delete(doc._id);
      else next.add(doc._id);
      return next;
    });
  }

  async function createFilingFolder() {
    const name = folderName.trim();
    if (!name) return;
    setOrganizing("create");
    setOrganizeNotice(null);
    try {
      const result = await createOrganizationalFolder({ name });
      setFolderName("");
      setDestination(String(result.folderId));
      setOrganizeNotice(`Created ${name}.`);
    } catch {
      setOrganizeNotice("The folder could not be created. Nothing changed.");
    } finally {
      setOrganizing(null);
    }
  }

  async function moveSelected() {
    if (!destination || selectedIds.size === 0) return;
    setOrganizing("move");
    setOrganizeNotice(null);
    try {
      const ids = [...selectedIds] as MoveDocId[];
      let moved = 0;
      let skipped = 0;
      for (let i = 0; i < ids.length; i += 25) {
        const result = await moveDocuments({
          folderId: destination as MoveFolderId,
          docIds: ids.slice(i, i + 25),
        });
        moved += result.moved;
        skipped += result.skipped;
      }
      setSelectedIds(new Set());
      setSelectionMode(false);
      setOrganizeNotice(
        skipped > 0
          ? `Moved ${moved} file${moved === 1 ? "" : "s"}; ${skipped} stayed in their upload folder.`
          : `Moved ${moved} file${moved === 1 ? "" : "s"}.`,
      );
    } catch {
      setOrganizeNotice("The selected files could not be moved. Nothing was removed.");
    } finally {
      setOrganizing(null);
    }
  }

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
      searchSequence.current += 1;
      activeSearchIdentity.current = null;
      setHitIds(null);
      setSearchState({ kind: "idle" });
      return;
    }
    const sequence = ++searchSequence.current;
    const identity = `${folderId ?? "root"}\u0000${folderId ? "all" : category}\u0000${q}`;
    activeSearchIdentity.current = identity;
    setSearchState({ kind: "loading", query: q });
    try {
      // A folder is provenance, not a category. Root keeps the selected category; folder browse
      // sends folderId and searches every member category, matching the list directly beneath it.
      const results = await search(folderId ? { query: q, folderId } : { query: q, category });
      if (searchSequence.current !== sequence || activeSearchIdentity.current !== identity) return;
      setHitIds(new Set(results.map((r) => r._id)));
      setSearchState({ kind: "complete", query: q, resultCount: results.length });
    } catch {
      if (searchSequence.current !== sequence || activeSearchIdentity.current !== identity) return;
      setHitIds(null);
      setSearchState({
        kind: "error",
        query: q,
        message: "Search is unavailable right now. Your documents are still here.",
      });
    } finally {
      if (searchSequence.current === sequence && activeSearchIdentity.current === identity) {
        activeSearchIdentity.current = null;
      }
    }
  }

  function clearSearch() {
    searchSequence.current += 1;
    activeSearchIdentity.current = null;
    setQuery("");
    setHitIds(null);
    setSearchState({ kind: "idle" });
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
  const viewState = deriveVaultViewState({
    scope: folderId ? "folder" : "root",
    list: loading
      ? { kind: "loading" }
      : {
          kind: "ready",
          visibleCount: rows.length,
          totalCount: totalCount + folderCount,
        },
    search: searchState,
    processingCount: docs.filter((doc) => doc.status !== "ready" && doc.status !== "failed").length,
    failedCount: docs.filter((doc) => doc.status === "failed").length,
  });
  const suppressGrid =
    viewState.content.kind === "initial-loading" ||
    viewState.content.kind === "list-error" ||
    viewState.content.kind === "root-empty" ||
    viewState.content.kind === "category-empty" ||
    viewState.content.kind === "folder-empty" ||
    (viewState.content.kind === "no-results" && folderCount === 0);

  return (
    <div>
      <section
        aria-label="Organize vault files"
        className="clay-card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          flexWrap: "wrap",
          padding: "0.75rem 1rem",
          marginBottom: "0.75rem",
          borderRadius: "1rem",
        }}
      >
        <input
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createFilingFolder();
          }}
          placeholder="New folder name"
          aria-label="New folder name"
          style={{
            minHeight: "2.35rem",
            flex: "1 1 12rem",
            border: "1px solid var(--rule)",
            borderRadius: "0.65rem",
            padding: "0.45rem 0.7rem",
            background: "var(--card)",
            color: "var(--ink)",
            font: "inherit",
          }}
        />
        <button
          type="button"
          className="vault-button"
          disabled={!folderName.trim() || organizing !== null}
          onClick={() => void createFilingFolder()}
        >
          {organizing === "create" ? "Creating…" : "Create folder"}
        </button>
        <button
          type="button"
          className="vault-button"
          aria-pressed={selectionMode}
          disabled={organizing !== null}
          onClick={() => {
            setSelectionMode((active) => !active);
            setSelectedIds(new Set());
          }}
        >
          {selectionMode ? "Cancel selection" : "Select files"}
        </button>
        {selectionMode && (
          <>
            <span style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
              {selectedIds.size} selected
            </span>
            <select
              aria-label="Move selected files to folder"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              style={{
                minHeight: "2.35rem",
                border: "1px solid var(--rule)",
                borderRadius: "0.65rem",
                padding: "0.4rem 0.65rem",
                background: "var(--card)",
                color: "var(--ink)",
                font: "inherit",
              }}
            >
              <option value="">Choose a folder…</option>
              {organizationalFolders
                .filter((folder) => folder._id !== folderId)
                .map((folder) => (
                  <option key={folder._id} value={folder._id}>
                    {folder.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="vault-button vault-button-primary"
              disabled={!destination || selectedIds.size === 0 || organizing !== null}
              onClick={() => void moveSelected()}
            >
              {organizing === "move" ? "Moving…" : "Move selected"}
            </button>
          </>
        )}
        {organizeNotice && (
          <span role="status" style={{ flexBasis: "100%", color: "var(--ink-soft)", fontSize: "0.82rem" }}>
            {organizeNotice}
          </span>
        )}
      </section>
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
        {searchState.kind === "loading" && (
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

      {viewState.ingest.kind === "partial" && (
        <section className="vault-state vault-state-warning vault-state-compact" role="status">
          <strong>Some sources still need attention.</strong>
          <p>
            {viewState.ingest.processingCount > 0
              ? `${viewState.ingest.processingCount} still processing. `
              : ""}
            {viewState.ingest.failedCount > 0
              ? `${viewState.ingest.failedCount} failed and can be retried below.`
              : ""}
          </p>
        </section>
      )}

      <VaultContentNotice
        state={viewState.content}
        onClearSearch={clearSearch}
        onRetrySearch={() => void runSearch()}
      />

      {!suppressGrid && (
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
                <FolderOpenControl
                  name={f.name}
                  onOpen={() => onOpenFolder?.(f._id)}
                  disabled={!onOpenFolder}
                  className="clay-card"
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    textAlign: "left",
                    width: "100%",
                    height: view === "grid" ? "100%" : undefined,
                    padding: "1rem",
                    // In list view the pill row sits vertically centred at the right — reserve room.
                    paddingRight:
                      view === "list"
                        ? sealed
                          ? "11rem"
                          : f.organizational === true
                            ? "6rem"
                            : "1rem"
                        : "1rem",
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
                      {f.organizational
                        ? "Organizational folder"
                        : f.source === "drive"
                          ? "Google Drive folder"
                          : "Uploaded folder"}
                    </span>
                  </span>
                  <span style={{ display: "inline-flex", gap: "0.35rem", flex: "none" }}>
                    <StatusChip status={chip.status} label={chip.label} />
                  </span>
                </FolderOpenControl>
                {sealed && (
                  // A ROW, because unlike a document card these two controls coexist: a folder
                  // being read is both cancellable and not yet discussable.
                  <span style={{ ...pillAnchor(view), display: "inline-flex", gap: "0.35rem" }}>
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
                {/* DELETE, for a filing folder the user made — the one folder kind that is theirs
                    to unmake. It is offered whatever the member count, because "empty" was exactly
                    the case with no control at all: `sealed` is false the instant an organizational
                    folder is born (it is `complete` from birth), so this branch was unreachable and
                    an empty folder was permanent. An upload/Drive folder keeps its cancel-only rail
                    — its counters, reservation and digest describe a batch, not a filing choice.
                    NON-DESTRUCTIVE: `cancelFolder` removes the FOLDER; its members keep a dangling
                    folderId and become ordinary documents (see vaultFolders.cancelFolder). */}
                {!sealed && f.organizational === true && (
                  <span style={{ ...pillAnchor(view), display: "inline-flex", gap: "0.35rem" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmDeleteId !== f._id) {
                          setConfirmDeleteId(f._id);
                          return;
                        }
                        setConfirmDeleteId(null);
                        void runCancel(f);
                      }}
                      onBlur={() => setConfirmDeleteId((id) => (id === f._id ? null : id))}
                      disabled={cancellingId !== null}
                      aria-label={
                        confirmDeleteId === f._id
                          ? `Confirm deleting folder ${f.name}. The ${f.memberCount} document${f.memberCount === 1 ? "" : "s"} inside stay in your vault.`
                          : `Delete folder: ${f.name}`
                      }
                      title="Deletes the folder only — any documents inside stay in your vault"
                      style={{
                        ...pillShape,
                        cursor: cancellingId ? "default" : "pointer",
                        background: confirmDeleteId === f._id ? "var(--teal-600)" : "var(--rule)",
                        color: confirmDeleteId === f._id ? "#fff" : "var(--ink)",
                        opacity: cancellingId === f._id ? 0.6 : 1,
                      }}
                    >
                      {confirmDeleteId === f._id ? "Delete?" : "Delete"}
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
              {selectionMode && canSelectDoc(doc) && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(doc._id)}
                  onChange={() => toggleSelected(doc)}
                  aria-label={`Select ${docLabel(doc)}`}
                  style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 2 }}
                />
              )}
              <button
                type="button"
                onClick={() =>
                  selectionMode && canSelectDoc(doc) ? toggleSelected(doc) : onOpen?.(doc)
                }
                aria-pressed={selectionMode && canSelectDoc(doc) ? selectedIds.has(doc._id) : undefined}
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
                  outline: selectedIds.has(doc._id) ? "2px solid var(--teal-600)" : undefined,
                  outlineOffset: selectedIds.has(doc._id) ? "2px" : undefined,
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
                  style={{
                    ...discussPillStyle(view),
                    background: "var(--teal-600)",
                    color: "#fff",
                  }}
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
