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
  - The workflowPackEvents table, classified and tenant-scoped
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
- **`workflowPackEvents`**, classified `tenant_owned`, refs/enums/counts only, re-emitting neither
  cost nor latency.
- **An offline fixture validator** that refuses a fixture asserting something the matrix forbids,
  with a `--self-test` that proves 18 rejections before trusting itself.

## Task Commits

1. **Task 2 (schema half): the events table and its classification** — `84447ed` (feat)
2. **Task 1: the registry, matrix and grant** — `5191e02` (feat)
3. **Task 2 (registry half): candidate-only publication and the pack gate** — `a9d5b07` (feat)
4. **Task 3: the offline fixture validator** — `15ddd3c` (feat)

Committed in dependency order rather than task order, so every intermediate HEAD compiles: the core
registry test scans `schema.ts` for the `packId` union, and `skills.ts` imports the core predicates.

## Verification — all executed

```
cd packages/core && npx vitest run                          42 files / 1150 passed
cd packages/core && npx tsc --noEmit                        clean
cd packages/backend && npx tsc --noEmit                     clean
cd packages/contracts && npx tsc --noEmit                   clean
cd packages/backend && npx vitest run convex/skills.test.ts             122 passed
cd packages/backend && npx vitest run convex/isolation.test.ts \
    convex/tenantExport.test.ts convex/tenantDelete.test.ts \
    convex/dashboardSchema.test.ts convex/auditImmutability.test.ts \
    convex/importGuard.test.ts                                          279 passed
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

## Open for the owner

- **Should `workflowPackEvents` survive tenant erasure?** `tenant_owned` enrols the table in the
  export and deletion walks, so erasure removes a tenant's pack events today — which silently
  rewrites the pilot's denominator. Reclassifying to `audit_immutable` keeps them at the cost of
  leaving an Art. 17 walk. Recorded in `packages/core/src/tenantData.ts` and the playbook; not
  resolved.

## Next

27-01 (upstream provenance) is the remaining wave-1 plan and still needs its upstream tree
re-inventoried at the pinned SHA before it runs. 27-04/05/06 can now author bodies and fixtures
against this matrix; 27-07 binds `toolsForWorkflowPack` into the runtime; 27-08 publishes the six
candidates on DEV through `publishPackCandidate`.
