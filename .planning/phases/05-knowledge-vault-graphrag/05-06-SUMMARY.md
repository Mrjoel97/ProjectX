---
phase: 05-knowledge-vault-graphrag
plan: 06
subsystem: ui
tags: [react, nextjs, convex, vault, graphrag, upload, modal]

# Dependency graph
requires:
  - phase: 05-04
    provides: vault ingest mutations (vaultIngestText / vaultUpload) + deleteVaultDoc cascade
  - phase: 05-05
    provides: read plane (listVaultDocs / vaultStats / vaultDownloadUrl / docEntities / vaultSearch)
provides:
  - "/dashboard/vault route — the user-facing Knowledge Vault surface (browse / search / upload / paste / preview / download / delete)"
  - "Knowledge Vault nav entry in (app)/layout.tsx"
  - "in-place PreviewModal surfacing per-doc graph entities (VALT-02) in the UI"
affects: [05-07, phase-close, human-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Refresh-by-remount: a nonce key on the query-bearing subtree genuinely re-subscribes reactive Convex queries (blinks through undefined → Loading pill) instead of polling"
    - "In-place modal (no route change): fixed-overlay dialog with Esc/backdrop close, body-scroll lock, and reactive delete that closes on success"
    - "Conditional useQuery('skip'): a signed media URL is only subscribed for image/video kinds; text docs never fetch one"
    - "Bearer-capability URL discipline in the client: signed download/media URLs are rendered into <img>/<video>/<a> only and never logged (§4)"

key-files:
  created:
    - "apps/web/app/(app)/dashboard/vault/PreviewModal.tsx"
  modified:
    - "apps/web/app/(app)/dashboard/vault/page.tsx"
    - "apps/web/app/(app)/dashboard/vault/DocGrid.tsx"
    - "apps/web/app/(app)/dashboard/vault/icons.tsx"
    - "docs/playbooks/vault.md"

key-decisions:
  - "Preview media URL uses a conditional useQuery('skip') subscription (needed to render <img>/<video>); the Download button mints a FRESH on-demand URL via useConvex().query at click, honoring the plan's 'on demand' while keeping media rendering reactive"
  - "Selected-doc state lifted into VaultBody (the keyed subtree), so a Refresh closes the modal — desirable, since the row may have changed"
  - "Reused DocGrid's fmtSize + VaultDoc (exported) rather than duplicating in the modal (ponytail rung 2)"

patterns-established:
  - "PreviewModal: in-place, reactive-delete, on-demand bearer-URL download"

requirements-completed: [VALT-04]

# Metrics
duration: ~25min
completed: 2026-07-14
---

# Phase 5 Plan 06: Knowledge Vault Route Summary

**The `/dashboard/vault` route — headline + Refresh/Loading pill + 4 stat tiles + 6 category tabs + upload/Brain-Dump dropzone + search grid + an in-place preview modal (text/media, per-doc graph entities, on-demand download, reactive delete) — wired to the Plan 04/05 vault queries.**

## Performance

- **Duration:** ~25 min (continuation — Tasks 1/2 pre-committed)
- **Completed:** 2026-07-14
- **Tasks:** 3 (Task 3 completed this session; Tasks 1/2 pre-committed)
- **Files modified:** 5 (this session: 1 created, 4 modified)

## Accomplishments
- `PreviewModal.tsx`: an in-place (Esc/X/backdrop, NOT a route change) modal showing the stored text — or the image/video itself for those kinds — with a detail panel (kind / source / size / added / status), the entities & relationships extracted from THIS doc (`api.vault.docEntities`) as chips + edge list (surfaces VALT-02 in the UI), an on-demand Download (`api.vault.vaultDownloadUrl` fetched at click, URL never logged §4), a Delete (`api.vault.deleteVaultDoc` — the grid drops the row reactively), and an "Open in workspace" plain `<Link>` (navigate only, no Lane-A edits).
- Wired the grid item click through `DocGrid`'s existing `onOpen` hook → `page.tsx` selected-doc state → the modal.
- Bumped `docs/playbooks/vault.md` Last verified → 05-06 and documented the built UI surface.

## Task Commits

1. **Task 1: Vault route shell — headline, stat tiles, category tabs, nav entry** - `4aea653` (feat) [pre-committed]
2. **Task 2: Dropzone (upload + paste) + search bar + grid/list** - `7ae3b1b` (feat) [pre-committed]
3. **Task 3: Preview modal — text/render + metadata + entities + download/delete** - `81059df` (feat)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP/REQUIREMENTS) committed separately.

## Files Created/Modified
- `apps/web/app/(app)/dashboard/vault/PreviewModal.tsx` - the in-place preview modal (text/media + metadata + docEntities + download/delete + workspace link)
- `apps/web/app/(app)/dashboard/vault/page.tsx` - lifted selected-doc state + wired DocGrid onOpen → PreviewModal
- `apps/web/app/(app)/dashboard/vault/DocGrid.tsx` - exported `VaultDoc` type + `fmtSize` for reuse in the modal
- `apps/web/app/(app)/dashboard/vault/icons.tsx` - X / Download / Trash icons for the modal actions
- `docs/playbooks/vault.md` - Last verified → 05-06 + built-UI notes

## Decisions Made
- Media preview subscribes a signed URL via conditional `useQuery(..., "skip")` (only for image/video kinds); Download mints a fresh on-demand URL via `useConvex().query` at click — reconciles the plan's "fetch on demand" with the need to render media reactively.
- Selected-doc state lives in the keyed `VaultBody` subtree, so a Refresh closes the modal.
- Reused `fmtSize`/`VaultDoc` from `DocGrid` (exported) rather than duplicating (ponytail).

## Deviations from Plan
None - plan executed exactly as written. `DocGrid.tsx` already exposed the `onOpen` click hook from Task 2, so Task 3 only needed to export its `VaultDoc`/`fmtSize` for reuse and wire the modal in `page.tsx`.

## Issues Encountered
- A `biome-ignore` comment initially used the wrong rule category (`lint/nursery/noImgElement` → the real rule is `lint/performance/noImgElement`), which biome flagged as an unparseable suppression. Corrected; `biome check --write` on `PreviewModal.tsx` is clean. (The 3 pre-existing `assist/source/organizeImports` notes in the Task 1/2 committed files are out of scope and untouched.)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The full Knowledge Vault UI surface (VALT-04) is code-complete and typecheck-clean; the visual 1:1 match against `brand-024242` / `brand-024258` is human-verified in Plan 07 (phase close).
- Offline codegen note (§7): the gitignored `convex/_generated/api.d.ts` already carried the vault modules — NOT committed.

## Self-Check: PASSED

- FOUND: apps/web/app/(app)/dashboard/vault/PreviewModal.tsx
- FOUND: apps/web/app/(app)/dashboard/vault/page.tsx
- FOUND: apps/web/app/(app)/dashboard/vault/DocGrid.tsx
- FOUND commit 4aea653 (Task 1), 7ae3b1b (Task 2), 81059df (Task 3)
- `pnpm --filter @pikar/web typecheck` clean; `node scripts/check-playbooks.mjs` exit 0

---
*Phase: 05-knowledge-vault-graphrag*
*Completed: 2026-07-14*
