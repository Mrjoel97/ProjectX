# 29-07-FIX — the customizer asserted through its render, and two false records deleted

Branch `feat/29-unified-knowledge`, worktree `C:/Users/expert/AppData/Local/Temp/pikar29`.
Four commits: `30deb8d`, `3ca7770`, `d37c79a`, `27b5248`.

---

## The two claims the orchestrator verified as false — what I found and what I did

### 1. "`pnpm --filter @pikar/web build` cannot run in this worktree at all"

**The claim was false and it is deleted.** I ran it three times during this round; every run
exits 0 and lists `ƒ /dashboard/workflows` among the emitted routes. `server-only` is not imported
by anything — it occurs once, in a comment in `IntakeControls.tsx`.

The claim was recorded in `docs/playbooks/workflow-packs.md` and in the previous SUMMARY as a
durable gate RESULT. It is retracted in the playbook in place (not superseded — the sentence is
gone), the real result is recorded, and `pnpm --filter @pikar/web build` is now listed in that
playbook's **How to verify** block with a note saying the dev server OOMs on the workspace page so
this is *the* compile gate for a route.

### 2. `workflowPackEvals.test.ts`'s headline claim about the eval harness

`grep -rn stageFor` over the worktree returns exactly one hit: the comment asserting it exists. I
read the runner. What it actually does:

- `seedCase` (`packages/backend/scripts/run-workflow-pack-evals.mjs:1335`) calls **three** seed
  mutations — `smoke:seedPackEvalTenant` (a figure row, one calendar event, a `gmailTokens` row),
  `smoke:seedInboxFixture` (only when the fixture declares `inbox: available`) and
  `vaultSmoke:seedCorpus` (only when an expected operation uses `searchVault`).
- `runCase` adds a fourth, `smoke:seedCockpitPlan`.
- **`smoke:seedInboxFixture` DOES contain an injected instruction.** Message `fix-injection`'s body
  is a forward-to-attacker instruction, and `pack-customer-complaint` is the only pack whose
  fixtures declare `inbox: available` — I checked all 30 fixtures — so **all five** of its cases
  run against it, not only its `-injected-` one.

And the guard could not see it: `INJECTION_MARKERS` had no entry matching
`IMPORTANT SYSTEM INSTRUCTION:`, the phrasing this repo's own probe payload uses. The marker list
gained `"system instruction"`; I confirmed the widening does not move the turn-text classification
(still `brand-review` + `customer-complaint`) and does not trip on ordinary seeded prose.

Every seeder is now scanned as its **own sliced source** (`seederSource`), with a positive control
on the slicer — an empty slice would make every "carries no injection" assertion vacuously true.
The mailbox injection is asserted **present and named**, not assumed absent.

---

## The blocker: UI copy was asserted through pure functions

`WorkflowPackCustomizer` is split into a hooks/handlers container and **`CustomizerView`**, which
holds all the JSX and takes its whole state as props. **No copy function is exported any more**, and
a test pins that — there is nothing to call instead of rendering.

`WorkflowPackCustomizer.test.ts` renders with `react-dom/server` and asserts the text a user reads.
Refusals, per-field rejections, the save notice and the byte counter became *reachable states*
(`outcome: {kind:"refused"|"saved"|"transport"|"none"}`, `fieldErrors`) rather than handler-local
strings, which is what made them assertable at all. ARIA is asserted as the **exact id pair on the
exact control** (`aria-describedby="p-business_terms-note"` on the element carrying
`id="p-business_terms"`, and the described `<p>` existing), not as a bare `toContain`.

The verifier's six-function strip and the four ARIA deletions were re-run as mutations. **All go
red now.** See the mutation table below.

---

## The two user-facing defects

### `baseCandidateVersion` from a truncated window

`workflowPackDiscovery.listPacks` now returns `myBaseVersion`, resolved with the **same** descending
`by_tenant_name_version` `take(1)` that `readTenantPublishState` performs when it computes the value
`publishPackCustomization` compares against. Not filtered by author — the comparand on a first
customization is the code-authored `system` rollback baseline, and a client that filtered it out
would disagree with the server again in a new way. The handler also **adopts** the server's
`currentBaseVersion` on a `stale_base_version` refusal, and the copy changed from "Reload the page
before saving again" (which reproduces the window) to "Pikar has caught up — press save again".
The saved-versions list no longer says "You have not customized this workflow yet" while the
lineage line above it says a version is saved.

