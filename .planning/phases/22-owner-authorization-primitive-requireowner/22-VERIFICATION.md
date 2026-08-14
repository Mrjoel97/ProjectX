---
phase: 22-owner-authorization-primitive-requireowner
requirement: GOVN-01
verified: 2026-08-10T18:00:43Z
status: human_needed
score: "4/5 phase truths verified; 1 presentation truth requires live human evidence"
re_verification: false
human_verification:
  - test: "Owner/non-owner /ops presentation and mount-guard mutation on the intended deployment"
    expected: "The owner sees the Optimizer section after a fresh login; the controlled non-owner sees no optimizer heading, loading/error state, switch, candidate body/evidence, or Activate control while Eval signals, Dead letters, Compliance navigation, and the DLQ badge remain; removing the mount guard exposes the heading and restoring it removes it again."
    why_human: "The 2026-08-01 live run proved the server boundary with two identities but could not reach a stable rendered /ops session because onboarding redirected the fresh identity and the local auth/backend later degraded. There is no /ops component test or completed browser artifact that substitutes for the missing DOM observation."
---

# Phase 22: Owner Authorization Primitive Verification Report

**Phase goal:** A durable `requireOwner(ctx)` primitive gates the Phase-8 global controls and establishes the server-side convention for every later admin-like public control.

**Requirement:** GOVN-01  
**Status:** `human_needed`  
**Verdict:** The authorization primitive and server trust boundary are implemented, tested, committed, and proven live. The remaining work is the explicitly recorded `/ops` presentation checkpoint; it is not a server-security gap, but it prevents a fully `passed` phase verdict.

## Goal Achievement

### Observable truths

| # | Truth | Status | Current evidence |
|---|---|---|---|
| 1 | Identity and ownership derive from durable auth-user data and fail closed. | VERIFIED | `schema.ts:23-34` widens the pinned auth `users` table with optional `owner`; `lib/functions.ts:38-58` uses `getAuthUserId`, reads the exact user row, and accepts only `owner === true`; `owner.test.ts` covers true/absent/false/orphan/unauthenticated states and session stability; `tenant.test.ts` proves two sessions share one user scope and two users remain isolated. |
| 2 | Owner bootstrap is exact, internal-only, idempotent, and redaction-safe. | VERIFIED | `owner.ts:47-70` exposes only an `internalMutation`, targets an exact `users._id`, changes false/absent to true once, and emits one `owner.granted` event with payload keys `owner,userId`. Current focused tests pass. Live evidence from 2026-08-01 records `changed:true` then `changed:false`, exactly one grant row, and no identity prose/PII. |
| 3 | The four Phase-8 public controls reject non-owners before their handlers can disclose or mutate global state. | VERIFIED | `optimizerConfig.ts:84,93` uses `ownerQuery`/`ownerMutation`; `skills.ts:183,203` uses `ownerMutation`/`ownerQuery`. `optimizerConfig.test.ts` and `skills.test.ts` prove non-owner refusal, no config/status change, and no candidate-body disclosure. The live two-identity run returned `OWNER_REQUIRED` from all four as an authenticated non-owner and left a pre-existing optimizer row byte-unchanged. |
| 4 | Internal CI/eval/operator paths and the independent skill EVAL_GATE remain operational. | VERIFIED | `optimizerConfig.getOptimizerConfig/setOptimizerConfig` remain internal; `skills.activateSkill` remains internal and shares the single `activateSkillVersion` implementation. Tests prove an owner can reach the independent `EVAL_GATE`, while trusted internal activation remains identity-free. The live owner path reached `NO_SUCH_SKILL_VERSION`, proving authorization passed and the skill gate still executed. |
| 5 | The `/ops` admin presentation is hidden from non-owners while tenant-visible operations remain. | HUMAN NEEDED | Current source is structurally correct: `ops/page.tsx:409-450` reads `api.owner.viewer`, computes exact `viewer?.isOwner === true`, and conditionally mounts the whole `OptimizerPanel`; Eval signals and Dead letters remain outside the condition. Web typecheck is green. However `22-UAT-EVIDENCE.md:87-112` explicitly records that owner/non-owner DOM steps and the UI mutation were not completed. |

**Score:** 4/5 truths fully verified; the fifth is code-complete but still needs live presentation evidence.

## Required artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `packages/backend/convex/lib/functions.ts` | VERIFIED | `requireOwner`, `ownerQuery`, and `ownerMutation` exist and are wired through `customCtx(requireOwner)`; relevant file is clean against HEAD. |
| `packages/backend/convex/owner.ts` | VERIFIED | Boolean-only `viewer` and internal idempotent `bootstrapOwner`; relevant file is clean against HEAD. |
| `packages/backend/convex/schema.ts` | VERIFIED | Optional `users.owner` authority bit; no migration/backfill required. |
| `packages/backend/convex/optimizerConfig.ts` | VERIFIED | Both public optimizer functions are owner-wrapped; internal config seams remain internal. |
| `packages/backend/convex/skills.ts` | VERIFIED | Public candidate read/activation are owner-wrapped; shared internal EVAL_GATE remains single-source. |
| `apps/web/app/(app)/ops/page.tsx` | VERIFIED (source), HUMAN NEEDED (live DOM) | Entire `OptimizerPanel` mount is conditional on exact owner true; tenant sections are outside the branch. No dedicated component test exists. |
| `docs/playbooks/authorization.md` | VERIFIED with noted drift | Documents identity, wrapper trust boundary, live checklist, and outstanding DOM half. Its mutation checklist still contains one stale line saying a post-write owner check must turn immutability tests red, while the immediately preceding section correctly explains Convex atomic rollback makes that mutation unobservable. This documentation inconsistency does not weaken the implemented boundary. |
| `docs/playbooks/watch.json` | VERIFIED | Registers the wrapper, owner module/tests, and `/ops` path under `authorization.md`; `check-playbooks` passes. |

