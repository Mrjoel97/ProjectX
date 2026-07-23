# Phase 9: Private Beta Productionization - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Let invited users **beyond the owner** sign up, stay **fully isolated** from each other,
**onboard to a first delivered result in minutes**, and **deliver via Gmail _or_ Outlook**.
This is the week-4 definition of "production" — **NOT** billing, public/open signup, abuse
protection, or legal pages (those are the next milestone, EXPN-04).

Scoped requirements: **BETA-01** (invite-only signup), **BETA-02** (verified per-user
isolation), **BETA-03** (guided conversational onboarding), **DLVR-02** (Microsoft Graph as
second provider).

Also **in-scope and mandatory** (carried in, not a new requirement): the **owner/admin-role
gating** blocker from Phase 8 — the codebase has no owner primitive, so Phase-8 ops/optimizer
controls are currently callable by any authenticated tenant. This MUST land before a second
human exists.

Also **pulled in from Phase 1** (deferred there to here): the production **Vercel deploy** and
the Google OAuth **verification** track (01-08 Tasks 2–3, 01-09).

</domain>

<decisions>
## Implementation Decisions

### Invite & signup flow (BETA-01)
- **Code model:** single-use, **any-email** codes. One code = one signup, then dead. Owner
  controls how many codes exist, not which email redeems each. (No email-binding — chosen for
  lowest friction.)
- **Issuance:** **public waitlist → owner approves.** A visitor requests access; the owner
  approves a pending waitlist entry, which mints a single-use code (optionally emailed). This
  is heavier than a hand-seed and edges toward public-launch surface — accepted deliberately.
- **Approval surface:** a new **owner-only admin page** lists pending waitlist requests with an
  Approve action. This SAME page hosts the owner-gated optimizer/ops controls (see Owner-gating)
  — one admin surface, one auth primitive.
- **Provider gating:** **both** Google and password sign-up are gated by an invite. A Google
  sign-in arriving **without a redeemed invite is blocked at the door — NO user/tenant row
  persists** (no orphan tenants; reconciliation happens in the auth callback). Convex Auth OAuth
  has no natural pre-redemption hook — this reconciliation is the key technical unknown for
  research (see code_context / flagged-for-research).
- **Signup UX:** invite is a **link that pre-fills an editable code field** (`/signup?invite=CODE`);
  no link → user pastes into the same field. One field + one query-param read serves both. Code
  stays visible/auditable (not a hidden magic-link auto-redeem).

### Onboarding to first result (BETA-03)
- **Shape:** **scripted first-run cockpit conversation.** The Executive Agent greets a
  brand-new user in the existing cockpit and walks them to a first send. No separate
  wizard/route — the requirement says "conversational" and the cockpit IS the conversation.
- **Mailbox connect timing:** **inline at first Approve (soft).** User explores/composes freely;
  the connect prompt appears when they Approve without a connected mailbox. Reuses the existing
  connect-gmail flow + `ReconnectBanner`. No hard pre-cockpit gate.
- **"First delivered result" =** a **real email to the user's own address** (welcome/test send).
  Genuine end-to-end delivery (real send + audit + telemetry + per-recipient report), zero risk
  of bothering a stranger. Not a sandbox/no-op, not "reaching a PLAN card" — honors "delivered."
