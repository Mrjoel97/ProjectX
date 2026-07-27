// The ONE place a vault `failureReason` becomes prose.
//
// A failure reason is a refs-only label (CLAUDE.md §4) — it lives in `convex/` as a stable code and
// is NEVER shown to a user. The user-facing wording belongs in the surface that renders it, which
// is why this map is here and not in the backend. Two callers: DocGrid's failed card and
// PreviewModal's failure block.
//
// `title` = what happened. `remedy` = what to do about it. Plain language, second person, no blame,
// no apology-padding (BRAND §1). Every reason the extraction/ingest path can produce owns a row —
// if you add a `fail("...")` in vaultExtract/vaultTranscribe/vaultIngest/vaultSweep, you owe a row
// here, or the user reads the default.
//
// ponytail: a flat map, exact-matched. The plan specified an extra `startsWith` branch for the
// `extract_error: <sdk message>` prefix — NOT written, because the lookup miss already sends it to
// GENERIC, which is the behaviour that branch would have produced. A branch whose only effect is to
// reach the fallthrough it already falls through to is a dead branch.
// If this grows past ~30 rows, move it beside the reason strings — but do NOT move the COPY into
// the backend; that would put user-facing prose behind the §4 refs-only boundary.

export type FailureCopy = { title: string; remedy: string };

const GENERIC: FailureCopy = {
  title: "We couldn't read this file.",
  remedy: "Press Retry, or try a different format.",
};

// Shared rows — several reason codes describe the same thing to a user.
const PARSE_FAILED: FailureCopy = {
  title: "We couldn't read inside this file.",
  remedy: "It may be corrupted or password-protected. Try re-saving it, then upload again.",
};
const PAUSED: FailureCopy = {
  title: "Processing is paused right now.",
  remedy: "Nothing is wrong with your file. Press Retry later.",
};
const MISSING: FailureCopy = {
  title: "The uploaded file couldn't be found.",
  remedy: "Upload it again.",
};
const INGEST: FailureCopy = {
  title: "Something went wrong while indexing this file.",
  remedy: "Press Retry.",
};

const COPY: Record<string, FailureCopy> = {
  unsupported_format: {
    title: "We couldn't recognise this file's format.",
    remedy: "Re-save it as PDF, DOCX, XLSX or plain text and upload it again.",
  },
  // The remedy that makes the SheetJS spike (15.2-07) OPTIONAL: if that plan never lands, this is
  // what the user sees, and it is actionable.
  unsupported_legacy_spreadsheet: {
    title: "This is a legacy Excel workbook (.xls).",
    remedy: "Open it in Excel and re-save as .xlsx, then upload it again.",
  },
  unsupported_video_container: {
    title: "We can't transcribe this video format.",
    remedy: "Re-save it as MP4, M4A or MP3 and upload it again.",
  },
  // The transcribe rail's three honest endings (vaultTranscribe.ts). The first is the one worth
  // distinguishing: a soundless screen-recording is not a broken file, and telling the user to
  // re-save it would send them round a loop that cannot succeed.
  no_audio_track_or_undecodable: {
    title: "This recording has no audio we could transcribe.",
    remedy: "Check the file has sound, then upload it again.",
  },
  transcribe_timeout: {
    title: "Transcribing this recording took too long, so we stopped.",
    remedy: "Press Retry. If it happens again, try a shorter clip.",
  },
  transcribe_failed: {
    title: "We couldn't transcribe this recording.",
    remedy: "Press Retry. If it keeps failing, re-save it as MP4 or M4A and upload it again.",
  },
  // Legacy rows only: written before the format could be handled at all. Retry is now real work.
  not_implemented: {
    title: "This file type wasn't supported when you uploaded it.",
    remedy: "It may be supported now — press Retry.",
  },
  empty_extraction: {
    title: "We opened this file but found no readable text.",
    remedy: "If it's a scan or a photo, try a clearer or higher-resolution version.",
  },
  extraction_stalled: {
    title: "Reading this file took too long, so we stopped.",
    remedy:
      "Press Retry. If it happens again the file is probably too large or too complex — try splitting it.",
  },
  office_parse_failed: PARSE_FAILED,
  legacy_parse_failed: PARSE_FAILED,
  raw_parse_failed: PARSE_FAILED,
  pii_scan_failed: {
    title: "We stopped before storing this file's contents.",
    remedy:
      "Press Retry. If it keeps failing, the file may contain content we can't safely process.",
  },
  kill_switch: PAUSED,
  daily_budget_exhausted: PAUSED,
  no_stored_bytes: MISSING,
  missing_blob: MISSING,
  missing_bytes: MISSING,
  ingest_failed: INGEST,
  ingest_canceled: INGEST,
};

/**
 * Map a refs-only failure reason to what the user reads. Unknown, absent, and the `extract_error:`
 * prefix all fall through to the generic row — that prefix carries an SDK/parser message which is
 * never document content but is also never fit to show verbatim, and it can never match a key
 * because every key here is a bare code.
 */
export function failureCopy(reason?: string): FailureCopy {
  // `Object.hasOwn`, not a bare index: a reason is a string from the backend, and a bare index
  // would hand back Object.prototype members ("constructor", "toString") as if they were copy.
  if (!reason || !Object.hasOwn(COPY, reason)) return GENERIC;
  return COPY[reason] ?? GENERIC;
}
