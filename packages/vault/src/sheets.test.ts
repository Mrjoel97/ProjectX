import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
  SHEET_COLS_CAP,
  SHEET_COUNT_CAP,
  SHEET_ROWS_CAP,
  SHEETS_BYTES_CAP,
  sheetRows,
  sheetsToXlsx,
} from "./sheets";

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
    expect(sheets[0]?.totalCols).toBe(3); // the width, so a cut one can be announced
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

    const cut = roundTrip([{ name: "Wide", rows: wide }]).sheets[0];
    expect(cut?.rows[0]).toHaveLength(SHEET_COLS_CAP);
    // The honesty field for the OTHER axis: without it the grid announces a row cap and implies
    // the columns are whole.
    expect(cut?.totalCols).toBe(SHEET_COLS_CAP + 10);
    const capped = roundTrip(many);
    expect(capped.sheets).toHaveLength(SHEET_COUNT_CAP);
    expect(capped.sheetCount).toBe(SHEET_COUNT_CAP + 3); // the workbook's real total, uncapped
  });

  test("a LYING <dimension> cannot make the read walk a range the file does not have", () => {
    // THE ONE THAT BOUNDS THE WORK, not the output. Excel routinely writes a used-range far larger
    // than the cells present; SheetJS trusts that header unless `nodim` is set, and then walks every
    // declared row. `blankrows: false` hides the damage — the RESULT stays two rows while the read
    // takes seconds and, at Excel's full 1,048,576-row range, hours inside an action whose
    // try/catch cannot catch a hang. MUTATION that turns this RED: drop `nodim: true` in sheets.ts.
    const bytes = sheetsToXlsx([{ name: "Sales", rows: SALES }]);
    const entries = unzipSync(bytes);
    const sheetPath = Object.keys(entries).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k));
    expect(sheetPath, "fixture shape changed").toBeTruthy();
    const xml = strFromU8(entries[sheetPath as string] as Uint8Array);
    expect(xml, "fixture has no dimension to lie with").toMatch(/<dimension ref="[^"]+"/);
    const lied = new TextEncoder().encode(
      xml.replace(/<dimension ref="[^"]+"/, '<dimension ref="A1:XFD400"'),
    );
    entries[sheetPath as string] = lied;

    const doctored = zipSync(entries);
    const started = Date.now();
    const { sheets } = sheetRows(doctored);
    const elapsed = Date.now() - started;

    expect(sheets[0]?.totalRows).toBe(3); // the cells that EXIST, not the range that was claimed
    expect(elapsed, `walked the declared range (${elapsed} ms)`).toBeLessThan(1000);
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

  test("the byte cap drops whole sheets and counts UTF-8, not UTF-16 units", () => {
    // A cap named in BYTES that counted String.length admitted ~3x its bound for non-Latin text.
    // Two fat sheets of CJK: the first fits, the rest are dropped WHOLE, and sheetCount still
    // reports the workbook's real total.
    const fat = () =>
      Array.from({ length: 60 }, () => Array.from({ length: 20 }, () => "会計データ".repeat(20)));
    const { sheets, sheetCount } = roundTrip([
      { name: "A", rows: fat() },
      { name: "B", rows: fat() },
      { name: "C", rows: fat() },
    ]);

    expect(sheetCount).toBe(3); // the truth about the workbook
    expect(sheets.length).toBeLessThan(3); // ...and less than that was kept
    const stored = new TextEncoder().encode(JSON.stringify(sheets)).length;
    expect(stored).toBeLessThanOrEqual(SHEETS_BYTES_CAP);
    for (const s of sheets) expect(s.rows.length).toBe(60); // whole sheets, never a half one
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

  test("names SheetJS itself REFUSES are rewritten, not passed through", () => {
    // `book_append_sheet` THROWS on the reserved name and on an outer apostrophe, and a throw here
    // fails the whole deliverable. "## History" above an order table is exactly what this format is
    // advertised for. MUTATION: drop either rule from safeSheetName and this goes red.
    const { sheets } = roundTrip([
      { name: "History", rows: [["a"]] },
      { name: "'23 Results'", rows: [["b"]] },
      { name: "Summary: 'top line'", rows: [["c"]] },
    ]);
    expect(sheets).toHaveLength(3);
    for (const s of sheets) {
      expect(s.name.toLowerCase()).not.toBe("history");
      expect(s.name.startsWith("'")).toBe(false);
      expect(s.name.endsWith("'")).toBe(false);
    }
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
