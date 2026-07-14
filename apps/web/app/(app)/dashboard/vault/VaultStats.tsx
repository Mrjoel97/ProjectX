"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "@pikar/backend/api";
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

function valueFor(key: (typeof TILES)[number]["key"], stats: Stats | undefined): string {
  if (!stats) return key === "storageUsed" ? "0 MB" : "0";
  switch (key) {
    case "totalFiles":
      return String(stats.totalFiles);
    case "processed":
      return String(stats.processed);
    case "storageUsed":
      return `${Math.round(stats.storageUsedBytes / MB)} MB`;
    case "categories":
      return String(stats.categories);
  }
}

export function VaultStats({ stats }: { stats: Stats | undefined }) {
  return (
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
          style={{
            background: "var(--card)",
            border: "1px solid var(--rule)",
            borderRadius: "1rem",
            padding: "1.25rem 1.5rem",
            boxShadow: "0 6px 20px -14px rgb(14 20 25 / 25%)",
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
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--ink)", marginTop: "0.5rem" }}>
              {valueFor(key, stats)}
            </div>
          </div>
          <span
            aria-hidden="true"
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
  );
}
