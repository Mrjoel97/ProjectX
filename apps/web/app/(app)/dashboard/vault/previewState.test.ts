import { describe, expect, test } from "vitest";
import { PREVIEW_SNIPPET_CHARS, derivePreviewState, previewCapabilities } from "./previewState";

const ready = {
  status: "ready" as const,
  mimeType: "application/pdf",
  hasStoredBytes: true,
};

describe("derivePreviewState", () => {
  test("renders ready extracted text and pins long-content expansion", () => {
    const short = derivePreviewState({ ...ready, text: "A readable contract" });
    expect(short.content).toMatchObject({
      kind: "ready-text",
      excerpt: "A readable contract",
      canExpand: false,
    });

    const text = "x".repeat(PREVIEW_SNIPPET_CHARS + 1);
    const long = derivePreviewState({ ...ready, text, extractionTruncated: true });
    expect(long.content).toMatchObject({
      kind: "ready-text",
      excerpt: `${"x".repeat(PREVIEW_SNIPPET_CHARS)}…`,
      canExpand: true,
      extractionTruncated: true,
    });
  });

  test.each([
    ["pending_extraction", "Waiting to read this file"],
    ["extracting", "Extracting document text"],
    ["processing", "Preparing this document"],
  ] as const)("renders %s as an explicit processing state", (status, title) => {
    const state = derivePreviewState({ ...ready, status, text: null });
    expect(state.content).toMatchObject({ kind: "processing", title });
  });

  test("renders extraction failure before empty or binary fallbacks", () => {
    const state = derivePreviewState({ ...ready, status: "failed", text: null });
    expect(state.content.kind).toBe("failure");
    expect(state.capabilities.retryExtraction).toBe(true);
  });

  test("distinguishes ready media from unsupported inline formats", () => {
    expect(
      derivePreviewState({ ...ready, mimeType: "image/png", text: null }).content,
    ).toMatchObject({ kind: "ready-binary", media: "image" });
    expect(
      derivePreviewState({ ...ready, mimeType: "video/mp4", text: null }).content,
    ).toMatchObject({ kind: "ready-binary", media: "video" });
    expect(derivePreviewState({ ...ready, text: null }).content.kind).toBe("unsupported");
  });

  test("distinguishes a lazy text query from genuinely missing bytes", () => {
    expect(derivePreviewState({ ...ready, text: undefined }).content.kind).toBe("loading");
    expect(
      derivePreviewState({ ...ready, text: null, hasStoredBytes: false }).content,
    ).toMatchObject({ kind: "missing-bytes", title: "No stored original" });
  });
});

describe("previewCapabilities", () => {
  test("retains identity correction, citations, signed download and confirmation-gated delete", () => {
    expect(previewCapabilities({ ...ready })).toEqual({
      identityCorrection: true,
      citations: true,
      download: true,
      delete: true,
      deleteRequiresConfirmation: true,
      retryExtraction: false,
      discussByVoice: true,
    });
  });

  test("never arms controls for foreign or missing document data", () => {
    expect(previewCapabilities({ ...ready, ownedDocument: false })).toEqual({
      identityCorrection: false,
      citations: false,
      download: false,
      delete: false,
      deleteRequiresConfirmation: true,
      retryExtraction: false,
      discussByVoice: false,
    });
    expect(
      derivePreviewState({ ...ready, text: null, ownedDocument: false }).content,
    ).toMatchObject({ kind: "missing-bytes", title: "Document unavailable" });
  });
});
