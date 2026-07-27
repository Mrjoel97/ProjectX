// Recovery parsers for the documents that are NOT zips: HTML/XML markup, RTF, and legacy OLE2
// (Word 97 / PowerPoint 97) body text. DEPENDENCY-FREE by design — no `fflate`, no `node:*` — so
// unlike officeText.ts this module is barrel-safe and may be imported from a default-runtime (V8)
// Convex module. Throws `raw_parse_failed: ...` on input it cannot read.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

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

/**
 * Markup (HTML / XHTML / XML) to plain text. Takes a STRING because both callers — the EPUB walker
 * in officeText.ts and the markup extraction rail — already hold decoded text.
 *
 * Order is load-bearing: script/style/comment BODIES are removed BEFORE the generic tag strip,
 * because stripping tags first would inline the script source as document text.
 */
export function markupText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(BLOCK, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
}
