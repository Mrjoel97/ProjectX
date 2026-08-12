# Phase 25: Private Beta Productionization - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning
**Source:** Inherits `09-CONTEXT.md` (2026-07-24), amended by owner decisions 2026-08-09.

> **READ THIS FIRST.** `.planning/phases/09-private-beta-productionization/09-CONTEXT.md` is the
> ancestor spec and is still worth reading for its code-context inventory. But it was written
> **before phases 10-24 existed** and it is **wrong in four places today**. Where the two
> disagree, THIS file wins. The `<inherited_deltas>` block below enumerates every divergence.
> Do not plan off `09-CONTEXT.md` alone.

<domain>
## Phase Boundary

Open the **invite-only private beta on the full platform**: invited users beyond the owner sign
up, stay **provably isolated** from each other, **onboard to a first delivered result in
minutes**, and **deliver via Gmail OR Outlook**. This is the last phase of milestone v2.0 and it
executes LAST.

Scoped requirements: **BETA-01** (invite-only signup), **BETA-02** (per-user isolation across
every table and index), **BETA-03** (guided conversational onboarding to first delivered
result), **BETA-05** (the culminating two-user cross-tenant test), **DLVR-02** (Microsoft Graph
as the second delivery provider through the same adapter).

**NOT in scope** (unchanged from `09-CONTEXT.md`): billing, public/open signup, abuse
protection, legal pages. Also not in scope: Google/Microsoft OAuth *verification* and the
legal-entity track — both stay off the critical path.

</domain>

<inherited_deltas>
## What changed since `09-CONTEXT.md` (2026-07-24)

Four substantive divergences. Two are owner decisions taken 2026-08-09; two are facts that
changed underneath the old document.

### 1. `requireOwner` is BUILT — reuse it, do not build it
`09-CONTEXT.md` puts the `requireOwner` primitive and the gating of the three Phase-8 functions
**in scope** for this phase. **Phase 22 shipped it** (3/3 plans, live UAT 2026-08-01: owner
bootstrap PASSED, server-side trust boundary PASSED in both directions).

Phase 25 therefore **consumes** `requireOwner` for the owner-admin surface and does **not**
re-derive it. Two residues remain and belong here:
- Phase 22's **`/ops` DOM UAT half was never obtained** (environmental — see
  `22-UAT-EVIDENCE.md`). The owner-admin page this phase builds is the natural place to close it.
- BETA-05 must still **assert a non-owner cannot reach** `optimizerConfig.setOptimizerEnabled`,
  `skills.activateCandidate` and `skills.candidatesForReview`. That assertion is a *test* this
  phase writes, not a guard this phase builds.

### 2. Invites are EMAIL-BOUND (owner decision 2026-08-09) — reverses `09-CONTEXT.md`
`09-CONTEXT.md` locked "single-use, **any-email** codes… **No email-binding** — chosen for
lowest friction." **That is reversed.** Roadmap SC#2 governs:

> Invite redemption binds the OAuth **SUBJECT** (not the typed email), **verifies the invited
> email matches**, records the subject **immutably**, and **rejects cross-subject
> re-redemption** — tested against **both Google and Microsoft subject formats**.

An invite row therefore carries an invited email. Redemption is a three-part check: the code is
valid and unredeemed, the authenticating identity's email matches the invited email, and the
OAuth subject is recorded immutably so a second subject can never re-redeem the same code.

The Microsoft subject-format half is not optional and is not theoretical — `STATE.md` carries it
as a standing blocker: *"MS Graph subject format (Phase 25): invite->subject reconciliation needs
the delegated-flow response shape verified before binding logic."* Verify the shape before
writing the binding, not after.

### 3. Outlook is FULL PARITY (owner decision 2026-08-09) — the de-scope lever was NOT taken
`09-CONTEXT.md` recorded full parity as the phase's schedule risk and named a clean de-scope
path (send-only, read plane as fast-follow). **The owner was offered that lever on 2026-08-09
and declined it.** Outlook gets **outbound send AND the read plane** — inbox search, briefing,
reply threading, contact resolution — matching Gmail.

This is knowingly the **heaviest lane in the phase**. The sequencing instruction from
`09-CONTEXT.md` still stands and is now load-bearing: **land the multi-tenant safety work
(invite gate, isolation test, owner-admin) FIRST**, sequence Outlook as the long tail. Safety
gates admitting a second human; Outlook does not.

### 4. The isolation surface grew by an order of magnitude
`09-CONTEXT.md` was written when the product was a governed email cockpit. Since then S1-S3
added — at minimum — the vault (documents, folders, embeddings, graph entities, Drive rail),
the Business Blueprint, media (jobs, assets, canvas, budget rail), contacts/followUps/
suppressions, calendar, goals, the spend ledger, and the Phase 26 dashboard read models.

