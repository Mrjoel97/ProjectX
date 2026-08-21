# 25-01 — security audit of the BETA-01 admission boundary

Audited 2026-08-17, before the gate ships. Reviewed: `invites.ts`, `auth.ts`, the `betaWaitlist` /
`betaInvites` schema, `invites.test.ts`, `(auth)/signup/page.tsx`, `(app)/admin/AdminView.tsx`, and
the relevant internals of `@convex-dev/auth@0.0.94`.

**Verdict: the boundary is sound. One real defect found and fixed in this commit.**

## What was verified, not assumed

1. **The rollback property is real.** `admitIdentity` is called from `callbacks.createOrUpdateUser`.
   In the package, `dist/server/implementation/users.js:14-19` invokes a custom
   `createOrUpdateUser` and **returns immediately**, before `createOrUpdateAccount` and before any
   session or verification-code write. Throwing therefore leaves no user, no account, no session.
   The module's central claim holds against the installed package, not just its own comment.

2. **`existingUserId` cannot be obtained by claiming someone's email.** `users.js:13` derives it as
   `existingAccount?.userId ?? null` — an ACCOUNT match (provider + providerAccountId) only.

3. **DEFINING THIS CALLBACK CLOSED A LARGER HOLE THAN THE INVITE GATE ITSELF, and nothing in the
   plan claims credit for it.** The package's DEFAULT path (`users.js:21-27`) computes
   `emailVerified = profileEmailVerified ?? ((provider.type === "oauth" || "oidc") &&
   provider.allowDangerousEmailAccountLinking !== false)` — i.e. **defaults to TRUE for any OAuth
   provider unless explicitly opted out** — and then links accounts by email. That is the textbook
   account-takeover vector, and it was live in this app until a custom `createOrUpdateUser` was
   defined, which makes that branch unreachable. **If this callback is ever removed, that hole
   reopens silently.** Do not remove it without replacing the protection.

4. **Shipping the gate will not lock out existing users, including the owner.** They hold
   `authAccounts` rows, so they take the `existingUserId` branch and never reach the invite check.

5. `userFields` is a whitelist (`email`/`name`/`image`), so `owner` cannot be injected through a
   provider profile; authority comes only from `owner.bootstrapOwner`. Single-use is a patch inside
   a serializable Convex mutation. Unknown and spent codes are reported identically. `pending`
   returns no codes; `approve` hands a code back once and `AdminView` holds it in session memory
   only. `ownerQuery`/`ownerMutation` resolve to a real `requireOwner`.

## The defect: the OAuth path trusted an unverified email claim

`admitIdentity` matched an invite on `profile.email ?? profile.preferred_username` and its own
comment asserted that an OAuth email "is provider-VERIFIED, which is the stronger fact". **Nothing
checked that.** `email_verified` / `emailVerified` / `xms_edov` appeared nowhere in `auth.ts` or
`invites.ts`.

This is the **nOAuth** class. Entra does not verify `email` or `preferred_username`; both are
settable on accounts an attacker controls. An attacker who knew an invited address could redeem
that invite: a stranger admitted to the beta, **and** the real invitee locked out, because the
invite is single-use and now spent.

**Bounded, and the bound was checked rather than assumed:** because `existingUserId` is
account-derived (finding 2), a forged email creates a NEW user and cannot inherit an existing one.
This was unauthorized admission and denial, **not account takeover**.

**It was dormant.** Production has no `AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` — the Microsoft
*calendar* connector uses differently-named vars — so `authProviders.microsoft` is false and no
Microsoft button renders. **It would have armed itself the day those two variables were set**,
which is exactly what "enable Microsoft sign-in" looks like. A dormant flaw behind an env var is
worse than a live one: nothing exercises it, so nothing reveals it, until a config change does.

### The fix

- `auth.ts` Google mapper carries `emailVerified: p.email_verified === true`.
- `auth.ts` Entra mapper carries `emailVerified: xms_edov === true` — the only claim that answers
  the question, OPTIONAL, and configured per app registration (Token configuration → optional claim
  → `xms_edov`). Until it is configured this is `false` and **Entra signup is refused**, which fails
  closed: an invited user signs up with Google, or with password + code. Do not "fix" that refusal
  by defaulting the value to true.
- `admitIdentity` refuses non-credentials admission unless `emailVerified === true`, **checked
  BEFORE the invite lookup and throwing the same generic `INVITE_REQUIRED`** as every other
  refusal. A distinct error, or one raised after the lookup, would tell a stranger that a guessed
  address has a live invite — the oracle this module is otherwise careful not to be.
- The credentials path is untouched: a password signup is proven by the code, not by a claim.

### Evidence

`invites.test.ts` 33 → **37 passed**. The harness now defaults `emailVerified: true` so existing
tests still model the ordinary verified case, and the new tests override it explicitly.

Mutation-proof, red first then reverted: disabling the guard
(`if (false && …)`) reddens exactly three tests — the unverified refusal, the
invite-not-spent-and-still-usable case, and the missing-claim case — while the credentials test
correctly stays green. `tsc --noEmit` exit 0 in `packages/backend`.

## Left open, deliberately

- **`approve`'s replay branch does not patch the waitlist row to `approved`.** A row whose invite
  already exists therefore sits in the owner queue forever. Cosmetic, not security; not fixed here
  because it belongs to the issuance UI's owner.
- `unique()` on `by_email` throws if duplicate rows ever exist, which fails closed. Acceptable.
- Cross-provider linking remains unsupported and fails closed, as designed.
- **This audit is a code review. It is not a live admission test** — no browser has been walked
  through invite → signup → tenant against a running deployment.
