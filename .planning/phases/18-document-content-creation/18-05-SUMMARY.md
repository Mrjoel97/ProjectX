---
phase: 18-document-content-creation
plan: 05
subsystem: drafting-seam
tags: [skill-registry, parameterization, attachments, output-format, governed-path]
requires:
  - "18-01 (packages/core: DocFormat, formatSpec, renderHtmlDocument, buildDocFilename's 4th param)"
  - "18-03 (the ungated content-drafter row at v1 active)"
provides:
  - "internal.llm.draftDocument({ tenantId, safeText, safeTextHash, skillVersion?, skillName? }) — skillName is a CLOSED optional union"
  - "renderAndStore(topic, existing, replaceIndex, format = 'pdf') — the 4th defaulted param"
  - "generateAttachment's OPTIONAL `format` input property (pdf | html)"
affects:
  - "18-06 (createDocument MUST pass skillName + skillVersion: skillVersions?.[skillName])"
  - "18-08 (the cockpit-agent body may now teach the format argument — it is real)"
tech-stack:
  added: []
  patterns:
    - "Closed-union argument over v.string(): a wrong skill name is a validator error, never a silently-wrong prompt body"
    - "One `const name = skillName ?? DEFAULT` feeding BOTH lookup branches — the root-cause shape, not two patched call sites"
    - "A defaulted trailing parameter makes a second format additive: every shipped caller is byte-identical by construction"
key-files:
  created: []
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/documentDraft.test.ts
    - packages/backend/convex/cockpitTools.test.ts
decisions:
  - "SC4's html test lives in cockpitTools.test.ts, not documentDraft.test.ts: renderAndStore is only reachable through the __invokeCockpitTool shim, which needs the node pragma + the registered auditCounts component that file already has"
  - "generateAttachment's description changed from 'Generate a PDF document' to 'Generate a document' — the old wording became false once html was reachable"
  - "regenerateAttachment deliberately left at three args; the default is what makes SC4b true"
metrics:
  duration: ~30 min
  completed: 2026-08-01
---

# Phase 18 Plan 05: Threading skillName and format Summary

Two parameters, four commits, zero new files: `draftDocument` now takes a **closed** `skillName` so
18-03's `content-drafter` row is loadable instead of dead weight, and `renderAndStore` takes a
defaulted `format` so a self-contained HTML page is emitted through the *same* PII → registry drafter
→ 8 MiB cap → `ctx.storage.store` → ref-only chain that already shipped for PDF.

## The exact `draftDocument` argument list after this plan — 18-06 READ THIS

```ts
internal.llm.draftDocument({
  tenantId: string,
  safeText: string,          // ALREADY redacted by the caller (scanText, fail-closed) — §4
  safeTextHash: string,
  skillVersion?: number,     // EVAL-01 pin; a missing (name, version) FAILS CLOSED
  skillName?: "document-drafter" | "content-drafter",   // NEW. Absent = document-drafter
}) => Promise<{ title: string; markdown: string }>
```

**18-06's `createDocument` must pass BOTH:**

```ts
const skillName = form === "short" ? CONTENT_DRAFTER_SKILL : DOCUMENT_DRAFTER_SKILL;
await ctx.runAction(internal.llm.draftDocument, {
  tenantId, safeText, safeTextHash,
  skillName,
  skillVersion: skillVersions?.[skillName],   // name-keyed record — no new plumbing needed
});
```

`skillVersions?.[CONTENT_DRAFTER_SKILL]` resolving to `undefined` is **correct, not a gap**:
`run-eval-golden.mjs`'s `SKILL_NAMES` derives from `GATED_SKILLS` and `content-drafter` is
deliberately ungated, so the pin falls through to the active row, which is the intent.

**Why a closed union and not `v.string()`.** The action is internal-only and model-unreachable, so
this is not a prompt-injection defence — it is a *typo* defence. With `v.string()` a wrong name
reaches `getActiveSkill` and either throws a runtime `NO_ACTIVE_SKILL` in production or, worse,
successfully loads some *other* registry row and drafts with the wrong prompt body. With the union,
a wrong name is a validator error at the call site.

**`document-drafter`'s body is byte-unchanged.** `git diff packages/contracts/skills/document-drafter.md`
is empty. This plan changes who is ASKED for, never what it says — so no gated candidate was minted
and no paid eval is owed.

## HTML is reachable on the ATTACHMENT path ONLY, and that is the design — do not "fix" it

