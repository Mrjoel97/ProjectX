/** Bounded, framework-independent report contract. No arbitrary spreadsheet formulas or code. */
export const WORKBOOK_REPORT_LIMITS = {
  sheets: 10,
  rowsPerSheet: 2_000,
  columns: 30,
  cells: 30_000,
  cellCharacters: 10_000,
  textCharacters: 1_000_000,
  sources: 100,
  calculationReferences: 2_000,
} as const;

export type ReportColumn = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "date";
  format?: "text" | "integer" | "decimal" | "percent" | "currency" | "date";
  currency?: string;
  width?: number;
};
export type ReportReference = { sheet: string; row: number; column: string };
export type ReportCalculation = {
  op: "sum" | "average" | "difference" | "ratio";
  refs: ReportReference[];
};
export type ReportValue = string | number | boolean | null | { date: string };
export type ReportCell = ReportValue | { calculation: ReportCalculation };
export type ReportSource = { id: string; label: string; reference?: string; note?: string };
export type ReportChart = {
  title: string;
  sheet: string;
  categoryColumn: string;
  valueColumn: string;
  type: "column" | "line";
};
export type WorkbookReport = {
  version: 1;
  title: string;
  subtitle?: string;
  sources?: ReportSource[];
  chart?: ReportChart;
  sheets: {
    name: string;
    columns: ReportColumn[];
    rows: { cells: ReportCell[]; sourceIds?: string[] }[];
  }[];
};
export type CompiledReportCell = { value: ReportValue; calculation?: ReportCalculation };
export type CompiledWorkbookReport = Omit<WorkbookReport, "sheets"> & {
  sheets: {
    name: string;
    columns: ReportColumn[];
    rows: { cells: CompiledReportCell[]; sourceIds?: string[] }[];
  }[];
};

const fail = (reason: string): never => {
  throw new Error(`workbook_report_invalid: ${reason}`);
};
const object = (value: unknown, fields: string[]): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail("expected object");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !fields.includes(key))) fail("unsupported field");
  return item;
};
const array = (value: unknown, min: number, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    return fail("array bounds");
  return value;
};
const member = <T extends string>(value: unknown, choices: readonly T[]): T => {
  if (typeof value !== "string" || !choices.includes(value as T)) return fail("unsupported value");
  return value as T;
};
const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  value >= "1900-01-01" &&
  value <= "9999-12-31" &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// biome-ignore lint/suspicious/noControlCharactersInRegex: These code points are forbidden in OOXML text.
const INVALID_XML_CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const IDENTIFIER_HEADER =
  /\b(id|identifier|code|sku|phone|zip|postal|account|reference|ref|iban|uuid)\b/i;
const CURRENCY_CODES = new Set(
  "TZS USD EUR GBP KES UGX ZAR NGN AED INR JPY CNY CAD AUD CHF NZD RWF XOF XAF GHS BWP EGP SAR QAR SGD HKD BRL MXN SEK NOK DKK PLN TRY KWD OMR BHD".split(
    " ",
  ),
);

