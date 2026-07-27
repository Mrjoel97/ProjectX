// @vitest-environment node
//
// Lane-1 (03.8-02) offline coverage for the extractDoc dispatcher — EXTR-B/D/E/F.
// Every path here drives the REAL spine (gate -> markExtracting -> bytes -> SMOKE sniff /
// dispatch -> scanText fail-closed -> refs-only audit -> ingestExtractedText seam) with ZERO
// real API calls: SMOKE::extract:: sentinel bytes short-circuit the model, the skill registry
// stays deliberately unseeded (a hosted branch fails closed at getActiveSkill — which is
// exactly how the "hosted path chosen" assertions observe the branch offline), and the
// downstream ingest workflow is only STARTED (convex-test never runs the durable steps).
//
// Components registered (intake.test.ts / vault.test.ts precedent): rateLimiter
// (guardrails.preCall/recordSpend), workflow + workflow/workpool (the seam's workflow.start),
// auditCounts (the aggregate audit.log maintains on every insert).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");

const TENANT = "tenant_extract";
type T = ReturnType<typeof convexTest>;

// Fake timers: the seam's workflow.start enqueues workpool functions via the scheduler; under
// real timers they fire AFTER the suite and retry-loop against vitest's torn-down module
// runner (minutes of "Timeout calling resolveId" teardown drag on Windows). These tests assert
// the SYNCHRONOUS effects only (vault.test.ts precedent) — the durable steps never need to run.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** Seed a doc through the REAL vaultUpload path (stores bytes + inserts the row). */
async function uploadBytes(
  t: T,
  bytes: string | Uint8Array,
  mimeType: string,
  filename: string,
): Promise<Id<"vaultDocuments">> {
  const asT = t.withIdentity({ subject: TENANT });
  // .slice() re-homes a Uint8Array<ArrayBufferLike> (pdf-lib output) onto a plain ArrayBuffer.
  const part: BlobPart = typeof bytes === "string" ? bytes : bytes.slice();
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([part], { type: mimeType })));
  const { vaultDocId } = await asT.mutation(api.vault.vaultUpload, {
    storageId,
    filename,
    mimeType,
    size: 64, // metadata only — the action derives truth from the real loaded bytes
    contentHash: `h-${Math.random()}`,
  });
  return vaultDocId;
}

const runExtract = (t: T, vaultDocId: Id<"vaultDocuments">) =>
  t.action(internal.vaultExtract.extractDoc, { vaultDocId, tenantId: TENANT });

const getDoc = (t: T, id: Id<"vaultDocuments">) => t.run((ctx) => ctx.db.get(id));
const auditRows = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());

