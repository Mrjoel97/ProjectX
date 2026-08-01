---
phase: 18-document-content-creation
plan: 06
subsystem: cockpit-tool-surface
tags: [agent-tools, vault, replace-in-place, refs-only-audit, smoke-grammar, closed-enum]
requires:
  - "18-02 (the `createDocument` agentSteps.tool literal + its cards.tsx VERB entry)"
  - "18-04 (insertCreatedDoc / patchCreatedDoc / the vaultSources card shape)"
  - "18-05 (draftDocument's closed `skillName`, which is what makes `short` reach content-drafter)"
provides:
  - "createDocument — the tool the model calls: { topic, form: short|long, replace?: number } => string"
  - "SMOKE_OP_TOOL.create === 'createDocument' — the create=<short|long>:<topic> offline driver"
  - "internal.vaultSources.latestCreated({ tenantId, threadId }) — the explicit-tenantId card reader"
  - "the document.created audit event: { topicHash, form, vaultDocId, hasPdf }"
affects:
  - "18-07 (the Output card reads the vaultSources row this tool writes; its e2e spec drives create=)"
  - "18-08 (the cockpit-agent body must teach EXACTLY the description recorded below)"
  - "18-09 (the live gate: the trigger rule has no code branch and is verifiable only there)"
tech-stack:
  added: []
  patterns:
    - "One tool, one optional property: `replace` buys the revision path at ZERO registration cost"
    - "A closed JSON-Schema enum steers BOTH the skill row and the render branch — no inference"
    - "Refusal-by-return: every governed stop in this tool is a sentence, never a throw"
    - "The card is read-then-append, so ONE row always carries ALL N docIds and #index stays stable"
key-files:
  created: []
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/vaultSources.ts
    - packages/backend/convex/cockpitTools.test.ts
decisions:
  - "vaultSources.latestCreated added: byThread is a tenantQuery (auth-derived) and the tool plane passes tenantId EXPLICITLY, so the two cannot share one function"
  - "The card ACCUMULATES across the conversation rather than per-turn: buildCockpitTools is rebuilt per tool invocation, so a closure accumulator cannot span turns — and 'in this conversation' is what the tool description promises anyway"
  - "Task 2's `replace` code landed in Task 1's commit: it is one schema and one execute body; splitting it would have meant writing the tool twice"
  - "content-drafter is archived through the shipped internal.skills.archiveSkill, not a hand-rolled t.run patch (this file's `T` is deliberately schema-generic)"
metrics:
  duration: ~45 min
  completed: 2026-08-01
---

# Phase 18 Plan 06: The createDocument Tool Summary

One key in `buildCockpitTools`, one optional property that buys the entire revision path, and a
four-site SMOKE registration. This is the surface the model actually calls — every earlier plan in
this phase was machinery whose only consumer is this tool.

## The tool contract — 18-08 must teach EXACTLY this

**Description (verbatim, split across concatenated literals because `skills.test.ts` scans `convex/`
for inline strings over 200 chars):**

```
Create a standalone document or piece of content and save it to the user's vault. Use `long` for
proposals, one-pagers and reports; `short` for posts, ad copy or headlines. Pass `replace` to
rewrite a document created earlier in this conversation in place. It saves only — it never sends
anything. Create directly when the user asks for one; when creating one is YOUR idea, say what you
would write and wait for a yes.
```

**Schema (verbatim):**

```ts
inputSchema: jsonSchema<{ topic: string; form: "short" | "long"; replace?: number }>({
  type: "object",
  properties: {
    topic: { type: "string", description: "What to write, in plain language." },
    form: {
      type: "string",
      enum: ["short", "long"],
      description: "long = proposal, one-pager, report. short = post, ad copy, headline.",
    },
    replace: {
      type: "number",
      description:
        "1-based #index of a document already created in this conversation to rewrite in place.",
    },
  },
  required: ["topic", "form"],   // `replace` stays OPTIONAL — create is the default shape
  additionalProperties: false,
}),
```

The locked trigger rule (*explicitly asked → create directly; agent-suggested → confirm first*) is
the description's closing clause and **nowhere else in code**. There is no `confirmed` argument —
a model-supplied confirmation flag is the model grading its own trigger — so there is no code branch
and no offline test for it. It is verified by live UAT in 18-09.

