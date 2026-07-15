"use client";

import type { ComponentType } from "react";
import {
  FileDocIcon,
  FolderIcon,
  ImageIcon,
  PuzzleIcon,
  UploadCloudIcon,
  VideoIcon,
} from "./icons";

// The 6 vault category tabs in the exact screenshot order (brand-024258). The `category` values
// are the @pikar/vault VaultCategory strings (categoryFor) — kept local (a UI concern) so the web
// app takes no new package dep (ponytail). The active tab is a --teal-600 pill with white text;
// inactive tabs are --ink-soft icon+label with no fill. The active category is lifted to the page.
type Tab = { label: string; category: string; Icon: ComponentType<{ size?: number }> };

export const VAULT_TABS: readonly Tab[] = [
  { label: "My Uploads", category: "my-uploads", Icon: UploadCloudIcon },
  { label: "Workspace Docs", category: "workspace-docs", Icon: FolderIcon },
  { label: "Images", category: "images", Icon: ImageIcon },
  { label: "Videos", category: "videos", Icon: VideoIcon },
  { label: "Google Docs", category: "google-docs", Icon: FileDocIcon },
  { label: "Brain Dumps", category: "brain-dumps", Icon: PuzzleIcon },
];

export function CategoryTabs({
  active,
  onChange,
}: {
  active: string;
  onChange: (category: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Vault categories"
      className="clay-card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.4rem",
        padding: "0.4rem",
        borderRadius: "1rem",
      }}
    >
      {VAULT_TABS.map(({ label, category, Icon }) => {
        const on = active === category;
        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(category)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.6rem 1.1rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              fontSize: "0.95rem",
              fontWeight: on ? 700 : 500,
              background: on ? "var(--teal-600)" : "transparent",
              color: on ? "#fff" : "var(--ink-soft)",
            }}
          >
            <Icon size={18} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
