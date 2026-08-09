---
phase: 19-contacts-crm-follow-ups
plan: 02
subsystem: contacts-crm
tags: [contacts, crm, follow-ups, suppression, unsubscribe, can-spam, audit, tenant-isolation]
requires:
  - "19-01: @pikar/core normalizeAddress + renderFooter"
  - "19-01: contacts / followUps / suppressions tables, tenantProfiles.postalAddress"
provides:
  - "convex/contacts.ts: 6 public tenant-scoped writes (upsertContact, assertConsent, markSuppressed, unsuppress, createFollowUp, setFollowUpStatus)"
  - "convex/contacts.ts: 5 internals (isSuppressed, suppressedAmong, footerFor, resolveUnsubToken, suppressFromUnsubscribe)"
  - "the UNSUBSCRIBE_SECRET-signed opaque unsubscribe token, minted and verified in one module"
  - "convex/contacts.test.ts: the BETA-05 isolation block + the no-opportunities structural scan"
affects:
  - "packages/backend/convex/llmRedaction.test.ts (audit key-set structural pin)"
  - "docs/playbooks/contacts-crm.md"
  - "19-04 (the HTTP route consumes resolveUnsubToken / suppressFromUnsubscribe)"
  - "19-05 (executePlan consumes isSuppressed / suppressedAmong / footerFor)"
tech-stack:
  added: []
  patterns:
    - "tenantMutation-only public surface; internalQuery/internalMutation take an explicit tenantId and filter it themselves"
    - "one shared private suppress() behind both suppression entry points"
    - "stateless HMAC path-segment token (the 20-06 fal-webhook pattern), fail-closed in exactly one place"
    - "audit payload pinned by key-set EQUALITY at runtime AND by a structural single-site scan"
key-files:
  created:
    - packages/backend/convex/contacts.ts
    - packages/backend/convex/contacts.test.ts
  modified:
    - packages/backend/convex/llmRedaction.test.ts
    - docs/playbooks/contacts-crm.md
decisions:
  - "No public tenantQuery in contacts.ts — the module ships writes + internals only; the Pipeline page's reads land with the page, so VALIDATION row 9's read clause is N/A here and is kept honest by an export-set pin rather than a vacuous test"
  - "The runtime audit key-set equality test lives in contacts.test.ts, not llmRedaction.test.ts: that file is @vitest-environment node and convex-test needs edge-runtime. llmRedaction.test.ts got the structural half instead (one audit site, depth-aware key parse, no content-plane identifier in the call)"
  - "The auditCounts component is registered in only the 4 harnesses that write an audit row — registering it in all 40 crashed the shared vitest fork and took vaultDigest.test.ts down with it"
  - "unsuppress refuses on `acknowledged !== true` BEFORE any read, so a truthy non-boolean un-suppresses nobody"
  - "suppress() never bumps suppressedAt on a replay — the fact of record is WHEN they asked to stop"
metrics:
  duration: ~55 min
  tasks: 3
  files: 4
  completed: 2026-08-09
---

# Phase 19 Plan 02: The person store Summary

`packages/backend/convex/contacts.ts` — the one substrate PIPE-01 forbids duplicating: six
tenant-scoped writes, five internals the send path and the unsubscribe route consume, a stateless
HMAC unsubscribe token with a single fail-closed env guard, and exactly one audit row whose key set
is `{contactId, addressHash}` and is asserted by equality from two directions.

## What shipped

### Task 1 — the module (commit `5939f08`, 452 lines)

**Pre-existing WIP, verified rather than written.** `contacts.ts` arrived as an untracked 448-line
file from an interrupted prior session. It was read in full and reconciled against the plan
line-by-line before anything was committed: every function in the plan's `exports` list was present
and correct, including the `ponytail:` ceiling note on `isSuppressed`'s comma-split and the
`normalizeAddress`/`renderFooter` imports from `@pikar/core` (no local `.toLowerCase()` anywhere).
The only change made to it was `biome check --write` (two line-wrap fixes). Nothing was clobbered.

Public (`tenantMutation`, CLAUDE.md §2 — `importGuard.test.ts` scans it and stays green at 75):

- `upsertContact` — normalizes, REFUSES `""`, upserts on `by_tenant_email`. A nameless re-save does
  not erase a name on record; `origin` is set once, on creation.
- `assertConsent` — refuses blank wording (a consent record with no wording is a defaulted consent
  wearing a timestamp). One `CONTACT_NOT_FOUND` for both "gone" and "not yours".
