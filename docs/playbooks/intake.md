# Playbook: Attachment & Voice-Dictation Intake

> Last verified: 2026-07-14 against 04-05
> Build history: `.planning/phases/04-attachment-voice-intake/` · Related ADRs: none

## Purpose

Lets a user attach a file (image/PDF/document) or dictate by voice from the cockpit
composer instead of typing. The system classifies the upload, extracts/OCRs/transcribes
its content, redacts it, and merges the result into the conversation as a turn — an
attachment becomes context the agent can reason about, a dictation becomes the request
itself. This closes the multi-modal intake gap (INTK-02 attachments, INTK-03 voice).

## Key files

- **Pure packages:** `packages/extraction/src/classify.ts` (magic-byte + mime + extension
  sniff → `image | pdf | audio | document | unknown`), `packages/extraction/src/frame.ts`
  (`frameForConversation` — wraps extracted text as the synthetic merge turn; dictation
  passes through verbatim), `packages/extraction/src/index.ts` (public exports).
- **Backend (thin adapters):** `packages/backend/convex/intake.ts` — `"use node"`, ACTIONS ONLY
  (`attachToThread`, `dictateToThread`; the SC3-ordered `runIntake` spine + the
  `transcribeAudio`/`extractVisual` extraction helpers with their `SMOKE::transcribe::`/
  `SMOKE::extract::` offline short-circuits). `packages/backend/convex/intakeDb.ts` — the DB
  module `intake.ts` reaches via `ctx.runQuery`/`ctx.runMutation` (`generateUploadUrl`,
  `insertArtifact`/`patchArtifact`/`getArtifact` internal, `byThread` tenant-scoped). The
  `intakeArtifacts` table region in `packages/backend/convex/schema.ts` (04-03). The
  `attachment-extractor` registry skill (`packages/contracts/skills/`, loaded via
  `ctx.runQuery(internal.skills.getActiveSkill, ...)` — §5, no hardcoded prompt, fails closed
  unseeded). The merge is a CALL to the existing public `api.cockpit.sendCockpitMessage` —
  `intake.ts` never imports `cockpit.ts`/`llm.ts` internals (ZERO edits to either).
- **Frontend:** `apps/web/app/(app)/dashboard/workspace/IntakeControls.tsx` (Plan 05) — a
  self-contained attach picker + one-shot MediaRecorder dictation button, wired through
  `intakeDb.generateUploadUrl` → POST → `intake.attachToThread`/`intake.dictateToThread`.
  Takes `threadId: string` as a prop; renders no conversation output itself (the merge is
  server-side and the existing chat/card views pick it up reactively). Its one-line mount into
  `ChatPane.tsx`'s composer (`<IntakeControls threadId={threadId} />`, once `threadId` is
  truthy) is Lane A's responsibility — `apps/web/e2e/intake.spec.ts` (Plan 05) drives it
  directly via its own test ids ahead of that mount landing.

## Dependencies & blast radius

Run `graphify query "intake"` for the current subgraph once the backend/frontend files
land. Couplings graphify cannot see: the extraction MODEL call goes to the zero-retention
OpenAI processor (not a general LLM call); `@pikar/pii` `scanText` gates every persisted
result; `@pikar/cost` prices the extraction/transcription call same as any other model call.

## Data flow

1. User attaches a file or records dictation in the cockpit composer (`IntakeControls.tsx`)
   — client PUTs bytes to an `intakeDb.generateUploadUrl` URL, then calls
   `intake.attachToThread`/`intake.dictateToThread` with the resulting `storageId`. A client-side
   size guard mirrors `INTAKE_UPLOAD_CAP_BYTES` (UX only — the server always re-derives the cap
   from the real loaded bytes).
2. `runIntake` (the shared spine both actions call) gates on `guardrails.preCall`
   (kill-switch/budget) BEFORE anything else — a stop is a conversational paused reply merged
   via `sendCockpitMessage`, never a throw; NO `intakeArtifacts` row is created on a stop.
