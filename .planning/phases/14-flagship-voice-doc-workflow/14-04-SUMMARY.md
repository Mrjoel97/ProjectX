---
phase: 14-flagship-voice-doc-workflow
plan: 04
subsystem: voice-doc
tags: [wave-4, convex-adapter, mint, realtime-tools, prompt-fencing, registry-persona, lane-c]
requires:
  - phase: 14-01
    provides: "the document-analyst persona row (seeded UNGATED) + DOCUMENT_ANALYST_SKILL, and vaultDocuments.extractionTruncated already in schema"
  - phase: 14-02
    provides: "buildDocDigest / DIGEST_CHAR_CAP / DIGEST_FENCE_*, SEARCH_DOCUMENT_TOOL, SESSION_TOOL_KEYS, TOOL_CHOICE_AUTO and the dated blank-until-verify decision line in realtime.ts"
  - phase: 14-03
    provides: "api.voiceDoc.searchDocument — the real action the declared tool points at — and the `voicedoc: document not found/not ready` message vocabulary"
  - phase: 06-live-voice-sessions
    provides: "mintClientSecret, its live-verified audio.input body shape, and the mock-fetch body-capture test harness"
provides:
  - "voiceToken.mintClientSecret({docId?}) -> {clientSecret, expiresAt, toolsAtMint} — the doc-grounded ephemeral session"
  - "toolsAtMint — the transport-control flag 14-06's relay branches on"
  - "voiceToken.docForMint — the {title,text,status,extractionTruncated} tenant-scoped read the mint needs"
  - "both branches of Open Question 3 (mint-time tools + the session.update fallback), shipped and tested"
affects:
  - "14-06 (browser relay: reads toolsAtMint; sends session.update{tools,tool_choice} when false; passes ?doc= through as docId)"
  - "14-07 (vault picker: the 'Discuss by voice' entry point supplies the docId)"
  - "14-09 (live verify fills the dated LIVE-VERIFIED line in realtime.ts with the accepted branch)"
tech-stack:
  added: []
  patterns:
    - "build-the-body-once: a local sessionBody(withTools) closure, so the tools-carrying and toolless POSTs can never drift apart in anything but the tool keys"
    - "shape-fallback, not retry-policy: re-POST on 400 ONLY, and only when something was actually declared — every other non-OK status still throws first time"
    - "trivially-true flag: toolsAtMint is true when there was nothing to declare, so the consumer's branch stays a single `if (!flag)`"
    - "anti-vacuous fail-closed: delete ONLY the persona under test and assert the OTHER branch still mints on the same harness"
key-files:
  created: []
  modified:
    - packages/backend/convex/voiceToken.ts
    - packages/backend/convex/voiceToken.test.ts
    - docs/playbooks/voice.md
key-decisions:
  - "the mint reads the document through a module-local `docForMint` internalQuery, NOT internal.vault.getDoc — that query carries no `status` and no `extractionTruncated`, so it can answer neither the readiness check nor the truncation disclosure (the same wrong premise 14-03 hit at startSession)"
  - "the mint re-validates the document rather than trusting startSession, because the browser MINTS BEFORE it has a session row (useVoiceSession.ts:269) — the mint is the FIRST trust boundary in wall-clock order, not a redundant second one"
  - "toolsAtMint is trivially `true` on an unscoped mint: nothing was declared, so there is nothing for the browser to re-declare and its branch stays one line"
  - "the 400 re-POST fires ONLY when tools were actually declared; a 500 (and any other non-OK) still throws on the first attempt — the fallback is a SHAPE fallback, not a retry policy"
  - "voiceToken.test.ts now references api.voiceToken.mintClientSecret, not internal.* — mintClientSecret is a PUBLIC tenantAction, so the internal reference was always wrong and was 3 of the 52 pre-existing tsc errors"
patterns-established:
  - "the tool SET is a containment layer: exactly ONE tool, READ-ONLY, asserted by length — an instruction planted in the report has nothing to actuate"
requirements-completed: []
duration: ~18 min
completed: 2026-07-26
---

# Phase 14 Plan 04: The Doc-Grounded Mint Summary

