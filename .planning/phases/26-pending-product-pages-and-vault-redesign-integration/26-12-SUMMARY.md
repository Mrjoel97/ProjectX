---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 12
wave: 9
requirements: [CONT-01]
status: complete
executed: 2026-08-22
---

# 26-12 — the Content shelf: one bounded read plane over artifacts that already exist

## What shipped

**`packages/backend/convex/content.ts` — three `tenantQuery`s and nothing else.**
`listArtifacts` (the bounded cross-kind union), `summary` (capped filter-chip counts) and
`artifactById` (the same card, by id). No mutation, no scheduler call, no signed-URL minting, no
log-plane write. `content.test.ts` scans the module for each of those *and* asserts that every
`export const` binds a `tenantQuery`.

That shape is the point. The plan asked for tests proving "zero reuse-side writes/audit" and
"signed URLs never enter audit/logs" — but a query **cannot write**, and a module with no
`getUrl` call site has no URL to leak. This is the repo's own structural-exclusion pattern
(`vaultRedaction.test.ts`, `insertCreatedDoc` skipping `startIngest`) applied to a page adapter:
an absent call site cannot be edited into a leak by accident; a carefully-shaped payload can.

**Three terminals already existed, so none of them was rebuilt.** The card carries a `vaultDocId`
and, for a reel, a `planId`; the page asks the existing ownership-checked reader for a capability
only when the user acts.

| Action | Surface | Why not re-wrapped here |
|---|---|---|
| open / download | `api.vault.vaultDownloadUrl` | already tenant-guarded, minted on demand, never logged |
| play a reel | `api.media.reel` | its non-null `url` IS the validated-sidecar guarantee (D8) |
| promote | `api.vault.promoteToReference` | 26-11 owner decision: ONE guarded promotion surface |

`content.ts` reads `origin` only to decide what to **offer**. Whether to **allow** stays in one
place. The two are pinned against each other in a single test: the projection's verdict for each
of `eligible` / `promoted` / `retry` / `not-applicable` is checked by calling the real mutation and
asserting the matching `{ok:…}`, so the page can never grow a button that always refuses (or hide
one that would work).

**The shelf is a positive kind whitelist** — `created_document`, `created_content`,
`next_step_memo`, `reel`. `vaultDocuments.kind` is `v.string()` and grows every phase, so
"everything except the ones I thought of" silently admits the next writer's rows. Research briefs
(`web_research`) stay with the Knowledge Vault and sent mail stays with Reports (CONT-01 as amended
2026-08-22); `requests` is never queried by this module and a test pins that too. This closes the
invariant 26-11 handed on ("research briefs are not projected into the Content shelf").

**A reel plays on three terms, and the third is the one a naive check misses.** Bytes on the row,
the live artifact triple on the plan (`renderStorageId` + `sidecarStorageId` + `renderSummary`),
AND `plan.reelVaultDocId === doc._id`. Without that last term a thread that re-rendered would serve
reel #2's video under reel #1's title — `resetPlan` clears both the triple and the pointer, and
`saveReelToVault` upserts *through* the pointer, so the pointer is what says which reel the plan's
bytes are. Unproved is never silent: `no-plan` / `no-bytes` / `no-sidecar` / `superseded` ride on
the card and the canvas link still opens.

## DEVIATION — one schema line the plan did not list

`files_modified` named three files; `packages/backend/convex/schema.ts` is a fourth.
**`by_tenant_kind` gained `createdAt`** — a third field on an existing index, not a fifth index.

