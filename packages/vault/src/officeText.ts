// Deterministic flatten of every ZIP-based office document: one fflate unzip + one
// attribute-tolerant regex XML text-walk (the locked fidelity bar is FLATTEN — text runs only, no
// XML parser dep). Dispatch is on the MARKER ENTRY the archive carries, never on a declared MIME
// type: that is what makes coverage true BY CONSTRUCTION (a .docm/.xlsm/.pptm is byte-structurally
// its non-macro twin) instead of by an enumeration that is always one format behind.
// Deliberately NOT exported from the index barrel: only the "use node" vaultExtract.ts imports
// it via the subpath export `@pikar/vault/officeText`, which keeps fflate structurally out of
// the V8 Convex bundle. Throws `office_parse_failed: ...` on malformed input — the Lane-1
// dispatcher catches and marks the doc failed.
import { strFromU8, unzipSync } from "fflate";
import { decodeEntities, markupText } from "./rawText";

/** Raw (still entity-encoded) inner text of each `<tag ...>...</tag>` — attribute-tolerant. */
function rawRunsOf(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (m) => m[1] ?? "",
  );
}

/** All text runs of `<tag ...>...</tag>` — attribute-tolerant (Pitfall 7: xml:space="preserve"). */
function runsOf(xml: string, tag: string): string[] {
  return rawRunsOf(xml, tag).map(decodeEntities);
}

function docxText(doc: Uint8Array): string {
  return strFromU8(doc)
    .split("</w:p>")
    .map((p) => runsOf(p, "w:t").join(""))
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Zip entries matching `re` (one capture group: the number), numerically sorted (Pitfall 7). */
function numericSorted(
  entries: Record<string, Uint8Array>,
  re: RegExp,
): { xml: string; n: number }[] {
  return Object.entries(entries)
    .flatMap(([path, data]) => {
      const m = re.exec(path);
      return m ? [{ xml: strFromU8(data), n: Number(m[1]) }] : [];
    })
    .sort((a, b) => a.n - b.n);
}

/**
 * A structural header (`Sheet 3`, `Slide 7`) is SCAFFOLDING. Emitted unconditionally it makes an
 * empty extraction non-empty, so `empty_extraction` never fires and a document with nothing in it
 * reports `ready` — a plausible failure, which is worse than a failure. The label is therefore
 * bound to the body: no body, no label, no part. The success signal downstream is the COUNT of
 * surviving parts, never the truthiness of the joined string (`okPages` 15.2-06, `okSheets`
 * 15.2-07). `trim()` is the TEST, never a rewrite — the body is returned as it came in, so a part
 * whose first row is blank still renders that blank row.
 */
function labelled(label: string, body: string): string | null {
  return body.trim().length === 0 ? null : `${label}\n${body}`;
}

/** Parts that yielded content, blank-line joined. Nothing survived => "" — see joinParts' note. */
function joinParts(parts: (string | null)[]): string {
  // "" and NOT a throw: the archive parsed fine, so `office_parse_failed` would be a lie about a
  // perfectly valid chart-only or password-protected document. vaultExtract.ts's empty_extraction
  // guard already turns "" into the accurate reason, and that reason already carries user-facing
  // copy ("We opened this file but found no readable text."). A throw here would be a SECOND
  // failure mechanism for a case the existing one already describes correctly.
  return parts.filter((p): p is string => p !== null).join("\n\n");
}

function xlsxText(entries: Record<string, Uint8Array>): string {
  const sst = entries["xl/sharedStrings.xml"]; // optional: literal-only workbooks omit it
  // ponytail: a rich-text <si> (multiple <r><t> runs) indexes as multiple entries here;
  // per-<si> grouping is the upgrade path if real workbooks surface it.
  const shared = sst ? runsOf(strFromU8(sst), "t") : [];
  const sheets = numericSorted(entries, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  // *No worksheets at all* is a BROKEN ARCHIVE and throws; *worksheets with nothing in them* is an
  // EMPTY DOCUMENT and returns "". Different facts, different endings — do not merge them.
  if (sheets.length === 0) throw new Error("office_parse_failed: no worksheets");
  return joinParts(
    sheets.map(({ xml, n }) => {
      const rows = [...xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((row) =>
        [...(row[1] ?? "").matchAll(/<c(?:\s([^>]*))?>([\s\S]*?)<\/c>/g)]
          .map((cell) => {
            const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell[2] ?? "");
            if (!v) return "";
            const raw = decodeEntities(v[1] ?? "");
            return /\bt="s"/.test(cell[1] ?? "") ? (shared[Number(raw)] ?? "") : raw;
          })
          .join("\t"),
      );
      return labelled(`Sheet ${n}`, rows.join("\n"));
    }),
  );
}

/**
 * `<a:fld>` blocks are slide-number / date / footer FIELDS — scaffolding, not content. Measured on
 * a real deck: a field is the ENTIRE `<a:t>` content of all three of its notes slides.
 */
const PPT_FIELD = /<a:fld(?:\s[^>]*)?>[\s\S]*?<\/a:fld>/g;

/** `<a:t>` runs of one part, fields stripped and blank runs dropped (they are not content). */
function slideRuns(xml: string): string[] {
  return runsOf(xml.replace(PPT_FIELD, ""), "a:t").filter((r) => r.trim().length > 0);
}

/**
 * The three PPTX part types that carry CONTENT, as an ALLOW-LIST. A slide's rels point at plenty of
 * scaffolding (layouts, masters, themes, media, colour/style parts), so "read whatever the Target
 * says" would inject ~110 runs of "Click to edit Master title style" and repeat the deck title on
 * every layout. `drawingN.xml` is deliberately ABSENT: it is a byte-duplicate of `dataN.xml` (both
 * are referenced from the same slide), so reading it doubles the SmartArt text.
 */
const CHART_PART = /^ppt\/charts\/chart\d+\.xml$/;
const DIAGRAM_PART = /^ppt\/diagrams\/data\d+\.xml$/;
const NOTES_PART = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;

const REL_TARGET = /Target="([^"]+)"/g;

