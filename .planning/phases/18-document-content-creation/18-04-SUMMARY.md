---
phase: 18-document-content-creation
plan: 04
subsystem: vault-write-plane
tags: [vault, provenance, tenant-isolation, retrieval-exclusion, replace-in-place]
requires:
  - "18-02 (vaultDocuments.origin + vaultSources.role/snippet/form must exist in schema.ts)"
provides:
  - "internal.vault.insertCreatedDoc — the governed created-artifact write (12 fields, one row)"
  - "internal.vault.patchCreatedDoc — replace-in-place revision with BOTH guards + oldStorageId"
  - "vaultSources.insert accepting role/snippet/form (the Output-card row shape)"
  - "vaultSources.byThread({ threadId, role? }) — a role-FILTERED latest-wins read"
  - "The retrieval exclusion, implemented as the absence of a startIngest call"
affects:
  - "18-06 (the createDocument tool is a thin caller over both mutations + vaultSources.insert)"
  - "18-07 (the Output card reads byThread({ role: 'created' }) and renders its `form` as the badge)"
  - "18-10 (the drift filter reads the `origin: 'agent'` this mutation writes)"
tech-stack:
  added: []
  patterns:
    - "Structural exclusion: a capability is removed by NOT wiring it, not by adding a filter"
    - "Refusal-by-return ({ ok: false }) rather than by throw, so the caller can phrase it"
    - "#index → docId resolution INSIDE the mutation, so raw _ids never reach the model"
key-files:
  created:
    - packages/backend/convex/createdDocs.test.ts
  modified:
    - packages/backend/convex/vault.ts
    - packages/backend/convex/vaultSources.ts
decisions:
  - "storageId trap: took option A — store a real blob and pass its id — so straight-through is proved in BOTH directions in this file"
  - "ONE vaultSources row per turn carries all N docIds; that is what makes `replace: 2` addressable"
  - "byThread's no-role read is now `role === undefined`, not a bare `.first()` — SourceCard must not start rendering created rows now that the table is dual-purpose"
  - "Dropped the sibling `@ts-expect-error import.meta.glob` idiom: the directive is dead under this tsconfig and would have made the typecheck delta +1"
metrics:
  duration: ~65 min
  completed: 2026-08-01
---

# Phase 18 Plan 04: The Vault Write Plane Summary

Two internal mutations in `vault.ts` (`insertCreatedDoc`, `patchCreatedDoc`), the Output-card row
shape on `vaultSources`, and a 10-test file proving SC1, SC1b, SC3 and SC7 — with the locked
retrieval exclusion implemented by **not writing a line**.

## What Shipped

**Task 1 — `insertCreatedDoc` (`3b669fc`).** One `internalMutation` mirroring `ingestFromAttachment`
(explicit `tenantId`, internal-only, refs in, one row out). All twelve schema-required fields;
`kind` is `created_document` / `created_content`, `mimeType` is `text/markdown` for BOTH forms,
`category` comes from `categoryFor({ source: "agent" })` → `workspace-docs`, `origin: "agent"`,
`status: "ready"`. `storageId` is written **straight through from args** — the mutation renders
nothing, because `pdf-lib` is unusable outside a `"use node"` module.

**Task 2 — `patchCreatedDoc` + the card row (`a90b417`).** `vaultSources.insert` gained
`role`/`snippet`/`form` (all optional, straight through); `byThread` gained an optional `role` and a
filtered `.take(20).find(...)` read. `patchCreatedDoc` resolves the 1-based `#index` against that
filtered card **inside the mutation**, guards on tenant AND origin, patches the same `_id`, and
returns `oldStorageId` so the tool can delete the superseded PDF after the patch persists.

**Typecheck hygiene (`6bc39fa`).** See *The typecheck baseline* below.

## The two signatures plan 18-06 calls

```ts
internal.vault.insertCreatedDoc({
  tenantId: string, title: string, form: "short" | "long",
  markdown: string, contentHash: string, storageId?: Id<"_storage">,
}) => Promise<Id<"vaultDocuments">>

internal.vault.patchCreatedDoc({
  tenantId: string, threadId: string, index: number /* 1-based */,
  title: string, form: "short" | "long",
  markdown: string, contentHash: string, storageId?: Id<"_storage">,
}) => Promise<{ ok: false } | { ok: true; oldStorageId?: Id<"_storage"> }>
```

**`patchCreatedDoc` never throws.** Every refusal — bad `#index`, missing doc, foreign tenant,
non-agent `origin` — is `{ ok: false }`. The tool turns that into a sentence.

**`insertCreatedDoc` does NOT hash.** `contentHash` is an argument, not derived. The caller owns it
(`convex/lib/hash.ts` `contentHash(s)`), matching how the tool already has the markdown in hand.

