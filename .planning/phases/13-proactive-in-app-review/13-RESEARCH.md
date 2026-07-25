# Phase 13: Proactive In-App Review - Research

**Researched:** 2026-07-25
**Domain:** Convex scheduled functions (crons) + tenant fan-out + in-app notification delivery over an existing evaluation engine
**Confidence:** HIGH (almost every finding is verified against repo source or Convex 1.42.1 typings/docs; two MEDIUM items flagged)

## Summary

This is a **wiring phase, not a technology phase**. Every mechanism it needs already ships in this
repo: `crons.ts` has two working cron registrations, `internal.evaluations.runEvaluation` is a
complete deterministic engine, `gmailAuth.flagExpiringTokens` is a working cron→direct-notification-
insert that already bypasses the Gmail path, `EvaluationCard` is a dumb renderer over
`evaluations.byThread`, and `?thread=<id>` deep-linking already works. There is **no new library, no
new dependency, and no new pattern to learn**. The research value is therefore concentrated in
(a) verifying the CONTEXT.md code claims, (b) the three places CONTEXT.md is factually wrong or
imprecise, and (c) the Convex platform limits that bound the fan-out design.

Three findings materially change the plan. **First**, `vaultDocuments` has NO index on `kind` — the
locked "enumerate tenants from `vaultDocuments` where `kind === 'business_profile'`" requires either a
full-table `.collect()` (which reads every document's `text` field, and this is the exact table a user
uploads 300-page PDFs into) or a new `by_kind` index. Convex caps a transaction at 32,000 documents
scanned / 16 MiB read; a handful of large PDFs gets there. **Second**, `runEvaluation` returns only
`{verdict, findingCount, gapCount}` — it does NOT return the row or its id, so CONTEXT.md's "the cron
already holds `next`" is false; the delta must either be computed inside `runEvaluation` (which
already holds both `prev` and the fresh findings/gaps in one scope) or bought with a re-read plus a
patch of an append-only table. **Third**, `diagnose()` returns exactly ONE `Prescription`, so
`gaps.length` is always 0 or 1 — the locked `gapsClosed[]`/`gapsOpened[]` set-diff is set arithmetic
over singletons, and keying it on `route` alone cannot distinguish the three different
`offer-architect` prescriptions from each other.

One UI landmine: selecting the pinned review tab feeds `threadId = "proactive-review"` into
`ChatPane`, whose composer calls `sendCockpitMessage`, which **throws** `"cockpit: plan row missing
for thread"` because no `plans` row exists for that thread. Message *listing* degrades gracefully
(verified: `listThreadMessages` returns an empty page), but *sending* does not.

**Primary recommendation:** Add a `by_kind` index to `vaultDocuments`, compute the delta inside
`runEvaluation` (zero extra reads, zero extra writes, keeps `insertEvaluation` the single write
surface), suppress the composer on the review tab, and write the SC#2/SC#3 guard as a single
edge-runtime test using the `importGuard.test.ts` `import.meta.glob("?raw")` idiom.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Where the review lands**

- **Synthetic review thread.** The cron writes the evaluation under a deterministic per-tenant
  thread id (e.g. `proactive-review`) so the existing `evaluations.byThread` → `EvaluationCard`
  path renders it with no new card infrastructure. The existing `?thread=<id>` deep-link
  (built for the VOIC-04 voice→plan handoff) is the routing — no new route.
- **One persistent review thread per tenant, NOT a new thread per week.** This is load-bearing:
  `runEvaluation` carries the prior Scorecard and `userProvided` keys forward via
  `lastForThread`, which is scoped to the SAME threadId. A weekly thread id would silently reset
  the Scorecard every week and re-ask figures the user already answered. Append-only rows on one
  stable thread give carry-forward for free.
- **Pinned workspace tab.** A "Weekly review" tab is always rendered in the workspace tab strip.
  Because the thread id is deterministic, this needs NO tab persistence (page.tsx:27 notes tabs
  are session-only view state) — the tab is static and always known.
- **Tab is always visible, with empty-state copy before the first run** — e.g. "Your first
  weekly review runs Monday. It reads your vault — nothing to do." One extra branch in the card.
- **The review thread is NOT added to "Past chats".** It has no cockpit turns; the history menu
  stays a chat-only surface.
- **Same card, dated header.** The proactive review renders the identical `EvaluationCard` body
  with a header line: `Weekly review · Jul 27`. No new card idiom.
- **Live swap is fine.** Convex subscriptions will replace the card contents if a new review
  lands while the tab is open. That is the correct outcome and costs zero code.
- **Latest review only — no history UI.** Rows accumulate append-only for free; a "previous
  reviews" list is deferred until someone asks.
- **Notification copy is a static line, no counts:** "Your weekly business review is ready."
  Zero §4 exposure. The card carries all substance.

**Cadence and tenant selection**

- **One weekly UTC cron**, matching the existing `worm-export` / `gmail-token-expiry-scan`
  pattern: `crons.weekly("proactive-review", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.proactiveReview.runWeekly, {})`. Convex crons are deploy-time and UTC-only; no
  per-tenant timezone handling in this phase (there is no tenant tz field today).
- **Tenants are enumerated from `vaultDocuments` where `kind === "business_profile"`** — the same
  rows `internal.vault.profileSeedDocs` already keys on. Semantics: *onboarded ⇒ reviewed*. There
  is no `tenants` table; both existing crons enumerate by scanning a domain table, so this
  follows precedent.
- **No opt-out toggle this phase.** One notification per week at private-beta scale does not
  justify a settings table + settings UI. Deferred (below).
- **Fan-out: one scheduled job per tenant.** `runWeekly` is a cheap `internalMutation` that
  enumerates tenants and calls `ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne,
  { tenantId })` per tenant. Each review is its own isolated transaction — one tenant's failure
  cannot stall or affect another. This is the same seam `notifications.notify` already uses to
  hand off to `notifyExternal`.
