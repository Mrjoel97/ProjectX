"use node";

// Transcription: governed gate → tenant-owned normalized audio → byte-derived duration
// → paid admission → provider → privacy scan → counts-only audit → ingestion.
// Keep the original file for download; never trust a compressed container's duration header.
// No prompt or new skill is required for transcription.
import { OR_TRANSCRIPTION_MODEL, priceTranscription } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { TRANSCRIBABLE_CONTAINER_MIME, VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
import { inspectPcmWav } from "@pikar/voice/pcm";
import { experimental_transcribe as transcribe } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { fixtureSeamFor, transcriptionModel, transcriptionUsage } from "./lib/models";
import { internalAction } from "./lib/tenantLifecycle";

// Eight minutes leaves room below the Node action limit for storage and ingestion.
// This request timeout is independent of the ten-minute input-audio ceiling.
const CALL_TIMEOUT_MS = 480_000;

// ── SMOKE:: offline seam (same sentinel family as intake.ts) ─────────────────────────────
// Bytes decoding to `SMOKE::transcribe::<text>` short-circuit to `<text>` — no API call,
// no spend. This drives the whole offline test spine deterministically.
const SMOKE_TRANSCRIBE_PREFIX = "SMOKE::transcribe::";
// ponytail: offline-only forced-failure hook (mirrors intake.ts) — routes a poisoned fixture
// into scanText's OWN non-string Err branch; scanText itself is never faked.
const PII_POISON_SENTINEL = "PII_POISON::";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Transcribe a vault video/audio upload and feed the transcript through the ingest seam.
 * Browser uploads retain the original and supply a canonical mono 16 kHz PCM WAV sidecar.
 * Validate its bytes and derive duration before reserving spend. Legacy canonical WAVs work
 * directly; other legacy media need re-upload with normalized audio. Maximum duration: 10 minutes.
 */
export const transcribeDoc = internalAction({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    tenantId: v.string(),
    // 15.3-03 budget rail. Absent ⇒ today's token-rail behaviour.
    spendRail: v.optional(v.literal("ingest")),
    reserved: v.optional(v.boolean()),
  },
  handler: async (ctx, { vaultDocId, tenantId, spendRail, reserved }): Promise<null> => {
    // FIN-01 replay identity, MINTED not derived — an ATTEMPT nonce. `vaultDocId` alone is TOO
    // COARSE: `vaultSweep`'s retry re-schedules this exact action for the same doc, and a re-entry
    // after a mid-flight failure re-uploads the bytes to whisper — both are real second charges.
    // A doc-scoped constant would collapse them onto the first attempt's `actual` row and leave
    // the ledger BELOW the limiter, the unrecoverable direction. One transcription call per
    // execution, so the nonce alone separates attempt N from attempt N+1.
    const fail = (reason: string): Promise<null> =>
      ctx.runMutation(internal.vault.markFailed, { vaultDocId, reason }).then(() => null);

    try {
      // 1. Governed gate BEFORE any byte/model work — a stop is a visible failure, never a throw.
      //    Reserved folder work reaches the kill-switch branch ONLY (guardrails.preCall).
      const pre:
        | { ok: true }
        | {
            ok: false;
            reason: "kill_switch" | "daily_budget_exhausted" | "deployment_budget_exhausted";
          } = await ctx.runMutation(internal.guardrails.preCall, {
        tenantId,
        rail: spendRail,
        reserved,
      });
      if (!pre.ok) return fail(pre.reason);

      // 2. Work actually starts → flip the visible pill (honest pill). `{ ok: false }` means the
      //    folder was CANCELLED while this queued — markExtracting already failed the row
      //    `folder_cancelled`, and no transcription cent is spent.
      const started = await ctx.runMutation(internal.vault.markExtracting, { vaultDocId });
      if (!started.ok) return null;

      // 3. Metadata + bytes (bytes via storage, never args).
      const doc = await ctx.runQuery(internal.vault.getDocForExtraction, { vaultDocId, tenantId });
      const audioStorageId = doc.transcriptionStorageId ?? doc.storageId;
      const blob = audioStorageId ? await ctx.storage.get(audioStorageId) : null;
      if (!blob) return fail("missing_bytes");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // 4. SMOKE sniff FIRST (offline/dev spine — no API call, no spend), then
      // 5. Legacy container compatibility, then canonical PCM verification before spend.
      const sniffed = decodeUtf8(bytes);
      let rawText: string;
      let durationSeconds = 0;
      if (sniffed.startsWith(SMOKE_TRANSCRIBE_PREFIX) && fixtureSeamFor(tenantId)) {
        rawText = sniffed.slice(SMOKE_TRANSCRIBE_PREFIX.length);
      } else if (!doc.transcriptionStorageId && !TRANSCRIBABLE_CONTAINER_MIME.has(doc.mimeType)) {
        return fail("unsupported_video_container");
      } else {
        // Byte-derived PCM duration is trusted; compressed container metadata is not.
        let pcm: ReturnType<typeof inspectPcmWav>;
        try {
          pcm = inspectPcmWav(bytes);
        } catch {
          return fail("normalized_audio_required");
        }
        const model = transcriptionModel(OR_TRANSCRIPTION_MODEL);
        const ceiling = priceTranscription(pcm.seconds);
        if (!ceiling.ok) return fail("transcription_price_unavailable");
        const reservationId = await ctx.runMutation(internal.guardrails.reservePaidCall, {
          tenantId,
          callId: crypto.randomUUID(),
          model: OR_TRANSCRIPTION_MODEL,
          ceilingCents: Math.max(1, Math.ceil(ceiling.value * 100)),
          rail: spendRail,
        });
        const result = await transcribe({
          model,
          maxRetries: 0,
          audio: bytes,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        const usage = transcriptionUsage(result);
        durationSeconds = pcm.seconds;
        const seconds = result.durationInSeconds ?? usage.seconds ?? pcm.seconds;
        const priced =
          usage.costUsd === undefined && seconds !== undefined
            ? priceTranscription(seconds)
            : undefined;
        const costUsd = usage.costUsd ?? (priced?.ok ? priced.value : undefined);
        if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd < 0)
          throw new Error("PAID_TRANSCRIPTION_COST_UNKNOWN");
        const settled = await ctx.runMutation(internal.guardrails.settlePaidCall, {
          tenantId,
          reservationId,
          costUsd,
        });
        if (settled.breached) throw new Error("PAID_TRANSCRIPTION_EXCEEDED_ALLOWANCE");
        rawText = result.text;
      }

      // 7. scanText FAIL-CLOSED gate (redact-before-audit ordering, §4). The transcript never
      // persists past a failed scan; ONE refs-only audit row records the failure.
      const scan = rawText.includes(PII_POISON_SENTINEL) ? scanText(undefined) : scanText(rawText);
      if (!scan.ok) {
        await ctx.runMutation(internal.vault.markFailed, { vaultDocId, reason: "pii_scan_failed" });
        await ctx.runMutation(internal.audit.log, {
          tenantId,
          correlationId: vaultDocId,
          eventType: "vault.extraction_failed",
          actor: "system",
          payload: { vaultDocId, kind: "video", reason: "pii_scan_failed" },
        });
        return null;
      }

      // 8/9. Truncate at the shared cap, audit COUNTS ONLY (§4 — never transcript text), then
      // hand the raw (post-gate) transcript to the seam (the content plane holds the user's data).
      const truncated = rawText.length > VAULT_EXTRACT_CHAR_CAP;
      const text = truncated ? rawText.slice(0, VAULT_EXTRACT_CHAR_CAP) : rawText;
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: vaultDocId,
        eventType: "vault.extracted",
        actor: "system",
        payload: { vaultDocId, kind: "video", durationSeconds, charCount: text.length, truncated },
      });
      await ctx.runMutation(internal.vault.ingestExtractedText, {
        docId: vaultDocId,
        tenantId,
        text,
        truncated,
      });
      return null;
    } catch (err) {
      // Terminal catch-all: any unexpected step error still lands a visible failed pill with a
      // refs-only static reason (§4 — the failureReason/audit never carry the message). But the
      // error MESSAGE (an API/auth/format error, never transcript text) goes to the function log
      // so a `transcribe_failed` is diagnosable instead of a silent dead-end.
      const msg =
        err instanceof Error
          ? `${err.name}: ${err.message}`.slice(0, 500)
          : String(err).slice(0, 500);
      console.error("[vaultTranscribe] transcribe_failed:", msg);
      // whisper's "could not be decoded / format not supported" almost always means the video has
      // no audio track (verified: a soundless screen-recording mp4 triggers exactly this) — map it
      // to a specific static reason so the card says the truth instead of a generic failure.
      return fail(
        /could not be decoded|format is not supported/i.test(msg)
          ? "no_audio_track_or_undecodable"
          : /timeout|aborted/i.test(msg)
            ? "transcribe_timeout"
            : "transcribe_failed",
      );
    }
  },
});
