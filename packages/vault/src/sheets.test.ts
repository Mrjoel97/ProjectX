import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SHEET_COLS_CAP, SHEET_COUNT_CAP, SHEET_ROWS_CAP, sheetRows, sheetsToXlsx } from "./sheets";

/**
 * The two functions are each other's fixture: `sheetsToXlsx` writes a REAL .xlsx and `sheetRows`
 * reads it back, so the round trip is the test and no binary is committed. (xlsText.test.ts builds
 * its BIFF fixtures the same way — the writer has always been the fixture tool; Phase 40 is the
 * first time it is also production.)
 */
const roundTrip = (sheets: { name: string; rows: string[][] }[]) => sheetRows(sheetsToXlsx(sheets));

const SALES = [
  ["Region", "Revenue", "Margin"],
  ["North", "152340.5", "0.31"],
  ["South", "98120", "0.27"],
];

describe("sheetRows", () => {
  test("a written workbook reads back as its sheets, names, header row and cell text", () => {
    const { sheets, sheetCount } = roundTrip([
      { name: "Sales", rows: SALES },
      {
        name: "Costs",
        rows: [
          ["Item", "Amount"],
          ["Rent", "1200"],
        ],
      },
    ]);

    expect(sheetCount).toBe(2);
    expect(sheets.map((s) => s.name)).toEqual(["Sales", "Costs"]);
    expect(sheets[0]?.rows[0]).toEqual(["Region", "Revenue", "Margin"]); // row 0 IS the header
    expect(sheets[0]?.rows[1]).toEqual(["North", "152340.5", "0.31"]);
    expect(sheets[0]?.totalRows).toBe(3);
    // Every cell is a string: the grid renders display text, never a typed value (the ceiling).
    for (const cell of sheets.flatMap((s) => s.rows.flat())) expect(typeof cell).toBe("string");
  });

  test("rows are capped and `totalRows` tells the truth about what was dropped", () => {
    const rows = Array.from({ length: SHEET_ROWS_CAP + 50 }, (_, i) => [`r${i}`, String(i)]);
    const { sheets } = roundTrip([{ name: "Long", rows }]);

    expect(sheets[0]?.rows).toHaveLength(SHEET_ROWS_CAP);
    expect(sheets[0]?.totalRows).toBe(SHEET_ROWS_CAP + 50); // the honesty field, not the length
    expect(sheets[0]?.rows.at(-1)?.[0]).toBe(`r${SHEET_ROWS_CAP - 1}`); // the FIRST N, in order
  });

  test("columns are capped per row and sheets are capped in count", () => {
    const wide = [Array.from({ length: SHEET_COLS_CAP + 10 }, (_, i) => `c${i}`)];
    const many = Array.from({ length: SHEET_COUNT_CAP + 3 }, (_, i) => ({
      name: `S${i}`,
      rows: [["a"]],
    }));

    expect(roundTrip([{ name: "Wide", rows: wide }]).sheets[0]?.rows[0]).toHaveLength(
      SHEET_COLS_CAP,
    );
    const capped = roundTrip(many);
    expect(capped.sheets).toHaveLength(SHEET_COUNT_CAP);
    expect(capped.sheetCount).toBe(SHEET_COUNT_CAP + 3); // the workbook's real total, uncapped
  });

  test("a container SheetJS should never be handed throws instead of inventing a sheet", () => {
    // The xlsText gate, and the reason it exists: handed noise, SheetJS falls back to a DSV parser
    // and returns a one-cell "sheet" made of arbitrary bytes.
    const noise = Uint8Array.from({ length: 64 }, (_, i) => i % 2);
    expect(() => sheetRows(noise)).toThrow(/sheets_parse_failed: not a workbook container/);
    expect(() => sheetRows(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toThrow(
      /not a workbook container \(pdf\)/,
    );
  });

  test("an empty workbook is a preview with no sheets, NOT an error", () => {
    // A user can upload an empty workbook; the document still ingests, it just has no grid.
    const { sheets, sheetCount } = roundTrip([{ name: "Blank", rows: [] }]);
    expect(sheets).toEqual([]);
    expect(sheetCount).toBe(1);
  });
});

describe("sheetsToXlsx", () => {
  test("sheet names are sanitised to Excel's rules and de-duplicated", () => {
    const { sheets } = roundTrip([
      { name: "Q3 [draft]: prices/margins *final*?", rows: [["a"]] },
      { name: "A".repeat(60), rows: [["b"]] },
      { name: "Prices", rows: [["c"]] },
      { name: "Prices", rows: [["d"]] },
      { name: "   ", rows: [["e"]] },
    ]);

    const names = sheets.map((s) => s.name);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[[\]:*?/\\]/);
      expect(name.trim()).not.toBe("");
    }
    // Illegal characters become spaces, runs of whitespace collapse, the ends are trimmed.
    expect(names[0]).toBe("Q3 draft prices margins final");
    expect(names[2]).toBe("Prices");
    expect(names[3]).toBe("Prices 2"); // the duplicate gets a suffix, never a lost sheet
    expect(names[4]).toBe("Sheet 5"); // a blank name falls back to its position
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  test("no sheets is a refusal, and the bytes are byte-stable across calls", () => {
    expect(() => sheetsToXlsx([])).toThrow(/xlsx_write_failed: no sheets/);
    const once = sheetsToXlsx([{ name: "Sales", rows: SALES }]);
    const twice = sheetsToXlsx([{ name: "Sales", rows: SALES }]);
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(true); // epoch-pinned Props
    expect(once.byteLength).toBeGreaterThan(0);
  });
});

describe("sheets source contract", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sheets.ts"), "utf8");
  // Scan CODE, not prose: the header deliberately spells out the banned `await import("xlsx")`
  // form, and a naive scan matches that comment and goes red on a correct file (the xlsText
  // lesson).
  const code = src.replace(/^\s*\/\/.*$/gm, "");

  test("SheetJS is a STATIC import — Pitfall 9 is a general rule, not a pdf-lib quirk", () => {
    expect(code).toMatch(/^import\s*\{[^}]*\}\s*from\s*["']xlsx["'];?$/m);
    expect(code).not.toMatch(/await\s+import\(\s*["']xlsx["']\s*\)/);
  });

  test("this module is NOT on the @pikar/vault barrel — SheetJS stays out of the V8 bundle", () => {
    const barrel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, "");
    expect(barrel).not.toMatch(/["']\.\/sheets["']/);
  });
});
