import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { utils, write } from "xlsx";
import { describe, expect, test } from "vitest";
import { xlsText } from "./xlsText";

/**
 * Every fixture is written by SheetJS itself (`write(wb, { bookType: "xls", type: "buffer" })`) —
 * the only way to get a REAL BIFF workbook into the suite without committing a binary.
 */
function workbook(sheets: Array<{ name: string; rows: unknown[][] }>) {
  const wb = utils.book_new();
  for (const { name, rows } of sheets) {
    utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), name);
  }
  return wb;
}

function xlsBytes(sheets: Array<{ name: string; rows: unknown[][] }>): Uint8Array {
  return new Uint8Array(write(workbook(sheets), { bookType: "xls", type: "buffer" }));
}

const SALES = [
  ["Region", "Revenue", "Margin"],
  ["North", 152340.5, 0.31],
  ["South", 98120, 0.27],
];

describe("xlsText", () => {
  test("numbers survive — the exact thing a text sweep silently loses", () => {
    // THE ASSERTION THE WHOLE DEPENDENCY EXISTS FOR. Legacy .xls stores numbers as binary
    // doubles, so a printable-run sweep (oleText) recovers the HEADERS and loses every VALUE —
    // it would pass the first half of this test and fail the second, landing a `ready`
    // spreadsheet with no data in it. That is a PLAUSIBLE failure, which is worse than a failure.
    const text = xlsText(xlsBytes([{ name: "Sales", rows: SALES }]));

    for (const header of ["Region", "Revenue", "Margin", "North", "South"]) {
      expect(text, `header "${header}" missing`).toContain(header);
    }
    for (const value of ["152340.5", "98120", "0.31", "0.27"]) {
      expect(text, `NUMBER ${value} missing — the parser degraded to header recovery`).toContain(
        value,
      );
    }
  });

  test("multiple sheets appear in sheet order under `Sheet N` headers (officeText house style)", () => {
    const text = xlsText(
      xlsBytes([
        { name: "First", rows: [["alpha", 11]] },
        { name: "Second", rows: [["beta", 22]] },
      ]),
    );

    expect(text).toContain("Sheet 1");
    expect(text).toContain("Sheet 2");
    expect(text.indexOf("Sheet 1")).toBeLessThan(text.indexOf("Sheet 2"));
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("beta"));
    expect(text).toContain("11");
    expect(text).toContain("22");
  });

  test("a sheet with NO cell values contributes NO `Sheet N` header", () => {
    // The `Slide N` / `Sheet N` false-ready family (officeText.ts:65 and :74 emit their header
    // UNCONDITIONALLY, so scaffolding-only output is non-empty and `empty_extraction` never
    // fires — plan 15.2-08). This file must not become the THIRD instance: the header is
    // emitted only for a sheet that actually yielded content, which is also why the empty-
    // workbook case below can throw at all.
    const text = xlsText(
      xlsBytes([
        { name: "Blank", rows: [[]] },
        { name: "Real", rows: [["gamma", 33]] },
      ]),
    );

    expect(text).not.toContain("Sheet 1");
    expect(text).toContain("Sheet 2");
    expect(text).toContain("gamma");
  });

  test("a formula cell yields its cached VALUE, not the formula string", () => {
    const wb = workbook([{ name: "Calc", rows: [["a", 2], ["b", 3]] }]);
    const ws = wb.Sheets.Calc;
    if (!ws) throw new Error("fixture sheet missing");
    ws.C1 = { t: "n", f: "B1+B2", v: 5 };
    ws["!ref"] = "A1:C2";
    const text = xlsText(new Uint8Array(write(wb, { bookType: "xls", type: "buffer" })));

    expect(text).toContain("5");
    expect(text, "the formula STRING must not reach the model as document text").not.toContain(
      "B1+B2",
    );
  });

  test("a date cell in a SheetJS-written .xls comes out as an Excel SERIAL — the observed ceiling", () => {
    // OBSERVED, NOT AN ASPIRATION. SheetJS's own BIFF8 WRITER does not emit a date number-format
    // record, so on read the cell is indistinguishable from a number and `sheet_to_csv` renders
    // the serial (46067), not "2/14/26". `cellDates: true` does NOT change this — measured.
    // The same workbook written as .xlsb/.xlsx DOES render "2/14/26", so this is a property of
    // the FIXTURE WRITER. Whether a real Excel-authored .xls (which does carry a format record)
    // renders as a date is NOT observed here — see the ponytail ceiling in xlsText.ts.
    const wb = workbook([{ name: "Dated", rows: [["when"]] }]);
    const ws = wb.Sheets.Dated;
    if (!ws) throw new Error("fixture sheet missing");
    ws.B1 = { t: "d", v: new Date(Date.UTC(2026, 1, 14)) };
    ws["!ref"] = "A1:B1";
    const text = xlsText(new Uint8Array(write(wb, { bookType: "xls", type: "buffer" })));

    expect(text).toContain("46067");
  });

  test("an .xlsb workbook also extracts with its numbers", () => {
    const bytes = new Uint8Array(
      write(workbook([{ name: "Sales", rows: SALES }]), { bookType: "xlsb", type: "buffer" }),
    );
    const text = xlsText(bytes);

    expect(text).toContain("Region");
    expect(text).toContain("152340.5");
    expect(text).toContain("98120");
  });

  test("an empty workbook THROWS rather than returning \"\"", () => {
    // Same rule as oleText: an empty extraction that "succeeds" becomes a `ready` document with
    // 0 chars. SheetJS reads an empty workbook happily and sheet_to_csv returns "" — measured —
    // so this guard is load-bearing, not defensive decoration.
    expect(() => xlsText(xlsBytes([{ name: "Empty", rows: [[]] }]))).toThrow(
      /xls_parse_failed: no cell values/,
    );
  });

  test("64 bytes of noise THROWS — SheetJS would otherwise return mojibake as a one-cell sheet", () => {
    // MEASURED HAZARD, and the reason this function sniffs the container before parsing:
    // `read()` falls back to its DSV/plain-text guesser for unrecognised bytes, so arbitrary
    // noise comes back as a workbook with ONE cell of mojibake — non-empty, so it would sail
    // past `empty_extraction` and be stored as a `ready` document. A plausible failure.
    const noise = new Uint8Array(64);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + 11) & 0xff;

    expect(() => xlsText(noise)).toThrow(/^xls_parse_failed: /);
  });

  test("a truncated workbook THROWS our own reason, never SheetJS's message (§4)", () => {
    const full = xlsBytes([{ name: "Sales", rows: SALES }]);
    const half = full.slice(0, Math.floor(full.length / 2));

    expect(() => xlsText(half)).toThrow(/^xls_parse_failed: /);
    // SheetJS's own message for this input is "Cannot set properties of undefined (setting
    // 'name')" — an SDK string must never become a user-visible failure reason.
    expect(() => xlsText(half)).not.toThrow(/Cannot set properties/);
  });

  test("deterministic: the same bytes give byte-identical output", () => {
    const bytes = xlsBytes([
      { name: "First", rows: SALES },
      { name: "Second", rows: [["x", 1]] },
    ]);

    expect(xlsText(bytes)).toBe(xlsText(bytes));
  });
});

