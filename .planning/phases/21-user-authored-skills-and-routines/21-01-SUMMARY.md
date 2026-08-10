---
phase: 21-user-authored-skills-and-routines
plan: 01
subsystem: skill-registry
requirements: [SKILL-01]
requirement_status: OPEN — deliberately not marked complete
tags: [contracts, schema, tenant-overlay, saved-prompts, playbooks]
dependency_graph:
  requires: []
  provides:
    - "USER_AUTHORABLE_SKILLS / USER_AUTHORABLE_SKILL_METADATA / isUserAuthorableSkill"
    - "USER_SKILL_ADAPTATION_MAX_BYTES / USER_SKILL_ADAPTATION_SECTION / composeUserSkillBody"
    - "tenantSkills table + 4 indexes"
    - "savedPrompts table + 2 indexes"
    - "playbook ownership for savedPrompts.ts/test and skillAuthoring.test.ts"
  affects: ["21-02", "21-03", "21-04", "21-05"]
tech_stack:
  added: []
  patterns: ["overlay table over a deployment-global registry", "pure-TS contract + thin schema"]
key_files:
  created:
    - packages/contracts/src/skillAuthoring.test.ts
  modified:
    - packages/contracts/src/skill.ts
    - packages/backend/convex/schema.ts
    - docs/playbooks/skill-registry.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/watch.json
metrics:
  commit: 32f36e3
  files_changed: 7
  insertions: 505
  deletions: 0
  spend_usd: 0.00
  completed: 2026-08-10
  follow_up_commits:
    - "44bcd0d — this summary"
    - "9bef3ec — agent-runtime.md Last-verified bump, foreign-lane false positive (see Deviations)"
    - "98af255 — one-clause accuracy fix to 9bef3ec"
---

# Phase 21 Plan 01: Contracts and Schema Foundation Summary

Closed three-name user-authorable skill set with a byte-capped deterministic body composer, plus an
additive `tenantSkills` overlay and an inert `savedPrompts` table — no public function, no reader, no
writer, no UI, no model call, no eval path, no activation.

---

## Measured Results

Every number below was read off a command run in this session. Nothing is estimated.

| Gate | Command | Result |
|---|---|---|
| Contracts focused test | `pnpm --filter @pikar/contracts exec vitest run src/skillAuthoring.test.ts` | **3/3 passed**, exit 0 |
| Contracts full suite | `pnpm exec vitest run` (packages/contracts) | **31/31 passed**, 3 files |
| Contracts typecheck | `pnpm typecheck` (packages/contracts) | exit **0**, no diagnostics |
| Backend typecheck | `pnpm typecheck` (packages/backend) | exit **0**, no diagnostics (see OOM note) |
| Backend registry suite | `pnpm exec vitest run convex/skills.test.ts --maxWorkers=1` | **53/53 passed**, exit 0 |
| Backend import guard | `pnpm exec vitest run convex/importGuard.test.ts --maxWorkers=1` | **75/75 passed**, exit 0 |
| Playbook checker | `node scripts/check-playbooks.mjs check` | exit **0** |
| Whitespace | `git diff --check` | exit **0** |
| Biome | `biome check` on the 4 owned source/config files | exit **0** |
| Model spend | — | **$0.00** — this plan makes no model call and runs no eval |

Schema diff is **71 lines, all insertions, zero deletions** (`git diff -U0 … | grep "^-" | wc -l` → 0),
so the deployment-global `skills` table definition and both its indexes are byte-unchanged, and no
`routines` table exists.

### Backend typecheck OOM — measured, not hidden

Three plain runs of `pnpm --filter @pikar/backend typecheck` were executed: **exit 0**, then
**exit 134**, then **exit 0**. The 134 run printed `FATAL ERROR: Zone Allocation failed - process out
of memory` and **zero tsc diagnostics** — it is the known Windows heap flake in this repo, not a type
error. Confirmed by a fourth run under `NODE_OPTIONS=--max-old-space-size=8192`: **exit 0**. The
green result is reported on the strength of three exit-0 runs, one of them with headroom; do not read
a 134 here as a red typecheck without diagnostics on the line above it.

---

## What Was Built

### Task 1 — the closed authoring and composition contract (`packages/contracts/src/skill.ts`, +91)

`USER_AUTHORABLE_SKILLS` is an `as const` tuple of exactly `offer-architect`,
`money-model-designer`, `lead-engine`, with `UserAuthorableSkill`, a type-exhaustive
`USER_AUTHORABLE_SKILL_METADATA` (so a UI never re-lists registry names), and an
`isUserAuthorableSkill` type guard.

