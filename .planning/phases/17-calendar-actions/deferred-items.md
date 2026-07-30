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