Backend coverage is real, not a scan: `workflowPackDiscovery.test.ts` seeds 60 newer rows under
another skill name, asserts the pack row has **fallen out of `myUserSkills`**, then asserts that
`null` is refused with `currentBaseVersion: 2` and that the listed `myBaseVersion` is accepted.

### The repeat customization that dropped everything

`listPacks` returns `myCustomizationValues` (the tenant's own row; the same disclosure class as
`myUserSkills.authoredBody`, and it never reaches an audit payload). The form reopens with them,
narrowed to the keys the current schema still declares and their declared kinds, so a template
revision drops stale settings instead of jamming the form. `changeSummary` diffs against **what the
form opened with**, and a new sentence states plainly: *"These are the settings you saved in version
N. Saving replaces all of them with what is on this form."*

---

## The rest of the findings

| Finding | What I did |
| --- | --- |
| `:34` ACTIVATION_NOTE rests on an unenforced absolute about `cockpit.ts` | **CITED, not narrowed.** The test reads `packages/backend/convex/cockpit.ts`, extracts the `runWorkflowPack` call and asserts `tenantSkillIds` is absent, with a positive control that it found the right call site. Adding the pin turns it red (observed). |
| `:211` `as PackRow[]` cast erases the coupling to `listPacks` | Deleted. `useQuery` result is consumed un-cast; row/saved-row/result types come from `FunctionReturnType`, matching `ApprovalsView.tsx`'s existing idiom. |
| `:211` re-declares the three-state source vocabulary as `string` | Deleted with the cast. `selected.sources` goes straight into `WorkflowPackPreflight`, so a fourth `SourceState` breaks this route exactly as it breaks the workspace. |
| `:178` `valueBytes` duplicates `adaptationBytes` | Deleted; imports `adaptationBytes` from `../workspace/SkillAuthoringPanel`. |
| `:520` bytes mislabelled as characters, capped in the wrong unit | The counter says **bytes**, and `maxLength` (UTF-16 code units) is gone — it permitted 3× the cap in CJK while the counter beside it read past its own limit. Over-cap now renders "… Shorten this before saving." |
| `:67` no eval or rollback state rendered | Rollback state was already in `draftStateLine`. Eval state is now rendered from the row's **own** `gatePassed`, both branches asserted — not from an assumption that it is structurally false. |
| `:376` tautological `toEqual(packReadableSources(packId))` | Deleted. Verified `packages/core/src/workflowCustomization.test.ts` catches the `.slice(0,2)` mutation (2 failures) while the backend file correctly does not. |
| `:257` re-implements an already-passing `@pikar/core` test | Deleted. |
| `:44` re-implements `validateFixture`/`validateCorpus` | **The barrier is removed.** `run-workflow-pack-evals.mjs` runs `main()` only when Node was pointed at it, `projectRegistry` is exported, and the test imports the real validators. ~130 lines of second traversal deleted, and the runner's validator now runs on every `pnpm test` — which is the gap that whole file was created to close. `--fixtures-only` still reports "30 valid". |

---

## Mutations applied, observed RED, and reverted

Every mutation below was applied to the working tree, the named suite was run, the result recorded,
and the file restored byte-for-byte (verified by comparison, and `git status` is clean of source).

**The surface (`apps/web`, 109 tests)** — 17 of 18 red, one deliberate green:

