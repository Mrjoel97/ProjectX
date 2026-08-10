# Deferred Items

## 17-02 verification

- `pnpm typecheck` on 2026-07-29 reached the backend package and reported the pre-existing,
  out-of-scope baseline in unrelated test files (for example `audit.test.ts`, `dispatch.test.ts`,
  `evaluations.test.ts`, and `vault.test.ts`). One new `calendar.test.ts` helper error was fixed
  inline; a follow-up backend typecheck reported 59 baseline diagnostics and zero in
  `convex/calendar*`. Phase 17-02 did not modify the foreign files. At the same final code state,
  `calendar.test.ts` passed 25/25 and the plan quick gate passed 30/30 with
  `dispatchGuard.test.ts`.

## 17-04 verification

- `pnpm test` ran twice on 2026-07-30. Each run passed 815/816 backend tests and failed a
  different assertion in `convex/onboarding.test.ts`; the first failed assertion passed when
  rerun alone. No Calendar, cockpit, dispatch-guard, retrier, or audit test failed. This is an
  unrelated nondeterministic onboarding isolation issue and is outside 17-04's write set.
- `pnpm typecheck` reported 145 diagnostics, all in `*.test.ts` files and zero in production
  code. The seven diagnostics in touched Calendar/cockpit tests are the existing unused
  `@ts-expect-error` import-meta guards already present before 17-04; no new non-test diagnostic
  was introduced.

## 17-05 out-of-scope discoveries (logged, deliberately NOT fixed)

- **`buildAgentContext` (`llm.ts`) has no `calendar_event` branch, and now none for
  `calendar_manage` either.** A staged Calendar plan is therefore described to the model under
  "Current email plan:" with Recipients / Send-mode / Send-time slots — the exact defect the
  2026-07-26 playbook entry fixed for `memo`, never extended to Calendar. PRE-EXISTING since 17-01
  and out of 17-05's write set. `calendar_manage` is unreachable today (no tool stages it), so the
  new half is inert; Plan 17-09 owns the staging tool and must add the branch in the same commit.
- **`ApprovalsView.tsx` renders no detail line for a `calendar_manage` plan** (the
  `plan.kind === "calendar_event"` block at `:484` has no sibling). 17-05 added only the badge
  label, the honest `actionLabel` and the honest `titleFor`, because the compiler forced the first
  and honesty forced the other two. The detail line needs the registry read that 17-09-03 owns.
- **The 2026-08-10 verifier's Calendar timeouts (G4) did not reproduce at HEAD.** 39/39 in
  9.6-14.5s across cold and warm caches, and a planted never-resolving promise fails by the
  per-test timeout with the test NAMED. Recorded as environmental. No test-lifecycle defect was
  found, so per the plan's own instruction no timeout regression test was added.
