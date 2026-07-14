---
phase: 04-attachment-voice-intake
verified: 2026-07-14T22:00:00Z
status: passed
score: 7/7 must-haves verified (code-complete); SC3 live human-verify deferred by design
deferred_human_verification:
  - item: "SC3 — live attachment + live dictation → delivered email reflects the content, past PII/cost/review guardrails"
    reason: "Requires a live backend (OPENAI_API_KEY, seeded skills, Gmail connected) AND the Lane A ChatPane.tsx mount of <IntakeControls threadId={threadId}/> — a cross-lane prerequisite Lane B correctly did not cross. This is 04-06-PLAN.md's Task 2, a blocking human-verify checkpoint explicitly PAUSED (not skipped) per 04-06-SUMMARY.md."
    machinery_verified: "The redact→cost→audit→merge ordering (runIntake in intake.ts), the fail-closed scanText path with its refs-only audit row, the guardrail preCall gate, and the sendCockpitMessage merge seam are all present, wired, and covered by 5 green offline convex-test cases (intake.test.ts) including a raw-PII honeypot assertion. Only the REAL OCR/transcription accuracy and REAL Gmail delivery over the live backend remain unexercised."
---

# Phase 4: Attachment & Voice-Dictation Intake Verification Report

**Phase Goal:** Users can enrich requests with files (image/PDF/audio/document → classify → OCR/extract/transcribe → merge into request context) AND dictate requests by voice (record → transcribe → same governed pipeline). Both flow through the SAME governed route→draft→review→deliver pipeline, subject to the SAME PII/cost/review guardrails.
**Verified:** 2026-07-14
**Status:** passed (code-complete; SC3 live human-verify deferred by design — see below)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `classify()` buckets image/pdf/audio/document/unknown from magic bytes + mime + extension, MediaRecorder webm/matroska included | VERIFIED | `packages/extraction/src/classify.ts` — magic-bytes→mime→extension trust order; 22 tests in `classify.test.ts`, all green (28/28 package total incl. frame) |
| 2 | `frameForConversation()` produces the attachment merge turn; dictation passes through verbatim | VERIFIED | `packages/extraction/src/frame.ts` — audio branch returns `safeText` unwrapped; attachment branches wrap with a named-file frame; 6 tests green |
| 3 | `attachment-extractor` is a versioned, active registry skill (no hardcoded prompt) | VERIFIED | `packages/contracts/skills/attachment-extractor.md` + byte-identical `attachmentExtractorSkillBody`; `seedSkills` row in `skills.ts`; drift test green (`skills.test.ts` 13/13) |
| 4 | `intakeArtifacts` table exists, thread-scoped, `extracted` holds redacted safeText only; transcription is priceable per audio-minute, fail-closed | VERIFIED | `schema.ts:261` `intakeArtifacts` w/ `by_thread` index; `packages/cost/src/cost.ts` `TRANSCRIPTION_PRICING`/`priceTranscription` (re-exported from `index.ts`); `cost.test.ts` 17/17 green |
| 5 | Backend spine: classify→extract→redact(fail-closed)→cost→audit(counts-only)→persist safeText→merge via `sendCockpitMessage` | VERIFIED | `packages/backend/convex/intake.ts` `runIntake` implements the exact 9-step SC3 ordering; `intake.test.ts` 5/5 green incl. a raw-PII honeypot assertion (no raw email/SSN in artifact row or any audit payload) and the fail-closed poison path (exactly ONE refs-only `intake.extraction_failed` audit row) |
| 6 | Dictation transcript merges verbatim as a request turn, not wrapped as an attachment | VERIFIED | `intake.test.ts` "dictateToThread…merges verbatim" test: `artifacts[0].extracted === TRANSCRIPT`; merged message `text === TRANSCRIPT`; no "attached file" substring |
| 7 | User-facing UI: attach picker + one-shot MediaRecorder dictation, wired through `generateUploadUrl`→POST→intake actions; self-contained (no ChatPane edit) | VERIFIED | `IntakeControls.tsx` (both controls implemented, accessible labels, busy-guard, cap-guard, mic-denial handling); `ChatPane.tsx` grep-confirmed untouched by any Phase-4 commit; `intake.spec.ts` Playwright-discovered (2/2 tests listed) |
| SC3 | A delivered result reflects attachment/dictation content, past guardrails | **DEFERRED (by design)** | Machinery fully verified in code (see truth 5/6); the LIVE end-to-end run requires the Lane A `ChatPane.tsx` mount + a live backend — explicitly out of Lane B's scope per `PARALLELIZATION.md`. `04-06-PLAN.md` Task 2 is a blocking human-verify checkpoint the executor PAUSED at (`04-06-SUMMARY.md`), not skipped. |

