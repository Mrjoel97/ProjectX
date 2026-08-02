"use client";

import type { api } from "@pikar/backend/api";
import type { FunctionReturnType } from "convex/server";
import { FileTextIcon, FolderIcon, HardDriveIcon, LayersIcon } from "./icons";

// The 4 browse stat tiles (brand-024258): UPPERCASE label + big bold value + a rounded-square
// icon badge (teal / green / blue / purple). `stats` is undefined during the initial load — the
// page shows the "Loading" pill for that; here we render honest zeros so the layout never jumps
// (0 files / 0 MB match the empty-vault screenshots exactly).
type Stats = FunctionReturnType<typeof api.vault.vaultStats>;

// Decorative accent fills for the badges. teal is a real token (--teal-400); green/blue/purple
// have NO globals.css token that covers them (they are one-off stat-badge accents, BRAND §2
// "icon badges … teal, cyan, green"), so they are literals here — not a hex a token covers (§10).
const TILES = [
  { key: "totalFiles", label: "TOTAL FILES", badge: "var(--teal-400)", Icon: FileTextIcon },
  { key: "processed", label: "PROCESSED", badge: "#22c55e", Icon: LayersIcon },
  { key: "storageUsed", label: "STORAGE USED", badge: "#3b82f6", Icon: HardDriveIcon },
  { key: "categories", label: "CATEGORIES", badge: "#a855f7", Icon: FolderIcon },
] as const;

const MB = 1024 * 1024;

// `capped` means the read stopped at its bound (15.3-02: a vault read is bounded by rows AND by
// bytes, because a row carries the document's whole text). The three counted tiles then describe
// the newest window, not the whole vault — so they say "200+", never a confidently wrong exact
// number. CATEGORIES is the fixed 6 and is never capped.
function valueFor(key: (typeof TILES)[number]["key"], stats: Stats | undefined): string {
  if (!stats) return key === "storageUsed" ? "0 MB" : "0";
  const more = stats.capped ? "+" : "";
  switch (key) {
    case "totalFiles":
      return `${stats.totalFiles}${more}`;
    case "processed":
      return `${stats.processed}${more}`;
    case "storageUsed":
      return `${Math.round(stats.storageUsedBytes / MB)}${more} MB`;
    case "categories":
      return String(stats.categories);
  }
}

export function VaultStats({ stats }: { stats: Stats | undefined }) {
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "1.25rem",
          margin: "1.5rem 0",
        }}
      >
        {TILES.map(({ key, label, badge, Icon }) => (
          <div
            key={key}
            className="clay-card"
            style={{
              borderRadius: "1rem",
              padding: "1.25rem 1.5rem",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "var(--ink-soft)",
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: "2rem",
                  fontWeight: 800,
                  color: "var(--ink)",
                  marginTop: "0.5rem",
                }}
              >
                {valueFor(key, stats)}
              </div>
            </div>
            <span
              aria-hidden="true"
              className="clay-badge"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2.75rem",
                height: "2.75rem",
                borderRadius: "0.85rem",
                background: badge,
                color: "#fff",
                flex: "none",
              }}
            >
              <Icon />
            </span>
          </div>
        ))}
      </div>
      {/* Say it once, in words, rather than leaving the user to decode a "+" (BRAND §1: honest
          about limits; §6: never encode meaning in a glyph alone). No number is named because the
          window is bounded by BYTES as well as rows — a vault of very large documents shows fewer. */}
      {stats?.capped && (
        <p style={{ margin: "-0.75rem 0 1.5rem", fontSize: "0.85rem", color: "var(--ink-soft)" }}>
          Showing your newest documents — this vault holds more than one page.
        </p>
      )}
    </>
  );
}
