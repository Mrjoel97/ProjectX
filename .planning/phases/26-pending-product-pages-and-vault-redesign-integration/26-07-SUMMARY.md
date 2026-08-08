---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 07
subsystem: backend
tags: [finance, spend-ledger, guardrails, folder-ingest, idempotence, reconciliation]

requires:
  - phase: 26-06
    provides: append-only spendEvents writer, coverage start, movement validation
provides:
  - Reasoning-rail estimate and actual movements paired with the limiter, in one transaction
  - Ingest-rail reservation and refund movements joined by one correlation
  - The correlation policy (derive where replay is real, mint a nonce where it is not)
affects: [26-08, 26-09, guardrails, vault, finance]

tech-stack:
  added: []
  patterns:
    - plain-function ledger writer called inside the limiter's own transaction
    - derive-vs-nonce correlation policy keyed on whether a site is replayable

key-files:
  created:
    - .planning/phases/26-pending-product-pages-and-vault-redesign-integration/26-07-SUMMARY.md
  modified:
    - packages/backend/convex/guardrails.ts
    - packages/backend/convex/guardrails.test.ts
    - packages/backend/convex/vaultFolders.ts
    - packages/backend/convex/vaultFolders.test.ts
    - packages/backend/convex/spendLedger.ts
    - packages/backend/convex/dashboardSchema.test.ts
    - docs/playbooks/guardrails.md
    - docs/playbooks/vault.md
    - docs/playbooks/dashboard-pages.md
    - packages/backend/convex/pipeline.ts (follow-up sweep)
    - packages/backend/convex/pipeline.test.ts (follow-up sweep)
    - packages/backend/convex/intake.ts (follow-up sweep)
    - packages/backend/convex/llm.ts (follow-up sweep)
    - packages/backend/convex/blueprint.ts (follow-up sweep)
    - packages/backend/convex/vaultExtract.ts (follow-up sweep)
    - packages/backend/convex/vaultExtract.test.ts (follow-up sweep)
    - packages/backend/convex/vaultIngest.ts (follow-up sweep)
    - packages/backend/convex/vaultDigest.ts (follow-up sweep)
    - packages/backend/convex/vaultTranscribe.ts (follow-up sweep)
    - packages/backend/convex/voice.ts (follow-up sweep)
    - packages/backend/convex/voice.test.ts (follow-up sweep)
    - packages/backend/convex/voiceDoc.ts (follow-up sweep)
    - packages/backend/convex/runCockpitAgent.test.ts (follow-up sweep)
    - docs/playbooks/cockpit.md (follow-up sweep)
    - docs/playbooks/intake.md (follow-up sweep)
    - docs/playbooks/voice.md (follow-up sweep)
    - docs/playbooks/onboarding.md (follow-up sweep, lane note)

key-decisions:
  - "The ledger write is a PLAIN FUNCTION CALL (spendLedger.recordMovement) inside the limiter's own transaction, never ctx.runMutation. A second transaction could leave the window moved with no record, and an append-only table has no backfill to repair that. It writes the SAME `cents` variable the limiter consumed, so the two planes are arithmetically incapable of disagreeing about the amount."
  - "THE CORRELATION POLICY IS SPLIT ON ONE QUESTION: can this site be re-entered WITHOUT new money changing hands? Replayable sites (prepare, reserveFolderInner, settleFolder) DERIVE a deterministic correlation from refs, so a second entry finds the stored row. recordSpend MINTS a per-execution nonce, because all ~15 of its callers are actions where re-entry re-runs the model call and the second charge is real money."
  - "A too-COARSE correlation is worse than none. It collapses a genuine second charge into one row, putting the ledger BELOW the limiter — and a missing movement is indistinguishable from money never spent, while a duplicate is findable by reconciling the two planes. Every choice here breaks toward over-count."
  - "correlationId and the typed refs are OPTIONAL on recordSpend, not required. Owner decision (2026-08-08) after the design workflow recommended required: required would edit ~10 source files and ~6 playbooks this plan does not own. The nonce fallback means no call site is uninstrumented in the meantime."
  - "reservedAt is stamped ONCE and used for both the returned value and the correlation. settleFolder rebuilds that exact string from folder.reservedAt, so a second Date.now() in reserveFolderInner would orphan every refund while leaving the money perfectly correct — a defect nothing else in the subsystem would notice."
  - "A rolled window writes NO movement. validateSpendMovement rejects amountCents <= 0 and that throw runs inside tryComplete's transaction, so a zero row would fail FOLDER COMPLETION for an accounting reason. Recording nothing is also the honest answer: the reservation then reads as `unlanded`, which is the literal truth. settleFolder gained `settled_window_rolled` so the reason stays distinguishable from a clamp that landed on zero."
  - "The deployment-window refund is deliberately NOT ledgered. spendEvents is a per-tenant statement and the two clamps return different amounts, so a second tenant-scoped row would claim ~800c returned on a 400c credit and drive `unlanded` to a false zero. The reserve side already carries this asymmetry: both windows debited, one row written."

