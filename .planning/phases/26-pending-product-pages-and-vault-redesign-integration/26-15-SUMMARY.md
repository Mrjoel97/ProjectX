---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 15
wave: 11
requirements: [RPRT-01]
status: complete
executed: 2026-08-22
---

# 26-15 — the audit viewer is safe by filtering, and the mockup said otherwise

## The claim this plan was built to destroy

`docs/design/mockups/pending-pages.html` promised, under the governance table:

> Rows carry **refs, hashes, ids and counts only** — never message bodies, addresses or PII. That is
> a schema property, so this viewer is safe by construction, not by filtering.

**It is not a schema property.** `audit.log` declares `payload: v.any()` and then writes
`const payload: AuditPayload = args.payload` — an interface, erased at runtime, assigned straight
out of `any` with no check. 96 write sites across 40 modules feed that field.

And the contract is already broken in production: **`piiCounts: Record<string, number>` is a nested
object sitting in the `audit` table right now** — `intake.ts:253`, `pipeline.ts:196`,
`vaultExtract.ts:497`. `AuditPayload`'s own header says nested objects are "not representable". They
are representable. They are simply not TYPED.

So the viewer is safe by FILTERING, and this plan is the filter.

## What shipped

**`packages/contracts/src/auditProjection.ts`** — two independent gates:

1. **KEY** — a per-event allowlist, read off all 96 write sites (72 events, plus the six the
   indirect helpers in `pipeline.ts` / `calendarComplete.ts` / `skills.ts` emit). A key not named for
   that exact event never appears; an event with no row at all yields a SHELL — timestamp, actor,
   correlation, zero payload detail. This fails CLOSED: a new event added next phase shows less than
   it could until someone adds a row, which is the direction a privacy boundary should fail.
2. **SHAPE** — every surviving value must still be a bounded, whitespace-free, markup-free primitive
   or an array of them. Objects, arrays of objects, oversized strings and non-finite numbers are
   DROPPED. Never truncated (half a body is still a body) and never stringified — there is no `else`
   branch reaching for `JSON.stringify`, which is the one line every boundary like this leaks through.

Actors normalize to a closed set (`you` / `system` / `agent` / `owner`); a raw user or tenant id
never crosses the boundary. Categories are DERIVED from the allowlist's own keys, never typed a
second time beside it — 26-14 shipped a defect that was exactly a hand-typed copy of a closed set
drifting from the set it copied.

**`packages/backend/convex/reportsGovernance.ts`** — `auditPage` (tenantQuery, cursor-paginated on
`audit.by_tenant_ts`, projected inside the handler so the raw row never reaches a serialized return
value), plus `wormExport` and `activeSkills` as `ownerQuery`s.

### Three keys are deliberately absent, and the reasons are the reusable part

- **`piiCounts`** — nested. The SHAPE gate would drop it anyway; keeping it out of the KEY gate is
  what stops `unsafeDrops` firing on every redaction row, so a non-zero count stays a real signal
  rather than background noise. *ponytail:* the redaction count is genuinely useful governance
  information — the upgrade path is flattening it to a `piiTotal` at the write site, not teaching
  the projection to walk objects.
- **`userId` / `ownerUserId`** (`owner.granted`, `owner.revoked`, the skill activations) — a raw
  identity walking around the front door the actor normalizer guards. The grant is the governance
  fact; the subject's id is not.
- **`tenant.deleted`'s `deleted_<table>` counts** — their key names are computed from
  `deletableTables()` at runtime and cannot be enumerated honestly. The row still shows its hash,
  its auth-credential count and both providers' outcomes.

### The WORM card is a cursor position, not a health verdict

The mockup's second false claim was a green **Healthy** pill and "Last export 06 Aug 03:00 · 412
rows · lag 5h". `exportCursors` holds exactly one number: the ts the exporter last said it had
written. **No S3 object is read back and no Object Lock retention is checked** — a cron that died
mid-upload after advancing looks identical to a healthy one.

`wormExport` therefore returns `lastCursorAdvanceMs` (null until it has ever advanced, which is a
different fact from "0 rows behind") and **deliberately returns no `healthy` and no `status` field**.
A test asserts those keys are ABSENT, because a verdict this data cannot support must not be
inventable downstream. `rowsAwaitingExport` is a floor (`take(CAP+1)` → slice); `oldestAwaitingMs` is
exact and is the honest version of "lag".

**Both corrections were also made in the mockup itself.** 26-17 builds the UI from that file, and a
backend that refuses to claim health does not help if the page it feeds still renders a green pill —
the 26-14 lesson (a backend fix that never reached the renderer) applied before it could repeat.

## The mutant that found a guarantee with zero coverage

"Never stringify the payload as a fallback" is the plan's own words, and it had **two tests**. Both
passed with a `JSON.stringify` fallback installed.

