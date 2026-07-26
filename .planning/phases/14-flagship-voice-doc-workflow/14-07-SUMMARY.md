---
phase: 14-flagship-voice-doc-workflow
plan: 07
subsystem: voice-doc
tags: [wave-7, ui, vault-entry, status-gate, accessibility, lane-c]
requires:
  - phase: 14-06
    provides: "the docId prop on <LiveSession>, and `/dashboard/voice?doc=` as a working entry"
  - phase: 14-03
    provides: "voiceDoc.ts and the fail-closed-by-null convention"
provides:
  - "\"Discuss by voice\" on DocGrid cards and in the PreviewModal footer, gated on ingestion status"
  - "voiceDoc.docContext — a {title, status, truncated} projection, fail-closed cross-tenant"
  - "DocStrip — the in-call context strip with the `partial` honesty badge"
affects:
  - "14-08 (PostCall already receives docId from 14-06; nothing here changes that seam)"
  - "14-09 (human-verify rows: the three status states, the partial badge, and the visual result)"
tech-stack:
  added: []
  patterns:
    - "subscription-driven gating: a live query already re-renders on the status flip, so the disabled state enables itself with no poll, timer or second query"
    - "sibling-not-nested interactive control: the card is a <button>, so the action is an absolutely-positioned sibling (the failed-card Retry precedent)"
    - "real `disabled` over a dead-styled Link, so a screen reader never announces an inert control"
    - "projection over row reuse: three fields instead of listVaultDocs' whole row, so document text cannot reach the page at all"
    - "undefined and null render identically — loading and not-yours are indistinguishable by design"
key-files:
  created:
    - apps/web/app/(app)/dashboard/voice/DocStrip.tsx
  modified:
    - apps/web/app/(app)/dashboard/vault/DocGrid.tsx
    - apps/web/app/(app)/dashboard/vault/PreviewModal.tsx
    - apps/web/app/(app)/dashboard/voice/LiveSession.tsx
    - packages/backend/convex/voiceDoc.ts
    - packages/backend/convex/voiceDoc.test.ts
    - docs/playbooks/voice.md
    - docs/playbooks/vault.md
    - .gitignore
key-decisions:
  - "docContext is a new three-field query rather than a listVaultDocs reuse: that query .collect()s whole rows including `text`, and the voice page must not hold a book-sized blob to render a title"
  - "DocStrip links to /dashboard/vault instead of hoisting PreviewModal — that modal owns download/delete/retry, and destructive actions one mis-tap from a live call is the wrong trade"
  - "the partial badge uses --ink-soft on a ruled chip, not teal text (BRAND §6: --teal-600 is ~2.9:1 on white) and carries the literal word so meaning is never colour-only"
  - "no live insights panel — explicitly deferred; insights belong on the post-call screen where the user decides"
---

# Plan 14-07 Summary — the entry point and the in-call context

**Wave:** 7 · **Tasks:** 3/3 · **Commits:** 3

The vault is now the front door. A ready report starts a scoped voice session; a still-extracting one
shows a wait state that enables itself; a failed one is refused with a reason. During the call the
screen names the report and flags a partial read.

## Commits

| Commit | Task | What |
|--------|------|------|
| `9b0bad5` | 2 | `docContext` — the three-field projection (TDD: 4 tests RED first) |
| `5d84b08` | 1, 3 | vault entry point in `DocGrid` + `PreviewModal`, `DocStrip`, `LiveSession` wiring |
| `5acb06c` | 1, 3 | `voice.md` + `vault.md`, and the `.convex/` gitignore fix |

## Gates

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/backend test voiceDoc` | **23/23** (was 19) |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `pnpm --filter @pikar/web build` | compiles; `/dashboard/vault` and `/dashboard/voice` stay `ƒ (Dynamic)` |
| `pnpm test` (whole monorepo) | **896/896, zero failures** — backend **530/530** |
| new npm dependencies | none |
| hardcoded hex a token covers | none |

## Out-of-scope fix worth flagging: `.convex/` was not gitignored

Junctioning the local Convex deployment into this worktree surfaced that `packages/backend/.convex/`
— which contains `convex_local_backend.sqlite3` and `convex_local_storage/`, i.e. **real tenant rows:
vault documents, audit entries, PII** — was untracked but **unignored**, in both worktrees. It had
never been committed, but a single `git add -A` would have committed the entire dev database. Added
`**/.convex/` to `.gitignore` with the reason inline. Not this plan's scope; left unfixed it is a
latent data-leak, and the phase has already had one lane warn about `git add -A` exposure.

## Deviations

### 1. The failed-doc explainer lives in `PreviewModal`, not `DocGrid`

The plan located it at "`DocGrid.tsx` ~line 268". At that line `DocGrid` has only the Retry button;
the `failureReason` explainer is `PreviewModal.tsx:346`. Extended the real one and left the card to
simply offer no voice action. Minor, but it is the **fifth** plan detail in this phase asserted rather
than read — see the standing note now at the top of `14-RESEARCH.md`.

### 2. `DocStrip` links to the vault instead of opening `PreviewModal`

The plan allowed either and asked which was taken. Took the link: hoisting `PreviewModal` onto the
voice route would carry its download/delete/retry actions and its `docEntities` subscription into a
live call, putting a destructive action one mis-tap from an in-progress conversation. Smaller diff and
the safer product.

## Notes for later waves

- **`docContext`'s key set is pinned by a test** (`[status, title, truncated]`, and no `text` key). If
  14-08 needs a fourth fact, add the field — do not widen it to return the row.
- **Both status branches share `discussPillStyle()`** so the control cannot move as the status flips
  under the user. Keep that if you restyle either.
- The three status states and the partial badge have **no automated visual assertion**, deliberately —
  they are human-verify rows in 14-09.
- `DOCV-01` deliberately left **Pending**.
