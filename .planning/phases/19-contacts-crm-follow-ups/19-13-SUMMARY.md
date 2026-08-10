---
phase: 19-contacts-crm-follow-ups
plan: 13
subsystem: contacts-crm
tags: [convex, consent, tenant-isolation, compliance, gap-closure]

requires:
  - phase: 19-02
    provides: tenant-scoped contacts and durable consent fields
  - phase: 19-verification
    provides: SC#4 write-only consent-record gap finding
provides:
  - bounded public consentRecord query over one tenant-owned contact
  - exact consent wording/context reproduction tests through the public API
  - Phase 19 re-verification at 8/8 code truths with human sign-off still explicit
affects: [contacts-crm, phase-19-verification, owner-uat]

tech-stack:
  added: []
  patterns:
    - one-id tenantQuery for content-plane compliance records
    - indistinguishable missing/foreign refusal with explicit null absence semantics
    - verification evidence separated from owner judgement

key-files:
  created:
    - .planning/phases/19-contacts-crm-follow-ups/19-13-PLAN.md
    - .planning/phases/19-contacts-crm-follow-ups/19-13-SUMMARY.md
    - .planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md
  modified:
    - packages/backend/convex/contacts.ts
    - packages/backend/convex/contacts.test.ts
    - docs/playbooks/contacts-crm.md

key-decisions:
  - "Consent reproduction is id-at-a-time through ctx.db.get; a bulk export remains an explicit future product surface."
  - "No consent returns null, while unrecorded wording/context fields return explicit nulls rather than invented prose."
  - "8/8 code truths do not self-approve the separate owner browser UAT or requirement checkboxes."

patterns-established:
  - "Content-plane compliance reads stay out of the refs-only audit plane."
  - "A real foreign id proves tenant isolation at the handler rather than vacuously at validation."

requirements-completed: []

duration: 30 min
completed: 2026-08-10
---

# Phase 19 Plan 13: Consent Record Gap Closure Summary

**A one-contact `tenantQuery` now reproduces the exact stored consent wording, timestamp, source,
and capture context without widening the CRM into a bulk export or leaking content into audit.**

## Performance

- **Duration:** 30 min
- **Completed:** 2026-08-10
- **Tasks:** 2
- **Files changed:** 6

## Accomplishments

- Added `api.contacts.consentRecord`, bounded to one `ctx.db.get` and followed by an authenticated
  tenant comparison using one indistinguishable `CONTACT_NOT_FOUND` refusal.
- Proved exact wording/context reproduction, timestamp/source fidelity, no-consent and absent-field
  null semantics, foreign-tenant and anonymous refusal, audit absence, and public-surface coverage.
- Updated the contacts CRM playbook with the request-path invariant, point-read ceiling, and
  whole-book export upgrade path.
- Re-verified Phase 19 at 8/8 code truths while preserving owner UAT/sign-off and real Gmail inbox
  delivery as human evidence still owed. REQUIREMENTS.md was deliberately untouched.

## Task Commits

1. **Task 1: Bounded tenant-scoped consent record request path** — `6a2d23e`
2. **Task 2: Document the request path and re-verify the phase gap** — `306bc82`

## Files Created/Modified

- `packages/backend/convex/contacts.ts` — exports the typed, one-contact `consentRecord` query.
- `packages/backend/convex/contacts.test.ts` — exercises the public query across exact reproduction,
  auth, isolation, absence, audit-safety, and export-set cases.
- `docs/playbooks/contacts-crm.md` — records the shipped reader, enforcement, ceiling, and upgrade
  path.
- `.planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md` — closes the SC#4 code gap and
  retains the human gates.
- `.planning/phases/19-contacts-crm-follow-ups/19-13-PLAN.md` — executable gap-closure plan, checked
  with zero plan-checker issues.

## Decisions Made

- Used a point lookup instead of adding a bulk export. A regulator request is per person, and the
  wider surface can compose existing pagination with this projection if it is actually required.
- Returned `null` for no consent and explicit null content fields for unrecorded details; neither
  case is an error or an invitation to synthesize display prose.
- Kept the query audit-free because wording/context are content plane; the existing audit key-set
  remains refs/ids/counts only.

## Verification

- `pnpm --filter @pikar/backend test contacts` — **PASS**, 1 file / 64 tests.
- `.\\node_modules\\.bin\\biome.CMD check packages/backend/convex/contacts.ts packages/backend/convex/contacts.test.ts`
  — **PASS**, 2 files clean.
- `git diff --check` over all Phase 19-owned plan paths — **PASS**.
- Plan checker — **PASS**, zero issues.
- `pnpm typecheck` (full turbo) — **8/10, exit 2. The ONLY errors are the concurrent Finance lane's
  `convex/cash.ts(132,9)` and `(150,7)` TS2739** (missing `origin`, `actor`, `basis`), surfaced once
  by `@pikar/backend:typecheck` and once by `@pikar/web:typecheck`. Nothing in this plan is red.
