---
phase: 21-user-authored-skills-and-routines
plan: 02
subsystem: skill-registry
requirements: [SKILL-01]
requirement_status: OPEN — deliberately not marked complete
tags: [tenant-overlay, candidate-only, provenance, effective-loader, workspace-panel]
dependency_graph:
  requires:
    - "21-01: USER_AUTHORABLE_SKILLS / USER_AUTHORABLE_SKILL_METADATA / isUserAuthorableSkill"
    - "21-01: USER_SKILL_ADAPTATION_MAX_BYTES / composeUserSkillBody"
    - "21-01: tenantSkills table + 4 indexes"
  provides:
    - "skills.publishUserCandidate (tenantMutation, args = {name, authoredBody})"
    - "skills.myUserSkills (tenantQuery, bounded, no ids)"
    - "skills.loadEffectiveSkill / skills.getEffectiveSkill (internalQuery)"
    - "allocateImmutableVersion — the one next-version rule for both registry scopes"
    - "llm.runSpecialistTurn consumes the tenant overlay"
    - "SkillAuthoringPanel + its source contract"
  affects: ["21-03", "21-04", "21-05", "21-06", "21-07"]
tech_stack:
  added: []
  patterns:
    - "one allocation rule, two differently-indexed scopes"
    - "composition core != lineage base"
    - "MockLanguageModelV4 doGenerate-as-function to read the prompt the model received"
key_files:
  created:
    - apps/web/app/(app)/dashboard/workspace/SkillAuthoringPanel.tsx
    - apps/web/app/(app)/dashboard/workspace/skillAuthoring.test.ts
  modified:
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/runCockpitAgent.test.ts
    - apps/web/app/(app)/dashboard/workspace/page.tsx
    - docs/playbooks/skill-registry.md
    - docs/playbooks/cockpit.md
metrics:
  commits:
    - "cd78145 — publisher + shared allocation core (2 files, +835 / -10)"
    - "7d43f47 — runtime overlay in runSpecialistTurn (2 files, +157 / -3)"
    - "04b6b8a — workspace authoring panel (3 files, +458 / -0)"
    - "697e278 — playbooks + 21-02-PLAN.md (3 files, +392 / -0)"
  files_changed: 10
  insertions: 1842
  deletions: 13
  spend_usd: 0.00
  completed: 2026-08-10
---

# Phase 21 Plan 02: Tenant Candidate Write/Read and Effective Loading Summary

A signed-in user can now publish a bounded business adaptation as an immutable tenant candidate, and
an ACTIVE tenant row now reaches the real specialist model call — while nothing was evaluated,
activated, or spent.

---

## Measured Results

Every number below was read off a command run in this session. Nothing is estimated.

| Gate | Command | Result |
|---|---|---|
| Registry suite (Task 1+2) | `pnpm exec vitest run convex/skills.test.ts --maxWorkers=1` | **65/65 passed** (was 53/53 at plan start; +12) |
| Task 2 verify (exact plan command) | `… vitest run convex/skills.test.ts convex/runCockpitAgent.test.ts --maxWorkers=1` | **95/95 passed** |
| Backend regression set | `… vitest run skills + runCockpitAgent + dispatch + importGuard --maxWorkers=1` | **243/243 passed**, 4 files |
| Guard suites | `… vitest run importGuard + auditImmutability + llmRedaction --maxWorkers=1` | **138/138 passed** |
| Web authoring test (Task 3) | `pnpm --filter web exec vitest run '…/skillAuthoring.test.ts'` | **12/12 passed** |
| Full web suite | `pnpm --filter web exec vitest run` | **188/188 passed**, 11 files |
| Contracts suite (21-01 regression) | `pnpm --filter @pikar/contracts exec vitest run` | **31/31 passed**, 3 files |
| Backend typecheck | `pnpm typecheck` (packages/backend) | exit **0**, twice |
| Web typecheck | `pnpm typecheck` (apps/web) | exit **0**, twice |
| Playbook checker | `node scripts/check-playbooks.mjs check` | exit **0** |
| Whitespace | `git diff --check` | exit **0** |
| Biome, owned backend files | `biome check convex/skills.ts convex/skills.test.ts` | exit **0** |
| Biome, owned web files | `biome check SkillAuthoringPanel.tsx skillAuthoring.test.ts page.tsx` | exit **0** |
| **Model spend** | — | **$0.00 — no model call, no eval run, no `--skill` pin, no activation** |