3. `packages/extraction` `classify(bytes, mimeType, filename)` (pure, no Convex/API import)
   decides the path: image/pdf/document → OCR/extract; audio → transcribe (dictation always
   forces the audio path); unknown → reject conversationally with NO model call. An
   `intakeArtifacts` row is inserted (`status: "uploaded"` → `"extracting"`).
4. `intake.ts` runs the extraction/transcription model call (the bounded GRDL-01 exception —
   `transcribeAudio`/`extractVisual`, each with a `SMOKE::transcribe::`/`SMOKE::extract::`
   offline short-circuit), then redacts the RAW output via `@pikar/pii` `scanText`
   FAIL-CLOSED before anything is persisted or audited. On Err: `status: "failed"`, NO
   `extracted` field, NO merge — but ONE refs-only `intake.extraction_failed` audit row
   records the failure itself (OPSG-02).
5. On Ok, the redacted `safeText` is written to `intakeArtifacts.extracted`
   (`status: "extracted"`); a refs/counts-only `intake.extracted` audit row is written;
   `frameForConversation` turns `safeText` into a synthetic user turn (attachment: named-file
   frame; dictation: verbatim passthrough) merged into the cockpit conversation via the
   EXISTING public `api.cockpit.sendCockpitMessage` — `intake.ts` never imports
   `cockpit.ts`/`llm.ts` internals.
6. Cost is recorded for the extraction/transcription call (`priceUsage`/`priceTranscription` →
   `guardrails.recordSpend`; kill-switch/budget respected, same as any other model call).

## Invariants — what must never break

1. **Extracted content is REDACTED via `@pikar/pii` `scanText` BEFORE any audit write or
   conversation merge** (CLAUDE.md §4 / GRDL-01). Enforced in `intake.test.ts`
   (`SMOKE::extract::` + PII-poison fail-closed cases, 04-04).
2. **The extraction MODEL call is the bounded GRDL-01 chicken/egg exception**: un-redacted
   bytes/text go ONLY to the zero-retention OpenAI processor performing OCR/transcription;
   its OUTPUT is redacted before anything downstream sees it. This is the ONE place in the
   codebase where un-redacted content leaves the process boundary, and it is intentional —
   there is nothing to redact yet because extraction is what produces the text. Do not
   generalize this exception to any other model call in the codebase.
3. **`intakeArtifacts.extracted` holds `safeText` ONLY — never raw bytes or raw extracted
   text.** Audit and dead-letter payloads carry refs/hashes/counts only (CLAUDE.md §4).
4. **`packages/extraction` stays pure** — no Convex/AI/OpenAI import (CLAUDE.md §1). The
   classifier and framer must be testable offline with zero network/DB access.
5. **A `scanText` Err is NOT silent** — the redaction FAILURE itself is recorded as exactly
   ONE refs-only audit row (`{ artifactId, kind, reason: "pii_scan_failed" }`, no raw/redacted
   text) so a fail-closed stop is observable in the audit trail (OPSG-02 / §4).
6. **The merge is a CALL, never an edit** — `intake.ts` reaches the cockpit conversation ONLY
   through the existing public `api.cockpit.sendCockpitMessage`. It must never import
   `cockpit.ts`/`llm.ts` internals or duplicate their logic (the Lane-B/Lane-A boundary).
7. **`intake.ts` is `"use node"` — ACTIONS ONLY.** Every DB read/write goes through
   `intakeDb.ts` via `ctx.runQuery`/`ctx.runMutation`; the skill body loads via
   `ctx.runQuery(internal.skills.getActiveSkill, ...)`, never `loadSkill`/`ctx.db` directly
   (CLAUDE.md §2/§96).

## How to change safely

- **Changing classification buckets/thresholds:** edit `packages/extraction/src/classify.ts`
  only; add/extend cases in `classify.test.ts` first (TDD). No Convex dependency to worry
  about — this is a pure function.
