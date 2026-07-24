---
phase: 10-vault-agent-grounding
plan: 03
subsystem: cockpit-vault-grounding
tags: [vault, grounding, searchVault, cockpit, ui, VGND-01, source-card]
requires:
  - api.vaultSources.byThread (tenantQuery, latest row per thread — Plan 02 content-plane reader)
  - searchVault member of the agentSteps.tool closed union (Plan 02)
provides:
  - VERB["searchVault"] activity-step label pair (cards.tsx) — "Searching your knowledge vault…" / "Grounded in the vault"
  - SourceCard "📚 Grounded in N documents" rendered in CardList (reads vaultSources.byThread)
  - cockpit.md Phase-10 read-side note (source card + verb)
affects:
  - the workspace right-pane canvas now visibly shows a grounded turn (VGND-01 SC1 — what the user SEES)
tech-stack:
  added: []
  patterns:
    - dumb-renderer-over-content-plane-reader (copied verbatim from BriefingCard/ActivityCard)
    - reuse the existing briefingSheet opaque --card style (BRAND §2/§5) — no new card idiom
    - self-querying card returns null when ungrounded (trace/briefing precedent)
key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - docs/playbooks/cockpit.md
decisions:
  - "SourceCard reuses the existing briefingSheet opaque-sheet style (background var(--card) + var(--rule) hairline + soft shadow) rather than inventing a new card style — the plan REJECTED the transparent border-only box for legibility; briefingSheet already is exactly that opaque sheet."
  - "Titles link to /dashboard/vault (doc-level, no new query) — the inline PreviewModal per-title click-through is a MARKED ponytail-deferred upgrade needing a getVaultDoc(byId) tenant query (out of 10-03's file boundary)."
metrics:
  duration_min: 12
  tasks: 2
  files_changed: 2
  tests: "pnpm --filter @pikar/web typecheck clean; node scripts/check-playbooks.mjs exit 0 (cross-surface React render is Manual-Only UAT per 10-VALIDATION)"
  completed: 2026-07-24
---

# Phase 10 Plan 03: Vault-Grounding Source-Card Read-Side Summary

Surfaced vault grounding to the USER (VGND-01 SC1) in the workspace right-pane canvas: a
`VERB["searchVault"]` entry so the SDK-emitted activity step reads "Searching your knowledge vault…"
/ "Grounded in the vault" instead of the "Working…" FALLBACK, and a `SourceCard` — a dumb renderer
over Plan 02's `vaultSources.byThread` content-plane reader — that renders "📚 Grounded in N
documents" with each doc title clickable through to `/dashboard/vault`. The grounding the previous
two waves built was invisible without this read-side render; it is now visible without loosening the
refs-only (§4) boundary.

## What Was Built

- **`VERB["searchVault"]` pair** (`cards.tsx` L1092) — one code-owned string pair added after
  `briefInbox`. This is the only human string in the feature; §4 keeps step text off the wire, so it
  is code-owned and keyed off the closed `agentSteps.tool` union. Unknown keys still fall back to
  "Working…", so the addition is compile-safe on its own and can never crash the trace.
- **`SourceCard`** (`cards.tsx`, before `CardList`) — self-queries `api.vaultSources.byThread` keyed
  on `threadId` (`"skip"` when absent), derives its type via
  `FunctionReturnType<typeof api.vaultSources.byThread>` (never a hand-written interface), and
  returns `null` when `!sources || sources.count === 0` (an ungrounded/compose turn shows no card).
  Renders the reused `briefingSheet` opaque `--card` sheet + a `capsTeal` tracked-caps
  "📚 Grounded in {count} document{s}" label, then each title as a `next/link` to `/dashboard/vault`
  styled `var(--teal-600)`, with `traceText` (`overflowWrap:"anywhere"`) so a long title wraps in the
  resizable pane. `data-testid="source-card"` / `data-testid="source-title"` for later UAT/E2E. A
  `ponytail:` comment on the Link names the ceiling (doc-level link, no new query) and the deferred
  inline-PreviewModal upgrade path (a `getVaultDoc(byId)` query).
- **Wired into `CardList`** — rendered between `{trace}` and `{rest()}` in the returned grid so a
  grounded turn shows the card whether or not a PLAN row exists (grounding happens on pure advice
  turns with no plan — mirrors how the trace renders above every plan-status branch). `next/link`
  import added (the file did not import it).
- **cockpit.md** (§9 definition-of-done) — APPENDED the read-side note to the existing Phase-10
  section (verb label + SourceCard/vaultSources reader, refs-only, deferred PreviewModal), replacing
  the Plan-03 append marker Plan 02 left; added a `Last verified: 2026-07-24 (10-03)` line above the
  10-02 one.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | searchVault VERB entry + SourceCard in CardList | 5a081de | cards.tsx |
| 2 | augment cockpit playbook with read-side note | 68ed672 | cockpit.md |

## Verification

- `pnpm --filter @pikar/web typecheck` → clean (proves the SourceCard consumes Plan 02's
  `api.vaultSources.byThread` reader and the whole file compiles — JSX + the FunctionReturnType
  derivation against the real reader shape).
- `node scripts/check-playbooks.mjs` → exit 0 (§9 Stop hook does not block on the cockpit.md-watched
  `workspace/cards.tsx` change).
- `graphify update .` + `node scripts/extract-convex-edges.mjs` → graph current (+198 convex edges).
- Stayed strictly inside the file-ownership boundary: touched ONLY `cards.tsx` and `cockpit.md`. Did
  NOT touch `vaultSources.ts`/`llm.ts`/`schema.ts`, `PreviewModal.tsx`/`vault.ts`, sibling playbooks,
  skill bodies, or eval fixtures.

## Deviations from Plan

None — the plan executed as written. One shape note: rather than defining a fresh opaque-sheet
style, the SourceCard reuses the existing `briefingSheet` const (already `background: var(--card)` +
`border: 1px solid var(--rule)` + soft shadow) with an inline `padding` — the laziest brand-correct
choice (CLAUDE.md §8), exactly the sheet the briefing card adopted after rejecting the transparent
`box`.

## Deferred / Out of Scope

- Inline `PreviewModal` per-title click-through — marked `ponytail:` deferred; needs a
  `getVaultDoc(byId)` tenant query (`vault.ts`, outside 10-03's boundary). `docIds` already ride the
  `vaultSources` row for that future targeted click-through.
- The verb-visible trace, the rendered card, the title click-through, and the brand match are
  MANUAL-ONLY UAT (10-VALIDATION): a cross-surface SDK-loop + React render no backend vitest covers —
  confirmed by a human running a grounded turn at /gsd:verify-work.

## Self-Check: PASSED

- FOUND: .planning/phases/10-vault-agent-grounding/10-03-SUMMARY.md
- FOUND: apps/web/app/(app)/dashboard/workspace/cards.tsx (searchVault VERB + SourceCard)
- FOUND: docs/playbooks/cockpit.md (read-side note + Last verified 10-03)
- FOUND commits: 5a081de (Task 1), 68ed672 (Task 2)
