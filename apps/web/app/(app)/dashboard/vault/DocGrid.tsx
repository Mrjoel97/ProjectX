"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FileTextIcon, GridIcon, ListIcon, SearchIcon } from "./icons";

// The browse grid (brand-024242 / brand-024258): a search bar, the N ITEMS count, a grid/list
// toggle, and the doc cards/rows off the reactive listVaultDocs. Search runs vault.vaultSearch
// (the hybrid rag primitive, category-scoped) and filters the metadata rows to its hits — so a
// result card still shows the full status/size. Per-item status badges reflect the row
// (pending_extraction / extracting / processing / ready / failed — the Phase-3.8 walk, all
// reactive off the subscription). Failed cards carry a Retry (vaultSweep.retryExtraction).
// Clicking a card opens the preview (Task 3).

export type VaultDoc = FunctionReturnType<typeof api.vault.listVaultDocs>[number];

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

/** Shared geometry for the "Discuss by voice" pill so the enabled link and the disabled wait state
 *  occupy the identical spot — the control must not move as the status flips under the user.
 *  Mirrors the failed-card Retry placement (grid ⇒ bottom-right, list ⇒ vertically centred right). */
function discussPillStyle(view: "grid" | "list"): React.CSSProperties {
  return {
    position: "absolute",
    right: "0.85rem",
    ...(view === "grid" ? { bottom: "0.85rem" } : { top: "50%", transform: "translateY(-50%)" }),
    padding: "0.2rem 0.7rem",
    borderRadius: "999px",
    border: "none",
    fontSize: "0.72rem",
    fontWeight: 700,
    textDecoration: "none",
    lineHeight: 1.6,
  };
}

function StatusChip({ status }: { status: string }) {
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
      {b.label}
    </span>
  );
}

export function DocGrid({
  docs,
  category,
  onOpen,
}: {
  docs: VaultDoc[];
  category: string;
  onOpen?: (doc: VaultDoc) => void;
}) {
  const search = useAction(api.vault.vaultSearch);
  const retry = useMutation(api.vaultSweep.retryExtraction);
  const [query, setQuery] = useState("");
  const [hitIds, setHitIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [searching, setSearching] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

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

      {rows.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", textAlign: "center", margin: "2.5rem 0" }}>
          {hitIds
            ? "No matches in this category."
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
                    {doc.title}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                    {fmtSize(doc.size)}
                  </span>
                </span>
                <StatusChip status={doc.status} />
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
                  aria-label={`Discuss by voice: ${doc.title}`}
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
                  aria-label={`Still reading ${doc.title} — voice discussion not ready yet`}
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
                  aria-label={`Retry extraction: ${doc.title}`}
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