describe("extractDoc spine — SMOKE, gate, scan-then-audit, seam (EXTR-D/E/F)", () => {
  test("a SMOKE::extract:: sentinel walks the spine to processing with the seam text (EXTR-D)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, "SMOKE::extract::hello", "image/png", "sentinel.png");
    expect((await getDoc(t, docId))?.status).toBe("pending_extraction");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing"); // seam patched + ingest workflow started
    expect(doc?.text).toBe("hello");
    expect(doc?.extractionTruncated).toBeUndefined();

    const success = (await auditRows(t)).find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({
      vaultDocId: docId,
      kind: "text",
      path: "smoke",
      charCount: 5,
      truncated: false,
      piiCounts: { email: 0, ssn: 0, card: 0, phone: 0 },
    });
  }, 20000);

  test("a governed stop (kill switch) marks failed with the reason — no throw, no audit row (EXTR-E)", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("guardrailConfig", { killSwitch: true, budgetUsdPerRequest: 0.05, updatedAt: Date.now() }),
    );
    const docId = await uploadBytes(t, "SMOKE::extract::never processed", "image/png", "blocked.png");

    await runExtract(t, docId); // a governed stop is a RETURN, never a throw

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("kill_switch");
    expect(doc?.text).toBeUndefined();
    expect((await auditRows(t)).some((r) => r.eventType.startsWith("vault."))).toBe(false);
  });

  test("scanText Err fail-closed: failed + pii_scan_failed + exactly ONE refs-only audit row (EXTR-E)", async () => {
    const t = setup();
    const POISONED = "SMOKE::extract::PII_POISON::this content must never reach the audit plane";
    const docId = await uploadBytes(t, POISONED, "image/png", "poison.png");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("pii_scan_failed");
    expect(doc?.text).toBeUndefined(); // nothing written past the gate

    const rows = await auditRows(t);
    const failures = rows.filter((r) => r.eventType === "vault.extraction_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toEqual({ vaultDocId: docId, kind: "text", reason: "pii_scan_failed" });
    expect(rows.some((r) => r.eventType === "vault.extracted")).toBe(false);
    // Needle scan (vaultRedaction.test.ts pattern): the raw text is absent from EVERY audit write.
    const all = JSON.stringify(rows.map((r) => r.payload));
    expect(all).not.toContain("PII_POISON");
    expect(all).not.toContain("never reach the audit plane");
  });

  test("success audit carries counts only — raw extracted text never reaches the audit plane (EXTR-E)", async () => {
    const t = setup();
    const RAW_EMAIL = "john@example.com";
    const RAW_SSN = "123-45-6789";
    const docId = await uploadBytes(
      t,
      `SMOKE::extract::Reach John at ${RAW_EMAIL} SSN ${RAW_SSN}`,
      "image/png",
      "contact.png",
    );

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    // Planner-confirmed: RAW text into the content plane (downstream re-scans pre-model).
    expect(doc?.text).toContain(RAW_EMAIL);

    const rows = await auditRows(t);
    const success = rows.find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({ piiCounts: { email: 1, ssn: 1, card: 0, phone: 0 } });
    const all = JSON.stringify(rows.map((r) => r.payload));
    expect(all).not.toContain(RAW_EMAIL);
    expect(all).not.toContain(RAW_SSN);
  }, 20000);

  test("office dispatch reaches extractOfficeText; the Wave-0 stub's throw maps to office_parse_failed", async () => {
    const t = setup();
    const docId = await uploadBytes(
      t,
      "PK not a real docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "deck.docx",
    );

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    // Proves Lane 2's merge needs zero Lane-1 changes: the branch exists, the catch maps the throw.
    expect(doc?.failureReason).toBe("office_parse_failed");
  });

  test("text over VAULT_EXTRACT_CHAR_CAP truncates at the cap with truncated: true (EXTR-F)", async () => {
    const t = setup();
    // Word-shaped filler (a single unbroken run makes the pii email regex backtrack O(n²)).
    const over = "lorem ipsum ".repeat(Math.ceil((VAULT_EXTRACT_CHAR_CAP + 500) / 12)).slice(0, VAULT_EXTRACT_CHAR_CAP + 500);
    const docId = await uploadBytes(t, `SMOKE::extract::${over}`, "image/png", "big.png");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text?.length).toBe(VAULT_EXTRACT_CHAR_CAP);
    expect(doc?.extractionTruncated).toBe(true);

    const success = (await auditRows(t)).find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({ charCount: VAULT_EXTRACT_CHAR_CAP, truncated: true });
  }, 30000);

  test("an unexpected throw inside the body marks failed with a refs-only reason — never a throw out", async () => {
    const t = setup();
    // Real-looking (non-sentinel) but corrupt PDF bytes: the pdf engine throws, the wrapper catches.
    const docId = await uploadBytes(t, "%PDF-1.4 garbage not parseable", "application/pdf", "corrupt.pdf");

    await runExtract(t, docId); // resolves — the catch-all converted the throw

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toMatch(/^extract_error:/);
  });
});

// ── Task 2: PDF text-layer-first + hosted fallback + image path (EXTR-B) ──────
// Fixtures are built IN-TEST with pdf-lib (no binary fixtures in the repo). The skill registry
// stays unseeded, so a hosted branch fails closed at getActiveSkill with NO_ACTIVE_SKILL —
// the offline observation that the hosted path was CHOSEN (no model call ever attempted).

