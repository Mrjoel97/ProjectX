---
phase: 21-user-authored-skills-and-routines
plan: 04
subsystem: skill-registry
requirements: [SKILL-01]
requirement_status: OPEN — deliberately not marked complete
tags: [owner-boundary, two-gates, exact-row-activation, rollback-eligibility, bounded-disclosure, unpaid]
dependency_graph:
  requires:
    - "21-01: tenantSkills table + by_status_createdAt (the cross-tenant owner queue index)"
    - "21-02: publishUserCandidate, the system baseline (rollbackEligible: true, byte copy of the core)"
    - "21-03: hasPassingTenantEvidence, tenantTargetOf, loadTenantCandidate, recordTenantEvalEvidence"
    - "Phase 22: requireOwner / ownerQuery / ownerMutation (users.owner === true)"
  provides:
    - "skills.transitionSkillActivation — ONE status transition for both registry scopes"
    - "skills.tenantCandidatesForReview (ownerQuery, bounded)"
    - "skills.activateTenantCandidate (ownerMutation, {candidateId})"
    - "skills.rollbackTenantSkill (ownerMutation, {targetId})"
    - "audit: skill.user_candidate_activated / skill.user_skill_rolled_back (refs only)"
    - "/ops → Optimizer → User-authored candidates (owner-only diff/activate/rollback)"
    - "importGuard: 7 named owner-gated endpoints (was 4)"
  affects: ["21-06", "21-07", "23"]
tech_stack:
  added: []
  patterns:
    - "one scope-discriminated plan, one shared patch block — the source test COUNTS the activating patch"
    - "rollback eligibility is a COLUMN, not a status, because a superseded draft is also archived"
    - "the disclosure surface pinned by returned-key-set EQUALITY, not by what the UI happens to read"
key_files:
  created:
    - apps/web/app/(app)/ops/tenantSkillReview.test.ts
  date_bumped_claiming_nothing:
    - docs/playbooks/cockpit.md
    - docs/playbooks/dashboard-pages.md
  modified:
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/importGuard.test.ts
    - apps/web/app/(app)/ops/page.tsx
    - docs/playbooks/skill-registry.md
    - docs/playbooks/authorization.md
    - docs/playbooks/cockpit.md
metrics:
  commits:
    - "18d8bca — the shared transition + tenant activation/rollback + tests (3 files, +1083 / -11)"
    - "70d54e3 — the owner review surface on /ops (2 files, +447 / -0)"
    - "3166544 — playbooks + 21-04-PLAN.md (4 files, +567 / -9; 102 of those lines are 17-05's, swept in — see Shared-tree)"
    - "d49f6dc — separate the swept-in 17-05 entry from mine (1 file, +7)"
    - "b9ecdbd — this summary (1 file, +503)"
    - "1a51259 — the SECOND cockpit.md Stop-hook false positive, still claiming nothing (1 file, +6)"
    - "3a93124 — a THIRD false positive, on dashboard-pages.md, claiming nothing (1 file, +17 / -1)"
  files_changed: 10
  insertions: 2630
  deletions: 21
  spend_usd: 0.00
  completed: 2026-08-11
---

# Phase 21 Plan 04: The Owner Boundary Summary

**A tenant row can now become `active`.** 21-02 and 21-03 both closed with the sentence "no tenant
row can become active through any code path"; that sentence is false as of `18d8bca`. It takes an
owner *and* eval evidence pinning that exact row, both gates are separately proven, and **nothing
was activated live, no tenant candidate has ever passed a real eval run, and $0.00 was spent.**

---

## Measured Results

Every number below was read off a command run in this session. Nothing is estimated.

