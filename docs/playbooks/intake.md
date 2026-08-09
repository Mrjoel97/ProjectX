# Playbook: Attachment & Voice-Dictation Intake

> Last verified: 2026-08-08 (26-07 follow-up — **both intake charges now name themselves in the
> spend ledger.**) `transcribeAudio` and `extractVisual` each take an `artifactId` and pass
> `correlationId: intake:transcribe:<artifactId>` / `intake:extract:<artifactId>` to `recordSpend`,
> plus the real `model` and a code-owned `kind`. **`artifactId` IS the discriminator, and the choice
> is load-bearing:** `runIntake` inserts a FRESH `intakeArtifacts` row per attempt, so an action
> re-entry — which re-runs the transcription for real money — mints a new id and therefore a new
> ledger row. A correlation derived from tenant/thread/`storageId` would have collapsed that second
> real charge onto the first and left the ledger BELOW the limiter, which is the unrecoverable
> direction (a duplicate is findable by reconciling the two planes; a missing movement is
> indistinguishable from money never spent). The `transcribe`/`extract` token separates the two
> rails: ONE artifact can legitimately incur both (a video's audio track plus its frames), and
> without the token those two charges would share a correlation. The policy behind all of this —
> derive where re-entry does not re-spend, mint where it does — lives in `docs/playbooks/guardrails.md`
> §"Phase 26"; a static scan in `guardrails.test.ts` fails the build if any `recordSpend` call site
> ships without a correlation. **Historical note:** the 2026-08-01 entry below anticipated a lane
> making `tenantId` REQUIRED on `recordSpend`; that is NOT what shipped — `tenantId` was already
> required, and the 26-07 additions (`correlationId`, `model`, `kind`, refs) are all OPTIONAL by
> owner decision, precisely to avoid the repo-wide ripple that entry warned about.
>
> Previously verified: 2026-08-01 (OBSERVED, NOT AUTHORED BY THIS ENTRY) — `intake.ts`'s two `recordSpend` call sites (`transcribeAudio`, `extractVisual`) gained a `tenantId` argument, threaded in as a new parameter on both helpers. This is part of an IN-FLIGHT, uncommitted repo-wide change in another lane making `tenantId` REQUIRED on `internal.guardrails.recordSpend` (`guardrails.ts` is dirty in the same working tree). It is recorded here because this playbook's watched path changed, not because this entry made the change — the lane that owns it should replace this line with its own account. **Why it matters beyond intake:** once that field is required, every `recordSpend` caller that reaches it with an undefined `tenantId` throws MID-ACTION, after the model call has already been billed, and the error surfaces far from its cause as `ArgumentValidationError: Object is missing the required field tenantId` on `{costUsd: <n>}`. That is exactly how it presented on the research-dispatch path (eval run `3a1e37f3`, fixture 34), where the cause turned out to be spread ORDER — `{ tenantId: args.tenantId, ..., ...a }` with `a` carrying a present-but-undefined `tenantId` — fixed in `dispatch.ts` at 5460a81 by spreading `...a` FIRST. Anyone auditing the remaining call sites for this migration should check spread order, not just the presence of the argument. PREVIOUS ENTRY: 2026-07-25 (2) — **attachments now PERSIST to the vault** (owner-reported: "I uploaded the document in the cockpit and it didn't register in the knowledge vault… instead of the agent just putting all of it in the prompt"). `runIntake` gained step **8b**, between the refs-only audit and the step-9 conversational merge: a non-dictation attachment is handed to `internal.vault.ingestFromAttachment` so it is embedded + graph-extracted and can ground a LATER turn, instead of being one-shot prompt context that vanishes with the thread. Cause was a phase seam, not a decision — INTK-02 shipped in Phase 2, the vault in Phase 5, and the two ingestion paths were never unified. **The two planes keep their existing contracts:** the vault copy holds the RAW `rawText` (what every other vault doc holds — redacting it would degrade grounding and make the same file store different content depending on entry surface), while the conversation still receives the REDACTED `safeText`, so GRDL-01 is untouched. Step 8b is **FAIL-OPEN** (wrapped in try/catch, error deliberately swallowed): an attachment's first job is answering the question in front of it, so a vault-ingest problem must never become a failed conversation. The fail-CLOSED PII gate stays UPSTREAM at step 6, so scan-failed content can never reach the vault. Dictation is excluded via the existing `isDictation` flag — a voice note IS the request, not a document. Cost note: every attachment now runs an embedding + graph extraction where it previously ran neither; `by_tenant_contentHash` dedup limits repeat cost, not first cost. Verified: `intake.test.ts` 10/10 (5 new — raw-vs-redacted split, one groundable row with `storageId`, dedup, dictation writes nothing, poisoned content writes nothing), full backend 479/480 with only the pre-existing `audit.test.ts` `auditCounts` red, `intake.ts`/`vault.ts` typecheck clean. Spec: `docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md`. Prior: 2026-07-25 — the attach picker's `accept` string (`IntakeControls.tsx`) gained `text/markdown` plus literal extensions (`.txt,.md,.markdown`); a `.md` was previously unselectable, so the intake document path could never be reached with one from the cockpit. No change to `classify()` or any extraction path — `sniffMime` already mapped the `text/` prefix and `sniffExtension` already mapped `md` to the `document` kind, so this only lets the picker offer what intake already handled. Prior: 2026-07-15 against the post-merge `ChatPane.tsx` composer mount
> (`<IntakeControls threadId={threadId} />` renders once `threadId` is minted; disabled
> paperclip/mic placeholders before the first send; the controls reshaped to the composer's
> `icon-btn` idiom — hidden file input triggered by a paperclip button, `MicIcon` dictate
> toggle, `display: contents` wrapper; both `intake.spec.ts` test ids unchanged; web
> typecheck clean. The live human-verify (SC3) is now the SOLE remaining checkpoint — see
> Known gaps below. Prior bless 2026-07-14 against 04-06: extraction 28/28, cost 17/17,
> intake convex-test 5/5, skills drift 13/13, `intake.spec.ts` Playwright-discovered 2/2.)
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
  truthy) LANDED post-merge (2026-07-15) — before the first send the composer shows disabled
  paperclip/mic placeholders whose titles say to send a message first.
  `apps/web/e2e/intake.spec.ts` (Plan 05) drives the controls via their own test ids.

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

- ~~The one-line `ChatPane.tsx` mount~~ **CLOSED 2026-07-15**: the composer now mounts
  `<IntakeControls threadId={threadId} />` once `threadId` is truthy (disabled placeholders
  before the first send). `intake.spec.ts`'s live run is unblocked.
- Live human-verify (real OCR/transcription accuracy + real Gmail delivery reflecting
  attached/dictated content, SC3) remains the sole manual verification (04-06 · T2).