Both fed a nested object under a key the ALLOWLIST already refuses (`piiCounts`), so the shape gate
was never entered. The tests were measuring gate 1 while claiming to measure gate 2.

> **A test that refuses input at gate 1 proves nothing about gate 2.**

Fixed by putting an object in an ALLOWLISTED key, and the injection sweep now feeds every needle
three ways — bare, object-wrapped, array-wrapped — across every allowlisted key of every event.

## Two existing guards caught this plan's own changes

Neither was a test I wrote, and both are worth recording:

- **`isolation.test.ts`'s self-growing owner surface** went red the moment `reportsGovernance` added
  two `ownerQuery`s (16 → 18). Its generated sweep now also exercises non-owner rejection for both,
  independently of this plan's own tests.
- **`llmRedaction.test.ts`'s RCE-door scan** went red because lifting `seeds` to module scope as
  `SEEDS` broke its non-vacuity anchor (`/const seeds = \[/`). That anchor exists precisely so the
  four "no assemble script in the registry" bans cannot pass by scanning nothing — **a rename would
  have silently disarmed a security scan if the guard had been written any softer.**

## What this does NOT claim

The guarantee is SHAPE. A credential-shaped token (`sk-live-0000`) is character-for-character
indistinguishable from a document id, so a write site that puts one in an allowlisted key defeats
this and no projection can see it. Redact-then-write (CLAUDE.md §4) is still the primary control;
this is the second one. Stated in the test rather than implied by omission.

The drift guard is likewise asymmetric on purpose: the forward scan (production literal → allowlist)
sees the direct `eventType: "literal"` form, ~90% of sites, but not the indirect helpers; the reverse
scan (allowlist → source) is complete. **Invention is the failure that lies to the owner; omission
only under-shows. The complete guard is on the liar.**

## Deviations

- **`packages/contracts/src/index.ts` was NOT modified**, though the plan names it. That file's own
  header states the package is consumed via the `./*` subpath export and that domain modules "do NOT
  require editing this file" — `audit.ts`, `skill.ts` and `tenant.ts` are all absent from it. Adding
  an export would have violated the invariant the file documents.
- **Four backend files the plan did not list.** `skills.ts` (the `seeds` array lifted to module
  scope as `SEEDS` + `REGISTRY_SKILL_NAMES` derived from it — `activeSkills` needs the enumeration
  to drive one indexed read per skill instead of collecting every version ever published, and a
  second hand-typed list of those names is the drift 26-14 shipped); `wormCursor.ts` (`CURSOR_NAME`
  exported, so the reader names the same row the exporter advances); `reportsBusiness.ts`
  (`MAX_WINDOW_MS` exported, so Reports cannot grow two definitions of how far back it looks);
  `isolation.test.ts` (owner surface 16 → 18, and the `audit.by_ts` exception note now names its new
  owner-plane consumer). Plus `llmRedaction.test.ts`'s anchor, above.
- **`docs/design/mockups/pending-pages.html`** — see above; correcting the backend without
  correcting the spec 26-17 reads from would ship both claims anyway.
- **Playbooks:** `audit-dead-letter.md` (named by the plan), plus `dashboard-pages.md` and
  `skill-registry.md`, both required by the watcher for the modules this plan touched.
  `auditProjection.ts` + its test are registered under `audit-dead-letter.md` in `watch.json`.

## Evidence

- contracts: 4 files / **64 passed**, `auditProjection` **21/21**, typecheck clean.
- backend: 94 files / **2314 passed / 0 failed**, `reportsGovernance` **17/17**, typecheck clean.
- **Mutation-verified, applied and reverted:** 5 on the projection (stringify fallback for objects —
  SURVIVED the first pass and drove a new test; prototype-key walk on the allowlist lookup; `@`
  admitted to the ref charset; truncate-instead-of-drop; unknown-actor default) and 6 on the module
  (`wormExport` as a tenantQuery; `activeSkills` returning `body`; the cursor's strictly-after
  filter dropped; `gte` → `gt` on the window's lower bound; the invariant signal fired
  unconditionally; the raw row returned instead of the projected one). All caught after the fix.
- biome clean on every touched file (the 5 remaining warnings are pre-existing in
  `llmRedaction.test.ts` and untouched by this plan); playbook watcher clean.

## Not done / handed on

- **No `apps/web` file.** 26-17 owns the route, the section layout and the browser gate, and must
  render `known: false` rows as shells rather than hiding them — a governance record with holes in
  it is worse than one with shells.
- **`activeSkills` reports only skills that HAVE an active version.** A skill with none is absent
  rather than reported at v0. *ponytail:* surfacing "no active version" is real — an unseeded
  `document-classifier` makes `classifyDoc` fail closed and every document classify as
  `unclassified` — and the upgrade path is returning the registry with `version: null` for the gaps.
- Still open, not introduced here: the agent-relayed citation-label gap from 26-12-SUMMARY, and
  26-VALIDATION rows 26-06/07/08.
