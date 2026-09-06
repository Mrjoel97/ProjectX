import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetGrid } from "./SheetGrid";

const PRICES = {
  name: "Prices",
  rows: [
    ["Item", "Unit price (USD)"],
    ["Setup", "500"],
    ["Monthly", "120"],
  ],
  totalRows: 3,
};
/** A sheet the ingest cap truncated: 200 of 1,240 rows. */
const LONG = {
  name: "Transactions",
  rows: Array.from({ length: 200 }, (_, i) => [`row ${i}`, String(i)]),
  totalRows: 1240,
};

const render = (sheets: (typeof PRICES)[], sheetCount: number) =>
  renderToStaticMarkup(createElement(SheetGrid, { sheets, sheetCount }));

describe("SheetGrid", () => {
  it("renders one titled table per sheet, header row as column headers", () => {
    const html = render([PRICES, LONG], 2);

    expect(html.match(/<table>/g)).toHaveLength(2);
    expect(html).toContain(">Prices</p>");
    expect(html).toContain(">Transactions</p>");
    expect(html).toContain('<th scope="col">Item</th>'); // row 0 IS the header
    expect(html).toContain('<th scope="col">Unit price (USD)</th>');
    expect(html).toContain("<td>Setup</td>");
    expect(html).toContain('class="markdown-table-scroll"'); // the shipped table CSS, not a new one
    // Read-only: the download lives in the modal's controls, never in the grid.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it("says in WORDS how many rows a capped sheet is showing, and only for the capped one", () => {
    const html = render([PRICES, LONG], 2);

    expect(html).toMatch(/Showing the first 200 of 1,240 rows/);
    expect(html.match(/Showing the first/g)).toHaveLength(1); // never on an uncapped sheet
  });

  it("announces a cut WIDTH too — a rows-only caption implies the columns are whole", () => {
    // MUTATION that turns this RED: drop the totalCols clause from SheetGrid's caption.
    const wide = {
      name: "CRM export",
      rows: [Array.from({ length: 30 }, (_, i) => `c${i}`), Array.from({ length: 30 }, () => "x")],
      totalRows: 2,
      totalCols: 45,
    };
    const html = render([wide], 1);

    expect(html).toMatch(/the first 30 of 45 columns/);
    // The sheet is not row-capped, so the sentence must still be about what WAS cut.
    expect(html).toMatch(/Showing the first 2 of 2 rows and the first 30 of 45 columns/);
  });

  it("says how many sheets are missing, with the plural right, and nothing when none are", () => {
    expect(render([PRICES], 4)).toMatch(/3 more sheets are not shown/);
    expect(render([PRICES], 2)).toMatch(/1 more sheet is not shown/);
    expect(render([PRICES], 1)).not.toMatch(/more sheet/);
  });

  it("pads short rows so a ragged sheet keeps its columns aligned", () => {
    const ragged = { name: "Ragged", rows: [["A", "B", "C"], ["1"]], totalRows: 2 };
    const html = render([ragged], 1);

    // Three headers, three cells in the body row — a missing cell is empty, never a shifted column.
    expect(html.match(/<th scope="col">/g)).toHaveLength(3);
    expect(html).toContain("<tr><td>1</td><td></td><td></td></tr>");
  });
});

describe("SheetGrid source contract", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SheetGrid.tsx"), "utf8");
  const code = src.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, "");

  it("uses BRAND tokens only — no hardcoded colour, and never the approval gate's amber", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
    expect(code).not.toMatch(/--held/); // BRAND §2: amber is the approval gate's ALONE
  });
});
