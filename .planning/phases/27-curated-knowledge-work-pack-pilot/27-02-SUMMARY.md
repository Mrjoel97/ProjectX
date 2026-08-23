---
phase: 27-curated-knowledge-work-pack-pilot
plan: 02
subsystem: workflow-packs
tags: [packs, skill-registry, capability-grant, candidate-lifecycle, eval-fixtures, telemetry]

requires: []
provides:
  - Six closed workflow pack ids with a total existing/missing/forbidden operation matrix
  - A code-owned tool grant derived from the matrix, pinned to real llm.ts tool names
  - Candidate-only first publication plus a three-plane pack activation gate
  - The workflowPackEvents table, tenant-scoped and on the immutable audit plane
  - An offline fixture schema and validator with a self-proving --self-test
affects: [skills-registry, agent-runtime, tenant-data-plane, eval-harness]

tech-stack:
  added: []
  patterns:
    - discriminated-union operation matrix (no optional fields the compiler cannot check)
    - grant derived from the matrix rather than typed twice
    - native TS import of a pure registry from a .mjs script instead of a regex parse

key-files:
  created:
    - packages/core/src/workflowPacks.ts
    - packages/core/src/workflowPacks.test.ts
    - packages/backend/scripts/run-workflow-pack-evals.mjs
    - packages/backend/scripts/workflow-pack-fixtures/.gitkeep
    - docs/playbooks/workflow-packs.md
  modified:
    - packages/core/src/index.ts
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/package.json
    - docs/playbooks/skill-registry.md
    - docs/playbooks/audit-dead-letter.md
    - docs/playbooks/watch.json

key-decisions:
  - "Pack skill names are DERIVED (`pack-<id>`) and deliberately absent from GATED_SKILLS: run-eval-golden derives its --skill allow-list from that array and drives runCockpitAgent over text fixtures, so a gated pack name would mint candidates no eval run could certify."
  - "The pack gate is a SECOND branch in planGlobalActivation on the same `status === candidate` condition, not a widening of the EVAL_GATE — so the archived/rolled_back rollback exemption is inherited unchanged."
  - "provenance participates in publication IDENTITY (idempotence is on the body+provenance pair) because it is written at insert and never patched; a corrected manifest is a new candidate, not a rewrite."
  - "PackOperation is a discriminated union with `reads: null` for producing operations, not one shape with optional fields — an optional field can never be mutation-checked by the compiler."
  - "The fixture runner imports the registry as TypeScript (Node >= 22.6 type stripping) rather than regex-parsing it, so the validator cannot drift from the module it checks."
  - "No promisedOutcome field on the preflight: under owner decision A every pilot pack has a matrix-missing source, so the field would be the constant \"partial\"."

patterns-established:
  - "A capability grant is derived from a code-owned operation matrix and asserted as whole-registry equality, so widening one is never a quiet one-line edit."
  - "A closed id set that reaches a Convex literal union is pinned by a source scan in the pure package, because a missing literal makes the insert throw inside a callback the SDK swallows."

requirements-completed: [PACK-02, PACK-03]

duration: 52min
completed: 2026-08-23
---

# Phase 27 Plan 02: Native Pack Contracts Summary

**The pack contract, capability boundary, candidate lifecycle and fixture vocabulary are frozen —
and no pack can reach a deployment active, because the only door into the registry mints candidates
and the only door out of candidacy demands three independently-pinned kinds of evidence.**

## Performance

- **Duration:** ~52 min
- **Tasks:** 3
- **Files created/modified:** 15
- **Cost:** $0.00 — the entire plan is offline. No deployment was touched and no model call was made.

## Accomplishments

- **A total operation matrix** over six closed pack ids. Every operation is `existing`, `missing` or
  `forbidden`, and the three words are the whole vocabulary 27-04/05/06 may author against. The
  matrix is a discriminated union, so a `missing` row without a source or an `existing` row without
  tools does not compile.
- **A derived, code-owned tool grant.** `toolsForWorkflowPack` unions the `existing` rows' tools; a
  tool no operation asks for cannot be granted, and a skill body can never add one. Cross-file scans
  pin every granted name to a real `<name>: tool(` key in `llm.ts` and every pack id to a
  `workflowPackEvents.packId` literal in `schema.ts`.
- **The leaf-agent fact, encoded rather than instructed.** A source scan asserts `llm.ts` still
  derives `grantDispatch` and `grantSkillAuthoring` from `toolNames === undefined`, and no pack may
  name `dispatchResearch`, `dispatchMedia`, `proposeImage` or `authorSkillCandidate`.
- **`publishPackCandidate`** — the third publication door, and the only one the pack names may enter
  by. No branch inside it can produce an active row. `seedSkills` is byte-unchanged.
- **A three-plane activation gate** (`provenance` + `evidence` + `browserEvidence`, each pinning the
  exact `(name, version)`), with the rollback exemption preserved by status.
