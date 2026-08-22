---
phase: 26
slug: connected-product-pages
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
---

# Phase 26 — Validation Strategy

> Every route stays disabled until its connected automated and authenticated owner gates pass.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.7 + convex-test; Playwright 1.61.1; Next 16 production build |
| **Config files** | Package Vitest configs; `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @pikar/backend test <surface>` — **no `--`**; with it pnpm forwards the separator literally and vitest runs the WHOLE suite (measured, 26-11) |
| **Full suite command** | `pnpm --filter @pikar/backend test && pnpm --filter @pikar/web test && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` |
| **Estimated runtime** | ~15 minutes plus focused authenticated Playwright and owner checkpoints |

## Sampling Rate

- **After every task commit:** Run the plan's focused package/backend test.
- **After every backend page wave:** Run backend typecheck and affected package suites.
- **After every route-gate plan:** Run web tests, web typecheck, production build and the page's
  focused authenticated Playwright spec.
- **Before phase verification:** Run both full suites, both typechecks, production build and watcher.
- **Max focused feedback latency:** 180 seconds; full build/E2E is a page/final gate.

## Per-Plan Verification Map

| Plan | Wave | Requirement | Primary evidence | Automated command | Status |
|------|------|-------------|------------------|-------------------|--------|
| 26-01 | 1 | DASH-01 | pure result/window/money contracts | `pnpm --filter @pikar/core test -- dashboard` | ⬜ pending |
| 26-02 | 1 | DASH-01 | additive schema/index contracts; no destructive migration | `pnpm --filter @pikar/backend test -- schema dashboard` | ⬜ pending |
| 26-03 | 2 | APRV-01 | discard/schedule/progress CAS and race tests | `pnpm --filter @pikar/backend test -- cockpit plans` | ⬜ pending |
| 26-04 | 2 | APRV-01 | auth/isolation/cursor/capped Approvals projections | `pnpm --filter @pikar/backend test -- approvals` | ⬜ pending |
| 26-05 | 3 | APRV-01 | page states + connected browser flow | `pnpm --filter @pikar/web test -- approvals && pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts` | ⬜ pending |
| 26-06 | 4 | FIN-01 | append-only/idempotent ledger arithmetic and coverage start | `pnpm --filter @pikar/backend test -- spendLedger` | ⬜ pending |
| 26-07 | 5 | FIN-01 | reasoning/ingest limiter-to-ledger parity | `pnpm --filter @pikar/backend test -- guardrails vaultFolders spendLedger` | ⬜ pending |
| 26-08 | 5 | FIN-01 | media reserve/actual/refund/unlanded replay safety | `pnpm --filter @pikar/backend test -- media spendLedger` | ⬜ pending |
| 26-09 | 6 | FIN-01 | tenant/owner finance projections and controls | `pnpm --filter @pikar/backend test -- finance` | ✅ green (15/15) |
| 26-10 | 7 | FIN-01 | honest coverage UI + owner/non-owner browser flow | `pnpm --filter @pikar/web test -- finance` then, from `apps/web`, `npx playwright test e2e/finance.spec.ts` | ✅ green — connected cost console + owner boundary pass; owner UAT approved 2026-08-22 (found and fixed a mobile clip); 2 unrelated red characterised in 26-10-SUMMARY |
| 26-11 | 8 | CONT-01 | provenance pair at 4 write sites; promote = one guarded tx + one counted `workflow.start`; agent-relayed citation | `pnpm --filter @pikar/backend test vault.test createdDocs cockpitTools dispatch.test research.test evaluations.test cockpit.test media.test vaultDigest vaultGround` | ✅ green — full backend suite 90 files / 2237 passed / 0 failed; backend typecheck clean; 5/5 promotion mutants caught + the citation mutant; playbook gate verified live |
| 26-12 | 9 | CONT-01 | union pagination, signed URL ownership and sidecar proof | `pnpm --filter @pikar/backend test content` (the `--` REMOVED — it does not filter) then the full `pnpm --filter @pikar/backend test` | ✅ green — content 20/20; full backend suite 91 files / 2258 passed / 0 failed; backend typecheck clean; 9/9 mutants caught (one only after the missing test was written); playbook gate verified live |
| 26-13 | 10 | CONT-01 | every artifact kind, reuse deep link and promotion lifecycle | `pnpm --filter @pikar/web test content` then, from `apps/web`, `npx playwright test e2e/content.spec.ts --project=chromium` | ✅ green — component 23/23, web suite 30 files / 476 passed, web typecheck + prod build clean, **`e2e/content.spec.ts` EXECUTED 7/7** against a rebuilt `:3111`, backend 92 files / 2263 passed, 7/7 view mutants caught, playbook gate verified live. **Owner UAT APPROVED 2026-08-22** ("the page is minimalistic, it works great") and Task 3 activated the nav; the spec re-ran 7/7 after the flip. The owner also found a 26-12 defect — `kind:"image"` is wrongly excluded from the shelf — carried into 26-13.1. |
| 26-13.1 | 10.1 | CONT-01 | the image lane (a 26-12 repair), title search, thumbnails | `pnpm --filter @pikar/backend test content` and `pnpm --filter @pikar/web test content`, then `npx playwright test e2e/content.spec.ts` from `apps/web` | ✅ green — backend content 25/25 with 4/4 mutants caught, component 27/27, **`e2e/content.spec.ts` EXECUTED 9/9**, web suite 30 files / 480, backend 92 files / 2268, watcher clean |
| 26-14 | 11 | RPRT-01 | comparable metrics, window and completeness semantics | from `packages/core`: `npx vitest run src/reports.test.ts`; from `packages/backend`: `npx vitest run convex/reportsBusiness.test.ts convex/opsSignals.test.ts convex/plans.test.ts`; from `apps/web`: `npx vitest run "app/(app)/ops"` | ✅ green — core 1083/1083 (40 files), backend 2294/2294 (93 files), web ops 21/21, both typechecks clean, biome clean on every touched file, watcher clean. **An adversarial 43-agent audit of the first draft confirmed 25 findings; 13 distinct defects fixed**, four of them mutation-verified (the /ops tile, the symmetric snapshot guard, the graph.sent join, the latency truncation). Defect 1 had shipped BACKEND-ONLY — `/ops` still rendered `edit 0`. |
| 26-15 | 11 | RPRT-01 | unsafe audit payload omission and owner rejection | from `packages/contracts`: `npx vitest run src/auditProjection.test.ts`; from `packages/backend`: `npx vitest run convex/reportsGovernance.test.ts convex/isolation.test.ts convex/llmRedaction.test.ts` (the `--` form does NOT filter) | ✅ green — contracts 4 files / 64 passed with **21/21 in `auditProjection`** and 5/5 mutants caught, backend **94 files / 2314 passed / 0 failed** with `reportsGovernance` 17/17 and 6/6 mutants caught, both typechecks clean, biome clean on every touched file (the 5 remaining warnings are pre-existing in `llmRedaction.test.ts`), watcher clean. **A MUTANT FOUND A GUARANTEE WITH ZERO COVERAGE:** "never stringify the payload as a fallback" was tested twice and neither test reached the shape gate — both fed a nested object under a key the ALLOWLIST already refuses, so a `JSON.stringify` fallback survived the whole suite. **TWO EXISTING GUARDS CAUGHT THIS PLAN'S OWN CHANGES:** `isolation.test.ts`'s self-growing owner surface (16 → 18) and `llmRedaction.test.ts`'s RCE-door scan, whose anchor the `seeds` → `SEEDS` rename broke. |
| 26-16 | 12 | RPRT-01 | one-snapshot board pack, non-groundable artifact, safe audit | from `packages/backend`: `npx vitest run convex/reportPack.test.ts` then the full `npx vitest run` (the `--` form does NOT filter) | ✅ green — reportPack **21/21**, backend **95 files / 2338 passed / 0 failed**, core 40/1096, contracts 4/64, all three typechecks clean, biome clean, watcher clean. **ONE REAL DEFECT FOUND IN REVIEW AND FIXED: the replay guard admitted only `origin:"agent"`, so PROMOTING a pack (the shipped 26-13 control patches that very field to `agent_promoted`) made the guard stop recognising it — regenerate the same window and it inserted a DUPLICATE, and every regeneration after that inserted another.** Both halves were separately tested and never composed. Fixed to `agent`/`agent_promoted` via `.take()` + `.find()` (`.first()` lets one foreign row sharing the hash mask ours), with two new tests, both mutation-verified. |
| 26-17 | 13 | RPRT-01 | synchronized filters, privacy DOM and board-pack download | from `apps/web`: `npx vitest run "app/(app)/dashboard/reports"`, `npx tsc --noEmit`, `npx next build`, then `npx playwright test e2e/reports.spec.ts --project=chromium` | ✅ green — **OWNER UAT APPROVED** ("The report interface is okay") and the Reports nav is LIVE. Component **28/28**, **`e2e/reports.spec.ts` EXECUTED 7/7** against a rebuilt `:3111` with the nav live, web typecheck + prod build clean, core 40/1096, backend typecheck, biome + watcher clean. The board pack is the one NON-seeded claim: `markdownToPdf` and `ctx.storage.store` really ran, the href was a minted `https:` URL, and the second click returned "Already generated for this window". **UAT CHANGE: the Governance and Deployment cards now collapse (native `<details>`, closed on arrival) with a summary hint so a closed card still discloses whether it has content.** Three run-only lessons folded in (wait by PATTERN not by "it changed"; never hardcode a timezone; **`convex run` ENDS THE BROWSER SESSION** so the owner-toggle test must run last). **A MUTANT CAUGHT A PROSE-SATISFIABLE TEST**: `toContain("shown")` was satisfied by the explanatory COMMENT above the hint, so deleting the hint left the suite green — it now asserts rendered output inside `</summary>`. |
| 26-18 | 14 | DASH-01 + external PIPE-01 | Phase 19 isolation/suppression/footer plus connected Pipeline | `pnpm --filter @pikar/backend test -- contacts cockpit gmail pipeline && pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts` | ⬜ external gate |
| 26-19 | 15 | HOME-01 | priority total order, unknown health and composed summaries | `pnpm --filter @pikar/core test -- home && pnpm --filter @pikar/backend test -- home briefings` | ⬜ pending |
| 26-20 | 16 | HOME-01 | Command Center browser flow plus repository-wide close | `pnpm --filter @pikar/web test:e2e -- e2e/command-center.spec.ts && pnpm --filter @pikar/backend test && pnpm --filter @pikar/web test && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

Existing Vitest, convex-test, Playwright, auth storage-state and production-build infrastructure is
sufficient. Each TDD plan creates its named test before implementation; no framework or dependency
installation is planned.

## Required Non-Vacuity and Mutation Checks

- Remove tenant/folder/status scope from one page query and observe an isolation test fail.
- Replay each spend correlation/webhook and observe exactly one ledger movement.
- Reopen a discarded plan and observe the cancellation-provenance test fail.
- Inject nested, address-like and content-like audit values; prove none reaches the browser projection.
- Promote the same artifact twice; prove ingestion starts exactly once.
- Fail one health source; prove Command Center renders Unknown, never Healthy.
- Suppress one recipient in a group and prove no partial product-email send starts.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Approvals responsive/control UAT | APRV-01 | scheduler/browser focus and real card composition | Desktop/tablet/mobile; keyboard; email/media/calendar/memo; double approve; move/fire race; revise deep link |
| Finance owner/non-owner UAT | FIN-01 | role-gated controls and truthful live movements | Verify separate tenant/global rails, coverage-start copy, Unknown history and one real movement per phase |
| Content artifact UAT | CONT-01 | signed downloads/media playback/processing | Open each type, reuse to cockpit, promote eligible artifact, verify processing/ready/error and ownership failures |
| Reports privacy/pack UAT | RPRT-01 | rendered audit privacy and file download | Change windows, inspect all sections, compare owner/non-owner, generate/download one consistent board pack |
| Pipeline external gate | PIPE-01 | Phase 19 live send-safety and legal presentation | Two tenants; consent evidence; immediate/scheduled/legacy suppression; postal footer; responsive page |
| Command Center final UAT | HOME-01 | priority transitions and full composition | Clear blockers in order, verify recommendation changes, health Unknown, latest briefing link and responsive layout |

## Validation Sign-Off

- [x] Every plan has focused automated evidence or creates its test first.
- [x] No three consecutive tasks lack automated verification.
- [x] Existing infrastructure covers all planned references.
- [x] No watch-mode flags are used.
- [x] Browser specs are explicitly executed, not merely authored.
- [x] Full repository close includes both suites, both typechecks, build and watcher.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** planning complete; execution pending