**Consequence:** a table/index list hand-authored today is stale before it executes. See
`<decisions>` → "BETA-05 shape".

</inherited_deltas>

<decisions>
## Implementation Decisions

### Invite & signup flow (BETA-01)
- **Code model:** single-use, **EMAIL-BOUND** codes (see `<inherited_deltas>` §2). One code =
  one invited email = one signup, then dead.
- **Issuance:** **public waitlist → owner approves.** A visitor requests access; the owner
  approves a pending entry on the owner-only admin page, which mints the single-use code.
- **Approval surface:** the **owner-only admin page**, behind the already-shipped Phase 22
  `requireOwner`. Same page hosts the three gated Phase-8 controls. One admin surface, one auth
  primitive — this collapsing was `09-CONTEXT.md`'s best insight and survives intact.
- **Provider gating:** **both** Google and password sign-up are invite-gated. A Google or
  Microsoft sign-in arriving **without a redeemed invite is blocked at the door with NO
  user/tenant row persisted.** No orphan tenants. Convex Auth OAuth has no natural
  pre-redemption hook — this remains the highest-uncertainty item in the phase and is flagged
  for research below.
- **Signup UX:** invite is a **link that pre-fills an editable code field**
  (`/signup?invite=CODE`); no link → the user pastes into the same field. One field, one
  query-param read, code stays visible and auditable.

### Onboarding to first result (BETA-03)
- **Shape:** **scripted first-run cockpit conversation.** The Executive Agent greets a brand-new
  user in the existing cockpit and walks them to a first send. No separate wizard, no new route,
  no onboarding-state table.
- **Interaction with Phase 11/15.1 onboarding:** Phase 11 (sparse-start persona onboarding) and
  Phase 15.1 (conversational onboarding, agent name, behavior preset) **already ship a first-run
  path.** Phase 25 does **not** build a second one — it extends the existing path with the
  first-send offer. Planner must read Phase 11 and 15.1 before touching onboarding.
  Per the standing project constraint, **idea-stage profiles are thin by design** — only
  `oneLineDescription` and persona are required. The first-send offer must work on a thin
  profile.
- **Mailbox connect timing:** **inline at first Approve (soft).** The connect prompt appears when
  the user Approves without a connected mailbox. Reuses the existing connect flow +
  `ReconnectBanner`. No hard pre-cockpit gate.
- **"First delivered result" =** a **real email to the user's own address**. Real send, real
  audit, real telemetry, real per-recipient report. Not a sandbox, not a no-op, not "reached a
  PLAN card". This doubles as a free end-to-end smoke test of the governed spine on the new
  user's own data.
- **Hand-holding:** the agent **offers one concrete first action**, one tap runs
  resolve → PLAN → Approve → delivered. No persistent checklist widget.

### Microsoft Graph as second provider (DLVR-02)
- **Parity:** **FULL** — send AND read plane (inbox search, briefing, reply threading, contact
  resolution). Owner-confirmed 2026-08-09.
- **Provider model:** **connect both + choose per send.** Not one-active-provider.
- **Account types:** personal + work via the `/common` authority from a single Azure app
  registration. Unverified-publisher consent is acceptable for the beta (mirrors Gmail Testing
  mode).
- **The adapter is built in the SAME commit as the Graph implementation, not before.** Roadmap
  SC#5 is explicit and cites the code: `gmailTokens` (`schema.ts:625-632`) has no `provider`
  column and is indexed `by_tenant` only; `gmail.ts:45-46` hardcodes
  `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`; `gmail.ts:19` hardcodes the Google
  token endpoint. The widening — a `provider` column, a `by_tenant_provider` index, a provider
  lookup — ships **with** the Microsoft adapter. **An abstraction with one implementation is
  what CLAUDE.md §8 forbids**; a plan that lands the seam in an earlier wave than the Graph
  adapter is wrong on its face.
- **Seam to rewrite:** `deliverApprovedPlan.ts` currently calls `internal.gmail.send`
  **directly**. That call site is where per-send provider routing lands.
- **Re-auth:** the Gmail 7-day Testing-mode expiry is handled by `ReconnectBanner` + the
  token-age cron. The MS side needs its equivalent; MS token lifetime differs and must be
  verified, not assumed.

### BETA-02 / BETA-05 shape — the isolation gate
- **BETA-02 is a VERIFICATION exercise, not a build.** Every table is already tenant-scoped via
  the `tenantQuery/tenantMutation/tenantAction` wrappers in `convex/lib/functions.ts`. This
  phase proves it; it does not re-implement it.
