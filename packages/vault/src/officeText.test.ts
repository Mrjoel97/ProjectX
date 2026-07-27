import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractOfficeText } from "./officeText";

// All fixtures are built in-test with the SAME dep the parser uses — no binary fixtures in repo.
// NOTE: extractOfficeText takes ONE argument. No MIME type is supplied anywhere in this file —
// every fixture identifies itself by the ZIP ENTRIES it carries (SC#2).
const docxOf = (body: string) =>
  zipSync({
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://x"><w:body>${body}</w:body></w:document>`,
    ),
  });

/** An OOXML workbook always carries xl/workbook.xml — that entry is the XLSX/XLSM marker. */
const xlsxOf = (parts: Record<string, Uint8Array>) =>
  zipSync({ "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook/>`), ...parts });

const pptxOf = (parts: Record<string, Uint8Array>) =>
  zipSync({ "ppt/presentation.xml": strToU8(`<?xml version="1.0"?><p:presentation/>`), ...parts });

const odfOf = (mimetype: string, content: string) =>
  zipSync({
    mimetype: strToU8(mimetype),
    "content.xml": strToU8(
      `<?xml version="1.0"?><office:document-content xmlns:text="http://x">${content}</office:document-content>`,
    ),
  });

describe("extractOfficeText — DOCX/DOCM (EXTR-C)", () => {
  it("extracts from word/document.xml with NO mime type supplied at all (SC#2)", () => {
    const bytes = docxOf(`<w:p><w:r><w:t>Self identified</w:t></w:r></w:p>`);
    expect(extractOfficeText(bytes).text).toBe("Self identified");
  });

  it("joins runs within a paragraph and captures attribute-bearing <w:t> (Pitfall 7)", () => {
    const bytes = docxOf(
      `<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; co</w:t></w:r></w:p>`,
    );
    expect(extractOfficeText(bytes).text).toBe("Hello world & co");
  });

  it("separates paragraphs with newlines", () => {
    const bytes = docxOf(
      `<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`,
    );
    expect(extractOfficeText(bytes).text).toBe("First\nSecond");
  });

  it("decodes numeric (decimal + hex) and all five named entities", () => {
    const bytes = docxOf(`<w:p><w:r><w:t>&#65;&#x42;C &lt;&gt;&quot;&apos;&amp;</w:t></w:r></w:p>`);
    expect(extractOfficeText(bytes).text).toBe(`ABC <>"'&`);
  });

  it("throws a typed error on non-zip bytes", () => {
    expect(() => extractOfficeText(new Uint8Array([1, 2, 3, 4]))).toThrow(
      "office_parse_failed: not a zip",
    );
  });
});

const sheetXml = (rows: string) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;

describe("extractOfficeText — XLSX/XLSM (EXTR-C)", () => {
  // THE OWNER'S STUCK FILE: an .xlsm is byte-structurally an .xlsx — same zip, same entries, same
  // walker. It needed NO new parser, only routing. This fixture IS what that file looks like inside.
  it("routes an .xlsm-shaped zip (xl/workbook.xml) through the XLSX walker with no mime type", () => {
    const bytes = xlsxOf({
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row><c><v>Q3 revenue</v></c></row>`)),
    });
    expect(extractOfficeText(bytes).text).toBe("Sheet 1\nQ3 revenue");
  });

  it('resolves t="s" cells through sharedStrings, keeps literal cells, tab-joins rows', () => {
    const bytes = xlsxOf({
      "xl/sharedStrings.xml": strToU8(
        `<?xml version="1.0"?><sst><si><t>Alpha &amp; Co</t></si><si><t xml:space="preserve">Beta</t></si></sst>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        sheetXml(
          `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row>` +
            `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3.14</v></c></row>`,
        ),
      ),
    });
    expect(extractOfficeText(bytes).text).toBe("Sheet 1\nAlpha & Co\t42\nBeta\t3.14");
  });

  it("orders sheets numerically (sheet2 before sheet10) with Sheet N headers and blank line between", () => {
    const bytes = xlsxOf({
      "xl/worksheets/sheet10.xml": strToU8(sheetXml(`<row><c><v>ten</v></c></row>`)),
      "xl/worksheets/sheet2.xml": strToU8(sheetXml(`<row><c><v>two</v></c></row>`)),
    });
    expect(extractOfficeText(bytes).text).toBe("Sheet 2\ntwo\n\nSheet 10\nten");
  });

  it("flattens literal-only sheets when sharedStrings.xml is absent (it is optional)", () => {
    const bytes = xlsxOf({
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row><c><v>7</v></c><c><v>8</v></c></row>`)),
    });
    expect(extractOfficeText(bytes).text).toBe("Sheet 1\n7\t8");
  });

  it("throws from the walker when the marker entry is present but the payload is not", () => {
    expect(() => extractOfficeText(xlsxOf({ "xl/other.xml": strToU8("<x/>") }))).toThrow(
      "office_parse_failed: no worksheets",
    );
  });
});

const slideXml = (runs: string) => `<?xml version="1.0"?><p:sld xmlns:a="http://x">${runs}</p:sld>`;

describe("extractOfficeText — PPTX/PPTM (EXTR-C)", () => {
  it("orders slides numerically (1, 2, 10) with Slide N headers, <a:t> runs newline-joined", () => {
    const bytes = pptxOf({
      "ppt/slides/slide10.xml": strToU8(slideXml(`<a:t>Last</a:t>`)),
      "ppt/slides/slide1.xml": strToU8(slideXml(`<a:t>Title</a:t><a:t>Subtitle &amp; more</a:t>`)),
      "ppt/slides/slide2.xml": strToU8(slideXml(`<a:t xml:space="preserve">Body</a:t>`)),
    });
    expect(extractOfficeText(bytes).text).toBe(
      "Slide 1\nTitle\nSubtitle & more\n\nSlide 2\nBody\n\nSlide 10\nLast",
    );
  });

  it("throws from the walker on a presentation with no ppt/slides/*.xml", () => {
    expect(() => extractOfficeText(pptxOf({ "ppt/other.xml": strToU8("<x/>") }))).toThrow(
      "office_parse_failed: no slides",
    );
  });
});

describe("extractOfficeText — ODF (ODT / ODS / ODP)", () => {
  it("ODT: paragraphs from <text:p>, inner <text:span> markup stripped", () => {
    const bytes = odfOf(
      "application/vnd.oasis.opendocument.text",
      `<office:body><text:p><text:span>Hello</text:span> world</text:p><text:p>Second &amp; last</text:p></office:body>`,
    );
    expect(extractOfficeText(bytes).text).toBe("Hello world\nSecond & last");
  });

  it("ODS: table rows tab-joined within a row, newline-joined between rows", () => {
    const cell = (t: string) => `<table:table-cell><text:p>${t}</text:p></table:table-cell>`;
    const bytes = odfOf(
      "application/vnd.oasis.opendocument.spreadsheet",
      `<table:table><table:table-row>${cell("A1")}${cell("B1")}</table:table-row>` +
        `<table:table-row>${cell("A2")}${cell("B2")}</table:table-row></table:table>`,
    );
    expect(extractOfficeText(bytes).text).toBe("A1\tB1\nA2\tB2");
  });

  it("ODP: draw:page text in document order", () => {
    const bytes = odfOf(
      "application/vnd.oasis.opendocument.presentation",
      `<draw:page><text:p>Page one</text:p></draw:page><draw:page><text:p>Page two</text:p></draw:page>`,
    );
    expect(extractOfficeText(bytes).text).toBe("Page one\nPage two");
  });

  it("throws when the ODF mimetype entry is present but content.xml is not", () => {
    const bytes = zipSync({
      mimetype: strToU8("application/vnd.oasis.opendocument.text"),
      "styles.xml": strToU8("<x/>"),
    });
    expect(() => extractOfficeText(bytes)).toThrow("office_parse_failed: missing content.xml");
  });
});

const epubOf = (parts: Record<string, Uint8Array>) =>
  zipSync({ "META-INF/container.xml": strToU8(`<container/>`), ...parts });

describe("extractOfficeText — EPUB", () => {
  it("reads every (x)html entry in entry-name sorted order with tags stripped", () => {
    const bytes = epubOf({
      "OEBPS/ch2.xhtml": strToU8(`<html><body><p>Chapter two</p></body></html>`),
      "OEBPS/ch1.xhtml": strToU8(`<html><body><p>Chapter &amp; one</p></body></html>`),
    });
    expect(extractOfficeText(bytes).text).toBe("Chapter & one\n\nChapter two");
  });

  it("throws when an epub carries no (x)html content", () => {
    expect(() => extractOfficeText(epubOf({ "OEBPS/cover.png": strToU8("x") }))).toThrow(
      "office_parse_failed: no epub content",
    );
  });
});

describe("extractOfficeText — dispatch precedence and the unrecognized case", () => {
  it("OOXML markers are checked FIRST: word/document.xml wins over an ODF mimetype entry", () => {
    const bytes = zipSync({
      "word/document.xml": strToU8(
        `<w:document><w:p><w:r><w:t>OOXML</w:t></w:r></w:p></w:document>`,
      ),
      mimetype: strToU8("application/vnd.oasis.opendocument.text"),
      "content.xml": strToU8(
        `<office:document-content><text:p>ODF</text:p></office:document-content>`,
      ),
    });
    expect(extractOfficeText(bytes).text).toBe("OOXML");
  });

  it("names the ZIP, not a mime type, when no marker entry is present", () => {
    const bytes = zipSync({ "a.txt": strToU8("one"), "b.txt": strToU8("two") });
    expect(() => extractOfficeText(bytes)).toThrow("office_parse_failed: unrecognized zip");
  });
});

describe("extractOfficeText — determinism (same bytes in, byte-identical text out)", () => {
  const cases: [string, Uint8Array][] = [
    ["DOCX", docxOf(`<w:p><w:r><w:t>Stable &amp; sure</w:t></w:r></w:p>`)],
    [
      "XLSM-shaped",
      xlsxOf({
        "xl/worksheets/sheet2.xml": strToU8(sheetXml(`<row><c><v>two</v></c></row>`)),
        "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row><c><v>one</v></c></row>`)),
      }),
    ],
    [
      "PPTX",
      pptxOf({
        "ppt/slides/slide2.xml": strToU8(slideXml(`<a:t>Two</a:t>`)),
        "ppt/slides/slide1.xml": strToU8(slideXml(`<a:t>One</a:t>`)),
      }),
    ],
    [
      "ODT",
      odfOf("application/vnd.oasis.opendocument.text", `<text:p>One</text:p><text:p>Two</text:p>`),
    ],
    [
      "EPUB",
      epubOf({
        "OEBPS/b.xhtml": strToU8(`<p>Bee</p>`),
        "OEBPS/a.xhtml": strToU8(`<p>Aye</p>`),
      }),
    ],
  ];

  it.each(cases)("%s is byte-identical across two calls", (_name, bytes) => {
    expect(extractOfficeText(bytes).text).toBe(extractOfficeText(bytes).text);
  });
});