- **Failures ARE surfaced to the user** (not silently skipped). A failed review writes an in-app
  notification: "We couldn't run your weekly review — open the cockpit to run one now.", which
  deep-links to `/dashboard/workspace` where the Phase-12 on-demand `evaluateBusiness` path is
  already live. The failure reason is NEVER put on the notification plane (§4).

**What the review says**

- **Full re-run of the existing engine** — `reviewOne` calls `internal.evaluations.runEvaluation`
  with no engine changes. Output is identical to an on-demand assessment.
- **Plus a stored "what changed" delta line.** Computed at WRITE time by the cron (which already
  holds `prev` from carry-forward and `next`), stored on the evaluation row in a new **optional**
  `delta` field → no migration. Keeps `EvaluationCard` a single-row dumb renderer. An on-demand
  run has no `delta` → the line is simply hidden.
- **Delta is keyed on `gap.route`, not on labels.** `route` is a bounded specialist-skill
  identifier (`money-model-designer`, etc.); `label` is prose from `diagnose()` and any wording
  change would read as "closed + new". Findings get a count-only comparison.
  Shape: `{ newFindings: number, gapsClosed: string[], gapsOpened: string[] }` (routes).
  Rendered as e.g. `2 new findings · 1 gap closed · 1 new gap`.
- **Framework carries forward from last week's row**, falling back to the engine default on the
  first run (`framework = last?.framework` → `undefined` → existing default behavior). The user
  compares like with like week over week.

**Sparse and empty cases**

- **Always write the evaluation row; notify ONLY on change.** The card stays current every week
  and history accrues, but a notification fires only when: it is the first review ever, OR the
  verdict changed since last week, OR the delta is non-empty. An idea-stage tenant (Phase 11
  admits users with only a one-line description) gets ONE "not enough data" notification and then
  silence — a weekly unchanging ping is the fastest way to get the bell ignored.
- **The not-enough-data card links to `/dashboard/profile`** — the Phase-11 enrichment surface —
  turning a dead end into the one action that unblocks it.
- **A healthy business going quiet is correct.** Silence is the signal: nothing changed, nothing
  needs you. The card still refreshes weekly with the healthy banner. No monthly heartbeat.
- **No unread dot / badge on the pinned tab.** The dated card header (`Weekly review · Jul 27`)
  is the freshness signal — no per-tenant read state to add or maintain.

**Governance (SC#2 and SC#3)**

- **The no-mailbox-token guarantee gets a STATIC GUARD TEST**, following the established
  `importGuard.test.ts` / `llmRedaction.test.ts` precedent. It asserts:
  1. the review module imports neither `./gmail` nor `./notifyExternal`;
  2. `"weekly_review"` is absent from `NOTIFICATION_KINDS` (an unregistered kind makes
     `notifyExternal.dispatch` return *before* `freshAccessToken` is ever called);
  3. the review path inserts into `notifications` **directly**, never via `notifications.notify`.
  Rationale: `notifications.notify` unconditionally schedules `internal.notifyExternal.dispatch`,
  which calls `freshAccessToken` and sends Gmail — routing the review through it would violate
  SC#1/SC#2. `gmailAuth.flagExpiringTokens` already sets the bypass precedent (direct insert,
  unregistered `gmail_reconnect` kind). A test makes the invariant fail in CI instead of silently
  breaking in production week 2.
- **No new audit row.** `runEvaluation` already writes a refs/counts-only `evaluation.ran` audit
  row. The cron adds nothing — a `review.delivered` row would duplicate it.
- **Explicit `tenantId` on every internal function + a scoping assertion in the same guard test.**
  The cron runs with no authenticated identity, so `requireTenant` / `tenantQuery` do not apply.
  Every read and write in the review path carries an explicit validated `tenantId`, following the
  established internal-twin convention (`recordScorecardAnswerInternal`, `runEvaluation`). The
  guard test asserts no unscoped table scan exists in the review path.
- **Live verification runs `internal.proactiveReview.runWeekly` from the Convex dashboard**
  function runner with `{}`. No dev-only UI trigger is added; this exercises the exact production
  path including fan-out. Document the invocation in the playbook.

### Claude's Discretion

- Exact module name/layout (`proactiveReview.ts` assumed but not locked) and function naming.
- Exact delta line wording and its placement within the card header region.
- Exact empty-state and failure-notification microcopy (decisions above fix the substance and the
  §4 constraint, not the final characters). Follow `docs/design/BRAND.md` voice.
- Whether the pinned-tab label reads "Weekly review" or similar.
- Test file layout and how the static source assertions are implemented.

### Deferred Ideas (OUT OF SCOPE)

- **Per-tenant opt-out / mute toggle** for the weekly review — needs a settings row + settings UI.
  Add when a beta user asks.
- **Tenant-local delivery time** (e.g. Monday 08:00 local) — needs a per-tenant timezone field and
  an hourly cron with a due-filter. Revisit if UTC delivery proves annoying.
- **Review history UI** ("previous reviews" list) — rows already accumulate append-only, so this is
  purely a read surface whenever it's wanted.
- **Unread state on the pinned tab** — deferred with the dated header standing in as the freshness
  signal.
- **Any scheduled Google-bound call** (emailing the review, calendar-aware timing) — explicitly
  deferred to production OAuth in Stage S4 / Phase 25, per the roadmap.
- **Monthly "still healthy" heartbeat notification** — considered and rejected for now; revisit if
  users report feeling the system went silent.
- **Rich LLM narrative in the review** — already deferred by Phase 12; the engine stays
  deterministic here.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BEVL-03 | A proactive business review is delivered in-app on a recurring cadence (weekly-style briefing) using no OAuth mailbox token | **Cadence:** `crons.weekly(...)` verified present and correctly typed in convex@1.42.1 (`WeeklySchedule`, lowercase `DayOfWeek`) — see Standard Stack. **In-app delivery:** the `notifications` table + direct-insert bypass is verified working in `gmailAuth.flagExpiringTokens:169`; `EvaluationCard` renders from `evaluations.byThread` with no new card. **No OAuth token:** verified that `notifyExternal.dispatch` returns at `if (!KINDS.has(kind)) return;` — *before* `freshAccessToken` — for any kind absent from `NOTIFICATION_KINDS`, and that direct insertion into `notifications` never schedules `dispatch` at all. **Tenant scoping:** `by_tenant_thread` index + explicit-`tenantId` internal-twin convention verified on `runEvaluation`, `lastForThread`, `insertEvaluation`, `profileSeedDocs`. **Audit:** `evaluation.ran` refs/counts-only payload verified at `evaluations.ts:341-354`. |
