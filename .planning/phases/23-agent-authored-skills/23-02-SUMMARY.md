# 23-02 SUMMARY — the inert writer, built before anything can reach it

**Status:** complete. **Cost:** $0.00 (no model call). **Date:** 2026-08-18.
**Gate deviation:** inherited from `23-00-GATE-2026-08-18.md`, not re-argued here.

## Task 1 — the shared seam, extracted and proven behaviour-neutral

Two private helpers now sit above both writers in `skills.ts`:

- **`readTenantPublishState(ctx, tenantId, name, authoredBody)`** — loads the global core, loads the
  tenant's effective row, composes, and does the ONE descending indexed `take(1)`. Throws on a
  blank/over-cap adaptation before returning, so no caller can reach an insert with an unvalidated
  body.
- **`ensureRollbackBaseline(...)`** — the first-customization `system`/`archived`/rollback-eligible
  baseline (research pitfall 8). Author is `system`, **not** the publisher: the baseline is the
  code's copy of the code's own core, and attributing it to a user or the agent would put an
  authorship claim on bytes neither wrote.

`publishUserCandidate`'s public args, returns and behaviour are unchanged. The suite was run before
(**91 passed**) and after (**91 passed**) the refactor as its own step, so the extraction is not
bundled with new behaviour in one unobservable jump.

**One guard had to move with it.** The structural test *"the tenant allocation reads ONE descending
indexed row — never a history `.collect()`"* scanned the region from `export const
publishUserCandidate` to `export const myUserSkills`. The read left that region. Rather than delete
or weaken the guard, its region was **re-anchored to start at `readTenantPublishState`** — so it now
covers the read where it lives PLUS both writers below it, with an added non-vacuity assertion that
the region still contains `export const publishUserCandidate`. Strictly more coverage than before.

## Task 2 — `publishAgentCandidate`

`internalMutation`. No public API, no tenant wrapper, no HTTP route.

**Args:** `{tenantId, sourceThreadId, sourceTurnId, name, authoredBody}`.
**What the model will supply (23-03):** `name` and `authoredBody`. Nothing else. The other three
come from the trusted turn envelope and are args only because an internal mutation has no
`ctx.tenantId`.

**Two refusals, in order, and the order is the contract:**

1. **Exact retry FIRST**, off `by_tenant_source_turn`. A re-fired turn recovers its own row
   (`inserted: false`, same id and version) and mints no second immutable version and no second
   audit row. It returns the row's **real status**, not a hardcoded `"candidate"` — a retry fired
   after an owner already activated the row must not report it as still pending.
   Same turn + different draft **or different name** → `AGENT_SOURCE_TURN_CONFLICT`, zero rows
   changed. Patching would mutate an immutable row; inserting would give one turn two.
2. **The v1 pending rule.** A new turn while ANY candidate is pending for that tenant/name —
   **including one the USER authored** — → `AGENT_CANDIDATE_PENDING`, zero rows changed, the pending
   row neither archived nor superseded.

**Idempotence is the SOURCE TURN, never the bytes.** `allocateImmutableVersion` is called with
`duplicate: false` deliberately: two turns producing identical text are two authoring acts, and
collapsing them would return a row whose `sourceTurnId` names a turn that never asked for it.

**Inserted facts:** `author: "agent"`, `authorAgentId: EXECUTIVE_AGENT_AUTHOR_ID` (hardcoded),
trusted source refs, `status: "candidate"`, `rollbackEligible: false`, no evidence, no approval,
lineage against the effective row. Body composed against the **global core**, asserted equal to
`composeUserSkillBody(GLOBAL_CORE, DRAFT)`.

**`inspectAgentCandidate`** — refs-only `internalQuery` for the later live artifacts: ids, status,
provenance, `bodyHash`, `authoredBytes`, `hasEvidence` as a BOOLEAN, `ownerApproval` or null. Never
`body`, never `authoredBody`. Asserted over the whole serialized view, not key by key: a new field
carrying content would slip past a key-name check.

**Audit:** one row, `skill.agent_candidate_published`, `actor: "agent"`, key set pinned by EQUALITY —
`author, authorAgentId, authoredBytes, baseScope, baseSkillId, baseVersion, bodyHash, skillName,
sourceThreadId, sourceTurnId, tenantSkillId, version` — needle-scanned across every audit row and
every dead letter, with a non-vacuity assertion that the scan really read the row.

## Task 3 — mutation evidence (all executed, all restored, none left in the tree)

| Mutation | Result |
|---|---|
| Writer inserts `status: "active"` | **6 red**, incl. the structural region scan |
| Add a caller-supplied `status` to the validator | **1 red** — the boundary test |
| Drop `sourceTurnId` from the source-turn predicate | **1 red** — a new turn recovers the wrong row |
| **Drop the TENANT predicate** | **COMPILE ERROR, not a test failure:** `TS2345: Argument of type '"sourceThreadId"' is not assignable to parameter of type '"tenantId"'` |
| Archive the pending candidate instead of refusing | **3 red** — both behavioural tests AND the `ctx.db.patch` structural scan, independently |

**The fourth line is the most useful result of this plan.** Convex index predicates must be supplied
in field order, so putting `tenantId` first in `by_tenant_source_turn` makes tenant scoping
**structurally unskippable** — the compiler refuses, rather than a test noticing after the fact.
That is a stronger guarantee than any assertion, and it is why the index ordering chosen in 23-01 is
not cosmetic.

## Measured

| Check | Result |
|---|---|
| `skills.test.ts` | **104 passed** (91 → 104; +13) |
| `skills.test.ts` + `llmRedaction.test.ts` | **165 passed** / 2 files |
| `tsc --noEmit` backend | **0 errors** |
| `biome check` | 0 errors (39 warnings, all pre-existing `noNonNullAssertion`) |
| `node scripts/check-playbooks.mjs` | clean, no block |
| `git diff --check` | exit 0 |

## What is still true after this plan

- **Nothing can promote an agent row.** No code path from this mutation reaches
  `transitionSkillActivation`, `activateSkillVersion`, `activateTenantCandidate` or
  `recordTenantEvalEvidence`; the region scan asserts all four plus `ctx.db.patch` / `replace` /
  `delete` / `status: "active"` / `rollbackEligible: true`.
- **The tenant's effective row is unchanged** after a publish — asserted with `loadEffectiveSkill`
  before and after, `toEqual`.
- **23-01's ceiling is now half-closed.** `publishAgentCandidate` is the intended single insert site
  for agent rows and always writes full lineage. A **direct `ctx.db.insert` still bypasses it** —
  the structural "no other module inserts an `author: "agent"` row" test named in 23-01's upgrade
  path is NOT written yet, because 23-03 is about to add the only other module in the story
  (`llm.ts`). It belongs there.

## Next

`23-03` — the cockpit tool grant: `authorSkillCandidate` constructed only for a real Executive-Agent
turn with trusted thread/turn lineage, absent entirely from specialist / ingestion / voice /
toolless / smoke contexts.
