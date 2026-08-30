# 29-W2-CLEANUP FIX — Summary

> The remaining wave-2-cleanup findings, closed or explicitly not closed. Two commits:
> `eed88b5` (the guard decision + the shared fixture predicate) and `f56c71f` (the false comments,
> the citations, the debt register).

## What I inherited vs what I wrote

**I inherited nothing uncommitted.** At resume, `git status` showed no modification to any file I
own — the previous round's work was already committed (`96c4700`, `e42a3d3`, `5311e3c`), and the
only dirty files belonged to the two siblings (29-05/29-06 knowledge-plane files, since committed by
them). So this round is a review of COMMITTED work, not a rescue of a half-finished draft. Every
change below is mine. What I verified about the inherited half is stated per item.

---

## 1. THE DRIFT GUARD — DECIDED. Option (a), plus the half of option (b) that option (a) cannot avoid

**The decision:** the guard stays and is made genuinely robust *within the channel it can see*
(provider-package imports), **and the absolute claim is deleted**, because option (a) as literally
stated is impossible in this repo. A regex over import specifiers cannot cover raw HTTP, and
**`vaultRag.ts`'s `embeddingV2` (~:230-270) already routes three providers by raw `fetch` on a
landed production path** — it picks provider label, env-key NAME and endpoint URL from a runtime
decision and holds zero provider imports. Verified by reading it (`sed -n '225,275p'`), and
`grep "@ai-sdk/\|@openrouter" convex/vaultRag.ts` returns only a comment. So "no module can even
hold a provider" was never true of this codebase, and no fifth regex would make it true.

What changed in `convex/lib/models.test.ts`:

| Escape | Before | Now |
|---|---|---|
| `@ai-sdk/openai/internal` (documented subpath, ships the raw `OpenAIChatLanguageModel`) | green | RED |
| `@openrouter/ai-sdk-provider/<subpath>` | green | RED |
| `` await import(`@ai-sdk/openai`) `` (template literal) | green | RED |
| `export default openai;` | green | RED |
| `export async function providerFor()` / `export let leaked` / `export class Leak` | green | RED |
| `export { openai }` / `export *` | RED | RED |

