"use node";

// Lane-1 (03.8-02) extraction dispatcher — PDF text-layer-first + hosted OCR + office delegation.
// The spine (RESEARCH Pattern 1, intake.ts ordering): preCall gate -> markExtracting -> load
// bytes via ctx.storage.get (NEVER via args — 5 MiB node-action arg cap, vault files go to
// 8 MiB) -> SMOKE::extract:: sniff -> dispatch by resolveRail (magic bytes, 15.2-03) -> scanText FAIL-CLOSED on
// the extracted output BEFORE any audit write (§4) -> refs/counts-only audit -> char-cap
// truncation -> internal.vault.ingestExtractedText seam with the RAW post-gate text
// (planner-confirmed: the content plane holds the user's own data; downstream re-scans).
// A governed stop is a RETURN + markFailed(reason), never a throw; the whole body sits in a
// try/catch so an unexpected throw also lands as markFailed (refs-only reason).
// NEVER imports llm.ts or vaultTranscribe.ts (§96 circular-inference rule — "use node"
// modules stay siblings, not imports).
import { openai } from "@ai-sdk/openai";
import { ATTACHMENT_EXTRACTOR_SKILL } from "@pikar/contracts/skill";
import { priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import {
  MIN_CHARS_PER_PAGE,
  markupText,
  oleText,
  resolveRail,
  rtfText,
  sniffContainer,
  VAULT_EXTRACT_CHAR_CAP,
  VAULT_EXTRACT_PAGE_CAP,
} from "@pikar/vault";
// Subpath import (NOT the barrel) — keeps fflate structurally out of the V8 bundle.
import { extractOfficeText } from "@pikar/vault/officeText";
import { generateText } from "ai";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
// STATIC import — a dynamic import of this package breaks in the Convex bundle (Pitfall 9 below,
// and llm.ts's working precedent). Do not convert this to `await import(...)`.
import { PDFDocument } from "pdf-lib";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

// Pitfall 1: unpdf bundles pdf.js 5.x, which needs Promise.withResolvers (Node >= 22); Convex
// node actions default to Node 20. Local Node 24 masks the bug — ONLY the live smoke proves it
// deployed. Polyfill BEFORE any unpdf usage.
type WithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};
// tsconfig lib predates ES2024, so the property is reached via a widened constructor type.
const PromiseCtor = Promise as PromiseConstructor & { withResolvers?: WithResolvers };
if (typeof PromiseCtor.withResolvers !== "function") {
  PromiseCtor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Per-call wall-clock ceiling for the HOSTED extraction call. Deliberately NOT intake.ts's 45s:
// that number is tuned for small email attachments, but a vault upload runs to VAULT_FILE_CAP_BYTES
// (100 MiB). Measured live on a 14.4 MB / 12-page scanned PDF (~19 MB base64 on the wire, plus OCR
// of 12 full-page images): 45s was not survivable — the doc failed with
// "extract_error: The operation was aborted due to timeout". 480s is the SAME ceiling
// vaultTranscribe.ts already had to adopt for a 21 MB video, and stays under Convex's 10-minute
// node-action limit.
const CALL_TIMEOUT_MS = 480_000;

// ── Per-page fan-out bounds (15.2-06) ────────────────────────────────────────
// Pages sent concurrently. 6 is a BOUNDED FAN-OUT, not a throughput knob: each page is its own
// hosted call AND its own recordSpend write, and recordSpend is a rateLimiter.limit on ONE
// KEYLESS `dailySpendCents` window (guardrails.ts:166-173) — so the batch width is also the
// OCC-contention width against that single document. 6, not 50.
const PAGE_BATCH_SIZE = 6;
// Per-page wall-clock bound. CALL_TIMEOUT_MS (480 s) is PER CALL and was tuned for ONE
// whole-document call; under fan-out every page would inherit all 480 s, letting a single stuck
// page eat the entire 10-minute action ceiling. ~10 s/page is the measured norm — 60 s is 6x
// headroom and the binding constraint stops being the action limit.
const PAGE_TIMEOUT_MS = 60_000;
// Total budget for the whole fan-out, under Convex's 10-minute node-action limit with room left
// for the surrounding scan/audit/seam work.
const FANOUT_BUDGET_MS = 420_000;

// SMOKE:: offline seam — the intake.ts grammar verbatim: SMOKE::extract::<text> short-circuits
// to <text> with NO model call and NO spend. PII_POISON:: routes the extracted output into
// scanText's OWN non-string Err branch (never a fabricated Err), intake.ts precedent.
const SMOKE_EXTRACT_PREFIX = "SMOKE::extract::";
const PII_POISON_SENTINEL = "PII_POISON::";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

type ExtractPath = "smoke" | "text_layer" | "hosted" | "office" | "legacy" | "raw";
type Extracted = { text: string; path: ExtractPath };

/**
 * Hosted OCR/visual extraction — the intake.ts extractVisual shape VERBATIM: skill body from
 * the registry as system (§5 — no hardcoded prompt, fails closed unseeded), gpt-4o-mini file
 * part with the REAL mediaType, then priceUsage -> recordSpend.
 */
async function extractHosted(
  ctx: GenericActionCtx<DataModel>,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
    name: ATTACHMENT_EXTRACTOR_SKILL,
  });
  const { text, usage } = await generateText({
    model: openai("gpt-4o-mini"),
    system: skill.body,
    messages: [{ role: "user", content: [{ type: "file", data: bytes, mediaType: mimeType }] }],
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    maxRetries: 1,
  });
  const priced = priceUsage("openai/gpt-4o-mini", usage);
  if (priced.ok) {
    await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
  }
  return text;
}

