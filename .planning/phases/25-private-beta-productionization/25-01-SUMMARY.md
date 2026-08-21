---
phase: 25-private-beta-productionization
plan: 01
subsystem: beta-admission
tags: [BETA-01, auth, authorization, convex-auth, invites]
requires:
  - packages/backend/convex/lib/functions.ts (ownerMutation / ownerQuery, GOVN-01)
  - "@convex-dev/auth@0.0.94 (pinned exact, CLAUDE.md §6)"
provides:
  - packages/backend/convex/invites.ts (waitlist, preflight, owner-gated approval, admitIdentity)
  - packages/backend/convex/auth.ts (Google + Microsoft Entra ID + password, createOrUpdateUser)
  - betaWaitlist / betaInvites tables
  - docs/playbooks/beta-admission.md
affects:
  - packages/core/src/tenantData.ts (fifth category, admission_plane)
  - packages/backend/convex/tenantExport.ts (omission loop)
  - biome.json + lib/allowlist.ts (invites.ts is the first PUBLIC raw-builder entry)
tech-stack:
  added: []
  patterns:
    - "callbacks.createOrUpdateUser as an atomic admission gate inside auth:store"
    - "provider-qualified subject binding (${provider.id}|${oauthSubject})"
    - "source-guard tests over a pinned dependency's internals"
key-files:
  created:
    - packages/backend/convex/invites.ts
    - packages/backend/convex/invites.test.ts
    - docs/playbooks/beta-admission.md
  modified:
    - packages/backend/convex/auth.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/lib/allowlist.ts
    - packages/backend/convex/importGuard.test.ts
    - packages/backend/convex/tenantExport.ts
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - biome.json
decisions:
  - "Email is the first-redemption matching key ONLY; the persisted authorization root is provider-qualified"
  - "Password admission is asymmetric — the self-asserted email additionally requires the typed code"
  - "Cross-provider account linking fails closed for the beta rather than silently merging accounts"
  - "No Convex-side rate limit on requestAccess — a keyless global limit on public signup converts spam into a DoS on real users; the correct layer is the edge, keyed by IP"
metrics:
  tests: 122 (invites 33, importGuard 89) + core tenantData 3
  duration: ~35min (verification lane)
  completed: 2026-08-16
---

# Phase 25 Plan 01: Beta Admission Trust Boundary Summary

Invite-only admission enforced inside the `auth:store` transaction: a public waitlist, owner-gated
single-use email-bound invites, and a `createOrUpdateUser` callback that refuses an uninvited
identity before any user, account, verification code or session row exists.

## What this lane actually did

The implementation (`invites.ts`, `invites.test.ts`, schema, allowlist, tenantData/tenantExport,
biome.json, playbook) was authored and committed in parallel as `a584793` while this lane was
verifying it. This lane's contribution is therefore **verification plus the two gaps that
verification exposed**, committed on top.

**Read the pinned package source rather than trusting the comments.** Four load-bearing claims in
`invites.ts`/`auth.ts` were assertions about `@convex-dev/auth@0.0.94` internals. All four were
confirmed against `node_modules/.../dist/server/`:

| Claim | Verified at |
| --- | --- |
| `createOrUpdateUser` runs before `createOrUpdateAccount`, in one mutation | `implementation/users.js` `upsertUserAndAccount` |
| A custom callback short-circuits the default user insert entirely | `users.js` `return await config.callbacks.createOrUpdateUser(...)` |
| `existingUserId` comes from the matched ACCOUNT only, so cross-provider arrives as `null` | `users.js` `existingAccount?.userId ?? null` |
| `id` is stripped from the OAuth profile before the callback | `implementation/index.js:207` |
| Password `signIn` of an existing account never reaches the callback (no lockout) | `mutations/createAccountFromCredentials.js` early return |

## Deviations from Plan

### [Rule 1 - Bug] The test fixtures misdeclared the OAuth provider type

**Found during:** verification of Task 2. **Issue:** `googleProvider`/`entraProvider` fixtures
declared `type: "oauth"`. Auth.js normalizes both Google and Entra to **`"oidc"`**; only the *args*
`type` is hardcoded `"oauth"` by `userOAuth.js`, so the two fields disagree at runtime. Not
exploitable — `admitIdentity` asks only whether the type IS `"credentials"`, which fails closed —
but the fixtures were describing a runtime that does not exist, and the next person to write
`provider.type === "oauth"` would have shipped a broken gate with a green suite.
**Fix:** fixtures corrected to `"oidc"` with the reason recorded inline and as playbook invariant 9.