## ⚠ The tool is INVISIBLE to the model until 18-08 teaches it

`buildCockpitTools` now returns a `createDocument` key, the schema literal and the VERB entry exist
(18-02), and the SMOKE op drives it offline. **None of that puts it in the model's context.** The
active `cockpit-agent` body does not mention it, so on a real gateway turn the model will not call
it. A tool the body does not teach is a tool that does not exist. 18-08 is still parked behind
Phase 16 closing the shared candidate stream.

## The exact SMOKE sentinel 18-07's spec must send

```
SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager
```

The **nested** `SMOKE::route=direct_llm::` prefix is part of the TOPIC and is load-bearing.
`SMOKE::agent::create=` only picks the tool; it does not keep the model out of the loop.
`parseSmoke` is `^`-anchored on the safeText `draftDocument` receives, so without the nested prefix
`generateObject` fires for real, throws with no key, and **no `vaultDocuments`/`vaultSources` row is
written at all**. That is exactly why the `create` case splits on the FIRST colon and hands
`val.slice(c + 1)` through untrimmed. It is asserted, not just documented:

```
parseAgentSmoke("SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager")
  === { kind: "create", form: "long", topic: "SMOKE::route=direct_llm:: Quarterly one-pager" }
```

`create=long` (no colon) and `create=medium:x` (outside the closed enum) both parse to `null` and
drive nothing — the same shape as a malformed `regenerate=`. Registration Checklist row **16** is
closed at all four sites; `SMOKE_OP_TOOL` is typed TOTAL, so the op could not compile without it.

## The audit payload

```ts
eventType: "document.created", actor: "system", correlationId: planId,
payload: { topicHash, form, vaultDocId: String(id), hasPdf }
```

Four keys, asserted by exact key-set equality. A hash, a closed enum, an id and a boolean —
no topic, no title, no prose (CLAUDE.md §4, the `research.ts:188-211` shape). It is emitted from the
**tool**, not from `cockpit.ts`: that file still has exactly **2** `internal.audit.log` call sites
and `llmRedaction.test.ts` is 43/43 green.

## What the two forms actually do

| | short | long |
| --- | --- | --- |
| skill row loaded | `CONTENT_DRAFTER_SKILL` | `DOCUMENT_DRAFTER_SKILL` |
| `vaultDocuments.kind` | `created_content` | `created_document` |
| `mimeType` | `text/markdown` | `text/markdown` |
| `storageId` | **absent** | present (derived PDF) |
| Download button | none, for free | `PreviewModal`'s shipped `canDownload` |

Both pass `skillVersion: skillVersions?.[skillName]` — the record is name-keyed, so no new plumbing.
`skillVersions?.[CONTENT_DRAFTER_SKILL]` resolving to `undefined` is correct: `content-drafter` is
deliberately outside `GATED_SKILLS`.

**HTML appears nowhere in this flow, by design.** Markdown is the locked artifact of record; storing
HTML would land the row at `pending_extraction` and round-trip it through `vaultExtract` to recover
text we rendered from. `createDocument` is a SIBLING closure of `renderAndStore`, never a caller:
`renderAndStore` captures `planId` and writes `plans.recordAttachments` on failure, both wrong for a
vault artifact. `renderAndStore` occurrences in `llm.ts` are unchanged.

## The one design call this plan had to make: how the card accumulates

18-04 locked *ONE `vaultSources` row per turn carrying ALL N `docIds`* — that is what makes
`replace: 2` resolvable, since `patchCreatedDoc` reads `docIds[index - 1]`.

**There is no turn identity available inside a tool closure**, and `buildCockpitTools` is rebuilt per
invocation, so a closure-local accumulator cannot span two `createDocument` calls. The tool therefore
**reads the thread's latest created card and appends to it**: `docIds = [...card.docIds, newId]`.
Consequences, all of them intended:

- The index is monotone over the **whole conversation**, which is precisely what the tool description
  promises (*"a document already created in this conversation"*).
- The latest card always carries every created docId, so `#2`, `#3`, … stay addressable across turns
  and across intervening `searchVault` turns (the read is `role`-filtered, never a bare `.first()`).
