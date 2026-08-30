# 29-09 FIX — remediation summary

**Branch:** `feat/29-unified-knowledge` (worktree `C:/Users/expert/AppData/Local/Temp/pikar29`)
**Commits:** `f2036da` (the fix), `ee23bb1` (one comment corrected to name the right test)
**Status: the browser gate is STILL UNRUN. The plan's browser criterion is NOT met.**

---

## 1. The findings, and what each one got

| # | Finding | Closed? | How |
|---|---|---|---|
| MAJOR | Panel prints "The sources that were searched had nothing on this." beside real cited claims | **YES** | `answered` derived from `row.claims.length > 0 \|\| row.summary.trim().length > 0`; the summary paragraph renders only when there is one. Two new tests. |
| MAJOR | Citation source attribution deletable with 33/33 green | **YES** | Two new tests asserting the rendered span through the citation's own label |
| MAJOR | E2E spec dead on arrival (`{name:"Search"}` matched 2 elements) | **YES** (fixed, still unrun) | `{ name: "Search", exact: true }` at both sites; whole file re-read selector by selector; proven against real chromium |
| MAJOR | Three falsified "NOT WIRED YET" comments in `@pikar/core` left standing | **YES** for the two in `packages/core/src/knowledgeSearch.ts` | Deleted. The third is in `packages/backend/convex/knowledgeSearch.ts:499` — **NOT MINE, follow-up below** |
| MAJOR | Ownership crossing into `docs/playbooks/knowledge-search-routines.md` | **NOT REPEATED** | Not touched this pass. Recorded as a follow-up; the §9 hook consequently still blocks (see §5) |
| MINOR | Conflicting-evidence source label untested | **YES** | `expect(html).toContain("Rate card (old copy)</span> — your Google Drive")` |
| MINOR | Stored-question heading untested | **YES** | Two tests in a new §6b block |
| MINOR | Panel header comment's false "only numbers rendered are…" | **YES** | The enumeration is deleted, not restated. It now names the assertion that enforces the intent |
| MINOR | Panel's own `nonVault`-rationale comment false | **YES** | Rewritten to describe what the panel actually does |
| MINOR | `groundedSourceProps().nonVault` has zero production consumers | **EXPLAINED, not changed** | See §3 |
| MINOR | Search unreachable after the first chat message | **YES** | `activeThread = ownThread ?? threadId ?? null` |
| MINOR | `aggregateCoverage`'s "made once, here" duplicated in the panel | **YES** | Panel calls `aggregateCoverage(row.sources)`; core's docstring now cites the test that fails if a second copy returns |

---

## 2. Mutations observed RED (each applied, observed, reverted)

Baseline before this pass: `cd apps/web && pnpm vitest run KnowledgeSearchPanel` → **33 passed**.
After: **41 passed**. Every mutation below was run against the 41-test suite.

