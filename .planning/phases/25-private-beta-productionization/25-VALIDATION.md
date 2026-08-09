---
phase: 25
slug: private-beta-productionization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `25-RESEARCH.md` § Validation Architecture. That section is the source of
> truth for the requirement→test map; this file is the execution contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` ^3.2.7 + `convex-test` 0.0.54 (backend) · `@playwright/test` (web e2e) |
| **Config file** | `packages/backend/vitest.config.ts` — `environment: "edge-runtime"`, `server.deps.inline: ["convex-test"]`, `include: ["convex/**/*.test.ts"]`, `testTimeout: 20_000` |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run convex/<file>.test.ts` |
| **Full suite command** | `pnpm test` (turbo, all packages) |
| **E2E command** | `pnpm test:e2e` (Playwright, `apps/web/e2e/`, storage-state via `auth.setup.ts`) |
| **Skill gate** | `pnpm eval:golden` — **required** whenever the `cockpit-agent` body changes |
| **Boot gate** | `pnpm boot:check` (install → codegen → typecheck) · `pnpm lint` (biome ci) |
| **Estimated runtime** | ~60s backend quick · ~4-6 min full suite · e2e additional |

**No framework install needed** — vitest, convex-test, edge-runtime and Playwright are all
present and configured. Wave 0 writes test FILES, not infrastructure.

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @pikar/backend exec vitest run convex/<touched>.test.ts` + `pnpm lint`
- **After every plan wave:** `pnpm test` + `pnpm typecheck`; add `pnpm test:e2e` on any wave touching `apps/web`
- **Skill-body waves only:** `pnpm eval:golden` before activating — **read back the live version first** (`seedSkills` writes `maxVersion + 1`; optimizer dry-runs occupy versions)
- **Before `/gsd:verify-work`:** full suite + e2e green, `ops:envCheck` returns `missing: []` on the hosted deployment, and every live checkpoint recorded
- **Max feedback latency:** ~60 seconds (single backend test file)

---

## Per-Task Verification Map

*Populated by `gsd-planner`. Every task must map to an `<automated>` verify or an explicit
Wave 0 dependency, except the five live checkpoints enumerated under Manual-Only below.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| *pending planning* | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test files (all six are MISSING and gate their requirement):

- [ ] `packages/backend/convex/invites.test.ts` — BETA-01: zero-row-persistence on uninvited sign-in, subject binding, **cross-subject re-redemption refused driven twice (Google-shaped 21-digit `sub` AND Entra-shaped opaque ~44-char `sub`)**, returning-identity skip, password wrong-code asymmetry, owner-gated issuance
- [ ] `packages/backend/convex/isolation.test.ts` — BETA-02 + BETA-05: the `schema.tables` enumeration (**an unclassified table FAILS**), the every-index-leads-with-`tenantId` scan with a non-vacuity floor, the reverse check (no `EXEMPT_GLOBAL` table declares `tenantId`), the two-user behavioural cross-read/cross-write matrix, owner's pre-existing rows stay attributed, and the three `OWNER_REQUIRED` assertions
- [ ] `packages/backend/convex/graph.test.ts` — DLVR-02: MIME byte-parity with `gmail.send`, suppression refusal before credential mint + CAN-SPAM footer (19-05 parity), error taxonomy (≥500 throws / non-202 4xx terminal), provider-aware >4 MB attachment cap, rotated-`refresh_token` persistence, and the fixture-first read plane
- [ ] `packages/backend/convex/delivery.test.ts` — DLVR-02: per-send routing, and the **static scan proving `internal.gmail.send` appears in ZERO non-test source files** after the seam lands
- [ ] `apps/web/e2e/onboarding-first-send.spec.ts` — BETA-03 DOM path against the `SMOKE::` fixture spine
- [ ] `apps/web/e2e/admin.spec.ts` — BETA-01 issuance DOM; also closes **Phase 22's outstanding `/ops` DOM UAT residue**
- [ ] `packages/backend/convex/lib/env.ts` + `ops:envCheck` — the fail-closed production secret manifest

Extensions to existing files (no new file):

- [ ] `onboarding.test.ts` — the first-send offer appears iff `needsOnboarding === true`
- [ ] `cockpit.test.ts` — **a tenant with NO `postalAddress` can complete the first-send offer**, and the offer works on a thin idea-stage profile (only `oneLineDescription` + persona)
- [ ] `skilloptExport.test.ts` — grounded-prose export stays owner-gated
- [ ] `migrations.test.ts` — the `gmailTokens.provider` backfill sets `"google"` on every pre-existing row

---

## Manual-Only Verifications

Five behaviours cannot be proven offline. Each needs a live owner checkpoint.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **Outlook MIME threading** | DLVR-02 | Whether Graph honours `In-Reply-To`/`References` in the conversation view is observable only against a real Outlook client. **This is the one whose failure changes the design** | **Schedule FIRST among the live MS checks, not last.** Send a real reply via Graph to a real Outlook thread; confirm it lands in the conversation view, not as a new thread |
| Real Google + Microsoft OAuth | BETA-01 | Real IdP round-trip against the hosted deployment; synthetic subjects cannot prove the door | On the hosted deployment: sign in **uninvited** (must be blocked, and `users`/`authAccounts` must show zero new rows) and **invited** (must admit and bind the subject) — for BOTH providers |
| Real Outlook send lands | DLVR-02 | Requires a real Azure app, real consent, real mailbox | Approve a plan routed `provider: "microsoft"`; confirm arrival in a real inbox with correct headers and CAN-SPAM footer |
| First delivered result in minutes | BETA-03 | The requirement is about a real human's wall-clock experience | A brand-new invited human completes the first-send offer and receives a real email at their own address |
| Vercel deploy + secret manifest green | Go-live | Hosted-environment state | Deploy; `npx convex run ops:envCheck` returns `missing: []`; seed the skill registry and confirm `executive-router` is active |
| **Custom-domain decision (SC#6)** | Go-live | Pure owner judgment, both branches acceptable | `checkpoint:decision`. Either domain + DNS + TLS are decided and recorded, **or** it is recorded in writing that no user-shareable URL ships until they exist. Facts for the decision are in `25-RESEARCH.md` § Custom-domain decision brief |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (7 new files above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] The five live checkpoints are each an explicit `checkpoint:*` task, not prose
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
