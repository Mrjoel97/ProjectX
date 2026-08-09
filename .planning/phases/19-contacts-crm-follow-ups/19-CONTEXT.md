# Phase 19: Contacts, CRM & Follow-ups - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

The ONE person store, built once. Tenant-scoped contacts and follow-ups that the agent READS
in-loop to resolve people and surface context, and WRITES only through the human Approve gate.
Carries the outreach legal obligations — `origin`, consent, `unsubscribedAt` — plus the suppression
guard in the SEND path, the CAN-SPAM postal address on `tenantProfiles`, a working unsubscribe
link, and a narrow connected Pipeline route.

**Fixed by prior decision, NOT reopened here:**
- No `opportunities` table, no stage enum, no `amountCents` anywhere (PIPE-01 contradiction
  resolved 2026-08-09 in favour of the requirement as written; the mockup's "Open opportunities"
  and "Pipeline value" tiles and its "Stage" column are already deleted from
  `docs/design/mockups/pending-pages.html:880`).
- Suppression is checked in `executePlan`/`startFanout` against `plans.recipients`, NOT in the
  contacts module (SC#5).
- `audit` carries refs/ids/counts only (CLAUDE.md §4); the consent record lives in the content plane.
- Pipeline's four tiles (contacts needing attention · follow-ups due · consent on record ·
  suppressed contacts) and five table columns (Contact · Origin · Last touch · Next step · Consent)
  come from the corrected mockup.
- The nav item stays `soon: true` (`apps/web/app/(app)/layout.tsx:49`) until 26-18 flips it.

</domain>

<decisions>
## Implementation Decisions

### Schema shape — THREE tables, not two

**The ROADMAP resolution note says "two new tables: `contacts` and `followUps`". That is now
superseded: there are THREE.** A separate address-keyed `suppressions` table was chosen
deliberately (see *Suppression storage* below). **The planner must not "correct" this back to two.**

### How contacts get created

- **Explicit acts ONLY.** A contact row exists because someone deliberately made it: the user typed
  it, the agent staged an add through the Approve gate, or (later) a Phase 31 lead form captured it.
- **Gmail header resolution NEVER writes a contact row.** `plans.candidates` stays transient and
  wiped-on-pick exactly as today (`schema.ts:203-211`).
- **This IS the SC#7 argument.** The "no contacts cache at rest" invariant survives because nothing
  accretes without a human act — there is no cache, only a deliberate record. The playbook states
  this in these terms.
- **Identity = lowercased email address. One row per address.** Same key the send-path guard uses
  against `plans.recipients` (a raw address array), so the guard and the contact row agree by
  construction. A person with two addresses is two contacts; person-level merging is deferred.
- **Email is REQUIRED. Name is OPTIONAL.** No name-only contacts. The Pipeline table falls back to
  the address when no name is known, so saving from a resolution card never blocks on data Gmail
  did not provide.
- **`origin` records the PROVENANCE OF THE DATA, not who triggered the write.** Three values as
  SC#4 requires:
  - `mailbox-resolved` — the user saved this person FROM an agent resolution card (the address came
    out of Gmail headers; a human pressed save)
  - `user-entered` — typed from scratch
  - `inbound` — arrived via a Phase 31 lead form (not written in this phase)

### Suppression storage and deletion

- **A separate tenant-scoped `suppressions` table, keyed by lowercased address.**
  `contacts.unsubscribedAt` is a convenience MIRROR for display only.
- **The send-path guard reads ONLY the `suppressions` table and never touches `contacts`.** This is
  what makes SC#5 structurally clean: a contacts bug cannot un-suppress anyone, and contact
  deletion is a non-event for the guard.
- **Suppression outlives the contact.** Deleting a contact must never restore the ability to email
  someone who asked you to stop.
- **Reversal is possible but deliberate.** Un-suppressing is behind an explicit confirm that states
  re-subscribing without fresh consent is the user's responsibility, and it writes an audit row
  (refs-only). Not a plain toggle.

### Consent record (SC#4)

- **`consentAt` / `consentSource` are OPTIONAL and stay EMPTY when no consent event occurred.** The
  Pipeline "Consent" cell then reads *"none on record"* — the truth. Nothing is defaulted to
  consented.
- **A user CAN explicitly assert consent** ("they signed up at the trade show"). That records the
  assertion, its timestamp, and the user's free-text context under source `asserted-by-user`.
