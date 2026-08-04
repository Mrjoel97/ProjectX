export const PREVIEW_SNIPPET_CHARS = 1500;

export type PreviewStatus =
  | "pending_extraction"
  | "extracting"
  | "processing"
  | "ready"
  | "failed";

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
  | { kind: "ready-binary"; title: string; detail: string; media: "image" | "video" }
  | { kind: "unsupported"; title: string; detail: string }
  | { kind: "missing-bytes"; title: string; detail: string };

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

function processingCopy(status: PreviewStatus): Pick<PreviewContentState, "title"> & { detail: string } {
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
    const canExpand = input.text.length > PREVIEW_SNIPPET_CHARS;
    return {
      capabilities,
      content: {
        kind: "ready-text",
        title: "Extracted text",
        text: input.text,
        excerpt: canExpand ? `${input.text.slice(0, PREVIEW_SNIPPET_CHARS)}…` : input.text,
        canExpand,
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

  if (input.mimeType.startsWith("image/")) {
    return {
      capabilities,
      content: {
        kind: "ready-binary",
        media: "image",
        title: "Image preview",
        detail: "Loading the stored image through a short-lived signed URL.",
      },
    };
  }

  if (input.mimeType.startsWith("video/")) {
    return {
      capabilities,
      content: {
        kind: "ready-binary",
        media: "video",
        title: "Video preview",
        detail: "Loading the stored video through a short-lived signed URL.",
      },
    };
  }

  return {
    capabilities,
    content: {
      kind: "unsupported",
      title: "No inline preview",
      detail: "This file is stored safely, but its format has no inline preview. Download the original to open it.",
    },
  };
}
