import { describe, expect, test } from "vitest";
import {
  DATA_PROFILE_LIMITS,
  type DataCell,
  type DatasetInput,
  profileDataset,
} from "./dataProfile";

const cell = (value: DataCell["value"]): DataCell => ({ value });
const dataset = (
  rows: DataCell[][],
): DatasetInput & { sheets: [DatasetInput["sheets"][number]] } => ({
  source: { fileId: "vault-doc-1", contentHash: "sha256:test", byteLength: 100, format: "xlsx" },
  sheets: [{ name: "Sales", rows }],
});

describe("deterministic typed dataset profiling", () => {
  test("counts real values, missing cells, numeric/date coverage and duplicate rows with provenance", () => {
    const input = dataset([
      [cell("Amount"), cell("Date"), cell("Region")],
      [cell(12), cell(new Date("2026-01-03T00:00:00Z")), cell("East")],
      [cell(-4), cell(new Date("2025-12-31T00:00:00Z")), cell("West")],
      [cell(12), cell(new Date("2026-01-03T00:00:00Z")), cell("East")],
      [cell(null), cell(null), cell(" ")],
    ]);
    const withHeader = {
      ...input,
      sheets: [{ ...input.sheets[0], hasHeader: true, startRow: 3, startColumn: 2 }],
    };
    const result = profileDataset(withHeader);
    expect(profileDataset(withHeader)).toEqual(result);
    expect(result.source).toEqual(input.source);
    expect(result.sheets[0]).toMatchObject({
      sheet: "Sales",
      range: "B4:D7",
      rowCount: 4,
      columnCount: 3,
      availableRows: 4,
      availableColumns: 3,
      duplicateRowCount: 1,
      duplicateRowsCompared: 4,
    });
    expect(result.sheets[0]?.columns[0]).toMatchObject({
      header: "Amount",
      inferredType: "number",
      confidence: 1,
      missingCount: 1,
      numericRange: { min: -4, max: 12 },
      distinctCount: 2,
    });
    expect(result.sheets[0]?.columns[1]?.dateCoverage).toEqual({
      earliest: "2025-12-31T00:00:00.000Z",
      latest: "2026-01-03T00:00:00.000Z",
    });
    expect(result.sheets[0]?.columns[2]?.categories).toEqual([
      { value: "East", count: 2 },
      { value: "West", count: 1 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("never infers a header, coerces a locale/identifier string or calculates a formula", () => {
    const input = dataset([
      [cell("0012"), { value: 42, formula: true }],
      [cell("1,234"), { value: undefined, formula: true }],
      [cell("2026-02-31"), cell('=HYPERLINK("https://example.test")')],
    ]);
    const result = profileDataset({
      ...input,
      features: { macros: true, externalLinks: true, parseLimited: true },
    });
    expect(result.sheets[0]).toMatchObject({ rowCount: 3, headerAssumption: "none" });
    expect(result.sheets[0]?.columns[0]).toMatchObject({
      inferredType: "text",
      numericRange: null,
      dateCoverage: null,
    });
    expect(result.sheets[0]?.columns[1]).toMatchObject({
      missingCount: 1,
      numericRange: { min: 42, max: 42 },
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "formula_cached_values_only",
        "formula_without_cached_value",
        "macros_not_executed",
        "external_links_not_followed",
        "parse_limitations",
        "mixed_types",
      ]),
    );
  });

  test("invalid numeric/date values cannot become statistics or fabricated duplicate rows", () => {
    const result = profileDataset(
      dataset([
        [cell(Number.POSITIVE_INFINITY)],
        [cell(Number.NaN)],
        [cell(Number.MAX_SAFE_INTEGER + 1)],
        [cell(new Date("invalid"))],
        [cell(Number.MIN_VALUE)],
        [cell(-Number.MAX_SAFE_INTEGER)],
      ]),
    );
    expect(result.sheets[0]?.columns[0]).toMatchObject({
      invalidCount: 4,
      typeCounts: { number: 2 },
      numericRange: { min: -Number.MAX_SAFE_INTEGER, max: Number.MIN_VALUE },
    });
    expect(result.sheets[0]?.duplicateRowsCompared).toBe(2);
    expect(result.warnings).toContain("invalid_values");
  });

  test("mixed types and unit/currency/timezone metadata stay disclosed without cross-unit ranges", () => {
    const result = profileDataset(
      dataset([
        [{ value: 100, currency: "USD", unit: "dollars", timezone: "UTC" }],
        [{ value: 20, currency: "TZS", unit: "shillings", timezone: "Africa/Dar_es_Salaam" }],
        [cell("unknown")],
      ]),
    );
    const column = result.sheets[0]?.columns[0];
    expect(column).toMatchObject({ inferredType: "mixed", confidence: 2 / 3, numericRange: null });
    expect(column?.warnings).toEqual(
      expect.arrayContaining(["mixed_types", "mixed_currencies", "mixed_units", "mixed_timezones"]),
    );
  });

  test("date order uses timestamps even across ISO expanded-year boundaries", () => {
    const result = profileDataset(
      dataset([
        [cell(new Date("+010000-01-01T00:00:00Z"))],
        [cell(new Date("2026-01-01T00:00:00Z"))],
      ]),
    );
    expect(result.sheets[0]?.columns[0]?.dateCoverage).toEqual({
      earliest: "2026-01-01T00:00:00.000Z",
      latest: "+010000-01-01T00:00:00.000Z",
    });
  });
});

describe("profile bounds", () => {
  test("rejects oversized file metadata before touching workbook contents", () => {
    expect(() =>
      profileDataset({
        source: {
          fileId: "f",
          contentHash: "h",
          byteLength: DATA_PROFILE_LIMITS.fileBytes + 1,
          format: "xlsx",
        },
        get sheets(): never {
          throw new Error("UNBOUNDED_WORKBOOK_TOUCHED");
        },
      }),
    ).toThrow("DATA_SOURCE_INVALID");
  });

  test("sheet/row/column limits retain exact declared coverage and forbid prefix-based duplicates", () => {
    const rows = Array.from({ length: 501 }, () => Array.from({ length: 31 }, () => cell(1)));
    const input = dataset(rows);
    const result = profileDataset({
      ...input,
      sheets: Array.from({ length: 6 }, (_, i) => ({ ...input.sheets[0], name: `Sheet${i}` })),
    });
    expect(result.sheets).toHaveLength(5);
    expect(result.sheets[0]).toMatchObject({
      rowCount: 500,
      columnCount: 30,
      availableRows: 501,
      availableColumns: 31,
      duplicateRowsCompared: 0,
      duplicateRowCount: 0,
    });
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining(["rows_truncated", "columns_truncated", "sheets_truncated"]),
    );
  });

  test("category count is a lower bound after the cap and repeated tracked values remain exact", () => {
    const result = profileDataset(
      dataset([
        ...Array.from({ length: 21 }, (_, i) => [cell(`category-${i}`)]),
        [cell("category-0")],
      ]),
    );
    expect(result.sheets[0]?.columns[0]).toMatchObject({
      distinctCount: 20,
      distinctCountExact: false,
    });
    expect(result.sheets[0]?.columns[0]?.categories[0]?.count).toBe(2);
    expect(result.warnings).toContain("categories_capped");
  });

  test("long values with equal prefixes never become false duplicates or false categories", () => {
    const prefix = "x".repeat(512);
    const result = profileDataset(dataset([[cell(`${prefix}a`)], [cell(`${prefix}b`)]]));
    expect(result.sheets[0]).toMatchObject({ duplicateRowCount: 0, duplicateRowsCompared: 0 });
    expect(result.sheets[0]?.columns[0]).toMatchObject({
      distinctCount: 0,
      distinctCountExact: false,
      categories: [],
    });
    expect(result.warnings).toContain("cell_text_truncated");
  });

  test("decoded UTF-8 bytes stop work before the row cap", () => {
    const result = profileDataset(
      dataset(
        Array.from({ length: 500 }, () => Array.from({ length: 30 }, () => cell("界".repeat(512)))),
      ),
    );
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.rowCount).toBeLessThan(50);
    expect(result.warnings).toContain("decoded_bytes_truncated");
  });

  test("output cap omits whole sheets with a warning instead of returning half a profile", () => {
    const rows = Array.from({ length: 20 }, (_, row) =>
      Array.from({ length: 30 }, (_, col) => cell(`${row}:${col}:${"x".repeat(450)}`)),
    );
    const result = profileDataset(dataset(rows));
    expect(result.sheets).toEqual([]);
    expect(result.warnings).toContain("output_truncated");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(
      DATA_PROFILE_LIMITS.outputBytes,
    );
  });

  test("rejects contradictory parser coverage and accepts empty workbook", () => {
    const input = dataset([[cell(1)]]);
    expect(() =>
      profileDataset({ ...input, sheets: [{ ...input.sheets[0], totalRows: 0 }] }),
    ).toThrow("DATA_COVERAGE_INVALID");
    expect(profileDataset({ ...input, sheets: [] })).toMatchObject({
      sheets: [],
      rowCount: 0,
      truncated: false,
    });
  });
});
