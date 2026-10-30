import {
  type PresentationSpec,
  presentationPalettes,
  validatePresentationSpec,
} from "@pikar/core/presentation";
import PptxGenJS from "pptxgenjs";

export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Native OOXML only. Never fetches URLs, reads files or evaluates model code. */
export async function presentationToPptx(input: unknown): Promise<Uint8Array> {
  const spec: PresentationSpec = validatePresentationSpec(input);
  const palette = presentationPalettes[spec.theme ?? "teal"];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Pikar AI";
  pptx.subject = "Editable presentation";
  pptx.title = spec.title;
  pptx.company = "";
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };
  pptx.defineSlideMaster({
    title: "PIKAR",
    background: { color: "FFFFFF" },
    objects: [
      {
        rect: {
          x: 0,
          y: 0,
          w: 0.16,
          h: 7.5,
          fill: { color: palette.ink },
          line: { color: palette.ink },
        },
      },
      { line: { x: 0.62, y: 6.98, w: 12.05, h: 0, line: { color: "D8DBE0", width: 0.7 } } },
    ],
  });

  for (const [index, content] of spec.slides.entries()) {
    const slide = pptx.addSlide("PIKAR");
    const text = (
      value: string,
      x: number,
      y: number,
      w: number,
      h: number,
      fontSize = 20,
      extra: PptxGenJS.TextPropsOptions = {},
    ) => {
      // Content admission bounds fit before serialization; shrink is a final Office safeguard.
      slide.addText(value, {
        x,
        y,
        w,
        h,
        fontFace: "Aptos",
        fontSize,
        color: "263544",
        breakLine: false,
        margin: 0,
        valign: "top",
        fit: "shrink",
        ...extra,
      });
    };
    const rule = (x: number, y: number, w: number, color: string = palette.accent) =>
      slide.addShape(pptx.ShapeType.line, { x, y, w, h: 0, line: { color, width: 2 } });
    const footerColor = content.kind === "cover" ? "FFFFFF" : "55606C";
    text(String(index + 1).padStart(2, "0"), 12.2, 7.12, 0.45, 0.2, 10, {
      align: "right",
      color: footerColor,
    });
    if (content.sourceIds?.length)
      text(`Sources: ${content.sourceIds.length} (speaker notes)`, 0.65, 7.12, 7.0, 0.2, 10, {
        color: footerColor,
      });
    const referenced = (content.sourceIds ?? []).map(
      (id) => spec.sources!.find((source) => source.id === id)!,
    );
    slide.addNotes(
      [
        content.notes ?? "",
        ...referenced.map(
          (source) => `[${source.id}] ${source.label}${source.url ? `\n${source.url}` : ""}`,
        ),
      ]
        .filter(Boolean)
        .join("\n\n") || "Created with Pikar AI. Editable text, shapes, tables and chart data.",
    );

    if (content.kind === "cover") {
      slide.background = { color: palette.ink };
      slide.addShape(pptx.ShapeType.rect, {
        x: 10.8,
        y: 0,
        w: 2.533,
        h: 7.0,
        fill: { color: palette.accent },
        line: { color: palette.accent },
      });
      text(content.title, 0.8, 2.05, 9.3, 1.65, 40, { color: "FFFFFF", bold: true });
      const subtitle = content.subtitle ?? spec.subtitle;
      if (subtitle) text(subtitle, 0.82, 4.03, 8.6, 1.25, 23, { color: "FFFFFF" });
      continue;
    }

    text(content.title, 0.65, 0.52, 11.95, 1.03, 30, { color: palette.ink, bold: true });
    rule(0.65, 1.57, 0.75);

    switch (content.kind) {
      case "bullets":
        content.bullets.forEach((item, i) => {
          slide.addShape(pptx.ShapeType.ellipse, {
            x: 0.72,
            y: 2.02 + i * 0.9,
            w: 0.09,
            h: 0.09,
            line: { color: palette.accent },
            fill: { color: palette.accent },
          });
          text(item, 1.02, 1.87 + i * 0.9, 11.25, 0.78, 23);
        });
        break;
      case "metrics": {
        const width = 11.9 / content.metrics.length;
        content.metrics.forEach((metric, i) => {
          const x = 0.67 + i * width;
          if (i > 0)
            slide.addShape(pptx.ShapeType.line, {
              x: x - 0.15,
              y: 2.13,
              w: 0,
              h: 3.7,
              line: { color: "D8DBE0", width: 1 },
            });
          text(metric.value, x, 2.15, width - 0.4, 1.25, 38, { color: palette.ink, bold: true });
          text(metric.label, x, 3.65, width - 0.4, 0.85, 20, { bold: true });
          if (metric.detail)
            text(metric.detail, x, 4.65, width - 0.4, 1.45, 17, { color: "55606C" });
        });
        break;
      }
      case "table": {
        const rows: PptxGenJS.TableRow[] = [
          content.columns.map((value) => ({
            text: value,
            options: { bold: true, color: "FFFFFF", fill: { color: palette.ink } },
          })),
          ...content.rows.map((row, i) =>
            row.map((value) => ({
              text: value,
              options: { fill: { color: i % 2 === 0 ? palette.pale : "FFFFFF" } },
            })),
          ),
        ];
        // ponytail: fixed row/column caps avoid pagination complexity; reject oversized tables.
        slide.addTable(rows, {
          x: 0.65,
          y: 1.9,
          w: 12.0,
          h: 4.65,
          colW: Array(content.columns.length).fill(12 / content.columns.length),
          rowH: 4.65 / rows.length,
          fontFace: "Aptos",
          fontSize: 14,
          color: "263544",
          border: { type: "solid", color: "FFFFFF", pt: 1 },
          margin: [0.07, 0.1, 0.05, 0.1],
          valign: "middle",
          autoPage: false,
        });
        break;
      }
      case "chart":
        slide.addChart(
          content.chartType === "line" ? pptx.ChartType.line : pptx.ChartType.bar,
          content.series.map((series) => ({
            name: series.name,
            labels: content.categories,
            values: series.values,
          })),
          {
            x: 0.75,
            y: 1.92,
            w: 11.7,
            h: 4.75,
            catAxisLabelFontFace: "Aptos",
            catAxisLabelFontSize: 13,
            valAxisLabelFontFace: "Aptos",
            valAxisLabelFontSize: 12,
            chartColors: [...palette.series],
            showLegend: content.series.length > 1,
            legendPos: "b",
            legendFontSize: 12,
            showTitle: Boolean(content.unit),
            title: content.unit,
            titleFontSize: 14,
            titleColor: "55606C",
            titleFontFace: "Aptos",
            showValue: false,
            lineDataSymbol: content.chartType === "line" ? "circle" : "none",
            lineDataSymbolSize: 5,
            lineSize: 2,
            barDir: content.chartType === "bar" ? "bar" : "col",
            catAxisLineShow: false,
            valAxisLineShow: false,
            valGridLine: { color: "D8DBE0", size: 0.5 },
          },
        );
        break;
      case "comparison":
        [content.left, content.right].forEach((column, i) => {
          const x = 0.68 + i * 6.15;
          text(column.heading, x, 1.95, 5.5, 0.9, 24, { color: palette.ink, bold: true });
          rule(x, 2.91, 5.48, "D8DBE0");
          column.bullets.forEach((item, j) => {
            text(item, x, 3.12 + j * 0.83, 5.42, 0.76, 18);
          });
        });
        break;
      case "process": {
        const width = 11.9 / content.steps.length;
        content.steps.forEach((step, i) => {
          const x = 0.67 + width * i;
          text(String(i + 1).padStart(2, "0"), x, 2.0, width - 0.4, 0.8, 38, {
            bold: true,
            color: palette.accent,
          });
          rule(x, 2.98, width - 0.4);
          text(step.title, x, 3.2, width - 0.4, 1.0, 22, { color: palette.ink, bold: true });
          text(step.description, x, 4.45, width - 0.4, 1.8, 18);
        });
        break;
      }
    }
  }
  const bytes = await pptx.write({ outputType: "uint8array", compression: true });
  if (!(bytes instanceof Uint8Array)) throw new Error("Presentation export did not produce bytes");
  return bytes;
}
