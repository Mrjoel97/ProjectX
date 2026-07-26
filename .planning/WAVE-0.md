# Wave 0 — the freeze commit (Phases 14 + 15)

**Executed by:** ONE session, on `main`, at Stage 1 of `.planning/PARALLELIZATION.md`.
**Precondition:** Lane A's Phase-15 plans and Lane C's Phase-14 plans are both written AND merged
to `main`. Wave 0 reads both plan sets; it cannot be executed before they exist.
**Written:** 2026-07-25 (ahead of time, so the day itself is mechanical).

---

> # ⚠ STATUS 2026-07-25 — PARTLY SUPERSEDED. Do NOT execute this as a Stage-1 sequence.
>
> This doc was written expecting Stage 0 to be planning-only. It was overtaken within hours:
> **both lanes absorbed the freeze into their own phase plans and are executing.**
> Lane A is on `15-05` (executor generalization, plan 5 of 6); Lane C is past `14-01` and has
> already widened the `evaluations` schema on its branch.
>
> | § | Revised status |
> |---|---|
> | **§C** plan-derived (schema, stubs, seams, lane table) | **SUPERSEDED.** Lane A's `15-01` did its own freeze; Lane C's `14-01` widened `evaluations`. Both on branches, not `main`. Nothing to execute here |
> | **§A** facts split | **Re-scoped to POST-INTEGRATION.** Do not land on `main` while lanes are mid-flight |
> | **§B** `proofMetricPath` | Same — rides with §A |
> | **§D** cron hardening | **Re-derive before applying.** The claim that `proactiveReview.ts` is unowned is now FALSE — Lane C edited `reviewOne`, the exact function §D.4 targets |
>
> **The Monday-06:00-UTC migration deadline in §A is DOWNGRADED.** It was right in principle and
> wrong in proportion: at one tenant the cron writes one row per week, so missing it costs the
> ~20-line backfill §A already prices — not a project. That is not worth disrupting two live lanes.
> It becomes a real deadline only at scale, which is months out. Re-check row count at integration.
>
> **Region-disjointness still holds** (the reason §A survives intact): Lane C added a `framework`
> literal and `findings[].citationExcerpt`; §A touches `scorecard` and `userProvided`. No overlap.
>
> **Known merge hazard:** `PARALLELIZATION.md` is now edited in THREE places — `main` (Phase-15.1
> constraint + this doc's pointer), Lane A (finalized lane table), Lane C (a recorded deviation).
> Per the contract's own singleton rule, **keep all sides** at merge; do not pick one.
>
> Everything below is unchanged from the original write-up and is still the reference for **what**
> §A/§B/§D should do and why — only **when** changed.

---

## What Wave 0 is for

After this commit, `convex/schema.ts`, `convex/llm.ts` and `convex/deliverApprovedPlan.ts` are
FROZEN to their owning lane. Wave 0 is the last moment shared files can be changed, so it lands
everything all three lanes need and everything that would otherwise fight the freeze:

1. every schema field/table either phase needs (§C, from the plans),
2. an empty stub file for every module a lane owns (§C, from the plans),
3. the seams as no-op passthroughs (§C, from the plans),
4. **the evaluations data-model split** (§A) — unrelated to 14/15, but it is a `schema.ts` change
   and `schema.ts` is about to be frozen for the length of three lanes,
5. one free optional field (§B) that makes a later phase pure logic.

§D (cron hardening) is a **sibling commit**, not part of Wave 0 — see below.

---

## §A — The evaluations data-model split (plan-independent; write it now)

### Why it is in Wave 0 and not its own phase

`evaluations` today stores **facts** (the scorecard — high churn, patched in place on every
in-conversation answer) in the SAME document as **conclusions** (findings/gaps/verdict — written
once per run). That violates two documented Convex rules:

- `convex/_generated/ai/guidelines.md:159` — *"Do not store unbounded lists as an array field
  inside a document… every update rewrites the entire document."*
- `:160` — *"Separate high-churn operational data from stable profile data. Storing frequently
  updated fields on a shared document forces every write to contend with reads of the entire
  document."*

Today one user answering *"our CAC is 340"* rewrites a document containing every finding, every
gap and the whole scorecard, and can contend with the weekly cron writing the same row.

### There is no migration

`crons.ts:30` schedules `proactive-review` for **Monday 06:00 UTC**; `proactiveReview.ts` was
committed **Sat 2026-07-25** (`0cb48f6`). The cron had not fired when this was written. The only
`evaluations` rows are on-demand ones from owner testing.

**Verify before executing** (the deployment config was not loadable from the main checkout when
this was written):

```
cd packages/backend && npx convex data evaluations
```

- Few/no rows → **discard, no migration.** Precedent: the 2026-07-21 tenant-scope fix was resolved
  discard-no-migration deliberately.
- Owner wants the stated figures kept → a one-shot `internalMutation` that reads the latest row
  per tenant, inserts one `businessFacts` row per non-null path, and is deleted in the same phase.
  ~20 lines. Do NOT reach for `@convex-dev/migrations` at this data volume.

### Blast radius — VERIFIED CONTAINED

`grep` for `.scorecard` / `userProvided` across `packages/backend/convex`, `apps/web` and
`packages/core` returns hits in **`evaluations.ts` only** (plus two `schema.ts` comments).
No UI change. No other Convex module. No package change. The evaluation card reads
findings/gaps/verdict/notEnoughData/delta and never the scorecard.

### The new table

```ts
// Append-only. ONE row per assertion — never patched, never deleted.
// The scorecard at any moment is a fold over these rows (latest statedAt wins per path).
businessFacts: defineTable({
  tenantId: v.string(),
  path: v.string(),                 // Scorecard dot-path, e.g. "financials.cac"
  value: v.union(v.number(), v.string(), v.boolean()),
  statedAt: v.number(),             // when the value was ASSERTED (not when a row was written)
  source: v.union(v.literal("user"), v.literal("vault")),
  sourceRef: v.optional(v.string()),// vaultDocuments id for a grounded fact; absent for user-stated
}).index("by_tenant_path", ["tenantId", "path"]),
```

### `evaluations` slims

Drop `scorecard` and `userProvided`. Everything else stays. The row becomes small, bounded and
**genuinely append-only** — which is what STATE.md has claimed since 13-01.

### The write semantics — first-write-wins becomes change-detection

This is the load-bearing part. Persist a fact **only when the derived value differs from the
folded value**:

- User states a figure → always a fact (`source: "user"`), it is a new assertion by definition.
- A run grounds a value out of the vault → write a fact ONLY if it differs from the current fold.
- A stable business writes **zero** fact rows per week (today it writes a full scorecard snapshot
  every week forever). Storage goes `O(tenants × weeks)` → `O(tenants × changes)`.

**A grounded fact must still be written** (not left ephemeral). If only user statements were
facts, a week where retrieval fails would drop previously-known values, flip the verdict, and
report a false "gap closed". Writing grounded values as facts preserves carry-forward through a
degraded run — the fold returns the last known value and the verdict stays stable. This is the
primary defence against the false-change problem; §D.5 is the second.

`user` beats `vault` on the same path at the same `statedAt` — a user's own figure is never
downgraded by a document. (This preserves the 13-02 provenance rule.)

### What gets DELETED (this change is a net subtraction)

| Delete | Location | Replaced by |
|---|---|---|
| The patch branch | `evaluations.ts:474-481` | one `db.insert` into `businessFacts` |
| The seed-carrier branch | `:483-495` | nothing — an insert is an insert, no special case |
| Deep-copy carry-forward | `:190-192` (`JSON.parse(JSON.stringify(...))`) | a fold over `by_tenant_path` |
| The provenance rebuild loop | `:194-204` | `source`/`sourceRef` are columns on the fact row |
| `userProvided[]` + its dedupe | `:476-478`, schema | implied by `source: "user"` |
| `scorecard` + `userProvided` args | `insertEvaluation` `:135-146` | removed from the mutation |

**Keep** `getPath`/`setPath` (`:90-97`) and `emptyScorecard` — the fold needs both, and `fillVault`
still uses them in-memory during a run. Only the *persistence* changes, not the derivation.

`applyScorecardAnswer` keeps its shape (one shared implementation behind both the tenant-scoped
`recordScorecardAnswer` and the identity-free `recordScorecardAnswerInternal` twin) — that
convention stays; only its body changes from patch to insert.

### Check left behind

`deriveTier`-style pure unit tests are not needed here, but ONE runnable check is:
the fold returns the latest value per path, `user` outranks `vault`, and a run with zero grounding
returns the SAME scorecard as the previous run (the degraded-run regression). Extend
`proactiveReview.test.ts`'s existing *"notifies only on change"* case rather than adding a file.

---

## §B — The free move: `gaps[].proofMetric` gains a path

Add an optional `proofMetricPath: v.optional(v.string())` beside the existing `proofMetric` prose
on the `gaps[]` object. **Nothing writes it in Wave 0.**

`proofMetric` today is human prose (`diagnose.ts:19`, e.g. *"market passes the 4 indicators"*) —
readable, not machine-checkable. Giving each prescription a scorecard dot-path is a domain-modelling
job across all five gates and belongs in its own later phase. But adding the *field* now, while
`schema.ts` is open, means that phase is pure logic with no schema change and no migration — with
`schema.ts` frozen and lanes running, that matters.

This is the pattern the repo already uses deliberately: *"Optional → pre-12-05 rows simply carry
none (append-only, no migration)"* — the same way `reason` and `proofMetric` themselves shipped.

Once §A + §B land, the outcome question — *"we prescribed X on date D; did the number move?"* —
is a **query** over `businessFacts`, not a feature: read the fact at `proofMetricPath` as of D,
read it now. No new table, no new writer, and it works retroactively over every fact ever recorded.

---

## §C — Plan-derived work (FILL IN when the two plan sets land)

Do not guess these. Read `.planning/phases/14-*/` and `15-*/` and fill each list, then finalise the
provisional lane table in `PARALLELIZATION.md` in this same commit.

- [ ] **Schema — Phase 15:** lineage fields (`rootRequestId`, `parentAgentId` — SC #3) + any
      dispatch/specialist rows. → _fill from plans_
- [ ] **Schema — Phase 14:** voice-doc rows. → _fill from plans_
- [ ] **Stub files:** one empty file per module each lane owns, so no lane creates a file another
      lane also creates. → _fill from plans_
- [ ] **Seam 1 — executor:** `deliverApprovedPlan.ts` dispatch-by-action-type `switch`, carrying
      ONLY today's email + memo arms as a no-op passthrough (Phase 15 SC #4).
- [ ] **Seam 2 — dispatch:** specialist-route lookup **failing closed to `unknown_route`** with
      zero specialists registered (Phase 15 SC #1).
- [ ] **Seam 3 — voice-doc:** IF Phase 14's plans need the grounded voice loop to touch `llm.ts`,
      export a seam here so Lane C never opens that file. If the plans show no `llm.ts` need,
      skip this and record that in the commit message.
- [ ] **Finalise** the Stage-2 lane table in `PARALLELIZATION.md` (currently marked PROVISIONAL).

---

## §D — Sibling commit: weekly-review hardening (NOT part of Wave 0)

`proactiveReview.ts` is owned by **no lane** (A = `llm.ts`, B = executor, C = voice), so these land
as their own commit on `main` during Stage 1. Defect repair on shipped code, not new scope.

1. **Paginate the fan-out.** `runWeekly:41-44` does `.collect()` over every `business_profile` doc,
   reading each doc's full text to extract a tenant id. Violates `guidelines.md:245`. At ~5 KB/doc
   against a 16 MiB transaction budget this dies near ~3,000 tenants — as a **cliff**, taking every
   tenant's review with it. Fix per `guidelines.md:248`: `.take(n)` + `scheduler.runAfter(0, self)`
   with a cursor. The `ponytail:` note at `:33` already names the better long-term shape (a small
   `onboarded` marker table) — take it if the plans make it cheap.
2. **Jitter the fan-out.** `:47` schedules every tenant at `runAfter(0)` — a thundering herd at one
   instant every Monday. `runAfter(i * ms)`.
3. **Consult the cost kill-switch.** `grep` of `runEvaluation` for
   `guardrail|killSwitch|recordSpend|rateLimit|budget` returns **nothing**. Each review runs a RAG
   search; the fan-out scales with tenant count and no cost gate is checked.
4. **Dead-letter the failures.** `reviewOne:95-103` is a bare `catch {}` that writes the user a
   `weekly_review_failed` notification and nothing else — zero `deadLetter` references on this path.
   Phase 7 built the DLQ for exactly this. §4 forbids the reason reaching the *notification* plane;
   the dead-letter table is the refs-safe place it belongs.
5. **Persist `groundedDocCount` on the row; suppress `delta` when it is 0.** The value is already
   computed for the audit at `:412` but never stored, so neither the card nor the delta can tell a
   degraded week from a real one. ~3 lines. With §A's fact-carry-forward this is belt-and-braces,
   but it is what lets the UI be honest about a degraded run.
6. **Optional, cheap:** a third notification kind for a regression. `gapsClosed` and `gapsOpened`
   both produce the identical `REVIEW_READY_MESSAGE` today. `kind` is a closed enum, not prose, so
   a `weekly_review_regression` kind is §4-safe.

Known limitation, do NOT chase: `newFindings` (`:381`) is a count difference, so offsetting changes
cancel. Findings have no code-owned key (the `:371` comment explains why gaps could be keyed and
findings could not). Leave it; note it if the outcome-ledger phase needs better.

---

## Verification gates (all must pass before any lane starts Stage 2)

- `pnpm test` in `packages/backend` — **known pre-existing red: `audit.test.ts` `auditCounts`**
  (documented since Phase 2, NOT a regression, do not chase).
- `pnpm test` in `packages/core`.
- `npx tsc --noEmit` in `packages/backend` — expect **+0 new errors** over the ~52 pre-existing
  test-file ones.
- `apps/web` typecheck.
- `node scripts/check-playbooks.mjs` exit 0 — §A touches `evaluations.ts`, so the playbook covering
  it must be updated and its `Last verified` line bumped **in this commit** (CLAUDE.md §9).
- `graphify update .` then `node scripts/extract-convex-edges.mjs` (CLAUDE.md graphify section).

**Watch for Pitfall 9.** Changing `insertEvaluation`'s args and `runEvaluation`'s return shape has
twice collapsed TypeScript's inference of the whole generated API graph. Keep the explicit named
return types and the explicit `Promise<void>` / local annotations at `evaluations.ts:172` and
`proactiveReview.ts:65-76`. A union return is what triggers it.

## Commit sequence

```
1. wave-0: schema + stubs + seams + evaluations facts split   (§A §B §C — ONE commit)
2. fix(proactive-review): pagination, jitter, DLQ, cost gate, groundedDocCount   (§D)
3. announce on main → lanes merge main → Stage 2 begins
```

## Wave 0 must NOT

- Register any specialist, or teach the router any tier (Phase 15 routes by NAME only; tier
  filtering is Phase 15.1 — see the Lane A constraint in `PARALLELIZATION.md`).
- Implement any lane's feature. Stubs and seams only — a lane must find its file empty, not half-done.
- Seed or activate any skill. Skill seeding is Lane A's exclusive property this phase
  (version-collision risk: `seedSkills` writes `maxVersion + 1` and optimizer candidates already
  occupy versions).
- Build an event-sourcing framework, a projections layer, or a metrics service. §A is ONE
  append-only table and a fold. If it grows past that, stop and re-scope.
- Split `findings`/`gaps` into their own tables. `guidelines.md:159` targets *unbounded* arrays;
  these are bounded and immutable. Leave them.
- Add a denormalised latest-per-path cache. A fold over ~30 paths is trivial.
  `ponytail:` if a tenant ever restates figures thousands of times, add it then.
