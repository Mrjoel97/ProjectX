// Content-first recognition (Phase 15.2, SC#1). Every fixture is built in-test from a byte
// array (or fflate for a REAL zip) — no binary fixtures in the repo, the Lane-2 convention.
import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { ole2Kind, resolveRail, sniffContainer } from "./sniff";

const enc = new TextEncoder();

/** Concatenate byte arrays / UTF-8 strings into one buffer. */
const cat = (...parts: Array<Uint8Array | number[] | string>): Uint8Array => {
  const chunks = parts.map((p) =>
    typeof p === "string" ? enc.encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

const fill = (n: number, byte: number) => new Uint8Array(n).fill(byte);
/** The UTF-16LE encoding of an ASCII name — how OLE2 directory entry names are stored. */
const utf16le = (s: string) => new Uint8Array([...s].flatMap((c) => [c.charCodeAt(0), 0]));

const OLE2_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PROSE = "The quarterly budget is attached.\nRevenue is up 12% year over year.\n";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// A real OOXML package: zip container, [Content_Types].xml + one sheet part.
const xlsxBytes = () =>
  zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData/></worksheet>`),
  });

describe("sniffContainer — magic bytes decide, not the file name", () => {
  test("%PDF at offset 0 → pdf", () => {
    expect(sniffContainer(cat("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj"))).toBe("pdf");
  });

  test("900 bytes of junk BEFORE %PDF → still pdf (legal, and it happens in the wild)", () => {
    expect(sniffContainer(cat(fill(900, 0x00), "%PDF-1.4"))).toBe("pdf");
  });

  test("%PDF past the 1024-byte scan window → NOT pdf (a text file may merely mention it)", () => {
    const late = cat("a".repeat(2000), "%PDF-1.4");
    expect(sniffContainer(late)).not.toBe("pdf");
    expect(sniffContainer(late)).toBe("text");
  });

  test("all three ZIP local-header variants → zip", () => {
    expect(sniffContainer(cat([0x50, 0x4b, 0x03, 0x04], fill(64, 0x00)))).toBe("zip");
    expect(sniffContainer(cat([0x50, 0x4b, 0x05, 0x06], fill(64, 0x00)))).toBe("zip"); // empty
    expect(sniffContainer(cat([0x50, 0x4b, 0x07, 0x08], fill(64, 0x00)))).toBe("zip"); // spanned
    expect(sniffContainer(xlsxBytes())).toBe("zip"); // a REAL .xlsx
  });

  test("OLE2 compound-file header → ole2", () => {
    expect(sniffContainer(cat(OLE2_HEADER, fill(512, 0x00)))).toBe("ole2");
  });

  test("{\\rtf1 → rtf", () => {
    expect(sniffContainer(cat("{\\rtf1\\ansi\\deff0 Hello}"))).toBe("rtf");
  });

  test("image signatures → png / jpeg / gif", () => {
    expect(sniffContainer(cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffContainer(cat([0xff, 0xd8, 0xff, 0xe0], fill(32, 0x00)))).toBe("jpeg");
    expect(sniffContainer(cat([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("gif");
  });

  test("plain ASCII prose → text", () => {
    expect(sniffContainer(cat(PROSE))).toBe("text");
  });

  test("UTF-8 BOM + prose → text (the BOM is tolerated, not read as binary)", () => {
    expect(sniffContainer(cat([0xef, 0xbb, 0xbf], PROSE))).toBe("text");
  });

  test("valid multi-byte UTF-8 → text", () => {
    expect(sniffContainer(cat("héllo — ✓ naïve café\n"))).toBe("text");
  });

  test("a run of 0x00/0x01 bytes → binary", () => {
    expect(sniffContainer(cat(fill(256, 0x00), fill(256, 0x01)))).toBe("binary");
  });

  test("90% printable / 10% control → binary (the bar is ≥95% over the first 4 KiB)", () => {
    expect(sniffContainer(cat("a".repeat(3600), fill(400, 0x01)))).toBe("binary");
  });

  test("empty input → binary, never a throw (an empty file is not text)", () => {
    expect(sniffContainer(new Uint8Array())).toBe("binary");
  });

  test("a multi-byte char straddling the 4 KiB window is not misread as binary", () => {
    // "é" is 2 bytes; land its first byte on the window edge.
    expect(sniffContainer(cat("a".repeat(4095), "é", "b".repeat(64)))).toBe("text");
  });
});

describe("ole2Kind — doc / ppt / xls told apart from the directory stream names, with no MIME", () => {
  const ole2With = (name: string) => cat(OLE2_HEADER, fill(500, 0x00), utf16le(name), fill(64, 0x00));

  test("WordDocument → doc", () => {
    expect(ole2Kind(ole2With("WordDocument"))).toBe("doc");
  });

  test("PowerPoint Document → ppt", () => {
    expect(ole2Kind(ole2With("PowerPoint Document"))).toBe("ppt");
  });

  test("Workbook → xls, and BIFF5's bare Book → xls", () => {
    expect(ole2Kind(ole2With("Workbook"))).toBe("xls");
    expect(ole2Kind(ole2With("Book"))).toBe("xls");
  });

  test("an OLE2 file with none of the three stream names → unknown", () => {
    expect(ole2Kind(cat(OLE2_HEADER, fill(512, 0x00)))).toBe("unknown");
  });

  test("non-OLE2 bytes → unknown, never a throw", () => {
    expect(ole2Kind(cat(PROSE))).toBe("unknown");
    expect(ole2Kind(new Uint8Array())).toBe("unknown");
  });
});

describe("resolveRail — content wins, MIME/extension is only the fallback", () => {
  test("SC#1 HEADLINE: a real .xlsx with an EMPTY mime, renamed budget.dat → zip", () => {
    expect(resolveRail(xlsxBytes(), "", "budget.dat")).toBe("zip");
  });

  test("a real PDF declared application/octet-stream → pdf", () => {
    expect(resolveRail(cat("%PDF-1.7\n1 0 obj"), "application/octet-stream", "thing.bin")).toBe(
      "pdf",
    );
  });

  test("an OLE2 .doc with no mime → legacy_doc; an OLE2 .xls with no mime → legacy_xls", () => {
    const doc = cat(OLE2_HEADER, fill(500, 0x00), utf16le("WordDocument"));
    const xls = cat(OLE2_HEADER, fill(500, 0x00), utf16le("Workbook"));
    expect(resolveRail(doc, "")).toBe("legacy_doc");
    expect(resolveRail(xls, "")).toBe("legacy_xls");
  });

  test("PNG bytes → image whatever the mime says", () => {
    const png = cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(resolveRail(png, "")).toBe("image");
    expect(resolveRail(png, "application/octet-stream", "logo.bin")).toBe("image");
  });

  test("the MIME fallback still covers image formats the magic table does not enumerate", () => {
    // The sniff is an OVERRIDE, not a replacement: unrecognised bytes + image/webp is still image.
    expect(resolveRail(cat(fill(64, 0x02)), "image/webp", "shot.webp")).toBe("image");
  });

  test("prose refines by mime/extension: markup vs text", () => {
    expect(resolveRail(cat(PROSE), "text/html")).toBe("markup");
    expect(resolveRail(cat(PROSE), "application/xml")).toBe("markup");
    expect(resolveRail(cat(PROSE), "", "page.html")).toBe("markup");
    expect(resolveRail(cat(PROSE), "text/plain")).toBe("text");
    expect(resolveRail(cat(PROSE), "", "notes.md")).toBe("text");
  });

  test("prose with NO mime and NO filename → text (JSON/YAML/TSV/LOG all land here)", () => {
    expect(resolveRail(cat(PROSE), "")).toBe("text");
    expect(resolveRail(cat(`{"revenue": 1200, "stage": "seed"}`), "")).toBe("text");
    expect(resolveRail(cat("a\tb\tc\n1\t2\t3\n"), "")).toBe("text");
  });

  test("unrecognised binary with no mime → unsupported (an honest failure, not a guess)", () => {
    expect(resolveRail(cat(fill(64, 0x02), fill(64, 0x9f)), "")).toBe("unsupported");
  });

  test("video/mp4 → unsupported, DELIBERATELY — media is routed by MIME at the scheduling gate", () => {
    // Media rides vaultTranscribe and is routed BEFORE any action runs. Anything reaching
    // resolveRail as video has already failed to be recognised as media, so failing honestly
    // here is correct — it must NOT silently claim to be a document rail.
    const rail = resolveRail(cat(fill(64, 0x02)), "video/mp4", "clip.mp4");
    expect(rail).toBe("unsupported");
    expect(rail).not.toBe("text");
  });

  test("deterministic: the same bytes twice give the same rail", () => {
    const bytes = xlsxBytes();
    expect(resolveRail(bytes, "", "budget.dat")).toBe(resolveRail(bytes, "", "budget.dat"));
    expect(resolveRail(bytes, XLSX_MIME, "budget.xlsx")).toBe("zip");
  });
});
