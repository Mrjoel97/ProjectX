---
phase: 21
slug: user-authored-skills-and-routines
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-10
updated: 2026-08-10
---

# Phase 21 — Validation Strategy

> Per-task and per-wave validation for tenant-scoped candidate-only skill authoring and inert,
> manually re-runnable pinned prompts across all seven executable plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Existing Vitest + convex-test; existing golden-runner self-check; existing Playwright authenticated project |
| **Config files** | `packages/backend/vitest.config.ts`, package Vitest configs, `apps/web/playwright.config.ts` |
| **Fast focused smoke** | contracts authoring test; backend `skills`/`dispatch`/`savedPrompts`/`importGuard`; three focused web source tests; golden `--self-check` |
| **Full free gate** | `pnpm test && pnpm typecheck && pnpm --filter @pikar/backend eval:golden -- --self-check && pnpm --filter web build && node scripts/check-playbooks.mjs && git diff --check` |
| **Live/readback tools** | `--inspect-tenant-skill`, `smoke:userSkillRuntimeAttribution`, one explicitly authorized full unfiltered `--tenant-skill` run |
| **Estimated runtime** | focused smoke under ~3 minutes; full free gate ~5–10 minutes; authenticated/live gate variable and separately authorized |

The exact fast focused smoke before the final full gate is:

```powershell
pnpm --filter @pikar/contracts exec vitest run src/skillAuthoring.test.ts
pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts convex/dispatch.test.ts convex/savedPrompts.test.ts convex/importGuard.test.ts --maxWorkers=1
pnpm --filter web exec vitest run 'app/(app)/dashboard/workspace/skillAuthoring.test.ts' 'app/(app)/dashboard/workspace/pinnedPrompts.test.ts' 'app/(app)/ops/tenantSkillReview.test.ts'
pnpm --filter @pikar/backend eval:golden -- --self-check
```

---

## Sampling Rate and Wave Gates

- **After every task:** run every `<automated>` command in that task. A TDD/mutation task is not
  complete until its intentional red is observed, the mutation hunk is restored, and the same
  focused command is green.
- **After Wave 1 (21-01):** contracts focused test, backend typecheck, playbook checker, diff check.
- **After Wave 2 (21-02):** focused `skills` + `runCockpitAgent`, authoring web test, backend/web
  typechecks, playbook checker.
- **After Wave 3 (21-03 and 21-05):** focused skills/dispatch/saved-prompts/web suites plus golden
  `--self-check`; both parallel plans must be green before Wave 4.
- **After Wave 4 (21-04):** skills/import-guard/owner-review web suites, both typechecks, playbooks.
- **After Wave 5 (21-06):** authenticated Playwright, the exact fast focused smoke above, the full
  free gate, and two identical exact-id inspection snapshots must produce one immutable refs-only
  handoff. Any red, skipped mutation, dirty mutation hunk, identity mismatch, or unrun command blocks
  Wave 6 and spend.
- **Before/after the Wave 6 (21-07) live checkpoint:** machine-compare the handoff to a fresh
  zero-spend exact-id snapshot; afterward machine-read exact evidence, final state, handoff-bound
  recursively closed/forbidden-content result, correlation-scoped A/B runtime attribution, and
  authenticated prompt/thread/privacy refs before changing completion docs.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Proof | Automated command / gate | File at plan start | Status |
