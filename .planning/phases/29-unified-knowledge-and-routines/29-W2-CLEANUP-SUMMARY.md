---
phase: 29
plan: W2-CLEANUP
subsystem: offline-fixture-seam
tags: [security, offline-seam, model-routing, playbooks, debt-register]
requires: [29-01, 29-02, 29-03, 29-04]
provides:
  - PIKAR_OFFLINE_FIXTURES positive operator opt-in for every offlineSeamAvailable() consumer
  - a rename-proof model-provider import guard in lib/models.test.ts
  - a corrected + extended SMOKE:: seam debt register (6 instances, was 4)
affects: [vaultDigest, voiceDoc, lib/models, lib/env]
tech-stack:
  added: []
  patterns:
    - "offline fixture = POSITIVE operator opt-in AND-ed with the precondition it claims"
    - "guard the provider IMPORT (a module specifier no rename touches), not the call spelling"
key-files:
  created:
    - .planning/phases/29-unified-knowledge-and-routines/29-W2-CLEANUP-SUMMARY.md
  modified:
    - packages/backend/convex/lib/models.ts
    - packages/backend/convex/lib/models.test.ts
    - packages/backend/convex/lib/env.ts
    - packages/backend/convex/vaultDigest.ts
    - packages/backend/convex/vaultDigest.test.ts
    - packages/backend/convex/voiceDoc.ts
    - packages/backend/convex/voiceDoc.test.ts
    - .planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md
    - docs/playbooks/vault.md
    - docs/playbooks/voice.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/production-beta.md
decisions:
  - "Absence of a credential is a misconfiguration, not consent: the fixture path now needs PIKAR_OFFLINE_FIXTURES=1 as well, and a keyless deployment without it THROWS."
  - "Only the literal \"1\" is consent. `!== undefined` reads `\"\"` and `0` as yes, which is the same mistake one level up."
  - "The copy-drift call-shape scan is demoted to a documented second net; the load-bearing guard is now the provider-package IMPORT scan."
  - "vaultGround.ts promoted from footnote to debt instance #5: its `query` is a model-composed tool argument on the searchVault path."
  - "knowledgeLlm.ts added as debt instance #6, and named as the only instance closable on its own (no production caller yet)."
metrics:
  duration: "~1h"
  completed: 2026-08-28
  commits: 2
---

# Phase 29 W2-CLEANUP: Offline-seam regression, false claims, and the drift guard — Summary

Closed the wave-2 tail: the offline fixture gate stopped treating a lost API key as an operator's
consent, a claim that had been copied verbatim into three source/doc locations was corrected rather
than softened, the model-copy-drift tripwire was replaced after being proven escapable for the third
time, and the `SMOKE::` debt register gained the two instances it was missing.

## What I INHERITED vs what I WROTE

Three agents were killed mid-task. I own the `W2-CLEANUP` slice of that dirty tree.

**INHERITED (uncommitted, by an agent that is gone), and what I verified about it:**

| File | Inherited | Verdict |
|---|---|---|
| `lib/models.ts` | `offlineSeamAvailable` rewritten to `PIKAR_OFFLINE_FIXTURES !== undefined && !OPENAI && !OPENROUTER`, plus a large docstring and the `:27` cross-reference fix | **MID-EDIT AND RED.** Kept the design, fixed the predicate (below). |
| `lib/env.ts` | `PIKAR_OFFLINE_FIXTURES` registered in `ENV_MANIFEST` at `tier: "fixture"` | Correct coupling, kept as-is. |
| `lib/models.test.ts` | a 4-test `offlineSeamAvailable` block, expected values as literals | Correct and well-built; **its last test failed against the inherited implementation.** |
| `vaultDigest.{ts,test.ts}` | opt-in threaded through the gate + 3 new tests | Verified by running; kept. |
| `voiceDoc.{ts,test.ts}` | opt-in threaded through `beforeEach` + 2 new tests | Verified by running; kept. |

**The inherited work was internally inconsistent and did not pass.** `models.test.ts` asserted
`'only the literal "1" is consent — "0" and "" are not'`, while the implementation was
`!== undefined`. Measured, before touching anything:

```
$ cd packages/backend && pnpm vitest run convex/lib/models.test.ts
 FAIL  convex/lib/models.test.ts > only the literal "1" is consent — "0" and "" are not
   AssertionError: expected true to be false
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

**I WROTE:** the `=== "1"` tightening and its comment; every change in item 2 (the false-claim
correction, three sites); the whole of item 3 (debt instances #5 and #6, the citation re-verification,
the closing-section correction); the entire drift-guard replacement in `models.test.ts` and the
planted `zzAliasCopy.ts` demonstration; all four playbook blocks.

---

## 1. THE REGRESSION — a missing credential was being read as consent

The round-4 fix gated the fixture on `!OPENAI_API_KEY && !OPENROUTER_API_KEY`. That closed an
attacker-triggered fabrication and opened an **unconditional** one: a deployment that lost its keys
(never set, or blanked with `convex env set X ""`) fabricated on **every** call, **silently** — a
fixture RETURNS where the previous gate THREW at `openRouter()`, so the retry was suppressed too.
Blast radius: every completed folder, plus `api.voiceDoc.reviewSession`, a **public** endpoint,
reopened to every authenticated tenant.

```ts
// packages/backend/convex/lib/models.ts
export const offlineSeamAvailable = (): boolean =>
  process.env.PIKAR_OFFLINE_FIXTURES === "1" &&
  !process.env.OPENAI_API_KEY &&
  !process.env.OPENROUTER_API_KEY;
```

The credential half is kept as the second belt (an accidental flag on a keyed deployment still takes
the real model path). The literal `"1"` matters: `!== undefined` reads `""` and a leftover `0` as
yes — the same "absence/emptiness means yes" mistake, one level up. **A keyless deployment without
the flag now throws `OPENROUTER_API_KEY is not set`, and both consumers assert that.**

## 2. THE FALSE CLAIM, corrected in three places (not four)

The claim "the fabricated output was **stored, embedded and served back through retrieval**" existed
in **three** places, not four: `vaultDigest.ts`'s module header, `vaultDigest.test.ts`'s seam comment,
and `29-SMOKE-SEAM-DEBT.md`'s headline. (I searched the whole worktree for `embedded and served` /
`stored, embedded`; the only other hits are `.planning/ROADMAP.md:31`, `docs/playbooks/vault.md:1326`
and `05-CONTEXT.md:11`, all describing the *real* ingest pipeline correctly, not the fixture.)

**Traced, and the claim is false.** `smokeDigestFixture` must begin with `SMOKE::graph::`, and
`vaultRag.embedDoc` (`vaultRag.ts:390`) short-circuits on ANY `SMOKE::` prefix:

```ts
if (safeText.startsWith(SMOKE_PREFIX))
  return { entryId: `smoke::${doc.contentHash}`, costUsd: 0 };
```

No vector is written, so the fabricated digest was **never vector-retrievable**. What was true: it
was stored as a `vaultDocuments` row, **displayed** to the tenant as the folder's digest, and carried
a `ragEntryId` that merely *reads* groundable — which is the register's own debt instance #3, not
retrieval poisoning. Corrected at all three sites with the reasoning, not softened.

## 3. THE DEBT REGISTER — two instances added, every citation re-verified

**`vaultGround.ts` promoted from footnote to instance #5.** Its exclusion rested on "the content is
the caller's own upload/query in the same request" — the same argument disproven twice on the digest
gate, re-used rather than re-derived. Traced every writer of `query`:

| Caller | Source of `query` |
|---|---|
| `llm.ts:3792` `searchVault` `execute({ query })` | **A MODEL-COMPOSED TOOL ARGUMENT** (`inputSchema: jsonSchema<{ query: string }>` at `llm.ts:3784`), inside `runAgentLoop` |
| `blueprint.ts:547` | server-composed |
| `evaluations.ts:295` | server-composed from a validated arg |

That is the same channel as instance #4 (`gmail.ts:370`), which the register itself calls the worst
of the four. Harm recorded: (a) a **silent denial of vault retrieval needing no valid id at all** — a
`SMOKE::` query bypasses `rag.search` and the turn answers ungrounded; (b) with a reachable docId,
`SMOKE::<docId>|<passage>` attaches a **model-written "matched passage"** to a real tenant document,
rendered under that document's title in the `<vault_context>` fence and on the SourceCard row. I
explicitly recorded (b)'s precondition — whether a real `vaultDocuments` id is reachable inside the
tool loop — as **NOT VERIFIED**, rather than asserting it.

**`knowledgeLlm.ts` added as instance #6.** Its seams key on the `question` argument, and its
docstring argues `"the question is the caller's own argument, so keying on it puts the seam back
under the operator"` — a caller's argument is a payload, not a fact about the deployment, so this
breaks the register's own stated rule. It has **no production caller** (`grep` outside the module
finds only `skills.test.ts:913-914`), so it is the one instance not coupled to the E2E chain and
closable on its own; the same positive-opt-in fix applies verbatim. Recorded, not fixed — see
"not closed" below.