/** One line per `<c:ser>`: the cached values `<c:v>` in document order, tab-joined. */
function chartLines(xml: string): string[] {
  // <c:v> is the cache inside <c:numCache>/<c:strCache> AND carries the series NAME through
  // <c:tx><c:strRef>, so ONE tag covers names, categories and values. Tab-joined to match
  // xlsxText's and xlsText's row convention — one convention for every spreadsheet-shaped thing.
  const lines = slideRuns(xml); // the chart's own <a:t> title runs come first
  for (const frag of xml.split("</c:ser>")) {
    if (!frag.includes("<c:ser")) continue;
    const values = runsOf(frag, "c:v")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (values.length > 0) lines.push(values.join("\t"));
  }
  return lines;
}

/** Content lines of one referenced part — [] for anything outside the allow-list. */
function partLines(path: string, xml: string): string[] {
  if (CHART_PART.test(path)) return chartLines(xml);
  if (DIAGRAM_PART.test(path) || NOTES_PART.test(path)) return slideRuns(xml);
  return [];
}

/**
 * PPTX. ROUTING, not parsing: every part read here is already in the `entries` map `unzipSync`
 * returned — nothing new is unzipped, no dependency is added, no second XML walker is written.
 *
 * ponytail — the MEASURED ceilings of this walker, none of them built here:
 * - PICTURE SLIDES ARE UNREADABLE. A slide that is an image export (`image1.png`, `.wmf`) yields
 *   its title run and nothing more. No text walker will ever read them. Upgrade path: render each
 *   slide and route it through the hosted OCR rail 15.2-06 built — a different rail with a real
 *   per-page cost, deliberately out of scope. This is a ceiling, not coverage.
 * - CACHED VALUES ARE EMITTED VERBATIM. Chart categories come back as Excel DATE SERIALS
 *   (46023 / 46054 / 46082 = the Jan/Feb/Mar 2026 month ends) and percentages as full-precision
 *   floats (4.7100000000000003E-2, displayed as 4.71%). Same family as 15.2-07's `46067`.
 *   Upgrade path: read `<c:formatCode>` and apply it.
 * - EMBEDDED WORKSHEETS ARE OUT OF SCOPE BY MEASUREMENT, not omission. The real deck has no
 *   `ppt/embeddings/` directory at all; its charts declare `externalData` pointing at a path on the
 *   AUTHOR'S machine, so the cached `<c:v>` values are the complete numeric truth inside the
 *   archive. If a deck ever surfaces `ppt/embeddings/*.xlsx` the upgrade is one line — recurse
 *   `extractOfficeText` on that entry, since it is a self-identifying ZIP. An `externalData` target
 *   must NEVER be dereferenced: it is an attacker-controlled path/URL in an untrusted upload.
 * - MASTERS AND LAYOUTS ARE DELIBERATELY NEVER READ — boilerplate, pinned by a test.
 */
