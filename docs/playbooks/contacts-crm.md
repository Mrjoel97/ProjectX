# Playbook: Contacts, CRM & follow-ups

> Last verified: 2026-08-09 (Plan 19-07 — **the Pipeline page is CONNECTED, and this module has
> public READS for the first time.** `pipelineTiles`, `listContacts` and `listUnassignedFollowUps`
> land here rather than in a second store, which is PIPE-01 satisfied by construction. Invariant 3
> stopped being a promise and became a component test; invariant 14 below is new and records the
> "last touch" ceiling. The nav item is deliberately STILL `soon: true` — 26-18 flips it.)
>
> Previously verified: 2026-08-09 (Plan 19-06 — **the agent WRITE path exists: `crm_write` is the fifth
> `ACTION_TYPES` member, on the `inline` arm.** Invariant 11's ACTOR rule stopped being prose and
> became enforced code, and invariant 13 below is new. `contacts.ts` was refactored so the write
> rule has exactly ONE implementation.)
>
> Previously verified: 2026-08-09 (Plan 19-05 — the send path consumes this module: invariant 12 below,
> and the "Touching the send path" note is now describing shipped code rather than a plan)
>
> Previously verified: 2026-08-09 (Plan 19-04 — the public unsubscribe route)
>
> Previously verified: 2026-08-09 (Plan 19-02 — the person store, isolation assertion, audit key-set pin)
>
> Previously verified: 2026-08-09 (a foreign lane's watch-gate bump over this file's in-progress
> state — not a content review; superseded by the line above)
> Previously verified: 2026-08-09 (Plan 19-01 — pure core, three tables, playbook created)
> Build history: `.planning/phases/19-contacts-crm-follow-ups/` · Related ADRs: none

## Purpose

The ONE person store. A tenant-scoped record of the people the business deals with, what is owed to
each of them and by when, plus the outreach obligations that come with emailing them at all:
provenance, consent, a working unsubscribe, and a suppression list the send path cannot route
around. The agent READS it in-loop to resolve people faster than a mailbox search can, and WRITES
to it only through the human Approve gate.

It exists because everything before it was transient. Gmail header resolution produced candidates
that were wiped on pick, so the second time you emailed the same person the system knew nothing
about them — and there was nowhere to record that someone had asked to stop being emailed.

## Key files

**Pure packages (framework-agnostic, CLAUDE.md §1)**
- `packages/core/src/contacts.ts` — `normalizeAddress` (the identity function), `needsAttention`,
  `followUpIsDue`, `renderFooter`, and (19-06) `CrmOperation` + `parseCrmOperations` — the pure
  contract of a `crm_write` plan's operation list, run at BOTH the write and the apply boundary and
  idempotent over its own output so the second parse cannot refuse what the first accepted.
  No Convex import, plain `string` ids and refs.
- `packages/core/src/contacts.test.ts` — boundary tests for all four, including the idempotence
  table that keeps the suppressions key byte-stable.

**Backend**
- `packages/backend/convex/schema.ts` — the `contacts`, `followUps` and `suppressions` tables and
  `tenantProfiles.postalAddress`. The comments there are the contract, not decoration.
- `packages/backend/convex/contacts.ts` — the thin Convex adapter (tenant wrappers only,
  CLAUDE.md §2). Six public writes: `upsertContact`, `assertConsent`, `markSuppressed`,
  `unsuppress`, `createFollowUp`, `setFollowUpStatus`. Five internals the rest of the phase
  consumes: `isSuppressed`, `suppressedAmong`, `footerFor`, `resolveUnsubToken`,
  `suppressFromUnsubscribe`. Plus (19-06) the three SHARED write helpers `upsertContactRow` /
  `createFollowUpRow` / `setFollowUpStatusRow` and the `applyCrmOperations` terminal that
  `cockpit.ts`'s `inline` arm calls — invariant 13. There are deliberately NO public reads here yet
  — CORRECTED in 19-07: the reads landed WITH THE PAGE, in this same module. Three public
  `tenantQuery` reads now sit at the bottom of the file — `pipelineTiles` (the four counts),
  `listContacts` (newest-first rows carrying `nextStep`, `consent`, `lastTouchAt` and the
  suppression mirror) and `listUnassignedFollowUps` — every one bounded by the 26-01
  `createDashboardBound` / `dashboardCursorFor` contract from `@pikar/core`, never a hand-rolled
  limit/offset pair. (No line numbers: they rot.)
