---
title: Connections — a fourth Business Profile tab, not a Configurations page
status: approved (owner, 2026-08-02)
decided: 2026-08-02
supersedes_premise_of: .planning/design/growth-surfaces-canvas-funnels-connections.md §3.4
decision: The connection surface becomes a fourth tab on `/dashboard/profile`, reached from a
  RENAMED rail footer item ("Connect Gmail" → "Connections"). Google renders live; the three
  categories that cannot connect yet render as rows that STATE THEIR BLOCKER. No new page, no new
  route, no new Convex function, no new table, no schema change.
---

# Design — Connections tab

**Status:** approved 2026-08-02. Owner-driven, originating from a live observation: the Gmail
Disconnect control exists and works, but is unfindable.

**Reading order:** §1 (why the earlier rejection no longer applies) → §5 (what must NOT be built)
→ §2–4 (the build).

---

## 1. Why this reverses part of a decided document

`.planning/design/growth-surfaces-canvas-funnels-connections.md` §3.4 ruled
**"Configurations / Integrations → a button, not a page"**, on the ground that *"an aggregator over
one item is not a page."* That reasoning was correct about **structure** and is not disturbed here.

Two things it did not account for, both surfaced by the owner on 2026-08-02:

1. **It never asked what the entry point would be CALLED.** The Disconnect button shipped
   (`gmailAuth.disconnectGoogle`, commit `0e89a09`) behind a rail item labelled **"Connect Gmail"**.
   To a connected user that label reads as a finished setup step, so the control is invisible in
   practice. Discoverability is a separate question from whether a surface deserves its own route,
   and §3.4 only answered the second.
2. **The owner's intended contents are a category, not one item** — social account auth, external
   database auth, third-party applications, connections, configurations. The rail footer holds four
   items today (Business Profile, Connect Gmail, Collapse, Sign Out); `.rail-foot` is not the
   scrolling region (`.rail-nav` is, `globals.css:651-658`), so footer growth crushes rather than
   scrolls.

**What is preserved from §3.4 unchanged:** no `/dashboard/connections` route is created;
`/connect-gmail` is not deleted or rewritten; connections stay TENANT data on
`tenantQuery`/`tenantMutation`, never `ownerQuery` (platform config remains on `/ops`); the
credential rule ("only store what you can scope and revoke") stands and is what keeps §5 empty.

---

## 2. Architecture

Five files (plus the playbook, §8). **Zero backend change.**

| File | Change |
|---|---|
| `apps/web/app/(app)/dashboard/profile/ConnectionsPanel.tsx` | **new** — the tab body |
| `apps/web/app/(app)/dashboard/profile/page.tsx` | one `TABS` entry + one `<div role="tabpanel">` |
| `apps/web/app/(app)/_components/DisconnectGoogle.tsx` | **new** — the shared button (§4) |
| `apps/web/app/(app)/layout.tsx` | footer item relabelled + re-pointed |
| `apps/web/app/(app)/connect-gmail/page.tsx` | imports the shared button instead of inlining it |

Both backend functions already exist and are tenant-scoped:

- `gmailAuth.gmailStatus` (`gmailAuth.ts:229`) → `{ connected: boolean, expiresAt: number | null }`
- `gmailAuth.disconnectGoogle` (`gmailAuth.ts:273`) → `{ revoked: boolean }`

**No new Convex function, no new table, no schema edit, no `middleware.ts` change.**

### 2.1 The tab slots into an existing pattern

`page.tsx` already carries the mechanism:

- `TABS` is a `const` array (`:48-52`) — a fourth entry is one line.
- Arrow-key roving already loops modulo `TABS.length` (`:157-158`) — free.
- `?tab=` is read once on mount from `window.location.search` (`:75`, deliberately never
  `useSearchParams` — the repo idiom) and written back on change (`:84`), so
  `/dashboard/profile?tab=connections` is already a valid, shareable deep link.
- `isTabId` (`:56`) validates against `TABS`, so an unknown `?tab=` falls back safely.

