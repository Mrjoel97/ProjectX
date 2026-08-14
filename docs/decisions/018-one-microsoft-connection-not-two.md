# ADR-018: One Microsoft connection, not two — Calendar and Mail share a single delegated grant

- **Status**: Accepted
- **Recorded**: 2026-08-14, during the Phase 14→25 gap audit, **before either plan was executed**.
  Both `17-06` and `25-06` were unexecuted at the time of this decision; nothing is being unwound.
- **Requirements**: ACTN-02 (calendar), DLVR-02 (Outlook mail)
- **Phases**: 17 (Calendar Actions), 25 (Private Beta Productionization)
- **Relates to**: `.planning/phases/25-private-beta-productionization/25-PREREQUISITE-EVIDENCE.md`
  (the audit row that found the collision)

## Context

Two approved-but-unexecuted plans each specified a Microsoft delegated OAuth flow, independently,
neither referencing the other:

| | `17-06` | `25-06` |
| --- | --- | --- |
| Scope | `offline_access Calendars.ReadWrite` | `offline_access Mail.Send Mail.Read` + identity |
| Module | creates `microsoftCalendarAuth.ts`, parallel to `gmailAuth.ts` | extends `gmailAuth.ts` into a two-provider mail module |
| Callback | `/microsoft-calendar/callback` | its own Microsoft callback |
| Consent page | new `/connect-microsoft` | extends `connect-gmail/page.tsx` |
| Token row | new row; "do not rename `gmailTokens`" | 25-05 migrates `gmailTokens`, 25-07 narrows the schema |

Three files were claimed by both: `packages/backend/convex/http.ts`,
`apps/web/app/(app)/_components/ReconnectBanner.tsx`, `docs/playbooks/cockpit.md`.

Neither plan was wrong in isolation. 17-06 was written when Phase 17 was the only Microsoft consumer;
25-06 was written against a Phase 17 that had not yet specified a Microsoft grant. The collision is a
product of parallel planning across a long milestone, and it was invisible to every prior audit
because both plans are *unexecuted* — no SUMMARY, no code, nothing for a file-level scan to collide.

## Decision

**One Microsoft delegated connection, requested once, serving both Calendar and Mail.**

- One auth module owns the Microsoft grant. It is **not** a fork of `gmailAuth.ts` and **not** named
  for either consumer, because it serves both.
- One grant: `offline_access Calendars.ReadWrite Mail.Send Mail.Read` plus identity scopes.
- One callback route, one consent page, one token row, one disconnect control, one reconnect state.
- `17-06` builds it. `25-06` consumes it and adds only the mail send/read adapter.

## Why the union grant rather than incremental consent

Microsoft's v2 `common` endpoint supports incremental consent, so requesting Calendar first and
widening to Mail later is technically available. It was rejected for the beta because the second
consent prompt buys nothing here: **both consumers are certain**, not speculative. ACTN-02 and
DLVR-02 are both committed milestone requirements with plans already written. Deferring half a grant
we already know we will request trades one user-visible consent interruption for no optionality.

This is the narrow case where asking for more scope up front is the smaller decision, and it does not
generalize: a scope whose consumer is *speculative* still waits for that consumer to exist.

## Consequences

1. **DLVR-02's auth half leaves Phase 25's critical path.** Phase 25's Microsoft work becomes an
   adapter over an existing, already-consented connection. 25-07's "narrow the provider schema"
   has nothing to reconcile, because nothing was widened twice.
2. **The beta user connects Microsoft once.** Two consent screens for one account was the outcome
   both plans were unknowingly heading toward; it is now structurally impossible.
3. **`17-06` grows and `25-06` shrinks.** 17-06 now requests scopes it does not itself use. This is
   deliberate and must stay legible: the module is provider-owned, not feature-owned, and its scope
   constant names both consumers.
4. **Google is untouched.** `gmailAuth.ts`, `gmailTokens`, the Google callback and the Google
   reconnect copy keep their current behavior. This ADR adds a second provider; it does not
   generalize the first one. 17-06's original "do not rename `gmailTokens`" constraint stands.
5. **`ReconnectBanner` generalizes once**, by provider, in 17-06 — not twice.
6. **A scope the product does not yet exercise is now consented.** Until 25-06 lands, the stored
   grant carries `Mail.Send`/`Mail.Read` that no code path uses. The honest mitigation is that the
   consent copy must say what the connection will be used for, including the mail half, rather than
   describing only the calendar feature shipping that week. **A consent screen that under-describes a
   granted scope is the defect this consequence exists to prevent.**

## What this ADR does not decide

- **It does not re-scope ACTN-02.** The calendar management operations (update/move/cancel) and the
  Microsoft Graph *Calendar* adapter remain owed by 17-07…17-11. `17-VERIFICATION.md`'s finding
  stands: ACTN-02 is not satisfied by a connection, and must not be marked complete from one.
- **It does not decide Microsoft token revocation.** 17-06 already records honestly that the v2 flow
  used here has no Google-style revocation endpoint and that removing consent is a separate owner
  action in Microsoft My Apps or Entra. GOVN-03 (the policy-promises-a-control requirement) inherits
  that limitation unchanged and must state it rather than imply parity with Google disconnect.
- **It does not decide cross-provider account linking**, which 25-01 explicitly leaves unsupported
  for the beta.