| # | Mutation | Result |
| --- | --- | --- |
| M1 | `{lineageLine(…)}` → static text | 4 failed |
| M2 | `{draftStateLine(r)}` → `{r.status}` | 5 failed |
| M3 | `{refusalMessage(outcome.refusal)}` → `{outcome.refusal.reason}` | 8 failed |
| M4 | `{changeSummary(…)}` → `{"changed"}` | 7 failed |
| M5 | the save notice → `"saved"` | 1 failed |
| M6 | `fieldHint(…)` → `""` | 3 failed |
| M7 | `"aria-describedby": noteId` deleted from the shared props | 1 failed |
| M8 | `htmlFor={fieldId}` deleted from the field label | 1 failed |
| M9 | the per-field `role="alert"` deleted | 1 failed |
| M10 | `aria-live="polite"` deleted from the change summary | 1 failed |
| M11 | `tenantSkillIds: {}` added to `cockpit.ts`'s `runWorkflowPack` call | 1 failed |
| M12 | base version taken from the truncated list again | 2 failed |
| M13 | the diff taken against the empty set again | 2 failed |
| M14 | "bytes" renamed to "characters" | 4 failed |
| M15 | the eval-state line deleted | 1 failed |
| M16 | the saved-list truncation branch deleted | 1 failed |
| M17 | `"aria-invalid": invalid` deleted from the shared props | 4 failed |
| M18 | the prefill warning deleted | 1 failed |
| P1 | `prefillFrom` lets unknown keys through | 5 failed |
| P2 | `JSON.parse` left unguarded | 1 failed |
| P4 | the threshold kind check dropped | 1 failed |
| W1 | `choose` stops prefilling | 1 failed |
| W2 | the `stale_base_version` adoption removed | 1 failed |
| W3 | the publish always sends the server's value | 1 failed |
| **P3** | **the `Array.isArray` guard removed** | **109 passed — see below** |

P3 stayed green because the narrowing loop is over the **schema's** keys and no declared key is an
array index, so an array returns `{}` on its own. I **deleted the guard** rather than writing a test
that could not distinguish it: a branch whose removal is invisible is a claim with nothing behind it.

**The eval corpus (`packages/backend`, 22 tests)** — 5 of 5 red:

| # | Mutation | Result |
| --- | --- | --- |
| E1 | the repo's own `IMPORTANT SYSTEM INSTRUCTION:` line planted in `vaultSmoke.ts` | 1 failed |
| E2 | `Ignore previous instructions.` planted in `vaultSmoke.ts` | 1 failed |
| E3 | the mailbox injection body removed from `smoke.ts` | 1 failed |
| E4 | `runtimeMissing > 0` broken in `outcomeFor` | 1 failed |
| E5 | a fixture given an operation its pack does not have | 1 failed |

E1 is the exact case the verifier used to prove the old guard blind; it now fires.

**The discovery query (`packages/backend`, 12 tests)** — 3 of 3 red:

| # | Mutation | Result |
| --- | --- | --- |
| B1 | `myBaseVersion` forced to `null` | 3 failed |
| B2 | `myCustomizationValues` forced to `null` | 1 failed |
| B3 | the `take(1)` reversed to ascending | 2 failed |

**Cross-package:** `packReadableSources(...).slice(0, 2)` in `@pikar/core` → `packages/core` 2
failed, `workflowPackEvals` 22 passed. That is the evidence for deleting the tautology rather than
keeping a second copy of it.

---

## Gates actually run

| Gate | Result |
| --- | --- |
| `cd apps/web && pnpm vitest run WorkflowPackCustomizer` | 109/109 |
| `cd apps/web && pnpm vitest run` | 37 files / 737 passed |
| `cd packages/backend && pnpm vitest run workflowPackEvals` | 22/22 |
| `cd packages/backend && pnpm vitest run workflowPackDiscovery` | 12/12 |
| `cd packages/backend && pnpm vitest run` (full) | 113 files, **112 passed / 1 failed** — the failure is `convex/env.test.ts` (`QUICKBOOKS_*` / `ENV_MANIFEST`), the declared KNOWN RED from Phase 28's 28-06. 3151/3152 tests. |
| `cd packages/core && pnpm vitest run` | 45 / 1457 — matches baseline |
| `cd packages/contracts && pnpm vitest run` | 6 / 99 — matches baseline |
| `cd packages/revenue && pnpm vitest run` | 6 / 226 — matches baseline |
| typecheck: core, contracts, backend, apps/web | all clean |
| `node scripts/run-workflow-pack-evals.mjs --fixtures-only --self-test` | 42 rejections verified, 30 fixtures valid |
| `pnpm --filter @pikar/web build` | **EXIT=0**, `ƒ /dashboard/workflows` in the route table |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | empty stdout (no `"decision":"block"`) — run on the dirty tree |
| `npx biome check` on every file I touched | clean |

