import React, { type CSSProperties, type ReactNode } from "react";

export type VaultBrowseHandlers = {
  onUpload: () => void;
  onFolderUpload: () => void;
  onDriveImport: () => void;
};

export type VaultBrowseActionId = "upload" | "folder-upload" | "drive-import";

export type VaultBrowseAction = {
  id: VaultBrowseActionId;
  label: string;
  controls: string;
  onSelect: () => void;
};

/** One descriptor list is shared by the presenter and its callback-contract test. */
export function vaultBrowseActions(handlers: VaultBrowseHandlers): readonly VaultBrowseAction[] {
  return [
    {
      id: "upload",
      label: "Upload a file",
      controls: "vault-upload-source",
      onSelect: handlers.onUpload,
    },
    {
      id: "folder-upload",
      label: "Choose a folder",
      controls: "vault-folder-source",
      onSelect: handlers.onFolderUpload,
    },
    {
      id: "drive-import",
      label: "Import from Drive",
      controls: "vault-drive-source",
      onSelect: handlers.onDriveImport,
    },
  ];
}

export function VaultBrowseControls({
  handlers,
  disabled = false,
  visible = true,
}: {
  handlers: VaultBrowseHandlers;
  disabled?: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <nav className="vault-action-cluster" aria-label="Add to your vault">
      {vaultBrowseActions(handlers).map((action, index) => (
        <button
          key={action.id}
          type="button"
          className={index === 0 ? "vault-button vault-button-primary" : "vault-button"}
          disabled={disabled}
          aria-controls={action.controls}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </nav>
  );
}

export function FolderOpenControl({
  name,
  onOpen,
  disabled = false,
  children,
  className,
  style,
}: {
  name: string;
  onOpen: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={disabled}
      aria-label={`Open folder: ${name}`}
      onClick={onOpen}
    >
      {children}
    </button>
  );
}

export function DigestRebuildControl({
  available,
  stale,
  rebuilding,
  onRebuild,
}: {
  available: boolean;
  stale: boolean;
  rebuilding: boolean;
  onRebuild: () => void;
}) {
  if (!available) return null;

  return (
    <button
      type="button"
      className={stale ? "vault-button vault-button-primary" : "vault-button"}
      disabled={rebuilding}
      onClick={onRebuild}
    >
      {rebuilding ? "Rebuilding…" : "Rebuild digest"}
    </button>
  );
}