**`mintClientSecret({docId?})` now opens a session that already knows the report: the
`document-analyst` registry persona, a bounded fenced digest of that specific document, and exactly
one flat read-only retrieval tool — and if the API refuses tools in the mint body, the session still
opens and the browser is told to declare them over the data channel instead.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-25T22:02:27Z
- **Tasks:** 2 (1 TDD)
- **Files modified:** 3 code/doc (+ regenerated graph artifacts)

## Accomplishments

- **The other half of SC1.** A doc-scoped mint's `instructions` is the `document-analyst` skill
  body, a blank line, then `buildDocDigest(...)` — so the agent can open with something specific
  about the report in its first second, which is the flagship moment. The persona is selected from
  the registry per branch (`DOCUMENT_ANALYST_SKILL` vs `VOICE_SESSION_SKILL`), both fail closed via
  `getActiveSkill`'s `NO_ACTIVE_SKILL`, and **no request leaves Convex when the registry cannot
  answer** (asserted: `calls.length === 0`). §5 held — there is no hardcoded fallback prompt and no
  behavioural line added at the mint.
- **The mint is a real trust boundary, and the FIRST one.** The browser mints *before* it has a
  session row (`useVoiceSession.ts:269` → handshake → `startSession`), so leaning on 14-03's
  `startSession` validation was not an option. A missing or cross-tenant document reads as
  `voicedoc: document not found`; a non-`ready` one as `voicedoc: document not ready` — the same
  message vocabulary as `startSession`, a STATUS and never content, refused before any request
  leaves Convex.
- **Exactly one tool, and it is read-only — the tool-SET containment.** `tools: [SEARCH_DOCUMENT_TOOL]`
  + `tool_choice: "auto"`, keyed through `SESSION_TOOL_KEYS`. The test asserts length **1**, the
  name, a top-level `parameters` key and the **absence** of a `function` key (the flat Realtime
  shape, not the Chat-Completions nesting that 400s the mint). Nothing writable is reachable from a
  voice session, so an instruction planted in the report has nothing to actuate.
- **Open Question 3 — settled by shipping both branches, not by guessing.** Mint-time first
  (server-owned, races nothing), then on a **400** — and only 400 — an automatic re-POST of the
  identical body minus the tool keys, returning `toolsAtMint: false`. A 500 still throws on the
  first attempt and does **not** re-POST (asserted). The `LIVE-VERIFIED ____-__-__:` line in
  `packages/voice/src/realtime.ts` is deliberately still blank: 14-09's live verify fills it in with
  the branch the API actually accepted, with a date, as Phase 6 did.
- **The Phase-6 path is pinned byte-unchanged.** An unscoped mint's body has `instructions ===
  voiceSessionSkillBody` exactly (so no digest sneaks in) and **no `tools` / `tool_choice` keys at
  all** — absent, not empty. A doc feature cannot quietly reshape every ordinary voice call.
- **The instruction budget is now a test, not a comment.** `instructions.length <
  personaBody.length + DIGEST_CHAR_CAP + 500` — `gpt-realtime-2.1` is a 32k window whose
  `instructions` are re-billed as input every turn, so a future digest change cannot silently blow
  past it.
- **Nothing leaks.** The returned key set is asserted **exactly** `{clientSecret, expiresAt,
  toolsAtMint}` and the serialized result is searched for the fake key. `toolsAtMint` is documented
  in code as transport control — not a secret, not document content. This path writes no audit row.

## Task Commits

1. **Task 1: the doc-scoped mint** — `cce300b` (feat)
2. **Task 2: the test matrix + playbook** — `529c574` (test)

## Files Created/Modified

- `packages/backend/convex/voiceToken.ts` — `mintClientSecret` gains `args: {docId?}`, an explicit
  three-field return type, registry persona selection, the digest append, the `sessionBody(withTools)`
  closure, the 400 shape-fallback, and the prompt-injection-ceiling `ponytail:` block. New
  module-local `docForMint` internalQuery.
- `packages/backend/convex/voiceToken.test.ts` — 5 → **12** tests. `stubFetch` now records **every**
  call (the fallback POSTs twice), plus `sessionOf(i)` and a `seedDoc` helper.
- `docs/playbooks/voice.md` — a `### The doc-grounded mint (14-04)` section (persona branch, digest
  + why not `vault.getDoc`, the budget, the tool-set containment, both Open-Question-3 branches and
  the still-unverified line, and what never leaves), `Last verified` bumped to 2026-07-26.

