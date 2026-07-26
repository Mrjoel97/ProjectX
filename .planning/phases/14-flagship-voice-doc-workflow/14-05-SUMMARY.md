---
phase: 14-flagship-voice-doc-workflow
plan: 05
subsystem: voice-doc
tags: [wave-5, convex-adapter, findings-producer, welded-citations, honesty-verdict, smoke-seam, security-fix, lane-c]
requires:
  - phase: 14-01
    provides: "evaluations.framework widened with `document-review`, evaluations.findings[].citationExcerpt, the document-analyst persona row (UNGATED), and the inert voiceDoc.ts stub"
  - phase: 14-02
    provides: "shapeDocReview (welds citations/route/playbook/rank, applies the honesty verdict), composeDocMemo, DOC_REVIEW_* literals, EXCERPT_CHAR_CAP, voiceDocThreadId"
  - phase: 14-03
    provides: "voiceDoc.ts with searchDocument + docScopedPassages, the refs-only audit idiom, and the seedSession test helper"
  - phase: 14-04
    provides: "voiceToken.docForMint — the {title,text,status,extractionTruncated} tenant-scoped read reused here instead of internal.vault.getDoc"
provides:
  - "voiceDoc.reviewSession({sessionId, transcript}) -> {threadId, findingCount, gapCount, verdict} — the tenant-scoped, idempotent client entry"
  - "voiceDoc.reviewDocument — the vaultLlm-shaped V8 producer writing through the unmodified insertEvaluation"
  - "offlineSeamAvailable() — the keyless-backend gate that makes the SMOKE sentinel inert in production"
  - "SC2 coverage: welded citations, honest healthy, no fabricated gap, absent-excerpt path, BETA-05 cross-tenant refusal"
affects:
  - "14-08 (post-call screen renders this row through CardList; memo-vs-plan branches on verdict/gapCount)"
  - "14-09 (static scans pin the voicedoc.reviewed payload and the docReviewSchema excerpt presence)"
tech-stack:
  added: []
  patterns:
    - "welded-in-code citations: the model emits labels only; citationDocId/citationTitle/route/playbook/rank never cross the model boundary"
    - "one declared exception, substring-verified: `excerpt` is model-authored, then checked whitespace-normalized against doc.text — on failure DROP THE EXCERPT, not the finding"
    - "anti-vacuous honesty: verdict + findingsPresent + gapCount asserted together, at both the return value and the persisted row"
    - "exposure-gated test seam: a content sentinel is only honoured on a keyless backend, so the offline harness keeps working while production cannot reach it"
key-files:
  created: []
  modified:
    - packages/backend/convex/voiceDoc.ts
    - packages/backend/convex/voiceDoc.test.ts
    - docs/playbooks/voice.md
key-decisions:
  - "the producer reads the document through voiceToken.docForMint (14-04), NOT internal.vault.getDoc — that query returns {text, contentHash, title} with no `extractionTruncated` and THROWS on cross-tenant instead of reading as missing. This is the THIRD plan in a row to hit the same false research premise (14-03 at startSession, 14-04 at the mint, 14-05 here); reusing 14-04's query avoided adding a third copy or widening the Phase-10 shared query"
  - "SMOKE sentinel gated on OPENAI_API_KEY being ABSENT rather than on an env flag or deployment config — preserves the original per-request design goal while closing the exposure, and needs no test rewritten"
  - "the honest-no-gaps assertion pins all THREE parts (verdict === healthy, findings.length > 0, gaps.length === 0) because gapCount === 0 alone also passes on the thin-data `insufficient` verdict — the Phase-12 28-healthy-no-gaps lesson"
---

# Plan 14-05 Summary — the findings producer

**Wave:** 5 · **Tasks:** 3/3 · **Commits:** 5

Turns a finished voice-doc discussion into a persisted, cited `evaluations` row. Because the row
lands in the existing table, everything downstream — per-finding citations, the affirmative healthy
banner, leverage-ranked gaps, "Act on this" → proposed plan → the single Approve gate — is inherited
rather than rebuilt. `evaluations.ts` was never edited; the schema-derived validator widened by
14-01 carried the new framework literal on its own.

## Commits

| Commit | Task | What |
|--------|------|------|
| `cc78314` | 1 | `reviewDocument` — the `vaultLlm.ts`-shaped V8 producer with the SMOKE seam |
| `01c245d` | 2 | `reviewSession` — the tenant-scoped, idempotent client entry with the refs-only audit |
| `5678f22` | — | **security fix**: gate the SMOKE seam on a keyless backend (see Deviations) |
| `a49660f` | 3 | `voice.md` — the producer contract and the seam exposure note |
| `60fd934` | — | knowledge-graph refresh |