- A revise writes a NEW row with the same `docIds` and a fresh `titles`/`snippet`/`form`, so the
  Output card refreshes with zero new code. `count` is `docIds.length`, `snippet` is the newest
  artifact's first 240 chars, `form` is the newest artifact's form.

`byThread` could not serve the read: it is a `tenantQuery` and derives the tenant from auth, while
the tool plane passes `tenantId` EXPLICITLY (the `gmail.search` / `vaultGround` convention) and an
action has no user identity to derive from. `internal.vaultSources.latestCreated` is the same 20-row
window and the same load-bearing `role` filter; only the tenant source differs.

## Mutation checks (both performed, both reverted green)

**SC2 (mandated by the plan).** Inserted `void internal.cockpit.sendCockpitMessage;` inside the tool
body:

```
× SC2: the createDocument tool body has NO external side effect
Tests  1 failed | 2 passed | 79 skipped (82)
```

Exactly 1 RED, and the right one. Reverted ⇒ green. The scan has a non-vacuity floor (the slice must
still contain `internal.vault.(insert|patch)CreatedDoc`, and the slice itself must be > 400 chars and
bounded by the NEXT tool key — an anchor that moves fails loudly rather than passing trivially).

**The `form` badge (extra).** Dropped `form` from the `vaultSources.insert` call:

```
Tests  5 failed | 77 passed (82)
```

5 RED — the static scan plus four behavioural rows. Worth recording because `form` is the ONLY data
source for 18-07's UPPERCASE type badge and 18-04 warned that nothing else in the offline suite
catches its absence; after this plan, four things do.

`git diff --stat packages/backend/convex/llm.ts` was empty after each revert — the file is
byte-identical to its committed state.

## Verification

| Gate | Result |
| --- | --- |
| `vitest run convex/cockpitTools.test.ts` | **82/82** (was 71 — +11) |
| `+ llmRedaction, createdDocs, dispatchGuard, traceParity, skills, runCockpitAgent, vault, vaultGround, documentDraft` | **268/268 green across 10 files** |
| `turbo run typecheck --filter=@pikar/backend --force` (FOREGROUND) | **150 — delta 0 vs 18-02/18-04/18-05, ZERO non-test** |
| `biome check` on the three edited files | 4 errors / 71 warnings, all `lint/style/noNonNullAssertion` at pre-existing locations; **zero diagnostics inside the new tool body** |
| `git diff --stat` on `actionType.ts` / `cockpit.ts` / `plans.ts` / `traceParity.test.ts` / `vaultIngest.ts` / `schema.ts` / `watch.json` / `document-drafter.md` / `cockpit-agent.md` | **empty** |
| `internal.audit.log` call sites in `cockpit.ts` | **2 — unchanged** |
| `node scripts/check-playbooks.mjs check` | exit 0 (see the caveat) |
| `graphify update` + `extract-convex-edges.mjs` | −75 noise nodes, +32 convex edges, +1 table edge |

The full backend suite was **not** used as a gate — 18-02, 18-04 and 18-05 all recorded it as
unreliable in this multi-lane tree. Gated on the ten suites above, run directly.

### The playbook hook passed and it is STILL possibly a false negative

`cockpit.md` watches `packages/backend/convex/llm.ts`, which this plan edits. The hook exits 0
anyway, for the third plan running, because foreign lanes bump `Last verified` on shared playbooks.
**18-09 owns `cockpit.md` + `vault.md` and must not read a green hook as the obligation discharged.**

## Deviations from Plan