**`insertCreatedDoc` does NOT dedup.** Unlike `ingestFromAttachment` there is no
`by_tenant_contentHash` lookup: "give me three LinkedIn post options" can legitimately produce two
identical short artifacts, and deduping them would silently return a 2-element `docIds` array for a
3-document turn, breaking `#3`.

## `vaultSources.insert`'s full arg list

```ts
internal.vaultSources.insert({
  tenantId, threadId, docIds: Id<"vaultDocuments">[], titles: string[], count: number,
  role?: "created", snippet?: string, form?: "short" | "long", createdAt: number,
})
```

Plan 18-06 passes `role: "created"`, a `snippet` (first ~240 chars) and `form`. Plan 18-07 reads
`form` for the UPPERCASE type badge — it is the ONLY thing the card can read for that, since
`byThread` returns a `vaultSources` row and the short/long discriminator otherwise lives on
`vaultDocuments.kind`, which the card never reads.

### The decision that must not be changed later

**ONE `vaultSources` row per turn carries ALL N `docIds`.** That is precisely what makes
`replace: 2` addressable: `patchCreatedDoc` resolves `card.docIds[index - 1]`. Splitting a
multi-document turn into N rows later would silently reduce every `#index` to `#1`. The invariant is
written into `vaultSources.insert`'s doc comment so the next editor sees it at the site.

## The retrieval exclusion is an ABSENCE, and it is annotated as one

`insertCreatedDoc` does not call `startIngest`. A row with no rag entry and no graph nodes is
unreachable by **both** halves of `runVaultGround`, so no filter exists anywhere to forget to apply.
A 12-line block comment says this at the site, names the shipped precedent (`blueprint.ts`
`confirmBlueprint`, likewise `ready` without ingest), and names the promotion path (patch `origin`
to `agent_promoted` + call the already-exported `startIngest` — a UI addition, not a migration).

Measured, not asserted: **`startIngest(ctx` call sites in `vault.ts` are unchanged at 5.** The
grep-for-the-word count went 7 → 9 because the mandated comment names `startIngest` four times; the
plan's `grep -c` done-criterion and its "write the comment" instruction are in direct conflict, and
the call-site count is the one that carries the meaning.

`git diff packages/backend/convex/vaultIngest.ts` is **empty**.

**The ponytail note about the vault UI search box** is at the same site: created docs will NOT appear
in `vault.vaultSearch`'s results (same rag primitive), though they DO appear in the browse grid for
free (`listVaultDocs` collects the tenant partition with no kind/status/origin filter). Accepted for
beta; upgrade path is a ~3-line title-substring fallback in `DocGrid`'s filter. **Owner question,
still open, raised in 18-09's gate.**

## The storageId trap: option A was taken

18-RESEARCH's copyable snippet asserts `expect(row.storageId).toBeDefined()` after a call that passes
no `storageId` — guaranteed RED, and "fixing" it would drag `pdf-lib` into a Convex mutation.

**Taken: option A** — `storePdf()` stores a real `Blob(["%PDF-1.4"])` via `t.run` and passes its id,
and the assertion is strengthened from `toBeDefined()` to `toBe(storageId)`. Kept here rather than
deferred to 18-06 because straight-through is a property of *this mutation*, and pairing it with the
`form: "short"` case (`toBeUndefined()`) proves the property in **both** directions in one file.

## Mutation check (mandatory, performed)

Deleted the `doc.origin !== "agent"` conjunct from `patchCreatedDoc`'s guard:

```
× SC7: a revision cannot overwrite a user-uploaded document
Tests  1 failed | 9 passed (10)
```

Exactly 1 RED, and the right one. Reverted ⇒ **10/10 green**. The guard is load-bearing, not
belt-and-braces: without it a `vaultSources` row pointing at a user upload lets agent prose
overwrite the user's own document.

**The role filter was checked non-vacuously too.** Both the `byThread` test and the SC7
same-`_id` test insert a **grounding** card (`role` absent) *after* the created card — the exact
"one searchVault turn between a create and a revise" sequence that a bare `.first()` breaks. Under
`.first()` those tests resolve `#1` to the wrong row.

## Verification

| Gate | Result |
| --- | --- |
| `vitest run convex/createdDocs.test.ts` | **10/10 green** |
| `vitest run convex/createdDocs.test.ts convex/vault.test.ts` | **38/38 green** |
| `+ convex/vaultGround.test.ts convex/traceParity.test.ts` | **54/54 green** |
| `turbo run typecheck --filter=@pikar/backend --force` | **150 — delta 0, ZERO non-test, ZERO attributable to this plan** |
| `git diff --stat` on `vaultIngest.ts` / `actionType.ts` / `cockpit.ts` / `plans.ts` | **empty** |
| `node scripts/check-playbooks.mjs check` | exit 0 (see the caveat below) |
| This plan's file count | exactly 3 |

