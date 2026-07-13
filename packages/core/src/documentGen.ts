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

/** A single rendered block. Bullets and headings/paragraphs share the {kind,text} shape. */
export type DocToken = {
  kind: "h1" | "h2" | "h3" | "bullet" | "para";
  text: string;
};

const HEADING_KINDS = ["h1", "h2", "h3"] as const;

/**
 * Line-based markdown → block tokens. Supports `#`/`##`/`###` headings, `- ` bullets, and
 * blank-line-separated paragraphs (consecutive plain lines join into one paragraph with a
 * single space). NO inline/nested markdown — the renderer draws each token's text verbatim.
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
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) {
      flush();
      tokens.push({ kind: HEADING_KINDS[heading[1]!.length - 1]!, text: heading[2]!.trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      flush();
      tokens.push({ kind: "bullet", text: line.slice(2).trim() });
      continue;
    }
    para.push(line);
  }
  flush();
  return tokens;
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
