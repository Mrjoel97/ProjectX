# 29-FIN-W2 — the drift guard is deleted, and the gap is written down instead

**Commit:** `2fc1a8a` · **Branch:** `feat/29-unified-knowledge` · **Date:** 2026-08-29
**Scope owned:** `convex/lib/models.{ts,test.ts}`, `convex/lib/env.ts`, `convex/vaultDigest.ts`,
`convex/vaultRag.ts` (READ ONLY), `29-SMOKE-SEAM-DEBT.md`, `docs/playbooks/vault.md`,
`docs/playbooks/production-beta.md`, plus `docs/playbooks/cockpit.md`'s model-routing section as
directed by Item 1. Nothing outside that list was edited or staged.

**Nothing I inherited was uncommitted.** The three killed agents' work described in the brief had
already been committed by the time I started (`4902e2c`, `f56c71f`, `eed88b5`, `58c1e34`); the only
dirty files at my start belonged to the two fixers running beside me. So everything below is mine,
written against committed code that I read and, where I make a claim about it, RAN.

---

## Item 1 — DELETE the drift guard. Done.

`packages/backend/convex/lib/models.test.ts`: **18 tests -> 10.** Removed the whole
`describe("no module keeps its own copy of the route table")` block (~280 lines, 8 tests) and the
`import.meta.glob` raw-source map that only it used:

