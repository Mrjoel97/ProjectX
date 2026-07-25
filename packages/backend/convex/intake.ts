"use node";

// Backend intake spine (INTK-02/03) — the SC3 guardrail-ordering heart of Phase 4
// (04-RESEARCH § The Guardrail Merge Point): classify -> EXTRACT (the bounded GRDL-01
// chicken/egg exception: un-redacted bytes/text go ONLY to the zero-retention OpenAI
// processor performing OCR/transcription, because there is nothing to redact until
// extraction produces text) -> scanText on the EXTRACTED OUTPUT, fail-closed -> on Ok:
// cost -> audit (refs/counts only) -> persist REDACTED safeText -> merge into the governed
// cockpit conversation via the EXISTING public api.cockpit.sendCockpitMessage. RAW extracted
// text is NEVER audited/logged/persisted (CLAUDE.md §4). ZERO edits to cockpit.ts/llm.ts.
//
// "use node": this module holds ONLY actions (no ctx.db) — every DB read/write goes through
// intakeDb.ts via ctx.runQuery/ctx.runMutation (CLAUDE.md §2/§96). It does NOT import llm.ts:
// a second "use node" module importing a sibling "use node" module's internals would re-trigger
// the TS circular-inference cliff (04-RESEARCH §6) — the model-resolution helper below is a
// small local duplicate, not a shared import.
import { openai } from "@ai-sdk/openai";
import { ATTACHMENT_EXTRACTOR_SKILL } from "@pikar/contracts/skill";
import { priceTranscription, priceUsage } from "@pikar/cost";
import { classify, frameForConversation, type IntakeKind } from "@pikar/extraction";
import { scanText } from "@pikar/pii";
import { experimental_transcribe as transcribe, generateText } from "ai";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { tenantAction } from "./lib/functions";

// Per-call wall-clock ceiling (mirrors llm.ts's CALL_TIMEOUT_MS).
const CALL_TIMEOUT_MS = 45_000;

// Hard upload cap enforced BEFORE any extraction model call (mirrors PLAN_ATTACHMENT_CAP_BYTES,
// Pitfall 7). Sized above the 8 MiB outbound-document cap: inbound audio dictation and scanned
// PDFs legitimately run larger than a generated one-page report.
export const INTAKE_UPLOAD_CAP_BYTES = 20 * 1024 * 1024; // 20 MiB

// ── SMOKE:: offline seam (mirrors llm.ts/gmail.ts) ────────────────────────────────────────
// A dev/test run must drive the REAL spine (classify -> redact -> cost -> audit -> merge)
// deterministically and with ZERO real API calls. The sentinel carries no PII, so it survives
// redaction verbatim.
const SMOKE_TRANSCRIBE_PREFIX = "SMOKE::transcribe::";
const SMOKE_EXTRACT_PREFIX = "SMOKE::extract::";
// ponytail: offline-only forced-failure hook for the fail-closed scanText path (mirrors
// llm.ts's `render=fail::`). scanText itself is never faked — this sentinel just routes a
// poisoned fixture into scanText's OWN documented non-string Err branch, deterministically.
// Remove once a mock-poison fixture exists at the @pikar/pii layer.
const PII_POISON_SENTINEL = "PII_POISON::";

const PAUSED_TEXT =
  "I'm briefly unavailable — I've paused processing this upload. Please try again in a moment.";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Audio -> text (INTK-03). `SMOKE::transcribe::<text>` short-circuits to `<text>` with NO API
 * call and NO spend (the offline path). Otherwise transcribes via the zero-retention OpenAI
 * processor and prices/records the real spend per audio-minute (priceTranscription, Plan 03).
 */