// A structural header (`Sheet 3`, `Slide 7`) is SCAFFOLDING. Emitted unconditionally it makes an
// empty extraction NON-EMPTY, so vaultExtract.ts's `empty_extraction` guard never fires and a
// document with nothing readable in it reports `ready` — a plausible failure, which is worse than a
// failure. Same family as 15.2-06's `okPages` and 15.2-07's `okSheets`: the success signal is a
// COUNT of parts that yielded content, NEVER the truthiness of the joined string.
describe("extractOfficeText — the false-ready family: scaffolding is not content (SC#4)", () => {
  it('XLSX: sheets with no cell values extract to "" — NOT `Sheet 1 / Sheet 2`', () => {
    const bytes = xlsxOf({
      // value-less cells (self-closing <c/>) and a sheet with no <row> at all
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row r="1"><c r="A1"/><c r="B1"/></row>`)),
      "xl/worksheets/sheet2.xml": strToU8(sheetXml("")),
    });
    // `=== ""`, not `.trim() === ""`: "Sheet 1\n\n\nSheet 2" is what shipped before this gate.
    expect(extractOfficeText(bytes).text).toBe("");
  });

  it("XLSX: an empty sheet emits NO header and the surviving sheet keeps its OWN number", () => {
    const bytes = xlsxOf({
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row r="1"><c r="A1"/></row>`)),
      "xl/worksheets/sheet2.xml": strToU8(sheetXml(`<row><c><v>7</v></c><c><v>8</v></c></row>`)),
    });
    const { text } = extractOfficeText(bytes);
    expect(text).toBe("Sheet 2\n7\t8"); // NOT renumbered to "Sheet 1"
    expect(text).not.toContain("Sheet 1");
  });

  it('PPTX: slides whose only <a:t> is a slide-number field extract to ""', () => {
    const bytes = pptxOf({
      "ppt/slides/slide1.xml": strToU8(
        slideXml(`<a:fld id="{A}" type="slidenum"><a:t>1</a:t></a:fld>`),
      ),
      "ppt/slides/slide2.xml": strToU8(
        slideXml(`<a:fld id="{B}" type="slidenum"><a:t>2</a:t></a:fld>`),
      ),
      "ppt/slideLayouts/slideLayout1.xml": strToU8(
        slideXml(`<a:t>Click to edit Master title style</a:t>`),
      ),
    });
    expect(extractOfficeText(bytes).text).toBe("");
  });

  it("PPTX: a whitespace-only run cannot hold a header up on its own", () => {
    const bytes = pptxOf({
      "ppt/slides/slide1.xml": strToU8(slideXml(`<a:t xml:space="preserve">   </a:t>`)),
    });
    expect(extractOfficeText(bytes).text).toBe("");
  });

  it("PPTX: a blank slide emits no header and the surviving slide keeps its OWN number", () => {
    const bytes = pptxOf({
      "ppt/slides/slide1.xml": strToU8(slideXml(`<a:t xml:space="preserve"> </a:t>`)),
      "ppt/slides/slide2.xml": strToU8(slideXml(`<a:t>Real content</a:t>`)),
    });
    const { text } = extractOfficeText(bytes);
    expect(text).toBe("Slide 2\nReal content");
    expect(text).not.toContain("Slide 1");
  });

  // *No sheets/slides at all* is a BROKEN ARCHIVE; *sheets/slides with nothing in them* is an EMPTY
  // DOCUMENT. Different facts, different endings — do not let anyone merge the throws into the ""
  // path above.
  it("the structural throws are UNCHANGED and still reachable", () => {
    expect(() => extractOfficeText(xlsxOf({ "xl/other.xml": strToU8("<x/>") }))).toThrow(
      "office_parse_failed: no worksheets",
    );
    expect(() => extractOfficeText(pptxOf({ "ppt/other.xml": strToU8("<x/>") }))).toThrow(
      "office_parse_failed: no slides",
    );
  });
});

describe("officeText source contract", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "officeText.ts"), "utf8");
  // Scan CODE, not prose (the 15.2-07 precedent): this file's comments deliberately name the banned
  // form so the next reader knows what it is, and a naive scan would go red on a correct file.
  const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const PART_LABEL = /`(?:Sheet|Slide) \$\{/g;

  it("every Sheet-N / Slide-N part-label literal is an argument to labelled()", () => {
    const all = [...code.matchAll(PART_LABEL)].length;
    const gated = [...code.matchAll(/labelled\(\s*`(?:Sheet|Slide) \$\{/g)].length;
    expect(all, "the part-label literals must still exist").toBeGreaterThan(0);
    expect(gated, "a part label may ONLY reach the output through labelled()").toBe(all);
  });
});
