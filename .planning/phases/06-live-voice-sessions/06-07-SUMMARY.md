---
phase: 06-live-voice-sessions
plan: 07
subsystem: ui
tags: [voice, react, nextjs, convex, cockpit, vault, e2e, playwright, a11y]

# Dependency graph
requires:
  - phase: 06-live-voice-sessions (05)
    provides: voice.ts session engine — endSessionClean/storeBrief/persistBrief, the vault brief ingest
  - phase: 06-live-voice-sessions (06)
    provides: /dashboard/voice phase machine + useVoiceSession hook (the "ended" post-call seam)
  - phase: 03.x cockpit
    provides: sendCockpitMessage → PLAN card + single-Approve pipeline (reused entirely for the handoff)
  - phase: 05 vault
    provides: vault.listVaultDocs (the banner's brief read) + vaultIngest (brief indexing)
provides:
  - Post-call surface (PostCall.tsx) — clean-end brief review/edit + store + "Turn this into a plan?" ask
  - AbnormalBriefBanner — next-app-open surfacing of a dropped-session auto-stored brief
  - Brief→plan handoff routed through the EXISTING cockpit gate (no new pipeline, no new gate)
  - Offline post-call e2e (voice.spec.ts) + smoke:seedVoiceBrief seeder
affects: [phase 06 plan 08 (live human-verify), voice, cockpit, vault]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Both end types converge on ONE stored brief + ONE review→convert surface (identical render path)"
    - "Client-side seen-set (localStorage) distinguishes reviewed (clean) from unreviewed (dropped) briefs — no new backend"
    - "URL ?thread= pickup via window.location in useEffect (connect-gmail precedent, no useSearchParams Suspense)"

key-files:
  created:
    - apps/web/app/(app)/dashboard/voice/PostCall.tsx
    - apps/web/app/(app)/dashboard/voice/AbnormalBriefBanner.tsx
    - apps/web/e2e/voice.spec.ts
  modified:
    - apps/web/app/(app)/dashboard/voice/page.tsx
    - apps/web/app/(app)/dashboard/workspace/page.tsx
    - apps/web/app/(app)/layout.tsx
    - packages/backend/convex/voice.ts
    - packages/backend/convex/smoke.ts
    - docs/playbooks/voice.md
    - docs/playbooks/watch.json
    - docs/playbooks/cockpit.md

key-decisions:
  - "Reuse cockpit sendCockpitMessage entirely for the brief→plan handoff — the brief's Decisions/Action items become the opening user turn, landing at the existing single Approve (VOIC-04 by construction)"
  - "Clean-end brief composed client-side from the transcript (no model call) per plan-05's endSessionClean contract; the structured draftVoiceBrief model path stays the server abnormal-end story"
  - "The dropped-session banner surfaces ONLY unreviewed briefs — PostCall marks a just-reviewed clean brief seen (via the vaultDocId endSessionClean now returns); the seen-set lives in localStorage (no new backend query, honoring the plan's constraint)"

patterns-established:
  - "Post-call convergence: PostCall renders whatever ended on-page (clean OR on-page abnormal); the app-wide banner catches sessions dropped on a closed tab"
  - "Offline voice e2e seeds a stored brief (smoke:seedVoiceBrief) and drives the deterministic banner→handoff→no-send half; the live round-trip is the plan-08 human-verify"

requirements-completed: [VOIC-03, VOIC-04]

# Metrics
duration: 15min
completed: 2026-07-20
---

# Phase 6 Plan 7: Post-Call Brief Review + Plan Handoff Summary

**The load-bearing post-call surface: review/edit the voice brief and store it (clean end), convert it into a plan through the EXISTING cockpit single-Approve gate (VOIC-04), and surface a dropped-session's auto-stored brief on next app open — both end types converging on one review-and-convert path.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-20T00:02:58Z
- **Completed:** 2026-07-20T00:17:17Z
- **Tasks:** 3
- **Files modified:** 12 (3 created, 9 modified)

## Accomplishments
- **PostCall.tsx** — a clean-end brief (composed client-side from the transcript, no model call) in an editable, keyboard + screen-reader-complete textarea; "Just save" stores it to the vault; "Turn this into a plan?" stores it then seeds a cockpit thread and navigates to the existing PLAN card + single Approve.
- **AbnormalBriefBanner** — mounted app-wide beside ReconnectBanner; on next app open it surfaces the newest auto-stored voice brief the user has NOT yet reviewed (client-side seen-set), reusing `vault.listVaultDocs` with no new backend, and offers the same "Turn into a plan" conversion.
- **Handoff reuses the cockpit pipeline entirely** — the brief's Decisions + Action items become the opening `sendCockpitMessage` turn; `/dashboard/workspace?thread=<id>` re-opens exactly that thread at the unchanged single-Approve gate. No new plan pipeline, no new gate.
- **Offline e2e + seeder** — `smoke:seedVoiceBrief` (validated against the live dev deployment) seeds a stored dropped-session brief; `voice.spec.ts` drives banner→handoff→"nothing sent before Approve".

## Task Commits

1. **Task 1: Post-call brief review/edit + store + plan-vs-save ask** — `acab5e1` (feat)
2. **Task 2: Plan handoff wiring + dropped-session brief banner** — `02b56ff` (feat)
3. **Task 3: Offline e2e + seedVoiceBrief + playbook bump** — `e532d9b` (test)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `apps/web/app/(app)/dashboard/voice/PostCall.tsx` — brief review/edit + store + VOIC-04 ask (created)
- `apps/web/app/(app)/dashboard/voice/AbnormalBriefBanner.tsx` — dropped-brief surfacing + seen-set helpers (created)
- `apps/web/e2e/voice.spec.ts` — offline post-call e2e (created)
- `apps/web/app/(app)/dashboard/voice/page.tsx` — route the ended phase to PostCall
- `apps/web/app/(app)/dashboard/workspace/page.tsx` — open ?thread=<id> at the Approve gate
- `apps/web/app/(app)/layout.tsx` — mount AbnormalBriefBanner app-wide
- `packages/backend/convex/voice.ts` — endSessionClean persists the reviewed brief after the end-CAS + returns vaultDocId
- `packages/backend/convex/smoke.ts` — seedVoiceBrief internalMutation (e2e fixture)
- `docs/playbooks/voice.md` — post-call surface + convergence/store/banner invariants + e2e; verified line → 06-07
- `docs/playbooks/watch.json` — voice.md owns apps/web/e2e/voice.spec.ts
- `docs/playbooks/cockpit.md` — verified-line bump (voice spec under its broad e2e watch; no cockpit change)

## Decisions Made
- **Handoff reuses `sendCockpitMessage` entirely** — the plan's mandated reuse; a voice brief crosses the SAME human Approve as every other plan.
- **Clean-end brief is client-composed (no model call)** — matches plan-05's explicit `endSessionClean` contract ("the client already composed the markdown"); the structured `draftVoiceBrief` model path remains the server abnormal-end story.
- **"Unreviewed" is a localStorage seen-set** — the plan forbids a new backend query for the banner; a clean brief is marked seen the instant PostCall stores it (via the `vaultDocId` `endSessionClean` now returns), so only auto-stored dropped briefs surface. Losing the seen-set degrades to re-surfacing, never to losing a brief.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] endSessionClean dropped the reviewed brief when the end-CAS had already flipped**
- **Found during:** Task 1 (post-call store path)
- **Issue:** `useVoiceSession.end()` calls `endSessionClean({sessionId})` (no markdown) to flip `ended_clean` + cancel the watchdog the moment the user ends. PostCall then calls `endSessionClean({sessionId, editedMarkdown})` to store the reviewed brief — but the original guard `if (!ended) return {alreadyEnded}` short-circuited BEFORE `persistBrief`, so the reviewed brief was never stored (the clean-end store was silently a no-op).
- **Fix:** Moved `persistBrief` out of the CAS gate — it now runs whenever `editedMarkdown` is present, regardless of the `markEndedClean` result. `persistBrief` is already idempotent on `briefRef`, so a race with the watchdog's auto-store never double-writes; a bare end (no markdown) keeps the original no-op (the existing "clean end after abnormal" test still passes).
- **Files modified:** packages/backend/convex/voice.ts
- **Verification:** `pnpm --filter @pikar/backend test voice` — 15/15 green (the clean-end + clean-after-abnormal return-shape assertions intact).
- **Committed in:** acab5e1 (Task 1 commit)