|---------|------|------|-------------|-------|--------------------------|--------------------|--------|
| 21-01-01 | 01 | 1 | SKILL-01 | closed names, deterministic composition, UTF-8 cap | `pnpm --filter @pikar/contracts exec vitest run src/skillAuthoring.test.ts` | ❌ task creates test | ⬜ pending |
| 21-01-02 | 01 | 1 | SKILL-01 | additive tenantSkills/savedPrompts schema and indexes | `pnpm --filter @pikar/backend typecheck` | ✅ schema exists | ⬜ pending |
| 21-01-03 | 01 | 1 | SKILL-01 | one playbook owner and pre-runtime/no-automation boundary | `node scripts/check-playbooks.mjs && git diff --check` | ✅ | ⬜ pending |
| 21-02-01 | 02 | 2 | SKILL-01 | candidate-only publish, first baseline, 200-version bounded allocation, provenance/privacy | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts --maxWorkers=1` | ✅ extended | ⬜ pending |
| 21-02-02 | 02 | 2 | SKILL-01 | tenant active override, global fallback, real prompt isolation | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts convex/runCockpitAgent.test.ts --maxWorkers=1` | ✅ extended | ⬜ pending |
| 21-02-03 | 02 | 2 | SKILL-01 | user panel is candidate-only and hides base/activation | `pnpm --filter web exec vitest run 'app/(app)/dashboard/workspace/skillAuthoring.test.ts' && pnpm --filter web typecheck` | ❌ task creates | ⬜ pending |
| 21-02-04 | 02 | 2 | SKILL-01 | live authoring seam documented without eval claim | `node scripts/check-playbooks.mjs && git diff --check` | ✅ | ⬜ pending |
| 21-03-01 | 03 | 3 | SKILL-01 | exact tenant evidence identity and refs-only state inspector | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts --maxWorkers=1` | ✅ extended | ⬜ pending |
| 21-03-02 | 03 | 3 | SKILL-01 | exact pin through scheduled dispatch plus refs-only audit attribution/readback | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts convex/skills.test.ts --maxWorkers=1` | ✅ extended | ⬜ pending |
| 21-03-03 | 03 | 3 | SKILL-01 | tenant CLI pin, no-evidence rules, read-only inspector | `pnpm --filter @pikar/backend eval:golden -- --self-check` | ✅ runner extended | ⬜ pending |
| 21-03-04 | 03 | 3 | SKILL-01 | exact operator commands and unpaid boundary | `node scripts/check-playbooks.mjs && git diff --check` | ✅ | ⬜ pending |
| 21-04-01 | 04 | 4 | SKILL-01 | one global/tenant activation transition plus owner/eval truth table | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts convex/importGuard.test.ts --maxWorkers=1` | ✅ extended | ⬜ pending |
| 21-04-02 | 04 | 4 | SKILL-01 | rollback eligibility and evidence-exempt one-write restore | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts --maxWorkers=1` | ✅ extended | ⬜ pending |
| 21-04-03 | 04 | 4 | SKILL-01 | bounded owner review and exact-id controls | `pnpm --filter web exec vitest run 'app/(app)/ops/tenantSkillReview.test.ts' && pnpm --filter web typecheck` | ❌ task creates | ⬜ pending |
| 21-04-04 | 04 | 4 | SKILL-01 | authorization/rollback operation documented | `node scripts/check-playbooks.mjs && git diff --check` | ✅ | ⬜ pending |
| 21-05-01 | 05 | 3 | SKILL-01 | bounded prompt CRUD, dedupe, tenant ownership, log privacy | `pnpm --filter @pikar/backend exec vitest run convex/savedPrompts.test.ts --maxWorkers=1` | ❌ task creates | ⬜ pending |
| 21-05-02 | 05 | 3 | SKILL-01 | Pin/Run/Delete uses trusted hook and a fresh thread | `pnpm --filter web exec vitest run 'app/(app)/dashboard/workspace/pinnedPrompts.test.ts' && pnpm --filter web typecheck` | ❌ task creates | ⬜ pending |
| 21-05-03 | 05 | 3 | SKILL-01 | routine-v0/no-automation operating contract | `node scripts/check-playbooks.mjs && git diff --check` | ✅ | ⬜ pending |
| 21-06-01 | 06 | 5 | SKILL-01 | authenticated authoring + pinned fresh-thread browser behavior | `pnpm --filter web exec playwright test e2e/skill-authoring.spec.ts --project=chromium --workers=1` | ❌ task creates | ⬜ pending |
| 21-06-02 | 06 | 5 | SKILL-01 | fast smoke then full free regression/privacy gate | exact focused smoke above, then full free gate | ✅ infrastructure | ⬜ pending |
| 21-06-03 | 06 | 5 | SKILL-01 | two identical exact-id snapshots freeze candidate/baseline/effective/foreign refs | inspector JSON + schema/key/content validation of `21-LIVE-HANDOFF.json` | ❌ task creates handoff | ⬜ pending |
| 21-07-01 | 07 | 6 | SKILL-01 | zero-spend deployment state still byte-matches immutable handoff | exact inspector JSON maps current state to handoff pre-state | ✅ after 21-06 | ⬜ pending |
| 21-07-02 | 07 | 6 | SKILL-01 | exact snapshotted candidate completes authorized live eval/owner/runtime/rollback gate without republish | blocking human checkpoint; exact-id machine assertions and refs-only result | n/a manual/live | ⬜ pending |
| 21-07-03 | 07 | 6 | SKILL-01 | recursive closed-schema/content rejection plus fresh evidence/global/foreign/runtime/prompt/thread/privacy readback before truthful completion | Node exact-key/forbidden scan + inspector + A/B `smoke:userSkillRuntimeAttribution` + read-only Playwright result readback + handoff SHA-256 + playbook/diff checks | ✅ after 21-03/06 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Status