- **The two-user test DERIVES its table/index list from `schema.ts` at execution time.** Owner
  decision 2026-08-09. A hand-authored list rots between authoring and execution (see
  `<inherited_deltas>` §4) and — worse — a table added after the list was written is silently
  uncovered, which is exactly the failure the test exists to catch. The test must **fail when a
  table exists that it does not cover**, so new surfaces cannot slip through unasserted.
- **Precedent to follow, not duplicate:** 19-02 already ships a 40-test BETA-05 isolation block
  with an exact `{contactId, addressHash}` audit key set. Reuse its shape.
- **Must also assert** a non-owner cannot reach the three owner-gated Phase-8 functions.
- **`packages/pii` names-in-prose ceiling is a hard gate on this phase.** `packages/pii` scrubs
  **structured** PII only; names in free prose survive. That is fine for a solo owner and is a
  **blocker before a second user's trajectories can be exported.** Decision: **gate
  grounded-prose export owner-only** for the beta (roadmap SC#3 states this), and record the
  scrub gap as the named unlock. Do not attempt to close the scrub in this phase.

### Go-live posture
- **Launch on Gmail Testing mode + an unverified Azure app + a live Vercel deploy.** Google and
  Microsoft verification stay OFF the critical path. Testing mode's 100-user cap and 7-day
  refresh-token lifetime are accepted; the 7-day lifetime is already why
  `SEND_TIME_HORIZON_MS` is 7 days.
- **Custom domain (roadmap SC#6) is a BLOCKING OWNER DECISION inside this phase**, not a
  planning input. The decision is binary, but only Branch A is completion-capable: **Branch A**
  provides a durable custom domain, DNS and TLS and releases deployment/live sends; **Branch B**
  records that no user-shareable URL ships and BLOCKS Phase 25 because mandatory BETA-03 self-send
  and DLVR-02 Outlook-send acceptance cannot run. It belongs in a `checkpoint:decision` task. The
  reasoning the owner must decide against:
  serving from `*.convex.site` **shares a host with the OAuth callback** (`http.ts:15`), so a
  reputation flag on that host breaks **SIGN-IN**, not merely a page; and a Convex deployment
  URL is deployment-scoped, so a link a user sent a client does **not** survive a prod
  migration. **Outcome required for completion:** Branch A is implemented and evidenced. Branch B
  is a valid recorded decision only as an unresolved phase blocker; it cannot release deployment,
  live sends, requirement closure, or Phase 25 completion.
- **Production secrets are part of go-live and are NOT all in place.** At minimum,
  `UNSUBSCRIBE_SECRET` is currently set on the **local** deployment only — a hosted deployment
  without its own causes **every unsubscribe link to 404 and every send to be refused** (19-04).
  `SKILLOPT_TOKEN` is likewise a deployment env. The deploy plan must enumerate every required
  secret and fail closed on a missing one rather than discovering it in production.

### Claude's Discretion
- Exact schema of the `betaInvites` / waitlist rows and the owner-admin page layout.
- Where the invite-redemption reconciliation attaches inside the Convex Auth callback.
- The provider-routing seam's concrete shape (in-`convex` dispatch vs a `packages/delivery`
  module) — a technical call, resolved by research, constrained by the "same commit" rule above.
- Onboarding copy and the exact "offer one action" prompt wording.
- The mechanism by which the isolation test enumerates tables from `schema.ts`.

</decisions>

<specifics>
## Specific Ideas

- The invite gate, waitlist approval, and the three Phase-8 controls all want the **same
  `requireOwner`-gated admin page**. Build one page. It is also the cheapest place to close
  Phase 22's outstanding `/ops` DOM UAT.
- Onboarding's "real email to self" is a **free full-spine smoke test** for every new user:
  connect → resolve → PLAN → Approve → deliver → audit, on their own data.
- The isolation test that **fails on an uncovered table** is worth more than the test that
  passes on today's tables. Write the enumeration, not the list.
- Outlook is the long tail. Nothing about admitting a second human safely depends on it — so
  nothing in the safety lane may depend on it either.

</specifics>

<code_context>
## Existing Code Insights

`09-CONTEXT.md` §`<code_context>` remains substantially accurate for the auth/Gmail/delivery
spine and should be read for its file-level inventory. Corrections and additions:

### Corrections to the inherited inventory
- **`requireOwner` EXISTS** (Phase 22). Do not plan to build it.
- **Gmail disconnect + Google token revocation EXIST** (22.1-01, owner live-verified). The
  privacy policy's promised control is real. Outlook needs the equivalent.
- **`dailySpendCents` is per-tenant keyed** (22.1-02, smoke 7/7 live-verified 2026-08-01). The
  deployment-wide window `09-CONTEXT.md` implies is gone.

### Additions since 2026-07-24
- **`convex/contacts.ts`** (19-02) — the tenant-scoped person store, plus the send-path
  suppression internals and the `UNSUBSCRIBE_SECRET`-signed opaque token. Its 40-test BETA-05
  block is the isolation-test template.
- **`convex/http.ts`** (19-04) — carries the product's **first public unauthenticated route**
  (`/unsubscribe/<raw>.<hmac>`) alongside the OAuth callback. Relevant to SC#6's host-sharing
  argument and to the production-secret enumeration.
- **`cockpit.ts` send path** (19-05) — the pre-CAS postal-address refusal and pre-join
  suppression partition. A tenant with no postal address **cannot approve and cannot send** —
  which means **onboarding must surface the postal address**, or a brand-new user's first send
  is refused. This is a direct BETA-03 dependency that did not exist when `09-CONTEXT.md` was
  written.

### Established patterns
- Schema changes ship as tracked migrations (`@convex-dev/migrations`, OPSG-06).
- Domain logic in pure-TS `packages/*`; `convex/` stays a thin adapter (CLAUDE.md §1).
- Raw `query`/`mutation`/`action` imports are banned outside the wrapper module (CLAUDE.md §2).
- Skill bodies are DB registry rows and ride the eval gate — **never hardcoded** (CLAUDE.md §5).
  Any onboarding-script change to `cockpit-agent` is a GATED skill edit, needs
  `pnpm eval:golden`, and must **read back the live version** before activating (seedSkills
  writes `maxVersion + 1` and optimizer dry-runs occupy versions).
- Playbooks under `docs/playbooks/` update in the same commit as the subsystem they cover
  (CLAUDE.md §9, Stop-hook enforced).

## Flagged for Research/Planning (resolve in RESEARCH/PLAN — not user decisions)
1. **Convex-Auth invite reconciliation.** No natural pre-redemption hook in the OAuth flow.
   Determine how to enforce "block at door, no row persists" for Google AND Microsoft
   (`afterUserCreatedOrUpdated`, callback interception, delete-on-no-invite). Highest
   uncertainty in the phase.
2. **Microsoft OAuth subject format** for the delegated flow — must be verified before the
   binding logic is written (standing `STATE.md` blocker). SC#2 requires the test to cover both
   Google and Microsoft subject shapes.
3. **Schema-derived table enumeration** for the isolation test — how to enumerate tables and
   indexes from `schema.ts` at test time so an uncovered table fails the suite.
4. **MS Graph auth/token model** vs Gmail: delegated `Mail.Send` + `Mail.Read` + `/common`,
   unverified-publisher consent, MS token lifetime vs Gmail's 7-day Testing-mode expiry, and the
   read-plane endpoint mapping for briefing / reply threading / contact resolution.
5. **Full production secret inventory** for a hosted deployment (`UNSUBSCRIBE_SECRET`,
   `SKILLOPT_TOKEN`, OAuth client pairs for both providers, …) and a fail-closed startup check.
6. **Interaction with the existing Phase 11 / 15.1 first-run path** — where the first-send offer
   attaches without building a second onboarding.

</code_context>

<deferred>
## Deferred Ideas

- **Billing, public/open signup, abuse protection, legal pages** — next milestone, explicitly out.
- **Full Google/Microsoft OAuth verification, verified custom domain + Search Console** — the
  legal-entity-blocked track. Does not gate the beta opening.
- **Closing the `packages/pii` names-in-prose scrub** — this phase gates prose export owner-only
  and records the gap as the named unlock; it does not close it.
- **Waitlist auto-approve-to-a-cap** — rejected (removes owner curation); revisit if volume grows.
- **Multi-use / cohort invite codes** — rejected in favour of single-use email-bound.
- **Password strength/breach checks, email verification, password reset** — needs a transactional
  email sender; deferred past the closed beta.
- **Admin roles beyond owner** — the Phase 22 primitive extends later; not built now.

</deferred>

<open_bookkeeping>
## Bookkeeping defects to correct during this phase

Recorded here so the planner can fold them into a docs task rather than leaving them to rot:

- **`REQUIREMENTS.md:160` marks BETA-05 `[x]` Complete** and the trace table (`:348`) says
  "Complete". Only the "assertions written as each surface ships" half is done (19-02's block).
  **The culminating two-user test does not exist** — it is this phase's deliverable. The
  requirement must not read Complete before this phase closes.
- **`ROADMAP.md` Phase 25 row reads `0/TBD`** and must carry the real plan count once planned.

</open_bookkeeping>

---

*Phase: 25-private-beta-productionization*
*Context gathered: 2026-08-09 — inherits 09-CONTEXT.md (2026-07-24), amended by owner decisions*