| Mutation | Result |
|---|---|
| Delete `{PACK_SOURCE_LABEL[citation.source]} · ` from `Citation` (the finding's own mutation, which was green before) | **2 failed** |
| Delete `{" — "}` + `{PACK_SOURCE_LABEL[row.source]}` from the conflicting-evidence list | **1 failed** |
| Delete the `<p className="caps-label">{row.question}</p>` block | **2 failed** |
| Revert `answered` to `row.summary.length > 0` | **1 failed** |
| Revert `activeThread` to `threadId ?? ownThread` | **1 failed** |
| Replace `aggregateCoverage(row.sources)` with the inline `row.sources.some((s) => s.status !== "unavailable")` | **1 failed** |

All six reverted; `git diff --stat` after restore showed only the intended change, and the suite
returned to 41/41. Nothing from a mutation reached a commit — verified by reading the committed
diff of `KnowledgeSearchPanel.tsx` in `f2036da`.

The Playwright locator bug was proven the same way, with **real chromium** (throwaway script in
`apps/web`, `setContent` with the panel's own two buttons inside its own `<section aria-label=…>`,
deleted afterwards):

```
loose  count = 2
exact  count = 1
LOOSE THROWS: Error: locator.isDisabled: Error: strict mode violation:
  getByRole('region', { name: 'Search everything you have connected' })
  .getByRole('button', { name: 'Search' }) resolved to 2 elements:
EXACT isDisabled = false
```

---

## 3. Judgement calls, stated rather than hidden

**`nonVault` was left in place and is still unread in production.** The finding's stated worry —
"if the panel drops them entirely, non-vault sources are cited invisibly" — is not what the panel
does: `Claim` iterates `claim.evidence` in full and renders EVERY citation, vault and non-vault, as
a `Citation` row carrying `PACK_SOURCE_LABEL[citation.source]`. Non-vault provenance is on the page;
the new test *"a Drive citation names Drive, so two systems on one claim are told apart"* pins the
rendered string for a Drive citation, and the vault-only drill-in is pinned by the existing
`source-title` count assertion. So the real defect was the two comments claiming `nonVault` is what
the caller renders — both corrected. Deleting `nonVault` itself (the ponytail rung-1 answer) would
break `packages/backend/convex/knowledgeSearch.test.ts:1206-1207`, which I do not own; recorded as a
follow-up rather than done across the line.

**The thread-handle fix is session-scoped by design.** `ownThread ?? threadId ?? null` means a
panel that minted its own `ks_` handle keeps it while the card is open, including across a chat-tab
switch. The panel unmounts on close (`page.tsx` renders it behind `searching`), so the handle does
not outlive the card. Marked with a `ponytail:` comment naming that ceiling and the upgrade path.

**`page.tsx` is in my ownership list and my diff never touches it.** No change was needed there: the
transition defect was entirely in how the panel resolved its own handle, and `page.tsx`'s
`threadId` lifecycle is correct for the cockpit. Stating it because "a file the plan names that the
diff never touches" is normally a coverage hole.

---

## 4. Gates — run with the corrected commands

| Command | Result |
|---|---|
| `cd apps/web && pnpm vitest run KnowledgeSearchPanel` | **1 file / 41 passed** (was 33) |
| `cd apps/web && pnpm vitest run` | **36 files passed / 1 failed — 671 passed, 28 failed.** The red file is `dashboard/workflows/WorkflowPackCustomizer.test.ts`, **29-07's, in flight and uncommitted in this shared worktree**. `git log -2` on it names 29-07; `git status` shows that lane's `.tsx` + `workflowPackDiscovery.ts` modified right now. NOT MINE, not touched. |
| `cd apps/web && pnpm typecheck` | **Every error is in `dashboard/workflows/WorkflowPackCustomizer*` (29-07's in-flight files). Zero errors in any file I own** — verified by re-running with that path filtered out. |
| `cd packages/core && pnpm vitest run` | **45 files / 1457 passed** (matches the stated baseline) |
| `cd packages/core && pnpm typecheck` | clean |
| `pnpm --filter @pikar/web build` | **passed**; `/dashboard/workspace` compiles |
| `cd apps/web && npx playwright test --list knowledge-search` | **8 tests in 2 files** — parse only, and §7.2 of the gate doc records exactly why that proves nothing about locators |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **`decision":"block"` on two playbooks I do not own** — see §5 |

Backend was not run: this pass changes no file under `packages/backend`.

---

## 5. NOT CLOSED, and why

1. **THE BROWSER GATE IS UNRUN.** Zero Playwright executions against a running stack. It needs a
   live Convex deployment, a seeded E2E user, real credentials and (in live mode) real spend — all
   out of scope and explicitly forbidden here. `29-SEARCH-GATE.md` §2 has the exact commands, env
   vars and preconditions; §4's results table is still empty and says UNRUN. Fixing the locator
   made the spec *runnable*; it produced no evidence.

2. **The §9 playbook hook still returns `decision":"block"`**, on two files:
   - `docs/playbooks/knowledge-search-routines.md` — W3-TAIL / FIX-TAIL owns it. It needs a
     `Last verified` bump for my `packages/core/src/knowledgeSearch.ts` comment corrections. The
     previous 29-09 pass crossed this line and was flagged for it; I did not. **This is a real,
     open blocker for whoever finishes the wave**, and `watch.json:375-380` structurally couples
     that playbook to files 29-09 owns.
   - `docs/playbooks/workflow-packs.md` — blocked by 29-07's in-flight, uncommitted work. Not mine.

   `docs/playbooks/cockpit.md` (unclaimed in the wave-4 split, and the playbook watching the
   workspace panel I changed) **was** updated with a prepend-only `Last verified` block, per
   CLAUDE.md §9. Disclosed here because my ownership brief said "YOU OWN ONLY".

3. **`packages/backend/convex/knowledgeSearch.ts:499`** still carries the third copy of the false
   "it has NO caller yet — 29-09's panel is where it gets wired" comment. Not my file.

4. **The `ownThread` persistence half has no runnable unit oracle.** `apps/web` has no jsdom, no
   happy-dom and no testing-library, so the container's post-submit state transition cannot be
   driven in vitest. What exists is (a) a source-scan assertion that the expression is
   `ownThread ?? threadId ?? null` and not the prop-first form — which goes red on the mutation, but
   is a scan, not behaviour — and (b) a new e2e test that searches, sends
   `SMOKE::agent::brief=today`, and asserts the answer card survives. **That e2e test has never
   run.** Treat the behavioural half as unproven.

5. **No connector was invented, stubbed or mocked.** Nothing was added to satisfy plan text.

---

## 6. Files changed

| File | Change |
|---|---|
| `apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx` | `answered`, `aggregateCoverage`, `activeThread`, three comment corrections |
| `apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.test.ts` | +8 tests (blank summary ×2, citation source label ×2, conflict source label, question heading ×2, two source scans) |
| `apps/web/e2e/knowledge-search.spec.ts` | `exact: true` ×2, +1 thread-transition test |
| `packages/core/src/knowledgeSearch.ts` | 3 falsified comments deleted/corrected; `aggregateCoverage` docstring cites its enforcing test |
| `docs/playbooks/cockpit.md` | prepended `Last verified` block (§9) |
| `.planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md` | new §7; 7→8 tests; superseded rows marked; UNRUN restated |

Staged path by path. No `git add -A`. `graphify-out/*` not committed.
`git diff --stat HEAD` after committing shows only 29-07's in-flight files outstanding — none of
mine, so HEAD carries the whole change.