/**
 * Slice a PDF to its first VAULT_EXTRACT_PAGE_CAP pages with pdf-lib copyPages (Pitfall 8:
 * pdf-lib CANNOT extract text — fixtures + slicing only). Returns the original bytes untouched
 * when already under the cap. Exported for the offline page-cap test.
 *
 * Pitfall 9: pdf-lib is reached by the STATIC top-level import, NEVER a dynamic one.
 * pdf-lib ships `main: cjs/index.js` with NO `exports` map, and Convex bundles node actions with
 * esbuild `platform: node, format: "esm", splitting: true` — across a dynamic-import chunk
 * boundary esbuild cannot synthesize a CJS module's named exports, so the namespace carries ONLY
 * `default` and `{ PDFDocument }` destructures to undefined ("Cannot read properties of undefined
 * (reading 'load')" — the live scanned-PDF failure). Node/vitest recover the names via
 * cjs-module-lexer, so a dynamic import looks fine offline and dies only when deployed. unpdf may
 * stay dynamic: it is ESM-only. Locked by a static scan in vaultExtract.test.ts.
 */
export async function slicePdfToPageCap(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes);
  if (src.getPageCount() <= VAULT_EXTRACT_PAGE_CAP) return bytes;
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: VAULT_EXTRACT_PAGE_CAP }, (_, i) => i));
  for (const p of pages) out.addPage(p);
  return out.save();
}

/**
 * Run `run(i)` for pages 0..pageCount-1 in bounded-concurrency batches, SEQUENTIAL across
 * batches, and reassemble the results in PAGE ORDER.
 *
 * Exported for the offline test (the slicePdfToPageCap precedent): the orchestration — batch
 * width, ordering, per-page isolation, the deadline — is the non-trivial part and is fully
 * provable with a stub and zero model calls. The hosted call itself is NOT provable offline,
 * which is why the plan's live checkpoint exists.
 *
 * A page that fails or times out contributes a MARKER, not a throw: 49 good pages beat losing the
 * document to one bad scan. `okPages` is what the caller judges success on — a document made
 * entirely of markers is a failure wearing a success costume, which is the shape this whole phase
 * exists to delete.
 */
export async function fanOutPages(
  pageCount: number,
  run: (index: number) => Promise<string>,
  opts?: { batchSize?: number; pageTimeoutMs?: number; deadlineAt?: number },
): Promise<{ text: string; okPages: number; truncated: boolean }> {
  const batchSize = opts?.batchSize ?? PAGE_BATCH_SIZE;
  const pageTimeoutMs = opts?.pageTimeoutMs ?? PAGE_TIMEOUT_MS;
  const deadlineAt = opts?.deadlineAt ?? Date.now() + FANOUT_BUDGET_MS;

  // Pre-sized and indexed BY PAGE — ordering is structural, not a sort anyone has to remember.
  const results: (string | null)[] = new Array(pageCount).fill(null);
  let okPages = 0;
  let truncated = false;

  for (let start = 0; start < pageCount; start += batchSize) {
    if (Date.now() > deadlineAt) {
      truncated = true;
      break;
    }
    const indices = Array.from(
      { length: Math.min(batchSize, pageCount - start) },
      (_, k) => start + k,
    );
    await Promise.all(
      indices.map(async (i) => {
        // ponytail: Promise.race, not a real per-page AbortSignal. extractHosted's contract is
        // reused UNCHANGED (a locked decision) and it owns its own 480 s abortSignal, so a
        // raced-out page's request lingers in the background — it just stops BLOCKING the batch,
        // and FANOUT_BUDGET_MS bounds the whole fan-out regardless. Upgrade path if lingering
        // requests ever matter: thread an optional timeoutMs through extractHosted (one optional
        // parameter; every existing call site unchanged).
        let timer: ReturnType<typeof setTimeout> | undefined;
        const text = await Promise.race([
          run(i).catch(() => null),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), pageTimeoutMs);
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        if (typeof text === "string") {
          results[i] = text;
          okPages++;
        }
      }),
    );
  }

  // `Page N` matches the existing `Sheet N` / `Slide N` convention in officeText.ts — the house
  // style, not a third one. `[unreadable]` is a MARKER, never an error message: §4 — no SDK or
  // parser string, no document content, nothing that could carry PII.
  const text = results.map((r, i) => `Page ${i + 1}\n${r ?? "[unreadable]"}`).join("\n\n");
  return { text, okPages, truncated };
}