function pptxText(entries: Record<string, Uint8Array>): string {
  const slides = numericSorted(entries, /^ppt\/slides\/slide(\d+)\.xml$/);
  // See xlsxText: no slides at all is a broken archive; slides with nothing in them is empty.
  if (slides.length === 0) throw new Error("office_parse_failed: no slides");
  const consumed = new Set<string>();
  const parts = slides.map(({ xml, n }) => {
    const lines = slideRuns(xml);
    const rels = entries[`ppt/slides/_rels/slide${n}.xml.rels`];
    for (const m of rels ? strFromU8(rels).matchAll(REL_TARGET) : []) {
      const target = m[1] ?? "";
      const path = target.startsWith("../") ? `ppt/${target.slice(3)}` : target;
      const data = entries[path];
      if (!data || consumed.has(path)) continue; // a part referenced twice is emitted ONCE
      consumed.add(path);
      lines.push(...partLines(path, strFromU8(data)));
    }
    return labelled(`Slide ${n}`, lines.join("\n"));
  });
  // Orphan sweep: a chart or diagram no slide's rels reference is still emitted, labelled by its
  // entry path. A rels file that fails to parse must degrade to "the numbers are present but
  // unattached", never back to titles-only. Sorted, because entry order is archive order.
  for (const path of Object.keys(entries).sort()) {
    if (consumed.has(path) || !(CHART_PART.test(path) || DIAGRAM_PART.test(path))) continue;
    parts.push(labelled(path, partLines(path, strFromU8(entries[path] as Uint8Array)).join("\n")));
  }
  return joinParts(parts);
}

/** `<text:p>` runs of one ODF block, inner markup (`<text:span>`, `<text:a>`, …) stripped. */
function paragraphsOf(block: string): string[] {
  return rawRunsOf(block, "text:p")
    .map(markupText)
    .filter((t) => t.length > 0);
}

/**
 * ODT / ODS / ODP from `content.xml`. ONE walker, three shapes — the block separator is chosen from
 * what the document actually contains, never from the declared `mimetype`, so a spreadsheet inside
 * a text document still reads as rows.
 */
function odfText(content: Uint8Array): string {
  const xml = strFromU8(content);
  for (const [close, sep] of [
    ["</table:table-row>", "\t"],
    ["</draw:page>", "\n"],
  ] as const) {
    const blocks = xml
      .split(close)
      .map((b) => paragraphsOf(b).join(sep))
      .filter((b) => b.length > 0);
    if (xml.includes(close) && blocks.length > 0) return blocks.join("\n");
  }
  return paragraphsOf(xml).join("\n");
}

const EPUB_CONTENT = /\.x?html?$/i;

function epubText(entries: Record<string, Uint8Array>): string {
  // ponytail: entry-name sort, not the OPF spine order — a book whose files are not
  // lexicographically ordered reads out of order. Upgrade path: parse content.opf's <spine>.
  const names = Object.keys(entries)
    .filter((n) => EPUB_CONTENT.test(n))
    .sort();
  if (names.length === 0) throw new Error("office_parse_failed: no epub content");
  // The `.filter` is the same rule as `labelled`, made explicit: without it a book of empty
  // chapters returns "\n\n" — whitespace-only, which the downstream guard trims and so already
  // fails honestly, but "already honest by someone else's trim()" is not a property worth relying on.
  return names
    .map((n) => markupText(strFromU8(entries[n] as Uint8Array)))
    .filter((t) => t.length > 0)
    .join("\n\n");
}

const ODF_MIME_PREFIX = "application/vnd.oasis.opendocument.";

/**
 * Flatten any ZIP-based office document to text. Takes the BYTES ONLY — the archive identifies
 * itself, so a wrong, renamed or absent MIME type cannot strand a readable file.
 *
 * ponytail: dispatch is on the PRESENCE of a marker entry, so a malformed archive carrying the
 * marker but not its payload still throws `office_parse_failed` from the walker. That is the honest
 * outcome and is exactly what the vaultExtract.ts dispatcher already handles.
 */
/** Which family the archive turned out to be. Phase 40 needs it for ONE thing: only a
 *  spreadsheet gets a structured grid, and guessing from the extracted text (a workbook's text
 *  happens to start with "Sheet 1") would be a discriminator the walker never promised.
 *  Additive: every caller reads `.text`. */
export type OfficeKind = "document" | "spreadsheet" | "presentation" | "odf" | "epub";

export function extractOfficeText(bytes: Uint8Array): { text: string; kind: OfficeKind } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("office_parse_failed: not a zip");
  }
  const doc = entries["word/document.xml"]; // DOCX / DOCM
  if (doc) return { text: docxText(doc), kind: "document" };
  if (entries["xl/workbook.xml"]) return { text: xlsxText(entries), kind: "spreadsheet" }; // XLSX / XLSM
  if (entries["ppt/presentation.xml"]) return { text: pptxText(entries), kind: "presentation" }; // PPTX / PPTM
  const mimetype = entries.mimetype; // ODT / ODS / ODP — first entry, stored uncompressed
  if (mimetype && strFromU8(mimetype).trim().startsWith(ODF_MIME_PREFIX)) {
    const content = entries["content.xml"];
    if (!content) throw new Error("office_parse_failed: missing content.xml");
    return { text: odfText(content), kind: "odf" };
  }
  if (entries["META-INF/container.xml"]) return { text: epubText(entries), kind: "epub" }; // EPUB
  throw new Error("office_parse_failed: unrecognized zip");
}
