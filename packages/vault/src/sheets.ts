// Phase 40 (DOC-01): a workbook as ROWS — the structured half of a spreadsheet, and the writer.
//
// SUBPATH-ONLY, exactly like xlsText.ts and officeText.ts — do NOT add this to the index barrel.
// SheetJS is ~1 MB and must enter Convex node actions only (one `use node` module per caller).
//
// Pitfall 9 — STATIC top-level import, NEVER `await import("xlsx")`. See xlsText.ts's header for
// the measured history (pdf-lib destructured to `undefined` in production 2026-07-26 while the
// offline suite stayed green). SheetJS 0.20.3 survives both forms; static is the proven shape and
// a version bump could drop the ESM build without a test going red. `sheets.test.ts` scans for it.
//
// TWO functions, opposite directions, one module because they share the caps and the sanitiser:
//   `sheetRows`   — ingest: an uploaded workbook → the capped grid the preview renders.
//   `sheetsToXlsx` — generation: markdown tables (@pikar/core `markdownToSheets`) → real .xlsx bytes.
// This is the file that finally uses the writer that has shipped unused since 15.2 (xlsText.ts's
// `ponytail:` note said "production never does" — Phase 40 is why that note changes).
import { read, utils, write } from "xlsx";
import { sniffContainer } from "./sniff";

/**
 * The caps. A `vaultSheets` row is READ WHOLE by the preview query, so every one of these is a
 * row-size bound, not a UX preference — the same reasoning as VAULT_GRID_READ_BUDGET_BYTES.
 *
 * ponytail: formatted STRINGS, not typed cells. `raw: false` asks SheetJS for the display text, so
 * a date arrives as its formatted date and a currency cell as its formatted number — the grid shows
 * what the spreadsheet shows, and nothing downstream has to re-implement number formats. The
 * ceiling: no types, no formulas, no merges, no styles. Upgrade path is a typed cell shape here and
 * in the table renderer, when something actually needs to compute on it.
 */
export const SHEET_ROWS_CAP = 200;
export const SHEET_COLS_CAP = 30;
export const SHEET_COUNT_CAP = 10;
/** JSON bytes of the accumulated sheets. Whole-sheet granularity: a sheet that would cross the
 *  line is dropped ENTIRELY (with everything after it), never truncated mid-row — a half row in a
 *  grid reads as data, and that would be a lie. */
export const SHEETS_BYTES_CAP = 256 * 1024;

/** One sheet, capped. `totalRows` is the honesty field: rows.length may be less. */
export type SheetRows = { name: string; rows: string[][]; totalRows: number };
/** `sheetCount` is the workbook's TOTAL sheet count, so the renderer can say how many it is not
 *  showing. `sheets.length <= sheetCount` always. */
export type SheetPreview = { sheets: SheetRows[]; sheetCount: number };

/**
 * An uploaded workbook (.xlsx/.xlsm OOXML, or legacy .xls/.xlsb BIFF) as capped rows of display
 * text. SheetJS reads all of these, so this ONE function serves both extraction rails.
 *
 * Throws `sheets_parse_failed: …` for a container SheetJS should not be handed at all or a workbook
 * it cannot read — the caller (vaultExtract) treats a throw as "no grid for this document" and
 * NEVER as a document failure: the text projection is the artifact of record and it has already
 * succeeded by then.
 *
 * A workbook whose every sheet is empty returns `{ sheets: [], sheetCount }` rather than throwing —
 * an empty workbook is a real thing a user can upload, and it is not an error.
 */
export function sheetRows(bytes: Uint8Array): SheetPreview {
  // The xlsText gate, and for the same reason: handed noise, SheetJS falls back to a DSV parser and
  // invents a one-cell sheet out of arbitrary bytes. Fail before it can.
  const container = sniffContainer(bytes);
  if (container !== "ole2" && container !== "zip") {
    throw new Error(`sheets_parse_failed: not a workbook container (${container})`);
  }

  let wb: ReturnType<typeof read>;
  try {
    wb = read(bytes, { type: "array" });
  } catch {
    throw new Error("sheets_parse_failed: unreadable workbook");
  }

  const sheets: SheetRows[] = [];
  let bytesUsed = 0;
  for (const name of wb.SheetNames) {
    if (sheets.length >= SHEET_COUNT_CAP) break;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    let grid: unknown[][];
    try {
      grid = utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false, // display text — see the caps comment
        defval: "",
        blankrows: false,
      });
    } catch {
      continue; // one unreadable sheet never costs the others
    }
    if (grid.length === 0) continue;
    const rows = grid
      .slice(0, SHEET_ROWS_CAP)
      .map((row) => row.slice(0, SHEET_COLS_CAP).map((cell) => String(cell ?? "")));
    const sheet: SheetRows = { name, rows, totalRows: grid.length };
    const cost = JSON.stringify(sheet).length;
    if (bytesUsed + cost > SHEETS_BYTES_CAP) break; // whole-sheet granularity, and stop here
    bytesUsed += cost;
    sheets.push(sheet);
  }

  return { sheets, sheetCount: wb.SheetNames.length };
}

/** Excel's own sheet-name rules: ≤ 31 chars, none of `[ ] : * ? / \`, non-empty, unique in the
 *  workbook. A name from a markdown heading satisfies none of them by construction. */
const safeSheetName = (raw: string, index: number, taken: Set<string>): string => {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || `Sheet ${index + 1}`;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
};

/**
 * Real `.xlsx` bytes from rows — the deliverable half. Row 0 of each sheet is its header row as far
 * as the reader is concerned; this function writes values and NOTHING else: no formulas, no styles,
 * no widths. What the drafter wrote is what the workbook contains.
 *
 * Byte-stable like `markdownToPdf`: the workbook's timestamps are pinned to the epoch, so the same
 * rows produce the same bytes and a fixture can be compared without a clock in the loop.
 */
export function sheetsToXlsx(sheets: readonly { name: string; rows: string[][] }[]): Uint8Array {
  if (sheets.length === 0) throw new Error("xlsx_write_failed: no sheets");
  const wb = utils.book_new();
  wb.Props = { CreatedDate: new Date(0), ModifiedDate: new Date(0) };
  const taken = new Set<string>();
  sheets.forEach((sheet, i) => {
    utils.book_append_sheet(
      wb,
      utils.aoa_to_sheet(sheet.rows),
      safeSheetName(sheet.name, i, taken),
    );
  });
  return new Uint8Array(write(wb, { bookType: "xlsx", type: "buffer" }) as ArrayBufferLike);
}