/** Reject unsupported features and resource excess before the writer allocates a workbook. */
export function validateWorkbookReport(input: unknown): WorkbookReport {
  let characters = 0;
  const text = (value: unknown, max: number = WORKBOOK_REPORT_LIMITS.cellCharacters): string => {
    if (typeof value !== "string" || value.length > max || value.search(INVALID_XML_CONTROLS) >= 0)
      return fail("invalid text");
    characters += value.length;
    if (characters > WORKBOOK_REPORT_LIMITS.textCharacters) fail("text limit");
    return value;
  };
  const nonempty = (value: unknown, max: number): string => {
    const result = text(value, max);
    return result.trim() ? result : fail("empty label");
  };
  const root = object(input, ["version", "title", "subtitle", "sources", "sheets", "chart"]);
  if (root.version !== 1) fail("unsupported version");
  const report: WorkbookReport = { version: 1, title: nonempty(root.title, 200), sheets: [] };
  if (root.subtitle !== undefined) report.subtitle = text(root.subtitle, 500);
  const sourceIds = new Set<string>();
  if (root.sources !== undefined) {
    report.sources = array(root.sources, 0, WORKBOOK_REPORT_LIMITS.sources).map((value) => {
      const source = object(value, ["id", "label", "reference", "note"]);
      const id = nonempty(source.id, 100);
      if (sourceIds.has(id)) fail("duplicate source");
      sourceIds.add(id);
      return {
        id,
        label: nonempty(source.label, 200),
        ...(source.reference !== undefined ? { reference: text(source.reference, 2_000) } : {}),
        ...(source.note !== undefined ? { note: text(source.note, 2_000) } : {}),
      };
    });
  }
  const names = new Set<string>(["_sources", "_charts", "history"]);
  let cells = 0;
  let references = 0;
  report.sheets = array(root.sheets, 1, WORKBOOK_REPORT_LIMITS.sheets).map((value) => {
    const sheet = object(value, ["name", "columns", "rows"]);
    const name = nonempty(sheet.name, 31);
    if (/[[\]:*?/\\]/.test(name) || /^'|'$/.test(name) || names.has(name.toLowerCase()))
      fail("invalid or duplicate sheet name");
    names.add(name.toLowerCase());
    const keys = new Set<string>();
    const columns = array(sheet.columns, 1, WORKBOOK_REPORT_LIMITS.columns).map((value) => {
      const column = object(value, ["key", "label", "type", "format", "currency", "width"]);
      const key = nonempty(column.key, 100);
      if (keys.has(key)) fail("duplicate column");
      keys.add(key);
      const result: ReportColumn = {
        key,
        label: nonempty(column.label, 200),
        type: member(column.type, ["string", "number", "boolean", "date"]),
      };
      if (column.format !== undefined) {
        const format = member(column.format, [
          "text",
          "integer",
          "decimal",
          "percent",
          "currency",
          "date",
        ] as const);
        result.format = format;
        const compatible =
          result.type === "number"
            ? ["integer", "decimal", "percent", "currency"].includes(format)
            : format === (result.type === "date" ? "date" : "text");
        if (!compatible) fail("column format/type mismatch");
      }
      if (column.currency !== undefined) {
        result.currency = text(column.currency, 3);
        if (!/^[A-Z]{3}$/.test(result.currency) || result.format !== "currency")
          fail("invalid currency");
      }
      if (result.format === "currency" && !result.currency) fail("currency code required");
      if (column.width !== undefined) {
        if (
          typeof column.width !== "number" ||
          !Number.isFinite(column.width) ||
          column.width < 8 ||
          column.width > 60
        )
          fail("column width bounds");
        result.width = column.width as number;
      }
      return result;
    });
    const rows = array(sheet.rows, 0, WORKBOOK_REPORT_LIMITS.rowsPerSheet).map((value) => {
      const row = object(value, ["cells", "sourceIds"]);
      cells += columns.length;
      if (cells > WORKBOOK_REPORT_LIMITS.cells) fail("cell limit");
      const result: { cells: ReportCell[]; sourceIds?: string[] } = {
        cells: array(row.cells, columns.length, columns.length).map((value, index): ReportCell => {
          const column = columns[index]!;
          if (value === null) return null;
          if (typeof value === "object") {
            const cell = object(value, ["date", "calculation"]);
            if ("date" in cell) {
              if ("calculation" in cell || column.type !== "date")
                return fail("date column required");
              const date = text(cell.date, 10);
              if (!isDate(date)) fail("invalid date");
              return { date };
            }
            if (column.type !== "number") fail("numeric calculation column required");
            const calculation = object(cell.calculation, ["op", "refs"]);
            const op = member(calculation.op, ["sum", "average", "difference", "ratio"]);
            const refs = array(
              calculation.refs,
              1,
              WORKBOOK_REPORT_LIMITS.calculationReferences,
            ).map((value) => {
              const ref = object(value, ["sheet", "row", "column"]);
              if (
                !Number.isInteger(ref.row) ||
                (ref.row as number) < 0 ||
                (ref.row as number) >= WORKBOOK_REPORT_LIMITS.rowsPerSheet
              )
                fail("invalid reference row");
              references++;
              if (references > WORKBOOK_REPORT_LIMITS.calculationReferences)
                fail("calculation reference limit");
              return {
                sheet: nonempty(ref.sheet, 31),
                row: ref.row as number,
                column: nonempty(ref.column, 100),
              };
            });
            if ((op === "ratio" || op === "difference") && refs.length !== 2)
              fail("two references required");
            return { calculation: { op, refs } };
          }
          if (typeof value !== column.type) return fail("cell type mismatch");
          if (typeof value === "string") return text(value);
          if (typeof value === "number" && !Number.isFinite(value)) return fail("nonfinite number");
          return value as number | boolean;
        }),
      };
      if (row.sourceIds !== undefined) {
        result.sourceIds = array(row.sourceIds, 0, WORKBOOK_REPORT_LIMITS.sources).map((value) => {
          const id = text(value, 100);
          return sourceIds.has(id) ? id : fail("unknown source");
        });
        if (new Set(result.sourceIds).size !== result.sourceIds.length)
          fail("duplicate row source");
      }
      return result;
    });
    return { name, columns, rows };
  });
  if (root.chart !== undefined) {
    const chart = object(root.chart, ["title", "sheet", "categoryColumn", "valueColumn", "type"]);
    report.chart = {
      title: nonempty(chart.title, 120),
      sheet: nonempty(chart.sheet, 31),
      categoryColumn: nonempty(chart.categoryColumn, 100),
      valueColumn: nonempty(chart.valueColumn, 100),
      type: member(chart.type, ["column", "line"]),
    };
    const sheet = report.sheets.find((sheet) => sheet.name === report.chart!.sheet);
    const category = sheet?.columns.find((column) => column.key === report.chart!.categoryColumn);
    const value = sheet?.columns.find((column) => column.key === report.chart!.valueColumn);
    if (
      !sheet ||
      !category ||
      category.type === "boolean" ||
      !value ||
      value.type !== "number" ||
      category === value ||
      sheet.rows.length < 1 ||
      sheet.rows.length > 1_000
    )
      fail("invalid chart columns or row bounds");
  }
  return report;
}