- **The reproducible-wording machinery is BUILT AND EXERCISED by that path** — same shape Phase 31
  will later write real captured wording into. It does not ship unused.
- Consent detail lives in the content plane, never in `audit` (CLAUDE.md §4).

### What a follow-up is

- **Bound to a contact OPTIONALLY.** Free-standing follow-ups are allowed ("chase the supplier
  quote").
- **Due date is REQUIRED.** No date, no follow-up — "Follow-ups due" is a headline tile and an
  undated follow-up could never appear in it.
- **States: `open` / `done` / `canceled`.** No snooze state — moving the due date IS the snooze,
  leaving the date as the single source of truth for "due". `canceled` is distinct from `done`
  because "I decided not to" and "I did it" are different facts.
- **An optional provenance ref** (plan / message id) so "why is this here" is answerable later. It
  is an id — refs-only, audit-safe by construction. Optional ⇒ no migration.
- **The AGENT must always name a contact.** Contactless follow-ups are a USER-only capability. This
  is the structural brake against the CRM quietly becoming a general task generator (a different
  product, a different phase).

### How CRM writes reach the Approve gate

- **A FIFTH `ACTION_TYPES` member: `crm_write`, arm = `inline`.**
- **`packages/core/src/actionType.ts:36-38` IS STALE AND MUST BE CORRECTED IN THE SAME COMMIT.** It
  currently predicts *"Phases 18 (document creation) and 19 (CRM writes) are the same mechanism —
  one governed external side effect driven by the retrier, not a DB write"*. That was written when
  "CRM" plausibly meant writing to somebody ELSE's CRM. Phase 19 builds OUR OWN `contacts` table, so
  an add is *"a single transactional write"* — that same file's definition of the `inline` arm
  (memo's arm). Supporting evidence the prediction already failed: `ACTION_TYPES` is still four
  members and `plans.kind` is still `memo | calendar_event | media`, so Phase 18 did not take that
  path either.
- Adding the member is a deliberate COMPILE error at both arm tables
  (`packages/core/src/actionType.ts` `ARMS`, `packages/backend/convex/cockpit.ts:563` `_ARM_TABLE`)
  — that is the guarantee the machinery was built for. Do not route around it.
- **The user sees its own PLAN card** in the workspace right pane and a row in Approvals, showing
  exactly what will be written. One Approve story, not five.
- **ONE plan carries a LIST of operations, applied atomically.** 2 contacts + 3 follow-ups from one
  conversation = one card, approve-all-or-none. Mirrors how an email plan carries many recipients.
  No per-row opt-out UI in this phase.
- **Receipt = the existing plan lifecycle.** The plan reaches `done` and Pipeline reflects it. No
  new receipt concept, no chat confirmation message that can disagree with the database.

### The ACTOR rule (gating)

**The ACTOR decides whether something is gated, not the operation.**
- Agent-proposed writes — create, complete or cancel — ALWAYS stage through the plan gate.
- Direct user edits on the Pipeline page are ungated. A human marking their own follow-up done is
  not an agent act; gating it is friction with no safety payoff.

### In-loop resolution precedence

- **Contacts FIRST, Gmail headers as fallback.** A saved contact is a deliberate human statement
  about who someone is; a header match is an inference. Falls back to the existing
  candidates/resolution card when there is no saved match.
- This is also the reason a user would bother saving a contact: it visibly makes the agent faster.

### Pipeline page behaviour

- **"Contacts needing attention" = contacts with NO open follow-up.** Deliberately COMPLEMENTARY to
  the "Follow-ups due" tile rather than a restatement of it (an overdue-based definition would make
  two adjacent tiles report nearly the same fact). Requires no invented staleness threshold — it is
  derived purely from data the user created. The two tiles answer "what's owed" and "what's unowned".
- **"Last touch" = delivered outbound sends PLUS completed follow-ups.** All local, durable data —
  no Gmail call at page render. Counting completed follow-ups means off-channel contact ("called her
  Tuesday") registers, and it rewards using the feature.
- **"Follow-ups due" tile counts contactless follow-ups too** — one honest total, no asterisk.
- **Contactless follow-ups render in their OWN section beneath the table**, not as em-dash rows
  inside it. The contact table stays one-row-per-person exactly as the mockup has it.
- **Row actions: read + mark suppressed + add follow-up.** Marking suppressed is honoured by the
  send guard immediately. Full inline contact editing is NOT in this phase.
- **Empty state: tiles show `0`** — a real zero is stated as zero, never `—` and never `Unknown`
  (the 26-10 lesson) — and the empty table is replaced by a short explanation of what the page
  becomes plus ONE action: add your first contact. No seeded suggestions from recent mail (that
  would read the mailbox to propose contacts, brushing against explicit-only creation).

### Send-path guard behaviour

- **Per-address, not plan-level.** With 5 recipients and 1 suppressed: drop the suppressed address,
  send to the other 4, and TELL the user which addresses were withheld and why. The fan-out is
  already per-recipient (`requests` rows seeded per address), so dropping one is natural rather than
  special-cased. Reads SC#5's "address-by-address" literally.
- The guard stays in the send path even though an approve-time check would be nicer UX — an
  approve-time check alone is bypassable by the scheduled-send path (03.5).

### CAN-SPAM footer and the unsubscribe link

- **EVERY send carries both the postal address and the unsubscribe link.** One code path, one test,
  and SC#6's "the drafter cannot omit it" becomes true BY CONSTRUCTION rather than by a classifier
  being right. No "is this commercial?" judgement to get wrong.
- **A tenant with no postal address set CANNOT SEND.** Fail closed, naming the missing field and
  pointing at the profile surface. A footer rendering an empty address looks compliant and isn't —
  worse than no footer. Matches how the codebase already treats unknown models and missing config.
  This does NOT become a required onboarding field (Phase 11 deliberately admits idea-stage users
  with almost nothing filled in — that decision is not reopened).
- **The link opens a LANDING PAGE with a confirm button; suppression happens on an explicit POST.**
  A bare GET would be fired by corporate mail scanners and link prefetchers, silently unsubscribing
  people who never clicked. The confirm button is what stops the feature firing itself.
- **HMAC path segment for the token** — sign tenant+address with a deployment secret, reusing the
  pattern already shipped and proven for the fal webhook in Phase 20-06 (`convex/http.ts`).
  Stateless: no token table, no expiry bookkeeping, nothing to clean up.
- This is **the phase's only public unauthenticated route.** It needs its own abuse/rate
  consideration at planning time.

### Claude's Discretion

- Exact table/index shapes, field names and validators (subject to the three-table decision above).
- Where the postal-address field lives on the profile surface and its input validation.
- Which plan owns the `actionType.ts` comment correction (it must be the one adding `crm_write`).
- Pagination/window bounds on the Pipeline read models (26-01's shared contracts govern).
- Copy and layout details within the BRAND tokens (`docs/design/BRAND.md`).
- Whether the RFC 8058 `List-Unsubscribe` headers ship alongside the landing page or are deferred —
  the landing page is the committed deliverable.

</decisions>

<specifics>
## Specific Ideas

- **"The written requirement wins over an unbuilt mockup."** Already applied to the two deleted
  tiles; it is the tie-breaker for any further mockup/requirement conflict in this phase.
- **The near-duplicate-tile test.** Two tiles sitting next to each other must not report almost the
  same fact. That is what drove "needing attention" to mean *unowned* rather than *overdue*.
- **A real zero is stated as zero.** Direct carry-over from the 26-10 UAT defect, where a page
  rendered `Unknown` above a series showing real spend on the same screen.
- **Fail-closed on missing config** — the postal-address refusal follows `chooseModel`'s
  unknown-model precedent.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/core/src/actionType.ts`** — `ACTION_TYPES`, `actionTypeOf`, `armFor`, the `ARMS`
  `satisfies Record<ActionType, Arm>` bind. Adding `crm_write` here is a compile error until its arm
  is decided. **Its doc comment at lines 36-38 contains a stale prediction about Phase 19 that this
  phase must correct.**
- **`packages/backend/convex/cockpit.ts:563` `_ARM_TABLE`** — the dispatcher's own arm bind, separate
  on purpose so a new type cannot silently inherit the EMAIL fan-out terminal. `EXTERNAL_TARGETS` is
  DERIVED from it, so an `inline` classification correctly requires no target entry.
- **The `memo` arm** — the existing `inline` occupant and the exact template for `crm_write`: a
  single transactional write inside `executePlan`, no workflow, no retrier, no fetch.
- **`plans.candidates` / `pendingValid` / `recipientNames` (`schema.ts:203-235`)** — the transient
  content-plane resolution store, wiped on pick. The contacts-first resolution path plugs in ahead
  of this, and its wipe-on-pick behaviour is UNCHANGED (that is what preserves the invariant).
- **`convex/http.ts` HMAC path-segment pattern (Phase 20-06 fal webhook)** — reuse verbatim for the
  unsubscribe token. Proven, stateless, already live.
- **`requests` rows / `startFanout` per-recipient seeding** — the per-address drop for suppressed
  recipients rides this existing shape rather than adding plan-level branching.
- **26-01 shared dashboard contracts** — tenant/owner authorization, bounded pagination and time
  windows, honest loading/empty/partial/error states. The Pipeline route consumes these; it does not
  invent its own.
- **`docs/design/mockups/pending-pages.html:863-905`** — the corrected Pipeline section: four tiles,
  five columns, and the two gravestone notes explaining what was removed and why.

### Established Patterns
- **Tenant-scoped wrappers only** (CLAUDE.md §2) — no raw `query`/`mutation`/`action` imports. The
  new tables' functions go through `convex/lib/functions.ts`.
- **Domain logic in `packages/*`, `convex/` as a thin adapter** (CLAUDE.md §1) — the suppression
  check, the "needing attention" predicate and the follow-up due logic are pure TS, testable without
  Convex.
- **Audit is insert-only and refs-only** (CLAUDE.md §3, §4) — the un-suppress audit row and the CRM
  write audit rows carry ids/counts, never addresses or note text.
- **All-optional new fields ⇒ no migration** — the `tenantProfiles` postal-address field follows the
  established precedent stated in that table's own comment (`schema.ts:1190-1196`).

### Integration Points
- **`tenantProfiles`** gains the postal-address field; `/dashboard/profile` is the enrichment surface
  (Phase 11 precedent).
- **`executePlan` / `startFanout`** gain the suppression guard — the SC#5 trust boundary, with a test
  that proves it THERE.
- **The drafter** gains the un-omittable footer and the missing-address refusal.
- **A new `/dashboard/pipeline` route**, connected but with nav still `soon: true` until 26-18.
- **A new public unauthenticated unsubscribe route** — the phase's only one.

### Serialization constraint — the GATED_SKILLS candidate stream
Teaching `cockpit-agent` the new contacts/follow-up tools edits a body that is in `GATED_SKILLS`
(`packages/backend/convex/skills.ts:22,207`) with ONE candidate stream. **18-08, 20-12 and 20.1-01
already contend for that same body**, and a concurrent edit mints a candidate carrying two lanes'
prose that the next eval would certify untested. The cockpit-body plan for Phase 19 must be
scheduled against those, exactly as 20.1 was. Also note the live-DB version-collision gotcha:
optimizer dry-run candidates occupy versions, so verify which version carries your body before any
eval or activate.

</code_context>

<deferred>
## Deferred Ideas

- **Person-level contact merging** — one person holding N addresses, with suppression applying to
  the person or a single address. Ships as one-row-per-address now; merging is a later phase.
- **Full inline contact editing on the Pipeline table** — this phase ships read + suppress + add
  follow-up only.
- **Per-row opt-out inside a multi-operation CRM plan card** — approve-all-or-none for now.
- **Contact deletion / GDPR erasure** — not addressed beyond "suppression outlives the contact".
- **Seeded contact suggestions from recent mail** on the empty state — attractive onboarding, but it
  reads the mailbox to propose contacts and needs care to stay on the right side of explicit-only
  creation.
- **RFC 8058 `List-Unsubscribe` headers** for native Gmail/Outlook unsubscribe controls — better
  deliverability posture, additional POST endpoint. Landing page ships first.
- **Deal stages / opportunities / monetary pipeline value** — explicitly forbidden by PIPE-01 and
  SC#8. Real money arrives with Phase 28's connector-backed Cash surface, from observed provider
  data rather than typed guesses. Reopening this is an amendment to PIPE-01, and the mockup's own
  note warns that retrofitting stages onto a committed schema is the expensive order.

</deferred>

---

*Phase: 19-contacts-crm-follow-ups*
*Context gathered: 2026-08-09*
