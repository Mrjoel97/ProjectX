---
phase: 11
slug: persona-onboarding-business-profile
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3 (`vitest@^3.2.7`) + `convex-test@0.0.54` |
| **Config file** | per-package (backend `vitest run`); pure `packages/*` use vitest too |
| **Quick run command** | `pnpm --filter @pikar/backend test` (or `pnpm --filter @pikar/<domain> test` for the pure module) |
| **Full suite command** | `pnpm test` (turbo run test across the monorepo) |
| **Estimated runtime** | ~60 seconds (backend convex-test suite); pure module ~5s |

---

## Sampling Rate

- **After every task commit:** Run the quick run for the module touched (`pnpm --filter @pikar/<pkg> test`)
- **After every plan wave:** Run `pnpm --filter @pikar/backend test` + the pure `packages/*` module test
- **Before `/gsd:verify-work`:** Full suite green (`pnpm test`) + `docs/playbooks` check green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

> Task IDs are provisional until plans are authored; rows map to the four SCs + extraction behavior.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-XX | pure profile module | 1 | ONBD-01 / SC#1 | unit (pure) | `pnpm --filter @pikar/<domain> test -- businessProfile` | ❌ W0 | ⬜ pending |
| 11-XX | onboarding adapter | 1 | ONBD-02 / SC#2 | integration (convex-test) | `pnpm --filter @pikar/backend test -- onboarding` | ❌ W0 | ⬜ pending |
| 11-XX | tenant isolation | 1 | SC#3 | integration (convex-test) | `pnpm --filter @pikar/backend test -- onboarding` | ❌ W0 | ⬜ pending |
| 11-XX | redaction scan | 1 | SC#4 | scan (convex-test) | `pnpm --filter @pikar/backend test -- profileRedaction` | ❌ W0 | ⬜ pending |
| 11-XX | extraction skill | 1 | ONBD-02 (extract) | unit/integration | `pnpm --filter @pikar/backend test -- onboarding` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## The four SCs, mapped to concrete assertions

1. **Persona confirm-not-assume (SC#1 / ONBD-01):** the pure decision fn returns a `{ persona, needsConfirm: true }`
   state for every inference; assert no branch yields an auto-committed persona. Enterprise is not an
   emittable persona value.
2. **Embed + retrieve (SC#2 / ONBD-02):** convex-test — call the commit mutation, drive `ingestDoc` to
   `ready` (SMOKE offline seam carries no network), then `vaultGroundHydrated({tenantId, query:"SMOKE::<docId>"})`
   returns the profile doc.
3. **Tenant isolation (SC#3):** seed tenant A's profile, query as tenant B via `SMOKE::<A-docId>` →
   `ownedDocsMeta` drops it → empty result. Assert.
4. **§4 redaction boundary (SC#4):** run a full commit and scan every `audit` / `telemetry` / `deadLetters`
   row written during onboarding; assert payloads contain only refs / hashes / ids / counts / booleans — no
   profile field values, no intake prose. Mirror `llmRedaction.test.ts` + `auditImmutability.test.ts`.

---

## Wave 0 Requirements

- [ ] `packages/<domain>/src/businessProfile.test.ts` — pure schema + always-confirm decision (SC#1)
- [ ] `packages/backend/convex/onboarding.test.ts` — commit→ingest→retrieve + tenant isolation (SC#2/#3)
- [ ] `packages/backend/convex/profileRedaction.test.ts` — §4 audit/telemetry/DLQ scan (SC#4)
- [ ] Seed row: add `BUSINESS_PROFILE_SKILL` to `seedSkills[]` so tests boot with an active v1 body
- [ ] New skill body file `contracts/src/skills/businessProfile.ts` (extraction prompt, §5)

*Framework install: none — vitest + convex-test already present.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Forced first-run gate redirects a brand-new user into `/dashboard/onboarding` and blocks cockpit | ONBD-01 | Client-side `<Authenticated>` routing + `useQuery` redirect — no server assertion surface | Fresh tenant → load `/dashboard` → confirm redirect to onboarding; commit a profile → confirm cockpit unlocks |
| Resumability — leave mid-onboarding, return, progress persists | ONBD-01 | Cross-session client state + thread persistence | Start onboarding, confirm persona, reload → confirm draft/transcript restored |
| Review-gate card pre-fills extracted fields; user edits before commit | ONBD-02 | UI interaction / visual | Paste a brief → confirm card is pre-filled and editable, not blank re-entry |
| Profile page edit re-embeds (grounding stays current) | ONBD-02 | Requires observing re-embed side effect end-to-end | Edit a field, save → confirm old rag entry replaced and `searchVault` returns updated text |
| Spoken-brief + file-upload intake modalities produce a profile | ONBD-02 | Voice/binary rails are integration-heavy; smoke-verified manually in v1 | Upload a deck and record a spoken brief → confirm each yields an extracted profile card |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
