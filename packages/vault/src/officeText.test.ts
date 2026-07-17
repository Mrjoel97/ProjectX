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
