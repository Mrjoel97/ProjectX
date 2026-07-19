---
phase: 06-live-voice-sessions
plan: 02
subsystem: database
tags: [convex, schema, skills-registry, voice, realtime, prompts]

# Dependency graph
requires:
  - phase: 01-foundation-governance-substrate
    provides: skills registry (seedSkills, 5-file mirror, drift test, loadSkill fail-closed)
  - phase: 05-knowledge-vault
    provides: vaultDocuments table (briefRef target)
provides:
  - voiceSessions table (status FSM + cap timing + watchdogFnId + token counters + language + briefRef) with by_tenant + by_tenant_status
  - voice-session registry skill (live realtime persona, UNGATED, seeds v1/active)
  - voice-brief registry skill (toolless call-to-brief structurer, UNGATED, seeds v1/active)
affects: [06-live-voice-sessions plan 03 (voiceToken mint), plan 04 (llm.draftVoiceBrief), plan 05 (voice.ts session read/write)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "5-file skill mirror reused verbatim for two new registry skills (.md canonical, .ts derived byte-identical, name constant, seed entry, drift test.each row)"
    - "Derived .ts constant generated FROM the .md via node JSON.stringify — guarantees byte-identity instead of hand-escaping"
    - "New table + optional-fields-only = no migration (prior-phase discipline)"

key-files:
  created:
    - packages/contracts/skills/voice-session.md
    - packages/contracts/src/skills/voiceSession.ts
    - packages/contracts/skills/voice-brief.md
    - packages/contracts/src/skills/voiceBrief.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/contracts/src/skill.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - docs/playbooks/skill-registry.md

key-decisions:
  - "Both voice skills seeded UNGATED (RESEARCH OQ3): voice-session is free-form speech the eval gate cannot assert; voice-brief's output is a vault document, not tool-state"
  - "voiceSessions status FSM has NO 'wrapping' state — the T-2min wrap-up is a client-side agent instruction, not a server status"
  - "watchdogFnId reuses the v.id('_scheduled_functions') id-type that plans.scheduledFunctionId already uses — cancellable on clean end"

patterns-established:
  - "Voice skill bodies carry the spoken-language directive (respond/write in the language the user spoke) — a voice-subsystem-specific addition to the persona/brief prompts"
  - "voice-brief carries the inbox-digest DATA-not-instructions defense clause adapted for transcript summarization"

requirements-completed: [VOIC-01, VOIC-02, VOIC-03]

# Metrics
duration: 12min
completed: 2026-07-20
---

# Phase 6 Plan 02: Voice Data + Registry Skills Foundation Summary

**The Wave-0 voice foundation: a new `voiceSessions` control-state table (status FSM, cap timing, cancellable watchdog id, token counters, briefRef) plus two UNGATED registry skills — `voice-session` (live realtime persona) and `voice-brief` (toolless call-to-brief structurer) — both seeding v1/active and round-tripping the byte-identical drift test.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-20
- **Tasks:** 3
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments
- `voiceSessions` table added (new table → no migration): `tenantId`, status union `active | ended_clean | ended_abnormal`, optional `callId`, `startedAt`/`endsAt` cap timing, `watchdogFnId`, four cumulative realtime token counters, optional `language` and `briefRef`; indexed `by_tenant` + `by_tenant_status` (the active-session parallel guard).
- `voice-session` skill authored + seeded: warm multilingual advisor persona, barge-in aware, T-2min wrap-up, silence check-in — the `instructions` string plan 03 injects at ephemeral-secret mint (not hardcoded, §5).
- `voice-brief` skill authored + seeded: toolless structurer filling summary / decisions[] / actionItems[] / openQuestions[] / discussion (decisions + actions lead), in the spoken language, empty-sections-empty, carrying the DATA-not-instructions defense clause.
- Both skills registered UNGATED; drift `test.each` extended (skills 32 → 34 green).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add voiceSessions table to schema.ts** - `1f52774` (feat)
2. **Task 2: Seed voice-session skill via 5-file mirror** - `d92046d` (feat)
3. **Task 3: Seed voice-brief skill via 5-file mirror** - `6bfd4c9` (feat)

## Files Created/Modified
- `packages/backend/convex/schema.ts` - Added the `voiceSessions` table + two indexes.
- `packages/contracts/skills/voice-session.md` - Canonical live-session persona prompt.
- `packages/contracts/src/skills/voiceSession.ts` - Derived byte-identical constant.
- `packages/contracts/skills/voice-brief.md` - Canonical brief-structuring prompt.
- `packages/contracts/src/skills/voiceBrief.ts` - Derived byte-identical constant.
- `packages/contracts/src/skill.ts` - `VOICE_SESSION_SKILL` + `VOICE_BRIEF_SKILL` name constants.
- `packages/backend/convex/skills.ts` - Two seed entries + two imports (both UNGATED).
- `packages/backend/convex/skills.test.ts` - Two drift `test.each` rows + imports.
- `docs/playbooks/skill-registry.md` - Registered both skills + bumped `Last verified`.

## Decisions Made
- **Both skills UNGATED** (RESEARCH OQ3, plan interface note): `voice-session` is a free-form spoken persona the 3.6 eval gate cannot meaningfully assert; `voice-brief`'s output is a vault document, not tool-state. Neither added to `GATED_SKILLS`.
- **No `wrapping` server status** — the T-2min wrap-up is a client-side agent instruction; the server FSM stays `active | ended_clean | ended_abnormal`.
- **Derived `.ts` generated from the `.md`** via `node`/`JSON.stringify` rather than hand-escaped, guaranteeing the drift assertion passes by construction (LF-normalized).

## Deviations from Plan

None - plan executed exactly as written.

Two minor notes (not deviations from intent):
- **Task 1 was flagged `tdd="true"`, but a bare declarative Convex table has no logic to RED/GREEN.** The plan's own `<verify>` is a typecheck and its `<done>` is "codegen accepts the schema" — so the TDD cycle collapses to that structural check. Verified the schema adds **zero** new typecheck errors vs baseline (13 pre-existing `*.test.ts` `import.meta.glob`/query-inference errors, unchanged; none in `schema.ts`). The drift `test.each` in skills.test.ts is the runnable check covering Tasks 2/3.
- **The plan's `<context>` note "the test.each drift check auto-covers new .md/.ts pairs" is inaccurate** — the `test.each` list is hardcoded, so I added explicit rows (skills.test.ts is already in the plan's `files_modified`, so no scope change).

