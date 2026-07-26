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
| A real conversational turn | SC#3 | `pnpm dev` — it seeds the skills; **`npx convex dev` ALONE does not** — then walk `/dashboard/onboarding` and confirm both halves: the facts are ASKED (headcount and paid staff are questions, not inferences) and an empty required slot blocks completion however warmly the agent wraps up |
| Profile page interaction | SC#1c | Load `/dashboard/profile`; confirm no tier control exists, the tier renders read-only with `TIER_REASON` + an honest `tierSource`, and editing headcount to 12 MOVES the tier (and is acknowledged as an event, not a silent field update) |
| Perceivable tier difference | SC#5 | Run the same diagnosis as a solopreneur and as an SME; confirm the solopreneur's specialist output never presumes delegation |

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

**Do not conflate these with Phase 15's unpaid eval gate.** That one is separate and still unpaid:
15-06 rewrote the three specialist bodies (`offer-architect` / `money-model-designer` /
`lead-engine`) and they ship DARK as candidates until `pnpm eval:golden` runs on a deployment.
Paying the four rows above does NOT activate those bodies, and running the eval gate does NOT
verify any of the four. They are different obligations against the same missing deployment.

**Every offline gate these four stand in for IS paid:** `convex-test` exercises the backfill,
`converse` and both refusal codes; the SC#1c source scan covers both rewritten pages and was
mutation-checked in 15.1-07; `tsc --noEmit`, `biome` and `check-playbooks.mjs` all run clean. The
gap is behavioural confirmation against a real deployment and a real model, nothing else.
