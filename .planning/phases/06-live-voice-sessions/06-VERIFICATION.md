---
phase: 06-live-voice-sessions
verified: 2026-07-21T00:47:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
human_verification_note: >
  The blocking live human-verify gate (06-08 Task 2) was APPROVED by the owner 2026-07-21
  (real bidirectional audio, barge-in, multilingual auto-detect, brief→vault, brief→plan→Approve→send).
  All items that require a live mic + real OpenAI Realtime call are therefore already satisfied;
  this automated pass confirms the shipped code on `main` backs each of the four Success Criteria.
notes:
  - "VOIC-04 (SC#4) is functionally met end-to-end: an approved voice-derived plan enters the normal
    cockpit pipeline at the single-Approve review gate (owner drove a brief → email + PDF → real
    governed send). A logged, deliberate deferral (deferred-items.md): a voice brief cannot yet become
    a NON-EMAIL 'step-by-step plan' — the Executive Agent is an email composer, so it asks one
    clarifying question rather than auto-producing a filled plan. This is a UX-expectation gap, not a
    functional failure; the PostCall button was renamed 'Continue with your agent' to stop
    over-promising, and the richer plan type is deferred (no roadmap phase covers it)."
---

# Phase 6: Live Voice Sessions — Verification Report

**Phase Goal:** Users can hold a live strategy conversation with the Executive Agent that safely becomes a durable brief and, optionally, an executable plan — the product's identity feature, isolated from the durable pipeline and cost-metered.
**Verified:** 2026-07-21T00:47:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria = the contract)