---

## WHAT I DID NOT CLOSE — read this part

1. **The authenticated browser gate is UNRUN, and there is no Playwright spec for
   `/dashboard/workflows` at all.** I did not write one: it was not in the findings and
   `apps/web/e2e/` is 29-09's ownership this round. The plan's browser criterion is **not met**.
   An operator who wants it must write `apps/web/e2e/workflows.spec.ts` against the established
   `storageState` pattern, then run it with a live Convex deployment, `E2E_USER_EMAIL` /
   `E2E_USER_PASSWORD`, and a seeded tenant that has at least one ACTIVE pack row — with no active
   `pack-*` row in `skills`, `listPacks` returns `[]` and the route renders only "No workflows are
   switched on for your account yet."

2. **The container's handlers are proved by SOURCE SCAN, not by behaviour.** `apps/web` has no DOM
   runner, so there is no click and no typing here. Choosing a pack, submitting, and adopting the
   server's `currentBaseVersion` are pinned by three `toContain` scans that the test file labels as
   mechanism coverage in as many words. `prefillFrom` itself is unit-tested (it is a parser at a
   trust boundary, not copy). The end-to-end path — open form → save → get refused → save again and
   succeed — has **never been executed**. The server half of it is covered in
   `workflowPackDiscovery.test.ts`; the browser half is not.

3. **I changed two files outside the three I was told I own**, deliberately, and both are inside
   `docs/playbooks/workflow-packs.md`'s watched prefixes and in neither sibling's ownership list:
   - `packages/backend/convex/workflowPackDiscovery.ts` + `.test.ts` — the base-version defect
     cannot be fixed client-side. The truncation is structurally **undetectable** from
     `myUserSkills`' output, because the `author` filter runs *after* `.take(50)`, so a truncated
     list and a genuinely short one look identical to the client. Adopting the refusal's
     `currentBaseVersion` alone would still have left the first render lying about lineage.
   - `packages/backend/scripts/run-workflow-pack-evals.mjs` — the one-line `main()` guard, which is
     what made deleting 130 lines of duplicated traversal possible.
   `git log` showed neither file had been touched by this wave before I started.

4. **`docs/playbooks/workflow-packs.md`'s Task-2 finding paragraph is retracted in place, and the
   commit message `99d5023` that carries the same false sentence cannot be changed.** Anyone reading
   git history will still find "`stageFor` plants exactly two things" there. The playbook now names
   that paragraph as retracted and points at the correct account.

5. **The four fixtures whose injection lives outside the harness are still unplanted.**
   `business-pulse-04` and `process-sop-05` describe an injection in a stored document,
   `campaign-plan-05` / `sales-call-prep-05` in a live web page; the harness controls neither, so
   those four score as ordinary cases. Closing it needs edits to `vaultSmoke.ts`, the fixture JSONs
   and the `casesHash`/`caseCount` in `packages/contracts/src/skill.ts` — none of which is this
   round's. The list is pinned as a LITERAL so a fix turns it red.

6. **A published pack customization remains INERT.** `planTenantActivation` refuses every `pack-*`
   name and `cockpit.ts` passes no `tenantSkillIds`, so nothing a user starts reads what they saved.
   The surface says exactly that, once, and the `cockpit.ts` half is now cited by a test. This is
   the shipped state, not a defect I left.

---

## Follow-ups for another agent's files

- `packages/backend/convex/env.test.ts` is red on `QUICKBOOKS_CLIENT_ID` /
  `QUICKBOOKS_CLIENT_SECRET` / `QUICKBOOKS_REDIRECT_URI` missing from `ENV_MANIFEST`. Declared not
  mine; unchanged by this round.
- `apps/web/vitest.config.mts`'s header says a `.tsx` "cannot be RENDERED here" and points at
  jsdom + testing-library as the upgrade path. That is now only half true: `react-dom/server`
  renders a component in the node environment with no new dependency, which is what this round
  used. Whoever owns that file may want to say so; the DOM claim it needs is about *interaction*,
  not rendering.