| Deleted test | What it was |
|---|---|
| `EXACTLY ONE shared table: no module resolves a model without importing it` | the name scan + its empty allow-list |
| `no module under convex/ IMPORTS a model provider except the five named here` | the `PROVIDER_PACKAGE` import scan |
| `THE IMPORT GUARD IS NOT VACUOUS: every escape found against it is now caught` | its non-vacuity companion |
| `the provider cannot be laundered through this file's exports — ANY spelling` | the export-surface pin (Item 4's `:342-363`) |
| `THE DETECTOR ITSELF: a route table under ANY name is caught…` | the `DYNAMIC_MODEL_ROUTE` detector test |
| `no module under convex/ routes a model id to a provider except the shared table` | the call-shape file scan |
| `llm.ts keeps its google/ wrapper and DELEGATES the rest to the shared table` | source-text pin on `llm.ts` |
| `the scan is not vacuous — it can see the modules that DO resolve models` | the scan's own liveness check |

**KEPT:** the five behavioural tests (`or/`, `stealth/`, bare/`openai/`, `google/` throws, and
`resolveModel(DEFAULT_MODEL)` -> OpenRouter, all asserting `.provider`/`.modelId`) and the five
offline-fixture consent tests. Both groups were mutation-checked (below), so what remains is real.

**The gap is recorded in three places, with the five escapes named as the evidence:**

- `docs/playbooks/cockpit.md` — new top entry, with the escape table (name scan -> rename;
  call-shape scan -> `createOpenAI({…})(id)` / local alias; import scan -> `@ai-sdk/openai/internal`;
  export pin -> `export default openai;`; rewritten export pin -> leading whitespace).
- `docs/playbooks/vault.md` — new top entry, same account, condensed.
- `29-SMOKE-SEAM-DEBT.md` — new section "Second debt, same shape: COPY-DRIFT OF THE MODEL ROUTE
  TABLE IS UNGUARDED", with the escape table and the upgrade path.

**The stated ceiling:** a pattern over source text cannot decide "does any module hold a private
route table?" — a provider is reachable via a renamed binding, an arbitrary subpath specifier, a
non-literal specifier (`import("@ai-sdk/" + "openai")`), any export spelling, and, needing no
provider package at all, raw `fetch`. `vaultRag.ts`'s `embeddingV2` does exactly that on a landed
path today. Closing it needs an AST/type-level pass or a lint rule that RESOLVES BINDINGS.

---

## What I DELETED vs what I MADE TRUE

### Deleted (no replacement absolute written)

| Where | The claim |
|---|---|
| `lib/models.ts` header | "`lib/models.test.ts` pins the END STATE: its allow-list is EMPTY, so a new module that resolves a model without importing this table is red…" — the scan is gone. Replaced by "⚠ NOTHING GUARDS THAT AN EIGHTH COPY IS NOT WRITTEN". |
| `lib/models.ts` (the `:154`-area comment) | "The rule lives in `lib/env.ts` so the readiness screen **cannot** answer it differently" — falsified by the file's own asymmetry test. Now states the shared VALUE test and the deliberate credential-conjunct difference separately. |
| `lib/models.ts` seam note | "they **cannot** be converted one at a time" (the other `SMOKE::` seams) — replaced with the mechanism: they share fixtures with each other and with a landed E2E, so converting one moves the others. |
| `lib/env.ts` `fixturesActive` | "this screen **cannot** announce a seam that is off (or stay quiet about one that is on)" — FALSE: the screen reports the flag, the seam ANDs it with "neither key", so a keyed deployment reports ACTIVE over an inert seam. |
| `production-beta.md` (Item 4's `:12-14`) | the paragraph said "**Only** `PIKAR_OFFLINE_FIXTURES` is routed through it" and then generalised: "a **fixture-tier** value that is not `1` now reads as OFF". Scoped to the one name, with the unchanged behaviour of other fixture-tier names stated. |
| `models.test.ts` test title | `THE SEAM AND THE READINESS SCREEN CANNOT DISAGREE ABOUT WHETHER IT IS ON` -> `the seam and the readiness screen share ONE value test, and differ only on the key`. The old title was contradicted by the deliberate asymmetry inside the same test. |
| `cockpit.md` | the entire "WAVE-3 CLEANUP — THE COPY-DRIFT GUARD WAS DEFEATED AGAIN" entry (53 lines describing regexes and pins that no longer exist), and the "WAVE-2 FINAL PASS" entry's part (1); both would have read as "a guard protects you". |
| `vault.md` | its item 1, the CHANNEL-guard account, superseded by a one-line pointer. |

### Made true instead (citation added, each verified by running the mutation)

| Where | The claim, and what now backs it |
|---|---|
| `vaultDigest.ts:153-157` | "selected by `offlineSeamAvailable()` … and by nothing else" now names the `the offline seam is selected by the DEPLOYMENT, never by content` block and its three attacked channels (member TEXT, member TITLE, folder NAME). |
| `vaultDigest.ts:180-184` | "on any deployment with a key the fixture is **unreachable by construction**" -> what the code does (`offlineSeamAvailable()` ANDs the flag with "neither model key") plus the two keyed tests that pin it. |
| `lib/models.ts` / `lib/env.ts` / `production-beta.md` | the "one value test, two deciders" claim, which the surviving literal-value table in `models.test.ts` genuinely enforces (mutation below). |

---

## Mutations OBSERVED RED (each reverted; `git diff --stat` confirmed clean afterwards)

| Mutation | Result |
|---|---|
| `resolveModel`: `if (id.startsWith("or/")) return openRouter().chat(id.slice(3))` -> `openai(id.slice(3))` | **3/10 RED** — the `or/` route test, the `DEFAULT_MODEL` test, and `absence of a credential is a MISCONFIGURATION` (its missing-key throw). Proves the KEPT behavioural tests are not vacuous. |
| `offlineSeamAvailable`: drop the `isOfflineFixtureConsent(...)` conjunct | **3/10 RED** — misconfiguration test, literal-"1" test, shared-predicate table. |
| `lib/env.ts` `fixturesActive`: offline flag back to `!unset(e.name)` | **1/10 RED** — `the READINESS SCREEN at "on": expected true to be false`. |
| `vaultDigest.ts`: gate -> `folder.name.includes("SMOKE::digest::")` | **10/17 RED**, including `A FOLDER NAME carrying the sentinel takes the LIVE model path` — the citation I added to `vaultDigest.ts` is real, not inherited on trust. |

Deletions carry no mutation, by the pass's own rule; the deleted tests are enumerated above instead.

---

## Item 6 — vaultRag, recorded not fixed. Re-verified 2026-08-29.

`packages/backend/convex/vaultRag.ts:390` still short-circuits on `safeText.startsWith(SMOKE_PREFIX)`
and returns a fake `smoke::<contentHash>` entryId at `costUsd: 0`, with `SMOKE_PREFIX = "SMOKE::"`
defined at `:368`. `grep` finds **zero** occurrences of `offlineSeamAvailable` or
`PIKAR_OFFLINE_FIXTURES` in that file — there is no operator gate on it. Debt instance #3's
description (a `ready` row with a fake `ragEntryId` and no vector — a silent, targeted denial of
retrieval) matches the code, and the register's severity paragraph already lists it as **LIVE AND
COMPLETELY UNGATED**. Confirmed accurate; not edited. The confirmation is written into the register
so the next reader does not have to re-derive it.

---

## Gates

| Gate | Result |
|---|---|
| `pnpm vitest run lib/models.test.ts` (from `packages/backend`) | **10/10 pass** (was 18/18; 8 deleted) |
| `pnpm vitest run vaultDigest.test.ts` (alone) | **17/17 pass** |
| `pnpm vitest run env.test.ts` | 20/21 — the ONLY red is Phase 28's known `QUICKBOOKS_*` manifest gap. `no manifest entry is dead` PASSES, so the literal `process.env.PIKAR_OFFLINE_FIXTURES` read is intact. |
| `pnpm typecheck` (backend) | clean |
| `npx biome check` on the four changed TS files | clean, no fixes applied |
| playbook hook, dirty tree, read from STDOUT | blocks ONLY on `docs/playbooks/knowledge-search-routines.md` for `knowledgeLlm/knowledgeSearch` — a **sibling plan's** files, not mine. All three of my watched playbooks (`cockpit.md` via `convex/lib/models`, `production-beta.md` via `lib/env.ts`, `vault.md` via `vaultDigest.ts`) were updated and bumped in the same commit. |
| `git diff --stat HEAD -- "*.ts"` after committing | shows only the two siblings' in-flight files; none of mine. |

---

## What I left open, deliberately

1. **Copy-drift is UNGUARDED.** This is the deliverable, not an oversight. An eighth private
   `resolveModel` can be written under `convex/` and no test will see it. Upgrade path recorded.
2. **`vaultRag.ts:390`** — untouched by instruction. Still LIVE.
3. **`29-SMOKE-SEAM-DEBT.md`'s "Verification a future plan owes"** proposes "add one scan test
   asserting that no `SMOKE::`-style gate reads a value that came from a document". I did NOT delete
   that bullet — a scan CAN pin a gate it can see, which is a narrower question than the provider
   one — but I appended the ceiling to my new section: this register now holds five worked examples
   of gates a source scan could not see. Whoever writes that test should read them first.
4. **`production-beta.md` still owes its separate bump for Phase 28's `lib/env.ts` change.** Both my
   entry and the one below it say so. Not mine.
5. **Not touched, by ownership:** `llm.ts`'s false `USER_AUTHORABLE_SKILLS` claim (Item 4) and its
   repetition in `cockpit.md`'s `29-06 REMEDIATION` entry — that entry is the other fixer's subject
   and I left it byte-for-byte alone even though it sits in a file I edited.
   `knowledge-search-routines.md` and `skill-registry.md` likewise.
6. **Not re-audited:** comments elsewhere in `vaultDigest.ts` predating this wave (e.g. the recursion
   guard's "can never bump its own folder's terminalCount"). Out of the stated range
   (`d46f783..HEAD`), and I did not spend budget re-deriving old invariants.