- `markSuppressed` / `unsuppress` — see invariants below.
- `createFollowUp` — `contactId` optional, `dueAt` required and `Number.isFinite`-checked (a
  `v.number()` admits NaN/Infinity, either of which produces a follow-up the
  `by_tenant_status_dueAt` range read can never find).
- `setFollowUpStatus` — `done` stamps `completedAt`, `canceled` does not, re-open clears it.

Internal (explicit `tenantId` arg, filtered in-handler): `isSuppressed`, `suppressedAmong`,
`footerFor`, `resolveUnsubToken`, `suppressFromUnsubscribe`. These read `suppressions` and NEVER
`contacts` — that split is what makes a contacts bug unable to un-suppress anyone.

### Task 2 — the assertions (commits `55fd303`, `7448205`)

`contacts.test.ts`, 40 tests, all $0:

- Isolation over every public function by name (`asA`/`asB` over real `users` rows).
- Unauthenticated refusal using **real ids A created** — the arg validator runs before the wrapper,
  so a made-up id rejects as a validator error and passes for the wrong reason. That is exactly how
  the first draft failed, and it is why the ids are real now.
- Address-identity (`"Bob@X.com"` + `"  bob@x.com "` ⇒ one row), idempotent suppression with a
  stable `suppressedAt`, the `acknowledged: false` refusal, the free-standing follow-up, the
  non-finite `dueAt` refusal.
- The token: round-trip through a group string, tampered digest, absent digest, wrong-key signature,
  no-`|` payload, and the unset-secret fail-closed path (which also asserts
  `suppressFromUnsubscribe` writes nothing). `resolveUnsubToken` is asserted to write NOTHING —
  a link prefetcher must not unsubscribe anyone.
- `footerFor` returns `null` on each of its four missing-configuration paths and, when configured,
  emits a URL on the **Convex site origin** whose token round-trips back through
  `resolveUnsubToken`.
- The audit key set by runtime `Object.keys().sort()` equality, twice — once with a contact row and
  once without, because `contactId` is `null` rather than absent precisely so the key set does not
  vary with the data.
- The structural scan (row 20) over `contacts.ts`, `packages/core/src/contacts.ts` and the three
  schema blocks, comment-stripped (both files carry a deliberate gravestone comment naming what is
  absent; an unstripped scan would punish its own documentation). Non-vacuity floor: every source
  must load at >500 chars and the regex must be shown to match a real violation.
- Two **export-set pins**: the `tenantMutation` export names must equal the covered list, and the
  `internal*` export names must equal the five internals. A seventh public write added without an
  isolation test fails there rather than shipping unasserted.

`llmRedaction.test.ts` gained the structural half of row 10 (58 → 60 tests): exactly ONE
`internal.audit.log` site in `contacts.ts`, its payload keys parsed depth-aware, and no
`address`/`email`/`wording`/`note` identifier anywhere in the call — including `correlationId`,
which must be `addressHash`.

### Task 3 — the playbook (commit `62428db`)

`Last verified` bumped to `(Plan 19-02 — the person store, isolation assertion, audit key-set pin)`,
superseding a foreign lane's watch-gate-only bump (which is now recorded as such rather than
silently overwritten). Key files now name the eleven exported functions; Data flow states the write
path (`human act → tenantMutation → normalizeAddress → by_tenant_email upsert`) and the
two-entry/one-helper suppression path. Two new invariants: **7** (the exact audit key set, with both
enforcing tests) and **8** (`UNSUBSCRIBE_SECRET` fails closed in exactly one place, and adding a
second guard at the route would make it vacuous). Operational notes carry the deployment-secret
rule and the reason its absence is invisible: an unset secret makes `footerFor` return `null`, so
the symptom is "sending stopped working", not "the secret is missing".

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @pikar/backend test -- contacts` | 40/40 green (rows 9, 20) |
| `pnpm --filter @pikar/backend test -- llmRedaction` | 60/60 green (row 10) |
| `pnpm --filter @pikar/backend test -- importGuard` | 75/75 green — no raw builder import |
| `pnpm --filter @pikar/backend test -- auditImmutability` | 3/3 green |
| full backend `vitest run` | **72 files / 1360 tests green** |
| `pnpm typecheck` (full turbo) | 10/10 packages, exit 0 — backend delta **0** vs the re-measured 0 baseline |
| `node scripts/check-playbooks.mjs` | exit 0 |
| playbook content assertions (`19-02`, `UNSUBSCRIBE_SECRET`) | `ok` |
| `biome check` on all four touched files | clean |

`npx convex codegen` WAS required here (19-01's "no codegen needed" note applies to schema changes
only — a new *module* must be added to `_generated/api.d.ts`). The local backend needs
`CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=180`; the default 30s is not enough on this machine.

`graphify update .` + `node scripts/extract-convex-edges.mjs`: 14289 nodes / 16317 edges,
+402 convex edges, +62 table edges over 36 tables.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — blocking] The runtime audit key-set test moved to `contacts.test.ts`**
- **Found during:** Task 2
- **Issue:** The plan put the key-set equality assertion in `llmRedaction.test.ts`. That file is
  `// @vitest-environment node` and is a pure static-scan file; `convex-test` requires
  `edge-runtime`. The two cannot coexist in one file.
