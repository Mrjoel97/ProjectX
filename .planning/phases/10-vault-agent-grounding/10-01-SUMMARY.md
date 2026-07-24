---
phase: 10-vault-agent-grounding
plan: 01
subsystem: vault-grounding
tags: [vault, grounding, hydration, internalAction, VALT-03, VGND-01]
requires:
  - internal.vault.ownedDocsMeta (tenant-scoped batch title read)
  - internal.vault.getDoc (fail-closed per-doc text read)
  - internal.vaultGraph.expand (hop-capped tenant BFS)
  - "@pikar/vault fuse"
provides:
  - internal.vaultGround.vaultGroundHydrated ({tenantId, query} -> {docIds, titles, chunks})
  - runVaultGround shared retrieval helper (both entry points)
affects:
  - Plan 10-02 runCockpitAgent / searchVault tool (consumes vaultGroundHydrated)
tech-stack:
  added: []
  patterns:
    - identity-less internalAction with explicit tenantId arg (gmail.search / llm.digestInbox convention)
    - shared module-level helper feeding a public tenantAction + an internalAction (zero duplication)
key-files:
  created: []
  modified:
    - packages/backend/convex/vaultGround.ts
    - packages/backend/convex/vaultGround.test.ts
    - docs/playbooks/vault.md
decisions:
  - "Hydration budget: PER_DOC_CHAR_CAP=1500, TOTAL_CHAR_CAP=8000 (Claude's-discretion from 10-CONTEXT) — a large fused corpus never blows the agent-loop context."
  - "No Biome allow-list change needed: §2's noRestrictedImports bans only query/mutation/action, not the internal* builders, so importing internalAction is already permitted."
metrics:
  duration_min: 5
  tasks: 2
  files_changed: 3
  tests: "12/12 vaultGround green"
  completed: 2026-07-24
---

# Phase 10 Plan 01: Vault Grounding Hydration Summary

Gave the retrieval engine a hydrated path — `vaultGroundHydrated`, an identity-less
`internalAction` returning real doc TITLES + per-doc/total char-capped chunk TEXT parallel to a
tenant-scoped, hop-fused docId list — so Plan 02's identity-less `runCockpitAgent`/`searchVault`
tool can fence actual vault content into the agent loop instead of the id-only placeholder.

## What Was Built

- **`runVaultGround(ctx, tenantId, query)`** — the existing `vaultGround` handler body extracted
  verbatim into a plain module-level helper that reads the tenant from an EXPLICIT `tenantId`
  parameter (not `ctx.auth`). SMOKE:: seam, `rag.search` namespace, `ownedDocsMeta`, `expand`, and
  `fuse` all route the same `tenantId`. Returns `{docIds, context}` unchanged.
- **Public `vaultGround` tenantAction** — now a one-line handler calling
  `runVaultGround(ctx, ctx.tenantId, query)`. Its args, name, `{docIds, context}` return, ranking,
  and BOTH pre-existing public tests are byte-for-byte unchanged.
- **`vaultGroundHydrated` internalAction** (`args {tenantId, query}`) — calls `runVaultGround` for
  the fused docIds (zero duplicated retrieval), then hydrates: titles via the tenant-scoped batch
  `internal.vault.ownedDocsMeta` (`_id -> title` map keeps them parallel), chunk text via
  `internal.vault.getDoc`, each slice bounded by `PER_DOC_CHAR_CAP` (1500) with a running
  `TOTAL_CHAR_CAP` (8000). Returns three parallel arrays `{docIds, titles, chunks}` (the Plan-02
  contract). Text is returned into the loop ONLY — no audit/DLQ/telemetry write (§4).
- **Tests** — a new describe block driving `vaultGroundHydrated` via `internal.*` with an explicit
  `tenantId` and NO identity (matching the cockpit tool harness): hydration parity + per-doc cap,
  total-budget cap across six hub-fused docs, and cross-tenant isolation (foreign explicit
  `tenantId` -> `{docIds:[], titles:[], chunks:[]}`).
- **Playbook** — `docs/playbooks/vault.md` records the shared-helper + hydration path; `Last
  verified` bumped to `2026-07-24 (7)` (§9).

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (RED) | failing hydration tests | ca71790 | vaultGround.test.ts |
| 1 (GREEN) | vaultGroundHydrated + runVaultGround | 51e402c | vaultGround.ts, vaultGround.test.ts |
| 2 | vault playbook §9 | 5f2c93f | docs/playbooks/vault.md |

## Verification

- `pnpm --filter @pikar/backend vitest run vaultGround --maxWorkers=1` -> **12/12 green** (hydration
  parity, per-doc + total caps, cross-tenant empty via explicit tenantId, both unchanged public
  engine tests).
- `vaultGround.ts` + `vaultGround.test.ts` typecheck clean; `internal.vaultGround.vaultGroundHydrated`
  resolves for Plan 02. `packages/vault/src/fusion.ts` untouched.
- No audit/DLQ/telemetry write added (§4 — hydration returns text into the loop only).

## Deviations from Plan

None functional. One planned contingency did NOT fire: the Biome import-rule allow-list needed no
change — §2's `noRestrictedImports` bans only `query`/`mutation`/`action`, not the `internal*`
builders, so importing `internalAction` from `./_generated/server` is already permitted.

## Deferred / Out of Scope

- `pnpm --filter @pikar/backend typecheck` (whole package) reports pre-existing errors in unrelated
  test files (`skills.test.ts`, `tenant.test.ts`, `voiceToken.test.ts`, `worm.test.ts`,
  `vault.test.ts` WorkflowId casts) — none in this plan's files, not introduced here. Left as-is per
  the scope boundary.

## Self-Check: PASSED
