---
phase: 18-document-content-creation
plan: 07
subsystem: cockpit-output-surface
tags: [brand, output-card, provenance, e2e, playwright, no-new-query]
requires:
  - "18-02 (vaultSources.role/snippet/form on schema + the cards.tsx VERB entry)"
  - "18-04 (byThread({ role }) + the Output-card row shape)"
  - "18-06 (the createDocument tool that writes the row, and the create= SMOKE op)"
provides:
  - "OutputCard — a self-querying dumb renderer over api.vaultSources.byThread({ role: 'created' })"
  - "data-testid=\"output-card\" / data-testid=\"output-title\" — the SC#6 e2e handles"
  - "OriginChip — the AGENT provenance chip in the vault grid"
  - "apps/web/e2e/cockpit-created-document.spec.ts — authored, discoverable, NOT yet run"
affects:
  - "18-09 (owns BOTH the BRAND conformance judgement AND the live Playwright run)"
tech-stack:
  added: []
  patterns:
    - "One extra optional arg on a SHIPPED query buys a second card — zero new Convex surface"
    - "A null-case test in the same spec is what makes the presence assertion non-vacuous"
    - "Teal in the FILL, --ink in the LABEL — token-only contrast without inventing a darker teal"
key-files:
  created:
    - apps/web/e2e/cockpit-created-document.spec.ts
  modified:
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/dashboard/vault/DocGrid.tsx
decisions:
  - "The card lists ALL titles as the #index list rather than a single `titles[0]` heading: the row ACCUMULATES over the conversation and nothing on it records WHICH slot the newest write landed in, so any single-title heading would be wrong after a revise"
  - "The type badge uses --ink text on a --teal-400 tint, not --teal-600 text: BRAND §6 bans teal-600 for small text (~2.9:1) and no token covers a darkened teal"
  - "The AGENT chip gates on `origin !== undefined`, not `=== \"agent\"`, so a promoted document keeps its provenance"
metrics:
  duration: ~40 min
  completed: 2026-08-01
---

# Phase 18 Plan 07: The Output Card Summary

SC#6's automated half: a created artifact is now SEEN. One component modelled on `SourceCard`, one
chip beside `StatusChip`, one authored e2e spec. Zero new tables, zero new queries, zero new routes,
zero new dependencies, no component library.

## The exact copy that shipped