The backend typecheck did **not** reproduce 21-01's OOM (exit 134) in this session: three runs, all
exit 0, all under `--max-old-space-size=8192`.

`biome check` on `convex/llm.ts` and `convex/runCockpitAgent.test.ts` exits **1** — but it exits 1 on
those same two files at `HEAD` before my changes too (measured by stashing and re-running), and the
warning count on `runCockpitAgent.test.ts` is **20 before and 20 after**. I added zero. Both are
`lint/style/noNonNullAssertion` in the pre-existing test idiom. `skills.ts` I cleaned to exit 0,
including removing the one non-null assertion my own code introduced.

---

## What Was Built

### Task 1 — the publisher and the one allocation rule (`skills.ts`, +297)

`allocateImmutableVersion(newest, duplicate)` is the whole next-version contract for **both**
registry scopes: a body that byte-matches the newest row in scope mints nothing, anything else
becomes `newest.version + 1`, a prior row is never patched. The global `insertCandidate` (the
SkillOpt write-back) now routes through it and is behaviour-identical — its own guard makes `rows`
non-empty, so `newest.version + 1` is exactly the `maxVersion + 1` it replaced, and its three
existing tests stayed green throughout.

It takes the newest **row** rather than reading it, because the two scopes are indexed differently
and only the rule is shared: global reads `by_name_status` and collects (a bounded registry, its
existing behaviour), tenant reads `by_tenant_name_version` with `.order("desc").take(1)`.

`publishUserCandidate` is a `tenantMutation` whose args are `{name, authoredBody}` and nothing else.
Tenant, author, `authorUserId`, status, version, evidence, `rollbackEligible`, the base body and the
composed body are all derived server-side, so Convex's arg validator is the refusal boundary: a
caller cannot even *name* a field it does not own. The test drives nine separate spoof attempts
(`tenantId`, `authorUserId`, `author`, `status`, `version`, `rollbackEligible`, `evidence`,
`basedOnVersion`, `body`) and asserts zero rows were written by any of them, with a clean publish on
the next line as the positive witness.

**The defect this plan's own test caught, before the code shipped.** My first implementation composed
the new body against `loadEffectiveSkill(...)`, i.e. against the tenant's *active* row — which is
what the plan's prose says ("Later publication bases on the tenant's active row"). The tenant's
active body already contains its own adaptation, so the second publication produced a body with
**two** `## Tenant-authored business adaptation` markers and the first draft's needle still in it.
That is research pitfall 5 arriving on the second edit and compounding forever. The fix splits two
things the plan's wording conflates:

- the **composition core** is the *global active body* (`loadSkill`). It is the only body in the
  system that provably carries no tenant adaptation, because nothing can write one into `skills`.
- the **lineage base** is the tenant's *effective* row (`loadEffectiveSkill`) — the row this
  candidate supersedes, which is what `basedOnScope` / `basedOnVersion` / `basedOn*Id` record and
  what 21-03 will pin evidence to.

The consequence is written into `skill-registry.md` because 21-03 depends on it: **a candidate based
on a tenant row records the superseded TENANT version in `basedOnVersion`, not the core version.**
21-03 must read the core from the global active row at eval time.

The first customization writes two rows in one transaction: a `system` / `authoredBody: ""` /
`archived` / `rollbackEligible: true` baseline that is a byte copy of the core, then the user
candidate at v2. A tenant that already has history gets no new baseline — it is a first-customization
artifact, and the 200-version case asserts 201 rows rather than 202.

Idempotence is bytes **and** lineage: a repost matches only when the newest row is a `user`
`candidate` whose trimmed `authoredBody` and whose `basedOnScope`/`basedOnVersion` all match. The
test reposts with leading/trailing whitespace to prove the comparison is against the trimmed stored
text. An idempotent repost mints no version and writes no second audit event.

The `basedOn*Id` cross-field invariant is **structural, not checked**: `lineageOf(base)` returns one
of two object shapes keyed off the base's own `scope` discriminant, so a row whose scope and lineage
id disagree is not constructible.

`myUserSkills` takes **no arguments** — there is no id to point at another tenant — and returns
exactly `name, label, authoredBody, version, status, baseScope, baseVersion, gatePassed, createdAt`.
The test pins that key set by equality and asserts the serialized payload contains neither the global
body, nor the section marker, nor the other tenant's needle.

