import { DOC_TYPE_LABEL, DOC_TYPES, type DocType } from "@pikar/core";
import React from "react";
import type { PreviewCapabilities } from "./previewState";

export type PreviewEntity = { _id: string; name: string; type: string };
export type PreviewRelationship = {
  _id: string;
  fromNodeId: string;
  toNodeId: string;
  rel: string;
};

export type PreviewControlHandlers = {
  onDocTypeChange: (value: DocType | "") => void;
  onIdentityLineChange: (value: string) => void;
  onSaveIdentity: () => void;
  onDownload: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onRetryExtraction: () => void;
};

export type PreviewActionId =
  | "save-identity"
  | "download"
  | "request-delete"
  | "cancel-delete"
  | "confirm-delete"
  | "retry-extraction";

export type PreviewActionDescriptor = {
  id: PreviewActionId;
  label: string;
  onSelect: () => void;
};

/** The destructive callback is deliberately unreachable until confirmation is already visible. */
export function confirmedDelete(confirmed: boolean, onDelete: () => void): boolean {
  if (!confirmed) return false;
  onDelete();
  return true;
}

/** One callback map drives the presenter and its executable handler-contract tests. */
export function previewActionDescriptors(
  capabilities: PreviewCapabilities,
  handlers: PreviewControlHandlers,
  deleteConfirmation: boolean,
): readonly PreviewActionDescriptor[] {
  const actions: PreviewActionDescriptor[] = [];
  if (capabilities.identityCorrection) {
    actions.push({ id: "save-identity", label: "Save identity", onSelect: handlers.onSaveIdentity });
  }
  if (capabilities.retryExtraction) {
    actions.push({
      id: "retry-extraction",
      label: "Retry extraction",
      onSelect: handlers.onRetryExtraction,
    });
  }
  if (capabilities.download) {
    actions.push({ id: "download", label: "Download original", onSelect: handlers.onDownload });
  }
  if (capabilities.delete) {
    if (deleteConfirmation) {
      actions.push(
        { id: "cancel-delete", label: "Keep document", onSelect: handlers.onCancelDelete },
        {
          id: "confirm-delete",
          label: "Yes, remove it",
          onSelect: () => void confirmedDelete(true, handlers.onConfirmDelete),
        },
      );
    } else {
      actions.push({
        id: "request-delete",
        label: "Remove from vault",
        onSelect: handlers.onRequestDelete,
      });
    }
  }
  return actions;
}

export function PreviewControls({
  capabilities,
  docType,
  identityLine,
  identitySaved,
  identityUserSet,
  entities,
  relationships,
  busy,
  deleteConfirmation,
  handlers,
}: {
  capabilities: PreviewCapabilities;
  docType: DocType | "";
  identityLine: string;
  identitySaved: boolean;
  identityUserSet: boolean;
  entities: readonly PreviewEntity[] | undefined;
  relationships: readonly PreviewRelationship[] | undefined;
  busy: PreviewActionId | null;
  deleteConfirmation: boolean;
  handlers: PreviewControlHandlers;
}) {
  const actions = previewActionDescriptors(capabilities, handlers, deleteConfirmation);
  const action = (id: PreviewActionId) => actions.find((candidate) => candidate.id === id);
  const nodeName = new Map((entities ?? []).map((node) => [node._id, node.name] as const));
  const save = action("save-identity");
  const retry = action("retry-extraction");
  const download = action("download");
  const requestDelete = action("request-delete");
  const cancelDelete = action("cancel-delete");
  const confirmDelete = action("confirm-delete");

  return (
    <>
      {capabilities.identityCorrection && save && (
        <section className="vault-preview-section" aria-labelledby="vault-preview-identity-heading">
          <h3 id="vault-preview-identity-heading" className="vault-preview-section-title">
            Document identity
          </h3>
          <label className="vault-preview-field">
            <span>Type</span>
            <select
              value={docType}
              onChange={(event) => handlers.onDocTypeChange(event.target.value as DocType | "")}
            >
              <option value="">Not classified</option>
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOC_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="vault-preview-field">
            <span>What this is</span>
            <input
              value={identityLine}
              placeholder="2025 P&amp;L"
              onChange={(event) => handlers.onIdentityLineChange(event.target.value)}
            />
          </label>
          <div className="vault-preview-inline-actions">
            <button
              type="button"
              className="vault-button vault-button-primary"
              disabled={busy !== null}
              onClick={save.onSelect}
            >
              {busy === "save-identity" ? "Saving…" : save.label}
            </button>
            {identitySaved && busy === null && (
              <span role="status" aria-live="polite">
                Saved.
              </span>
            )}
          </div>
          {identityUserSet && (
            <p className="vault-preview-note">You set this. Re-reading this document will never change it.</p>
          )}
        </section>
      )}

      {retry && (
        <section className="vault-preview-alert" aria-labelledby="vault-preview-retry-heading">
          <h3 id="vault-preview-retry-heading">Extraction needs attention</h3>
          <p>It can&rsquo;t be discussed by voice until it reads successfully.</p>
          <button
            type="button"
            className="vault-button"
            disabled={busy !== null}
            onClick={retry.onSelect}
          >
            {busy === "retry-extraction" ? "Retrying…" : retry.label}
          </button>
        </section>
      )}

      {capabilities.citations && (
        <section className="vault-preview-section" aria-labelledby="vault-preview-citations-heading">
          <h3 id="vault-preview-citations-heading" className="vault-preview-section-title">
            Entities &amp; citations
          </h3>
          {entities === undefined ? (
            <p className="vault-preview-note">Loading provenance…</p>
          ) : entities.length === 0 ? (
            <p className="vault-preview-note">No entities or relationships were extracted from this document.</p>
          ) : (
            <>
              <div className="vault-preview-entities" aria-label="Entities found">
                {entities.map((entity) => (
                  <span key={entity._id} title={entity.type}>
                    {entity.name} <small>{entity.type}</small>
                  </span>
                ))}
              </div>
              {(relationships ?? []).length > 0 && (
                <ul className="vault-preview-relationships" aria-label="Cited relationships">
                  {(relationships ?? []).map((relationship) => (
                    <li key={relationship._id}>
                      {nodeName.get(relationship.fromNodeId) ?? "Unknown"}{" "}
                      <strong>{relationship.rel}</strong>{" "}
                      {nodeName.get(relationship.toNodeId) ?? "Unknown"}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <div className="vault-preview-actions" aria-label="Document actions">
        {download && (
          <button type="button" className="vault-button" disabled={busy !== null} onClick={download.onSelect}>
            {busy === "download" ? "Preparing download…" : download.label}
          </button>
        )}
        {requestDelete && (
          <button
            type="button"
            className="vault-button vault-button-danger"
            disabled={busy !== null}
            onClick={requestDelete.onSelect}
          >
            {requestDelete.label}
          </button>
        )}
        {cancelDelete && confirmDelete && (
          <div className="vault-preview-confirm" role="group" aria-label="Confirm document removal">
            <p>Remove this document from the vault? This cannot be undone.</p>
            <button type="button" className="vault-button" disabled={busy !== null} onClick={cancelDelete.onSelect}>
              {cancelDelete.label}
            </button>
            <button
              type="button"
              className="vault-button vault-button-danger"
              disabled={busy !== null}
              onClick={confirmDelete.onSelect}
            >
              {busy === "confirm-delete" ? "Removing…" : confirmDelete.label}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
