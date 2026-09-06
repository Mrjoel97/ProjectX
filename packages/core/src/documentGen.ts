// Pure document-generation validators for the attachment engine (CLAUDE.md §1: no Convex/pdf-lib
// import — domain logic stays portable and testable without the runtime).
//
// These are the text→PDF pre-processors the renderer (llm.ts markdownToPdf) wraps:
//   - tokenizeMarkdown: a line-based markdown → block-token list (headings/bullets/paragraphs).
//   - toWinAnsi: sanitize LLM prose to a WinAnsi-safe string so pdf-lib Standard-14 drawText can
//     NEVER throw on smart punctuation / astral glyphs (V2 — no silent corruption).
//   - buildDocFilename: a deterministic, LLM-free safe filename from a topic + date + format.
//   - renderHtmlDocument: the second output format — DocToken[] → escaped, self-contained HTML.
//   - markdownToSheets: the THIRD output format (Phase 40) — pipe tables → sheet rows for the
//     .xlsx writer in @pikar/vault. This module still imports nothing: it hands over rows.
//   - exceedsByteCap / PLAN_ATTACHMENT_CAP_BYTES: the attachment size guard.
//
// ponytail: line-based md tokenizer; swap to marked tokens if inline/nested md needed.

/** The OOXML spreadsheet MIME. Written here and nowhere else — the read side already had this
 *  literal in two places (vaultDrive's Drive filter, @pikar/vault extractKind); the write side
 *  gets it from `formatSpec("xlsx")`. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

/** The output formats renderAndStore can emit. `pdf` is the Phase-3.3 default — callers that
 *  omit `format` are byte-identical to today. Phase 40 (DOC-01) added `xlsx`; ADR-036 fixes this
 *  as the CLOSED set — there is no DOCX/PPTX member and there is not going to be one. */
export type DocFormat = "pdf" | "html" | "xlsx";

const FORMAT: Record<DocFormat, { ext: string; mimeType: string }> = {
  pdf: { ext: "pdf", mimeType: "application/pdf" },
  html: { ext: "html", mimeType: "text/html" },
  xlsx: { ext: "xlsx", mimeType: XLSX_MIME },
};

/** ext + MIME for a format — the ONE place either literal is written. */
export const formatSpec = (f: DocFormat): { ext: string; mimeType: string } => FORMAT[f];

/** The reverse: a stored attachment's MIME → its format, or null for anything this system did
 *  not write. `regenerateAttachment` uses it to rebuild an attachment in the format it already
 *  had — without it, regenerating an html or xlsx attachment silently produced a PDF. */
export const formatForMime = (mimeType: string): DocFormat | null =>
  (Object.keys(FORMAT) as DocFormat[]).find((f) => FORMAT[f].mimeType === mimeType) ?? null;

/** A rendered block. Headings/para/bullet/ordered carry raw `text` (the renderer applies
 * `inlineRuns` for bold); a table carries its parsed header + body cells. */
export type DocToken =
  | { kind: "h1" | "h2" | "h3" | "bullet" | "para"; text: string }
  | { kind: "ordered"; text: string; num: number }
  | { kind: "table"; header: string[]; rows: string[][] };

/** One styled span of inline text: `bold` runs render in the bold font. */
export type InlineRun = { text: string; bold: boolean };

const HEADING_KINDS = ["h1", "h2", "h3"] as const;

const isTableRow = (l: string): boolean => l.startsWith("|") && l.indexOf("|", 1) > 0;
// The |---|:--:| divider under a table's header row (dashes + optional colons/pipes/spaces).
const isTableSep = (l: string): boolean => /-/.test(l) && /^\|?[\s:|-]+$/.test(l);
const splitRow = (l: string): string[] =>
  l
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/**
 * Line-based markdown → block tokens. Supports `#`..`######` headings (clamped to 3 visual
 * levels), `- `/`* ` bullets, `N. ` numbered items, GitHub pipe tables (a header row + a
 * `|---|` divider + body rows), and blank-line-separated paragraphs (consecutive plain lines
 * join with a single space). Inline emphasis stays in the token text — `inlineRuns` resolves it
 * at render time, so raw `**`/`` ` `` never reach the page.
 */
