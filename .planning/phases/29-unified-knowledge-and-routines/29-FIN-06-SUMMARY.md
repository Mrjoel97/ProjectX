# 29-FIN-06 — Summary

**Commit:** `2e24dda` · **Branch:** `feat/29-unified-knowledge` · 14 files, +360 / −72.

**Inherited vs written:** nothing was inherited. The three killed agents' work had already been
committed by the time this pass started (`4902e2c`, and the siblings landed `58c1e34`, `290647b`,
`2fc1a8a` mid-run). Every line below was written in this pass.

---

## What was DELETED (no replacement absolute)

| Claim | Where | Why it went |
|---|---|---|
| `⚠ WHICH NAMES CAN HAVE AN OVERLAY ROW … Phase 29 widened USER_AUTHORABLE_SKILLS to admit the six pack-* skills` | `llm.ts:4975-4984` | **FALSE.** `packages/contracts/src/skill.ts:370-374` still lists exactly `OFFER_ARCHITECT`, `MONEY_MODEL_DESIGNER`, `LEAD_ENGINE`; 29-05 added a SEPARATE channel, `skills.publishPackCustomization:1570`. Replaced with what `loadEffectiveSkill` **queries** (`tenantSkills` by `[tenantId, name, status:"active"]`, falling through to global) and a pointer to the publish channels. No closed set of names is asserted at that line any more. |
| The same false sentence, twice more | `cockpit.md:39-50`, `cockpit.md:~2191`, `knowledge-search-routines.md` "Corrected claims" | Same. It mattered because it reads as justification for removing a sibling's fail-closed gate. |
| `── THE ONE GOVERNANCE-PLANE WRITE (§4)` | `knowledgeSearch.ts:~557` | There are two `audit.log` sites. Now: "THE COMPLETED-RUN GOVERNANCE-PLANE WRITE", stating the branch-above-returns mechanism and citing the test that counts rows per type. The `:485` comment's wrong ordinal ("the second … the only one on this branch") went with it. |
| `THE ONLY UNCAPPED FREE TEXT ON THIS PLANE UNTIL NOW` + `Every other free-text trust boundary in this repo is bounded` | `knowledgeSearch.ts` `QUESTION_CHAR_CAP` docstring | A repo-wide absolute, and false about the argument sitting beside it. |
| `Zero callers repo-wide … covered by its own unit tests and nothing else` | `core/src/knowledgeSearch.ts:1089` (`renderSourceGap`) | `workflowPacks.test.ts:216-222` imports and calls it. Now says "not wired yet; unit tests exercise it", naming both. |
| `zero callers repo-wide` | `core/src/knowledgeSearch.ts:1127` (`groundedSourceProps`) | Same class. Softened to "unit tests are what exercise it" — no count, no "only". |
| `Only the tests in "THE PROMPT THE HANDLER ACTUALLY SENDS" reach it` | `knowledgeLlm.test.ts:61-64` | A second describe (`untrusted evidence cannot select a code path`, `:891`) stubs the key and reaches the mocked boundary. Rewritten as the mechanism: reaching it needs a stubbed `OPENROUTER_API_KEY`, stubbed per-describe. |
| `knowledgeSearch.ts:118` line citation | `knowledge-search-routines.md:890` | Already drifted (`:118` is a comment line now). Replaced by the symbol name, not a new number. |
| `NOTHING CALLS knowledgeLlm YET` | `knowledge-search-routines.md` known-gaps | Closed by 29-06. |
| `listByThread`'s length guard (**code**, not prose) | `knowledgeSearch.ts` | See "the guard that guarded nothing" below. |

I checked the five other `*.ts:<line>` citations in my playbook (`evaluations.ts:1150`,
`voice.ts:349`, `onboarding.ts:492`, `dispatch.ts:234`, `blueprint.ts:271`) against HEAD — all five
still point at what they claim.

## What was MADE TRUE (behaviour + a test that goes red)

### 1. `vaultGround.ts`'s `SMOKE::` seam is gated on the operator (Item 3)

