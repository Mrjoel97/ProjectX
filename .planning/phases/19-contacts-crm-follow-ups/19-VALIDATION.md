---
phase: 19
slug: contacts-crm-follow-ups
status: closed-out (offline); owner browser UAT PENDING
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-09
filled_in: 2026-08-10
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `19-RESEARCH.md` → "Validation Architecture". Line numbers in that
> document were read from source on 2026-08-09; **re-verify before relying on one.**
>
> **FILLED IN BY 19-10 (2026-08-10).** Every row below carries the outcome of a command that was
> ACTUALLY EXECUTED in this session, not one inferred from a plan summary. Where a plan summary and
> a re-measurement disagreed, the re-measurement wins and the disagreement is recorded.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` 3.2.7 (three configs) + `@playwright/test` for the browser gate |
| **Config files** | `packages/core/vitest.config.ts` (node) · `packages/backend/vitest.config.mts` (edge-runtime) · `apps/web/vitest.config.mts` (`jsx: "automatic"`, includes `app/**/*.test.ts` ONLY) · `apps/web/playwright.config.ts` (pins `127.0.0.1:3111`, **no `webServer` block**) |
| **Quick run command** | **CORRECTED — see the box below.** `pnpm --filter @pikar/core test contacts` (NO `--`) |
| **Full suite command** | `pnpm test` (turbo, all packages) + `pnpm typecheck` + `node scripts/check-playbooks.mjs` |
| **Measured runtime** | backend package suite **117.7 s** (72 files / 1415 tests); full turbo **2 m 8 s**; `pnpm typecheck` **38 s** |

### ⚠ THE COMMAND COLUMN OF THIS FILE WAS WRONG, AND SO IS THE REST OF THE REPO'S

**`pnpm --filter @pikar/<pkg> test -- <name>` DOES NOT FILTER.** Measured both ways in this session:

```
pnpm --filter @pikar/core test -- contacts   → vitest run "--" "contacts"  → 32 files  (EVERYTHING)
pnpm --filter @pikar/core test    contacts   → vitest run "contacts"       →  1 file   (correct)
```

pnpm forwards the literal `--` to vitest, which then matches nothing and falls back to the whole
suite. On the backend that is **72 files / 1415 tests / ~2 minutes**, not the "~90 s filtered"
this file used to claim. **Drop the `--`.**

Three consequences, all of them honest-reporting problems rather than product problems:

1. Every "filtered" figure quoted in plans 19-01 → 19-09 came from reading one file's line out of a
   FULL-suite run. The numbers are right; the commands beside them are not reproducible as written.
2. **Rows 4, 5, 6, 11, 12, 13 and 16 name `-- cockpitTools`, and `cockpitTools.test.ts` contains
   ZERO `executePlan` tests** — verified: `grep -c executePlan convex/cockpitTools.test.ts` = **0**,
   while `convex/cockpit.test.ts` = **78**. Those rows pass today ONLY because the broken `--` makes
   the command run the entire backend suite, which happens to include `cockpit.test.ts`. **Fix the
   `--` without fixing those rows' file names and six rows silently become vacuous greens.** Both
   are corrected below.
3. The same `--` swallowing breaks the e2e resume command every spec header in this repo quotes:
   `pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts` runs the WHOLE e2e suite (~8 min,
   25 failed / 4 passed, almost all unrelated tenant-precondition failures). Use
   `npx playwright test e2e/pipeline.spec.ts` from `apps/web`.

**Typecheck baseline: backend is ZERO — RE-MEASURED 2026-08-10, not quoted.** Foreground
`npx tsc --noEmit` from `packages/backend` exits **0** with no output. The "13" this file once
claimed and the "150" in STATE.md are both stale; so is any figure older than this line. Any error
at all is a regression. `pnpm typecheck` (full turbo): **10/10 packages, exit 0.**

Also established by 19-01: a **schema-only** change needs no `npx convex codegen` —
`_generated/dataModel.d.ts` derives table types generically from `schema.ts`. Codegen is only
required when a new Convex *module* appears (19-02 measured that; 19-06/07/08 measured that a new
FUNCTION on an existing module does not need it either).

**Browser gate: RUN 2026-08-10 — 2/2 PASSED in 12.3 s.** `apps/web/e2e/pipeline.spec.ts` executed
for the first time against a live `convex dev` on `:3210` and a PRODUCTION build on `:3111`.
**19-07's "an executor cannot mint `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`" is FALSE for a local
deployment** — `convex/auth.ts` runs the Convex Auth `Password` provider and `/signup` is a real
form, so a throwaway user is one scripted signup away, and a fresh signup is also how the
empty-tenant precondition was met without building a reset seam. 26-05 and 26-10 stopped in
`auth.setup.ts` for want of credentials; that was a missing account, not an impossibility.
**A `--list` is still NOT a run, and a blank result still means NOT RUN.**

---

## Sampling Rate

- **After every task commit:** the package's suite (`pnpm --filter @pikar/<pkg> test <name>`, no
  `--`) + `pnpm typecheck` delta against the freshly re-measured baseline.
- **After every plan wave:** `pnpm test` (full turbo) + `node scripts/check-playbooks.mjs`.
- **Any plan touching `cockpit.ts`, `gmail.ts` or the approve spine:** the **WHOLE** suite is the
  gate, not a filtered run (20-07's rule — the spine has no safe partial).
- **Before `/gsd:verify-work`:** full suite green + both typechecks + production build +
  `check-playbooks` exit 0 + the owner browser UAT.
- **Max feedback latency:** **~2 min measured** (the backend package suite). The "~90 s filtered"
  figure assumed a filter that never worked.

**Compliance:** met. Every wave ran the full turbo suite, and because the `--` never filtered,
every "filtered" run was in fact a full package run — the contract was over-met, not under-met.

---

## Per-Task Verification Map

**All 22 rows executed 2026-08-10.** Commands are the CORRECTED ones; where a row's original
command was wrong, the original is struck through in the note.

| # | Requirement | Behavior | Test Type | Automated Command (corrected) | File Exists | Status |
|---|-------------|----------|-----------|-------------------|-------------|--------|
| 1 | ACTN-05 | `ACTION_TYPES` has exactly five members; `armFor("crm_write") === "inline"`; the four existing assertions unchanged | unit | `pnpm --filter @pikar/core test actionType` | ✅ `packages/core/src/actionType.test.ts` | ✅ green — **12/12** |
| 2 | ACTN-05 | `normalizeAddress` is idempotent and agrees across contacts / suppressions / the guard | unit | `pnpm --filter @pikar/core test contacts` | ✅ W0 shipped | ✅ green — **23/23** (core `contacts.test.ts`) |
| 3 | ACTN-05 | The needing-attention predicate (no OPEN follow-up) and the due predicate are pure and correct at the boundaries | unit | `pnpm --filter @pikar/core test contacts` | ✅ W0 shipped | ✅ green — same 23/23; the `dueAt === now` boundary has its own case |
| 4 | ACTN-05 | `patchPlan({ kind: "crm_write" })` is ACCEPTED by the runtime validator | integration | `npx vitest run convex/plans.test.ts` ~~`-- cockpitTools`~~ | ✅ `plans.test.ts` | ✅ green — **22/22**. MUTATION-VERIFIED (19-06): dropping the literal from `patchPlan`'s hand-maintained mirror alone turns 2 tests RED **while every typecheck still passes** — Pitfall 1 |
| 5 | ACTN-05 | Approving a `crm_write` plan applies the whole operation list, sets `done`, seeds ZERO `requests` rows, and never reaches `deliverApprovedPlan` / `gmail.send` | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ `cockpit.test.ts` | ✅ green — **63/63**. The CRM arm registers NO components, so a regression routing it into the fan-out throws rather than quietly seeding rows |
| 6 | ACTN-05 | Double-approve of a `crm_write` plan applies nothing a second time | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — same 63/63. All-or-none is free: `applyCrmOperations` is called DIRECTLY, sharing the CAS transaction — asserted (an invalid THIRD op applies none of the first two), not assumed |
| 7 | ACTN-05 | The email / memo / calendar / media arms are behaviourally UNCHANGED | integration | `npx vitest run convex/cockpit.test.ts` | ✅ | ⚠️ green, PARTIAL BY CONSTRUCTION — the calendar/media arm suites seed no mailbox and no profile, so they ARE the regression and stayed green untouched; 19-05 added ONE new assertion (the memo arm approves with neither gate satisfied) rather than copying them. Real coverage, but three of the four arms are proven by *absence of change*, not by a new claim |
| 8 | ACTN-05 | Every new tool key has an `agentSteps.tool` literal AND a `cards.tsx` VERB entry, asserted BOTH ways | structural | `npx vitest run convex/traceParity.test.ts convex/cockpitTools.test.ts` | ✅ | ✅ green — **2/2 + 101/101**. BOTH directions MUTATION-VERIFIED (19-08): dropping the schema literal reddens the key-scan AND traceParity's orphan side **and fails `tsc`**; dropping the VERB entry reddens traceParity's missing-verb side |
| 9 | ACTN-05 (SC#2) | Every new public read returns `[]`/`null` for a foreign tenant; every new public write throws; unauthenticated throws `UNAUTHENTICATED` | integration | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — **62/62**. The unauth cases use REAL ids tenant A created: a made-up id rejects at the arg validator before the wrapper and would pass for the wrong reason (19-02's first draft did exactly that). Export-set pins make a new public function without an isolation test a FAILURE |
| 10 | ACTN-05 (SC#3) | Audit rows carry ids/counts ONLY — asserted by **exact key-set equality**, never a substring check | integration | `npx vitest run convex/llmRedaction.test.ts convex/contacts.test.ts` | ✅ | ✅ green — **60/60 + 62/62**. Split across two files by necessity: `llmRedaction.test.ts` is `@vitest-environment node` and `convex-test` needs `edge-runtime`, so the RUNTIME `Object.keys().sort()` equality lives in `contacts.test.ts` and the structural single-site scan in `llmRedaction.test.ts` |
| 11 | PIPE-01 (SC#5) | A suppressed address is dropped per-address; the other recipients still send; the user is told which were withheld | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63 |
| 12 | PIPE-01 (SC#5) | **Group mode** drops the suppressed member from the joined string (the `executePlan` join happens BEFORE the `requests` seed) | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63. Uses **three** recipients deliberately: with two, the joined string contains the survivor whether or not a drop happened and the test passes vacuously |
| 13 | PIPE-01 (SC#5) | ALL recipients suppressed ⇒ `{ ok:false }` **before the CAS**: plan stays `proposed`, zero `requests` rows, nothing scheduled | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63. **MUTATION-VERIFIED:** moving the guard below the CAS patch turns it RED (`expected "proposed", received "approved"`) |
| 14 | PIPE-01 (SC#5) | **A suppression created AFTER approve but BEFORE a scheduled fire is still refused at `gmail.send`** — THE test that proves the guard is in the send path | integration | `npx vitest run convex/gmail.test.ts` | ✅ | ✅ green — **42/42**. Asserts `{delivered:false, reason:"suppressed"}` **and ZERO fetch calls** — refused before a credential is even minted |
| 15 | PIPE-01 (SC#6) | Every send carries the postal address AND an unsubscribe link — asserted on the **MIME bytes** | integration | `npx vitest run convex/gmail.test.ts` | ✅ | ✅ green — 42/42 |
| 16 | PIPE-01 (SC#6) | A tenant with no postal address cannot approve (`no_postal_address`, before the CAS) and cannot send (hard throw at `gmail.send`) | integration | `npx vitest run convex/cockpit.test.ts convex/gmail.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63 + 42/42 |
| 17 | PIPE-01 (SC#6) | `notifyExternal`'s service notice carries **NO** footer — `buildMime` byte-identity V4 still green | unit | `npx vitest run convex/gmail.test.ts` | ✅ | ✅ green — 42/42. The footer is applied at the `buildMime` CALL SITE, never inside it, which is what keeps V4 byte-identical |
| 18 | PIPE-01 | Unsubscribe: a tampered/absent digest 404s; an unset secret fails closed; a **GET writes NOTHING**; the POST suppresses idempotently | integration | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — 62/62 (8 route tests). **MUTATION-VERIFIED:** adding a `runMutation` to the GET reddens the ROW-COUNT assertion (`received length 1`). Counting rows, not reading the response, is the point — a handler that suppressed and returned identical HTML passes a status-only check |
| 19 | PIPE-01 (SC#8) | All four tiles render `0` on an empty tenant — **never `—`, never `Unknown`** (the 26-10 lesson) | component **+ browser** | `pnpm --filter @pikar/web test pipelineView` **and** `npx playwright test e2e/pipeline.spec.ts` | ✅ W0 shipped | ✅ green TWICE — component **17/17** (asserts `">0<"` exactly four times AND the explicit absence of `—`/`Unknown`) **and now BROWSER-VERIFIED**: e2e test 1 passed against a real empty tenant, parsing each tile as an integer so a hedge throws |
| 20 | PIPE-01 (SC#8) | The page contains **no** opportunity / stage / monetary field — structural scan for `amountCents` / `stage` / `opportunit` across the new modules | structural | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — 62/62. Comment-STRIPPED (both files carry a deliberate gravestone comment naming what is absent; an unstripped scan punishes its own documentation) with a non-vacuity floor: the source must load above a size threshold AND the regex must be shown to match a real violation |
| 21 | PIPE-01 | Bounded reads honour `createDashboardBound` (`nextCursor ⇒ partial`) | integration | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — 62/62 (short-page/long-page bound pair + a cursor round-trip with disjoint pages) |
| 22 | PIPE-01 (SC#7) | The playbook states the "no contacts cache at rest" reconciliation in writing, and `check-playbooks` passes with the new watch entry | structural | `node scripts/check-playbooks.mjs` | ✅ | ✅ green — **exit 0**. `contacts-crm.md` invariant 1 states all three halves as unchanged and names the enforcement point (`resolveContacts` never calls a contacts write). 19-08 made the write-absence MECHANICAL (invariant 16, proven by row count). The playbook says plainly that invariant 1's structural half has no automated enforcement — that gap is listed as one |

*Status vocabulary: ✅ green · ❌ red · ⚠️ partial/qualified · NOT RUN · (the unfilled placeholder
this column used to carry is gone from every row, and from this legend, because the plan's own
verify script scans the whole file for it — a legend that names the token fails the check.)*

**Score: 22 green (1 of them qualified — row 7), 0 red, 0 NOT RUN.**

### ❗ WHAT THESE 22 ROWS DO NOT COVER — and it is the thing ACTN-05 is actually about

Every row above tests a mechanism: the tool is registered, the plan gate accepts it, the apply is
transactional and tenant-safe, the guards hold. **Not one row asks whether the LIVE MODEL routes a
plain-language follow-up request to that mechanism at all.** That is behavioural, it costs money,
and it lives in the eval corpus — fixture `36-crm-follow-up`.

**Measured 2026-08-10, and it is RED.** Against the now-ACTIVE `cockpit-agent@18`, asked
*"Add a follow-up for Thursday with Rhea Calloway (…) about the benchmark-CR1 renewal"*, the agent
stages an **`addContact` with no `dueAt`** and no follow-up at all. Run `309b1c3d`, `--only 36`,
**$0.0142**, plan row read back at $0:

```json
{"kind":"crm_write","status":"proposed",
 "crmOperations":[{"op":"addContact","email":"eval-rhea-6q@golden.example",
                   "name":"Rhea Calloway","origin":"mailbox-resolved"}]}
```

On the run's other attempt it staged nothing and the plan stayed `collecting`.

19-09's gate scored this 35/35 because `crmOperationCount` is a COUNT and cannot distinguish op
types. 19-10 added **`datedFollowUpCount`** to the closed `EXPECT_KEYS` vocabulary (a SUBSET key the
runner refuses without `crmOperationCount`, requiring a finite `dueAt`; both halves mutation-proven
red-able offline). **A full gate is therefore 34/35 until the body reaches the tool. The assertion
was NOT weakened to restore green.**

**So: 22/22 green and ACTN-05 is still not met.** A mechanism that works and a model that never
reaches it is not a delivered capability. This is why the requirement is NOT ticked.

---

## Wave 0 Requirements

- [x] `packages/core/src/contacts.ts` + `contacts.test.ts` — `normalizeAddress`, the
      needing-attention predicate, the due predicate, `renderFooter` (ACTN-05, PIPE-01) — **23 tests**
- [x] `packages/backend/convex/contacts.test.ts` — the `asA`/`asB` isolation block over every new
      public function, the unsubscribe token round-trip, the bounded-read contract, the
      no-opportunities structural scan (ACTN-05 SC#2, PIPE-01 SC#8) — **62 tests**
- [x] `apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` — **`.test.ts`, NOT `.test.tsx`**
      (the web vitest config includes `app/**/*.test.ts` only) — the empty-state `0` assertions
      (PIPE-01 SC#8) — **17 tests**
- [x] `apps/web/e2e/pipeline.spec.ts` — **authored** in 19-07, **RUN in 19-10: 2/2 PASSED.**
      Registered in `watch.json` under `dashboard-pages.md` (single owner, not double-registered)
- [x] `packages/backend/scripts/eval-cases/36-*.json` + a `$0` observable + fixture floor bump
      34 → 35 — the binding 18-08 override condition ("teach a tool, owe a fixture") is PAID.
      **19-10 tightened the observable with `datedFollowUpCount`, and the fixture is now RED against
      the active body — see the box above.**
- [x] Framework install: **none needed.**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Status |
|----------|-------------|------------|--------|
| Connected browser UAT — BRAND conformance of the Pipeline page, the three never-seen send-refusal notes, the withheld report's TONE, the CRM plan card, the `Records update` trace verb, the CAN-SPAM footer in a real inbox, and the rendered unsubscribe landing page as a RECIPIENT sees it | PIPE-01 SC#8, SC#6 | BRAND conformance and "does this read as information or as a failure" are human judgements no assertion encodes. The unsubscribe page is inline-styled from BRAND hex (a Convex `httpAction` cannot import `globals.css`) and matches no screenshot | **NOT RUN — this is the blocking owner gate 19-10 stops at.** The MECHANICAL half of this row is now covered by the e2e run (tiles, add/suppress/un-suppress, nav still `soon`); what remains is exactly the part a machine cannot judge. Seed evidence under a `uat-19:` correlation prefix so the run is re-checkable (the 26-10 discipline) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all ❌ MISSING references above — all five items shipped
- [x] No watch-mode flags anywhere
- [x] Feedback latency measured (~2 min, not the claimed 90 s) and bounded
- [x] Backend typecheck baseline **re-measured 2026-08-10** (exit 0), not quoted from this file
- [x] `nyquist_compliant: true` set in frontmatter
- [ ] **Owner browser UAT — PENDING. This is the one unchecked box and the phase does not close
      without it.**

**Approval:** offline surface signed off 2026-08-10 by plan 19-10; **owner approval PENDING**, and
`ACTN-05` / `PIPE-01` stay Pending in `REQUIREMENTS.md` until it lands — a requirement is met
because someone verified it, not because the code exists.
