# Design: Fix per-session tenant scoping

- **Date:** 2026-07-21
- **Status:** Approved (design), pending implementation
- **Subsystem:** tenant-scoping linchpin — `packages/backend/convex/lib/functions.ts`
- **Related:** CLAUDE.md §2 (multi-tenant isolation), memory `tenant-scope-is-per-session`

## Problem

`requireTenant` (`packages/backend/convex/lib/functions.ts:22-26`) resolves the tenant
scope from the authenticated identity and returns `identity.subject` verbatim as
`ctx.tenantId`. Under Convex Auth, `identity.subject` is a pipe-joined pair,
`<userId>|<sessionId>` — **not** the bare userId. The comment on line 20 asserts
`tenantId === identity.subject (userId)`, which is the exact wrong belief that
caused the bug.

**Consequence.** Every tenant-scoped table — `notifications`, `gmailTokens`, `plans`,
`briefings`, vault, etc., all written through `tenantQuery`/`tenantMutation`/`tenantAction`
— is scoped **per login session**, not per user. Each new sign-in mints a new `sessionId`,
therefore a new `tenantId`, therefore a fresh empty tenant. The user silently loses
visibility of everything created under prior sessions, including the Gmail connection.

**Observed proof (Phase 7 live verify, 2026-07-21).** The same account
(`kn73kmcdzqxem7mkq4n5b9x2b18abrnq`) had multiple `gmailTokens` rows, one per
`…|<session>`. A notification fired at one session's tenant was invisible in the
browser's then-current session until re-fired at the exact current subject.

**Why it has not bitten hard yet.** Single-owner beta with long-lived sessions: within
one session everything is consistent. It only manifests across logins.

## Goal

`tenantId` is stable for a given user across login sessions. After the fix, logging out
and back in yields the same `tenantId`, so notifications, the Gmail connection, plans,
briefings, and vault data persist across logins.

Non-goal: per-organization scoping. Single-owner beta needs per-user only; per-org is
YAGNI and can supersede this later if multi-user/orgs arrive.

## Approach

### Root cause is a single point

All three builders — `tenantQuery`, `tenantMutation`, `tenantAction` — derive `tenantId`
from one function, `requireTenant`. Fixing that one function corrects every tenant-scoped
table at once. There are **no per-caller changes** and no feature-file edits.

### The change

1. **`requireTenant` returns the stable user id.** Take the segment before the first `|`:

   ```ts
   return (identity.subject as string).split("|")[0];
   ```

   `split("|")[0]` returns:
   - `"user123|sess456"` → `"user123"` (the Convex Auth shape)
   - `"user123"` → `"user123"` (no pipe → unchanged; safe if the identity shape ever varies)
   - `"user123|s1|s2"` → `"user123"` (defensive: only the first segment is ever the userId)

2. **Rewrite the misleading comment** at `functions.ts:20` so it states the real shape of
   `identity.subject` (`<userId>|<sessionId>`) and that we intentionally take the userId
   segment for stable per-user scoping.

### Data: discard, no migration

Existing rows are keyed by `userId|<session>`. After the switch to bare `userId`, current
reads look up `userId` and find nothing — this is accepted. **No migration.** Old rows are
orphaned and never read again (all reads now key on the bare userId). This includes the
*current* session's data: post-deploy the owner re-connects Gmail once, and prior
notifications/plans/briefings do not reappear. All data created from then on is stable
across logins.

Orphaned rows are left in place (no wipe): zero extra code, harmless for a single-owner
beta, and a wipe touching every table is throwaway code with a real footgun (nuking
non-tenant tables). A cleanup can be done later if the dead rows ever matter.

## Testing

This is the tenant-isolation security path, so the change leaves one runnable check
(ponytail discipline — security paths always keep a check).

Make the derivation testable: extract a tiny pure exported helper
`stableTenant(subject: string)` in `functions.ts` and call it inside `requireTenant`.
Assert three cases:

- `"u|s"` → `"u"`
- `"u"` → `"u"`
- `"u|s1|s2"` → `"u"`

**Where the assertions live.** There is no existing unit test of `requireTenant`'s logic —
`importGuard.test.ts` is a static import-scan that explicitly *exempts* `functions.ts`
(`importGuard.test.ts:27`), so it does not cover this. Two options, pick the lazier that
keeps the suite honest:

- **Preferred:** add a small `describe("stableTenant")` runtime-assert block to the existing
  `importGuard.test.ts` (imports `stableTenant`, three `expect`s). No new file, so the
  CLAUDE.md §9 "new uncovered file under `packages/`" Stop hook does not fire. The file
  already carries tenant-scoping invariants (SC-2), so a tenant-derivation check is a
  reasonable neighbour.
- **Alternative:** add a dedicated `convex/functions.test.ts`. This is a *new* file under
  `packages/` and will trip the §9 hook unless its path is registered in
  `docs/playbooks/watch.json` (or acknowledged under `_unassigned`). Only take this if the
  dedicated file is judged worth the registration step.

## Manual verification

1. Log in. Connect Gmail. Note the `tenantId` (or confirm a `gmailTokens` row exists).
2. Log out.
3. Log in again (fresh session).
4. Confirm the `tenantId` is identical and Gmail is still connected — no re-connect prompt.

## Definition of done

- `requireTenant` returns the stable userId; comment corrected.
- `stableTenant` derivation check added (see Testing); test suite green.
- `pnpm typecheck` passes.
- Manual verification above performed once against the live deployment.
- Memory `tenant-scope-is-per-session` updated to reflect the fix (or the note that it's
  fixed), so future sessions don't re-flag it as a latent bug.

No playbook covers `lib/functions.ts` (confirmed against `docs/playbooks/watch.json`), and
the edit is not a new file, so the §9 playbook Stop hook does not apply to the source
change. Adding a new test file *would* trip it — hence the "extend the existing test"
constraint above.

## Out of scope

- Per-organization scoping.
- Any data migration or backfill.
- Wiping orphaned `userId|session` rows.
- Changes to the wrapper builders' signatures or to any feature file.
