---
phase: 18-document-content-creation
plan: 01
subsystem: document-generation
tags: [core, html, escaping, format-parameterization, pure-ts]
requires: []
provides:
  - "DocFormat + formatSpec(): the one place the ext/MIME literals for pdf|html are written"
  - "buildDocFilename(topic, date, existing, format='pdf'): extension and collision suffix follow the format"
  - "renderHtmlDocument(title, markdown): DocToken[] -> escaped, self-contained HTML page"
affects:
  - "packages/backend/convex/llm.ts renderAndStore (plan 18-05 wires the html branch)"
tech-stack:
  added: []
  patterns:
    - "the token list IS the sanitizer — no marked/sanitize-html/DOMPurify/remark"
    - "structural convention test: every ${} in renderHtmlDocument is esc(...) | *Html | HTML_*"
key-files:
  created: []
  modified:
    - packages/core/src/documentGen.ts
    - packages/core/src/documentGen.test.ts
decisions:
  - "The research's verbatim `not.toMatch(/onerror/i)` assertion is unsatisfiable and was corrected: `onerror` survives as inert TEXT by design"
  - "Added a code-owned-tag allow-list strip as the load-bearing behavioural assertion"
  - "Structural test normalizes CRLF before the `\\n}\\n` anchor (core.autocrlf=true)"
metrics:
  duration: "23m"
  completed: "2026-08-01"
  tasks: 2
  commits: 4
---

# Phase 18 Plan 01: Format parameterization + the HTML renderer Summary

`packages/core/src/documentGen.ts` now names its output format instead of hardcoding `.pdf`, and
carries `renderHtmlDocument` — a pure DocToken[]→HTML renderer whose escape boundary is held by a
behavioural test AND a structural test, not by prompt instruction.

## What shipped

**Task 1 — `DocFormat` / `formatSpec` / a 4th defaulted param** (`9e54550` RED, `8a83d12` GREEN)

`FORMAT` is a `Record<DocFormat, {ext, mimeType}>` and `formatSpec` reads it — the ONE place either
literal is written. `buildDocFilename` gained `format: DocFormat = "pdf"` as a 4th **optional**
param, so both shipped 3-arg call sites in `llm.ts` are untouched and every pre-existing assertion
in the test file passes **unedited** (SC4b). Both `.pdf` template literals inside the function are
gone — `grep -n '\.pdf\`' packages/core/src/documentGen.ts` returns nothing. The `:159` docstring
no longer claims "Always ends in `.pdf`".

**Task 2 — `renderHtmlDocument`** (`21c2165` RED, `dc990a5` GREEN)

Pure: zero imports of any kind in the file, zero Convex, zero pdf-lib, zero `node:`, zero new
dependencies (`grep -c "marked\|sanitize-html\|DOMPurify\|remark" packages/core/package.json` → 0).
It calls `tokenizeMarkdown(markdown)` and renders from the returned `DocToken[]`, resolves emphasis
through `inlineRuns` in a `runsHtml` local, switches to **explicitly written fixed tags** (no
`<${token.kind}>` interpolation — see Deviations), and emits `<!doctype html>` + a code-owned
`HTML_STYLE` string containing zero interpolation.

## Mutation check (mandatory, recorded)

Replaced the non-bold branch's `esc(r.text)` with `r.text` in `runsHtml`:

- **behavioural test → RED**, 1 failed / 21 passed, failing on `expected … not to match /<script/i`
- reverted → 22/22 green

**The structural test stayed GREEN under that mutation** — `r.text` there is a returned value, not a
`${}` interpolation, so the structural scan cannot see it. The two tests are genuinely complementary
rather than redundant: the structural one guards *interpolations*, the behavioural one guards
*output*. Worth knowing before anyone "consolidates" them.

## The exact interpolation count the structural test saw

**17** (floor is 4):

```
esc(r.text) | esc(c) | esc(c) | cellsHtml | headHtml | rowsHtml | textHtml | textHtml |
textHtml | textHtml | esc(String(token.num)) | textHtml | textHtml | esc(title) |
HTML_STYLE | esc(title) | bodyHtml
```

Zero raw interpolations.

## Deviations from Plan

### 1. [Rule 1 - Bug] The research's `not.toMatch(/onerror/i)` assertion is unsatisfiable

**Found during:** Task 2, on the first GREEN run — 1 failed, and it was this line.
**Issue:** `18-RESEARCH.md` § Pattern 6 test (a) asserts the output contains no `onerror`. After
escaping, the hostile string renders as `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;` — the
substring `onerror` **survives as visible text, and must**: removing it would mean mangling prose a
user legitimately wrote. Copied verbatim, the test can never pass.
**Fix:** two changes, both narrowing to the real invariant rather than weakening it.

1. `not.toMatch(/onerror\s*=\s*["']/i)` — the quote that would make it an *attribute* is what must
   never survive, and it doesn't (`&quot;`).
2. Added the load-bearing assertion the research didn't have: strip the **code-owned tag literals**
   by name and assert no `<` remains. That proves every angle bracket in the output is one this file
   wrote, which is SC#5 stated directly instead of by proxy. A generic `/<[^>]*>/g` strip would have
   been vacuous (it would delete a real injected `<script>` too), so the allow-list is spelled out.

**Files modified:** `packages/core/src/documentGen.test.ts`
**Commit:** `dc990a5`

### 2. [Rule 3 - Blocking] CRLF would silently break the structural test's anchor