/** A real text-layer PDF (pdf-lib drawText). */
async function textPdf(text: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.setFont(font);
  page.drawText(text, { x: 40, y: 700, size: 12, lineHeight: 16 });
  return doc.save();
}

/** A no-text-layer "scan": N empty pages — trips the garbage heuristic. */
async function scanPdf(pages: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

describe("PDF + image engines (EXTR-B)", () => {
  test("a text-layer PDF extracts FREE via unpdf — path text_layer, no skill load, no spend", async () => {
    const t = setup();
    const bytes = await textPdf(
      "The quarterly revenue was $1.2M.\nOperating costs held flat at $340K.\nHeadcount grew to twelve people.",
    );
    const docId = await uploadBytes(t, bytes, "application/pdf", "report.pdf");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    // Success WITHOUT a seeded skill registry === the hosted path was never touched.
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toContain("quarterly revenue");
    const success = (await auditRows(t)).find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({ kind: "pdf", path: "text_layer" });
  }, 30000);

  test("a no-text-layer scan routes HOSTED PER PAGE; zero good pages is TERMINAL failed (SC#5)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, await scanPdf(3), "application/pdf", "scan.pdf");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    // The hosted branch was CHOSEN: every page fails closed at the unseeded registry (never a
    // model call offline). 15.2-06 changed WHAT the failure looks like — fanOutPages absorbs each
    // page's throw into a marker (§4: never an SDK string), so the reason is no longer
    // NO_ACTIVE_SKILL but our own okPages===0 refusal. That refusal is the point: three
    // `[unreadable]` markers stored as a `ready` document would be a false-ready of exactly the
    // family this phase exists to delete.
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toMatch(/hosted_extract_failed/);
    expect(doc?.failureReason?.length ?? 0).toBeGreaterThan(0);
    expect(doc?.status).not.toBe("pending_extraction"); // never left non-terminal
    expect(doc?.status).not.toBe("extracting");
    expect(doc?.text).toBeUndefined();
  }, 30000);

  test("pdfPages emits ONE-PAGE documents from a SINGLE loaded source", async () => {
    vi.useRealTimers(); // pure helper test — no scheduler involved
    const { pdfPages } = await import("./vaultExtract");
    const { PDFDocument } = await import("pdf-lib");
    const { VAULT_EXTRACT_PAGE_CAP } = await import("@pikar/vault");

    const pages = await pdfPages(await scanPdf(3), VAULT_EXTRACT_PAGE_CAP);

    expect(pages).toHaveLength(3);
    for (const p of pages) expect((await PDFDocument.load(p)).getPageCount()).toBe(1);
  }, 30000);

  test("VAULT_EXTRACT_PAGE_CAP still binds AFTER the fan-out — an oversize scan emits at most 50", async () => {
    vi.useRealTimers();
    const { pdfPages } = await import("./vaultExtract");
    const { VAULT_EXTRACT_PAGE_CAP } = await import("@pikar/vault");

    const pages = await pdfPages(await scanPdf(VAULT_EXTRACT_PAGE_CAP + 5), VAULT_EXTRACT_PAGE_CAP);

    expect(pages).toHaveLength(VAULT_EXTRACT_PAGE_CAP);
  }, 60000);

  test("the .slice() discipline: unpdf must not detach the buffer pdfPages then reads", async () => {
    vi.useRealTimers();
    const { pdfPages } = await import("./vaultExtract");
    const { getDocumentProxy, extractText } = await import("unpdf");

    const bytes = await scanPdf(3);
    // extractPdf's sequence VERBATIM: pdf.js TRANSFERS (detaches) the buffer it is handed, so it
    // gets a COPY — otherwise the fan-out emitter below reads a zeroed buffer (caught offline
    // once already, when pdf-lib did). Drop the .slice() in the source and this goes red.
    const pdf = await getDocumentProxy(bytes.slice());
    await extractText(pdf, { mergePages: false });

    expect(await pdfPages(bytes, 50)).toHaveLength(3);
  }, 30000);

  test("an image routes HOSTED with its real mediaType (fails closed unseeded)", async () => {
    const t = setup();
    // REAL png magic. Content-first recognition means the sniff must actually SEE a png: the
    // old string fixture encoded \x89 as UTF-8 0xC2 0x89, which makes those bytes decodable text,
    // so they now honestly resolve to the text rail. The sniff is not wrong — the fixture was.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    const docId = await uploadBytes(t, png, "image/png", "photo.png");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toMatch(/NO_ACTIVE_SKILL/);
  });

  test("slicePdfToPageCap slices an oversize scan to VAULT_EXTRACT_PAGE_CAP pages before the hosted call", async () => {
    vi.useRealTimers(); // pure helper test — no scheduler involved; dynamic import needs real timers
    const { slicePdfToPageCap } = await import("./vaultExtract");
    const { PDFDocument } = await import("pdf-lib");
    const { VAULT_EXTRACT_PAGE_CAP } = await import("@pikar/vault");

    const sliced = await slicePdfToPageCap(await scanPdf(VAULT_EXTRACT_PAGE_CAP + 5));
    expect((await PDFDocument.load(sliced)).getPageCount()).toBe(VAULT_EXTRACT_PAGE_CAP);

    // Under the cap: bytes pass through untouched.
    const small = await scanPdf(2);
    expect(await slicePdfToPageCap(small)).toBe(small);
  }, 30000);
});