### The typecheck baseline: 150, and one measurement that lied

**Delta 0 against 18-02's recorded 150.** Zero errors in any production `convex/*.ts`, and zero
naming any of this plan's three files.

Two things worth carrying forward:

1. **A backgrounded `turbo typecheck` can be read before its output file has flushed.** The first
   measurement of this run returned **27** and an empty non-test list — both plausible, and 27 was
   nearly acted on as the new baseline. It was wrong: the file was truncated mid-write. Three
   foreground re-runs returned 151 / 151 / 150. **Do not measure the baseline from a backgrounded
   run's output file.** (This is a different failure mode from 18-02's transient 152, which was real
   cross-lane interference.)
2. **Do not copy the sibling `// @ts-expect-error import.meta.glob` line into a new backend test
   file.** `packages/backend/tsconfig.json` includes `vitest.config.mts`, which pulls Vite's global
   types in, so `import.meta.glob` typechecks and the directive is **dead** — tsc reports TS2578.
   That one dead directive is **100 of the backend's 150 errors**, repeated across 37 files, and
   22.1-03 is actively sweeping them. Copying it was a real **+1 delta**; dropping it landed exactly
   150. A comment at the site says why, so the next author does not "restore" the idiom.

### The playbook hook passed, and that is a FALSE NEGATIVE — record it

`vault.md` watches `packages/backend/convex/vault.ts`, which this plan edits, so §9 says vault.md is
owed. The hook exits 0 anyway because **foreign lane 22.1-02 bumped `vault.md`'s `Last verified`
earlier today**, which satisfies the "touched since baseline" test for everyone.

**Deliberately NOT satisfied here.** The plan assigns vault.md + cockpit.md to **18-09**, and bumping
a `Last verified` a foreign lane already owns would claim verification of a diff this plan never
read. **18-09 must not treat a green hook as evidence the obligation is discharged.**

## Deviations from Plan

**None of substance.** Both tasks executed as written; no auto-fix rules fired. Four things recorded
rather than papered over:

1. **The `grep -c "startIngest"` done-criterion is unsatisfiable as literally written** (see above).
   Verified via the call-site count instead, which is what the criterion means.
2. **`byteLen` was reused instead of the research snippet's inline `new TextEncoder().encode(...)`.**
   `vault.ts:39` already exports exactly that helper (ponytail rung 2). Behaviour identical.
3. **`byThread({ threadId })` with no role is now `role === undefined`, not `.first()`.** Strictly a
   correction: pre-18 every row had no role so the two agreed, but now that created rows share the
   table a bare `.first()` would feed `SourceCard` a created row. The plan specifies this shape; it
   is called out here because it is a behaviour change to a SHIPPED surface, small and safe.
4. **The dead `@ts-expect-error` (see above).** One deliberate divergence from a 37-file idiom.

**Out of scope, not touched:** the backend suite is still unreliable as a whole-suite gate in this
four-lane tree (18-02 documented two runs disagreeing). Gated on the four suites above, run directly.

## Notes for the Next Plan

- **18-06 owns three things this plan deliberately does not do:** hashing the markdown, rendering the
  PDF, and `ctx.storage.delete(oldStorageId)` — the last one **only when
  `oldStorageId !== a.storageId`**, and **after** the patch resolves (the `regenerateAttachment`
  ordering: never orphan a live ref).
- **18-06 must write the `vaultSources` row on a REVISE as well as a create** — same `docIds`, new
  `titles`/`snippet`/`form`. The table is append-only and `byThread` reads the latest, so the Output
  card refreshes with zero new code.
- **18-06's audit call belongs in the tool, not in `cockpit.ts`** (`llmRedaction.test.ts` pins that
  file's audit call-site count at 2), and carries refs/hashes/ids/counts only.
- **18-07's badge reads `vaultSources.form`**, not `vaultDocuments.kind`. Both are written; only the
  former is on the row `byThread` returns.
- **18-10's drift filter reads the `origin: "agent"` written here.** Nothing in this plan touches
  `blueprint.ts`.

## Self-Check: PASSED

- `packages/backend/convex/createdDocs.test.ts` — FOUND (313 lines, 10 tests, > the 120 min_lines)
- `packages/backend/convex/vault.ts` — FOUND, exports `insertCreatedDoc` and `patchCreatedDoc`
- `packages/backend/convex/vaultSources.ts` — FOUND, `insert` carries `role`/`snippet`/`form`,
  `byThread` carries the `r.role === role` filter
- Commit `3b669fc` — FOUND
- Commit `a90b417` — FOUND
- Commit `6bc39fa` — FOUND