It is deliberately **kept separate from and narrower than `GATED_SKILLS`**: gating is an activation
policy, authorability is a product decision. The three chosen names are the dispatched business
specialists whose real runtime is `dispatch.runSpecialist` → `llm.runSpecialistTurn`, and held-out
golden fixtures 29/30/31 drive one each — so a tenant candidate has a runner that can clear its gate.
Adding a name whose runner cannot drive it reproduces the `document-analyst` / `media-director`
deadlock already recorded in `skill.ts`, except once per tenant.

`composeUserSkillBody(baseBody, authoredBody)` emits the base verbatim, one fixed
`## Tenant-authored business adaptation` marker, and the trimmed adaptation. It never parses or
strips the base (raw bodies are an owner-only disclosure boundary), never accepts a capability/tool
list (ADR-007 — capability is code), and **throws rather than returning a partial body**, so no
caller can persist an unvalidated adaptation. Non-recursion is structural: the caller passes the
*base*, not a previously composed body, so a new adaptation cannot carry an older one forward.

`USER_SKILL_ADAPTATION_MAX_BYTES = 4000` is a **UTF-8 byte** cap measured with `TextEncoder`, not a
character cap — a character cap lets one multibyte paste carry ~4x the tokens the number implies.
Error strings carry the cap and the measured byte count only, never the authored text (CLAUDE.md §4).

### Task 2 — the additive schema (`packages/backend/convex/schema.ts`, +71)

`tenantSkills`: `tenantId, name, version, body, authoredBody, status, author, authorUserId?,
basedOnScope, basedOnName, basedOnVersion, basedOnGlobalSkillId?, basedOnTenantSkillId?,
rollbackEligible, evidence?, createdAt`, with `by_tenant_name_status`, `by_tenant_name_version`,
`by_tenant_createdAt`, `by_status_createdAt`.

A separate table rather than a migration of `skills`, because `skills` is deployment-global and its
`by_name_status` reads are `.unique()` — tenant rows in that table make every one of those reads
multi-row and break every agent on the deployment. The immutability rule (everything except `status`,
`evidence`, and the code-owned `rollbackEligible` transition) and the two row shapes (server baseline
= `system`/`""`/`archived`/`rollbackEligible: true`; user candidate = `user`/real
`authorUserId`/`candidate`/`rollbackEligible: false`) are written into the schema comment, where the
next implementer will actually read them.

`savedPrompts`: `tenantId, text, title, textHash, createdAt` with `by_tenant_createdAt` and
`by_tenant_textHash`. No `routines` table, cron, trigger, recurrence, next-run timestamp, execution
history, canvas, DSL, or unbounded array was added.

### Task 3 — ownership and the pre-runtime boundary

`watch.json`: `packages/contracts/src/skillAuthoring.test.ts` → `skill-registry.md`;
`packages/backend/convex/savedPrompts.ts` + `savedPrompts.test.ts` → `cockpit.md`. No overlapping
entries; existing `skills.ts`, workspace and ops owners unchanged.

`skill-registry.md` (+54) and `cockpit.md` (+23) each open with an entry stating plainly that nothing
is reachable yet and naming what 21-02/03/04/05 still owe. `cockpit.md` states explicitly that a
saved prompt is inert at rest, that "routine v0" is not a euphemism for a scheduler, and that the
only future execution path is a user click into a fresh ordinary cockpit turn through
`useSendCockpitMessage` with no `threadId`.

---

## Mutation Proofs (both mandated rows in 21-VALIDATION.md's ledger)

The test file existed untracked at plan start (a prior aborted attempt left it behind, uncommitted).
It was **verified red before any implementation was written** — `3 failed (3)`, every failure
`composeUserSkillBody is not a function` / `USER_AUTHORABLE_SKILLS` undefined — so it is not a test
retro-fitted to passing code.

| Mutation | Exact edit | Observed red (verbatim) | Restored |
|---|---|---|---|
| `add cockpit-agent to USER_AUTHORABLE_SKILLS` | prepended `COCKPIT_AGENT_SKILL` to the tuple | `FAIL … keeps the v0 authorable set exact, gated, and exhaustively labelled` — `AssertionError: expected [ 'cockpit-agent', …(3) ] to deeply equal [ 'offer-architect', …(2) ]`; **1 failed \| 2 passed** | yes — 3/3 green |
| `remove UTF-8 byte cap` | `new TextEncoder().encode(authored).length` → `authored.length` | `FAIL … refuses blank and over-cap UTF-8 adaptations at the byte boundary` — `AssertionError: expected [Function] to throw an error … Received: undefined` at line 57; **1 failed \| 2 passed** | yes — 3/3 green |

