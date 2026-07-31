---
title: Growth surfaces — landing-page canvas, workflow canvas, funnels, connections
status: decided (reviewed 2026-07-31; four capability proposals adversarially reviewed, most scope rejected)
decided: 2026-07-31
decision: All four owner-requested capabilities are absorbed into EXISTING roadmap phases
  (18, 19, 21, 22.1, 25) or pushed post-beta. No new phase is minted, no new table is added
  pre-beta, and no canvas library enters the repo. The reusable "canvas" mechanism already
  exists and is documented here as the panel protocol (§2).
---

# Design — Growth Surfaces: canvases, funnels, connections

**Status:** decided (2026-07-31). This document is the decision record for four capabilities
the owner asked about on 2026-07-31: (a) agent-built landing pages with a live workspace
canvas, (b) a dynamic workflow/automation generator with a canvas, (c) funnels that
capture → nurture → convert leads with per-stage metrics, (d) a Configurations/Integrations
page for social, email, CRM, external DBs and MCP/A2A.

**Scope:** what the repo actually provides today, what was decided, and — most importantly —
what must NOT be built. A future session with no memory of the originating conversation should
be able to act from this file alone.

**Deferred (separate later milestone):** publishing a page to a public URL; the funnel form
and its lead-capture write; a `routines` table + cron; a `/dashboard/connections` aggregator
page; social posting; an MCP client for user-supplied servers. See §6.

**Reading order for a future session:** §1 (what exists) → §4 (what was rejected) → §3 (what
was decided). §4 before §3 is deliberate: the expensive versions of all four capabilities are
seductive and were already argued down once.

---

## 1. Status quo — what the repo actually has today

Four findings are load-bearing. Every design below is downstream of them.

### 1.1 There is no canvas. "Live work canvas" is brand copy over a CSS section.

`apps/web/app/(app)/dashboard/workspace/page.tsx:378` renders the string
`{threadId ? "Live work canvas" : …}` as an `<h2>`. That is the entire extent of "canvas" in
the product, alongside the `--canvas` CSS token and the `.pane-canvas` class in
`apps/web/app/globals.css`. There is no `<canvas>` element anywhere under `apps/web/app`.

No graph/diagram/drag library is installed: a `package.json` scan across the workspace finds
no `reactflow`, `@xyflow/*`, `tldraw`, `excalidraw`, `konva`, `cytoscape`, `rete`, `@dnd-kit/*`
or `react-dnd`, and `pnpm-lock.yaml` contains zero matches for any of them (the single
`@xyflow/react` string in the tree is a devDependency declared inside the published
`@convex-dev/aggregate` package manifest under `node_modules` — not installed, not transitive
into our build). CLAUDE.md §10 and `docs/design/BRAND.md` forbid adding a component library
without asking. **Anyone who reads "canvas" in a roadmap line and reaches for a node editor is
adding the repo's first UI dependency for a feature nobody has validated.**

### 1.2 There is no public read path, and the default-deny posture is deliberate.

`apps/web/middleware.ts:10` is a literal five-route allowlist —
`["/", "/privacy", "/terms", "/signin", "/signup"]` — with the comment at `:9` naming
default-deny as "the safe direction". There is no dynamic segment. Note the matcher at
`middleware.ts:20`: `"/((?!.*\\..*|_next).*)"` skips any path containing a dot, so a public
path with a file extension would bypass the auth middleware *accidentally* — a reason to put
any future public surface on the Convex `httpAction` plane where it is explicit, never on a
Next route that merely looks private.

Every handout of stored bytes re-checks the tenant: `plans.attachmentUrls` bounces on
`plan.tenantId !== ctx.tenantId` (`packages/backend/convex/plans.ts:378`), `reportForPlan`
skips foreign rows (`plans.ts:416`), and `vault.vaultDownloadUrl` returns `null` before it
ever calls `ctx.storage.getUrl` (`packages/backend/convex/vault.ts:317`).
`packages/backend/convex/http.ts` declares only the Gmail OAuth callback (`http.ts:15`) and
bearer-gated SkillOpt routes. **Publishing anything world-readable is net-new architecture,
not a missing file.**