describe("xlsText source contract", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "xlsText.ts"), "utf8");
  // Scan CODE, not prose: xlsText.ts's header deliberately spells out the banned
  // `await import("xlsx")` form so the next reader knows exactly what is forbidden, and a naive
  // scan matches that comment and goes red on a correct file. (vaultExtract.ts's pdf-lib scan
  // dodges this only because its comment happens not to quote the syntax.)
  const code = src.replace(/^\s*\/\/.*$/gm, "");

  test("SheetJS is a STATIC import — Pitfall 9 (pdf-lib) is a GENERAL rule, not a pdf-lib quirk", () => {
    // Convex bundles node actions with esbuild `platform: "node", format: "esm", splitting: true`.
    // Across a DYNAMIC-import chunk boundary esbuild cannot synthesise a CJS module's named
    // exports, so the namespace carries only `default` — which is exactly how `{ PDFDocument }`
    // destructured to undefined in production on 2026-07-26 while Node/vitest, which recover CJS
    // named exports via cjs-module-lexer, stayed GREEN the whole time.
    //
    // The 15.2-07 spike measured SheetJS under Convex's exact flags: it survives BOTH forms
    // (19 named exports either way) because 0.20.3 ships an `exports` map with a real ESM build
    // (`import` -> ./xlsx.mjs) — the `unpdf` case, not the `pdf-lib` case. The static form is
    // still mandatory here: it is the shape that was actually proven, it costs nothing, and a
    // future version bump could drop the ESM build without any test noticing.
    //
    // THIS SCAN IS THE LOCK. The next person to see a ~1 MB dependency will want to lazy-load it.
    expect(code, "SheetJS must NOT be dynamically imported").not.toMatch(
      /import\(\s*["']xlsx["']\s*\)/,
    );
    expect(code, "SheetJS must be a STATIC top-level import").toMatch(
      /^import\s*\{[^}]*\bread\b[^}]*\}\s*from\s*["']xlsx["'];?$/m,
    );
  });
});