- **Fix:** The runtime assertion (a real `audit` row, `Object.keys().sort()`) lives in
  `contacts.test.ts`; `llmRedaction.test.ts` got the structural half, which is the stronger of the
  two against the failure mode that file exists for — a *second* audit site appearing later with a
  payload nobody re-reviewed. Both verify commands in the plan stay green.
- **Commit:** `55fd303`

**2. [Rule 1 — bug, caused by this plan] The 40-harness aggregate registration crashed the vitest fork**
- **Found during:** full-suite verification of Task 2
- **Issue:** `pnpm test` came back with 8 failures in `convex/vaultDigest.test.ts` plus an unhandled
  `Cannot set properties of undefined (setting 'exit')` from the forks worker. `vaultDigest` passes
  in isolation (14s). Running the backend suite with `--exclude convex/contacts.test.ts` was
  **71/71 green**, which is what made this mine rather than pre-existing.
- **Root cause:** `harness()` called `registerComponent("auditCounts", …)` unconditionally, loading
  the whole `@convex-dev/aggregate` component tree into all 40 in-memory backends. Only the 4 tests
  that reach `internal.audit.log` need it.
- **Fix:** `harness({ audit: true })`, opt-in. Backend suite 72/72 files, 1360/1360 tests, and the
  run dropped 375s → 253s.
- **Commit:** `7448205`

**3. [Rule 1 — bug] The unauthenticated test passed for the wrong reason**
- The first draft used `"x" as unknown as Id<"contacts">`. The arg validator runs BEFORE the tenant
  wrapper, so it rejected with `Validator error: Expected ID for table "contacts"` — never reaching
  the auth check it claimed to test. Rewritten against real ids A created, plus three assertions
  that nothing the anonymous caller attempted landed. Folded into `55fd303`.

### Judgement calls recorded

**No public `tenantQuery` in this module.** The plan's `exports` list contains no read function, and
the key_links line mentions `tenantQuery` only as part of the sanctioned-import pair. VALIDATION row
9's "every new public read returns `[]`/`null`" is therefore N/A for this plan — and rather than
write a vacuous read test, the export-set pin makes it *provable* that no public read exists yet,
and makes adding one without an isolation test a test failure.

**Field name:** `createFollowUp` takes `note`, not the plan's `title` — 19-01 shipped `note` as the
schema field and the plan text pre-dates that choice.

## Notes for the next plans

- **19-04 (the HTTP route):** do NOT add a second `if (!process.env.UNSUBSCRIBE_SECRET)` guard.
  `verifyUnsubToken` holds the only one on the verify path, and a second would make it vacuous
  (playbook invariant 8). The route's job is the `raw.lastIndexOf(".")` split and the GET/POST
  split — nothing else.
- **19-05 (the send path):** `isSuppressed` can only refuse a WHOLE comma-joined recipient row; the
  per-address drop that makes partial group sends work belongs at `executePlan`/`startFanout`,
  which sees the recipient LIST before the join. The `ponytail:` note in `contacts.ts` says so.
- **`UNSUBSCRIBE_SECRET` is not set on any deployment yet.** `npx convex env set` from
  `packages/backend` before any live unsubscribe verification, or every link 404s and every send is
  refused (correctly, and invisibly).
- **New Convex modules need `npx convex codegen`** with the raised local-backend timeout. Schema-only
  changes do not.
- Commit with the pathspec form (`git commit -m "…" -- <paths>`); the shared tree carried a foreign
  lane (19-03) throughout this plan. All four commits here are clean at their named paths.

## Self-Check: PASSED

- `packages/backend/convex/contacts.ts` — FOUND (452 lines, 11 exports)
- `packages/backend/convex/contacts.test.ts` — FOUND (730 lines, 40 tests)
- `packages/backend/convex/llmRedaction.test.ts` — FOUND (60 tests, +2)
- `docs/playbooks/contacts-crm.md` — FOUND (256 lines, `19-02` + `UNSUBSCRIBE_SECRET` present)
- commits `5939f08`, `55fd303`, `62428db`, `7448205` — all FOUND in `git log`