</phase_requirements>

## Standard Stack

### Core — everything is already installed and in use

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | **1.42.1** (pinned exact) | `cronJobs()` / `crons.weekly` / `ctx.scheduler.runAfter` | Already the backend. Cron + scheduler are first-party primitives; no third-party scheduler exists or is needed. §6 forbids bumping. |
| `convex-test` | 0.0.54 | In-memory execution of the cron + fan-out in tests, incl. `t.finishInProgressScheduledFunctions()` | Already used in 20+ test files; `finishInProgressScheduledFunctions` already used in `cockpit.test.ts:331,400,468` |
| `vitest` | ^3.2.7 | Test runner, `edge-runtime` env | The repo's only test framework |

### Supporting — existing repo modules the phase composes

| Module | Symbol | Purpose |
|--------|--------|---------|
| `convex/crons.ts` | `crons` | One added `crons.weekly(...)` line |
| `convex/evaluations.ts` | `runEvaluation` (L144), `lastForThread` (L112), `insertEvaluation` (L123), `byThread` (L601) | The engine + its read/write surfaces |
| `convex/vault.ts` | `profileSeedDocs` (L467) | The `business_profile` kind predicate (per-tenant, not an enumerator) |
| `convex/gmailAuth.ts` | `flagExpiringTokens` (L169) | **The pattern to copy** — cron mutation → direct `notifications` insert |
| `packages/core` | `NOTIFICATION_KINDS`, `notificationMessage` | The closed kind union the review kinds must stay OUT of |
| `apps/web/.../cards.tsx` | `EvaluationCard` (L1385), `CardList` (L1497) | Card render + dispatch |
| `apps/web/.../workspace/page.tsx` | `WorkspacePage` (L139), tab strip (L253-289), `?thread=` effect (L165-169) | Pinned tab + deep-link |
| `apps/web/(app)/_components/NotificationsBanner.tsx` | `NotificationsBanner` | In-app render (mounted at `layout.tsx:189`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crons.weekly` | `crons.cron("0 6 * * 1", ...)` | The repo's `_generated/ai/guidelines.md:287` says *"Only use `crons.interval` or `crons.cron`. Do NOT use the `crons.hourly`, `crons.daily`, or `crons.weekly` helpers."* — **but the repo already uses `crons.daily` twice** and CONTEXT locks `crons.weekly`. See Pitfall 2: the guidelines line is stale/conflicting; repo precedent wins, and `crons.weekly` is fully typed and supported in 1.42.1. |
| Enumerating tenants by full-table `.collect()` on `vaultDocuments` | Add `.index("by_kind", ["kind"])` to `vaultDocuments` | The index costs one schema line and no migration; the `.collect()` reads every document's `text` blob (see Pitfall 1). Recommended: add the index. |
| Enumerating tenants from `gmailTokens` (tiny table, the `flagExpiringTokens` precedent) | — | **Rejected:** couples proactivity to the mailbox, which is the exact dependency SC#2 exists to sever. Also wrong semantics (CONTEXT locks *onboarded ⇒ reviewed*). |
| Post-hoc patch of the evaluation row with `delta` | Compute `delta` inside `runEvaluation` and pass it to `insertEvaluation` | The patch is a second write to a table documented as append-only and needs an extra `lastForThread` re-read. In-engine computation is strictly cheaper and keeps `insertEvaluation` the one write surface. See Pitfall 3. |

**Installation:** none. No new dependency.

## Architecture Patterns

### Recommended Layout

```
packages/backend/convex/
├── crons.ts                     # +1 line: crons.weekly("proactive-review", …)
├── proactiveReview.ts           # NEW — runWeekly (internalMutation) + reviewOne (internalAction)
├── proactiveReview.test.ts      # NEW — behavior (convex-test) + static SC#2/SC#3 guards
├── evaluations.ts               # delta computation + insertEvaluation gains `delta`
└── schema.ts                    # evaluations.delta (optional); vaultDocuments by_kind index
apps/web/app/(app)/
├── dashboard/workspace/page.tsx # pinned tab, composer suppression on the review thread
├── dashboard/workspace/cards.tsx# dated header, delta line, profile link, pre-first-run empty state
└── _components/NotificationsBanner.tsx  # click destination per kind
docs/playbooks/watch.json        # register proactiveReview.ts (see Pitfall 8)
```

### Pattern 1: Cron → fan-out mutation → per-tenant action

**What:** A cheap `internalMutation` enumerates work and schedules one `internalAction` per unit.
**When to use:** Any per-tenant recurring job. The mutation stays inside one fast transaction; each
unit gets its own transaction so a failure is isolated.
**Why it matters here:** `runEvaluation` is an `internalAction` (it calls `vaultGroundHydrated`,
which hits the network). A mutation **cannot** call an action inline — `ctx.scheduler.runAfter(0, …)`
is the only legal seam, so this shape is forced, not chosen.

```typescript
// Verified precedent: convex/notifications.ts:notify (mutation → runAfter(0) → notifyExternal.dispatch)
export const runWeekly = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const tenantId of await enrolledTenants(ctx)) {
      await ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne, { tenantId });
    }
  },
});
```

### Pattern 2: Direct `notifications` insert (the no-OAuth bypass)

**What:** Insert the row into `notifications` directly; never call `notifications.notify`.
**Why:** `notify` unconditionally runs `ctx.scheduler.runAfter(0, internal.notifyExternal.dispatch, …)`,
and `dispatch` calls `freshAccessToken(ctx, tenantId)` → the Gmail refresh path. **Verified source,
`notifications.ts:notify`** — there is no conditional around the schedule.

```typescript
// Verified precedent: convex/gmailAuth.ts:169 flagExpiringTokens
await ctx.db.insert("notifications", {
  tenantId,
  kind: "weekly_review",           // deliberately NOT in NOTIFICATION_KINDS
  message: "Your weekly business review is ready.",  // static, §4-clean
  read: false,
  createdAt: Date.now(),
});
```

**Defence in depth (verified):** even if a future refactor routed this through `notify`, `dispatch`
returns at `if (!KINDS.has(kind)) return;` — line 35 of `notifyExternal.ts`, **before**
`freshAccessToken` on line 39. So an unregistered kind is a second, independent barrier. Both must be
asserted by the guard test; neither alone is the guarantee.

### Pattern 3: Explicit-`tenantId` internal twin

**What:** Any function reachable from a cron takes `tenantId: v.string()` as an explicit validated
arg and uses it in every `withIndex(...)`. Verified convention: `runEvaluation`, `lastForThread`,
`insertEvaluation`, `profileSeedDocs`, `recordScorecardAnswerInternal` all do exactly this.
**Why:** `tenantQuery`/`tenantMutation` from `lib/functions.ts` call `requireTenant`, which needs
`ctx.auth`. A cron has no identity — those wrappers are structurally uncallable.

### Pattern 4: Static source-scan guard test

Two working idioms exist; **prefer the first** because it runs in the default `edge-runtime`
environment and therefore coexists in ONE file with the convex-test behaviour tests:

```typescript
// Idiom A — importGuard.test.ts (edge-runtime, no node:fs)
const sources = import.meta.glob("./**/*.ts", { query: "?raw", import: "default", eager: true })
  as Record<string, string>;
