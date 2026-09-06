// biome-ignore-all lint/suspicious/noArrayIndexKey: a workbook grid is immutable display output
// (the MarkdownDocument precedent) — the whole grid is replaced at once, rows never reorder, and
// no cell carries component state.
"use client";

/**
 * Phase 40 (DOC-01): a workbook as sheets of rows — the grid the tab-separated text dump replaced.
 *
 * Read-only by construction: no buttons, no links, no onClick. Downloading the original is already
 * a control in `PreviewControls`, and BRAND §5's briefing rule (a card that must not act carries
 * zero interactive elements) applies here for the same reason.
 *
 * The markup is `MarkdownDocument`'s table verbatim (`.markdown-document` +
 * `.markdown-table-scroll` + `<th scope="col">`), so the grid inherits the shipped table CSS —
 * tinted header, `--rule` hairlines, its own horizontal scroll — and BRAND §4's "never dense
 * tables-on-white" is satisfied the way §5 says it is: a structured report inside a card, ruled,
 * no gridlines. No new component library (§8), no new CSS, no hardcoded colour.
 *
 * Every ceiling is stated IN WORDS, never by colour (§6): a capped sheet says how many rows it is
 * showing of how many, and a capped workbook says how many sheets it is not showing. Amber is the
 * approval gate's alone and appears nowhere here.
 */
export type SheetRowsView = { name: string; rows: string[][]; totalRows: number };

const count = (n: number): string => n.toLocaleString();

export function SheetGrid({ sheets, sheetCount }: { sheets: SheetRowsView[]; sheetCount: number }) {
  const hidden = sheetCount - sheets.length;
  return (
    <div className="markdown-document">
      {sheets.map((sheet, index) => {
        // Row 0 is the header row: that is the contract `sheetRows` and `markdownToSheets` both
        // write, and it is what the reader of a spreadsheet expects in row 1.
        const [header = [], ...body] = sheet.rows;
        const columns = Math.max(header.length, ...body.map((row) => row.length), 1);
        const cells = (row: string[]) => Array.from({ length: columns }, (_, i) => row[i] ?? "");
        return (
          <section key={`${sheet.name}-${index}`} style={{ marginBottom: "1.25rem" }}>
            <p className="caps-label" style={{ marginBottom: "0.5rem" }}>
              {sheet.name}
            </p>
            <div className="markdown-table-scroll">
              <table>
                <thead>
                  <tr>
                    {cells(header).map((cell, i) => (
                      <th key={i} scope="col">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {cells(row).map((cell, i) => (
                        <td key={i}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.rows.length < sheet.totalRows && (
              <p style={{ marginTop: "0.4rem", color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                Showing the first {count(sheet.rows.length)} of {count(sheet.totalRows)} rows —
                download the original for the rest.
              </p>
            )}
          </section>
        );
      })}
      {hidden > 0 && (
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          {hidden === 1 ? "1 more sheet is" : `${count(hidden)} more sheets are`} not shown —
          download the original to see {hidden === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}
