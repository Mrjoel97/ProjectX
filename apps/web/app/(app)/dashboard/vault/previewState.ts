export const PREVIEW_SNIPPET_CHARS = 1500;

export type PreviewStatus = "pending_extraction" | "extracting" | "processing" | "ready" | "failed";

export type PreviewContentState =
  | { kind: "loading"; title: string; detail: string }
  | { kind: "processing"; title: string; detail: string }
  | { kind: "failure"; title: string; detail: string }
  | {
      kind: "ready-text";
      title: string;
      text: string;
      excerpt: string;
      canExpand: boolean;
      extractionTruncated: boolean;
    }
  | {
      kind: "ready-binary";
      title: string;
      detail: string;
      /** `pdf` renders in the browser's OWN viewer (an iframe over the signed URL) rather than as
       *  an <img>/<video>. It is grouped with media deliberately: the shape is identical — stored
       *  bytes shown in true form, with any extracted text riding beneath — so it reuses this
       *  branch instead of adding a parallel one. */
      media: "image" | "video" | "pdf";
      /** The vision description / transcript / extracted text, shown BENEATH the media. Null while
       *  its lazy query settles — the bytes are already signed, so the picture never waits on it. */
      text: string | null;
      excerpt: string;
      canExpand: boolean;
    }
  | { kind: "unsupported"; title: string; detail: string }
  | { kind: "missing-bytes"; title: string; detail: string };

/**
 * THE single source of truth for "is this a document we show in its true form, and which kind?"
 *
 * It is exported because `PreviewModal` needs the SAME answer to decide whether to fetch the signed
 * URL at all — and when the two disagreed, the failure was silent: the modal kept its own
 * `isImage(mime) || isVideo(mime)` pair, so a PDF skipped the URL query, `mediaUrl` stayed
 * undefined, and the ready-binary branch it had just qualified for never rendered. Nothing threw.
 * One predicate, two callers.
 *
 * Exact match for PDF, not `startsWith("application/")`: that prefix also covers zips, JSON and
 * Office blobs, none of which a browser can display. Widening it is how you get an empty frame.
 */
export function binaryMediaKind(mimeType: string): "image" | "video" | "pdf" | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

/** Title + detail per binary kind. Exhaustive by construction: adding a `media` variant without a
 *  copy entry fails typecheck rather than shipping a wrong label. */
const BINARY_COPY: Record<"image" | "video" | "pdf", { title: string; detail: string }> = {
  image: {
    title: "Image preview",
    detail: "Loading the stored image through a short-lived signed URL.",
  },
  video: {
    title: "Video preview",
    detail: "Loading the stored video through a short-lived signed URL.",
  },
  pdf: {
    title: "PDF preview",
    detail: "Loading the stored PDF through a short-lived signed URL.",
  },
};

export type PreviewCapabilities = {
  identityCorrection: boolean;
  citations: boolean;
  download: boolean;
  delete: boolean;
  deleteRequiresConfirmation: true;
  retryExtraction: boolean;
  discussByVoice: boolean;
};

export type PreviewState = {
  content: PreviewContentState;
  capabilities: PreviewCapabilities;
};

type PreviewStateInput = {
  status: PreviewStatus;
  mimeType: string;
  text: string | null | undefined;
  hasStoredBytes: boolean;
  extractionTruncated?: boolean;
  /** False for a missing/foreign projection. Such data must never arm a control. */
  ownedDocument?: boolean;
};

function processingCopy(
  status: PreviewStatus,
): Pick<PreviewContentState, "title"> & { detail: string } {
  switch (status) {
    case "pending_extraction":
      return {
        title: "Waiting to read this file",
        detail: "The original is stored. Text extraction has not started yet.",
      };
    case "extracting":
      return {
        title: "Extracting document text",
        detail: "This preview will update automatically when extraction finishes.",
      };
    default:
      return {
        title: "Preparing this document",
        detail: "Pikar AI is making this document searchable and groundable.",
      };
  }
}

