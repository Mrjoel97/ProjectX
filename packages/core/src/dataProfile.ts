/** Phase 30-03: deterministic facts over typed cells from the existing SheetJS adapter.
 * This module does not parse files or evaluate formulas. Never pass Vault's formatted preview
 * strings as if they retained workbook types, formula flags or complete coverage. */
export const DATA_PROFILE_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  decodedBytes: 1024 * 1024,
  outputBytes: 128 * 1024,
  sheets: 5,
  rowsPerSheet: 500,
  columns: 30,
  cellChars: 512,
  categories: 20,
} as const;

export type DataWarningCode =
  | "sheets_truncated"
  | "rows_truncated"
  | "columns_truncated"
  | "cell_text_truncated"
  | "decoded_bytes_truncated"
  | "output_truncated"
  | "categories_capped"
  | "formula_cached_values_only"
  | "formula_without_cached_value"
  | "macros_not_executed"
  | "external_links_not_followed"
  | "parse_limitations"
  | "mixed_types"
  | "mixed_currencies"
  | "mixed_units"
  | "mixed_timezones"
  | "invalid_values";

export type DataCell = Readonly<{
  value: string | number | boolean | Date | null | undefined;
  /** Presence of a formula, never its executable text. value is its parser-provided cache. */
  formula?: boolean;
  invalid?: boolean;
  currency?: string;
  unit?: string;
  timezone?: string;
}>;

export type DatasetInput = Readonly<{
  source: { fileId: string; contentHash: string; byteLength: number; format: "csv" | "xlsx" };
  sheets: readonly Readonly<{
    name: string;
    rows: readonly (readonly DataCell[])[];
    /** 1-based origin. Headers are excluded only when explicitly declared by the adapter. */
    startRow?: number;
    startColumn?: number;
    hasHeader?: boolean;
    totalRows?: number;
    totalColumns?: number;
  }>[];
  totalSheets?: number;
  features?: { macros?: boolean; externalLinks?: boolean; parseLimited?: boolean };
}>;

type ValueType = "number" | "date" | "text" | "boolean";
export type DataColumnProfile = {
  column: string;
  header?: string;
  missingCount: number;
  invalidCount: number;
  typeCounts: Record<ValueType, number>;
  inferredType: ValueType | "mixed" | "empty";
  /** Share of valid nonmissing sampled values matching the dominant type; not model certainty. */
  confidence: number;
  numericRange: { min: number; max: number } | null;
  dateCoverage: { earliest: string; latest: string } | null;
  distinctCount: number;
  distinctCountExact: boolean;
  categories: { value: string; count: number }[];
  warnings: DataWarningCode[];
};

export type DataSheetProfile = {
  sheet: string;
  range: string | null;
  headerAssumption: "declared" | "none";
  availableRows: number;
  availableColumns: number;
  rowCount: number;
  columnCount: number;
  duplicateRowCount: number;
  duplicateRowsCompared: number;
  columns: DataColumnProfile[];
  warnings: DataWarningCode[];
};

export type DataProfile = {
  source: DatasetInput["source"];
  totalSheets: number;
  sheets: DataSheetProfile[];
  rowCount: number;
  truncated: boolean;
  warnings: DataWarningCode[];
  semantics: "observed-cached-cell-values; no formula evaluation; no type coercion";
};

const encoder = new TextEncoder();
const byteSize = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;
const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const add = (warnings: DataWarningCode[], code: DataWarningCode): void => {
  if (!warnings.includes(code)) warnings.push(code);
};
const columnName = (index: number): string => {
  let n = index;
  let name = "";
  while (n > 0) {
    n -= 1;
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26);
  }
  return name;
};

function emptyColumn(column: string): DataColumnProfile {
  return {
    column,
    missingCount: 0,
    invalidCount: 0,
    typeCounts: { number: 0, date: 0, text: 0, boolean: 0 },
    inferredType: "empty",
    confidence: 0,
    numericRange: null,
    dateCoverage: null,
    distinctCount: 0,
    distinctCountExact: true,
    categories: [],
    warnings: [],
  };
}

/** Reject oversized source files before examining any sheet. The file adapter must supply the
 * actual byte length, preserve typed values/feature flags and apply its own parser resource caps.
 * String dates/numbers stay text: locale, identifiers and units cannot safely be guessed. */
