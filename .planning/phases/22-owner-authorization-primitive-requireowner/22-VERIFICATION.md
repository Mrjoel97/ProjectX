---
phase: 22-owner-authorization-primitive-requireowner
requirement: GOVN-01
verified: 2026-08-15T22:02:20Z
status: passed
score: "5/5 phase truths verified"
re_verification: true
---

# Phase 22: Owner Authorization Primitive Verification Report

**Phase goal:** A durable `requireOwner(ctx)` primitive gates the Phase-8 global controls and establishes the server-side convention for every later admin-like public control.

**Requirement:** GOVN-01  
**Status:** `passed`
**Verdict:** The authorization primitive and server trust boundary are implemented, tested, and proven live. A focused React component test now closes the former `/ops` presentation gap by rendering the real page with instrumented Convex hooks: exact owner true mounts the optimizer panels and their hooks; false, null, and loading do not mount their content or subscriptions while tenant operations remain.

## Goal Achievement

### Observable truths

| # | Truth | Status | Current evidence |
|---|---|---|---|
| 1 | Identity and ownership derive from durable auth-user data and fail closed. | VERIFIED | `schema.ts:23-34` widens the pinned auth `users` table with optional `owner`; `lib/functions.ts:38-58` uses `getAuthUserId`, reads the exact user row, and accepts only `owner === true`; `owner.test.ts` covers true/absent/false/orphan/unauthenticated states and session stability; `tenant.test.ts` proves two sessions share one user scope and two users remain isolated. |
| 2 | Owner bootstrap is exact, internal-only, idempotent, and redaction-safe. | VERIFIED | `owner.ts:47-70` exposes only an `internalMutation`, targets an exact `users._id`, changes false/absent to true once, and emits one `owner.granted` event with payload keys `owner,userId`. Current focused tests pass. Live evidence from 2026-08-01 records `changed:true` then `changed:false`, exactly one grant row, and no identity prose/PII. |
| 3 | The four Phase-8 public controls reject non-owners before their handlers can disclose or mutate global state. | VERIFIED | `optimizerConfig.ts:84,93` uses `ownerQuery`/`ownerMutation`; `skills.ts:183,203` uses `ownerMutation`/`ownerQuery`. `optimizerConfig.test.ts` and `skills.test.ts` prove non-owner refusal, no config/status change, and no candidate-body disclosure. The live two-identity run returned `OWNER_REQUIRED` from all four as an authenticated non-owner and left a pre-existing optimizer row byte-unchanged. |
| 4 | Internal CI/eval/operator paths and the independent skill EVAL_GATE remain operational. | VERIFIED | `optimizerConfig.getOptimizerConfig/setOptimizerConfig` remain internal; `skills.activateSkill` remains internal and shares the single `activateSkillVersion` implementation. Tests prove an owner can reach the independent `EVAL_GATE`, while trusted internal activation remains identity-free. The live owner path reached `NO_SUCH_SKILL_VERSION`, proving authorization passed and the skill gate still executed. |
| 5 | The `/ops` admin presentation is hidden from non-owners while tenant-visible operations remain. | VERIFIED | `opsPresentation.test.ts` server-renders the real `OpsPage` with recorded Convex hook references. Exact owner true renders the Optimizer heading/switch and executes every owner-only query/mutation hook. False, null, and loading render no optimizer content and execute none of those hooks, while Eval signals, DLQ, and Dead letters render and keep their tenant queries. The same focused test pins the unchanged shell's Compliance `/ops` link and `DeadLetterBadge` subscription. This is React component/mount evidence, not a claim of browser pixels or a live DOM run. |

**Score:** 5/5 truths verified.

## Required artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `packages/backend/convex/lib/functions.ts` | VERIFIED | `requireOwner`, `ownerQuery`, and `ownerMutation` exist and are wired through `customCtx(requireOwner)`; relevant file is clean against HEAD. |
| `packages/backend/convex/owner.ts` | VERIFIED | Boolean-only `viewer` and internal idempotent `bootstrapOwner`; relevant file is clean against HEAD. |
| `packages/backend/convex/schema.ts` | VERIFIED | Optional `users.owner` authority bit; no migration/backfill required. |
| `packages/backend/convex/optimizerConfig.ts` | VERIFIED | Both public optimizer functions are owner-wrapped; internal config seams remain internal. |
| `packages/backend/convex/skills.ts` | VERIFIED | Public candidate read/activation are owner-wrapped; shared internal EVAL_GATE remains single-source. |
| `apps/web/app/(app)/ops/page.tsx` | VERIFIED | Entire owner section is conditional on exact owner true; tenant sections are outside the branch. `opsPresentation.test.ts` renders this real component and records which Convex hooks mount. |
| `apps/web/app/(app)/ops/opsPresentation.test.ts` | VERIFIED | Four viewer-state render cases plus shell preservation evidence; positive owner assertions make deletion of the entire branch fail, and every non-owner case fails if the mount guard is removed. |
| `docs/playbooks/authorization.md` | VERIFIED | Documents the server trust boundary, component-level presentation proof, live deployment evidence, and honest evidence limits. |
| `docs/playbooks/watch.json` | VERIFIED | Registers the wrapper, owner module/tests, and `/ops` path under `authorization.md`; `check-playbooks` passes. |