// ── Phase 15.2 (15.2-03): the rail dispatch — every rail, or an honest failure ──
// Every fixture is built IN-TEST from bytes; nothing here supplies a trustworthy MIME type on
// purpose, because the point of SC#1 is that the MIME type no longer decides anything.
//
// ponytail: the ZIP fixtures use the ~35-line STORE-method writer below rather than fflate's
// zipSync. fflate is a dependency of @pikar/vault ONLY — the arrangement that keeps it out of the
// V8 Convex bundle — so it does not resolve from @pikar/backend, and adding it as a devDependency
// here to build three fixtures is a lockfile change to save thirty lines. STORE (method 0) reads
// back through fflate's unzipSync identically to a deflated entry. Upgrade path: add the
// devDependency if a fixture ever needs compression or an encrypted archive.
function zipStore(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // method 0 = stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true); // method 0 = stored
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const XLSM_MIME = "application/vnd.ms-excel.sheet.macroEnabled.12";
const CELL = "803281";

/** An .xlsm is byte-structurally an .xlsx — same zip, same marker entry, same walker. */
const workbookZip = (): Uint8Array =>
  zipStore({
    "xl/workbook.xml": `<?xml version="1.0"?><workbook/>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c><v>${CELL}</v></c></row></sheetData></worksheet>`,
  });

// The OLE2 / CFB compound-file signature, and the three builders rawText.test.ts uses. Rebuilt
// here rather than imported: a test helper reached across a package boundary is a dependency the
// package does not declare.
const OLE2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const nuls = (n: number): Uint8Array => new Uint8Array(n);
const ansi = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const utf16 = (s: string): Uint8Array =>
  Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0), 0]));
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const SENTENCE = "The board approved the budget on Tuesday.";
/** A legacy compound file whose directory stream names identify it — MIME-free by design. */
const ole2With = (stream: string): Uint8Array =>
  cat(OLE2, nuls(8), utf16(stream), nuls(4), ansi(SENTENCE), nuls(16));

/** 64 bytes nothing can read: not a signature, not %PDF, not valid printable text. */
const NOISE = Uint8Array.from({ length: 64 }, (_, i) => i % 2);

/** The `kind` field of the success audit row now carries the RAIL (a label — refs/counts only). */
const successAudit = async (t: T) =>
  (await auditRows(t)).find((r) => r.eventType === "vault.extracted")?.payload;

