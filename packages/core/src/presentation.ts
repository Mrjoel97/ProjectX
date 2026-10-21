/** Reviewed layouts accept content, never model-written rendering code or remote assets. */
export type PresentationSlide = {
  title: string;
  notes?: string;
  sourceIds?: string[];
} & (
  | { kind: "cover"; subtitle?: string }
  | { kind: "bullets"; bullets: string[] }
  | { kind: "metrics"; metrics: { label: string; value: string; detail?: string }[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | {
      kind: "chart";
      chartType: "column" | "bar" | "line";
      categories: string[];
      series: { name: string; values: number[] }[];
      unit?: string;
    }
  | {
      kind: "comparison";
      left: { heading: string; bullets: string[] };
      right: { heading: string; bullets: string[] };
    }
  | { kind: "process"; steps: { title: string; description: string }[] }
);

export interface PresentationSpec {
  title: string;
  subtitle?: string;
  theme?: "indigo" | "teal" | "slate";
  slides: PresentationSlide[];
  sources?: { id: string; label: string; url?: string }[];
}

const stringSchema = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const arraySchema = (items: object, maxItems: number, minItems = 1) => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const objectSchema = <T extends Record<string, object>>(properties: T, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const common = {
  title: stringSchema(84),
  notes: stringSchema(1600),
  sourceIds: arraySchema(stringSchema(40), 8, 0),
};
const columnSchema = objectSchema(
  { heading: stringSchema(44), bullets: arraySchema(stringSchema(105), 4) },
  ["heading", "bullets"],
);
const variants = {
  cover: { subtitle: stringSchema(180) },
  bullets: { bullets: arraySchema(stringSchema(150), 5) },
  metrics: {
    metrics: arraySchema(
      objectSchema(
        { label: stringSchema(40), value: stringSchema(16), detail: stringSchema(100) },
        ["label", "value"],
      ),
      4,
      2,
    ),
  },
  table: {
    columns: arraySchema(stringSchema(38), 5, 2),
    rows: arraySchema(arraySchema(stringSchema(52), 5, 2), 8),
  },
  chart: {
    chartType: { type: "string", enum: ["column", "bar", "line"] },
    categories: arraySchema(stringSchema(20), 8, 2),
    series: arraySchema(
      objectSchema(
        {
          name: stringSchema(32),
          values: arraySchema({ type: "number", minimum: -1e12, maximum: 1e12 }, 8, 2),
        },
        ["name", "values"],
      ),
      3,
    ),
    unit: stringSchema(24),
  },
  comparison: { left: columnSchema, right: columnSchema },
  process: {
    steps: arraySchema(
      objectSchema({ title: stringSchema(35), description: stringSchema(105) }, [
        "title",
        "description",
      ]),
      4,
      2,
    ),
  },
};
const required: Record<keyof typeof variants, string[]> = {
  cover: [],
  bullets: ["bullets"],
  metrics: ["metrics"],
  table: ["columns", "rows"],
  chart: ["chartType", "categories", "series"],
  comparison: ["left", "right"],
  process: ["steps"],
};

/** Model boundary schema. Cross-field and conservative text-fit checks also run below. */
export const presentationJsonSchema = objectSchema(
  {
    title: stringSchema(120),
    subtitle: stringSchema(180),
    theme: { type: "string", enum: ["indigo", "teal", "slate"] },
    slides: arraySchema(
      {
        anyOf: Object.entries(variants).map(([kind, fields]) =>
          objectSchema({ ...common, kind: { type: "string", enum: [kind] }, ...fields }, [
            "kind",
            "title",
            ...required[kind as keyof typeof variants],
          ]),
        ),
      },
      24,
    ),
    sources: arraySchema(
      objectSchema({ id: stringSchema(40), label: stringSchema(180), url: stringSchema(500) }, [
        "id",
        "label",
      ]),
      24,
      0,
    ),
  },
  ["title", "slides"],
);

function fail(path: string): never {
  throw new Error(`Invalid presentation: ${path}`);
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject characters forbidden in XML 1.0 text.
const INVALID_XML_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u;

function validateSchema(value: unknown, schema: Record<string, unknown>, path: string): void {
  if (schema.anyOf) {
    const kind =
      value && typeof value === "object" ? (value as Record<string, unknown>).kind : undefined;
    const chosen = (schema.anyOf as Record<string, unknown>[]).find(
      (entry) =>
        (
          (entry.properties as Record<string, Record<string, unknown>>).kind!.enum as string[]
        )[0] === kind,
    );
    if (!chosen) fail(`${path}.kind`);
    validateSchema(value, chosen, path);
    return;
  }
  if (schema.type === "object") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      fail(path);
    const record = value as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    for (const key of schema.required as string[]) if (!(key in record)) fail(`${path}.${key}`);
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(props, key)) fail(`${path}.unsupportedField`);
      validateSchema(record[key], props[key]!, `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems as number) ||
      value.length > (schema.maxItems as number)
    )
      fail(path);
    for (const entry of value)
      validateSchema(entry, schema.items as Record<string, unknown>, `${path}[]`);
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > (schema.maxLength as number) ||
      INVALID_XML_CHARACTERS.test(value)
    )
      fail(path);
    // XML 1.0 cannot contain isolated surrogate code points.
    for (const char of value) {
      const point = char.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) fail(path);
    }
    if (schema.enum && !(schema.enum as unknown[]).includes(value)) fail(path);
    if (schema.const && value !== schema.const) fail(path);
  } else if (schema.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < (schema.minimum as number) ||
      value > (schema.maximum as number)
    )
      fail(path);
  }
}

/** Conservative layout admission; long Unicode glyphs and manual line breaks consume space. */
export function presentationTextLines(text: string, unitsPerLine: number): number {
  return text
    .split(/\r\n|\r|\n/u)
    .reduce(
      (sum, line) =>
        sum +
        Math.max(
          1,
          Math.ceil(
            Array.from(line).reduce((n, char) => n + (char.codePointAt(0)! > 0x2ff ? 2 : 1), 0) /
              unitsPerLine,
          ),
        ),
      0,
    );
}
function fits(text: string, units: number, lines: number, path: string) {
  if (presentationTextLines(text, units) > lines) fail(`${path}.textFit`);
}

export function validatePresentationSpec(input: unknown): PresentationSpec {
  validateSchema(input, presentationJsonSchema, "spec");
  const spec = input as PresentationSpec;
  if (spec.subtitle) fits(spec.subtitle, 70, 3, "subtitle");
  const sources = new Set<string>();
  for (const source of spec.sources ?? []) {
    if (!/^[a-zA-Z0-9_-]+$/u.test(source.id) || sources.has(source.id)) fail("sources.id");
    sources.add(source.id);
    if (source.url) {
      let url: URL;
      try {
        url = new URL(source.url);
      } catch {
        fail("sources.url");
      }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        fail("sources.url");
    }
  }
  for (const slide of spec.slides) {
    fits(slide.title, 55, 2, "slide.title");
    if (
      new Set(slide.sourceIds).size !== (slide.sourceIds?.length ?? 0) ||
      slide.sourceIds?.some((id) => !sources.has(id))
    )
      fail("slide.sourceIds");
    switch (slide.kind) {
      case "cover":
        fits(slide.title, 35, 2, "cover.title");
        if (slide.subtitle) fits(slide.subtitle, 70, 3, "cover.subtitle");
        break;
      case "bullets":
        for (const text of slide.bullets) fits(text, 80, 2, "bullets");
        break;
      case "metrics":
        for (const metric of slide.metrics) {
          fits(metric.value, 13, 2, "metric.value");
          fits(metric.label, 22, 2, "metric.label");
          if (metric.detail) fits(metric.detail, 25, 4, "metric.detail");
        }
        break;
      case "table":
        for (const text of slide.columns)
          fits(text, Math.floor(80 / slide.columns.length), 2, "table.header");
        for (const row of slide.rows) {
          if (row.length !== slide.columns.length) fail("table.rowWidth");
          for (const text of row)
            fits(text, Math.floor(90 / slide.columns.length), 2, "table.cell");
        }
        break;
      case "chart":
        for (const category of slide.categories) fits(category, 14, 2, "chart.category");
        for (const series of slide.series) {
          fits(series.name, 24, 2, "chart.series");
          if (series.values.length !== slide.categories.length) fail("chart.valueCount");
        }
        break;
      case "comparison":
        for (const column of [slide.left, slide.right]) {
          fits(column.heading, 31, 2, "comparison.heading");
          for (const text of column.bullets) fits(text, 43, 3, "comparison.bullet");
        }
        break;
      case "process":
        for (const step of slide.steps) {
          fits(step.title, 18, 2, "process.title");
          fits(step.description, 22, 5, "process.description");
        }
        break;
    }
  }
  if (JSON.stringify(spec).length > 64000) fail("size");
  return spec;
}

/** Honest text outline for Vault search and an optional PDF outline, not a slide preview. */
export function presentationToMarkdown(input: unknown): string {
  const spec = validatePresentationSpec(input);
  // Escape user punctuation so data cannot create misleading headings/links in the outline.
  const text = (value: string) =>
    value.replace(/([\\`*_{}[\]()#+.!|<>-])/gu, "\\$1").replace(/[\r\n]+/gu, " ");
  const lines = [
    "Presentation outline. Download the PowerPoint for the designed, editable slides.",
    "",
  ];
  for (const [index, slide] of spec.slides.entries()) {
    lines.push(`## ${index + 1}. ${text(slide.title)}`, "");
    switch (slide.kind) {
      case "cover":
        if (slide.subtitle) lines.push(text(slide.subtitle));
        break;
      case "bullets":
        lines.push(...slide.bullets.map((item) => `- ${text(item)}`));
        break;
      case "metrics":
        lines.push(
          ...slide.metrics.map(
            (item) =>
              `- **${text(item.label)}:** ${text(item.value)}${item.detail ? ` — ${text(item.detail)}` : ""}`,
          ),
        );
        break;
      case "table":
        lines.push(
          `| ${slide.columns.map(text).join(" | ")} |`,
          `| ${slide.columns.map(() => "---").join(" | ")} |`,
          ...slide.rows.map((row) => `| ${row.map(text).join(" | ")} |`),
        );
        break;
      case "chart":
        lines.push(
          `Chart${slide.unit ? ` (${text(slide.unit)})` : ""}.`,
          ...slide.series.map(
            (series) =>
              `- ${text(series.name)}: ${slide.categories.map((category, i) => `${text(category)} ${series.values[i]}`).join("; ")}`,
          ),
        );
        break;
      case "comparison":
        for (const column of [slide.left, slide.right])
          lines.push(
            `### ${text(column.heading)}`,
            ...column.bullets.map((item) => `- ${text(item)}`),
          );
        break;
      case "process":
        lines.push(
          ...slide.steps.map(
            (step, i) => `${i + 1}. **${text(step.title)}:** ${text(step.description)}`,
          ),
        );
        break;
    }
    if (slide.notes) lines.push("", `Speaker notes: ${text(slide.notes)}`);
    if (slide.sourceIds?.length) lines.push("", `Sources: ${slide.sourceIds.map(text).join(", ")}`);
    lines.push("");
  }
  if (spec.sources?.length)
    lines.push(
      "## Sources",
      "",
      ...spec.sources.map(
        (source) =>
          `- ${text(source.id)}: ${text(source.label)}${source.url ? ` — ${text(source.url)}` : ""}`,
      ),
    );
  return lines.join("\n");
}

export const presentationPalettes = {
  teal: { ink: "0B4F4A", accent: "009689", pale: "EAF6F4", series: ["0B4F4A", "009689", "40CAD0"] },
  indigo: {
    ink: "25275C",
    accent: "5856A8",
    pale: "F0EFF9",
    series: ["25275C", "5856A8", "8C89CB"],
  },
  slate: {
    ink: "172B40",
    accent: "386D8A",
    pale: "EDF3F7",
    series: ["172B40", "386D8A", "78A6BF"],
  },
} as const;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/gu,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** Scriptless, network-free layout preview. Office font metrics may differ. */
export function renderPresentationHtml(input: unknown, slideIndex?: number): string {
  const spec = validatePresentationSpec(input);
  if (
    slideIndex !== undefined &&
    (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= spec.slides.length)
  )
    fail("slideIndex");
  const palette = presentationPalettes[spec.theme ?? "teal"];

  const renderChart = (slide: Extract<PresentationSlide, { kind: "chart" }>) => {
    const values = slide.series.flatMap((series) => series.values);
    const low = Math.min(0, ...values),
      high = Math.max(0, ...values);
    const span = high - low || 1;
    const y = (value: number) => 330 - ((value - low) / span) * 280;
    const x = (value: number) => 90 + ((value - low) / span) * 840;
    let parts = `<svg viewBox="0 0 1000 430" role="img" aria-label="${escapeHtml(slide.title)}"><title>${escapeHtml(slide.title)}</title>`;
    for (let i = 0; i < 5; i++) {
      const value = low + (span * i) / 4;
      if (slide.chartType === "bar")
        parts += `<line x1="${x(value)}" y1="35" x2="${x(value)}" y2="345" stroke="#D8DBE0"/><text x="${x(value)}" y="369" text-anchor="middle">${escapeHtml(Number(value.toPrecision(3)).toString())}</text>`;
      else
        parts += `<line x1="85" y1="${y(value)}" x2="945" y2="${y(value)}" stroke="#D8DBE0"/><text x="75" y="${y(value) + 5}" text-anchor="end">${escapeHtml(Number(value.toPrecision(3)).toString())}</text>`;
    }
    const group = 840 / slide.categories.length;
    const verticalGroup = 300 / slide.categories.length;
    slide.categories.forEach((category, i) => {
      if (slide.chartType === "bar")
        parts += `<text x="80" y="${52 + i * verticalGroup + verticalGroup / 2}" text-anchor="end">${escapeHtml(category)}</text>`;
      else
        parts += `<text x="${95 + i * group + group / 2}" y="357" text-anchor="middle">${escapeHtml(category)}</text>`;
    });
    slide.series.forEach((series, seriesIndex) => {
      const color = palette.series[seriesIndex];
      if (slide.chartType === "line") {
        const points = series.values
          .map((value, i) => `${95 + i * group + group / 2},${y(value)}`)
          .join(" ");
        parts += `<polyline points="${points}" fill="none" stroke="#${color}" stroke-width="3"/>`;
        series.values.forEach((value, i) => {
          parts += `<circle cx="${95 + i * group + group / 2}" cy="${y(value)}" r="4" fill="#${color}"><title>${escapeHtml(series.name)}: ${value}</title></circle>`;
        });
      } else
        series.values.forEach((value, i) => {
          if (slide.chartType === "bar")
            parts += `<rect x="${Math.min(x(0), x(value))}" y="${42 + i * verticalGroup + (seriesIndex * verticalGroup * 0.7) / slide.series.length}" width="${Math.abs(x(value) - x(0))}" height="${(verticalGroup * 0.65) / slide.series.length}" fill="#${color}"><title>${escapeHtml(series.name)}: ${value}</title></rect>`;
          else
            parts += `<rect x="${95 + i * group + 0.12 * group + (seriesIndex * group * 0.7) / slide.series.length}" y="${Math.min(y(0), y(value))}" width="${(group * 0.65) / slide.series.length}" height="${Math.abs(y(value) - y(0))}" fill="#${color}"><title>${escapeHtml(series.name)}: ${value}</title></rect>`;
        });
      parts += `<rect x="${110 + seriesIndex * 280}" y="398" width="13" height="13" fill="#${color}"/><text x="${132 + seriesIndex * 280}" y="410">${escapeHtml(series.name)}</text>`;
    });
    return `${slide.unit ? `<p class="unit">${escapeHtml(slide.unit)}</p>` : ""}${parts}</svg>`;
  };
  const slideHtml = (slide: PresentationSlide, index: number) => {
    let body = "";
    switch (slide.kind) {
      case "cover":
        body = `<div class="cover-copy"><h1>${escapeHtml(slide.title)}</h1>${(slide.subtitle ?? spec.subtitle) ? `<p>${escapeHtml(slide.subtitle ?? spec.subtitle!)}</p>` : ""}</div>`;
        break;
      case "bullets":
        body = `<ul class="bullets">${slide.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
        break;
      case "metrics":
        body = `<div class="metrics">${slide.metrics.map((metric) => `<section><strong>${escapeHtml(metric.value)}</strong><h2>${escapeHtml(metric.label)}</h2>${metric.detail ? `<p>${escapeHtml(metric.detail)}</p>` : ""}</section>`).join("")}</div>`;
        break;
      case "table":
        body = `<table><thead><tr>${slide.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${slide.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        break;
      case "chart":
        body = `<div class="chart">${renderChart(slide)}</div>`;
        break;
      case "comparison":
        body = `<div class="comparison">${[slide.left, slide.right].map((column) => `<section><h2>${escapeHtml(column.heading)}</h2>${column.bullets.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</section>`).join("")}</div>`;
        break;
      case "process":
        body = `<div class="process">${slide.steps.map((step, i) => `<section><strong>${String(i + 1).padStart(2, "0")}</strong><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.description)}</p></section>`).join("")}</div>`;
        break;
    }
    return `<article class="slide slide-${slide.kind}" aria-label="Slide ${index + 1}">${slide.kind === "cover" ? "" : `<header><h1>${escapeHtml(slide.title)}</h1></header>`}<main>${body}</main><footer><span>${slide.sourceIds?.length ? `Sources: ${slide.sourceIds.length} (speaker notes)` : ""}</span><span>${String(index + 1).padStart(2, "0")}</span></footer></article>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#e2e8f0;color:#263544;font-family:Aptos,Arial,sans-serif}.slide{--ink:#${palette.ink};--accent:#${palette.accent};--pale:#${palette.pale};position:relative;width:100%;aspect-ratio:16/9;background:white;border-left:1.2cqw solid var(--ink);padding:4cqw 4.8cqw 5cqw;container-type:inline-size;overflow:hidden;margin:0 0 16px}h1,h2,p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:3.1cqw;line-height:1.16;color:var(--ink);font-weight:700;max-height:7.4cqw}header{height:8.1cqw;position:relative}header:after{content:'';position:absolute;bottom:0;width:5.7cqw;border-bottom:.2cqw solid var(--accent)}main{padding-top:2.2cqw;height:37cqw}footer{position:absolute;left:4.8cqw;right:4.8cqw;bottom:1.5cqw;border-top:.07cqw solid #d8dbe0;padding-top:1cqw;display:flex;justify-content:space-between;color:#55606c;font-size:1cqw}.slide-cover{background:var(--ink)}.slide-cover:after{content:'';position:absolute;right:0;top:0;width:19%;height:93%;background:var(--accent)}.cover-copy{position:relative;z-index:1;width:76%;margin-top:11cqw}.slide-cover h1{color:white;font-size:4.3cqw;max-height:none}.cover-copy p{font-size:2.45cqw;line-height:1.4;color:white;margin-top:3cqw}.slide-cover footer{color:white}.slide-bullets ul{margin:0;padding:0 1cqw 0 2.5cqw}.slide-bullets li{padding-left:.8cqw;font-size:2.4cqw;line-height:1.35;margin-bottom:2.1cqw;white-space:pre-wrap;overflow-wrap:anywhere}.slide-bullets li::marker{color:var(--accent)}.metrics,.process{display:flex;gap:3cqw;margin-top:1cqw}.metrics section,.process section{flex:1;min-width:0}.metrics section+section{border-left:.1cqw solid #d8dbe0;padding-left:2cqw}.metrics strong{display:block;font-size:4.1cqw;line-height:1.2;color:var(--ink);min-height:10cqw;overflow-wrap:anywhere}.metrics h2{font-size:2.1cqw;line-height:1.3;min-height:6cqw}.metrics p{font-size:1.8cqw;line-height:1.45;color:#55606c;margin-top:1.2cqw}table{width:100%;height:33cqw;border-collapse:collapse;table-layout:fixed;font-size:1.5cqw}th,td{padding:.65cqw 1cqw;border:.1cqw solid white;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}th{background:var(--ink);color:white}tbody tr:nth-child(odd){background:var(--pale)}.chart{height:35cqw}.chart svg{height:100%;width:100%;font-family:Aptos,Arial,sans-serif;font-size:15px;fill:#55606c}.unit{position:absolute;top:14cqw;left:9cqw;font-size:1.4cqw}.comparison{display:flex;gap:5cqw}.comparison section{flex:1;min-width:0}.comparison h2{font-size:2.5cqw;line-height:1.2;min-height:6.5cqw;border-bottom:.1cqw solid #d8dbe0;padding-bottom:1cqw}.comparison p{font-size:1.9cqw;line-height:1.3;min-height:5.8cqw;margin-top:1cqw}.process strong{font-size:4cqw;color:var(--accent);display:block;padding-bottom:1cqw;border-bottom:.2cqw solid var(--accent)}.process h2{font-size:2.3cqw;line-height:1.3;margin-top:1.6cqw;min-height:7.3cqw}.process p{font-size:1.9cqw;line-height:1.4;margin-top:1.8cqw}@media print{body{background:white}.slide{page-break-after:always;margin:0}@page{size:13.333in 7.5in;margin:0}}
</style></head><body>${spec.slides.map((slide, index) => (slideIndex === undefined || slideIndex === index ? slideHtml(slide, index) : "")).join("")}</body></html>`;
}