**Found during:** Task 2, before writing the test.
**Issue:** `core.autocrlf=true` with `* text=auto`. On a fresh checkout the file is CRLF, so
`src.indexOf("\n}\n", start)` returns `-1`, `src.slice(start, -1)` silently yields *the rest of the
file*, and the test then scans foreign functions' interpolations. A test that changes what it scans
depending on how you cloned the repo is worse than no test.
**Fix:** `.replace(/\r\n/g, "\n")` on read, plus an `expect(end).toBeGreaterThan(start)` floor so a
missed anchor fails loudly instead of scanning the wrong region.
**Commit:** `dc990a5`

### 3. [Rule 1 - Bug] Two interpolations the research's shape would have left raw

`<ol start="${token.num}">` and `<${token.kind}>` both fail the structural convention. Neither is
model-authored (`num` is a parsed integer, `kind` is a closed union), but exempting them would need
a carve-out in the convention, and a convention with exceptions is one someone else's exception can
walk through. `token.num` goes through `esc(String(token.num))`; `token.kind` is replaced by three
explicit `if` branches writing `h1`/`h2`/`h3` literally — which is also what the plan's action text
asked for ("switch on `token.kind` to **fixed tags**").

### 4. [Documentation] The plan's stated collision expectation is off by one

Plan Task 1 `<behavior>`: *"with an existing `q3-plan-2026-08-01.html`, the html call returns
`...-2.html`"*. The shipped suffixing yields `-1` for the first collision (pinned since Phase 3.3 by
`buildDocFilename > appends -N on collision`, unedited here). The test asserts `-1.html`. The plan's
actual point — *"not `-2.pdf`"*, i.e. the extension follows the format — is what got tested, plus
the converse case that a taken `.pdf` does **not** push the `.html` name along.

## Gates

| Gate | Result |
|---|---|
| `documentGen.test.ts` | **22/22** (was 16) |
| Full `@pikar/core` suite | **18 files / 381 tests** green, 37s (baseline 375) |
| `tsc --noEmit` (@pikar/core) | exit 0 |
| Biome | formatted; the 11 warnings + 1 error are the **pre-existing** `noNonNullAssertion` / `noAssignInExpressions` family in untouched code (`inlineRuns` :119, `tokenizeMarkdown`). Not in scope. |
| New dependencies | **zero** |
| `.pdf` literals in `buildDocFilename` | **zero** |
| Convex / pdf-lib / `node:` imports in `documentGen.ts` | **zero** — the file has no `import` statement at all |

## check-playbooks

**BLOCKS, entirely on FOREIGN work:** `docs/playbooks/skill-registry.md`, triggered by
`packages/backend/convex/skills.ts` — an uncommitted edit belonging to the concurrently-running
plan 18-03 (`d056941`, `8f94e4e` landed in this tree during execution).

`cockpit.md` — which does watch `packages/core/src/documentGen.ts` (`watch.json:66`) — is **not** in
the block list, because this plan's own edits are committed. **Nothing was bumped**, per the plan's
explicit instruction (the `cockpit.md` obligation is 18-09's) and per STATE.md's shared-tree rule
that bumping a foreign playbook's `Last verified` claims verification of a diff you never read.

## Notes for later plans

- **18-05 (the `renderAndStore` wiring)** gets `formatSpec(format).mimeType` and
  `buildDocFilename(topic, today, others, format)` for free; `renderHtmlDocument` returns a string,
  so the html branch is `new TextEncoder().encode(renderHtmlDocument(draft.title, draft.markdown))`.
- The structural test's convention is **enforced, not advisory**: any new `${}` inside
  `renderHtmlDocument` must be `esc(...)`, a local ending in `Html`, or a `HTML_*` constant.
- `PLAN_ATTACHMENT_CAP_BYTES` (8 MiB) untouched; `VAULT_FILE_CAP_BYTES` (100 MiB,
  `packages/vault/src/constants.ts:2`) is a different ceiling and was not unified.

## Commits

| Commit | Message |
|---|---|
| `9e54550` | test(18-01): add failing format-parameterization pins for buildDocFilename/formatSpec |
| `8a83d12` | feat(18-01): parameterize buildDocFilename by output format |
| `21c2165` | test(18-01): add failing SC5 behavioural + structural escape tests |
| `dc990a5` | feat(18-01): renderHtmlDocument — the spec-to-markup boundary (SC5) |
</content>
</invoke>

## Self-Check: PASSED

Both modified files exist; all four commits resolve; all three `must_haves.key_links` patterns
(`FORMAT[format]`, `tokenizeMarkdown(markdown)`, `renderHtmlDocument` in the test) are present.

## Shared-tree notes

- **`roadmap update-plan-progress 18` reproduced its documented bug**: it wrote phase 18's count
  over **phase 22.1's** `**Plans:** 2 of 3 complete` line. Caught by diffing and hand-reverted; the
  correct table row was kept. Anyone running that tool in this repo must diff after, every time.
- **This plan's `ROADMAP.md` + `STATE.md` edits were swept into a sibling lane's commit** (`c3af0e4`,
  plan 18-03) — the exact hazard STATE.md § *Shared-tree discipline* names. Content is intact and
  verified present in `HEAD` (18-01 checkbox `[x]`, the Lane D row, the Performance Metrics row, and
  the 22.1 revert). Recorded so the commit archaeology isn't confusing later.
- **`gsd-tools state advance-plan` was deliberately NOT run** — STATE.md carries four lanes and the
  tool reads only the first frontmatter block (`current_phase: 17.1`). The Lane D row was hand-edited
  instead, per the 17.1-01 precedent.
- **`ACTN-04` left PENDING in REQUIREMENTS.md on purpose.** Its text covers the whole created-artifact
  capability; this is plan 1 of 10 and delivers only the pure-core half of SC#4 plus SC#5. Flipping it
  here would be a false signal.
