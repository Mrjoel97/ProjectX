---
phase: 40-document-canvas
plan: 01
status: complete
completed: 2026-09-06
commits: [see the phase-close commit — feat(40-01)]
requirements-completed: []
requirements-pending: [DOC-01]
---

# 40-01 — Sheet grids: structured rows at ingest, rendered in the vault preview

**Measured before (2026-09-06, tree `4b8fe5b`).** A workbook reached the reader as a `<pre>` of
tab-separated text. XLSX/XLSM were flattened by a home-grown fflate + regex walk keeping only cached
`<v>` values, cells joined by tabs, sheets labelled `Sheet 1`, `Sheet 2` **by file number** — sheet
names, cell types, number formats and merges all dropped. Legacy `.xls`/`.xlsb` went through SheetJS
`sheet_to_csv` to the same shape, and ODS through `content.xml`. `previewState` gives the native
viewer to `image/*`, `video/*` and exactly `application/pdf`, so a workbook landed in `ready-text`
with a 1,500-char excerpt that cuts mid-row. The SheetJS **writer** had shipped inside
`@pikar/vault` since 15.2 with zero production callers.

**Owner decision (2026-09-06):** structured rows written at ingest — not the text projection, not a
re-parse on demand.

**What changed.**
- **`packages/vault/src/sheets.ts`** (new, subpath-only, static SheetJS import per Pitfall 9):
  `sheetRows(bytes)` gates on the container (`ole2|zip`, the xlsText rule — handed noise SheetJS
  falls back to a DSV parser and invents a sheet), then `sheet_to_json({header:1, raw:false})` per
  sheet for **display text**, capped at `SHEET_ROWS_CAP` 200 rows, `SHEET_COLS_CAP` 30 columns,
  `SHEET_COUNT_CAP` 10 sheets and `SHEETS_BYTES_CAP` 256 KiB of JSON at **whole-sheet granularity**
  (a sheet that would cross the line is dropped entirely — half a row in a grid reads as data).
  Returns `{sheets:[{name, rows, totalRows}], sheetCount}` where `sheetCount` is the workbook's real
  total. An empty workbook returns zero sheets rather than throwing. `sheetsToXlsx(sheets)` is the
  writer half — Excel's own name rules (≤31 chars, no `[]:*?/\`, de-duplicated), epoch-pinned
  `Props` so the bytes are stable, throws on zero sheets. The module finally uses the writer that
  `xlsText.ts`'s `ponytail:` note said production never called.
- **`vaultSheets` table** (`schema.ts`): one row per spreadsheet document, `by_doc` and `by_tenant`.
  A SEPARATE table by design — the vault grid's read bound counts `vaultDocuments.text` bytes to
  stay under Convex's 16 MiB per-transaction cap, so a second large blob on that row would slip past
  a bound that cannot see it. Classified `tenant_owned` in `@pikar/core` `tenantData.ts`, which is a
  promise the tenant can export and delete it — and both walkers reach owned tables through
  `by_tenant`, so that index is what keeps the promise true rather than a comment.
- **`vault.ts`:** `internal.vault.upsertSheets` (replace-by-doc, so a Retry that re-runs the whole
  rail leaves one row; zero sheets DELETES the row rather than storing an empty grid — one empty
  state, not two) and `api.vault.vaultDocSheets` (tenantQuery, one document, null on miss like
  `vaultDocText`). `deleteVaultDoc` now deletes the grid with its document.
- **`vaultExtract.ts`:** `extractOfficeText` returns `{text, kind}` (additive — every caller reads
  `.text`), so the rail knows a zip was a **spreadsheet** rather than guessing from the text it
  produced. The grid is written AFTER `ingestExtractedText`, inside its own try: a failed structured
  read leaves no row and never fails the document, because the text projection is the artifact of
  record and has already succeeded. Cells never reach the audit (§4) — the success row still carries
  the rail and the char count only.
- **Web:** `SheetGrid.tsx` (new) renders one titled table per sheet reusing `MarkdownDocument`'s
  markup and CSS (`.markdown-document`, `.markdown-table-scroll`, `<th scope="col">`), so BRAND §4's
  "never dense tables-on-white" holds the way §5 defines it — a structured report inside a card,
  ruled, no gridlines. Read-only by construction (no button, no link, no onClick). Every ceiling is
  stated **in words**, never colour (§6): "Showing the first 200 of 1,240 rows — download the
  original for the rest" and "3 more sheets are not shown". `PreviewModal` asks for the grid only
  when the row is a spreadsheet, through `isSpreadsheet(mime)` living BESIDE `binaryMediaKind`, never
  inside it — that function answers "can the browser display these bytes", and for a workbook the
  answer is still no, so `previewState.test.ts`'s "only application/pdf gets the viewer" pin holds
  by construction.

**Verified.** `packages/vault` 184/184 (9 new in `sheets.test.ts`: the two functions are each
other's fixture, so a written workbook read back proves both; caps and `totalRows`; the container
refusal; an empty workbook; name sanitising and de-duplication; byte stability; the static-import
and not-on-the-barrel source scans). Backend `vaultExtract` 52/52 (4 new: a real `.xlsx` lands a
grid with sheet NAMES and the header row; a DOCX gets none; a workbook SheetJS cannot read still
ingests with no grid; a second run replaces rather than duplicates) and `vault` 45/45 (3 new: the
tenant guard reads null for a stranger, re-writing replaces, deleting the document deletes the
grid). Web vault 56/56 including 5 new `sheetGrid` tests and a token-only source scan. Both
typechecks clean.

**A nine-agent adversarial review ran over the committed diff and found real defects — the suite was
green for all of them.** Six dimension reviewers, three skeptics who had to refute each finding: 30 of
40 candidates confirmed, fixed in the follow-up commit. The one that mattered most is in this plan's
module: `sheetRows` capped its OUTPUT and not its WORK. A sheet's `<dimension ref>` is self-declared
and SheetJS trusts it, so `sheet_to_json` walked the whole declared range while `blankrows: false`
hid the damage — the result stayed two rows and no cap fired. Measured on one 5.7 KB workbook whose
header was rewritten by hand: A1:B2 = 25 ms, A1:XFD400 = 5.8 s, linear, so Excel's routine used-range
bloat extrapolates to HOURS inside an action whose try/catch cannot catch a hang. `nodim: true` fixes
it; removing the flag now makes the new test take 5,095 ms and go red. Also fixed here: sheet names
SheetJS itself refuses (`History`, outer apostrophes) that would have thrown and failed the whole
deliverable; the byte cap counting UTF-16 units; the silent column truncation (now `totalCols`, stated
in words beside the row cap); `upsertSheets` writing a grid for a document that was deleted mid-parse;
and an `.ods` denied a grid by a discriminator the preview already contradicted.

**Deliberately not done.** Sheet names or types in the TEXT projection (unchanged and pinned —
downstream RAG/ground/digest consumers treat it as opaque), client-side SheetJS, re-parse on demand,
CSV as a workbook (it is decoded as text at upload and never touches the walkers).
