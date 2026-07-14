/** The 6 vault categories — auto-assigned at ingest, never manual (single `category` field). */
export type VaultCategory =
  | "my-uploads"
  | "brain-dumps"
  | "workspace-docs"
  | "images"
  | "videos"
  | "google-docs";

/** Where a vault item came from. */
export type VaultSource = "upload" | "paste" | "agent" | "google";

/** The Phase-5 searchable (chunked/embedded/graph-extracted) MIME set. */
const SEARCHABLE_MIME = new Set(["text/plain", "text/markdown", "text/csv"]);

/**
 * Map (source, mimeType) to exactly one of the 6 categories. `image/*` and `video/*`
 * win over source (an uploaded image is still an image); otherwise the source decides.
 */
export function categoryFor(input: { source?: VaultSource; mimeType?: string }): VaultCategory {
  const { source, mimeType } = input;
  if (mimeType?.startsWith("image/")) return "images";
  if (mimeType?.startsWith("video/")) return "videos";
  switch (source) {
    case "paste":
      return "brain-dumps";
    case "agent":
      return "workspace-docs";
    case "google":
      return "google-docs";
    default:
      return "my-uploads";
  }
}

/** True when a format is wired through embed → graph-extract → retrieval this phase (TXT/MD/CSV). */
export function isSearchable(mimeType: string | undefined): boolean {
  return mimeType !== undefined && SEARCHABLE_MIME.has(mimeType);
}