/** References must name previously compiled numeric cells. This excludes cycles and external links. */
export function compileWorkbookReport(input: unknown): CompiledWorkbookReport {
  const report = validateWorkbookReport(input);
  const values = new Map<string, ReportValue>();
  const key = (sheet: string, row: number, column: string) => JSON.stringify([sheet, row, column]);
  const compiled: CompiledWorkbookReport = {
    ...report,
    sheets: report.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row, rowIndex) => ({
        ...row,
        cells: row.cells.map((cell, columnIndex): CompiledReportCell => {
          let value: ReportValue = cell as ReportValue;
          let calculation: ReportCalculation | undefined;
          if (cell !== null && typeof cell === "object" && "calculation" in cell) {
            calculation = cell.calculation;
            const inputs = calculation.refs.map((ref) => {
              const value = values.get(key(ref.sheet, ref.row, ref.column));
              return typeof value === "number"
                ? value
                : fail("reference must precede calculation and contain a number");
            });
            // JS finite numbers are the contract; no inferred or model-authored arithmetic.
            const sum = inputs.reduce((total, value) => total + value, 0);
            switch (calculation.op) {
              case "sum":
                value = sum;
                break;
              case "average":
                value = sum / inputs.length;
                break;
              case "difference":
                value = inputs[0]! - inputs[1]!;
                break;
              case "ratio":
                if (inputs[1] === 0) fail("division by zero");
                value = inputs[0]! / inputs[1]!;
                break;
            }
            if (!Number.isFinite(value)) fail("calculation overflow");
          }
          values.set(key(sheet.name, rowIndex, sheet.columns[columnIndex]!.key), value);
          return { value, ...(calculation ? { calculation } : {}) };
        }),
      })),
    })),
  };
  if (compiled.chart) {
    const sheet = compiled.sheets.find((sheet) => sheet.name === compiled.chart!.sheet)!;
    const categoryIndex = sheet.columns.findIndex(
      (column) => column.key === compiled.chart!.categoryColumn,
    );
    const valueIndex = sheet.columns.findIndex(
      (column) => column.key === compiled.chart!.valueColumn,
    );
    if (
      sheet.rows.some(
        (row) =>
          row.cells[categoryIndex]!.value === null ||
          typeof row.cells[valueIndex]!.value !== "number",
      )
    )
      fail("chart requires complete categories and numeric values");
  }
  return compiled;
}

