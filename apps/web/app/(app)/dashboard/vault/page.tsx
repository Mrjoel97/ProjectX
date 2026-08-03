"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { CategoryTabs } from "./CategoryTabs";
import { DocGrid, type VaultDoc, type VaultFolder } from "./DocGrid";
import { DriveBrowser } from "./DriveBrowser";
import { Dropzone, type PickedFolder } from "./Dropzone";
import { FolderBreadcrumb } from "./FolderBreadcrumb";
import { RefreshIcon } from "./icons";
import { PreFlight, type StartPhase } from "./PreFlight";
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
//
// EVERYTHING THAT MUST SURVIVE REFRESH LIVES HERE, for that same reason: `key={nonce}` (:41) does
// not re-render <VaultBody>, it DESTROYS it, and every `useState` it owns with it. So the drill-in
// scope, the picked directory and the Start phase are all atoms of this component:
//   - `currentFolderId` — otherwise Refresh silently teleports the user back to the flat grid.
//   - `picked` — File handles cannot be re-derived; a remount would force a re-pick of a 1.5 GB tree.
//   - `phase` — a reserve refusal (or an in-flight upload) must not be wiped, or the user presses
//     Start again and re-uploads the whole folder into a second one while the first sits `refused`.
// `selected` deliberately stays in VaultBody: it is a snapshot one click away from being re-opened.

export default function VaultPage() {
  const [category, setCategory] = useState<string>("my-uploads");
  const [nonce, setNonce] = useState(0);
  const [currentFolderId, setCurrentFolderId] = useState<VaultFolder["_id"] | null>(null);
  const [picked, setPicked] = useState<PickedFolder | null>(null);
  const [phase, setPhase] = useState<StartPhase>({ kind: "idle" });

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
          currentFolderId={currentFolderId}
          onFolder={setCurrentFolderId}
          picked={picked}
          onPicked={setPicked}
          phase={phase}
          onPhase={setPhase}
        />
      </div>
    </div>
  );
}

function VaultBody({
  category,
  onCategory,
  onRefresh,
  currentFolderId,
  onFolder,
  picked,
  onPicked,
  phase,
  onPhase,
}: {
  category: string;
  onCategory: (c: string) => void;
  onRefresh: () => void;
  currentFolderId: VaultFolder["_id"] | null;
  onFolder: (id: VaultFolder["_id"] | null) => void;
  picked: PickedFolder | null;
  onPicked: (p: PickedFolder | null) => void;
  phase: StartPhase;
  onPhase: (p: StartPhase) => void;
}) {
  const stats = useQuery(api.vault.vaultStats);
  // Inside a folder the scope IS the folder — a folder is provenance, not a category, so the two
  // filters are never combined.
  const docs = useQuery(
    api.vault.listVaultDocs,
    currentFolderId ? { folderId: currentFolderId } : { category },
  );
  const folders = useQuery(api.vaultFolders.listFolders, currentFolderId ? "skip" : {});
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
        {/* Belt AND braces with lifting `phase`: the upload loop RUNS inside PreFlight, which is
            inside VaultBody, so a remount mid-loop orphans it (setState on an unmounted tree, a
            half-created folder). Disabling the only remount trigger is the guard that makes that
            impossible — and Refresh is meaningless mid-upload anyway, since every vault query is
            already live (BRAND §1: say why, honestly). */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={phase.kind === "uploading"}
          title={phase.kind === "uploading" ? "Finishing your folder upload…" : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.7rem 1.4rem",
            borderRadius: "999px",
            border: "none",
            cursor: phase.kind === "uploading" ? "default" : "pointer",
            background: "var(--teal-600)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.95rem",
            opacity: phase.kind === "uploading" ? 0.5 : 1,
          }}
        >
          <RefreshIcon />
          Refresh
        </button>
      </header>

      <VaultStats stats={stats} />

      {/* ONE TERNARY. Inside a folder the breadcrumb REPLACES the tabs — a folder is a provenance
          scope, not a category, and leaving the tabs live lets a user select "Videos" inside a
          folder with none and read an unexplained empty grid. */}
      {currentFolderId ? (
        <FolderBreadcrumb folderId={currentFolderId} onExit={() => onFolder(null)} />
      ) : (
        <CategoryTabs active={category} onChange={onCategory} />
      )}

      {/* No upload slot inside a folder: a sealed folder takes no new members (vault.ts:205-211),
          so offering one would promise what the server refuses. */}
      {!currentFolderId &&
        (picked ? (
          <PreFlight
            picked={picked}
            phase={phase}
            onPhase={onPhase}
            onClear={() => {
              onPicked(null);
              onPhase({ kind: "idle" });
            }}
          />
        ) : (
          <>
            <Dropzone onPickFolder={onPicked} />
            <DriveBrowser />
          </>
        ))}

      {/* PRESENCE IS THE SCOPE SIGNAL: an array (possibly empty) at the top level, `undefined`
          inside a folder — which is what makes DocGrid's zero state say "This folder is empty."
          `folders ?? []` so a still-loading folder list never reads as "in a folder". */}
      <DocGrid
        docs={docs ?? []}
        category={category}
        folders={currentFolderId ? undefined : (folders ?? [])}
        onOpen={setSelected}
        onOpenFolder={onFolder}
      />

      {liveSelected && <PreviewModal doc={liveSelected} onClose={() => setSelected(null)} />}
    </>
  );
}
