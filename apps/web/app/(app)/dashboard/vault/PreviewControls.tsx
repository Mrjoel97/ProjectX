import { DOC_TYPE_LABEL, DOC_TYPES, type DocType } from "@pikar/core";
import React from "react";
import type { PreviewCapabilities } from "./previewState";

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.65rem",
  padding: "1.15rem 0",
  borderTop: "1px solid var(--vault-border)",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "2.6rem",
  padding: "0.55rem 0.7rem",
  border: "1px solid var(--vault-border)",
  borderRadius: "0.7rem",
  background: "var(--vault-paper)",
  color: "var(--ink)",
  font: "inherit",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "color-mix(in srgb, var(--vault-danger) 24%, var(--vault-border))",
  background: "var(--vault-danger-bg)",
  color: "var(--vault-danger)",
};

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
    actions.push({
      id: "save-identity",
      label: "Save identity",
      onSelect: handlers.onSaveIdentity,
    });
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
        <section
          className="vault-preview-section"
          style={sectionStyle}
          aria-labelledby="vault-preview-identity-heading"
        >
          <h3
            id="vault-preview-identity-heading"
            className="vault-preview-section-title"
            style={sectionTitleStyle}
          >
            Document identity
          </h3>
          <label
            className="vault-preview-field"
            style={{
              display: "grid",
              gap: "0.35rem",
              color: "var(--ink-soft)",
              fontSize: "0.8rem",
            }}
          >
            <span>Type</span>
            <select
              style={fieldStyle}
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
          <label
            className="vault-preview-field"
            style={{
              display: "grid",
              gap: "0.35rem",
              color: "var(--ink-soft)",
              fontSize: "0.8rem",
            }}
          >
            <span>What this is</span>
            <input
              style={fieldStyle}
              value={identityLine}
              placeholder="2025 P&amp;L"
              onChange={(event) => handlers.onIdentityLineChange(event.target.value)}
            />
          </label>
          <div
            className="vault-preview-inline-actions"
            style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}
          >
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
            <p
              className="vault-preview-note"
              style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.8rem" }}
            >
              You set this. Re-reading this document will never change it.
            </p>
          )}
        </section>
      )}

      {retry && (
        <section
          className="vault-preview-alert"
          style={{
            ...sectionStyle,
            padding: "0.9rem",
            border: "1px solid color-mix(in srgb, var(--vault-danger) 22%, var(--vault-border))",
            borderRadius: "0.75rem",
            background: "var(--vault-danger-bg)",
          }}
          aria-labelledby="vault-preview-retry-heading"
        >
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
        <section
          className="vault-preview-section"
          style={sectionStyle}
          aria-labelledby="vault-preview-citations-heading"
        >
          <h3
            id="vault-preview-citations-heading"
            className="vault-preview-section-title"
            style={sectionTitleStyle}
          >
            Entities &amp; citations
          </h3>
          {entities === undefined ? (
            <p
              className="vault-preview-note"
              style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}
            >
              Loading provenance…
            </p>
          ) : entities.length === 0 ? (
            <p
              className="vault-preview-note"
              style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}
            >
              No entities or relationships were extracted from this document.
            </p>
          ) : (
            <>
              <div
                className="vault-preview-entities"
                style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}
              >
                {entities.map((entity) => (
                  <span
                    key={entity._id}
                    title={entity.type}
                    style={{
                      display: "inline-flex",
                      gap: "0.3rem",
                      alignItems: "center",
                      padding: "0.25rem 0.55rem",
                      border: "1px solid var(--vault-border)",
                      borderRadius: "999px",
                      background: "var(--vault-slate-bg)",
                      color: "var(--ink)",
                      fontSize: "0.78rem",
                    }}
                  >
                    {entity.name} <small>{entity.type}</small>
                  </span>
                ))}
              </div>
              {(relationships ?? []).length > 0 && (
                <ul
                  className="vault-preview-relationships"
                  aria-label="Cited relationships"
                  style={{
                    display: "grid",
                    gap: "0.35rem",
                    margin: "0.75rem 0 0",
                    paddingLeft: "1.1rem",
                    color: "var(--ink-soft)",
                    fontSize: "0.8rem",
                  }}
                >
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

      <div
        className="vault-preview-actions"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--vault-border)",
        }}
      >
        {download && (
          <button
            type="button"
            className="vault-button"
            disabled={busy !== null}
            onClick={download.onSelect}
          >
            {busy === "download" ? "Preparing download…" : download.label}
          </button>
        )}
        {requestDelete && (
          <button
            type="button"
            className="vault-button vault-button-danger"
            style={dangerButtonStyle}
            disabled={busy !== null}
            onClick={requestDelete.onSelect}
          >
            {requestDelete.label}
          </button>
        )}
        {cancelDelete && confirmDelete && (
          <fieldset
            className="vault-preview-confirm"
            aria-label="Confirm document removal"
            style={{
              display: "flex",
              flex: "1 1 100%",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem",
              border: 0,
              margin: 0,
              minWidth: 0,
              borderRadius: "0.75rem",
              background: "var(--vault-danger-bg)",
            }}
          >
            <p
              style={{
                flex: "1 1 100%",
                margin: 0,
                color: "var(--vault-danger)",
                fontSize: "0.85rem",
              }}
            >
              Remove this document from the vault? This cannot be undone.
            </p>
            <button
              type="button"
              className="vault-button"
              disabled={busy !== null}
              onClick={cancelDelete.onSelect}
            >
              {cancelDelete.label}
            </button>
            <button
              type="button"
              className="vault-button vault-button-danger"
              style={dangerButtonStyle}
              disabled={busy !== null}
              onClick={confirmDelete.onSelect}
            >
              {busy === "confirm-delete" ? "Removing…" : confirmDelete.label}
            </button>
          </fieldset>
        )}
      </div>
    </>
  );
}
