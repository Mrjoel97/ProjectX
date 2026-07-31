---
phase: 22-owner-authorization-primitive-requireowner
plan: 01
status: complete
uat: "Task 3 PASSED live 2026-08-01 — see 22-UAT-EVIDENCE.md"
completed: 2026-07-31
requirements: [GOVN-01]
---

# 22-01 Summary — identity + owner substrate

All three tasks are complete. **Task 3 ran live on 2026-08-01 and PASSED** — full evidence in
`22-UAT-EVIDENCE.md`.

## What shipped

| File | Change |
|---|---|
| `convex/schema.ts` | `users` override after `...authTables` — verbatim 7-field mirror of the pinned `@convex-dev/auth@0.0.94` table + both index names, widened by `owner: v.optional(v.boolean())`. No migration, no backfill. |
| `convex/lib/functions.ts` | `stableTenant` DELETED. `requireScope` now uses the official `getAuthUserId`. Added `requireOwner`, `ownerQuery`, `ownerMutation`. ctx now carries `userId` **and** `tenantId`. |
| `convex/owner.ts` | NEW — `viewer` (tenantQuery, returns only `{isOwner}`) and `bootstrapOwner` (internalMutation, idempotent, audited once). |
| `convex/owner.test.ts` | NEW — 10 tests, every negative case anti-vacuous. |
| `convex/tenant.test.ts` | Rewritten against real `users` rows and two session suffixes. |
| `convex/importGuard.test.ts` | Pure `stableTenant` unit tests replaced by a static identity guard on the wrapper source. |
| `convex/dispatch.test.ts`, `convex/evaluations.test.ts` | Dropped dead `stableTenant(TENANT)` calls (no-ops — `TENANT` carries no `\|sessionId`). |
| `docs/playbooks/authorization.md` | NEW playbook. |
| `docs/playbooks/watch.json` | Registered the above paths + `apps/web/app/(app)/ops/` under it. |
| `docs/playbooks/business-evaluation.md` | `Last verified` bumped — TEST-ONLY, states explicitly that no engine behaviour changed. |

## Key finding: the identity swap is provably behaviour-preserving

`getAuthUserId` is **byte-identical** to the deleted `stableTenant`:

```js
const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);  // "|"
return userId;
```

So **no tenant is re-keyed and no data moves.** The value is ownership of correctness: the auth
package now owns the subject format across a version bump instead of us, and the return is a
typed `Id<"users">` that `requireOwner` can pass straight to `ctx.db.get`.

## Evidence

- **Targeted suite:** `owner.test.ts` + `tenant.test.ts` + `importGuard.test.ts` — **71/71 green**.
- **No collateral damage:** `dispatch.test.ts` + `evaluations.test.ts` — **85/85 green**.
- **Playbook checker:** `node scripts/check-playbooks.mjs` — pass.
- **Mutation check (required):** weakened `viewer` to authentication-only
  (`isOwner: user !== null`) → **2 failed / 8 passed**; the absent-owner and explicit-`owner:false`
  tests turned RED. Reverted, re-ran green.
  - *Honest caveat:* the **orphan** test correctly stayed GREEN under this mutation — a deleted
    row reads `null` either way, so that test is sensitive to a different mutation (dropping the
    null check), not this one. Recorded rather than dressed up as a 3-way red.

## Typecheck delta (measured with `--force`; `pnpm typecheck` caches a stale pass and lies)

| | Total | In production `convex/*.ts` |
|---|---|---|
| Baseline (before) | 150 | **0** |
| After | 162 | **0** |

All +12 are in `owner.test.ts` and are **`Property 'owner' does not exist on type ...`** — the
generated API has not seen `owner.ts` yet because `_generated/` is codegen output (CLAUDE.md §7)
and `npx convex codegen` needs a running backend. **They resolve when codegen runs at the Task 3
checkpoint.** Three genuinely-mine errors were found and fixed (an unused `@ts-expect-error` and
two `'event' is possibly undefined` under `noUncheckedIndexedAccess`).

> Note: the baseline itself moved from the **52** recorded in `PARALLELIZATION.md` (2026-07-27) to
> **150**, purely from test files added by phases 15.2/16/17/17.1 hitting the same
> `"types": ["node"]` tsconfig artifact. The load-bearing property is unchanged: **zero errors in
> production `convex/` source.**

## Deviations from the plan as written

1. **`stableTenant` had three test consumers, not one.** The plan anticipated only
   `importGuard.test.ts`. `dispatch.test.ts` and `evaluations.test.ts` also imported it. Both call
   sites were provable no-ops and were removed. Neither file was foreign-modified at the time.
2. **`internal.audit.log` takes no `ts` arg** (the plan's `<interfaces>` block listed one); it
   stamps `Date.now()` itself.
3. **`owner.test.ts` needs `t.registerComponent("auditCounts", ...)`.** The real audit insert path
   maintains an aggregate, so the harness shape was reused verbatim from `calendar.test.ts` /
   `blueprint.test.ts` rather than invented.
4. **The static guard strips comments before its negative assertions.** Without that the guard
   punished its own documentation — a doc comment *warning against* `tokenIdentifier` reads
   identically to using it, so the wrapper could not explain the rule without failing it.
5. **No allowlist entry was needed** for `owner.ts`: the import guard's regex is case-sensitive
   and `internalMutation` never matches it.

## Task 3 — RAN LIVE 2026-08-01. PASS.

Executed live; see 22-UAT-EVIDENCE.md.

Original instructions, kept for the record — requires, on the intended deployment (NOT a lane deployment — a lane has its own,
owner-less deployment and would prove nothing):

```powershell
npx convex run owner:bootstrapOwner '{"userId":"<confirmed users._id>"}'   # expect changed: true
npx convex run owner:bootstrapOwner '{"userId":"<confirmed users._id>"}'   # expect changed: false
```

Resolve the id from deployment data and **confirm it before granting** — do not infer from
registration order, do not select by unverified email. If the deployment, the row, or either
result is ambiguous: stop. Then verify `owner === true`, exactly one `owner.granted` audit row,
and payload key set exactly `owner,userId`.
