# Playbook: Beta Admission (BETA-01)

> Last verified: 2026-09-06 (36-01 — `AdminView`'s not-ready headline gains "N fixture seam(s) active — a
> provider is being faked." when `fixturesActive` is non-empty, matching `ops.envCheck`'s new `ready`
> conjunct (production-beta.md). `adminPresentation.test.ts` 10/10.)

> Last verified: 2026-09-06 (35-01, G23 — **THE PUBLIC PAGE SELLS WHAT SHIPS.** `page.tsx` metadata, JSON-LD
> and hero no longer say "connecting to your tools", "end to end" or "executes it autonomously"; a new
> "What you get" section (replies sent; meetings and documents done; the next move every week) precedes
> "How it works", itself rewritten as outcomes. Invoice reminders are NOT promised until the QuickBooks lane
> passes. Entry path unchanged (eyebrow, /signin, /signup, #how). `homeEntry.test.ts` 4/4 now scans for the
> three retired promises.)

> Last verified: 2026-09-05 (25.2-03 — the public home page (`apps/web/app/page.tsx`) is now WATCHED
> by this playbook: it is the front door of admission. Its eyebrow says "Private beta · by
> invitation" and "Request access" links to `/signup`'s waitlist door instead of a mailto
> (owner decision 3, invite-only). `homeEntry.test.ts` pins it. Admission logic is unchanged.)
>
> Last verified: 2026-08-30 (**/admin NOW NAMES THE AGENTS THAT HAVE NO PROMPT ROW, AND THE
> HEADLINE STOPPED LYING BY OMISSION.** `AdminView` renders `envCheck.unseededSkills` with the
> exact remedy on screen (`npx convex run skills:seedSkills '{}'` from `packages/backend`) rather
> than in a runbook nobody opens.
>
> **MEASURED, NOT HYPOTHETICAL.** Phase 29 added `knowledge-query-planner` and
> `knowledge-synthesizer` to `SEEDS`. The deployment was never re-seeded. Unified knowledge search
> was **completely inert** — the browser gate died on `NO_ACTIVE_SKILL: knowledge-query-planner` —
> while the entire unit suite stayed green, because `convex-test` seeds the registry INSIDE each
> test. One `npx convex run skills:seedSkills '{}'` turned the same spec green with no code change.
> A whole feature was dark, and the one surface whose job is "is this deployment configured?" did
> not look.
>
> The headline previously read *"Every required name is set."* — which stayed literally TRUE the
> whole time a feature was dark, because it reported one dimension of a `ready` flag that now has
> three. It now reads *"Every required name is set and every agent has its prompt."* when green, and
> when red it composes the faults it actually found instead of naming only the first: two
> independent faults collapsed into one message is how the second one gets missed.
>
> Tests (`adminPresentation.test.ts`, +3, 10 total): the missing agents are NAMED on screen with the
> fixing command; the green headline mentions prompts; a required-name fault and an unseeded agent
> are reported TOGETHER. Assertions are on the RENDERED markup, not on the presence of a field.
> Both mutations observed RED: deleting the unseeded block (2 tests), and restoring the old headline
> (1 test).)

> Last verified: 2026-08-22 (26-17 — **ONE TEST SEAM, AND THE INVITE GATE IS UNMOVED.**
> `invites.__seedInvite` is a new `internalMutation` that mints a `betaInvites` row for one
> address without an owner session.
>
> **WHY IT HAD TO EXIST.** `/signup` is invite-gated, and the only issuance path is `approve`, an
> `ownerMutation`. Playwright's `auth.setup.ts` signs in through the REAL form and therefore needs
> an account it can create, but `npx convex run` is unauthenticated and can never call `approve`.
> So on any deployment without a pre-seeded user whose password someone still knows, the browser
> gate is structurally unrunnable — which is exactly where 26-17 landed when the stored
> `e2e/.auth/user.json` JWT expired on 2026-08-22.
>
> **WHY IT IS NOT A HOLE, structurally rather than by promise:** an `internalMutation` is not
> client-callable (`isolation.test.ts` scans for exactly that), so it is reachable only from the
> CLI by someone who already holds deployment credentials. It mints nothing new either — the same
> `betaInvites` row `approve` writes, via the same `mintCode()` — so an invite from this seam is
> indistinguishable downstream, and **`admitIdentity` inside the auth transaction remains the
> boundary**, exactly as this playbook has always said. The `__` prefix and the header comment are
> the convention `onboarding.__seedOnboardedTenant` established.
>
> Idempotent per normalized address: re-running returns the existing code rather than inserting a
> second row, because `by_email` is read with `.unique()` and a duplicate would throw there
> forever after.
>
> **NOT YET EXERCISED.** The seam is written and typechecked but has never run against a
> deployment: the Convex push has been failing since 2026-08-22 ~19:0x for an unrelated reason
> (`convex/lib/foglamp.ts` carries no `"use node"` directive, so the V8 bundle pulls in
> `foglamp`'s `node:http` import and every push fails). Nothing here may be cited as verified
> until a push succeeds and `e2e/reports.spec.ts` runs.)
>

> Last verified: 2026-08-17 (**the OAuth buttons no longer swallow their own failures.**)
>
> All three OAuth call sites on `/signin` and `/signup` were `onClick={() => void signIn(…)}`.
> `void` discards the promise, so a rejection produced no redirect, no message and no console
> entry — a button that did nothing, which a user cannot tell apart from a dead page. During the
> 2026-08-16 lockout the server was failing loudly (twelve logged crashes naming the exact dead
> user id) while the page showed the owner absolutely nothing, and the retries that produced those
> twelve entries were the direct result.
>
> Both pages now route their buttons through an `onOAuth(provider, label)` helper that awaits,
> catches, sets the page's existing `auth-error` text and disables the button while in flight.
>
> **SCOPE, AND DO NOT OVERSTATE IT:** this reports failures raised while STARTING the flow. A
> failure inside `/api/auth/callback/<provider>` is a server-side 500 with no redirect and no error
> parameter — `@convex-dev/auth` rewrites the destination only on success (`index.js:188-227`) — so
> the browser never returns to the page and nothing can be shown there. **The 2026-08-16 crash was
> a callback failure and would still be invisible in the UI.** Callback failures are found in the
> Convex logs, and that remains the documented recovery route. `/signup` separately avoids rendering
> a provider button at all unless `authProviders` reports credentials for it, which covers a MISSING
> provider but no other refusal.
>
> **Verification:** `apps/web/app/(auth)/oauthErrors.test.ts`, a deliberately labelled SOURCE-level
> guard — it reads both pages as text and asserts no `void signIn(`, every `signIn` awaited, a
> `setError` per `catch`, and the handler actually wired to the buttons. It strips block comments
> first, because both files describe the old shape in prose and a naive scan would match its own
> explanation. It is not behavioural evidence: the repo's DOM-free runner renders to static markup
> and never fires an onClick, so a real assertion needs Playwright. Mutation-checked — restoring
> `void signIn(` on `/signin` reddens that page's three cases and leaves `/signup`'s three green.

> Last verified: 2026-08-17 (**`admitIdentity`'s `existingUserId` branch no longer patches a user
> document it has not confirmed exists.**)
>
> THIS IS A FIXED PRODUCTION LOCKOUT, not a hypothetical. `authAccounts` is Convex Auth's table,
> keyed by `userId`; `users` is ours, deleted by tenant erasure via the `by_tenant` walk that cannot
> reach `authAccounts`. Nothing made those two move together, so the 22.1-05 live erasure (request
> `a73023088f58ea6e`) left **1 `authAccounts` row and 23 `authSessions` rows** pointing at a deleted
> user. Convex Auth kept supplying that dead id as `existingUserId`, the unguarded `db.patch` threw
> *"Update on nonexistent document ID"* inside `auth:store`, the transaction rolled back, and
> `/api/auth/callback/google` returned HTTP 500. **Permanently** — every retry and every attempt to
> re-register resolved the same orphan and died on the same line. The owner could not sign in to
> their own production deployment.
>
> `tenantDelete.ts` now removes the auth binding during erasure (see `audit-dead-letter.md`), but
> that fix does not heal orphans that already exist, and **admission must not assume erasure was
> correct in the past**. So the branch now confirms the user document before patching it. A missing
> document means the account is a leftover: fall through to fresh admission, which requires a valid
> unredeemed invite — correct, because that person genuinely has no tenant any more. Convex Auth
> then re-points the stale account at the newly inserted user (`createOrUpdateAccount` patches
> `userId` whenever it differs, `users.js:117`), so the orphan **self-heals** rather than bricking
> the identity.
>
> **The property that must not regress:** a LIVE returning identity is still patched in place and
> still skips the invite check. Turning returns into signups would demand an invite from every
> existing user the moment their original invite row was consumed — the exact lockout the branch
> exists to prevent. Both directions are pinned by tests.
>
> **Verification performed:** two cases in `invites.test.ts` — an orphaned account reaching
> `INVITE_REQUIRED` (a refusal proves the invite lookup was reached, rather than dying two
> statements earlier), then being admitted as a NEW user id once re-invited; and a live user still
> patched in place. Mutation-checked: removing the `db.get` guard turns the orphan case red and
> leaves the live-user case green, so neither test is vacuous. 47/47 green across `invites` and
> `tenantDelete`; `pnpm --filter @pikar/backend typecheck` clean.
>
> **Operational note for whoever hits this again:** the recovery is to delete the orphaned
> `authAccounts` row for that `userId`. `invites.approve` is an `ownerMutation`, so it cannot be
> used while the last owner is the one locked out — the Convex dashboard is the only way back in.

> **25-10 Task 3 note, 2026-08-17 — the readiness section now also names non-durable origins**
> (ADR-022, **Accepted 2026-08-17**). Relevant to admission for one reason: the invite link the owner copies from
> this page is built from `window.location.origin`, and every OAuth redirect an invited user
> traverses is built from `CONVEX_SITE_URL`. If either is a preview build, an invite mailed today
> stops working on the next push — with no missing-name to show for it. `/admin` now says so.
>
> **25-10 note, 2026-08-17 — `/admin` gained a hosted-readiness section**
> (`ops.envCheck`, owner-only, NAMES ONLY). It is on this playbook's watched path but belongs to
> `production-beta.md`, which owns the manifest and its invariants. Relevant here for one reason:
> **`AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` are classified `feature`, not `required`, precisely
> because `/signup` hides the Microsoft button while they are unset** — so their absence reads as
> honest rather than broken, and the readiness screen says "feature dark" instead of "deployment
> broken". If that hiding behaviour is ever removed, the tier must change with it.
> The invites-module entries in this file's own log are the concurrent audit lane's, not 25-10's.

> Last verified: 2026-08-17 (**SECURITY AUDIT BEFORE SHIPPING — the OAuth path trusted an
> UNVERIFIED email claim, and it is now refused.** Full report:
> `.planning/phases/25-private-beta-productionization/25-01-SECURITY-AUDIT.md`.
>
> **THE DEFECT (nOAuth class).** `admitIdentity` matched an invite on
> `profile.email ?? profile.preferred_username` and its own comment called that
> "provider-VERIFIED". Nothing checked it. Entra verifies NEITHER claim, so anyone who knew an
> invited address and held any Entra account could redeem that invite — admitting a stranger and
> locking the real invitee out, since the invite is single-use and then spent. Bounded to
> admission, NOT account takeover: `existingUserId` comes only from an existing ACCOUNT
> (`@convex-dev/auth@0.0.94` `users.js:13`), so a forged address creates a new user and cannot
> inherit one. **It was DORMANT** — prod has no `AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` (the
> calendar connector uses different names), so no Entra button renders — and it would have ARMED
> ITSELF the day someone enabled Microsoft sign-in.
>
> **THE INVARIANT NOW: the OAuth path admits nobody whose address the provider did not vouch for.**
> Both mappers carry `emailVerified`; `admitIdentity` refuses non-credentials admission unless it
> is `true`, **before the invite lookup**, throwing the same generic `INVITE_REQUIRED`. Both
> details are load-bearing: a distinct error, or one raised after the lookup, turns this into an
> oracle for "does this address have a live invite". Entra's only answer is the OPTIONAL `xms_edov`
> claim (Token configuration → optional claim → `xms_edov`); until it is configured, Entra signup
> is REFUSED and invited users take Google or password + code. **Never default `emailVerified` to
> true to clear a refusal.** The credentials path is untouched — a password signup is proven by the
> code, not by a claim.
>
> **DO NOT REMOVE THE `createOrUpdateUser` CALLBACK.** Defining it also makes the package's DEFAULT
> path unreachable, and that path (`users.js:21-27`) computes `emailVerified` as defaulting to TRUE
> for any OAuth provider unless `allowDangerousEmailAccountLinking` is explicitly false, then links
> accounts by email — a genuine account-takeover vector. Removing the callback reopens it silently.
>
> Measured: `invites.test.ts` 33 → **37 passed**; the harness defaults `emailVerified: true` so the
> pre-existing tests still model a verified provider. Mutation-proof red then reverted — disabling
> the guard reddens exactly the three new tests and leaves the credentials test green.
> `tsc --noEmit` exit 0 in `packages/backend`. **Still unproven: no browser has walked
> invite → signup → tenant against a running deployment.**
>
> Known and NOT fixed: `approve`'s replay branch returns the existing invite without patching the
> waitlist row to `approved`, so such a row stays in the owner queue forever. Cosmetic.)

> Last verified: 2026-08-16 against `a584793` + the provider-shape guard (25-01 — waitlist,
> owner-gated invites, and the
> `createOrUpdateUser` admission transaction for Google / Microsoft Entra ID / password).
> Build history: `.planning/phases/25-private-beta-productionization/` · Related ADRs: ADR-018
> (one shared Microsoft app registration)

> **25-02 update, 2026-08-16 — the UI half.** `/signup` is now ONE public route serving both doors:
> `?invite=CODE` prefills a **visible, editable** code field, and no code shows the waitlist form.
> `/admin` is the owner surface for approving requests and copying the `/signup?invite=…` link.
>
> **Three things about it are deliberate and load-bearing:**
>
> 1. **The Microsoft button renders only where the deployment holds Entra credentials.** A new
>    public query, `invites.authProviders`, reads `AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` from the
>    Convex env. A `NEXT_PUBLIC_…` flag was the obvious alternative and is worse — a build-time
>    mirror of a runtime secret is a second source of truth, and when the two disagree the symptom
>    is a real invited user hitting a dead sign-in button.
> 2. **`/admin` does NOT consolidate `/ops`.** The plan said "consolidate or link". `/ops` is 800
>    lines calling eleven backend APIs (dead letters, eval signals, optimizer controls, and the
>    whole tenant-skill overlay review flow, three endpoints of which `importGuard.test.ts` pins).
>    A three-control caricature of it would have orphaned shipped compliance UI. It gets a link.
> 3. **The owner gate is a MOUNT gate, not a CSS gate.** `AdminView` owns the `invites.pending`
>    subscription, so not-mounting it is what stops the subscription. `hidden`, `opacity`, or an
>    early return *inside* the view would each still run the hook. Mutation-proven: swapping the
>    conditional mount for `<div hidden>` reddens 4 tests.
>
> **THE PROOF IS A RENDER TEST, NOT A BROWSER SPEC, AND THAT IS A REAL LIMITATION —**
> `apps/web/app/(app)/admin/adminPresentation.test.ts`. Two reasons the planned Playwright spec
> could not be written: `playwright.config.ts` declares ONE project with ONE `storageState` and
> `auth.setup.ts` signs in ONE seeded user, so there is no second identity (and `owner` is
> grantable only by hand via `owner.bootstrapOwner`); rewriting that harness is **23-06's** owned
> work, which the file-collision map forbids landing mid-Phase-25. And a browser spec would have
> proved the wrong thing anyway: the `(app)` shell's ONBD-01 first-run gate redirects a fresh
> non-owner to `/dashboard/onboarding` before `/admin` mounts, so "no admin controls" would pass
> because of the onboarding redirect. **Phase 22's outstanding owner/non-owner DOM evidence is
> therefore closed at the component level, not in a real browser. Do not record it as browser-proven.**

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

   **UPGRADED 2026-09-08 by ADR-044.** This is no longer only an admission question.
   `betaInvites.redeemedUserId` IS the `users` document id, and `tenantId` is `String(userId)` —
   so joining any audit row to a surviving `betaInvites` row returns the erased person's email and
   OAuth subject. That makes this row **the named falsifier** of the “no personal data” claim on
   three user-facing surfaces (`AUDIT_ARCHIVE_STATEMENT`, the erasure UI, the privacy page), and
   **arming WORM is held OFF until it is closed** (ADR-044 D2, T1-T2). Three options with a
   recommendation are in ADR-044 D3; the recommended one clears `email`, `redeemedUserId` and
   `redeemedSubject` at erasure while keeping `redeemedAt`, so the invite stays spent. Note ADR-044
   D4: any such fix is FORWARD-ONLY — rows for people already erased keep the bridge until a sweep
   clears them. **Do not change `betaInvites`' erasure posture without reading ADR-044 first.**

   Nothing enforces this entry: `watch.json` lists no invites path, so a change here trips no hook.
4. **No rate limit on `requestAccess`.** It is public, unauthenticated and writes a row. Idempotency
   per address bounds the damage to one row per distinct address, but nothing bounds distinct
   addresses. ponytail: idempotency is the whole defence; add the Rate-Limiter component if the
   waitlist is ever abused.
5. **No email is sent.** Approval mints a code and the owner delivers the link by hand. There is no
   transactional email sender in the project yet (the same gap that defers password verify/reset).
