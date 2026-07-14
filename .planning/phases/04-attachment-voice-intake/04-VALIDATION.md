---
phase: 4
slug: attachment-voice-intake
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
planned: 2026-07-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `04-RESEARCH.md` § Validation Architecture. Task-level rows finalized by the planner (below).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (unit) + `convex-test@0.0.54` (Convex) + Playwright 1.61.1 (E2E) |
| **Config file** | `packages/backend/vitest.config.*`, `packages/extraction/vitest.config.ts` (created in Plan 01), `apps/web/playwright.config.*` |
| **Quick run command** | `pnpm --filter @pikar/extraction test` (pure) · `pnpm --filter @pikar/backend test -- intake` |
| **Full suite command** | `pnpm test` + `pnpm --filter @pikar/web exec playwright test intake` |
| **Estimated runtime** | ~ pure <1s · intake convex-test subset ~10s · full suite ~60s |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick command (`@pikar/extraction` pure tests <1s; `intake` convex-test subset).
- **After every plan wave:** Run `pnpm test` (all packages) — must be green.
- **Before `/gsd:verify-work`:** Full suite + Playwright green; live smoke + human-verify before phase close.
- **Max feedback latency:** ~10 seconds (intake convex-test subset).

---

## Per-Task Verification Map

> All SMOKE:: paths hit the REAL intake spine (classify → redact → cost → audit → merge) with ZERO real API calls.

| Req | Behavior | Plan · Task | Test Type | Automated Command | Status |
|-----|----------|-------------|-----------|-------------------|--------|
| INTK-02 | classify image/pdf/audio/document/unknown (magic bytes + mime + ext) | 04-01 · T2 | unit (pure) | `pnpm --filter @pikar/extraction test` | ⬜ pending |
| INTK-02/03 | frameForConversation: attachment frame + dictation verbatim | 04-01 · T3 | unit (pure) | `pnpm --filter @pikar/extraction test` | ⬜ pending |
| INTK-02 | attachment-extractor skill .md ↔ .ts byte-identity + active seed | 04-02 · T2 | convex-test | `pnpm --filter @pikar/backend test -- skills` | ⬜ pending |
| INTK-03 | transcription priced per audio-minute (fail-closed) | 04-03 · T2 | unit (pure) | `pnpm --filter @pikar/cost test` | ⬜ pending |
| INTK-02/03 | intakeDb upload URL + artifact CRUD round-trip | 04-04 · T1 | convex-test | `pnpm --filter @pikar/backend test -- intake` | ⬜ pending |
| INTK-02 | extract → **redact** → persist safeText; raw never in audit | 04-04 · T3 | convex-test | `pnpm --filter @pikar/backend test -- intake` | ⬜ pending |
| INTK-02 | fail-closed: `scanText` Err → status=failed, no safeText, no merge | 04-04 · T3 | convex-test | `pnpm --filter @pikar/backend test -- intake` (`SMOKE::extract::` + PII-poison) | ⬜ pending |
| INTK-02 | cost recorded for extraction call (kill-switch respected) | 04-04 · T3 | convex-test | `pnpm --filter @pikar/backend test -- intake` | ⬜ pending |
| INTK-02 | attachment safeText drives a cockpit turn (merge seam) | 04-04 · T3 | convex-test | `pnpm --filter @pikar/backend test -- intake` | ⬜ pending |
| INTK-03 | dictation transcript → conversation turn like a typed request | 04-04 · T3 | convex-test | `pnpm --filter @pikar/backend test -- intake` (`SMOKE::transcribe::<goal>`) | ⬜ pending |
| INTK-02/03 | UI: record/attach → upload → visible result in conversation | 04-05 · T2 | E2E (Playwright) | `pnpm --filter @pikar/web exec playwright test intake` over SMOKE:: | ⬜ pending |
| SC3 | delivered email reflects attachment/dictation content past guardrails | 04-06 · T2 | **manual live** | human-verify checkpoint (Wave 4) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/extraction/` package scaffold + `vitest.config.ts` + first `classify.test.ts` — **04-01 · T1/T2**.
- [ ] `packages/backend` intake convex-test file + seed helper (register the components cockpit tests already use) — **04-04 · T1**.
- [ ] No framework install needed (Vitest / convex-test / Playwright all present).

---

## Manual-Only Verifications

| Behavior | Requirement | Plan · Task | Why Manual | Test Instructions |
|----------|-------------|-------------|------------|-------------------|
| Delivered email reflects attached/dictated content past guardrails | SC3 (INTK-02/03) | 04-06 · T2 | Real OCR/transcription accuracy + real Gmail delivery cannot be exercised offline | On the live backend: (1) attach a REAL PDF + a REAL image → see them classified + content summarized into the conversation; (2) record + DICTATE a request → see the transcript enter as a request turn; (3) let the agent propose → Approve → confirm the delivered email reflects the content, audit refs-only. Mirrors Phase 3.3 CKPT-02. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the sole manual is the SC3 checkpoint, 04-06 · T2)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (extraction scaffold in 04-01; intake convex-test seed in 04-04)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-07-14
