---
phase: 04-attachment-voice-intake
plan: 05
subsystem: ui
tags: [react, nextjs, convex, mediarecorder, playwright, e2e, a11y]

# Dependency graph
requires:
  - phase: 04-04 (Backend Intake Spine)
    provides: "intakeDb.generateUploadUrl + intake.attachToThread/dictateToThread (the SC3-ordered classify->extract->redact->cost->audit->persist->merge spine)"
provides:
  - "IntakeControls.tsx: a fully self-contained attach picker + one-shot MediaRecorder dictation component (threadId prop), wired through generateUploadUrl -> POST -> intake.attachToThread/dictateToThread"
  - "A headless-safe dictation test seam (data-testid=\"dictation-test-input\") that drives the same upload path a real recording's onstop handler takes, since a headless Playwright run cannot grant a real microphone"
  - "apps/web/e2e/intake.spec.ts: Playwright E2E over SMOKE::extract::/SMOKE::transcribe:: sentinels, Playwright-discovered + type-loaded"
affects: [04-06 (phase close: Lane A mounts IntakeControls into ChatPane.tsx, then the live human-verify + live E2E run)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Headless-safe dictation test seam: a hidden `<input type=\"file\" data-testid=\"dictation-test-input\">` drives the EXACT SAME upload -> dictateToThread call a real MediaRecorder onstop handler makes, letting Playwright inject a SMOKE::transcribe:: blob without ever needing a real/faked microphone"
    - "Client-side security-cap mirroring: IntakeControls hardcodes a client-side copy of intake.ts's INTAKE_UPLOAD_CAP_BYTES (that module is \"use node\", server-only, not importable into a client bundle) — UX-only, the server always re-derives the authoritative cap from real bytes"

key-files:
  created:
    - apps/web/app/(app)/dashboard/workspace/IntakeControls.tsx
    - apps/web/e2e/intake.spec.ts
  modified:
    - docs/playbooks/intake.md

key-decisions:
  - "IntakeControls takes threadId: string (required, not optional) per the plan's documented interface — Lane A must mount it only once threadId is truthy (the same guard ChatPane.tsx already applies to its own Gmail-connected branch), not unconditionally at every render"
  - "The dictation-test seam is a real, hidden <input type=\"file\"> rather than a page.evaluate/mock-getUserMedia approach — Playwright's setInputFiles works on non-visible inputs, keeping the REAL merge spine (upload -> dictateToThread -> sendCockpitMessage) in the loop with zero real API cost, exactly as 04-VALIDATION.md's E2E row requires"
  - "Attach/record/dictation-test controls are mutually exclusive while any one is in flight (`busy || recording` gates all three) to hold the single-double-submit guard the plan required"

patterns-established: []

requirements-completed: [INTK-02, INTK-03]

# Metrics
duration: ~35min
completed: 2026-07-14
---

# Phase 4 Plan 05: Intake UI (IntakeControls.tsx + Playwright E2E) Summary

**A self-contained cockpit-composer control — attach-file picker + one-shot MediaRecorder dictation button — wired through `generateUploadUrl` → POST → `intake.attachToThread`/`dictateToThread`, covered by a headless-safe Playwright E2E over the `SMOKE::extract::`/`SMOKE::transcribe::` sentinels.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `IntakeControls.tsx` — `IntakeControls({ threadId }: { threadId: string })`: a visible, labeled `<input type="file" accept="image/*,application/pdf,audio/*,text/plain">` (attach) and a labeled record/stop `<button>` (one-shot `MediaRecorder`: `getUserMedia({audio:true})` → `start()` → user click → `stop()` → assemble `Blob` → upload → `dictateToThread`). Both paths share a `upload()` helper (`generateUploadUrl` mutation → `fetch(url, {method:"POST", ...})` → `{storageId}` → the matching intake action). A client-side `INTAKE_UPLOAD_CAP_BYTES` mirror (20 MiB, commented as a mirror of `intake.ts`'s server-authoritative constant) rejects oversize files/recordings before any upload. `getUserMedia` denial surfaces an inline message ("Microphone access was denied…") — never a crash. A `busy || recording` guard disables every control during any in-flight operation (no double-submit). Accessible labels: `aria-label` on the file input and the record button (`"Record dictation"` / `"Stop recording"` + `aria-pressed`), plus a non-color-only `"Recording…"`/`"Extracting…"` text indicator. A hidden `data-testid="dictation-test-input"` file input drives the identical upload → `dictateToThread` path a real recording's `onstop` takes — the headless-safe seam Task 2's E2E needs since Playwright cannot grant a real microphone.
- `apps/web/e2e/intake.spec.ts` — two Playwright tests: (1) attach a `SMOKE::extract::<text>` blob via `attach-file-input`, assert the extracted/redacted text appears as a new turn in the `chat-pane`; (2) upload a `SMOKE::transcribe::<text>` blob via the hidden `dictation-test-input`, assert the transcript enters the conversation verbatim. Both are Playwright-discovered (`playwright test intake --list` shows both, confirmed) and type-load cleanly; the LIVE run is deferred to Plan 06 (the Lane A `ChatPane.tsx` mount is a prerequisite for the component to actually render on `/dashboard/workspace`), matching the exact precedent `cockpit-resolve.spec.ts`/`cockpit-report.spec.ts`/`cockpit-attachment.spec.ts` all set (shipped Playwright-discovered ahead of their live runs).
- `docs/playbooks/intake.md` — `Last verified` bumped to 04-05; the Frontend key-files entry (previously a "does not exist yet" placeholder) now documents the shipped component and its contract; Data flow / How-to-verify updated for the real attach+dictate UI and `intake.spec.ts`; Known gaps narrowed to the pending Lane A mount + the 04-06 live human-verify.

## Task Commits

1. **Task 1: IntakeControls.tsx — attach picker + one-shot dictation** - `fc50409` (feat)
2. **Task 2: intake.spec.ts — Playwright E2E over SMOKE:: sentinels** - `6c6f928` (test)
3. **Docs: intake.md playbook bump** - `4b688b6` (docs)

_Plan metadata commit follows this summary._

## Files Created/Modified
- `apps/web/app/(app)/dashboard/workspace/IntakeControls.tsx` - self-contained attach + one-shot dictation component
- `apps/web/e2e/intake.spec.ts` - Playwright E2E over SMOKE:: sentinels (attach + dictate)
- `docs/playbooks/intake.md` - Last verified -> 04-05; frontend section filled in; known gaps narrowed

## Decisions Made
- `threadId: string` (required, not optional) on `IntakeControls`'s props, matching the plan's documented interface literally — this means Lane A's one-line mount must guard on `threadId` being truthy (the exact same pattern `page.tsx` already uses for `ChatPane`'s Gmail-connected branch), not render `IntakeControls` unconditionally. Recorded as the cross-lane contract below.
- The dictation E2E path uses a real hidden `<input type="file">` test seam rather than mocking `getUserMedia`/`MediaRecorder` — Playwright's `setInputFiles` works on non-visible inputs without needing a fake-device flag or browser-launch-arg changes, and it exercises the exact same code path (`upload()` → `dictateToThread`) a real recording's `onstop` handler calls, keeping the REAL merge spine in the loop with zero real API cost.
- `INTAKE_UPLOAD_CAP_BYTES` is hardcoded client-side (not imported from `intake.ts`) because `intake.ts` is a `"use node"` Convex action module (server-only AI-SDK/Node imports) — pulling it into the Next.js client bundle would be a bundling hazard, not merely a Lane boundary issue. A comment ties the two constants together so a future change to one is easy to spot as needing the other.

## Deviations from Plan

None - plan executed as written. The plan explicitly anticipated and specified the two judgment calls above (the `threadId: string` prop shape and the "prefer keeping the real merge spine in the loop" E2E guidance for the dictation path); both were followed directly rather than deviating.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. Reuses the existing Convex deployment / OpenAI zero-retention configuration already wired by Plan 04.

## Cross-Lane Note (for Lane A)

`IntakeControls.tsx` ships fully self-contained. The single integration line Lane A owns, inside `ChatPane.tsx`'s composer (near the existing `<AttachmentPicker .../>` line), guarded on `threadId` being defined (mirrors `page.tsx`'s existing `status.connected ? <ChatPane .../> : ...` guard style):