### [Rule 2 - Missing critical coverage] Every test hand-wrote the provider object

**Found during:** the same check. **Issue:** all 27 committed tests fed `admitIdentity` synthetic
`{id, type}` literals, so nothing connected the suite to the providers `auth.ts` actually
configures. Dropping `oauthSubject` from the real Google mapper — which breaks **every live Google
signup** with `INVITE_NO_SUBJECT` — reddened zero tests. This is the repo's documented
green-tests-over-broken-capability class, sitting on the admission gate itself.
**Fix:** `auth.ts` now exports `google`/`microsoft`/`password` solely so the test can materialize
them through the package's own `providerDefaults` merge and assert the literals the other tests
hard-code, plus the `oauthSubject` survival and `inviteCode` passthrough.

### [Rule 2 - Missing critical coverage] The rollback property was prose only

**Issue:** "throwing rolls the transaction back" is a property of the pinned package's call
**order**, not of our code; every test proved only that `admitIdentity` throws. A version bump could
reorder it silently — the exact CLAUDE.md §6 hazard the code comment warned about in prose.
**Fix:** a source-guard block asserts the ordering inside `upsertUserAndAccount`, the callback
short-circuit, the `id` strip, and pins the version literal `0.0.94`, with a non-vacuity assertion
that the sources were actually read.

## Verification — measured, not asserted

```
packages/backend  vitest invites.test.ts importGuard.test.ts --maxWorkers=1
                  Test Files 2 passed (2) | Tests 122 passed (122)
packages/core     vitest src/tenantData.test.ts
                  Test Files 1 passed (1) | Tests 3 passed (3)
packages/backend  tsc --noEmit  -> 0 errors in owned files
packages/core     tsc --noEmit  -> exit 0
biome check <9 touched files + biome.json> -> 0 errors, 4 warnings (pre-existing)
node scripts/check-playbooks.mjs -> exit 0
```

### Mutation proof

Each mutation applied, suite run, then reverted; `invites.ts` diffed byte-identical to its
pre-mutation backup afterwards.

| Mutation | Reddens |
| --- | --- |
| Drop the `redeemedAt` single-use check | 2 |
| Drop the password `INVITE_CODE_REQUIRED` check | 2 |
| Replace the `by_email` lookup with `.first()` | 2 |
| `approve` as plain `mutation` not `ownerMutation` | 1 |
| Spread the whole profile onto the `users` row | 10 |
| Drop `oauthSubject` from the REAL google mapper | 1 — only the new guard |

The invite code never reaching the `users` table is proven twice over: `userFields` allow-lists
three fields, and Convex schema validation rejects the row outright if anything else is spread in
(that is why the profile-spread mutation reddens 10, not 1).

## Not closed, and why

1. **No live provider round trip has ever reached this callback.** Narrowed by this lane — the
   provider configuration half is now proven offline — but the network half stays open until
   25-11/25-12.
2. **Microsoft Entra is configured but unprovisioned.** No `AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` on
   any deployment. 25-02 must not ship that button as though it works.
3. **No rate limit on `requestAccess`.** Deliberate: a Convex mutation has no IP, so the only
   available limit is keyless and global — which would let one attacker deny signup to everyone.
   That is worse than the bounded spam it prevents. The correct layer is the edge, keyed by IP.
4. **First-invite bootstrap on a fresh deployment is a chicken-and-egg.** `approve` is an
   `ownerMutation` and `bootstrapOwner` needs an existing `users` row, so a deployment with zero
   users has no code path to admit anyone. The escape hatch is inserting one `betaInvites` row
   (`email`, `code`, `createdAt`) via the Convex dashboard. No code written for this — the platform
   already covers it.
5. **Erasure does not reach the admission plane** (a deleted tenant's email survives in
   `betaWaitlist`). Recorded for the owner; tenant deletion is Phase 22.1's irreversible surface.
6. **`isolation.test.ts` typechecks red** — untracked, owned by the concurrent 25-03 lane, actively
   changing during this session. Not touched. Zero typecheck errors in owned files.