Both reds were **specific**: the first names the wrong set, the second proves a character cap
silently accepts a 4002-byte multibyte adaptation while the positive witness on the line above
(`expect(new TextEncoder().encode(atCap)).toHaveLength(4000)` plus the at-cap value composing
successfully) proves the boundary case actually executed. `git diff --stat` after restoration showed
`91 insertions(+)` on `skill.ts` and nothing else — no mutation residue reached the commit.

Anti-vacuity: no zero/absence assertion in this test stands alone. `isUserAuthorableSkill(COCKPIT_AGENT_SKILL) === false`
sits beside three positive `=== true` assertions; the blank/over-cap throws sit beside a successful
at-cap composition.

---

## NOT DONE AND NOT CLAIMED

This is a foundation plan. **SKILL-01 is deliberately not marked complete.** Concretely, as of this
commit:

- **No user can publish anything.** There is no `publishUserCandidate`, no tenant mutation, no
  public query. `tenantSkills` and `savedPrompts` have **zero writers and zero readers** in the
  entire repo.
- **No runtime uses the overlay.** `loadEffectiveSkill` does not exist. Every agent still loads the
  deployment-global active row exactly as before. Nothing in `llm.ts`, `dispatch.ts` or
  `runCockpitAgent` was touched.
- **`composeUserSkillBody` has no caller.** In this repo a tested function with no caller is
  invisible to every green suite — the 3/3 above proves the contract's *shape*, and proves nothing
  about tenant behaviour. Behavioural proof (isolation, provenance, candidate-only status, rollback
  baseline) is 21-02's, and none of it is claimed here.
- **No eval, no evidence, no activation, no rollback.** No `--tenant-skill` pin, no exact-candidate
  evidence identity, no owner control. $0.00 spent; no golden run was started.
- **No UI, no route, no browser test.** No workspace pin control, no ops review panel, no Playwright
  spec.
- **The schema has no test.** Task 2 is marked `tdd="true"` in the plan but its only stated verify is
  `typecheck`, and the plan's own file list gives it no test file. A test asserting "this table I
  just declared exists" is mechanism coverage with no behaviour behind it — exactly the pattern that
  let this project ship a phase 22/22 green with the feature broken. The honest gates for Task 2 are
  the typecheck, the 53/53 registry suite still passing against the widened schema, and the
  zero-deletion schema diff. **The first real proof of these tables is 21-02's isolation tests.**
- **`v.id("users")` on `authorUserId` is typechecked, not enforced.** Nothing yet guarantees a
  `user`-authored row carries one; that invariant is 21-02's publisher and 21-02's mutation ledger row 3.

---

## Deviations

**Rule 3 (blocking issue) — biome formatting on owned files.** `biome check` reported 3 formatting
errors, all in the pre-existing untracked `skillAuthoring.test.ts` (line-wrapping). Fixed with
`biome check --write` scoped to the four files this plan owns; the focused test was re-run green
afterwards (3/3) and `biome check` re-run clean (exit 0). No other lane's files were formatted.

**Rule 3 (blocking issue) — backend typecheck OOM.** See the measured note above. Worked around with
`--max-old-space-size=8192` for one confirming run; no code or config was changed for it.

**Process deviation — the plan file was untracked.** `21-01-PLAN.md` had never been committed
(`21-RESEARCH.md` and `21-VALIDATION.md` were both already tracked). On the coordinator's instruction
it was included in this plan's commit, so code does not land ahead of the plan authorizing it. The
GSD workflow normally expects the plan file to be committed by the planning step, before execution —
flagging it rather than silently absorbing it. Only `21-01-PLAN.md` was staged; 21-02 … 21-07 remain
untracked and untouched.

**Shared-tree incident — another lane's index entered my first commit, and it was corrected.** The
first commit attempt (`f919dfe`) landed **10 files / 699 insertions / 55 deletions** instead of the
7 / 505 / 0 that `git diff --cached --stat` had shown seconds earlier: between my `git add` call and
my `git commit` call, the 19.1 lane staged `19.1-VALIDATION.md`, `pipeline-uat.spec.ts` and
`contacts-crm.md` into the **shared index**, and `git commit` takes the index as it is at commit
time. There is no pre-commit hook — this was pure concurrency in a tree that is not a worktree.

