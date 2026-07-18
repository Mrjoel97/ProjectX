---
phase: 03.8-vault-document-extraction
verified: 2026-07-18T00:00:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 3.8: Vault Document Extraction Verification Report

**Phase Goal:** A document uploaded to the knowledge vault in a non-text format (PDF, DOCX,
XLSX, PPTX, images, videos) has its text extracted and flows through the existing
`vaultIngestText` seam into embedding/graph ingestion — closing the gap where such uploads sit
at `pending_extraction` forever and never become searchable.
**Verified:** 2026-07-18
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | All four lane branches (PDF/image, Office, sweep+UI, video) are merged to `main` and the merged whole is green | ✓ VERIFIED | `git merge-base --is-ancestor` confirms all six merge/fix commits (3d48d1b, a12dec4, c8db65b, 86e81d6, e7452ab, 88cb902) are ancestors of `main` HEAD. Re-ran suites myself: `pnpm --filter @pikar/vault test` → 42/42 green; `packages/backend` vitest (`--maxWorkers=1`) → 319/320, sole red is the documented pre-existing `audit.test.ts` `auditCounts`-unregistered issue (not a 3.8 regression); `pnpm --filter @pikar/web exec tsc --noEmit` → clean; `npx biome lint` on all touched vault files → clean; `node scripts/check-playbooks.mjs` → exit 0 |
| 2 | A binary vault upload is dispatched by kind (pdf/image/office/transcribe) and produces real extracted text that flows through `ingestExtractedText` into the existing embed→graph workflow — never writing embeddings/graph itself | ✓ VERIFIED | Read `vaultExtract.ts` (244 lines): PDF text-layer-first via `unpdf` (free) with hosted `gpt-4o-mini` OCR fallback (garbage-heuristic-gated, page-capped via `pdf-lib` slicing), image via hosted OCR, office via `@pikar/vault/officeText` subpath. Read `vaultTranscribe.ts` (154 lines): mp4/webm/mpeg/audio via `whisper-1` (demuxes audio track; `gpt-4o-transcribe` was tried and rejected video containers — documented fix). Both call `internal.vault.ingestExtractedText` (vault.ts:460) which patches text/hash/size, flips status to `processing`, and starts `internal.vaultIngest.ingestDoc` — the SAME workflow TXT uploads ride. `vaultUpload` (vault.ts:177) schedules by `extractionKindFor` when `!searchable`. |
| 3 | Honest, visible failure states exist for every governed/unsupported/oversize case — never a silent forever-pending row | ✓ VERIFIED | Code: `.mov`/unsupported container → `markFailed("unsupported_video_container")` (mime-only check, before byte work); kill switch/budget → `preCall` gate returns a RETURN (never a throw) → `markFailed(reason)`; soundless video → whisper decode-error mapped to static `no_audio_track_or_undecodable`; timeout → `transcribe_timeout`; oversize text → `extractionTruncated: true` + calm UI note. `DocGrid.tsx`/`PreviewModal.tsx` render a `failed` badge + human-readable reason + a `Retry` affordance (both card and detail panel) calling `vaultSweep.retryExtraction`. Owner's live sign-off (2026-07-18) independently confirmed the soundless-video honest-failure path and the preview-modal UX live. |
| 4 | Governed spend (kill switch, budget) gates every extraction/transcription call, and audit/dead-letter payloads carry refs/counts only — never raw text | ✓ VERIFIED | Every action opens with `internal.guardrails.preCall`. Hosted OCR calls `priceUsage` → `recordSpend`; transcription calls `priceTranscription` → `recordSpend`. Success audit `vault.extracted` payload is `{vaultDocId, kind, path/durationSeconds, piiCounts/charCount, truncated}` — counts/refs only (needle-scanned by the offline test suites, confirmed passing). `scanText` runs FAIL-CLOSED on extracted output BEFORE any audit write (redact-then-audit ordering, §4). |
| 5 | The pre-existing `pending_extraction` backlog on the main deployment healed via the one-shot governed sweep | ✓ VERIFIED (documented) | `vaultSweep.ts` (`sweepPendingExtraction`, a `@convex-dev/migrations` migration) + `runSweep` exist, tested offline (10/10 in `vaultSweep.test.ts`, re-run green). 03.8-06-SUMMARY.md + STATE.md record the production run against the shared `:3210` deployment: before ~4 `pending_extraction` rows, after 0 (98 ready / 19 mid-flight processing / 10 governed/unsupported failed, all retryable). Per the operational constraint, I did not start/query the live Convex deployment myself; this is accepted on the documented run record, consistent with the code that performs it. |
| 6 | A human watched each of the seven supported formats (text PDF, scanned PDF, image, DOCX, XLSX, PPTX, mp4) walk `pending_extraction → extracting → processing → ready` reactively and found unique content via search; the phase-close blocking checkpoint (03.8-06 Task 2) is satisfied | ✓ VERIFIED | Per the task context, the phase owner performed the live human-verify walk-through on 2026-07-18 and signed off: uploads (PDF/DOCX/XLSX/PPTX/image), video transcription of a real 21 MB mp4 reaching `ready`, honest failure reasons (soundless video), backlog swept to 0, and preview-modal behavior — "Everything is working... I've seen them myself." This satisfies the blocking `checkpoint:human-verify` gate that 03.8-06's Task 2 required before phase close. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/vault/src/extractKind.ts` | classifier + caps consts | ✓ VERIFIED | Exports `extractionKindFor`, `VAULT_EXTRACT_CHAR_CAP`, `VAULT_EXTRACT_PAGE_CAP`, `MIN_CHARS_PER_PAGE`, `TRANSCRIBABLE_CONTAINER_MIME`; 47 lines, on the index barrel; `extractKind.test.ts` 8/8 green |
| `packages/vault/src/officeText.ts` | real DOCX/XLSX/PPTX flatten | ✓ VERIFIED | 96 lines (min 60), real `unzipSync` + regex XML text-walk implementation (not a stub); `officeText.test.ts` 15/15 green; correctly off the index barrel (subpath-only) |
| `packages/backend/convex/vaultExtract.ts` | extractDoc dispatcher: gate + pdf/image/office dispatch + scan + audit + seam | ✓ VERIFIED | 244 lines (min 120); full spine present (preCall → markExtracting → bytes-via-storage → SMOKE sniff → kind dispatch → scanText gate → truncation → audit → seam); `vaultExtract.test.ts` 349 lines, 15/15 green |
| `packages/backend/convex/vaultTranscribe.ts` | transcribeDoc: gate → container check → transcribe → scan → audit → seam | ✓ VERIFIED | 154 lines (min 80); real `whisper-1` transcription (fixed from initial `gpt-4o-transcribe` per playbook history), honest container rejection, 480s timeout; `vaultTranscribe.test.ts` 188 lines, 6/6 green |
| `packages/backend/convex/vaultSweep.ts` | migrations-based backlog sweep + retryExtraction | ✓ VERIFIED | 78 lines (min 40); `sweepPendingExtraction`, `runSweep`, `retryExtraction` all present and wired; `vaultSweep.test.ts` 219 lines, 10/10 green |
| `packages/backend/convex/vault.ts` (seam additions) | vaultUpload hook + markExtracting + ingestExtractedText + getDocForExtraction | ✓ VERIFIED | All four present, schema union carries `"extracting"` + `extractionTruncated` |
| `apps/web/.../vault/DocGrid.tsx`, `PreviewModal.tsx`, `Dropzone.tsx` | extracting pill, failed badge + Retry, truncation note, honest caps copy | ✓ VERIFIED | All five statuses render distinctly (pending/extracting/processing/ready/failed); Retry on card AND panel; failureReason humanized; extractionTruncated note; per-kind cap copy (100 MB docs/images, 25 MB video) matches server enforcement |
| `apps/web/e2e/vault.spec.ts` | EXTR-H tests un-skip-guarded | ✓ VERIFIED | Two `SMOKE::extract::`/`SMOKE::transcribe::` tests present with no skip-guard/stub-branch language; asserts clean `pending → ready` terminal |
| `docs/playbooks/vault.md` | Extraction lifecycle + lane ownership + fix-chain history | ✓ VERIFIED | Extensive, current (`Last verified` reflects the full post-merge fix chain through commit 4980c8d — per-kind caps, whisper-1 model choice, timeout fix, geometry fix, media containment); Known gaps section documents the accepted deferrals (video >25 MB, large-doc memory/time, `vaultGround` call-site) |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `vault.ts` (`vaultUpload`) | `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` | `ctx.scheduler.runAfter(0, ...)` keyed on `extractionKindFor` | ✓ WIRED | Confirmed at vault.ts:177 area |
| `vaultExtract.ts` / `vaultTranscribe.ts` | `internal.vault.ingestExtractedText` | `ctx.runMutation` post scan-gate + truncation | ✓ WIRED | Both call sites confirmed with `truncated` flag threaded through |
| `vaultExtract.ts` | `internal.guardrails.preCall` / `recordSpend` | governed gate before work; spend after hosted call | ✓ WIRED | Confirmed; gate is first statement in the try block |
| `vaultExtract.ts` | `@pikar/vault/officeText` | office dispatch, subpath import | ✓ WIRED | `extractOfficeText` imported and called; throw path converts to `office_parse_failed` |
| `vaultTranscribe.ts` | `experimental_transcribe` (ai@7) + `priceTranscription` (@pikar/cost) | copied intake.ts shape (no cross-`"use node"`-module import) | ✓ WIRED | Confirmed; zero import of `intake.ts`/`llm.ts` |
| `vaultSweep.ts` | `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` | kind-dispatched `scheduler.runAfter` | ✓ WIRED | Confirmed in both `sweepPendingExtraction` and `retryExtraction` |
| `DocGrid.tsx` / `PreviewModal.tsx` | `api.vaultSweep.retryExtraction` | `useMutation` on Retry affordances | ✓ WIRED | Confirmed in both files |
| `ingestExtractedText` | `internal.vaultIngest.ingestDoc` | `workflow.start`, mirrors the existing docId path | ✓ WIRED | Confirmed at vault.ts:460 area — the seam never writes embeddings/graph itself |

