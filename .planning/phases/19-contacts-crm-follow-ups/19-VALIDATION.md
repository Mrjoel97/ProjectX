---
phase: 19
slug: contacts-crm-follow-ups
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-09
filled_in: 2026-08-10
corrected: 2026-08-10 (Plan 19-13 — this file had gone actively false; see the correction notice)
reconciled: 2026-08-16 (owner judgement and real-inbox attestation were recorded after 19-13)
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `19-RESEARCH.md` → "Validation Architecture". Line numbers in that
> document were read from source on 2026-08-09; **re-verify before relying on one.**
>
> **FILLED IN BY 19-10 (2026-08-10).** Every row below carries the outcome of a command that was
> ACTUALLY EXECUTED in this session, not one inferred from a plan summary. Where a plan summary and
> a re-measurement disagreed, the re-measurement wins and the disagreement is recorded.
>
> ## ⚠ CORRECTED BY 19-13 (2026-08-10) — this file had become the phase's worst document
>
> The phase-19 verifier found this file asserting **the opposite of reality** on three counts, all
> of them written at 19-10 and overtaken by 19-11 and 19-12 without anyone coming back here:
>
> | It said | The truth |
> |---|---|
> | "22/22 green and **ACTN-05 is still not met**" | ACTN-05 **is** met — code, offline tests and a live browser turn (UAT step 7) |
> | "**fixture 36 is now RED** against the active body … a full gate is 34/35" | Fixture 36 is **GREEN**, re-verified alone at run `0b2b6b22` ($0.0057) after 19-11's tool-shape fix |
> | The owner browser UAT is "**NOT RUN**" | It ran. `apps/web/e2e/pipeline-uat.spec.ts` is **15/15** with both `test.fail()` markers deleted (19-12, `d575b3f`) |
>
> A validation file that says the capability does not work, when it does, is worse than no
> validation file: the next reader trusts it and stops checking. Every falsified sentence below is
> now corrected in place, struck through with a superseding line, or replaced. **Nothing was
> corrected by weakening an assertion** — the two things that are still not clean (the spliced
> eval gate and the `__seedOnboardedTenant` inference) are recorded as caveats at the bottom of
> this file rather than closed, because closing either costs money or a run nobody has done.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` 3.2.7 (three configs) + `@playwright/test` for the browser gate |
| **Config files** | `packages/core/vitest.config.ts` (node) · `packages/backend/vitest.config.mts` (edge-runtime) · `apps/web/vitest.config.mts` (`jsx: "automatic"`, includes `app/**/*.test.ts` ONLY) · `apps/web/playwright.config.ts` (pins `127.0.0.1:3111`, **no `webServer` block**) |
| **Quick run command** | **CORRECTED — see the box below.** `pnpm --filter @pikar/core test contacts` (NO `--`) |
| **Full suite command** | `pnpm test` (turbo, all packages) + `pnpm typecheck` + `node scripts/check-playbooks.mjs` |
| **Measured runtime** | backend package suite **117.7 s** (72 files / 1415 tests at 19-10; **1448 tests at 19-13**, ~4.5 min under concurrent-lane load); full turbo **2 m 8 s**; `pnpm typecheck` **38 s** |

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
   `pnpm --filter @pikar/web test:e2e -- <file>` runs the WHOLE e2e suite (~8 min, 25 failed /
   4 passed, almost all unrelated tenant-precondition failures). Use
   `npx playwright test e2e/pipeline-uat.spec.ts` from `apps/web`. *(The original wording named
   `e2e/pipeline.spec.ts`, deleted at 19-13.)*

**Typecheck baseline: backend is ZERO for PHASE-19 CODE — measured 2026-08-10 at 19-10, not
quoted.** Foreground `npx tsc --noEmit` from `packages/backend` exited **0** with no output at that
point. **It does NOT exit 0 today, and the reason is not phase 19 — see the 19-13 re-measurement
two paragraphs down.** The "13" this file once
claimed and the "150" in STATE.md are both stale; so is any figure older than this line. Any error
at all is a regression. `pnpm typecheck` (full turbo) was **10/10 packages, exit 0** when measured
at 19-10.

**RE-MEASURED AT 19-13: `pnpm typecheck` is 8/10, exit 2 — and that is NOT a phase-19 regression.**
The only errors are `convex/cash.ts(132,9)` and `(150,7)` TS2739 (`CashInputState` missing
`origin`, `actor`, `basis`), owned by the concurrent finance lane; they surface twice because both
`@pikar/backend:typecheck` and `@pikar/web:typecheck` compile that file. The `:3210` watcher runs
with `--typecheck=disable` because of them. **Any error outside `cash.ts` IS phase-19's.**

**Also re-measured at 19-13: `pnpm --filter @pikar/backend test` is 72 files / 1448 passed, exit 0**
(1446 before `consentRecord` added two cases). Recorded honestly: the FIRST attempt died with
`FATAL ERROR: Zone Allocation failed - process out of memory` and a second reported 8 spurious
failures. That is the shared-vitest-fork memory hazard `contacts.test.ts`'s own harness comment
documents, not a regression — the third run is clean and is the one quoted. If you see 8 failures
here, re-run before believing them.

Also established by 19-01: a **schema-only** change needs no `npx convex codegen` —
`_generated/dataModel.d.ts` derives table types generically from `schema.ts`. Codegen is only
required when a new Convex *module* appears (19-02 measured that; 19-06/07/08 measured that a new
FUNCTION on an existing module does not need it either).

**Browser gate: THE OWNER UAT RAN — `apps/web/e2e/pipeline-uat.spec.ts` is 15/15 (19-12,
`d575b3f`), with BOTH `test.fail()` markers deleted and measured spend $0.0400.** It signs up its
own throwaway tenants through the real `/signup` form, so it is re-runnable indefinitely and needs
no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`. Seven PNGs, `spend.json` and `tenant.txt` are on disk
under `.planning/phases/19-contacts-crm-follow-ups/uat/`.

