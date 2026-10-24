import { describe, expect, it } from "vitest";
import {
  compileWorkbookReport,
  reportFromSheets,
  validateWorkbookReport,
  type WorkbookReport,
} from "./workbookReport";

const monthlyReport = (): WorkbookReport => ({
  version: 1,
  title: "Monthly business review",
  subtitle: "Synthetic example · TZS · October 2026",
  sources: [
    {
      id: "sales",
      label: "Sales ledger",
      reference: "vault:synthetic-sales",
      note: "Owned test data",
    },
  ],
  sheets: [
    {
      name: "Sales & costs",
      columns: [
        { key: "month", label: "Month", type: "string" },
        { key: "id", label: "Account ID", type: "string" },
        { key: "date", label: "Period", type: "date" },
        {
          key: "revenue",
          label: "Revenue (TZS)",
          type: "number",
          format: "currency",
          currency: "TZS",
        },
        { key: "costs", label: "Costs (TZS)", type: "number", format: "currency", currency: "TZS" },
        {
          key: "profit",
          label: "Profit (TZS)",
          type: "number",
          format: "currency",
          currency: "TZS",
        },
        { key: "margin", label: "Margin", type: "number", format: "percent" },
        { key: "approved", label: "Approved", type: "boolean" },
      ],
      rows: [
        {
          cells: [
            "September",
            "00142",
            { date: "2026-09-30" },
            120000,
            75000,
            {
              calculation: {
                op: "difference",
                refs: [
                  { sheet: "Sales & costs", row: 0, column: "revenue" },
                  { sheet: "Sales & costs", row: 0, column: "costs" },
                ],
              },
            },
            {
              calculation: {
                op: "ratio",
                refs: [
                  { sheet: "Sales & costs", row: 0, column: "profit" },
                  { sheet: "Sales & costs", row: 0, column: "revenue" },
                ],
              },
            },
            true,
          ],
          sourceIds: ["sales"],
        },
        {
          cells: [
            "October",
            "00143",
            { date: "2026-10-31" },
            180000,
            100000,
            {
              calculation: {
                op: "difference",
                refs: [
                  { sheet: "Sales & costs", row: 1, column: "revenue" },
                  { sheet: "Sales & costs", row: 1, column: "costs" },
                ],
              },
            },
            {
              calculation: {
                op: "ratio",
                refs: [
                  { sheet: "Sales & costs", row: 1, column: "profit" },
                  { sheet: "Sales & costs", row: 1, column: "revenue" },
                ],
              },
            },
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
                  { sheet: "Sales & costs", row: 0, column: "revenue" },
                  { sheet: "Sales & costs", row: 1, column: "revenue" },
                ],
              },
            },
          ],
        },
        {
          cells: [
            "Average revenue",
            {
              calculation: {
                op: "average",
                refs: [
                  { sheet: "Sales & costs", row: 0, column: "revenue" },
                  { sheet: "Sales & costs", row: 1, column: "revenue" },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
  chart: {
    title: "Revenue by month",
    sheet: "Sales & costs",
    categoryColumn: "month",
    valueColumn: "revenue",
    type: "column",
  },
});

describe("bounded workbook report", () => {
  it("compiles supported operations independently and retains provenance and typed raw values", () => {
    const report = compileWorkbookReport(monthlyReport());
    expect(report.sheets[0]!.rows[0]!.cells.map((cell) => cell.value)).toEqual([
      "September",
      "00142",
      { date: "2026-09-30" },
      120000,
      75000,
      45000,
      0.375,
      true,
    ]);
    expect(report.sheets[0]!.rows[1]!.cells[5]!.value).toBe(80000);
    expect(report.sheets[1]!.rows.map((row) => row.cells[1]!.value)).toEqual([300000, 150000]);
    expect(report.sheets[0]!.rows[0]!.sourceIds).toEqual(["sales"]);
  });

  it.each([
    [
      "unrecognized formula",
      (report: WorkbookReport) =>
        Object.assign(report.sheets[0]!.rows[0]!.cells[5]!, {
          formula: 'WEBSERVICE("https://bad.example")',
        }),
    ],
    [
      "wrong primitive type",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = "120000";
      },
    ],
    [
      "nonfinite number",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = Number.POSITIVE_INFINITY;
      },
    ],
    [
      "invalid day",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[2] = { date: "2026-02-30" };
      },
    ],
    [
      "ambiguous date",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[2] = { date: "10/11/2026" };
      },
    ],
    [
      "future reference",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = {
          calculation: { op: "sum", refs: [{ sheet: "Sales & costs", row: 1, column: "revenue" }] },
        };
      },
    ],
    [
      "self reference",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = {
          calculation: { op: "sum", refs: [{ sheet: "Sales & costs", row: 0, column: "revenue" }] },
        };
      },
    ],
    [
      "missing reference",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = {
          calculation: {
            op: "sum",
            refs: [{ sheet: "[external.xlsx]Sheet1", row: 0, column: "a" }],
          },
        };
      },
    ],
    [
      "division by zero",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = 0;
      },
    ],
    [
      "unknown source",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.sourceIds = ["unknown"];
      },
    ],
    [
      "duplicate sheet",
      (report: WorkbookReport) => {
        report.sheets[1]!.name = "SALES & COSTS";
      },
    ],
    [
      "reserved sheet",
      (report: WorkbookReport) => {
        report.sheets[1]!.name = "_Charts";
      },
    ],
    [
      "invalid currency format",
      (report: WorkbookReport) => {
        report.sheets[0]!.columns[3]!.currency = 'A"B';
      },
    ],
    [
      "row cap",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows = Array(2001).fill(report.sheets[0]!.rows[0]);
      },
    ],
    [
      "column cap",
      (report: WorkbookReport) => {
        report.sheets[0]!.columns = Array(31).fill(report.sheets[0]!.columns[0]);
      },
    ],
    [
      "text cap",
      (report: WorkbookReport) => {
        report.title = "x".repeat(201);
      },
    ],
    [
      "unknown chart column",
      (report: WorkbookReport) => {
        report.chart!.valueColumn = "not-found";
      },
    ],
    [
      "missing chart value",
      (report: WorkbookReport) => {
        report.sheets[0]!.rows[0]!.cells[3] = null;
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const report = monthlyReport();
    mutate(report);
    expect(() => compileWorkbookReport(report)).toThrow("workbook_report_invalid");
  });

  it("fails closed on cyclic/unsupported schema without evaluating code", () => {
    const input: Record<string, unknown> = { version: 1, title: "Report" };
    input.sheets = input;
    expect(() => validateWorkbookReport(input)).toThrow("workbook_report_invalid");
    expect(() => validateWorkbookReport({ ...monthlyReport(), macro: "arbitrary" })).toThrow(
      "unsupported field",
    );
  });

  it("keeps model totals as inputs and conservatively upgrades existing string tables", () => {
    const report = reportFromSheets(
      [
        {
          name: "History",
          rows: [
            [
              "Month",
              "Account ID",
              "Revenue (TZS)",
              "Margin",
              "Date",
              "Approved",
              "Unknown $",
              "Grouped",
              "Mixed",
            ],
            ["October", "00123", "1200.50", "25%", "2026-10-31", "true", "$12", "1,000", "12"],
            [
              "Total",
              "00456",
              "1200.50",
              "30%",
              "2026-11-30",
              "false",
              "$13",
              "1,100",
              "unavailable",
            ],
          ],
        },
      ],
      "Example",
    );
    expect(report.sheets[0]!.name).toBe("History data");
    expect(report.sheets[0]!.columns.map((column) => column.type)).toEqual([
      "string",
      "string",
      "number",
      "number",
      "date",
      "boolean",
      "string",
      "string",
      "string",
    ]);
    expect(report.sheets[0]!.rows[0]!.cells).toEqual([
      "October",
      "00123",
      1200.5,
      0.25,
      { date: "2026-10-31" },
      true,
      "$12",
      "1,000",
      "12",
    ]);
    expect(report.sheets[0]!.rows[1]!.cells[2]).toBe(1200.5);
    expect(report.chart).toBeUndefined(); // A total is not a peer category of its component rows.
  });

  it("keeps leading-zero numeric data and mixed percents as text; handles ragged rows and safe names", () => {
    const report = reportFromSheets([
      {
        name: "A/B",
        rows: [
          ["Code", "Leading", "Mixed percent"],
          ["A", "00123", "20%"],
          ["B", "00456", "0.2"],
        ],
      },
      { name: "A:B", rows: [["Label"], ["value", "extra"]] },
      { name: "_Sources", rows: [["Name"], ["value"]] },
    ]);
    expect(report.sheets.map((sheet) => sheet.name)).toEqual(["A B", "A B 2", "_Sources data"]);
    expect(report.sheets[0]!.columns.every((column) => column.type === "string")).toBe(true);
    expect(report.sheets[1]!.columns[1]!.label).toBe("Column 2");
  });

  it("preserves precision-sensitive identifiers and does not invent currency from uppercase headings", () => {
    const report = reportFromSheets([
      {
        name: "Precision",
        rows: [
          ["Reference", "NET SALES", "Revenue (USD)"],
          ["12345678901234567", "1234.5", "1234.5"],
        ],
      },
    ]);
    expect(report.sheets[0]!.rows[0]!.cells[0]).toBe("12345678901234567");
    expect(report.sheets[0]!.columns[1]).toMatchObject({ type: "number", format: "decimal" });
    expect(report.sheets[0]!.columns[1]!.currency).toBeUndefined();
    expect(report.sheets[0]!.columns[2]).toMatchObject({
      type: "number",
      format: "currency",
      currency: "USD",
    });
  });
});