patterns-established:
  - "Ask of every instrumented site: can it be re-entered without re-spending? That single question decides derive-vs-nonce, and answering it wrong in the coarse direction loses money from the record silently."
  - "A CAS and a correlation guard two different things — the money and the record. Neither substitutes for the other."
  - "A source scan must pin the DECLARATION, not the print width. Whitespace AND the trailing comma before `)` are both formatter-owned."

requirements-completed: []

duration: 3h 10m
completed: 2026-08-08
---

# Phase 26 Plan 07: Reasoning and Ingest Ledger Instrumentation Summary

Every reasoning and ingest limiter movement now writes a matching `spendEvents` row **in the same
transaction**, so the reporting plane cannot silently drift below the enforcement plane it exists to
check. Enforcement semantics are unchanged: no refusal, cap, clamp or reason code moved.

- **Tasks:** 2 of 2 complete.
- **Commits:** `df69693` (Task 1), `05420f9` (Task 2), `84c83b9` (deviation).

## Where the movements land

| site | phase | rail | correlation |
|---|---|---|---|
| `prepare`, OK path only | `estimated` | reasoning | `req:<requestId>:prepare` |
| `recordSpend` | `actual` | selector | caller's, else a per-execution nonce |
| `reserveFolderInner`, success | `reserved` | ingest | `f:<folderId>:<reservedAt>` |
| `settleFolder`, inside `> 0` | `refunded` | ingest | `f:<folderId>:<reservedAt>` |

## The design work behind it

A multi-agent workflow (26 agents: 5 parallel call-site investigations, a folder-settlement design,
an adversarial attack on each of 19 proposed correlations, then synthesis) produced a full
correlation design. **16 of 19 proposals were broken by the attackers, and every single defect was
an UNDER-count** — a correlation too coarse to separate a fallback model, a retry, or a per-page OCR
fan-out, so a real second charge was swallowed as a replay.

That result is what set the policy. A per-execution nonce **cannot** under-count, which makes it
strictly safer than a derived correlation at any site that re-spends on re-entry. Derived
correlations only earn their complexity where replay-without-respend is real. The full 19-site table
is recorded as deferred work below.

## Verification

| Gate | Result |
|------|--------|
| `guardrails` + `vaultFolders` + `spendLedger` + `dashboardSchema` | 64/64 |
| `@pikar/backend` full suite | 1255/1255 |
| `@pikar/backend` typecheck | clean |
| `node scripts/check-playbooks.mjs` | exit 0 |

**Mutation checks, all four run and all four caught, each by a different test:**

1. Ledger re-derives the amount as `Math.round(costUsd * 100)` instead of reusing the limiter's
   `cents` → the sub-cent parity test goes red.
2. `settleFolder` correlates on `Date.now()` instead of `folder.reservedAt` → the reserve/settle
   join goes red in both test files.
3. The nonce is replaced by a per-tenant constant → the "a second identical charge is a SECOND
   movement" test goes red.
4. `vaultFolders.ts` stops passing `folderId` down → the end-to-end parity test goes red.

## Deviations from Plan

**[Rule 4 - Architectural] The plan's "widen internal args compatibly" was taken literally, against
the design workflow's recommendation.** The brief argued `correlationId` should be REQUIRED so the
compiler enumerates every call site and a future site cannot ship uninstrumented. That would edit
~10 source files (`llm.ts`, `pipeline.ts`, `intake.ts`, `blueprint.ts`, four vault modules,
`media.ts`, `voice.ts`) and ~6 playbooks this plan does not own — and `media.ts` overlaps plan 26-08.
Presented to the owner, who chose plan scope with the nonce fallback (2026-08-08).

**[Rule 1 - Bug] `dashboardSchema.test.ts` was red before Task 2 finished, from another lane.**

- Found during: the full backend suite run for Task 2's verification.
- Issue: commit `b74c7af` (the blueprint lane) re-wrapped `cancelKind` onto a single line. The
  schema is semantically identical; the Phase-26 assertion was pinned to the old line-wrapping.
  `compact()` collapses whitespace runs to one space, so it still distinguished
  `v.optional( v.union(...), )` from `v.optional(v.union(...))`.
- Fix: added `dense()`, which strips whitespace entirely and normalizes the trailing comma before
  `)` (the formatter adds one when wrapping and drops it when a call fits on one line). Applied to
  the two assertions in the file that span a possible wrap — the second one was the same trap
  waiting to fire on `spendEvents.phase`.
- Verification: 4/4, and dropping the `adjustment` phase from the schema still turns it red.
- Commit: `84c83b9`.