/**
 * PDF: text-layer first (unpdf — free, costUsd 0, no model call), hosted OCR fallback when the
 * garbage heuristic trips (scans yield ~0 chars/page; real text layers yield hundreds).
 */
async function extractPdf(ctx: GenericActionCtx<DataModel>, bytes: Uint8Array): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js TRANSFERS (detaches) the buffer it is handed — pass a copy so the hosted-fallback
  // slice below still sees the real bytes (caught offline: pdf-lib read a zeroed buffer).
  const pdf = await getDocumentProxy(bytes.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const joined = text.join("\n\n");
  const hasTextLayer =
    joined.replace(/\s/g, "").length / Math.max(totalPages, 1) >= MIN_CHARS_PER_PAGE;
  if (hasTextLayer) return { text: joined, path: "text_layer" }; // free — no model, no spend
  // Hosted fallback for scans: slice oversize PDFs to the page cap, then send the PDF bytes as
  // a file part (in-repo precedent: intake already sends application/pdf to gpt-4o-mini).
  const sliced = await slicePdfToPageCap(bytes);
  return { text: await extractHosted(ctx, sliced, "application/pdf"), path: "hosted" };
}

export const extractDoc = internalAction({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId, tenantId }): Promise<null> => {
    const fail = (reason: string): Promise<null> =>
      ctx.runMutation(internal.vault.markFailed, { vaultDocId, reason });
    try {
      // 1. Governed gate BEFORE any work — a stop is a RETURN, never a throw (vaultIngest.ts).
      const gate: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
        await ctx.runMutation(internal.guardrails.preCall, {});
      if (!gate.ok) {
        await fail(gate.reason);
        return null;
      }

      // 2. Flip the visible pill — work actually starts now (honest pill).
      await ctx.runMutation(internal.vault.markExtracting, { vaultDocId });

      // 3. Metadata (fail-closed tenant guard) + bytes from storage.
      const meta: { storageId: Id<"_storage"> | undefined; mimeType: string; title: string; status: string } =
        await ctx.runQuery(internal.vault.getDocForExtraction, { vaultDocId, tenantId });
      if (!meta.storageId) {
        await fail("no_stored_bytes");
        return null;
      }
      const blob = await ctx.storage.get(meta.storageId);
      if (!blob) {
        await fail("missing_blob");
        return null;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // THE dispatch decision, taken from the BYTES — this action is the only runtime that can see
      // them (ctx.storage.get is action-only), which is why scheduling upstream is permissive and
      // why the refusals below are where format support is actually decided. A wrong, renamed or
      // absent MIME type no longer decides anything on its own; `meta.title` is only the extension
      // fallback behind the magic-byte sniff.
      const rail = resolveRail(bytes, meta.mimeType, meta.title);

      // 4. SMOKE:: sniff FIRST (intake.ts grammar) — vaultSmoke.ts depends on it staying AHEAD of
      // the rail dispatch — then dispatch by rail.
      const sniffed = decodeUtf8(bytes);
      let extracted: Extracted;
      if (sniffed.startsWith(SMOKE_EXTRACT_PREFIX)) {
        extracted = { text: sniffed.slice(SMOKE_EXTRACT_PREFIX.length), path: "smoke" };
      } else if (rail === "pdf") {
        extracted = await extractPdf(ctx, bytes);
      } else if (rail === "image") {
        // A SNIFFED image with an empty/wrong MIME must still be sent with a real mediaType, or
        // the model call is malformed — SC#1 would "work" right up to the point it silently didn't.
        const imageMediaType = meta.mimeType.startsWith("image/")
          ? meta.mimeType
          : (({ png: "image/png", jpeg: "image/jpeg", gif: "image/gif" } as const)[
              sniffContainer(bytes) as "png" | "jpeg" | "gif"
            ] ?? "image/png");
        extracted = { text: await extractHosted(ctx, bytes, imageMediaType), path: "hosted" };
      } else if (rail === "zip") {
        // Every ZIP-based office format (DOCX/DOCM, XLSX/XLSM, PPTX/PPTM, ODT/ODS/ODP, EPUB) —
        // extractOfficeText dispatches on the archive's own marker entry, not on a mime type.
        try {
          extracted = { text: extractOfficeText(bytes).text, path: "office" };
        } catch {
          await fail("office_parse_failed");
          return null;
        }
      } else if (rail === "legacy_doc" || rail === "legacy_ppt") {
        try {
          const text = oleText(bytes, rail === "legacy_doc" ? "doc" : "ppt");
          extracted = { text, path: "legacy" };
        } catch {
          await fail("legacy_parse_failed");
          return null;
        }
      } else if (rail === "legacy_xls") {
        // An HONEST refusal, deliberately not a plausible one. A printable-run sweep over BIFF is
        // NOT an acceptable substitute: legacy .xls stores numbers as binary doubles, so a sweep
        // recovers the column headers and silently loses every value — a spreadsheet that reads as
        // a document with no data in it. The real parser (SheetJS) lands in plan 15.2-07; until
        // then the remedy shown to the user is "re-save as .xlsx".
        await fail("unsupported_legacy_spreadsheet");
        return null;
      } else if (rail === "rtf") {
        try {
          extracted = { text: rtfText(bytes), path: "raw" };
        } catch {
          await fail("raw_parse_failed");
          return null;
        }
      } else if (rail === "markup") {
        extracted = { text: markupText(decodeUtf8(bytes)), path: "raw" };
      } else if (rail === "text") {
        // JSON / YAML / TSV / LOG / plain text all ride here — the document IS its own extraction.
        extracted = { text: decodeUtf8(bytes), path: "raw" };
      } else {
        // NOT dead code any more. This line has existed since 03.8-02 and was UNREACHABLE, because
        // the mutation upstream refused to schedule anything it could not name — which is exactly
        // how a .xlsm parked at pending_extraction for ~20 hours with no failureReason. Bytes that
        // nothing here can read now land as a TERMINAL failure the user can see and retry.
        await fail("unsupported_format");
        return null;
      }

      // An extraction that recovered nothing must FAIL, not succeed with 0 chars. A `ready`
      // document with empty text is a PLAUSIBLE failure — the agent grounds confidently on
      // nothing — and this phase exists to remove exactly that shape (the same reason oleText
      // throws rather than returning "").
      if (extracted.text.trim().length === 0) {
        await fail("empty_extraction");
        return null;
      }

      // 5. scanText FAIL-CLOSED on the extracted output BEFORE any audit write (§4).
      const scan = extracted.text.includes(PII_POISON_SENTINEL)
        ? scanText(undefined)
        : scanText(extracted.text);
      if (!scan.ok) {
        await fail("pii_scan_failed");
        // ONE refs-only audit row — NEVER raw/redacted text (intake.ts ordering verbatim).
        await ctx.runMutation(internal.audit.log, {
          tenantId,
          correlationId: vaultDocId,
          eventType: "vault.extraction_failed",
          actor: "system",
          payload: { vaultDocId, kind: rail, reason: "pii_scan_failed" },
        });
        return null;
      }

      // 6. Truncate at the char cap (Pitfall 6: stays under Convex's ~1 MiB doc limit).
      const truncated = extracted.text.length > VAULT_EXTRACT_CHAR_CAP;
      const outText = truncated ? extracted.text.slice(0, VAULT_EXTRACT_CHAR_CAP) : extracted.text;

      // 7. Refs/counts-only success audit (§4) — never text.
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: vaultDocId,
        eventType: "vault.extracted",
        actor: "system",
        payload: {
          vaultDocId,
          // The RAIL that read the bytes. Still keyed `kind` so existing audit readers are
          // unaffected; it is a label — refs/counts only, never document text (§4).
          kind: rail,
          path: extracted.path,
          piiCounts: scan.value.counts,
          charCount: outText.length,
          truncated,
        },
      });

      // 8. THE SEAM — RAW post-gate text into the content plane; the seam flips the row to
      // processing and starts the ingest workflow (embed -> graph -> ready).
      await ctx.runMutation(internal.vault.ingestExtractedText, {
        docId: vaultDocId,
        tenantId,
        text: outText,
        truncated,
      });
      return null;
    } catch (e) {
      // Unexpected throw -> honest failure with a refs-only reason (our own/parser/SDK error
      // strings, never model output or document content).
      const msg = e instanceof Error ? e.message.slice(0, 160) : "unknown";
      await ctx.runMutation(internal.vault.markFailed, {
        vaultDocId,
        reason: `extract_error: ${msg}`,
      });
      return null;
    }
  },
});
