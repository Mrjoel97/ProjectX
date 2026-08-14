---
phase: 17-calendar-actions
plan: 06
completed: 2026-08-14
requirements: [ACTN-02]
status: complete
---

# 17-06 — One Microsoft connection, before any Graph call

**ACTN-02 IS NOT SATISFIED BY THIS PLAN AND MUST NOT BE TICKED FROM IT.** 17-06 delivers the
Microsoft *connection*: OAuth, token store, callback, and the connect/disconnect/status surfaces.
The Graph Calendar adapter, the management operations (update / move / cancel) and the live gates
remain owed by 17-07…17-11. `17-VERIFICATION.md` is explicit that ACTN-02 needs both the missing
provider AND the missing operations, and a connection is neither.

## What changed, and the decision that reshaped it

Mid-plan audit found that **17-06 and Phase 25-06 each specified an independent Microsoft OAuth flow
for the same account**, colliding on `http.ts`, `ReconnectBanner.tsx` and `cockpit.md`. Both were
unexecuted, so nothing was unwound. The owner chose one shared connection with the union grant →
**[ADR-018](../../../docs/decisions/018-one-microsoft-connection-not-two.md)**. 17-06 now builds the
one connection; 25-06 consumes it and adds the mail adapter only. Plans 17-06, 25-05, 25-06 and
25-07 carry matching `amended:` records.

This removes DLVR-02's entire auth half from Phase 25's critical path and leaves 25-07 nothing to
reconcile.

## Environment names (deployment secrets, not `.env.local`)

| Name | Purpose |
| --- | --- |
| `MICROSOFT_OAUTH_CLIENT_ID` | Azure app registration (client) id |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | Client secret; ALSO the HMAC key for the signed `state` |
| `MICROSOFT_CALENDAR_REDIRECT_URI` | Must byte-match the Azure redirect URI registration |

Missing configuration is an operational state, not a crash: `microsoftConnectUrl` returns
`{configured:false, url:null}` and the page explains itself. `buildMicrosoftAuthorizeUrl` stays
strict so callback/token-exchange code can never run on partial configuration.

## Exact scopes

```
offline_access openid profile email Calendars.ReadWrite Mail.Send Mail.Read
```

`offline_access` for the refresh token. `Calendars.ReadWrite` is ACTN-02's consumer (Graph does not
split freeBusy from event write the way Google does). `Mail.Send`/`Mail.Read` are DLVR-02's, granted
now and first used by 25-06. The identity scopes are **not padding**: `Mail.Send` sends AS the
connected account, so the product must be able to SHOW the sending address before a human approves a
plan. Explicitly NOT requested: `Contacts.*`, `Directory.*`, anything `.All`, any application
permission.

## Callback error codes

`/microsoft/callback` maps every failure onto a closed set and the page owns the wording. **Fixed
codes, never provider text** — a Microsoft error body can carry the authorization code, correlation
ids and directory/tenant names, and a redirect lands in browser history, the `Referer` header and
every proxy log in between. (The Gmail callback beside it interpolates `${oauthError}`; that is the
older pattern and was deliberately not copied. It is worth its own look, out of scope here.)

| Code | Raised when | Reaches the token endpoint? |
| --- | --- | --- |
| `cancelled` | provider returned any `error` (declined, admin consent required, invalid client) | no |
| `missing_callback` | `code` or `state` absent | no |
| `invalid_state` | signature/tenant mismatch | **no — before the credentialed POST** |
| `exchange_failed` | token endpoint returned non-ok (body never read) | yes |
| `missing_refresh` | response lacked `access_token` or `refresh_token` | yes |

Success 303s to `/dashboard/profile`. An unrecognised `?microsoftError=` value renders a FIXED
sentence, never itself.

## Mutation evidence — six mutations, each red then reverted

| Mutation | Named test that turned red |
| --- | --- |
| sign the bare tenantId instead of `microsoft:<tenantId>` | "a Google-issued state is REJECTED even when both providers share a client secret" → `expected 'tenant_microsoft' to be null` — **a Google state verified as Microsoft** |
| relax the notification filter to `endsWith("_reconnect")` | "retires only `microsoft_calendar_reconnect`" — it cleared the user's `gmail_reconnect` banner |
| drop the qualified-scope match | "matches the fully-qualified form Graph actually returns" |
| delete the pre-POST state check | "a tampered state fails BEFORE the credentialed token POST" → lands at `store`'s `v.string()` validator, a real SECOND line of defence, but only AFTER the client secret was spent on the attacker's code — which is why the assertion is on `fetch` not being called |
| store `MICROSOFT_SCOPES` instead of `tok.scope` | "a token response with no scope field stores empty and reads un-ready" |
| `if (false && !hasScope(...))` in `calendar.ts:149` | BOTH the existing zero-fetch test AND the new paired H3 |

**Two tests were strengthened because their mutation produced a CRASH rather than a claim** — an
undefined stub gave `Cannot read properties of undefined`, and an empty JSON body gave `Unexpected
end of JSON input`. Both mocks now answer plausibly so a removed guard fails on its own assertion.
Recorded because it is the general lesson: a mutation that crashes proves the line is reachable, not
that the assertion is watching it.

