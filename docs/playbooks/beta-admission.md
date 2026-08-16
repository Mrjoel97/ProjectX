# Playbook: Beta Admission (BETA-01)

> Last verified: 2026-08-16 against `a584793` + the provider-shape guard (25-01 — waitlist,
> owner-gated invites, and the
> `createOrUpdateUser` admission transaction for Google / Microsoft Entra ID / password).
> Build history: `.planning/phases/25-private-beta-productionization/` · Related ADRs: ADR-018
> (one shared Microsoft app registration)

## Purpose

The private beta is invite-only. This subsystem decides **whether a second human may become a
tenant at all** — a public waitlist anyone can join, owner-gated approval that mints one single-use
email-bound invite, and the auth-transaction hook that refuses an uninvited identity before any
row describing it exists.

It is a data-integrity boundary, not a signup-page affordance. The UI in `25-02` can only ever
hide a door; this is the lock.

## Key files

Backend

- `packages/backend/convex/invites.ts` — the whole subsystem. `requestAccess` / `preflight` are
  public and unauthenticated; `pending` / `approve` are `ownerQuery` / `ownerMutation`;
  **`admitIdentity` is the boundary itself** and is called only from `auth.ts`.
- `packages/backend/convex/auth.ts` — provider configuration and the one-line
  `callbacks.createOrUpdateUser` delegation. Also the Password provider's `inviteCode` passthrough.
- `packages/backend/convex/schema.ts` — `betaWaitlist`, `betaInvites`.
- `packages/backend/convex/lib/allowlist.ts` — `invites.ts` is the one **public** entry.
- `biome.json` — `overrides[].includes` must ALSO list `invites.ts` (see Invariants).

Pure packages

- `packages/core/src/tenantData.ts` — `TENANT_TABLE_CLASSIFICATION` classifies both tables as
  `admission_plane`.

Tests

- `packages/backend/convex/invites.test.ts` — 33 tests, $0, the whole contract. The last two
  `describe` blocks are guards rather than behaviour: they materialize the REAL exported provider
  configs and pin the auth package internals the rollback rests on (see Invariants 9 and 10).
- `packages/backend/convex/importGuard.test.ts` — the two-allowlist divergence guard.
- `packages/core/src/tenantData.test.ts` — the 45-table classification drift test.

## Dependencies & blast radius

Not visible to graphify:

- **`@convex-dev/auth@0.0.94`, pinned exact (CLAUDE.md §6).** The security property depends on
  package *internals*: `dist/server/implementation/users.js` calls `createOrUpdateUser` from inside
  `upsertUserAndAccount` **before** `createOrUpdateAccount`, and
  `dist/server/implementation/index.js` destructures `const { id, ...profile } = await
  provider.profile(...)` so `id` never reaches the callback. **If this package is ever bumped,
  re-read both files and re-run `invites.test.ts` before trusting admission.** Both facts are now
  asserted against the installed package source by the `pinned @convex-dev/auth internals` block,
  which also pins the version literal — so a bump reddens the suite instead of silently changing
  the ordering that makes a throw a rollback.
- **Deployment env, NOT in source.** `microsoft-entra-id` derives its credential names from the
  provider id (`@auth/core/lib/utils/env.js`), so it needs
  `AUTH_MICROSOFT_ENTRA_ID_ID` and `AUTH_MICROSOFT_ENTRA_ID_SECRET`, plus an Azure app registration
  whose redirect URI is `${CONVEX_SITE_URL}/api/auth/callback/microsoft-entra-id`. These are
  **distinct from** the mailbox credentials (`MICROSOFT_OAUTH_CLIENT_ID`) — sign-in and mailbox are
  two different grants over one app registration. See Known gaps.

## Data flow

1. A stranger posts `invites.requestAccess({email, name?, referral?})` → one `betaWaitlist` row,
   `status: "pending"`. Idempotent per normalized address. **No user, no tenant, no identity.**
2. The owner calls `invites.pending` → the queue. It never returns a code.
3. The owner calls `invites.approve({waitlistId})` → mints one `betaInvites` row with a 16-character
   code, flips the waitlist row to `approved`, and returns `{inviteId, code, email}`.
   **Replay returns the existing invite** rather than minting a second.
4. The owner hands the invited person `/signup?invite=<code>`.
5. The signup page may call `invites.preflight({code})` → `{valid, invitedEmailMasked}`. **This is a
   courtesy, not a gate.** It exists so the page can refuse before an OAuth round trip.
