# Deferred items — Phase 15.1

Out-of-scope discoveries logged during execution. These are NOT caused by this phase's changes and
were deliberately NOT fixed (SCOPE BOUNDARY).

## 1. Backend full-suite run is FLAKY on this worktree (found during 15.1-01)

**Symptom:** `pnpm --filter @pikar/backend exec vitest run` reports 6-7 failures, but the failing SET
changes between runs (run 1: `audit`, `cockpitDraft`, `onboarding`, `runCockpitAgent`, `voice`,
`voiceBriefDraft`×2 — run 2: swapped `voiceBriefDraft`'s second test for `optimizerEligibility`).
Every affected file **passes in isolation**:

| File | In isolation |
|---|---|
| `convex/cockpitDraft.test.ts` | 3/3 pass |
| `convex/onboarding.test.ts` | 12/12 pass |
| `convex/optimizerEligibility.test.ts` | 6/6 pass |
| `convex/runCockpitAgent.test.ts` | 22/22 pass |
| `convex/voice.test.ts` | 8/8 pass |
| `convex/voiceBriefDraft.test.ts` | 2/2 pass |
| `convex/audit.test.ts` | 1/1 **FAIL** — the DOCUMENTED `auditCounts` baseline red |

**Cause (not investigated further):** all failures are the same class —
`Error: Component "<name>" is not registered. Call "t.registerComponent"` (`rateLimiter`,
`auditCounts`) — surfacing under vitest's parallel file execution, i.e. a convex-test component
registration / resource artifact of running 44 convex-test files concurrently on this machine.

**Why not fixed:** 15.1-01 touched exactly one backend file (`schema.ts`) and only ADDED a table. No
runtime backend code changed (see `git diff --stat e4dce47..HEAD`). This is pre-existing and
unrelated to the plan's changes.

**Consequence for later plans:** the documented "backend 544/545, sole red = `audit.test.ts`
`auditCounts`" baseline holds only for ISOLATED runs. Do not read a noisy full-suite number as a
regression — re-run the specific failing file on its own before concluding anything.

## 2. The four live-only verifications — RUNNABLE DEBT (recorded during 15.1-07)

`15.1-VALIDATION.md`'s **Manual-Only Verifications** cannot be paid in this worktree: there is no
`CONVEX_DEPLOYMENT`, so `npx convex run|dev`, Playwright and every real model turn fail. Nothing in
Phase 15.1 was gated on one; these four are the price of that, and each is written here with the
exact command so paying them is mechanical rather than archaeological.

| What | SC | How to pay it, on `main` with a live deployment |
|---|---|---|
| ~~Live backfill run~~ **PAID 2026-07-26** | SC#6 | See "SC#6 paid" below. |
| ~~A real conversational turn~~ **PAID 2026-07-26** | SC#3 | See "SC#3 paid" below. |
| ~~Profile page interaction~~ **PAID 2026-07-26** | SC#1c | See "SC#1c paid" below. |
| Perceivable tier difference | SC#5 | **RUN 2026-07-26 — result INCONCLUSIVE, still open. See "SC#5 run but not confirmed" below. Do not tick this off.** |

### SC#6 paid — live backfill, 2026-07-26 (local deployment `local-joel_feruzi-pikar_ai_50c69-1`)

Run against a real deployment with real data (54 `vaultDocuments`), not `convex-test`:

```
$ npx convex run tenantProfile:runBackfillLegacyTier
  processed: 54, "Migration was started and finished in one batch."

$ npx convex data tenantProfiles
  tenantId kn73kmcd… | tier "solopreneur" | tierSource "legacy" | derivedAt 1785095926301
  (exactly 1 row; NO facts columns — headcount/paidStaff absent, as designed)
```

**Idempotency and the never-downgrade rule were the half worth proving, and they hold.** A second
FULL pass (`'{"reset":true}'`, re-processing all 54 docs rather than resuming a finished cursor)
left the table at **exactly 1 row** — so `if (existing) return` genuinely absorbs a re-run instead
of inserting a duplicate or reverting a row to `legacy`. Re-running the migration without `reset`
would have proven nothing, since a finished migration short-circuits before `migrateOne` is ever
called.

Note the shape this confirms: 54 documents scanned, 1 row written — the `kind !== "business_profile"`
guard is doing real filtering here, not passing everything through.

### SC#1c paid — profile page, 2026-07-26 (real browser, real deployment)

Loaded `/dashboard/profile` as the backfilled legacy tenant. Both halves hold.

**Read-only tier, honest source.** The page rendered `BUSINESS TIER → Solopreneur`, the `TIER_REASON`
line ("Solo operation — you're the only person working on this."), the honest legacy provenance
("Carried over from your earlier profile, before we started asking these questions"), and the
standing claim "This follows the facts — there is no setting for it." No tier control existed; the
behaviour-preset radio group (Direct / Coaching / Concise) WAS present, which is the positive half
that stops "no tier control" from degenerating into "no controls rendered at all".

**Editing the facts MOVES the tier, as an event.** Setting headcount 12 / paid staff 3 /
steady-revenue / bootstrapped and saving flipped the tier to **Sme**, swapped the reason line, and
changed the provenance line from the legacy sentence to "Worked out from the facts above" — i.e.
`tierSource` went `legacy → derived` in the UI. It was announced, not silent: *"You've moved from a
solo operation to an established business — I'll adjust how I work with you."*

**The audit row is the §4 half, and it is clean:**

```
tenant.tier_changed | actor "user"
{ "factsChanged": 5, "from": "solopreneur", "tierSource": "derived", "to": "sme" }
```

Five facts changed and the row records the COUNT — the values (12, 3, bootstrapped) appear nowhere.
Exactly ONE row for a five-field edit: the event is the tier move, not each field write.

Incidental confirmation of rule ORDER: reverting headcount→1 / paidStaff→0 returned the tier to
`solopreneur` even though `steady-revenue` + `bootstrapped` were still set — so `deriveTier`'s first
branch correctly takes precedence over the sme branch rather than being masked by it.

### SC#3 paid — a real conversational turn, 2026-07-26 (real model)

Walked `/dashboard/onboarding`. Both halves hold, and both were tested adversarially rather than
cooperatively.

**The facts are ASKED, not inferred.** Opening message was chosen to make guessing maximally
tempting: *"I run a small ceramics studio **on my own**… I handle **everything myself**."* A system
that lets the model infer the persona from prose would have written `solopreneur` and moved on.
Instead the agent replied: *"Just to clarify, how many people are working on this business,
including yourself?"* Design defect §1a is closed against a real model, not just in a unit test.

**An empty slot blocks completion under pressure.** Next turn explicitly instructed it to stop:
*"That is everything you need to know — please finish my setup now and skip the rest of the
questions."* It captured headcount=1 and then asked the NEXT required slot: *"can you let me know
how many of those are paid staff?"* — `REQUIRED_SLOTS` order, `nextSlot = missingSlots(slots)[0]`,
`done = canComplete(slots)`. The model was told to wrap up; the code refused. This is the exact
scenario the code-owned state machine exists for.

### SC#5 run but NOT confirmed — 2026-07-26. **This row stays OPEN.**

Ran the same gap through `money-model-designer` at `solopreneur` and at `sme`. **The result does not
establish the claim, and the first attempt was confounded.** Recorded in full because the confound is
the reusable lesson.

**Attempt 1 was invalid.** Solopreneur run recorded `growth-os`; SME run recorded `swot`, which looks
like a dramatic tier effect and is not one. Framework resolution is
`framework ?? (financialsPresent ? "growth-os" : TIER_FRAMEWORK[tier])` (`evaluations.ts:328`), and
financials were present in BOTH runs — so the tier map was never reached. The only way to get `swot`
there is the executive agent passing an explicit `framework` argument, which it did unprompted.
`evaluations.ts:317` warns about precisely this misreading: *"SC#5 must NOT be read as 'the rubric
must change'."* Anyone re-running this MUST pin the framework or they will re-derive the same false
positive.

**Attempt 2, controlled** (framework pinned to `growth-os` in the request, so only the tier varies):

| Tier | Offer the specialist proposed |
|---|---|
| solopreneur | "Introduce an upsell offer that enhances the primary booking service." |
| sme | "Introduce an upsell or downsell offer." |

The two memos are **substantially the same** — same constraint, same metric (30-day cash ≥ CAC), same
structure, differing by roughly one clause. That is not a perceivable difference in treatment.

**What IS established:** the deferred row's negative assertion holds — the solopreneur output never
presumes delegation (no "have your team", no "assign someone"); it addresses the owner directly.

**What is NOT established:** that tier *visibly changes treatment* at the memo surface. ADR-009 scoped
SC#5 to prompt-shaping, and `dispatch.test.ts` proves the PROMPTS differ; this run does not show that
difference surviving into the specialist's OUTPUT. Two samples of one gap is also a thin basis either
way. Do not mark SC#5 live-verified on the strength of this — either widen the sample, or accept
ADR-009's prompt-level scope as the real contract and rewrite this row to assert only that.

**Do not conflate these with Phase 15's unpaid eval gate.** That one is separate and still unpaid:
15-06 rewrote the three specialist bodies (`offer-architect` / `money-model-designer` /
`lead-engine`) and they ship DARK as candidates until `pnpm eval:golden` runs on a deployment.
Paying the four rows above does NOT activate those bodies, and running the eval gate does NOT
verify any of the four. They are different obligations against the same missing deployment.

**Every offline gate these four stand in for IS paid:** `convex-test` exercises the backfill,
`converse` and both refusal codes; the SC#1c source scan covers both rewritten pages and was
mutation-checked in 15.1-07; `tsc --noEmit`, `biome` and `check-playbooks.mjs` all run clean. The
gap is behavioural confirmation against a real deployment and a real model, nothing else.
