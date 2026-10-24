import type { WorkbookReport } from "@pikar/core/workbookReport";
import { reportFromSheets } from "@pikar/core/workbookReport";
import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { read } from "xlsx";
import { reportToXlsx } from "./reportWorkbook";

const fixture = (): WorkbookReport => ({
  version: 1,
  title: "October performance",
  subtitle: "Synthetic owned example · TZS",
  sources: [
    {
      id: "sales",
      label: "Sales ledger",
      reference: "vault:synthetic",
      note: "Synthetic owned data",
    },
  ],
  sheets: [
    {
      name: "Owner's sales",
      columns: [
        { key: "label", label: "Month", type: "string", width: 25 },
        {
          key: "revenue",
          label: "Revenue (TZS)",
          type: "number",
          format: "currency",
          currency: "TZS",
        },
        { key: "cost", label: "Costs (TZS)", type: "number", format: "currency", currency: "TZS" },
        {
          key: "profit",
          label: "Profit (TZS)",
          type: "number",
          format: "currency",
          currency: "TZS",
        },
        { key: "margin", label: "Margin", type: "number", format: "percent" },
        { key: "date", label: "Date", type: "date" },
        { key: "id", label: "Customer ID", type: "string" },
        { key: "ok", label: "Approved", type: "boolean" },
      ],
      rows: [
        {
          cells: [
            "September & <October>",
            120000,
            75000,
            {
              calculation: {
                op: "difference",
                refs: [
                  { sheet: "Owner's sales", row: 0, column: "revenue" },
                  { sheet: "Owner's sales", row: 0, column: "cost" },
                ],
              },
            },
            {
              calculation: {
                op: "ratio",
                refs: [
                  { sheet: "Owner's sales", row: 0, column: "profit" },
                  { sheet: "Owner's sales", row: 0, column: "revenue" },
                ],
              },
            },
            { date: "2026-09-30" },
            "00142",
            true,
          ],
          sourceIds: ["sales"],
        },
        {
          cells: [
            "October",
            180000,
            100000,
            80000,
            80000 / 180000,
            { date: "2026-10-31" },
            "00143",
            false,
          ],
        },
      ],
    },
    {
      name: "Summary",
      columns: [
        { key: "metric", label: "Metric", type: "string" },
        { key: "value", label: "Value (TZS)", type: "number", format: "currency", currency: "TZS" },
      ],
      rows: [
        {
          cells: [
            "Revenue total",
            {
              calculation: {
                op: "sum",
                refs: [
                  { sheet: "Owner's sales", row: 0, column: "revenue" },
                  { sheet: "Owner's sales", row: 1, column: "revenue" },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
  chart: {
    title: "Revenue <by> month & source",
    sheet: "Owner's sales",
    categoryColumn: "label",
    valueColumn: "revenue",
    type: "column",
  },
});

describe("rich XLSX report writer", () => {
  it("reopens real bytes with numeric/boolean/date/ID types and independently expected cached calculations", async () => {
    const bytes = await reportToXlsx(fixture());
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const workbook = read(bytes, { type: "array", cellDates: true, cellNF: true });
    expect(workbook.SheetNames).toEqual(["Owner's sales", "Summary", "_Sources", "_Charts"]);
    const sheet = workbook.Sheets["Owner's sales"]!;
    expect(sheet.B6).toMatchObject({ t: "n", v: 120000 });
    expect(sheet.C6).toMatchObject({ t: "n", v: 75000 });
    expect(sheet.D6).toMatchObject({
      t: "n",
      v: 45000,
      f: "'Owner''s sales'!B6-'Owner''s sales'!C6",
    });
    expect(sheet.E6).toMatchObject({ t: "n", v: 0.375, z: "0.0%;[Red](0.0%)" });
    expect(sheet.F6!.v.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(sheet.G6).toMatchObject({ t: "s", v: "00142" });
    expect(sheet.H6).toMatchObject({ t: "b", v: true });
    expect(workbook.Sheets.Summary!.B6).toMatchObject({
      t: "n",
      v: 300000,
      f: "SUM('Owner''s sales'!B6,'Owner''s sales'!B7)",
    });
    expect(workbook.Sheets._Sources!.C2!.v).toBe("vault:synthetic");
  });

  it("persists styles, widths, filters, frozen headers, source comments and print setup, verified by an independent reopen", async () => {
    const bytes = await reportToXlsx({ ...fixture(), chart: undefined });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Owner's sales")!;
    expect(sheet.getCell("A1").font).toMatchObject({
      size: 22,
      bold: true,
      color: { argb: "FFFFFFFF" },
    });
    expect(sheet.getCell("A5").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FF0B4F4A" },
    });
    expect(sheet.getCell("B6").numFmt).toContain('"TZS"');
    expect(sheet.getCell("A7").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFF8FAFC" },
    });
    expect(sheet.getColumn(1).width).toBe(25);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 5, showGridLines: false });
    expect(sheet.autoFilter).toBe("A5:H7");
    expect(sheet.pageSetup).toMatchObject({
      orientation: "landscape",
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "5:5",
      printArea: "A1:H7",
    });
    expect(sheet.getCell("A6").note).toBe("Source references: sales (see _Sources).");
    expect(sheet.getCell("D6").value).toEqual({
      formula: "'Owner''s sales'!B6-'Owner''s sales'!C6",
      result: 45000,
    });
  });

  it.each([
    "column",
    "line",
  ] as const)("writes a native %s chart with internal relationships, editable source ranges and real cached data", async (type) => {
    const report = fixture();
    report.chart!.type = type;
    const bytes = await reportToXlsx(report);
    const files = unzipSync(bytes);
    const text = (path: string) => strFromU8(files[path]!);
    const chart = text("xl/charts/chart1.xml");
    expect(chart).toContain(type === "column" ? "<c:barChart>" : "<c:lineChart>");
    expect(chart).toContain("Revenue &lt;by&gt; month &amp; source");
    expect(chart).toContain("September &amp; &lt;October&gt;");
    expect(chart).toContain("&apos;Owner&apos;&apos;s sales&apos;!$B$6:$B$7");
    expect(chart).toContain('<c:pt idx="0"><c:v>120000</c:v></c:pt>');
    expect(chart).toContain('<c:pt idx="1"><c:v>180000</c:v></c:pt>');
    expect(chart).toContain('<a:srgbClr val="009689"/>');
    expect(text("xl/worksheets/sheet4.xml")).toContain('<drawing r:id="rIdDrawing1"/>');
    expect(text("xl/worksheets/_rels/sheet4.xml.rels")).toContain(
      'Target="../drawings/drawing1.xml"',
    );
    expect(text("xl/drawings/drawing1.xml")).toContain('r:id="rIdChart1"');
    expect(text("xl/drawings/_rels/drawing1.xml.rels")).toContain('Target="../charts/chart1.xml"');
    expect(text("[Content_Types].xml")).toContain('PartName="/xl/charts/chart1.xml"');
    expect(Object.keys(files).some((path) => /externalLinks|vbaProject/.test(path))).toBe(false);
    expect(read(bytes, { type: "array" }).Sheets["Owner's sales"]!.B6!.v).toBe(120000);
  });

  it("upgrades the current string-table path and writes formula-looking strings as literal text", async () => {
    const report = reportFromSheets([
      {
        name: "Monthly sales",
        rows: [
          ["Month", "Revenue (TZS)", "Account ID", "Note"],
          ["October", "1234.50", "00123", '=WEBSERVICE("https://invalid.example")'],
          ["November", "1500", "00124", "@SUM(A1:A3)"],
        ],
      },
    ]);
    const workbook = read(await reportToXlsx(report), { type: "array" });
    expect(workbook.Sheets["Monthly sales"]!.B6).toMatchObject({ t: "n", v: 1234.5 });
    expect(workbook.Sheets["Monthly sales"]!.C6).toMatchObject({ t: "s", v: "00123" });
    expect(workbook.Sheets["Monthly sales"]!.D6).toMatchObject({
      t: "s",
      v: '=WEBSERVICE("https://invalid.example")',
    });
    expect(workbook.Sheets["Monthly sales"]!.D6!.f).toBeUndefined();
    expect(workbook.SheetNames).toContain("_Charts");
  });

  it("rejects unsupported inputs before generating a workbook", async () => {
    await expect(reportToXlsx({ ...fixture(), macros: "x" })).rejects.toThrow("unsupported field");
    const report = fixture();
    report.sheets[0]!.rows[0]!.cells[1] = Number.NaN;
    await expect(reportToXlsx(report)).rejects.toThrow("nonfinite number");
  });
});
