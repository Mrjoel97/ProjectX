/**
 * The size a Drive file should be RESERVED against (15.3-09, VALT-13).
 *
 * This is one function, and it exists for one reason: **Drive does not reliably populate `size`
 * (or `md5Checksum`) for Google-native Docs Editors files.** A Doc, a Sheet and a Slides deck are
 * not blobs in Drive — they are documents in Google's own store, exported to bytes on demand — so
 * `files.list` frequently returns them with no `size` field at all.
 *
 * An estimator that reads a missing size as `0` prices a 500-Doc folder at **$0**, reserves
 * nothing against the ingest window, and the folder then trips the budget WALL HALFWAY THROUGH —
 * producing exactly the half-ingested folder this phase exists to forbid. A refused folder is
 * honest; a folder that stops at document 300 is not.
 *
 * Over-estimation is the safe direction and costs nothing, because the design hard-reserves and
 * then REFUNDS the unspent remainder (`clampRefundCents`, `ingestEstimate.ts`). That asymmetry is
 * the whole argument: guessing high delays a folder, guessing low strands one.
 */

/**
 * Assumed exported size per Google-native kind, when Drive gives us nothing to go on.
 *
 * Calibrated to the EXPORT we actually request (`vaultDrive.ts`), not to what the document "is":
 * Docs and Slides export to `text/plain`, so their exported bytes are far smaller than the
 * rendered document; Sheets export to xlsx, which carries the whole workbook. Hence a spreadsheet
 * is assumed largest by a wide margin — a multi-tab workbook is the realistic worst case on this
 * rail, and it is also the one whose extraction actually costs money.
 *
 * ponytail: three hand-picked constants, not a probe. Reading the true size means a per-file
 * `files.export` HEAD (N extra round-trips against a rate-limited API) to learn a number the
 * refund path makes irrelevant. Upgrade path if a folder is ever refused for being over-reserved:
 * probe only the files whose kind is native AND whose folder estimate lands near the wall.
 */
export const DRIVE_NATIVE_ASSUMED_BYTES = {
  document: 256_000,
  presentation: 512_000,
  spreadsheet: 1_000_000,
} as const;

/** The floor for ANY file with no usable size, native kind or not. The largest assumption in the
 *  table above: an unknown kind is the case we know least about, so it reserves the most. */
const ASSUMED_FALLBACK_BYTES = Math.max(...Object.values(DRIVE_NATIVE_ASSUMED_BYTES));

const NATIVE_PREFIX = "application/vnd.google-apps.";

/**
 * Bytes to reserve for one Drive file. **Never returns 0**, and never returns a negative or a
 * NaN — every path lands on a real size or on an assumption.
 *
 * `size` arrives from `files.list` as a STRING in the Drive JSON (int64), so callers coerce; a
 * `0`, a `NaN` from a failed coercion, and an absent field are all treated identically as "Drive
 * told us nothing", because all three are indistinguishable in their consequences.
 */
export function estimatedBytesFor(f: { mimeType: string; size?: number }): number {
  const { size } = f;
  if (typeof size === "number" && Number.isFinite(size) && size > 0) return size;

  const kind = f.mimeType.startsWith(NATIVE_PREFIX) ? f.mimeType.slice(NATIVE_PREFIX.length) : "";
  return kind in DRIVE_NATIVE_ASSUMED_BYTES
    ? DRIVE_NATIVE_ASSUMED_BYTES[kind as keyof typeof DRIVE_NATIVE_ASSUMED_BYTES]
    : ASSUMED_FALLBACK_BYTES;
}