### 1.3 Automation is compile-time. A per-user schedule is impossible by construction.

`workflow.define` appears exactly three times and every one is a static TypeScript
declaration: `packages/backend/convex/deliverApprovedPlan.ts:23`,
`packages/backend/convex/pipeline.ts:90`, `packages/backend/convex/vaultIngest.ts:104`. There
is no interpreter that turns a DB row into a workflow definition, so a user-authored
automation can never *be* a workflow — it can only be *interpreted by* one.

Convex crons are statically registered in one file. `packages/backend/convex/crons.ts` holds
exactly three: `worm-export`, `gmail-token-expiry-scan` and `proactive-review`. A per-user
cron cannot exist. The only legal shape is the `proactiveReview` precedent — ONE static cron
that enumerates tenants and fans out `ctx.scheduler.runAfter(0, …)`, where every fanned-out
function takes an explicit validated `tenantId` because the cron carries no authenticated
identity.

One further hard limit: `plans.byThread` reads `.unique()` (`packages/backend/convex/plans.ts:135`,
with the frozen-schema note at `:120`). One thread holds exactly one plan row. **A branching or
parallel automation graph is structurally unrepresentable.**

### 1.4 The step vocabulary already exists as a palette.

`buildCockpitTools` (`packages/backend/convex/llm.ts:726`) declares every governed verb as a
literal object key in one function. Its trace counterpart is the closed
`agentSteps.tool` union at `packages/backend/convex/schema.ts:457` — 27 literals
(`thinking` plus 26 tool names, through `declareUnsupported` at `schema.ts:521`). The comment
at `schema.ts:452-456` states why there is deliberately no `label`/`text`/`detail` field: §4 is
enforced by the *absence* of anywhere to put text.

This union is a trap for new work. A tool literal missing from it makes the trace insert throw
inside a callback the AI SDK **swallows** — green in every offline test, silently invisible in
production. `schema.ts:485-491` records that this already bit `searchVault` and
`evaluateBusiness`. Every new tool ships its literal *and* its VERB entry in
`apps/web/app/(app)/dashboard/workspace/cards.tsx:1139-1178` in the same commit, or
`traceParity.test.ts` goes red.

**Consequence for a "workflow builder":** the step palette, the runner, the trace view, the
governance gate and the versioned program store all already exist. The only genuinely new
thing a routine needs is a trigger row.

---

## 2. The panel protocol — the reusable mechanism for every "canvas"

This is the most reusable thing in the repo for this family of features, and it is nowhere
written down. It is written down here.

**There is no server→client "open panel" message.** `sendCockpitMessage`
(`packages/backend/convex/cockpit.ts:77`) is a `tenantAction` whose declared return type is
`Promise<{ threadId: string }>` (`cockpit.ts:86`) and it returns exactly `{ threadId: tid }`
(`cockpit.ts:165`). The client learns nothing else from the call.

**Panels appear because a tool patches a row keyed by `(tenantId, threadId)`, and a card that
is already mounted holds a live `useQuery` on it.** The existing content-plane panel tables
follow one shape — `briefings`, `vaultSources`, `evaluations` — each with a
`by_thread` index on `["tenantId", "threadId"]`. The card self-reads its own data;
nothing pushes.

**Mount is one line, above the plan-status branches.** `CardList` in
`apps/web/app/(app)/dashboard/workspace/cards.tsx:1693-1704` renders `{trace}`, then
`<SourceCard threadId={threadId} />` (`:1698`) and `<EvaluationCard threadId={threadId} />`
(`:1701`), then `{rest()}`. The comment at `:1696-1697` states the rule verbatim: these render
*above* the plan-status branches because grounding happens on pure-advice turns with no plan
row, so a panel must not sit under any plan-status gate.

**A card interaction is an agent TURN, not a dead end.** `cockpit.ts:169-177` documents the
escape hatch: a `ResolutionCard` pick re-enters the tool loop as synthetic user text
(`RESOLUTION_CONTINUE`), stating the fact of the change and telling the agent to continue. The
UI does not mutate state behind the agent's back; it speaks to the agent.

