import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  confirmedDelete,
  type PreviewControlHandlers,
  PreviewControls,
  previewActionDescriptors,
} from "./PreviewControls";
import type { PreviewCapabilities } from "./previewState";

const capabilities: PreviewCapabilities = {
  identityCorrection: true,
  citations: true,
  download: true,
  delete: true,
  deleteRequiresConfirmation: true,
  retryExtraction: false,
  discussByVoice: true,
};

function handlers(): PreviewControlHandlers {
  return {
    onDocTypeChange: vi.fn(),
    onIdentityLineChange: vi.fn(),
    onSaveIdentity: vi.fn(),
    onDownload: vi.fn(),
    onRequestDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onRetryExtraction: vi.fn(),
  };
}

function render(overrides: Partial<Parameters<typeof PreviewControls>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PreviewControls, {
      capabilities,
      docType: "contract",
      identityLine: "Northfield services agreement",
      identitySaved: false,
      identityUserSet: true,
      entities: [{ _id: "entity-1", name: "Northfield", type: "organization" }],
      relationships: [],
      busy: null,
      deleteConfirmation: false,
      handlers: handlers(),
      ...overrides,
    }),
  );
}

describe("PreviewControls", () => {
  test("renders metadata correction, provenance, signed download and guarded removal", () => {
    const html = render();
    expect(html).toContain("Document identity");
    expect(html).toContain("Save identity");
    expect(html).toContain("Northfield services agreement");
    expect(html).toContain("Entities &amp; citations");
    expect(html).toContain("Northfield");
    expect(html).toContain("Download original");
    expect(html).toContain("Remove from vault");
    expect(html).not.toContain("Yes, remove it");
  });

  test("renders the destructive action only in the explicit confirmation state", () => {
    const html = render({ deleteConfirmation: true });
    expect(html).toContain('aria-label="Confirm document removal"');
    expect(html).toContain("This cannot be undone");
    expect(html).toContain("Keep document");
    expect(html).toContain("Yes, remove it");
    expect(html).not.toContain("Remove from vault");
  });

  test("renders honest loading and empty provenance states", () => {
    expect(render({ entities: undefined })).toContain("Loading provenance…");
    expect(render({ entities: [], relationships: [] })).toContain(
      "No entities or relationships were extracted from this document.",
    );
  });

  test("maps each descriptor to the existing query or mutation handler", () => {
    const callbacks = handlers();
    const actions = previewActionDescriptors(capabilities, callbacks, false);
    actions.find((action) => action.id === "save-identity")?.onSelect();
    actions.find((action) => action.id === "download")?.onSelect();
    actions.find((action) => action.id === "request-delete")?.onSelect();

    expect(callbacks.onSaveIdentity).toHaveBeenCalledOnce();
    expect(callbacks.onDownload).toHaveBeenCalledOnce();
    expect(callbacks.onRequestDelete).toHaveBeenCalledOnce();
    expect(callbacks.onConfirmDelete).not.toHaveBeenCalled();
  });

  test("cannot invoke the destructive handler until confirmation is true", () => {
    const destroy = vi.fn();
    expect(confirmedDelete(false, destroy)).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
    expect(confirmedDelete(true, destroy)).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
  });

  test("fails closed when the state model removes every capability", () => {
    const html = render({
      capabilities: {
        identityCorrection: false,
        citations: false,
        download: false,
        delete: false,
        deleteRequiresConfirmation: true,
        retryExtraction: false,
        discussByVoice: false,
      },
    });
    expect(html).not.toContain("Document identity");
    expect(html).not.toContain("Entities &amp; citations");
    expect(html).not.toContain("Download original");
    expect(html).not.toContain("Remove from vault");
  });
});
