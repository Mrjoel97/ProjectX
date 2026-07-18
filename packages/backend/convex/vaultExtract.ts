"use node";

// Lane-1 (03.8-02) extraction dispatcher — PDF text-layer-first + hosted OCR + office delegation.
// The spine (RESEARCH Pattern 1, intake.ts ordering): preCall gate -> markExtracting -> load
// bytes via ctx.storage.get (NEVER via args — 5 MiB node-action arg cap, vault files go to
// 8 MiB) -> SMOKE::extract:: sniff -> dispatch by extractionKindFor -> scanText FAIL-CLOSED on
// the extracted output BEFORE any audit write (§4) -> refs/counts-only audit -> char-cap
// truncation -> internal.vault.ingestExtractedText seam with the RAW post-gate text
// (planner-confirmed: the content plane holds the user's own data; downstream re-scans).
// A governed stop is a RETURN + markFailed(reason), never a throw; the whole body sits in a
// try/catch so an unexpected throw also lands as markFailed (refs-only reason).
// NEVER imports llm.ts or vaultTranscribe.ts (§96 circular-inference rule — "use node"
// modules stay siblings, not imports).
import { scanText } from "@pikar/pii";
import { extractionKindFor, VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
// Subpath import (NOT the barrel) — keeps fflate structurally out of the V8 bundle.
import { extractOfficeText } from "@pikar/vault/officeText";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

// SMOKE:: offline seam — the intake.ts grammar verbatim: SMOKE::extract::<text> short-circuits
// to <text> with NO model call and NO spend. PII_POISON:: routes the extracted output into
// scanText's OWN non-string Err branch (never a fabricated Err), intake.ts precedent.
const SMOKE_EXTRACT_PREFIX = "SMOKE::extract::";
const PII_POISON_SENTINEL = "PII_POISON::";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

type ExtractPath = "smoke" | "text_layer" | "hosted" | "office";
type Extracted = { text: string; path: ExtractPath };

/** Task-2 fills this with unpdf text-layer-first + hosted OCR fallback. */
async function extractPdf(_ctx: GenericActionCtx<DataModel>, _bytes: Uint8Array): Promise<Extracted> {
  throw new Error("pdf_extract_pending");
}

/** Task-2 fills this with the intake.ts extractVisual shape verbatim. */
async function extractHosted(
  _ctx: GenericActionCtx<DataModel>,
  _bytes: Uint8Array,
  _mimeType: string,
): Promise<string> {
  throw new Error("hosted_extract_pending");
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
      const kind = extractionKindFor(meta.mimeType, meta.title) ?? "unknown";

      // 4. SMOKE:: sniff FIRST (intake.ts grammar), then dispatch by kind.
      const sniffed = decodeUtf8(bytes);
      let extracted: Extracted;
      if (sniffed.startsWith(SMOKE_EXTRACT_PREFIX)) {
        extracted = { text: sniffed.slice(SMOKE_EXTRACT_PREFIX.length), path: "smoke" };
      } else if (kind === "pdf") {
        extracted = await extractPdf(ctx, bytes);
      } else if (kind === "image") {
        extracted = { text: await extractHosted(ctx, bytes, meta.mimeType), path: "hosted" };
      } else if (kind === "office") {
        try {
          extracted = { text: extractOfficeText(bytes, meta.mimeType).text, path: "office" };
        } catch {
          await fail("office_parse_failed");
          return null;
        }
      } else {
        // "transcribe" rides vaultTranscribe.ts (Lane 4); null should never be scheduled here.
        await fail("unsupported_format");
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
          payload: { vaultDocId, kind, reason: "pii_scan_failed" },
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
          kind,
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