Corrected by `git reset --soft HEAD~1`, unstaging exactly those three paths plus `cockpit.md`,
re-staging only my own `cockpit.md` block, and running stage-check-commit in **one** shell
invocation to close the race window. Result: **`32f36e3`, 7 files, 505 insertions, 0 deletions.**
`git diff 8642858 32f36e3` (their commit → mine) shows only my seven files with zero deletions, so
the 19.1 lane's committed 179-line spec was not reverted, and their still-uncommitted WIP was
re-staged exactly as found.

**`docs/playbooks/cockpit.md` was staged surgically, not with `git add`.** The working-tree file
carried the 19.1-07 lane's uncommitted playbook entry in the *same* diff hunk as mine. `git add
docs/playbooks/cockpit.md` would have committed their entry. Instead the desired index content was
built explicitly (HEAD + my block only) and installed with `git hash-object -w` +
`git update-index --cacheinfo`, with a guard that throws if the string `19.1-07` appears in the
staged content. Verified: `git diff --cached docs/playbooks/cockpit.md | grep -c "19.1-07"` → **0**,
23 insertions. **No `git add -A` or `git add .` was ever run. `.git/MERGE_HEAD` was checked before
each commit and was absent both times. `.planning/REQUIREMENTS.md` was not modified.**

**Rule 3 (blocking issue) — the Stop hook blocked on a foreign lane's file, and the fix claims
nothing.** After both 21-01 commits landed, `check-playbooks.mjs` began blocking on
`docs/playbooks/agent-runtime.md (changed: packages/backend/scripts/run-eval-golden.mjs)`. That file
is not in either 21-01 commit — `git diff 8642858 44bcd0d` lists only the seven 21-01 paths — and the
change was another lane's then-uncommitted `RETRY_TURN` (`retryOnEmpty: true`) on the **paid**
`attemptCase` turn, reversing the deliberate note above `RETRY_READ` that had confined empty-stdout
retries to free reads. The hook builds its changed-set from the whole working tree, not the session's
diff, so it attributed that lane's edit to this plan.

Cleared with a **date-bump-only** entry (`9bef3ec`), the shape `skill-registry.md` already uses twice
for this exact false positive: it states in its first sentence that nothing was re-verified and that
it documents no change of its own, names the seven paths 21-01 actually touched, and hands the real
entry back to the lane that wrote the change — while flagging the load-bearing assumption for
whoever picks it up (that an empty stdout with no failure banner can *only* be the
`UV_HANDLE_CLOSING` teardown crash; if that is ever false, a real refusal gets silently re-billed).
**I did not run, re-measure, endorse, revert or restage that lane's change.** Committed with an
explicit pathspec (`git commit -- <path>`), which is immune to the shared-index race described
above. `98af255` then corrected one clause: the entry said "it is not committed", and that lane
committed it as `4ea300c` minutes later — a stale claim in a durable record about a paid-spend
policy, so it now points at the commit instead.

**No Rule 1, 2 or 4 deviations.** Nothing of this plan's was found broken, and nothing architectural
was in question.

---

## Graph

`graphify update .` rebuilt 15789 nodes / 18046 edges / 1581 communities;
`node scripts/extract-convex-edges.mjs` re-injected **+428 convex edges, +63 table edges (39 tables)**
and removed 9299 noise nodes. `graphify-out/` was **not staged** — it is a shared generated artifact
with another lane's uncommitted state in it.

---

## Next

**21-02** is the plan that makes any of this real: the `tenantMutation` publisher (candidate-only,
`tenantId`/`userId` from authenticated context, never from args), the atomic first-customization
system baseline, `loadEffectiveSkill` with global fallback, refs-only audit, and the two-tenant
isolation tests. Until it lands, both new tables are empty declarations.

## Self-Check: PASSED

- `packages/contracts/src/skill.ts` — FOUND (91 insertions in `32f36e3`)
- `packages/contracts/src/skillAuthoring.test.ts` — FOUND (created, 57 lines)
- `packages/backend/convex/schema.ts` — FOUND (71 insertions, 0 deletions)
- `docs/playbooks/skill-registry.md` — FOUND (54 insertions)
- `docs/playbooks/cockpit.md` — FOUND (23 insertions, foreign lane's block excluded)
- `docs/playbooks/watch.json` — FOUND (3 insertions)
- `.planning/phases/21-user-authored-skills-and-routines/21-01-PLAN.md` — FOUND (206 lines, newly tracked)
- Commit `32f36e3` — FOUND in `git log`
- Superseded commit `f919dfe` — correctly absent from history