**H3, paired.** `calendar.test.ts` already asserted `not.toHaveBeenCalled()` for a pre-widening
grant — an assertion a `freeBusy` that never fetches at all would pass perfectly. The new test pairs
it with a positive witness (same action, same args, one scope wider, fetch DOES go out), so the
contrast proves the stored-scope check is the cause. **This is the offline half only; the live
negative is still owed by 17-11.**

## Measured

- `microsoftAuth.test.ts` 25/25 · `httpAuth.test.ts` 13/13 · `microsoft.test.ts` 22/22 ·
  `connectionsSurface.test.ts` (extended) · `calendar.test.ts` 40/40
- **Full suites:** core **936/936** (37 files) · backend **1714 passed / 24 skipped** (78 files)
- `tsc --noEmit` exit 0 for core, backend and apps/web; `apps/web` production build green
- biome clean · `check-playbooks` exit 0
- **Browser: `e2e/connect-microsoft.spec.ts` 7/7**, run three times against a prod build on `:3111`

### Pre-existing red, NOT caused by this plan

`apps/web` is **267/268**. `cockpitAccess.test.ts > business-first cockpit language` fails looking
for `"Run the business with Pikar."` in `cards.tsx`. Verified pre-existing: that string is absent
**at HEAD as well as in the working tree**, and this plan touched neither `cards.tsx` nor that test.
It belongs to the concurrent lane holding `cards.tsx` dirty.

### The configured branch was proven, not assumed

The spec asserts the specific correct thing for whichever connect state is live, so it passes on a
deployment without Microsoft OAuth. That would leave the configured branch unverified, so it was
exercised directly with placeholder values: the rendered link carried
`https://login.microsoftonline.com/common/oauth2/v2.0/authorize`, the exact union scope,
`prompt=consent`, `response_type=code`, `response_mode=query`, a 97-char state (32-char tenant +
`.` + 64-hex signature), and no secret.

**Those placeholders were then REMOVED from the local deployment** — a Connect button backed by a
bogus client id is worse than the honest "not configured" notice.

## Live setup note (for 17-11 / the owner)

1. **Azure app registration** at `portal.azure.com` → Entra ID → App registrations → New. Supported
   account types must be **"Accounts in any organizational directory and personal Microsoft
   accounts"** — anything narrower defeats the `common` endpoint and locks out one account class.
2. **Redirect URI** of type *Web*, byte-matching `MICROSOFT_CALENDAR_REDIRECT_URI`. For the Convex
   site origin that is `<CONVEX_SITE_URL>/microsoft/callback` (locally
   `http://127.0.0.1:3211/microsoft/callback`). A trailing-slash difference fails the exchange.
3. **Delegated permissions** (NOT application permissions): `Calendars.ReadWrite`, `Mail.Send`,
   `Mail.Read`, `offline_access`, `openid`, `profile`, `email`.
4. **Client secret** → `npx convex env set MICROSOFT_OAUTH_CLIENT_SECRET …`. It is also the HMAC key
   for the signed `state`, so rotating it invalidates any consent round-trip in flight.
5. A **work/school** account may require admin consent even for delegated scopes; that surfaces as
   `cancelled`, which is correct but coarse. If 17-11 needs to distinguish it, widen the closed set
   deliberately — do not start echoing provider text.

## Deviations from the plan as written

- **`packages/core/src/microsoft.ts` instead of putting the scope constant in
  `calendarManagement.ts`.** The grant covers mail; a Mail.Send scope inside a calendar module is the
  feature-owned shaping ADR-018 exists to prevent.
- **The reconnect table went into `notificationTemplates.ts`**, not a new
  `packages/core/src/notifications.ts` (which did not exist). It sits deliberately beside
  `NOTIFICATION_KINDS` — the list it must stay OUT of, because that list arms the mail dispatch path
  and a reconnect prompt must never route through the connection it reports on.
- **The table name `microsoftCalendarTokens` was kept** though it now holds the union grant, on the
  `gmailTokens` precedent: renaming a Convex table is a migration for cosmetic gain.
- **`ConnectionsPanel` stayed concrete** (no `Record<Provider, …>` lookup). Its own note said Phase
  25 would mint the lookup; two rows is not enough repetition to pay for it, and the readiness
  fields genuinely differ (`driveReady` vs `calendarReady`+`mailReady`). Revisit at a third provider.
- **Microsoft UI surfaces registered under `onboarding.md`, not `cockpit.md`.** The plan assigns
  consent surfaces to `onboarding.md` and forbids overlapping `watch.json` entries; the Google twins
  stay under `cockpit.md`. The asymmetry is documented in both playbooks.

## Follow-ups this plan deliberately did not take

- The **Gmail callback still interpolates provider text** into its redirect. Out of scope; rewriting
  a shipped delivery path while closing a different plan is how a gate stops meaning anything.
- **No Microsoft token-expiry cron.** `flagExpiringTokens` is Google-only and the
  `microsoft_calendar_reconnect` kind currently has no writer — the banner renders it, nothing
  creates it yet. Whichever plan adds the Graph adapter should add its expiry sweep.
- **No revocation on disconnect**, because the v2 delegated flow has no endpoint for it. GOVN-03
  inherits this and must state it rather than imply parity with the Google disconnect.
