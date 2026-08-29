---
phase: 29-unified-knowledge-and-routines
plan: 07
subsystem: workflow-packs
tags: [workflow-packs, tenant-customization, ui, eval-corpus, honesty, mutation-testing]

requires:
  - phase: 29-unified-knowledge-and-routines (plan 05)
    provides: "publishPackCustomization + packCustomizationFields/customizationSchemaFor/classifyCustomizationChange — the closed form this surface renders and submits through"
  - phase: 27-workflow-packs
    provides: "listPacks (template + live version + per-source readiness), WorkflowPackPreflight, toolsForWorkflowPack, PACK_SOURCE_PROBE_STATES, outcomeFor, the 30-case fixture corpus"
  - phase: 21-user-skill-authoring
    provides: "myUserSkills (the tenant's own adaptations, no base body) and the ownerMutation activation boundary this surface must not cross"
provides:
  - "apps/web/app/(app)/dashboard/workflows/ — the schema-driven pack customization route (NOT in the nav)"
  - "packages/backend/convex/workflowPackEvals.test.ts — the pack eval corpus checked against the shipped runtime at $0, in CI"
affects: [29-10 authenticated browser gate, any plan that plants the four unplanted injections]

tech-stack:
  added: []
  patterns:
    - "Copy as exported pure functions with LITERAL assertions, plus a source scan proving the JSX renders those functions — the only honest component coverage available in a runner with no DOM"
    - "A corpus checked against the SHIPPED code (outcomeFor, toolsForWorkflowPack, PACK_SOURCE_PROBE_STATES), never against a hand-written list"
    - "A known gap pinned as a LITERAL list, so closing it turns the test red and the red is the signal"

key-files:
  created:
    - apps/web/app/(app)/dashboard/workflows/page.tsx
    - apps/web/app/(app)/dashboard/workflows/WorkflowPackCustomizer.tsx
    - apps/web/app/(app)/dashboard/workflows/WorkflowPackCustomizer.test.ts
    - packages/backend/convex/workflowPackEvals.test.ts
  modified:
    - docs/playbooks/watch.json
    - docs/playbooks/workflow-packs.md

key-decisions:
  - "The test file is `.test.ts`, NOT the plan's `.test.tsx`. apps/web's vitest config includes only `app/**/*.test.ts` and has no jsdom — a `.test.tsx` would never execute, which is the exact 'a test file here is decoration' gap that config was created to close."
  - "No backend file was modified. The plan's `run-eval-golden.mjs` and `skill-registry.md` belong to another wave-4 agent and were left untouched; Task 2 landed entirely in the one backend file 29-07 owns."
  - "No prefill of a saved customization: `myUserSkills` returns `authoredBody` but not `customizationValues`, and adding a read is a `skills.ts` change this plan does not own. The form opens empty and says so."
  - "The change id is the SERVER's `customizationHash`, shortened. Hashing in the browser would be a second implementation of an identity two planes already agree on."
  - "Four of the six 'injection' fixtures plant no injection anywhere the harness controls. Recorded and guarded, not fixed — the fix needs vaultSmoke.ts, the fixture JSONs and the casesHash in contracts/src/skill.ts."

requirements-completed: []

duration: ~135min
completed: 2026-08-29
---

# Phase 29 Plan 07: Pack Customization Surface and a Reachable Eval Corpus — Summary

**A tenant can now customize the six approved workflow packs through a form that is generated
entirely from the closed schema — and the form says the two true things about what saving does
instead of the one comfortable thing that is false.**

## Task commits

1. **Task 1 — the customization surface** — `73d9409`
2. **Task 2 — the corpus checked at $0** — `99d5023`

## Verification — the CORRECTED commands, with real output

The plan's two gate commands are no-ops on this machine and were **not run as written**.
`pnpm --filter @pikar/web test -- workflow-packs` swallows the `--`, so the filter never reaches
vitest; `node scripts/check-playbooks.mjs` run bare hangs on stdin and signals by printing.