~~**Browser gate: RUN 2026-08-10 — 2/2 PASSED in 12.3 s.** `apps/web/e2e/pipeline.spec.ts` executed
for the first time against a live `convex dev` on `:3210` and a PRODUCTION build on `:3111`.~~
**SUPERSEDED at 19-13: `e2e/pipeline.spec.ts` HAS BEEN DELETED.** That run was real, but the spec
could only ever pass once — its own header documented that test 1 pins an EMPTY-tenant precondition
that can never hold again after test 2 creates a contact. The verifier re-ran it and got **1 failed
/ 1 did not run**. A permanently-red spec is worse than no spec, and `pipeline-uat.spec.ts` steps
1+2 and 3 assert strictly more over tenants that are empty by construction. The paragraph below is
kept because its two findings about HOW to run e2e specs are still true and still useful.
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

**All 22 rows executed 2026-08-10; row 23 added and executed at 19-13.** Commands are the
CORRECTED ones; where a row's original command was wrong, the original is struck through in the
note. Backend row counts were re-measured at 19-13 (62 → 64 — `consentRecord` added two cases).

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
| 9 | ACTN-05 (SC#2) | Every new public read returns `[]`/`null` for a foreign tenant; every new public write throws; unauthenticated throws `UNAUTHENTICATED` | integration | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — **64/64 at 19-13** (62 before `consentRecord`). The unauth cases use REAL ids tenant A created: a made-up id rejects at the arg validator before the wrapper and would pass for the wrong reason (19-02's first draft did exactly that). Export-set pins make a new public function without an isolation test a FAILURE |
| 10 | ACTN-05 (SC#3) | Audit rows carry ids/counts ONLY — asserted by **exact key-set equality**, never a substring check | integration | `npx vitest run convex/llmRedaction.test.ts convex/contacts.test.ts` | ✅ | ✅ green — **60/60 + 64/64**. Split across two files by necessity: `llmRedaction.test.ts` is `@vitest-environment node` and `convex-test` needs `edge-runtime`, so the RUNTIME `Object.keys().sort()` equality lives in `contacts.test.ts` and the structural single-site scan in `llmRedaction.test.ts` |
| 11 | PIPE-01 (SC#5) | A suppressed address is dropped per-address; the other recipients still send; the user is told which were withheld | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63 |
| 12 | PIPE-01 (SC#5) | **Group mode** drops the suppressed member from the joined string (the `executePlan` join happens BEFORE the `requests` seed) | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63. Uses **three** recipients deliberately: with two, the joined string contains the survivor whether or not a drop happened and the test passes vacuously |
| 13 | PIPE-01 (SC#5) | ALL recipients suppressed ⇒ `{ ok:false }` **before the CAS**: plan stays `proposed`, zero `requests` rows, nothing scheduled | integration | `npx vitest run convex/cockpit.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63. **MUTATION-VERIFIED:** moving the guard below the CAS patch turns it RED (`expected "proposed", received "approved"`) |
| 14 | PIPE-01 (SC#5) | **A suppression created AFTER approve but BEFORE a scheduled fire is still refused at `gmail.send`** — THE test that proves the guard is in the send path | integration | `npx vitest run convex/gmail.test.ts` | ✅ | ✅ green — **42/42**. Asserts `{delivered:false, reason:"suppressed"}` **and ZERO fetch calls** — refused before a credential is even minted |
| 15 | PIPE-01 (SC#6) | Every send carries the postal address AND an unsubscribe link — asserted on the **MIME bytes** | integration | `npx vitest run convex/gmail.test.ts` | ✅ | ✅ green — 42/42 |
| 16 | PIPE-01 (SC#6) | A tenant with no postal address cannot approve (`no_postal_address`, before the CAS) and cannot send (hard throw at `gmail.send`) | integration | `npx vitest run convex/cockpit.test.ts convex/gmail.test.ts` ~~`-- cockpitTools`~~ | ✅ | ✅ green — 63/63 + 42/42 |
| 17 | PIPE-01 (SC#6) | `notifyExternal`'s service notice carries **NO** footer — `buildMime` byte-identity V4 still green | unit | `npx vitest run convex/gmail.test.ts` | ✅ | ✅ green — 42/42. The footer is applied at the `buildMime` CALL SITE, never inside it, which is what keeps V4 byte-identical |
| 18 | PIPE-01 | Unsubscribe: a tampered/absent digest 404s; an unset secret fails closed; a **GET writes NOTHING**; the POST suppresses idempotently | integration | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — 64/64 (8 route tests). **MUTATION-VERIFIED:** adding a `runMutation` to the GET reddens the ROW-COUNT assertion (`received length 1`). Counting rows, not reading the response, is the point — a handler that suppressed and returned identical HTML passes a status-only check |
| 19 | PIPE-01 (SC#8) | All four tiles render `0` on an empty tenant — **never `—`, never `Unknown`** (the 26-10 lesson) | component **+ browser** | `pnpm --filter @pikar/web test pipelineView` **and** `npx playwright test e2e/pipeline-uat.spec.ts` | ✅ W0 shipped | ✅ green TWICE — component **17/17** (asserts `">0<"` exactly four times AND the explicit absence of `—`/`Unknown`) **and BROWSER-VERIFIED**: UAT step 1 parses each tile as an integer against a freshly signed-up empty tenant, so a hedge throws. *(19-13: the browser half was originally credited to `e2e/pipeline.spec.ts` test 1, which has since been deleted; the UAT step supersedes it and is re-runnable.)* |
| 20 | PIPE-01 (SC#8) | The page contains **no** opportunity / stage / monetary field — structural scan for `amountCents` / `stage` / `opportunit` across the new modules | structural | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — 64/64. Comment-STRIPPED (both files carry a deliberate gravestone comment naming what is absent; an unstripped scan punishes its own documentation) with a non-vacuity floor: the source must load above a size threshold AND the regex must be shown to match a real violation |
| 21 | PIPE-01 | Bounded reads honour `createDashboardBound` (`nextCursor ⇒ partial`) | integration | `npx vitest run convex/contacts.test.ts` | ✅ W0 shipped | ✅ green — 64/64 (short-page/long-page bound pair + a cursor round-trip with disjoint pages) |
| 22 | PIPE-01 (SC#7) | The playbook states the "no contacts cache at rest" reconciliation in writing, and `check-playbooks` passes with the new watch entry | structural | `node scripts/check-playbooks.mjs` | ✅ | ✅ green — **exit 0**. `contacts-crm.md` invariant 1 states all three halves as unchanged and names the enforcement point (`resolveContacts` never calls a contacts write). 19-08 made the write-absence MECHANICAL (invariant 16, proven by row count). The playbook says plainly that invariant 1's structural half has no automated enforcement — that gap is listed as one |
| 23 | PIPE-01 (SC#4) | **The consent record is reproducible ON REQUEST** — the exact wording, the timestamp, the source and the capture context, returned to the owning tenant and to nobody else | integration | `pnpm --filter @pikar/backend test contacts` | ✅ 19-13 | ✅ green — **64/64**. Added at 19-13 because the phase-19 verifier found `consentWording`/`consentContext` were WRITE-ONLY: `assertConsent` stored them and nothing in the repo read them back (`listContacts` projects `{at, source}` and drops both). `contacts.consentRecord({contactId})` is the request path — one `ctx.db.get` behind `tenantQuery`, `null` for no consent, explicit `null` for unrecorded fields, no audit write. **BOTH guards MUTATION-PROVEN red-able:** dropping `\|\| row.tenantId !== ctx.tenantId` ⇒ `AssertionError: promise resolved "{ at: 1786328761895, …(3) }" instead of rejecting`; dropping `"consentRecord"` from the export-set pin ⇒ `AssertionError: expected [ 'assertConsent', …(9) ] to deeply equal [ 'assertConsent', …(8) ]`. **No UI surface, deliberately** — see the playbook's Known gaps for why |

*Status vocabulary: ✅ green · ❌ red · ⚠️ partial/qualified · NOT RUN · (the unfilled placeholder
this column used to carry is gone from every row, and from this legend, because the plan's own
verify script scans the whole file for it — a legend that names the token fails the check.)*

**Score: 23 green (1 of them qualified — row 7), 0 red, 0 NOT RUN.**

### ❗ WHAT THESE 23 ROWS DO NOT COVER — and it is the thing ACTN-05 is actually about

Every row above tests a mechanism: the tool is registered, the plan gate accepts it, the apply is
transactional and tenant-safe, the guards hold. **Not one row asks whether the LIVE MODEL routes a
plain-language follow-up request to that mechanism at all.** That is behavioural, it costs money,
and it lives in the eval corpus — fixture `36-crm-follow-up`.

**Measured 2026-08-10 at 19-10, and it WAS red — then 19-11 found the cause and fixed it.**
Against the now-ACTIVE `cockpit-agent@18`, asked *"Add a follow-up for Thursday with Rhea Calloway
(…) about the benchmark-CR1 renewal"*, the agent staged an **`addContact` with no `dueAt`** and no
follow-up at all. Run `309b1c3d`, `--only 36`, **$0.0142**, plan row read back at $0:

```json
{"kind":"crm_write","status":"proposed",
 "crmOperations":[{"op":"addContact","email":"eval-rhea-6q@golden.example",
                   "name":"Rhea Calloway","origin":"mailbox-resolved"}]}
```

On the run's other attempt it staged nothing and the plan stayed `collecting`.

**THE CAUSE WAS NOT THE MODEL, AND IT IS FIXED. FIXTURE 36 IS GREEN.** 19-11 found that
`runAgentLoop` dropped the trusted clock on the way to `buildCockpitTools`, so `stageCrmWrite`
refused every dated follow-up with `no_clock` and the model degraded to a bare contact. Two fixes
landed (the clock at the shared seam; `parseCrmOperations` applying the send path's own
`isValidEmail` so the model could not satisfy the required-`email` brake by inventing
`"no-email"`), and fixture 36 was re-verified GREEN **for the right reason** — turn 2 refused,
turn 1's follow-up intact — at run `0b2b6b22`, **$0.0057**, with the skill body BYTE-UNCHANGED.
19-12 then found the browser had never sent `clientContext` at all and fixed that at
`useSendCockpitMessage`, which UAT step 7 observes from a real browser turn.

19-09's gate scored this 35/35 because `crmOperationCount` is a COUNT and cannot distinguish op
types. 19-10 added **`datedFollowUpCount`** to the closed `EXPECT_KEYS` vocabulary (a SUBSET key the
runner refuses without `crmOperationCount`, requiring a finite `dueAt`; both halves mutation-proven
red-able offline). **The assertion was never weakened**, and the fix was made in the CODE, not in
the fixture — which is exactly why the strengthened key is worth having.

~~**So: 22/22 green and ACTN-05 is still not met.** A mechanism that works and a model that never
reaches it is not a delivered capability. This is why the requirement is NOT ticked.~~

**SUPERSEDED (19-11, 19-12, recorded here at 19-13): ACTN-05 IS MET.** The mechanism works, the
model reaches it, and a real browser turn has been observed doing so (UAT step 7 asserts the
`addFollowUp` with a finite `dueAt` off the PLAN ROW, not the DOM — the only observer that can see
this class of bug, because every offline layer supplies its own clock). The later owner judgement
and real-inbox attestation are recorded in `19-VERIFICATION.md`; ACTN-05 and PIPE-01 are now checked
and Complete in `REQUIREMENTS.md`.

---

## Wave 0 Requirements

- [x] `packages/core/src/contacts.ts` + `contacts.test.ts` — `normalizeAddress`, the
      needing-attention predicate, the due predicate, `renderFooter` (ACTN-05, PIPE-01) — **23 tests**
- [x] `packages/backend/convex/contacts.test.ts` — the `asA`/`asB` isolation block over every new
      public function, the unsubscribe token round-trip, the bounded-read contract, the
      no-opportunities structural scan (ACTN-05 SC#2, PIPE-01 SC#8) — **62 tests at 19-10, 64 at
      19-13** (`consentRecord`'s isolation case and its exact-reproduction case)
- [x] `apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` — **`.test.ts`, NOT `.test.tsx`**
      (the web vitest config includes `app/**/*.test.ts` only) — the empty-state `0` assertions
      (PIPE-01 SC#8) — **17 tests**
- [x] ~~`apps/web/e2e/pipeline.spec.ts` — **authored** in 19-07, **RUN in 19-10: 2/2 PASSED.**~~
      **DELETED at 19-13** (with its `watch.json` entry) — it could only pass once, and the verifier
      re-ran it to 1 failed / 1 did not run. Replaced by `apps/web/e2e/pipeline-uat.spec.ts`, **15/15**,
      which signs up throwaway tenants and is therefore re-runnable
- [x] `packages/backend/scripts/eval-cases/36-*.json` + a `$0` observable + fixture floor bump
      34 → 35 — the binding 18-08 override condition ("teach a tool, owe a fixture") is PAID.
      19-10 tightened the observable with `datedFollowUpCount`; the fixture went red against the
      active body, **19-11 fixed the CODE (not the fixture) and it is GREEN again** at run
      `0b2b6b22`, $0.0057 — see the box above
- [x] Framework install: **none needed.**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Status |
|----------|-------------|------------|--------|
| Connected browser UAT — BRAND conformance of the Pipeline page, the three never-seen send-refusal notes, the withheld report's TONE, the CRM plan card, the `Records update` trace verb, the CAN-SPAM footer in a real inbox, and the rendered unsubscribe landing page as a RECIPIENT sees it | PIPE-01 SC#8, SC#6 | BRAND conformance and "does this read as information or as a failure" are human judgements no assertion encodes. The unsubscribe page is inline-styled from BRAND hex (a Convex `httpAction` cannot import `globals.css`) and matches no screenshot | ✅ **COMPLETE — 15/15 mechanical UAT + owner judgement + real-inbox attestation.** The UAT executed at 19-12 (`d575b3f`) as `apps/web/e2e/pipeline-uat.spec.ts`, **15 steps, 15 green**, measured spend **$0.0400**, with 7 PNGs + `spend.json` + `tenant.txt` on disk. On 2026-08-10 the owner approved the seven screenshots for BRAND/tone and attested that the authorized product email to `joel.feruzi@gmail.com` arrived with its configured postal footer and working unsubscribe landing-page link. The final unsubscribe button was not pressed. Inbox evidence is owner-attested; automation did not inspect credentials or mailbox contents. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all ❌ MISSING references above — all five items shipped (one of them,
      `e2e/pipeline.spec.ts`, has since been DELETED at 19-13 and superseded by
      `e2e/pipeline-uat.spec.ts`; it shipped, ran, and was then correctly retired)
- [x] No watch-mode flags anywhere
- [x] Feedback latency measured (~2 min, not the claimed 90 s) and bounded
- [x] Backend typecheck baseline **measured 2026-08-10 at 19-10** (exit 0 then), not quoted from
      this file — superseded by the 19-13 re-measurement in the next box but one
- [x] `nyquist_compliant: true` set in frontmatter
- [x] **Owner browser UAT — RUN at 19-12 (`d575b3f`): `e2e/pipeline-uat.spec.ts` 15/15, spend
      $0.0400, seven PNGs on disk.** ~~PENDING. This is the one unchecked box and the phase does not
      close without it.~~
- [x] Backend typecheck re-measured at 19-13: **8/10, `cash.ts` (concurrent lane) the only red**
- [x] SC#4's second sentence closed at 19-13 by `contacts.consentRecord` — the consent record is
      reproducible on request, unit-proven, isolation-proven and both guards mutation-proven red-able
- [x] **OWNER JUDGEMENT SIGN-OFF — complete 2026-08-10.** The owner approved the seven UAT
      screenshots for BRAND/tone and attested that the authorized product email arrived with the
      configured postal footer and a working unsubscribe landing-page link. The final unsubscribe
      button was deliberately not pressed.

**Approval:** complete. The offline surface was signed off 2026-08-10 by plan 19-10, re-measured
and corrected by plan 19-13; the browser UAT ran 15/15, and the owner subsequently approved the
seven judgements and attested the live-inbox result. `ACTN-05` and `PIPE-01` are Complete.

---

## Two things that are NOT clean, recorded rather than closed (19-13)

Both are cheap to state and expensive to close. Neither was paid for: the 19-13 spend ceiling was
**$0.00** and it was met.

**1. The 35/35 eval gate is a SPLICE OF TWO RUNS, not one clean sweep.**
Gate `086f8267` (35/35, $0.3505) ran at **19-09** — before `datedFollowUpCount` existed (19-10) and
before the tool-shape fix (19-11). Fixture 36 was then re-verified **alone** (`--only 36`, run
`0b2b6b22`, $0.0057, PASS) after those changes. The skill body is byte-unchanged between the two, so
the *body's* certification legitimately stands — but **no single run has ever been green across all
35 cases with the strengthened key and the post-19-11 code.** The risk is small (only fixture 36
touches CRM) and it is not zero. "35/35" reads as one run; it is two. Closing this properly costs a
full gate at ~$0.35.

**2. `__seedOnboardedTenant`'s "nine specs" figure is an INFERENCE, not an observation.**
`onboarding.ts:654` seeds the postal address with a comment naming the nine specs that would fail
without it. Only **five** specs call the seeder, and no run of the others is recorded anywhere in
this phase. The seeder is correct either way — this is a documentation-accuracy note, not a defect —
but the number was reasoned, not measured, and it should not be quoted as if it were measured.
