---
phase: 21-user-authored-skills-and-routines
verified: 2026-08-20
status: passed
score: "3/3 success criteria verified"
requirements:
  SKILL-01: complete
gaps: []
open_observations:
  - "Tenant runtime attribution for the live author tenant was not observed; this is not claimed."
  - "21-LIVE-RESULT.json is absent by design because the stricter Plan 21-08 result schema could not be completed truthfully."
  - "21-VALIDATION.md still has draft/pending bookkeeping even though its mutation ledger was rerun in 21-06 and the current focused checks are green."
---

# Phase 21: User-Authored Skills & Routines Verification Report

**Phase goal:** A user can author a tenant-scoped business adaptation through the eval-gated skill
registry, with candidate-only publication, passing-eval activation, immutable versions and a safe
rollback path. The pre-beta routine surface is an inert pinned prompt re-run as a fresh ordinary
cockpit turn, not automation.

**Requirement:** SKILL-01 — “The user can author skills adapted to their business through the
eval-gated skills registry.”  
**Status:** `passed`  
**Verdict:** The requirement and all three ROADMAP success criteria are satisfied. The live record
proves exact-row held-out evaluation, owner activation, exact-baseline rollback, tenant invisibility
and a real non-owner refusal with no state change. Runtime attribution for the synthetic author
tenant remains unobserved and is not inferred from the eval harness. That limitation prevents the
stricter Plan 21-08 result artifact from passing, but it does not negate SKILL-01 or any of the
phase's three stated success criteria.

## Goal Achievement

| # | Phase success criterion | Status | Evidence |
|---|---|---|---|
| 1 | A user composes through an authoring surface that can write only a `candidate`, never `active`. | VERIFIED | Current `SkillAuthoringPanel` calls only `api.skills.publishUserCandidate` with `{name, authoredBody}`. Current `skills.ts` derives tenant and authenticated author server-side and inserts `status: "candidate"`, `author: "user"`, `authorUserId: ctx.userId`, with no activation call. Plan 21-06 records the authenticated browser publication and freezes the exact returned row in `21-LIVE-HANDOFF.json`. |
| 2 | A user-authored candidate leaves `candidate` only through a passing held-out eval recorded on that exact row; rollback to a prior active version is structurally exempt and works. | VERIFIED | `21-EVAL-EVIDENCE.json` binds the 41/41 unfiltered run `de976d8e` to candidate `qx73bwshbfds5nk7hd40vsf5y18cm7z0`, tenant `kn790hj6...`, `offer-architect` v12 and body hash `aee0008c...`. Current `planTenantActivation` requires `hasPassingTenantEvidence` for that exact user row, and `activateTenantCandidate` is owner-wrapped. The live session records owner activation to current-effective and rollback to exact baseline `qx73cg6grg5gjr9tx1r3bzs5zx8ck3te` v1 with `requiredEval: false`. |
| 3 | Authored skills are tenant-scoped and immutable-versioned with recorded `author=user` provenance. | VERIFIED | `21-LIVE-HANDOFF.json` records the candidate tenant, immutable id/version/body hash, `author: user`, `authorUserId`, lineage and exact rollback baseline. The live non-owner identity received `OWNER_REQUIRED`, saw neither the candidate nor A's pinned prompt, and left the handoff comparisons unchanged. Current source resolves active overlays by tenant/name, allocates new immutable versions, and never patches body/name/version/author/lineage/evidence during activation. |

**Score:** 3/3 success criteria verified.

## Three-Source Requirement Cross-Check

| Source | Finding | Result |
|---|---|---|
| Current implementation and focused tests | Closed authorable set and byte-capped composition; candidate-only authenticated publication; exact tenant evidence predicate; owner-wrapped exact-id activation; evidence-exempt eligible rollback; tenant-scoped effective loader; pinned-prompt fresh-thread source contract. | PASS |
| Plans and closing summaries | Plans 21-01 through 21-07 built and tested the substrate, browser handoff and exact held-out gate. Plan 21-08 records successful non-owner refusal, owner activation and exact-baseline rollback, while truthfully leaving runtime-attribution steps incomplete. | PASS for the phase criteria; PARTIAL only against Plan 21-08's stronger evidence protocol |
| Requirement and roadmap traceability | `REQUIREMENTS.md` marks SKILL-01 complete and records the runtime-attribution limitation. `ROADMAP.md` defines three success criteria and records all three as live-proven; none requires a post-activation runtime-attribution readback. | PASS |

## Current Source and Test Evidence

The current tree preserves the Phase-21 user path even though later Phase-23 agent-authoring work
now shares the registry module:

- `packages/contracts/src/skill.ts` keeps the exact three-name user-authorable set, deterministic
  composition and 4,000-byte UTF-8 cap, separate from agent authorability.