### Task 2 — the runtime (`llm.ts`, +11 / −3)

One line changed in `runSpecialistTurn`: the ordinary active-body read is now
`internal.skills.getEffectiveSkill({tenantId, name})`. The exact-**version** pin branch stays global
on purpose — moving it would silently re-point the eval runner's `--skill name@version` at a tenant
row, and tenant pins are 21-03's. Nothing else was threaded: `runCockpitAgent`, voice, inbox, reply,
extraction, blueprint and vault loaders all still call `getActiveSkill`, and only the three
`USER_AUTHORABLE_SKILLS` can have an overlay row at all.

The proof reads the prompt the **model** received, not the reply. `MockLanguageModelV4` accepts a
`doGenerate` *function* as well as the usual scripted array (`ai/dist/test`), so the test passes a
capture through the **existing** `mockScript` seam and pulls the `system` message out of the
provider-level call options. Tenant A's overlay arrives byte for byte; tenant B gets the global body
byte for byte. B also holds its own **candidate** carrying the same needle, so B's clean prompt is
evidence about `status`, not only about `tenantId`. And `SPECIALISTS["offer-architect"].tools` is
identical for both tenants and equal to the code-owned spec — ADR-007: a prompt row advises
behaviour, it never grants capability.

### Task 3 — the panel (`SkillAuthoringPanel.tsx`, 225 lines)

A card in the chat pane, opened from the **existing** Chat options menu. No route, no nav entry, no
component library, no new dependency. It calls exactly two functions and renders regardless of
mailbox state (adapting a skill has nothing to do with a connected inbox).

`skillStateLabel` is what keeps the surface honest: a fresh candidate reads *"Draft saved — waiting
to be evaluated. Nothing has changed yet."*, a passing one reads *"Evaluation passed — waiting for
Pikar to approve it"*, and only an `active` row may say *"uses now"*. The byte counter uses the same
UTF-8 measure the server caps on, so a multibyte paste cannot sail past the disabled check and be
refused server-side instead.

`skillAuthoring.test.ts` **strips comments before scanning**. Without that, the panel's own note
explaining that there is no Activate control fails the no-Activate scan, and the only way to green it
would be to delete the explanation — a guard weakened to accommodate itself. The test asserts the
mount site exists in `page.tsx` (a panel with no call site is invisible to every green suite here),
and its menu-slice assertion carries an explicit non-vacuity floor because the first `</HeaderMenu>`
in the file belongs to `PastChats` — a plain `indexOf` returns an empty slice and passes vacuously.

---

## Mutation Proofs

Every mutation was applied, run, its verbatim red recorded, then reverted from a byte-exact
pre-mutation copy. `git diff --stat` after restoration showed no residue on any file.

### The 21-VALIDATION.md ledger rows owned by this plan

| # | Exact mutation | Observed red (verbatim) | Restored |
|---|---|---|---|
| 1. Candidate tenant predicate | newest-candidate lookup → `.filter(q.eq(name))`, no tenant scoping | `FAIL … two tenants: identical name and version, zero crossover` — `AssertionError: expected [ { …(16) } ] to have a length of 2 but got 1`; **2 failed \| 63 passed** | yes — 65/65 |
| 2. Candidate-only status | candidate insert `status: "candidate"` → `"active"` | `FAIL … first publication: ONE server baseline + ONE user candidate, and NOTHING goes live` — `AssertionError: expected 'active' to be 'candidate'`; **3 failed \| 62 passed** | yes — 65/65 |
| 3. Authenticated provenance | added `authorUserId: v.optional(v.id("users"))` to args, used `authorUserId ?? ctx.userId` | `FAIL … provenance + authority come from the authenticated context, never from arguments` — `AssertionError: promise resolved "{ inserted: true, …(4) }" instead of rejecting`; **1 failed \| 64 passed** | yes — 65/65 |
| 7. Effective-loader isolation | `loadEffectiveSkill` overlay read → `.filter(name && status)`, no tenant scoping | `FAIL … tenant A's active adaptation reaches A's specialist prompt and NEVER B's` — `AssertionError: expected 'OFFER ARCHITECT CORE plus adaptation …' to be '# Offer Architect (v1)…'`; **2 failed \| 93 passed** | yes — 95/95 |
| 8. Global fallback | `loadEffectiveSkill` throws `NO_ACTIVE_SKILL` instead of calling `loadSkill` | **12 failed \| 83 passed**, incl. `FAIL … a tenant with no overlay still loads the global row` and `AssertionError: expected [Function] to throw error matching /USER_SKILL_ADAPTATION_REQUIRED/ but got 'NO_ACTIVE_SKILL: offer-architect'` | yes — 95/95 |
| 9. Initial rollback baseline | deleted the baseline `insert`, kept the version bump | `FAIL … first publication` — `AssertionError: expected [ { …(16) } ] to have a length of 2 but got 1`; **4 failed \| 61 passed** | yes — 65/65 |
| 12a. Candidate audit privacy | added `authoredBody: authored` to the publish payload | `FAIL … the publish audit row is refs-only` — `AssertionError: expected [ 'author', 'authoredBody', …(8) ] to deeply equal [ 'author', 'authoredBytes', …(7) ]`; **1 failed \| 64 passed** | yes — 65/65 |
| *(additional)* bounded allocation | `.order("desc").take(1)` → `.collect()` + last element | `FAIL … the tenant allocation reads ONE descending indexed row — never a history .collect()` — `AssertionError: expected 'export const publishUserCandidate = t…' to contain '.order("desc")'`; **1 failed \| 64 passed** | yes — 65/65 |