export function tokenizeMarkdown(md: string): DocToken[] {
  const tokens: DocToken[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      tokens.push({ kind: "para", text: para.join(" ") });
      para = [];
    }
  };
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") {
      flush();
      continue;
    }
    // Table: a pipe header row immediately followed by a |---| separator, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1]!.trim())) {
      flush();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2; // consume header + separator
      while (i < lines.length && isTableRow(lines[i]!.trim())) {
        rows.push(splitRow(lines[i]!.trim()));
        i++;
      }
      i--; // the for-loop re-increments
      tokens.push({ kind: "table", header, rows });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1]!.length, 3);
      tokens.push({ kind: HEADING_KINDS[level - 1]!, text: heading[2]!.trim() });
      continue;
    }
    const ordered = line.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      flush();
      tokens.push({ kind: "ordered", text: ordered[2]!.trim(), num: Number(ordered[1]) });
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flush();
      tokens.push({ kind: "bullet", text: line.slice(2).trim() });
      continue;
    }
    para.push(line);
  }
  flush();
  return tokens;
}

/**
 * Markdown tables → sheet sources for the `.xlsx` writer (@pikar/vault `sheetsToXlsx`).
 *
 * The drafter writes ONE pipe table per sheet under its own heading, so the mapping is: every
 * `table` token becomes a sheet, named from the most recent heading above it. Row 0 of the sheet is
 * the table's header row, because that is what the reader of a spreadsheet expects in row 1.
 *
 * Returns `[]` when the draft has no table at all — the caller turns that into a render refusal
 * (an empty workbook is not a deliverable, and silently sending one would be the dishonest path).
 *
 * ponytail: reuses `tokenizeMarkdown`, so a spreadsheet inherits exactly the markdown the PDF and
 * HTML renderers understand — one parser for every format (dashboard-pages.md's rule). Cells stay
 * strings; the upgrade path, if a sheet ever needs real numbers, is a typed cell here AND in
 * `sheetsToXlsx`, never a second parser.
 */
export type SheetSource = { name: string; rows: string[][] };

export function markdownToSheets(markdown: string): SheetSource[] {
  const sheets: SheetSource[] = [];
  let heading: string | null = null;
  for (const t of tokenizeMarkdown(markdown)) {
    if (t.kind === "h1" || t.kind === "h2" || t.kind === "h3") {
      heading = t.text;
      continue;
    }
    if (t.kind !== "table") continue;
    sheets.push({
      name: heading ?? `Sheet ${sheets.length + 1}`,
      rows: [t.header, ...t.rows],
    });
    heading = null; // one heading titles one table; a second table needs its own
  }
  return sheets;
}

/**
 * Resolve inline emphasis into styled runs. `**bold**` / `__bold__` become bold runs; every other
 * stray inline marker (`*`, `` ` ``, leftover `_`) is stripped so the page never shows raw syntax.
 * ponytail: mid-word bold (`un**x**y`) splits into space-separated words at render — rare in
 * generated prose; swap in a real inline parser (marked) if it starts mattering.
 */
