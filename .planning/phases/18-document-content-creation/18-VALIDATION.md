---
phase: 18
slug: document-content-creation
status: planned
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-01
updated: 2026-08-01
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | vitest 3.2.7, two configs: `packages/core/vitest.config.ts` (**node**) and `packages/backend/vitest.config.mts` (**edge-runtime** + `convex-test`). Playwright for `apps/web/e2e/`. |
| **Config files** | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.mts`, `apps/web/playwright.config.ts` — all exist. **Wave 0 install: NONE.** |
| **Quick run (core)** | `pnpm --filter @pikar/core test` |
| **Quick run (one backend file)** | `pnpm --filter @pikar/backend exec vitest run convex/<file>.test.ts` |
| **Quick run (contracts)** | `pnpm --filter @pikar/contracts test` |
| **Full suite** | `pnpm test` (turbo, all packages) |
| **Typecheck** | `pnpm exec turbo run typecheck --filter=@pikar/backend --force` |
| **E2E** | `pnpm test:e2e` (Playwright) |
| **Measured runtime — core suite** | **25.6 s** in-runner (18 files / 375 tests); **~52 s** wall-clock including pnpm/turbo overhead. Measured 2026-08-01. |
| **Measured runtime — one backend file** | **~21 s** in-runner; **~44 s** wall-clock. Measured 2026-08-01 on `convex/documentDraft.test.ts`. |
| **Max feedback latency** | **~52 s** (worst per-task quick command). Well inside the sampling budget. |

> ⚠ **`pnpm typecheck` LIES.** Turbo's `typecheck` task declares no `inputs`, so its cache restores a
> stale pass without ever invoking `tsc`. Always use the `--force` form above. Gate on the **DELTA**
> against the baseline, never on absolute clean.
>
> ⚠ **The baseline is 150, not 52.** `18-RESEARCH.md` Pitfall 3 measured **150** at HEAD on
> 2026-08-01 with `--force`; `18-CONTEXT.md` and `PARALLELIZATION.md` both say 52 and are stale. ALL
> 150 are in 41 `convex/*.test.ts` files; **ZERO are in production convex source.** Lane O / Phase
> 22.1 are actively moving this number. **Plan 18-02 re-measures it and records it in
> `18-02-SUMMARY.md`; every later plan gates its delta against THAT number**, plus "zero errors in a
> production `convex/*.ts` file".

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` command (each is a single test file or
  the core suite — 21-52 s).
- **After every plan wave:** `pnpm test` **+** `pnpm exec turbo run typecheck --filter=@pikar/backend --force`
  (delta 0 vs. `18-02-SUMMARY.md`'s number) **+** `node scripts/check-playbooks.mjs`.
- **Before `/gsd:verify-work`:** full suite green, typecheck delta 0, and the **live phase gate** in
  plan 18-09 Task 3 executed and recorded.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | SC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | ACTN-04 | SC4 / SC4b | unit | `pnpm --filter @pikar/core test -- documentGen` | ✅ `packages/core/src/documentGen.test.ts` | ⬜ pending |
| 18-01-02 | 01 | 1 | ACTN-04 | SC5 | unit (behavioural + structural source scan) | `pnpm --filter @pikar/core test -- documentGen` | ✅ same file (node env, `node:fs` legal) | ⬜ pending |
| 18-02-01 | 02 | 1 | ACTN-04 | REG (rows 1+2) | unit, existing + automatic | `pnpm --filter @pikar/backend exec vitest run convex/traceParity.test.ts` | ✅ `convex/traceParity.test.ts` — **guard, do not edit** | ⬜ pending |
| 18-02-02 | 02 | 1 | ACTN-04 | SC3 (enabler) / SC6 (enabler) | schema validation via existing suites | `pnpm --filter @pikar/backend exec vitest run convex/traceParity.test.ts convex/vault.test.ts` | ✅ (⚠ `vault.test.ts` holds a NUL byte — `grep -a`) | ⬜ pending |
| 18-03-01 | 03 | 1 | ACTN-04 | REG (rows 6-8) | unit | `pnpm --filter @pikar/contracts test && pnpm --filter @pikar/contracts exec tsc --noEmit` | ✅ contracts vitest | ⬜ pending |
| 18-03-02 | 03 | 1 | ACTN-04 | REG2 (rows 9-10) | unit (drift byte-identity, mutation-verified) | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts` | ✅ `convex/skills.test.ts` | ⬜ pending |
| 18-04-01 | 04 | 2 | ACTN-04 | SC1, SC1b, SC3 | convex-test integration | `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts` | ❌ **created by this task** (Wave 0 gap, see below) | ⬜ pending |
| 18-04-02 | 04 | 2 | ACTN-04 | SC7 | convex-test integration (mutation-verified) | `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts` | ❌ → ✅ after 18-04-01 | ⬜ pending |
| *(moved)* | ~~04~~ → **10** | ~~2~~ → **6** | ACTN-04 | SC1b (drift half) | — | *the blueprint drift edit moved to plan 18-10, wave 6 — it is PARKED behind `17.1-10`'s unrun live gate and cannot sit inside an `autonomous: true` wave-2 plan* | — | — |
| 18-05-01 | 05 | 3 | ACTN-04 | SC7b | convex-test integration | `pnpm --filter @pikar/backend exec vitest run convex/documentDraft.test.ts convex/runCockpitAgent.test.ts` | ✅ both exist — **extend** | ⬜ pending |
| 18-05-02 | 05 | 3 | ACTN-04 | SC4, SC4b | convex-test integration (offline `SMOKE::` / `render=fail::` seams) | `pnpm --filter @pikar/backend exec vitest run convex/documentDraft.test.ts convex/cockpitTools.test.ts` | ✅ both exist — **extend** | ⬜ pending |
| 18-06-01 | 06 | 4 | ACTN-04 | SC1, SC3b | convex-test + existing redaction pin | `pnpm --filter @pikar/backend exec vitest run convex/cockpitTools.test.ts convex/llmRedaction.test.ts` | ✅ both exist (⚠ `llmRedaction.test.ts:77-107` pins `cockpit.ts`'s audit call-site count at **exactly 2** — do not change it) | ⬜ pending |
| 18-06-02 | 06 | 4 | ACTN-04 | SC2, SC7 | source scan (node pragma) + convex-test, mutation-verified | `pnpm --filter @pikar/backend exec vitest run convex/cockpitTools.test.ts convex/createdDocs.test.ts convex/dispatchGuard.test.ts` | ✅ `cockpitTools.test.ts` already carries `// @vitest-environment node`; `dispatchGuard.test.ts:222-252` already pins `executePlan` | ⬜ pending |
| 18-07-01 | 07 | 5 | ACTN-04 | SC6 (partial) | web typecheck + Biome | `pnpm --filter @pikar/web exec tsc --noEmit` | ✅ | ⬜ pending |
| 18-07-02 | 07 | 5 | ACTN-04 | provenance UI | web typecheck + Biome | `pnpm --filter @pikar/web exec tsc --noEmit` | ✅ | ⬜ pending |
| 18-07-03 | 07 | 5 | ACTN-04 | SC6 (partial) | e2e **authoring** (the RUN is 18-09's precondition 6) | `pnpm --filter @pikar/web exec playwright test e2e/cockpit-created-document.spec.ts --list && pnpm --filter @pikar/web exec tsc --noEmit && grep -c "output-card" apps/web/e2e/cockpit-created-document.spec.ts` | ❌ **created by this task** (Wave 0 gap) | ⬜ pending |
| 18-08-01 | 08 | 6 | ACTN-04 | REG (row 15 precondition) | **MANUAL** — live Convex `skills` table read | *(none — see Manual-Only)* | n/a | ⬜ pending |
| 18-08-02 | 08 | 6 | ACTN-04 | REG2 (rows 11-12) | unit (byte-identity) | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts && pnpm --filter @pikar/contracts exec tsc --noEmit` | ✅ | ⬜ pending |
| 18-09-01 | 09 | 7 | ACTN-04 | §9 DoD | hook | `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 18-09-02 | 09 | 7 | ACTN-04 | doc correctness | grep assertion | `grep -n "groundable without new extraction\|pre-commitment stands" .planning/ROADMAP.md` (must return NOTHING) | ✅ | ⬜ pending |
| 18-10-01 | 10 | 6 | ACTN-04 | sequencing gate | **MANUAL** — is `17.1-10`'s live gate run? | *(none — see Manual-Only)* | n/a | ⬜ pending |
| 18-10-02 | 10 | 6 | ACTN-04 | SC1b (drift half) | convex-test integration | `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts convex/blueprint.test.ts` | ✅ after 18-04-01; `blueprint.test.ts` ✅ | ⬜ pending |
| 18-09-03 | 09 | 7 | ACTN-04 | SC6 (human half + the e2e RUN), REG #3, REG #11/#15, U4 | **MANUAL** — live phase gate, 4 turns, plus the Playwright run 18-07 could not do | *(none — see Manual-Only)* | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity check:** no 3 consecutive tasks lack an `<automated>` command. `18-07-03`'s
command is an offline *authoring* check (`--list` + `tsc` + an assertion grep) — the live Playwright
RUN needs `convex dev`, `:3111` and seeded `E2E_USER_*` credentials an executor cannot mint, so it is
plan 18-09's precondition 6. The three manual-only tasks are `18-08-01` and `18-10-01` (precondition
gates, each immediately followed by an automated task in the same plan) and `18-09-03` (the terminal
phase gate, preceded by two automated tasks).

---

## Wave 0 Requirements

Existing infrastructure covers the phase — **no framework install, no config file, no scaffold plan
is needed.** vitest, `convex-test` and Playwright are all present and running today.

Two test files do not exist yet. Both are **created by the task that needs them**, inside their own
plan, which is why there is no separate Wave 0 plan:

- [ ] `packages/backend/convex/createdDocs.test.ts` — created by task **18-04-01** (covers SC1, SC1b,
      SC3, SC7 and the drift exclusion). A new convex test file needs **no `watch.json` entry** and
      **no `importGuard.test.ts` registration** (`import.meta.glob` auto-scans).
- [ ] `apps/web/e2e/cockpit-created-document.spec.ts` — created by task **18-07-03** (SC6 partial).
      ⚠ Its offline driver is the `SMOKE::agent::create=…` op, a **CLOSED four-site registration in
      `llm.ts`** that does NOT exist at HEAD. It is Registration Checklist **row 16**, owned by plan
      **18-06** (wave 4). Without it the spec can never make an Output card appear — e2e runs with
      no gateway key.

Every other command in the map above points at a file that exists at HEAD and is **extended**, never
replaced: `documentGen.test.ts`, `documentDraft.test.ts`, `cockpitTools.test.ts`, `skills.test.ts`,
`traceParity.test.ts` (guard — read-only), `blueprint.test.ts`, `vault.test.ts`,
`runCockpitAgent.test.ts`, `llmRedaction.test.ts`, `dispatchGuard.test.ts`.

### Test-authoring cautions (verified at HEAD, 2026-08-01)

- **`stableTenant` was DELETED** (Lane O commit `d62c46c`). Use plain string subjects:
  `t.withIdentity({ subject: "tenant_a" })` — `requireTenant` takes the subject before `|`.
  `vaultGround.test.ts:21-23`'s `asTenant` is the current idiom. `18-RESEARCH.md` § *Validation
  Architecture* carries a copyable snippet that compiles at HEAD.
- **`packages/backend/convex/vault.test.ts` contains a literal NUL byte** (~offset 5982). ripgrep/Grep
  treat it as binary and skip it **silently** — a verification grep "confirms" whatever it hoped by
  returning nothing. Use `grep -a`, `sed`, or the Read tool.
- **The backend suite is `edge-runtime`.** `node:fs` needs `// @vitest-environment node` on line 1
  (`traceParity.test.ts:1`, `cockpitTools.test.ts:1` precedents). `packages/core` is node already —
  put source-scan tests there when possible, which is why SC5's structural test lives in
  `packages/core/src/documentGen.test.ts`.
- **`importGuard.test.ts` needs no registration** for a new convex module — `import.meta.glob` auto-scans.
- **Do not background a long suite and then edit files it imports** — vitest transforms a module graph
  changing underneath it and reports reds indistinguishable from a real regression (STATE.md, 17.1-02).
- **Every new test needs a non-vacuity floor.** Source-scan tests must assert the anchor was found and
  the slice is non-empty; escape tests must assert the hostile string actually reached every slot.
  **Four** tasks — 18-01-02, 18-03-02, 18-04-02, 18-06-02 — carry a **mandatory mutation check**
  whose result must be recorded in the plan SUMMARY.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **The `cockpit-agent` candidate stream is free before Phase 18 edits it** | ACTN-04 | The contested state is in the **live Convex `skills` table**, not the working tree — `cockpit-agent.md` is CLEAN at HEAD (last touched `68afb7b`), so `git status` shows nothing. | Plan **18-08 Task 1**. Read the live `skills` rows for `name = "cockpit-agent"`: report the ACTIVE version and whether ANY row is `status: "candidate"`. Confirm Phase 16 closed with a recorded PASSING eval run. Proceed only if both hold. |
| **`17.1-10`'s live gate has already run** | ACTN-04 | Whether another lane's live gate was EXECUTED is a project-state fact, not a working-tree fact. Landing Phase 18's `blueprint.ts` drift conjunct first silently corrupts the number that gate exists to measure, and the corruption is invisible afterwards. | Plan **18-10 Task 1**. Read `.planning/STATE.md`'s Lane 17.1 row and check for `17.1-10-SUMMARY.md`. Proceed only if closed with the gate recorded as run. |
| **The trace row actually appears in a live turn** (REG #3) | ACTN-04 | **Structurally unprovable offline.** A tool name missing from the closed `agentSteps.tool` union makes `internal.agentSteps.record` throw *inside* the AI-SDK `onToolExecutionStart` callback, which the SDK **swallows** — no trace row in prod, every offline test green. Bitten twice (`searchVault`, `evaluateBusiness`). `traceParity.test.ts` is the best proxy and only covers schema↔VERB. | Plan **18-09 Task 3, turn 1**: *"Write me a one-pager on X."* Open the workspace trace and confirm a row renders with the new VERB copy. |
| **The ACTIVE `cockpit-agent` body teaches the tool and the model calls it** (REG #11/#15) | ACTN-04 | Offline tests cannot see the live `skills` row. The `.md` edit only mints a **candidate**; the tool is invisible until an eval activates it — the **withheld-tool pattern** (hit at RPLY-01, again at 16-09 for ~$0.46). | Plan **18-09 Task 3**, preconditions 3-4 (deploy → `seedSkills` → activate the candidate through its eval gate, recording run id / verdicts / cost cross-checked against `npx convex data audit`), then turn 1 must actually call the tool. |
| **`content-drafter` was the body actually loaded for short-form** | ACTN-04 | No offline assertion can tell which registry body produced given prose. | Plan **18-09 Task 3, turn 2**: *"Give me three LinkedIn post options."* Three short vault rows, **no Download button**, and bodies that read like posts rather than like a proposal. |
| **The locked trigger rule (U4), both halves** | ACTN-04 | **Structurally unprovable offline** — the tool cannot see whose idea the document was. It lives in `cockpit-agent.md` prose and the tool `description`, deliberately with no code branch. 🚫 A `confirmed: boolean` argument is NOT an acceptable substitute (the model grading its own trigger). | Plan **18-09 Task 3**, turn 1 (explicit ask → creates with **no** confirmation round-trip) and turn 4 (agent **suggests** a document → it must **ask first**). |
| **Revision replaces in place, live** (SC7 live half) | ACTN-04 | The offline test proves the mutation; only a live turn proves the model addresses the right `#index` from its own context. | Plan **18-09 Task 3, turn 3**: *"Make the second one shorter."* Same vault row rewritten, created-row COUNT unchanged, Output card refreshes. |
| **SC#6 — the Output card LOOKS like BRAND §5's Output card** | ACTN-04 | An e2e can assert `[data-testid="output-card"]` exists and carries the title; it **cannot** assert title + UPPERCASE type badge + subline + rendered artifact on the `--card` sheet, that no amber `--held` token appears, or that the copy reads well. That judgement is human (CLAUDE.md §10). | Plan **18-09 Task 3**, design-judgement step: compare against `docs/design/BRAND.md:101-102` and the screenshots in `docs/design/brand/`. |
| **The audit payload is genuinely refs-only** | ACTN-04 | `llmRedaction.test.ts` pins call-site counts, not the payload of a NEW event. | Plan **18-09 Task 3, turn 1**: `npx convex data audit` → open the `document.created` row and confirm it carries `topicHash` / `form` / `vaultDocId` / `hasPdf` and **no topic text, no prose** (CLAUDE.md §4). |

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify or an explicit Manual-Only row + Wave 0 note
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (two test files, each created by the task that needs them; zero framework installs)
- [x] No watch-mode flags — every command uses `vitest run` / `playwright test`, never bare `vitest`
- [x] Feedback latency measured: **~52 s** worst case per-task
- [x] Typecheck gated with `--force` on the **delta** vs. a freshly re-measured baseline (recorded HEAD baseline 2026-08-01: **150**, re-measured by plan 18-02)
- [ ] `nyquist_compliant: true` — **deliberately still false.** Flip it only after every Manual-Only
      row above has been EXECUTED and recorded in `18-09-SUMMARY.md`. Setting it true on
      planning-time conditions alone is the exact false signal Phase 15.2 called out.

**Approval:** pending — plan 18-09 Task 3.