**Known cost, accepted:** all panels stay MOUNTED and toggle with `hidden` (`:216-218` — this is
what lets a half-typed narrative survive a tab trip). A Connections panel therefore mounts on every
profile visit, so its `gmailStatus` subscription is always live. One cheap indexed `by_tenant`
`.unique()` lookup. Accepted rather than worked around; lifting state to avoid it would cost more
than it saves.

### 2.2 The rail

The footer item at `layout.tsx:151-158` changes label `"Connect Gmail"` → `"Connections"` and
`href` → `/dashboard/profile?tab=connections`. Nothing is added to the rail; one stale label dies.

**Required companion fix:** `isActive` (`layout.tsx:105-106`) does `pathname.startsWith(href)`, and
`usePathname()` carries **no query string**, so an href with `?tab=` can never match and the item
would never light up. Compare against the pathname portion only. Without this the change ships a
permanently-dead active state.

---

## 3. The row model — concrete, not generic

**One live provider does not justify a provider abstraction.** `ConnectionsPanel` contains:

- a concrete `<GoogleRow />` reading `gmailStatus`; and
- a module-level `BLOCKED` array of `{ label, blocker }`, mapped over.

There is deliberately no `Record<Provider, …>` lookup, no `ConnectionRow` interface and no
`providers.ts`. §3.4 item 10 of the growth-surfaces doc already pre-committed that lookup to
**"the same commit as the Microsoft Graph adapter"** (Phase 25). This design does not pre-empt it.

### 3.1 The blocked rows state a real reason

Approach chosen over a "Soon" badge. The distinguishing test: **does a reader learn something true?**
A "Soon" tag is decoration and silently becomes a promise; a stated blocker is information and tells
the reader what would clear it.

| Row | Blocker text (substance) |
|---|---|
| Social accounts | Blocked on business-entity verification — LinkedIn Marketing Developer Platform, Meta Business Verification and Google OAuth verification each require a real legal entity as data controller. |
| Databases & CRMs | Blocked on encrypted credential storage — API keys and PATs have no scope, no refresh and no per-integration revocation. |
| Third-party apps | Capability is code-owned (ADR-007); a specialist's tool-set is never DB-writable. |

This is the failure mode being avoided, named in the growth-surfaces doc's own §1.1: *"'Live work
canvas' is brand copy over a CSS section."* A tab of decorative disabled rows naming services that
cannot be connected would repeat that with a different noun.

**Each `BLOCKED` entry carries a `ponytail:` comment naming what clears it.** These are hardcoded
facts about the codebase as of 2026-08-02 and they WILL rot. Nothing enforces freshness — that is an
accepted ceiling, recorded here so it is not mistaken for an oversight.

The social row's blocker is also the single highest-leverage non-code item in the project
(growth-surfaces §5.8: forming the legal entity simultaneously gates Google OAuth verification,
LinkedIn MDP, Meta Business Verification, a custom domain registrant, CASA and billing — and it is
on no roadmap). Putting that sentence where the owner will actually see it is worth more than the
tab.

---

## 4. Shared Disconnect — one writer for the confirm text

`connect-gmail/page.tsx:34` owns a `confirm()` string warning that disconnecting kills **calendar as
well as mail**. Duplicating that string in the tab creates two writers of one user-facing warning;
the next scope change updates one and the other starts lying.

The button therefore moves to `apps/web/app/(app)/_components/DisconnectGoogle.tsx` — an existing
directory (`ReconnectBanner.tsx` lives there), imported by both surfaces. This also avoids
`/connect-gmail` importing from `dashboard/profile/`, which the onboarding playbook explicitly
closed off ("no panel imports from a page component any more").

`/connect-gmail` otherwise stays exactly as it is: the OAuth start page and callback landing target,
still linked from `ReconnectBanner.tsx:74`, `workspace/page.tsx:343` and `dashboard/page.tsx:55`.
§3.4 item 9 rejected deleting it ("a rewrite, not a fix") and that still holds.

---

## 5. Error handling and honest states

Three states, and getting them wrong reintroduces the exact false-promise problem this work exists
to fix.