| Element | Text |
| --- | --- |
| Section label (BRAND §3 tracked-caps) | `✍️ Created` — and `✍️ Created · {N}` when `count > 1` |
| Type badge pill (UPPERCASE) | `DOCUMENT` when `form === "long"`, `POST` when `form === "short"`, `DOCUMENT` when `form` is absent |
| Title rows | the title as a `/dashboard/vault` link, prefixed `#1 #2 …` **only** when `count > 1` |
| Subline | `Saved to your vault. Nothing was sent.` |
| Artifact preview | `row.snippet` verbatim (the tool's first 240 chars), `pre-wrap` on a `--canvas` sheet |
| Vault grid chip | `AGENT` |

`Nothing was sent.` is deliberate, not filler: `createDocument`'s own description says *it saves only
— it never sends anything*, and BRAND §1 forbids implying an action that did not happen. It is also
what the e2e asserts to prove a *creating* turn rendered, not a sending one.

## Tokens used — all from `globals.css`, no hex added

`--card` / `--rule` (via the shared `briefingSheet`), `--canvas`, `--ink`, `--ink-soft`,
`--teal-600` (title links + the reused `capsTeal` label), `--teal-400` (badge/chip fill, as
`color-mix(in srgb, var(--teal-400) 30%, var(--card))` — the shipped `DocGrid` icon-badge idiom).

**Zero `--held`.** The three `--held` strings the diff adds are all in comments that say never to use
it here. Every `#rrggbb` in both files is pre-existing and untouched.

**The badge's contrast decision.** `ConfChip` (`cards.tsx`) sets `--teal-600` as *text* at 0.62rem,
which BRAND §6 explicitly bans (~2.9:1). Rather than copy that or invent a darkened teal (no token
covers one), the teal moved into the FILL and the label stayed `--ink`. Same for the vault chip. This
is the one place the shipped in-file precedent was *not* followed, and §6 is why.

## The one design call: which title is "the" title

The plan says *`titles[0]`, or a count-aware heading when `count > 1`*. That is not safely
implementable. 18-06 made the row **accumulate**: `titles`/`docIds` carry every artifact the thread
has created, while `snippet` and `form` describe only the **most recent write** — and on a
`replace: 2` revise the newest title lands in slot 2, not slot 0 and not the last slot. **Nothing on
the row records which slot moved**, so any single-title heading is wrong after the first revision.

So the card renders **all** titles as the `#index` list, with the count on the label and the badge +
snippet describing the newest write. That is strictly more correct, is one `.map` instead of a
branch, and the `#N` prefixes double as the affordance for the `replace` grammar the tool teaches
("make the second one shorter"). With `count === 1` — the only shape the e2e exercises — it reads as
an ordinary titled card.

## SourceCard is byte-unchanged

The diff on `cards.tsx` is **91 added lines and zero removed**: the whole `OutputCard` block, the
`FORM_LABEL`/`typeBadge`/`snippetSheet` constants, and the two-line mount beside `<SourceCard/>`.
`git diff HEAD~3 HEAD` shows exactly one `api.vaultSources.byThread` line, and it is an addition —
the shipped grounding call (which passes no `role`) has no `-` line at all. The 18-02 `VERB` map is
untouched and `traceParity.test.ts` is **2/2 green**.

## The SMOKE sentinel the spec sends

```
SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager
```

Verbatim from `18-06-SUMMARY.md`, nested prefix included. Verified before writing the spec that
`create=` is registered at all four sites in `llm.ts` (the grammar comment `:2607`, the
`AgentSmokeOp` union `:2628`, the parse case `:2693-2701`, `SMOKE_OP_TOOL.create` `:2727`, and the
invoke `:2765`). The offline artifact title is `"Smoke Document"` (`draftDocument`'s SMOKE
short-circuit, `llm.ts:3245`) — that is what the spec asserts.

## ⚠ STILL OWED, AND BOTH BELONG TO 18-09

1. **The Playwright run itself.** The spec is authored and **discoverable** — `--list` picks up both
   tests under the chromium project with its `setup` dependency — but it has **NOT been executed**.
   It cannot be here: `playwright.config.ts` pins `baseURL: 127.0.0.1:3111` with **no `webServer`
   block**, so it needs an already-running stack (a live `convex dev`, NOT `--once`, plus the web app
   pinned to `:3111` — `next start` defaults to `:3000`) and `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` for
   a seeded user, **which an executor cannot mint**. Nothing here may be read as "the spec passes".
2. **The BRAND conformance judgement — SC#6's human half.** An e2e can prove the card mounts and
   names the artifact. It cannot judge whether the card *looks* like BRAND §5's Output card or reads
   well. That is a Manual-Only row in `18-VALIDATION.md`. The card was built against BRAND §§2/3/5/6
   and the `docs/design/brand/` patterns, but **it has never been rendered in a browser.**

The spec's own header comment states both, so the next reader cannot mistake a green `--list` for a
green run.

## The null case is in the spec on purpose

A second test sends `SMOKE::agent::add=alice@example.com` — a governed tool call that writes no
`role: "created"` row — and asserts `output-card` has count 0. Without it, the presence assertion is
satisfied by a card that renders on every turn, which is exactly the failure mode `SourceCard`'s
`return null` exists to prevent.

## The vault-search ceiling, annotated at the site

`DocGrid`'s `rows` filter now carries a `ponytail:` comment naming the known ceiling: created
documents **browse** in this grid for free (`listVaultDocs` collects the tenant partition with no
kind/status/origin filter) but will **never** appear in the search box, because `vault.vaultSearch`
is the same rag primitive as grounding and created artifacts are deliberately never ingested — that
absence *is* the retrieval exclusion. Upgrade path named in the comment: a ~3-line title-substring
fallback unioned into `hitIds`, right there. **Do not solve it by ingesting.** Accepted for beta;
open owner question in 18-09's gate.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm --filter @pikar/web exec tsc --noEmit` | **exit 0** (run after each task) |
| `pnpm --filter @pikar/web build` | **green** — all routes compiled, incl. `/dashboard/workspace` and `/dashboard/vault` |
| `playwright test e2e/cockpit-created-document.spec.ts --list` | **3 tests in 2 files** (2 chromium + the `setup` dep) |
| `grep -c "output-card"` on the spec | **3** |
| `biome check` on `cards.tsx` | 4 errors — **identical set to `git show HEAD:…`** (whole-file CRLF format, `organizeImports:3:1`, `useHookAtTopLevel:746`, `noArrayIndexKey` at `1550`→`1638`, the +88 line shift). **Zero new diagnostics.** |
| `biome check` on `DocGrid.tsx` | 1 error — the same pre-existing whole-file format diagnostic, byte-for-byte with baseline. **Zero new.** |
| `biome check` on the new spec | **clean, zero diagnostics** |
| `vitest run convex/traceParity.test.ts` | **2/2** |
| `--held` / hardcoded hex in ADDED lines | **zero** (3 `--held` hits, all comments forbidding it) |
| `git diff --stat` on `actionType.ts` / `cockpit.ts` / `plans.ts` / `vaultIngest.ts` / `traceParity.test.ts` / `schema.ts` | **empty** |
| `node scripts/check-playbooks.mjs check` | exit 0 (see the caveat) |
| `graphify update` + `extract-convex-edges.mjs` | −78 noise nodes, +20 convex edges |
| This plan's file count | exactly **3** |

**Baseline comparison method.** `git stash` is banned in this shared tree (18-06's near-miss). Each
file's Biome baseline was taken by writing `git show HEAD:<path>` to a throwaway sibling inside
`apps/web`, running `biome check` on it, and deleting it — no working-tree state was moved.

### The playbook hook passed and it is STILL a probable false negative

`cockpit.md` watches `apps/web/app/(app)/dashboard/workspace/` **and** `apps/web/e2e/`; `vault.md`
watches `apps/web/app/(app)/dashboard/vault/`. This plan edits all three prefixes, so under §9 both
playbooks are owed. The hook exits 0 anyway — the fourth plan running — because foreign lanes keep
bumping `Last verified` on these shared playbooks. **The plan assigns `cockpit.md` + `vault.md` to
18-09, and 18-09 must not read a green hook as the obligation discharged.** Bumping a `Last verified`
another lane owns would claim verification of a diff this plan never read.

## Deviations from Plan

**1. [Design, recorded not papered over] The single-title heading was replaced by the `#index`
title list.** Reason above — the plan's `titles[0]` is unsafe against the accumulate-and-revise row
shape 18-06 shipped. No rule fired; this is the plan's own "count-aware heading" latitude taken to
its correct conclusion. Every `done` criterion still holds: title, UPPERCASE badge off `row.form`,
subline, snippet, `data-testid="output-card"`, `null` on a turn that created nothing.

**2. [Extra, cheap] The e2e asserts three things, not two.** The plan requires the testid + the
title; the spec also asserts the `DOCUMENT` badge (a `POST` there would mean the badge stopped
reading `row.form`, the one thing 18-04 and 18-06 both warned about) and the `nothing was sent`
subline. Plus the second, null-case test that makes the first non-vacuous.

**3. [BRAND §6 over in-file precedent] The badge does not copy `ConfChip`'s `--teal-600` text.**
Detailed above. This is a deliberate divergence from a sibling component in the same file.

**Out of scope, not touched:** the pre-existing whole-file CRLF format diagnostics on both edited
files (running `biome check --write` would reformat hundreds of lines of untouched code into
cross-lane merge noise); the three pre-existing lint findings in `cards.tsx`.

## Notes for the Next Plan

- **18-09 must actually RUN `cockpit-created-document.spec.ts`.** It is authored, typechecked and
  discoverable; it has never executed. Preconditions are listed verbatim in the spec's header.
- **18-09 owns SC#6's human half** — open `/dashboard/workspace`, drive one create turn, and judge
  the card against BRAND §5. The card has never been rendered in a browser.
- **18-09 owns `cockpit.md` + `vault.md`**, and the green `check-playbooks` is not evidence.
- **The vault-search exclusion is an open owner question**, annotated in `DocGrid.tsx` with its
  upgrade path. Do not close it by ingesting.
- **`data-testid="output-title"`** exists on each title link if a later spec needs a targeted handle.

## Self-Check: PASSED

- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — FOUND; contains `OutputCard`,
  `role: "created"`, `data-testid="output-card"`, `FORM_LABEL`
- `apps/web/app/(app)/dashboard/vault/DocGrid.tsx` — FOUND; contains `OriginChip`,
  `doc.origin !== undefined`, the `ponytail:` ceiling comment
- `apps/web/e2e/cockpit-created-document.spec.ts` — FOUND, 71 lines (> the 20 `min_lines`),
  `output-card` ×3, the verbatim `create=` sentinel
- Commit `1c53030` (Task 1, OutputCard) — FOUND
- Commit `b1b7030` (Task 2, AGENT chip) — FOUND
- Commit `590ee9a` (Task 3, e2e spec) — FOUND