describe("rail dispatch — content decides, and every refusal is TERMINAL (SC#1/#2/#3/#4)", () => {
  test("the owner's .xlsm reaches the seam — the MIME that used to reach fail(unsupported_format)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, workbookZip(), XLSM_MIME, "budget.xlsm");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toContain(CELL);
    expect(await successAudit(t)).toMatchObject({ kind: "zip", path: "office" });
  }, 20000);

  test("content beats declaration: the SAME archive as application/octet-stream, named .dat (SC#1)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, workbookZip(), "application/octet-stream", "budget.dat");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toContain(CELL);
    expect(await successAudit(t)).toMatchObject({ kind: "zip" });
  }, 20000);

  test("a legacy OLE2 .doc with an EMPTY mimeType extracts on the legacy rail (SC#3)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, ole2With("WordDocument"), "", "minutes.doc");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toContain(SENTENCE);
    expect(await successAudit(t)).toMatchObject({ kind: "legacy_doc", path: "legacy" });
  }, 20000);

  test("a legacy .xls refuses HONESTLY rather than plausibly (headers-and-no-numbers)", async () => {
    const t = setup();
    // A printable-run sweep over BIFF would recover the column headers and silently lose every
    // value (numbers are binary doubles) — a plausible failure, which is worse than a failure.
    // SheetJS lands in plan 15.2-07; until then the refusal IS the correct behaviour.
    const docId = await uploadBytes(t, ole2With("Workbook"), "application/vnd.ms-excel", "q3.xls");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("unsupported_legacy_spreadsheet");
    expect(doc?.failureReason?.length).toBeGreaterThan(0);
  });

  test("RTF extracts on the raw rail with no MIME type at all", async () => {
    const t = setup();
    // A literal backslash written as a char code: raw backslashes in source have been silently
    // mangled by tooling in this repo (the 15.2-02 heredoc/Write finding), and a corrupted RTF
    // fixture would still be a valid string — i.e. it would test the wrong input, quietly.
    const BS = String.fromCharCode(92);
    const docId = await uploadBytes(t, ansi(`{${BS}rtf1${BS}ansi Hello}`), "", "note.rtf");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toBe("Hello");
    expect(await successAudit(t)).toMatchObject({ kind: "rtf", path: "raw" });
  });

  test("HTML extracts its text and NOT its script body", async () => {
    const t = setup();
    const html = `<html><body><p>Hi</p><script>bad()</script></body></html>`;
    const docId = await uploadBytes(t, html, "text/html", "page.html");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toContain("Hi");
    expect(doc?.text).not.toContain("bad");
    expect(await successAudit(t)).toMatchObject({ kind: "markup", path: "raw" });
  });

  test("a JSON document rides the text rail verbatim (the JSON/YAML/TSV/LOG coverage)", async () => {
    const t = setup();
    const json = `{"revenue": 42}`;
    const docId = await uploadBytes(t, json, "", "data.json");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toBe(json);
    expect(await successAudit(t)).toMatchObject({ kind: "text", path: "raw" });
  });

  test("bytes nothing can read are TERMINAL failed(unsupported_format), never left pending (SC#4)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, NOISE, "", "mystery.bin");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("unsupported_format");
    // THE WHOLE POINT: the row is not parked at a non-terminal status with no reason.
    expect(doc?.status).not.toBe("pending_extraction");
    expect(doc?.status).not.toBe("extracting");
  });

  test("media that reaches the action fails honestly instead of being treated as a document", async () => {
    const t = setup();
    const docId = await uploadBytes(t, NOISE, "", "clip.mp4");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason?.length ?? 0).toBeGreaterThan(0);
    expect(doc?.text).toBeUndefined();
  });

  test("an extraction that recovers ZERO characters fails — never a ready doc with 0 chars", async () => {
    const t = setup();
    const empty = zipStore({
      "word/document.xml": `<w:document><w:body><w:p/></w:body></w:document>`,
    });
    const docId = await uploadBytes(
      t,
      empty,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "blank.docx",
    );

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("empty_extraction");
    expect(doc?.text).toBeUndefined();
  }, 20000);
});