Existing infrastructure covers the phase: Vitest, convex-test, package typechecks, the golden
self-check, authenticated Playwright setup, the insert-only audit indexes, and playbook checker are
already present. Therefore `wave_0_complete: true` is honest.

The new focused test files are not missing infrastructure or deferred Wave-0 stubs: each is an
explicit TDD output owned by the same executable task that creates its implementation. No separate
framework install, fixture framework, mock server, dependency, or pre-plan setup is required.

---

## Required Mutation and Anti-Vacuity Ledger

Every row is mandatory. “Restore” means reverse only the deliberate local mutation hunk (never reset
or discard unrelated work), rerun the named command, and record RED then restored GREEN in that
plan's SUMMARY.

| Research mutation | Owner task | Exact temporary mutation | Named red proof / positive witness | Restore gate |
|-------------------|------------|--------------------------|------------------------------------|--------------|
| 1. Candidate tenant predicate | 21-02-01 | remove `tenantId` equality from newest candidate lookup | `skills.test.ts` two-tenant collision exposes A row to B while A row positively exists | skills focused green |
| 2. Candidate-only status | 21-02-01 | insert publisher row as `active` | candidate exists but prior effective active must remain unchanged | skills focused green |
| 3. Authenticated provenance | 21-02-01 | set `authorUserId` from spoofable arg | row exists but differs from real `ctx.userId` | skills focused green |
| 4. Exact eval target | 21-03-01 | resolve evidence by name/version instead of candidate id | two tenants share name/version; A evidence must not certify B | skills focused green |
| 5. Filtered evidence suppression | 21-03-03 | remove the `filters.length === 0` evidence guard | self-check proves filtered cases executed, then observes no evidence write | golden self-check green |
| 6. Exact evidence identity | 21-03-01 | accept B row carrying A candidate id in evidence | B remains refused despite same name/version and passing A evidence | skills focused green |
| 7. Effective-loader isolation | 21-02-02 | remove loader tenant predicate | A's high-entropy body needle reaches B's model prompt | skills/runCockpit green |
| 8. Global fallback | 21-02-02 | remove fallback to existing global `loadSkill` | no-overlay tenant throws instead of positively loading global body | skills/runCockpit green |
| 9. Initial rollback baseline | 21-02-01 | skip first system baseline insertion | candidate exists but no eligible prior effective row can restore | skills focused green |
| 10a. Trusted browser send | 21-05-02 | replace `useSendCockpitMessage` with raw cockpit action | positive Run control remains, raw-action source assertion turns red | pinned-prompts web green |
| 10b. Fresh-thread run | 21-05-02 | pass current `threadId` to Run | positive returned id exists but no-threadId/different-thread assertion turns red | pinned-prompts web green |
| 11. Prompt delete ownership | 21-05-01 | remove exact-row tenant comparison | B deletes A's positively witnessed pin | savedPrompts green |
| 12a. Candidate audit privacy | 21-02-01 | add `authoredBody`/`body` to publish audit payload | exact audit row exists; key-set/needle scan turns red | skills focused green |
| 12b. Prompt log privacy | 21-05-01 | add prompt text to an audit payload | saved row exists; audit/DLQ/telemetry needle scan turns red | savedPrompts green |
| 12c. Runtime audit privacy | 21-03-02 | add resolved body to `subagent.completed` | correlation row exists; exact-key/body-needle assertion turns red | dispatch/skills green |

