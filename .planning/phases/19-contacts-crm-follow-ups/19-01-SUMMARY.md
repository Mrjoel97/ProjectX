---
phase: 19-contacts-crm-follow-ups
plan: 01
subsystem: contacts-crm
tags: [contacts, crm, follow-ups, suppression, can-spam, schema, playbook]
requires: []
provides:
  - "packages/core: normalizeAddress, needsAttention, followUpIsDue, renderFooter"
  - "schema: contacts, followUps, suppressions tables"
  - "schema: tenantProfiles.postalAddress"
  - "docs/playbooks/contacts-crm.md + watch.json registration"
affects:
  - "packages/core/src/index.ts (barrel)"
  - "packages/backend/convex/schema.ts"
tech-stack:
  added: []
  patterns:
    - "pure-TS predicates in packages/core, Convex as thin adapter (CLAUDE.md §1)"
    - "new table ⇒ no migration; all-optional field ⇒ no migration"
    - "playbook created BEFORE the code it watches (CLAUDE.md §9 Stop hook)"
key-files:
  created:
    - packages/core/src/contacts.ts
    - packages/core/src/contacts.test.ts
    - docs/playbooks/contacts-crm.md
  modified:
    - packages/core/src/index.ts
    - packages/backend/convex/schema.ts
    - docs/playbooks/watch.json
decisions:
  - "normalizeAddress is trim+lowercase ONLY — plus-addressing and dot-folding stay deferred so the suppressions key is byte-stable"
  - "renderFooter fails closed on a blank postal address OR a blank unsubscribe URL (the plan required the first; the second is the same argument)"
  - "followUps.note is the text field name; dueAt is REQUIRED, no snooze state"
  - "suppressions is address-keyed and separate from contacts so suppression outlives the contact"
  - "backend typecheck baseline RE-MEASURED at 0 errors (the 13 and 150 figures in phase docs are both stale)"
metrics:
  duration: ~35 min
  tasks: 3
  files: 6
  completed: 2026-08-09
---

# Phase 19 Plan 01: Contacts substrate Summary

The phase's foundation: one address-identity function every later call site imports, three pure
predicates, three new tables with tenant-leading indexes, an optional CAN-SPAM postal address on
`tenantProfiles`, and the `contacts-crm.md` playbook registered in `watch.json` before any of the
code it protects exists.

## What shipped

### Task 1 — the pure contacts core (commit `0abc73b`)

`packages/core/src/contacts.ts`, framework-agnostic (no Convex import, plain `string` ids):

- `normalizeAddress(s)` — `s.trim().toLowerCase()`. The identity function for contacts,
  suppressions and the per-address send guard alike. Carries the `ponytail:` ceiling note naming
  person-level merging as the deferred upgrade and forbidding a change to *this* function.
- `needsAttention(contactId, openFollowUpContactIds)` — true when the contact has no OPEN follow-up.
- `followUpIsDue(dueAt, now)` — `dueAt <= now`; the `===` boundary is pinned by its own test.
- `renderFooter({ postalAddress, unsubscribeUrl })` — two-line plain-text footer behind a
  `\n\n` separator; throws on a blank address.

Written RED first: 12 failures before implementation, 14/14 green after. Re-exported from the
`packages/core/src/index.ts` barrel in alphabetical position (`cash` → `contacts` → `dashboard`).

**VALIDATION rows 2 and 3 are green.**

### Task 2 — three tables and one optional field (commit `38ac3d2`)

`packages/backend/convex/schema.ts`:

- `contacts` — `by_tenant_email`, `by_tenant_createdAt`. `email` is documented as ALREADY
  normalized by the write boundary. `unsubscribedAt` carries the mandated DISPLAY MIRROR ONLY
  comment; `consentWording`/`consentContext` carry the mandated CLAUDE.md §4 content-plane comment.
- `followUps` — `by_tenant_status_dueAt`, `by_tenant_contact`. `dueAt` REQUIRED, `contactId`
  optional, `sourcePlanId` an id (refs-only by construction).
- `suppressions` — `by_tenant_address`, the ONE index the send guard reads.
- `tenantProfiles.postalAddress: v.optional(v.string())` immediately after `blueprintConfirmedAt`,
  a single free-text block (not a structured object), with the "ALL optional ⇒ NO migration
  (convex-migration-helper: Safe Changes → Adding Optional Field)" idiom.
- The set-level gravestone comment: no `opportunities` table, no stage enum, no `amountCents` —
  PIPE-01 and SC#8.

`plans.kind` was deliberately NOT touched (19-06 owns that edit).

### Task 3 — the playbook and its watch registration (commit `a78a169`)

`docs/playbooks/contacts-crm.md`, every TEMPLATE section filled, with the three load-bearing ones:

1. **SC#7's written reconciliation.** A `contacts` row is not a cache — it exists only because a
   human deliberately made it. All three halves of the original invariant are restated as unchanged
   (no write from header resolution, `clearCandidates` still wipes on pick, `candidates`/
   `pendingValid` never survive the pick), and the change-safety rule is explicit: a code path that
   writes a contact row without a human act is forbidden, and **`resolveContacts` (`llm.ts`) never
   calling a contacts write is how that stays provable.** The playbook also states plainly that
   this invariant has no automated enforcement — a gap, listed as one.
