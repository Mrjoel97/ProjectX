# 29-09 second fix pass — SUMMARY

**Commit:** `b45b93b` — `fix(29-09): delete the claims nothing enforces, and give the summary guard an oracle`

**Files changed (4, all owned):** `apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx`,
`apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.test.ts`,
`packages/core/src/knowledgeSearch.ts`,
`.planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md`.
`git diff --stat HEAD -- "*.ts" "*.tsx"` after committing shows only 29-07's in-flight
`WorkflowPackCustomizer*` files — none of mine, so HEAD carries the whole change.

**Files I own that this diff does NOT touch, and why:** `page.tsx` and
`e2e/knowledge-search.spec.ts` had no finding against them in this round, and
`KnowledgeSearchPanel.test.tsx` does not exist (deliberately — `apps/web/vitest.config.ts` collects
`app/**/*.test.ts` only).

---

## 1. The MAJOR finding: a docstring citing a test that does not enforce it

`packages/core/src/knowledgeSearch.ts` `aggregateCoverage` said `KnowledgeSearchPanel.test.ts`
("the available/unavailable split is read from @pikar/core, not restated in the UI") "is what fails
if a second copy appears". It is not. That test bans two literal substrings from the component
source; the verifier's `s.status === "available" || s.status === "partial"` re-derivation contains
neither and ran 41/41 green.