async function transcribeAudio(ctx: GenericActionCtx<DataModel>, bytes: Uint8Array): Promise<string> {
  const sniffed = decodeUtf8(bytes);
  if (sniffed.startsWith(SMOKE_TRANSCRIBE_PREFIX)) return sniffed.slice(SMOKE_TRANSCRIBE_PREFIX.length);

  const result = await transcribe({
    model: openai.transcription("gpt-4o-transcribe"),
    audio: bytes,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const priced = priceTranscription(result.durationInSeconds ?? 0);
  if (priced.ok) {
    await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
  }
  return result.text;
}

/**
 * Image/PDF -> text (INTK-02, OCR/visual-description). `SMOKE::extract::<text>` short-circuits
 * to `<text>` with NO API call and NO spend. Otherwise loads the `attachment-extractor` skill
 * body as the system prompt (CLAUDE.md §5 — no hardcoded prompt; fails closed unseeded) and
 * runs a vision `generateText` call, pricing/recording the real spend (priceUsage).
 */
async function extractVisual(
  ctx: GenericActionCtx<DataModel>,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const sniffed = decodeUtf8(bytes);
  if (sniffed.startsWith(SMOKE_EXTRACT_PREFIX)) return sniffed.slice(SMOKE_EXTRACT_PREFIX.length);

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

type RunIntakeArgs = {
  tenantId: string;
  threadId: string;
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  isDictation: boolean;
};

/**
 * The SC3-ordered spine shared by attachToThread/dictateToThread. Every governed stop (kill
 * switch/budget, an unrecognized file, a fail-closed redaction) surfaces as a conversational
 * reply merged via sendCockpitMessage — never a throw, mirroring the cockpit's blocked-as-data
 * pattern (runCockpitAgent's PAUSED_REPLY). Explicit return type (guidelines §96).
 */
async function runIntake(
  ctx: GenericActionCtx<DataModel>,
  { tenantId, threadId, storageId, filename, mimeType, isDictation }: RunIntakeArgs,
): Promise<{ threadId: string }> {
  // The sole merge/reply channel — a governed stop and the eventual successful merge both flow
  // through the SAME public action (ZERO edits to cockpit.ts/llm.ts).
  const respond = async (text: string): Promise<{ threadId: string }> => {
    await ctx.runAction(api.cockpit.sendCockpitMessage, { threadId, text });
    return { threadId };
  };

  // 1. Governed gate BEFORE any model call (kill-switch/budget) — a stop is conversational
  // data, never a throw/DLQ. NO artifact row is created past this point (no extraction ran).
  const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
    await ctx.runMutation(internal.guardrails.preCall, {});
  if (!pre.ok) return respond(PAUSED_TEXT);

  // 2. Load bytes (a missing blob is a client-visible failure, not a bug — respond, don't throw).
  const blob = await ctx.storage.get(storageId);
  if (!blob) return respond("I couldn't read that upload — please try attaching it again.");
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // Enforce the upload cap on the REAL bytes (never trust a client-declared size for a security
  // gate) — before any model call.
  if (bytes.byteLength > INTAKE_UPLOAD_CAP_BYTES) {
    const capMb = Math.floor(INTAKE_UPLOAD_CAP_BYTES / (1024 * 1024));
    return respond(`That file is too large to process (over ${capMb}MB). Please try a smaller file.`);
  }

  // 3. classify (dictation forces the audio path — the MediaRecorder blob is already known-audio).
  const kind: IntakeKind = isDictation ? "audio" : classify(bytes, mimeType, filename).kind;

  // 4. insertArtifact (uploaded) -> patch (extracting).
  const artifactId: Id<"intakeArtifacts"> = await ctx.runMutation(internal.intakeDb.insertArtifact, {
    tenantId,
    threadId,
    storageId,
    filename,
    mimeType,
    size: bytes.byteLength,
    kind,
  });
  await ctx.runMutation(internal.intakeDb.patchArtifact, { artifactId, status: "extracting" });

  // 5. EXTRACTION MODEL CALL (the bounded GRDL-01 exception) -> rawText.
  let rawText: string;
  if (kind === "audio") {
    rawText = await transcribeAudio(ctx, bytes);
  } else if (kind === "image" || kind === "pdf") {
    rawText = await extractVisual(ctx, bytes, mimeType);
  } else if (kind === "document") {
    rawText = decodeUtf8(bytes); // NO model, NO spend — the bytes already ARE the text.
  } else {
    await ctx.runMutation(internal.intakeDb.patchArtifact, { artifactId, status: "failed" });
    return respond(`I don't recognize the file type of ${filename} — I can't process it. Please try a different file.`);
  }

  // 6. scanText FAIL-CLOSED on the EXTRACTED OUTPUT (redact BEFORE any audit write or merge, §4).
  // ponytail: the poison sentinel routes into scanText's OWN non-string Err branch (never faked).
  const scan = rawText.includes(PII_POISON_SENTINEL) ? scanText(undefined) : scanText(rawText);
  if (!scan.ok) {
    await ctx.runMutation(internal.intakeDb.patchArtifact, { artifactId, status: "failed" }); // NO extracted written
    // ONE refs-only audit row of the redaction FAILURE (OPSG-02/§4) — NO raw/redacted text.
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: artifactId,
      eventType: "intake.extraction_failed",
      actor: "system",
      payload: { artifactId, kind, reason: "pii_scan_failed" },
    });
    return respond(`I couldn't safely process ${filename} — the content failed a safety scan. Please try again or paste the text directly.`);
  }
  const { safeText, counts } = scan.value;

  // 7. Persist REDACTED safeText only (content plane; §4 keeps it out of audit).
  await ctx.runMutation(internal.intakeDb.patchArtifact, { artifactId, status: "extracted", extracted: safeText });

  // 8. Refs/counts-only audit (§4) — NEVER rawText/safeText.
  await ctx.runMutation(internal.audit.log, {
    tenantId,
    correlationId: artifactId,
    eventType: "intake.extracted",
    actor: "system",
    payload: { artifactId, kind, piiCounts: counts, charCount: safeText.length },
  });

  // 8b. ALSO persist the attachment as a vault doc, so it is embedded/graph-extracted and can
  // ground a LATER turn instead of vanishing with this thread. Stores RAW text (every other vault
  // doc does — the conversation below still gets the redacted safeText); hash-dedup means
  // re-attaching a file already in the vault is a no-op. Dictation is excluded: a voice note IS
  // the request, not a document.
  //
  // FAIL-OPEN, deliberately: the attachment's first job is answering the question in front of it,
  // so a vault-ingest problem must never turn into a failed conversation. The fail-CLOSED PII gate
  // above is upstream, so scan-failed content can never reach here.
  if (!isDictation) {
    try {
      await ctx.runMutation(internal.vault.ingestFromAttachment, {
        tenantId,
        storageId,
        filename,
        mimeType,
        size: bytes.byteLength,
        text: rawText,
      });
    } catch {
      // Swallowed on purpose — see FAIL-OPEN above. The reply still goes out below.
    }
  }

  // 9. MERGE — the ONLY call into the governed cockpit pipeline (ZERO edits to cockpit.ts/llm.ts).
  // Dictation's frameForConversation returns safeText VERBATIM: the transcript IS the request.
  return respond(frameForConversation(kind, filename, safeText));
}

// `size` is accepted (client-known metadata, mirrors requests.ts's attachmentArg shape) but the
// spine never trusts it for the cap decision or the persisted row — runIntake derives the
// authoritative size from the REAL loaded bytes (Rule 2: never trust an unverified client size
// for a security gate).

/** Attach a file (image/PDF/document) to an in-progress cockpit thread (INTK-02). */
export const attachToThread = tenantAction({
  args: {
    threadId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, { threadId, storageId, filename, mimeType }): Promise<{ threadId: string }> =>
    runIntake(ctx, { tenantId: ctx.tenantId, threadId, storageId, filename, mimeType, isDictation: false }),
});

/** Dictate a request via audio — transcribed VERBATIM into the conversation (INTK-03). */
export const dictateToThread = tenantAction({
  args: { threadId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { threadId, storageId }): Promise<{ threadId: string }> =>
    runIntake(ctx, {
      tenantId: ctx.tenantId,
      threadId,
      storageId,
      filename: "dictation.webm",
      mimeType: "audio/webm",
      isDictation: true,
    }),
});
