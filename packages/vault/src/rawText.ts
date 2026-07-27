// Recovery parsers for the documents that are NOT zips: HTML/XML markup, RTF, and legacy OLE2
// (Word 97 / PowerPoint 97) body text. DEPENDENCY-FREE by design — no `fflate`, no `node:*` — so
// unlike officeText.ts this module is barrel-safe and may be imported from a default-runtime (V8)
// Convex module. Throws `raw_parse_failed: ...` on input it cannot read.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

// Constructed LAZILY inside the decode helper, never at module scope: this module is on the
// @pikar/vault barrel, and `new TextDecoder("windows-1252")` throws RangeError on a runtime built
// without full ICU. A throw at import time would take down every module that touches the barrel;
// a throw inside rtfText/oleText is a single honest `failed` document.
let cp1252: TextDecoder | undefined;

function decodeCp1252(bytes: Uint8Array): string {
  cp1252 ??= new TextDecoder("windows-1252");
  return cp1252.decode(bytes);
}

/** The ONE entity decoder in this package — officeText.ts imports it from here. */
export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (match, e: string) => {
    if (e[0] !== "#") return NAMED[e] ?? match;
    const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return Number.isNaN(code) ? match : String.fromCodePoint(code);
  });
}

/** Tags whose boundary is a LINE break rather than a word break. */
const BLOCK =
  /<\/?(?:p|div|br|hr|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|blockquote|pre|figure|figcaption|table)(?:\s[^>]*)?\/?>/gi;

/** Whitespace runs collapse to one space, line breaks survive as single newlines, ends trimmed. */
function collapse(s: string): string {
  return s
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
}

/**
 * Markup (HTML / XHTML / XML) to plain text. Takes a STRING because both callers — the EPUB walker
 * in officeText.ts and the markup extraction rail — already hold decoded text.
 *
 * Order is load-bearing: script/style/comment BODIES are removed BEFORE the generic tag strip,
 * because stripping tags first would inline the script source as document text.
 */
export function markupText(html: string): string {
  return collapse(
    decodeEntities(
      html
        .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script\s*>/gi, " ")
        .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style\s*>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(BLOCK, "\n")
        .replace(/<[^>]*>/g, " "),
    ),
  );
}

/** A control word, its optional signed numeric argument, and the one delimiter space RTF allows. */
const RTF_CONTROL = /\\([a-zA-Z]+)(-?\d+)? ?/y;
/** Control words that are a LINE BREAK rather than formatting to be dropped. */
const RTF_BREAKS = new Set(["par", "line", "sect", "page"]);

/**
 * RTF body text. A brace-DEPTH scanner, not a regex: ignorable `{\*\...}` destinations nest, and a
 * regex cannot balance braces — flattening them would emit generator/font/colour tables as prose.
 */
export function rtfText(bytes: Uint8Array): string {
  const src = decodeCp1252(bytes);
  if (!src.startsWith("{\\rtf")) throw new Error("raw_parse_failed: not rtf");
  const out: string[] = [];
  let depth = 0;
  let skipDepth = -1; // brace depth of the ignorable destination currently being skipped
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charAt(i);
    if (c === "{") {
      depth += 1;
      if (skipDepth < 0 && src.charAt(i + 1) === "\\" && src.charAt(i + 2) === "*") {
        skipDepth = depth;
      }
      continue;
    }
    if (c === "}") {
      if (skipDepth === depth) skipDepth = -1;
      depth -= 1;
      continue;
    }
    if (skipDepth >= 0) continue;
    if (c !== "\\") {
      out.push(c);
      continue;
    }
    const next = src.charAt(i + 1);
    if (next === "\\" || next === "{" || next === "}") {
      out.push(next); // an ESCAPED literal, not a control word
      i += 1;
      continue;
    }
    if (next === "'") {
      const code = Number.parseInt(src.slice(i + 2, i + 4), 16);
      if (!Number.isNaN(code)) {
        out.push(decodeCp1252(Uint8Array.of(code)));
        i += 3;
        continue;
      }
    }
    RTF_CONTROL.lastIndex = i;
    const control = RTF_CONTROL.exec(src);
    if (control) {
      if (RTF_BREAKS.has(control[1] ?? "")) out.push("\n");
      i = RTF_CONTROL.lastIndex - 1;
      continue;
    }
    i += 1; // a control SYMBOL (non-alphabetic) — drop the backslash and the symbol it marks
  }
  const text = collapse(out.join(""));
  if (text.length === 0) throw new Error("raw_parse_failed: no text recovered");
  return text;
}