// ── Phase 15.2 (15.2-06): fanOutPages — the per-page fan-out orchestration ────
// The hosted CALL is not provable offline; the ORCHESTRATION is, and that is the whole reason
// fanOutPages is exported (the slicePdfToPageCap precedent). A stub `run` reaches zero model
// calls, so batch width, PAGE ORDER, per-page isolation and the wall-clock deadline are all
// observable for free. These tests prove SHAPE. They do NOT — and cannot — prove that the model
// transcribed rather than digested; that is the live checkpoint's job.

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("fanOutPages — bounded, ordered, isolated, deadline-bounded (SC#5 shape)", () => {
  // Real (tiny) timers: the per-page bound is a real Promise.race against setTimeout, and the
  // deadline reads a real Date.now(). The file-level fake timers would freeze both.
  beforeEach(() => vi.useRealTimers());
  const load = () => import("./vaultExtract");
  const far = () => Date.now() + 10_000;

  test("page ORDER is by index, never completion order — pages resolving in REVERSE still ascend", async () => {
    const { fanOutPages } = await load();

    const out = await fanOutPages(
      7,
      async (i) => {
        await sleep((7 - i) * 5); // page 6 finishes first, page 0 last — inside AND across batches
        return `p${i}`;
      },
      { batchSize: 3, pageTimeoutMs: 2_000, deadlineAt: far() },
    );

    // Asserted LITERALLY: `Page N` matches the house `Sheet N` / `Slide N` convention.
    expect(out.text).toBe(
      "Page 1\np0\n\nPage 2\np1\n\nPage 3\np2\n\nPage 4\np3\n\nPage 5\np4\n\nPage 6\np5\n\nPage 7\np6",
    );
    expect(out.okPages).toBe(7);
    expect(out.truncated).toBe(false);
  });

  test("concurrency is BOUNDED by batchSize and batches are SEQUENTIAL — 7 pages, 3 batches", async () => {
    const { fanOutPages } = await load();
    const calls: number[] = [];
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const out = await fanOutPages(
      7,
      async (i) => {
        calls.push(i);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        events.push(`in${i}`);
        await sleep(10);
        inFlight--;
        events.push(`out${i}`);
        return `p${i}`;
      },
      { batchSize: 3, pageTimeoutMs: 2_000, deadlineAt: far() },
    );

    expect(calls).toHaveLength(7); // exactly pageCount calls — no page run twice, none skipped
    expect(maxInFlight).toBe(3); // the batch width is the concurrency AND the OCC-contention width
    // Batch k+1 starts only after batch k has FULLY settled.
    for (const done of ["out0", "out1", "out2"]) {
      expect(events.indexOf("in3")).toBeGreaterThan(events.indexOf(done));
    }
    for (const done of ["out3", "out4", "out5"]) {
      expect(events.indexOf("in6")).toBeGreaterThan(events.indexOf(done));
    }
    expect(out.okPages).toBe(7);
  });

  test("a page that REJECTS is isolated to its own marker — the other six still land", async () => {
    const { fanOutPages } = await load();

    const out = await fanOutPages(
      7,
      async (i) => {
        if (i === 2) throw new Error("boom: parser exploded");
        return `p${i}`;
      },
      { batchSize: 3, pageTimeoutMs: 2_000, deadlineAt: far() },
    );

    expect(out.okPages).toBe(6);
    expect(out.text).toContain("Page 3\n[unreadable]");
    expect(out.text).toContain("Page 4\np3"); // the rest of its own batch's successor batch landed
    expect(out.text).toContain("Page 2\np1");
    // §4: the marker is a MARKER. No SDK/parser string, no document content, nothing PII-bearing.
    expect(out.text).not.toContain("boom");
    expect(out.text).not.toContain("parser exploded");
  });

  test("a page that NEVER settles is timed out without stalling its batch", async () => {
    const { fanOutPages } = await load();

    const out = await fanOutPages(
      3,
      (i) => (i === 1 ? new Promise<string>(() => {}) : Promise.resolve(`p${i}`)),
      { batchSize: 3, pageTimeoutMs: 30, deadlineAt: far() },
    );

    expect(out.text).toBe("Page 1\np0\n\nPage 2\n[unreadable]\n\nPage 3\np2");
    expect(out.okPages).toBe(2);
  });

  test("a deadline already in the PAST runs nothing and reports truncated", async () => {
    const { fanOutPages } = await load();
    const calls: number[] = [];

    const out = await fanOutPages(7, async (i) => { calls.push(i); return `p${i}`; }, {
      batchSize: 3,
      pageTimeoutMs: 2_000,
      deadlineAt: Date.now() - 1,
    });

    expect(calls).toHaveLength(0);
    expect(out.truncated).toBe(true);
    expect(out.okPages).toBe(0);
  });

  test("a deadline expiring mid-run stops the fan-out after the batch in flight", async () => {
    const { fanOutPages } = await load();
    const calls: number[] = [];

    const out = await fanOutPages(
      9,
      async (i) => {
        calls.push(i);
        await sleep(25);
        return `p${i}`;
      },
      { batchSize: 3, pageTimeoutMs: 2_000, deadlineAt: Date.now() + 10 },
    );

    expect(calls).toEqual([0, 1, 2]); // batch 0 was already past the check; batch 1 never started
    expect(out.truncated).toBe(true);
    expect(out.okPages).toBe(3);
    expect(out.text).toContain("Page 4\n[unreadable]");
  });

  test("ZERO successful pages is REPORTED (okPages 0), not hidden behind a document of markers", async () => {
    const { fanOutPages } = await load();

    const out = await fanOutPages(4, async () => { throw new Error("nope"); }, {
      batchSize: 2,
      pageTimeoutMs: 2_000,
      deadlineAt: far(),
    });

    // The text is non-empty (all markers) — which is exactly why the CALLER must judge okPages.
    // A document of markers passing `empty_extraction` is the false-ready this phase exists to
    // delete, so the signal has to be a count, not a truthiness check on the string.
    expect(out.okPages).toBe(0);
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.truncated).toBe(false);
  });

  test("the same stub twice gives the same output string (deterministic reassembly)", async () => {
    const { fanOutPages } = await load();
    const stub = async (i: number) => {
      await sleep((5 - (i % 5)) * 3);
      return `p${i}`;
    };
    const opts = { batchSize: 3, pageTimeoutMs: 2_000, deadlineAt: far() };

    const a = await fanOutPages(7, stub, opts);
    const b = await fanOutPages(7, stub, opts);
    expect(a.text).toBe(b.text);
  });
});

