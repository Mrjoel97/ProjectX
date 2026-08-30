# Plan 29-06 — FIX round summary

**Commit:** `7f1fbd6` — `fix(29-06): the caller became the attacker, and three claims stopped being true`
**Branch:** `feat/29-unified-knowledge` (worktree `C:/Users/expert/AppData/Local/Temp/pikar29`)
**Baseline at start:** HEAD `fb5e92c`, tree clean for my paths (the orchestrator had already
reverted the executor's live `rawQuestion: question` mutation). I inherited NOTHING uncommitted on
my own files — the three interrupted agents' work had all been committed by the time I started, so
the "draft by a stranger" protocol did not apply to me. I neither read nor staged any sibling file.

## What changed, per finding

### [BLOCKER] `rawQuestion` on the audit payload — closed by an ALLOWLIST, not another blocklist

The line itself was already gone. The ask was a test that stops the next stray mutation surviving
a green suite. The five-needle test could not do that (it plants needles only in INPUT fields), and
neither could `llmRedaction.test.ts`'s word blocklist — verified: adding `unansweredList`
(synthesizer prose written over untrusted mail bodies) to the payload passed the entire backend
suite before this change.

`knowledgeSearch.test.ts` now asserts `Object.keys(payload).sort()` of the **stored** audit row
against a literal 22-key set, for both knowledge events. Any new key on the governance plane —
whatever it is called, whoever wrote its value — is now RED.

*Mutations observed RED:* `rawQuestion: question` (3 tests); `unansweredList: [...unanswered]`
(2 tests).

### [MAJOR] The SMOKE fixture seam was tenant-reachable

Both gates in `knowledgeLlm.ts` are now `offlineSeamAvailable() && question.includes(SMOKE_*)`.
`offlineSeamAvailable()` is FIX-W2's shared predicate in `lib/models.ts` (`PIKAR_OFFLINE_FIXTURES
=== "1"` AND no model credential) — reused, not re-derived; there is still exactly one such
predicate in the repo.

The false docstring at `knowledgeLlm.ts:88-97` ("the `question` is the caller's own argument, so
keying on it puts the seam back under the operator") is **deleted and replaced** with a two-conjunct
explanation naming which door each half closes.

Proof is behavioural and paired, on the SAME question string:
- OPERATOR OFF (a model credential present): the sentinel takes the LIVE path — one model call, the
  mocked model's summary and claim text, and neither of the fixture's two signatures.
- OPERATOR ON (`PIKAR_OFFLINE_FIXTURES=1`, no credential): zero model calls, the fixture's output.

The source scan at `knowledgeLlm.test.ts` now requires `offlineSeamAvailable() &&` inside the
80-char window before the sentinel, in both handlers.

*Mutations observed RED:* drop `offlineSeamAvailable() &&` from the synthesizer seam (2 tests: the
scan and the OPERATOR-OFF behavioural test); the same from the planner seam (1 test).

**Honest limit:** the behavioural pair drives `internal.knowledgeLlm.synthesizeKnowledge` directly,
not through the public `knowledgeSearch.search` action. I did not add an end-to-end probe through
`search`, because `knowledgeSearch.test.ts` stubs `OPENROUTER_API_KEY` for every test (so
`offlineSeamAvailable()` is false there by construction) and un-stubbing it to reach the fixture
would also send the PLANNER down its keyless failure path, measuring a different run. The gate is
one expression shared by both callers and the scan pins it in the shipped source; the direct test is
the strongest assertion available at $0.

### [MAJOR] The unbounded `question`

`QUESTION_CHAR_CAP = 2_000` in `knowledgeSearch.ts`, checked as the first act of the handler —
before the hash, before the planner, before any spend — and refused as
`{ ok: false, reason: "question_too_long" }`. **Refused, not truncated:** truncating would answer a
question the user did not ask and store it as if they had. The reason joins the existing negative
arm rather than minting a second negative shape.

The cap lives in the backend module, not `SEARCH_CAPS`, for `SUMMARY_CHAR_CAP`'s stated reason
(`@pikar/core`'s cap set is covered by a "NO CAP IS DEAD" scan requiring an enforcement site in that
package, and a question never crosses a pure function).

The test pins **2000 / 2001 as literals** and does not import the constant.

*Mutations observed RED:* delete the guard (1 test); `>` → `>=` (1 test).

### [MAJOR] `searchedGapCount` could not discriminate the case it exists for

Fixed the **computation**, and tightened the documented meaning to something the code can actually
tell apart: *zero ⟺ at least one source was searched AND every searched source answered in full.*
A run whose plan is empty (planner named only not-landed or rejected sources) now reports
`states.length` — every source is a gap, because none was searched.

New test drives `planSearches({source: "support-desk", ...})`: five unavailable sources, zero
evidence, only the planner called, `searchedGapCount === 5` (a literal), explicitly `not.toBe(0)`.
The existing ALL-EMPTY test (0) and ALL-UNAVAILABLE test (3) are unchanged, so the three states are
now observably distinct.

*Mutation observed RED:* drop the `attempted.size === 0 ? states.length :` arm (1 test).

### [MAJOR/MINOR] The `AdapterRef` comment asserted a contract that is two-thirds real

I did **not** make the type bind both directions — I took the finding's second option and stated
exactly which half holds, then closed the other half with a test rather than leaving it as prose.
The comment now says: return type and a RENAMED argument break the build at the registry; a newly
ADDED required argument does not and reaches runtime as `provider_error` on every search.

`knowledgeSearch.test.ts` scans the four adapters' `args:` blocks and asserts the key set is exactly
`{tenantId, query}`, with a vacuous-scan control and a check that the scanned list covers every
non-null registry entry.

*Mutation observed RED:* `extraRequired: v.string()` added to `searchVaultKnowledge` (1 test).
(Confirming the finding: `pnpm typecheck` stays silent at the registry for that mutation — which is
the whole point of the scan.)

### [MINOR] A governed stop between fan-out and synthesis left no governance record

`knowledge.search_stopped` — a new audit event, refs and counts only: `questionHash`, a code-owned
`stoppedAt` stage token, `stopReason` (`guardrails.preCall`'s closed enum, never provider prose),
`evidenceCount` plus the three coverage counts (which is what says the connectors were reached),
`adapterCrashCount`, `rejectedPlanCount`, `plannerFallback`, `planRunRef`, `plannerSkillVersion`,
`durationMs`. Still **no** content row: there is no answer to store. Registered in
`AUDIT_VIEWER_EVENTS`; its payload key set is pinned by the same allowlist test.

`aggregateCoverage(states)` moved above the synthesis branch so the stop row carries the same read
counts the completed row would have. It depends only on `states`.

The branch is driven at $0 by flipping the kill switch from the mocked model boundary **after** the
planner call and **before** the fan-out — a real production ordering, not a stubbed one.

*Mutation observed RED:* restore the bare `if (!synthesized.ok) return {...}` (2 tests).

### [MINOR] `auditProjection.ts` hand-lists keys that are mechanically derivable

I did **not** derive them in the source. `@pikar/contracts` does not depend on `@pikar/core` (only
`zod`), so importing `redactedSearchEvent` there would invert the package dependency for a comment's
worth of DRY. Instead the drift is pinned by a test in `packages/backend`, which sees both packages:
the allowlist row must equal the stored payload's key set exactly, and every one of
`redactedSearchEvent`'s 14 output keys must be present (14 asserted as a literal).

*Mutation observed RED:* delete `"adapterCrashCount"` from `AUDIT_VIEWER_EVENTS` (1 test). Before
this change that mutation left contracts (99) and backend (110 in the relevant files) fully green.

### [MINOR] The `llmRedaction.test.ts` blocklist

**Not converted to an allowlist in that file — deliberately, and the ceiling is now written into the
test.** A source-text scan cannot enumerate a payload's runtime keys; the allowlist that actually
closes the gap is behavioural and lives in `knowledgeSearch.test.ts`. The blocklist is kept as the
cheap tripwire in front of it, and the test now says so in prose. The same test was updated to
expect **two** `audit.log` sites and to scan both payloads.

### [MINOR] Comments describing unwired code

- `packages/core/src/knowledgeSearch.ts`: `renderSourceGap` and `groundedSourceProps` both now carry
  a "⚠ NOT WIRED YET — zero callers repo-wide as of 29-06; 29-09's panel is the caller" note.
- `packages/backend/convex/knowledgeSearch.ts:384`: the coordinator's comment no longer reads as
  live wiring.
- `packages/backend/convex/llm.ts`: the "only the three USER_AUTHORABLE_SKILLS can have an overlay
  row at all, so every other specialist name resolves exactly as before" invariant is corrected —
  after 29-05 a `pack-*` name can, and the comment now says why that is intended and where the
  authoritative membership lives. Comment-only; no behaviour and no cockpit test changed.

## Gates

Corrected forms used throughout (`cd packages/<pkg> && pnpm vitest run <filter>`; the playbook hook
via `echo '{}' | node scripts/check-playbooks.mjs check`, reading STDOUT).

| Gate | Result |
| --- | --- |
| `packages/backend` full suite | 112 files / **3119 passed, 2 failed** |
| `packages/backend` typecheck | clean |
| `packages/core` full suite | 45 files / **1457 passed** |
| `packages/core` typecheck | clean |
| `packages/contracts` full suite | 6 files / **99 passed** |
| `packages/contracts` typecheck | clean |
| `biome check` on my files | clean (5 pre-existing warnings) |
| playbook §9 hook (dirty tree) | empty STDOUT — passed |

The two backend failures are both on the known-red list and neither is mine:
- `convex/env.test.ts` — `QUICKBOOKS_CLIENT_ID/_CLIENT_SECRET/_REDIRECT_URI` unclassified in
  `ENV_MANIFEST`. Phase 28's in-flight 28-06. Confirmed by reading the assertion output.
- `convex/vaultDigest.test.ts` — one failure in the full run, **17/17 passing when run alone**. The
  documented load flake, and the file belongs to FIX-W2 (`git log -1` → `e42a3d3 fix(29)`).

Relevant-file totals after my change: `knowledgeSearch.test.ts` 26 → 31, `knowledgeLlm.test.ts`
48 → 50, `llmRedaction.test.ts` 67, `reportsGovernance.test.ts` unchanged.

## Playbooks (CLAUDE.md §9)

- `docs/playbooks/knowledge-search-routines.md` — new "Last verified" block, Invariants 41 and 43
  rewritten to match the code, the `AdapterRef` paragraph corrected, and a new remediation section
  (Invariants 46–48, the corrected claims, and what was deliberately not closed).
- `docs/playbooks/audit-dead-letter.md` — the new event and the first key-allowlist test in that
  table. Required by the hook (`auditProjection.ts` is under its watched paths).
- `docs/playbooks/cockpit.md` — bumped for the comment-only `llm.ts` change. Required by the hook.

## What I did NOT close

1. **The end-to-end seam probe through the public `search` action** — reasoned above. The gate is
   one shared expression, pinned by a source scan and by a direct behavioural pair.
2. **`llmRedaction.test.ts` remains a blocklist.** By design; the ceiling is stated in the test.
3. **The other ~90 rows in `AUDIT_VIEWER_EVENTS` remain hand-listed.** Only `knowledge.*` has an
   exported pure projection to derive from; a general fix is a write-site change, not a wider table.
4. **`renderSourceGap` / `groundedSourceProps` are still unwired.** They are 29-01's, awaiting
   29-09's panel. I corrected the prose rather than inventing a caller (ponytail rung 1).
5. **`dedupeEvidence`'s conflict arm is still unreachable from the landed adapters** — a wave-2
   stated limit I did not touch.
6. **`QUESTION_CHAR_CAP` is not enforced on the stored row's schema** (`knowledgeSearches.question`
   is still a bare `v.string()`). The action is the only writer and it refuses first; a schema-level
   bound would be a second copy of the number. Named here so a future direct-insert path knows.
7. **No live-deployment verification.** No `convex dev`, no `convex run`, no model call, $0 spent.

## Files I touched outside my stated ownership

`packages/backend/convex/knowledgeLlm.ts` and `knowledgeLlm.test.ts` — not in my list, but not in
FIX-05's or FIX-W2's either, and the seam fix and its docstring were explicitly assigned to me.
`docs/playbooks/audit-dead-letter.md` and `docs/playbooks/cockpit.md` — forced by the §9 hook because
I changed `auditProjection.ts` and `llm.ts`. Both were clean in the working tree when I edited them.
I read `lib/models.ts` (FIX-W2's) to reuse `offlineSeamAvailable`; I did not modify or stage it.