`if (offlineSeamAvailable() && query.startsWith(SMOKE_PREFIX))`. Same predicate as
`knowledgeLlm.ts` / `vaultDigest.ts` / `voiceDoc.ts` — no fourth variant. It was the last
tenant-supplied string on the knowledge plane that could select a fabrication path: `vaultGround` is
a `tenantAction`, and every `vaultGroundHydrated` caller (cockpit `searchVault` tool at
`llm.ts:3807`, `blueprint.ts:547`, `evaluations.ts:295`, `voiceDoc.ts:75`,
`knowledgeVaultDrive.ts:82`) passes user text as `query`.

**The cost is the finding.** Closing it broke 10 test files / 57 tests on the first attempt. Two
distinct causes, both fixed at the cause:

- **~14 files drive this seam and none set the operator flag.** The consent now lives once, in
  `packages/backend/vitest.config.mts` (`env: { PIKAR_OFFLINE_FIXTURES: "1" }`), rather than in
  every `beforeEach`. A test that needs the consent ABSENT stubs it off — which is exactly what the
  new `vaultGround.test.ts` gate test does, and what `knowledgeLlm.test.ts` / `lib/models.test.ts`
  already did.
- **Two files planted a FAKE MODEL CREDENTIAL**, which is a claim about the deployment and makes
  `offlineSeamAvailable()` false. `knowledgeSearch.test.ts` stubbed `OPENROUTER_API_KEY` only to get
  past `resolveModel` before the mocked `generateObject`; it now mocks the model ROUTE instead
  (`vi.mock("./lib/models", … resolveModel)`) and is honestly a no-credential deployment.
  `onboarding.test.ts` had `process.env.OPENAI_API_KEY = FAKE_KEY` — a raw assignment with **no
  cleanup**, leaking into every later file in the same worker — and nothing needed it (32/32
  without). Deleted.

Debt register: entry #5 (`vaultGround.ts:48`) marked **CLOSED** with the coupling written down; the
severity paragraph and the channel table corrected; entry #6 (`knowledgeLlm`) corrected too — it was
still listed as open with "no production caller", and it is gated and `knowledgeSearch.search` IS
its production caller.

### 2. `threadId` is capped and refused as DATA (Item 2b)

`THREAD_ID_CHAR_CAP = 200`, checked in `search` on the line after the question cap, before the hash
and before any spend; refusal `{ ok: false, reason: "thread_id_invalid" }`. Empty is refused as
well — that is the absence of a thread, and admitting it files every such search into one unnamed
bucket. 200 rather than 2000 because this is an opaque handle (a UUID is 36, a Convex id 32), not
prose. The test pins **200 as a literal**.

**The guard that guarded nothing, and is therefore gone.** I first added the same check to
`listByThread`. Mutating it away (`threadIdOk(threadId) ? … : []` → `true ? …`) left the test
**GREEN** — an id `search` refuses can name no stored row, so the index read returns `[]` either
way. Deleted the guard, deleted the two vacuous assertions, and said so in the code, the test and
the playbook.

### 3. The fence nonce cannot be eaten by the PII scanner (Item 5)

The flaky test was not a bad test. `scanText` runs over the **assembled** prompt; its card detector
is `\d(?:[ -]?\d){12,18}` + Luhn, and a `crypto.randomUUID()` reaches 13+ digits by spanning its own
dashes. Measured over 2,000,000 ids: **2.18% reach a 13-digit run, 0.22% clear Luhn**. In those runs
both fence markers were rewritten to `[CARD_1]` — the run's unpredictable fence became a guessable
constant, in production as well as in the test. `synthesizeKnowledge`'s `runId` is now
`crypto.randomUUID().replace(/-/g, "_")`; `_` is not a separator that detector accepts, so a digit
run cannot span groups. Fixed at the source, so both affected files stop flaking.

The new test hardcodes the adversarial id `39524087-0499-4406-4379-140790585744`, and **first
asserts that the dashed spelling really is redacted** so the fixture cannot go vacuous if `scanText`
changes. `knowledgeSearch.test.ts`'s `/<<<evidence:[0-9a-f-]{36}/` became `[0-9a-f_]{36}`.

## Mutations observed RED (each reverted immediately)