## Decisions Made

### `docForMint` instead of `internal.vault.getDoc` (the plan's stated interface, again)

The plan's Task 1 step 2 specifies `internal.vault.getDoc({vaultDocId, tenantId})` and then asks for
a `status !== "ready"` refusal and a `doc.extractionTruncated` truncation flag. `getDoc` returns
`{text, contentHash, title}` — **neither field exists on it**, and it *throws* on cross-tenant rather
than returning null. `getDocForExtraction` carries `status` but no `text`; two round-trips still miss
`extractionTruncated`. This is the same wrong premise 14-03 recorded as its Deviation 1.

`mintClientSecret` is a `tenantAction` with no `ctx.db`, so a query is unavoidable. The read was
added as a **module-local `docForMint`** rather than by widening `internal.vault.getDoc`: widening a
shared Phase-10 query touches `vault.ts` (outside this plan's `files_modified`, outside Wave 4's
ownership row in `14-VALIDATION.md`, and watched by `vault.md`) for two fields only this caller
wants. `docForMint` returns `null` for missing/cross-tenant so the **mint** owns the thrown message
and both trust boundaries speak with one voice.

### `toolsAtMint` is `true` when there is nothing to declare

An unscoped session declares no tool, so there is nothing for the browser to re-declare. Making the
flag `false` there would be "more literal" and would force 14-06 to write
`if (!toolsAtMint && docId)`. One `if (!toolsAtMint)` is the contract.

### The test file moved to `api.*` (root-cause fix, CLAUDE.md §8)

`mintClientSecret` is a **public** `tenantAction`, so it lives under `api`, not `internal` — the
existing `internal.voiceToken.mintClientSecret` references were 3 of the documented 52 pre-existing
`tsc` errors, and my 9 new call sites would have made them 17. Renaming to `api.*` fixed the class:
`voiceToken.test.ts` now contributes **zero** tsc errors and the backend baseline dropped **52 → 49**.
This is *not* the stale-`api.d.ts` problem 14-03 documented — that one is real and separate.

## Deviations from Plan

### 1. [Rule 1 — the plan's stated interface was wrong] the document read is `docForMint`, not `internal.vault.getDoc`

- **Found during:** Task 1, before writing the validation block.
- **Issue / Fix / Impact:** see "Decisions Made" above. The `key_links` row
  `voiceToken.ts → internal.skills.getActiveSkill` **is** satisfied; the plan carries no `key_link`
  for the vault read, so nothing in `must_haves` is missed by this.
- **Commit:** `cce300b`

### 2. [Rule 1 — bug, pre-existing] `voiceToken.test.ts` referenced `internal.voiceToken.mintClientSecret`

- **Found during:** Task 2, at `tsc --noEmit` (66 errors vs. the 52 baseline — 14 of them my new
  call sites multiplying an existing mistake).
- **Fix:** `api.voiceToken.mintClientSecret` throughout (`hangupCall` stays `internal`, correctly).
  Runtime behavior is unchanged — `convex-test` resolves by path either way — but the type is now
  honest. **52 → 49 backend tsc errors, 0 non-test.**
- **Commit:** `529c574`

### 3. [Rule 1 — mine] the Phase-6 exact-key assertion had to widen by one

`mintClientSecret returns ONLY {clientSecret, expiresAt}` went red the moment Task 1 landed — which
is exactly what that assertion is for. It was widened to the three-key set **and kept exact** (plus
a new `toolsAtMint === true` pin), so a fourth field still cannot creep in. Landed in Task 1's commit
because it is the contract change Task 1 makes, not a test-matrix addition.

## Issues Encountered

- **The known parallel-load flake fired once.** One full `pnpm test` run reported `Failed Tests 2`;
  the re-run showed the single documented `audit.test.ts` `auditCounts` red. Same class 14-01/14-02/
  14-03 each recorded. Not a regression.
