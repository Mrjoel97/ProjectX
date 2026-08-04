/**
 * Folder-ingest cost estimation + the refund clamp (15.3-03, VALT-06).
 *
 * CLAUDE.md §1 — this is domain logic, so it is pure and lives here rather than in a Convex
 * handler. `packages/vault/` and not `packages/cost/` because `packages/vault/` is already a
 * registered `watch.json` prefix (docs/playbooks/vault.md) while `packages/cost/src/` is watched
 * by no playbook (15.3-RESEARCH §1.9).
 *
 * TWO JOBS, both of which the budget wall depends on:
 *
 * 1. `estimateFolderCents` — what a whole folder will draw against the ingest window, computed
 *    CONSERVATIVELY. Over-estimation is safe (the settle path refunds the unspent remainder);
 *    under-estimation breaks the phase's central invariant, because the folder would then trip
 *    the wall halfway through and leave a half-ingested folder — worse than a refused one.
 * 2. `clampRefundCents` — the one line standing between a tenant and free budget. See its
 *    docstring; it is a money bug, not a rounding bug.
 *
 * PRICES ARE IMPORTED, NEVER RESTATED. `@pikar/cost` owns the price table; `cost.ts:20-22`
 * records that a model constant and its PRICING row land together. A second copy here would
 * drift silently and the drift would show up as an under-reservation.
 */
import { DEFAULT_MODEL, estimateTokens, priceTranscription, priceUsage } from "@pikar/cost";
import { GRAPH_EXTRACT_CHAR_CAP, VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } from "./constants";
import { extractionKindFor, VAULT_EXTRACT_PAGE_CAP } from "./extractKind";

/**
 * Embedding is FREE **today** — `text-embedding-3-small` is absent from `PRICING`, so
 * `priceUsage` errs and `vaultRag.ts` records 0 (15.3-RESEARCH §1.4). This term is carried
 * EXPLICITLY at zero rather than omitted: a silent omission becomes wrong on the day the
 * embedding model gets a price row, and nothing would fail to say so.
 */
export const EMBED_USD_PER_MTOK = 0;

/**
 * Input tokens billed for ONE full-page `gpt-4o-mini` vision call. gpt-4o-mini bills images at a
 * large token multiple, and 33k input tokens is what reproduces the ~$0.005/page figure measured
 * live in 15.3-RESEARCH §1.4. Expressed as TOKENS, not dollars, so the estimate follows the
 * price table when the model's rate moves.
 */
const OCR_PAGE_INPUT_TOKENS = 33_000;
/** A page of transcribed text back from the same call. */
const OCR_PAGE_OUTPUT_TOKENS = 1_000;
/** Graph extraction returns bounded JSON (nodes + edges), not prose. */
const GRAPH_OUTPUT_TOKENS = 1_024;

/**
 * Bytes-per-second assumed for an audio/video file whose real duration has not been probed.
 * 16 KB/s is a 128 kbps AUDIO rate, so a video (far higher bitrate) is over-estimated — the safe
 * direction under reserve-then-refund. A 25 MB video (the cap) prices at ~26 minutes ≈ $0.16.
 */
const ASSUMED_AUDIO_BYTES_PER_SEC = 16_000;

/**
 * `guardrails.recordSpend` charges `Math.ceil(costUsd * 100)` PER CALL and no-ops at <= 0. Model
 * that, not the true price: a ~$0.005 document draws a FULL cent, so 300 sub-cent documents draw
 * ~2x their real cost (15.3-CONTEXT §B14). An estimator computed from model pricing alone
 * under-reserves a large folder by about half, which is exactly the failure the wall forbids.
 */
const centsFor = (usd: number): number => Math.max(0, Math.ceil(usd * 100));

/** Price a `gpt-4o-mini` call from the SHARED table. An unpriced model is a bug, not a governed
 *  stop — estimating it at 0 would reserve nothing and strand the folder mid-run (the A7 defect,
 *  one rail over), so it throws rather than silently returning a free folder. */
function modelUsd(inputTokens: number, outputTokens: number): number {
  const priced = priceUsage(DEFAULT_MODEL, { inputTokens, outputTokens });
  if (!priced.ok) throw new Error(`ingestEstimate: ${DEFAULT_MODEL} is absent from PRICING`);
  return priced.value;
}

/** One hosted OCR page (`vaultExtract.extractHosted`, one call per page). */
const ocrPageUsd = (): number => modelUsd(OCR_PAGE_INPUT_TOKENS, OCR_PAGE_OUTPUT_TOKENS);

/**
 * Head-slice ceiling in tokens — `capGraphText` sends at most `GRAPH_EXTRACT_CHAR_CAP` chars.
 * ponytail: routed through `@pikar/cost`'s own `estimateTokens` (one 120 KB temp string, once, at
 * import) rather than re-typing its chars/4 heuristic here. If that heuristic ever becomes a real
 * tokenizer this line follows it for free; a local `/ 4` would not.
 */
const GRAPH_INPUT_TOKENS = estimateTokens("x".repeat(GRAPH_EXTRACT_CHAR_CAP));

/**
 * The per-document floor every ingested document pays: ONE `recordSpend` carrying
 * embed + graph-extract (`vaultIngest.ingestDoc` step 5). Graph extraction is a single
 * `gpt-4o-mini` call over at most `GRAPH_EXTRACT_CHAR_CAP` chars.
 */
const perDocumentUsd = (): number =>
  EMBED_USD_PER_MTOK + modelUsd(GRAPH_INPUT_TOKENS, GRAPH_OUTPUT_TOKENS);

