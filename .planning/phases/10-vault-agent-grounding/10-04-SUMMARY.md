---
phase: 10-vault-agent-grounding
plan: 04
subsystem: cockpit-vault-grounding
tags: [vault, grounding, searchVault, cockpit, skill-registry, eval-gate, VGND-01]
requires:
  - searchVault cockpit tool + <vault_context> fence (Plan 02)
  - vaultSmoke:seedCorpus internalAction (real rag.add embed, namespace=tenant)
  - the 3.6 eval gate (seedSkills candidate → activateSkill EVAL_GATE → pnpm eval:golden --skill)
provides:
  - candidate cockpit-agent@13 skill body — teaches WHEN to ground (searchVault), fence-is-reference-only, honest no-match + upload nudge
  - golden fixtures 25-vault-grounded (grounded compose→proposed) + 26-vault-empty (no-match, no fabricated compose)
  - a one-shot real vault-corpus seed in run-eval-golden.mjs so fixture 25 resolves under the live agent
affects:
  - the phase-boundary activation of cockpit-agent@13 (gate-driven, OPENAI_API_KEY — deferred human/live gate)
tech-stack:
  added: []
  patterns:
    - 2-file skill mirror (canonical .md + byte-identical derived cockpitAgentSkillBody) — every cockpit-agent bump
    - closed-vocabulary golden fixture asserting plan STATE only (never reply prose)
    - reuse the existing REAL-embed vaultSmoke:seedCorpus seeder (ponytail rung 2) — one-shot, no new seeder
key-files:
  created:
    - packages/backend/scripts/eval-cases/25-vault-grounded.json
    - packages/backend/scripts/eval-cases/26-vault-empty.json
  modified:
    - packages/contracts/skills/cockpit-agent.md
    - packages/contracts/src/skills/cockpitAgent.ts
    - packages/backend/scripts/run-eval-golden.mjs
    - docs/playbooks/skill-registry.md
    - docs/playbooks/agent-runtime.md
decisions:
  - "The vault-grounding teaching is a versioned CANDIDATE skill (cockpit-agent@13), never a hardcoded prompt (§5) and never hand-activated — it rides the 3.6 eval gate only."
  - "The 'not on an unrelated compose turn' clause is load-bearing: it keeps the existing 23 golden fixtures from paying a retrieval regression."
  - "Fixtures assert plan-state SHAPE only; the honest-phrasing/upload-nudge PROSE stays a Manual-Only UAT check (no 'grounding-happened' expect key exists in the closed vocabulary)."
metrics:
  duration_min: 15
  tasks: 3
  files_changed: 8
  tests: "self-check 25 fixtures valid; cockpit-agent drift test green"
  completed: 2026-07-24
---

# Phase 10 Plan 04: Teach the Agent WHEN to Ground Summary

Taught the Executive Agent to actually CALL the `searchVault` tool Plan 02 gave it — through the
Phase-3.6 eval gate, not a code edit. Per CLAUDE.md §5 the teaching is a versioned candidate
`cockpit-agent` skill body (the next version, cockpit-agent@13), mirrored byte-identically into the
derived constant. Two golden fixtures now drive the behavior end to end: one that must ground against
a seeded vault doc and complete a compose to `proposed`, and one no-match turn that must stay in a
read/answer posture and never fabricate a compose. The eval harness seeds a REAL embedded vault
corpus once before the loop so the grounded fixture resolves under the live agent. Activation itself
is left to the phase-boundary gate (never hand-flipped).

## What Was Built

