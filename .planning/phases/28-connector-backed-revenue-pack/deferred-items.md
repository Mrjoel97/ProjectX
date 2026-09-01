# Phase 28 — deferred / out-of-scope discoveries

- **2026-08-27 (28-01 Task 1)** — `scripts/check-playbooks.mjs` reports `decision:block` for
  `docs/playbooks/revenue-finance.md` against uncommitted `packages/revenue/src/{finance,finance.test,money,money.test}.ts`.
  That is **28-02's lane**, running in parallel; 28-01 owns only `docs/connectors/*`. Not fixed here.
  28-02 must bump `revenue-finance.md` `Last verified` in the commit that lands those files.

## 28-07 (2026-08-28)

- `packages/revenue/src/providers/quickbooks.test.ts` fails `biome check` on a formatter
  disagreement about a `test.each` call (~line 408). PRE-EXISTING from 28-06 and NOT touched by
  28-07 — `git diff --stat` against that file is empty for this plan. Out of scope; noted so the
  next lane that runs a repo-wide biome check knows it is not theirs either.

## 28-16 (2026-09-02)

- The authenticated 390×844 Connections artifact shows the existing profile shell clipping long
  tab/descriptive copy at the right edge even though `html.scrollWidth === clientWidth` (the shell
  hides overflow rather than exposing a horizontal scrollbar). Revenue-provider absence and the
  honest Google/Microsoft states remain visible and the plan-owned gate passes. This predates the
  28-16 files and is outside the connector-exposure slice; a profile/responsive owner should add a
  viewport-containment assertion and repair the shell without folding in the concurrently edited
  workspace-header overflow change.