**Score:** 7/7 code-verifiable truths verified; 1 (SC3) is a documented, deliberately deferred live-verify gate — not a code gap.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/extraction/src/classify.ts` | pure classifier, no Convex/API import | VERIFIED | 87 lines; magic-byte sniff + mime + extension; grep-clean of Convex/AI/OpenAI imports |
| `packages/extraction/src/frame.ts` | synthetic user-turn framer | VERIFIED | 19 lines; audio verbatim, attachment wrapped |
| `packages/extraction/src/index.ts` | public exports | VERIFIED | re-exports classify + frame |
| `docs/playbooks/intake.md` | §9 playbook, Lane B surface | VERIFIED | Purpose/Key files/Data flow/7 Invariants/How-to-change/How-to-verify/Known gaps; Last verified → 04-06 |
| `docs/playbooks/watch.json` | intake.md prefix registration | VERIFIED | `packages/extraction/`, `convex/intake.ts`, `convex/intakeDb.ts`, `IntakeControls.tsx` all registered |
| `packages/contracts/skills/attachment-extractor.md` | canonical OCR/extraction prompt | VERIFIED | "Extract ALL of it VERBATIM" contract present |
| `packages/backend/convex/schema.ts` (`intakeArtifacts`) | thread-scoped table | VERIFIED | `by_thread` index on `[tenantId, threadId]`; `extracted` documented redacted-only |
| `packages/cost/src/cost.ts` (`priceTranscription`) | per-minute transcription pricing | VERIFIED | `Result`-typed, fail-closed, `ceil(seconds/60)` billing; re-exported from `@pikar/cost` index |
| `packages/backend/convex/intakeDb.ts` | upload URL + artifact CRUD | VERIFIED | `generateUploadUrl` (tenantMutation), `insertArtifact`/`patchArtifact`/`getArtifact` (internal), `byThread` (tenantQuery) |
| `packages/backend/convex/intake.ts` | `"use node"` actions: attachToThread/dictateToThread | VERIFIED | Both `tenantAction`s with explicit `Promise<{threadId}>` returns; imports nothing from `cockpit.ts`/`llm.ts` internals (grep-verified) |
| `packages/backend/convex/intake.test.ts` | full-spine convex-test coverage | VERIFIED | 5 tests, all green, incl. honeypot + fail-closed + kill-switch + verbatim-dictation assertions |
| `apps/web/.../IntakeControls.tsx` | attach + one-shot dictation UI | VERIFIED | 202 lines; `attach-file-input` + record button + hidden `dictation-test-input` headless seam |
| `apps/web/e2e/intake.spec.ts` | Playwright E2E over SMOKE:: | VERIFIED | 2 tests, Playwright-discovered (`playwright test intake --list` shows both) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `classify.ts` | leading bytes + mimeType + filename | pure sniff, bytes-win-on-disagree | WIRED | Trust order enforced: `sniffBytes` checked before `sniffMime`/`sniffExtension` |
| `intake.ts` | `scanText` (@pikar/pii) | redact extracted text before audit + merge | WIRED | Step 6 of `runIntake`; fail-closed branch writes NO safeText and stops before merge |
| `intake.ts` | `api.cockpit.sendCockpitMessage` | `ctx.runAction` + `frameForConversation` | WIRED | Step 9; sole merge/reply channel, also used for governed-stop replies |
| `intake.ts` | `guardrails.recordSpend` | `priceUsage`(vision)/`priceTranscription`(audio) | WIRED | Both `transcribeAudio` and `extractVisual` price-then-record on success |
| `intake.ts` | `intakeArtifacts.extracted` | `insertArtifact`/`patchArtifact` via `ctx.runMutation` | WIRED | Status transitions uploaded→extracting→extracted/failed; `extracted` set only with redacted safeText |
| `IntakeControls.tsx` | `generateUploadUrl`→POST→`attachToThread`/`dictateToThread` | `useAction`/`useMutation` + `fetch` | WIRED | `upload()` helper shared by both attach and dictate paths |
| `watch.json` | `packages/extraction/` | intake.md watched-prefix entry | WIRED | Confirmed present alongside the other 3 Lane-B prefixes |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| INTK-02 | 04-01, 04-02, 04-03, 04-04, 04-05, 04-06 | Attachments classified + OCR'd/extracted/transcribed, merged into request context | SATISFIED (code); live SC3 deferred | classify→extract→redact→cost→audit→persist→merge spine fully implemented and offline-tested; UI wired |
| INTK-03 | 04-01, 04-03, 04-04, 04-05, 04-06 | Voice dictation (record→transcribe→same pipeline) | SATISFIED (code); live SC3 deferred | `dictateToThread` forces audio path, transcript merges verbatim; UI record/stop wired; MediaRecorder webm classifies audio |

No orphaned requirements: every plan's `requirements:` field is INTK-02 and/or INTK-03, matching the phase's declared requirement IDs exactly. `REQUIREMENTS.md`'s Traceability table already shows INTK-02/INTK-03 mapped to Phase 4 as "Complete" and the checkboxes `[x]`'d — this is ahead of `ROADMAP.md`/`STATE.md`, which correctly still show Phase 4 as in-progress (`04-06-PLAN.md` unchecked, "5/6 plans executed", `STATE.md` stopped_at = paused at the Task-2 checkpoint). This is a pre-existing/expected discrepancy given the explicit decision to land Phase 4 code-complete with SC3's live gate deferred; it does not reflect a code gap.

### Anti-Patterns Found

None. Grep for `TODO|FIXME|XXX|HACK|PLACEHOLDER|placeholder|coming soon` across `packages/extraction/src`, `packages/backend/convex/intake.ts`, and `IntakeControls.tsx` returned zero matches. No stub returns (`return null`/`return {}`/empty handlers) found in any shipped Phase-4 file.

### Offline Verification Suite Results

| Command | Result |
|---------|--------|
| `pnpm --filter @pikar/extraction test` | **28/28 green** (classify 22 + frame 6) |
| `pnpm --filter @pikar/cost test` | **17/17 green** (incl. `priceTranscription`) |
| `cd packages/backend && npx vitest run convex/intake.test.ts convex/skills.test.ts` | **18/18 green** (intake 5 + skills 13) |
| `pnpm --filter @pikar/web typecheck` | **clean, zero errors** |
| `node scripts/check-playbooks.mjs` | **exit 0** |
| `pnpm --filter @pikar/web exec playwright test intake --list` | Both `intake.spec.ts` tests discovered (`attach a file -> classified content appears in the conversation (INTK-02)`, `dictate -> transcript enters as a request turn (INTK-03, one-shot)`). Note: this Playwright config lists ALL 11 tests across 8 spec files regardless of the `intake` filter argument — a pre-existing quirk of this repo's project-dependency config (`chromium` depends on `setup`), not something Phase 4 introduced; the required 2 intake tests ARE present and confirmed. |
| `npx vitest run convex/audit.test.ts` (control check) | **1 failed**, confirmed as the documented-since-Phase-2 pre-existing red (`auditCounts` component not registered in that specific test file) — unrelated to any Phase-4 file, not a regression |

### Lane B Boundary Check

`git log` over `packages/backend/convex/llm.ts`, `cockpit.ts`, `plans.ts`, and `gmail.ts` shows zero Phase-4 (Lane B) commits touching any of them. `ChatPane.tsx` has no `IntakeControls` reference and no Phase-4 commit in its history — the Lane A mount genuinely has not landed, exactly as documented. The one adjacent docs touch — `docs/playbooks/cockpit.md`'s `Last verified` bump in commit `eb7b3a5` — is confirmed via `git show --stat` to be a single-line docs-only change (no code), triggered by `watch.json`'s broad directory-prefix coverage of `apps/web/app/(app)/dashboard/workspace/` catching the new sibling files `IntakeControls.tsx`/`intake.spec.ts`. This is the expected, acceptable cross-lane playbook-hygiene touch, not a code boundary violation. No vault package (`packages/vault` or similar) exists yet and none was touched.

### Human Verification Required (Deferred by Design)

#### 1. SC3 — Live attachment + dictation → delivered email reflects the content, past guardrails

**Test:** On a live backend (this worktree's `npx convex dev` + `pnpm dev`, `OPENAI_API_KEY` set, `attachment-extractor`/`cockpit-agent` skills seeded, Gmail connected) with the Lane A `ChatPane.tsx` mount of `<IntakeControls threadId={threadId} />` in place: (1) attach a real PDF and a real image, confirm each is classified and its content is summarized/extracted into the conversation; (2) record and dictate a request, stop, confirm the transcript enters as a request turn; (3) let the agent propose a plan, click Approve once, confirm the delivered email's content reflects the attached/dictated content and the audit trail carries refs/counts only; (4) confirm nothing was sent before Approve, cost moved, and a poison/PII input is redacted in the delivered content.
**Expected:** All four checks pass on the live backend, mirroring the Phase 3.3 CKPT-02 precedent.
**Why human/deferred:** Real OCR/transcription accuracy and real Gmail delivery cannot be exercised by the offline `SMOKE::` suite. This is `04-06-PLAN.md`'s Task 2, a blocking checkpoint the executing agent correctly PAUSED at (per `04-06-SUMMARY.md`) rather than fabricating a result for, because it additionally requires the Lane A `ChatPane.tsx` mount — a cross-lane prerequisite outside Lane B's file scope. The code machinery this live-verify exercises (redact→cost→audit→merge ordering, the fail-closed audit row, the guardrail gate, the merge seam) is already fully verified in code above (offline convex-test, 5/5 green, including a raw-PII honeypot assertion).

### Gaps Summary

No code gaps found. All 12 must-have artifacts across the six 04-0X plans exist, are substantive (no stubs/placeholders), and are wired correctly — confirmed by direct code reading and by a 63/63 green offline test run across `@pikar/extraction` (28), `@pikar/cost` (17), and the targeted backend intake+skills suite (18), plus a clean web typecheck, a clean `check-playbooks.mjs`, and Playwright-discovered E2E specs. The only open item is SC3's live human-verify, which is explicitly and correctly deferred pending the Lane A `ChatPane.tsx` mount — a cross-lane prerequisite this phase's plan (`04-06-PLAN.md`) anticipated and gated on rather than skipped or fabricated. Phase 4 is code-complete.

---
*Verified: 2026-07-14*
*Verifier: Claude (gsd-verifier)*