6. The person signs in. Convex Auth opens the `auth:store` mutation and calls
   `createOrUpdateUser` → `admitIdentity`:
   - `existingUserId` present → returning identity. Patch allowed profile fields, return. **No
     invite is checked or consumed.**
   - otherwise → normalize the email, find an **unredeemed** invite on it, (credentials only) match
     the typed code, insert the `users` row, then patch the invite's three redemption fields.
   - any refusal throws → **the whole transaction rolls back.**

## Invariants — what must never break

1. **An uninvited identity leaves nothing behind.** Not just no `users` row — no `authAccounts`, no
   `authSessions`, no `authVerificationCodes`, no `authVerifiers`. Enforced by
   `invites.test.ts`'s `identityRows()` full-census comparison across every refusal path. The
   rollback itself was verified empirically (a write-then-throw probe inside `t.run` leaves nothing).
2. **Email is the first-redemption matching key only; the authorization root is
   `${provider.id}|${oauthSubject}`.** Provider-qualified, so the same raw `sub` from two issuers is
   two people. Enforced by the Google/Entra subject tests; mutation-proven (dropping the qualifier
   reddens 3).
3. **An invite is single-use and its redemption fields are immutable.** Only unredeemed invites
   match. Enforced by "a second, different subject cannot redeem a spent invite", which compares the
   whole row byte-for-byte; mutation-proven (dropping the `redeemedAt` check reddens 2).
4. **Password admission additionally requires the code.** An OAuth email is provider-verified; a
   password email is self-asserted, so the address alone must never admit. Enforced by the
   `password admission is asymmetric` block; mutation-proven (reddens 2).
5. **Cross-provider account linking is unsupported and fails closed.** The first provider to redeem
   spends the invite; the second is refused rather than silently merged. This is a beta limitation,
   not a bug — tell users "sign in with the provider you used at signup". **Mailbox connection is
   unaffected**: one account can still connect both Gmail and Outlook.
6. **Admission never grants authority.** `admitIdentity` writes only `email` / `name` / `image` /
   `emailVerificationTime`. `owner` is granted solely by `owner.bootstrapOwner`. Enforced by "a
   returning identity keeps its owner bit".
7. **Public responses leak nothing.** `preflight` returns a masked address and a boolean; an unknown
   code and a spent code are reported **identically**, so it cannot be used as an oracle. `pending`
   never returns a live code. Raw codes never enter audit payloads (CLAUDE.md §4).
8. **`invites.ts` must be exempt in BOTH allowlists.** `RAW_BUILDER_ALLOWLIST` covers the runtime
   scan; `biome.json`'s `overrides[].includes` covers `style/noRestrictedImports`. Listing it in one
   only passes `pnpm test` and then **fails `biome ci` in CI**, and a red CI run means the
   `workflow_run`-gated production deploy never fires. Enforced by the divergence test in
   `importGuard.test.ts` — added because this exact failure happened while writing 25-01.

9. **The credentials branch is selected by `provider.type === "credentials"`, and nothing else.**
   Google and Entra materialize as type **`"oidc"`, NOT `"oauth"`** — Auth.js normalizes both to
   OIDC, while `userOAuth.js` separately hardcodes the *args* `type: "oauth"` around them, so the
   two fields genuinely disagree at runtime. Never branch on `provider.type === "oauth"`: asking
   only whether the type IS `"credentials"` fails **closed** (into the subject-bound OAuth path)
   for every present and future provider type. The fixtures asserted `"oauth"` until the
   provider-shape guard was added and immediately reddened; they now assert the real value.
10. **The provider objects the tests hand `admitIdentity` must be the ones the runtime produces.**
    `auth.ts` exports `google` / `microsoft` / `password` **solely** so `invites.test.ts` can
    materialize them through the package's own `providerDefaults` merge and assert the literals the
    other 31 tests hard-code. This is not decoration: `ConvexCredentials` literally returns
    `id: "credentials"` and only that merge lifts `"password"` over it, and if the OAuth mappers
    ever stopped returning `oauthSubject`, every real Google signup would fail `INVITE_NO_SUBJECT`
    while the whole synthetic suite stayed green. Mutation-proven — dropping `oauthSubject` from the
    real mapper reddens exactly one test, and it is this one.

## How to change safely

**Adding a schema table** (this is a 4-file change, not a 1-file change): `schema.ts` →
`TENANT_TABLE_CLASSIFICATION` in `packages/core/src/tenantData.ts` → the table-count literal in
`tenantData.test.ts` → and if you add a *category*, `tenantExport.ts`'s `omittedReason` union **and**
its omission loop, or the table silently vanishes from the export manifest.

