---
phase: 04-attachment-voice-intake
plan: 04
subsystem: intake
tags: [convex, use-node, pii-redaction, guardrails, cost, cockpit-merge, vitest, convex-test]

# Dependency graph
requires:
  - phase: 04-01 (Extraction Foundation + Intake Playbook)
    provides: "@pikar/extraction classify()/frameForConversation() + the intake.md playbook scaffold"
  - phase: 04-02 (Attachment Extractor Skill)
    provides: "the attachment-extractor registry skill (OCR/vision system prompt)"
  - phase: 04-03 (Intake Schema + Transcription Pricing)
    provides: "intakeArtifacts schema table + priceTranscription per-audio-minute cost helper"
provides:
  - "intakeDb.ts: generateUploadUrl (tenant-scoped) + insertArtifact/patchArtifact/getArtifact (internal) + byThread (tenant-scoped) — the intake content-plane DB adapter"
  - "intake.ts: 'use node' attachToThread/dictateToThread actions — the SC3-ordered classify->extract->redact->cost->audit->persist->merge spine"
  - "intake.test.ts: full offline convex-test coverage over SMOKE:: (extract-redact-persist honeypot, fail-closed redaction-failure audit row, kill-switch gate, dictation verbatim merge)"
affects: [04-05 (IntakeControls.tsx UI wires generateUploadUrl + attachToThread/dictateToThread), 04-06 (phase close + live human-verify)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The merge is a CALL, never an edit: intake.ts reaches the governed cockpit conversation ONLY through the existing public api.cockpit.sendCockpitMessage — zero edits to cockpit.ts/llm.ts, the Lane-B/Lane-A boundary held structurally"
    - "Governed stop = conversational data, never a throw: a preCall kill-switch/budget stop, an unrecognized file kind, and a fail-closed scanText Err all surface as a merged conversational reply via the SAME respond() helper — mirrors runCockpitAgent's blocked-as-data pattern"
    - "SMOKE::transcribe::/SMOKE::extract:: ASCII-prefix short-circuit (mirrors llm.ts/gmail.ts) drives the whole spine offline with zero real API calls"
    - "Poison-sentinel routes into a REAL library's own documented Err branch (scanText's non-string input case) rather than fabricating a fake failure — deterministic, offline, and never a mocked contract"

key-files:
  created:
    - packages/backend/convex/intakeDb.ts
    - packages/backend/convex/intake.ts
    - packages/backend/convex/intake.test.ts
  modified:
    - packages/backend/package.json
    - packages/cost/src/index.ts
    - pnpm-lock.yaml
    - docs/playbooks/intake.md

key-decisions:
  - "intake.ts never trusts a client-declared upload size for the cap check or the persisted intakeArtifacts row — always derives size from the real loaded bytes (Rule 2: a security cap must not trust unverified client input)"
  - "The 'cost recorded / kill-switch respected' Wave-2 row is tested via the kill-switch-blocks-before-extraction path (no artifact row, no spend, a conversational pause) rather than asserting a literal dollar decrement from a SMOKE call — SMOKE paths are explicitly zero-spend by design, so the governance-parity assertion is the correct offline proxy"
  - "The fail-closed scanText Err path is exercised via a PII_POISON:: sentinel that routes into scanText's OWN real non-string-input Err branch (scanText(undefined)) rather than a fabricated mock — the Err path itself is never faked, only deterministically triggered"

patterns-established: []

requirements-completed: [INTK-02, INTK-03]

# Metrics
duration: ~70min
completed: 2026-07-14
---

# Phase 4 Plan 04: Backend Intake Spine Summary

**The SC3 guardrail-ordered intake backbone — classify → extract (bounded GRDL-01 exception) → `scanText` fail-closed redaction → cost → refs-only audit → persist `safeText` → merge via the existing `api.cockpit.sendCockpitMessage`, covered end-to-end offline with zero real API calls.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 completed
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- `intakeDb.ts` — the DB adapter `intake.ts`'s `"use node"` actions reach via `ctx.runQuery`/`ctx.runMutation`: tenant-scoped `generateUploadUrl` (mirrors `requests.ts`), internal `insertArtifact`/`patchArtifact` (drop-undefined patch, mirrors `plans.patchPlan`)/`getArtifact`, and a tenant-scoped `byThread`.
- `intake.ts` — the full SC3-ordered spine. `attachToThread`/`dictateToThread` (`tenantAction`, explicit `Promise<{threadId}>` return types) both call a shared `runIntake`: **1** `guardrails.preCall` gate BEFORE any model call (a stop is a conversational paused reply, never a throw — no artifact row is created past this point) → **2** load bytes + enforce `INTAKE_UPLOAD_CAP_BYTES` on the REAL bytes → **3** `classify` (dictation forces the audio path) → **4** `insertArtifact`(uploaded)→patch(extracting) → **5** the extraction model call (`transcribeAudio`/`extractVisual`/UTF-8 decode/unknown-reject — the bounded GRDL-01 exception; `SMOKE::transcribe::`/`SMOKE::extract::` short-circuit with zero API calls and zero spend) → **6** `scanText` FAIL-CLOSED on the extracted output (Err → `status:"failed"`, no `extracted` write, exactly ONE refs-only `intake.extraction_failed` audit row, no merge) → **7** persist redacted `safeText` → **8** refs/counts-only `intake.extracted` audit → **9** merge via `ctx.runAction(api.cockpit.sendCockpitMessage, {threadId, text: frameForConversation(...)})` — the ONLY call into the governed cockpit pipeline, zero edits to `cockpit.ts`/`llm.ts`.
- `intake.test.ts` — 5 offline convex-test cases (all SMOKE::, zero real API calls) covering every Wave-2 `04-VALIDATION.md` row: the upload-URL+artifact round-trip; extract→redact→persist with the §4 honeypot assertion (no raw email/SSN anywhere in the artifact row or any audit payload); the fail-closed poison path (status=failed, no safeText, exactly one refs-only failure audit row, no merge); the kill-switch/cost governance gate (no artifact, no spend, a conversational pause); and the dictation verbatim-merge contract (the transcript lands in the thread byte-for-byte, no attachment-style wrapper).

## Task Commits

1. **Task 1: intakeDb.ts + seed helper + round-trip test** - `c929128` (feat)
2. **Task 2: intake.ts — the "use node" extraction spine** - `904668b` (feat, includes the Rule-3 `@pikar/cost` export fix + the `@pikar/extraction` dependency addition)
3. **Task 3: full-spine intake.test.ts + docs/playbooks/intake.md bump** - `cb6e244` (test/docs)

_Plan metadata commit follows this summary._

## Files Created/Modified
- `packages/backend/convex/intakeDb.ts` - upload URL + artifact CRUD, tenant-scoped/internal split
- `packages/backend/convex/intake.ts` - the `"use node"` SC3-ordered extraction spine (`attachToThread`/`dictateToThread`)
- `packages/backend/convex/intake.test.ts` - full offline convex-test coverage over SMOKE::
- `packages/backend/package.json` - added `@pikar/extraction` as a dependency (Rule 3 — missing from 04-01's scaffold, needed by `intake.ts`)
- `packages/cost/src/index.ts` - re-exported `priceTranscription`/`TRANSCRIPTION_PRICING` (Rule 3 — 04-03 added them to `cost.ts` but never re-exported from the package's public entry; `cost.test.ts` imports `./cost` directly so the gap went undetected until `intake.ts` imported `@pikar/cost` itself)
- `pnpm-lock.yaml` - lockfile entry for the new `@pikar/extraction` workspace link
- `docs/playbooks/intake.md` - Key files/Data flow/Invariants updated for the finished backend spine (new redaction-failure-audit-row invariant + the merge-is-a-call boundary rule), How-to-verify command, Last verified → 04-04, Known gaps narrowed to just the Plan-05 UI

## Decisions Made
- Never trust a client-declared upload `size` for the security cap or the persisted row — `runIntake` always derives it from the real loaded bytes (`bytes.byteLength`). `attachToThread`'s public args still accept `size` (API-shape parity with the plan's documented signature and the `attachments.ts` precedent) but the handler does not forward it.
- The "cost recorded / kill-switch respected" Wave-2 row is tested via the kill-switch-blocks-before-extraction path rather than asserting a literal `recordSpend` dollar amount — the SMOKE:: extraction paths are explicitly zero-spend by design (mirrors `llm.ts`'s SMOKE contract), so proving the SAME governed gate stops the spine before any artifact/extraction/spend is the correct, deterministic offline proxy for "the extraction path respects the cost guardrail."
- The fail-closed `scanText` Err path is exercised via a `PII_POISON::` sentinel that routes `intake.ts` into calling `scanText(undefined)` — the REAL library's own documented non-string-input Err branch — rather than mocking or forking `@pikar/pii`. This stays inside the Lane-B boundary (no edit to `packages/pii/`) while still testing the actual fail-closed contract, not a fabricated one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@pikar/cost`'s public entry never re-exported `priceTranscription`/`TRANSCRIPTION_PRICING`**
- **Found during:** Task 2 (`intake.ts` typecheck)
- **Issue:** Plan 04-03 added `priceTranscription`/`TRANSCRIPTION_PRICING` to `packages/cost/src/cost.ts` but `packages/cost/src/index.ts` (the package's `"."` export map entry, i.e. what `import ... from "@pikar/cost"` actually resolves to) was never updated. `cost.test.ts` imports directly from `./cost`, so `@pikar/cost`'s own 17/17 suite stayed green and the gap was invisible until `intake.ts` — the first consumer to `import { priceTranscription } from "@pikar/cost"` — failed `tsc` with `TS2305: has no exported member 'priceTranscription'`.
- **Fix:** Added `priceTranscription`/`TRANSCRIPTION_PRICING` to `index.ts`'s existing re-export list. Purely additive — no existing export's signature changed.
- **Files modified:** `packages/cost/src/index.ts`
- **Verification:** `pnpm --filter @pikar/cost test` still 17/17 green; `pnpm --filter @pikar/backend typecheck` no longer reports the error (confirmed via `git stash`/typecheck/`git stash pop` that this was the ONLY typecheck error attributable to my changes).
- **Committed in:** `904668b` (Task 2 commit)

**2. [Rule 3 - Blocking] `@pikar/extraction` was missing from `packages/backend/package.json`'s dependencies**
- **Found during:** Task 2 (`intake.ts` implementation)
- **Issue:** Plan 04-01 scaffolded `@pikar/extraction` but never added it as a `packages/backend` dependency (no consumer existed yet). `intake.ts` is the first backend module to `import ... from "@pikar/extraction"`.
- **Fix:** Added `"@pikar/extraction": "workspace:*"` to `packages/backend/package.json` and ran `pnpm install` to link it.
- **Files modified:** `packages/backend/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @pikar/backend typecheck`/`test` both resolve the import cleanly.
- **Committed in:** `904668b` (Task 2 commit)

**3. [Rule 3 - Blocking, local-only, not a tracked file] `convex/_generated/api.d.ts` had no entries for the new `intake`/`intakeDb` modules**
- **Found during:** Task 2 (typecheck)
- **Issue:** `_generated/` is git-ignored and produced by `npx convex dev`/`convex codegen`, both of which require a configured `CONVEX_DEPLOYMENT` (`npx convex codegen` failed with "No CONVEX_DEPLOYMENT set" — no deployment is configured in this worktree). Without regeneration, `api.intake.attachToThread`/`api.intakeDb.generateUploadUrl` would not typecheck (the runtime `api`/`internal` objects are a fully dynamic `anyApi` proxy and worked immediately at test-time regardless, per `_generated/api.js`; only the STATIC `.d.ts` type map needed the new module entries).
- **Fix:** Hand-added the `intake`/`intakeDb` import + `fullApi` map lines to the LOCAL, git-ignored `convex/_generated/api.d.ts`, in the same alphabetical position codegen would place them. This is a local build-artifact edit only — `git status` confirms it is invisible to any commit (`_generated/` is `.gitignore`d) and does not appear in this plan's diff. A future `npx convex dev`/`codegen` run on a configured deployment will regenerate the identical entries.
- **Files modified:** `packages/backend/convex/_generated/api.d.ts` (git-ignored, not committed)
- **Verification:** `pnpm --filter @pikar/backend typecheck` resolves `api.intake.*`/`api.intakeDb.*` cleanly; `intake.test.ts` runs (convex-test does not depend on this file at all — it only affects `tsc`).
- **Committed in:** N/A — git-ignored, not part of any commit

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking issues required to complete the plan; two are one-line/additive fixes to shared pure-package/config surfaces, one is a local-only generated-artifact edit invisible to git). No scope creep — none touch Lane A's boundary files (`llm.ts`/`cockpit.ts`/`plans.ts`/`gmail.ts`/vault packages), confirmed by `git diff --stat` after every commit.

## Issues Encountered
- The full happy-path test (extract→redact→persist→audit→merge) initially timed out at vitest's default 5000ms under load (it is the only test that runs BOTH nested `ctx.runAction` merge calls to completion AND every follow-up assertion query). Re-running in isolation with a higher timeout confirmed it was genuine query-heavy latency, not a hang — gave that one test a `20000`ms override (`test(..., 20000)`), scoped to `intake.test.ts` only (no shared `vitest.config.mts` edit, staying inside the Lane-B file boundary). Full suite: 5/5 green, ~4–8s depending on load.
- `packages/backend`'s full test suite (`npx vitest run`, no path filter) shows two pre-existing, unrelated red/flaky results confirmed NOT caused by this plan: `audit.test.ts`'s "auditCounts is not registered" (documented as pre-existing since Phase 2 in numerous prior SUMMARY.md files) and `runCockpitAgent.test.ts`'s occasional 5000ms timeout under concurrent CPU load (documented in 04-02's SUMMARY as a known flake under sibling load; passes cleanly when run in isolation, reconfirmed here). Neither touches any file this plan modified.

## User Setup Required

None - no external service configuration required. The extraction model call reuses the existing `OPENAI_API_KEY`/zero-retention configuration already used by the cockpit LLM gateway (no new secret).

## Next Phase Readiness
- `intakeDb.generateUploadUrl` + `intake.attachToThread`/`intake.dictateToThread` are ready for Plan 05's `IntakeControls.tsx` (attach/record UI) to wire directly — the upload-then-call contract matches `requests.ts`'s existing attachment precedent.
- `docs/playbooks/intake.md` §9 discipline is current (`Last verified: 04-04`); `node scripts/check-playbooks.mjs` exits clean.
- The live human-verify checkpoint (04-06 · T2 — real OCR/transcription accuracy + real Gmail delivery reflecting attached/dictated content) remains the sole manual verification per `04-VALIDATION.md`; nothing in this plan blocks it.
- No blockers for Plan 05.

---
*Phase: 04-attachment-voice-intake*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 7 claimed files verified present on disk (`intakeDb.ts`, `intake.ts`, `intake.test.ts`,
`packages/backend/package.json`, `packages/cost/src/index.ts`, `docs/playbooks/intake.md`, this
SUMMARY.md); all 3 task commits (`c929128`, `904668b`, `cb6e244`) verified present in git history.