**Total deviations:** 1 owner-decided (Rule 4), 1 auto-fixed (Rule 1).
**Impact:** no enforcement behavior changed. The Rule-4 decision leaves replay suppression off at
the sites outside this plan's file list; that gap is named below and cannot under-count.

## Follow-up sweep (2026-08-09, commit `5a69982`) — the deferred design, implemented

The owner directed the deferred 19-site design to be implemented after all. A second workflow (28
agents: 7 parallel file-cluster instrumentations, then an adversarial attack on each landed
correlation) threaded a stable correlation through **all twelve** `recordSpend` call sites. Zero
survived-defect verdicts; independently re-verified here.

`correlationId` stayed OPTIONAL — the owner's earlier decision was preserved, not reversed. What
replaced the compiler enforcement a required arg would have given is a static scan in
`guardrails.test.ts` that balances braces from each call's argument object and fails the build if a
site ships without a correlation, with a non-vacuity floor of ten sites.

**The full per-site table, with the discriminator each one needs, is in `docs/playbooks/guardrails.md`
§"Phase 26".** The three that mattered most:

- `vaultExtract` bills PER PAGE on the PDF fan-out, so `:p<i>` is what stops one page's cost being
  recorded for a 50-page scan. The image branch omits the segment rather than faking `:p0`.
- `voice.ts` meters REPEATEDLY within one session, so the cumulative token `offset` — not
  `sessionId` — is the discriminator; without it only the first slice of the most expensive
  sessions would land.
- Every `try`/`catch` model pair in `llm.ts` is TWO fully-billed calls, so `:a0`/`:a1` is required;
  a shared correlation returns the primary's row and the fallback's charge disappears.

**Two hazards confirmed rather than assumed.** (1) `{ unstableArgs: true }` is present on the PUBLIC
`RunOptions` type of `@convex-dev/workflow@0.4.4`, and both journaled sites carry it — without it a
workflow parked mid-flight replays against a journal entry recorded with the old args and dies on
`Journal entry mismatch`, killing work already paid for. (2) `pipeline.ts` does NOT interpolate the
handler's `correlationId`: `smoke.seedPipeline` declares it as an unconstrained `v.string()`, so it
could carry whitespace and throw the ledger's charset check AFTER the model call was billed.

**My own guard shipped with the bug it exists to catch.** Its first draft balanced parens from the
next `(` after the callee name — but the call is `ctx.runMutation(internal.guardrails.recordSpend,
{...})`, so that paren opens BEFORE the name. It returned a garbage span that happened to contain
`correlationId` further down `voice.ts` and reported an uninstrumented site as green. Fixed to
balance BRACES from the argument object, and mutation-checked by stripping a real correlation.
**Third instance in two days of a source scan passing for a reason unrelated to its subject** (the
vault scan pinned a variable name, the schema scan pinned a line wrap). The defence is a
non-vacuity assertion plus one run against known-bad input before trusting the green.

**Shared-tree hazard, observed live:** the blueprint lane committed `fabc51d` while a sweep agent
was editing `blueprint.ts`, discarding that agent's edit. Nothing was lost because the call-site
guard reported the site red rather than letting it ship — but concurrent agents in a tree another
lane is actively committing to need a guard that fails closed.

**Gates after the sweep:** backend 1271/1271 (up 16 from the agents' new tests), typecheck clean,
`check-playbooks` exit 0, and the call-site guard mutation-checked.

## Issues Encountered

1. ~~The other ~15 `recordSpend` call sites have no replay suppression yet.~~ **CLOSED by the
   follow-up sweep above (`5a69982`).** All twelve now pass a correlation, and both journaled sites
   carry `{ unstableArgs: true }`.
2. **Charges the pricer never sees are invisible to BOTH planes** — `draftUncached` runs
   `maxRetries: 1` then a whole CHEAP_MODEL fallback but returns only the surviving attempt's usage;
   an id missing from `PRICING` records nothing anywhere. Ledger and limiter still agree, so
   reconciliation cannot detect it. Only an invoice can.
3. **`folder.spentCents` is permanently 0** — nothing increments it, and a zero money field beside a
   real ledger invites someone to read 0 and believe it.
4. **Nothing here is live-verified**, and no money has moved through the ledger. This is offline
   parity evidence against the real rate-limiter component only.
5. **The shared working tree stayed busy.** The blueprint lane landed `b74c7af`, `8959be6`, and a
   `69bfafa`/`97e8062` bump-then-revert of this very playbook mid-plan. Nothing foreign was staged.

## Next Phase Readiness

Ready for **26-08** (media rail), the last of the three. It is file- and playbook-disjoint from this
plan and can now write against a proven seam: it should reuse `spendLedger.recordMovement` inside
`media.ts`'s existing transactional reservation, and its webhook landing is a genuinely REPLAYABLE
site — so it derives a correlation from the job/batch refs rather than minting a nonce. After that,
26-09 reads all three rails, and `startCoverage` should be called only once every rail writes.