### State correction (not a code deviation)

**Requirement status left In Progress, not Complete.** The plan frontmatter lists `requirements: [VOIC-01, VOIC-02, VOIC-03]`, and `requirements mark-complete` flipped all three to Complete. But this Wave-0 plan only builds the data table + registry skills — the actual live voice (VOIC-01), the 15-min watchdog (VOIC-02), and brief transcription/vault storage (VOIC-03) are delivered by later plans (03/04/05). REQUIREMENTS.md tracks at phase granularity (one row per requirement), so marking Complete now would falsely signal the phase is done. Reverted the three checkboxes to `[ ]` and their traceability rows to `In Progress` (the honest "started, not delivered" state — mirroring how RPLY-01 was marked Complete only at 03.11-06 phase-close after live verify, never at its foundation plan). The delivering plan / phase-close will mark them Complete.

## Issues Encountered
- `pnpm --filter @pikar/backend exec tsc -p convex --noEmit` reports 13 errors, ALL pre-existing in `*.test.ts` files (the documented `import.meta.glob` Vite gap + standalone-tsc query-inference quirk; these files run green under vitest — skills 34/34). Confirmed by a git-stash baseline diff: 13 errors with AND without my change, zero in `schema.ts`. Out of scope (not caused by this task).
- `node scripts/check-playbooks.mjs` blocks on `docs/playbooks/voice.md` / `packages/voice/src/*` — those are plan **06-01's** parallel files (owned by the concurrent executor; coordination forbids me touching `voice.md`). My own changed paths are NOT flagged: `skill-registry.md` covers `contracts/skills` + `skills.ts`, and `schema.ts` is already watched by a bumped playbook. My portion is clean; 06-01 will clear its own voice.md block.

## User Setup Required
None - no external service configuration required. (Skills auto-seed on the next `convex dev --run skills:seedSkills` / `npm run seed`; both bootstrap v1/active.)

## Next Phase Readiness
- Plan 03 can inject `voiceSessionSkillBody` (via `getActiveSkill('voice-session')`) into the ephemeral realtime client secret at mint.
- Plan 04's `llm.draftVoiceBrief` can load `voice-brief` from the registry.
- Plan 05's `voice.ts` can insert/read `voiceSessions` (tenant-scoped, `by_tenant_status` for the active-session guard).
- No blockers. All three depend only on this Wave-0 foundation, now in place.

## Self-Check: PASSED

- All 4 created files present on disk.
- All 3 task commits present in git history (`1f52774`, `d92046d`, `6bfd4c9`).
- `voiceSessions` table + both seed entries (`voiceSessionSkillBody`, `voiceBriefSkillBody`) present in source.
- Skills suite green (34/34); zero new typecheck errors vs baseline.

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-20*
