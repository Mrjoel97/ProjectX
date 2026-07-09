---
phase: 1
slug: foundation-governance-substrate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x + convex-test 0.0.54 (`@edge-runtime/vm` environment) |
| **Config file** | none — Wave 0 installs `packages/backend/vitest.config.mts` (`environment: "edge-runtime"`) |
| **Quick run command** | `pnpm --filter backend vitest run` |
| **Full suite command** | `pnpm turbo test` |
| **Estimated runtime** | ~30 seconds (unit suite) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter backend vitest run`
- **After every plan wave:** Run `pnpm turbo test` + `npx convex run` smoke scripts against the dev deployment
- **Before `/gsd:verify-work`:** Full suite green + clean-clone boot test + both smoke workflows (DLQ, review-gate race) demonstrated
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs are assigned by the planner; rows below anchor requirement/criterion coverage and MUST be adopted into plans.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | OPSG-02 (insert path) | unit (convex-test) | `pnpm --filter backend vitest run convex/audit.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPSG-02 (insert-only static scan) | unit (static scan) | `pnpm --filter backend vitest run convex/auditImmutability.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPSG-04 (DLQ via onComplete) | integration (dev deployment) | `pnpm --filter backend smoke:dlq` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Criterion 2 (tenant scoping unavoidable) | unit negative (convex-test) + grep allow-list | `pnpm --filter backend vitest run convex/tenant.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Criterion 4 (awaitEvent race + WORM stub) | integration (dev deployment) | `npx convex run smoke:runReviewGate` (decision + timeout paths); `npx convex run worm:exportAudit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Criterion 6 (skills registry + seed skill) | unit (convex-test) + grep no-hardcoded-prompts | `pnpm --filter backend vitest run convex/skills.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Criterion 1 (clean-clone boot) | scripted check | `pnpm boot:check` (install → codegen → typecheck) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/backend/vitest.config.mts` + `@edge-runtime/vm` install — framework bootstrap
- [ ] `convex/audit.test.ts` — stubs for OPSG-02 (insert path)
- [ ] `convex/auditImmutability.test.ts` — OPSG-02 insert-only static scan
- [ ] `convex/tenant.test.ts` — cross-tenant negative + unauthenticated rejection
- [ ] `convex/skills.test.ts` — skills registry loader/activation
- [ ] `convex/smoke.ts` + `smoke:assert*` scripts — OPSG-04 DLQ + review-gate race (dev-deployment integration)
- [ ] `scripts/boot-check` — install → codegen → typecheck

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clean-clone boot following README verbatim | Criterion 1 | First-run DX can't be fully scripted (README accuracy is the artifact) | Fresh `git clone` → follow README: `pnpm install` → `npx convex dev` → `pnpm dev` → app loads, codegen green, 5 components in `convex.config.ts` |
| Google OAuth verification submitted | Criterion 5 | External console workflow (Verification Center) | Verification Center shows "submitted"; record URL/screenshot in phase notes; demo video of minimal gmail.send consent flow attached |
| Graphify active on repo | Criterion 5 | Local tooling state | `.git/hooks/post-commit` exists; `graphify-out/graph.json` fresh after a commit; `.mcp.json` contains graphify stdio entry |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