**2. [Rule 3 - Blocking] No client-visible signal to distinguish reviewed vs unreviewed briefs / no e2e seeder**
- **Found during:** Task 2 (banner) + Task 3 (e2e)
- **Issue:** The banner must surface ONLY dropped (unreviewed) briefs, but the vault doc carries no reviewed marker; and the offline e2e needs a stored voice brief to drive from (no live mic).
- **Fix:** (a) `endSessionClean` now returns the stored `vaultDocId` so PostCall can mark a just-reviewed brief seen (localStorage), keeping the banner's "unreviewed" correct with no new backend query. (b) Added `smoke:seedVoiceBrief` (mirrors `seedInboxFixture`) to seed the stored brief for the e2e.
- **Files modified:** packages/backend/convex/voice.ts, packages/backend/convex/smoke.ts
- **Verification:** web tsc exit 0; `smoke:seedVoiceBrief` run against the live dev deployment returned a `vaultDocId`; voice tests 15/15.
- **Committed in:** 02b56ff (Task 2), e532d9b (Task 3)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). Both are small, backend-side enablers for a frontend-scoped plan — the plan's own interfaces assumed a working clean-end store and an offline-seedable brief. No scope creep; no new gate, no new plan pipeline.
**Impact on plan:** All within the plan's intent (reuse the pipeline, honor "no new backend" for surfacing). The clean-end store fix is a root-cause correctness fix at the shared `endSessionClean` seam.

