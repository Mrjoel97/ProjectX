"use client";

import type { api } from "@pikar/backend/api";
import type { FunctionReturnType } from "convex/server";
import { FileTextIcon, FolderIcon, HardDriveIcon, LayersIcon } from "./icons";

// The 4 browse stat tiles (brand-024258): UPPERCASE label + big bold value + a rounded-square
// icon badge (teal / green / blue / purple). `stats` is undefined during the initial load — the
// page shows the "Loading" pill for that; here we render honest zeros so the layout never jumps
// (0 files / 0 MB match the empty-vault screenshots exactly).
type Stats = FunctionReturnType<typeof api.vault.vaultStats>;

const TILES = [
  { key: "totalFiles", label: "TOTAL FILES", accent: "neutral", Icon: FileTextIcon },
  { key: "processed", label: "PROCESSED", accent: "ready", Icon: LayersIcon },
  { key: "storageUsed", label: "STORAGE USED", accent: "storage", Icon: HardDriveIcon },
  { key: "categories", label: "CATEGORIES", accent: "structure", Icon: FolderIcon },
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
      <div className="vault-stats">
        {TILES.map(({ key, label, accent, Icon }) => (
          <div
            key={key}
            className="vault-stat-card"
          >
            <div>
              <div className="vault-stat-label">{label}</div>
              <div className="vault-stat-value">{valueFor(key, stats)}</div>
            </div>
            <span
              aria-hidden="true"
              className={`vault-stat-badge is-${accent}`}
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
        <p className="vault-bounded-copy">
          Showing your newest documents — this vault holds more than one page.
        </p>
      )}
    </>
  );
}