`renderHtmlDocument` is called from exactly one place: `renderAndStore`'s html branch.
`renderAndStore` is reached from exactly two places: `generateAttachment` and
`regenerateAttachment` — the Phase-3.3 email attachment tools.

**18-06's `createDocument` will find no HTML anywhere in its flow. That is correct.** CONTEXT.md locks
*markdown is the artifact of record* for a created document; storing HTML as that artifact lands a
non-markdown vault row at `pending_extraction` and round-trips it through `vaultExtract` to recover
text we rendered *from*. A planner who reads the asymmetry as a gap is looking at the design.

## What changed in `llm.ts`, site by site

| Site | Before | After |
| --- | --- | --- |
| `draftDocument` args | `{ tenantId, safeText, safeTextHash, skillVersion? }` | `+ skillName?` (closed union) |
| `draftDocument` handler | `DOCUMENT_DRAFTER_SKILL` hardcoded **twice** | one `const name = skillName ?? DOCUMENT_DRAFTER_SKILL`, read by both branches |
| `renderAndStore` signature | `(topic, existing, replaceIndex)` | `+ format: DocFormat = "pdf"` |
| render | `await markdownToPdf(...)` | `format === "pdf" ? await markdownToPdf(...) : new TextEncoder().encode(renderHtmlDocument(draft.title, draft.markdown))` |
| filename | `buildDocFilename(topic, today, others)` | `+ format` |
| store + returned `att` | `"application/pdf"` ×2 | one `const { mimeType } = formatSpec(format)` hoist, used twice |
| `generateAttachment` | `inputSchema { topic }` | `+ format?: "pdf" \| "html"`, passed straight to `renderAndStore` |

**Zero changes** to `skills.ts` (both queries already took `name: v.string()`), `gmail.ts`
(`buildMime` emits `Content-Type: ${a.mimeType}` generically), `regenerateAttachment`, or any
locked file. The lookup still runs **before** the SMOKE short-circuit, so the fail-closed contract
stays exercised offline. No second size constant: `PLAN_ATTACHMENT_CAP_BYTES` (8 MiB) is shared by
both formats, which is precisely what SC#4 asks for.

**`renderAndStore` was NOT extracted from its closure** (Pitfall 6). Occurrences in `llm.ts` are
still **5**, identical to HEAD — the declaration, the two call sites and two comments.

## Mutation checks (both performed, both reverted green)

**Task 1** — replaced `const name = skillName ?? DOCUMENT_DRAFTER_SKILL` with the hardcoded name
while *keeping* the argument:

```
× skillName selects the row; omitting it still loads document-drafter
Tests  1 failed | 3 passed (4)
```

Exactly 1 RED, and the right one. This is the check that matters, because a `skillName` argument
that is accepted and then ignored is indistinguishable from the shipped behaviour under any test
that only asserts "the seeded call succeeds". The discriminator seeds **both** rows, archives
**only** `content-drafter`, and then requires the `skillName` call to throw
`NO_ACTIVE_SKILL: content-drafter` while the argument-less call still succeeds.

**Task 2** — replaced `renderHtmlDocument(draft.title, draft.markdown)` with `draft.markdown`:

```
Tests  1 failed | 70 passed (71)
```

Exactly 1 RED (the SC4 row), proving the html branch cannot silently degrade to storing raw markdown
under a `text/html` MIME type — the XSS-adjacent failure that would otherwise ship green.

## Verification

| Gate | Result |
| --- | --- |
| `vitest run convex/documentDraft.test.ts convex/cockpitTools.test.ts convex/llmRedaction.test.ts convex/runCockpitAgent.test.ts` | **142/142 green** (was 139 — +2 SC7b, +2 SC4, and the RED→GREEN of the pre-existing 4) |
| `turbo run typecheck --filter=@pikar/backend --force` (FOREGROUND) | **150 — delta 0 vs 18-02/18-04, ZERO non-test** |
| `biome check` on all three edited files | **4 errors / 43 warnings — byte-identical to the same three files at HEAD** (all pre-existing) |
| `git diff --stat` on `actionType.ts` / `cockpit.ts` / `plans.ts` / `gmail.ts` / `vaultIngest.ts` / `document-drafter.md` | **empty** |
| `"application/pdf"` literals inside `renderAndStore` | **0** |
| `renderAndStore` occurrences in `llm.ts` | **5 — unchanged from HEAD** |
| `node scripts/check-playbooks.mjs check` | exit 0 (see the caveat) |

The full backend suite was **not** used as a gate — 18-02 and 18-04 both recorded it as unreliable in
this four-lane tree. Gated on the four suites above, run directly, per the standing convention.