The union is four kind partitions merged into one newest-first order, so its cursor needs a RANGE
on the same read (`.eq(tenantId).eq(kind).lte(createdAt, …)`). Without it the page would have to
over-fetch and discard rows that each carry a `text` blob — the read-cap fault this table's own
comments keep pointing at. Appending was chosen over a new index because it is safe for the one
production caller: `onboarding.currentProfileDoc` `.collect()`s its partition and re-sorts in
memory, so it never depended on the implicit `_creationTime` ordering this replaces. Convex
rebuilds the index on push (the convex-migration-helper skill lists index changes under "When Not
to Use"). No playbook watches `schema.ts`; the reasoning lives in the index's own comment and in
`dashboard-pages.md`.

`docs/playbooks/vault.md` was deliberately NOT touched: the vault's own read/write paths are
unchanged, and a second copy of the index rationale in a second file is the duplication this repo
keeps deleting.

## Evidence

| Check | Result |
|---|---|
| `npx vitest run content.test` (from `packages/backend`) | **20/20** |
| Full backend suite `npx vitest run` | **91 files, 2258 passed, 0 failed** (was 90 / 2237) |
| `tsc --noEmit` (backend) | clean |
| `npx biome check` on the three touched source files | clean, 0 errors, 0 warnings |
| Playbook gate | verified **LIVE**: ack entry cleared + playbook reverted ⇒ `{"decision":"block"}` naming `content.ts` / `content.test.ts`; restored ⇒ silent |
| Mutants | **9 applied and reverted, 9 caught** |

Mutants: M1 drop the tenant term in `artifactById`; M2 drop the kind whitelist in `artifactById`;
M3 drop the cursor after-filter; M4 drop the superseded-pointer term; M5 collapse the failed-ingest
retry branch; M6 put the storage id on the card; M7 write a row from the read plane; M8 drop the
lane filter; M9 drop the tenant term in the reel's plan join.

**M9 SURVIVED the first pass, and that is the one worth reading.** The reel block joins through
`doc.reelMeta.planId` — a field on a row the tenant owns — and the code TRUSTED that the plan it
names is theirs. Nothing asserted it. A test now seeds a reel row pointing at another tenant's
fully-rendered plan and requires `no-plan` plus no foreign thread id anywhere in the card. *Ask what
the code trusts, not only what it checks* — mutation testing cannot see a check nobody wrote, but it
can show you a guard nothing depends on.

## Corrections made in passing

- **Every verify command in `dashboard-pages.md` was the non-filtering form.** `pnpm --filter <pkg>
  test -- <filters>` forwards the separator literally and runs the WHOLE suite (26-11 measured it).
  All corrected. The Playwright lines went further: `test:e2e <file>` does not filter EITHER — this
  playbook already recorded that under "Corrected 2026-08-21" while the code block below it still
  quoted the broken form — so the connected-page block now says `npx playwright test <file>` run
  from `apps/web`. **The three historical entries that quote the broken form on purpose were left
  exactly as they were**; a first blanket replace had mangled them and that was reverted.
- `26-VALIDATION.md`: row 26-12 and the "Quick run command" row both carried the broken form.
- **`node scripts/check-playbooks.mjs` reads its hook input from stdin (fd 0)**, so running it bare
  in a terminal HANGS forever rather than failing. Run it as
  `echo '{}' | node scripts/check-playbooks.mjs check`. This is a third separate way that gate can
  read as "fine" when it never ran — beside the two 26-11 recorded (it only ever exits 0, and the
  ack cache suppresses a re-block).

## A finding handed on, NOT fixed here

**The `agent-relayed` citation label keys only on `origin === "agent_promoted"`, and three
agent-authored document kinds carry no `origin` at all.** A next-step memo, a reel transcript and a
research brief are all written by the agent and all ingested at their write site, so
`evaluations.ts:382` cites them as `source: "vault"` — the same unqualified label the owner's own
uploaded P&L gets. The labeled-number scan in `runEvaluation` runs over EVERY grounded chunk, not
only profile docs, so a figure the agent wrote into a memo can fill a scorecard field and be cited
back as the owner's own source. That is the same provenance-laundering class 26-11 closed on the
promoted-document plane, one door over.

It is out of 26-12's scope by construction — this plan ships a read-only projection and cannot fix
a write-site or grounding-label defect — and it is stated as a code path traced, not as an observed
production incident. Fixing it means either stamping `origin` at those three write sites or widening
the label predicate; both are 26-11-shaped work on the vault/evaluation planes.

## Not done / handed on

- **No UI.** `files_modified` contains no `apps/web/**` file; 26-13 builds the route, the promotion
  control with its one-way warning, the refs-only `vault.promoted` audit row, and the E2E.
- **26-13 gets these refs from the card**: `vaultDocId` (→ `vault.vaultDownloadUrl`,
  `vault.promoteToReference`), `reel.planId` (→ `media.reel`), `reuse.href` and `reel.canvasHref`.
  It must NOT re-wrap any of the three mutations/queries in an `api.content.*` function.
- **Ponytail ceiling, marked at the call site:** a page can skip rows only if MORE than `limit`
  artifacts of ONE kind share a single millisecond (each insert is its own transaction, so that
  needs 24 writes inside one tick). Upgrade path: widen the per-branch window by the boundary ties.
- **Second ponytail ceiling:** `summary` counts by a bounded `.take(51)` per kind over rows that
  carry `text`. Same shape and same ceiling as `vaultStats`. Upgrade path is a maintained counter
  row or the aggregate component — both write-path obligations, so not taken.
- **Still open, not introduced here**: the two red finance tests characterised in 26-10-SUMMARY, and
  26-VALIDATION rows 26-06/07/08.