**1. [Rule 3 — Blocking] `internal.vaultSources.latestCreated` was added** (`vaultSources.ts` is not
in the plan's `files_modified`). The tool cannot write the appended/refreshed Output-card row without
reading the current card, and `byThread` is a `tenantQuery` unreachable from an action carrying an
explicit `tenantId`. The alternative — widening `patchCreatedDoc`'s return with `docIds`/`titles` —
would have broken two `toEqual({ ok: true, oldStorageId })` assertions in `createdDocs.test.ts`, i.e.
edited a file 18-04 owns *and* a shipped signature. One additive `internalQuery` in the module that
already owns this table is the smaller, safer diff. Commit `47fc7dd`.

**2. [Structure] Task 2's PRODUCTION code landed in Task 1's commit.** `replace` is one property on
one `inputSchema` and one branch in one `execute` body; splitting it across two commits would have
meant writing the tool twice. Task 2 contributed its four tests (revision behaviour, bad-index
refusal, the SC2 scan, the renderer-bypass guard) plus the mandated mutation check, in `8751315`.
Both tasks' `done` criteria are met.

**3. [Rule 1 — Bug, in my own new test] `t.run` + `.withIndex("by_name_status", …)` cost +3 typecheck
errors.** This file's `type T = ReturnType<typeof convexTest>` is deliberately schema-generic, so
`ctx.db` inside `t.run` only knows `SystemIndexes`. Fixed by calling the shipped
`internal.skills.archiveSkill` (`skills.ts:455`) instead — rung 2, and it exercises the real
retirement path. Commit `a139696`.

**4. [Hygiene, inherited from 18-04] The `@ts-expect-error import.meta.glob` line was NOT copied**
onto the new `rateLimiterModules` glob. It is dead under this tsconfig (TS2578) and cost a real +1;
dropping it landed exactly 150. A comment at the site says why, so nobody "restores" the idiom.

**5. [Reverted] `biome check --write` was run on `cockpitTools.test.ts` and then backed out.** It
reformatted 92 lines of PRE-EXISTING test code to the configured line width — cross-lane merge noise
for zero correctness. Reverted with `git checkout --` (this plan's own additions were already
committed) and the two functional fixes re-applied by hand. The remaining
`assist/source/organizeImports` diagnostic on this file is **pre-existing** (the
`../node_modules/...` component imports have sat after the `./` imports since before this phase).

**6. [PROCESS INCIDENT — do not repeat] `git stash -u` was used for a biome baseline comparison in
this SHARED working tree.** It was popped successfully and, verified against the stash object
(`ea07c31`), it captured only `graphify-out/*`, `cockpitTools.test.ts` and the untracked `Skills/`
folder — all restored, nothing foreign lost. But it was still the wrong tool: a foreign lane's
uncommitted work would have been swept into a stash it does not know about. **Never `git stash` here.
Compare against `git show HEAD:path` instead.** Recorded because the near-miss is the lesson.

**Out of scope, not touched:** the 150 pre-existing backend typecheck errors (100 of them that one
dead directive across 37 files, which 22.1-03 is sweeping); the whole-suite reliability problem.

## Notes for the Next Plan

- **18-07's e2e must send the sentinel verbatim, nested prefix included.** Without it the turn is not
  offline and no Output card can ever appear.
- **18-07's badge reads `vaultSources.form`.** It is written on every create AND every revise, and
  four tests now fail if it stops being.
- **18-08 must teach the description recorded above, not a paraphrase.** The trigger rule has no code
  branch; the body's wording IS the mechanism.
- **18-09's live gate owns everything this plan could not test offline:** whether the model calls the
  tool unprompted, whether it confirms before creating on its own initiative, and whether the
  `#index` phrasing ("make the second one shorter") actually resolves in a real conversation.
- **`replace` is deliberately absent from the SMOKE grammar.** 18-07 needs ONE created document; the
  revision path is proven by `cockpitTools.test.ts` and by the live gate. A second op would be a
  second registration surface for zero coverage.

## Self-Check: PASSED

- `packages/backend/convex/llm.ts` — FOUND; contains `createDocument: tool(`, `create: "createDocument"`,
  `internal.vault.insertCreatedDoc`, `internal.vault.patchCreatedDoc`, `document.created`, `skillName`
- `packages/backend/convex/vaultSources.ts` — FOUND; exports `latestCreated`
- `packages/backend/convex/cockpitTools.test.ts` — FOUND; 82 tests (was 71), contains `createDocument`
- Commit `bc9ec08` (RED, Task 1) — FOUND
- Commit `47fc7dd` (GREEN, Tasks 1+2 production) — FOUND
- Commit `8751315` (Task 2 tests + scans) — FOUND
- Commit `a139696` (typecheck hygiene) — FOUND