| Gate | Command | Result |
|---|---|---|
| Task 1 verify (exact plan command) | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts convex/importGuard.test.ts --maxWorkers=1` | **165/165 passed** (skills 72→**86**, +14; importGuard 76→**79**, +3) |
| Task 2 verify (exact plan command) | `… vitest run convex/skills.test.ts --maxWorkers=1` | **86/86 passed** |
| Task 3 verify (exact plan command) | `pnpm --filter web exec vitest run 'app/(app)/ops/tenantSkillReview.test.ts' && pnpm --filter web typecheck` | **15/15 passed**, then `tsc --noEmit` exit **0** |
| Task 4 verify (exact plan command) | `node scripts/check-playbooks.mjs && git diff --check` | exit **0**, empty output |
| Backend regression set | `… vitest run skills + importGuard + dispatch + runCockpitAgent + auditImmutability + llmRedaction + savedPrompts + owner + tenant --maxWorkers=1` | **362/362 passed**, 9 files |
| Full web suite | `pnpm --filter web exec vitest run` | **220/220 passed**, 13 files |
| Contracts suite | `pnpm --filter @pikar/contracts exec vitest run` | **31/31 passed**, 3 files |
| Web typecheck | `pnpm --filter web typecheck` | exit **0**, three separate runs |
| Backend typecheck | `npx tsc --noEmit -p tsconfig.json` | exit **0** at first implementation; **3 diagnostics at the end, all in the 17-05 lane's `convex/calendar.test.ts`** — see Deviations. **Zero in any file this plan owns**, every run. |
| Eval self-check (the ONLY permitted eval invocation) | `pnpm --filter @pikar/backend eval:golden -- --self-check` | **PASSED**, exit **0**, 36 fixtures, 12 gated skills |
| Whitespace | `git diff --check` on every path touched | exit **0** |
| Biome, owned files | `biome check convex/skills.ts convex/importGuard.test.ts` | exit **0**, **0 warnings** |
| Biome, test files | `biome check convex/skills.test.ts` | 0 errors, **38 warnings**, all `lint/style/noNonNullAssertion` (29 at 21-03's end; the 9 added are the pre-existing fixture idiom) |
| Biome, web files | `biome check ops/page.tsx ops/tenantSkillReview.test.ts` | 0 errors, **1 warning** (`noTemplateCurlyInString`, intentional — the assertion is *about* source text containing a template literal) |
| **Model spend** | — | **$0.00 — no model call, no paid eval, no `--skill` or `--tenant-skill` run, no activation on any deployment** |

**THE EVAL GATE WAS NOT RUN.** The standing do-not-rerun order was honoured. The only eval
invocation is the free `--self-check`, run with the command 21-03's playbook actually specifies
(`pnpm --filter @pikar/backend eval:golden -- --self-check`) rather than a paraphrase of it — 21-03's
own `--` separator bug is why that distinction is written down.

**A different lane ran the paid gate this session** (`107ee875`, 36/36, $0.4047, global
`cockpit-agent v1` on cloud dev `woozy-wren-368`, recorded in `skill-registry.md`). That is **not
mine, and it certifies no tenant row.** My playbook entry says so explicitly, because a reader
skimming two adjacent green entries would otherwise conclude the tenant path had been proven live.

---

## What Was Built

### Task 1 — one transition for two scopes (`skills.ts` +376 / −11)

`transitionSkillActivation(ctx, target)` where target is exactly `{scope:"global",name,version}` or
`{scope:"tenant",candidateId,mode:"activate"|"rollback"}`. Two scope planners produce an
`ActivationPlan`; one shared block applies it:

```ts
if (plan.currentId !== null && plan.currentId !== plan.targetId)
  await ctx.db.patch(plan.currentId, { status: "archived", ...plan.provenActive });
if (!plan.alreadyActive)
  await ctx.db.patch(plan.targetId, { status: "active", ...plan.provenActive });
