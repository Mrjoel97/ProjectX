---
plan: 25-06
task: "Task 2 — decide the Microsoft remote-invalidation support posture"
type: checkpoint:decision
gate: blocking
status: awaiting_owner_decision
prepared: 2026-08-16
decided: null
---

# Microsoft disconnect: what it does, what it cannot do, and the choice

> **This document is PREPARED, NOT DECIDED.** Task 2 is a blocking owner checkpoint. Nothing in
> source was softened, hidden or conditionally re-worded while preparing it —
> `disconnectMicrosoft` still returns `revokedAtProvider: false`, which is the honest value.

## The one-sentence version

When a user disconnects Google, we call Google's revocation endpoint and the grant is dead at the
provider. **There is no equivalent call for Microsoft**, so disconnecting Microsoft deletes our
stored tokens and nothing else — the app's consent remains listed in the user's Microsoft account
until *they* remove it.

## Why the asymmetry is real and not an implementation gap

| | Google | Microsoft Entra |
| --- | --- | --- |
| Revoke THIS app's grant, no admin consent | `POST https://oauth2.googleapis.com/revoke` — works under the delegated grant we already hold | **No equivalent endpoint** under a delegated `Mail.Send Mail.Read offline_access` grant |
| What we do today | Call it, record `{revoked: true, status: 200}` | Delete the local rows, record `{deleted: true, revokedAtProvider: false}` |

Three Microsoft mechanisms exist and none of them is the missing one:

1. **`/common/oauth2/v2.0/logout`** — ends the browser SSO *session*. It does not touch the
   application's refresh grant. A user who logs out and back in still has the app authorized.
2. **Graph `revokeSignInSessions`** — invalidates *all* refresh sessions for a work/school user
   across *every* application. It requires the admin-consented application permission
   `User.RevokeSessions.All`, and it is **unsupported for personal Microsoft accounts**. It is also
   far broader than the intent: the user asked to disconnect Pikar AI, not to be signed out of
   every app their organisation has authorized.
3. **The user or tenant admin removing the app** — `https://myaccount.microsoft.com/permissions`
   for personal/work accounts, or the Entra admin centre's Enterprise Applications for an
   admin-governed tenant. This is the supported route, and it is *not something we can do for them*.

**Evidence to re-verify at decision time** (do not treat these as current without checking the
date — Microsoft moves these pages):
`https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow`,
`https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions`,
`https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/`.
Verified against as of 2026-08-16; **the owner should re-check before recording a decision.**

## The choice

### Posture A — accept the honest local disconnect for the beta

- `disconnectMicrosoft` keeps returning `revokedAtProvider: false`.
- The disconnect UI says plainly that we have removed our copy of the credentials and that the
  app's access remains listed in their Microsoft account until they remove it, **with a direct
  link to `https://myaccount.microsoft.com/permissions`**.
- We **never** use the words "revoked", "disconnected at Microsoft", or anything implying parity
  with the Google flow.
- **Consequence:** a user who disconnects and does nothing else has left a live consent standing.
  Our stored refresh token is gone, so *we* cannot use it — but the grant itself is not dead.

### Posture B — stop this lane and commission a security/consent review

- Requires naming a specific supported mechanism. On the evidence above the only candidate is
  `revokeSignInSessions`, which means requesting `User.RevokeSessions.All`, obtaining **admin
  consent** in every customer tenant, and accepting that it does not work at all for personal
  accounts and signs the user out of unrelated applications.
- **Consequence:** Phase 25's Microsoft lane stops until that review completes. The admin-consent
  requirement would also change the beta's onboarding story, since a personal-account user could
  never satisfy it.

## Recommendation

**Posture A**, for two reasons that are specific rather than general. First, Posture B's only
mechanism does not do the thing being asked for — it is a session-wide sign-out, not a per-app
revocation, and it silently excludes personal accounts, which the private beta will mostly be.
Second, the honest-limitation route is already this repo's established posture for exactly this
shape of problem, and the audit record already carries the distinction (`revokedAtProvider: false`
sits beside Google's `revoked: true` in the live erasure evidence in `audit-dead-letter.md`), so a
regulator or a support case can already see which happened.

**What Posture A must ship to be honest, and what is blocked until this is decided:** the
disconnect copy in the UI. It is deliberately NOT written yet — the wording is the decision.

## What this does NOT do

**GOVN-03's provider-revocation clause stays OPEN.** Neither posture closes it, and 25-06 does not
claim to. Recorded here, in `cockpit.md`, and previously in `22.1-05`'s evidence.

---

## Owner decision

- Posture chosen: _______
- Evidence re-verified on: _______
- Approved UI wording: _______
- Recorded by: _______