**Citations re-read, one by one.** `vaultLlm.ts:135`, `vaultLlm.ts:265`, `vaultRag.ts:390`,
`gmail.ts:370`, `vaultGround.ts:48`, `intake.ts:69/111`, `vaultExtract.ts:389` — **all accurate.**
`vaultDrive.ts:697` / `:880` were **WRONG**: the `name: v.string()` arg is at **`:705`** and the store
is at **`:888`** (`name.slice(0, 200) || "Drive folder"`). Fixed in the register and in
`vaultDigest.ts`'s header, which repeated them.

**Also corrected in the closing section:** the register proposed `PIKAR_OFFLINE_FIXTURES=1` as the
future `flag && content` fix for instances #1-#4. That flag now exists, but `offlineSeamAvailable()`
ANDs it with "neither model key" — and the E2E and `pnpm smoke:vault` run against a **keyed**
deployment, so the predicate is `false` there by construction and **cannot** be the flag half.
A future plan needs a separate flag-only predicate and must justify the weaker guard. Reusing
`offlineSeamAvailable()` there without noticing would produce a chain that is dead offline and looks
fine in a unit suite.

**Note on the `intake.ts` / `vaultExtract.ts` footnote:** I did NOT re-trace their byte writers, and
I said so in the register rather than re-certifying the argument that has now failed three times.

## 4a. `lib/models.ts:27` cross-reference

Inherited fix, verified: `grep -n offlineSeamAvailable convex/voiceDoc.ts` shows only an import and
two call sites — **zero definitions**. `96c4700` moved it into `lib/models.ts`.

## 4b. THE DRIFT GUARD — escapable a third time, so I replaced the load-bearing half

`DYNAMIC_MODEL_ROUTE` hardcodes callee spellings and requires an identifier after `(`. I planted
`convex/zzAliasCopy.ts` holding both escapes and ran the suite:

```
# with convex/zzAliasCopy.ts present (createOpenAI({apiKey})(id.replace(...)) + an aliased provider)
$ pnpm vitest run convex/lib/models.test.ts
 Test Files  1 passed (1)          <-- 14/14 GREEN with two live private route tables
```

The replacement does not read the call at all: to route a model id you must first **have** a
provider, and the only way to get one is the provider package's **module specifier** — a string
literal no rename touches.

```
# same planted module, new guard
 FAIL  convex/lib/models.test.ts > NO MODULE CAN EVEN HOLD A PROVIDER except the five named here
 +   "../zzAliasCopy.ts",
```

Five holders pinned as literals: `lib/models.ts` (the table), `llm.ts` (Node-only `google/`), and
`intake.ts` / `vaultExtract.ts` / `vaultTranscribe.ts` (one fixed model id each — they route nothing).
Plus two supporting tests: the planted text asserted to **pass** the call scan and **fail** the import
scan (non-vacuity as a value), and `lib/models.ts`'s export surface pinned to three names with no
`export {` / `export *`, closing the laundering hole.