### Requirements Coverage

Phase 3.8's requirements (EXTR-A..EXTR-I) are locally derived in `03.8-RESEARCH.md` (ROADMAP.md
explicitly notes "derived in planning" — not sourced from the top-level `.planning/REQUIREMENTS.md`,
which carries no Phase-3.8/EXTR entries; this is expected, not an omission).

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| EXTR-A | 03.8-01 | Binary upload trigger schedules extractDoc/transcribeDoc by kind | ✓ SATISFIED | vault.ts hook + vault.test.ts |
| EXTR-B | 03.8-02 | PDF text-layer-first + hosted fallback | ✓ SATISFIED | vaultExtract.ts + 15/15 tests, live smoke per plan 02 checkpoint |
| EXTR-C | 03.8-03 | Office DOCX/XLSX/PPTX flatten | ✓ SATISFIED | officeText.ts + 15/15 tests |
| EXTR-D | 03.8-02 | Seam + lifecycle (pending→extracting→processing) | ✓ SATISFIED | markExtracting/ingestExtractedText + tests |
| EXTR-E | 03.8-02 | Governed stop + redact-then-audit ordering | ✓ SATISFIED | preCall gate, scanText-before-audit, needle-scanned tests |
| EXTR-F | 03.8-02/04 | Truncation honesty (unit + UI) | ✓ SATISFIED | VAULT_EXTRACT_CHAR_CAP truncation + PreviewModal note |
| EXTR-G | 03.8-04 | Sweep + retry | ✓ SATISFIED | vaultSweep.ts + 10/10 tests + documented production run |
| EXTR-H | 03.8-04/06 | Offline E2E | ✓ SATISFIED | vault.spec.ts, un-skip-guarded, Playwright-discoverable |
| EXTR-I | 03.8-05 | Video/audio transcription + honest container rejection | ✓ SATISFIED | vaultTranscribe.ts + 6/6 tests + fix-chain (whisper-1 model swap) live-verified |