**Mutations 1 and 7 could not be applied as the ledger literally words them.** Both index field
orders (`by_tenant_name_version` = `[tenantId, name, version]`,
`by_tenant_name_status` = `[tenantId, name, status]`) put `tenantId` first, so deleting the
`.eq("tenantId", …)` does not compile — the equality cannot be dropped while keeping the index. Each
was applied as its behavioural equivalent: the indexed read replaced by an unindexed `.filter()` on
the non-tenant fields, which is precisely "this query no longer scopes by tenant". Mutation 1 also
turns the bounded-allocation source contract red as a side effect; the row above records the
collision test, which is the one the ledger names.

**Mutation 4 is the reason the source contract exists.** With `.collect()` in place, the behavioural
200-version test *still passes* — it returns 201 either way. Only the source assertion fires. That is
written into the test's own comment so nobody later deletes the "redundant" scan.

### Panel mutations (Task 3)

| Mutation | Observed red | Restored |
|---|---|---|
| add an `Activate` button + `useMutation(api.skills.activateCandidate)` | `AssertionError: the authoring panel references activateCandidate: expected … not to contain 'activateCandidate'`; **1 failed \| 11 passed** | yes — 12/12 |
| render `{s.body}` instead of `{s.authoredBody}` | `AssertionError: the authoring panel exposes .body: expected … not to contain '.body'`; **1 failed \| 11 passed** | yes — 12/12 |
| `skillStateLabel` returns "Live …" for a candidate | **3 failed \| 9 passed** — `expected 'Live — this is what your agent uses n…' to contain 'Draft'`, `… to contain 'Evaluation passed'`, `expected 3 to be 4` | yes — 12/12 |

### Anti-vacuity

No zero/absence assertion in this plan stands alone:

- "no tenant row is active" sits beside the two rows that *were* written and the still-live global v7.
- "a refusal writes nothing" (0 rows, 0 audit) sits beside an **at-cap** 4000-byte adaptation being
  accepted on the next line — so the zeros are the refusals, not an empty fixture.
- "B's needle is not in A's `myUserSkills`" sits beside `expect(serialized).toContain(NEEDLE_A)`.
- the audit needle scan over `audit` + `deadLetters` ends with
  `expect(everything).toContain(payload.bodyHash)` — proof the scan actually read the row.
- B's clean specialist prompt is asserted *equal to the global body*, and `a.system !== b.system`, so
  neither equality is trivially the other.
- the panel scans each pair a forbidden string with a positive witness in the same test
  (`useMutation(api.skills.publishUserCandidate)`, `s.authoredBody`, `skillStateLabel(s)`).

---

## NOT DONE AND NOT CLAIMED

**SKILL-01 is deliberately not marked complete.** Concretely, as of `697e278`:

- **No tenant row can become `active` through any code path.** There is no tenant activation, no
  tenant rollback, and `activateSkillVersion` still only knows the global `skills` table. Every test
  in this plan that needs an active overlay **patches the row directly with `ctx.db.patch`**, and
  the panel's `"Live — this is what your agent uses now"` copy is currently unreachable in
  production. That is 21-04's work and none of it is claimed here.
