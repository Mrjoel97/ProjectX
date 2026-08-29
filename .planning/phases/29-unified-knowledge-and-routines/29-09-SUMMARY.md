---
phase: 29-unified-knowledge-and-routines
plan: 09
subsystem: web-cockpit
tags: [knowledge-search, honest-gaps, citations, provenance, accessibility, playwright, e2e-unrun]

# Dependency graph
requires:
  - phase: 29-06
    provides: "knowledgeSearch.search / listByThread — the coordinator this panel calls"
  - phase: 29-01
    provides: "renderSourceGap, groundedSourceProps, PACK_SOURCE_LABEL, MISSING_SOURCE_UNLOCK — the sentences and the citation mapping the panel renders"
  - phase: 10-vault-grounding
    provides: "GroundedSources / VaultDocButton in cards.tsx — the landed drill-in, reused not reinvented"
provides:
  - "apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx — the KNOW-01 user surface; the FIRST production caller of renderSourceGap and groundedSourceProps"
  - "apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.test.ts — 33 rendered-markup tests, 11 mutations observed red"
  - "packages/backend/convex/knowledgeSearch.test.ts sections 9-10 — 8 tests binding a real run's states to the sentence and the control they become"
  - "apps/web/e2e/knowledge-search.spec.ts — 7 Playwright tests, WRITTEN AND UNRUN"
  - "29-SEARCH-GATE.md — the exact operator commands, env vars, preconditions and an EMPTY results table"