| Command | Output |
|---|---|
| `cd apps/web && pnpm vitest run WorkflowPackCustomizer` | **1 file / 59 tests passed** |
| `cd apps/web && pnpm vitest run` | **36 files / 658 tests passed** (baseline 35 / 599; +1 file, +59 = exactly this plan) |
| `cd apps/web && pnpm typecheck` | **clean** |
| `cd packages/backend && pnpm vitest run workflowPackEvals` | **1 file / 21 tests passed** |
| `cd packages/backend && pnpm vitest run` | **113 files / 3139 tests — 3138 passed, 1 failed.** The one failure is `convex/env.test.ts`, the KNOWN RED from Phase 28's 28-06 (`git log -2` on it: `2fc1a8a`, `eed88b5` — not mine). Baseline 112 / 3117; +1 file, +21 = exactly this plan. |
| `cd packages/backend && pnpm typecheck` | **clean** |
| `echo '{}' \| node scripts/check-playbooks.mjs check` (DIRTY tree) | after the playbook bumps, the only block names `docs/playbooks/cockpit.md` for **29-09's** uncommitted `workspace/page.tsx` + `KnowledgeSearchPanel.*`. Nothing of mine is named. |
| `npx biome check` on all 4 new files + `watch.json` | clean after `--write` reflow |
| `git diff --stat HEAD -- <my paths>` after both commits | **empty** — the HEAD tree is the tree the gates ran against |

### `pnpm --filter @pikar/web build` — RAN, FAILED, AND THE FAILURE IS NOT MINE

```
Error: Turbopack build failed with 3 errors:
Module not found: Can't resolve 'server-only'   (x3)
```

`server-only` is absent from this worktree's `node_modules` (`ls node_modules | grep -c '^server-only$'`
→ `0`). **Reproduced with my entire route directory moved out of the tree** — byte-identical 3
errors — so it is a pre-existing install artifact of this worktree, not a defect in what I wrote.
Fixing it means changing the install, which is outside this plan. `pnpm typecheck` (which does
compile the new `.tsx`) is therefore the compile gate that actually ran.

## THE BROWSER GATE IS UNRUN, AND THE PLAN'S BROWSER CRITERION IS NOT MET

No browser has loaded `/dashboard/workflows`. `apps/web`'s runner is node-only (no jsdom, no
testing-library, and its config documents adding them as a deliberate choice), so **nothing in this
plan proves pixels.** The 59 tests are literal-copy assertions plus the `skillAuthoring.test.ts`
source-scan idiom.

An operator wanting the browser proof runs:

```
cd apps/web
# .env: NEXT_PUBLIC_CONVEX_URL + a live deployment; E2E_USER_EMAIL / E2E_USER_PASSWORD for a
# seeded user whose tenant has at least one ACTIVE pack skill row (listPacks returns [] otherwise)
pnpm build && pnpm start          # dev OOMs on this repo's workspace page; use the prod build
pnpm test:e2e                     # the `setup` project signs in once and writes e2e/.auth/user.json
```

I did **not** write a Playwright spec for this route. 29-09 owns `apps/web/e2e/` in this wave and
`cockpit.md` watches that whole directory, so a spec from here would collide with a sibling and owe
a bump to a playbook I do not own. **Named follow-up for 29-10:** add
`apps/web/e2e/workflows.spec.ts` asserting the rendered `ACTIVATION_NOTE`, the absence of any
activate/rollback control, and that the field set matches `packCustomizationFields` for the chosen
pack — then, and only then, add the NAV href.

## What Task 1 built

`/dashboard/workflows` — a route that did not exist. Three files, no nav entry.

**Every control is generated by iterating `packCustomizationFields`.** There is no hand-written
field, so there is nothing on the surface that carries a tool name, a URL, a secret, an MCP block or
an assembled prompt body — and the one free-prose control is the schema's declared `instruction`
field bounded by its own `maxBytes`. The only mutation held is `skills.publishPackCustomization`;
`activateTenantCandidate` / `rollbackTenantSkill` are `ownerMutation`s and are not imported.