### The playbook hook passed and it may again be a FALSE NEGATIVE

`cockpit.md` watches `packages/backend/convex/llm.ts`, which this plan edits. The hook exits 0
anyway. Per 18-04's finding, foreign lanes bump `Last verified` on shared playbooks, which satisfies
the "touched since baseline" test for everyone. **The plan assigns `cockpit.md` to 18-09 and this
plan deliberately did not bump it. 18-09 must not read a green hook as the obligation discharged.**

## Deviations from Plan

**1. [Placement] The SC4 html test lives in `cockpitTools.test.ts`, not `documentDraft.test.ts`.**
The plan's `files_modified` names only `llm.ts` + `documentDraft.test.ts`, but `renderAndStore` is a
closure inside `buildCockpitTools` and is reachable ONLY through the `internal.llm.__invokeCockpitTool`
shim, which needs `// @vitest-environment node` (the suite default is `edge-runtime`) plus the
registered `auditCounts` aggregate component. `cockpitTools.test.ts` has both, plus the `setup()` /
`call()` / `readPlan()` harness and every other attachment-path assertion. Adding the node pragma to
`documentDraft.test.ts` would have changed the runtime of four shipped tests to duplicate a harness
sitting two files over (ponytail rung 2). The plan's own Task-2 verify command already runs
`cockpitTools.test.ts`. `documentDraft.test.ts` still satisfies its `contains: "CONTENT_DRAFTER_SKILL"`
artifact contract via the two SC7b rows.

**2. [Rule 1 — Bug, in my own new test] `t.run((ctx) => ctx.storage.get(id))` throws
`Blob {} is not a supported Convex type`.** A `Blob` cannot cross the `t.run` boundary. Fixed by
reading `.text()` *inside* the callback. Caught by running the test, not by review.

**3. [Copy] `generateAttachment`'s description changed** from *"Generate a PDF document on the given
topic…"* to *"Generate a document on the given topic…"*. The old wording became a false statement the
moment html was reachable, and this description is model-visible prompt surface. The confirm rule
(*"Only after the user asks for (or confirms) an attachment"*) and the block-on-render-fail sentence
are byte-unchanged. `llmRedaction.test.ts`'s `generateAttachment` slice assertions stay green (43/43).

**4. [Hygiene, inherited from 18-04] The `// @ts-expect-error import.meta.glob` line was NOT added**
to any new code. `documentDraft.test.ts` already carries it from before this phase — it was left
alone rather than swept, because sweeping is 22.1-03's job and touching it here would muddy this
plan's typecheck delta.

**Out of scope, not touched:** the 150 pre-existing backend typecheck errors (100 of them that one
dead directive across 37 files); the whole-suite reliability problem.

## Notes for the Next Plan

- **18-06 passes `skillName` AND `skillVersion: skillVersions?.[skillName]`** — the record is
  name-keyed, so the same 5th `buildCockpitTools` argument covers both drafters with no new plumbing.
- **18-06's `createDocument` does not and must not call `renderAndStore`.** It is a SIBLING closure.
  `renderAndStore` captures `planId` and writes `plans.recordAttachments` on failure — both wrong for
  a created document. The long-form PDF is a direct two-line
  `markdownToPdf` → `ctx.storage.store(new Blob([bytes], { type: "application/pdf" }))`.
- **`formatSpec` is now imported in `llm.ts`** — reuse it rather than re-writing either MIME literal.
- **Registration Checklist row 4 is CLOSED:** `content-drafter` is reachable. Row 4 was the phase's
  quiet blocker; 18-03's row is no longer dead weight.
- **18-08's `cockpit-agent` body edit may now truthfully teach the `format` argument** — the tool
  really accepts it. Still gated on Phase 16 closing.

## Self-Check: PASSED

- `packages/backend/convex/llm.ts` — FOUND; `skillName` present, `formatSpec`/`renderHtmlDocument`/
  `DocFormat` imported, zero `"application/pdf"` literals inside `renderAndStore`
- `packages/backend/convex/documentDraft.test.ts` — FOUND; contains `CONTENT_DRAFTER_SKILL`, 4 tests
- `packages/backend/convex/cockpitTools.test.ts` — FOUND; 71 tests (was 69)
- Commit `a154c9d` (RED, Task 1) — FOUND
- Commit `e06cd45` (GREEN, Task 1) — FOUND
- Commit `6360ac9` (RED, Task 2) — FOUND
- Commit `1b53e32` (GREEN, Task 2) — FOUND