- **Mutation-verified the trickiest branch.** Temporarily changing `res.status === 400` to `=== 499`
  turned the fallback test RED (`1 failed | 11 passed`); reverted, `git diff --stat` clean. The
  fallback assertion is not theatre.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/backend test voiceToken` | **12/12** green (was 5; +7 new) |
| Backend full suite | **515/516** — baseline held (was 508/509, **+7 new green**); sole red the documented pre-existing `audit.test.ts` `auditCounts` row |
| Other packages | contracts / vault / extraction / core / pii / voice / cost all green (turbo cache hit — untouched by this plan) |
| `pnpm --filter @pikar/backend exec tsc --noEmit` | **49** errors, all pre-existing test-file ones; **0** non-test. **Below** the 52 baseline (Deviation 2) — `voiceToken.test.ts` now contributes zero |
| `pnpm --filter @pikar/web typecheck` | exit 0 — `mint({})` still typechecks against the optional arg, and the extra return field is ignored by the destructure |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `npx biome check` on both changed source files | clean (6 warnings, all pre-existing non-null assertions in untouched Phase-6 test lines) |
| Mutation check: `400` → `499` | fallback test goes **RED**, reverts clean |
| Frozen files this plan | `llm.ts`, `evaluations.ts`, `deliverApprovedPlan.ts`, `schema.ts`, `vaultGround.ts`, `vault.ts`, `realtime.ts`, `run-eval-golden.mjs` — **zero diff** |
| Diff scope | exactly the 3 files in the plan's `files_modified`, nothing else |

**14-VALIDATION rows now green:** SC1 "Mint body carries the doc digest + tool array + registry
persona" (14-04), §5 "Persona loads from the registry and fails closed unseeded" (14-04). The
SC1 row's wording *"still returns only `{clientSecret,expiresAt}`"* is superseded by the plan's own
`toolsAtMint` extension — the key set is still asserted **exactly**, and the new field carries no
secret and no document content.

## User Setup Required

None.

## Next Phase Readiness

- **14-06 (browser relay):** `mint({ docId })` now returns `toolsAtMint`. Branch on it with a single
  `if (!toolsAtMint)` → send `{type:"session.update", session:{tools:[SEARCH_DOCUMENT_TOOL],
  tool_choice:TOOL_CHOICE_AUTO}}` once the data channel opens. Do **not** send it when the flag is
  true — declaring twice is a second shape this repo has not verified. The mint refuses a bad
  `docId` with `voicedoc: document not found` / `not ready` **before** the mic is touched, so the
  pre-flight error surface is the same two strings `startSession` throws.
- **14-07 (picker):** pass the vault doc id straight through as `docId`; the mint validates it
  itself, so the picker's ready-only filter stays UX, not safety.
- **14-09 (live verify):** the ONE thing this plan deliberately did not answer is which branch the
  API accepts. Run a real doc-scoped call, then **fill in
  `packages/voice/src/realtime.ts`'s `LIVE-VERIFIED ____-__-__: <mint-time | session.update>` line
  with a date**. If mint-time is accepted, the fallback stays as dead-but-cheap insurance; if it
  400s, `toolsAtMint` is already doing its job and the note should say so.
- **14-09 (static scan):** `voiceToken.ts` writes **no** log-plane row at all (`grep -c "audit.log"`
  = 0) and has no `payload:` block — that is the cleanest possible result for the SC4 scan, and it
  should stay that way. The digest, the persona body and the client secret exist only inside the
  outgoing request body and the return value.

## Self-Check: PASSED

All 3 modified files exist on disk. Both task commits (`cce300b`, `529c574`) resolve in `git log`.
`must_haves` artifacts verified: `voiceToken.ts` contains `toolsAtMint` (8 hits) and provides
`mintClientSecret({docId?})` with the tool declaration and the fallback; `voiceToken.test.ts` covers
persona, digest, flat tool shape, the 400 fallback and fail-closed (12 tests). `key_links` patterns
present: `DOCUMENT_ANALYST_SKILL` in `voiceToken.ts`, `SEARCH_DOCUMENT_TOOL` imported from
`@pikar/voice` in `voiceToken.ts`.

---
*Phase: 14-flagship-voice-doc-workflow*
*Completed: 2026-07-26*
</content>
</invoke>