describe("dispatcher source contract (vaultRedaction.test.ts static-scan pattern)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vaultExtract.ts"), "utf8");

  test("spine ordering: preCall -> markExtracting -> bytes -> scanText -> audit -> seam", () => {
    // Call-site needles (runMutation/ctx-prefixed so header comments can't match).
    const order = [
      "runMutation(internal.guardrails.preCall",
      "runMutation(internal.vault.markExtracting",
      "ctx.storage.get(",
      "scanText(",
      "runMutation(internal.audit.log",
      "runMutation(internal.vault.ingestExtractedText",
    ];
    const indexes = order.map((needle) => {
      const i = src.indexOf(needle);
      expect(i, `vaultExtract.ts is missing "${needle}"`).toBeGreaterThanOrEqual(0);
      return i;
    });
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i], `"${order[i]}" must come after "${order[i - 1]}"`).toBeGreaterThan(indexes[i - 1]!);
    }
  });

  test("dispatch is rail-driven: resolveRail replaced the MIME allow-list outright", () => {
    // The allow-list must not survive as a SECOND opinion inside the action — a byte-sniffed rail
    // and a MIME guess disagreeing is how "it works except when it doesn't" gets built.
    expect(src).toContain("resolveRail(bytes");
    expect(src).not.toContain("extractionKindFor(");
  });

  test("the SMOKE short-circuit stays AHEAD of the rail dispatch (vaultSmoke.ts depends on it)", () => {
    const smoke = src.indexOf("sniffed.startsWith(SMOKE_EXTRACT_PREFIX)");
    const dispatch = src.indexOf('rail === "pdf"');
    expect(smoke).toBeGreaterThanOrEqual(0);
    expect(dispatch).toBeGreaterThan(smoke);
  });

  test("never imports llm.ts (the §96 circular-inference rule)", () => {
    expect(src).not.toMatch(/from\s+["']\.\/llm["']/);
  });

  test("pdf-lib is a STATIC import — a dynamic import() collapses to { default } in the Convex bundle", () => {
    // ROOT CAUSE of the scanned-PDF failure ("extract_error: Cannot read properties of undefined
    // (reading 'load')" on a live 12-page image-only PDF, 2026-07-26). pdf-lib ships
    // `main: cjs/index.js` with NO `exports` map, so it resolves to its CJS build. Convex bundles
    // node actions with esbuild `platform: node, format: "esm", splitting: true` — and across a
    // dynamic-import CHUNK boundary esbuild cannot synthesize a CJS module's named exports, so the
    // namespace carries ONLY `default`. `const { PDFDocument } = await import("pdf-lib")` therefore
    // destructures to undefined and `PDFDocument.load(...)` throws. Node/vitest read the named
    // exports out of the CJS source via cjs-module-lexer, so this is INVISIBLE offline — the
    // Pitfall-1 class of bug where only the deployed run proves it.
    // A STATIC import is resolved at bundle time and works (llm.ts does exactly this in production
    // for markdownToPdf). unpdf may stay dynamic: it is ESM-only, so its namespace has real
    // named exports.
    expect(src, "pdf-lib must NOT be dynamically imported").not.toMatch(
      /import\(\s*["']pdf-lib["']\s*\)/,
    );
    expect(src, "pdf-lib must be a STATIC top-level import").toMatch(
      /^import\s*\{[^}]*\bPDFDocument\b[^}]*\}\s*from\s*["']pdf-lib["'];?$/m,
    );
  });

  test("hosted call carries the extractVisual shape verbatim (skill system, gpt-4o-mini, timeout, retries, spend)", () => {
    for (const needle of [
      'openai("gpt-4o-mini")',
      "system: skill.body",
      "mediaType: mimeType",
      "AbortSignal.timeout(CALL_TIMEOUT_MS)",
      "maxRetries: 1",
      'priceUsage("openai/gpt-4o-mini"',
      "runMutation(internal.guardrails.recordSpend",
    ]) {
      expect(src, `vaultExtract.ts is missing "${needle}"`).toContain(needle);
    }
  });

  test("the hosted branch no longer sends the WHOLE DOCUMENT as one call (15.2-06)", () => {
    // THE DEFECT, named so nobody optimises it back: a 12-page deck handed to
    // attachment-extractor as ONE file part returned 2,161 chars of "here's a breakdown" instead
    // of the deck's text. The skill's contract is written for a SINGLE page (§5 — satisfied by
    // REUSE: no new skill row, no prompt change), so the CALL SHAPE was the defect, not the
    // prompt. This scan is the only thing standing between a green suite and that regression:
    // the behavioural tests prove batching SHAPE, and shape stays green when the model digests.
    expect(src, "the per-page fan-out must be wired in").toContain("fanOutPages(");
    expect(src, "slicePdfToPageCap's output must never reach extractHosted again").not.toMatch(
      /extractHosted\(\s*ctx\s*,\s*sliced/,
    );
    expect(src, "the hosted call must receive ONE PAGE").toMatch(/extractHosted\(\s*ctx\s*,\s*pages\[/);
  });

  test("unpdf gets a COPY — pdf.js detaches the buffer the fan-out emitter then reads", () => {
    expect(src).toContain("getDocumentProxy(bytes.slice())");
  });

  test("Promise.withResolvers polyfill sits BEFORE any unpdf usage (Pitfall 1 — deployed Node 20)", () => {
    const polyfill = src.indexOf("Promise.withResolvers");
    const unpdf = src.indexOf('import("unpdf")'); // the actual usage site, not a comment mention
    expect(polyfill, "polyfill missing").toBeGreaterThanOrEqual(0);
    expect(unpdf, "unpdf usage missing").toBeGreaterThanOrEqual(0);
    expect(polyfill).toBeLessThan(unpdf);
  });
});