- `packages/backend/convex/skills.ts` accepts only `{name, authoredBody}` for user publication,
  derives authority and provenance from tenant context, and inserts only a candidate. Exact-row
  user activation still requires both passing tenant evidence and `ownerMutation`; rollback still
  requires `rollbackEligible` but no eval.
- `packages/backend/convex/llm.ts` and `dispatch.ts` retain the tenant pin/effective-loader and
  refs-only attribution implementation. This verifies the mechanism exists; it is not evidence that
  attribution was observed for the live author tenant.
- The routine-v0 surface remains saved tenant text re-run through the trusted cockpit hook into a
  fresh thread. No scheduler or routines table is claimed.

Focused zero-spend checks run on 2026-08-20:

| Check | Result |
|---|---|
| Contracts `src/skillAuthoring.test.ts` via the installed package-local Vitest binary | **15/15 passed** |
| Backend `skills`, `dispatch`, `savedPrompts`, and `importGuard` via the installed backend Vitest binary | **321/321 passed**, 4/4 files |
| Web `skillAuthoring`, `pinnedPrompts`, and `tenantSkillReview` source-contract suites via the installed web Vitest module | **43/43 passed**, 3/3 files |
| `pnpm --filter @pikar/backend eval:golden -- --self-check` | **PASSED**, 46 fixtures and 12 gated skills checked offline |

The documented filtered `pnpm ... exec vitest` commands could not resolve `vitest` for the
contracts and web packages in this checkout. The package-local installed binaries/modules were
used instead. The backend run emitted expected caught diagnostics from unrelated mocked RAG/network
paths, but finished green with 321 tests; no live or paid call was made by this verification.

## Live Evidence Boundary

The following is established by the recorded live artifacts:

- Candidate `qx73bwsh...` remained a candidate until exact passing evidence from run `de976d8e`
  was recorded on that row.
- A real authenticated non-owner (`kn735m0c...`) received `OWNER_REQUIRED`, observed empty
  tenant-owned candidate/prompt lists, and caused no state change.
- The owner activated the exact candidate; the tenant effective row became v12 while global and
  foreign state remained unchanged.
- Rollback restored exact baseline `qx73cg6g...` v1 without eval and preserved the archived
  candidate's immutable hash and evidence.

The following is **not** established and is not claimed:

- No post-activation specialist turn was run as the synthetic author tenant, so no tenant-A
  `subagent.completed` attribution row was observed.
- The existing attribution rows for the candidate belong to eval-harness tenants and do not
  substitute for an author-tenant runtime observation.
- `21-LIVE-RESULT.json` does not exist. Its schema requires author and foreign runtime, prompt-run
  and privacy fields that were not obtained; writing a partial object would falsely imply that the
  stricter Plan 21-08 machine gate passed.

This limitation does **not** block SKILL-01. The requirement asks whether a user can author a
business-adapted skill through the eval-gated registry, and the ROADMAP success criteria ask for
candidate-only authoring, eval-gated activation/rollback, and tenant-scoped immutable provenance.
Those outcomes were observed directly. Runtime attribution is useful assurance for the runtime
implementation and was a Plan 21-08 closure probe, but it is not part of the requirement wording or
the phase success-criteria contract.

## Recorded Commit Continuity

The implementation history named by the phase summaries remains ancestral to current `HEAD`,
including `32f36e3` (contracts/schema), `cd78145`/`7d43f47`/`04b6b8a` (publication, runtime overlay,
user surface), `ce04642`/`d2374bf`/`6cd236b`/`bb3c6e5` (exact evidence, dispatch pin and runner),
`18d8bca`/`70d54e3` (owner activation/rollback and review UI), `cf18305`/`fc20c60` (pinned prompts),
`5d14979` (browser/free gate), `f45c596` (live-gate split), `9326622` (baseline visibility fix), and
`aa97267` (41/41 held-out gate evidence).

## Validation and Documentation Reconciliation

`21-VALIDATION.md` remains marked `draft` and its per-task rows remain visually pending. That is
stale validation bookkeeping, not evidence that the tests were never run: `21-06-SUMMARY.md`
records the full free gate and all 22 mutation rows rerun red-then-green, and the current focused
suites above are green. The same summary records one narrower test-coverage observation: deleting
the scheduled-dispatch handoff did not redden the suite at that exact hop, although mutating the
consumption boundary did. This is a worthwhile future regression-test addition, but it does not
contradict the live candidate/eval/activation/rollback evidence or block SKILL-01.

## Verdict

Phase 21 and SKILL-01 pass. No requirement gap remains. The tenant runtime-attribution observation,
the absent strict live-result artifact, the scheduled-handoff test specificity, and stale validation
row bookkeeping remain documented limitations; none is upgraded into a claim or hidden by the
passing verdict.

---

_Verified: 2026-08-20_  
_Verifier: Codex three-source reconciliation against current source/tests, plans/summaries/live artifacts, requirement traceability and recorded commits_