**The call scan is KEPT as an explicitly weaker second net** (inside the five holders a provider is
legitimately in scope, so the import guard says nothing there) — and the previous docstring claim
that a rename "cannot get past" it is deleted and replaced with its real ceiling, in both the test and
`docs/playbooks/cockpit.md`.

## 5. RECORDED, NOT FIXED

- **`convex/media.test.ts`** — "a transcript with no usable words never buys a sandbox" fails under
  full-suite load (spy called 1x, expected 0). **Measured in isolation myself: 255/255 pass**
  (the brief said 266; I report what I ran). Latent test-isolation defect newly exposed by the suite
  growing 107 → 111 files; this branch touches no `media.*`, no `render/`, not `vaultIngest.ts`.
  Recorded in `docs/playbooks/vault.md`'s known-flaky block beside `vaultDigest.test.ts` **and named
  as needing an owner on the media plane.** Not attempted.
- **`check-playbooks.mjs` certifies almost nothing here — VERIFIED.** `let base = "HEAD"` (line 44),
  overridden only if `.git/worktrees/pikar29/claude-playbooks-<sessionId>` exists. It does not — the
  only file there is `claude-playbooks-ack.json`. So `git diff --name-only HEAD` sees **only the
  uncommitted tree**: after each of my commits my changed files vanished from its view entirely. A §9
  "pass" in this worktree is a statement about work not yet committed, nothing more. I therefore ran
  the gate on the DIRTY tree **before** each commit, which is the only moment it can see anything.

---

## Verification

Commands are the CORRECTED forms (the plan's `pnpm --filter … test -- <filter>` swallows the `--`;
`node scripts/check-playbooks.mjs` bare hangs on stdin and signals by printing, never by exit code).

```
$ cd packages/backend && pnpm vitest run convex/lib/models.test.ts
   Test Files  1 passed (1)          Tests  14 passed (14)

$ cd packages/backend && pnpm vitest run convex/vaultDigest.test.ts
   Test Files  1 passed (1)          Tests  17 passed (17)

$ cd packages/backend && pnpm vitest run convex/voiceDoc.test.ts
   Test Files  1 passed (1)          Tests  33 passed (33)

$ cd packages/backend && pnpm vitest run convex/media.test.ts        # item 5, isolation
   Test Files  1 passed (1)          Tests  255 passed (255)

$ cd packages/backend && pnpm typecheck                              # tsc --noEmit, clean
$ npx biome check <my 7 files>       Checked 7 files in 102ms. No fixes applied.

$ cd packages/backend && pnpm vitest run                             # FULL SUITE, after both commits
   Test Files  2 failed | 109 passed (111)
        Tests  2 failed | 3068 passed (3070)
   ❯ convex/env.test.ts   (21 tests | 1 failed)
       × the manifest covers every name source actually reads
         expected [ 'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET',
                    'QUICKBOOKS_REDIRECT_URI' ] to deeply equal []
   ❯ convex/media.test.ts (255 tests | 1 failed)
       × a transcript with no usable words never buys a sandbox

$ echo '{}' | node scripts/check-playbooks.mjs check   # on the DIRTY tree, before each commit
   before: block — cockpit.md, voice.md, vault.md, production-beta.md
   after:  block — skill-registry.md ONLY (29-05's uncommitted skills.ts/skills.test.ts; NOT MINE)
```

### Mutations OBSERVED RED (each reverted; none left in the tree)

