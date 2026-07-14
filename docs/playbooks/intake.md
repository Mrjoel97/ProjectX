# Playbook: Attachment & Voice-Dictation Intake

> Last verified: 2026-07-14 against fe64bd7
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
- **Backend (thin adapters, land in later Phase-4 plans):** `packages/backend/convex/intake.ts`
  (classify → extract/OCR/transcribe orchestration action), `packages/backend/convex/intakeDb.ts`
  (upload URL + `intakeArtifacts` CRUD), the `intakeArtifacts` table region in
  `packages/backend/convex/schema.ts`, the `attachment-extractor` registry skill
  (`packages/contracts/skills/`, loaded via §5 — no hardcoded prompt).
- **Frontend (lands in later Phase-4 plans):**
  `apps/web/app/(app)/dashboard/workspace/IntakeControls.tsx` (attach/record UI).

## Dependencies & blast radius

Run `graphify query "intake"` for the current subgraph once the backend/frontend files
land. Couplings graphify cannot see: the extraction MODEL call goes to the zero-retention
OpenAI processor (not a general LLM call); `@pikar/pii` `scanText` gates every persisted
result; `@pikar/cost` prices the extraction/transcription call same as any other model call.

## Data flow

1. User attaches a file or records dictation in the cockpit composer (`IntakeControls.tsx`).
2. Bytes upload to Convex storage via an `intakeDb` upload URL; an `intakeArtifacts` row is
   created (`status: pending`, no content yet).
3. `packages/extraction` `classify(bytes, mimeType, filename)` (pure, no Convex/API import)
   decides the path: image/pdf/document → OCR/extract; audio → transcribe; unknown → reject
   conversationally with NO model call.
4. `intake.ts` orchestrates the extraction/transcription model call, then redacts the raw
   output via `@pikar/pii` `scanText` BEFORE anything is persisted or audited.
5. The redacted `safeText` is written to `intakeArtifacts.extracted`; `frameForConversation`
   turns it into a synthetic user turn (attachment: named-file frame; dictation: verbatim
   passthrough) that merges into the cockpit conversation exactly like a typed message.
6. Cost is recorded for the extraction/transcription call (kill-switch respected, same as
   any other model call); audit carries refs/hashes/counts only.

## Invariants — what must never break

1. **Extracted content is REDACTED via `@pikar/pii` `scanText` BEFORE any audit write or
   conversation merge** (CLAUDE.md §4 / GRDL-01). Enforced in the Phase-4 `intake.ts`
   convex-test suite (`SMOKE::extract::` fail-closed + PII-poison cases, 04-04 plan).
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

## How to change safely

- **Changing classification buckets/thresholds:** edit `packages/extraction/src/classify.ts`
  only; add/extend cases in `classify.test.ts` first (TDD). No Convex dependency to worry
  about — this is a pure function.
- **Changing the merge-turn framing:** edit `packages/extraction/src/frame.ts`; keep the
  audio/dictation path a verbatim passthrough (the transcript IS the request, not an
  "attached file").
- **Adding a new intake source (backend/schema/UI):** extend the `intakeArtifacts` schema
  region, `intake.ts`/`intakeDb.ts`, or `IntakeControls.tsx` per the later Phase-4 plans;
  re-run the redact-before-persist invariant check (`SMOKE::extract::` in the backend suite)
  and re-verify no raw bytes/text reach `audit`/`deadLetters`.
- Any change under the watched paths below must bump this playbook's `Last verified` line
  in the same commit/phase (CLAUDE.md §9).

## How to verify

- **Unit (pure):** `pnpm --filter @pikar/extraction test` — classify + frame, offline, <1s.
- **Convex-test (once 04-04 lands):** `pnpm --filter @pikar/backend test -- intake` — upload
  URL + artifact CRUD round-trip, extract→redact→persist, fail-closed redaction, cost
  recording, cockpit merge.
- **E2E (once 04-05 lands):** `pnpm --filter @pikar/web exec playwright test intake` over the
  `SMOKE::` grammar.
- **Manual-only:** delivered-email-reflects-attachment/dictation-content-past-guardrails is a
  live human-verify checkpoint (04-06 · T2) — see `.planning/phases/04-attachment-voice-intake/04-VALIDATION.md`.

## Operational notes

- No new env vars for the pure package. The extraction model call (later plan) reuses the
  existing OpenAI credentials/zero-retention configuration already used by the cockpit LLM
  gateway — no new secret plane.
- `packages/extraction` has zero runtime dependencies beyond `vitest` as a devDependency
  (pure hand-rolled magic-byte sniff — no `file-type` package, per ponytail rung 6/3).

## Known gaps & deferred work

- `packages/backend/convex/intake.ts`, `intakeDb.ts`, the `intakeArtifacts` schema region,
  and `IntakeControls.tsx` do not exist yet as of this plan (04-01) — the watched paths below
  are pre-registered so the §9 Stop hook does not block the plans that create them (04-02
  through 04-06). This playbook's Data-flow/Invariants sections describe the intended
  contract those plans must satisfy.
