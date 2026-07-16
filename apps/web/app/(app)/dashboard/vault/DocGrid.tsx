"use client";

import { api } from "@pikar/backend/api";
import type { FunctionReturnType } from "convex/server";
import { useAction } from "convex/react";
import { useMemo, useState } from "react";
import { FileTextIcon, GridIcon, ListIcon, SearchIcon } from "./icons";

// The browse grid (brand-024242 / brand-024258): a search bar, the N ITEMS count, a grid/list
// toggle, and the doc cards/rows off the reactive listVaultDocs. Search runs vault.vaultSearch
// (the hybrid rag primitive, category-scoped) and filters the metadata rows to its hits — so a
// result card still shows the full status/size. Per-item status badges reflect the row
// (processing / ready / pending_extraction / failed). Clicking a card opens the preview (Task 3).

export type VaultDoc = FunctionReturnType<typeof api.vault.listVaultDocs>[number];

// status → badge palette (mirrors the cockpit cards idiom; no token covers these small semantic
// chips, so the literals stand — not a hex a token covers).
function statusBadge(status: string): { bg: string; fg: string; label: string } {
  switch (status) {
    case "ready":
      return { bg: "#dcfce7", fg: "#166534", label: "ready" };
    case "processing":
      return { bg: "#fef3c7", fg: "#92400e", label: "processing" };
    case "pending_extraction":
      return { bg: "#f1f5f9", fg: "#334155", label: "pending" };
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
  const [query, setQuery] = useState("");
  const [hitIds, setHitIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [searching, setSearching] = useState(false);

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
        {searching && <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>Searching…</span>}
        <span style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.1em", color: "var(--ink-soft)" }}>
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
          {hitIds ? "No matches in this category." : "No documents yet — upload a file or paste a Brain Dump."}
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
            <button
              key={doc._id}
              type="button"
              onClick={() => onOpen?.(doc)}
              className="clay-card"
              style={{
                display: "flex",
                gap: "0.75rem",
                textAlign: "left",
                width: "100%",
                padding: "1rem",
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
                <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>{fmtSize(doc.size)}</span>
              </span>
              <StatusChip status={doc.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
