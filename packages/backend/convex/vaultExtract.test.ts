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
import { VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

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
      kind: "image",
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
    expect(failures[0]?.payload).toEqual({ vaultDocId: docId, kind: "image", reason: "pii_scan_failed" });
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

  test("a no-text-layer scan trips the garbage heuristic and routes HOSTED (fails closed unseeded)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, await scanPdf(2), "application/pdf", "scan.pdf");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    // The hosted branch was chosen: it fail-closed at the registry (never a model call offline).
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toMatch(/NO_ACTIVE_SKILL/);
  }, 30000);

  test("an image routes HOSTED with its real mediaType (fails closed unseeded)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, "\x89PNG not a sentinel", "image/png", "photo.png");

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

  test("Promise.withResolvers polyfill sits BEFORE any unpdf usage (Pitfall 1 — deployed Node 20)", () => {
    const polyfill = src.indexOf("Promise.withResolvers");
    const unpdf = src.indexOf('import("unpdf")'); // the actual usage site, not a comment mention
    expect(polyfill, "polyfill missing").toBeGreaterThanOrEqual(0);
    expect(unpdf, "unpdf usage missing").toBeGreaterThanOrEqual(0);
    expect(polyfill).toBeLessThan(unpdf);
  });
});
