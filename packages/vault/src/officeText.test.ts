import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractOfficeText } from "./officeText";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// All fixtures are built in-test with the SAME dep the parser uses — no binary fixtures in repo.
const docxOf = (body: string) =>
  zipSync({
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://x"><w:body>${body}</w:body></w:document>`,
    ),
  });

describe("extractOfficeText — DOCX (EXTR-C)", () => {
  it("joins runs within a paragraph and captures attribute-bearing <w:t> (Pitfall 7)", () => {
    const bytes = docxOf(
      `<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; co</w:t></w:r></w:p>`,
    );
    expect(extractOfficeText(bytes, DOCX).text).toBe("Hello world & co");
  });

  it("separates paragraphs with newlines", () => {
    const bytes = docxOf(
      `<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`,
    );
    expect(extractOfficeText(bytes, DOCX).text).toBe("First\nSecond");
  });

  it("decodes numeric (decimal + hex) and all five named entities", () => {
    const bytes = docxOf(`<w:p><w:r><w:t>&#65;&#x42;C &lt;&gt;&quot;&apos;&amp;</w:t></w:r></w:p>`);
    expect(extractOfficeText(bytes, DOCX).text).toBe(`ABC <>"'&`);
  });

  it("throws on a zip missing word/document.xml under the DOCX mime", () => {
    const bytes = zipSync({ "word/other.xml": strToU8("<x/>") });
    expect(() => extractOfficeText(bytes, DOCX)).toThrow(/^office_parse_failed/);
  });

  it("throws a typed error on non-zip bytes", () => {
    expect(() => extractOfficeText(new Uint8Array([1, 2, 3, 4]), DOCX)).toThrow(
      "office_parse_failed: not a zip",
    );
  });

  it("throws on an unrecognized mime", () => {
    expect(() => extractOfficeText(docxOf(""), "application/pdf")).toThrow(/^office_parse_failed/);
  });
});

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const sheetXml = (rows: string) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;

describe("extractOfficeText — XLSX (EXTR-C)", () => {
  it("resolves t=\"s\" cells through sharedStrings, keeps literal cells, tab-joins rows", () => {
    const bytes = zipSync({
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
    expect(extractOfficeText(bytes, XLSX).text).toBe(
      "Sheet 1\nAlpha & Co\t42\nBeta\t3.14",
    );
  });

  it("orders sheets numerically (sheet2 before sheet10) with Sheet N headers and blank line between", () => {
    const bytes = zipSync({
      "xl/worksheets/sheet10.xml": strToU8(sheetXml(`<row><c><v>ten</v></c></row>`)),
      "xl/worksheets/sheet2.xml": strToU8(sheetXml(`<row><c><v>two</v></c></row>`)),
    });
    expect(extractOfficeText(bytes, XLSX).text).toBe("Sheet 2\ntwo\n\nSheet 10\nten");
  });

  it("flattens literal-only sheets when sharedStrings.xml is absent (it is optional)", () => {
    const bytes = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row><c><v>7</v></c><c><v>8</v></c></row>`)),
    });
    expect(extractOfficeText(bytes, XLSX).text).toBe("Sheet 1\n7\t8");
  });

  it("throws on an XLSX-mime zip with no worksheets", () => {
    const bytes = zipSync({ "xl/other.xml": strToU8("<x/>") });
    expect(() => extractOfficeText(bytes, XLSX)).toThrow(/^office_parse_failed/);
  });
});

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const slideXml = (runs: string) => `<?xml version="1.0"?><p:sld xmlns:a="http://x">${runs}</p:sld>`;

describe("extractOfficeText — PPTX (EXTR-C)", () => {
  it("orders slides numerically (1, 2, 10) with Slide N headers, <a:t> runs newline-joined", () => {
    const bytes = zipSync({
      "ppt/slides/slide10.xml": strToU8(slideXml(`<a:t>Last</a:t>`)),
      "ppt/slides/slide1.xml": strToU8(slideXml(`<a:t>Title</a:t><a:t>Subtitle &amp; more</a:t>`)),
      "ppt/slides/slide2.xml": strToU8(slideXml(`<a:t xml:space="preserve">Body</a:t>`)),
    });
    expect(extractOfficeText(bytes, PPTX).text).toBe(
      "Slide 1\nTitle\nSubtitle & more\n\nSlide 2\nBody\n\nSlide 10\nLast",
    );
  });

  it("throws on a PPTX-mime zip with no ppt/slides/*.xml", () => {
    const bytes = zipSync({ "ppt/other.xml": strToU8("<x/>") });
    expect(() => extractOfficeText(bytes, PPTX)).toThrow(/^office_parse_failed/);
  });
});

describe("extractOfficeText — determinism (same bytes in, byte-identical text out)", () => {
  it("DOCX", () => {
    const bytes = docxOf(`<w:p><w:r><w:t>Stable &amp; sure</w:t></w:r></w:p>`);
    expect(extractOfficeText(bytes, DOCX).text).toBe(extractOfficeText(bytes, DOCX).text);
  });

  it("XLSX", () => {
    const bytes = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(`<row><c><v>1</v></c></row>`)),
    });
    expect(extractOfficeText(bytes, XLSX).text).toBe(extractOfficeText(bytes, XLSX).text);
  });

  it("PPTX", () => {
    const bytes = zipSync({ "ppt/slides/slide1.xml": strToU8(slideXml(`<a:t>One</a:t>`)) });
    expect(extractOfficeText(bytes, PPTX).text).toBe(extractOfficeText(bytes, PPTX).text);
  });
});
