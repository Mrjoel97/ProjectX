"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { Component, type ErrorInfo, type ReactNode, useRef, useState } from "react";
import { CategoryTabs } from "./CategoryTabs";
import { DocGrid, type VaultDoc, type VaultFolder } from "./DocGrid";
import { DriveBrowser } from "./DriveBrowser";
import { Dropzone, type PickedFolder } from "./Dropzone";
import { FolderBreadcrumb } from "./FolderBreadcrumb";
import { RefreshIcon } from "./icons";
import { PreFlight, type StartPhase } from "./PreFlight";
import { PreviewModal } from "./PreviewModal";
import { VaultBrowseControls } from "./VaultBrowseControls";
import { VaultStats } from "./VaultStats";
import { deriveVaultViewState } from "./vaultViewState";

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

  return (
    <div className="vault-surface vault-nord-edge">
      <div className="vault-scroll">
        <VaultErrorBoundary key={nonce} onRetry={() => setNonce((n) => n + 1)}>
          <VaultBody
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
        </VaultErrorBoundary>
      </div>
    </div>
  );
}

class VaultErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Vault browse query failed", {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const viewState = deriveVaultViewState({
      scope: "root",
      list: { kind: "error", message: "Your vault could not be loaded." },
      search: { kind: "idle" },
    });
    if (viewState.content.kind !== "list-error") return null;

    return (
      <section className="vault-state vault-state-error" role="alert">
        <p className="caps-label">Vault unavailable</p>
        <h2>We couldn&rsquo;t load your documents.</h2>
        <p>{viewState.content.message} Nothing has been removed.</p>
        <button
          type="button"
          className="vault-button vault-button-primary"
          onClick={this.props.onRetry}
        >
          Try again
        </button>
      </section>
    );
  }
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
  const uploadSourceRef = useRef<HTMLDivElement>(null);
  const driveSourceRef = useRef<HTMLDivElement>(null);

  // The selected doc opens the in-place preview modal (Task 3) — not a route change.
  const [selected, setSelected] = useState<VaultDoc | null>(null);
  // Resolve the LIVE row for the modal (the click captures a snapshot; a panel Retry must show
  // the status/failureReason flip reactively). A row that vanishes unmounts the modal.
  const liveSelected = selected ? (docs?.find((d) => d._id === selected._id) ?? null) : null;

  return (
    <>
      <header className="vault-header">
        <div>
          <p className="caps-label">Grounding for every agent</p>
          <h1>Knowledge Vault</h1>
          <p className="vault-header-copy">
            Keep the source material your team can search, cite, and act on.
          </p>
        </div>
        <div className="vault-header-actions">
          {loading && <span className="vault-status-pill">Loading</span>}
          <VaultBrowseControls
            visible={!currentFolderId && !picked}
            disabled={phase.kind === "uploading"}
            handlers={{
              onUpload: () =>
                uploadSourceRef.current?.querySelector<HTMLButtonElement>("button")?.click(),
              onFolderUpload: () =>
                uploadSourceRef.current
                  ?.querySelector<HTMLInputElement>("input[webkitdirectory]")
                  ?.click(),
              onDriveImport: () => {
                driveSourceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                driveSourceRef.current?.focus({ preventScroll: true });
              },
            }}
          />
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
            className="vault-button vault-button-primary"
          >
            <RefreshIcon />
            Refresh
          </button>
        </div>
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
            <div id="vault-upload-source" ref={uploadSourceRef}>
              <span id="vault-folder-source" />
              <Dropzone onPickFolder={onPicked} />
            </div>
            <div id="vault-drive-source" ref={driveSourceRef} tabIndex={-1}>
              <DriveBrowser />
            </div>
          </>
        ))}

      {/* PRESENCE IS THE SCOPE SIGNAL: an array (possibly empty) at the top level, `undefined`
          inside a folder — which is what makes DocGrid's zero state say "This folder is empty."
          `folders ?? []` so a still-loading folder list never reads as "in a folder". */}
      <DocGrid
        docs={docs ?? []}
        category={category}
        folderId={currentFolderId ?? undefined}
        loading={docs === undefined}
        totalCount={stats?.totalFiles ?? 0}
        folders={currentFolderId ? undefined : (folders ?? [])}
        onOpen={setSelected}
        onOpenFolder={onFolder}
      />

      {liveSelected && <PreviewModal doc={liveSelected} onClose={() => setSelected(null)} />}
    </>
  );
}