Additional load-bearing plan mutations:

| Mutation | Owner task | Expected red | Restore gate |
|----------|------------|--------------|--------------|
| add `cockpit-agent` to `USER_AUTHORABLE_SKILLS` | 21-01-01 | exact three-name set | contracts focused green |
| remove UTF-8 byte cap | 21-01-01 | multibyte boundary case | contracts focused green |
| replace tenant descending `take(1)` with `.collect()` | 21-02-01 | 200-version bounded source contract | skills focused green |
| drop `tenantSkillIds` at one scheduled handoff | 21-03-02 | exact candidate body never reaches mock model | dispatch/skills green |
| substitute colliding skill id/body hash in runtime audit | 21-03-02 | exact attribution/readback mismatch | dispatch/skills green |
| bypass `transitionSkillActivation` with tenant direct patches | 21-04-01 | one-helper/global+tenant source contract | skills/importGuard green |
| downgrade tenant activation/review/rollback wrapper | 21-04-01 | importGuard plus real non-owner truth-table cell | skills/importGuard green |
| remove `rollbackEligible` predicate | 21-04-02 | never-active archived candidate becomes restorable | skills focused green |

No zero-count proof stands alone: every isolation/privacy/absence assertion must pair with a positive
row, executed case, audit event, prompt, candidate, or runtime correlation witness.

---

## Read-Only Live Evidence Architecture

Plan 21-06 captures the exact id returned by its one browser publication, invokes the JSON inspector
twice, requires canonical snapshots to match, and writes immutable `21-LIVE-HANDOFF.json`. The
artifact carries deployment hash; candidate id/tenant/name/version/bodyHash/author/authorUserId/
lineage/state; exact rollback baseline; active effective-before id/hash; global-before id/hash; and
foreign-before state.
It contains refs only. Plan 21-07 reloads those bytes and queries that literal candidate id—never a
newest lookup or republish—before spend:

```powershell
$h = Get-Content -Raw '.planning/phases/21-user-authored-skills-and-routines/21-LIVE-HANDOFF.json' | ConvertFrom-Json
pnpm --filter @pikar/backend eval:golden -- --inspect-tenant-skill $h.candidate.id --foreign-tenant $h.foreignBefore.tenantId --expect-status candidate --expect-evidence absent --expect-gate-passed false --expect-rollback-eligible false --json
```

After owner activation and one real specialist call, read the existing audit lineage:

