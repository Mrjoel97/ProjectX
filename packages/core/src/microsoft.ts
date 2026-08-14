// The Microsoft delegated grant — ONE connection serving BOTH Calendar and Mail (ADR-018).
//
// This module is PROVIDER-owned, not feature-owned. That is the whole point of ADR-018: plans
// 17-06 (calendar) and 25-06 (Outlook mail) each specified their own Microsoft OAuth flow for the
// same account, which would have walked a beta user through two consent screens into two token
// rows with two disconnect controls. The scope constant below therefore lives beside neither
// consumer and names both.
//
// Why a UNION grant rather than incremental consent: Microsoft's v2 `common` endpoint supports
// widening a grant later, so Calendar-now/Mail-later was available. It was rejected because both
// consumers are COMMITTED requirements (ACTN-02 and DLVR-02) with plans already written — deferring
// half a grant we already know we will request buys no optionality and costs one user-visible
// consent interruption. This does NOT generalize: a scope whose consumer is speculative still waits
// for that consumer to exist.

/** Refresh-token access. Without this Microsoft returns an access token only, and the connection
 *  dies at the first expiry with no way to renew it un-attended. */
export const MS_OFFLINE_ACCESS_SCOPE = "offline_access";

/** Calendar read AND write in one scope — Microsoft does not split freeBusy from event creation
 *  the way Google does (`calendar.freebusy` + `calendar.events` are two Google scopes; Graph has
 *  `Calendars.ReadWrite` covering both). ACTN-02's consumer. */
export const MS_CALENDARS_READWRITE_SCOPE = "Calendars.ReadWrite";

/** Send as the connected user. DLVR-02's consumer (Phase 25-06). */
export const MS_MAIL_SEND_SCOPE = "Mail.Send";

/** Read the connected mailbox. DLVR-02's consumer — the Outlook half of the read plane that
 *  25-09 routes through the two-provider adapter. */
export const MS_MAIL_READ_SCOPE = "Mail.Read";

/** Identity scopes. NOT decoration and not scope-padding: `Mail.Send` sends AS the connected
 *  account, so the product must be able to SHOW which address it will send from before the user
 *  approves a plan. Without an identity scope the app holds a token it cannot attribute, and the
 *  send surface would have to say "your Microsoft account" and hope. `email` is the claim that
 *  answers it; `openid`/`profile` are its prerequisites on the v2 endpoint. */
export const MS_IDENTITY_SCOPES = ["openid", "profile", "email"] as const;

/**
 * The full Microsoft grant this app requests — ONE consent, ONE token row, ONE connect button.
 *
 * **Widening this list does NOT retro-grant anything**, exactly as `GOOGLE_SCOPES` warns for
 * Google: a token issued before a widening keeps its old `scope` string. An already-connected
 * tenant must be detected with `hasMicrosoftScope` and sent to reconnect BEFORE any Graph call,
 * or they get a 403 that reads as a product bug rather than as "reconnect to continue".
 *
 * ORDER IS NOT SIGNIFICANT to Microsoft, but is kept stable so a stored `scope` string diffs
 * legibly against this constant during support.
 */
export const MICROSOFT_SCOPES = [
  MS_OFFLINE_ACCESS_SCOPE,
  ...MS_IDENTITY_SCOPES,
  MS_CALENDARS_READWRITE_SCOPE,
  MS_MAIL_SEND_SCOPE,
  MS_MAIL_READ_SCOPE,
].join(" ");

/**
 * Whole-token scope check for a Microsoft grant.
 *
 * Separate from `@pikar/core`'s Google `hasScope` for one reason that matters: **Microsoft returns
 * granted scopes case-insensitively and often reordered**, and the resource scopes come back
 * fully-qualified (`https://graph.microsoft.com/Calendars.ReadWrite`) even when requested bare.
 * A `split(" ").includes(want)` written for Google therefore reports FALSE for a grant that is
 * genuinely present — which would send a correctly-connected tenant to reconnect forever.
 *
 * So: compare case-insensitively, and match either the bare scope or any `/`-qualified suffix.
 * Still a whole-segment comparison, never a substring test — `Mail.Read` must not be satisfied by
 * `Mail.ReadWrite`, and a prefix match would do exactly that.
 */
export function hasMicrosoftScope(granted: string, want: string): boolean {
  const target = want.toLowerCase();
  return granted
    .split(/\s+/)
    .filter(Boolean)
    .some((s) => {
      const g = s.toLowerCase();
      return g === target || g.slice(g.lastIndexOf("/") + 1) === target;
    });
}

/** Does a stored grant carry everything the CALENDAR half needs? (ACTN-02) */
export const microsoftCalendarReady = (grantedScope: string): boolean =>
  hasMicrosoftScope(grantedScope, MS_CALENDARS_READWRITE_SCOPE);

/** Does a stored grant carry everything the MAIL half needs? (DLVR-02, Phase 25-06)
 *  Both scopes are required: a grant that can send but not read cannot support the reply/threading
 *  plane, and one that can read but not send cannot deliver. */
export const microsoftMailReady = (grantedScope: string): boolean =>
  hasMicrosoftScope(grantedScope, MS_MAIL_SEND_SCOPE) &&
  hasMicrosoftScope(grantedScope, MS_MAIL_READ_SCOPE);
