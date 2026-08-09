---
phase: 19
slug: contacts-crm-follow-ups
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `19-RESEARCH.md` → "Validation Architecture". Line numbers in that
> document were read from source on 2026-08-09; **re-verify before relying on one.**

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` 3.2.7 (three configs) + `@playwright/test` for the browser gate |
| **Config files** | `packages/core/vitest.config.ts` (node) · `packages/backend/vitest.config.mts` (edge-runtime) · `apps/web/vitest.config.mts` (`jsx: "automatic"`, includes `app/**/*.test.ts` ONLY) · `apps/web/playwright.config.ts` (pins `127.0.0.1:3111`, **no `webServer` block**) |
| **Quick run command** | `pnpm --filter @pikar/core test -- contacts` · `pnpm --filter @pikar/backend test -- contacts` · `pnpm --filter @pikar/web test -- pipelineView` |
| **Full suite command** | `pnpm test` (turbo, all packages) + `pnpm typecheck` + `node scripts/check-playbooks.mjs` |
| **Estimated runtime** | ~90 s filtered per package; full turbo run several minutes |

**Typecheck baseline: backend is ZERO.** Measured foreground from `packages/backend` on
2026-08-09 during 19-01 and independently re-confirmed by the orchestrator: `npx tsc --noEmit`
exits 0 with no output. **The "13" this file previously claimed and the "150" in STATE.md are
BOTH stale — do not quote either.** Any error at all is now a regression.

Also established by 19-01: a **schema-only** change needs no `npx convex codegen` —
`_generated/dataModel.d.ts` derives table types generically from `schema.ts`. Codegen is only
required when a new Convex *module* appears.

**Browser gate:** `pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts` needs a live
`convex dev` (not `--once`), Next on :3111, and `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`.
**26-05 and 26-10 both stopped at `auth.setup.ts` for want of these — a `--list` is NOT a run,
and a blank result means NOT RUN, never that it passed.**

---

## Sampling Rate

- **After every task commit:** the filtered suite for the package touched
  (`pnpm --filter @pikar/<pkg> test -- <name>`) + `pnpm typecheck` delta against the freshly
  re-measured baseline.
- **After every plan wave:** `pnpm test` (full turbo) + `node scripts/check-playbooks.mjs`.
- **Any plan touching `cockpit.ts`, `gmail.ts` or the approve spine:** the **WHOLE** suite is the
  gate, not a filtered run (20-07's rule — the spine has no safe partial).
- **Before `/gsd:verify-work`:** full suite green + both typechecks + production build +
  `check-playbooks` exit 0 + the owner browser UAT.
- **Max feedback latency:** ~90 seconds (filtered package run).

---

## Per-Task Verification Map

| # | Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|---|-------------|----------|-----------|-------------------|-------------|--------|
| 1 | ACTN-05 | `ACTION_TYPES` has exactly five members; `armFor("crm_write") === "inline"`; the four existing assertions unchanged | unit | `pnpm --filter @pikar/core test -- actionType` | ✅ extend `packages/core/src/actionType.test.ts` | ⬜ pending |
| 2 | ACTN-05 | `normalizeAddress` is idempotent and agrees across contacts / suppressions / the guard | unit | `pnpm --filter @pikar/core test -- contacts` | ❌ W0 | ⬜ pending |
| 3 | ACTN-05 | The needing-attention predicate (no OPEN follow-up) and the due predicate are pure and correct at the boundaries | unit | `pnpm --filter @pikar/core test -- contacts` | ❌ W0 | ⬜ pending |
| 4 | ACTN-05 | `patchPlan({ kind: "crm_write" })` is ACCEPTED by the runtime validator | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend | ⬜ pending |
| 5 | ACTN-05 | Approving a `crm_write` plan applies the whole operation list, sets `done`, seeds ZERO `requests` rows, and never reaches `deliverApprovedPlan` / `gmail.send` | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend (`gapAction.test.ts:193` idiom) | ⬜ pending |
| 6 | ACTN-05 | Double-approve of a `crm_write` plan applies nothing a second time | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend | ⬜ pending |
| 7 | ACTN-05 | The email / memo / calendar / media arms are behaviourally UNCHANGED | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend 20-07 Task 3's regression | ⬜ pending |
| 8 | ACTN-05 | Every new tool key has an `agentSteps.tool` literal AND a `cards.tsx` VERB entry, asserted BOTH ways | structural | `pnpm --filter @pikar/backend test -- traceParity` + `-- cockpitTools` | ✅ | ⬜ pending |
| 9 | ACTN-05 (SC#2) | Every new public read returns `[]`/`null` for a foreign tenant; every new public write throws; unauthenticated throws `UNAUTHENTICATED` | integration | `pnpm --filter @pikar/backend test -- contacts` | ❌ W0 (`tenant.test.ts` `asA`/`asB` idiom) | ⬜ pending |
| 10 | ACTN-05 (SC#3) | Audit rows carry ids/counts ONLY — asserted by **exact key-set equality**, never a substring check | integration | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ extend (`document.created` 4-key precedent) | ⬜ pending |
| 11 | PIPE-01 (SC#5) | A suppressed address is dropped per-address; the other recipients still send; the user is told which were withheld | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend | ⬜ pending |
| 12 | PIPE-01 (SC#5) | **Group mode** drops the suppressed member from the joined string (the `executePlan:~800` join happens BEFORE the `requests` seed) | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend | ⬜ pending |
| 13 | PIPE-01 (SC#5) | ALL recipients suppressed ⇒ `{ ok:false }` **before the CAS**: plan stays `proposed`, zero `requests` rows, nothing scheduled | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ extend | ⬜ pending |
| 14 | PIPE-01 (SC#5) | **A suppression created AFTER approve but BEFORE a scheduled fire is still refused at `gmail.send`** — this is THE test that proves the guard is in the send path, not the approve path | integration | `pnpm --filter @pikar/backend test -- gmail` | ✅ extend | ⬜ pending |
| 15 | PIPE-01 (SC#6) | Every send carries the postal address AND an unsubscribe link — asserted on the **MIME bytes** | integration | `pnpm --filter @pikar/backend test -- gmail` | ✅ extend `gmail.test.ts` | ⬜ pending |
| 16 | PIPE-01 (SC#6) | A tenant with no postal address cannot approve (`no_postal_address`, before the CAS) and cannot send (hard throw at `gmail.send`) | integration | `pnpm --filter @pikar/backend test -- cockpitTools` + `-- gmail` | ✅ extend | ⬜ pending |
| 17 | PIPE-01 (SC#6) | `notifyExternal`'s service notice carries **NO** footer — `buildMime` byte-identity V4 still green | unit | `pnpm --filter @pikar/backend test -- gmail` | ✅ already pins V4 | ⬜ pending |
| 18 | PIPE-01 | Unsubscribe: a tampered/absent digest 404s; an unset secret fails closed; a **GET writes NOTHING**; the POST suppresses idempotently | integration | `pnpm --filter @pikar/backend test -- contacts` | ❌ W0 (`media.test.ts:1557` `signed()` template) | ⬜ pending |
| 19 | PIPE-01 (SC#8) | All four tiles render `0` on an empty tenant — **never `—`, never `Unknown`** (the 26-10 lesson) | component | `pnpm --filter @pikar/web test -- pipelineView` | ❌ W0 | ⬜ pending |
| 20 | PIPE-01 (SC#8) | The page contains **no** opportunity / stage / monetary field — structural scan for `amountCents` / `stage` / `opportunit` across the new modules | structural | `pnpm --filter @pikar/backend test -- contacts` | ❌ W0 | ⬜ pending |
| 21 | PIPE-01 | Bounded reads honour `createDashboardBound` (`nextCursor ⇒ partial`) | integration | `pnpm --filter @pikar/backend test -- contacts` | ❌ W0 | ⬜ pending |
| 22 | PIPE-01 (SC#7) | The playbook states the "no contacts cache at rest" reconciliation in writing, and `check-playbooks` passes with the new watch entry | structural | `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/contacts.ts` + `contacts.test.ts` — `normalizeAddress`, the
      needing-attention predicate, the due predicate, `renderFooter` (ACTN-05, PIPE-01)
- [ ] `packages/backend/convex/contacts.test.ts` — the `asA`/`asB` isolation block over every new
      public function, the unsubscribe token round-trip, the bounded-read contract, the
      no-opportunities structural scan (ACTN-05 SC#2, PIPE-01 SC#8)
- [ ] `apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` — **`.test.ts`, NOT `.test.tsx`**
      (the web vitest config includes `app/**/*.test.ts` only) — the empty-state `0` assertions
      (PIPE-01 SC#8)
- [ ] `apps/web/e2e/pipeline.spec.ts` — **authored** here, **RUN** at the owner gate (the
      18-07 → 18-09 precedent). Already registered in `watch.json` under `dashboard-pages.md`,
      so pick ONE playbook owner for it rather than double-registering.
- [ ] `packages/backend/scripts/eval-cases/36-*.json` + a `$0` observable + fixture floor bump
      34 → 35 — **owed by the binding 18-08 override condition ("teach a tool, owe a fixture")**
      before any paid gate run.
- [ ] Framework install: **none needed.**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Connected browser UAT — the four tiles, the contact table, the unassigned-follow-ups section, the row actions, the un-suppress arm/commit, responsive breakpoints, and the rendered unsubscribe landing page | PIPE-01 SC#8, SC#6 | 26-05 and 26-10 both proved the Playwright suite cannot run in an executor shell (no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`), and BRAND conformance is a human judgement no assertion encodes | Owner runs the authored `apps/web/e2e/pipeline.spec.ts` against a live deployment, or drives it by hand. **A blank row means NOT RUN — never that it passed.** Follow the 26-10 discipline: seed greppable evidence rows under a correlation prefix (`uat-19:`) so the run is re-checkable afterwards. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all ❌ MISSING references above
- [ ] No watch-mode flags anywhere
- [ ] Feedback latency < 90 s
- [ ] Backend typecheck baseline **re-measured**, not quoted from this file
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