export type EstimateInput = {
  size: number;
  mimeType: string;
  /** Stage-2 probe fields (15.3-CONTEXT §A4). ABSENT at pick time — the browser gives bytes and
   *  mime only — and present once the bytes have landed and the free local probe has run. The
   *  reservation is taken off the PROBED numbers; stage 1 is a card, not a reservation. */
  pages?: number;
  hasTextLayer?: boolean;
  durationSec?: number;
};

/** Refs-only labels (§4): a reason is a static code, never a filename. */
export type FileEstimate = { cents: number; reason: string };

export type FolderEstimate = {
  estCents: number;
  /** One entry per input, INDEX-ALIGNED with `files`. A skipped file is 0 cents. */
  perFile: FileEstimate[];
  /** The subset the upload gate will refuse before it ever ingests — what the pre-flight card
   *  promises to name. Their cost is genuinely 0, which is why they do not inflate the reserve. */
  skipped: { reason: string }[];
};

function estimateFile(f: EstimateInput): { cents: number; reason: string; skipped: boolean } {
  const kind = extractionKindFor(f.mimeType);

  // 1. Files `vault.vaultUpload` refuses never enter the pipeline, so they cost nothing. Naming
  //    them here is what lets the pre-flight card say what will be skipped BEFORE the upload.
  if (!(f.size > 0)) return { cents: 0, reason: "empty_file", skipped: true };
  const isAv = kind === "transcribe";
  const cap = isAv ? VAULT_VIDEO_CAP_BYTES : VAULT_FILE_CAP_BYTES;
  if (f.size > cap) {
    return { cents: 0, reason: isAv ? "over_video_cap" : "over_file_cap", skipped: true };
  }

  // 2. The EXTRACTION spend — the only term that varies by 40x inside one mime type.
  let extractCents = 0;
  let reason = "free_extract"; // txt/md/csv, office, and any rail with no model call
  if (isAv) {
    // `priceTranscription` bills whole minutes, so it already rounds our way.
    const probed = f.durationSec;
    const seconds =
      typeof probed === "number" && Number.isFinite(probed) && probed >= 0
        ? probed
        : f.size / ASSUMED_AUDIO_BYTES_PER_SEC;
    const priced = priceTranscription(seconds);
    if (!priced.ok) throw new Error("ingestEstimate: priceTranscription rejected a valid duration");
    extractCents = centsFor(priced.value);
    reason = probed === undefined ? "transcribe_assumed_duration" : "transcribe";
  } else if (kind === "image") {
    extractCents = centsFor(ocrPageUsd()); // the image rail is ONE hosted call
    reason = "ocr_image";
  } else if (kind === "pdf") {
    if (f.hasTextLayer === true) {
      reason = "pdf_text_layer"; // `unpdf` returns the text layer with NO model call — free
    } else {
      // UNKNOWN PAGE COUNT ⇒ THE SCANNED CEILING. A text-layer PDF costs ~$0.006 and a scanned
      // one ~$0.25 — a 40x spread the estimator cannot see without the probe. Guessing low here
      // is the one guess that breaks the invariant, so it guesses high and the refund pays it back.
      const pages = Math.min(f.pages ?? VAULT_EXTRACT_PAGE_CAP, VAULT_EXTRACT_PAGE_CAP);
      // ONE recordSpend PER PAGE (`extractHosted` is called per page), so the cent-ceiling
      // applies per page too — a 50-page scan draws 50 cents, not the 28 its tokens price at.
      extractCents = pages * centsFor(ocrPageUsd());
      reason = f.pages === undefined ? "ocr_pdf_assumed_page_cap" : "ocr_pdf_scanned";
    }
  }

  // 3. Every document that ingests ALSO pays the embed + graph recordSpend, whatever its rail.
  return { cents: extractCents + centsFor(perDocumentUsd()), reason, skipped: false };
}

/**
 * What a whole folder will draw against `ingestSpendCents`, in cents, conservatively.
 *
 * Deliberately TOTAL and deliberately pessimistic: an unprobed PDF is priced as a 50-page scan
 * and an unprobed video as 128 kbps audio. The reservation is taken off this number, and the
 * settle path refunds whatever was not spent — which is what makes the pessimism affordable.
 */
export function estimateFolderCents(files: EstimateInput[]): FolderEstimate {
  const perFile: FileEstimate[] = [];
  const skipped: { reason: string }[] = [];
  let estCents = 0;
  for (const f of files) {
    const one = estimateFile(f);
    perFile.push({ cents: one.cents, reason: one.reason });
    if (one.skipped) skipped.push({ reason: one.reason });
    estCents += one.cents;
  }
  return { estCents, perFile, skipped };
}

/**
 * How many cents a settle may credit back — **the money bug, in one line.**
 *
 * `@convex-dev/rate-limiter@0.3.2` has no refund API. A refund is a NEGATIVE `count`, and
 * `calculateRateLimit` computes `value = min(state.value + rate * elapsedWindows, capacity) - count`
 * — **the capacity clamp runs BEFORE the count is subtracted.** So a refund issued after the 24h
 * fixed window has rolled adds to a window that was already refilled to capacity: verified live at
 * **2900 against a capacity of 2500** (15.3-RESEARCH §1.2). Folder ingests routinely span the reset.
 *
 * Without this clamp a tenant gets free budget for timing an upload across midnight. `capacity`
 * comes from `getValue`'s `config.capacity ?? config.rate`; `currentValue` is that window's value
 * AFTER any roll-forward. The settle path additionally SKIPS the refund entirely when the window
 * rolled since `reservedAt` — the clamp alone would still permit crediting a window this folder
 * never paid into, up to whatever someone else spent in it since the roll.
 */
export function clampRefundCents(unspent: number, currentValue: number, capacity: number): number {
  return Math.max(0, Math.min(unspent, capacity - currentValue));
}
