"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { VaultFolder } from "./DocGrid";
import { DigestRebuildControl } from "./VaultBrowseControls";
import { deriveVaultViewState } from "./vaultViewState";

// The in-folder scope header. It REPLACES CategoryTabs while the user is inside a folder (the
// caller owns that ternary): a folder is a provenance scope, not a category, and leaving the tabs
// live lets someone select "Videos" inside a folder with none and read an unexplained empty grid.
//
// The stale-digest affordance here is the 17.1 idiom (BlueprintPanel), NOT a banner: an
// unincorporated COUNT beside the name plus the SAME Rebuild button flipping secondary→primary.
// One button, one label, one handler — only the emphasis moves. Deliberately not ReconnectBanner:
// a dismissible localStorage notice would let a user hide a digest that is genuinely out of date,
// and it spends amber, which BRAND §2 reserves for the approval gate alone. Nothing here is amber.

export function FolderBreadcrumb({
  folderId,
  onExit,
}: {
  folderId: VaultFolder["_id"];
  /** Back out to the flat grid. ALSO the cancel-recovery path — see the effect below. */
  onExit: () => void;
}) {
  const folder = useQuery(api.vaultFolders.getFolder, { folderId });
  const digest = useQuery(api.vaultDigest.folderDigestState, { folderId });
  const rebuild = useMutation(api.vaultDigest.rebuildDigest);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null);

  // `null` is the lenient join (getFolder): the folder was cancelled or deleted under us, so route
  // back rather than render a folder that no longer exists. `undefined` is still LOADING and must
  // not trigger it, or a slow first paint bounces the user straight out of the folder. No loop is
  // possible — onExit clears the caller's currentFolderId, which unmounts this component.
  useEffect(() => {
    if (folder === null) onExit();
  }, [folder, onExit]);

  if (!folder) return null;

  // Staleness is DERIVED upstream from unincorporatedCount > 0 — never a stored flag — and nothing
  // here reacts to it. The rebuild is the user's click.
  const unincorporated = digest?.unincorporatedCount ?? 0;
  const viewState = deriveVaultViewState({
    scope: "folder",
    list: { kind: "ready", visibleCount: folder.memberCount, totalCount: folder.memberCount },
    search: { kind: "idle" },
    unincorporatedCount: unincorporated,
  });
  const stale = viewState.digest.kind === "stale";
  const digestFailed = folder.digestStatus === "failed" || folder.digestStatus === "refused";
  const digestBuilding = folder.digestStatus === "building";
  const outcome = digestBuilding
    ? "Building this folder's summary."
    : digestFailed
      ? "The folder summary could not be completed. Rebuild to try again."
      : folder.digestStatus === "built"
        ? "The summary was created. Its document shows search indexing progress."
        : rebuildStatus;

  async function onRebuild() {
    setRebuilding(true);
    setRebuildStatus(null);
    try {
      const r = await rebuild({ folderId });
      setRebuildStatus(
        r.ok
          ? "Rebuilding the digest from this folder's documents."
          : "Nothing has changed; this folder isn't finished yet.",
      );
    } catch {
      setRebuildStatus("Nothing has changed; please try again.");
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <section className="vault-folder-context" aria-label="Current folder">
      <div className="vault-folder-row">
        <button type="button" onClick={onExit} className="vault-button">
          ← All documents
        </button>
        <strong>{folder.name}</strong>
        <span className="vault-folder-count">
          · {folder.memberCount} document{folder.memberCount === 1 ? "" : "s"}
        </span>
        {/* Emphasis is weight and position, never a coloured pill and never amber (BRAND §5/§2).
            No aria-live: this is an ambient count, not an outcome. */}
        {unincorporated > 0 && (
          <span className="caps-label" style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
            {unincorporated} added since the last digest
          </span>
        )}
        <DigestRebuildControl
          available={
            digestFailed || digestBuilding || (digest !== undefined && digest.state !== "none")
          }
          stale={stale || digestFailed}
          rebuilding={rebuilding || digestBuilding}
          onRebuild={() => void onRebuild()}
        />
      </div>
      {outcome && (
        <p role="status" aria-live="polite" className="vault-folder-outcome">
          {outcome}
        </p>
      )}
    </section>
  );
}