- **Changing the merge-turn framing:** edit `packages/extraction/src/frame.ts`; keep the
  audio/dictation path a verbatim passthrough (the transcript IS the request, not an
  "attached file").
- **Adding a new intake source (backend/schema/UI):** extend the `intakeArtifacts` schema
  region, `intake.ts`/`intakeDb.ts`, or `IntakeControls.tsx` (Plan 05); re-run the
  redact-before-persist invariant check (`SMOKE::extract::` + the PII-poison case in
  `intake.test.ts`) and re-verify no raw bytes/text reach `audit`/`deadLetters`.
- **Changing the extraction model/skill:** `transcribeAudio`/`extractVisual` in `intake.ts`;
  the OCR/vision prompt is the `attachment-extractor` registry skill (§5 — edit via the 5-file
  mirror, never hardcode a prompt string in `intake.ts`).
- Any change under the watched paths below must bump this playbook's `Last verified` line
  in the same commit/phase (CLAUDE.md §9).

## How to verify

- **Unit (pure):** `pnpm --filter @pikar/extraction test` — classify + frame, offline, <1s.
- **Convex-test:** `cd packages/backend && npx vitest run convex/intake.test.ts` — upload URL +
  artifact CRUD round-trip, extract→redact→persist (§4 honeypot: no raw PII anywhere in
  audit), fail-closed redaction (ONE refs-only failure audit row, OPSG-02), kill-switch/cost
  gate, the merge seam (a framed turn lands in the thread via `sendCockpitMessage`), and the
  dictation verbatim-frame contract. (`pnpm --filter @pikar/backend test -- intake` does NOT
  narrow to the file — the package's `test` script is plain `vitest run`; use the `npx vitest
  run` form above, same pre-existing script quirk noted in 04-02's summary.)
- **E2E:** `pnpm --filter @pikar/web exec playwright test intake` — `intake.spec.ts` drives
  attach + dictate over the `SMOKE::` grammar via `IntakeControls`'s own test ids
  (`attach-file-input`, `dictation-test-input`); Playwright-discovered + type-loads as of
  Plan 05, LIVE run deferred to Plan 06 alongside the Lane A `ChatPane.tsx` mount.
- **Manual-only:** delivered-email-reflects-attachment/dictation-content-past-guardrails is a
  live human-verify checkpoint (04-06 · T2) — see `.planning/phases/04-attachment-voice-intake/04-VALIDATION.md`.

## Operational notes

- No new env vars. The extraction model call reuses the existing `OPENAI_API_KEY`/
  zero-retention configuration already used by the cockpit LLM gateway — no new secret plane.
- `packages/extraction` has zero runtime dependencies beyond `vitest` as a devDependency
  (pure hand-rolled magic-byte sniff — no `file-type` package, per ponytail rung 6/3).
- `intake.test.ts` registers the `agent`/`rateLimiter`/`auditCounts` components (the Wave-0
  seed helper) so the merge seam (`sendCockpitMessage` → `runCockpitAgent`) runs end-to-end
  offline with ZERO real API calls: the suite never seeds the skill registry, so
  `runCockpitAgent`'s `cockpit-agent` skill lookup fails closed (`NO_ACTIVE_SKILL`) before it
  would ever reach a model call; `sendCockpitMessage`'s own try/catch converts that into a
  conversational error turn. This is intentional, not a gap — it proves the merge call fires
  without needing a live gateway.

## Known gaps & deferred work

- **The one-line `ChatPane.tsx` mount is not yet in place.** `IntakeControls.tsx` is fully
  built and self-contained (Plan 05), but Lane A owns mounting
  `<IntakeControls threadId={threadId} />` (rendered once `threadId` is truthy) into the
  composer. Until that mount lands, `intake.spec.ts`'s live run stays deferred (Plan 06).
- Live human-verify (real OCR/transcription accuracy + real Gmail delivery reflecting
  attached/dictated content, SC3) remains the sole manual verification (04-06 · T2).