const src = sources["./proactiveReview.ts"]!;
expect(src).not.toMatch(/from\s+["']\.\/(gmail|notifyExternal)["']/);
expect(src).not.toMatch(/notifications\.notify/);
```

```typescript
// Idiom B — llmRedaction.test.ts: `// @vitest-environment node` + readFileSync.
// File-level pragma → forces a SEPARATE test file if you also want convex-test behaviour tests.
```

### Anti-Patterns to Avoid

- **Adding `"weekly_review"` to `NOTIFICATION_KINDS`.** It would (a) arm the Gmail dispatch path and
  (b) break `packages/core/src/notificationTemplates.test.ts:36`, which asserts the kind list equals
  an exact expected array. The absence is the guarantee.
- **Calling `notifications.notify` "just for consistency."** See Pattern 2.
- **A second `review.delivered` audit row.** `evaluation.ran` already covers it (locked decision).
- **Per-week thread ids.** Breaks Scorecard carry-forward (locked decision, and mechanically true:
  `lastForThread` is indexed on `(tenantId, threadId)`).
- **Rendering the composer on the review tab.** See Pitfall 4 — it throws.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recurring schedule | A polling loop / self-rescheduling action | `crons.weekly` in `crons.ts` | First-party, deploy-time registered, survives restarts, visible in the Convex dashboard |
| Per-tenant isolation of a failure | try/catch around a serial loop | `ctx.scheduler.runAfter(0, …)` per tenant | Each gets its own transaction + Convex's own retry/visibility; a serial loop shares one 1s-user-code budget |
| The review content | Any new assessment logic | `internal.evaluations.runEvaluation` unchanged | The engine is Phase-12-verified and eval-gated (`cockpit-agent@15`, 27/27) |
| The review card | A new card component | `EvaluationCard` + `evaluations.byThread` | Already handles healthy / gaps / not-enough-data / confidence chips / citations |
| Deep-link routing | A new `/dashboard/review` route | `?thread=<id>` on `/dashboard/workspace` (page.tsx:165-169) | Built for VOIC-04, already reads on mount |
| "What changed" storage | A separate deltas table | Optional `delta` field on `evaluations` | Optional field = no migration (repo standing rule, schema.ts:139 precedent) |
| Manual test trigger | A dev-only UI button | Convex dashboard function runner on `internal.proactiveReview.runWeekly` with `{}` | Exercises the real production path incl. fan-out (locked decision) |

**Key insight:** this phase's only genuinely new code is ~60 lines of orchestration in one backend
module plus four small UI edits. Anything larger than that is a signal that something is being
rebuilt rather than reused.

## Common Pitfalls

### Pitfall 1: `vaultDocuments` has no `kind` index — the tenant enumerator can blow the read limit

**What goes wrong:** `ctx.db.query("vaultDocuments").collect()` loads every row *including the `text`
field*, which holds full extracted document text. Convex caps a transaction at **32,000 documents
scanned and 16 MiB of data read** (docs.convex.dev/production/state/limits, verified). This repo has
already been bitten by exactly this table holding a 300-page book (see `evaluations.ts:194-198` and
the 12-06 `f5c279e` fix). Ten such uploads across the beta cohort reaches 16 MiB.

**Why it happens:** `vaultDocuments` only has `by_tenant` and `by_tenant_contentHash` (verified,
schema.ts:598-599). There is no way to filter on `kind` at the index level, and `.filter()` in Convex
still *reads* every row it filters.

**How to avoid:** add `.index("by_kind", ["kind"])` to `vaultDocuments` and enumerate with
`withIndex("by_kind", q => q.eq("kind", "business_profile"))`. Profile docs are short serialized
markdown, so the read stays bounded regardless of how many books a tenant uploads. Adding an index to
an existing Convex table backfills automatically — no migration, consistent with the repo's
"optional fields → no migration" discipline.

**Warning signs:** `runWeekly` latency growing with vault size rather than tenant count; a
`ReadLimitExceeded`/"too much data read" error in the cron's dashboard log.

**Also note:** `onboarding.status` and `currentProfileDoc` both already do `by_tenant` + `.collect()`
+ in-memory `kind` filter — the same anti-pattern, but bounded to ONE tenant, so it is out of scope
here. Don't "fix" them; that is a different phase's problem.

### Pitfall 2: the repo's own Convex guidelines forbid `crons.weekly`

**What goes wrong:** `packages/backend/convex/_generated/ai/guidelines.md:287` states *"Only use the
`crons.interval` or `crons.cron` methods to schedule cron jobs. Do NOT use the `crons.hourly`,
`crons.daily`, or `crons.weekly` helpers."* An agent reading `packages/backend/CLAUDE.md` (which says
"always read guidelines.md first") may refuse the locked design or silently switch to a cron string.

**Resolution (evidence-based):** the guidance is stale relative to this repo. `crons.daily` is used
twice in the live `crons.ts`, and `crons.weekly` is a fully-typed, non-deprecated public API in
convex@1.42.1 (`WeeklySchedule`, `CronJobs.weekly<FuncRef>` — verified in
`convex/dist/esm-types/server/cron.d.ts:32-36,249`). CONTEXT.md locks `crons.weekly`. **Use
`crons.weekly`** and add a one-line comment noting the guidelines conflict and the repo precedent, so
the next agent doesn't re-litigate it.

**Confidence:** HIGH that `crons.weekly` works; MEDIUM on *why* the guidelines say otherwise (likely a
generic Convex-authored file predating helper stability, not a repo decision).

### Pitfall 3: `dayOfWeek` must be lowercase — the JSDoc example is wrong

**What goes wrong:** the JSDoc in `cron.d.ts:236` shows `dayOfWeek: "Tuesday"`. The runtime validator
is `if (!DAYS_OF_WEEK.includes(s)) throw new Error('Day of week must be a string like "monday".')`
with `DAYS_OF_WEEK = ["sunday","monday",...]` — **lowercase only** (verified in
`convex/dist/esm/server/cron.js:8-33`). A capitalised day throws at module load, i.e. the whole
deployment's cron registration fails.

**How to avoid:** `dayOfWeek: "monday"` exactly as CONTEXT.md specifies. TypeScript catches it too
(`DayOfWeek` is a literal union), but only if the object isn't widened by a helper.

### Pitfall 4: `runEvaluation` does not return the row — CONTEXT's delta plan needs a correction

**What goes wrong:** CONTEXT.md says the delta is "computed at WRITE time by the cron (which already
holds `prev` from carry-forward and `next`)". Verified false: `runEvaluation` returns
`{ verdict, findingCount, gapCount }` only (evaluations.ts:365) and inserts the row internally. The
cron holds neither `next` nor the new row's id, and cannot store a `delta` without a second read plus
a `patch` of the append-only `evaluations` table.

**How to avoid (recommended):** compute the delta **inside `runEvaluation`**. At line ~328 it already
holds `last` (the prev row, read at line 166) and the freshly-built `findings`/`gaps` arrays in the
same scope — the delta is pure arithmetic over values already in memory, costing zero extra reads and
zero extra writes, and it flows straight into `insertEvaluation` which stays the single write surface.

Gate it so on-demand runs stay delta-free per the locked decision. Two clean options:
- add `withDelta: v.optional(v.boolean())` to `runEvaluation.args` — only the cron passes `true`; or
- always compute it when `last` exists (first runs naturally have none). Simpler, but an on-demand
  re-run in the same thread would then show a delta line. Given the known repeat-evaluation
  provenance defect (STATE.md Pending Todos), same-thread re-runs are already discouraged, so this is
  low-impact — but the explicit flag is more honest about intent.

**Then also:** the "notify only on change" decision needs `prevVerdict` + the delta at the cron. Add
them to `runEvaluation`'s return value — the only non-test caller (`llm.ts:1400`) destructures
`{ verdict, findingCount, gapCount }`, so extra return fields are non-breaking (verified: the only
other callers are `evaluations.test.ts` and `gapAction.test.ts`). This avoids a second
`lastForThread` round-trip in the cron.

### Pitfall 5: `diagnose()` returns exactly ONE prescription — `gaps.length` is 0 or 1

**What goes wrong:** the locked delta shape `{ newFindings, gapsClosed: string[], gapsOpened: string[] }`
implies multi-gap set arithmetic. Verified: `diagnose()` has a single return per gate branch, and
`runEvaluation` calls `leverageRank([prescription])` — **one element** (evaluations.ts:284-285). So
each array is always length 0 or 1, and "2 new findings · 1 gap closed · 1 new gap" is the maximum
possible sentence.

**Second, sharper problem:** keying on `gap.route` cannot distinguish prescriptions. There are only
**three** routes in the entire diagnose surface — `offer-architect`, `money-model-designer`,
`lead-engine` — and multiple distinct prescriptions share each one (verified: `offer-architect` at
diagnose.ts:41/58/68; `money-model-designer` at 101/111/121/131). A tenant moving from "No offer worth
buying yet" (`offer-architect`/`02-build-offer`) to "Offer is a commodity"
(`offer-architect`/`03-enhance-offer`) is **real progress that a route-keyed delta reports as
no change**.

**How to avoid:** key on the pair `` `${route}/${playbook}` ``. `playbook` is an equally bounded,
code-owned string literal (`01-select-market`, `02-build-offer`, `06-assemble`, …) — never LLM prose,
so CONTEXT's stated objection to `label` does not apply to it. The pair still collides in two cases
(`money-model-designer/06-assemble` at :112 and :122; `money-model-designer/01-assess-money-model` at
:102 and :132), but those are genuinely adjacent diagnoses within the same gate, so treating them as
"unchanged" is defensible. Keep the locked array shape — it survives a future multi-prescription
`diagnose()` for free — just populate it from the pair, not the bare route.

**Note also:** `route` is `""` on the `ask` branch (diagnose.ts:84), but that branch produces a
`notEnoughData` entry rather than a gap (evaluations.ts:289-291), so no empty routes reach `gaps[]`.

### Pitfall 6: the pinned review tab feeds a fake `threadId` into the composer, which throws

**What goes wrong:** `WorkspacePage` passes `threadId` into `ChatPane`, whose composer calls
`api.cockpit.sendCockpitMessage({ threadId, text })`. That action does
`const plan = await ctx.runQuery(api.plans.byThread, { threadId: tid }); if (!plan) throw new Error("cockpit: plan row missing for thread");`
(cockpit.ts:92-93, verified). The synthetic review thread has **no `plans` row**, so any message typed
on the review tab throws — an unhandled error at the most visible surface in the product.

**Good news (verified):** *reading* degrades gracefully. `listThreadMessages` (cockpit.ts:332) returns
`{ page: [], isDone: true, continueCursor: "" }` when the ownership `plans` lookup misses — no throw.
Likewise `plans.byThread` and `briefings.byThread` return null, so `CardList` renders only
`EvaluationCard`. And `cockpit.listThreads` reads agent-component threads, so the review thread is
**automatically absent from "Past chats"** — the locked decision comes for free with zero code.

**How to avoid:** in `WorkspacePage`, branch the left pane on the review thread id and render a short
explainer instead of `ChatPane` (e.g. "This is your weekly review. Start a new chat to act on it.").
Do **not** try to make `sendCockpitMessage` tolerate a missing plan row — that guard protects the real
cockpit.

### Pitfall 7: `NotificationsBanner` has no click-through mechanism today

**What goes wrong:** CONTEXT's integration list says the banner "renders the new kinds and their
click destinations". Verified: the banner renders `{n.message}` as plain text plus a Dismiss button —
there is **no** `<Link>`, no per-kind destination map, and no `href` anywhere in the component. The
deep-link is therefore new UI work, not a config change.

**How to avoid:** the sibling `ReconnectBanner` is the precedent for a kind-specific CTA (`<Link
href="/connect-gmail">Reconnect</Link>`). Either (a) add a small `KIND_HREF: Record<string, string>`
map in `NotificationsBanner` and render the message as a `<Link>` when the kind has an entry — the
laziest change and it generalises to future kinds — or (b) follow `ReconnectBanner` and add a
dedicated banner. (a) is recommended.

**Also note:** the banner filters out `gmail_reconnect` explicitly and renders everything else. It is
an **exclude-list, not an allow-list**, so the new kinds will render with zero changes; only the
click destination is new work.

### Pitfall 8: the playbook Stop hook will block the phase

**What goes wrong:** `scripts/check-playbooks.mjs` blocks a turn that leaves new code files under
`packages/`/`apps/` uncovered by any playbook, and blocks changing a watched path without touching
its playbook. Verified against `docs/playbooks/watch.json`:

| File touched | Playbook that must be updated |
|---|---|
| `convex/crons.ts`, `convex/notifications.ts`, `_components/NotificationsBanner.tsx`, `core/src/notificationTemplates.ts` | `audit-dead-letter.md` |
| `convex/evaluations.ts`, `convex/evaluations.test.ts` | `business-evaluation.md` |
| `apps/web/app/(app)/dashboard/workspace/` (page.tsx, cards.tsx) | `cockpit.md` |
| **`convex/proactiveReview.ts` (NEW)** | **unregistered → hook blocks** |

**How to avoid:** register `packages/backend/convex/proactiveReview.ts` (and its test) in
`watch.json`, most naturally under `business-evaluation.md`. Bump every touched playbook's
`Last verified` line in the same commit, and document the dashboard `runWeekly` invocation there
(locked decision).

### Pitfall 9: Convex type-inference cycles on new cross-module internal calls

**What goes wrong:** `proactiveReview.ts` imports `internal` and calls into `evaluations`,
`notifications`/`db`, which can collapse TypeScript's inference of the whole internal API graph. This
repo has hit it before — see the explicit ponytail note in `gmailAuth.ts:164-167` about a
`gmailAuth⇄internal` cycle collapsing `llm.ts`'s inference, and `notifyExternal.dispatch`'s comment:
*"Explicit `Promise<void>` return keeps this action out of the internal-graph inference cycle (Convex
guidelines §96)."*

**How to avoid:** annotate `reviewOne`'s handler return type explicitly (`Promise<void>`), and
annotate the result of every `ctx.runAction`/`ctx.runQuery` call. `runEvaluation` already does this
for its own internal calls.

**Warning signs:** `pnpm typecheck` suddenly reporting `any`/"implicitly has type 'any' because it
does not have a type annotation and is referenced directly or indirectly in its own initializer" in a
module you did not touch (typically `llm.ts`).

### Pitfall 10: convex-test needs the aggregate component registered

**What goes wrong:** `runEvaluation` writes an `evaluation.ran` audit row, which hits the
`auditCounts` aggregate component. Under `convex-test` this throws "component not registered" unless
the component schema is registered.

**How to avoid:** copy `evaluations.test.ts:26-31`'s `newTest()` helper verbatim (it registers
`aggregateSchema` via the relative `../node_modules/@convex-dev/aggregate/src/component/schema.js`
import). Any test that drives `reviewOne` needs this.

## Code Examples

### Verified: the direct-insert cron mutation (the exact pattern to copy)

```typescript
// Source: packages/backend/convex/gmailAuth.ts:169 (verified in repo)
export const flagExpiringTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const row of await ctx.db.query("gmailTokens").collect()) {
      const refreshExpiresAt = row._creationTime + REFRESH_TOKEN_TTL_MS;
      if (!isExpiringSoon(refreshExpiresAt, now)) continue;
      await ctx.db.insert("notifications", {
        tenantId: row.tenantId,
        kind: "gmail_reconnect",   // NOT in NOTIFICATION_KINDS → dispatch is unreachable
        message: "Your Gmail connection is about to expire — reconnect to keep delivery running.",
        read: false,
        createdAt: now,
      });
    }
  },
});
```

### Verified: the barrier that makes an unregistered kind safe

```typescript
// Source: packages/backend/convex/notifyExternal.ts:33-40 (verified in repo)
handler: async (ctx, { tenantId, kind }): Promise<void> => {
  try {
    if (!KINDS.has(kind)) return;         // ← returns HERE, before any token work
    const k = kind as NotificationKind;
    const access = await freshAccessToken(ctx, tenantId);   // ← never reached for weekly_review
    if (!access.ok) return;
```

### Verified: existing cron registration to extend

```typescript
// Source: packages/backend/convex/crons.ts (verified in repo)
const crons = cronJobs();
crons.daily("worm-export", { hourUTC: 3, minuteUTC: 0 }, internal.worm.exportAudit, {});
crons.daily("gmail-token-expiry-scan", { hourUTC: 4, minuteUTC: 0 }, internal.gmailAuth.flagExpiringTokens, {});
export default crons;
```

### Verified: `crons.weekly` type surface (convex 1.42.1)

```typescript
// Source: convex/dist/esm-types/server/cron.d.ts:32-36, 249
export type WeeklySchedule = {
  type: "weekly";
  dayOfWeek: DayOfWeek;   // "sunday" | "monday" | ... — LOWERCASE ONLY
  hourUTC: number;
  minuteUTC: number;
};
weekly<FuncRef extends SchedulableFunctionReference>(
  cronIdentifier: string, schedule: Weekly, functionReference: FuncRef, ...args: OptionalRestArgs<FuncRef>
): void;
```

### Verified: the graceful-degradation read the pinned tab relies on

```typescript
// Source: packages/backend/convex/cockpit.ts:332-343 (verified in repo)
export const listThreadMessages = tenantQuery({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { threadId, paginationOpts }) => {
    const owns = await ctx.db.query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .unique();
    if (!owns) return { page: [], isDone: true, continueCursor: "" };  // ← no throw
    return await listMessages(ctx, components.agent, { threadId, paginationOpts });
  },
});
```

### Verified: scheduled-function completion in tests

```typescript
// Source: packages/backend/convex/cockpit.test.ts:331 (verified in repo)
await t.mutation(internal.proactiveReview.runWeekly, {});
await t.finishInProgressScheduledFunctions();   // drains the per-tenant reviewOne fan-out
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Proactive delivery via email/Gmail | In-app `notifications` row + card | Phase 7 (`flagExpiringTokens`, DLVR-03) | The precedent already exists — this phase is the second user of it, not the first |
| Per-thread evaluation only on demand | Scheduled per-tenant evaluation on a stable thread | This phase | Carry-forward semantics make the stable thread mandatory, not stylistic |

**Deprecated/outdated:**
- `_generated/ai/guidelines.md:287`'s ban on `crons.weekly` — contradicted by repo precedent and by
  the shipped convex@1.42.1 API. See Pitfall 2.
- The JSDoc `dayOfWeek: "Tuesday"` example — contradicted by the runtime validator. See Pitfall 3.

## Open Questions

1. **Should the delta be computed inside `runEvaluation` or by the cron?**
   - What we know: the cron does not have `next` (verified); in-engine computation is free.
   - What's unclear: whether CONTEXT's "computed by the cron" is a load-bearing decision or just a
     description of *when* it happens (it reads as the latter — the substance is "computed at write
     time, stored on the row, card stays dumb", all of which in-engine computation preserves).
   - Recommendation: compute in `runEvaluation` behind an optional `withDelta` arg. Flag the
     deviation explicitly in the plan so the owner can veto.

2. **`route` vs `route/playbook` as the delta key.**
   - What we know: three routes total, multiple prescriptions per route (verified in diagnose.ts).
   - What's unclear: whether the owner considered that route-only reports real progress as "no change".
   - Recommendation: use `` `${route}/${playbook}` ``; keep the locked array field names.

3. **Is a `by_kind` index on `vaultDocuments` acceptable, or should the enumerator accept the
   full-table read at beta scale?**
   - What we know: the limits are 32k docs / 16 MiB per transaction (HIGH confidence, official docs);
     this table holds book-sized text blobs (observed live in Phase 12).
   - Recommendation: add the index. One schema line, no migration, removes a class of failure whose
     symptom would be "the weekly review silently stopped running".

4. **Notification kind naming.**
   - `weekly_review` / `weekly_review_failed` are CONTEXT's working names. They must stay out of
     `NOTIFICATION_KINDS`; no other constraint applies. Not blocking.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^3.2.7 + convex-test 0.0.54 |
| Config file | `packages/backend/vitest.config.ts` (env `edge-runtime`, include `convex/**/*.test.ts`, no watch mode) |
| Quick run command | `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts` |
| Full suite command | `pnpm test` (turbo, all packages) |
| Web typecheck | `pnpm --filter @pikar/web typecheck` |
| Playbook gate | `node scripts/check-playbooks.mjs` (Stop hook — must exit 0) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BEVL-03 (SC#1) | `runWeekly` enumerates only tenants with a `business_profile` doc and schedules one `reviewOne` each | unit (convex-test) | `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts -t "enumerates"` | ❌ Wave 0 |
| BEVL-03 (SC#1) | After `runWeekly` + `finishInProgressScheduledFunctions`, an `evaluations` row exists on the review thread AND a `notifications` row exists | unit (convex-test) | `… -t "writes a review card and a notification"` | ❌ Wave 0 |
| BEVL-03 (SC#1) | Notify-on-change: an unchanged second week writes the evaluation row but NO new notification | unit (convex-test) | `… -t "notifies only on change"` | ❌ Wave 0 |
| BEVL-03 (SC#2) | `proactiveReview.ts` imports neither `./gmail` nor `./notifyExternal`, and never references `notifications.notify` | static source scan | `… -t "no mailbox token"` (Idiom A, same file) | ❌ Wave 0 |
| BEVL-03 (SC#2) | `"weekly_review"` and `"weekly_review_failed"` are absent from `NOTIFICATION_KINDS` | unit (pure) | `pnpm --filter @pikar/core test` or asserted in the same guard test | ❌ Wave 0 |
| BEVL-03 (SC#3) | Every `ctx.db.query(...)` in `proactiveReview.ts` is followed by a `withIndex` whose first `eq` is `tenantId` (except the deliberate `by_kind` enumerator, which is asserted by name) | static source scan | `… -t "tenant-scoped"` | ❌ Wave 0 |
| BEVL-03 (SC#3) | Tenant A's cron run writes no row readable by tenant B (`byThread` under tenant B returns null) | unit (convex-test) | `… -t "cross-tenant"` | ❌ Wave 0 |
| BEVL-03 (SC#3) | The audit row written by the run is the existing `evaluation.ran` and its payload contains only counts/enums | unit (convex-test) | already covered by `evaluations.test.ts`; assert no *additional* audit eventType appears | ⚠️ extend `proactiveReview.test.ts` |
| Delta | `delta` is absent on a first run and present with the expected route/playbook diff on a second | unit (convex-test) | `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts -t "delta"` | ⚠️ extend `evaluations.test.ts` |
| UI | Pinned review tab renders the card and does NOT render the composer | manual-only | Convex dashboard `runWeekly {}` → open `/dashboard/workspace` | — |

**Manual-only justification:** the workspace has no component-test harness (only Playwright e2e under
`apps/web/e2e/`, which requires a live deployment + auth). The locked verification is the dashboard
function-runner invocation; a Playwright spec for a cron-produced card would need seeded backend state
and is not worth the fixture cost this phase.

### Sampling Rate

- **Per task commit:** `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts convex/evaluations.test.ts` (< 30 s)
- **Per wave merge:** `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/web typecheck` + `node scripts/check-playbooks.mjs`
- **Phase gate:** `pnpm test` (full turbo suite) green, plus the dashboard `runWeekly {}` live run, before `/gsd:verify-work`

**Known baseline:** the backend suite has ONE pre-existing failure (recorded at 12-05: 474/475). Do
not treat it as a regression.

### Wave 0 Gaps

- [ ] `packages/backend/convex/proactiveReview.test.ts` — covers BEVL-03 SC#1/SC#2/SC#3. Must use the
      `newTest()` helper from `evaluations.test.ts:26-31` (registers the `auditCounts` aggregate
      component) and Idiom A (`import.meta.glob("?raw")`) so the static guards live in the same
      edge-runtime file as the behaviour tests.
- [ ] `docs/playbooks/watch.json` — register `packages/backend/convex/proactiveReview.ts` and
      `proactiveReview.test.ts` under `business-evaluation.md`, or the Stop hook blocks the phase.
- [ ] No framework install needed — vitest + convex-test are already present and configured.

## Sources

### Primary (HIGH confidence)

- **Repo source, read directly:** `packages/backend/convex/crons.ts`, `gmailAuth.ts:150-205`,
  `notifications.ts` (full), `notifyExternal.ts:1-70`, `evaluations.ts:85-384,590-612`,
  `vault.ts:455-495`, `onboarding.ts:110-160,240-262`, `cockpit.ts:72-120,318-370`,
  `llm.ts:1373-1450`, `schema.ts:315-400,501-600`, `importGuard.test.ts`, `llmRedaction.test.ts:1-45`,
  `evaluations.test.ts:1-75`, `vitest.config.ts`
- **Repo source, web:** `apps/web/app/(app)/dashboard/workspace/page.tsx` (full),
  `cards.tsx:1378-1502`, `_components/NotificationsBanner.tsx` (full), `_components/ReconnectBanner.tsx`
- **Pure core:** `packages/core/src/notificationTemplates.ts` (full), `growth/diagnose.ts:20-160`
- **convex@1.42.1 shipped typings/runtime:** `convex/dist/esm-types/server/cron.d.ts`,
  `convex/dist/esm/server/cron.js` (DAYS_OF_WEEK validator)
- **Official docs:** https://docs.convex.dev/production/state/limits — 32,000 documents scanned,
  16 MiB read, 16 MiB written, 16,000 documents written, 1 s user-code execution, 1000 scheduled
  functions per mutation, 4 MiB per scheduled-function args
- **Repo governance:** `CLAUDE.md` §1-§10, `docs/playbooks/watch.json`,
  `packages/backend/convex/_generated/ai/guidelines.md:248,287-312`
- **Planning:** `.planning/phases/13-proactive-in-app-review/13-CONTEXT.md`, `.planning/STATE.md`,
  `.planning/REQUIREMENTS.md:120-122,240-242`, `.planning/config.json`
- **graphify** knowledge graph (`graphify query "how does runEvaluation work…"`) — used to locate
  `evaluations.ts` symbol offsets before reading

### Secondary (MEDIUM confidence)

- The claim that `_generated/ai/guidelines.md`'s `crons.weekly` ban is stale rather than a repo
  decision — inferred from the file being Convex-authored codegen output (`ai-files.state.json`
  sibling), plus contradicting live repo usage. The *conclusion* (use `crons.weekly`) is HIGH; the
  *explanation* is MEDIUM.

### Tertiary (LOW confidence)

- None. No finding in this document rests on unverified web search.

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — no new dependency; every module verified by direct source read
- Architecture: **HIGH** — every pattern has a working in-repo precedent that was read, not assumed
- Pitfalls 1, 3, 4, 5, 6, 7, 8, 10: **HIGH** — each verified against specific source lines quoted above
- Pitfall 2: **HIGH** on the recommendation, **MEDIUM** on the root-cause explanation
- Pitfall 9: **MEDIUM** — the failure mode is documented in-repo (`gmailAuth.ts:164-167`,
  `notifyExternal.ts:27-28`) but whether *this* module triggers it can only be confirmed by running
  `pnpm typecheck` after the module exists
- Validation architecture: **HIGH** — config file and helper idioms read directly

**Research date:** 2026-07-25
**Valid until:** 2026-08-24 (30 days — the stack is pinned and internal; the only external dependency
is Convex platform limits, which are stable)
