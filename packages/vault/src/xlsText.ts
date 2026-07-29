// Legacy BIFF workbooks (.xls / .xlsb) via SheetJS.
//
// SUBPATH-ONLY, like officeText.ts — do NOT add this to the index barrel. officeText.ts is kept
// off the barrel to keep `fflate` (a few KB) structurally out of the V8 bundle; here the number is
// ~1 MB, so the rule matters more, not less. It enters exactly one Convex node action.
//
// Pitfall 9 — STATIC top-level import, NEVER `await import("xlsx")`. Convex bundles node actions
// with esbuild `platform: "node", format: "esm", splitting: true`, and across a dynamic-import
// CHUNK boundary esbuild cannot synthesise a CJS module's named exports: that is how
// `const { PDFDocument } = await import("pdf-lib")` destructured to `undefined` in production on
// 2026-07-26 while the offline suite stayed green (Node/vitest recover CJS named exports via
// cjs-module-lexer, so the broken production path is INVISIBLE offline).
// The 15.2-07 spike rebuilt this package under Convex's exact flags: SheetJS 0.20.3 survives BOTH
// forms (19 real named exports either way) because it ships an `exports` map with a real ESM build
// (`import` -> ./xlsx.mjs) — it is the `unpdf` case, not the `pdf-lib` case. Static stays anyway:
// it is the shape that was actually PROVEN, it costs nothing, and a version bump could drop the
// ESM build without a single test going red. `xlsText.test.ts` scans this file to enforce it.
//
// ponytail: only the READ path is used. SheetJS's writer ships in the same module and cannot be
// dropped without contortions; the tests use it to build fixtures, production never does.
import { read, utils } from "xlsx";
import { sniffContainer } from "./sniff";

/**
 * Text of a legacy `.xls` (BIFF/OLE2) or `.xlsb` workbook — headers AND numbers.
 *
 * Throws `xls_parse_failed: <reason>` on anything it cannot read, and on a workbook with no cell
 * values. Never returns `""`: an empty extraction that "succeeds" lands as a `ready` document with
 * 0 chars, which is a plausible failure and worse than a failure (the oleText rule).
 */
export function xlsText(bytes: Uint8Array): string {
  // TRUST BOUNDARY. `read()` guesses the format and falls back to a DSV/plain-text parser for
  // bytes it does not recognise, so 64 bytes of noise come back as a workbook holding ONE cell of
  // mojibake — non-empty, so it would pass `empty_extraction` and be stored as a `ready`
  // document. Measured, not theorised. Gate on the container magic first (sniffContainer is
  // dep-free and already on the barrel): OLE2 for .xls, ZIP for .xlsb.
  const container = sniffContainer(bytes);
  if (container !== "ole2" && container !== "zip") {
    throw new Error(`xls_parse_failed: not a workbook container (${container})`);
  }

  let wb: ReturnType<typeof read>;
  try {
    wb = read(bytes, { type: "array" });
  } catch {
    // Our own string, never SheetJS's — a parser message must not become a user-visible reason
    // and must not carry document content (§4).
    throw new Error("xls_parse_failed: unreadable workbook");
  }

  const parts: string[] = [];
  // The success signal is a COUNT of sheets that actually yielded content, not the truthiness of
  // the joined string — the 15.2-06 `okPages` rule. It is also why the `Sheet N` header is
  // emitted INSIDE the loop only for a sheet with content: officeText.ts:65/:74 emit theirs
  // unconditionally, which makes scaffolding-only output non-empty and defeats
  // `empty_extraction` (the false-ready family, plan 15.2-08). This file is not a third instance.
  let okSheets = 0;
  wb.SheetNames.forEach((name, i) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return;
    let body: string;
    try {
      // Rung 5: the installed dependency already handles the number/date/formula rendering that
      // is the entire reason it is here. Tab-separated + `Sheet N` matches officeText.ts's
      // xlsxText house style, so the downstream model sees one convention for all spreadsheets.
      body = utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false }).trim();
    } catch {
      return;
    }
    if (body.length === 0) return;
    okSheets++;
    parts.push(`Sheet ${i + 1}\n${body}`);
  });

  if (okSheets === 0) throw new Error("xls_parse_failed: no cell values");
  return parts.join("\n\n");
}

// ponytail ceilings, all MEASURED against SheetJS 0.20.3 rather than assumed:
// - DATES in a SheetJS-WRITTEN .xls surface as the Excel serial (46067), not "2/14/26", because
//   its BIFF8 writer emits no date number-format record; `cellDates: true` does not change it.
//   The same workbook as .xlsb/.xlsx renders the date. A REAL Excel-authored .xls was observed
//   2026-07-29: 31 numeric cells carried raw serial 46232 plus Excel's
//   `[$-F800]dddd\,\ mmmm\ dd\,\ yyyy` format record; this function emitted
//   "Wednesday, July 29, 2026" 31 times and the raw serial zero times. If another real file ever
//   emits serial dates, the upgrade path remains a per-cell `t === "d"` walk instead of
//   sheet_to_csv.
// - FORMULAE yield the cached value, and the .xls round-trip drops the formula string entirely.
// - MERGED CELLS render the value once and blanks for the spanned cells (sheet_to_csv default).
// - No cell/sheet cap: VAULT_EXTRACT_CHAR_CAP downstream is what bounds a huge workbook.
