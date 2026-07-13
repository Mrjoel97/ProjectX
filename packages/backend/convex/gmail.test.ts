// buildMime self-check (V3 multipart structurally correct + V4 zero-attachment byte-identical).
// Pure-function unit test — no convex-test harness needed; buildMime is a plain exported helper.
import { describe, expect, test } from "vitest";
import { buildMime } from "./gmail";

const TO = "dest@example.com";
const SUBJECT = "Quarterly update";
const BODY = "Here is the Q3 update.\r\nRegards.";

// The EXACT legacy single-part string (frozen here so a byte drift fails loudly — V4).
const LEGACY = [
  `To: ${TO}`,
  `Subject: ${SUBJECT}`,
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="UTF-8"',
  "",
  BODY,
].join("\r\n");

describe("buildMime — zero-attachment byte-identity (V4)", () => {
  test("no attachments arg → byte-identical to the legacy plain-text message", () => {
    expect(buildMime(TO, SUBJECT, BODY)).toBe(LEGACY);
  });

  test("empty attachments array → byte-identical to the legacy plain-text message", () => {
    expect(buildMime(TO, SUBJECT, BODY, [])).toBe(LEGACY);
  });
});

describe("buildMime — multipart/mixed with attachments (V3)", () => {
  const PDF_B64 = Buffer.from("%PDF-1.4 fake pdf bytes").toString("base64");
  const mime = buildMime(TO, SUBJECT, BODY, [
    { filename: "report.pdf", mimeType: "application/pdf", base64: PDF_B64 },
  ]);

  test("CRLF line endings throughout (no bare LF)", () => {
    expect(mime.includes("\n")).toBe(true);
    expect(/[^\r]\n/.test(mime)).toBe(false); // every \n is preceded by \r
  });

  test("exactly one top-level MIME-Version:1.0", () => {
    expect(mime.match(/MIME-Version: 1\.0/g)?.length).toBe(1);
  });

  test("top-level Content-Type is multipart/mixed with a =_pikar_ boundary", () => {
    const m = mime.match(/Content-Type: multipart\/mixed; boundary="(=_pikar_[0-9a-f]+)"/);
    expect(m).not.toBeNull();
  });

  test("a text/plain body part carried as base64 (Content-Transfer-Encoding: base64)", () => {
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    // body is base64-encoded inside the part, not left as cleartext
    expect(mime).toContain(Buffer.from(BODY, "utf-8").toString("base64"));
    expect(mime).not.toContain(BODY); // the raw body does NOT appear verbatim
  });

  test("one application/pdf attachment part with Content-Disposition: attachment; filename", () => {
    expect(mime).toContain('Content-Type: application/pdf; name="report.pdf"');
    expect(mime).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(mime).toContain(PDF_B64); // standard base64, carried verbatim
  });

  test("N+1 part delimiters and a MANDATORY closing --boundary--", () => {
    const boundary = mime.match(/boundary="(=_pikar_[0-9a-f]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    // opening delimiters: one before the text part + one per attachment = 2
    const opens = mime.match(new RegExp(`\r\n--${boundary}\r\n`, "g"))?.length;
    expect(opens).toBe(2);
    // closing delimiter is mandatory
    expect(mime.endsWith(`\r\n--${boundary}--`)).toBe(true);
  });

  test("two attachments → two application/pdf parts", () => {
    const two = buildMime(TO, SUBJECT, BODY, [
      { filename: "a.pdf", mimeType: "application/pdf", base64: "QQ==" },
      { filename: "b.pdf", mimeType: "application/pdf", base64: "Qg==" },
    ]);
    expect(two.match(/Content-Type: application\/pdf/g)?.length).toBe(2);
  });
});
