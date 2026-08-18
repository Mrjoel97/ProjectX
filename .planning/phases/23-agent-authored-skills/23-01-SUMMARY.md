# 23-01 SUMMARY — the agent-authoring data vocabulary, and nothing else

**Status:** complete. **Cost:** $0.00 (no model call). **Date:** 2026-08-18.

## The prerequisite gate did NOT fully pass

`23-01`'s Task 1 opens with a blocking gate, and it failed on two of seven checks. Full result and
reasoning: `23-00-GATE-2026-08-18.md`. In short:

- **`21-LIVE-RESULT.json` does not exist** and was deliberately withheld by Phase 21 (its steps 3-4,
  tenant runtime attribution, were unrunnable: a synthetic author tenant with no recoverable
  password, and a paid specialist turn against a plan whose own truth was "$0"). **It was NOT
  fabricated here to clear the gate.**
- **Phase 22's roadmap checkbox was stale** — `ROADMAP:386` read `- [ ]` while the phase body already
  read `3/3 complete` and `22-VERIFICATION.md` reads `status: passed`. Flipped during this plan,
  carrying forward the limit that verification records about itself: the owner/non-owner `/ops` DOM
  half was closed at `29103e9` by `opsPresentation.test.ts` component/mount evidence, **not** a live
  browser.

Owner decision: execute waves 1-5, stop waves 6-9 for a re-cut. **`23-08` carries the same
unrunnable runtime-attribution step**, so reaching it later does not make it runnable.

The seam inventory the gate also demands PASSED unchanged — including `schema.ts:230`, which Phase 21
wrote as *"Phase 23 may append `agent` here without granting it activation."*

## What landed

### `packages/contracts/src/skill.ts` (+74)

| Export | What it is |
|---|---|
| `AGENT_AUTHORABLE_SKILLS` | Closed set: `offer-architect`, `money-model-designer`, `lead-engine` |
| `AgentAuthorableSkill` | The derived union type |
| `isAgentAuthorableSkill` | Narrowing predicate |
| `EXECUTIVE_AGENT_AUTHOR_ID` | `"executive-agent"` — the code-owned author identity |
| `AgentSkillSource` | `authorAgentId` + `sourceThreadId` + `sourceTurnId` (refs only) |
| `SkillOwnerApproval` | `ownerUserId` + `approvedAt` + `evalRunId` — exactly three, nothing else |

`AGENT_AUTHORABLE_SKILLS` is a **separate literal**, not `= USER_AUTHORABLE_SKILLS` and not a filter
over it. The two are equal today and must stay independently narrowable: aliasing would let a
PRODUCT widening of the user set silently widen what a MODEL may write. The test asserts the
non-aliasing with `.not.toBe`, which only passes for genuinely distinct arrays.

No second composer, no replacement-body format, no capability list. The agent reuses
`composeUserSkillBody` and the 4000-byte cap verbatim.

### `packages/backend/convex/schema.ts` (+50, `tenantSkills` only)

- `author` union gains `v.literal("agent")`.
- `authorAgentId`, `sourceThreadId`, `sourceTurnId` — all `v.optional(v.string())`.
- `ownerApproval` — `v.optional(v.object({ ownerUserId: v.id("users"), approvedAt: v.number(),
  evalRunId: v.string() }))`.
- New index `by_tenant_source_turn` on `["tenantId", "sourceThreadId", "sourceTurnId"]`.

**No migration, no backfill, no new table.** Every legacy and Phase-21 row validates unchanged, and
the new columns are genuinely absent (not present-and-empty) on old rows — asserted, not assumed.

The tenant prefix on the index is load-bearing, not ordering trivia: a thread/turn-only index answers
"does a row exist for this turn?" across tenants, which is a cross-tenant existence oracle for anyone
holding a turn ref.

## The ceiling — do not read the green suite as more than it is

