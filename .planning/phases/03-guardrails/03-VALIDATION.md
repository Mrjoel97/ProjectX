---
phase: 3
slug: guardrails
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (packages) + convex-test 0.0.54 (backend) + smokeRun.mjs (dev-deployment smokes) |
| **Config file** | packages/*/vitest.config.ts; packages/backend/scripts/smokeRun.mjs |
| **Quick run command** | `pnpm --filter <touched-package> test` |
| **Full suite command** | `pnpm test` (turbo across packages) |
| **Estimated runtime** | ~20 seconds (full), ~2–10s per package |
| **Smoke runtime** | ~30–90s per smoke script against the running dev deployment |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter <touched-package> test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite green + guardrail smoke script passes
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

*Filled by the planner — one row per task, mapped to GRDL-01..06.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| — | — | — | GRDL-01..06 | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] None expected — vitest + convex-test + smokeRun.mjs infrastructure already exists (Phases 1–2); `packages/pii` already carries its test file. New packages (`packages/cost`) mirror the existing vitest config shape.

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real fallback on live model outage | GRDL-05 | Cannot force a real provider outage from CI; smoke uses the SMOKE:: seam / forced-error path instead | During execution, optionally verify with a bogus model id on the dev deployment; the automated path covers the error-taxonomy branch |
| Kill-switch operator flip UX | GRDL-06 | Flipping the guardrailConfig row is an operator action on a live deployment | `npx convex run` the toggle mutation on dev; confirm submits hard-stop with the governed `blocked` outcome |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
