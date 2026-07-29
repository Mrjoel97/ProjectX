# Deferred Items

## 17-02 verification

- `pnpm typecheck` on 2026-07-29 reached the backend package and reported the pre-existing,
  out-of-scope baseline in unrelated test files (for example `audit.test.ts`, `dispatch.test.ts`,
  `evaluations.test.ts`, and `vault.test.ts`). One new `calendar.test.ts` helper error was fixed
  inline; a follow-up backend typecheck reported 59 baseline diagnostics and zero in
  `convex/calendar*`. Phase 17-02 did not modify the foreign files. At the same final code state,
  `calendar.test.ts` passed 25/25 and the plan quick gate passed 30/30 with
  `dispatchGuard.test.ts`.