**Therefore, a new "canvas" costs:** one table with a `by_thread` index + one card + one line
in `CardList`. Nothing more. That is the answer to "the right pane should show the page /
the workflow / the funnel live" for all three surfaces.

**Inline field editors are REJECTED.** A card with `<input>`s calling a `patchX` mutation
*while* agent tools patch the same row is two independent writers to one row — last-write-wins
and merge-conflict surface, built before anyone has complained. No existing card does this;
every card control (`PlanAttachments`, `ResolutionCard`'s picks) re-enters the agent loop
instead. Chat-only editing until someone measures the round-trip as a problem. The one
asymmetry worth preserving if editing is ever added: a field-level patch must not round-trip
the model, because `dailySpendCents` is deployment-wide (§5.2) and page-fiddling would eat it.

---

## 3. Decisions (binding)

No new phase is minted. No roadmap goal-line edit is a "phase deliverable" — the goal-line
edits below are one editing session on `.planning/ROADMAP.md`, not a plan and not a wave.

### 3.1 Agent-built landing pages → Phase 18, as an output FORMAT

Phase 18's goal already covers this verbatim: "standalone documents and content artifacts
(beyond email attachments) as governed, vault-stored outputs" (`.planning/ROADMAP.md:702`),
and its SC2 already states the gate rule (`:707`).

- **The change is four string literals.** `renderAndStore` hardcodes `"application/pdf"` at
  `packages/backend/convex/llm.ts:948` and `:952`; `buildDocFilename` hardcodes `.pdf` at
  `packages/core/src/documentGen.ts:173` and `:177`. Parameterize the format and the existing
  path (PII scan → registry-loaded drafter → render → byte cap → `ctx.storage.store` →
  ref-only return) yields a self-contained downloadable HTML page with zero new tables, zero
  new routes and zero new governance surface.
- **The vault grounds it for free.** `packages/vault/src/sniff.ts:124-125` already lists
  `text/html` on the markup extraction rail (`MARKUP_MIME`).
- **The agent authors a structured `PageSpec`; CODE renders the HTML.** This is the
  `documentGen.ts` → `markdownToPdf` split repeated. It is the only thing standing between
  "generated page" and "attacker-controllable script served from our own deployment domain",
  and it must be protected by an escaping test, never by a prompt. Model-authored strings must
  never become markup — make that a Phase 18 success criterion.
- **Preview is an `<iframe>` with a bare `sandbox` attribute** (no allow-tokens) rendering
  `srcDoc` from the SAME renderer used at export time. `sandbox` is a native platform feature;
  it is the entire security model of the preview. The card mounts per §2.
- **Phase 18 must also name where a created artifact is SEEN.** The Output card is already
  specified in `docs/design/BRAND.md` (titled card, UPPERCASE type badge, "Synced to workspace
  history" subline) and is unimplemented. That silence is why this looked unplanned.
- **Publishing is post-beta** (§6), and the CTA in v1 is a `mailto:`, a booking URL or a phone
  number — three fields on the spec, zero backend.

Do not call it a canvas in the roadmap: Phase 20 already owns that word
(`.planning/ROADMAP.md:721`), and "live artifact preview" describes what is actually built.

### 3.2 Workflow / automation generator → a routine is a skill body plus a trigger row

**A routine is NOT a graph DSL.** Serializing an automation as bespoke node-graph JSON creates
a second executable plane outside the versioned, eval-gated `skills` registry — un-versioned,
un-rollbackable, un-gated. It contradicts CLAUDE.md §5 and forfeits the entire Phase 21/23
security model, which is already implemented in `packages/backend/convex/skills.ts`.

- **Pre-beta deliverable: a re-runnable pinned prompt.** Save a chat message; re-fire it at
  `api.cockpit.sendCockpitMessage` (`cockpit.ts:77`). That is localStorage plus a button. It
  answers the only question worth asking — does anyone re-run anything? — and it produces the
  evidence `.planning/PROJECT.md:51-53` demands before a feature may enter the roadmap
  (the Validated section reads "(None yet — ship to validate)" at `PROJECT.md:49`).
- **Phase 21's goal line gains the words "and routines"** — a one-line edit to
  `.planning/ROADMAP.md:733`. Nothing else about Phase 21 changes.
- **The run view is already built.** `agentSteps` + the VERB map
  (`schema.ts:457-521`; `cards.tsx:1139-1178`) is the node-execution visualization users
  actually want from a workflow product. Ship that, and most canvas demand evaporates.
- **If a routines table is ever built** (post-beta, evidence-gated — §6): one table, one cron
  line on the `proactiveReview` fan-out shape, one card, one authoring form. A routine run
  PROPOSES: it stages into the thread's single `plans` row and stops at `proposed`.
  `executePlan` stays a `tenantMutation` absent from every tool record. Recurrence grammar
  stays a closed set (daily / weekly+dayOfWeek / monthly) — a cron-string parser is a
  dependency this repo does not need.

### 3.3 Funnels → Phase 19 absorbs the person store; the funnel itself is post-beta

- **Phase 19 (existing, "Contacts, CRM & Follow-ups", `.planning/ROADMAP.md:711-719`) widens**
  to carry an `origin` discriminator (mailbox-resolved vs self-submitted), a consent record
  (§5.4), and `unsubscribedAt`. This is the single best merge available: it prevents building
  the person store twice.
- **The suppression guard lives in the SEND path, not in a funnel module.** See §5.1 — this is
  the most important correction in the whole review.
- **Phase 19 must state in writing why this does not violate "no contacts cache at rest"**
  (`packages/backend/convex/schema.ts:210-211`). That invariant governs transient
  mailbox-search *candidates* — data the tenant never asked for, harvested from headers, wiped
  on pick. A consented first-party row is a different data class. Without that sentence a
  future reader either deletes the table or quietly relaxes the invariant; both are bad.
- **Funnel v0 is link-only and post-beta.** One `httpAction`: unguessable token → increment
  three integers on a funnel row (visits / claims / downloads) → 302 to
  `ctx.storage.getUrl(...)`. Source attribution via `?s=` on the same link. No form, no leads
  table, no public write, no middleware widening, no Next route. It answers "does anyone
  click" at a fraction of the cost, and produces the Validated-line evidence the form version
  requires before it is admissible.
- **The conversion signal is already in the mailbox.** `listInbox`/`briefInbox` already read
  the connected inbox under the toolless-ingestion invariant; matching an inbound From against
  the contacts table is a real conversion signal with no pixel and no click rewriting.

### 3.4 Configurations / Integrations → a button, not a page

- **The Disconnect button goes on the EXISTING `/connect-gmail` page.**
  `apps/web/app/privacy/page.tsx:312` states "You can disconnect your Google account at any
  time from within the application." No such control exists — a repo-wide search finds zero
  calls to Google's revoke endpoint and no token-delete mutation outside `store`'s
  delete-then-insert. **This is a published legal claim that is currently false**, and it is
  the only genuinely urgent item across all four capabilities. It belongs in the already-
  inserted Phase 22.1, whose Goal is literally "[Urgent work - to be planned]"
  (`.planning/ROADMAP.md:761-763`) and whose title already names "legal … and identity-boundary
  hardening".
  Shape: one `tenantMutation` deleting the `gmailTokens` row + one `"use node"` internalAction
  POSTing the refresh token to `https://oauth2.googleapis.com/revoke` (delete-only leaves the
  grant alive at Google) + one refs-only audit row. Fix the hardcoded hexes on that page in the
  same pass (CLAUDE.md §10). Note the `"use node"` rule: a node module may contain ONLY actions.
- **The connections PAGE comes with the second provider, in Phase 25.** An aggregator over one
  item is not a page. Phase 25 SC#5 (`.planning/ROADMAP.md:799`) already promises Outlook
  "through the same provider-agnostic adapter that serves Gmail" — that adapter does not
  exist. Correct the SC text to admit it, and build it in the same commit as the Microsoft
  Graph adapter: an optional `provider` column (absent ⇒ `"google"`, the migration-free
  widening idiom documented at `packages/core/src/actionType.ts:11-13`), a
  `by_tenant_provider` index, and one `Record<Provider, {...}>` const. Not before.
- **Connections are TENANT data, not owner config** — `tenantQuery`/`tenantMutation`, never
  `ownerQuery`. The owner boundary belongs to platform config, which lives on `/ops`.
- **MCP: expose, do not consume.** A user-supplied MCP client is a runtime-mutable tool set,
  which collides head-on with ADR-007 (a specialist's tool-set is code-owned, never
  DB-writable) and with the closed `agentSteps.tool` union (§1.4). Phase 20's MCP client stays
  single-purpose. A2A/MCP-server exposure stays on the v2 shelf.
- **Rule for credentials: only store what you can scope and revoke.** API keys and PATs (most
  CRMs, "external databases") have no callback, no refresh, no scope and usually no
  per-integration revocation. A wall of pasted un-scopeable secrets against a plaintext column
  is a materially worse risk class than one revocable OAuth grant.

---

## 4. Rejected scope, and why

This is the highest-value section in the document. Each item was proposed, examined, and
refused. Do not re-propose without new evidence.

1. **The whole Phase 18 + 18.1 package** — a `sites` table, `PageSpec`/`renderPageHtml` as a
   phase-scale deliverable, a `SiteCard` with field editors, a new `plans.kind` literal, a new
   `ACTION_TYPES` member + arm re-bind + `executePlan` case, a public `httpAction`, a
   `by_slug` index, `unpublishSite`, a guard test file, a playbook and an ADR. **Why:** a
   subsystem for a capability with zero validated demand, for a milestone with eight unstarted
   phases and a beta days away. **Instead:** the four-literal format parameterization of §3.1.
2. **A new `ACTION_TYPES` member + `_ARM_TABLE` re-bind + `executePlan` case just to publish a
   page.** **Why:** the Approve gate exists to gate what the AGENT proposes; `executePlan` is a
   `tenantMutation` absent from every tool record. A Publish button on a card is already a
   human-gated mutation with identical safety properties. It also silently overrides
   `packages/core/src/actionType.ts:30-31`, which pre-commits Phase 18 to the `externalAction`
   arm, without superseding that written decision. **Instead:** publish and unpublish are both
   plain `tenantMutation`s, if and when publishing exists at all.
3. **Inline `<input>`/`<textarea>` field editors on a card that agent tools also patch.**
   **Why:** two writers, one row, last-write-wins — built before anyone complained. **Instead:**
   chat-only editing through the existing tool loop and the §2 re-entry escape hatch.
4. **Reserving an optional `heroStorageId` column "so Phase 20 needs no schema edit".**
   **Why:** a column for an unbuilt phase's unbuilt feature. Optional-field widening is already
   a zero-migration operation here (`actionType.ts:11-13`), so the reservation buys nothing.
   **Instead:** Phase 20 adds its own column when it exists.
5. **A `routines` table + `routines.ts` + a cron line + an authoring form + a `RoutineRunCard`
   pre-beta.** **Why:** speculative; nothing indicates anyone re-runs anything, because there
   are no users. **Instead:** the pinned-prompt v0 of §3.2.
6. **A "Scoped Grants / approve-once-for-many" phase.** **Why:** explicitly conditioned on beta
   evidence that cannot exist because the beta has not opened; adding it to the roadmap now is
   the admission-rule breach `PROJECT.md:51-53` forbids. **Instead:** leave it as deferred
   capability #2/#3 (§6).
7. **The full funnel phase** — `funnels` + `funnelEvents` tables, an optional `funnelId` column
   on plans, three or four public `httpAction`s, a public Next route + a middleware allowlist
   widening, `funnels.ts`, `funnelFollowup.ts`, a cron line, a NotificationKind, a `FunnelCard`,
   an ADR and a playbook. **Why:** the largest single proposal, introducing BOTH the product's
   first unauthenticated read and its first unauthenticated write, for a capability with zero
   requirement id, zero roadmap phase and zero validated demand. **Instead:** the link-only v0
   of §3.3.
8. **The `funnelEvents` append-only event table.** **Why:** it would be the first content-plane
   analytics table in a system that deliberately has no event plane (`agentSteps` structurally
   cannot hold text, `schema.ts:452-456`; audit is refs-only; telemetry is one row per
   request). For a solopreneur with tens of leads it answers questions nobody has asked.
   **Instead:** three integer columns incremented in the `httpAction`. Add the event table when
   someone asks "which day".
9. **A new `/dashboard/connections` route + NAV entry + page chrome to list one connection.**
   **Why:** an aggregator over a single item, and the proposal planned to delete
   `/connect-gmail` afterwards — so it is a rewrite, not a fix, and the urgent part is ~40 of
   its ~120 lines. **Instead:** §3.4.
10. **A `PROVIDERS` lookup const + `provider` column + `by_tenant_provider` index built now.**
    **Why:** correct in shape, but it is not a new proposal — it is what Phase 25 SC#5 already
    requires, and building the lookup before Outlook is being written is an abstraction with
    one implementation. **Instead:** write it in the same commit as the Microsoft Graph adapter.
11. **"Amend the goal text of Phase 18 / 19 / 21" framed as a phase deliverable.** **Why:** it
    inflates four proposals into seven phases. **Instead:** one editing session on
    `.planning/ROADMAP.md`.

Also rejected on sight, and worth naming so they are not re-invented: a Vercel/Netlify deploy
integration (a second OAuth plane in a system with plaintext tokens — `schema.ts:625-632` — and
no revocation path); a markdown or rich-text renderer; a page builder; open/click pixels (a
consent surface and a PII honeypot); auto-publishing to social, which
`.planning/research/FEATURES.md:179` lists as an explicit anti-feature that would have to be
superseded in writing first.

---

## 5. Cross-cutting prerequisites

Each of these is independent of which capability ships. Each names its home phase.

### 5.1 Suppression must live in the SEND path — Phase 19

An `unsubscribedAt` column on a contacts row, with the check inside a funnel module, is a lie.
The ordinary cockpit send path takes a raw address array on `plans.recipients`
(`packages/backend/convex/schema.ts:189`) resolved from Gmail headers — it never touches the
contacts table. The moment a user types an unsubscribed person's name in chat, the unsubscribe
is bypassed. The check must be a guard inside `executePlan`/`startFanout` against every target
address — the one place all sends converge — and it must be proven by a test, not by
convention. **Home: Phase 19, same commit as the column.**

### 5.2 Per-tenant budget keying — Phase 22.1, second wave

`dailySpendCents` is a KEYLESS rate-limiter window that caps the DEPLOYMENT, not the tenant.
The `ponytail:` comment at `packages/backend/convex/guardrails.ts:182-185` says so explicitly
and already names keying by `tenantId` as the upgrade path. `dispatch.ts:41-45` inherits the
same shared pool and derives `ENVELOPE_FRACTION = 0.25` (`dispatch.ts:45`) as 25% of it. With
one owner this is invisible. The moment Phase 25 admits a second user, one user's
page-fiddling, routine or research dispatch drains everyone else's day and every other tenant
sees governed refusals they cannot explain. It is small, mechanical, and it makes Phase 20
(whose "separate capped budget line" has nothing to cap against), Phase 21 and Phase 25 cheaper
at once. **This is the highest-leverage item in the whole review and none of the four proposals
scheduled it. Home: Phase 22.1.**

### 5.3 CAN-SPAM's physical postal address has no home in the schema — Phase 19

Every commercial email needs a valid physical postal address in the body. `tenantProfiles`
(`packages/backend/convex/schema.ts:847`) has no address field and the blueprint spine has
none. Any cold-outreach or nurture feature is non-compliant on day one for a US recipient. The
fix is a profile field plus a footer the drafter cannot omit — cheap now, awkward retrofitted
into a registry skill body later. **Home: Phase 19.**

### 5.4 GDPR lawful basis at capture — Phase 19 (decide before capture exists)

A `consentSource: string` is not a consent record. What is required is the exact wording shown,
the timestamp, the IP-or-equivalent, and the ability to reproduce it on request. None of that
may go in `audit` (refs-only, CLAUDE.md §4), so it needs a content-plane column set decided up
front. **Home: Phase 19, decided before any capture surface is designed.**

### 5.5 Sender reputation — nurture from a personal Gmail is a product-destroying risk

Google's bulk-sender rules apply to the sending address. A spam-complaint rate above ~0.3%
degrades the *user's own* mailbox, not Pikar's. A per-day recipient cap must be a success
criterion of any nurture work, enforced on the already-installed rate limiter rather than in
application code (20/day matches the solopreneur persona). The alternative that actually solves
it — send from a Pikar-owned domain with the user's address as reply-to — is a larger decision
that must be made *before*, not after, someone's account is restricted. **Home: Phase 19 (cap);
owner decision (domain).**

### 5.6 Idempotency of anything unattended — wherever unattended work lands

The repo solved this exactly once: `eventIdFor(planId)` in `packages/core/src/calendar.ts:57`,
consumed at `packages/backend/convex/calendar.ts:235`, where a 409 duplicate IS success. No
proposal carried that discipline across. A cron retry, a redeploy staging two plans, a tracked
download double-counting on a browser prefetch, a capture POST with no dedupe on
`(funnel, email)`, or a nurture email sending twice is the failure mode a beta user will never
forgive. **Every unattended path derives a deterministic key on the `eventIdFor` model.**

### 5.7 URL stability for anything published — Phase 25

All publishing designs serve from `*.convex.site` — the same host as the OAuth callback
(`packages/backend/convex/http.ts:15`) and the Convex Auth routes. Two consequences: a Safe
Browsing flag on that shared host breaks SIGN-IN, not just the page; and a Convex deployment
URL is deployment-scoped, so a link a user texted to a client does not survive a prod
migration. **A page URL that can break is worse than no page URL.** Nobody has costed a custom
domain, its DNS or its TLS. **Home: Phase 25, which owns the domain story — and it gates the
post-beta publish item in §6.**

### 5.8 The legal entity is the shared external blocker — non-code, unscheduled

`.planning/ROADMAP.md:86` already records that Google OAuth verification is DEFERRED because
submission is blocked on forming a legal entity ("Google's review reads a privacy policy that
must name a real data controller"). The same prerequisite gates LinkedIn's Marketing Developer
Platform, Meta Business Verification, a custom domain's registrant, CASA assessment, and
billing — simultaneously. So social posting is not "months of review": it is structurally
blocked behind an item already on the deferred list. Until the entity exists, Gmail Testing
mode's 7-day refresh-token lifetime (the reason `SEND_TIME_HORIZON_MS` is 7 days) caps every
nurture, schedule and automation these capabilities describe. **This is the highest-leverage
non-code task in the project and it is not on the roadmap.**

### 5.9 What a beta user needs on day one — unanswered by all four capabilities

Phase 25 SC#4 is "a first real delivered result within minutes" (`.planning/ROADMAP.md:798`).
Absent today and covered by none of the four: a working Disconnect (§3.4 — the privacy policy
is currently false), a visible remaining-budget indicator so a governed refusal reads as a
policy rather than a bug (`remainingDailyCents` at `guardrails.ts:187-191` already reads
utilization without consuming it — one read-only tile), and any way to see or undo what the
agent did outside the current thread. **Landing pages, routines and funnels are all week-two
features for a user who cannot yet disconnect their mailbox.**

### 5.10 Tenant data deletion and export — before any third-party PII is stored

A beta that stores third-party PII with no per-tenant delete path is a GDPR Art. 17 problem,
and the audit table is deliberately insert-only (CLAUDE.md §3) so "delete the tenant" is not a
trivial cascade. What happens to a tenant's vault, blueprint and audit rows when they leave is
undecided. **Decide before the first lead row exists.**

### 5.11 Deletion candidates — zero deletions were proposed across four capabilities

Under CLAUDE.md §8 (deletion over addition) that is itself a finding. The obvious candidates
nobody proposed: the retired-but-reachable `/requests`, `/review`, `/review/[id]` and `/submit`
routes (flagged at `apps/web/app/(app)/layout.tsx:35-36` — "the pages stay on disk and
reachable by URL"), and the `sub_agent` routing enum member that
`packages/backend/convex/pipeline.ts:215` aliases straight to `direct_llm` and that nothing
implements.

---

## 6. Deferred capabilities

Deferred to a later milestone, in the convention of
`.planning/design/agent-driven-cockpit.md:7-8`:

- **#2 campaign approval (approve-once-for-many)** and **#3 standing pre-authorized rules** —
  unchanged, still deferred, still the prerequisite for any unattended send. Their required
  shape is already fixed by `docs/decisions/004-agents-humans-peer-actors.md:56-58` and is NOT
  restated here: read the ADR. It is immutable; a different shape requires a superseding ADR,
  never an edit. Do not add either to the roadmap. The trap to refuse on sight: the moment a
  funnel or a routine exists, approve-once-for-many looks obvious and cheap. It is neither.
- **Publish a page to a real public URL** — post-beta, gated on the Phase-18 download version
  shipping and on someone actually complaining about the ~90 seconds of manual hosting, and on
  the Phase-25 custom-domain decision (§5.7). Publish and unpublish are plain `tenantMutation`s;
  no ActionType.
- **Funnel form + lead capture** — post-beta, after the link-only v0 (§3.3) produces click
  evidence, and after Phase 19's contacts + consent + the §5.1 send-path guard have landed.
- **Routines table + cron + authoring form** — post-beta, gated on evidence that anyone
  re-fired a pinned prompt twice. If nobody did, this phase never exists and a table, a cron, a
  card and a form were all avoided.
- **A `/dashboard/connections` (or `/dashboard/settings`) page** — arrives with the second
  provider in Phase 25.
- **Social posting** — blocked on the legal entity (§5.8) and on superseding the standing
  anti-feature line at `.planning/research/FEATURES.md:179` in writing.
- **MCP server exposure / A2A** — v2 shelf, gated on the scoped-grant machinery above. The
  MCP *client* stays single-purpose (Phase 20 media) and is not generalized.
- **Credential encryption at rest** — `gmailTokens` stores `refreshToken`/`accessToken`
  verbatim (`schema.ts:625-632`). Blast radius of fixing it later is two functions (`store`,
  `getTokens`). Mark it with a `ponytail:` comment naming the ceiling and the upgrade path
  (envelope-encrypt with a Convex-env master key) so `/ponytail-debt` harvests it, rather than
  letting it rot into "later means never".

---

## 7. Open questions for the owner

1. **Sending domain.** Do nurture/outreach sends go from the user's personal Gmail (their
   reputation, their risk — §5.5) or from a Pikar-owned domain with the user's address as
   reply-to (our reputation, our deliverability work, and a prerequisite for the legal entity)?
   This decision must precede any nurture feature, not follow it.
2. **The legal entity (§5.8).** Is forming it in progress? It simultaneously unblocks OAuth
   verification, custom domains, social APIs, CASA and billing, and it is not on the roadmap.
   Everything external stays capped until it exists.
3. **"Configurations" — connectors, or control?** The likely real ask is a place to see and
   change what the agent knows and is allowed to do. That is scattered across five surfaces
   today (deployment env, `/ops`, `/connect-gmail`, `/dashboard/profile` + onboarding, and a
   CLI-only guardrails kill switch). A settings page with three tabs composed from panels that
   already exist may be the better product and costs almost nothing. Confirm which was meant.
4. **Beta admission override.** `PROJECT.md:51-53` forbids a feature moving idea → roadmap
   phase without an evidence-backed Validated line, and `PROJECT.md:49` records "(None yet)".
   Every capability here is admitted only as a widening of an existing phase, which keeps the
   rule intact. Confirm that is the intent — anything more is an explicit owner override of the
   project's own admission rule, not a routine roadmap edit.
5. **Publishing appetite.** Is a downloadable self-contained `.html` (drag onto any static host,
   ~90 seconds) acceptable for the beta, or is a real hosted URL a hard requirement? The answer
   decides whether §5.7's custom-domain work is on the critical path.
