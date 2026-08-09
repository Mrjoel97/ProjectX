"use node";

// Lane 4 (Phase 3.8, EXTR-I) — vault video/audio transcription rail. The Pattern-1 spine:
// preCall gate → markExtracting → load bytes (ctx.storage.get, NEVER via args — node-action
// args cap at 5 MiB, vault files go to 8 MiB) → SMOKE::transcribe:: sniff →
// TRANSCRIBABLE_CONTAINER_MIME check (unsupported container → markFailed, the HONEST failure:
// a .mov gets a visible reason, never an eternal pending row) → experimental_transcribe
// (the intake.ts transcribeAudio shape, COPIED — "use node" modules never import each other,
// §96 circular-inference rule) → scanText fail-closed gate → counts-only audit (§4) →
// ingestExtractedText seam. Every governed stop is a RETURN, never a throw.
//
// No skill row: transcription takes no prompt (§5 does not apply). Zero new deps.
import { openai } from "@ai-sdk/openai";
import { priceTranscription } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { TRANSCRIBABLE_CONTAINER_MIME, VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
import { experimental_transcribe as transcribe } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Per-call wall-clock ceiling. NOT intake.ts's 45s (that's tuned for seconds-long mic clips):
// a vault video runs up to 25 MB ≈ many minutes of audio, and the call = upload + transcription —
// a 20 MB mp4 was observed aborting at 45s. 8 min sits under Convex's 10-min node-action limit
// with headroom for the rest of the spine (bytes load, seam mutations, embed scheduling).
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
 * The endpoint accepts mp4/webm/mpeg containers directly (audio track demuxed server-side);
 * the vault's video cap (VAULT_VIDEO_CAP_BYTES = 25 MB) is enforced at upload and sits at/under
 * the API's 25 MB limit, so every video that can enter the vault fits the API — the failure paths
 * are an unsupported container or the governed gate.
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
    const runId = crypto.randomUUID();
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
      const blob = doc.storageId ? await ctx.storage.get(doc.storageId) : null;
      if (!blob) return fail("missing_bytes");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // 4. SMOKE sniff FIRST (offline/dev spine — no API call, no spend), then
      // 5. the mime-only container check: unsupported → honest failure, no byte work, no spend.
      const sniffed = decodeUtf8(bytes);
      let rawText: string;
      let durationSeconds = 0;
      if (sniffed.startsWith(SMOKE_TRANSCRIBE_PREFIX)) {
        rawText = sniffed.slice(SMOKE_TRANSCRIBE_PREFIX.length);
      } else if (!TRANSCRIBABLE_CONTAINER_MIME.has(doc.mimeType)) {
        return fail("unsupported_video_container");
      } else {
        // 6. The transcription call + duration-priced spend.
        // Model: whisper-1, NOT gpt-4o-transcribe. gpt-4o-transcribe rejects video-container mp4
        // ("This model does not support the format you provided") — it wants audio-only input;
        // whisper-1 demuxes the audio track from mp4/webm/mpeg video. Both bill at 0.006/min
        // (TRANSCRIPTION_PRICING), so the cost model is unchanged.
        // ponytail: no duration cap — 25 MB of compressed video bounds duration in practice
        // (~a few min typical); audio-extract/chunk is the upgrade path if a >25 MB video (or a
        // duration limit) ever needs to be supported.
        const result = await transcribe({
          model: openai.transcription("whisper-1"),
          audio: bytes,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        const priced = priceTranscription(result.durationInSeconds ?? 0);
        if (priced.ok) {
          await ctx.runMutation(internal.guardrails.recordSpend, {
            tenantId,
            costUsd: priced.value,
            rail: spendRail,
            correlationId: `vault:transcribe:${vaultDocId}:${runId}`,
            model: "whisper-1",
            kind: "vault.transcribe", // code-owned token, refs only (§4)
          });
        }
        rawText = result.text;
        durationSeconds = result.durationInSeconds ?? 0;
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