## Issues Encountered
- **Offline e2e cannot fully render a PLAN card in one handoff message.** The offline agent SMOKE grammar drives one governed tool per composer message (add → subject → body → propose), so a single brief→plan handoff message can't build a full plan offline. The e2e therefore asserts the voice-owned deterministic half (dropped brief surfaces → handoff navigates to `/workspace?thread=<id>` → NO REPORT pre-Approve); the full PLAN card + real Approve→send is the plan-08 live human-verify, per the plan's own note.
- **E2E harness blocker (known, phase-wide).** Next dev (:3111) was down and is OOM-fragile on the workspace page; running the spec needs the live stack + a Gmail-connected E2E user. Authored-and-documented per prior phases; the seeder itself is validated against the running dev deployment (:3210).

## User Setup Required
None - no external service configuration required (the live voice round-trip's `OPENAI_API_KEY` was set in prior plans).

## Next Phase Readiness
- VOIC-03 (both clean review→store AND dropped auto-store→surface) and VOIC-04 (brief→plan at the existing gate) are code-complete and offline-verified.
- **Plan 08 (phase close / human-verify):** the live audio round-trip, the real clean-end review→store, and the real Approve→governed-send remain the manual live checks (voice is not unit-testable).

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-20*

## Self-Check: PASSED
- Created files exist: PostCall.tsx, AbnormalBriefBanner.tsx, voice.spec.ts — all FOUND
- Commits exist: acab5e1, 02b56ff, e532d9b — all FOUND
- Verifications: web `tsc --noEmit` exit 0; `@pikar/backend test voice` 15/15; `smoke:seedVoiceBrief` runs against dev deployment; `check-playbooks.mjs` exit 0
