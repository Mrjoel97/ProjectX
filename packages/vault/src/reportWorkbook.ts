/** Styled report writer, kept subpath-only so ordinary Vault reads do not load ExcelJS. */
import {
  type CompiledWorkbookReport,
  compileWorkbookReport,
  type ReportCalculation,
  type ReportColumn,
  type ReportValue,
} from "@pikar/core/workbookReport";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const HEADER_ROW = 5;
const DATA_ROW = HEADER_ROW + 1;
// Workbook files cannot consume CSS variables; these are BRAND.md's export palette.
const COLOR = {
  teal: "FF0B4F4A",
  accent: "FF009689",
  ink: "FF0E1419",
  muted: "FF55606C",
  pale: "FFF8FAFC",
  rule: "FFD8DBE0",
  white: "FFFFFFFF",
};
export const REPORT_XLSX_MAX_BYTES = 8 * 1024 * 1024;
const columnLetter = (index: number): string => {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
};
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
const xml = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const formatFor = (column: ReportColumn): string => {
  switch (column.format ?? column.type) {
    case "currency":
      return `"${column.currency}" #,##0.00;[Red]("${column.currency}" #,##0.00)`;
    case "percent":
      return "0.0%;[Red](0.0%)";
    case "integer":
      return "#,##0;[Red](#,##0)";
    case "date":
      return "yyyy-mm-dd";
    case "number":
    case "decimal":
      return "#,##0.00;[Red](#,##0.00)";
    default:
      return "@";
  }
};
const excelValue = (value: ReportValue): ExcelJS.CellValue =>
  value !== null && typeof value === "object" ? new Date(`${value.date}T00:00:00Z`) : value;

/** ExcelJS 4.4 quotes print defined names without escaping internal apostrophes. Repair that
 * known writer defect, preserving the worksheet name and the correctly quoted cell formulas. */
