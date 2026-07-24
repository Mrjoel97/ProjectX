---
phase: 10-vault-agent-grounding
plan: 02
subsystem: cockpit-vault-grounding
tags: [vault, grounding, searchVault, cockpit, audit, VGND-01, BETA-05]
requires:
  - internal.vaultGround.vaultGroundHydrated ({tenantId, query} -> {docIds, titles, chunks})  # Plan 01
  - internal.audit.log (refs-only insert)
  - contentHash (lib/hash.ts)
provides:
  - searchVault cockpit tool in buildCockpitTools (read-only vault grounding, VGND-01)
  - vaultSources content-plane table + insert/byThread adapter (source-card data plane)
  - vault.searched refs-only audit event ({queryHash, resultCount})
  - searchVault member of the agentSteps.tool closed union (activity step accepted)
affects:
  - Plan 10-03 (later wave) source-card UI + VERB label — reads vaultSources.byThread
  - Plan 10-04 gated when-to-call skill (routing teaching)
tech-stack:
  added: []
  patterns:
    - three-plane split (refs-only audit / content-plane row / fenced text into loop) copied from briefInbox
    - trusted-as-own SC2 labelled untrusted-reference fence (ADR-006) — vault text enters the loop directly
    - identity-less engine call with EXPLICIT tenantId (fail-open swallow would mask a tenantAction UNAUTHENTICATED)
key-files:
  created:
    - packages/backend/convex/vaultSources.ts
    - docs/decisions/ADR-006-vault-chunks-trusted-as-own.md
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/cockpitTools.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/audit-dead-letter.md
decisions:
  - "ADR-006: vault chunks are trusted-as-own — they enter the agent loop DIRECTLY (SC2-fenced), NOT routed through the toolless-ingestion firewall third-party inbox bodies use. Backstops: the labelled fence + the human Approve gate. Upgrade path: a toolless schema-validated digest mirroring digestInbox."
  - "TDD combined RED+GREEN into one feat commit (both phases verified in-process): the schema union member landed in Task 1's commit, so a tests-only red commit would not have compiled __invokeCockpitTool against the tool."
metrics:
  duration_min: 20
  tasks: 3
  files_changed: 7
  tests: "68/68 cockpitTools + vaultGround green (4 new searchVault tests)"
  completed: 2026-07-24
---

# Phase 10 Plan 02: searchVault Cockpit Grounding Tool Summary

Registered `searchVault` — a governed, read-only vault-grounding tool — inside `buildCockpitTools`,
wiring Plan 01's hydrated retrieval engine (`vaultGroundHydrated`) into the Executive Agent loop with
the full governance envelope: a refs-only `vault.searched` audit (§4), an SC2 labelled
`<vault_context>` untrusted-reference fence (SC2), fail-open no-match behavior (SC1), a `vaultSources`
content-plane source card, and a tenant-B-empty isolation assertion (BETA-05). The vault is now
readable by the agent — the root S1 dependency the rest of the milestone builds on — without
loosening any isolation/audit invariant.

## What Was Built

- **`searchVault` tool** (`llm.ts`, inside `buildCockpitTools`) — copies the `briefInbox` three-plane
  split verbatim, refs swapped. Calls `internal.vaultGround.vaultGroundHydrated` with an EXPLICIT
  `{ tenantId, query }` (the internalAction/identity-less convention — a `tenantAction` would throw
  `UNAUTHENTICATED` into the fail-open swallow and always no-match). Writes ONE refs-only
  `vault.searched` audit `{ queryHash: contentHash(query), resultCount }`, a `vaultSources` content
  card on a hit, and returns the retrieved chunk text wrapped in the labelled `<vault_context …>`
  fence. Any engine hiccup or zero-result returns the honest no-match + upload nudge — never a throw.
- **`vaultSources` table + adapter** (`schema.ts` + new `vaultSources.ts`) — the read-only sibling of
  `briefings`: `{ threadId, docIds, titles, count }`, `by_thread` index. `insert` (internalMutation)
  + `byThread` (tenantQuery, explicit `Promise<Doc | null>` return) through the §2 tenant-scoped
  wrappers. Writes NO log-plane row (titles = labels-to-UI, never audited — the briefings.ts property).
  This is the source-card reader Plan 03 consumes.
