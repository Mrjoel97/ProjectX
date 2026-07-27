// The Phase-3.8 extraction contract (Wave 0): which extraction rail a binary upload rides,
// plus the caps every lane shares. Dep-free and V8-safe — exported from the index barrel.
export type ExtractionKind = "pdf" | "image" | "office" | "transcribe";

const OFFICE_MIME: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
]);
const OFFICE_EXT = /\.(docx|xlsx|pptx)$/i;

/**
 * mimeType-first; filename extension fallback (.docx/.xlsx/.pptx) because browsers sometimes
 * send application/octet-stream for Office files. Returns null = not extractable (the row stays
 * pending_extraction / storage-only). Deliberately DUMB about transcription containers: every
 * video/* and audio/* classifies "transcribe" — container ACCEPTANCE is Lane 4's check via
 * TRANSCRIBABLE_CONTAINER_MIME (an unsupported container fails honestly there, never sits pending).
 */
export function extractionKindFor(mimeType: string, filename?: string): ExtractionKind | null {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (OFFICE_MIME.has(mimeType) || (filename !== undefined && OFFICE_EXT.test(filename))) {
    return "office";
  }
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) return "transcribe";
  return null;
}

/** Which rail an upload is SCHEDULED onto. Deliberately TOTAL — there is no "don't schedule". */
export type SchedulingRail = "transcribe" | "extract";

/**
 * The scheduling decision, in ONE place for all three callers (vault.vaultUpload,
 * vaultSweep.sweepPendingExtraction, vaultSweep.retryExtraction).
 *
 * Media rides vaultTranscribe by MIME, exactly as before. EVERYTHING ELSE rides
 * vaultExtract.extractDoc — including formats no allow-list here recognises. That is the whole
 * fix: `ctx.storage.get` is ACTION-ONLY (queries and mutations get getUrl/getMetadata), so the
 * magic-byte sniff physically cannot run at a scheduling site (RESEARCH §2). Instead of teaching
 * three mutations to guess, we schedule permissively and let the ONE place that can read bytes
 * decide — where `fail("unsupported_format")` already exists (vaultExtract.ts:200) and, until
 * this change, was UNREACHABLE.
 *
 * The invariant the owner cares about is preserved and strengthened: an unresolvable format is
 * TERMINAL `failed`, never a silent `pending_extraction`. Only its LOCATION moved, from the
 * mutation to the action.
 */
export function schedulingRailFor(mimeType: string, filename?: string): SchedulingRail {
  return extractionKindFor(mimeType, filename) === "transcribe" ? "transcribe" : "extract";
}

/** Chars stored via the ingest seam (Pitfall 6: stays well under Convex's ~1 MiB doc cap). */
export const VAULT_EXTRACT_CHAR_CAP = 400_000;
/** Pages sent to the hosted model for scanned PDFs (under OpenAI's 100-page PDF-input limit). */
export const VAULT_EXTRACT_PAGE_CAP = 50;
/** Garbage-text-layer heuristic: fewer non-space chars/page than this → treat as a scan. */
export const MIN_CHARS_PER_PAGE = 25;

/** Containers the transcription endpoint accepts natively (no demux). NOT video/quicktime. */
export const TRANSCRIBABLE_CONTAINER_MIME: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/webm",
  "video/mpeg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/mp3",
]);