- **No evaluation, no evidence, no spend.** `$0.00`. No golden run was started, no `--skill` or
  `--tenant-skill` pin exists, `recordEvalEvidence` is untouched, and `gatePassed` has only ever been
  observed as `false`. The eval gate was **not** run — a standing do-not-rerun order is in force and
  this plan needed no gate run.
- **Tenant eval evidence is still ambiguous by design.** The two-tenant test deliberately creates the
  collision (both tenants hold `offer-architect@2`) that 21-03 must resolve with an exact candidate
  id. Nothing here resolves it.
- **`basedOnVersion` on a tenant-based candidate is the SUPERSEDED tenant version, not the core
  version.** 21-03 must read the composition core from the global active row rather than inferring it
  from lineage. Recorded in `skill-registry.md`; no schema field was added for it (21-01 froze the
  schema, and adding one is an architectural decision this plan had no mandate for).
- **No browser proof.** `skillAuthoring.test.ts` is a **source-text scan**: `apps/web`'s vitest config
  is node-only with no jsdom and no testing-library, and that config documents adding them as a
  deliberate upgrade. It proves the shipped source contains and lacks exact things. **It proves
  nothing about pixels, layout, keyboard focus order, responsive behaviour, or that the panel renders
  at all.** No Playwright spec was written or run; the browser proof is 21-06's.
- **No `savedPrompts` work.** No pinned prompts, no `savedPrompts.ts`, no Run control. 21-05.
- **The `--inspect-tenant-skill` inspector, `smoke:userSkillRuntimeAttribution`, and the runtime
  audit attribution do not exist.** 21-03.
- **The `myUserSkills` `MY_USER_SKILLS_LIMIT = 50` cap is a `take`, not pagination.** A tenant with
  more than 50 rows silently sees only the newest 50. That is honest for v0 (a tenant reaching 50
  adaptations is a product signal, not a bug) but it is a cap, not a page.
- **`llm.ts` is the only runtime caller changed.** `dispatch.ts` was not touched; it reaches the
  overlay only because it calls `runSpecialistTurn`. No other agent on the deployment sees a tenant
  body.

---

## Deviations

**Rule 1 (bug) — the recursive-composition defect, found and fixed inside Task 1.** Documented in
full above. It was my own first implementation, caught by the plan's own non-recursion assertion
before any commit. The fix is the composition-core / lineage-base split; no schema change was needed.

**Rule 3 (blocking) — two ledger mutations are not literally applicable.** Index field order makes
"remove the `tenantId` equality" non-compiling for mutations 1 and 7. Applied as behavioural
equivalents (unindexed filter). Flagged rather than silently substituted.

**Rule 3 (blocking) — my own first test scans were too blunt.** The panel scan for the bare words
`Activate`, `evidence`, `owner` and `eval` fired on the panel's own *comments* and on the legitimate
user-facing word "Evaluation". Fixed by stripping comments before scanning (so the guard cannot be
weakened by deleting the documentation that trips it) and by replacing the `eval` substring with the
fixture/corpus tells that actually indicate held-out data leaking (`fixture`, `golden`, `eval-case`,
`evalCase`). Also fixed one genuinely vacuous assertion of my own: the Chat-options menu slice used
`page.indexOf("</HeaderMenu>")`, which finds `PastChats`' earlier close tag and yields an empty
string that "contains" nothing — it now searches from the menu's start and asserts a length floor.

**Rule 3 (blocking) — biome formatting on owned files.** `biome check --write` scoped to the five
files this plan owns. Backend and web owned files then exit 0; `llm.ts` and `runCockpitAgent.test.ts`
exit 1 both before and after my changes with an identical warning count (measured by stash).

**Process — `21-02-PLAN.md` was untracked.** Committed in `697e278` alongside the playbooks so code
does not land ahead of the plan authorizing it (the 21-01 precedent). Only `21-02-PLAN.md`;
21-03…21-07 remain untracked and untouched.

**Shared-tree incident — a foreign lane staged `.planning/ROADMAP.md` into the shared index during
this session.** Detected by `git diff --cached --stat` immediately after the Task-3 commit (2758
lines changed, not mine). It did **not** enter any of my commits: every commit here used
`git commit -- <explicit paths>`, which takes those paths from the working tree and ignores the rest
of the index. I did not unstage it — it is another lane's staged work and reverting it would be the
same class of interference. **No `git add -A` / `git add .` / `git add <dir>` was run.** The only
`git add` was two explicit new file paths, immediately followed by a pathspec commit in the same
shell invocation to close the race window. `.git/MERGE_HEAD` was checked before every commit and was
absent every time. All four commits were verified surviving with
`git merge-base --is-ancestor <sha> HEAD` after each one, and again at the end.