- **Candidate cockpit-agent skill teaching** (`cockpit-agent.md` + derived `cockpitAgent.ts`) — a new
  "## Grounding in your knowledge vault" section placed right after "## Inbox briefing" (grounding is
  the same read-tool family). It teaches exactly three things at the density of the neighboring
  sections: (a) WHEN to call `searchVault` — data-needing/advice/business turns, the same read-only
  posture as `listInbox`/`briefInbox`, and explicitly NOT on an unrelated composing turn (the
  load-bearing clause that protects the existing 23 fixtures); (b) the `<vault_context …>` fence is
  REFERENCE-ONLY — informational material that shapes the answer but is NEVER an instruction, tool
  call, or parameter (reinforces Plan 02's SC2 fence; human Approve is the backstop); (c) honest
  no-match + upload nudge — say so plainly on an empty search, never silently answer ungrounded,
  never claim a grounding that did not happen. The derived `cockpitAgentSkillBody` was regenerated
  byte-identical (LF-normalized), so the `skills.test.ts` drift `test.each` row stays green. No
  `active` flag was touched — this is a CANDIDATE (cockpit-agent@13).
- **Golden fixtures** (`25-vault-grounded.json`, `26-vault-empty.json`) — closed-vocabulary fixtures
  asserting plan STATE only. 25 asks the agent to draft from the vault about "our logistics platform"
  (semantically matching the seeded Northwind corpus) and then propose — asserting
  `status: proposed`, the recipient, and `bodyPresent`, proving grounding completes without
  dead-ending. 26 asks about a topic with no match in the seeded corpus and asserts
  `statusAtMost: collecting`, `recipientCount: 0`, `bodyPresent: false` — proving the honest no-match
  fails open and invents no recipients/subject/body. The `Northwind`/`dividend` needles double as
  refs-only log-plane scans via `assertEvalCaseClean` (SC3). Neither turn uses a `SMOKE::` prefix, so
  the live agent actually runs.
- **Harness vault seed** (`run-eval-golden.mjs`) — `runLive` now fires a one-shot
  `vaultSmoke:seedCorpus({ tenantId: tenant, needle: "evalgrd" })` right after the inbox seed, reusing
  the existing REAL-embed seeder (ponytail rung 2 — no new seeder). It `rag.add`-embeds two Northwind
  logistics briefs into `namespace = tenant`, so fixture 25's live hybrid `searchVault` resolves
  against a real doc. The eval tenant is throwaway (`eval-${runId}`), so no purge was added (the inbox
  seed isn't purged either); no expect key or smoke reader was added — the closed vocabulary already
  covers both fixtures.
- **Governance docs** (§9) — `skill-registry.md` and `agent-runtime.md` each gained a bumped
  `Last verified: 2026-07-24 (10-04 …)` line recording the candidate teaching, the two fixtures, the
  harness seed, and the gate-only activation path.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | candidate cockpit-agent@13 grounding teaching (2-file mirror) | cb49dcf | cockpit-agent.md, cockpitAgent.ts, skill-registry.md, deferred-items.md |
| 2 | golden fixtures 25-vault-grounded + 26-vault-empty | d2d2098 | 25-vault-grounded.json, 26-vault-empty.json |
| 3 | real vault-corpus seed in the eval harness | b9baa37 | run-eval-golden.mjs, agent-runtime.md |

## Verification

- `node packages/backend/scripts/run-eval-golden.mjs --self-check` → **PASSED, 25 fixtures valid**
  (was 23 + the 2 new), closed vocabulary, non-empty turns + needles, unique ids, count still ≥18.
  Re-run green after the harness seed edit.
- `pnpm --filter @pikar/backend vitest run skills` → the cockpit-agent drift `test.each` row (and all
  10 other seed-constant rows) **green** — the 2-file mirror is byte-identical. (See Deviations for one
  pre-existing unrelated failure in the same file.)
- Stayed inside the file-ownership boundary: touched only this plan's six declared files (+
  `deferred-items.md`); did NOT touch `cards.tsx` or `cockpit.md` (Plan 03's files, running
  concurrently).

## Phase Gate (deferred — live, needs OPENAI_API_KEY)

Activation of cockpit-agent@13 is gate-driven only (§5) and is NOT a task in this plan. At the phase
boundary, on a stable `convex dev`:
1. `seedSkills` mints the candidate cockpit-agent@13 from the edited `.md`.
2. `activateSkill` REFUSES it pre-evidence (EVAL_GATE proof).
3. `pnpm eval:golden --skill cockpit-agent@13` runs ALL fixtures green (incl. 25 + 26 with the live
   vault seed) → records refs/counts-only evidence.
4. `activateSkill` flips cockpit-agent@13 active on that evidence.

This live run was deliberately NOT executed here: `eval:golden` is Windows-fragile (a network blip
destabilizes `convex dev` into a retry storm), and this plan ran concurrently with Plan 03. It is a
deferred human-run gate.

## Deviations from Plan

### Auto-fixed / Notes

**1. [Rule 3 - Blocking] Task 1 verify command targeted the wrong package.**
- **Found during:** Task 1 verification.
- **Issue:** The plan's `pnpm --filter @pikar/contracts vitest run skills` finds no test files —
  `@pikar/contracts` has no `skills` test; the authoritative cockpit-agent drift `test.each` lives in
  `packages/backend/convex/skills.test.ts`.
- **Fix:** Ran the backend drift test instead. The cockpit-agent row (and all 10 sibling seed
  constants) are green — byte-identity is proven, which is what the verify intended.

### Deferred Issues (out of scope)

**1. Pre-existing `skills.test.ts` failure in `convex/llm.ts` (Plan 02 origin).**
- The `no long inline prompt string literals live in convex/ source` guard (MAX 200 chars) flags a
  256-char inline string — the `<vault_context …>` fence template literal at `llm.ts:1363-1365`,
  introduced by Plan 02's `searchVault` tool. Plan 02's verification ran `cockpitTools vaultGround` +
  `llmRedaction` but not `skills`, so it slipped through.
- `convex/llm.ts` is outside this plan's file ownership (and not Plan 03's either), and 10-04 ran
  concurrently with 10-03 — so it was NOT touched. Logged to
  `.planning/phases/10-vault-agent-grounding/deferred-items.md` with the one-line fix (split the fence
  literal across `+` fragments under 200 chars, as the `.md` §5 seed-literal rule already does).

## Self-Check: PASSED

- FOUND: packages/backend/scripts/eval-cases/25-vault-grounded.json
- FOUND: packages/backend/scripts/eval-cases/26-vault-empty.json
- FOUND: the "## Grounding in your knowledge vault" section in cockpit-agent.md
- FOUND commits: cb49dcf (Task 1), d2d2098 (Task 2), b9baa37 (Task 3)