**Convex validators cannot express "required only when `author === "agent"`".** A discriminated
union would invalidate every row already written, so all four new fields are optional and **a direct
`ctx.db.insert` of an agent row with NO lineage is accepted today**. The fixtures pin which
combinations are legal; they cannot refuse an illegal one, because refusal needs a writer to refuse
in. That writer is `publishAgentCandidate` (23-02).

`ponytail:` ceiling = permissive schema + behavioural fixtures. Upgrade path = 23-02's narrow writer
becomes the single insert site, plus a structural test that no other module inserts an
`author: "agent"` row.

This is written down because this repository has shipped the opposite mistake before (see
`green-tests-over-broken-capability`): mechanism coverage read as behaviour coverage.

## Mutation evidence — all executed, all restored, none left in the tree

| # | Mutation | Result |
|---|---|---|
| 1 | Add `document-analyst` (deliberately ungated, no eval runner) to `AGENT_AUTHORABLE_SKILLS` | **2 red** — `expected [ 'document-analyst', …(3) ] to deeply equal [ 'offer-architect', …(2) ]` and `expected true to be false` |
| 2 | Mutation 1 **plus** deleting the exact-set pin AND both subset assertions | **still 1 red** — the explicit rejection test catches it alone. Coverage is layered, not one assertion carrying everything |
| 3 | Reorder `by_tenant_source_turn` to `[sourceThreadId, sourceTurnId, tenantId]` and drop the tenant equality | **1 red** — `expected [ …2 rows ] to have a length of 1 but got 2`. The cross-tenant oracle is real and the test sees it |

Mutation 3 is the substitute for the plan's suggested "allow an agent row without source lineage"
mutation, **which is not expressible at this layer** — the schema already allows it (see the ceiling
above), so there is no guard to mutate and no red to produce. Recorded rather than faked.

## Measured

| Check | Result |
|---|---|
| `@pikar/contracts` `skillAuthoring.test.ts` | **8 passed** (was 3) |
| `@pikar/contracts` full package | **36 passed** / 3 files |
| `@pikar/backend` `skills.test.ts` | **91 passed** (was 87) |
| `@pikar/backend` `importGuard` + `llmRedaction` + `dashboardSchema` | **160 passed** / 3 files |
| `tsc --noEmit` contracts | exit 0 |
| `tsc --noEmit` backend | **0 errors** (4 `TS2532` introduced by the new index-access assertions were fixed to `.map`-based ones, not suppressed) |
| `biome check` on all four touched files | 0 errors (38 warnings, all pre-existing `noNonNullAssertion` on untouched lines) |
| `node scripts/check-playbooks.mjs` | `skill-registry.md` cleared |

## Bookkeeping notes for the next session

- **`check-playbooks.mjs` still reports three OTHER playbooks** (`agent-runtime.md`,
  `dashboard-pages.md`, `cockpit.md`) against `smoke.ts`, `dashboardSchema.test.ts`, `calendar*.ts`,
  `cockpit.ts`, `dispatchGuard.test.ts`. **None of those are Phase 23 files** — they belong to the
  17-08 calendar lane on this shared branch and were already flagged before this plan started.
- **`watch.json` gained `packages/backend/convex/skills.test.ts`** under `skill-registry.md`.
  `packages/backend/convex/schema.ts` was DELIBERATELY not added: it is a shared mega-file, and
  watching it would demand a skill-registry bump for every unrelated table change.
- **`schema.ts` carries an uncommitted foreign hunk** from the 17-08 lane (`cancelKind: "refused"`
  on the `plans` table, ~line 460). It was kept OUT of this commit by staging a version of the file
  with only the `tenantSkills` change, then restoring the foreign hunk to the working tree unstaged.
- One process note: `git checkout <file>` was used to restore mutation 1 and destroyed this plan's
  real edit alongside it. Re-applied from source. Use a scratchpad backup copy for mutations.

## Next

`23-02` — `publishAgentCandidate`: the one narrow internal mutation that can mint an Executive-Agent
row, candidate-only, with the ceiling above as its acceptance criterion.
