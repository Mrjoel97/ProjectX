"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { CategoryTabs } from "./CategoryTabs";
import { DocGrid, type VaultDoc } from "./DocGrid";
import { Dropzone } from "./Dropzone";
import { RefreshIcon } from "./icons";
import { PreviewModal } from "./PreviewModal";
import { VaultStats } from "./VaultStats";

// The Knowledge Vault route (VALT-04) — matches brand-024242 / brand-024258 1:1: the "Knowledge
// Vault" headline, a teal Refresh + a dark "Loading" pill while the live queries settle, the 4 stat
// tiles, and the 6 category tabs. Dropzone + search grid (Task 2) and the preview modal (Task 3)
// compose in below the tabs. Tokens only (globals.css) — no component library (§10).
//
// Refresh: Convex queries are already reactive, so there is nothing to poll — Refresh bumps a
// `nonce` used as the `key` on the query-bearing <VaultBody>, which genuinely re-subscribes (the
// data blinks through `undefined` → the Loading pill shows → refills). ponytail: a real re-fetch
// with zero extra machinery. The active tab is lifted here so a refresh never resets it.

export default function VaultPage() {
  const [category, setCategory] = useState<string>("my-uploads");
  const [nonce, setNonce] = useState(0);

  // Fused full-bleed to the shell (layout.tsx is-bleed), sharing the workspace canvas's teal
  // aura (.pane-canvas) so the vault reads as one surface with the cockpit — its stat tiles and
  // doc cards do the floating, matching the command center / workspace glass-over-clay look.
  // Owns its own scroll because is-bleed locks the outer <main>.
  return (
    <div className="vault-surface pane-canvas">
      <div className="vault-scroll">
        <VaultBody
          key={nonce}
          category={category}
          onCategory={setCategory}
          onRefresh={() => setNonce((n) => n + 1)}
        />
      </div>
    </div>
  );
}

function VaultBody({
  category,
  onCategory,
  onRefresh,
}: {
  category: string;
  onCategory: (c: string) => void;
  onRefresh: () => void;
}) {
  const stats = useQuery(api.vault.vaultStats);
  const docs = useQuery(api.vault.listVaultDocs, { category });
  const loading = stats === undefined || docs === undefined;

  // The selected doc opens the in-place preview modal (Task 3) — not a route change.
  const [selected, setSelected] = useState<VaultDoc | null>(null);
  // Resolve the LIVE row for the modal (the click captures a snapshot; a panel Retry must show
  // the status/failureReason flip reactively). A row that vanishes unmounts the modal.
  const liveSelected = selected ? (docs?.find((d) => d._id === selected._id) ?? null) : null;

  return (
    <>
      {loading && (
        <span
          style={{
            position: "absolute",
            top: "0.25rem",
            right: "0.5rem",
            padding: "0.3rem 0.9rem",
            borderRadius: "999px",
            background: "var(--ink)",
            color: "#fff",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          Loading
        </span>
      )}

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.75rem)",
            letterSpacing: "-0.03em",
            color: "var(--ink)",
          }}
        >
          Knowledge Vault
        </h1>
        <button
          type="button"
          onClick={onRefresh}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.7rem 1.4rem",
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            background: "var(--teal-600)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.95rem",
          }}
        >
          <RefreshIcon />
          Refresh
        </button>
      </header>

      <VaultStats stats={stats} />

      <CategoryTabs active={category} onChange={onCategory} />

      <Dropzone />

      <DocGrid docs={docs ?? []} category={category} onOpen={setSelected} />

      {liveSelected && <PreviewModal doc={liveSelected} onClose={() => setSelected(null)} />}
    </>
  );
}