```

`provenActive` is `{rollbackEligible: true}` in the tenant scope and `{}` in the global one —
`rollbackEligible` is a `tenantSkills` column and the global registry has no such field. That spread
is the whole reason the two patches could stay in one block instead of being copied per scope.

`activateSkillVersion(ctx,name,version)` survives as a three-line wrapper, so `activateSkill` and
`activateCandidate` are **behaviour-identical**: all 72 pre-existing `skills.test.ts` tests were
green through the refactor, unchanged, before a single new test was written.

**`requireOwner` is deliberately NOT in the helper.** It is also the identity-free path for the eval
runner and seeding, and gating it would break them while conflating two orthogonal questions
(`authorization.md` invariant 9, now restated as invariant 12 for the tenant scope). The audit write
therefore lives in the public wrapper, where `ctx.userId` exists.

**The tenant branch's refusal order is load-bearing.** Idempotence is decided FIRST — a row that is
already `active` is a no-op, and checking `status === "candidate"` before that would make
re-activation throw instead of returning `changed: false`.

### Task 2 — rollback eligibility (`skills.ts`, same commit)

The global scope's rollback exemption is **status alone**: an `archived` row in `skills` was live,
because nothing else in that table produces the status. **In `tenantSkills` that reasoning does not
transfer** — a superseded draft is also archived and has never been live — so status-only would
launder a pending candidate straight around the eval gate. The proof is `rollbackEligible === true`,
written in exactly two places: the shared patch block when a row actually goes live, and the
`system` baseline `publishUserCandidate` mints on a tenant's first customization (a byte copy of the
code-owned core, which is *why* it is evidence-exempt). Status is checked too, never instead.

Rollback never reads evidence. The test deletes the target's evidence entirely before restoring it,
so nothing about the restore can be reading a pin — a broken eval harness must not block an incident.

### Task 3 — the bounded owner queue and the surface

`tenantCandidatesForReview` (ownerQuery) reads `by_status_createdAt` with `.take(25)`, newest first,
filters to `author === "user"`, and per row resolves the tenant's current effective body (the diff
base) plus a bounded `.take(10)` of eligible rollback targets. **Never a deployment-wide
`.collect()`** — this index is cross-tenant by design and the candidate history is open-ended.

Its **returned key set is pinned by equality**, which is not decoration: the next field somebody adds
to this queue is the next field a raw prompt leaks through. That assertion is what makes the
"return the raw evidence string" mutation visible at all (it was green without it), and the same
mutation additionally fails `tsc` with `TS2339: Property 'evidence' does not exist` — the server's
shape is the real boundary and the UI cannot render what is not returned.

`UserCandidatesPanel` lives inside the existing `{isOwner && …}` section — **mounting is the security
act** (22-03's rule, restated in the code comment): the component owns all three owner-only hooks, so
CSS/`hidden`/an early return would each still subscribe. Activate is disabled until `gatePassed` with
a stated reason; rollback offers only the server's eligible list and a stale selection resolves to
nothing rather than to some other row. Evidence renders as refs (run id, counts, cost, model).
Reuses the page's own `unifiedDiff`, `cardShadow` and `globals.css` tokens — no new route, no
component library, no new icon, and no amber (BRAND §2 spends `--held` on the approval gate alone).

### Task 4 — the playbooks

`skill-registry.md` (+89) carries the two-gate rule as a formula, the global-vs-tenant difference as
a table (identity, evidence predicate, rollback exemption, who may activate), the one-transition
contract, tenant/name-locality and why a single-tenant test cannot prove it, the bounded queue, both
audit key sets, operator steps, and an explicit "still unpaid and unobserved".

`authorization.md` (+122 / −8) gains invariants 10–12, the tenant owner-surface table, the disclosure
boundary, the live checklist extended from four endpoints to seven, and **the stale-bullet fix
below**.

---

## The known-stale bullet, fixed

`authorization.md`'s mutation-check list ended with:

> Move the owner check below a write → the zero-mutation/immutability test must turn RED.

That **contradicted the section directly above it**, which records that the check was actually tried
in 22-02 and *all 11 optimizer tests correctly stayed green*: Convex mutations are atomic, so a
post-write throw rolls the transaction back and the resulting DB state is byte-identical to the
refusal case. Anyone following the bullet would have chased an unsatisfiable red — and the only way
to "achieve" it is to weaken a fixture until it goes, which is the precise failure this repo has
been cataloguing all phase. It is now struck through with the reason, replaced by six checks that
ARE satisfiable, every one of them executed and its red recorded this session.

---

## Mutation Ledger

15 mutations. Each was applied to a byte-exact working copy, run, its **verbatim** red recorded, then
restored from the pristine copy and confirmed with `diff -q` (IDENTICAL) plus a green re-run.

### Backend (`skills.ts`)

| # | Exact mutation | Observed red (verbatim) | Restored |
|---|---|---|---|
| M1 | add a direct `ctx.db.patch(candidateId, {status:"active"})` beside the shared transition in `activateTenantCandidate` | `ONE archive/activate transition: exactly one patch in the module sets status active` — `AssertionError: expected [ …(2) ] to have a length of 1 but got 2`; **1 failed \| 163 passed** | yes |
| M2 | `activateTenantCandidate` → `tenantMutation` | **2 failed \| 162 passed** — `skills.ts:activateTenantCandidate is declared with ownerMutation` (static) and the truth table: `expected [Function] to throw error matching /OWNER_REQUIRED/ but got 'EVAL_GATE: tenant candidate 000000000…'` | yes |
| M2b | M2 **plus** the truth table's owner-side cells temporarily removed, so the catastrophic cell is reached first | `promise resolved "{ changed: true, …(9) }" instead of rejecting` — **the candidate's own author activates it** | yes |
| M3 | delete the `rollbackEligible !== true` throw | `rollbackEligible — not status — is the proof of prior activation` — `promise resolved "{ changed: true, evalRunId: null, …(8) }" instead of rejecting`; **1 failed \| 84 passed** | yes |
| M4 | short-circuit the `hasPassingTenantEvidence` check | **2 failed \| 83 passed** — the truth table and the stale/foreign/forged test, both `promise resolved "{ changed: true, … }" instead of rejecting` | yes |
| M5 | tenant current-active lookup: indexed `by_tenant_name_status` → unindexed `.filter(name && status).first()` | **GREEN on first attempt — see below.** After the adversarial test: `expected 'archived' to be 'active'`; **1 failed \| 85 passed** | yes |
| M6 | audit on every attempt (`if (res.changed)` removed) | `re-activating the row that is ALREADY live is idempotent` — `expected [ { …(8) }, { …(8) }, { …(8) }, …(1) ] to deeply equal [ { …(8) }, { …(8) }, { …(8) } ]`; **1 failed \| 84 passed** | yes |
| M7 | `.take(TENANT_REVIEW_LIMIT)` → `.collect()` | **2 failed \| 83 passed** — `expected [ Array(42) ] to have a length of 25 but got 42` and `expected 'export const tenantCandidatesForRevie…' to contain '.take(TENANT_REVIEW_LIMIT)'` | yes |
| M8 | put the candidate BODY on the activation audit payload | **fired on the wrong assertion first — see below.** After reordering: `expected '{"audit":[{"_creationTime":1786402335…' not to contain 'ZQ7ACT4a19c7e2b'`; **1 failed \| 85 passed** | yes |
| M9 | review query returns `rawEvidence: row.evidence` | **GREEN on first attempt — see below.** After the key-set pin: `expected [ 'authorUserId', …(17) ] to deeply equal [ 'authorUserId', …(16) ]`; **1 failed \| 85 passed**. Also fails `tsc`: `TS2339: Property 'evidence' does not exist` | yes |

### Web (`ops/page.tsx`)

| # | Exact mutation | Observed red (verbatim) | Restored |
|---|---|---|---|
| W1 | `disabled={!c.gatePassed \|\| working}` → `disabled={working}` | `expected 'function UserCandidatesPanel() {…' to contain 'disabled={!c.gatePassed \|\| working}'`; **1 failed \| 14 passed** | yes |
| W2 | `activate({candidateId})` → `activate({name, version})` | `expected … to contain 'activate({ candidateId: c.candidateId…'`; **1 failed \| 14 passed** | yes |
| W3 | move `<UserCandidatesPanel />` outside the `isOwner` branch | `expected '{isOwner && (\n        <section style…' to contain '<UserCandidatesPanel />'`; **1 failed \| 14 passed** | yes |
| W4 | render `c.evidence ?? "No eval run recorded…"` | **GREEN on first attempt — see below.** After the regex: `expected … not to match /c\.evidence(?![A-Za-z])/`; **1 failed \| 14 passed** | yes |
| W5 | the awaiting-evaluation state coloured `var(--held-text)` | `expected … not to contain '--held'`; **1 failed \| 14 passed** | yes |
| W6 | swallow the refusal into `console.error(err)` | `expected … to contain 'err instanceof Error ? err.message : …'`; **1 failed \| 14 passed** | yes |

### Four mutations that were GREEN (or red for the wrong reason) on first attempt

These are the entries worth reading. Every one was a defect in **my test**, not evidence the code
was safe.

1. **M5 — tenant locality was vacuously proven.** My scope-exactness test had only ONE tenant ever
   holding an active row, so an unscoped "find the active row for this name" read returned the same
   row the scoped one did and **all 85 tests stayed green**. The adversarial case puts BOTH tenants
   live at the same name and version, then supersedes the **younger** one's row: an unscoped
   `.first()` finds the older tenant's row and archives a live tenant's skill nobody asked to
   change. Only then does the mutation bite (`expected 'archived' to be 'active'`).
   **Flagged, per the 21-02 precedent:** this mutation cannot be applied as literally worded —
   `by_tenant_name_status` puts `tenantId` first, so the equality cannot be dropped while keeping
   the index. The behavioural equivalent (an unindexed `.filter()` on the non-tenant fields) is what
   was applied. **And the reverse direction is still luck-dependent:** if tenant A supersedes its
   own row while B is live, the unscoped read happens to return A's own row and passes. Insertion
   order privileges that direction and I did not manufacture a third tenant to break it — the
   younger-supersedes case is the one that bites and it is the one asserted.
2. **M9 / W4 — the raw evidence string was renderable and nothing said so.** The review query had no
   pinned key set and the web scan matched only `c.evidence}`, which `c.evidence ?? "…"` sails past.
   Fixed with a returned-key-set equality on the server and a lookahead regex
   (`/c\.evidence(?![A-Za-z])/`) on the client. The server fix is the load-bearing one: with the key
   set pinned, the field does not exist on the returned type and the UI mutation additionally fails
   `tsc`.
3. **M8 — the red fired on the wrong assertion.** The body-leak mutation turned the audit **key
   set** red, and the needle scan on the line below it never ran. A key set is a stronger but
   narrower fact, and letting it fire first would have let me claim a scan proof I had not obtained.
   The scan (with its two positive witnesses) now runs FIRST and the key sets after — 21-05's row-12b
   lesson, applied one plan later to the same shape of test.
4. **W6 could not be applied as first written** — the anchor matched twice, because `OptimizerPanel`
   has a byte-identical error-handling line. Re-anchored with the preceding comment so the mutation
   hits the tenant panel only. Recorded rather than silently re-scoped.

### Anti-vacuity

No zero/absence assertion in this plan stands alone:

- the four-cell truth table's `OWNER_REQUIRED` cells sit beside **the same call succeeding for the
  owner on the same bytes**, and the non-owner cell carries *valid passing evidence* so the refusal
  is provably about authorization.
- the five EVAL_GATE refusals (foreign row / forged tenant / stale version / failed run /
  unparseable) end with the honest pin activating the same row.
- `ROLLBACK_NOT_ELIGIBLE` sits beside the **identical call succeeding after flipping only the
  `rollbackEligible` flag** — so the refusal is about that flag and not about the row, the tenant or
  the missing evidence.
- "nothing was written" on an idempotent re-activation is a **deep equality on the whole row and the
  whole audit table**, not a status re-read.
- the audit needle scan asserts `toContain(String(idA))` and `toContain(RUN_ID)` BEFORE its four
  negatives, so the scan is proven to have read the rows.
- "A's needle is not in A's queue row" sits beside `toContain(NEEDLE_B)` on B's row.
- the source-contract patch count asserts `patches.length > 3` before filtering to one, so "exactly
  one" is a filter result and not an empty match.
- every region slice in every source scan carries a length floor (the 21-02 `</HeaderMenu>` lesson).
- the web scan asserts `page.length > 5000` and `panel.text.length > 3000` first — an empty string
  passes every `not.toContain` in that file for free.
- the bounded-queue test's cap of 25 sits beside 42 real candidate rows.

---

## NOT DONE AND NOT CLAIMED

**SKILL-01 stays OPEN. Do not check it off.** Concretely, as of `d49f6dc`:

- **NO PAID EVAL WAS RUN BY THIS PLAN. $0.00.** No `--skill`, no `--tenant-skill`, no fixture against
  a model. The only eval invocation is the free `--self-check`. The green 36/36 gate in
  `skill-registry.md` is **another lane's**, on the **global** `cockpit-agent v1`, and certifies no
  tenant row.
- **No tenant candidate has passing evidence anywhere except in a test.** `gatePassed` has only ever
  been observed `false` in production and `tenantSkills.evidence` is unset on every real row. It
  follows that **nothing has ever been activated or rolled back outside `convex-test`** — the code
  path exists and has never been walked on a deployment.
- **`--tenant-skill` still has never executed end to end against a real deployment** (21-03's
  finding, unchanged). Activation therefore cannot be reached in production until that runs, which
  is 21-07's.
- **No browser proof, of anything.** `tenantSkillReview.test.ts` is a **source-text scan**:
  `apps/web`'s vitest config is node-only with no jsdom and no testing-library, and that config
  documents adding them as a deliberate upgrade. It proves the shipped source contains and lacks
  exact strings — which is enough to catch a downgraded call, a leaked field or a missing mount
  gate. **It proves nothing about pixels, layout, keyboard focus order, whether the section renders,
  whether the `<select>` is operable, or that a click ever reaches the server.** No Playwright spec
  was written or run and no dev server was started. 21-06's.
- **The live owner/non-owner `/ops` check is NOT run and remains the blocking checkpoint** it has
  been since 22-03. Steps 6 and 7 that I added to that checklist have never been executed.
- **The tenant review queue offers a candidate BEHIND the tenant's active version.** The global
  queue learned this lesson the hard way (`v17 -> v16` in production) and filters it; the tenant
  queue does not, deliberately — activation needs evidence pinning that exact row, so a stale
  candidate cannot activate by accident. The UI shows `v{baseVersion} → v{version}` so a backwards
  move is visible, and that is the whole mitigation. If a stale candidate ever carries real
  evidence, an owner could still activate it and silently downgrade that tenant. **Not fixed, not
  claimed.**
- **A displaced row is patched to `archived`, never to `rolled_back`.** The schema has that status
  and the global gate exempts it; nothing in this plan mints it. Honest, and a reader diffing the
  schema against behaviour should know it.
- **`TENANT_REVIEW_LIMIT = 25` is a `take`, not pagination.** A deployment with more than 25 pending
  candidates silently shows the newest 25, and there is no "show more". Same for
  `ROLLBACK_CHOICE_LIMIT = 10`.
- **The queue is O(candidates) reads.** Each row costs an effective-skill resolution plus a bounded
  prior-version read — ~75 reads at the cap. Bounded, not free, and not measured against a real
  deployment.
- **Concurrency is not serialized.** Two owner tabs can each activate a different candidate for the
  same tenant; Convex's transaction makes each atomic but nothing orders them. The same exposure the
  global panel already has.
- **No `packages/*` domain module was added.** The activation rule is Convex-transaction-shaped
  (two reads, two patches, one table) and pulling it into pure TS would mean inventing a repository
  abstraction nobody asked for. `ponytail:` the ceiling is that this logic is untestable without
  `convex-test`; the upgrade path is a `packages/core` module if a second runtime ever needs the
  same transition. Flagged against CLAUDE.md §1 rather than silently absorbed.
- **`packages/backend/convex/_generated/` was NOT regenerated or staged.** It was not needed — the
  new exports live in an existing module and `api.d.ts` types them through `import type * as skills`.
- **`graphify-out/`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md` and
  `21-VALIDATION.md` were NOT modified or staged.** See State handoff.

---

## Deviations

**Rule 3 (blocking) — Tasks 1 and 2 landed in ONE commit.** The plan asks for a commit per task, but
`rollbackTenantSkill` and `activateTenantCandidate` are two modes of the *same* helper in the same
region of the same file. Splitting them would have produced a commit in which the shared transition
knows a `"rollback"` mode with no caller, or a test file naming an export that does not exist.
Recorded rather than faked: `18d8bca` is Tasks 1+2, `70d54e3` is Task 3, `3166544` is Task 4.

**Rule 3 (blocking) — one ledger mutation is not literally applicable.** M5 as worded ("remove the
tenant scoping") does not compile: `by_tenant_name_status` puts `tenantId` first, so the equality
cannot be dropped while keeping the index. Applied as its behavioural equivalent — the indexed read
replaced by an unindexed `.filter()` on the non-tenant fields. The 21-02 precedent, flagged not
glossed.

**Rule 3 (blocking) — my own tests were wrong four times, and each is in the ledger.** One vacuous
locality proof, two renderable-raw-evidence holes, one assertion-ordering short-circuit. Every one
was found by a mutation coming back green (or red for the wrong reason), and every one is now
adversarially covered.

**Rule 1 (bug) — a non-null assertion on a stale rollback selection.** `c.rollbackTargets.find(…)!.id`
would have thrown if the queue refreshed under an open card between the `<select>` and the click.
Replaced with a resolve-then-guard (`if (pick)`), which also removed the file's one biome warning.
Not a hypothetical: the queue is a live Convex subscription and a candidate leaves it the moment it
is activated.

**Out of scope, NOT fixed — the 17-05 lane's backend typecheck errors.** `tsc --noEmit` on
`packages/backend` moved three times during this session as that lane worked:
`convex/cockpit.ts` (2 diagnostics: `calendar_manage` missing from the arm table after they widened
`ACTION_TYPES`), then `convex/plans.test.ts(809,9) TS2578`, and finally
`convex/calendar.test.ts` × 3 (`by_tenant_provider_external` is not yet an index on the table they
are querying). **All three files are named in the 17-05 lane's own file list; none is in any of my
commits.** Zero diagnostics in `skills.ts`, `skills.test.ts` or `importGuard.test.ts` on every run,
including the first one, which was exit 0 overall. Per the scope boundary I did not touch them. **The
phase cannot claim a green backend typecheck until 17-05 lands.**

**Rule 3 (blocking) — the Stop hook blamed 21-04 for another lane THREE times, and every fix claims
nothing.** `check-playbooks.mjs` builds its changed-set from the WHOLE working tree. It blocked on
`cockpit.md (changed: cards.tsx, traceParity.test.ts, run-calendar-test-gate.mjs)`, then on
`cockpit.md (changed: run-calendar-test-gate.mjs)` alone, then on
`dashboard-pages.md (changed: ApprovalsView.tsx, approvals.ts)`. **None of those five files is in any
21-04 commit**; `git log -1` on the two approvals files names `d17ab1d feat(17-05)`, and the other
three are in that lane's own file list. Cleared with **date-bump-only** entries (`1a51259`,
`3a93124`) in the shape `skill-registry.md` / `agent-runtime.md` / `cockpit.md` already use for this
exact false positive: each states **in its first sentence** that nothing was re-verified, names the
paths 21-04 actually touched with their commit hashes, and hands the real entry back to 17-05 with an
explicit "do not treat this bump as coverage". The second `cockpit.md` block **extended the entry I
already owned** rather than stacking a fourth (the 21-05 precedent). I did not run, read, re-measure,
endorse, revert or restage that lane's change. `watch.json` was **not** touched — deciding which
playbook owns another lane's file is an ownership call that is not mine to make.

**Process — `21-04-PLAN.md` was untracked.** Committed in `3166544` alongside the playbooks (the
21-01/21-02/21-03/21-05 precedent) so code does not land ahead of the plan authorizing it. **Only**
`21-04-PLAN.md`; 21-06/21-07 remain untracked and untouched.

**No Rule 2 or Rule 4 deviations.** Nothing was missing that correctness or security required beyond
what the plan specified, and nothing architectural was in question — no new table, no new index, no
new dependency, no second authorization primitive. The one judgement call (whether `rollbackEligible`
or status proves prior activation in the tenant scope) resolved inside the existing schema on the
column 21-01 already provided.

### Ponytail ladder, where it actually bit

- **Rung 2 (already here):** `requireOwner`/`ownerMutation` rather than a second authorization
  primitive; `loadTenantCandidate`, `tenantTargetOf`, `hasPassingTenantEvidence`, `evidenceRefs` and
  `loadEffectiveSkill` all reused from 21-02/21-03; the page's own `unifiedDiff`, `cardShadow`,
  `caps-label` and `globals.css` tokens rather than a diff library or a new card.
- **Rung 1 (does this need to exist):** no `rolled_back` status minting, no stale-candidate filter,
  no pagination, no `packages/*` module, no new event type, no second log plane, no CLI door to
  activation.
- **Deletion over addition:** `activateSkillVersion`'s 40-line body became a 3-line wrapper; the
  archive/activate patches went from one copy per scope (what a tenant-only helper would have been)
  to one copy total.
- **What was NOT made lazy:** the trust boundary (two independent gates, both mutation-proven), the
  disclosure boundary (a pinned returned-key set), the audit key sets, and the adversarial locality
  test that a lazier reading would have skipped because it was already green.

---

## Shared-tree conduct

- **No `git add -A` / `git add .` / `git add <dir>` was run.** The only two `git add` calls were the
  two new file paths (`tenantSkillReview.test.ts`, `21-04-PLAN.md`), each immediately followed by a
  pathspec commit **in the same shell invocation** to close the race window.
- Every commit used `git commit -- <explicit paths>`. `git diff --cached --stat` after the first
  commit showed **three foreign staged files** (`19.1-VERIFICATION.md`, `pipelineView.test.ts`,
  `contacts-crm.md`) put there by another lane; none entered any of my commits, and I did not
  unstage them — reverting another lane's staged work is the same class of interference.
- `.git/MERGE_HEAD` was checked before every commit and was absent every time.
- All four commits were verified with `git merge-base --is-ancestor <sha> HEAD` immediately after
  each one **and again after this summary was written**. None fell out; nothing needed re-applying.

**INCIDENT — 102 lines of the 17-05 lane's `cockpit.md` entry were swept into my commit `3166544`.**
The Stop hook forced me to touch `cockpit.md` (it fired on three of *their* files, because it builds
its changed-set from the whole tree). I checked `git diff --stat` first and saw only my own 16-line
claim-nothing bump. In the seconds between that check and `git commit -- <paths>`, that lane wrote
its real entry into the working tree, and the pathspec commit — which takes paths from the **working
tree**, not the index — took it. **Their text is byte-unchanged and I did not rewrite history to
"fix" it**: a `git reset` in this tree is exactly the destructive act observed here on 2026-08-10.
`d49f6dc` adds only a separator and an HTML comment recording the incident, so the two entries read
as two and their "SUPERSEDES the entry below it" pointer is unambiguous. **The lesson is that a
pathspec commit is safe against a foreign *index* and not against a foreign *working tree*; the only
real defence is to re-diff immediately before committing a contended file, and even that is a race.**

- **`docs/playbooks/skill-registry.md` and `authorization.md` are mine** and their diffs are additive
  apart from nine deliberate replacements in `authorization.md` (each preserved as `PREVIOUS:` or
  reworded in place). `skill-registry.md` has **zero deletions**.
- **`packages/backend/convex/schema.ts`, `docs/playbooks/watch.json`, `packages/core/` and every
  17-05 file were NOT touched.** `watch.json` needed no change: `skills.ts` is registered to
  `skill-registry.md` and `apps/web/app/(app)/ops/` to `authorization.md`, so the new web test file
  is already covered.

---

## Graph

`graphify update .` rebuilt **16007 nodes / 18413 edges / 1561 communities**;
`node scripts/extract-convex-edges.mjs` re-injected **+440 convex edges, +65 table edges (41
tables)** and removed 9408 noise nodes. **`graphify-out/` was not staged** — a shared generated
artifact carrying other lanes' state.

---

## State handoff (NOT written — other lanes own these files)

`.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` and `21-VALIDATION.md` all
carry other lanes' uncommitted edits, so I did not touch or stage any of them. What I would have
written:

- **STATE.md** — Current Plan advances past 21-04; Stopped At: `Completed 21-04-PLAN.md`. Decisions:
  *"21-04: a tenant skill goes live only through BOTH gates — `ownerMutation` for authority and
  evidence pinning the EXACT row for merit; the load-bearing test cell is non-owner WITH valid
  evidence, and downgrading the wrapper lets the candidate's own author activate it."*;
  *"21-04: tenant rollback eligibility is the `rollbackEligible` COLUMN, never status — a superseded
  draft is also archived and was never live, so status-only would launder a pending candidate around
  the eval gate."*; *"21-04: both registry scopes share ONE `transitionSkillActivation` with a single
  `status: active` patch that `skills.test.ts` counts; the behavioural tests stay green when that
  invariant is broken, so the source assertion is not redundant."*
- **ROADMAP.md** — Phase 21 plan progress advances by one (21-01, 21-02, 21-03, 21-04 and 21-05 are
  now done; 21-06 and 21-07 outstanding). Reconcile the count against SUMMARY files on disk rather
  than incrementing blindly — two lanes have been landing in parallel. Phase status stays
  in-progress.
- **REQUIREMENTS.md** — **SKILL-01 stays OPEN.** The browser checkpoint (21-06) and the first live
  paid tenant gate (21-07) are both outstanding, and no tenant candidate has ever been activated on
  a deployment.
- **21-VALIDATION.md** — the rows this plan owns can move from ⬜ pending to ✅ with the mutation
  ledger above as evidence. **Rows M5, M8, M9 and W4 must not be read as clean passes** — each was
  green (or red for the wrong reason) on first attempt and required a new adversarial assertion.
  **I did not edit this file** — it is dirty in the shared tree.

---

## Next

**21-06** owns the browser proof, and there are three specific traps for it. (1) The
`User-authored candidates` section only mounts for a confirmed owner, so the spec needs the owner
identity, not just any signed-in one. (2) Activate is `disabled` until `gatePassed`, and **no real
row has ever had passing evidence** — a spec that clicks it will find a disabled button unless the
run first records evidence on a disposable candidate. (3) The card leaves the queue the instant it
activates, so post-activation assertions must target the workspace panel's "Live" copy (unreachable
until now, and this is the plan that makes it reachable) rather than the ops card.

**21-07** owns the first paid `--tenant-skill` run, and it is the one that connects the two halves:
until it runs, activation is a door with nothing behind it. Pin the `deploymentHash` from
`--inspect-tenant-skill --json` before and after, budget the full unfiltered gate (~$0.35–0.45), and
note that a filtered or zero-case run correctly refuses to record anything.

**17-05's `convex/calendar.test.ts` typecheck errors are outstanding and are theirs** — the phase
cannot claim a green backend typecheck until they land.

## Self-Check: PASSED

- `packages/backend/convex/skills.ts` — FOUND (+376 / −11 in `18d8bca`; 1428 lines)
- `packages/backend/convex/skills.test.ts` — FOUND (+699; 2557 lines)
- `packages/backend/convex/importGuard.test.ts` — FOUND (+8)
- `apps/web/app/(app)/ops/page.tsx` — FOUND (+266 in `70d54e3`; 806 lines)
- `apps/web/app/(app)/ops/tenantSkillReview.test.ts` — FOUND (created, 181 lines)
- `docs/playbooks/skill-registry.md` — FOUND (+89, zero deletions, in `3166544`)
- `docs/playbooks/authorization.md` — FOUND (+122 / −8)
- `docs/playbooks/cockpit.md` — FOUND (claim-nothing bump, the separator in `d49f6dc`, the second
  false positive in `1a51259`)
- `docs/playbooks/dashboard-pages.md` — FOUND (+17 / −1, claim-nothing bump in `3a93124`)
- `.planning/phases/21-user-authored-skills-and-routines/21-04-PLAN.md` — FOUND (239 lines, newly tracked)
- `.planning/phases/21-user-authored-skills-and-routines/21-04-SUMMARY.md` — FOUND (`b9ecdbd`,
  amended in the follow-up below so its own commit list is not short by three)
- Commits `18d8bca`, `70d54e3`, `3166544`, `d49f6dc`, `b9ecdbd`, `1a51259`, `df54d67`, `3a93124`
  and this amendment — **all** re-verified with `git merge-base --is-ancestor <sha> HEAD` after this
  summary was written. Nothing fell out of history and nothing had to be re-applied.
- `node scripts/check-playbooks.mjs` — exit **0**, empty output, at the end (after `3a93124`).
- `git status` on every path this plan owns — **clean**.