export function inlineRuns(text: string): InlineRun[] {
  const clean = (s: string): string => s.replace(/[*`_]/g, "");
  const runs: InlineRun[] = [];
  const re = /(\*\*|__)(.+?)\1/g;
  let last = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) runs.push({ text: clean(text.slice(last, m.index)), bold: false });
    runs.push({ text: clean(m[2]!), bold: true });
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) runs.push({ text: clean(text.slice(last)), bold: false });
  return runs.filter((r) => r.text.length > 0);
}

/** HTML-escape. There is NO escaper anywhere in this repo (verified) and no dependency is
 *  warranted for five replacements. */
const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Code-owned CSS. ZERO interpolation, by construction — nothing model-authored may reach it.
const HTML_STYLE =
  "body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:44rem;" +
  "margin:2rem auto;padding:0 1rem}h1{font-size:1.75rem}h2{font-size:1.35rem}h3{font-size:1.1rem}" +
  "table{border-collapse:collapse;width:100%}th,td{border:1px solid #d4d4d4;padding:.4rem .6rem;" +
  "text-align:left}th{background:#f5f5f5}";

/**
 * A self-contained HTML page rendered from the drafter's markdown. THE SC#5 BOUNDARY: this
 * function is the ONLY producer of stored HTML bytes, it renders from `tokenizeMarkdown`'s
 * DocToken[] (never from the raw string), and EVERY value that came from the model passes through
 * `esc()`. CONVENTION (asserted by documentGen.test.ts): inside this function, a template
 * interpolation is either an `esc(...)` call or a local whose name ends in `Html` (already-rendered,
 * already-escaped markup). A future edit that interpolates a raw model string turns that test RED.
 */
export function renderHtmlDocument(title: string, markdown: string): string {
  const runsHtml = (t: string): string =>
    inlineRuns(t)
      .map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text)))
      .join("");
  const bodyHtml = tokenizeMarkdown(markdown)
    .map((token) => {
      if (token.kind === "table") {
        const headHtml = token.header.map((c) => `<th>${esc(c)}</th>`).join("");
        const rowsHtml = token.rows
          .map((r) => {
            const cellsHtml = r.map((c) => `<td>${esc(c)}</td>`).join("");
            return `<tr>${cellsHtml}</tr>`;
          })
          .join("");
        return `<table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
      }
      const textHtml = runsHtml(token.text);
      if (token.kind === "h1") return `<h1>${textHtml}</h1>`;
      if (token.kind === "h2") return `<h2>${textHtml}</h2>`;
      if (token.kind === "h3") return `<h3>${textHtml}</h3>`;
      if (token.kind === "bullet") return `<ul><li>${textHtml}</li></ul>`;
      if (token.kind === "ordered")
        return `<ol start="${esc(String(token.num))}"><li>${textHtml}</li></ol>`;
      return `<p>${textHtml}</p>`;
    })
    .join("\n");
  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<title>${esc(title)}</title><style>${HTML_STYLE}</style></head>` +
    `<body><h1>${esc(title)}</h1>\n${bodyHtml}\n</body></html>\n`
  );
}

// The LLM-prose offenders (RESEARCH §1): curly quotes, en/em-dash, ellipsis, nbsp. Mapped to
// their ASCII/WinAnsi equivalents so the sanitized string is drawable AND readable.
const WINANSI_MAP: Record<string, string> = {
  "‘": "'", // ‘
  "’": "'", // ’
  "‚": "'", // ‚
  "‛": "'", // ‛
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "‟": '"', // ‟
  "–": "-", // – en-dash
  "—": "-", // — em-dash
  "―": "-", // ― horizontal bar
  "−": "-", // − minus sign
  "…": "...", // … ellipsis
  " ": " ", // nbsp
};

/**
 * Sanitize a string so every remaining character is encodable by pdf-lib's WinAnsi Standard-14
 * fonts. Known offenders map to ASCII; anything else outside the WinAnsi-safe ranges
 * (0x20–0x7E printable ASCII, 0xA0–0xFF Latin-1 — all valid in Windows-1252) is DROPPED so
 * drawText can never throw at render time (V2 — sanitize-or-drop, never a partial PDF).
 */
export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const mapped = WINANSI_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out += ch;
    // else: no WinAnsi mapping → drop (never left to throw at draw time).
  }
  return out;
}

/**
 * Deterministic, LLM-free safe filename from a topic + ISO date. Lowercases, strips every
 * non-[a-z0-9] run to a single dash, appends the date, and disambiguates against `existing`
 * with a `-N` suffix. The extension follows `format`, defaulting to `pdf`.
 */
export function buildDocFilename(
  topic: string,
  date: string,
  existing: readonly string[] = [],
  format: DocFormat = "pdf",
): string {
  const { ext } = FORMAT[format];
  const slug =
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document";
  const base = `${slug}-${date}`;
  const taken = new Set(existing);
  let name = `${base}.${ext}`;
  let n = 1;
  while (taken.has(name)) {
    name = `${base}-${n}.${ext}`;
    n++;
  }
  return name;
}

/** The plan-attachment total-size ceiling: 8 MiB (RESEARCH O2). */
export const PLAN_ATTACHMENT_CAP_BYTES = 8 * 1024 * 1024;

/** True when `totalBytes` is over `cap` (default 8 MiB). Boundary is inclusive-OK (>). */
export function exceedsByteCap(
  totalBytes: number,
  cap: number = PLAN_ATTACHMENT_CAP_BYTES,
): boolean {
  return totalBytes > cap;
}