const safeName = (raw: string, index: number, taken: Set<string>): string => {
  const clean = (value: string) =>
    value
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(INVALID_XML_CONTROLS, " ")
      .replace(/\s+/g, " ")
      .replace(/^'+|'+$/g, "")
      .trim();
  let base = clean(clean(raw).slice(0, 31)) || `Sheet ${index + 1}`;
  if (/^history$|^_sources$|^_charts$/i.test(base)) base = `${base.slice(0, 24)} data`;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    name = `${clean(base.slice(0, 31 - suffix.length))}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
};

/** Upgrade existing Markdown tables conservatively. Mixed columns and identifiers stay text.
 * Model-authored totals remain input values; only explicit calculations are verified by core.
 * Bare currency symbols are kept as text: a dollar sign alone does not identify a currency. */
export function reportFromSheets(
  sheets: readonly { name: string; rows: string[][] }[],
  title = "Business report",
): WorkbookReport {
  if (sheets.length < 1 || sheets.length > WORKBOOK_REPORT_LIMITS.sheets) fail("sheet bounds");
  const taken = new Set<string>();
  const report = validateWorkbookReport({
    version: 1,
    title,
    sheets: sheets.map((sheet, sheetIndex) => {
      if (sheet.rows.length < 1 || sheet.rows.length > WORKBOOK_REPORT_LIMITS.rowsPerSheet + 1)
        fail("row bounds");
      const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (width < 1 || width > WORKBOOK_REPORT_LIMITS.columns) fail("column bounds");
      const header = sheet.rows[0]!;
      const data = sheet.rows
        .slice(1)
        .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
      const columns: ReportColumn[] = Array.from({ length: width }, (_, i) => {
        const label = header[i]?.trim() || `Column ${i + 1}`;
        const column: ReportColumn = { key: `c${i + 1}`, label, type: "string", format: "text" };
        const values = data.map((row) => row[i]!.trim()).filter(Boolean);
        if (!values.length || IDENTIFIER_HEADER.test(label)) return column;
        if (values.every(isDate)) return { ...column, type: "date", format: "date" };
        if (values.every((value) => /^(true|false)$/i.test(value)))
          return { ...column, type: "boolean" };
        const currency = [...label.matchAll(/\b([A-Z]{3})\b/g)]
          .map((match) => match[1]!)
          .find((code) => CURRENCY_CODES.has(code));
        const percent = values.every((value) => value.endsWith("%"));
        const numeric = values.map((value) => (percent ? value.slice(0, -1) : value));
        // No locale guesses, thousands-group guesses, exponent syntax or leading-zero coercion.
        if (
          numeric.every(
            (value) =>
              /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
              Number.isFinite(Number(value)) &&
              value.replace(/[-.]/g, "").replace(/^0+/, "").length <= 15,
          )
        )
          return {
            ...column,
            type: "number",
            format: percent
              ? "percent"
              : currency
                ? "currency"
                : numeric.every((value) => Number.isInteger(Number(value)))
                  ? "integer"
                  : "decimal",
            ...(currency && !percent ? { currency } : {}),
          };
        return column;
      });
      return {
        name: safeName(sheet.name, sheetIndex, taken),
        columns,
        rows: data.map((row) => ({
          cells: row.map((raw, i): ReportCell => {
            const value = raw.trim();
            if (!value) return null;
            switch (columns[i]!.type) {
              case "number":
                return (
                  Number(columns[i]!.format === "percent" ? value.slice(0, -1) : value) /
                  (columns[i]!.format === "percent" ? 100 : 1)
                );
              case "date":
                return { date: value };
              case "boolean":
                return value.toLowerCase() === "true";
              default:
                return raw;
            }
          }),
        })),
      };
    }),
  });
  for (const sheet of report.sheets) {
    if (sheet.rows.length < 1 || sheet.rows.length > 1_000) continue;
    const category = sheet.columns.findIndex(
      (column, i) =>
        (column.type === "string" || column.type === "date") &&
        !IDENTIFIER_HEADER.test(column.label) &&
        sheet.rows.every((row) => row.cells[i] !== null),
    );
    const value = sheet.columns.findIndex(
      (column, i) =>
        column.type === "number" && sheet.rows.every((row) => typeof row.cells[i] === "number"),
    );
    if (
      category >= 0 &&
      sheet.rows.some(
        (row) =>
          typeof row.cells[category] === "string" &&
          /^(?:grand\s+)?(?:total|subtotal)\b/i.test(row.cells[category] as string),
      )
    )
      continue;
    if (category >= 0 && value >= 0) {
      report.chart = {
        title: `${sheet.columns[value]!.label} by ${sheet.columns[category]!.label}`.slice(0, 120),
        sheet: sheet.name,
        categoryColumn: sheet.columns[category]!.key,
        valueColumn: sheet.columns[value]!.key,
        type: "column",
      };
      break;
    }
  }
  return report;
}