| # | Truth (SC) | Status | Evidence |
| - | ---------- | ------ | -------- |
| 1 | User holds a live bidirectional WebRTC (browser-direct) voice conversation with the Executive Agent and can end it with an End-session button (VOIC-01) | ✓ VERIFIED | `useVoiceSession.ts` owns the full WebRTC lifecycle: mint ephemeral secret → `getUserMedia` (echoCancellation) → SDP handshake to `CALLS_URL` → relay Location `call_id` to `startSession`; two-sided transcript + speaking orb + text fallback. `voiceToken.mintClientSecret` returns ONLY `{clientSecret,expiresAt}` (key never leaves Convex) — `voiceToken.test.ts` 5/5. `LiveSession.tsx` End button (`setConfirming`) → `ConfirmEnd` `onConfirm` → `end()` → `endSessionClean`. Live audio/barge-in/multilingual APPROVED by owner. |
| 2 | Server-side watchdog hard-caps every session at 15 min, terminates cleanly on tab-close/network-drop, with per-session token metering (VOIC-02) | ✓ VERIFIED | `voice.startSession` arms exactly ONE `scheduler.runAt(capEndsAt, forceEndSession)` (armed once, never re-armed); `forceEndSession` CAS-flips `ended_abnormal` → `voiceToken.hangupCall` → auto-stores brief. Clean end cancels via status-CAS (no fire-race throw). `recordUsage` fails CLOSED on non-finite delta via `priceRealtime`. `voice.test.ts` 8/8 (watchdog arm, parallel guard, metering fail-closed), `@pikar/cost` 22/22 (`priceRealtime`), `@pikar/voice session` 9/9 (cap math + `graceExpired` fail-safe). Live 15:00 hangup APPROVED by owner. |
| 3 | An ended session (clean or abnormal) produces a detailed structured brief, stored and indexed in the knowledge vault (VOIC-03) | ✓ VERIFIED | `buildBriefMarkdown`/`composeBrief` (pure, shared `BRIEF_HEADERS`) → `voice.storeBrief`/`persistBrief` inserts a `kind:"brief"` `vaultDocuments` row and routes through `startIngest` (the sole ingest starter). `draftVoiceBrief` (toolless `generateObject`, registry skill, SMOKE offline seam) drafts the abnormal path. Session audit rows carry refs/counts ONLY. `voice.test.ts` storeBrief→vault green, `@pikar/voice brief` 11/11, `llmRedaction.test.ts` 31/31 (refs-only), vault suite 72/72. Ingest-stranding fixed: `onIngestComplete` marks `failed` (no doc stuck at "processing"). |
| 4 | At session end the agent asks permission to convert the brief into a plan; an approved plan enters the normal pipeline with the review gate (VOIC-04) | ✓ VERIFIED | `PostCall.tsx` "Continue with your agent" → stores brief → `sendCockpitMessage({ text: planSeedFromBrief(markdown) })` → `router.push(/dashboard/workspace?thread=…)` landing at the EXISTING single-Approve gate (no new pipeline). `AbnormalBriefBanner.tsx` offers the same handoff for dropped sessions. `planSeedFromBrief` extracts Decisions + Action items (shared headers). Owner drove brief → email + PDF → real governed send. See note: non-email plan type deliberately deferred (UX-expectation gap only). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/voice/src/realtime.ts` | Pinned OpenAI Realtime shapes (single source) | ✓ VERIFIED | Endpoints, models, event vocab, `readUsage`; live-verified `audio.input` nesting. Imported by client + `voiceToken`. |
| `packages/voice/src/session.ts` | Cap math + status FSM | ✓ VERIFIED | `CAP_MS`, `capEndsAt`, `isEnded`, `canTransition`, `graceExpired` (fail-safe). 9/9 tests. |
| `packages/voice/src/brief.ts` | Pure brief text + plan-seed parser (plain text) | ✓ VERIFIED | `BRIEF_HEADERS`, `buildBriefMarkdown`, `composeBrief`, `planSeedFromBrief`. 11/11 tests. |
| `packages/voice/src/metering.ts` | Usage accumulator | ✓ VERIFIED | `accumulateUsage` reducer. 2/2 tests. |
| `packages/backend/convex/voiceToken.ts` | Mint + hangup (no key leak) | ✓ VERIFIED | `mintClientSecret` returns `{clientSecret,expiresAt}` only; `hangupCall` internalAction. 5/5 tests. |
| `packages/backend/convex/voice.ts` | Session engine (watchdog, CAS ends, metering, brief store) | ✓ VERIFIED | Thin adapter over `@pikar/voice`; one watchdog, CAS idempotency, `persistBrief` via `startIngest`. 8/8 tests. |
| `packages/backend/convex/llm.ts` `draftVoiceBrief` | Toolless brief drafter + SMOKE seam | ✓ VERIFIED | Registry skill fail-closed, `generateObject`, fallback retry, SMOKE offline. 2/2 draft tests. |
| `packages/backend/convex/vaultIngest.ts` | Brief lands in vault; no stranding | ✓ VERIFIED | `startIngest` (sole starter) + `onIngestComplete` (marks failed) + `retryStuckIngests`. 72/72 vault tests. |
| `apps/web/.../voice/useVoiceSession.ts` | WebRTC hook | ✓ VERIFIED | Full lifecycle, transcript, metering flush, countdown/wrap-up/grace timers. |
| `apps/web/.../voice/LiveSession.tsx` | Live surface + End + countdown + wrap-up | ✓ VERIFIED | Always-visible countdown, T-2min visible banner + SR announce, End confirm dialog. |
| `apps/web/.../voice/PostCall.tsx` | Brief review/store + plan handoff | ✓ VERIFIED | Edit → `endSessionClean(editedMarkdown)`; handoff → `sendCockpitMessage`. Wired. |
| `apps/web/.../voice/AbnormalBriefBanner.tsx` | Dropped-session brief recovery | ✓ VERIFIED | Surfaces newest unseen voice brief, vault link + same handoff, localStorage seen-set. |
| `docs/decisions/005-...md` | ADR (immutable) | ✓ VERIFIED | 9.5 KB architecture record. |
| `docs/playbooks/voice.md` | Subsystem contract | ✓ VERIFIED | 21.9 KB, finalized w/ UAT invariants. |
| `schema.ts` `voiceSessions` | Session table + `by_tenant_status` | ✓ VERIFIED | Table + index present (lines 518–545). |
| `skills.ts` voice-session / voice-brief | Registry skills seeded (§5) | ✓ VERIFIED | Both bodies seeded in `seedSkills`. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `useVoiceSession` | OpenAI Realtime | mint → SDP handshake → `startSession(callId)` | ✓ WIRED | callId relayed so watchdog has a target (Pitfall 1). |
| `startSession` | `forceEndSession` | `scheduler.runAt(capEndsAt)` | ✓ WIRED | One watchdog; test asserts arm at startedAt+CAP_MS. |
| `forceEndSession` | OpenAI hangup | `internal.voiceToken.hangupCall` | ✓ WIRED | Force-terminate; failure swallowed refs-only, brief still stores. |
| `recordUsage` | spend rails | `priceRealtime` → `recordSpend` | ✓ WIRED | Fail-closed before any write. |
| `storeBrief`/`persistBrief` | vault | insert `kind:brief` → `startIngest` | ✓ WIRED | Idempotent on `briefRef`; ingest workflow → ready. |
| `startIngest` | `onIngestComplete` | `workflow.start({onComplete})` | ✓ WIRED | No doc stranded at "processing" (the pre-existing bug, fixed). |
| `PostCall` / `AbnormalBriefBanner` | cockpit pipeline | `sendCockpitMessage(planSeedFromBrief)` → review gate | ✓ WIRED | Reuses existing single-Approve gate; no new pipeline. |
| `mintClientSecret` / `draftVoiceBrief` | skill registry | `getActiveSkill` (fail-closed) | ✓ WIRED | No hardcoded prompts (§5). |

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
| ----------- | ------ | ----------- | ------ | -------- |
| VOIC-01 | Plans 03/06 | Live bidirectional WebRTC voice + End button | ✓ SATISFIED | Truth 1; `voiceToken.test.ts` + owner live-verify |
| VOIC-02 | Plans 01/05 | 15-min watchdog + clean/abnormal terminate + metering | ✓ SATISFIED | Truth 2; `voice.test.ts` + `cost` + owner live 15:00 hangup |
| VOIC-03 | Plans 04/05 | Ended session → structured brief stored+indexed in vault | ✓ SATISFIED | Truth 3; `voice`/`vault`/`llmRedaction` suites green |
| VOIC-04 | Plan 07 | Agent asks brief→plan; approved plan enters pipeline at review gate | ✓ SATISFIED | Truth 4; owner brief→email+PDF→Approve→send (non-email plan type deferred — note) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `useVoiceSession.ts` | 244–248 | `console.debug("[voice] unhandled…")` UAT diagnostic | ℹ️ Info | Self-labeled ponytail "remove/quiet at phase close" diagnostic gated behind a type check; harmless, aids future live debugging. Not a stub. |

No blocker or warning anti-patterns. `ponytail:` comments throughout name deliberate ceilings (empty-transcript brief, no mint retry, full-table scan in `retryStuckIngests`) with upgrade paths — intentional simplifications, not incomplete work.

### Human Verification Required

None outstanding. The one phase-gate live walk-through (real mic + real OpenAI Realtime call — VOIC-01..04) was the blocking gate and was **APPROVED by the owner 2026-07-21**. The UAT surfaced and fixed six live-only defects (mint 400 shape `f22b2e3`, transcript turn-drop `292eb41`, plain-text brief + visible wrap-up + honest handoff `61a36a1`, vault ingest-stranding `68d47e6`), each root-caused with tests.

### Gaps Summary

No goal-blocking gaps. All four Success Criteria are backed by substantive, wired code on `main` and by green automated suites (voice 28, backend voice 15, vault 72, llmRedaction 31, cost 22 — all passing), plus the owner-approved live gate that no unit can substitute for.

One deliberate, logged deferral (not a gap against the phase contract): a voice brief cannot yet be turned into a NON-EMAIL structured "step-by-step plan" — the Executive Agent is an email composer, so on handoff it asks a clarifying question rather than auto-filling a plan. SC#4 as written ("an approved plan enters the normal request pipeline with the review gate") is met end-to-end (owner sent a real email + PDF from a brief). The gap is a UX-expectation mismatch, honestly addressed by renaming the button to "Continue with your agent"; the richer plan type is a genuinely new governed capability captured in `deferred-items.md`, correctly out of scope for a closed phase.

---

_Verified: 2026-07-21T00:47:00Z_
_Verifier: Claude (gsd-verifier)_
