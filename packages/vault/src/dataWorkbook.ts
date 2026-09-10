/** Subpath-only typed Data reader. Reuses pinned SheetJS/fflate; never the formatted preview.
 * No formula evaluation, filesystem extraction, external-link fetch, macro execution or repair. */

import { sniffContainer } from "@pikar/vault/sniff";
import { unzipSync } from "fflate";
import { read, utils } from "xlsx";

export const DATA_WORKBOOK_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  archiveEntries: 256,
  entryBytes: 4 * 1024 * 1024,
  expandedBytes: 12 * 1024 * 1024,
  sheets: 5,
  rows: 502, // header + 500 data rows + one truncation probe
  columns: 30,
  csvSeparators: 20_000,
} as const;

/** Structurally compatible with core DatasetInput; no core dependency in the parsing package. */
type WorkbookCell = {
  value: string | number | boolean | Date | null;
  formula?: boolean;
  invalid?: boolean;
  currency?: string;
  unit?: string;
  timezone?: string;
};

export function readDataWorkbook(bytes: Uint8Array, format: "csv" | "xlsx", hasHeader = false) {
  if (bytes.byteLength > DATA_WORKBOOK_LIMITS.fileBytes) throw new Error("DATA_FILE_TOO_LARGE");
  const container = sniffContainer(bytes);
  let macros = false;
  let externalLinks = false;
  let contents: Uint8Array | string = bytes;
  if (format === "xlsx") {
    if (container !== "zip") throw new Error("DATA_FORMAT_MISMATCH");
    let entries = 0;
    let expandedBytes = 0;
    // fflate inspects each central-directory size before inflation. Refuse oversized entries
    // before SheetJS decompresses anything; never trust the small compressed file-size alone.
    const files = unzipSync(bytes, {
      filter: (entry) => {
        entries += 1;
        expandedBytes += entry.originalSize;
        if (
          !Number.isSafeInteger(entry.originalSize) ||
          entry.originalSize < 0 ||
          entry.originalSize > DATA_WORKBOOK_LIMITS.entryBytes ||
          expandedBytes > DATA_WORKBOOK_LIMITS.expandedBytes ||
          entries > DATA_WORKBOOK_LIMITS.archiveEntries
        )
          throw new Error("DATA_ARCHIVE_LIMIT");
        if (/vbaProject\.bin$/i.test(entry.name)) macros = true;
        if (/externalLinks\//i.test(entry.name)) externalLinks = true;
        return entry.name.endsWith(".rels"); // inspect relationship metadata, not workbook cell XML
      },
    });
    externalLinks ||= Object.values(files).some((content) =>
      /TargetMode\s*=\s*["']External["']/i.test(new TextDecoder().decode(content)),
    );
  } else if (format === "csv") {
    if (container !== "text") throw new Error("DATA_FORMAT_MISMATCH");
    // Fail closed on invalid UTF-8 and NULs; do not silently repair a workbook/binary as CSV.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("DATA_FORMAT_MISMATCH");
    // Conservative complexity preflight, not a CSV parser. Count quoted delimiters too: a
    // pathological single row must be refused before SheetJS allocates millions of cells.
    let separators = 0;
    for (const char of text) {
      if (",;\t\n".includes(char)) separators += 1;
      if (separators > DATA_WORKBOOK_LIMITS.csvSeparators)
        throw new Error("DATA_PARSE_COMPLEXITY_LIMIT");
    }
    contents = text; // avoid SheetJS's legacy byte-codepage defaults for UTF-8 CSV
  } else throw new Error("DATA_FORMAT_MISMATCH");

  const workbook = read(contents, {
    type: format === "csv" ? "string" : "array",
    // Preserve !fullref for honest truncation disclosure. nodim:true discards it when
    // every populated cell falls beyond sheetRows. Projection loops are bounded below.
    nodim: false,
    raw: true,
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellText: false,
    sheetStubs: true,
    bookVBA: false,
    sheetRows: DATA_WORKBOOK_LIMITS.rows,
    sheets: Array.from({ length: DATA_WORKBOOK_LIMITS.sheets }, (_, i) => i),
  });
  let parseLimited = false;
  const sheets = workbook.SheetNames.slice(0, DATA_WORKBOOK_LIMITS.sheets).map((name) => {
    const sheet = workbook.Sheets[name];
    const range = sheet?.["!ref"] ? utils.decode_range(sheet["!ref"]) : null;
    const fullRange = sheet?.["!fullref"] ? utils.decode_range(sheet["!fullref"]) : range;
    const startRow = (range?.s.r ?? 0) + 1;
    const startColumn = (range?.s.c ?? 0) + 1;
    const totalRows = fullRange ? fullRange.e.r - fullRange.s.r + 1 : 0;
    const totalColumns = fullRange ? fullRange.e.c - fullRange.s.c + 1 : 0;
    // sheetRows is an absolute row boundary. A sparse A1000 cell can retain a declared !ref
    // even when SheetJS skipped its value; never turn that uninspected row into a missing cell.
    const rowCount = range
      ? Math.min(range.e.r - range.s.r + 1, Math.max(0, DATA_WORKBOOK_LIMITS.rows - range.s.r))
      : 0;
    const columnCount = Math.min(totalColumns, DATA_WORKBOOK_LIMITS.columns);
    if (
      !range ||
      range.e.r >= DATA_WORKBOOK_LIMITS.rows ||
      rowCount < totalRows ||
      columnCount < totalColumns
    )
      parseLimited = true;
    const rows: WorkbookCell[][] = Array.from({ length: rowCount }, (_, row) =>
      Array.from({ length: columnCount }, (_, column) => {
        const cell =
          sheet?.[utils.encode_cell({ r: startRow - 1 + row, c: startColumn - 1 + column })];
        if (!cell) return { value: null };
        if (cell.l) externalLinks = true;
        const value =
          cell.v instanceof Date || ["string", "number", "boolean"].includes(typeof cell.v)
            ? (cell.v as WorkbookCell["value"])
            : null;
        const numericFormat = typeof cell.z === "string" ? cell.z : "";
        const currency = numericFormat.match(/(?:USD|EUR|GBP|TZS|KES|AUD|CAD|JPY|[$€£¥])/i)?.[0];
        return {
          value,
          ...(cell.f ? { formula: true } : {}),
          ...(cell.t === "e" ? { invalid: true } : {}),
          ...(currency ? { currency } : {}),
          ...(numericFormat.includes("%") ? { unit: "percent-format" } : {}),
          ...(cell.t === "d" ? { timezone: "unspecified-workbook-timezone" } : {}),
        };
      }),
    );
    return { name, rows, hasHeader, startRow, startColumn, totalRows, totalColumns };
  });
  return {
    sheets,
    totalSheets: workbook.SheetNames.length,
    features: { macros, externalLinks, parseLimited },
  };
}