/** The one truncation rule, shared by extracted text and by a media description. */
function snippet(text: string | null): { excerpt: string; canExpand: boolean } {
  if (!text) return { excerpt: "", canExpand: false };
  const canExpand = text.length > PREVIEW_SNIPPET_CHARS;
  return { excerpt: canExpand ? `${text.slice(0, PREVIEW_SNIPPET_CHARS)}…` : text, canExpand };
}

export function previewCapabilities({
  status,
  hasStoredBytes,
  ownedDocument = true,
}: Pick<PreviewStateInput, "status" | "hasStoredBytes" | "ownedDocument">): PreviewCapabilities {
  return {
    identityCorrection: ownedDocument,
    citations: ownedDocument,
    download: ownedDocument && hasStoredBytes,
    delete: ownedDocument,
    deleteRequiresConfirmation: true,
    retryExtraction: ownedDocument && status === "failed",
    discussByVoice: ownedDocument && status === "ready",
  };
}

export function derivePreviewState(input: PreviewStateInput): PreviewState {
  const capabilities = previewCapabilities(input);

  if (input.ownedDocument === false) {
    return {
      capabilities,
      content: {
        kind: "missing-bytes",
        title: "Document unavailable",
        detail: "This document is missing or is not available in this workspace.",
      },
    };
  }

  if (input.status === "failed") {
    return {
      capabilities,
      content: {
        kind: "failure",
        title: "This document could not be read",
        detail: "Review the extraction error and retry when the source is ready.",
      },
    };
  }

  if (
    input.status === "pending_extraction" ||
    input.status === "extracting" ||
    input.status === "processing"
  ) {
    return { capabilities, content: { kind: "processing", ...processingCopy(input.status) } };
  }

  // MEDIA BEFORE TEXT, and this ordering is the whole feature. The hosted vision rail describes
  // every image and vaultTranscribe transcribes every video, so a READY media document ALWAYS
  // carries text; deciding on text first (as 15.4-03 did) made these two branches unreachable and
  // silently replaced the picture with a paragraph about the picture. The description is not lost —
  // it rides along below. Both branches sit ABOVE the lazy-text gate so the signed bytes paint
  // immediately rather than waiting on a second query.
  // PDF joins image/video here rather than falling through to the text branches. Before this, a
  // PDF in the vault rendered as a WALL OF EXTRACTED TEXT — its own layout, tables and figures
  // replaced by a paragraph of its words, which is the mistake 15.4-03 made with images ("silently
  // replaced the picture with a paragraph about the picture"). A PDF has a true form and every
  // browser can already render it; the extracted text still rides beneath.
  const mediaKind = binaryMediaKind(input.mimeType);

  if (mediaKind && input.hasStoredBytes) {
    const text = input.text ?? null;
    return {
      capabilities,
      content: {
        kind: "ready-binary",
        media: mediaKind,
        ...BINARY_COPY[mediaKind],
        text,
        ...snippet(text),
      },
    };
  }

  if (input.text === undefined) {
    return {
      capabilities,
      content: {
        kind: "loading",
        title: "Loading extracted text",
        detail: "Fetching this document's preview on demand.",
      },
    };
  }

  if (input.text) {
    return {
      capabilities,
      content: {
        kind: "ready-text",
        title: "Extracted text",
        text: input.text,
        ...snippet(input.text),
        extractionTruncated: input.extractionTruncated === true,
      },
    };
  }

  if (!input.hasStoredBytes) {
    return {
      capabilities,
      content: {
        kind: "missing-bytes",
        title: "No stored original",
        detail: "This document has no extracted text or original file to preview or download.",
      },
    };
  }

  // No media branch here: a media document with stored bytes returned above, and one WITHOUT them
  // has already fallen through to ready-text or missing-bytes — which is the honest answer, since
  // there are no bytes left to render.
  return {
    capabilities,
    content: {
      kind: "unsupported",
      title: "No inline preview",
      detail:
        "This file is stored safely, but its format has no inline preview. Download the original to open it.",
    },
  };
}
