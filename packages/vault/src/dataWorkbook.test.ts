import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { utils, write } from "xlsx";
import { DATA_WORKBOOK_LIMITS, readDataWorkbook } from "./dataWorkbook";

function workbookBytes() {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["Amount", "Date"],
    [12, new Date("2026-09-10T00:00:00Z")],
    [-4, null],
  ]);
  sheet.C2 = { t: "n", v: 42, f: "6*7" };
  sheet.C3 = { t: "n", f: 'WEBSERVICE("https://example.test")' };
  sheet.D2 = { t: "s", v: "link", l: { Target: "https://example.test" } };
  sheet["!ref"] = "A1:D3";
  utils.book_append_sheet(workbook, sheet, "Facts");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["Second"], [true]]), "Other");
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx", cellDates: true }));
}

describe("typed bounded workbook reader", () => {
  test("XLSX retains numeric/date/formula cache types and never follows links", () => {
    const result = readDataWorkbook(workbookBytes(), "xlsx", true);
    expect(result.totalSheets).toBe(2);
    expect(result.sheets[0]?.rows[1]?.[0]?.value).toBe(12);
    expect(result.sheets[0]?.rows[1]?.[1]?.value).toBeInstanceOf(Date);
    expect(result.sheets[0]?.rows[1]?.[2]).toMatchObject({ value: 42, formula: true });
    expect(result.sheets[0]?.rows[2]?.[2]).toMatchObject({ value: null, formula: true });
    expect(result.features.externalLinks).toBe(true);
  });

  test("CSV preserves identifiers, locale numbers and formula-like strings without coercion", () => {
    const result = readDataWorkbook(strToU8('id,amount,formula\n0012,"1,234",=2+2\n'), "csv", true);
    expect(result.sheets[0]?.rows[1]?.map((cell) => cell.value)).toEqual(["0012", "1,234", "=2+2"]);
    const unicode = readDataWorkbook(strToU8("場所,地域\n日本,Dar es Salaam\n"), "csv");
    expect(unicode.sheets[0]?.rows[1]?.[0]?.value).toBe("日本");
  });

  test("rejects format mismatches, invalid UTF-8, oversized files and declared zip bombs", () => {
    expect(() => readDataWorkbook(strToU8("not an xlsx"), "xlsx")).toThrow("DATA_FORMAT_MISMATCH");
    expect(() => readDataWorkbook(workbookBytes(), "csv")).toThrow("DATA_FORMAT_MISMATCH");
    expect(() => readDataWorkbook(new Uint8Array([65, 0xc0, 0xaf]), "csv")).toThrow();
    expect(() =>
      readDataWorkbook(new Uint8Array(DATA_WORKBOOK_LIMITS.fileBytes + 1), "csv"),
    ).toThrow("DATA_FILE_TOO_LARGE");
    const bomb = zipSync({
      "xl/worksheets/sheet1.xml": new Uint8Array(DATA_WORKBOOK_LIMITS.entryBytes + 1),
    });
    expect(() => readDataWorkbook(bomb, "xlsx")).toThrow("DATA_ARCHIVE_LIMIT");
    expect(() =>
      readDataWorkbook(strToU8(",".repeat(DATA_WORKBOOK_LIMITS.csvSeparators + 1)), "csv"),
    ).toThrow("DATA_PARSE_COMPLEXITY_LIMIT");
  });

  test("row/column/sheet parsing is capped before profile construction", () => {
    const workbook = utils.book_new();
    for (let i = 0; i < 6; i++) {
      const sheet = utils.aoa_to_sheet([[1]]);
      utils.sheet_add_aoa(sheet, [[2]], { origin: "AE510" });
      utils.book_append_sheet(workbook, sheet, `Sheet${i}`);
    }
    const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
    const result = readDataWorkbook(bytes, "xlsx");
    expect(result.sheets).toHaveLength(5);
    expect(result.totalSheets).toBe(6);
    expect(result.sheets[0]?.rows.length).toBeLessThanOrEqual(502);
    expect(result.sheets[0]?.rows[0]).toHaveLength(30);
    expect(result.features.parseLimited).toBe(true);
  });

  test("a sparse cell outside the parser row window cannot be reported as a fully inspected empty sheet", () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([]);
    utils.sheet_add_aoa(sheet, [["late value"]], { origin: "A1000" });
    utils.book_append_sheet(workbook, sheet, "Sparse");
    const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
    const result = readDataWorkbook(bytes, "xlsx");
    expect(result.features.parseLimited).toBe(true);
    expect(result.sheets[0]?.totalRows).toBeGreaterThan(result.sheets[0]?.rows.length ?? 0);
    expect(result.sheets[0]?.rows.flat().every((cell) => cell.value === null)).toBe(true);
  });
});