Task 3's SC2 coverage landed inside `5678f22` alongside the guard, because both edit
`voiceDoc.test.ts` and the guard's own test is part of that coverage.

## Gates

| Gate | Result |
|------|--------|
| `test voiceDoc` | **19/19** (was 9) |
| backend full suite | **524/526** — baseline held |
| backend `tsc --noEmit` | **49** errors, **+0 new**, **0 non-test** |
| web `typecheck` | exit 0 |
| `check-playbooks.mjs` | exit 0 |
| frozen files (`evaluations.ts`, `llm.ts`, `deliverApprovedPlan.ts`, `run-eval-golden.mjs`) | zero diff |

Both full-suite reds were verified, not assumed:
- `audit.test.ts > audit.log inserts exactly one row that round-trips` — `Component "auditCounts"
  is not registered`. Fails isolated too; the file is **untouched** by Phase 14
  (`git log 104e41a..HEAD -- convex/audit.test.ts` is empty). The documented pre-existing red.
- `runCockpitAgent.test.ts > mock loop` — passes **18/18 isolated**. The known parallel-load flake,
  now seen in 14-01, 14-02, 14-03 and here.

## Deviations

### 1. SMOKE seam was reachable from untrusted input — fixed (`5678f22`)

A background security review flagged `test-seam-exposed-to-untrusted-input`, and it was correct.
`reviewSession` is a public `tenantAction` whose `transcript` is entirely client-supplied, and
`reviewDocument` branched on `transcript[0].text.startsWith("SMOKE::docreview::")`. Any
authenticated tenant user could POST a crafted first turn and persist a **fabricated review** —
canned gaps, real citations to their own document, no model call — which then feeds
`actOnGap` → memo → the Approve gate.

The seam was written as "the `vaultLlm.ts` idiom", and the shape matches. **The exposure does not:**
`vaultLlm.extractGraph` is an `internalAction`, so its `SMOKE::graph::` sentinel is only reachable
by server code. Moving the same pattern onto a public action silently dropped the precondition that
made it safe. Idioms carry invisible preconditions; this one didn't travel.

Impact was bounded — tenant-scoped, no cross-tenant reach, no exfiltration, and the fixture content
is fixed rather than attacker-authored. It was still worth fixing immediately for a non-security
reason: **it contradicted the criterion this plan exists to satisfy.** SC #2 says the agent reports
gaps honestly rather than fabricating one; shipping it alongside a production gap-forgery primitive
would have made the criterion untrue in the only environment that matters.

Fix: `offlineSeamAvailable()` honours the sentinel only when `OPENAI_API_KEY` is absent. Production
always has a key, so the sentinel is inert; the offline suite has none, so all 12 SMOKE call sites
keep working with **no test weakened** and **no new deployment config** — preserving the original
"per-request sentinel, not shared config" design goal. Pinned by a mutation-verified test
(`voiceDoc.test.ts:613`): with a key present, a `SMOKE::` transcript no longer short-circuits.

### 2. `internal.vault.getDoc` was the wrong interface — for the third consecutive plan

The plan again specified `internal.vault.getDoc`. It returns `{text, contentHash, title}` — no
`extractionTruncated`, and it **throws** on cross-tenant instead of reading as missing, which turns
a fail-closed check into an oracle. Reused 14-04's `voiceToken.docForMint` rather than adding a
third copy or widening the Phase-10 shared query (`vault.ts` is watched by a different playbook and
outside this plan's ownership row).

**For Phase 15's planner:** this premise originates in `14-RESEARCH.md` and has now cost three
plans. Research errors replicate wherever the planner trusted them — the same thing happened with
the `evaluations.ts` "zero edits" claim in 14-01.

## Notes for later waves

- `reviewSession` is idempotent on the thread: an existing row is returned as-is rather than
  patched, so a post-call remount (refresh, resumed dropped call) shows ONE consolidated list.
  14-08 can mount it freely.
- The absent-excerpt path is covered (`findings[2]` asserted to **not** have a `citationExcerpt`),
  so 14-08's renderer must handle the missing key as a normal state, not an error.
- `DOCV-01` deliberately left **Pending** — it spans all 9 Phase-14 plans.