function fixPrintNames(bytes: Uint8Array, names: string[]): Uint8Array {
  const affected = names.filter((name) => name.includes("'"));
  if (!affected.length) return bytes;
  const archive = unzipSync(bytes);
  const path = "xl/workbook.xml";
  archive[path] = strToU8(
    strFromU8(archive[path]!).replace(/<definedName\b[^>]*>[^<]*<\/definedName>/g, (entry) => {
      for (const name of affected)
        entry = entry.replaceAll(xml(`'${name}'!`), xml(`${quoteSheet(name)}!`));
      return entry;
    }),
  );
  return zipSync(archive, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}

function calculationFormula(
  calculation: ReportCalculation,
  report: CompiledWorkbookReport,
): string {
  const refs = calculation.refs.map((ref) => {
    const sheet = report.sheets.find((sheet) => sheet.name === ref.sheet)!;
    const column = sheet.columns.findIndex((column) => column.key === ref.column);
    return `${quoteSheet(sheet.name)}!${columnLetter(column)}${ref.row + DATA_ROW}`;
  });
  let formula: string;
  switch (calculation.op) {
    case "sum":
      formula = `SUM(${refs.join(",")})`;
      break;
    case "average":
      formula = `AVERAGE(${refs.join(",")})`;
      break;
    case "difference":
      formula = `${refs[0]}-${refs[1]}`;
      break;
    case "ratio":
      formula = `${refs[0]}/${refs[1]}`;
      break;
  }
  if (formula.length > 8_192) throw new Error("workbook_report_invalid: formula length limit");
  return formula;
}

/** Native single-series chart. Every XML fragment and relationship is writer-owned.
 * ExcelJS 4.4 has no chart writer, so add the minimum standard OOXML parts to its ZIP.
 * No model-authored XML, external targets, arbitrary formulas, macros or embedded programs. */
function addChart(
  bytes: Uint8Array,
  report: CompiledWorkbookReport,
  chartSheetNumber: number,
): Uint8Array {
  const chart = report.chart!;
  const sheet = report.sheets.find((sheet) => sheet.name === chart.sheet)!;
  const categoryIndex = sheet.columns.findIndex((column) => column.key === chart.categoryColumn);
  const valueIndex = sheet.columns.findIndex((column) => column.key === chart.valueColumn);
  const categoryColumn = columnLetter(categoryIndex);
  const valueColumn = columnLetter(valueIndex);
  const count = sheet.rows.length;
  const range = (column: string) =>
    xml(`${quoteSheet(sheet.name)}!$${column}$${DATA_ROW}:$${column}$${DATA_ROW + count - 1}`);
  const categories = sheet.rows
    .map((row, index) => {
      const value = row.cells[categoryIndex]!.value;
      const label = value !== null && typeof value === "object" ? value.date : String(value);
      return `<c:pt idx="${index}"><c:v>${xml(label)}</c:v></c:pt>`;
    })
    .join("");
  const values = sheet.rows
    .map((row, index) => `<c:pt idx="${index}"><c:v>${row.cells[valueIndex]!.value}</c:v></c:pt>`)
    .join("");
  const chartKind = chart.type === "column" ? "barChart" : "lineChart";
  const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(sheet.columns[valueIndex]!.label)}</c:v></c:tx><c:spPr>${chart.type === "line" ? '<a:ln w="28575">' : ""}<a:solidFill><a:srgbClr val="${COLOR.accent.slice(-6)}"/></a:solidFill>${chart.type === "line" ? "</a:ln>" : ""}</c:spPr>${chart.type === "line" ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' : ""}<c:cat><c:strRef><c:f>${range(categoryColumn)}</c:f><c:strCache><c:ptCount val="${count}"/>${categories}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${range(valueColumn)}</c:f><c:numCache><c:formatCode>${xml(formatFor(sheet.columns[valueIndex]!))}</c:formatCode><c:ptCount val="${count}"/>${values}</c:numCache></c:numRef></c:val>${chart.type === "line" ? '<c:smooth val="0"/>' : ""}</c:ser>`;
  const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:lang val="en-US"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800" b="1"/><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:${chartKind}>${chart.type === "column" ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : '<c:grouping val="standard"/>'}<c:varyColors val="0"/>${series}${chart.type === "column" ? '<c:gapWidth val="85"/>' : '<c:marker val="1"/>'}<c:axId val="100"/><c:axId val="200"/></c:${chartKind}><c:catAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="200"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="${xml(formatFor(sheet.columns[valueIndex]!))}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="100"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>25</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Report chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  const relationship = (id: string, type: string, target: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
  const archive = unzipSync(bytes);
  const worksheetPath = `xl/worksheets/sheet${chartSheetNumber}.xml`;
  const worksheet = strFromU8(archive[worksheetPath]!);
  if (
    !worksheet.includes("</worksheet>") ||
    archive[`xl/worksheets/_rels/sheet${chartSheetNumber}.xml.rels`]
  )
    throw new Error("workbook_report_write_failed: unexpected chart worksheet");
  archive[worksheetPath] = strToU8(
    worksheet.replace("</worksheet>", '<drawing r:id="rIdDrawing1"/></worksheet>'),
  );
  archive[`xl/worksheets/_rels/sheet${chartSheetNumber}.xml.rels`] = strToU8(
    relationship("rIdDrawing1", "drawing", "../drawings/drawing1.xml"),
  );
  archive["xl/drawings/drawing1.xml"] = strToU8(drawingXml);
  archive["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(
    relationship("rIdChart1", "chart", "../charts/chart1.xml"),
  );
  archive["xl/charts/chart1.xml"] = strToU8(chartXml);
  const contentTypes = strFromU8(archive["[Content_Types].xml"]!);
  archive["[Content_Types].xml"] = strToU8(
    contentTypes.replace(
      "</Types>",
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
    ),
  );
  return zipSync(archive, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}

/** Genuine editable XLSX bytes with independently computed cached results for supported formulas.
 * This validates input and file structure locally; it does not recalculate arbitrary Excel files.
 * ponytail: one restrained report theme and one native chart; template editor/multi-series later. */
export async function reportToXlsx(input: unknown): Promise<Uint8Array> {
  const report = compileWorkbookReport(input);
  // Validate formula length before allocating ExcelJS rows.
  const formulas = new Map<CompiledReportCellKey, string>();
  report.sheets.forEach((sheet, si) => {
    sheet.rows.forEach((row, ri) => {
      row.cells.forEach((cell, ci) => {
        if (cell.calculation)
          formulas.set(`${si}:${ri}:${ci}`, calculationFormula(cell.calculation, report));
      });
    });
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pikar AI";
  workbook.title = report.title;
  workbook.subject = "Business report";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.calcProperties.fullCalcOnLoad = true;
  report.sheets.forEach((sheet, sheetIndex) => {
    const worksheet = workbook.addWorksheet(sheet.name, {
      properties: { defaultRowHeight: 24 },
      views: [{ state: "frozen", ySplit: HEADER_ROW, showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: sheet.columns.length > 6 ? "landscape" : "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
      },
    });
    worksheet.columns = sheet.columns.map((column, i) => ({
      key: column.key,
      width:
        sheet.columns.length === 1
          ? Math.max(40, column.width ?? 24)
          : (column.width ?? Math.min(42, Math.max(i === 0 ? 24 : 16, column.label.length + 3))),
      style: { numFmt: formatFor(column) },
    }));
    for (const row of [1, 2, 3]) {
      if (sheet.columns.length > 1) worksheet.mergeCells(row, 1, row, sheet.columns.length);
    }
    const width = worksheet.columns.reduce((sum, column) => sum + (column.width ?? 16), 0);
    worksheet.getCell("A1").value = report.title;
    worksheet.getCell("A1").font = {
      name: "Aptos Display",
      size: 22,
      bold: true,
      color: { argb: COLOR.white },
    };
    worksheet.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.teal },
    };
    worksheet.getCell("A1").alignment = { wrapText: true, vertical: "middle", indent: 1 };
    worksheet.getRow(1).height = Math.max(
      48,
      Math.ceil(report.title.length / (width / 2)) * 28 + 12,
    );
    worksheet.getCell("A2").value = sheet.name;
    worksheet.getCell("A2").font = {
      name: "Aptos",
      size: 13,
      bold: true,
      color: { argb: COLOR.teal },
    };
    worksheet.getRow(2).height = 30;
    worksheet.getCell("A3").value =
      report.subtitle ?? `${sheet.rows.length} data rows · ${sheet.columns.length} columns`;
    worksheet.getCell("A3").font = { name: "Aptos", size: 10, color: { argb: COLOR.muted } };
    worksheet.getCell("A3").alignment = { wrapText: true, vertical: "middle" };
    worksheet.getRow(3).height = Math.max(
      28,
      Math.ceil(String(worksheet.getCell("A3").value).length / width) * 16 + 8,
    );
    sheet.columns.forEach((column, index) => {
      const cell = worksheet.getCell(HEADER_ROW, index + 1);
      cell.value = column.label;
      cell.font = { name: "Aptos", bold: true, size: 11, color: { argb: COLOR.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.teal } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    worksheet.getRow(HEADER_ROW).height = Math.max(
      32,
      ...sheet.columns.map(
        (column, i) =>
          Math.ceil(column.label.length / (worksheet.getColumn(i + 1).width ?? 16)) * 16 + 12,
      ),
    );
    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(DATA_ROW + rowIndex);
      let lines = 1;
      row.cells.forEach((cell, columnIndex) => {
        const target = excelRow.getCell(columnIndex + 1);
        target.value = cell.calculation
          ? {
              formula: formulas.get(`${sheetIndex}:${rowIndex}:${columnIndex}`)!,
              result: cell.value as number,
            }
          : excelValue(cell.value);
        target.font = {
          name: "Aptos",
          size: 11,
          color: { argb: cell.calculation ? COLOR.accent : COLOR.ink },
          ...(cell.calculation ? { bold: true } : {}),
        };
        target.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowIndex % 2 ? COLOR.pale : COLOR.white },
        };
        target.alignment = {
          vertical: "top",
          wrapText: true,
          horizontal: sheet.columns[columnIndex]!.type === "number" ? "right" : "left",
        };
        target.border = { bottom: { style: "hair", color: { argb: COLOR.rule } } };
        if (columnIndex === 0 && row.sourceIds?.length)
          target.note = `Source references: ${row.sourceIds.join(", ")} (see _Sources).`;
        if (typeof cell.value === "string")
          lines = Math.max(
            lines,
            ...cell.value
              .split("\n")
              .map((line) =>
                Math.ceil(line.length / (worksheet.getColumn(columnIndex + 1).width ?? 16)),
              ),
          );
      });
      excelRow.height = Math.min(409, Math.max(25, lines * 15 + 10));
    });
    worksheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: {
        row: Math.max(HEADER_ROW, HEADER_ROW + sheet.rows.length),
        column: sheet.columns.length,
      },
    };
    worksheet.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;
    worksheet.pageSetup.printArea = `A1:${columnLetter(sheet.columns.length - 1)}${HEADER_ROW + sheet.rows.length}`;
    worksheet.headerFooter.oddFooter = "&L Pikar AI &R Page &P of &N";
  });
  if (report.sources?.length) {
    const sources = workbook.addWorksheet("_Sources", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    });
    sources.columns = [
      { header: "Source ID", key: "id", width: 20 },
      { header: "Label", key: "label", width: 35 },
      { header: "Reference", key: "reference", width: 55 },
      { header: "Notes", key: "note", width: 55 },
    ];
    report.sources.forEach((source) => {
      sources.addRow(source);
    });
    sources.eachRow((row, index) => {
      row.height = index === 1 ? 30 : 45;
      row.eachCell((cell) => {
        cell.alignment = { wrapText: true, vertical: "top" };
        cell.font = {
          name: "Aptos",
          size: 11,
          bold: index === 1,
          color: { argb: index === 1 ? COLOR.white : COLOR.ink },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: index === 1 ? COLOR.teal : index % 2 ? COLOR.pale : COLOR.white },
        };
      });
    });
    sources.autoFilter = `A1:D${report.sources.length + 1}`;
    sources.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
    };
  }
  if (report.chart) {
    const chart = workbook.addWorksheet("_Charts", { views: [{ showGridLines: false }] });
    chart.columns = Array.from({ length: 13 }, () => ({ width: 10 }));
    chart.mergeCells("A1:M1");
    chart.getCell("A1").value = report.title;
    chart.getCell("A1").font = { name: "Aptos", size: 20, bold: true, color: { argb: COLOR.teal } };
    chart.getRow(1).height = 36;
    chart.mergeCells("A2:M2");
    chart.getCell("A2").value = `Editable chart · Source: ${report.chart.sheet}`;
    chart.getCell("A2").font = { name: "Aptos", size: 10, color: { argb: COLOR.muted } };
    chart.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      printArea: "A1:M27",
    };
  }
  let bytes: Uint8Array = new Uint8Array(await workbook.xlsx.writeBuffer());
  bytes = fixPrintNames(
    bytes,
    report.sheets.map((sheet) => sheet.name),
  );
  if (report.chart) bytes = addChart(bytes, report, workbook.worksheets.length);
  if (bytes.byteLength > REPORT_XLSX_MAX_BYTES)
    throw new Error("workbook_report_write_failed: output byte limit");
  return bytes;
}

type CompiledReportCellKey = `${number}:${number}:${number}`;