**Loading is NOT disconnected.** `useQuery` returns `undefined` before the first result. The row
renders **"Checking…"**, never "Disconnected" — a false negative invites a user to reconnect an
already-connected account. The codebase carries scar tissue for precisely this class
(`layout.tsx:210`'s eternal-spinner note; `DeadLetterBadge` returning `null` on `undefined` to avoid
a flash).

**`revoked: false` does not mean "nothing happened".** Verified by reading the handler, not assumed:

```ts
const revoked = status === 200 || status === 400;
await ctx.runMutation(internal.gmailAuth.deleteTokens, { tenantId: ctx.tenantId });  // unconditional
```

The local row is deleted **whether or not** the revoke succeeded. So `revoked: false` means *we
dropped our copy, but Google may still hold the grant.* The UI must say that and point at Google's
account-permissions page. Reporting a flat "Disconnected" there would be a second false promise of
the same kind as the one in `privacy/page.tsx:312`.

(200 and 400 both count as success — 400 means Google already considers the token invalid, the same
end state. This mirrors the `eventIdFor` discipline in `calendar.ts` where a 409 duplicate IS
success.)

**A thrown `fetch`** (network/DNS) aborts the action before `deleteTokens`, leaving the row intact.
The UI surfaces the failure and the row stays "Connected" — which is true.

---

## 6. Testing

Per CLAUDE.md §8, non-trivial logic leaves ONE runnable check. The presentational parts need none.
Two things do:

1. **Every `BLOCKED` entry has a non-empty `blocker`.** A row that cannot say why is decoration —
   the exact thing §3.1 rejects.
2. **A source scan asserting no interactive control renders inside the blocked map.** The repo
   already uses this idiom (the SC#1c source scan recorded in `onboarding.md`). It is what stops a
   later edit from shipping a dead "Connect" button that does nothing.

Both live in one small test file. No new framework, no fixtures.

---

## 7. What must NOT be built

Carried forward so it is not re-proposed:

1. **A `/dashboard/connections` route.** Rejected in §3.4 item 9 and not revived — the tab is the
   surface.
2. **A `providers`/`connections` table.** Nothing here persists anything new; Google's state already
   lives in `gmailTokens`.
3. **A credential form for API keys / PATs / database URLs.** `gmailTokens.refreshToken` is
   `v.string()` — **plaintext**, commented "the crown jewels". A wall of pasted un-scopeable secrets
   against a plaintext column is a materially worse risk class than one revocable OAuth grant. An
   encrypted-secret story is a prerequisite, not a detail.
4. **An MCP client for user-supplied servers.** Collides with ADR-007 and with the closed
   `agentSteps.tool` union (`schema.ts:457-521`). "Expose, do not consume" stands.
5. **A `Record<Provider, …>` lookup, `provider` column or `by_tenant_provider` index.** Phase 25,
   same commit as the Microsoft Graph adapter.
6. **Interest-capture / click logging on the blocked rows.** Needs a table and a mutation to
   manufacture demand evidence for a product with no users; `PROJECT.md:51-53` bars roadmap
   admission on exactly that basis.
7. **Any change to `middleware.ts`.** No public surface is introduced.

---

## 8. Definition of done

- The Connections tab renders at `/dashboard/profile?tab=connections`, reachable from the renamed
  rail footer item, with the active state lighting correctly.
- Google's row reflects live status and offers Disconnect; the three blocked rows state their
  blockers and expose no interactive control.
- `DisconnectGoogle` has exactly one definition, imported by both surfaces.
- The two checks in §6 pass.
- `docs/playbooks/onboarding.md` is updated in the same commit and its `Last verified` line bumped
  (CLAUDE.md §9 — the profile path is one of its watched prefixes).

## 9. Explicitly out of scope

- Tenant-level settings/preferences on this tab. Business identity stays on the other profile tabs;
  platform config stays on `/ops`. Revisit only if a concrete setting has nowhere to live.
- Outlook and the provider adapter (Phase 25).
- Making any currently-blocked integration actually work.

## 10. Non-claim

This does **not** make `privacy/page.tsx:312` more true than it already was. Disconnect worked
before this change; this only makes it findable. It must not be recorded as a compliance fix.