| # | Mutation | Test that went red |
|---|---|---|
| 1 | drop `offlineSeamAvailable() &&` from `runVaultGround` | `vaultGround.test.ts` "WITHOUT the operator's consent…" (1 failed / 20 passed) |
| 2 | `crypto.randomUUID().replace(/-/g,"_")` → `crypto.randomUUID()` | `knowledgeLlm.test.ts` "A NONCE THAT LOOKS LIKE A CREDIT CARD…" (1 failed / 50 passed) |
| 3 | `threadId.length <= THREAD_ID_CHAR_CAP` → `<` | `knowledgeSearch.test.ts` "AN UNUSABLE threadId…" |
| 4 | drop `threadId.length > 0` from `threadIdOk` | same |
| 5 | delete the `if (!threadIdOk(threadId)) return …` line | same |

And one observed **GREEN**, which is why that code is deleted rather than shipped: `listByThread`'s
`threadIdOk(threadId) ? … : []` → `true ? …`.

## Gates

- backend `pnpm vitest run`: **112 files / 3117 tests, 1 red** — `env.test.ts`'s three unclassified
  `QUICKBOOKS_*` names, Phase 28's 28-06, byte-identical to the stated baseline. (3122 → 3117 is
  accounted for: sibling `2fc1a8a` deleted 8 tests from `models.test.ts`, this pass added 3.)
- core: 45 files / 1457 tests, all pass. Both `pnpm typecheck` clean.
- `biome ci` exit 0 on the nine changed files excluding `llm.ts`; `llm.ts`'s 9 warnings are
  pre-existing (unused `@ai-sdk/*` imports, `noNonNullAssertion`) and my diff there is comment-only.
- `echo '{}' | node scripts/check-playbooks.mjs check` on the dirty tree: empty stdout.
- `git diff --stat HEAD -- "*.ts"` after committing: empty. HEAD is what was tested.
- No `convex dev`, no `convex run`, no model call, $0.

## Left open, deliberately

1. **`vault.ts`'s `vaultSearch` keeps an UNGATED `SMOKE::` seam** (`query.startsWith("SMOKE::")`,
   ~`:729`). `apps/web/e2e/vault-redesign.spec.ts:179-200` types those sentinels into the search box
   against a REAL KEYED deployment, where `offlineSeamAvailable()` is false by construction — the
   documented STOP condition. Recorded in `vault.md` and the debt register, not touched.
2. **A future backend test now runs with fixture consent ON unless it stubs the flag off.** That is
   the cost of the suite-wide `vitest.config.mts` env, stated in a comment at that line and in the
   playbook. The negative tests that prove the gates still work stub explicitly and are unaffected.
3. **`llm.ts`'s pre-existing biome warnings** (3 unused imports, 6 non-null assertions) — not mine,
   not touched.
4. **Not my items, reported for the coordinator:** `skills.ts:271` / `:1542`, `skills.test.ts:4211`,
   `workflowPackBinding.ts:204` + `skill-registry.md:2448` (29-05's file set);
   `production-beta.md`'s bump for Phase 28's `lib/env.ts`; `run-eval-golden.mjs:971`'s
   source-scan-only ceiling. Item 1 (the drift guard) and item 2(a) (the pack pin door) were landed
   by the siblings at `2fc1a8a` and `290647b`.
5. **`vaultRag.ts:390` (item 6, record-not-fix)** — the register's entry #3 still describes it
   accurately and it remains in the LIVE list after my edit to that paragraph. Untouched.

## Files touched (all staged explicitly; no `git add -A`)

`packages/backend/convex/`: `knowledgeSearch.ts`, `knowledgeSearch.test.ts`, `knowledgeLlm.ts`,
`knowledgeLlm.test.ts`, `vaultGround.ts`, `vaultGround.test.ts`, `llm.ts`, `onboarding.test.ts` ·
`packages/backend/vitest.config.mts` · `packages/core/src/knowledgeSearch.ts` ·
`docs/playbooks/`: `knowledge-search-routines.md`, `cockpit.md`, `vault.md` ·
`.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md`.

Two of these are outside the stated ownership block and were unavoidable consequences of item 3,
taken only after their owners' commits had landed and the files were clean: `onboarding.test.ts`
(the leaked fake credential) and `29-SMOKE-SEAM-DEBT.md` (entry #5 would otherwise still read LIVE
over a closed door). `vault.md` was mandatory under CLAUDE.md §9 for the `vaultGround.ts` change.
`vault.md` is a **CRLF** file — the first edit converted the whole file to LF (8252-line diff); it
was reverted and redone in binary mode, and the committed diff is 27 added lines.
