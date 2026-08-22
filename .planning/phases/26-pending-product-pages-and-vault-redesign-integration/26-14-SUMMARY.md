---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 14
wave: 11
requirements: [RPRT-01]
status: complete
executed: 2026-08-22
---

# 26-14 — truthful report metrics, and the audit that found the plan's own first draft lying

## How this plan actually ran

A previous session wrote the whole plan and never committed it. Four files sat untracked and five
modified, the playbook already carried a confident "Last verified" block, and everything was green:
core 23/23, backend 25/25, both typechecks clean.

**It was green and it was wrong.** A 43-agent adversarial audit (six independent lenses, every
finding then handed to a separate agent instructed to REFUTE it) produced 37 raw findings, of which
**25 survived refutation** — 13 distinct defects after dedup. The load-bearing one:

> **Defect 1 had been fixed in the backend only. `/ops` still rendered `edit 0`.**

That is the entire user-visible symptom, untouched, behind a green suite that asserted the backend
now emits `edit_text`. Mechanism coverage, not behaviour coverage — the repo's own recorded failure
mode, reproduced by the plan that was written to fix an instance of it.

## What the audit found in the first draft, and what was done

| # | Defect in the first draft | Fix |
|---|---|---|
| 1 | **`/ops/page.tsx` read `dc.edit`** — backend corrected, card unchanged | read `dc.edit_text`; mock seeds the real literals with NON-ZERO counts; assertion pins the rendered string |
| 2 | **`DECISION_KEYS` hand-typed in TWO modules** while the docblock claimed it was "derived" | `review.ts` exports `REVIEW_DECISIONS = reviewDecisionValidator.members.map(m => m.value)`; both readers import it |
| 3 | **`opsSignals` still dropped unknown literals silently** — only the literal was corrected, not the mechanism | `otherDecisions` accumulator, rendered on the card |
| 4 | **`compareSnapshots` guarded only the NEWER row** | symmetric guard; an unassessed row is not a baseline either |
| 5 | **`take(STEP_CAP)` on the ascending index** — oldest 400/tool, truncation invisible | `.order("desc").take(CAP+1)` per tool, `capped()` per tool, `latency.truncated` on the wire |
| 6 | **`confirmedInWindow` scanned the audit firehose** — post-index `.filter()` over 90 days | card DELETED (see below) |
| 7 | **delivery coverage floor eq'd `status:"sent"`** | floor is the oldest request of ANY status |
| 8 | **`plans.reportForPlan` graph.sent fix was a NO-OP** | `delivered: sent !== null` makes the join observable; test pins three cases |
| 9 | **`evaluation: { state: "never-run" }`** — false for a tenant who evaluated off the cron thread | `no-review-run` + `population` |
| 10 | **`gapKey` was COPIED, not lifted** — `evaluations.ts` still had its own arrow | `evaluations.ts` imports it |
| 11 | **`bucketWindow`/`ReportBucket`: zero callers** | deleted, with its tests |
| 12 | **dead `QueryCtx` import + unused `inWindow` helper** — biome red | deleted |
| 13 | **latency asserted only against an EMPTY database** | real `agentSteps` fixtures across two tools, with the exclusions named |

### The two deletions are the interesting decisions

**`confirmedInWindow` was removed rather than indexed.** `audit` is indexed `by_tenant_ts` only, so
selecting one `eventType` is a post-index `.filter()`: every audit row in the range is scanned
whether it matches or not, and `.take(51)` never short-circuits because a tenant confirms a
blueprint a handful of times in its life. Over this module's own 90-day ceiling that walks the
firehose (~90 `internal.audit.*` call sites feed it) and trips Convex's per-query scan limit. The
card would have **thrown for exactly the active tenants it was for, and never in a fixture-seeded
test**. Options were a new `(tenantId, eventType, ts)` index or no card; nobody asked for a confirm
series, so it is no card. The index is named in the code comment if one is ever wanted.

**`bucketWindow` was exported, doc-commented and unit-tested with no caller** — and no later plan in
this phase (26-15/16/17/19/20) mentions buckets, series, or trends. Its tests read as coverage of
something the product does not do. CLAUDE.md §8 rung 1.

## What the first draft got right, and it is most of it