const MIN_RUN = 4;

/**
 * OLE2 structural stream names. Matched on the WHOLE run, never as a substring — a substring rule
 * would delete any sentence containing the word "Data". The 0x05 byte that prefixes the two
 * SummaryInformation streams is not printable, so those runs already surface as the bare name and
 * match here exactly (RESEARCH §6).
 */
const OLE_STREAM_NAMES = new Set([
  "Root Entry",
  "WordDocument",
  "1Table",
  "0Table",
  "Data",
  "SummaryInformation",
  "DocumentSummaryInformation",
  "PowerPoint Document",
  "Current User",
  "Pictures",
  "ObjectPool",
  "CompObj",
  "MsoDataStore",
]);

function printableByte(b: number): boolean {
  return (
    (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0xa0 && b <= 0xff)
  );
}

type Run = { at: number; text: string };

/** Maximal spans of printable CP1252 bytes. UTF-16LE text cannot match: every other byte is 0x00. */
function cp1252Runs(bytes: Uint8Array): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i += 1) {
    if (i < bytes.length && printableByte(bytes[i] as number)) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0 && i - start >= MIN_RUN) {
      runs.push({ at: start, text: decodeCp1252(bytes.subarray(start, i)) });
    }
    start = -1;
  }
  return runs;
}

/** Maximal spans of (printable byte, 0x00) pairs — alignment-agnostic, so odd offsets are found. */
function utf16Runs(bytes: Uint8Array): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i + 1 < bytes.length) {
    if (!(printableByte(bytes[i] as number) && bytes[i + 1] === 0)) {
      i += 1;
      continue;
    }
    const start = i;
    let text = "";
    while (i + 1 < bytes.length && printableByte(bytes[i] as number) && bytes[i + 1] === 0) {
      text += String.fromCharCode(bytes[i] as number); // high byte is 0x00: byte === code point
      i += 2;
    }
    if (text.length >= MIN_RUN) runs.push({ at: start, text });
  }
  return runs;
}

/**
 * Body text of a legacy OLE2 Word 97 / PowerPoint 97 file, with NO dependency: Word and PowerPoint
 * store body text as text (the `WordDocument` stream / `TextBytesAtom` + `TextCharsAtom` records),
 * so a printable-run sweep in both encodings recovers it. Runs are emitted in byte-offset order,
 * which is both deterministic and roughly document order (Word 97 body text is largely contiguous).
 *
 * THROWS rather than returning "" when nothing survives: an empty extraction that "succeeds" lands
 * as a `ready` document with 0 chars — a plausible failure, which is worse than a failure.
 *
 * ponytail: this is a SWEEP, deliberately imperfect — no field codes, no table structure, no
 * reading-order guarantee, and a UTF-16LE character outside Latin-1 is skipped. A downstream LLM
 * structures the text; we are not round-tripping the file. `_kind` is unused because the sweep is
 * format-agnostic and the stop-list is the union of both formats' stream names; it stays in the
 * signature because the caller has it and the upgrade path needs it. Upgrade path if fidelity
 * complaints surface: `word-extractor` for DOC, SheetJS for PPT/XLS (plan 15.2-07's spike).
 */
export function oleText(bytes: Uint8Array, _kind: "doc" | "ppt"): string {
  const runs = [...cp1252Runs(bytes), ...utf16Runs(bytes)].sort((a, b) => a.at - b.at);
  const kept: string[] = [];
  for (const run of runs) {
    const text = run.text.trim();
    if (text.length < MIN_RUN || OLE_STREAM_NAMES.has(text)) continue;
    if (kept[kept.length - 1] === text) continue; // OLE2 repeats stream names verbatim
    kept.push(text);
  }
  if (kept.length === 0) throw new Error("raw_parse_failed: no text recovered");
  return kept.join("\n");
}