- `pnpm --filter @pikar/backend test` (whole package) — **72 files / 1448 passed, exit 0.** Recorded
  honestly: the first attempt died with `FATAL ERROR: Zone Allocation failed - process out of
  memory` and a second reported 8 spurious failures. That is the shared-vitest-fork memory hazard
  the harness comment in `contacts.test.ts` already documents; the third run is clean and is the one
  quoted.
- `node scripts/check-playbooks.mjs` — **exit 0.** ~~qualified shared-tree block~~ — the block was
  real at the time it was written and is now resolved: `dashboard-pages.md` and `cockpit.md` were
  bumped for the `e2e/pipeline.spec.ts` deletion and the `gmail.ts` comment fix respectively, both
  of which are now IN scope (see the continuation below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided Node heap contention during verification**
- **Found during:** Task 1 verification
- **Issue:** Running the focused Vitest command and backend `tsc` concurrently exhausted Node's
  default heap (exit 134).
- **Fix:** Re-ran them sequentially and gave only `tsc` a 4 GB heap.
- **Result:** The focused suite passed 64/64; `tsc` reached stable diagnostics and reported only the
  unrelated Cash-lane errors above.

### Out-of-Scope Findings

- `packages/backend/convex/cash.ts` remains the sole backend typecheck blocker and belongs to the
  concurrent Finance lane. Untouched, per the standing instruction.
- ~~The repository-wide playbook gate remains blocked by the unrelated Pipeline spec deletion and
  Gmail comment edit; this plan changed neither file nor their owning playbooks.~~ **Both were then
  pulled IN scope by the owner (see the continuation below) and are done.**

## Authentication Gates

None.

## Remaining Human Verification

- Owner sign-off on the seven UAT screenshots: Pipeline and unsubscribe BRAND conformance,
  withheld-recipient information tone, and the three send-refusal messages.
- After that sign-off, the owner may tick ACTN-05 and PIPE-01 in REQUIREMENTS.md.
- A real Gmail delivery must still demonstrate that the CAN-SPAM footer and working unsubscribe
  link arrive in an inbox.

## Next Phase Readiness

The SC#4 code gap is closed. Phase 19 remains at `human_needed` until owner UAT/sign-off; no further
code work is required for this verification finding.

## Self-Check: PASSED

- All six claimed plan artifacts exist.
- Task commits `6a2d23e` and `306bc82` exist in git history.
- The unrelated staged Pipeline spec deletion remains staged and was not included.
- A concurrent post-commit edit to `contacts-crm.md` remains in the working tree; it was not
  reverted or folded into this plan's metadata commit.

---

# 19-13 CONTINUATION — the paperwork the owner would not let stand

Everything above covers the CODE gap only. The owner then widened 19-13 to close the rest of what
the phase-19 verifier found, on the standing instruction: **"no leftovers, actually complete, not
paperwork-complete."** Spend ceiling **$0.00**, met — nothing here needed a model call.

## The one real gap, finished properly

`consentRecord` shipped at `6a2d23e`. Three things the narrow pass did not report:

**Both guards are MUTATION-PROVEN red-able, with the exact failing text:**

- Drop `|| row.tenantId !== ctx.tenantId` from the handler →
  `AssertionError: promise resolved "{ at: 1786328761895, …(3) }" instead of rejecting`
  (`contacts: tenant isolation … > consentRecord — B cannot reproduce A's consent record`).
- Drop `"consentRecord"` from the test's `COVERED` list →
  `AssertionError: expected [ 'assertConsent', …(9) ] to deeply equal [ 'assertConsent', …(8) ]`
  (`PIPE-01/BETA-05: the public surface is exactly what the isolation block covers`).

Both mutations were applied, observed red, and reverted. The export-set pin was **not** merely
bumped — a real asA/asB isolation case landed beside it, and the unauthenticated block gained the
query too (a REAL id tenant A created, so the arg validator cannot reject it and pass for the wrong
reason).

**CLAUDE.md §4 checked, not assumed.** `tenantQuery` is `customQuery(query, customCtx(requireScope))`
— no logging, no audit hop — and a Convex query cannot write at all. The existing
"no audit row from this module carries the address or the consent wording, anywhere" test was
strengthened to run `consentRecord` **before** it serializes the audit table, so the assertion now
covers the read path rather than only the write path.

**Decision: NO UI surface.** Stated plainly rather than left implicit. The Pipeline table already
shows *whether* consent is on record; the wording is per-person evidence you hand a regulator, not
something to render on every row of a scanning table. A public `tenantQuery` IS the request path an
authenticated tenant can call. A disclosure row would cost per-row state, a second `useQuery`, and
long-lived free text on a page whose job is scanability. Build it when someone actually has to
produce the evidence through the UI. Recorded in the playbook's Known gaps.

## The five falsified documents

1. **`19-VALIDATION.md`** — the phase's worst document. It asserted the OPPOSITE of reality on three
   counts: "ACTN-05 is still not met" (it is met), "fixture 36 is now RED … a full gate is 34/35"
   (green at run `0b2b6b22`), and the manual-verification row reading NOT RUN (the UAT ran, 15/15).
   All three corrected, plus the frontmatter status, the typecheck baseline (now 8/10 with `cash.ts`
   named), the browser-gate paragraph, five stale 62/62 test counts, the Wave-0 items, the sign-off
   box, and a new row 23 for SC#4. A correction notice at the top says what was wrong and why it
   matters. **No assertion was weakened.**
2. **The playbook `Last verified` shas** — 19-12 now names `d575b3f` (the tree the 15/15 UAT ran
   against), 19-11 names `b73bff8`, 19-13 names `6a2d23e`. 19-11's stale
   "The owner browser UAT still has not run" is struck through with an explicit SUPERSEDED marker
   rather than being corrected only by ordering.
3. **`gmail.ts:167`** — the comment claimed `deliverApprovedPlan` was "the sole caller". There are
   TWO (`deliverApprovedPlan.ts:37` and `pipeline.ts:379`), verified by grep. The comment now names
   both and tells the next reader to grep rather than trust it. This is the class of defect that
   cost the phase the most: three separate times a claim in a comment stopped someone checking.
4. **`.planning/ROADMAP.md`** — `19-10-PLAN.md` ticked; the progress row moved off
   "9/10 | In Progress — 19-10 is AT its blocking owner browser UAT; nothing here is owner-verified
   yet" to 10/10 with the UAT result; the stale ACTN-05-is-broken and 34/35 narratives corrected;
   19-11/12/13 added to the plan list. **Committed this time** — the phase-25 lane's edits had
   landed, so the file was clean.
5. **`apps/web/e2e/pipeline.spec.ts`** — **DELETED**, with its `watch.json` entry. Its empty-tenant
   precondition can never hold again (the verifier ran it: 1 failed, 1 did not run), so it was a
   one-shot receipt, not a guard. `pipeline-uat.spec.ts` steps 1+2 and 3 supersede it over throwaway
   tenants; `pipelineView.test.ts` already covers the two-click un-suppress arming and the
   no-mailbox-suggestions empty state. Recorded in `contacts-crm.md`, `dashboard-pages.md` and
   `cockpit.md`.

Also corrected, unprompted but the same class of leftover: the playbook's "How to verify" table
still used `pnpm --filter … test -- <name>`, a form this very phase measured as NOT filtering, and
named `cockpitTools` for tests that live in `cockpit.test.ts`. Both fixed.

`.planning/STATE.md` was hand-edited (never `gsd-tools state *`), every `"` inside `stopped_at`
escaped as `\"` and verified by a guard script — bare quotes made this frontmatter unparseable
earlier in the phase (`12bde78`). The C19 lane row's stale head (9/10, "cockpit-agent@17 IS STILL
ACTIVE") was replaced with a current statement and the historical tail explicitly marked as a
reasoning trail.

## The two caveats — recorded, deliberately NOT closed

Both are written plainly into `19-VALIDATION.md` under "Two things that are NOT clean":

1. **The 35/35 is a splice of two runs.** Gate `086f8267` ran at 19-09, before `datedFollowUpCount`
   (19-10) and before the 19-11 fix; fixture 36 was re-verified alone afterwards (`0b2b6b22`). The
   body is byte-unchanged so the body's certification stands — but **no single run has ever been
   green across all 35 with the strengthened key.** Closing it costs ~$0.35; the ceiling was $0.00.
2. **`__seedOnboardedTenant`'s "nine specs" is an inference**, not an observation — only five specs
   call the seeder, and no run of the others is recorded.

## Measured, this session

| Check | Result |
|---|---|
| `pnpm --filter @pikar/backend test` | **72 files / 1448 passed, exit 0** (1446 before this plan) |
| `npx vitest run convex/contacts.test.ts` | **64 passed** |
| `pnpm typecheck` | **8/10, exit 2** — `cash.ts(132,9)` + `(150,7)` TS2739 only, the concurrent lane's |
| `node scripts/check-playbooks.mjs` | **exit 0** |
| Mutation proof, tenant guard | RED, text quoted above |
| Mutation proof, export-set pin | RED, text quoted above |
| Spend | **$0.00** |

## What is STILL outstanding after 19-13

**One thing, and it is not code.** The owner has to LOOK at the seven UAT PNGs under
`.planning/phases/19-contacts-crm-follow-ups/uat/` and judge BRAND conformance, whether the
withheld-recipients note reads as information rather than failure, and whether the three
send-refusal notes are honest and actionable. Then tick ACTN-05 and PIPE-01.

`.planning/REQUIREMENTS.md` was **not touched** — the phase-25 lane owns it and the owner said they
would handle both ticks at phase close. Also untouched: `packages/backend/convex/cash.ts`,
`.planning/phases/25-*`, `graphify-out/*`, and the `cockpit-agent@18` skill body (still 28,368 chars
/ sha `6ca4d937639c`, byte-identical, so gate `086f8267` still stands).