- **`searchVault` in the `agentSteps.tool` closed union** (`schema.ts`) — without it the SDK's
  activity-step insert throws and is silently swallowed (Pitfall 4). The step is now emitted free by
  the SDK loop; the tool writes no `agentSteps.record` (no double-write, CKPT-05).
- **Four regression tests** (`cockpitTools.test.ts`, TDD) — hydrated fenced return proving genuine
  retrieval (VGND-01), fail-open honest-no-match with no throw (SC1), refs-only payload exactly
  `{queryHash, resultCount}` with no query/chunk substring (SC3, §4), and tenant-B-empty (BETA-05).
- **Governance docs** (§9 definition-of-done) — cockpit.md gained an appendable "Phase 10 — Vault
  grounding" section (three-plane split, fence, fail-open, schema union) with a Plan-03 append marker;
  audit-dead-letter.md registered the `vault.searched` event + refs-only payload; new immutable
  **ADR-006** records the trusted-as-own boundary, its ceiling, and the toolless-digest upgrade path.
  Both playbooks' `Last verified` bumped to `2026-07-24 (10-02)`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | schema union + vaultSources table + adapter | 6ba725e | schema.ts, vaultSources.ts |
| 2 | searchVault tool + 4 regression tests (TDD) | 6e65a85 | llm.ts, cockpitTools.test.ts |
| 3 | governance docs — cockpit + audit playbooks + ADR-006 | f36ffc0 | cockpit.md, audit-dead-letter.md, ADR-006 |

## Verification

- `pnpm --filter @pikar/backend vitest run cockpitTools vaultGround` → **68/68 green** (the 4 new
  searchVault tests + all pre-existing cockpit tools + Plan-01 vaultGround hydration).
- `pnpm --filter @pikar/backend vitest run llmRedaction` → **33/33 green** — the refs-only static
  scan still passes with the new `vault.searched` writer.
- `npx tsc -p tsconfig.json --noEmit` → schema.ts / vaultSources.ts / llm.ts / cockpitTools.test.ts
  all clean; the 52 remaining errors are pre-existing unrelated test files (the Plan-01 baseline).
- `node scripts/check-playbooks.mjs` → exit 0 (§9 Stop-hook clean for the changed paths).
- `graphify update .` + `node scripts/extract-convex-edges.mjs` → graph current (+197 convex edges).
- Stayed inside the file-ownership boundary: did NOT touch `vaultGround.ts`, `cards.tsx`, or
  `PreviewModal.tsx`.

## Deviations from Plan

None functional. Two small notes:

1. **Test seed field**: `vaultDocuments` requires `createdAt` (schema) — the RED tests initially
   omitted it and the seed insert bounced; added `createdAt: Date.now()` to the seed helper. A test
   fixture correction, not a code deviation.
2. **TDD commit shape**: RED and GREEN were verified in sequence in-process but committed together as
   one `feat` commit. The `searchVault` schema-union member had to land in Task 1's commit, so a
   tests-only red commit would not have compiled `__invokeCockpitTool` against the tool — the split
   would have been a broken intermediate, not a clean RED.

## Deferred / Out of Scope

- The whole-package `pnpm --filter @pikar/backend typecheck` still reports the same pre-existing
  errors in unrelated test files (`skills.test.ts`, `tenant.test.ts`, `vault.test.ts`, etc.) noted in
  the Plan-01 summary — none in this plan's files, left as-is per the scope boundary.
- Source-card UI + `VERB` label (`cards.tsx`) and the when-to-call skill teaching are Plan 03 / Plan
  04 (later waves) by design — the cockpit.md section is marked for Plan 03 to append.

## Self-Check: PASSED

- FOUND: packages/backend/convex/vaultSources.ts
- FOUND: docs/decisions/ADR-006-vault-chunks-trusted-as-own.md
- FOUND commits: 6ba725e (Task 1), 6e65a85 (Task 2), f36ffc0 (Task 3)
