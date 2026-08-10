// The CSV import brain (Phase 19.1, ACTN-05). Imports from "./index" — the `contacts.test.ts`
// convention, which also proves the barrel export landed.
//
// Every hazardous input below is built with EXPLICIT escapes ("\uFEFF", "\r\n"). Never a
// multi-line template literal: `core.autocrlf=true` makes a literal CRLF in a source file
// unstable, so a template literal would test whatever git last checked out.
import { describe, expect, it } from "vitest";
import { IMPORT_ATTESTATION, IMPORT_BATCH_ROWS, IMPORT_MATCH_CHUNK, IMPORT_ROW_MAX, parseCsv } from "./index";

describe("parseCsv", () => {
  it("splits CRLF records into fields with 1-based physical line numbers", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      { fields: ["a", "b"], line: 1 },
      { fields: ["c", "d"], line: 2 },
    ]);
  });

  it("parses LF-only and CRLF files identically", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual(parseCsv("a,b\r\nc,d\r\n"));
  });

  it("strips a leading BOM from the first field of the first record", () => {
    const [header] = parseCsv("\uFEFFemail,name\r\nb@x.com,Bob");
    expect(header?.fields[0]).toBe("email");
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('x,"Acme, Inc.",y')[0]?.fields).toEqual(["x", "Acme, Inc.", "y"]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseCsv('"O""Neil"')[0]?.fields).toEqual(['O"Neil']);
  });

  it("keeps a newline inside a quoted field AND charges the record its physical lines", () => {
    // The whole point of physical lines: record 2 spans file lines 2-3, so record 3 is line 4.
    const rows = parseCsv('a,b\r\n"Multi\r\nLine Co",d\r\ne,f');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
    expect(rows[1]?.fields).toEqual(["Multi\nLine Co", "d"]);
  });

  it("drops a trailing newline and a genuinely blank line rather than inventing a record", () => {
    expect(parseCsv("a,b\r\n\r\nc,d\r\n")).toEqual([
      { fields: ["a", "b"], line: 1 },
      { fields: ["c", "d"], line: 3 },
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("import constants", () => {
  it("carries the attestation byte-for-byte as the design spec wrote it", () => {
    expect(IMPORT_ATTESTATION).toBe(
      "I have a lawful basis to contact these people — they are business contacts of mine, and I am not importing a purchased or scraped list.",
    );
  });

  it("single-sources the three sizes so client and server cannot drift", () => {
    expect([IMPORT_ROW_MAX, IMPORT_BATCH_ROWS, IMPORT_MATCH_CHUNK]).toEqual([1000, 100, 500]);
  });
});
