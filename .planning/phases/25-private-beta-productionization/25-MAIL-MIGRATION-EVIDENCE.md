---
plan: 25-06
task: "Task 2 — decide the Microsoft remote-invalidation support posture"
type: checkpoint:decision
gate: blocking
status: decided
prepared: 2026-08-16
decided: 2026-08-17
posture: A
evidence_reverified: 2026-08-17
copy_landed: true
copy_landed_on: 2026-08-17
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
3. **The user or tenant admin removing the app** — ~~`https://myaccount.microsoft.com/permissions`
   for personal/work accounts`~~ (**wrong URL — corrected in the re-verification section below**:
   personal accounts use `https://account.microsoft.com/privacy/app-access`, work/school accounts
   use `https://myapps.microsoft.com/`), or the Entra admin centre's Enterprise Applications for an
   admin-governed tenant. This is the supported route, and it is *not something we can do for them*.

**Evidence to re-verify at decision time** (do not treat these as current without checking the
date — Microsoft moves these pages):
`https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow`,
`https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions`,
`https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/`.
Verified against as of 2026-08-16; **the owner should re-check before recording a decision.**

### Re-verification, 2026-08-17 — two claims confirmed verbatim, one URL WRONG

Fetched at decision time, not carried forward:

| Claim | Source (page's own `ms.date` / `updated_at`) | Result |
| --- | --- | --- |
| Entra v2 auth-code flow documents no client-callable revocation endpoint for its own grant | `v2-oauth2-auth-code-flow`, ms.date 2026-01-09, updated 2026-06-15 | **CONFIRMED.** The page documents `/authorize`, `/token` and refresh only. Refresh tokens are described as things that "expire, are revoked, or lack sufficient privileges" — passively, with no endpoint a client can call. There is no Google `/revoke` analogue on the page. |
| `revokeSignInSessions` is unsupported for personal Microsoft accounts | `graph/api/user-revokesigninsessions`, updated 2025-07-23 | **CONFIRMED, verbatim.** Permissions table: *"Delegated (personal Microsoft account) — Not supported. / Not supported."* |
| `revokeSignInSessions` needs admin consent and is broader than per-app | same | **CONFIRMED, verbatim.** Least-privileged permission is `User.RevokeSessions.All`; the API *"Invalidates all the refresh tokens issued to applications for a user"* — every application, not ours. |

**CORRECTION — the user-facing link in Posture A was wrong, and wrong in the direction that hurts
most.** This document's line above named `https://myaccount.microsoft.com/permissions` "for
personal/work accounts". That is not the route for either, and the beta is expected to be *mostly*
personal accounts. The two supported routes are **different portals**:

| Account type | Where the user removes Pikar's access |
| --- | --- |
| **Personal Microsoft account** | `https://account.microsoft.com/privacy/app-access` |
| **Work or school (Entra)** | `https://myapps.microsoft.com/` — Microsoft's own *"Edit or revoke application permissions in the My Apps portal"* |

`learn.microsoft.com/en-us/entra/identity/enterprise-apps/methods-for-removing-user-access` was also
re-read: every method it lists is **admin-side** (assignment removal, disable sign-in, delete the
app, restrict future consent). It names no end-user self-service route and no API by which the
client application deletes its own consent grant. That is the third confirmation of the asymmetry,
by absence.

**The shipped copy carries the same defect.** `DisconnectMicrosoft.tsx` (landed 22.1-01) already
tells the user to go to "Microsoft My Apps" — as plain text, with no link — for *both* account
types. My Apps is the work/school portal. A personal-account beta user following that instruction
lands somewhere that will not show them Pikar. Posture A's copy must name both portals and link
them.

## The choice

### Posture A — accept the honest local disconnect for the beta

- `disconnectMicrosoft` keeps returning `revokedAtProvider: false`.
- The disconnect UI says plainly that we have removed our copy of the credentials and that the
  app's access remains listed in their Microsoft account until they remove it, **with direct links
  to both supported portals** — `https://account.microsoft.com/privacy/app-access` for a personal
  Microsoft account and `https://myapps.microsoft.com/` for a work or school account. (Originally
  written as a single link to `myaccount.microsoft.com/permissions`; corrected 2026-08-17.)
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

- **Posture chosen: A** — accept the honest local disconnect for the beta.
- **Evidence re-verified on: 2026-08-17.** All three source claims re-fetched; two confirmed
  verbatim, one user-facing URL found wrong and corrected. See the re-verification section above.
- **Approved UI wording: APPROVED BY THE OWNER AND LANDED 2026-08-17.** The three strings below are
  in `DisconnectMicrosoft.tsx` as written. `connectionsSurface.test.ts`'s guard was **tightened, not
  relaxed**: it used to accept the string "My Apps" alone — which is exactly how the wrong-portal
  copy passed review — and now requires BOTH `account.microsoft.com` and `myapps.microsoft.com`.
  Mutation-proven: restoring the old wording turns that named test red, and restoring the new
  wording turns it green (30/30).
- **Recorded by:** agent, on owner's decision of 2026-08-17.
- **Consequence, restated so it is not lost:** a user who disconnects and does nothing else has left
  a live consent standing at Microsoft. Our stored refresh token is gone, so *we* cannot use it, but
  the grant is not dead. This is the thing the copy has to say out loud.

### Proposed copy — `apps/web/app/(app)/_components/DisconnectMicrosoft.tsx`

Two strings change, and one of them needs a type widening to carry real links.

**1 · The pre-click confirm** (plain text — `window.confirm` cannot render a link, so the portals are
named, not linked):

> Disconnect Microsoft? Pikar will lose access to your calendar AND to Outlook mail. This deletes
> Pikar's copy of your token. It does NOT remove Pikar from your Microsoft account — that is a
> separate step you take at account.microsoft.com (personal account) or myapps.microsoft.com (work
> or school account).

**2 · The post-success note** (rendered, so both portals are real links):

> Pikar's copy of your token is deleted. Microsoft still lists Pikar on your account — we have no
> way to remove it for you. Remove it yourself at **[Microsoft account → App
> access](https://account.microsoft.com/privacy/app-access)** for a personal account, or
> **[My Apps](https://myapps.microsoft.com/)** for a work or school account.

**3 · The nothing-to-delete note** (same links, different first clause):

> There was no stored Microsoft connection to delete. If Microsoft still lists Pikar on your
> account, remove it at **[Microsoft account → App
> access](https://account.microsoft.com/privacy/app-access)** or **[My Apps](https://myapps.microsoft.com/)**.

**Words that must not appear in any of the three:** "revoked", "revoke", "disconnected at
Microsoft", "access removed", or any construction implying parity with the Google flow. The Google
component says `revoked` because Google's endpoint returns 200 for a real revocation; this one has
no such call to report on.

**The one mechanical change the links require:** `note` is `useState<string | null>`. Rendering
anchors needs `useState<ReactNode | null>`. That is the whole diff beyond the strings — no new
component, no dialog library, no link helper. The existing `role="status"` paragraph renders a
`ReactNode` unchanged.