affects: [29-13 final owner checkpoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure view + hook container: `KnowledgeSearchResult` takes a row and renders; `KnowledgeSearchPanel` holds the Convex hooks. The view is renderable with `renderToStaticMarkup` in apps/web's node-only vitest, so component guarantees are asserted as RENDERED STRINGS rather than smuggled into packages/core."
    - "Copy records typed over the BACKEND's own closed unions (`FunctionReturnType<typeof api...>`), so a new refusal reason or authority class fails to compile until it has words."
    - "The empty/unreachable discriminator is read off `summary === \"\"` (the coordinator's own signal) plus `some(status !== \"unavailable\")` — not re-derived from counts."

key-files:
  created:
    - apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx
    - apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.test.ts
    - apps/web/e2e/knowledge-search.spec.ts
    - .planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md
  modified:
    - apps/web/app/(app)/dashboard/workspace/page.tsx
    - packages/backend/convex/knowledgeSearch.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/knowledge-search-routines.md

key-decisions:
  - "The test file is `.test.ts`, NOT the plan's `.test.tsx`. `apps/web/vitest.config.ts` includes `app/**/*.test.ts` only; a `.tsx` would have executed nowhere while reading as coverage."
  - "Every citation gets a provenance line, vault included — not only the non-vault ones. The vault is exactly where an agent-promoted document lives, so vault-only drill-in with no authority words would have hidden `agent_authored` on the one source that can carry it."
  - "No client-side question cap. The server owns `QUESTION_CHAR_CAP` and refuses as DATA; a duplicated number would drift and a `maxLength` would answer a question the user did not ask."
  - "The refusal copy contains no apostrophes, because these strings are asserted against rendered markup where React escapes `'`."
  - "The browser gate has two modes on two DIFFERENT deployments, and the mode is an explicit env choice: on a keyed deployment the `SMOKE::` directives are billed."
  - "The two-identity browser block is skipped, not faked — this project has one loggable human account."

requirements-completed: []

# Metrics
duration: 71min
completed: 2026-08-29
---

# Phase 29 Plan 09: Unified knowledge search in the workspace Summary

**The cockpit can now ask every connected source one question and shows, in words, what each source could and could not answer — and the browser gate that would prove it in a real browser is written but has never been run.**

## Performance

- **Duration:** ~71 min (2026-08-29T00:31Z → 01:42Z)
- **Tasks:** 3 of 3 committed
- **Files:** 4 created, 4 modified (+1,126 lines across my paths)

## Task commits

1. **Task 1 — the cited workspace search panel** — `f1264d7` (feat, TDD)
2. **Task 2 — adversarial backend coverage** — `eba8984` (test)
3. **Task 3 — the browser gate and its evidence file** — `516aa06` (test/docs)

## What was built

### The panel (`KnowledgeSearchPanel.tsx`, 396 lines)

Split in two on purpose. `KnowledgeSearchResult` is a pure view over one stored row — no hooks, no
provider, no network — so `apps/web`'s node-only vitest can render it with `renderToStaticMarkup`
and assert the STRING the user reads. `KnowledgeSearchPanel` is the container: `useAction`
(`knowledgeSearch.search`) + `useQuery` (`listByThread`), mounted from the cockpit's existing "Chat
options" menu beside `SkillAuthoringPanel`, inside an `ErrorBoundary` with a `null` fallback.

The honest-gap contract is rendered, not described:

- **Every source's state gets a sentence, and the sentences are not in this file.** `renderSourceGap`
  in `@pikar/core` owns them; the panel renders what it returns, and the test scans the shipped
  source to prove the substrings `so it was not searched` and `only the first` do not appear in it.
  An available source renders `<label> was searched in full.` instead.
- **The pair reads differently.** `The sources that were searched had nothing on this.` when at
  least one source was not `unavailable`; `None of your sources could be searched, so there is no
  answer to give.` when none was. Chosen off `summary === ""` (the coordinator's own no-evidence
  signal) and the state union, not off a count.
- **Disagreement is shown.** `Another source disagrees with this`, with both readings named.
- **Only a vault ref becomes a vault control.** `groundedSourceProps` feeds
  `GroundedSources({titles, docIds})` → `VaultDocButton`; the non-vault refs come back separately
  and render as provenance text. Every citation — vault included — also carries source label,
  authority class and freshness in words (`Written by your assistant, not by you`, `Over a year
  old`, …).
- **Nothing is invented.** The only numbers rendered are the code-owned per-source `returned` and
  the count of cited vault documents. No total, no denominator.
- **Each refusal has words.** `REFUSAL_COPY` is `Record<SearchRefusalReason, string>` where
  `SearchRefusalReason` is extracted from `FunctionReturnType<typeof api.knowledgeSearch.search>`,
  so a sixth backend reason fails `pnpm typecheck` here until someone writes its sentence.
- **Accessibility:** `<section aria-label>` (role region), a real `<label htmlFor>`, a submit button
  disabled on an empty question, `role="status"` for the busy line and every governed stop,
  `role="alert"` for a thrown failure, and a close control with an accessible name.

BRAND: `--card`, `--rule`, `--ink`, `--ink-soft`, `--held-text` and the existing `caps-label`,
`cta-dark`, `icon-btn` classes. No hex, no new component, no library.

### The tests

`KnowledgeSearchPanel.test.ts` — **33 tests, all over `renderToStaticMarkup` output.** Expected
sentences are literals; nothing imports the constant it is meant to pin.

`convex/knowledgeSearch.test.ts` sections 9–10 — **8 tests** taking a REAL run's output and putting
it through the two functions the panel renders with. Both had no production caller when they landed;
this is where the coordinator meets them. Includes the acting-plane absence test (a run whose
evidence carries a prompt injection writes its content and audit rows — the **presence control** —
while `requests`, `plans`, `agentSteps`, `notifications`, `followUps`, `attachments` all stay empty).

## Mutations observed RED, then reverted

**Panel (11/11 red, all reverted, file byte-identical afterwards):** `readSomething` forced true ·
`renderSourceGap` result discarded · citation list filtered to vault only · every ref mapped into
`docIds` · the conflict block hidden · pluralisation forced plural · `answered` forced true ·
`agent_authored` copy replaced with the tenant-owned copy · `role="status"` removed from the
refusal · the excerpt block hidden · the unanswered list hidden.

**Backend (8/8 red, all reverted):** an unavailable state re-minted as available (`remintState`) ·
`renderSourceGap`'s unavailable sentence replaced with "no results" · the `not_landed` unlock clause
dropped · `groundedSourceProps` treating every ref as a vault doc id · `nonVault` emptied · the
`knowledgeSearches` insert removed (the presence control) · the inbox adapter ignoring its
`tenantId` · the unknown-id `continue` deleted from `validateSynthesis`.

Each backend mutation was re-run against the *named* failing tests, so what is reported is which of
MY tests went red, not merely that the file did. One incident is worth recording: a first mutation
harness crashed mid-run on a Windows console-encoding error and left `readSomething = true` in the
tree. It was found and reverted; every later harness writes the original back in a `finally` and
asserts byte equality.

## Verification — real commands, real output

The plan's two gate commands are no-ops on this machine and were NOT run as written.

| Command | Result |
|---|---|
| `cd apps/web && pnpm vitest run KnowledgeSearchPanel` | **1 file / 33 tests passed** |
| `cd apps/web && pnpm vitest run` | **37 files / 691 passed** (baseline 36 / 658 — exactly this plan's +1/+33) |
| `cd apps/web && pnpm typecheck` | clean |
| `cd packages/backend && pnpm vitest run knowledgeSearch.test` | **1 file / 40 passed** (baseline 32 — exactly +8) |
| `cd packages/backend && pnpm vitest run` | **113 files / 3147: 3145 passed, 2 failed** — `env.test.ts` (known Phase-28 red) and `media.test.ts` (documented flake; **alone: 255/255 passed**) |
| `cd packages/backend && pnpm typecheck` | clean |
| `cd packages/core && pnpm vitest run` | **45 files / 1457 passed** (unchanged; this plan changes no core source) |
| `cd apps/web && npx playwright test --list knowledge-search` | **7 tests discovered in 2 files** — parse only, NOT an execution |
| `pnpm --filter @pikar/web build` | **passed after an environment repair — see below** |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | empty stdout (pass) |

**A concurrent-lane incident:** one full backend run reported 4 failures including
`leakedEvidenceText: "IGNORE ALL PREVIOUS INSTRUCTIONS…"` on an audit payload — a §4 violation. It
was **another agent's live mutation in this shared worktree**, not a landed defect: the string
exists nowhere in the tree now (`rg leakedEvidenceText` → 0 hits) and the clean re-run is the table
above. Recorded because a reader of that log would otherwise have a real scare.

## Deviations from the plan

1. **`KnowledgeSearchPanel.test.tsx` → `KnowledgeSearchPanel.test.ts`.** `apps/web/vitest.config.ts`
   includes `app/**/*.test.ts` only and documents that as deliberate (node env, no jsdom). The
   plan's `.tsx` would have been a file that executes nowhere. `apps/web/vitest.config.ts` was NOT
   widened — it is not this plan's file and the existing `groundedSources.test.ts` idiom
   (`renderToStaticMarkup`) needs no DOM.
2. **Two playbooks updated that the plan does not list**, because CLAUDE.md §9's Stop hook blocks
   otherwise: `docs/playbooks/cockpit.md` (owns `dashboard/workspace/**`) and
   `docs/playbooks/knowledge-search-routines.md` (owns `convex/knowledgeSearch*`). The latter is
   listed as W3-TAIL's file in the wave-4 ownership block; W3-TAIL's SUMMARY was already committed
   (`f9b308c`) and the edit is a prepended block that touches nothing W3-TAIL wrote. **Flagging it
   explicitly as an ownership crossing.**
3. **`docs/playbooks/cockpit.md` was edited in two of my three commits** (the panel, then the spec) —
   the §9 hook requires the playbook to move in the same commit as the code.
4. **The plan's Task 2 says "Run authenticated Playwright with two identities" and "use connected
   Drive/Gmail … to prove real consent/read/citation drill-in". NEITHER WAS DONE.** Both need a live
   deployment and credentials that were out of scope, and the second identity does not exist on this
   project's deployments at all. The spec is written for both and skips the second-identity block
   rather than faking it.

## NOT DONE — state plainly

- **THE BROWSER GATE IS UNRUN. The plan's browser criterion is NOT met.** `test:e2e` was never
  executed; `--list` proves the file parses and nothing more. Success criterion "KNOW-01 is proven
  in backend, browser, two-tenant and connected paths" is met in **backend** and in the
  **rendered-markup** layer; the **browser**, **two-identity browser** and **connected-provider**
  paths are open. `29-SEARCH-GATE.md` §4 is an empty table by design.
- **No model actually resisted an injection here.** `generateObject` is mocked, so the injection
  tests prove the SHAPE (a claim survives only by citing minted evidence; the acting planes stay
  empty), not model behaviour.
- **`pnpm --filter @pikar/web build` needed an environment repair to pass**, and the repair is not
  committed. Three `Can't resolve 'server-only'` errors came from `@convex-dev/auth` and Next's own
  metadata chain — zero mention of any Phase-29 file. `next/dist/compiled/server-only/empty.js` is
  absent from this worktree's install although the shim's own `package.json` lists it. Repaired
  with `printf 'module.exports = {};\n' > .../compiled/server-only/empty.js` (node_modules,
  git-ignored). **A fresh `pnpm install` re-breaks it**, and it blocks 29-07's build gate too.
  Recorded in `29-SEARCH-GATE.md` §5.

## Follow-ups for other plans (not made here)

- **`apps/web/vitest.config.ts`** — if a future component genuinely needs a DOM, widening the
  include to `.tsx` plus jsdom is the deliberate upgrade its header describes. Not this plan's file
  and not needed for this panel.
- **A second loggable tenant.** Until one exists (the invite path is the only $0 route), the
  browser-level two-tenant assertion cannot run anywhere in this repo.
- **The `server-only` install defect** deserves a real fix (a root `server-only` dependency, or a
  clean reinstall) rather than a per-worktree patch.

## Self-Check: PASSED

Files verified present on disk:
`apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx`,
`apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.test.ts`,
`apps/web/e2e/knowledge-search.spec.ts`,
`.planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md`.
Commits verified in `git log`: `f1264d7`, `eba8984`, `516aa06`.
`git diff --stat HEAD -- "*.ts" "*.tsx" "*.md"` is empty for every path this plan owns, so HEAD
compiles what the gates above read.