**Adding a sign-in provider**: configure it in `auth.ts` with an explicit `profile` returning both
`id: p.sub` and `oauthSubject: p.sub`; add a subject-shape test to `invites.test.ts`; then provision
`AUTH_<PROVIDER_ID_UPPER_SNAKE>_ID` / `_SECRET` on the deployment and register the redirect URI.
**The tests pass with the live door dead** — synthetic profiles never touch the provider — so a
provider is not shippable until a real browser has signed in through it.

**Changing a refusal code**: `25-02`'s signup page maps them to one generic message. Keep them
distinguishable in logs and indistinguishable to the user; never add a code that reveals whether a
particular address is on the list.

## How to verify

| Command | Proves |
| --- | --- |
| `pnpm --filter @pikar/backend exec vitest run convex/invites.test.ts` | The whole contract, offline, $0. 33 tests. |
| `pnpm --filter @pikar/backend exec vitest run convex/importGuard.test.ts` | The two allowlists agree, and raw builders stay scoped. |
| `pnpm --filter @pikar/core exec vitest run src/tenantData.test.ts` | No unclassified table. |
| `npx biome check packages/backend/convex/invites.ts` | The Biome override is actually in effect. Expect zero errors. |
| `pnpm --filter @pikar/backend typecheck` | The callback matches the pinned auth package's signature. |
| **Manual, live only** | That a real Google / Microsoft / password sign-in is refused when uninvited and admitted when invited. **No automated test can prove this** — see Known gaps. |

Mutation checks recorded at 25-01, each applied then reverted and the file diffed back to identical:

| Mutation | Reddens |
| --- | --- |
| Drop the `redeemedAt` single-use check | 2 |
| Drop the password `INVITE_CODE_REQUIRED` check | 2 |
| Replace the `by_email` invite lookup with `.first()` (any invite admits anyone) | 2 |
| `approve` as a plain `mutation` instead of `ownerMutation` | 1 |
| Spread the whole provider profile onto the `users` row | 10 |
| Drop `oauthSubject` from the REAL google mapper in `auth.ts` | 1 — and only the provider-shape guard |

The last row is the one that matters most: that break kills every live Google signup, and before the
provider-shape guard existed it reddened **nothing**.

## Operational notes

- **Bootstrapping the first owner** is manual and unchanged:
  `npx convex run owner:bootstrapOwner '{"userId":"..."}'` from `packages/backend`. There is no
  self-service path to `owner: true`, deliberately.
- **Supporting a stuck invitee.** Read `betaInvites` by email. If `redeemedAt` is set and they
  cannot sign in, they are almost certainly using a *different provider* than the one that redeemed
  it — check `redeemedSubject`'s prefix. That is invariant 5 working, not a fault.
- **Rollback / re-issue.** There is no "revoke" function. To re-issue, delete the `betaInvites` row
  and re-run `approve`. Deleting a *redeemed* row does not remove the account it created.
- The invite code is shown to the owner by `approve` and is stored raw, so it can be re-read.

## Known gaps & deferred work

1. **The live admission gate has never run.** Every test here drives `admitIdentity` with synthetic
   profiles. Whether a real provider round trip reaches the callback with the fields we assume is
   unproven until `25-11`/`25-12`. This is the repo's documented
   green-tests-over-broken-capability class and it is why the table above ends with a manual row.
   **Narrowed, not closed:** the provider *configuration* half is now proven offline — the shapes
   the callback receives, the `oauthSubject` survival, the `inviteCode` passthrough, and the call
   ordering inside the pinned package. What remains genuinely unproven is only the network round
   trip: that the real issuer returns the claims those mappers read.
2. **Microsoft Entra sign-in is configured but unprovisioned.** No `AUTH_MICROSOFT_ENTRA_ID_ID` /
   `_SECRET` exists on any deployment and `deploy-production.yml` does not validate them. Until they
   are set, the Microsoft button on `/signup` will error at the provider. `25-02` must not ship that
   button as though it works.
3. **Erasure does not reach the admission plane.** A tenant deletion removes the `users` row but
   leaves `betaWaitlist` / `betaInvites` rows holding that person's email. `admission_plane` is
   excluded from `deletableTables()` by construction. This is a **real open Art. 17 question**,
   deliberately not decided in an admission plan — tenant deletion is Phase 22.1's owned,
   irreversible surface. Recorded for the owner in `tenantData.ts`.
4. **No rate limit on `requestAccess`.** It is public, unauthenticated and writes a row. Idempotency
   per address bounds the damage to one row per distinct address, but nothing bounds distinct
   addresses. ponytail: idempotency is the whole defence; add the Rate-Limiter component if the
   waitlist is ever abused.
5. **No email is sent.** Approval mints a code and the owner delivers the link by hand. There is no
   transactional email sender in the project yet (the same gap that defers password verify/reset).