- `PROVIDER_PACKAGE` now matches the package ROOT plus an optional subpath tail, and accepts
  backtick specifiers: `/["'`](?:@ai-sdk\/[a-z0-9-]+|@openrouter\/ai-sdk-provider)(?:\/[^"'`]*)?["'`]/`.
  A negative pin (`@ai-sdk-community/thing` must NOT match) keeps the tail from going greedy.
- The export-surface pin **no longer enumerates spellings**, which is why it kept losing. Every line
  starting `export` must reduce to one of the three allowed names via a strict regex, or it
  contributes its own raw text and fails. Any future spelling fails by default.
- The docstring's "the ONLY way to get a provider is the provider package's MODULE SPECIFIER" is
  **deleted, not re-worded**, and the CEILING paragraph now names what is still open.
- The test is renamed to "no module under convex/ **IMPORTS** a model provider…" and the scope
  over-claim is corrected (the glob is `../**` from `convex/lib`, so it sees `convex/` only —
  `packages/<pkg>/src` is not scanned; I grepped it by hand this round, no provider import there,
  only comments).
- `docs/playbooks/cockpit.md` carries the same correction, and the two false sentences in the block
  below its header are corrected in place rather than left for a reader to trip over.

### NOT CLOSED (stated in the test, in cockpit.md and here)

1. **Raw HTTP copy-drift is UNGUARDED.** `vaultRag.ts`'s adapter is the live in-repo example; nothing
   pins it to `lib/models.ts`. A real guard needs an AST pass, not a regex.
2. **A non-literal specifier** — `await import("@ai-sdk/" + "openai")` — is invisible. Confirmed by
   probe: my regex returns `false` for it.
3. **Re-export laundering from the OTHER four provider holders** (`llm.ts`, `intake.ts`,
   `vaultExtract.ts`, `vaultTranscribe.ts`) is not pinned; only `lib/models.ts`'s export surface is.
4. The call scan (`DYNAMIC_MODEL_ROUTE`) still misses `new OpenAIChatLanguageModel(` and every other
   class-construction shape. Inside the five holders — the only place it is load-bearing — that is
   still a hole. It was already documented as "the weaker second net"; it still is.

---

## 2. THE FIXTURE FLAG — ONE PREDICATE, PINNED

`lib/env.ts` decided "is this seam on?" with `!read(name)?.trim()` while `lib/models.ts` required the
literal `"1"`. At `PIKAR_OFFLINE_FIXTURES=on` **both halves of the contradiction held at once**: the
readiness screen announced a LIVE fabrication seam, the fixture was off, and the operator got an
unexplained `OPENROUTER_API_KEY is not set`.

- New: `lib/env.ts` exports `OFFLINE_FIXTURES_ENV` and `isOfflineFixtureConsent(value)` — the literal
  `"1"`, trimmed. `missingEnv().fixturesActive` routes **only** that row through it (every other
  fixture-tier name keeps the non-blank test; no consumer of those disagrees with it).
  `offlineSeamAvailable()` calls the same predicate.
- **The READ stays a literal `process.env.PIKAR_OFFLINE_FIXTURES` in `models.ts` on purpose:**
  `env.test.ts`'s "no manifest entry is dead" drift scan only sees literal reads, so a helper
  indirection would have made the manifest row look dead. Verified — that test still passes.
- Behaviour change, stated plainly: a non-`"1"` truthy value (`on`, `true`) now reads as OFF in the
  readiness screen too. Chosen over loosening the seam because tightening the *report* changes no
  runtime seam behaviour, while loosening the *seam* would be a security-direction change made in a
  cleanup pass. Recorded in `docs/playbooks/production-beta.md`.
- **The one residual asymmetry is pinned as a decision, not left implicit:** the screen reports the
  FLAG; the seam ANDs the flag with "neither model key". On a keyed deployment the screen still names
  the seam while the seam is inert — which is what the manifest row's `whatBreaks` string says, and a
  fixture warning louder than the fixture is the safe direction. There is an explicit assertion for
  that case so it cannot drift into being the next divergence.

---

## 3. THE FALSE COMMENTS THE PREVIOUS ROUND LEFT

- `vaultDigest.test.ts:12` stated the **superseded** predicate as present-tense fact, twelve lines
  above the `beforeEach` the same commit taught to stub `PIKAR_OFFLINE_FIXTURES=1`, and attributed
  `offlineSeamAvailable` to `vaultDigest` (it lives in `convex/lib/models.ts`). Rewritten to the
  actual predicate, with the correction stated. I verified the `beforeEach` does what my replacement
  says (lines 83-84: stubs the flag to `"1"`, deletes both keys).
- **The citations, fixed in all three source/doc sites** (they had been corrected only in the
  `.planning` register): `vaultDrive.ts:697` → `:705`, `:880` → `:888`, in `vaultDigest.ts:162-163`,
  `vaultDigest.test.ts:716` and `docs/playbooks/vault.md`. I re-read `vaultDrive.ts` to confirm:
  `:705` is `args: { driveFolderId: v.string(), name: v.string() }`, `:888` is
  `name: name.slice(0, 200) || "Drive folder"`. **The store TRUNCATES to 200 chars — it is not
  "verbatim", as every copy of that sentence said** — so the wording is corrected too (a leading
  sentinel still survives truncation, which is why the finding stands).
- `docs/playbooks/vault.md`'s live reference section still gave the credential-only gate as "the
  whole gate" **and** still carried the `STORED, EMBEDDED and served back through retrieval`
  overstatement that had been corrected everywhere else. Both fixed in place, corrections stated.
- A stale present-tense line in vault.md's wave-2 historical entry is marked SUPERSEDED rather than
  rewritten (it is an append-only round log).

---

## 4. RECORDED, NOT FIXED — as instructed

- **`vaultRag.ts:390` (`embedDoc`)** selects a fabrication path from CONTENT with **no operator gate
  at all**, on a fully landed path. Pre-existing (`d1e8826`, 2026-07-14) and disclosed. Confirmed
  the register's description is accurate, and **added the severity block the register was missing**:
  it now says once, plainly, that **instances #1-#5 are LIVE AND COMPLETELY UNGATED on a fully keyed
  production deployment today** — the module-ordered numbering read like a ranking — with a table
  ordering them by CHANNEL (tool-argument #4/#5 worst; document-text #1-#3; #6 has no production
  caller as of this commit) and #3 called out as live with an ABSENCE for damage.
- **`vaultGround.ts` (#5)** re-verified as accurate: a model-composed `SMOKE::` tool argument
  silently disables vault grounding for the turn; half (a) needs no valid id and is reachable today,
  half (b) remains explicitly NOT VERIFIED. Marked re-verified in the register.

---

## Mutations OBSERVED red (every one run, then reverted; tree confirmed clean after each)

| # | Mutation | Test that went RED |
|---|---|---|
| M1 | planted `convex/zzSubpathCopy.ts`: `import { OpenAIChatLanguageModel } from "@ai-sdk/openai/internal"` + a private route table | "no module under convex/ IMPORTS a model provider…" (1 failed / 17 passed) |
| M2 | planted `convex/zzAliasCopy.ts`: aliased `createOpenAI` factory route table | same test |
| M3 | planted `convex/zzTemplateCopy.ts`: `` await import(`@ai-sdk/openai`) `` | same test |
| M4-M9 | appended to `lib/models.ts`, one at a time: `export default openai;` · `export async function providerFor()` · `export let leaked` · `export { openai };` · `export * from "@ai-sdk/openai";` · `export class Leak` | "the provider cannot be laundered through this file's exports — ANY spelling" (all six) |
| M10 | `lib/env.ts` `fixturesActive` back to `!unset(e.name)` | "THE SEAM AND THE READINESS SCREEN CANNOT DISAGREE…" → `the READINESS SCREEN at "on": expected true to be false` |
| M11 | `lib/models.ts` back to `process.env.PIKAR_OFFLINE_FIXTURES !== undefined` | same test (`the SEAM at "on"`) **and** `only the literal "1" is consent` (2 failed / 16 passed) |
| M12 | `PROVIDER_PACKAGE` tail made greedy: `@ai-sdk[a-z0-9/-]+` | "THE IMPORT GUARD IS NOT VACUOUS…" (the `@ai-sdk-community` negative pin) |

M1-M3 were **real files planted under `convex/`**, not strings run through the regex — the trap this
phase has paid for. The string-level cases in the non-vacuity test exist as well, but the RED
observations above are from the file scan the handler actually runs.

## Gates (corrected forms, `cd packages/backend`)

- `pnpm vitest run convex/lib/models.test.ts` → **18/18**
- `convex/vaultDigest.test.ts` alone → **17/17** · `convex/voiceDoc.test.ts` → **33/33**
- `models + vaultDigest + voiceDoc + env + blueprint + onboarding + knowledgeLlm` → 205 passed,
  **1 failed: `env.test.ts` "every consumed name is classified"**, `['QUICKBOOKS_CLIENT_ID', …(2)]`
  — the disclosed Phase-28 28-06 red, **not mine**. `convex/opsSignals.test.ts` → 6/6.
- `pnpm typecheck` → clean.
- `echo '{}' | node scripts/check-playbooks.mjs check` on the DIRTY tree → empty stdout (passed).
  It first blocked on `cockpit.md` (models.ts/test) and `production-beta.md` (env.ts); both were
  updated with real content, not a bare date bump.
- `git diff --stat HEAD -- "*.ts"` after both commits → **empty**.

## Files changed

`packages/backend/convex/lib/models.ts` · `lib/models.test.ts` · `lib/env.ts` ·
`convex/vaultDigest.ts` · `convex/vaultDigest.test.ts` · `docs/playbooks/vault.md` ·
`docs/playbooks/cockpit.md` · `docs/playbooks/production-beta.md` ·
`.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md`

`cockpit.md` and `production-beta.md` are outside my stated ownership list; they were required by
the CLAUDE.md §9 Stop hook for `lib/models.*` and `lib/env.ts`, and cockpit.md's model-routing
section is where the brief required the guard decision to be stated. Neither is owned by 29-05 or
29-06. **`production-beta.md` still owes its separate bump for PHASE 28's `lib/env.ts` change — my
entry says so explicitly and does not discharge it.**