**`.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` and
`docs/governance/iso-9001-conformance-map.md` were NOT modified or staged.** See "State handoff"
below for what I would have written.

**No playbook false positive occurred.** `node scripts/check-playbooks.mjs check` exited 0 both
before and after the playbook commit, and both playbooks I touched are genuine owners of files this
plan changed (`skills.ts` → `skill-registry.md`; `llm.ts` + `workspace/` → `cockpit.md`). No
date-bump-only entry was needed, and none was written. `watch.json` needed no change: the two new web
files fall under `cockpit.md`'s existing `apps/web/app/(app)/dashboard/workspace/` prefix.

**No Rule 2 or Rule 4 deviations.** Nothing was missing that correctness or security required beyond
what the plan specified, and nothing architectural was in question — the one judgement call
(composition core vs lineage base) resolved inside the existing schema with no new field, no new
table and no new dependency.

---

## Graph

`graphify update .` rebuilt **15852 nodes / 18138 edges / 1598 communities**;
`node scripts/extract-convex-edges.mjs` re-injected **+432 convex edges, +64 table edges (39 tables)**
and removed 9338 noise nodes. `graphify-out/` was **not staged** — it is a shared generated artifact
carrying other lanes' uncommitted state.

---

## State handoff (NOT written — other lanes own these files)

`.planning/STATE.md` and `.planning/ROADMAP.md` both carry another lane's uncommitted edits, so I did
not touch or stage either. What I would have written:

- **STATE.md** — Current Plan advances 21-02 → 21-03; Stopped At: `Completed 21-02-PLAN.md`; add
  decision: *"21-02: a tenant candidate composes against the GLOBAL active core and takes its LINEAGE
  from the tenant effective row — collapsing the two appends every prior draft on re-edit."*; add
  decision: *"21-02: no tenant row can become active until 21-04; the panel's 'Live' state is
  unreachable in production."*
- **ROADMAP.md** — Phase 21 plan progress 1/7 → 2/7 complete; phase status stays in-progress.
- **REQUIREMENTS.md** — **SKILL-01 stays OPEN.** Do not check it off: eval evidence (21-03), owner
  activation and rollback (21-04), saved prompts (21-05), the browser checkpoint (21-06) and the live
  gate (21-07) are all outstanding. This plan is owned by the phase-25 lane and was not modified.

---

## Next

**21-03** needs three things from this plan: the exact tenant candidate id as the evidence target
(name@version is now genuinely ambiguous — the two-tenant test proves it), the note that the
composition core must be read from the global active row rather than inferred from `basedOnVersion`,
and `getEffectiveSkill`'s returned `scope` + `skillId` for runtime attribution. **21-04** owns the
only thing that can make any of this reach a user: there is currently no way to activate a tenant
row.

## Self-Check: PASSED

- `packages/backend/convex/skills.ts` — FOUND (+297 in `cd78145`)
- `packages/backend/convex/skills.test.ts` — FOUND (+548)
- `packages/backend/convex/llm.ts` — FOUND (+11 / −3 in `7d43f47`)
- `packages/backend/convex/runCockpitAgent.test.ts` — FOUND (+149)
- `apps/web/app/(app)/dashboard/workspace/SkillAuthoringPanel.tsx` — FOUND (created, 225 lines, `04b6b8a`)
- `apps/web/app/(app)/dashboard/workspace/skillAuthoring.test.ts` — FOUND (created, 213 lines)
- `apps/web/app/(app)/dashboard/workspace/page.tsx` — FOUND (+20)
- `docs/playbooks/skill-registry.md` — FOUND (+67, zero deletions)
- `docs/playbooks/cockpit.md` — FOUND (+51, zero deletions)
- `.planning/phases/21-user-authored-skills-and-routines/21-02-PLAN.md` — FOUND (274 lines, newly tracked)
- Commits `cd78145`, `7d43f47`, `04b6b8a`, `697e278` — all four verified with
  `git merge-base --is-ancestor <sha> HEAD` **after this summary was written**