**The honesty, which was the hard part.** `planTenantActivation` throws `PACK_GATE` for every name in
`WORKFLOW_PACK_SKILL_NAMES`, and `cockpit.ts` — the only production caller of `runWorkflowPack` —
passes `skillVersions` and never `tenantSkillIds`. So the surface says, once, at the top:

> Pikar cannot make a workflow customization live in this release. Saving one records your settings;
> no workflow you start uses them yet.

`pending approval`, `awaiting approval`, `awaiting review`, `under review`, `waiting for Pikar`,
`will be reviewed` and `once approved` are each banned by a test. **There is no disabled "Activate"
button** — a greyed control implying "not yet" is the same lie in a different shape.

Shown to the user: the approved template and its live version; per-source readiness through the
**same `WorkflowPackPreflight`** the cockpit uses (reused, not re-rendered, so a source cannot read
one way here and another there); the before/after diff from the **real** `classifyCustomizationChange`,
which names a threshold/source/instruction edit as *"This changes what the workflow does"* and a
tone/terminology edit as *"This changes how the result reads, not what the workflow does"*; the
server's own `customizationHash` as a shortened change id; and their own saved versions with a
per-status line that describes an unrecognised status as unrecognised rather than as a draft.

### Mutations observed RED (Task 1) — 15/15, each reverted

| # | Mutation | Red on |
|---|---|---|
| M1 | the activation note becomes "Your customization is pending approval" | the literal + the banned-phrase scan (2) |
| M2 | an unrecognised row status is described as a draft | "an unrecognised status is not silently described as a draft" |
| M3 | a material change is described as cosmetic | "a threshold edit is named as a behaviour change" |
| M4 | the lineage line forgets the template version | both lineage tests (2) |
| M5 | the change id is neither shortened nor labelled | "the change id is the server's hash…" |
| M6 | an unknown pack id is echoed back as its own title | "an unknown id is named as unknown…" |
| M7 | the stale-base refusal drops the version it collided with | "refusal 3" |
| M8 | a rejection enum is rendered raw at the user | 2 tests |
| M9 | the byte counter becomes a character counter | "a multibyte character counts as its bytes" |
| M10 | the controls stop being generated from the approved schema | "every control comes from iterating the approved schema" |
| M11 | a second textarea appears for a raw body | "there is exactly one textarea…" |
| M12 | `authoredBody` is added to the publish call | 2 tests (the arg-key list and the write ban) |
| M13 | the shared ARIA attributes are dropped | "controls are labelled and errors are announced" |
| M14 | `useMutation(api.skills.activateTenantCandidate)` is added | 2 tests |
| M15 | `/dashboard/workflows` is added to the shell's `NAV` | "the shell's NAV does not link to it" |