## Key-link verification

| From | To | Via | Status |
|---|---|---|---|
| authenticated request | durable `users._id` | `getAuthUserId` in `requireScope` | WIRED |
| `ownerQuery` / `ownerMutation` | `users.owner` | `customCtx(requireOwner)` before handler execution | WIRED |
| `getOptimizerStatus` / `setOptimizerEnabled` | owner primitive | owner wrappers | WIRED |
| `candidatesForReview` / `activateCandidate` | owner primitive | owner wrappers | WIRED |
| `activateCandidate` | skill evidence gate | shared `activateSkillVersion` | WIRED |
| `/ops` owner boolean | optimizer subscriptions | conditional `<OptimizerPanel />` mount | WIRED; COMPONENT-RENDER VERIFIED |
| later Finance admin controls | owner primitive | `finance.ts` uses `ownerQuery`/`ownerMutation` for `globalRails`, `controls`, and all three setters | WIRED |

The current codebase therefore follows the “admin-ish controls start owner-gated” convention beyond the original four endpoints: the later Finance deployment controls are born on owner wrappers, and their UI skips owner-only queries for non-owners.

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| GOVN-01 | SATISFIED | The durable primitive, named public guards, independent eval gate, live server boundary, and component-rendered owner/non-owner presentation all pass. |

## Automated evidence collected 2026-08-16

### Presentation gap closure

- Focused command: `pnpm --filter @pikar/web test -- "app/(app)/ops/opsPresentation.test.ts"
  "app/(app)/ops/tenantSkillReview.test.ts" --maxWorkers=1` — **2/2 files, 20/20 tests passed**
  (presentation component 5, tenant-review source contract 15).
- Web TypeScript: `apps/web/node_modules/.bin/tsc.cmd --noEmit` — **exit 0**.
- Playbook coverage was rerun after updating `authorization.md`; the authorization subsystem is no
  longer named. The repository-wide decision remains blocked only by concurrent, out-of-scope
  `cockpitTools.test.ts`/`llm.ts` changes requiring `docs/playbooks/cockpit.md`; this lane did not
  touch or attest those files.
- Focused web component suite: `opsPresentation.test.ts` renders the real `OpsPage` through
  `renderToStaticMarkup` with only the Convex transport hooks mocked and recorded.
- The exact-owner case is anti-vacuous: it requires rendered Optimizer heading/switch content and
  the owner-only query/mutation hook names. Deleting the branch or changing the condition so the
  owner cannot enter makes this case fail.
- False, null, and loading viewer cases require no optimizer content and no owner-only hook names.
  Removing the mount guard makes all three fail because React executes the panels and their hooks.
- Every non-owner case positively requires rendered Eval signals, DLQ, Dead letters, the empty DLQ
  state, and their tenant query hooks. The shell assertion separately pins Compliance → `/ops` and
  the `DeadLetterBadge` subscription.
- Evidence level: component-rendered React output and hook execution, not browser layout, pixels,
  hydration, or a live-deployment DOM observation.

## Prior automated evidence collected 2026-08-10

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

## Optional live presentation spot-check

No human step remains blocking for GOVN-01. If deployment wiring or browser hydration changes, the
following remains a useful smoke test on the intended deployment:

1. **Owner rendering:** Sign in fresh as the confirmed owner and open `/ops`. Confirm the Optimizer heading, switch, and candidate review render after the fresh session.
2. **Non-owner rendering and tenant preservation:** Use a controlled authenticated non-owner whose onboarding/profile gate is already satisfied. Confirm no Optimizer heading, loading/error state, switch, candidate body/evidence, or Activate control appears. Confirm Eval signals, Dead letters, Compliance navigation, and the DLQ badge remain.
3. **Browser-level confirmation:** Confirm the shared Compliance navigation and DLQ badge remain.

The component test now supplies the mount-guard mutation sensitivity that the incomplete 2026-08-01
browser run lacked. The four direct API refusals and bootstrap do **not** need repeating unless the
configured deployment or owner row changed; they are already recorded live with anti-vacuity and
state-immutability evidence.

## Gaps summary

No current GOVN-01 gap was found. The server boundary is integration-tested and live-proven; the
presentation branch is component-rendered across exact owner, false, null, and loading states with
hook-execution assertions. Browser pixels were not observed and are not claimed.

---

*Verified: 2026-08-15T22:02:20Z*
*Verifier: Codex (GSD re-verification pass)*
