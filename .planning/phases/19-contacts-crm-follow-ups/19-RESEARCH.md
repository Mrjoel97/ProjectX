# Phase 19: Contacts, CRM & Follow-ups — Research

**Researched:** 2026-08-09
**Domain:** This codebase's own shipped machinery (action-type dispatch, the Gmail send spine, the
Convex http router, the Phase-26 dashboard contracts). Zero external libraries.
**Confidence:** HIGH on every code fact below (all read from source on 2026-08-09); MEDIUM on the
two judgement calls flagged in Open Questions.

<user_constraints>
## User Constraints (from 19-CONTEXT.md)

### Locked Decisions

**Schema shape — THREE tables, not two.** The ROADMAP resolution note says "two new tables:
`contacts` and `followUps`". That is now superseded: there are THREE. A separate address-keyed
`suppressions` table was chosen deliberately. **The planner must not "correct" this back to two.**

**How contacts get created**
- Explicit acts ONLY — the user typed it, the agent staged an add through the Approve gate, or
  (later) a Phase 31 lead form captured it.
- Gmail header resolution NEVER writes a contact row. `plans.candidates` stays transient and
  wiped-on-pick exactly as today (`schema.ts:203-211`).
- This IS the SC#7 argument. The "no contacts cache at rest" invariant survives because nothing
  accretes without a human act — there is no cache, only a deliberate record. The playbook states
  this in these terms.
- Identity = lowercased email address. One row per address. Same key the send-path guard uses
  against `plans.recipients`. A person with two addresses is two contacts; person-level merging is
  deferred.
- Email is REQUIRED. Name is OPTIONAL. No name-only contacts. The Pipeline table falls back to the
  address when no name is known.
- `origin` records the PROVENANCE OF THE DATA, not who triggered the write. Three values:
  `mailbox-resolved` / `user-entered` / `inbound`.

**Suppression storage and deletion**
- A separate tenant-scoped `suppressions` table, keyed by lowercased address.
  `contacts.unsubscribedAt` is a convenience MIRROR for display only.
- The send-path guard reads ONLY the `suppressions` table and never touches `contacts`.
- Suppression outlives the contact.
- Reversal is possible but deliberate — explicit confirm stating re-subscribing without fresh
  consent is the user's responsibility, plus a refs-only audit row. Not a plain toggle.