- **`workflowPackEvents`**, classified `audit_immutable`, refs/enums/counts only, re-emitting
  neither cost nor latency.
- **An offline fixture validator** that refuses a fixture asserting something the matrix forbids,
  with a `--self-test` that proves 18 rejections before trusting itself.

## Task Commits

1. **Task 2 (schema half): the events table and its classification** — `84447ed` (feat)
2. **Task 1: the registry, matrix and grant** — `5191e02` (feat)
3. **Task 2 (registry half): candidate-only publication and the pack gate** — `a9d5b07` (feat)
4. **Task 3: the offline fixture validator** — `15ddd3c` (feat)
5. **The tenant-overlay bypass, pinned shut** (test)
6. **The owner's reclassification of `workflowPackEvents`** (refactor)

Committed in dependency order rather than task order, so every intermediate HEAD compiles: the core
registry test scans `schema.ts` for the `packId` union, and `skills.ts` imports the core predicates.

## Verification — all executed

```
cd packages/core && npx vitest run                          42 files / 1151 passed
cd packages/core && npx tsc --noEmit                        clean
cd packages/backend && npx tsc --noEmit                     clean
cd packages/contracts && npx tsc --noEmit                   clean
cd packages/backend && npx vitest run                        96 files / 2381 passed (FULL suite)
cd packages/backend && node scripts/run-workflow-pack-evals.mjs --fixtures-only --self-test
npx biome ci . --diagnostic-level=error --max-diagnostics=none          672 files, clean
```

### Mutations observed RED, then restored green

| Mutation | Result |
|---|---|
| `publishPackCandidate` inserts `status: "active"` | 4 tests red |
| the pack branch of `planGlobalActivation` disabled | 2 tests red |
| a malformed fixture placed on disk | runner exits 1 with the exact violation |
| one validator check deleted from the runner | `--self-test` exits 1 naming the unchecked rule |
| a pack name added to `USER_AUTHORABLE_SKILLS` | the overlay-bypass guard reddens |

## Key Decisions and Deviations

- **Two files were added that the plan does not list**: `packages/backend/package.json` (an
  `eval:packs` script — the root `package.json` is what `ci-gate.md` watches, so this costs no
  playbook obligation) and `packages/backend/scripts/workflow-pack-fixtures/.gitkeep` (so the
  directory 27-04/05/06 write into exists and is registered in `watch.json`). Every file the plan
  DID name was touched.
- **The gate predicates live in `packages/core/src/workflowPacks.ts`, not in `@pikar/contracts`.**
  The plan does not list `contracts/src/skill.ts` in `files_modified`, `@pikar/core` cannot import
  `@pikar/contracts`, and `@pikar/backend` already depends on both — so the pack predicates sit with
  the pack registry and `skills.ts` imports them beside the existing `hasPassingEvidence`.
- **The pack skill names are derived from the ids rather than inlined**, so there is no second list
  to drift. 27-04/05/06 must add the matching `@pikar/contracts` constants and `.md` bodies; a test
  here asserts the derivation, and the body-parity test starts biting the moment the first body
  lands (it fails on a HALF-landed corpus, not just a missing one).
- **`bodySha256` is shape-checked on the server, not byte-checked.** A Convex mutation has no
  synchronous digest; `scripts/verify-knowledge-work-provenance.mjs --check` (27-08) is the
  bytes-level enforcement. Recorded as a `ponytail:` with its upgrade path (compute the digest in a
  publishing ACTION).

## Facts downstream plans must carry

- **The allow-list silently ignores unknown names.** `llm.ts:4353` filters the built record by exact
  name, so a typo'd grant produces a SMALLER tool set with no throw and no log. The registry test is
  the only thing that catches it.
- **`webResearch` and `declareUnsupported` must be granted as a pair** — `llm.ts` builds them under
  one flag and then filters by name, so listing search alone drops the refusal channel.
- **A pack granted `listInbox`/`briefInbox`/`replyToMessage` receives them with no Gmail grant.**
  `runSpecialistTurn` does not pass `gmailEnabled` and the flag defaults true, so 27-05's fixtures
  must expect the conversational `mailboxUnavailable` refusal, not tool absence.
- **`runSpecialistTurn` does not pass `clientContext`**, so any date-dependent tool takes its
  no-clock refusal. None of the six grants depends on a clock today.
- **`createDocument` persists a durable artifact with NO approval gate** — the only granted tool that
  does. Every other write stages `status: "proposed"`.
- **The `.md` → `.ts` skill-body mirror has no generator.** It is hand-written and guarded only by
  two hand-maintained tables (`skillBodies.test.ts` and `skills.test.ts:849-868`). Each pack body
  must be added to one of them or it has zero drift protection.
- **Packs are invisible to `reportsGovernance.activeSkills`**, which iterates
  `REGISTRY_SKILL_NAMES` = `SEEDS.map(...)`. Surfacing them needs a deliberate second enumeration.