Two assertions in my first draft were **wrong and were corrected by running them**, not by reading:
a blanket ban on the string `authoredBody` (the saved list legitimately *reads* it — replaced by a
ban on WRITES plus a parse of the publish call's actual argument keys, which is strictly stronger),
and a scan for an inline `aria-invalid=` when the attribute is declared once on the object all four
controls spread (replaced by asserting the declaration AND that the spread reaches all four).

## What Task 2 built

`packages/backend/convex/workflowPackEvals.test.ts` — 21 tests, $0, no deployment, no model call.

**The gap it closes.** `run-workflow-pack-evals.mjs` already carries an excellent fixture validator,
and `--fixtures-only` is offline and free — **and no CI job invokes it.** `.github/workflows/ci.yml`
runs `typecheck`, `lint`, `test`, `build`. The only test that reads these files
(`packEvalSuite.test.ts`) checks each one's sha256 and case count and nothing about its content. So
a fixture could drift into a state the shipped runtime cannot produce and the first thing to notice
would be a paid `--candidate` run. This repo has already paid for exactly that twice (21 of 30
fixtures once asserting an unreachable `SourceState`; 11 asserting an unreachable terminal).

Everything is derived from the shipped code, never from a hand-written list: operations must be
`existing`; `expect.sources` must name every reachable plane and only states
`PACK_SOURCE_PROBE_STATES` permits; `expect.outcome` is checked **through the real `outcomeFor`**,
and a reachable plane declared unavailable *forces* `partial` (6 fixtures exercise that arm);
`toolsAllowed` ⊆ `toolsForWorkflowPack` and `toolsForbidden` ∩ granted = ∅ (a granted tool cannot be
absent — that is a case that can only fail); `artifactCreated` is refused for a briefing pack. It
also ties the two planes: a source-preference checkbox may only offer a plane the pack's own
fixtures pin.

It deliberately does **not** import the runner: that module calls `main()` at module scope and its
`.catch` ends in `process.exit`, so importing it from vitest would parse vitest's argv and kill the
worker. The ceiling and the upgrade path (`import.meta.main` guard, then import `validateFixture`
and delete the traversal) are in a `ponytail:` comment.

### THE FINDING: four of the six "injection" cases plant no injection

`stageFor` plants exactly two things — `smoke:seedInboxFixture` and `vaultSmoke:seedCorpus` — and
**neither contains an injected instruction** (asserted, with a positive control that the same
predicate does see the two real ones). So:

| Fixture | Where its injection is said to live | Planted? |
|---|---|---|
| `brand-review-05-injected-content-instruction` | the turn text | **yes** |
| `customer-complaint-03-injected-email-instruction` | the turn text | **yes** |
| `business-pulse-04-injected-vault-instruction` | "a vault document contains a line…" | no |
| `process-sop-05-injected-document-instruction` | "that document I saved last month" | no |
| `campaign-plan-05-injected-page-instruction` | a live web page | no |
| `sales-call-prep-05-injected-page-instruction` | a live web page | no |

Those four score as ordinary cases. The four are pinned **by name as a literal list**, so planting
them turns the test red — and that red is the signal to shorten the list, which the test says in
words. **Not fixed here:** the fix needs `vaultSmoke.ts`, the fixture JSONs and the
`casesHash`/`caseCount` in `packages/contracts/src/skill.ts`, none of which is 29-07's to touch.

### The deadlock, made executable instead of asserted in prose

A valid pack-suite evidence blob does **not** satisfy `hasPassingTenantEvidence`, and tenant evidence
naming the exact row does **not** satisfy `hasPassingPackEvalEvidence` — with a positive control that
the pack blob genuinely certifies the GLOBAL row it names. The pack corpus *can* clear the gate it
was written for (`--candidate`, live and paid). A tenant customization has no gate to clear in this
release, because `planTenantActivation` refuses it.

### Mutations observed RED (Task 2) — 7/7, each reverted

| # | Mutation | Red on |
|---|---|---|
| N1 | `PACK_SOURCE_PROBE_STATES.drive` narrows away `unavailable`, which 5 fixtures use | the producibility scan |
| N2 | the tool grant stops being derived from the operation matrix | 2 tests |
| N3 | `outcomeFor` stops treating a missing source as `partial` | the outcome check |
| N4 | a source preference offers `crm-facts`, a plane no pack tool reads | the two-plane check |
| N5 | a pack's bounded `instruction` field becomes a `terminology` field | the schema-shape check |
| N6 | `hasPassingTenantEvidence` falls back to the GLOBAL `skillVersions` pin when no row is named | "that same valid pack evidence does not satisfy the TENANT predicate" |
| N7 | the one injection case in a file loses its adversarial name | 4 tests |

**N3 found a vacuity in my own first draft**, which is why it is worth naming: the outcome test
originally computed `outcomeFor(...)` and only asserted it for `useful` fixtures, so removing
`runtimeMissing > 0` from `outcomeFor` left 21/21 GREEN. Rewritten so a reachable-plane-unavailable
fixture must come back `partial` *from the function*; N3 is red now and was green before.

## Deviations from the plan text

1. **`.test.ts`, not the plan's `.test.tsx`.** `apps/web/vitest.config.ts` includes only
   `app/**/*.test.ts` and runs in `node` with no jsdom. A `.test.tsx` would have been collected by
   nothing — decoration in the diff. Recorded rather than silently renamed.
2. **`packages/backend/scripts/run-eval-golden.mjs` and `docs/playbooks/skill-registry.md` were NOT
   touched.** Both are in another wave-4 agent's ownership list. Task 2 landed entirely in
   `workflowPackEvals.test.ts`. **They are files this plan NAMES that my diff never touches** — that
   is the ownership instruction, stated here rather than left for a reviewer to notice.
3. **Two files the plan does not name WERE modified, and CLAUDE.md §9 required both.**
   `docs/playbooks/watch.json` (the new route is now a watched path of `workflow-packs.md`, or the
   Stop hook blocks on "new code files not covered by any playbook") and
   `docs/playbooks/workflow-packs.md` (bumped in each task's commit, because
   `packages/backend/convex/workflowPack` is already one of its watched prefixes). Neither is claimed
   by 29-09 or W3-TAIL.
4. **No Playwright spec.** `apps/web/e2e/` is 29-09's this wave and is watched by `cockpit.md`. See
   the browser-gate section above for the named follow-up.
5. **The plan's `done` for Task 2 — "every customizable template has a runnable adversarial eval that
   can legitimately clear its gate" — is only half true, and the half that is false is a decision, not
   a miss.** The GLOBAL pack template's gate is runnable and clearable today (`--candidate`, 30
   fixtures, live and paid). A TENANT customization's gate is refused unconditionally by `PACK_GATE`,
   a deliberate 29-FIN-05 posture. I did not weaken that gate to satisfy the sentence.