**I deleted the citation rather than narrowing it.** The docstring now cites the describe in the
same file's own test suite that genuinely fails (`aggregateCoverage keeps an unavailable source
from reading as an empty one`), and states plainly that whether a renderer in another package
re-derives the rule inline is not something any test in `@pikar/core` checks — naming the old claim
as the thing it replaces, so the correction cannot be quietly re-lost.

**I also widened the scan, separately.** The section-8 test now additionally bans `.status`
anywhere in the panel source, because a re-derivation of the rule has to read `status` off a source
state. Its own comment says it is still a grep and that a destructured or aliased re-derivation
would pass. The test is renamed `scan: the panel calls aggregateCoverage and never reads a source's
status itself`.

## 2. Mutations, and what each one actually proves

| # | Mutation | Result | Kind of evidence |
|---|---|---|---|
| 1 | drop the `row.summary.trim().length > 0 &&` guard at `KnowledgeSearchPanel.tsx:210` | **RED — 1 test**, *a blank summary renders no paragraph at all, not an empty one*: `expected '<article style="display:grid;gap:0.5r…' not to match /<p[^>]*>\s*<\/p>/` | **behavioural** — over the rendered markup. This mutation was GREEN before this pass. |
| 2 | `coverage.available + coverage.partial > 0` -> the verifier's `row.sources.filter((s) => s.status === "available" \|\| s.status === "partial").length > 0` | **RED — 1 test**, the widened section-8 scan | **SCAN ONLY.** A grep over the component source. It proves spelling. Under the old two-comparison form this exact mutation was green. |
| 3 | `aggregateCoverage` stops distinguishing `unavailable` (count it `available`, push no gap) | **RED — 2 tests** in *aggregateCoverage keeps an unavailable source from reading as an empty one* (`one unavailable source makes the whole run INCOMPLETE and names the gap`, `the not-landed gap survives aggregation with its own reason`) | **behavioural** — this is the describe the corrected docstring now cites, so the new citation is verified rather than asserted. |

All three reverted from byte copies; `git diff --stat` on both files showed only the intended edits
before committing.

## 3. The other findings

| Finding | What I did |
|---|---|
| `groundedSourceProps` docstring: "so a caller cannot end up with a silently shorter list" | **Deleted the absolute.** Now: both halves come back; `nonVault` has no production reader today; kept so a caller does not re-derive the vault test — "not as a guarantee about how long any caller's rendered list ends up being, which this function does not decide." |
| `KnowledgeSearchPanel.tsx` `activeThread` comment: "nothing could ever query them back" | **Deleted the absolute.** Now states the mechanism: the rows are untouched in the DB, `listByThread` is a tenant query that takes any thread string, and what changes is that no path in this component asks for the cockpit thread once the panel minted its own. |
| Test header: "EVERY assertion below is over the STRING `renderToStaticMarkup` emits" | **Corrected, in three places.** The header now scopes it to sections 1-7 and adds a paragraph saying section 8 greps source and proves spelling; the section-8 banner repeats it; and every section-8 test title is prefixed `scan:` so a failure line reports itself honestly. The header also says outright that a mutation caught only by section 8 must be reported as a scan hit — which is why the table in §2 above carries a "kind of evidence" column. |
| Blank-summary guard had no oracle | **New test**, section 2 of the panel suite: renders `summary: ""` and `summary: "   "` beside a real claim, asserts the claim text IS present (so it cannot pass vacuously) and rejects `/<p[^>]*>\s*<\/p>/`. Mutation 1 above. |
| `29-SEARCH-GATE.md` section 5 and the section-7.1 build row | **Rewritten** to the settled facts: Next aliases the bare `server-only` specifier to its own 0-byte `next/dist/compiled/server-only/empty`; that file is present and store-linked in the main working tree, which builds, as does CI, as did the Phase-26 production ship; `pnpm install --frozen-lockfile` into this freshly created worktree did not materialise it. One-line repair, create it EMPTY: `: > "$(readlink -f apps/web/node_modules/next)/dist/compiled/server-only/empty.js"`. The two fixes that do not work (`server-only` in `apps/web/package.json`; a `packageExtensions` entry on `@convex-dev/auth`) are recorded with their reasons so they are not proposed again. The old "a fresh `pnpm install` will remove this file again … and it blocks any CI that builds the web app" sentence is quoted and corrected in place. **No dependency, lockfile or `pnpm-workspace.yaml` change is committed by me.** |

A new section 8 in `29-SEARCH-GATE.md` records this round: what changed, the three mutations, and
what is still open.

## 4. Gates — corrected commands, real output

| Command | Result |
|---|---|
| `cd apps/web && pnpm vitest run KnowledgeSearchPanel` | **1 file / 42 tests passed** (was 41; this pass adds 1) |
| `cd packages/core && pnpm vitest run` | **45 files / 1457 tests passed** — matches the stated baseline exactly |
| `cd packages/core && pnpm typecheck` | clean |
| `cd apps/web && pnpm typecheck` | **2 errors, both `TS2741 Property 'baseVersion' is missing`, both in `dashboard/workflows/WorkflowPackCustomizer.{tsx,test.ts}`** — 29-07's files, **uncommitted and in flight in this shared worktree right now** (`git status` shows both modified, `git log -2` on them gives 27b5248 / 30deb8d, both 29-07). Zero errors in any file I own. Not mine, not fixed. |
| `pnpm --filter @pikar/web build` | **passed**, `ƒ /dashboard/workspace` in the route table. `empty.js` was already present (0 bytes) from the orchestrator's repair. |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **`"decision":"block"`** on three playbooks, none of which I own — see §5.3. |

I did not run: any Convex deployment command, any model call, any Playwright execution.

## 5. NOT CLOSED — say it plainly

### 5.1 The browser gate

**UNRUN, and the plan's browser criterion is NOT met.** `29-SEARCH-GATE.md` section 4 is still an
empty table. Nothing in this pass executed a browser. The operator commands, env vars and expected
evidence are in sections 1-3 of that document.

### 5.2 A false comment in a file nobody owns

`packages/backend/convex/knowledgeSearch.ts:498-499` still says `renderSourceGap` "has NO caller yet
— 29-09's panel is where it gets wired". The caller is `KnowledgeSearchPanel.tsx:260`. Three
verifiers have now reported it. **No Wave-4 agent owns that file** and my ownership list excludes
it, so it survives another round. Exact fix: delete the clause `and it has NO caller yet — 29-09's
panel is where it gets wired` from that sentence.

### 5.3 The section-9 playbook hook is blocking, on three playbooks I do not own

- `docs/playbooks/cockpit.md` (R2-TAIL) — needs a `Last verified` bump for
  `KnowledgeSearchPanel.{tsx,test.ts}`, **and** two content corrections: the sentence "the rows
  stayed stranded under the `ks_` handle with nothing able to query them" is the same false absolute
  I deleted from the component (the rows are queryable; the panel stopped asking), and the entry
  claiming "the summary paragraph renders only when there is one … Two new tests" was untrue when
  written — it is true now, pinned by *a blank summary renders no paragraph at all, not an empty
  one*. Its "a source scan fails if the inline form comes back" wording is accurate and should stay.
- `docs/playbooks/knowledge-search-routines.md` (R2-TAIL) — `Last verified` bump for
  `packages/core/src/knowledgeSearch.ts` (docstring corrections only, no behaviour change).
- `docs/playbooks/workflow-packs.md` (29-07) — blocked by 29-07's own in-flight
  `WorkflowPackCustomizer*`; it also still records the build gate without the worktree-repair
  caveat, which belongs under its *How to verify* block per the §3 row above.

### 5.4 A sibling is adding a DOM environment to `apps/web`

`apps/web/package.json` and `pnpm-lock.yaml` are uncommitted-modified in this worktree, adding
`jsdom@^27.4.0`. I staged neither. If that lands, the "apps/web has no DOM environment, so the only
oracle is the rendered-markup string" note in the panel test header and in `29-SEARCH-GATE.md`
section 6 becomes stale and should be revisited by whoever owns `vitest.config.mts`.

### 5.5 The widened scan is still a grep

Banning `.status` catches more spellings than banning two comparisons did, and it caught the
verifier's mutation — but a re-derivation that destructures the field, or that avoids `status`
entirely, would pass and nothing in the suite would notice. That limit is written into the test's
own comment rather than left for a reader to discover.