- **The plan's two source references were slightly wrong** and are corrected here: `skill.ts:266-268`
  is `packages/contracts/src/skill.ts` (there is no `packages/backend/convex/skill.ts`), and the
  `rows.length === 0` branch is named by `skills.ts:583/603/610`, not `:557`.

## Adversarial review of this diff — four confirmed defects, all fixed

A six-lens review of the committed diff produced four findings that survived a refutation pass.
Three were in the fixture runner and one was a real design defect in the matrix.

1. **The `--packs` gate could not go red** (`353c34d`). The typo'd-filter guard read
   `kept.length === 0 && all.length > 0`, so with no fixtures on disk `--packs anything` validated
   zero cases and exited 0 — and `--packs <two packs> --fixtures-only` is 27-04/05/06's ONLY
   blocking automated evidence. A lane that wrote nothing would have passed it. Now per requested
   name and never conditioned on corpus size.
2. **A mixed filter passed if any name matched**, leaving a typo'd pack unvalidated. Each name is
   now checked against the registry and against the corpus.
3. **`expect.sources` accepted a matrix-MISSING source as `"available"`** — a state `packPreflight`
   can never produce, and the mirror of two rules the validator already enforced.
4. **The `draft_reply` contract could not reach the Approve gate it claimed to stop at** — see the
   owner decision below.

## Owner decisions, taken 2026-08-23 (after the first five commits)

### `customer-complaint` is granted `proposePlan`, and is the only pack that is

`replyToMessage` patches recipients, subject, threading and body onto the plan row and NEVER writes
`status`. `proposePlan` is the only tool on the email path that writes `status: "proposed"`, and
that status is the only state in which `PlanCard` — the sole Approve surface — renders, and the only
state `executePlan` acts on. The pack's headline deliverable therefore terminated at `collecting`:
visible as a read-only draft, approvable by nobody, with `executePlan` returning
`{ alreadyStarted: true }` having sent nothing. My comment claiming the plan "still stops at the one
human Approve gate" was false — it never reached the gate.

**The output-contract test could not see this.** It asserted `replyToMessage` was GRANTED, which is
mechanism coverage, not behaviour coverage — the same class as phase 26's five render tests that
passed under both orderings.

The owner chose to grant the staging step rather than downgrade the contract. `proposePlan` STAGES;
`executePlan`'s human compare-and-swap remains the only sender, and the injection posture is
unchanged because `replyToMessage` resolves the message and the recipient server-side, so a planted
instruction can influence what the human is SHOWN, never what leaves the building. `proposePlan` was
removed from the blanket deny-list and pinned to exactly one pack BY NAME instead
("exactly one pack may stage a plan for approval"), and the output-contract test now requires BOTH
halves. Mutation-verified: giving a second pack `proposePlan` reddens three tests.



### `workflowPackEvents` is `audit_immutable`, not `tenant_owned`

- The table first landed
  `tenant_owned`, which enrols it in the tenant deletion and export walks automatically — so erasing
  one tenant silently rewrote the denominator of every measure computed from the pilot. The owner
  ruled it onto the audit plane, beside `audit` and `deadLetters`: same refs-only shape, excluded
  from both walks BY CONSTRUCTION, covered by the existing export omission reason for the category.

  Three consequences, all landed in the same commit rather than left implied:
  1. **The bare `by_tenant` index was REMOVED.** Its only justification was `tenantExport`/
     `tenantDelete` calling `.withIndex("by_tenant")` on every `deletableTables()` name, and an
     `audit_immutable` table is not one of them. Every tenant-scoped read is served by the
     `by_tenant_createdAt` prefix. Reclassifying back means restoring it in the same commit or the
     backend does not typecheck.
  2. **The writer must be INSERT-ONLY** (CLAUDE.md §3) — the category is a claim about
     immutability, not a filing label. 27-03 owns the module; it is now invariant 11 in the playbook.
  3. **No field on this table may ever become personal data** — `audit_immutable` rows are beyond
     the reach of an erasure request. Invariant 12.

  Pinned positively by `tenantData.test.ts` "workflow-pack events sit on the audit plane", because
  the derived `deletableTables()` equality reads the classification itself and would stay green if
  the category silently flipped back.

  Verified against the WHOLE backend, not just the touched files: 96 files / 2381 tests green.
  Checked by hand before changing: `worm.ts` exports only `audit` (hardcoded, unaffected);
  `tenantExport`'s omission reason for the category is generic and accurate for this shape;
  `isolation.test.ts`'s cross-tenant index rule keys on the presence of a `tenantId` COLUMN rather
  than on the category, so the table is still scanned and all three indexes lead with `tenantId`.

## Next

27-01 (upstream provenance) is the remaining wave-1 plan and still needs its upstream tree
re-inventoried at the pinned SHA before it runs. 27-04/05/06 can now author bodies and fixtures
against this matrix; 27-07 binds `toolsForWorkflowPack` into the runtime; 27-08 publishes the six
candidates on DEV through `publishPackCandidate`.
