---
phase: 6
slug: live-voice-sessions
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + `convex-test` (backend), Playwright (web e2e) — matches every prior phase |
| **Config file** | `packages/backend` vitest config; `apps/web/e2e` Playwright |
| **Quick run command** | `pnpm --filter @pikar/backend test <touched>` (or `--filter @pikar/voice test` / `--filter @pikar/cost test` for pure modules) |
| **Full suite command** | `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/web test:e2e` |
| **Estimated runtime** | ~60 seconds backend; e2e additional |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @pikar/backend test <touched>` (+ `@pikar/voice`/`@pikar/cost` for pure modules)
- **After every plan wave:** Run full backend suite green (document the known pre-existing `audit.test.ts auditCounts` red as a non-regression, if still present)
- **Before `/gsd:verify-work`:** Full suite green + the live human-verify walk-through
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| VOIC-01 | Mint returns `{clientSecret,expiresAt}`, NEVER the API key; request body carries the registry skill instructions | unit (mock `fetch`) | `pnpm --filter @pikar/backend test voiceToken` | ❌ W0 | ⬜ pending |
| VOIC-01 | Live bidirectional audio, barge-in, echo cancel, multilingual | manual/live | phase-gate human live-verify | n/a | ⬜ pending |
| VOIC-02 | Watchdog armed at `startedAt+15min`; `forceEndSession` sets `ended_abnormal` + calls hangup + stores brief | unit (fake timers) | `pnpm --filter @pikar/backend test voice` | ❌ W0 | ⬜ pending |
| VOIC-02 | Clean end cancels the watchdog; CAS no-op on the fire race | unit | `pnpm --filter @pikar/backend test voice` | ❌ W0 | ⬜ pending |
| VOIC-02 | `priceRealtime` maps token counts → USD, fail-closed on non-finite | unit | `pnpm --filter @pikar/cost test` | ❌ W0 | ⬜ pending |
| VOIC-02 | Real hangup actually terminates the OpenAI call | manual/live | phase-gate human live-verify (watch force-end at 15:00) | n/a | ⬜ pending |
| VOIC-03 | `buildBriefMarkdown` → fixed sections, empty→"None", transcript welded in code | unit (pure) | `pnpm --filter @pikar/voice test brief` | ❌ W0 | ⬜ pending |
| VOIC-03 | `draftVoiceBrief` SMOKE:: offline path drives brief → `ingestDoc` → vault `ready` | unit (convex-test) | `pnpm --filter @pikar/backend test voice` | ❌ W0 | ⬜ pending |
| VOIC-03 | Abnormal-end auto-stores the brief; clean-end stores after review | unit | `pnpm --filter @pikar/backend test voice` | ❌ W0 | ⬜ pending |
| VOIC-03 | Session audit/telemetry rows are refs/counts-only (no transcript/secret) | unit (static-scan, `llmRedaction.test.ts` precedent) | `pnpm --filter @pikar/backend test llmRedaction` | ❌ W0 | ⬜ pending |
| VOIC-04 | Brief→plan seeds a cockpit thread and lands a proposable plan at the review gate | unit + e2e | `pnpm --filter @pikar/backend test voice` / Playwright | ❌ W0 | ⬜ pending |
| VOIC-04 | Real in-app: approve the voice-derived plan → normal governed send | manual/live | phase-gate human live-verify | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Deterministically asserted:** token-mint request/response shape + no-key-leak, watchdog arm/fire/cancel + CAS, realtime pricing math, brief markdown structure, brief→vault ingest via SMOKE, brief→plan handoff creating a proposable plan, refs-only audit.

---

## Wave 0 Requirements

- [ ] `packages/voice/brief.ts` + `brief.test.ts` — `buildBriefMarkdown` fixture (VOIC-03)
- [ ] `packages/voice/session.ts` — status FSM + `capEndsAt` (VOIC-02)
- [ ] `packages/cost/src/cost.ts` `priceRealtime` + `cost.test.ts` cases (VOIC-02)
- [ ] `packages/backend/convex/voice.ts` + `voice.test.ts` — watchdog arm/fire/cancel, storeBrief, parallel guard (convex-test, fake timers)
- [ ] `packages/backend/convex/voiceToken.ts` + test — mint (mock fetch) + hangup, no-key-leak
- [ ] `llm.ts` `draftVoiceBrief` + SMOKE:: seam (mirror `digestInbox` offline path)
- [ ] `voiceSessions` table in `schema.ts` (new table → no migration)
- [ ] `voice-session` + `voice-brief` skill rows seeded (CLAUDE.md #5)
- [ ] Static-scan extension in `llmRedaction.test.ts` for the session audit refs-only line
- [ ] Realtime JSON shapes pinned from the live OpenAI doc (Research Open Question 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Actual audio round-trip, barge-in feel, echo cancellation, multilingual auto-detect | VOIC-01 | Voice is not unit-testable — needs a real mic + realtime session | Start a session, speak, interrupt the agent mid-utterance (barge-in), speak a second language; confirm it responds and the transcript is bilingual |
| Real hangup terminates a live call at the cap | VOIC-02 | Requires observing a live OpenAI Realtime call force-end | Start a session, let it reach 15:00 (or force the watchdog); confirm the call ends and an abnormal-end brief is produced |
| Orb / countdown / End-session confirm UX | VOIC-01 | Visual/interaction feel | Walk the pre-flight → live → post-call surfaces; keyboard + screen-reader pass |
| Approve a voice-derived plan → normal governed send | VOIC-04 | End-to-end pipeline join, live | From the post-call summary, convert brief→plan, land at the cockpit review gate, single-Approve, confirm governed fan-out (RPLY-01 precedent) |

*Precedent: the RPLY-01 live gate — a live human-verify no unit can substitute for.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20 (plan-checker VERIFICATION PASSED; `wave_0_complete` flips true once Wave 0 scaffolds land)