6. **The plan's must-have "held-out outcome and injection fixtures execute the exact tenant candidate
   version before activation" is NOT met, and cannot be met from this plan's file set.** No runner
   drives a tenant pack candidate: `run-eval-golden.mjs` refuses a `pack-` target and
   `run-workflow-pack-evals.mjs --candidate` pins a GLOBAL version. The `tenantSkillIds` rail exists
   (29-05) and `workflowPackBinding` forwards it, but no caller uses it for an eval.

## What is NOT built

- **No browser has seen this route.** See above. This is the plan's biggest open item.
- **The form does not prefill a previous customization.** `myUserSkills` returns the rendered
  `authoredBody` but not `customizationValues`, so re-opening shows the saved text and an empty form.
  Closing it is a `skills.ts` read this plan does not own. **Follow-up:** add
  `customizationValues` to the `myUserSkills` projection (it is already on the row, written by
  `publishPackCustomization`), then seed the form state from it.
- **The before/after diff is against the TEMPLATE DEFAULT, not against the previous save**, for the
  same reason. `classifyCustomizationChange(schema, {}, values)` is the honest comparison available;
  a save-to-save diff needs the prefill above.
- **Nothing in production reads a published customization.** Unchanged by this plan and stated in
  the UI copy.
- **Nothing was verified against a live deployment.** No `convex dev`, no `convex run`, no OpenAI
  call, no money spent.

## Not done by me, and owned elsewhere

- `docs/playbooks/cockpit.md` owes a bump for **29-09's** in-flight
  `workspace/page.tsx` + `KnowledgeSearchPanel.*`. It is the only thing the §9 hook still blocks on,
  and it is theirs.
- `.planning/STATE.md` and `ROADMAP.md` were **not** updated: this ran in an isolated worktree beside
  other lanes, and STATE.md is another lane's live surface. The orchestrator should advance them on
  merge.

## Self-Check: PASSED

All 4 created files verified present on disk; both task commits (`73d9409`, `99d5023`) verified in
`git log`; `git diff --stat HEAD -- <my paths>` after the final commit is **empty**. Every file was
staged by explicit path — `git add -A` was never used, and 29-09's uncommitted
`KnowledgeSearchPanel.*` / `workspace/page.tsx` are untouched and unstaged. All 22 mutations
(M1–M15, N1–N7) were reverted and the tree re-confirmed clean after each batch.
