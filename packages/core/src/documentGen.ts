// Pure document-generation validators for the attachment engine (CLAUDE.md §1: no Convex/pdf-lib
// import — domain logic stays portable and testable without the runtime).
//
// These are the text→PDF pre-processors the renderer (llm.ts markdownToPdf) wraps:
//   - tokenizeMarkdown: a line-based markdown → block-token list (headings/bullets/paragraphs).
//   - toWinAnsi: sanitize LLM prose to a WinAnsi-safe string so pdf-lib Standard-14 drawText can
//     NEVER throw on smart punctuation / astral glyphs (V2 — no silent corruption).
//   - buildDocFilename: a deterministic, LLM-free safe filename from a topic + date.
//   - exceedsByteCap / PLAN_ATTACHMENT_CAP_BYTES: the attachment size guard.
//
// ponytail: line-based md tokenizer; swap to marked tokens if inline/nested md needed.

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
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: clean(text.slice(last, m.index)), bold: false });
    runs.push({ text: clean(m[2]!), bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: clean(text.slice(last)), bold: false });
  return runs.filter((r) => r.text.length > 0);
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
 * with a `-N` suffix. Always ends in `.pdf`.
 */
export function buildDocFilename(
  topic: string,
  date: string,
  existing: readonly string[] = [],
): string {
  const slug =
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document";
  const base = `${slug}-${date}`;
  const taken = new Set(existing);
  let name = `${base}.pdf`;
  let n = 1;
  while (taken.has(name)) {
    name = `${base}-${n}.pdf`;
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
