# ADR-007: Sub-agent capability is code-owned; the sub-agent prompt is registry-owned

- **Status**: Accepted (2026-07-25 — Phase 15, DISP-01; recorded at the moment the first sub-agent became dispatchable)
- **Recorded**: 2026-07-25 (`packages/core/src/specialists.ts`, `packages/backend/convex/llm.ts` `runSpecialistTurn`)

## Context

CLAUDE.md §5 (formalized in ADR-003) requires every LLM prompt to be a versioned row in the
`skills` table, loaded at runtime, never hardcoded in source. The reason is churn and rollback:
a prompt change should be a status flip, not a deploy, and telemetry must be able to say *which*
prompt produced an output.

Phase 15 introduces the first **sub-agent** (DISP-01). A specialist is not a prompt — it is a
pair: a **skill body** and a **tool-set**. `runAgentLoop` already treated `system` as a swappable
seam (`runCockpitAgent` passes `skill.body` into it), so the body half was settled by §5 the day
it was written. The open question is the other half: is the tool-set also a `skills`-style
registry row, so that "what a specialist may do" is DB-editable alongside "what it is told"?

The question is not academic. The three growth specialists ship with `tools: ["searchVault"]` —
one read-only, tenant-scoped tool. Everything else in the 20-key cockpit tool record writes
(recipients, subject, body, attachments, plan status) or re-enters the diagnostic engine.

## Decision

**The BODY is registry-owned. The TOOL-SET is code-owned.**

- The body is a `skills` row, loaded by `runSpecialistTurn` through the §5 loaders
  (`internal.skills.getActiveSkill` / `getSkillVersion`), fail-closed on an unseeded skill, and
  eval-gated (all three specialist rubrics are in `GATED_SKILLS`). The loaded `version` rides the
  return so the lineage audit row can record `{name, version}`.
- The tool-set is a `readonly` constant in `packages/core/src/specialists.ts` — a pure data record
  in a Convex-free package (CLAUDE.md §1), with no mutation surface of any kind.
- The grant is enforced by **structural absence**: `runAgentLoop`'s `toolNames` filter removes the
  withheld keys from the tool record entirely, so `ai@7` raises `NoSuchToolError` before any
  `execute` runs. It is not `activeTools` (which leaves the closure in the record, still reachable
  via `invokeTool`) and it is emphatically not skill wording.

## Alternatives rejected

- **Tool-set as a `skills` row (or any other DB row).** A row edit would then widen what a
  sub-agent can do. There is no eval gate in front of "which tools", only in front of "which
  words", so this is a privilege escalation with nothing standing in its way. §5 exists to make
  prompt changes *cheap and reversible*; it does not ask for capabilities to be DB-writable, and
  the two properties pull in opposite directions.
- **`activeTools` instead of a filtered record.** One line shorter, and wrong: the withheld tool's
  `execute` closure survives in the record and `invokeTool` (llm.ts) can reach it. The
  `omitRecipientEdits` precedent (llm.ts:619-626) already settled that withholding means the key
  is *absent*, not discouraged.
- **Telling the specialist in its prompt which tools not to use.** A prompt is not a capability
  boundary. This is the failure mode §5 cannot protect against, because a prompt is exactly the
  thing that is DB-editable.
- **A second, specialist-specific agent loop with its own narrow tool set.** Two loops means the
  daily spend window is billed twice for one turn while `preCall` only ever sees the outer call,
  and `stopWhen: stepCountIs(8)` stops meaning anything. `dispatchGuard.test.ts` pins exactly one
  tool-bearing `generateText` call site.

## Consequences

- **Adding or widening a specialist is a code change, not a DB write** — a PR, a review, and a
  test run. Accepted cost. `specialists.test.ts` asserts the tool-set as an equality over the
  WHOLE registry, so adding a write tool to any specialist fails a test rather than passing
  quietly.
- **The registry is a pure data record in `@pikar/core`**, which is also the seam Phase 15.1 plugs
  its tier filter into. Because the grant is data rather than routing logic, 15.1 becomes a filter
  layer over `SPECIALISTS`, not an edit to `llm.ts` (PARALLELIZATION forbids Lane A from reading
  the tier there).
- **`evaluateBusiness` is deliberately withheld** from every specialist despite its read-shaped
  name: it calls `internal.evaluations.runEvaluation`, which persists an `evaluations` row and an
  audit row per call and re-enters the engine mid-dispatch. The evaluation snapshot reaches the
  specialist through its PROMPT instead (`internal.evaluations.lastForThread`) — cheaper and
  strictly read-only. The reasoning is left as a comment on the registry so a later phase does not
  "fix" it.
- **Ceiling**: the grant is per-specialist and static. If a future capability needs to be granted
  per-tenant or per-tier at runtime, the upgrade path is a filter applied to `SPECIALISTS` at
  dispatch time (still code-owned, still an allow-list) — never a DB-writable tool list.
- Every later sub-agent inherits this split and must cite this ADR when it registers: body in the
  registry, tools in the code.