## Key-link verification

| From | To | Via | Status |
|---|---|---|---|
| authenticated request | durable `users._id` | `getAuthUserId` in `requireScope` | WIRED |
| `ownerQuery` / `ownerMutation` | `users.owner` | `customCtx(requireOwner)` before handler execution | WIRED |
| `getOptimizerStatus` / `setOptimizerEnabled` | owner primitive | owner wrappers | WIRED |
| `candidatesForReview` / `activateCandidate` | owner primitive | owner wrappers | WIRED |
| `activateCandidate` | skill evidence gate | shared `activateSkillVersion` | WIRED |
| `/ops` owner boolean | optimizer subscriptions | conditional `<OptimizerPanel />` mount | WIRED IN SOURCE; LIVE DOM PENDING |
| later Finance admin controls | owner primitive | `finance.ts` uses `ownerQuery`/`ownerMutation` for `globalRails`, `controls`, and all three setters | WIRED |

The current codebase therefore follows the “admin-ish controls start owner-gated” convention beyond the original four endpoints: the later Finance deployment controls are born on owner wrappers, and their UI skips owner-only queries for non-owners.

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| GOVN-01 | HUMAN NEEDED | The durable primitive, four named Phase-8 guards, current later admin controls, tests, and live server boundary all satisfy the security substance. The requirement remains pending because the phase's own blocking `/ops` owner/non-owner presentation checkpoint was never completed. |

## Automated evidence collected 2026-08-10

### Passed

- Focused authorization suite, using the installed backend-local binary because the documented filtered `pnpm exec` could not resolve `vitest` in this checkout:
  - Command: `packages/backend/node_modules/.bin/vitest.cmd run convex/tenant.test.ts convex/owner.test.ts convex/optimizerConfig.test.ts convex/skills.test.ts convex/importGuard.test.ts --maxWorkers=1` from `packages/backend`.
  - Result: **5/5 files, 153/153 tests passed**.
  - Breakdown: skills 53, tenant 4, owner 10, optimizerConfig 11, importGuard 75.
- Backend TypeScript: `packages/backend/node_modules/.bin/tsc.cmd --noEmit` — **exit 0**.
- Web TypeScript: `apps/web/node_modules/.bin/tsc.cmd --noEmit` — **exit 0**.
- Playbook guard: `node scripts/check-playbooks.mjs` — **exit 0**.
- Relevant Phase-22 implementation/playbook files were clean against HEAD during verification.

### Environmental/incomplete checks

- The documented command `pnpm --filter @pikar/backend exec vitest ...` failed before tests with `Command "vitest" not found`, despite `packages/backend/node_modules/.bin/vitest.cmd` existing. The direct installed binary produced the green result above; this is command-resolution drift, not a product failure.
- Current `next build` reached optimized compilation but failed because the sandbox could not fetch Bricolage Grotesque, JetBrains Mono, and Public Sans from Google Fonts. No Phase-22 compile/type error was reported; web TypeScript passed, and `22-03-SUMMARY.md` records a prior green production build.
- A full backend suite was started but deliberately terminated without a verdict when the verifier was instructed to finalize promptly. It is not claimed as current evidence. The phase-focused 153-test suite is green.

## Live evidence already obtained

`22-UAT-EVIDENCE.md` records the intended configured deployment on 2026-08-01:

- Exact intended owner bootstrap: first call changed true, second false.
- Exactly one refs/boolean-only `owner.granted` audit row.
- Authenticated non-owner: `owner.viewer -> false`; all four protected APIs returned `OWNER_REQUIRED`.
- Refused optimizer write left a real existing row byte-unchanged.
- Same identity after owner grant: viewer true, optimizer read/toggle worked, candidate bodies were readable, and bogus activation reached `NO_SUCH_SKILL_VERSION` rather than the owner guard.
- Environment cleanup left one real owner, no UAT accounts, and optimizer dormant.

This is substantive two-direction proof of the server trust boundary, not an inferred or source-only claim.

## Human verification required

Use a healthy intended deployment and satisfy only the still-missing presentation steps:

1. **Owner rendering:** Sign in fresh as the confirmed owner and open `/ops`. Confirm the Optimizer heading, switch, and candidate review render after the fresh session.
2. **Non-owner rendering and tenant preservation:** Use a controlled authenticated non-owner whose onboarding/profile gate is already satisfied. Confirm no Optimizer heading, loading/error state, switch, candidate body/evidence, or Activate control appears. Confirm Eval signals, Dead letters, Compliance navigation, and the DLQ badge remain.
3. **Mount-guard mutation proof:** In an isolated temporary change, remove the `isOwner` mount condition, rebuild, and confirm the non-owner sees the Optimizer heading (RED). Restore the condition, rebuild, and confirm it disappears again. Do not retain the mutation.

The four direct API refusals and bootstrap do **not** need repeating unless the configured deployment or owner row changed; they are already recorded live with anti-vacuity and state-immutability evidence.

## Gaps summary

No current server-authorization gap was found. GOVN-01's security boundary is implemented and proven. One human presentation checkpoint remains, plus two non-blocking documentation/tooling drifts:

- `22-VALIDATION.md` still shows Wave-0 and task rows as pending even though the tests and server live gate subsequently completed.
- `authorization.md` contains the stale post-write mutation bullet described above.

Because the phase plan explicitly made owner/non-owner `/ops` rendering and its UI mutation a blocking checkpoint, the honest result is `human_needed`, not `passed` and not `gaps_found`.

---

*Verified: 2026-08-10T18:00:43Z*  
*Verifier: Codex (GSD verification pass)*
