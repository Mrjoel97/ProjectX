// The CSV import brain (Phase 19.1, ACTN-05). Imports from "./index" — the `contacts.test.ts`
// convention, which also proves the barrel export landed.
//
// Every hazardous input below is built with EXPLICIT escapes ("\uFEFF", "\r\n"). Never a
// multi-line template literal: `core.autocrlf=true` makes a literal CRLF in a source file
// unstable, so a template literal would test whatever git last checked out.
import { describe, expect, it } from "vitest";
import {
  type ColumnMapping,
  detectMapping,
  IMPORT_ATTESTATION,
  IMPORT_BATCH_ROWS,
  IMPORT_MATCH_CHUNK,
  IMPORT_ROW_MAX,
  mapRows,
  parseCsv,
} from "./index";

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

describe("detectMapping", () => {
  it("auto-maps a common CRM export's headers without the user touching anything", () => {
    expect(detectMapping(["E-Mail", "Full Name", "Organization", "Job Title", "Phone"])).toEqual({
      email: [0],
      name: [1],
      company: [2],
      title: [3],
      phone: [4],
    });
  });

  it("lands BOTH first-name and last-name columns on `name`", () => {
    expect(detectMapping(["First", "Last", "email address"])).toEqual({
      email: [2],
      name: [0, 1],
      company: [],
      phone: [],
      title: [],
    });
  });

  it("drops a column matching no alias", () => {
    expect(detectMapping(["email", "Lead Score", "Notes"])).toEqual({
      email: [0],
      name: [],
      company: [],
      phone: [],
      title: [],
    });
  });
});

describe("mapRows", () => {
  const map = (over: Partial<ColumnMapping> = {}): ColumnMapping => ({
    email: [],
    name: [],
    company: [],
    phone: [],
    title: [],
    ...over,
  });

  it("refuses a header with no recognizable email column", () => {
    const records = parseCsv("Lead Score,Notes\r\n9,hi");
    expect(() => mapRows(records, detectMapping(records[0]?.fields ?? []))).toThrow(
      "IMPORT_NO_EMAIL_COLUMN",
    );
  });

  it("refuses more data records than IMPORT_ROW_MAX", () => {
    const body = Array.from({ length: IMPORT_ROW_MAX + 1 }, (_, i) => `u${i}@x.com`).join("\r\n");
    expect(() => mapRows(parseCsv(`email\r\n${body}`), map({ email: [0] }))).toThrow(
      "IMPORT_TOO_MANY_ROWS",
    );
    const atCap = Array.from({ length: IMPORT_ROW_MAX }, (_, i) => `u${i}@x.com`).join("\r\n");
    expect(mapRows(parseCsv(`email\r\n${atCap}`), map({ email: [0] })).rows).toHaveLength(
      IMPORT_ROW_MAX,
    );
  });

  it("drops unmapped columns — they never appear on an ImportRow", () => {
    const records = parseCsv("email,Lead Score\r\nbob@x.com,97");
    const { rows } = mapRows(records, detectMapping(records[0]?.fields ?? []));
    expect(rows).toEqual([{ email: "bob@x.com" }]);
  });

  it("normalizes every returned address and joins multi-column names with one space", () => {
    const records = parseCsv("First,Last,Email Address\r\nBob, Smith ,  Bob@Example.COM ");
    const { rows } = mapRows(records, detectMapping(records[0]?.fields ?? []));
    expect(rows).toEqual([{ email: "bob@example.com", name: "Bob Smith" }]);
  });

  it("rejects a blank address by PHYSICAL file line, and the good rows still import", () => {
    // The quoted newline on file line 2 is what makes physical lines differ from record indexes.
    const csv = 'email,company\r\na@x.com,"Multi\r\nLine Co"\r\n,Ghost Ltd\r\nc@x.com,Cee';
    const { rows, rejected } = mapRows(parseCsv(csv), map({ email: [0], company: [1] }));
    expect(rejected).toEqual([{ line: 4, reason: "no email address in this row" }]);
    expect(rows.map((r) => r.email)).toEqual(["a@x.com", "c@x.com"]);
  });

  it("rejects an address the send path could not use", () => {
    const { rows, rejected } = mapRows(
      parseCsv("email\r\nnot-an-address\r\nok@x.com"),
      map({ email: [0] }),
    );
    expect(rejected).toEqual([{ line: 2, reason: "not a usable email address" }]);
    expect(rows).toEqual([{ email: "ok@x.com" }]);
  });

  it("collapses two rows sharing an address under fill-empty-only, BOTH directions", () => {
    // Row 2 must FILL the blank company and must NOT overwrite the name row 1 already set.
    const csv = "email,name,company\r\nBob@X.com ,Bob Smith,\r\nbob@x.com,Robert Smythe,Acme";
    const { rows, rejected } = mapRows(parseCsv(csv), map({ email: [0], name: [1], company: [2] }));
    expect(rejected).toEqual([]);
    expect(rows).toEqual([{ email: "bob@x.com", name: "Bob Smith", company: "Acme" }]);
  });
});