```tsx
import { IntakeControls } from "./IntakeControls";
// ...
{threadId && <IntakeControls threadId={threadId} />}
```

`IntakeControls` takes `threadId: string` (required) — it must not be rendered before the first `sendCockpitMessage` mints a thread id. Once this mount lands, `apps/web/e2e/intake.spec.ts`'s two tests are ready to go live (Plan 06), following the same precedent `cockpit-resolve.spec.ts`/`cockpit-report.spec.ts`/`cockpit-attachment.spec.ts` set for their own live-run deferrals.

## Next Phase Readiness
- `IntakeControls.tsx` is complete, typechecked, and self-contained; `intake.spec.ts` is Playwright-discovered (2/2 tests listed) and type-loads cleanly.
- Plan 06 (phase close) needs: (1) Lane A's one-line `ChatPane.tsx` mount (see Cross-Lane Note above), (2) the live E2E run once that mount lands, and (3) the SC3 live human-verify checkpoint (real attach/dictate → delivered email reflects the content, per `04-VALIDATION.md`).
- No blockers for Plan 06 beyond the Lane A mount itself.

---
*Phase: 04-attachment-voice-intake*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 3 claimed files verified present on disk (`IntakeControls.tsx`, `intake.spec.ts`,
`docs/playbooks/intake.md`); all 3 commits (`fc50409`, `6c6f928`, `4b688b6`) verified present
in git history; `pnpm --filter @pikar/web typecheck` green; `playwright test intake --list`
shows both `intake.spec.ts` tests.