| # | Mutation | Went RED |
|---|---|---|
| M1 | drop the `PIKAR_OFFLINE_FIXTURES` conjunct (back to credential-only) | `vaultDigest` "KEYS GONE, OPT-IN ABSENT"; `voiceDoc` "KEYS GONE, OPT-IN ABSENT"; `models` "absence of a credential is a MISCONFIGURATION" — **3 files failed** |
| M2 | drop BOTH credential conjuncts (flag alone) | `vaultDigest` "the opt-in does NOT re-open the seam" + the member-TEXT / member-TITLE / folder-NAME / `OPENROUTER_API_KEY ALONE` cases; `voiceDoc` "the SMOKE:: sentinel is INERT once a model key exists" + "OPENROUTER_API_KEY ALONE is enough"; `models` "a key still closes the seam even WITH the opt-in" |
| M3 | `=== "1"` → `!== undefined` | `models` 'only the literal "1" is consent' — **this was the inherited state, observed red before I touched it** |
| M4 | blind `PROVIDER_PACKAGE` (prefix its literal with `zzz`) | "NO MODULE CAN EVEN HOLD A PROVIDER" + "THE IMPORT GUARD IS NOT VACUOUS" |
| M5 | append `export { openai };` to `lib/models.ts` | "the provider cannot be laundered through this file's exports" |
| M6 | plant `convex/zzAliasCopy.ts` (two private route tables) | **OLD guard: 14/14 GREEN.** NEW import guard: names the file |

### files_modified vs `git diff --stat` (the coverage-hole check)

Every file this plan named was touched: `vaultDigest.{ts,test.ts}`, `lib/models.{ts,test.ts}`,
`voiceDoc.{ts,test.ts}`, `29-SMOKE-SEAM-DEBT.md`, `docs/playbooks/vault.md`. Beyond the named set:
`lib/env.ts` (inherited, correct coupling) and three playbooks the §9 gate demanded
(`cockpit.md`, `voice.md`, `production-beta.md`). `git diff --stat HEAD -- "*.ts"` after committing
shows only 29-05's files, so nothing of mine was left unstaged.

## Commits

| Hash | Message |
|---|---|
| `e42a3d3` | `fix(29): a missing credential was consent, and that fabricated on every run` |
| `5311e3c` | `test(29): the copy-drift guard was escapable on its third iteration too` |

---

## What I did NOT close — read this before trusting anything above

1. **Instances #1-#4 and #5 in the debt register are OPEN.** Unchanged by design — they are coupled
   to a landed E2E against a keyed deployment. Instance #5 (`vaultGround.ts`) is **newly classified
   as debt and is live today**: a model-composed `SMOKE::` query can silently disable vault
   grounding for a turn. I classified it; I did not fix it.
2. **Instance #6 (`knowledgeLlm.ts`) was NOT fixed even though it is cheap.** `knowledgeLlm.ts` is on
   29-06's plane, which is executing concurrently in this worktree. Editing it would have raced a
   sibling. **Named follow-up for 29-06 or a successor:** apply `offlineSeamAvailable()` as the
   authority with the sentinel retained only as the fixture selector, and **delete or prove the
   docstring claim at `knowledgeLlm.ts:88-97`** that keying on `question` "puts the seam back under
   the operator". It is a comment asserting an invariant nothing enforces.
3. **`intake.ts` / `vaultExtract.ts` remain excluded on an untraced argument.** Flagged as unproven
   in the register rather than re-certified.
4. **The full backend suite is 2 failed / 109 passed (111 files), 3068 / 3070 tests — and NEITHER
   failure is mine.** `convex/env.test.ts` is the documented Phase-28 red (QUICKBOOKS_* unclassified
   in `ENV_MANIFEST`, 28-06 in flight). `convex/media.test.ts` is the isolation flake in item 5,
   reproduced exactly as described — same single test, and 255/255 alone. **Zero sibling reds
   appeared**, so 29-05/29-06 were at green commits when it ran. `vaultDigest.test.ts`, the other
   known load-flaky file, passed under full load on this run. Baseline was 111 files / 3033; the
   +37 tests are my +9 and the siblings' additions.
5. **No live-deployment verification.** No `convex dev`, no `convex run`, no model call, no spend —
   as instructed. The `PIKAR_OFFLINE_FIXTURES` flag has **never been exercised on a real
   deployment**; only convex-test drives it. Setting it in a real environment (and confirming the
   readiness screen lists it under `fixturesActive`) is unverified and owed.
6. **`graphify update .` / `extract-convex-edges.mjs` not run.** Two siblings are editing the same
   worktree; a rebuild now would encode a half-written tree. `graphify-out/*` was deliberately left
   unstaged.