export function profileDataset(input: DatasetInput): DataProfile {
  const { source } = input;
  if (
    !source.fileId ||
    source.fileId.length > 256 ||
    !source.contentHash ||
    source.contentHash.length > 256 ||
    !isCount(source.byteLength) ||
    source.byteLength > DATA_PROFILE_LIMITS.fileBytes ||
    (source.format !== "csv" && source.format !== "xlsx")
  )
    throw new Error("DATA_SOURCE_INVALID");
  const totalSheets = input.totalSheets ?? input.sheets.length;
  if (!isCount(totalSheets) || totalSheets < input.sheets.length)
    throw new Error("DATA_COVERAGE_INVALID");
  const result: DataProfile = {
    source: {
      fileId: source.fileId,
      contentHash: source.contentHash,
      byteLength: source.byteLength,
      format: source.format,
    },
    totalSheets,
    sheets: [],
    rowCount: 0,
    truncated: false,
    warnings: [],
    semantics: "observed-cached-cell-values; no formula evaluation; no type coercion",
  };
  if (input.features?.macros) add(result.warnings, "macros_not_executed");
  if (input.features?.externalLinks) add(result.warnings, "external_links_not_followed");
  if (input.features?.parseLimited) add(result.warnings, "parse_limitations");
  if (totalSheets > Math.min(input.sheets.length, DATA_PROFILE_LIMITS.sheets))
    add(result.warnings, "sheets_truncated");
  let decodedBytes = 0;

  for (const sheet of input.sheets.slice(0, DATA_PROFILE_LIMITS.sheets)) {
    const startRow = sheet.startRow ?? 1;
    const startColumn = sheet.startColumn ?? 1;
    const availableRows = sheet.totalRows ?? sheet.rows.length;
    if (
      !isCount(startRow) ||
      startRow < 1 ||
      startRow > 1_048_576 ||
      !isCount(startColumn) ||
      startColumn < 1 ||
      startColumn > 16_384 ||
      !isCount(availableRows) ||
      availableRows < sheet.rows.length ||
      sheet.name.length > 128
    )
      throw new Error("DATA_COVERAGE_INVALID");
    const warnings: DataWarningCode[] = [];
    const headerRows = sheet.hasHeader && sheet.rows.length ? 1 : 0;
    const candidateRows = sheet.rows.slice(
      headerRows,
      headerRows + DATA_PROFILE_LIMITS.rowsPerSheet,
    );
    // Width is inspected only in the bounded sample. The adapter supplies totalColumns if known.
    const observedWidth = Math.max(
      sheet.rows[0]?.length ?? 0,
      ...candidateRows.map((row) => row.length),
    );
    const width = sheet.totalColumns ?? observedWidth;
    if (!isCount(width) || width < observedWidth) throw new Error("DATA_COVERAGE_INVALID");
    const columnCount = Math.min(width, DATA_PROFILE_LIMITS.columns);
    if (width > columnCount) add(warnings, "columns_truncated");
    if (availableRows - headerRows > candidateRows.length) add(warnings, "rows_truncated");
    const states = Array.from({ length: columnCount }, (_, i) => ({
      column: emptyColumn(columnName(startColumn + i)),
      categories: new Map<string, { value: string; count: number }>(),
      semantics: {
        currency: new Set<string>(),
        unit: new Set<string>(),
        timezone: new Set<string>(),
      },
    }));
    const columns = states.map((state) => state.column);
    if (headerRows) {
      columns.forEach((col, i) => {
        const header = sheet.rows[0]?.[i];
        const value = header?.value;
        if (header?.formula) add(warnings, "formula_cached_values_only");
        if (header?.formula && value == null) add(warnings, "formula_without_cached_value");
        if (typeof value === "string") {
          col.header = value.slice(0, DATA_PROFILE_LIMITS.cellChars);
          if (value.length > DATA_PROFILE_LIMITS.cellChars) add(warnings, "cell_text_truncated");
        }
      });
    }
    const seenRows = new Set<string>();
    let rowCount = 0;
    let duplicateRowCount = 0;
    let duplicateRowsCompared = 0;
    for (const row of candidateRows) {
      // Cap text before encoding; never allocate an unbounded JSON representation of a raw cell.
      const sampled = Array.from({ length: columnCount }, (_, i) => {
        const cell = row[i] ?? { value: null };
        return typeof cell.value === "string"
          ? cell.value.slice(0, DATA_PROFILE_LIMITS.cellChars)
          : cell.value;
      });
      const rowBytes = byteSize(sampled);
      if (decodedBytes + rowBytes > DATA_PROFILE_LIMITS.decodedBytes) {
        add(warnings, "decoded_bytes_truncated");
        add(warnings, "rows_truncated");
        break;
      }
      decodedBytes += rowBytes;
      rowCount += 1;
      let comparable = width <= columnCount;
      const rowKey: unknown[] = [];
      for (const [i, state] of states.entries()) {
        const col = state.column;
        const cell = row[i] ?? { value: null };
        const value = cell.value;
        if (cell.formula) add(col.warnings, "formula_cached_values_only");
        if (cell.formula && value == null) add(col.warnings, "formula_without_cached_value");
        if (
          cell.invalid ||
          (typeof value === "number" &&
            (!Number.isFinite(value) ||
              (Number.isInteger(value) && !Number.isSafeInteger(value)))) ||
          (value instanceof Date && !Number.isFinite(value.getTime()))
        ) {
          col.invalidCount += 1;
          add(col.warnings, "invalid_values");
          comparable = false;
          continue;
        }
        if (value == null || (typeof value === "string" && value.trim() === "")) {
          col.missingCount += 1;
          rowKey.push(null);
          continue;
        }
        const type: ValueType =
          value instanceof Date
            ? "date"
            : typeof value === "number"
              ? "number"
              : typeof value === "boolean"
                ? "boolean"
                : "text";
        const full = value instanceof Date ? value.toISOString() : String(value);
        const display = full.slice(0, DATA_PROFILE_LIMITS.cellChars);
        col.typeCounts[type] += 1;
        if (full.length > DATA_PROFILE_LIMITS.cellChars) {
          add(col.warnings, "cell_text_truncated");
          col.distinctCountExact = false;
          comparable = false;
        }
        for (const [field, warning] of [
          ["currency", "mixed_currencies"],
          ["unit", "mixed_units"],
          ["timezone", "mixed_timezones"],
        ] as const) {
          const label = cell[field] ?? "unknown";
          if (label.length > 64) throw new Error("DATA_CELL_METADATA_INVALID");
          // Only two distinct labels are needed to prove mixed semantics.
          const values = state.semantics[field];
          if (values.size < 2) values.add(label);
          if (values.size > 1) add(col.warnings, warning);
        }
        const key = JSON.stringify([
          type,
          display,
          cell.currency ?? null,
          cell.unit ?? null,
          cell.timezone ?? null,
        ]);
        rowKey.push(key);
        // Truncated strings cannot be merged as if their unseen suffixes were identical.
        if (full.length <= DATA_PROFILE_LIMITS.cellChars) {
          const existing = state.categories.get(key);
          if (existing) existing.count += 1;
          else if (state.categories.size < DATA_PROFILE_LIMITS.categories)
            state.categories.set(key, { value: display, count: 1 });
          else {
            col.distinctCountExact = false;
            add(col.warnings, "categories_capped");
          }
        }
        if (type === "number") {
          const number = value as number;
          col.numericRange = col.numericRange
            ? {
                min: Math.min(col.numericRange.min, number),
                max: Math.max(col.numericRange.max, number),
              }
            : { min: number, max: number };
        }
        if (type === "date") {
          const date = full;
          col.dateCoverage = col.dateCoverage
            ? {
                earliest:
                  Date.parse(col.dateCoverage.earliest) < Date.parse(date)
                    ? col.dateCoverage.earliest
                    : date,
                latest:
                  Date.parse(col.dateCoverage.latest) > Date.parse(date)
                    ? col.dateCoverage.latest
                    : date,
              }
            : { earliest: date, latest: date };
        }
      }
      if (comparable) {
        duplicateRowsCompared += 1;
        const key = JSON.stringify(rowKey);
        if (seenRows.has(key)) duplicateRowCount += 1;
        seenRows.add(key);
      }
    }
    for (const state of states) {
      const col = state.column;
      const counts = Object.entries(col.typeCounts) as [ValueType, number][];
      const present = counts.filter(([, count]) => count > 0);
      col.inferredType = present.length > 1 ? "mixed" : (present[0]?.[0] ?? "empty");
      const valid = counts.reduce((sum, [, count]) => sum + count, 0);
      col.confidence = valid ? Math.max(...counts.map(([, count]) => count)) / valid : 0;
      if (present.length > 1) add(col.warnings, "mixed_types");
      if (col.warnings.includes("mixed_currencies") || col.warnings.includes("mixed_units"))
        col.numericRange = null;
      col.distinctCount = state.categories.size;
      col.categories = [...state.categories.values()];
      for (const warning of col.warnings) add(warnings, warning);
    }
    const profile: DataSheetProfile = {
      sheet: sheet.name,
      range:
        rowCount && columnCount
          ? `${columnName(startColumn)}${startRow + headerRows}:${columnName(startColumn + columnCount - 1)}${startRow + headerRows + rowCount - 1}`
          : null,
      headerAssumption: headerRows ? "declared" : "none",
      availableRows: Math.max(0, availableRows - headerRows),
      availableColumns: width,
      rowCount,
      columnCount,
      duplicateRowCount,
      duplicateRowsCompared,
      columns,
      warnings,
    };
    // Whole-sheet output granularity: never publish half a profile as complete statistics.
    if (
      byteSize({ ...result, sheets: [...result.sheets, profile] }) >
      DATA_PROFILE_LIMITS.outputBytes - 1024
    ) {
      add(result.warnings, "output_truncated");
      break;
    }
    result.sheets.push(profile);
    result.rowCount += rowCount;
    for (const warning of warnings) add(result.warnings, warning);
    if (warnings.includes("decoded_bytes_truncated")) break;
  }
  result.truncated = result.warnings.some((warning) => warning.endsWith("truncated"));
  return result;
}
