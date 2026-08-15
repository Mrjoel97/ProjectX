import { describe, expect, test } from "vitest";
import { derivePreviewState, PREVIEW_SNIPPET_CHARS, previewCapabilities } from "./previewState";

// THE FIXTURE MIME CHANGED, AND THAT IS THE FEATURE, NOT A TEST REPAIR. It used to be
// `application/pdf`, chosen as a stand-in for "has bytes, cannot be shown inline, so fall through
// to extracted text". A PDF is no longer that document: `binaryMediaKind` now routes it to the
// browser's own viewer. DOCX takes over the role — real bytes, real extracted text, and genuinely
// nothing a browser can render.
//
// Three tests below failed on this change before the fixture moved, and one of them —
// "distinguishes ready media from unsupported inline formats" — asserted `unsupported` for a PDF.
// That assertion WAS the old behaviour, stated deliberately. It is what this feature reverses.
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ready = {
  status: "ready" as const,
  mimeType: DOCX,
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
    expect(
      derivePreviewState({ ...ready, mimeType: "application/pdf", text: null }).content,
    ).toMatchObject({ kind: "ready-binary", media: "pdf" });
    expect(derivePreviewState({ ...ready, text: null }).content.kind).toBe("unsupported");
  });

  // A PDF has a TRUE FORM — pagination, tables, figures, signatures — and every browser can
  // already render it. Before this it fell through to the extracted-text branch and the document
  // was replaced by a paragraph of its own words: the same defect 15.4-03 shipped for images.
  test("a PDF with stored bytes renders as the document, not as a wall of its text", () => {
    const withText = derivePreviewState({
      ...ready,
      mimeType: "application/pdf",
      text: "Extracted contract body",
    });
    expect(withText.content).toMatchObject({ kind: "ready-binary", media: "pdf" });
    // The extraction is NOT discarded — it rides beneath the viewer, as a transcript does.
    expect(withText.content).toMatchObject({ text: "Extracted contract body" });
  });

  test("its copy names a PDF, rather than inheriting the video label", () => {
    // The branch this replaced read `media === "image" ? "Image preview" : "Video preview"`, which
    // is right for two kinds and silently wrong for a third.
    expect(
      derivePreviewState({ ...ready, mimeType: "application/pdf", text: null }).content,
    ).toMatchObject({ title: "PDF preview" });
  });

  test("a PDF whose bytes are gone falls back — it must never frame nothing", () => {
    // An <iframe> over a dead URL renders a blank rectangle with no error. The state has to refuse
    // the binary branch itself rather than leave the UI to notice.
    expect(
      derivePreviewState({
        ...ready,
        mimeType: "application/pdf",
        text: "Extracted contract body",
        hasStoredBytes: false,
      }).content.kind,
    ).toBe("ready-text");
  });

  test("only application/pdf gets the viewer — not every application/* blob", () => {
    // `startsWith("application/")` would drag in zips, JSON and Office files, none of which a
    // browser can display. Each would frame an empty rectangle or trigger a download.
    for (const mime of ["application/zip", "application/json", DOCX]) {
      expect(derivePreviewState({ ...ready, mimeType: mime, text: null }).content.kind).toBe(
        "unsupported",
      );
    }
  });

  // THE REGRESSION 15.4-03 SHIPPED. Every image is described by the hosted vision rail
  // (vaultExtract.ts) and every video is transcribed (vaultTranscribe.transcribeDoc), so a
  // READY media document ALWAYS carries text. Deciding on text before mimeType made
  // `ready-binary` unreachable in production and the picture stopped rendering. Media with
  // stored bytes wins over its own description; the description rides along beneath it.
  test("shows stored media itself, not its description or transcript", () => {
    expect(
      derivePreviewState({ ...ready, mimeType: "image/png", text: "A photo of a whiteboard" })
        .content,
    ).toMatchObject({
      kind: "ready-binary",
      media: "image",
      text: "A photo of a whiteboard",
      excerpt: "A photo of a whiteboard",
      canExpand: false,
    });
    expect(
      derivePreviewState({ ...ready, mimeType: "video/mp4", text: "Spoken transcript" }).content,
    ).toMatchObject({ kind: "ready-binary", media: "video", text: "Spoken transcript" });
  });

  test("renders media before its description query settles, and truncates a long one", () => {
    // An image must not wait on the lazy text query to paint — the bytes are already signed.
    expect(
      derivePreviewState({ ...ready, mimeType: "image/png", text: undefined }).content,
    ).toMatchObject({ kind: "ready-binary", media: "image", text: null, canExpand: false });

    const long = "x".repeat(PREVIEW_SNIPPET_CHARS + 1);
    expect(
      derivePreviewState({ ...ready, mimeType: "image/png", text: long }).content,
    ).toMatchObject({
      kind: "ready-binary",
      excerpt: `${"x".repeat(PREVIEW_SNIPPET_CHARS)}…`,
      canExpand: true,
    });
  });

  test("falls back to the description when the media bytes are gone", () => {
    expect(
      derivePreviewState({
        ...ready,
        mimeType: "image/png",
        text: "A photo of a whiteboard",
        hasStoredBytes: false,
      }).content,
    ).toMatchObject({ kind: "ready-text", excerpt: "A photo of a whiteboard" });
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