2. **The suppression split.** Guard reads `suppressions` only; `unsubscribedAt` is a mirror;
   suppression outlives the contact; un-suppressing needs an explicit confirm plus a refs-only
   audit row.
3. **The four tiles are always-known counts.** A real zero renders `0` — never `—`, never
   `Unknown`; `Unknown` must not exist as a state on the page (the 26-10 lesson, from the other
   side).

`watch.json` gained a `"contacts-crm.md"` key with exactly the five specified prefixes.
`apps/web/e2e/pipeline.spec.ts` was deliberately NOT added — the playbook's Key files section
records that `dashboard-pages.md` owns it.

**VALIDATION row 22 is green.**

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @pikar/core test -- contacts` | 32 files / 686 tests green (contacts.test.ts 14/14) |
| `pnpm --filter @pikar/core typecheck` | clean |
| `pnpm --filter @pikar/backend test -- schema` | 4/4 green |
| backend `npx tsc --noEmit` | exit 0 **before and after** — delta 0 |
| `pnpm test` (full turbo) | 9/9 packages, backend 71 files / 1310 tests green |
| `node scripts/check-playbooks.mjs` | exit 0 |
| watch.json / playbook content assertions | both `ok` |
| `biome check` on all six touched files | clean |
| structural scan of the schema diff | only the mandated gravestone COMMENT mentions the forbidden tokens; no field, table or index carries one |

**The backend typecheck baseline was re-measured, not quoted: it is 0 errors, exit 0.** Both the
`13` in `19-VALIDATION.md` and the `150` in STATE.md are stale — something has swept the remaining
test-file errors since those were written. Re-measure again before quoting this.

`graphify update .` + `node scripts/extract-convex-edges.mjs` were run: 14198 nodes / 16194 edges,
+401 convex edges, +59 table edges over 36 tables (the three new tables are now in the graph).

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 — missing critical validation] `renderFooter` also throws on a blank unsubscribe URL**
- **Found during:** Task 1
- **Issue:** The plan specified fail-closed on a blank postal address only. A footer rendering
  `Unsubscribe: ` with nothing after it is the same defect — it looks compliant and is not, and a
  dead unsubscribe link is arguably the worse of the two.
- **Fix:** A second guard with the same shape and its own test.
- **Files:** `packages/core/src/contacts.ts`, `packages/core/src/contacts.test.ts`
- **Commit:** `0abc73b`

**2. [Rule 3 — blocking] Two `v.union` calls reformatted to satisfy Biome**
- Biome's formatter collapses `v.union(...)` arguments onto one line at the configured width;
  the multi-line form written first failed `biome check`. Same for the `renderFooter` parameter
  object. Purely mechanical.

### Field-name choices left to discretion

`followUps` uses `note: v.string()` for the plan's "title/note text field" — one field, not two;
the Pipeline's "Next step" column renders it directly.

## Known issue — a foreign lane's work landed in commit `38ac3d2`

This tree is shared by parallel lanes (not git worktrees). Between the Task 1 and Task 2 commits, a
foreign lane (`cash-business-finance`) staged five files into the shared index. `git commit -m` in
Task 2 committed the whole index, so `38ac3d2` contains `CashView.tsx`, `cashView.test.ts`,
`dashboard-pages.md`, `cash.ts` and `cash.test.ts` alongside `schema.ts`.

**Deliberately NOT rewritten.** A `git reset --soft` while another agent is actively committing to
the same branch risks losing that lane's work — a strictly worse outcome than a muddled commit
message. Nothing is lost; the foreign changes are intact and attributable by path.

**Mitigation applied from Task 3 onward:** commit with the pathspec form
(`git commit -m "…" -- <paths>`), which commits only the named paths regardless of index state.
Commit `a78a169` is clean at exactly 2 files. **Every later plan in this phase should use the
pathspec form.**

## Notes for the next plans

- Import `normalizeAddress` from `@pikar/core` — do not write `.toLowerCase()` at a call site. That
  is the entire point of the function, and invariant 4 in the playbook says so.
- `packages/backend/convex/contacts.ts` and `contacts.test.ts` are already registered in
  `watch.json`, so creating them will not trip the Stop hook — but any commit touching them MUST
  bump `contacts-crm.md`'s `Last verified` line.
- `apps/web/app/(app)/dashboard/pipeline/` is registered as a directory prefix; the page component
  and its `.test.ts` (NOT `.test.tsx` — the web vitest config includes `app/**/*.test.ts` only)
  both land under it.
- Schema changes here needed **no** `npx convex codegen` run: `_generated/dataModel.d.ts` derives
  table types generically from `schema.ts`. Codegen is only needed for a new *module*.

## Self-Check: PASSED

- `packages/core/src/contacts.ts` — FOUND
- `packages/core/src/contacts.test.ts` — FOUND
- `docs/playbooks/contacts-crm.md` — FOUND
- `packages/backend/convex/schema.ts` — FOUND (contacts / followUps / suppressions / postalAddress present)
- `docs/playbooks/watch.json` — FOUND (`contacts-crm.md` key present)
- commits `0abc73b`, `38ac3d2`, `a78a169` — all FOUND in `git log`