- `packages/backend/convex/contacts.test.ts` — the BETA-05 isolation block over every public
  function by name, the runtime audit key-set assertion, and the no-opportunities structural scan.
  Its last two tests pin the EXPORT SETS, so a seventh public write added without an isolation
  test fails there rather than shipping unasserted.
- `packages/backend/convex/http.ts` — the two unsubscribe routes (19-04): the inert GET landing page
  and the confirm-only POST, both on `pathPrefix: "/unsubscribe/"`. Invariants 9 and 10 below;
  `cockpit.md` owns the file and carries the route-level entry.

**Frontend**
- `apps/web/app/(app)/dashboard/pipeline/` — the Pipeline page: four tiles, the contact table, the
  contactless-follow-ups section beneath it. `page.tsx` is five lines returning `<PipelineView />`;
  `PipelineView.tsx` is `"use client"` and holds the whole page, one `useQuery` PER SECTION so a
  single failing read cannot erase the rest; `pipelineView.test.ts` (**`.test.ts`, never `.test.tsx`
  — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` ONLY and a `.tsx` is silently skipped**)
  is the executable half of invariants 3 and 6.
- `apps/web/e2e/pipeline.spec.ts` — **owned by `dashboard-pages.md`**, not by this playbook.
  It is registered there and additionally covered by `cockpit.md`'s `apps/web/e2e/` prefix;
  registering it a third time here would make three playbooks claim one file.

## Dependencies & blast radius

Run `graphify query "contacts follow-ups suppressions"` for the current subgraph. Couplings the
graph cannot see:

- **The send path.** `executePlan` / `startFanout` (`cockpit.ts`) and `gmail.send` read
  `suppressions` per address. This is a runtime contract, not an import: the guard lives in the
  send path *on purpose*, because an approve-time check alone is bypassable by the scheduled-send
  path (03.5).
- **`tenantProfiles.postalAddress`** gates sending entirely. A tenant with no postal address cannot
  send — `renderFooter` throws. `/dashboard/profile` is the enrichment surface (Phase 11 precedent:
  it must never become a required onboarding field).
- **`UNSUBSCRIBE_SECRET`** signs the unsubscribe token (the `convex/http.ts` HMAC path-segment
  pattern proven by the Phase 20-06 fal webhook). Unset ⇒ the route fails closed.
- **`CONVEX_SITE_URL`** is the origin the unsubscribe URL is built from — the same origin `http.ts`
  serves. NOT `SITE_URL`: that is the Next app, which cannot serve this route.
- **`packages/core/src/actionType.ts`** — the `crm_write` action type and its `inline` arm.

## Data flow

1. **Create.** A human types a contact on the Pipeline page (ungated), or the agent proposes one
   and the user approves a `crm_write` plan. Either way the path is the same:
   **human act → `tenantMutation` (tenantId injected, never passed) → `normalizeAddress` →
   `by_tenant_email` upsert.** One address is one row; a blank address is refused at that boundary
   rather than collapsing every nameless save onto a `""` key.
2. **Resolve.** A cockpit turn naming a person checks `contacts` FIRST; only on a miss does it fall
   back to `resolveContacts` (`llm.ts`) and the existing Gmail candidates/resolution card.
3. **Follow up.** A `followUps` row carries a REQUIRED `dueAt`. `followUpIsDue(dueAt, now)` decides
   the tile; `needsAttention(contactId, openIds)` decides the complementary one.
4. **Send.** The drafter's body gets `renderFooter({ postalAddress, unsubscribeUrl })` appended —
   every send, no branch. `executePlan`/`startFanout` drop suppressed addresses per address and
   tell the user which were withheld.
5. **Unsubscribe.** The emailed link opens a landing page; an explicit POST (never the GET) writes
   a `suppressions` row and mirrors `contacts.unsubscribedAt` for display.

**The suppression path, end to end.** `markSuppressed` (user act) and `suppressFromUnsubscribe`
(the confirm POST) both route through ONE private `suppress()` helper → a `suppressions` row →
read back by `isSuppressed` / `suppressedAmong` and by NOTHING else. Two entry points, one
definition of what a suppression is, so the two can never disagree. Both are upserts: a replayed
unsubscribe link produces no second row and does not rewrite `suppressedAt` — the fact of record
is WHEN they asked to stop.

## Invariants — what must never break

**1. "no contacts cache at rest" still holds — a contact row is not a cache.**
`schema.ts` (`plans.candidates`) forbids a CACHE: data that accretes as a side effect of *reading
the mailbox*. A `contacts` row is not that. It exists ONLY because a human deliberately made it —
typed it, or approved a staged add through the plan gate. Nothing accretes. Concretely, all three
halves of the original invariant are unchanged: Gmail header resolution writes no contact row,
`clearCandidates` still wipes on pick, and `plans.candidates` / `pendingValid` never survive the
pick.
*Change safety:* any future code path that writes a contact row **without a human act** re-opens
the invariant and is forbidden. The way to prove it stays true is that **`resolveContacts`
(`llm.ts`) never calls a contacts write** — grep it before and after any change to the resolution
path. *Enforcement:* the structural half is a source-level obligation today, not an assertion; that
is a gap, stated here rather than hidden.

**2. The suppression split.**
The send-path guard reads `suppressions` ONLY and never `contacts`. `contacts.unsubscribedAt` is a
DISPLAY MIRROR. Consequences that are the whole point: a contacts bug cannot un-suppress anyone,
and deleting a contact is a non-event for the guard — suppression OUTLIVES the contact, because
deleting a contact must never restore the ability to email someone who asked you to stop.
Un-suppressing is possible but deliberate: `unsuppress` refuses unless `acknowledged === true`
(exact `true`, checked BEFORE any read, so a truthy non-boolean un-suppresses nobody). That flag is
the UI's explicit confirm that re-subscribing without fresh consent is the user's responsibility.
Never a plain toggle. It also writes the module's one refs-only audit row.
*Enforcement:* `contacts.test.ts` — "unsuppress WITHOUT acknowledged:true throws and leaves the
suppression intact" — plus the `gmail`/`cockpitTools` guard tests (19-VALIDATION rows 11-14).

**3. The four tiles are ALWAYS-KNOWN counts.**
Contacts and follow-ups have NO coverage-start concept — the substrate is created by the user, so
"we weren't watching then" cannot apply. Therefore a real zero renders as `0`: never `—`, never
`Unknown`. `Unknown` must not exist as a state on this page. This is carried over from the 26-10
UAT defect (commit `1a63992`) from the other side: there the fix was to stop printing a number the
system did not know; here the fix is to stop *hedging* a number it does know.
*Enforcement (19-07 — this stopped being a promise):*
`apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` renders the tiles with all four counts
at zero and asserts `">0<"` appears EXACTLY four times **and** that neither `—` nor `Unknown`
appears anywhere in the tile markup (19-VALIDATION row 19). The absence is asserted explicitly
because a tile that hedges still renders and still looks fine. The backend half is
`contacts.test.ts` — an EMPTY tenant returns `{0,0,0,0}` as real numbers, never null, never absent.

**4. Identity is `normalizeAddress`, and there is exactly one of it.**
Contacts, suppressions and the per-address send guard all key on the same function's output, which
is what makes "the guard and the contact row agree by construction" true rather than hoped for. It
is `trim().toLowerCase()` and nothing more — no plus-address stripping, no dot-folding, no
validation. Every write boundary in `contacts.ts` calls it; a local `.toLowerCase()` at a call site
is forbidden, because a second copy is a second chance for the guard and the contact row to
disagree about who someone is. *Enforcement:* the idempotence table in
`packages/core/src/contacts.test.ts`, and the one-row-per-address case in
`packages/backend/convex/contacts.test.ts` (`"Bob@X.com"` then `"  bob@x.com "` ⇒ ONE row).

**5. No stage, no opportunity, no money.**
No `opportunities` table, no stage enum, no `amountCents` — PIPE-01 and Phase 19 SC#8. Real money
arrives with Phase 28's connector-backed Cash surface, from observed provider data rather than
typed guesses. *Enforcement:* the structural scan in `packages/backend/convex/contacts.test.ts`
(19-VALIDATION row 20).

**6. Consent is never defaulted.**
`consentAt`/`consentSource` stay EMPTY when no consent event occurred, and the Pipeline cell reads
"none on record" — the truth. `consentWording` and `consentContext` are content plane: CLAUDE.md §4
means they MUST NEVER reach `audit.payload`, which carries refs/ids/counts only. `assertConsent`
also refuses blank wording: a consent record with no wording is a defaulted consent wearing a
timestamp. *Enforcement:* `contacts.test.ts` ("consent is never defaulted", "assertConsent refuses
blank wording").

**7. The ONE audit row this module writes has the key set `{contactId, addressHash}` — exactly.**
`unsuppress` is the only audit site in `contacts.ts`. `contactId` is `null` (never absent) when no
contact row exists, so the key set does not vary with the data; `correlationId` is the same hash,
never the address. Asserted by **key-set EQUALITY**, never a substring check — a substring check
passes on a payload that added a new leaky key.
*Enforcement:* the runtime assertion in `contacts.test.ts` (real audit row, `Object.keys().sort()`)
and the structural half in `llmRedaction.test.ts` — exactly one `internal.audit.log` site in the
module, its payload keys parsed depth-aware (`addressHash` ships as shorthand), and no
`address`/`email`/`wording`/`note` identifier anywhere in the call (19-VALIDATION row 10).

**8. `UNSUBSCRIBE_SECRET` fails closed, and is checked in exactly ONE place.**
The unsubscribe token is `base64url(tenantId|recipient).hmacHex(...)`, signed with its OWN
deployment secret — NOT `GOOGLE_OAUTH_CLIENT_SECRET`. A link that lives forever in a recipient's
inbox must not share the OAuth signing key. `verifyUnsubToken` holds the single
`if (!secret) return null` on the verify path; both `resolveUnsubToken` (the GET) and
`suppressFromUnsubscribe` (the confirm POST) go through it, so the POST can never trust a decode
its caller supplied. **Adding a second env guard at the HTTP route would make this one vacuous** —
do not. (The mint side in `footerFor` has its own refusal because minting and verifying are
different paths: `hmacHex(raw, "")` still yields a digest anyone can compute.)
*Enforcement:* `contacts.test.ts` — "an UNSET UNSUBSCRIBE_SECRET returns null", which also asserts
`suppressFromUnsubscribe` writes nothing.

**9. A GET on `/unsubscribe/` writes NOTHING — the POST is the only mutating verb.**
Corporate mail scanners and link prefetchers fire every URL in a message, so a GET-suppresses design
silently unsubscribes people who never clicked; the confirm button is what stops the feature firing
itself. The two routes live on `convex/http.ts` under `pathPrefix: "/unsubscribe/"` (Convex's router
has no `*` glob) and return ONLY 200 or 404 — one bare 404 for every rejection, so a
stale-but-well-formed token and a malformed one are indistinguishable from outside.
*Enforcement:* `contacts.test.ts` — "GET with a VALID segment renders the address and writes
NOTHING", which asserts the `suppressions` ROW COUNT before and after, not the response. That
distinction is the whole test: a handler that suppressed and then returned the very same HTML passes
a status-only check. Mutation-verified (adding the `runMutation` to the GET turns it red).

**10. A replayed unsubscribe link is honoured, and that idempotency IS the abuse mitigation.**
`suppressFromUnsubscribe` is an upsert that returns `ok: true` with `suppressed: 0` on a replay, and
the route shows the same confirmation both times — the recipient's request WAS honoured. This is why
the route carries **no rate limiter**: a valid segment requires the deployment secret, brute-forcing
an HMAC-SHA-256 digest is infeasible, and a per-address ceiling is meaningless against an idempotent
operation. Adding one would rate-limit only the people legitimately pressing the button.
(`@convex-dev/rate-limiter` is already a pinned component if that ever stops being true.)
*Enforcement:* `contacts.test.ts` — "POSTing the SAME segment twice is 200 twice and leaves exactly
ONE row", which also pins `suppressedAt` as unchanged across the replay (invariant 2's fact of
record).

**12. Two guards, two different jobs — deleting either leaves a real hole (19-05).**
`executePlan` calls `suppressedAmong` and drops addresses PER ADDRESS *before* the group join and
*before* the CAS patch; `gmail.send` calls `isSuppressed` per send, *before* a credential is even
minted. The first is the only one that can drop one of five recipients and still send to the other
four (a `requests` row in group mode is ONE comma-joined string — `isSuppressed` can only refuse the
whole row, which is the `ponytail:` ceiling written on it). The second is the only one that can see
a suppression created AFTER approve: `startScheduledDelivery` re-fires a `requestIds` list frozen at
approve time. `footerFor` is consumed at `gmail.send`'s `buildMime` CALL SITE and a null return is a
hard THROW — a tenant with no postal address cannot send, and neither can a deployment missing
`UNSUBSCRIBE_SECRET` or `CONVEX_SITE_URL`. A suppression discovered at send time terminates the row
as `blocked` (`recordDeliveryTerminal`'s `"suppressed"` outcome, which also decrements
`recipientTotal` so the plan counters balance) rather than holding it like `awaiting_reauth`.
*Enforcement:* `cockpit.test.ts` "executePlan suppression + postal-address gates" (rows 11-13, 16a),
`gmail.test.ts` "gmail.send — the suppression backstop + the CAN-SPAM footer" (rows 14-17) and
`plans.test.ts`'s balance/idempotency pair. **`gmail.send` has TWO production callers** —
`deliverApprovedPlan.ts` and `pipeline.ts` — so re-grep before claiming convergence at one.

**11. The ACTOR decides gating, not the operation.**
Agent-proposed writes — create, complete or cancel — ALWAYS stage through the plan gate. Direct
user edits on the Pipeline page are ungated: a human marking their own follow-up done is not an
agent act. Relatedly, the AGENT must always name a contact on a follow-up; contactless follow-ups
are a USER-only capability, and that is the structural brake against this CRM quietly becoming a
general task generator.
*Enforcement (19-06 — this stopped being prose):* the agent's only write path is a `crm_write` plan,
and `executePlan` is the only caller of `applyCrmOperations`. The contactless brake is structural in
the TYPE: `CrmOperation`'s `addFollowUp` arm carries a REQUIRED `email`, while
`contacts.createFollowUp`'s `contactId` stays optional for the human. `parseCrmOperations` throws
`CRM_FOLLOWUP_CONTACT_REQUIRED` on absent/blank/unnormalizable, pinned in `core/contacts.test.ts`.

**13. ONE implementation of the write rule, shared by both actors (19-06).**
`upsertContactRow`, `createFollowUpRow` and `setFollowUpStatusRow` are plain async functions over an
explicit `tenantId`. The public `tenantMutation`s are one-line delegations to them, and
`applyCrmOperations` calls the same three. **Three copies of the identity/upsert rule would be three
chances to disagree about who someone is** (invariant 4; CLAUDE.md §8 rung 2). The `tenantId` is
INJECTED by the wrapper at every public call site and read off the APPROVED PLAN ROW at the applier
— never model-supplied, so the refactor does not widen the tenant boundary. `applyCrmOperations`
resolves a `followUpRef` with `db.normalizeId` (`db.get` THROWS on a non-id string; `normalizeId`
returns null, so a malformed ref refuses the same way a foreign one does) and UPSERTS the contact a
follow-up names rather than refusing an unknown address — the human approved a card naming it, so
the row is a deliberate human act (invariant 1) and refusing after Approve would error on a plan the
user already agreed to.
*Enforcement:* `contacts.test.ts`'s existing isolation block still runs over every public write
(they delegate, so it still covers them), plus `cockpit.test.ts` "executePlan crm_write arm" —
including the cross-tenant approve and the foreign-`followUpRef` refusal.

**14. "Last touch" is DERIVED at read time, and that is a deliberate ceiling (19-07).**
`listContacts` folds ONE bounded `requests` read (status `sent`, through
`by_tenant_status_createdAt`) in memory against the page's addresses, and takes the max of that
and the newest `completedAt` on the contact's own follow-ups. A `canceled` follow-up is NOT a
touch, and re-opening a `done` one clears `completedAt`, so an undone completion cannot count.
There is deliberately **no denormalized `contacts.lastTouchAt` field**: that would be a write-path
obligation this phase does not otherwise have, and the write path is the expensive place to be
wrong. *ponytail ceiling:* the scan caps at 1 000 rows per call and the page then reports
`partial` / `"row-cap"`. *Upgrade path, when the read hurts:* denormalize `contacts.lastTouchAt`,
written by `recordDeliveryTerminal` and `setFollowUpStatus` — both of them, or the field lies.
A contact with neither a send nor a completion returns `null`, which the page renders as an
explicit "No contact yet" — NOT `0`, which would read as a measured zero (invariant 3 cuts both
ways: hedge a number you know, and you lie; print `0` for a fact you do not have, and you lie
harder).
*Enforcement:* `contacts.test.ts` "lastTouchAt is the NEWER of the newest delivered send and the
newest completed follow-up", which also pins the `null` case.

**15. The Pipeline nav item stays `soon: true` in Phase 19 (19-07).**
`apps/web/app/(app)/layout.tsx` keys the rail off `href`, not `soon`, so **adding the href IS the
activation** and 26-18 owns that decision. Phase 19 ships the route reachable BY URL only, exactly
as 26-10 Task 1 shipped Finance. *Enforcement:* the plan's verify step greps `layout.tsx` for
`/dashboard/pipeline` and expects NO hit, and `e2e/pipeline.spec.ts` asserts the rail carries no
such link so activation cannot happen by accident.

## How to change safely

**Adding a field to any of the three tables** — make it `v.optional`. All-optional additions are
"Safe Changes → Adding Optional Field" (convex-migration-helper): no migration, no backfill.
Completeness is enforced at the write boundary, never by the schema.

**Touching the resolution path (`llm.ts`, `plans.ts` candidates)** — re-check invariant 1 first.
Ask: does this write a contact row on a path no human pressed? If yes, stop.

**Touching the send path (`cockpit.ts` `executePlan`/`startFanout`, `gmail.ts`)** — this is the
spine; the WHOLE backend suite is the gate, not a filtered run (the 20-07 rule). The test that
matters most is the one where a suppression is created AFTER approve but BEFORE a scheduled fire:
it must still be refused at `gmail.send`. That is what proves the guard is in the send path.

**Changing the footer** — `renderFooter` is called on every send with no "is this commercial?"
branch. Adding one re-opens SC#6, which is currently true by construction. Also check
`notifyExternal`'s service notice still carries NO footer (`buildMime` byte-identity V4).

**Adding a Pipeline tile** — apply the near-duplicate-tile test: two adjacent tiles must not report
almost the same fact. That is why "needing attention" means *unowned* rather than *overdue*.

## How to verify

| Command | What it proves |
|---|---|
| `pnpm --filter @pikar/core test -- contacts` | The four pure functions at their boundaries, incl. idempotence and the fail-closed footer |
| `pnpm --filter @pikar/backend test -- contacts` | Tenant isolation over every new public function, the unsubscribe token round-trip, bounded reads, the no-opportunities structural scan |
| `pnpm --filter @pikar/backend test -- cockpitTools` + `-- gmail` | The per-address suppression drop, the group-mode join, all-suppressed refusal, the post-approve suppression, MIME-byte footer presence |
| `pnpm --filter @pikar/backend test -- cockpit` | The `crm_write` arm: all-or-none, double-approve, no requests rows, no Gmail token, cross-tenant and foreign-ref refusals |
| `pnpm --filter @pikar/backend test -- plans` | Pitfall 1 — `patchPlan`'s hand-maintained `kind` mirror accepts `crm_write` through the RUNTIME validator, and `resetPlan` clears `crmOperations` |
| `pnpm --filter @pikar/web test -- crmCard` | The plan card's line list, read through the same validator the applier runs |
| `pnpm --filter @pikar/web test -- pipelineView` | The empty-state `0` assertions (never `—`, never `Unknown`) |
| `node scripts/check-playbooks.mjs` | This playbook is registered and bumped alongside the code it watches |
| `pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts` | **Needs a live deployment.** A `--list` is NOT a run; a blank result means NOT RUN, never that it passed |

Manual-only: BRAND conformance of the Pipeline page and the rendered unsubscribe landing page, and
the un-suppress confirm flow. No assertion encodes a human judgement about how a page looks.

## Operational notes

- **`UNSUBSCRIBE_SECRET` must be set on the DEPLOYMENT** — `npx convex env set UNSUBSCRIBE_SECRET
  <value>` from `packages/backend`, not in `.env.local`. That is the Phase-2 lesson: a Convex
  function reads the deployment's env, and a value sitting only in `.env.local` is invisible to it.
  An unset secret makes every unsubscribe link resolve to `null` and 404, which is the CORRECT
  fail-closed behaviour and is completely invisible without checking — the footer still renders
  nothing at all (`footerFor` returns `null`, so the send is refused), so the symptom surfaces as
  "sending stopped working" rather than "the secret is missing". Check the env first.
- The unsubscribe route is **the phase's only public unauthenticated route.** It needs its own
  abuse/rate consideration; an unset signing secret must fail closed rather than open. Replay is
  handled by construction: `suppressFromUnsubscribe` is an upsert and returns `{ ok: true }` on a
  replay because the recipient's request WAS honoured.
- A bare GET must write NOTHING. Corporate mail scanners and link prefetchers fire GETs, and a
  GET-suppresses design silently unsubscribes people who never clicked. The confirm button is what
  stops the feature firing itself.
- A tenant with no `postalAddress` cannot send. The refusal names the missing field and points at
  `/dashboard/profile` — the `chooseModel` unknown-model precedent for fail-closed config.
- Teaching `cockpit-agent` the contacts/follow-up tools edits a **`GATED_SKILLS` body with ONE
  candidate stream**. Serialize against the other lanes contending for it, and verify which skill
  version carries your body before any eval — optimizer dry-run candidates occupy versions.

## Known gaps & deferred work

- **Person-level merging** — one person holding N addresses. Ships as one-row-per-address; the
  `ponytail:` note in `contacts.ts` names the upgrade path (a second `canonicalise()` beside
  `normalizeAddress`, never a change to it — the suppressions key must stay byte-stable).
- **Full inline contact editing on the Pipeline table** — this phase ships read + mark suppressed +
  add follow-up only.
- **Per-row opt-out inside a multi-operation CRM plan card** — approve-all-or-none for now.
- **Contact deletion / GDPR erasure** — not addressed beyond "suppression outlives the contact".
- **Seeded contact suggestions from recent mail** on the empty state — attractive onboarding, but
  it reads the mailbox to propose contacts and brushes against explicit-only creation (invariant 1).
- **RFC 8058 `List-Unsubscribe` headers** — better deliverability posture, additional POST
  endpoint. The landing page is the committed deliverable and ships first.
- **Deal stages / opportunities / monetary pipeline value** — explicitly forbidden (invariant 5).
  Reopening this is an amendment to PIPE-01, not a schema tweak.
- **Invariant 1 has no automated enforcement.** It is a source-level obligation checked by reading
  the resolution path. Stated as a gap, not a footnote.
