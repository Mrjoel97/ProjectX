import { describe, expect, it } from "vitest";
import { markupText, oleText, rtfText } from "./rawText";

/** CP1252/latin1 bytes — every fixture here is synthesized, no binary file in the repo. */
const ansi = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf16 = (s: string) =>
  Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]));
const nuls = (n: number) => new Uint8Array(n);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
/** The OLE2 / CFB compound-file signature (RESEARCH §4). */
const OLE2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe("markupText — HTML/XML to text", () => {
  it("emits block elements on separate lines", () => {
    expect(markupText(`<p>Hi</p><p>There</p>`)).toBe("Hi\nThere");
  });

  it("drops the SCRIPT BODY, not just its tags", () => {
    const out = markupText(`<script>alert(1)</script><p>Safe</p>`);
    expect(out).toContain("Safe");
    expect(out).not.toContain("alert");
  });

  it("drops the STYLE BODY", () => {
    const out = markupText(`<style>.a{color:red}</style><p>Safe</p>`);
    expect(out).toContain("Safe");
    expect(out).not.toContain("color:red");
  });

  it("drops comment bodies", () => {
    const out = markupText(`<!-- secret --><p>Safe</p>`);
    expect(out).toContain("Safe");
    expect(out).not.toContain("secret");
  });

  it("decodes named, decimal and hex entities", () => {
    expect(markupText(`<p>&amp; &#65; &#x41;</p>`)).toBe("& A A");
  });

  it("never emits attribute values or tag fragments as text", () => {
    const out = markupText(`<p><img alt="x" src="y"> shown</p>`);
    expect(out).toBe("shown");
    expect(out).not.toContain("y");
    expect(out).not.toContain("<");
  });

  it("collapses whitespace runs and trims", () => {
    expect(markupText(`  <span>  a   b  </span>  `)).toBe("a b");
  });
});

describe("rtfText — control words, destination groups and escapes", () => {
  it("returns the body of a minimal RTF document", () => {
    expect(rtfText(ansi("{\\rtf1\\ansi\\deff0 Hello world}"))).toBe("Hello world");
  });

  it("treats \\par as a BREAK, not as deleted text", () => {
    expect(rtfText(ansi("{\\rtf1 A\\par B}"))).toBe("A\nB");
  });

  it("DROPS an ignorable {\\*\\...} destination group and everything inside it", () => {
    const out = rtfText(ansi("{\\rtf1 {\\*\\generator Riched20}Real text}"));
    expect(out).toBe("Real text");
    expect(out).not.toContain("Riched20");
  });

  it("unescapes hex escapes through CP1252", () => {
    expect(rtfText(ansi("{\\rtf1 caf\\'e9}"))).toBe("café");
  });

  it("keeps escaped literals as {, } and a backslash", () => {
    const out = rtfText(ansi("{\\rtf1 \\{a\\} \\\\ b}"));
    expect(out).toContain("{");
    expect(out).toContain("}");
    expect(out).toContain("\\");
  });

  it("reads text out of nested (non-ignorable) groups", () => {
    const out = rtfText(ansi("{\\rtf1 {\\b bold} plain}"));
    expect(out).toContain("bold");
    expect(out).toContain("plain");
  });

  it("throws on bytes that are not RTF", () => {
    expect(() => rtfText(ansi("Just a plain sentence."))).toThrow("raw_parse_failed: not rtf");
  });
});

const SENTENCE = "The quarterly report is attached.";
// The two SummaryInformation streams really do carry a leading 0x05 in a compound file.
const STREAM_NAMES = [
  "Root Entry",
  "WordDocument",
  "1Table",
  "0Table",
  "Data",
  "\u0005SummaryInformation",
  "\u0005DocumentSummaryInformation",
  "ObjectPool",
  "CompObj",
  "MsoDataStore",
];

describe("oleText — legacy DOC/PPT printable-run sweep (SC#3, no dependency)", () => {
  it("recovers a CP1252 body run from a synthesized OLE2 buffer", () => {
    const bytes = cat(OLE2, nuls(8), utf16("WordDocument"), nuls(4), ansi(SENTENCE), nuls(16));
    expect(oleText(bytes, "doc")).toContain(SENTENCE);
  });

  it("recovers CP1252 AND UTF-16LE body runs from the SAME buffer", () => {
    const bytes = cat(
      OLE2,
      nuls(8),
      utf16("WordDocument"),
      nuls(4),
      ansi(SENTENCE),
      nuls(8),
      utf16("Board minutes 2026"),
      nuls(16),
    );
    const out = oleText(bytes, "doc");
    expect(out).toContain(SENTENCE);
    expect(out).toContain("Board minutes 2026");
  });

  it("emits NONE of the OLE2 stream names while keeping the real sentence", () => {
    const bytes = cat(
      OLE2,
      nuls(8),
      ...STREAM_NAMES.flatMap((n) => [utf16(n), nuls(4)]),
      ansi(SENTENCE),
      nuls(16),
    );
    const out = oleText(bytes, "doc");
    expect(out).toContain(SENTENCE);
    for (const name of STREAM_NAMES) expect(out).not.toContain(name.replace("\u0005", ""));
  });

  it("drops a 3-character printable island and keeps a 4-character one", () => {
    const bytes = cat(OLE2, nuls(4), ansi("abc"), nuls(4), ansi("wxyz"), nuls(4));
    const out = oleText(bytes, "doc");
    expect(out).toContain("wxyz");
    expect(out).not.toContain("abc");
  });

  it("PPT: recovers both encodings and emits no PowerPoint stream names", () => {
    const bytes = cat(
      OLE2,
      nuls(8),
      utf16("PowerPoint Document"),
      nuls(4),
      utf16("Current User"),
      nuls(4),
      utf16("Pictures"),
      nuls(4),
      ansi("Slide one heading"),
      nuls(8),
      utf16("Slide two heading"),
      nuls(16),
    );
    const out = oleText(bytes, "ppt");
    expect(out).toContain("Slide one heading");
    expect(out).toContain("Slide two heading");
    expect(out).not.toContain("PowerPoint Document");
    expect(out).not.toContain("Current User");
    expect(out).not.toContain("Pictures");
  });

  it("THROWS rather than returning '' — an empty 'success' stores a ready doc with 0 chars", () => {
    expect(() => oleText(cat(OLE2, nuls(64)), "doc")).toThrow(
      "raw_parse_failed: no text recovered",
    );
  });

  it("is deterministic across two calls on the same bytes", () => {
    const bytes = cat(OLE2, nuls(8), ansi(SENTENCE), nuls(4), utf16("Board minutes 2026"));
    expect(oleText(bytes, "doc")).toBe(oleText(bytes, "doc"));
  });
});