No orphaned requirements found (all nine EXTR items map to a plan and were independently verified above).

### Anti-Patterns Found

None blocking. Scanned `vaultExtract.ts`, `vaultTranscribe.ts`, `vaultSweep.ts`, `officeText.ts`,
`vault.ts` seam additions, and the vault UI components for TODO/FIXME/placeholder markers, empty
handlers, and console.log-only implementations — none found. The only `console.error` present
(`vaultTranscribe.ts`) is a deliberate, refs-safe diagnostic log (API error message, never
transcript text) explicitly called out in the playbook, not a stub marker. Two `ponytail:`
comments mark intentional, documented ceilings (XLSX rich-text `<si>` grouping; no video
duration/chunking cap) with named upgrade paths — this is the mandated discipline, not debt.

### Human Verification Required

None outstanding. The phase's single blocking `checkpoint:human-verify` gate (03.8-06 Task 2 —
the phase-close walk-through of all seven formats plus the honest-failure/truncation/kill-switch
paths) was completed and approved by the phase owner on 2026-07-18, per the task context provided
for this verification.

### Gaps Summary

No gaps. All observable truths, artifacts, and key links verified against the actual codebase
(not just SUMMARY claims) — dispatcher/transcription/office-parser/sweep code was read directly
and is substantive (not a stub), offline test suites were re-run independently (`@pikar/vault`
42/42, backend 319/320 with only the pre-existing documented red, web typecheck clean, biome
clean, check-playbooks clean), and all six merge/fix commits named in the task context are
confirmed ancestors of `main`. The accepted, documented gaps (video >25 MB deferred, large-doc
50–100 MB extraction untested live, `vaultGround` cockpit call-site deferred to a later
integration phase) are explicitly out of this phase's scope per `docs/playbooks/vault.md`'s
"Known gaps" section and the task's operational constraints — they do not block phase-goal
achievement.

One process note (not a goal-achievement gap): `.planning/ROADMAP.md` still shows Phase 3.8's
plan-06 checkbox as `[~]` (Task 2 pending) and `.planning/STATE.md`'s `stopped_at` predates the
owner's sign-off — this is phase-close bookkeeping the orchestrator's `/gsd:phase complete` step
updates, not evidence the goal itself is unmet.

---

_Verified: 2026-07-18_
_Verifier: Claude (gsd-verifier)_