```powershell
npx convex run smoke:userSkillRuntimeAttribution "{`"tenantId`":`"$env:PHASE21_TENANT_ID`",`"correlationId`":`"$env:PHASE21_ROOT_REQUEST_ID`"}"
```

After rollback, rerun the same exact-id inspector with archived/passing/gate-passed/rollback-eligible
expectations. `21-LIVE-RESULT.json` must bind to the immutable handoff SHA-256. Machine checks require
exact run/count/retry/cost/model metadata, evidence target/gatePassed, every activation/baseline/
global/foreign snapshot and body hash, restored baseline id/name/version/hash, and A's exact runtime
scope/id/name/version/hash. B has one exact rule in both the stored artifact and fresh readback: it
must be a non-null same-specialist-name attribution whose skill id and body hash are both different
from A's candidate, with `candidateAbsent: true`; null or either candidate value fails. These queries
are bounded, refs-only and read-only; they do not seed fixtures, call a model, record evidence,
mutate status, activate, or rollback. `npx convex data audit` remains the free raw operator
cross-check, but the bounded correlation query is the machine gate.

The result validator is recursively closed, not root-only: it rejects every missing/extra key in
run metadata, candidate/evidence, non-owner, activation, both runtime, rollback, prompt/thread and
privacy objects. It also walks every nested key/value to reject bodies, prompts, fixtures, model or
provider output, raw evidence, messages/content/text, headers/auth/secrets/tokens/emails and the
private needle. The read-only Playwright case loads the exact result path and freshly compares pin
absence, both distinct thread refs and all five zero privacy counts without performing a write.

---

## Manual-Only Verifications

| Behavior | Requirement | Why manual | Required evidence |
|----------|-------------|------------|-------------------|
| Fresh paid full held-out tenant candidate run | SKILL-01 | real provider spend and deployment state require new explicit authorization | exact candidate id/hash, run id, cases/retries/cost/model; no `--only`; red leaves candidate parked |
| Owner versus user authority | SKILL-01 | deployed identity sessions and owner UI | non-owner + valid evidence still `OWNER_REQUIRED`; owner activates exact id only |
| Two-tenant live privacy/runtime | SKILL-01 | two authenticated identities | B cannot read A candidate/prompt or receive A id/hash; A runtime attribution matches exact active row |
| Rollback | SKILL-01 | live status transition | server baseline active, user row archived/eligible, bodies unchanged, no eval required |
| Responsive/focus/honest states | SKILL-01 | semantic visual/keyboard judgment | desktop+narrow viewport, keyboard focus, loading/empty/pending/error/busy copy |

The failed Phase 17.1 run and any prior approval do not authorize Phase 21 spend. A human checkpoint
remains blocking even though machine readbacks surround it.

---

## Isolation and Scope Gates

- User publication accepts only `name` and `authoredBody`; tenant/user/author/status/version/evidence/
  base/rollback fields are derived server-side.
- Tenant next-version and newest-candidate selection use `by_tenant_name_version`, descending
  `take(1)`, including the many-version/no-collect proof.
- Exact evidence binds candidate id + registry tenant + name + version. Eval fixture data stays in
  the throwaway eval tenant.
- Global and tenant activation share one transition implementation; global API behavior remains
  regression-tested and user activation remains structurally absent.
- Runtime attribution rides existing `subagent.completed` audit lineage and contains only scope/id/
  name/version/body hash.
- The paid command consumes only the immutable handoff candidate id. Any new publication or any
  deployment/candidate/baseline/effective/foreign mismatch invalidates the handoff and blocks spend.
- Routine v0 is saved prompt text inert at rest. No routines table, cron, trigger, recurrence,
  execution history, canvas, DSL, or background run.
- SKILL-01 and Phase 21 remain pending on any unrun/red free gate, unapproved spend, parked candidate,
  missing runtime attribution, isolation failure, rollback failure, or unrun browser checkpoint.

---

## Validation Sign-Off

- [x] All 24 tasks across plans 21-01 through 21-07 are represented.
- [x] Waves match executable plans: 1=`01`; 2=`02`; 3=`03`+`05`; 4=`04`; 5=`06`; 6=`07`.
- [x] Every automatic task has a concrete automated command; the live human task has machine checks
  immediately before and after it.
- [x] Existing infrastructure makes Wave 0 complete; new TDD files are task-owned outputs.
- [x] All twelve research anti-vacuity mutations have exact owners, edits, expected reds, positive
  witnesses, and restore gates.
- [x] Fast focused smoke precedes the final full free gate.
- [x] The closing artifact has a recursive exact schema and forbidden-content scan; every result
  field is checked against the immutable handoff, a fresh state/runtime readback, or the exact
  authenticated prompt/thread/privacy readback.
- [x] No watch-mode flags and no paid command in an autonomous plan.
- [x] `nyquist_compliant: true` and completion remains human/live gated.

**Approval:** revised for checker iteration 3/3 on 2026-08-10; execution and spend remain pending.