**Consent record (SC#4)**
- `consentAt` / `consentSource` are OPTIONAL and stay EMPTY when no consent event occurred. The
  Pipeline "Consent" cell then reads *"none on record"*. Nothing is defaulted to consented.
- A user CAN explicitly assert consent, recording assertion + timestamp + free-text context under
  source `asserted-by-user`.
- The reproducible-wording machinery is BUILT AND EXERCISED by that path.
- Consent detail lives in the content plane, never in `audit` (CLAUDE.md §4).

**What a follow-up is**
- Bound to a contact OPTIONALLY. Free-standing follow-ups allowed.
- Due date is REQUIRED.
- States: `open` / `done` / `canceled`. No snooze state — moving the due date IS the snooze.
- An optional provenance ref (plan / message id). Optional ⇒ no migration.
- The AGENT must always name a contact. Contactless follow-ups are a USER-only capability.

**How CRM writes reach the Approve gate**
- A FIFTH `ACTION_TYPES` member: `crm_write`, arm = `inline`.
- `packages/core/src/actionType.ts:36-38` IS STALE AND MUST BE CORRECTED IN THE SAME COMMIT.
- Adding the member is a deliberate COMPILE error at both arm tables. Do not route around it.
- The user sees its own PLAN card in the workspace right pane and a row in Approvals.
- ONE plan carries a LIST of operations, applied atomically. No per-row opt-out UI in this phase.
- Receipt = the existing plan lifecycle. No new receipt concept, no chat confirmation message.

**The ACTOR rule (gating).** The ACTOR decides whether something is gated, not the operation.
Agent-proposed writes — create, complete or cancel — ALWAYS stage through the plan gate. Direct
user edits on the Pipeline page are ungated.

**In-loop resolution precedence.** Contacts FIRST, Gmail headers as fallback. Falls back to the
existing candidates/resolution card when there is no saved match.

**Pipeline page behaviour**
- "Contacts needing attention" = contacts with NO open follow-up (deliberately COMPLEMENTARY to
  "Follow-ups due").
- "Last touch" = delivered outbound sends PLUS completed follow-ups. All local, no Gmail call at
  page render.
- "Follow-ups due" tile counts contactless follow-ups too — one honest total.
- Contactless follow-ups render in their OWN section beneath the table.
- Row actions: read + mark suppressed + add follow-up. Full inline contact editing is NOT in scope.
- Empty state: tiles show `0` — a real zero is stated as zero, never `—` and never `Unknown` (the
  26-10 lesson) — plus a short explanation and ONE action: add your first contact. No seeded
  suggestions from recent mail.

**Send-path guard behaviour**
- Per-address, not plan-level. Drop the suppressed address, send to the others, and TELL the user
  which addresses were withheld and why.
- The guard stays in the send path even though an approve-time check would be nicer UX — an
  approve-time check alone is bypassable by the scheduled-send path (03.5).

**CAN-SPAM footer and the unsubscribe link**
- EVERY send carries both the postal address and the unsubscribe link. One code path, one test. No
  "is this commercial?" judgement.
- A tenant with no postal address set CANNOT SEND. Fail closed, naming the missing field and
  pointing at the profile surface. Does NOT become a required onboarding field.
- The link opens a LANDING PAGE with a confirm button; suppression happens on an explicit POST.
- HMAC path segment for the token, reusing the Phase 20-06 fal-webhook pattern (`convex/http.ts`).
  Stateless: no token table, no expiry bookkeeping.
- This is the phase's only public unauthenticated route. Needs its own abuse/rate consideration.

### Claude's Discretion

- Exact table/index shapes, field names and validators (subject to the three-table decision).
- Where the postal-address field lives on the profile surface and its input validation.
- Which plan owns the `actionType.ts` comment correction (it must be the one adding `crm_write`).
- Pagination/window bounds on the Pipeline read models (26-01's shared contracts govern).
- Copy and layout details within the BRAND tokens (`docs/design/BRAND.md`).
- Whether the RFC 8058 `List-Unsubscribe` headers ship alongside the landing page or are deferred —
  the landing page is the committed deliverable.

### Deferred Ideas (OUT OF SCOPE)

- Person-level contact merging (one person, N addresses).
- Full inline contact editing on the Pipeline table.
- Per-row opt-out inside a multi-operation CRM plan card.
- Contact deletion / GDPR erasure beyond "suppression outlives the contact".
- Seeded contact suggestions from recent mail on the empty state.
- RFC 8058 `List-Unsubscribe` headers.
- Deal stages / opportunities / monetary pipeline value — explicitly forbidden by PIPE-01 and SC#8.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **ACTN-05** | The agent can track contacts / CRM state and follow-ups scoped to the user | §1 The `crm_write` edit list (the exact 8-site map + the 20-07 template); §5 Schema + isolation (tenant wrappers, index conventions, the no-migration precedent); §"Registration surfaces" (the three-surface rule for a new cockpit tool); §7 GATED_SKILLS scheduling for the cockpit-body teaching plan |
| **PIPE-01** | Pipeline view over Phase 19's single substrate, no second CRM store; suppressed recipients refused in every product-email terminal; no opportunities / stages / monetary values | §2 The send-path convergence map (the TWO enforcement points and why both are needed); §3 The un-omittable footer (the lowest structural point is `gmail.send:201`, not the drafter); §4 The public unsubscribe route (Convex httpAction vs apps/web, and the default-deny middleware trap); §6 The Pipeline route (26-01 contracts, 26-10 coverage/clamp lesson, BRAND tokens, nav flip mechanics) |
</phase_requirements>

---

## Summary

**This phase adds zero dependencies and zero new mechanisms. Every capability it needs already
exists in the repo**: the action-type arm table (`memo` is the `inline` template), the per-recipient
`requests` fan-out, the `hmacHex` path-segment webhook, the `tenantQuery`/`tenantMutation`
wrappers, the 26-01 dashboard contracts, and the `stat-*` CSS classes. External research returned
nothing relevant — the "standard stack" for this phase is this codebase's own shipped machinery.

Three findings materially change the plan versus CONTEXT.md, none of them contradicting a locked
decision:

1. **The send path has TWO convergence points, not one, and SC#5 needs both.** `executePlan` builds
   `targets` by joining recipients in group mode (`cockpit.ts:800`), so a per-address drop is only
   possible *before* that join. And `startScheduledDelivery` re-fires a fan-out whose `requests`
   rows were frozen at approve time, so an approve-time-only filter misses a suppression created
   during the wait. The unbypassable per-send choke point is `gmail.send` (`gmail.ts:158`) — it has
   exactly ONE production caller (`deliverApprovedPlan.ts:37`) and already returns
   `{ delivered: false, reason }`, which the fan-out loop handles as a hold rather than a failure.
   **Filter at `executePlan` for the user-facing "withheld" report and the group-mode case; guard at
   `gmail.send` for the structural, unbypassable trust boundary.**

2. **The footer cannot be enforced at the drafter.** The model's output lands on `plans.body`, is
   then copied to `plans.recipientBodies`, then to `requests.draft`, and can be overridden by
   `requests.editedBody` (`gmailAuth.ts:182` — `r.editedBody ?? r.draft ?? ""`). Every one of those
   is a bypass. The lowest point where no send path can skip it is the `buildMime(...)` call inside
   `gmail.send` (`gmail.ts:201`). **Do NOT put it inside `buildMime` itself** — `notifyExternal.ts:53`
   is a second `buildMime` caller sending a static service notice to the user's own mailbox, and
   footering it would be wrong and would break `gmail.test.ts`'s byte-identity tests (V4).

3. **A public page under `apps/web` requires editing a default-deny auth middleware.**
   `apps/web/middleware.ts` matches `/((?!.*\..*|_next).*)` plus `/(api|trpc)(.*)` and redirects
   anything not in `isPublic` (`/`, `/privacy`, `/terms`, `/signin`, `/signup`) to `/signin`. The
   Convex `http.ts` router runs on the Convex site origin and is untouched by that middleware —
   which is why the fal webhook and `/skillopt/*` work at all. **Put the unsubscribe landing page
   and its confirm POST in `convex/http.ts`.**

**Primary recommendation:** four tables' worth of schema (three new + one optional field on
`tenantProfiles`), the `crm_write` member landed across all eight registration sites in ONE commit
following 20-07's template verbatim, the suppression guard at both `executePlan`'s pre-join filter
and `gmail.send`'s per-row check, the footer at `gmail.ts:201`, both unsubscribe routes as
`httpAction`s in `convex/http.ts` reusing `hmacHex`, a new `contacts-crm.md` playbook registered in
`watch.json`, and the Pipeline page as a `page.tsx` → `PipelineView.tsx` pair exactly like Finance.

---

## Standard Stack

### Core — everything already installed and pinned

| Library | Version | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| `convex` | pinned | Tables, indexes, `httpRouter`, `httpAction` | The only persistence plane |
| `convex-test` | workspace | Backend integration tests (`t.withIdentity({ subject })` → `ctx.tenantId`) | The isolation idiom SC#2 requires |
| `vitest` | 3.2.7 | The only runner. `packages/core/vitest.config.ts` (node), `packages/backend/vitest.config.mts` (edge-runtime), `apps/web/vitest.config.mts` | Three configs already exist |
| `convex-helpers` | pinned | `customQuery`/`customMutation`/`customCtx` behind `lib/functions.ts` | The tenant linchpin |
| `crypto.subtle` (Web Crypto) | runtime | HMAC-SHA-256 for the unsubscribe token, via the exported `hmacHex` in `gmailAuth.ts:26` | Already the OAuth `state` and the fal webhook signer |
| `@playwright/test` | pinned | `apps/web/e2e/pipeline.spec.ts` — **already registered in `watch.json`** | The 26-xx browser-gate idiom |

### Supporting — in-repo modules the phase consumes

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `packages/core/src/actionType.ts` | `ACTION_TYPES`, `actionTypeOf`, `Arm`, `ARMS`, `armFor`, `assertNever` | The `crm_write` member + its arm |
| `packages/core/src/dashboard.ts` | `resolveDashboardWindow`, `DashboardBound`, `createDashboardBound`, `compareDashboardOrder`, `dashboardCursorFor`/`parseDashboardCursor`, `DASHBOARD_STATE_COPY` | Every Pipeline read model |
| `packages/backend/convex/lib/functions.ts` | `tenantQuery` / `tenantMutation` / `tenantAction` / `requireOwner` | Every public contacts function |
| `packages/backend/convex/gmailAuth.ts` | `hmacHex(data, secret)` (exported), `verifyState` (the `lastIndexOf(".")` idiom) | Unsubscribe token mint + verify |
| `packages/backend/convex/http.ts` | `pathPrefix` routes, `httpAction`, `SITE_URL` bounce | Both unsubscribe routes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Convex `httpAction` unsubscribe page | `apps/web/app/unsubscribe/[token]/page.tsx` | Gets BRAND tokens + `globals.css` for free, but requires editing the **default-deny** `isPublic` matcher in `middleware.ts` and a second bearer-secret hop back into Convex to write the suppression. Two files and a security-sensitive middleware edit vs. one file. Recommend the httpAction; see Open Question 2 |
| A separate `crm.ts` Convex module | Folding into `cockpit.ts` | Keep it separate: `cockpit.ts` is already ~1000 lines and is the most contended file in the tree |
| Storing the unsubscribe token in a table | Stateless HMAC | Locked by CONTEXT; the fal-webhook precedent proves it |

**Installation:** none. Zero new dependencies.

---

## 1. The `crm_write` action type — the complete edit list

### The stale comment, verbatim (`packages/core/src/actionType.ts`, lines 33-41)

```
 *  CORRECTED in Phase 17. This comment used to promise "calendar in Phase 17" under `workflow`;
 *  research REFUTED that, and a third arm is STRUCTURALLY FORCED:
 *    - NOT `inline` — `executePlan` is a `tenantMutation` (pinned by `dispatchGuard.test.ts:95`)
 *      and a Convex mutation cannot `fetch`.
 *    - NOT `workflow` — that case IS the gmail fan-out (`cockpit.ts:496-505`), so classifying an
 *      external write as `workflow` would silently inherit the EMAIL terminal.
 *  Phases 18 (document creation) and 19 (CRM writes) are the same mechanism — one governed
 *  external side effect driven by the retrier, not a DB write and not a fan-out — so they reuse
 *  this arm rather than adding a fourth. */
```

The prediction is at lines **39-41** (CONTEXT.md's "36-38" is off by three — the file has drifted).
The correction must state: Phase 18 did NOT take that path (`ACTION_TYPES` is still four members and
`plans.kind` is still `memo | calendar_event | media`), and Phase 19 builds OUR OWN `contacts`
table, so an add is *"a single transactional write"* — that same file's definition of `inline`.

### Current state of the two `satisfies` binds

`packages/core/src/actionType.ts:48-53`:
```ts
const ARMS = {
  email: "workflow",
  memo: "inline",
  calendar_event: "externalAction",
  media: "externalAction",
} as const satisfies Record<ActionType, Arm>;
```

`packages/backend/convex/cockpit.ts:565-572` (`_ARM_TABLE`) — the identical four keys. `cockpit.ts`
line numbers in CONTEXT.md ("563") are within one line; locate by symbol.

### The edit list — work top to bottom, ONE commit (20-07's rule)

| # | File | Edit | Why it must be in the same commit |
|---|------|------|-----------------------------------|
| 1 | `packages/core/src/actionType.ts` | `ACTION_TYPES` += `"crm_write"` | Widens the union |
| 2 | `packages/core/src/actionType.ts` | `actionTypeOf`'s param → `"memo" \| "calendar_event" \| "media" \| "crm_write" \| undefined` | Otherwise `plans.kind` widening breaks its call site |
| 3 | `packages/core/src/actionType.ts` | `ARMS` += `crm_write: "inline"` | COMPILE error until done — the guarantee |
| 4 | `packages/core/src/actionType.ts` | **Correct the lines 33-41 doc comment** | Locked; CONTEXT names this plan as its owner |
| 5 | `packages/core/src/actionType.test.ts` | Exact-array assertion + `armFor("crm_write") === "inline"`; existing four assertions unchanged | 20-07's Task 1 shape |
| 6 | `packages/backend/convex/cockpit.ts` | `_ARM_TABLE` += `crm_write: "inline"` | The SECOND compile error. **`EXTERNAL_TARGETS` needs NO entry** — `ExternalActionType` is derived (`cockpit.ts:578-580`) and an `inline` member is excluded by construction |
| 7 | `packages/backend/convex/schema.ts:288` | `plans.kind` → `v.union(v.literal("memo"), v.literal("calendar_event"), v.literal("media"), v.literal("crm_write"))`, still `v.optional` | ABSENT still means email ⇒ no migration, no backfill |
| 8 | `packages/backend/convex/plans.ts:441` | `patchPlan`'s **hand-maintained mirror** of that union, widened in the SAME edit | Pitfall: widen one and the runtime validator rejects the new kind while every typecheck passes (the `PLAN_STATUS` Pitfall-5 lesson, `plans.ts:20-21`) |
| 9 | `apps/web/.../workspace/cards.tsx` | A `if (plan.kind === "crm_write") { … }` branch **before** the email chrome, mirroring the `memo` branch at `:322` | Every line below the branch (recipients, mode, send-time picker, "Send to N recipients") is a lie on a CRM plan |
| 10 | `apps/web/.../workspace/cards.tsx:2288-2292` | Add `plan.kind !== "crm_write"` to the `hasDraft` conjunction | Otherwise a DRAFT card prints an email body beside the CRM card |
| 11 | `packages/backend/convex/cockpit.ts` `executePlan` | The `case "inline"` body branches on kind: memo → `persistNextStepMemo`; crm_write → apply the operation list | `executePlan` is a `tenantMutation` pinned by `dispatchGuard.test.ts:290`; the inline arm is one transactional write, no workflow, no retrier, no fetch |

**Anything else the graph shows?** No. `dispatchGuard.test.ts:220` (`"the externalAction arm wires
each occupant's OWN retrier action and non-Node terminal"`) scans only `externalAction` occupants,
so an `inline` member does not touch it. `evaluations.ts` owns the memo half of the inline arm and
does not need to change.

### The `memo` arm — the exact template (`cockpit.ts:683-691`)

```ts
case "inline": {
  // memo (12-05 BEVL-02): Approve means SAVE, not send — one transactional write, so a
  // workflow would add rows and latency for nothing. Nothing below (seed requests →
  // startFanout → gmail.send) is reachable from here; the double-approve CAS above already
  // makes it exactly-once.
  await ctx.db.patch(planId, { status: "done" });
  await persistNextStepMemo(ctx, plan);
  return { ok: true };
}
```

Note the ordering: the arm runs **after** the `plan.status !== "proposed"` CAS and the `escalated`
guard, and **before** the Gmail pre-check — deliberately, "because a memo must not require a
connected Gmail" (`cockpit.ts:680`). `crm_write` inherits that for free.

**Atomicity of the operation list is free.** A Convex mutation is one serializable transaction, so
"2 contacts + 3 follow-ups, approve-all-or-none" needs no saga, no compensation and no idempotency
key beyond the existing CAS.

---

## 2. The send-path suppression guard (SC#5) — the convergence map

### Every path that reaches a Gmail send

```
[A] cockpit.executePlan (tenantMutation)   ← the human Approve click
      ├─ arm === "inline"          → returns. NO send reachable.
      ├─ arm === "externalAction"  → retrier. NO send reachable.
      └─ arm === "workflow"
            ├─ gmail token pre-check (:781)   → { ok:false, reason:"gmail_not_connected" }
            ├─ send_time_too_far cap (:790)
            ├─ CAS patch → "approved" (:794)
            ├─ targets = mode === "group" ? [recipients.join(", ")] : recipients   (:800)   ★
            ├─ counters patch (recipientTotal/queuedCount/...)                     (:805)
            ├─ materialize attachments rows                                        (:819)
            ├─ FOR EACH target: ctx.db.insert("requests", {...})                   (:834-867) ★
            ├─ if sendAt in future → scheduler.runAt(startScheduledDelivery) → return
            └─ startFanout(ctx, args)
[B] cockpit.startScheduledDelivery (internalMutation)  ← the 03.5 scheduler callback
      └─ re-reads the plan, checks sendAt CAS, → startFanout(ctx, args)
            ** args.requestIds were FROZEN at approve time. No re-filter happens here. **
[C] startFanout  (plain helper, cockpit.ts:507)  — the SOLE workflow.start call site
      └─ workflow.start(internal.deliverApprovedPlan.deliverApprovedPlan, {requestIds, ...})
[D] deliverApprovedPlan (workflow, deliverApprovedPlan.ts:23)
      └─ for i in requestIds:
            pipeline.setStatus(delivering)
            step.runAction(internal.gmail.send, { requestId })        ← :37  ★ THE ONLY CALL SITE
            if (!result.delivered) continue;   // "a hold, not a failure"
            plans.recordDeliveryTerminal(outcome:"sent") + telemetry
[E] gmail.send (internalAction, gmail.ts:158)
      └─ gmailAuth.getForDelivery(requestId) → { tenantId, recipient, subject, body, attachments, … }
         freshAccessToken → buildMime(...) → POST SEND_ENDPOINT
[F] notifyExternal.dispatch (internalAction)  ← OPSG-05, NOT a product email
      └─ freshAccessToken → GET /users/me/profile → buildMime(ownAddress, "Pikar: <kind>", static)
         → POST SEND_ENDPOINT
```

`grep -rn "internal.gmail.send"` returns exactly one production hit: `deliverApprovedPlan.ts:37`.
`SEND_ENDPOINT` has exactly two POST sites: `gmail.ts:202` and `notifyExternal.ts:54`, and
`llmRedaction.test.ts:193` asserts that set is closed.

### Where per-recipient `requests` rows are seeded

`cockpit.ts:832-867`. One row per `target`, each with a server-minted `correlationId`, carrying
`draft: (plan.recipientBodies ?? {})[recipient] ?? body`. **Group mode collapses all recipients into
ONE row whose `recipient` is a comma-joined string** (`:800`). This is the reason the drop cannot be
done at seed-time alone *or* at `gmail.send` alone:

| Point | Handles individual mode | Handles group mode | Catches a suppression created after approve |
|-------|------------------------|--------------------|---------------------------------------------|
| Filter `plan.recipients` at `executePlan:796`, **before the join** | ✅ | ✅ (filters members out of the joined string) | ❌ |
| Guard inside `gmail.send` on `req.recipient` | ✅ | ⚠️ can only refuse the whole row | ✅ |

**Prescription: BOTH, and they are not redundant.**

1. **`executePlan`, immediately after `const recipients = plan.recipients ?? []` (:796) and BEFORE
   `targets` is computed (:800).** Partition into `allowed` / `withheld` by a pure predicate over
   the `suppressions` rows. Then:
   - `withheld.length > 0` → surface it. The return union already carries governed refusals
     (`gmail_not_connected`, `send_time_too_far`, `review_escalated`, `no_deck`, `ReserveRefusal`);
     add a **non-refusal** carrier so a partial send still returns `{ ok: true, withheld: string[] }`.
     Only bugs throw; a governed stop returns.
   - `allowed.length === 0` → `{ ok: false, reason: "all_recipients_suppressed" }` **before the CAS
     patch**, so the plan stays `proposed` with zero `requests` rows (the 20-07 media pre-step rule:
     a refusal that runs after the CAS leaves a half-approved plan).
   - Set `recipientTotal`/`queuedCount` from `allowed.length`, not `recipients.length`, or the
     Approvals progress counters lie.
2. **`gmail.send`, immediately after `getForDelivery` (gmail.ts:161-162).** `ctx.runQuery` an
   internal suppression check on `{ tenantId: req.tenantId, address: req.recipient }` and return
   `{ delivered: false, reason: "suppressed" }`. `SendResult`'s non-delivered arm already exists
   (`gmail.ts:155`) and `deliverApprovedPlan.ts:38` already `continue`s on it.
   - ⚠️ **`continue` leaves the row at `delivering` forever and never records a terminal.** That is
     correct for `awaiting_reauth` (the user can reconnect and resume) and WRONG for suppressed
     (permanent). The planner must either extend `recordDeliveryTerminal`'s outcome union
     (`plans.ts:501` — currently `"sent" | "failed"`) with a `"suppressed"` member, or set the
     request status via `pipeline.setStatus` to an existing terminal. **This is the one place the
     phase genuinely widens an existing enum; decide it explicitly.**

### Pure-TS placement (CLAUDE.md §1)

The predicate itself is `normalizeAddress(s) => s.trim().toLowerCase()` plus a set membership test.
Put `normalizeAddress` in `packages/core` (it is the *identity function of the whole phase* — the
contacts key, the suppressions key and the guard key must agree by construction) and let both Convex
sites import it. One function, one test, three call sites.

---

## 3. The un-omittable CAN-SPAM footer

### Where the body is composed, in order

| Stage | Symbol | Can the footer live here? |
|-------|--------|---------------------------|
| Drafting | `llm.draftCockpit` (`llm.ts:938`), `llm.draft` (`:3978`) via `EMAIL_DRAFTER_SKILL` | ❌ Model output. §5 forbids hardcoding it in the prompt anyway, and a prompt instruction is exactly the "classifier being right" failure CONTEXT rejects |
| Plan row | `plans.body`, `plans.recipientBodies[addr]` | ❌ Both are editable after the fact |
| Request row | `requests.draft`, `requests.editedBody` | ❌ `editedBody` overrides `draft` |
| Projection | `gmailAuth.getForDelivery:182` → `body: r.editedBody ?? r.draft ?? ""` | ⚠️ Possible, but it is an `internalQuery` with no tenant profile read and no per-recipient token minting context |
| **Send** | **`gmail.ts:201` — `buildMime(req.recipient, req.subject, req.body, parts, threading)`** | ✅ **THE POINT** |
| MIME | `buildMime` itself (`gmail.ts:81`) | ❌ Second caller `notifyExternal.ts:53` would get a footer on a service notice; and `gmail.test.ts:48-56` pins zero-attachment byte-identity (V4) |

### Prescription

Append at `gmail.ts:201`. `gmail.send` is an `internalAction` in a `"use node"` module, so it can
`ctx.runQuery` freely. It has `req.tenantId` (for the postal address) and `req.recipient` (for the
per-address HMAC token) — the two inputs the footer needs, both already in the projection.

```ts
// one read, one pure builder, one call site
const footer = await ctx.runQuery(internal.contacts.footerFor, {
  tenantId: req.tenantId, recipient: req.recipient,
});
if (!footer) throw new Error("gmail.send: tenant has no postal address"); // fail closed
const raw = base64Url(buildMime(req.recipient, req.subject, req.body + footer.text, parts, threading));
```

`renderFooter({ postalAddress, unsubscribeUrl })` is pure and belongs in `packages/core`.

### Can that point also enforce the fail-closed refusal? Partly — and it needs a second guard.

Throwing at `gmail.send` on a missing address is *structurally* correct (it mirrors the existing
`gmail.send: attachment blob ${a.storageId} missing` throw at `:186` — never silently send without
the promised part) but it is a *bad user experience alone*: the throw goes to the retrier →
`deadLetter` → an ops alert, long after the user pressed Approve.

**Two layers:**
- **`executePlan`, beside the `gmail_not_connected` pre-check (`cockpit.ts:781`).** Add
  `{ ok: false, reason: "no_postal_address" }`. Same shape, same place, same fail-before-mutate
  ordering. `cards.tsx:320-322` already handles `res.reason === "gmail_not_connected"` with a
  `setNote(...)` — extend that record to name the missing field and link `/dashboard/profile`.
- **`gmail.send`, the hard throw.** Covers the scheduled-send window where the address is deleted
  between approve and fire. Fail-closed, per CONTEXT ("a footer rendering an empty address looks
  compliant and isn't"), following `chooseModel`'s unknown-model precedent (`packages/cost/src/cost.ts:79`).

### Complications the planner must name

- **Per-recipient bodies.** `req.body` is already the resolved per-recipient body at `:201`, so
  appending there covers `recipientBodies` for free. Nothing extra to do.
- **Group mode.** `req.recipient` is a comma-joined string. The unsubscribe token cannot be
  per-address. **Recommendation:** given §2's `executePlan` filter already reads suppressions
  address-by-address in group mode, mint the token over the *joined string as stored* and have the
  confirm POST suppress every address it decodes. Alternatively refuse group mode for suppressed
  members only (already done) and accept a group-scoped token. Decide explicitly — it is the one
  place the address-keyed model has a seam.
- **Attachments.** No interaction: the footer rides the `text/plain` part in both the zero-attachment
  and multipart branches, because `buildMime` takes `body` and does the branching itself.
- **Byte-identity tests.** `gmail.test.ts` V4 asserts `buildMime(TO, SUBJECT, BODY) === LEGACY`.
  Appending outside `buildMime` keeps all of `gmail.test.ts` green — a real reason not to move the
  logic inward.

---

## 4. The public unsubscribe route

### The HMAC path-segment pattern, verbatim from Phase 20-06

**Mint** (`media.ts:929`):
```ts
const webhookUrl = `${siteUrl}/fal/callback/${line.jobId}.${await hmacHex(line.jobId, secret)}`;
```

**Route** (`http.ts:271-295`):
```ts
http.route({
  // `pathPrefix`, not a glob: Convex's router has no `*` syntax, so `path: "/fal/callback/*"` would
  // match nothing at all.
  pathPrefix: "/fal/callback/",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const unauthorized = () => new Response("unauthorized", { status: 401 });
    ...
    // 2. The path segment — `gmailAuth.verifyState:66-71`'s shape verbatim, `lastIndexOf(".")`.
    const segment = new URL(req.url).pathname.split("/").pop() ?? "";
    const dot = segment.lastIndexOf(".");
    if (dot <= 0) return unauthorized();
    const job = await ctx.runQuery(internal.mediaComplete.resolveJob, {
      raw: segment.slice(0, dot),
      digest: segment.slice(dot + 1),
    });
    if (!job) return unauthorized();
```

**Verify** (`mediaComplete.ts:54-72`) — three rules the unsubscribe resolver must copy:
```ts
// FAIL CLOSED on the env, and this is the ONLY copy of that guard on purpose. A second one at
// the route would make the mutation check for this one vacuous ...
const secret = process.env.FAL_WEBHOOK_SECRET;
if (!secret) return null;
...
// `gmailAuth.verifyState:70`'s comparison verbatim, including the plain `===`.
if (digest !== (await hmacHex(raw, secret))) return null;
```

For unsubscribe, `raw` is not an id — it must encode **tenant + address**. Recommendation: base64url
of `${tenantId}|${normalizedAddress}` as `raw`, then `raw.hmac` as the segment. The env secret should
be **new** (e.g. `UNSUBSCRIBE_SECRET`), not `GOOGLE_OAUTH_CLIENT_SECRET` — a link that lives forever
in a recipient's inbox should not share the OAuth signing key.

### Convex httpAction vs. an apps/web route handler — RECOMMEND `convex/http.ts`

| Factor | `convex/http.ts` httpAction | `apps/web` route/page |
|--------|----------------------------|-----------------------|
| Auth middleware | **Untouched.** Runs on the Convex site origin; Next middleware never sees it | **Requires editing `isPublic` in `apps/web/middleware.ts`** — a default-deny matcher whose comment says *"a new route is private until it is added here — the safe direction"* |
| HMAC pattern | Already there, twice | Would import `hmacHex` from `@pikar/backend` or duplicate it |
| Writing the suppression | `ctx.runMutation` directly | Needs a second hop with a bearer secret (the 20-15 `/media/blob/` shape, in reverse) |
| BRAND conformance | ❌ Cannot import `globals.css`; must inline styles/hex | ✅ Full token access + the `(app)`-free public shell that `/privacy` already uses |
| Files added | 1 (two routes in the existing `http.ts`) | ≥3 + a middleware edit |

**The 20-15 precedent CONTEXT points at is the opposite direction** and does not apply here: the
render runner lives in `apps/web` *only* because it needs the Vercel SDK + automatic OIDC (ADR-013),
which is a capability Convex cannot supply. There is no such forcing function for an unsubscribe
page. Note also that `/api/media/render` is matched by the middleware config (`/(api|trpc)(.*)`) and
is **not** in `isPublic` — an untested latent trap that reinforces the recommendation.

### Route shape

```
GET  /unsubscribe/<b64tenantAddr>.<hmac>   → 200 text/html: a self-contained landing page
                                              with a <form method="POST"> confirm button
POST /unsubscribe/<b64tenantAddr>.<hmac>   → verify → runMutation(internal.contacts.suppress)
                                              → 200 text/html confirmation (or 303 to SITE_URL)
```

`pathPrefix`, not `path` (the 20-06 lesson: Convex's router has no glob). The GET must be inert — no
write, no side effect — because corporate scanners and prefetchers will fire it. The POST is the
only mutating verb, which is exactly the "confirm button is what stops the feature firing itself"
decision.

### CORS / CSP / app shell

- **No CSP or custom headers exist anywhere.** `apps/web/next.config.ts` is four lines
  (`transpilePackages` only). Nothing to negotiate.
- **CORS is irrelevant** for a same-origin `<form method="POST">` on a Convex-served page. Do NOT
  build it as a `fetch()`-from-Next page (that WOULD need CORS on the Convex origin).
- **The app shell does not apply.** `apps/web/app/(app)/layout.tsx` is the authenticated rail; a
  Convex-served page has no shell at all. Style it inline with hex values copied from
  `globals.css`/BRAND §2 and add a `ponytail:` comment naming the ceiling (upgrade path: move the
  page into `apps/web` with a middleware edit when it needs to be more than one paragraph).
- **Abuse consideration (locked as required).** The route is unauthenticated but not unbounded: a
  valid segment requires the deployment secret, so the only reachable abuse is (a) brute-forcing
  digests — infeasible against SHA-256 — and (b) replaying a *legitimately obtained* link, whose only
  effect is idempotently suppressing an address that was already sent mail. Idempotency is the whole
  mitigation: the suppress mutation must be an upsert, not an insert. `@convex-dev/rate-limiter` is
  already a pinned installed component if the planner wants a per-IP ceiling; state honestly that a
  per-address ceiling is meaningless when the operation is idempotent.

---

## 5. Schema + isolation

### The tenant-scoped wrapper pattern (`convex/lib/functions.ts`, read in full)

```ts
async function requireScope(ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { userId, tenantId: String(userId) };
}
export const tenantQuery    = customQuery(query, customCtx(requireScope));
export const tenantMutation = customMutation(mutation, customCtx(requireScope));
export const tenantAction   = customAction(action, customCtx(requireScope));
export const ownerQuery     = customQuery(query, customCtx(requireOwner));
export const ownerMutation  = customMutation(mutation, customCtx(requireOwner));
```

That file is the **only** sanctioned raw-builder import site (biome `noRestrictedImports` override +
`importGuard.test.ts`). Every public contacts/followUps/suppressions function imports from here.
`internalQuery`/`internalMutation` from `_generated/server` remain permitted for internal-only
functions (the whole codebase does this) — but they take `tenantId` as an explicit arg and must
filter on it themselves.

### The isolation-assertion test pattern (SC#2)

Two shipped exemplars, both `$0`:

- **`packages/backend/convex/tenant.test.ts:16-50`** — the canonical minimal form: insert real
  `users` rows, build subjects as `${userId}|session_x`, assert (a) two sessions of one user share a
  scope, (b) a second user reads `[]`, (c) unauthenticated throws `/UNAUTHENTICATED/`.
- **`packages/backend/convex/media.test.ts:2461-2463`** — the BETA-05 form the phase should copy,
  and its header states the contract exactly:
  > *"Five tenant-guarded reads, six tenant-guarded writes, and the BETA-05 isolation assertion that
  > ships WITH the surface rather than after it. Reads return []/null for a foreign tenant; writes
  > throw. Every test is $0."*
  with the `const asA = (t: T) => t.withIdentity({ subject: A })` / `asB` helper idiom.

**Write the `asA`/`asB` block covering EVERY new public function** — `contacts.test.ts` should have
one `describe` that enumerates them, because BETA-05 culminates in a two-user test over *every* new
table and index.

### Index conventions

Every tenant-owned table leads with `tenantId`. Observed forms: `by_tenant`, `by_tenant_status`,
`by_tenant_status_createdAt`, `by_tenant_kind`, `by_tenant_contentHash`, `by_thread`
(`["tenantId","threadId"]`). Suggested (planner's discretion on exact names):

- `contacts`: `by_tenant_email` (`["tenantId","email"]`) — the identity lookup, must be unique-by-
  convention (Convex has no unique constraint; enforce at the write boundary);
  `by_tenant_createdAt` for the Pipeline listing.
- `followUps`: `by_tenant_status_dueAt` (`["tenantId","status","dueAt"]`) — serves both the
  "follow-ups due" tile and the table's Next-step column in one index;
  `by_tenant_contact` (`["tenantId","contactId"]`) for the "no open follow-up" predicate.
- `suppressions`: `by_tenant_address` (`["tenantId","address"]`) — the ONE index the send guard uses.

### The "all-optional new fields ⇒ no migration" precedent — CONFIRMED

`schema.ts:1190-1196`, the `tenantProfiles` table's own comment:
> *"Tier facts (@pikar/core `TierFacts`). ALL optional: a `legacy` backfill row has none by
> definition and design §10 forbids forced re-onboarding, so the "narrow" half of
> widen-migrate-narrow is deliberately NEVER taken. Completeness is enforced at the WRITE
> boundary (`missingSlots`/`canComplete`), not by the schema."*

and `schema.ts:1233-1235`, the Phase-17.1 block:
> *"ALL optional ⇒ NO migration (convex-migration-helper: "Safe Changes → Adding Optional Field"),
> and the table's own comment above already blesses optionality."*

Add the postal address as `v.optional(...)` immediately after `blueprintConfirmedAt` (`:1251`) with
the same comment idiom. Three new TABLES also need no migration ("New table ⇒ no migration
(prior-phase discipline)", `schema.ts:1189`).

**Shape recommendation:** a single `v.optional(v.string())` free-text block, not a structured object.
CAN-SPAM requires "a valid physical postal address", not a parsed one; a structured object invites a
country/state enum this phase does not need (ponytail rung 1). Validate non-empty-after-trim and a
length ceiling at the write boundary in `tenantProfile.ts` — nowhere else.

---

## 6. The Pipeline route

### 26-01's shared contracts (`packages/core/src/dashboard.ts`) — what to consume

| Export | Purpose | Pipeline use |
|--------|---------|--------------|
| `resolveDashboardWindow(input)` | Validates a half-open window, then clamps to coverage. **Throws** on an oversized span, `since >= until`, an invalid IANA zone, or a window with no covered time | The Pipeline table's "Last touch" window |
| `DashboardWindow.timeZoneSource` | `"tenant" \| "browser-fallback"` — makes the temporary browser-derived tz contract visible | Display only, never filtering |
| `createDashboardBound({returned, limit, nextCursor, partial, partialReason})` | Enforces `nextCursor ⇒ partial` and `partial ⇔ partialReason` | Every bounded list |
| `DashboardPartialReason` | `row-cap \| time-cap \| legacy-window \| coverage-gap \| source-unavailable` | Closed vocabulary — do not invent a reason |
| `compareDashboardOrder` / `dashboardCursorFor` / `parseDashboardCursor` | Newest-first total order + a validated `v1:` cursor | Contacts table pagination |
| `DASHBOARD_STATE_COPY` | Code-owned page-state prose (`loading/empty/ready/partial/busy/error/refusal`) | *"Backends return typed facts, never display prose"* |
| `DashboardMoney` / `createDashboardMoney` | USD-cents money | **DO NOT USE.** PIPE-01 forbids monetary pipeline values. Importing it would be a signal in the wrong direction |

### How 26-10 built a connected route

`apps/web/app/(app)/dashboard/finance/` has exactly three files:
```
page.tsx           — 5 lines: `export default function FinancePage() { return <FinanceView />; }`
FinanceView.tsx    — "use client", the whole page
financeView.test.ts — component tests
```
Copy that shape: `pipeline/page.tsx` + `PipelineView.tsx` + `pipelineView.test.ts`.

**Hard-won details from `FinanceView.tsx`'s header and the 26-10 STATE record — all apply verbatim:**

- **Component tests are `.test.ts`, NOT `.test.tsx`.** `apps/web` vitest includes `app/**/*.test.ts`
  only — a `.tsx` is **silently skipped**. `apps/web/vitest.config.mts` sets
  `esbuild: { jsx: "automatic" }`.
- **Almost none of the mockup's classes exist in `globals.css`.** Only `stat-grid`, `stat-tile`,
  `stat-head`, `stat-badge`, `stat-value`, `caps-label` are real. `.card`, `.meter`, `.pill`,
  `.btn`, `.sec`, `.bars` are mockup-only. **`.ledger` IS defined but is the DARK marketing audit
  block from the landing page** — the Pipeline mockup's contact table uses `<table class="ledger">`,
  so using it would render the table on a navy panel. Use inline `CSSProperties` over
  `var(--card)` / `var(--rule)` / `var(--canvas)` / `var(--ink)` / `var(--ink-soft)`, the
  ApprovalsView/FinanceView idiom.
- **Every section owns its own `useQuery`** so one failing read cannot erase the rest of the page.
- **Owner-only queries are passed `"skip"`, never fired-and-caught** — `OWNER_REQUIRED` would drop
  the whole page into the error boundary. (Pipeline has no owner-only data, but the idiom stands if
  any is added.)
- **Never `window.confirm`** for the un-suppress confirm — a browser modal blocks the page the
  Playwright spec must drive. Use an in-component arm/commit two-step, the 26-09/26-10 idiom.

### THE 26-10 COVERAGE/CLAMP LESSON — the defect and its fix (commit `1a63992`)

> *The page asked for a fixed 30 days, coverage began the day before, and `aggregateSpend`'s verdict
> is BINARY — so the totals rendered `Unknown` while the per-day series DIRECTLY BENEATH THEM showed
> $1.52 on a covered day. Self-contradictory, and it would have suppressed every real figure for a
> MONTH after any tenant starts.*
>
> Fix: a new `finance.coverage` tenantQuery returns just the coverage start so **the page SIZES ITS
> WINDOW BEFORE asking for totals**; when coverage falls inside the window it requests from there
> and renders `CoverageClampNotice` NAMING the truncation. **The clamp is only honest because it
> announces itself.**

**Two carry-overs for Pipeline:**
1. If any Pipeline tile is windowed (only "Last touch" plausibly is), fetch the coverage boundary
   first and size the window from it. Do not let a partially-covered window blank a real number.
2. **A real zero is `0`, never `—` and never `Unknown`.** This is the same defect stated from the
   other side. Contacts/follow-ups have **no coverage-start concept at all** — the substrate is
   created by the user, so "we weren't watching" cannot apply. That means all four tiles are
   ALWAYS-KNOWN counts and the `Unknown` state must not exist on this page. Say so in the playbook.

### Nav activation

`apps/web/app/(app)/layout.tsx:49` — `{ label: "Sales Pipeline", icon: <TrendIcon />, soon: true }`.
The comment at `:43-46` (added by 26-10) is authoritative:
> *"The branch below keys off `href`, not `soon`, so adding the href IS the activation. Rollback is
> deleting the href."*

So the flip is a one-line diff adding `href: "/dashboard/pipeline"`. **26-18 owns that flip, not
Phase 19** (CONTEXT: "The nav item stays `soon: true` … until 26-18 flips it"). Phase 19 ships the
connected route reachable by URL only, exactly as 26-10 Task 1 shipped Finance.

### BRAND tokens and patterns the page must use

From `docs/design/BRAND.md`:
- **§2 tokens:** `--teal-900` (rail/masthead), `--teal-600` (primary CTA fill), `--teal-400`
  (accent), `--canvas`, `--card`, `--ink`/`--ink-soft`, `--rule`, `--released` (delivered/cleared),
  `--held`/`--held-text` (**the approval gate ONLY — spend amber in exactly one place**).
- **§3:** UPPERCASE tracked-caps section labels are the signature pattern; big bold stat numerals
  with a small caps label.
- **§4:** cards everywhere (~16-20px radius, soft shadow, ample padding); *"never dense
  tables-on-white"*.
- **§5 "Executive report card":** the refinement that makes the contact table legitimate —
  *"structured reports — aligned columns, ruled sections, card-native whitespace, no gridlines — are
  the intended pattern; cramped spreadsheets are not."* Priority is a neutral stripe + weight,
  **never amber**.
- **§5 empty states:** *"honest zeros (`$0`, `0`) rather than fake data."*
- **§6 (non-negotiable):** `--teal-600` on white is ~2.9:1 — **fills only, never small teal text**.
  The 18-07 precedent resolved this by putting teal in the FILL
  (`color-mix(in srgb, var(--teal-400) 30%, var(--card))`) and keeping `--ink` for the label. Copy
  that for the `origin` and `consent` chips. Amber `--held` is ~1.9:1 — use `--held-text` for text.
- **§8:** no component library. Do not add one.

### The corrected mockup (`docs/design/mockups/pending-pages.html:863-905`)

Four tiles — *Contacts needing attention · Follow-ups due · Consent on record · Suppressed contacts*
— and five columns — *Contact · Origin · Last touch · Next step · Consent*. The two gravestone
`<div class="note dead">` notes explain the removals and carry the tie-breaker: **"The written
requirement wins over an unbuilt mockup."**

---

## 7. The GATED_SKILLS serialization constraint

### Which bodies are gated (`packages/contracts/src/skill.ts:242-262`)

```
COCKPIT_AGENT_SKILL, DOCUMENT_DRAFTER_SKILL, INBOX_DIGEST_SKILL, REPLY_DRAFTER_SKILL,
GROWTH_OS_DIAGNOSTIC_SKILL, SWOT_SKILL, LEAN_CANVAS_SKILL, BMC_SKILL,
OFFER_ARCHITECT_SKILL, MONEY_MODEL_DESIGNER_SKILL, LEAD_ENGINE_SKILL,
RESEARCH_SPECIALIST_SKILL
```
`isGatedSkill(name)` is the runtime check. Deliberately UNGATED and documented as such in the same
file: `content-drafter`, `document-analyst`, `business-blueprint`, `media-director`,
`voice-session`, `onboarding-agent`, `business-profile`.

### CURRENT contention state for `cockpit-agent` — as of 2026-08-09

| Plan | Status | Blocked on |
|------|--------|-----------|
| **18-08** | ✅ **DONE — the contention is GONE.** Body edit landed `cb48d11` (2026-08-02) under an owner override of the Phase-16 gate; **CERTIFIED LIVE 2026-08-08 by gate `14feb4b7`, 34/34, with `cockpit-agent@17` ACTIVATED** | nothing |
| **20-12** | ⛔ PARKED. "Teach `cockpit-agent` the media route + regenerate its one-line mirror" (Wave 14, blocking checkpoint) | Phase 16 closing the shared candidate stream. Phase 16 is **DEFERRED on billing** (OpenAI balance $0) with no date. Also gated behind 20-11 Task 4, the owner-run ~$0.75 live gate, which has never run |
| **20.1-01** | ⛔ NOT STARTED. `20.1-01-PLAN.md` exists; ROADMAP:362 — *"Numbered 20.1 because the constraint is the SKILL BODY, not the tools — cockpit-agent is a GATED skill with ONE candidate stream and both 18-08 and 20-12 already edit it, so this runs after both."* | 20-12 |

### What this means for Phase 19's scheduling

The lane is **currently free** (18-08 certified, `cockpit-agent@17` active, no open candidate). But
20-12 and 20.1-01 are both queued for it with no date, and 20.1's own ROADMAP note establishes the
serialization order. **Recommendation: Phase 19's cockpit-body plan takes the lane NOW, in a late
wave of its own, and inherits 20.1's precedent** — it must not run concurrently with 20-12, and
whichever runs second re-bases on the other's body.

**The 18-08 override condition is binding on this phase and is not optional** (PARALLELIZATION.md:36-43):
> *"the original rule's real objection was never 'two lanes in one file' — it was 'the next eval
> would certify instructions it never tested'. That objection stands and is answered by FIXTURES,
> not by the override. So 18-08 ships with `eval-cases/35-create-document.json` and a new
> `createdDocCount` observable, floor bumped 33 → 34. **Any future lane taking this same override
> owes the same thing: teach a tool in the shared body and you owe a fixture that exercises it
> BEFORE the gate run.**"*

⇒ **Phase 19's cockpit-body plan owes an `eval-cases/36-*.json` fixture exercising the new contacts
tools, plus a `$0`-observable smoke op (the `smoke:createdDocCountForThread` shape), and a fixture
floor bump 34 → 35, BEFORE any paid gate run.**

### The version-collision gotcha — CONFIRMED, and it just bit someone

`candidatesForReview` was fixed on 2026-08-09 (commit `75fe550`) because it *"offered DOWNGRADES —
it picked the highest-versioned CANDIDATE without comparing to the active row, so stale optimizer
dry-run rows were offered forever (`cockpit-agent v17->v16` …), every click returning EVAL_GATE."*
The in-code comment now reads (`skills.ts:213-219`):
> *"ONLY candidates AHEAD of what is live … optimizer dry-runs leave candidate rows behind at lower
> versions … Observed 2026-08-09."*

**Operational rule for the planner:** `seedSkills` mints `maxVersion + 1`, which is NOT necessarily
`active + 1`. Verify with `getActiveSkill` which version carries your body before any
`eval:golden --skill cockpit-agent@N` run. **Do NOT run `pnpm eval:golden` on a version named in an
EVAL_GATE error without checking the arrow — it spends real money to bless a rollback.**

---

## 8. Playbooks

### Coverage of the paths this phase touches (`docs/playbooks/watch.json`, read in full)

| Path this phase touches | Watched by | Consequence |
|---|---|---|
| `packages/core/src/actionType.ts` + `.test.ts` | `cockpit.md` | Must bump `cockpit.md` |
| `packages/backend/convex/cockpit.ts` | `cockpit.md` | ″ |
| `packages/backend/convex/plans.ts` | `cockpit.md` | ″ |
| `packages/backend/convex/gmail.ts` / `gmailAuth.ts` / `http.ts` | `cockpit.md` | ″ |
| `packages/backend/convex/llm.ts` | `cockpit.md` | ″ |
| `packages/backend/convex/deliverApprovedPlan.ts` | `cockpit.md` | ″ |
| `apps/web/app/(app)/dashboard/workspace/` (`cards.tsx`) | `cockpit.md` | ″ |
| `apps/web/e2e/` (incl. `pipeline.spec.ts`, listed in BOTH) | `cockpit.md` **and** `dashboard-pages.md` | Both |
| `apps/web/app/(app)/layout.tsx` | `dashboard-pages.md` | Only when 26-18 flips the nav |
| `packages/backend/convex/tenantProfile.ts` + `.test.ts` | `onboarding.md` | Must bump `onboarding.md` for the postal-address field |
| `apps/web/app/(app)/dashboard/profile/` | `onboarding.md` | ″ |
| `packages/backend/convex/lib/functions.ts` | `authorization.md` | Only if the wrappers change (they should not) |
| `packages/contracts/src/skills/`, `packages/backend/convex/skills.ts` | `skill-registry.md` | The cockpit-body plan |
| **`packages/backend/convex/contacts.ts`** (new) | ❌ NOTHING | Hook BLOCKS the turn |
| **`packages/core/src/contacts.ts`** (new) | ❌ NOTHING | Hook BLOCKS the turn |
| **`apps/web/app/(app)/dashboard/pipeline/`** (new) | ❌ NOTHING | Hook BLOCKS the turn |
| `packages/backend/convex/schema.ts` | ❌ NOTHING (no playbook watches it) | No obligation |

### A NEW playbook IS needed — and SC#7 requires it by name

SC#7: *"The phase states IN WRITING — in the playbook, not only in a plan summary — why a contacts
table does not violate the 'no contacts cache at rest' invariant at `schema.ts:210-211`."*

Create **`docs/playbooks/contacts-crm.md`** from `docs/playbooks/TEMPLATE.md`. Header format
(copy `dashboard-pages.md:1-4` exactly):
```markdown
# Playbook: Contacts, CRM & follow-ups

> Last verified: YYYY-MM-DD (Plan 19-NN — <what was verified>)
> Build history: `.planning/phases/19-contacts-crm-follow-ups/` · Related ADRs: <links or "none">
```

Register in `watch.json` — the new key's array must contain **every** new path prefix, or the hook
cannot protect it (CLAUDE.md §9):
```json
"contacts-crm.md": [
  "packages/core/src/contacts.ts",
  "packages/core/src/contacts.test.ts",
  "packages/backend/convex/contacts.ts",
  "packages/backend/convex/contacts.test.ts",
  "apps/web/app/(app)/dashboard/pipeline/"
]
```
⚠️ `apps/web/e2e/pipeline.spec.ts` is **already** registered under `dashboard-pages.md`. Do not
double-register it — pick one owner and note the choice.

### The SC#7 reconciliation the playbook must state, in these terms

The invariant lives at `schema.ts:208-212`:
> *"TRANSIENT name-resolution store (Plan 04/05 resolution card): raw fetched candidate
> names/addresses/hints held on the content plane ONLY (CLAUDE.md §4 …), wiped on pick
> (clearCandidates). **The 'no contacts cache at rest' invariant: only the chosen address persists
> in `recipients`; candidates/pendingValid never survive the pick.**"*

The playbook's argument, per CONTEXT: the invariant forbids a *cache* — data that accretes as a side
effect of reading the mailbox. A `contacts` row is not a cache: **it exists only because a human
deliberately made it** (typed it, or approved a staged add). Gmail header resolution still writes
nothing, `clearCandidates` still wipes on pick, and `plans.candidates`/`pendingValid` still never
survive. Nothing accretes. **Also state the change-safety rule:** any future code path that writes a
contact row without a human act re-opens the invariant and is forbidden — and the way to prove it
stays true is that `resolveContacts` (`llm.ts:1672`) never calls a contacts write.

### Change-safety notes about the shared tree

- Foreign lanes bump playbooks constantly, so `check-playbooks.mjs` exiting 0 can be a **FALSE
  NEGATIVE** on your own obligation (18-04/18-05/18-07 each hit this). Bump the playbooks you owe
  regardless of the hook's exit code, and never bump a foreign playbook's `Last verified` line.
- `git commit -m "msg" -- <paths>`, never `git add -A`. Check `.git/MERGE_HEAD` first.
  **NEVER `git stash` in this tree.**
- `.planning/*.md` and `docs/playbooks/*.md` are **CRLF**. Multi-line `\n` edit anchors silently
  no-op — normalize and assert-unique before writing.

---

## Registration surfaces (the checklist that must land in one commit)

Adapted from 18-RESEARCH's *Registration Checklist*, which the 18-xx plans worked top-to-bottom.

| # | Surface | File | Guard that catches the omission |
|---|---------|------|--------------------------------|
| 1 | `ACTION_TYPES` member | `packages/core/src/actionType.ts` | `satisfies Record<ActionType, Arm>` — compile error |
| 2 | `ARMS` entry | same | ″ |
| 3 | `actionTypeOf` param type | same | compile error at `cockpit.ts:681` |
| 4 | `_ARM_TABLE` entry | `convex/cockpit.ts` | second `satisfies` bind |
| 5 | `plans.kind` literal | `convex/schema.ts:288` | none — silent runtime validator rejection |
| 6 | `patchPlan` mirror | `convex/plans.ts:441` | none — **the classic trap** |
| 7 | Plan-card branch | `.../workspace/cards.tsx` | none — falls through to email chrome |
| 8 | `hasDraft` exclusion | `cards.tsx:2288` | none — duplicate card |
| 9 | New cockpit tool key | `buildCockpitTools` (`llm.ts:1295`) | — |
| 10 | `agentSteps.tool` `v.literal` | `convex/schema.ts:606-650` | **`cockpitTools.test.ts` scans every `<name>: tool(` key and fails if any lacks a literal** |
| 11 | `VERB` entry | `cards.tsx:1477` | **`traceParity.test.ts` — asserted BOTH ways** |
| 12 | SMOKE op (offline driver) | `convex/smoke.ts` + the 4 SMOKE sites | — |
| 13 | Eval fixture + floor bump | `scripts/eval-cases/`, `run-eval-golden.mjs` | the 18-08 override condition |
| 14 | `watch.json` entry | `docs/playbooks/watch.json` | **Stop hook blocks the turn** |

Rows 10-11 have bitten this repo **three times** (`searchVault`, `recordScorecardAnswer`,
`resetPlan`) — a missing literal makes `agentSteps:record` throw an `ArgumentValidationError` that
the AI SDK **silently swallows**, so the trace loses a step in production while the whole suite
stays green (`schema.ts:637-646`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC token for the unsubscribe link | A `node:crypto` HMAC, a JWT, or a token table | `hmacHex` (`gmailAuth.ts:26`, exported) + the `lastIndexOf(".")` segment split | A file holding an `http.route` **cannot** be `"use node"`, so `node:crypto` is only reachable via an extra `runAction` hop (`http.ts:191`). Two shipped, live precedents |
| Bounded list + cursor | A hand-rolled `limit`/`offset` | `createDashboardBound` + `dashboardCursorFor`/`parseDashboardCursor` | `nextCursor ⇒ partial` and `partial ⇔ partialReason` are enforced; a hand-rolled pair drifts |
| Window validation / clamping | `Math.max` in the component | `resolveDashboardWindow` | It throws on an inverted or uncovered window instead of rendering a lie — the exact 26-10 defect |
| Tenant scoping | `args.tenantId` on a public function | `tenantQuery`/`tenantMutation` | Banned by CLAUDE.md §2, enforced by biome + `importGuard.test.ts` |
| Atomic multi-row apply | A saga / compensating writes / an idempotency key | One Convex mutation | Convex mutations are serializable. `executePlan`'s CAS already makes it exactly-once |
| Address normalization in 3 places | Three inline `.toLowerCase()` calls | ONE `normalizeAddress` in `packages/core` | The guard and the contact row must "agree by construction" (locked). Three copies is three chances to disagree |
| Page-state prose | Component-local strings | `DASHBOARD_STATE_COPY` | *"Backends return typed facts, never display prose"* |
| A confirm dialog | `window.confirm` | In-component arm/commit two-step | A browser modal blocks the Playwright spec (26-10) |
| A component library | shadcn/Radix/MUI | The hand-rolled inline-`CSSProperties` idiom | BRAND §8: *"the app deliberately has no component library yet — don't add one without asking"* |

**Key insight:** every "new" thing this phase needs has a shipped twin two files over. The failure
mode here is not missing capability — it is *re-implementing* a capability under a new name and
losing the guard test that came with the original.

---

## Common Pitfalls

### Pitfall 1: The `plans.kind` / `patchPlan` mirror
**What goes wrong:** `schema.ts:288` is widened but `plans.ts:441` is not. Every typecheck passes;
the runtime validator rejects `kind: "crm_write"` at the first real propose.
**Root cause:** `patchPlan`'s union is hand-maintained, deliberately (`plans.ts:20-21`, the
`PLAN_STATUS` Pitfall-5 lesson).
**Avoid:** land both in the same edit, per 20-07 Task 1's instruction.
**Warning sign:** an `ArgumentValidationError` naming `kind` in a live turn.

### Pitfall 2: A new cockpit tool with no `agentSteps.tool` literal
**What goes wrong:** the tool works, but `agentSteps:record` throws `ArgumentValidationError`, the
AI SDK swallows it, and the workspace trace silently loses a step **in production while every test
passes**.
**Root cause:** the closed union at `schema.ts:606` is a §4 protection, not an oversight.
**Avoid:** literal + `buildCockpitTools` key + `cards.tsx` VERB entry, all in one commit.
**Warning sign:** `cockpitTools.test.ts` or `traceParity.test.ts` going red — they exist for this.

### Pitfall 3: Filtering suppressed addresses AFTER the group join
**What goes wrong:** in group mode a suppressed address is baked into one comma-joined `recipient`
string and is unremovable downstream.
**Root cause:** `cockpit.ts:800` collapses the array before the seed loop.
**Avoid:** filter `plan.recipients` at `:796`, before `targets` is computed.
**Warning sign:** a group-mode test that passes only because it has one recipient.

### Pitfall 4: A refusal that runs after the CAS patch
**What goes wrong:** the plan is stuck at `approved` with zero `requests` rows and no workflow — a
half-approved state nothing can resume.
**Root cause:** `cockpit.ts:794` flips the status before the seed loop.
**Avoid:** every new refusal (`no_postal_address`, `all_recipients_suppressed`) goes **before**
`:794`, beside `gmail_not_connected`. 20-07's mutation check for exactly this: *"move the media
pre-step to AFTER the `approved` patch — the 'refused approval leaves the plan proposed' assertion
must go RED."*
**Warning sign:** a plan in `approved` with `recipientTotal` unset.

### Pitfall 5: Putting the footer in `buildMime`
**What goes wrong:** `notifyExternal.ts:53` sends a static OPSG-05 service notice to the user's own
mailbox with a CAN-SPAM footer and an unsubscribe link for their own address; and `gmail.test.ts`'s
V4 byte-identity assertions all break.
**Avoid:** append at the `buildMime(...)` **call site** in `gmail.send` (`gmail.ts:201`).

### Pitfall 6: A GET that unsubscribes
**What goes wrong:** corporate mail scanners and link prefetchers fire every URL in a message,
silently unsubscribing people who never clicked.
**Avoid:** GET renders, POST mutates. Locked in CONTEXT; the confirm button is the mechanism.

### Pitfall 7: `.test.tsx` in `apps/web`
**What goes wrong:** the file is **silently skipped**. Zero failures, zero coverage.
**Avoid:** name it `.test.ts` (26-10's finding).

### Pitfall 8: Rendering a real zero as `—` or `Unknown`
**What goes wrong:** the 26-10 UAT defect, from the other side. Pipeline has no coverage start, so
`Unknown` is never the truth for any of its four tiles.
**Avoid:** all four tiles render `0`. State it in the playbook and pin it with a component test.

### Pitfall 9: Trusting `check-playbooks.mjs` exit 0
**What goes wrong:** a foreign lane bumped the playbook you owe; the hook passes; your obligation is
undischarged. Hit four consecutive times in Phase 18.
**Avoid:** bump what you touched regardless of the hook.

### Pitfall 10: `eval:golden` on a stale candidate version
**What goes wrong:** you spend real money certifying a **rollback**. Observed 2026-08-09 with
`cockpit-agent v17->v16`.
**Avoid:** `getActiveSkill` first; check the arrow direction in any EVAL_GATE error.

### Pitfall 11: A new Convex module reads as +1 typecheck error until codegen
**Root cause:** `_generated/api` has no entry for it yet (CLAUDE.md §7). Not a type error.
**Avoid:** `npx convex codegen` before quoting a delta. **The backend typecheck baseline is 13, all
in `convex/*.test.ts`, zero non-test — NOT the stale 150. Re-measure before quoting.**

### Pitfall 12: Adding a public page to `apps/web` without the middleware edit
**What goes wrong:** the unsubscribe link 302s the recipient to `/signin`.
**Root cause:** `apps/web/middleware.ts` is default-deny.
**Avoid:** use `convex/http.ts` (recommended), or make the `isPublic` edit an explicit, reviewed task.

---

## Code Examples

### The inline arm, extended for `crm_write` (from `cockpit.ts:683`)
```ts
case "inline": {
  // Approve means APPLY, not send. One transactional write — a Convex mutation is serializable,
  // so a multi-operation CRM plan is approve-all-or-none for free. Nothing below (seed requests →
  // startFanout → gmail.send) is reachable from here; the CAS above makes it exactly-once.
  if (actionTypeOf(plan.kind) === "crm_write") {
    await applyCrmOperations(ctx, plan);      // pure planner + ctx.db writes
    await ctx.db.patch(planId, { status: "done" });
    return { ok: true };
  }
  await ctx.db.patch(planId, { status: "done" });
  await persistNextStepMemo(ctx, plan);
  return { ok: true };
}
```

### The per-address filter, before the group join (`cockpit.ts:796-800`)
```ts
const all = plan.recipients ?? [];
const suppressed = await suppressedAmong(ctx, ctx.tenantId, all);   // Set<string>, one index read
const recipients = all.filter((r) => !suppressed.has(normalizeAddress(r)));
if (recipients.length === 0) return { ok: false, reason: "all_recipients_suppressed" }; // before the CAS
const mode = plan.mode ?? "individual";
const targets = mode === "group" ? [recipients.join(", ")] : recipients;
```

### The send-path backstop (`gmail.ts:161`)
```ts
const req = await ctx.runQuery(internal.gmailAuth.getForDelivery, { requestId });
if (!req) throw new Error(`gmail.send: request ${requestId} not found`);
// SC#5 trust boundary: this is the ONE place every product send converges (deliverApprovedPlan.ts:37
// is the sole caller). The executePlan filter is better UX; THIS is what makes it unbypassable —
// a suppression created after approve but before a scheduled fire is caught only here.
if (await ctx.runQuery(internal.contacts.isSuppressed, {
      tenantId: req.tenantId, recipient: req.recipient })) {
  return { delivered: false, reason: "suppressed" };
}
```

### The unsubscribe route (mirroring `http.ts:271`)
```ts
http.route({
  // `pathPrefix`, not a glob: Convex's router has no `*` syntax (the 20-06 lesson).
  pathPrefix: "/unsubscribe/",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const segment = new URL(req.url).pathname.split("/").pop() ?? "";
    const dot = segment.lastIndexOf(".");                        // gmailAuth.verifyState:74 verbatim
    if (dot <= 0) return new Response("not found", { status: 404 });
    const who = await ctx.runQuery(internal.contacts.resolveUnsubToken, {
      raw: segment.slice(0, dot), digest: segment.slice(dot + 1),
    });
    if (!who) return new Response("not found", { status: 404 });
    // A GET NEVER WRITES. Scanners and prefetchers fire every URL in a message.
    return new Response(landingHtml(segment, who.address), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});
```

### The isolation assertion (from `media.test.ts:2465`)
```ts
const asA = (t: T) => t.withIdentity({ subject: A });
const asB = (t: T) => t.withIdentity({ subject: B });
// Reads return []/null for a foreign tenant; writes throw. Every test is $0.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `externalAction` is "calendar's arm" | Two occupants (`calendar_event`, `media`) with a derived `EXTERNAL_TARGETS` | 20-07, 2026-08-01 | The comment predicting Phase 19 uses this arm is stale — Phase 19 uses `inline` |
| `ACTION_TYPES` = 3 members | 4 members | 20-07 | `crm_write` is the fifth |
| Finance nav `soon: true` | `href` present ⇒ live | 26-10 Task 3, 2026-08-09 | The nav branch keys off `href`, not `soon` |
| `candidatesForReview` offered the max-versioned candidate | Only candidates `version > active.version` | `75fe550`, 2026-08-09 | Stale optimizer dry-run rows no longer offered forever |
| Windowed pages accepted a binary coverage verdict | The page sizes its window from a coverage query and announces the clamp | `1a63992`, 2026-08-09 | A real zero/real number is never suppressed by one uncovered day |
| Backend typecheck baseline 150 | **13**, all in `convex/*.test.ts`, zero non-test | re-measured by 20-04 | Do NOT gate on 150 |

**Deprecated/outdated:**
- `actionType.ts:39-41`'s Phase 18/19 prediction — **this phase corrects it**.
- The ROADMAP Phase-26 note's *"two new tables: `contacts` and `followUps`"* — superseded by
  CONTEXT.md's three-table decision.
- The mockup's "Open opportunities" / "Pipeline value" tiles and "Stage" column — already deleted.
- `docs/design/mockups/pending-pages.html` `<table class="ledger">` for the contact table — `.ledger`
  is the dark marketing block; do not use it.

---

## Open Questions

1. **Group mode and the per-address unsubscribe token.**
   - *Known:* `executePlan` can filter suppressed members out of the joined string before the join;
     `gmail.send` sees only one comma-joined `recipient` string.
   - *Unclear:* what the footer's unsubscribe link should resolve to in group mode — every address
     in the group, or the group string as an opaque key.
   - *Recommendation:* mint the token over the joined string and have the confirm POST suppress each
     decoded address. Make it an explicit task with a test; do not leave it to discovery.

2. **The unsubscribe landing page's BRAND conformance.**
   - *Known:* a Convex `httpAction` cannot import `globals.css`; an `apps/web` page can but needs a
     default-deny middleware edit.
   - *Unclear:* whether an inline-styled single-paragraph page clears the bar for the one screen a
     *recipient* (not a user) ever sees.
   - *Recommendation:* ship the httpAction with hex values copied from BRAND §2 and a `ponytail:`
     comment naming the ceiling and the upgrade path (move to `apps/web` + `isPublic` edit). Flag it
     for the owner at UAT rather than pre-deciding.

3. **Which terminal a suppressed `requests` row lands in.**
   - *Known:* `recordDeliveryTerminal`'s outcome union is `"sent" | "failed"` (`plans.ts:501`); the
     fan-out `continue`s on `!delivered` without recording anything, which is correct only for the
     resumable `awaiting_reauth` case.
   - *Unclear:* whether to widen that union with `"suppressed"` or reuse `pipeline.setStatus` with an
     existing `requests.status` member (`blocked` exists at `schema.ts:140`).
   - *Recommendation:* reuse `blocked` if the counters stay honest; widening the terminal union
     touches the Approvals progress arithmetic (`plans.ts:516-522`) and is the more expensive edit.
     Verify the counter path either way.

4. **Whether "Last touch" needs a windowed read at all.**
   - *Known:* it is defined as delivered outbound sends + completed follow-ups, all local.
   - *Unclear:* whether the delivered-sends half scans `requests` `by_plan` per contact (N+1) or
     needs a denormalized `contacts.lastTouchAt`.
   - *Recommendation:* at beta scale, read `requests` through `by_tenant_status_createdAt` once for
     the page and fold in memory. Mark it with a `ponytail:` ceiling note; a denormalized field is a
     write-path obligation the phase does not otherwise have.

---

## Validation Architecture

*(`.planning/config.json` → `workflow.nyquist_validation: true` — this section is required.)*

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest` 3.2.7 (three configs) + `@playwright/test` for the browser gate |
| Config files | `packages/core/vitest.config.ts` (node) · `packages/backend/vitest.config.mts` (edge-runtime) · `apps/web/vitest.config.mts` (`jsx: "automatic"`, includes `app/**/*.test.ts` ONLY) · `apps/web/playwright.config.ts` (pins `127.0.0.1:3111`, **no `webServer` block**) |
| Quick run (core) | `pnpm --filter @pikar/core test -- contacts` |
| Quick run (backend) | `pnpm --filter @pikar/backend test -- contacts` |
| Quick run (web) | `pnpm --filter @pikar/web test -- pipelineView` |
| Full suite | `pnpm test` (turbo, all packages) |
| Typecheck | `pnpm typecheck` — **backend baseline is 13, all in `convex/*.test.ts`, zero non-test. Re-measure; do not quote 150.** |
| Playbook gate | `node scripts/check-playbooks.mjs` (must exit 0) |
| Browser gate | `pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts` — **needs a live `convex dev` (not `--once`), Next on :3111, and `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`.** 26-05 and 26-10 both stopped at `auth.setup.ts` for want of these. **A `--list` is not a run.** |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACTN-05 | `ACTION_TYPES` contains exactly the five members; `armFor("crm_write") === "inline"`; the four existing assertions unchanged | unit | `pnpm --filter @pikar/core test -- actionType` | ✅ (`packages/core/src/actionType.test.ts` — extend) |
| ACTN-05 | `normalizeAddress` is idempotent and agrees across contacts/suppressions/guard | unit | `pnpm --filter @pikar/core test -- contacts` | ❌ Wave 0 |
| ACTN-05 | The "contacts needing attention" predicate (no OPEN follow-up) and the "due" predicate are pure and correct at the boundaries | unit | `pnpm --filter @pikar/core test -- contacts` | ❌ Wave 0 |
| ACTN-05 | `patchPlan({ kind: "crm_write" })` is ACCEPTED by the runtime validator | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (extend) |
| ACTN-05 | Approving a `crm_write` plan applies the whole operation list, sets `done`, seeds ZERO `requests` rows, and never reaches `deliverApprovedPlan`/`gmail.send` | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (extend; the `gapAction.test.ts:193` idiom) |
| ACTN-05 | Double-approve of a `crm_write` plan applies nothing a second time | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (extend) |
| ACTN-05 | The email / memo / calendar / media arms are behaviourally unchanged | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (20-07 Task 3's regression, extend) |
| ACTN-05 | Every new tool key has an `agentSteps.tool` literal AND a `cards.tsx` VERB entry, asserted both ways | structural | `pnpm --filter @pikar/backend test -- traceParity` + `-- cockpitTools` | ✅ |
| ACTN-05 / BETA-05 | **SC#2 isolation**: every new public read returns `[]`/`null` for a foreign tenant; every new public write throws; unauthenticated throws `UNAUTHENTICATED` | integration | `pnpm --filter @pikar/backend test -- contacts` | ❌ Wave 0 |
| ACTN-05 | **SC#3** audit rows carry ids/counts ONLY — asserted by exact key-set equality, never a substring check | integration | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ (extend; the `document.created` 4-key precedent) |
| PIPE-01 | **SC#5** a suppressed address is dropped per-address; the other recipients still send; the user is told which were withheld | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (extend) |
| PIPE-01 | **SC#5** group mode drops the suppressed member from the joined string | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (extend) |
| PIPE-01 | **SC#5** ALL recipients suppressed ⇒ `{ ok:false }` **before the CAS**: plan stays `proposed`, zero `requests` rows, nothing scheduled | integration | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ (extend) |
| PIPE-01 | **SC#5** a suppression created AFTER approve but BEFORE a scheduled fire is still refused at `gmail.send` — **the test that proves the guard is in the send path** | integration | `pnpm --filter @pikar/backend test -- gmail` | ✅ (extend) |
| PIPE-01 | **SC#6** every send carries the postal address AND an unsubscribe link — asserted on the MIME bytes | integration | `pnpm --filter @pikar/backend test -- gmail` | ✅ (extend `gmail.test.ts`) |
| PIPE-01 | **SC#6** a tenant with no postal address cannot approve (`no_postal_address`, before the CAS) and cannot send (hard throw at `gmail.send`) | integration | `pnpm --filter @pikar/backend test -- cockpitTools` + `-- gmail` | ✅ (extend) |
| PIPE-01 | **SC#6** `notifyExternal`'s service notice carries NO footer (`buildMime` byte-identity V4 still green) | unit | `pnpm --filter @pikar/backend test -- gmail` | ✅ (already pins V4) |
| PIPE-01 | Unsubscribe: a tampered/absent digest 404s; an unset secret fails closed; a GET writes NOTHING; the POST suppresses idempotently | integration | `pnpm --filter @pikar/backend test -- contacts` | ❌ Wave 0 (the `media.test.ts:1557` `signed()` helper is the template) |
| PIPE-01 | **SC#8** all four tiles render `0` on an empty tenant — never `—`, never `Unknown` | component | `pnpm --filter @pikar/web test -- pipelineView` | ❌ Wave 0 |
| PIPE-01 | **SC#8** the page contains no opportunity/stage/monetary field — a structural scan for `amountCents`/`stage`/`opportunit` across the new modules | structural | `pnpm --filter @pikar/backend test -- contacts` | ❌ Wave 0 |
| PIPE-01 | Bounded reads honour `createDashboardBound` (`nextCursor ⇒ partial`) | integration | `pnpm --filter @pikar/backend test -- contacts` | ❌ Wave 0 |
| PIPE-01 | **Manual-only:** connected browser UAT — the four tiles, the table, the row actions, the un-suppress arm/commit, responsive breakpoints, and the rendered unsubscribe landing page in a real browser. *Justification: 26-05 and 26-10 both proved the Playwright suite cannot run in an executor shell (no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`), and BRAND conformance is a human judgement. Blank rows mean NOT RUN, never that it passed.* | manual | — | authored spec: `apps/web/e2e/pipeline.spec.ts` (already in `watch.json`) |

### Sampling Rate

- **Per task commit:** the filtered suite for the package touched (`pnpm --filter @pikar/<pkg> test -- <name>`) + `pnpm typecheck` delta measured against a **freshly re-measured** backend baseline.
- **Per wave merge:** `pnpm test` (full turbo run) + `node scripts/check-playbooks.mjs`.
- **Any plan touching `cockpit.ts`, `gmail.ts` or the approve spine:** the **WHOLE** suite is the gate, not a filtered run (20-07's rule).
- **Phase gate:** full suite green + both typechecks + production build + `check-playbooks` exit 0 + the owner browser UAT, before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `packages/core/src/contacts.ts` + `contacts.test.ts` — `normalizeAddress`, the needing-attention predicate, the due predicate, `renderFooter` — covers ACTN-05, PIPE-01
- [ ] `packages/backend/convex/contacts.test.ts` — the BETA-05 `asA`/`asB` isolation block over every new public function, the unsubscribe token round-trip, the bounded-read contract, the no-opportunities structural scan — covers ACTN-05 SC#2, PIPE-01 SC#8
- [ ] `apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` — **`.test.ts`, NOT `.test.tsx`** — the empty-state `0` assertions — covers PIPE-01 SC#8
- [ ] `apps/web/e2e/pipeline.spec.ts` — authored here, RUN at the owner gate (the 18-07 → 18-09 precedent). Already registered in `watch.json`
- [ ] `packages/backend/scripts/eval-cases/36-*.json` + a `$0` observable + fixture floor bump 34 → 35 — **owed by the 18-08 override condition** before any paid gate run
- [ ] Framework install: **none needed**

---

## Sources

### Primary (HIGH confidence — all read from source 2026-08-09)
- `packages/core/src/actionType.ts` (full) — `ACTION_TYPES`, `ARMS`, the stale lines 33-41
- `packages/backend/convex/cockpit.ts:440-928` — `startFanout`, `startScheduledDelivery`, `_ARM_TABLE`, `EXTERNAL_TARGETS`, `executePlan` in full
- `packages/backend/convex/lib/functions.ts` (full) — the tenant/owner wrappers
- `packages/backend/convex/http.ts` (full) — the four shipped route shapes
- `packages/backend/convex/gmail.ts:70-219` — `buildMime`, `base64Url`, `send`
- `packages/backend/convex/gmailAuth.ts:20-80, 163-193` — `hmacHex`, `verifyState`, `getForDelivery`
- `packages/backend/convex/deliverApprovedPlan.ts` (full) — the sole `gmail.send` caller
- `packages/backend/convex/notifyExternal.ts` (full) — the SECOND `buildMime` caller
- `packages/backend/convex/mediaComplete.ts:54-85` — `resolveJob`, the fail-closed HMAC verify
- `packages/backend/convex/schema.ts:140-320, 606-650, 1185-1252` — `requests`, `plans`, `agentSteps.tool`, `tenantProfiles`
- `packages/backend/convex/plans.ts:441, 497-522` — the `patchPlan` mirror, `recordDeliveryTerminal`
- `packages/backend/convex/skills.ts:203-221` — `candidatesForReview` after the 2026-08-09 fix
- `packages/contracts/src/skill.ts:242-267` — `GATED_SKILLS`, `isGatedSkill`
- `packages/core/src/dashboard.ts` (full) — the 26-01 contracts
- `packages/backend/convex/tenant.test.ts:1-60`, `media.test.ts:2461-2470` — isolation idioms
- `packages/backend/convex/traceParity.test.ts:1-45`, `dispatchGuard.test.ts` (test list)
- `apps/web/middleware.ts` (full), `apps/web/next.config.ts` (full)
- `apps/web/app/(app)/layout.tsx:31-56`, `.../workspace/cards.tsx:310-395, 1477, 2280-2300`
- `apps/web/app/(app)/dashboard/finance/{page.tsx,FinanceView.tsx:1-60}`
- `docs/design/BRAND.md` (full, 139 lines)
- `docs/design/mockups/pending-pages.html:863-905`
- `docs/playbooks/watch.json` (full), `dashboard-pages.md:1-20`, `TEMPLATE.md:1-14`
- `.planning/ROADMAP.md:36-105, 1076-1140`, `REQUIREMENTS.md:139-176`, `config.json`
- `.planning/PARALLELIZATION.md:19-46` — the 18-08 override condition
- `.planning/phases/20-media-canvas/20-07-PLAN.md` (full) — the `crm_write` template
- `git show 1a63992`, `git show 6ef81ed` — the 26-10 coverage/clamp defect and fix

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` lane rows for 16 / 18 / 20 — the cockpit-agent contention state. Lane prose is authoritative for *intent*; the git history was cross-checked for 18-08's landing and 26-10's fix.

### Tertiary (LOW confidence)
- None. No external source was consulted; none was relevant. `graphify query`/`explain` returned no
  node for "suppression / unsubscribe / consent / contacts" — **correct, because none of it exists
  yet**, which is itself a useful negative confirmation that there is no second CRM store to collide
  with (PIPE-01's central worry).

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new dependencies; every module named was read from source today.
- Architecture (the edit list, the send map, the footer point): **HIGH** — the convergence claim is
  backed by an exhaustive grep of `internal.gmail.send` (1 hit) and `SEND_ENDPOINT` (2 hits), and by
  `llmRedaction.test.ts:193` which asserts that set is closed.
- Unsubscribe route placement: **MEDIUM** — the recommendation is sound and the middleware fact is
  verified, but the BRAND trade-off is a judgement the owner may reverse (Open Question 2).
- Pitfalls: **HIGH** — nine of the twelve are recorded defects with commit shas or in-code comments
  written by whoever hit them.
- Skill-lane scheduling: **MEDIUM-HIGH** — 18-08's landing and 20-12's park are documented in both
  ROADMAP and STATE; 20.1-01's ordering is stated in ROADMAP:362 but has no execution record yet.

**Research date:** 2026-08-09
**Valid until:** 2026-09-08 for the code facts (this tree moves daily — re-verify line numbers by
symbol, never by number). **7 days** for the `cockpit-agent` lane state and the typecheck baseline,
both of which changed within the last 48 hours.