- **Hand-holding:** the agent **offers one concrete first action** ("Want me to send a welcome
  email to yourself so you can see the full governed flow?") → one tap runs resolve → PLAN →
  Approve → delivered. No persistent checklist widget, no new onboarding-state table.

### Microsoft Graph as second provider (DLVR-02)
- **Parity:** **FULL parity** — Outlook gets outbound send AND the read plane (inbox search,
  briefing, reply threading, contact resolution), matching Gmail. ⚠️ This is the phase's
  **schedule risk** (see below).
- **Provider model:** **connect both + choose per send** (potentially per recipient). Needs a
  provider selector in the plan flow and per-recipient routing logic — NOT one-active-provider.
- **Account types:** **personal + work** via the `/common` authority (any org directory +
  personal Microsoft accounts) from a single Azure app registration. Unverified-publisher
  consent screen is acceptable for the beta (mirrors Gmail Testing mode).
- **Priority:** **hard requirement to close Phase 9** (owner decision, overriding the roadmap's
  "built only after Gmail works end-to-end" sequencing note — sequencing still applies, but it
  is not droppable).
- **⚠️ SCHEDULE RISK (recorded, owner-accepted):** Full parity + per-send routing + both account
  types roughly doubles the deepest integration in the codebase (5+ mailbox endpoints against
  Graph's different auth/API model) and lands in the same ~12-day window (beta target ~2026-08-05)
  as the multi-tenant safety work (isolation test, invite gate, owner-gating) that actually gates
  admitting a second human. **Clean de-scope path if the window tightens:** drop to Outlook
  **send-only** for beta and fast-follow the read plane. Planner should sequence Outlook as the
  heaviest lane and land the safety work first.

### Go-live gating
- **Launch posture:** **Gmail Testing mode + Vercel deploy now.** Open the invite beta on Testing
  mode (100 users, 7-day refresh tokens, "unverified app" warning) + an unverified Azure app.
  Google/Microsoft verification stays **OFF the critical path.** This is exactly what Phase 1
  designed Testing mode to carry.
- **Weekly re-auth** (7-day Testing-mode tokens) is accepted for the beta — the `ReconnectBanner`
  + token-age cron already handle it for Gmail; the MS side needs the equivalent.
- **Hosting/domain:** **deploy to the Vercel-provided domain now** (or a cheap already-owned
  domain). A verified **custom domain + Search Console** land later, WITH verification, post-beta.
  Testing mode needs no verified domain.
- **Verification/legal-entity track:** remains blocked on forming a legal entity that can name a
  real data controller in the privacy policy (unchanged from Phase 1). Not on the Phase-9 critical
  path; may be kicked off in parallel but does not gate the beta opening.

### Owner/admin-role gating (Phase 8 blocker — locked in-scope)
- Introduce a **`requireOwner(ctx)` primitive.** Owner identity is a **boolean `owner: true` on
  the user row**, seeded once via `convex run` — data-driven, survives redeploys, extends to more
  admins later. (NOT the first-registered-user heuristic; NOT the `SKILLOPT_OWNER_TENANT` env
  hack, which the Phase-8 memo flags as interim-only.)
- **Gate these three** (found by the Phase-8 commit security review):
  - `optimizerConfig.setOptimizerEnabled` — global optimizer kill switch (broken-authorization)
  - `skills.activateCandidate` — activates a self-modified skill live for ALL users (broken-auth)
  - `skills.candidatesForReview` — reads candidate skill BODIES / optimized prompts (info-disclosure)
- **Non-owner UX:** owner-only page/route + controls are **hidden entirely** for non-owners (they
  never learn the admin surface exists). Server-side `requireOwner` still guards every mutation
  regardless — hiding is presentation; the mutation guard is the non-negotiable trust boundary.
- **BETA-02 tie-in:** the cross-user isolation test (SC-2) should assert a non-owner **cannot
  reach** these three functions.

### Claude's Discretion
- Exact schema of `betaInvites` / waitlist rows and the owner-admin page layout.
- The `requireOwner` implementation details (where it lives relative to `lib/functions.ts`).
- The provider-abstraction seam shape for DLVR-02 (whether a `packages/delivery` package or an
  in-`convex` dispatch layer) — a technical call, but see flagged-for-research on how deep to
  abstract before Outlook lands.
- Onboarding copy/wording and the exact "offer one action" prompt.
- Isolation-test structure/coverage matrix (which tables, which indexes).

</decisions>

<specifics>
## Specific Ideas

- The invite gate, waitlist approval, optimizer kill-switch, `activateCandidate`, and
  `candidatesForReview` all want the **same `requireOwner`-gated admin page** — two apparent
  problems (invites + owner-gating) collapse into one page + one auth primitive. Build them
  together.
- Onboarding's "real email to self" doubles as a **free smoke test** of the full governed spine
  for every new user — connect → resolve → PLAN → Approve → deliver → audit — on their own data.
- The de-scope lever for the schedule risk is explicit: Outlook **send-only** for beta, read-plane
  as fast-follow. Keep it visible during planning.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/backend/convex/lib/functions.ts`** — `stableTenant()` + `requireTenant()` +
  `tenantQuery/tenantMutation/tenantAction`. `tenantId = userId` (first segment of the auth
  subject). This is the isolation linchpin BETA-02 must PROVE (not build). `requireOwner` should
  be a sibling primitive here or adjacent.
- **`packages/backend/convex/auth.ts`** — Convex Auth with **Google** (`openid email profile`
  only — mailbox access is the separate `gmail.modify` consent) + **Password** providers. The
  invite gate hooks the password flow directly; the Google flow needs the block-at-door
  reconciliation.
- **`apps/web/app/(auth)/signup/page.tsx` + `signin/page.tsx` + `fields.tsx` + `icons.tsx`** —
  existing auth UI. Signup currently creates accounts with **no gate** (Google one-click +
  password). The invite code field slots into `signup/page.tsx`.
- **`packages/backend/convex/gmail.ts`** — the deep Gmail integration DLVR-02 mirrors against
  Graph: `send` (internalAction), `search`, `listInbox`, `fetchInboxBodies`, `getReplyTarget`,
  `freshAccessToken`, `buildMime`, `SEND_ENDPOINT`. Token refresh + 7-day-expiry handling live
  here; `gmailTokens` table + token-age cron are the pattern to mirror for MS.
- **`packages/backend/convex/deliverApprovedPlan.ts`** — the fan-out workflow currently calls
  `internal.gmail.send` **directly** (no provider abstraction). This is the seam DLVR-02's
  per-send routing rewrites.
- **`ReconnectBanner`** (from 02-09, survives) + connect-gmail flow — reuse for the "connect
  inline at first Approve" onboarding step and for MS weekly re-auth.
- **Ops page** (OPSG-07 / EVAL-02) — existing owner-relevant surface; the new owner-admin page
  extends this pattern.
- **`optimizerConfig` + `skills` tables** (Phase 8) — the three functions to gate already exist;
  Phase 9 only adds the `requireOwner` guard + hides the UI.

### Established Patterns
- **Every table is tenant-scoped** via the `tenantQuery/Mutation/Action` wrappers — BETA-02 is a
  verification exercise over existing isolation, plus closing the un-gated owner functions.
- **Schema changes ship as tracked migrations** (`@convex-dev/migrations`, OPSG-06) — the
  `betaInvites`/waitlist tables, `users.owner`, and any MS-token table go through migrations, not
  ad-hoc backfills. Note: the owner's existing single-tenant data predates multi-tenant — confirm
  it stays correctly attributed when the second user arrives (no backfill needed since `tenantId`
  was always set, but the isolation test should include the owner's pre-existing rows).
- **`gmail.modify` is a restricted scope** → annual CASA assessment + zero-retention LLM contract
  are standing product costs (unchanged; relevant to the verification track, not the beta open).

### Integration Points
- Auth callback (`auth.ts` / Convex Auth server) — where the invite reconciliation + block-at-door
  logic attaches for both providers.
- `deliverApprovedPlan` send step — where per-send provider routing replaces the direct
  `internal.gmail.send` call.
- A new owner-admin route under `apps/web/app/(app)/` — waitlist approval + the three gated
  Phase-8 controls, all behind `requireOwner` + hidden for non-owners.

## Flagged for Research/Planning (not user decisions — resolve in RESEARCH/PLAN)
1. **Convex-Auth invite reconciliation:** there is no natural pre-redemption hook in the OAuth
   flow. Research how to enforce "block at door, no account persists" for a Google sign-in
   without a redeemed invite (auth callback interception / `afterUserCreatedOrUpdated` / delete-on-
   no-invite). This is the highest-uncertainty item in BETA-01.
2. **BETA-02 isolation test shape:** the real acceptance gate for going multi-tenant. Define an
   explicit two-user cross-read test across EVERY table + index (requests, vault, cache, audit,
   telemetry, plans, briefings, feedback, …) AND assert a non-owner cannot reach the three
   owner-gated functions.
3. **PII names-in-prose export ceiling:** the `/skillopt/export` scrub (`packages/pii`) removes
   STRUCTURED PII only; names in free prose survive. Fine for solo owner, but a **blocker before a
   second user's trajectories can be exported.** Decide: gate export owner-only, or close the
   scrub gap, before multi-user.
4. **MS Graph auth/token model** vs Gmail: delegated `Mail.Send` + `/common`, unverified publisher
   consent, MS token lifetime vs Gmail's 7-day Testing-mode expiry, and the read-plane scopes
   (`Mail.Read`) for full parity.
5. **Env prerequisites** for the optimizer loop already noted in Phase 8: `SKILLOPT_TOKEN` +
   `SKILLOPT_OWNER_TENANT` must be set on the deployment (the latter now superseded by the
   `users.owner` boolean for `requireOwner`, but still referenced by the writeback audit path).

</code_context>

<deferred>
## Deferred Ideas

- **Billing, public/open signup, abuse protection, legal pages** — next milestone (EXPN-04),
  explicitly out of Phase 9.
- **Full Google/Microsoft OAuth verification + verified custom domain + Search Console** — the
  legal-entity-blocked track; kicked off in parallel at most, lands post-beta, does not gate the
  beta open.
- **Waitlist auto-approve-to-a-cap** — considered and rejected for now (removes owner curation);
  revisit if invite volume grows.
- **Outlook read-plane (briefing/reply/resolve) as a fast-follow** — the de-scope target IF the
  window forces send-only; not a deferral today (owner chose full parity), but the named fallback.
- **Email-bound / multi-use invite codes** — rejected in favor of single-use any-email; revisit
  for cohort invites post-beta.
- **Strength/breach password checks + email verification + password reset** — Phase-8/auth
  `ponytail:` ceiling; needs a transactional email sender, deferred past the closed beta.
- **Additional admin roles beyond owner** — the `users.owner` boolean is extensible to a role
  set later; not built now.

</deferred>

---

*Phase: 09-private-beta-productionization*
*Context gathered: 2026-07-24*