The pure/adapter split, the coverage-label discipline, the thread-scoped snapshot pair, the refusal
to re-sum reasoning cost, the point-in-time DLQ flag, the `take(CAP+1)` idiom everywhere except the
one read that broke it. **Eleven of the audit's 37 raw findings were refuted** by independent agents
reading the real source — including a claimed `SCORECARD_PATHS` mismatch, a claimed NaN crash in
`sentMail`'s clamp, a claimed missing tenant check on the `by_correlation` join, and a claim that
the timezone was consumed by nothing. Those were checked and are not defects.

## Evidence

| Check | Result |
|---|---|
| `packages/core` full suite | **40 files, 1083 passed** |
| `packages/backend` full suite | **93 files, 2294 passed** |
| `apps/web` `app/(app)/ops` | **21 passed** |
| `tsc --noEmit` core / backend | both clean |
| `biome check` on all touched source | clean |
| Playbook watcher (`check` mode, hook JSON on stdin) | silent — no stale playbook |

**Four guards mutation-verified** — the fix reverted, the suite confirmed RED, the fix restored:

1. `/ops` tile back to `dc.edit` → 3 tests red (`expected … to contain 'approve 2 · edit 3 · reject 1'`)
2. `compareSnapshots` back to the newer-only guard → 1 test red
3. `reportForPlan` back to the single `gmail.sent` literal → 1 test red
4. (the latency truncation is pinned by a seeded 410-row fixture asserting `truncated: true`)

## DEVIATIONS from `files_modified`

The plan named six files. Six more were touched, every one because the audit showed the plan's own
goal was not reachable without them:

- `apps/web/app/(app)/ops/page.tsx` + `opsPresentation.test.ts` — **without these the plan's headline
  defect is not fixed at all**, only relocated.
- `packages/backend/convex/review.ts` — the root cause. Correcting one hand-typed copy of a closed
  set into another leaves the same drift one edit away.
- `packages/backend/convex/opsSignals.ts` + `.test.ts` — named indirectly by the plan's premise;
  already in the first draft's diff.
- `packages/backend/convex/plans.ts` + `.test.ts` — same.
- `packages/backend/convex/evaluations.ts` — one import, to make `gapKey`'s doc comment true.

`docs/playbooks/dashboard-pages.md` was rewritten rather than appended: its existing 26-14 block
asserted that both shipped defects were corrected, and neither claim was true as written.

## A gate that reads green without running — recorded again

`node scripts/check-playbooks.mjs` bare produces NOTHING and exits 0: it reads hook JSON from fd 0.
Run it as `echo '{"session_id":"x"}' | node scripts/check-playbooks.mjs check`. This is the fourth
distinct way that gate can look fine without having run (26-11 recorded two, 26-12 a third). The
plan's own `<verify>` block specifies the bare form, and so does every prior plan in this phase.

The plan's `<verify>` block also specifies `pnpm --filter <pkg> test -- <filter>`, which **does not
filter** — it runs the whole suite. 26-VALIDATION row 26-14 carried the same broken form and is
corrected to the `npx vitest run <file>` form 26-12 established.

## Not done / handed on

- **No UI for the report plane.** `business`, `operations` and `sentMail` have no consumer yet;
  `files_modified` contains no `apps/web` report route. That is 26-16/17's work. The only web file
  touched here is `/ops`, and only to finish Defect 1.
- **`otherDecisions` is now on two surfaces and rendered on one.** `/ops` shows it when non-zero;
  the reports `operations` card returns it and nothing reads it yet.
- **The `agent-relayed` undercount handed on by 26-12 is still open** and it now has a second
  reader: `business().evaluation.sources` splits vault / user-provided / agent-relayed, but the
  label keys on `origin === "agent_promoted"` and three agent-authored document kinds carry no
  `origin`, so agent-written figures still count as `vault`. Not fixable from a read plane — it is a
  write-site or grounding-label change, same as 26-12 said.
- **`latency.truncated` is a boolean, not a per-tool bound.** Which of the six tools was cut is not
  reported. `ponytail:` ceiling — upgrade to a per-tool bound map if a reader ever needs to know
  which population was clipped.
- **Still open, not introduced here**: the two red finance tests characterised in 26-10-SUMMARY, and
  26-VALIDATION rows 26-06/07/08.
