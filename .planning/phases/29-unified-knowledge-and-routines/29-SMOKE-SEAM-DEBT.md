# `SMOKE::` seam debt — offline fixtures are selected by in-band sentinels in content

> Written 2026-08-28 by the Phase-29 wave-2 final pass. **This is a record for a future plan, not a
> fix.** One instance (`vaultDigest.ts`) was closed in the same pass because it was cheap and
> isolated; the rest are coupled to each other and to a landed E2E, so they cannot be closed one at
> a time. Do not attempt them piecemeal — read the coupling section first.

## The design question, plainly

Every offline fixture in this repo is selected by an **IN-BAND SENTINEL IN CONTENT**: a magic string
(`SMOKE::…`) that arrives through the same channel as real user data, and whose presence chooses a
code path. The intent was "convex-test and the local backend cannot make model calls, so let a
sentinel short-circuit them". The consequence is that **whoever can write the content can choose the
code path** — and in this product a great deal of the content is written by third parties: ingested
Drive files (including files a stranger shared in), email bodies and subjects, and, on the tool-loop
sources, text the model itself composes after reading retrieved documents.

The fix, in one line: **an offline fixture must be selected by an OUT-OF-BAND OPERATOR SIGNAL — a
fact about the deployment — never by the payload.** `packages/backend/convex/lib/models.ts`
`offlineSeamAvailable()` is the shape. `voiceDoc.ts` and (as of this pass) `vaultDigest.ts` use it.

> **CORRECTION, 2026-08-28 (wave-3 cleanup).** This section previously gave the shape as
> `!OPENAI_API_KEY && !OPENROUTER_API_KEY` — the ABSENCE OF A CREDENTIAL — and that shipped as
> written. It was wrong, and worse in blast radius than the defect it replaced: a deployment that
> merely LOST its keys (never set, or blanked with `convex env set X ""`) then took the fixture path
> **unconditionally, on every call, with nobody's consent** — and silently, because a fixture
> RETURNS where the previous gate THREW at `openRouter()`. It turned a misconfiguration into
> fabricated output plus a suppressed retry. **Absence of a credential is a misconfiguration, not an
> operator's consent.** The predicate is now a POSITIVE opt-in AND-ed with that precondition:
>
> ```ts
> process.env.PIKAR_OFFLINE_FIXTURES === "1" &&
>   !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY
> ```
>
> The literal `"1"`, not "is set": `PIKAR_OFFLINE_FIXTURES=""` and a leftover `=0` are the operator
> saying no. **That value test now lives in ONE place — `lib/env.ts` `isOfflineFixtureConsent` —
> because it was briefly decided in two with two different rules** (`missingEnv().fixturesActive`
> used "non-blank", so `PIKAR_OFFLINE_FIXTURES=on` reported a LIVE fabrication seam on a deployment
> whose fixture was OFF). `lib/models.test.ts` runs a table of literal values through BOTH sites. `PIKAR_OFFLINE_FIXTURES` is registered in `lib/env.ts` `ENV_MANIFEST` at
> `tier: "fixture"`, so `missingEnv` reports it under `fixturesActive` and the readiness screen says
> out loud that a fabrication seam is live (the `FAL_FIXTURE` precedent). **A keyless deployment
> WITHOUT the flag now throws** — which is the honest answer for a backend that cannot synthesise.
> Pinned by `lib/models.test.ts`, `vaultDigest.test.ts` and `voiceDoc.test.ts`; each of the three
> was observed RED under a reversion to the credential-only gate.

This is not a hypothetical. It has already produced two shipped defects on the SAME gate:

1. `vaultDigest` gated on `safePrompt.includes("SMOKE::digest::")` — the assembled prompt carries
   every member's title and a slice of every member's text, so **one ingested document containing
   that string** turned a real folder's digest into a fixture.
2. The round-3 fix moved it to `folder.name`, justified in a code comment as "the tenant's own,
   chosen at creation". **`vaultDrive.importDriveFolder` is a `tenantAction` taking
   `name: v.string()` from the CLIENT** (`vaultDrive.ts:705`, stored at `:888` as
   `name.slice(0, 200)`), and the browser fills it from `listDriveFolders`, which lists **SHARED**
   folders whose names a third party chose. Same channel, one hop further away, and it read as safe
   for a whole round.

Both times the fabricated output was **stored as a `vaultDocuments` row and DISPLAYED to the tenant
as that folder's digest**, carrying a `ragEntryId` that reads as groundable.

> **CORRECTION, 2026-08-28 (wave-3 cleanup).** The sentence above previously read "stored, embedded
> and served back through retrieval", and that phrasing had been copied verbatim into
> `vaultDigest.ts`'s module header and `vaultDigest.test.ts`'s seam comment. **It was an
> overstatement and it is corrected rather than softened** — a false comment is the exact defect
> class this phase has spent four rounds on. What is actually true, traced: `smokeDigestFixture`
> begins its text with `SMOKE::graph::`, and the digest's own ingest calls `vaultRag.embedDoc`,
> which short-circuits on ANY `SMOKE::` prefix (`vaultRag.ts:390`) to
> `{ entryId: "smoke::<contentHash>", costUsd: 0 }`. **No vector was ever written, so the fabricated
> digest was never vector-retrievable.** The real harm was (a) a fabricated digest shown to the
> tenant as the folder's summary, with no model call, no spend and no trace that synthesis was
> skipped, and (b) a row that reads `ready` and groundable while being invisible to search — which
> is debt instance #3 below, not retrieval poisoning. Bad enough without the extra claim.

---

## The open instances

> Was "the four open instances". #5 was demoted to a footnote on an unproven argument and #6 was
> missing entirely; both were added on 2026-08-28. #6 is the only one that is NOT coupled to the
> chain below and can be closed on its own.

**SEVERITY, STATED ONCE, BECAUSE THE NUMBERING BELOW IS BY MODULE AND READS LIKE A RANKING.**
**#1, #2, #3 and #4 are LIVE AND COMPLETELY UNGATED on a fully keyed production deployment today**
— each selects its fixture from CONTENT with no operator flag anywhere in the handler, so
`PIKAR_OFFLINE_FIXTURES` does not restrain them. Converted so far: `vaultDigest.ts` and `voiceDoc.ts`
(wave-3 cleanup), `knowledgeLlm.ts` (#6, 29-06 FIX) and `vaultGround.ts` (#5, 29-FIN-06). Within
what remains, the ordering that matters is by channel, not by module:

| | Instance | Channel | Reachable today |
|---|---|---|---|
| worst | #4 `gmail.ts:370` (#5 `vaultGround.ts:48` was here and is **CLOSED**, 29-FIN-06) | a TOOL ARGUMENT the model composes, inside a tool-bearing loop whose context carries retrieved documents and inbox text — where prompt injection actually lives | yes, no id or setup needed |
| then | #1 `extractGraph`, #2 `identifyDoc`, #3 `embedDoc` | the ingested document's OWN text, so any Drive file a stranger shared in | yes, position 0 only |
| closed | #6 `knowledgeLlm` (29-06 FIX) | a `question` argument — and `knowledgeSearch.search`, a public `tenantAction`, IS the production caller now | no: gated on `offlineSeamAvailable()` |

**#3 in particular is live and ungated on a fully landed path** (`d1e8826`, 2026-07-14 — six weeks
older than this branch), and it is the one whose damage is an ABSENCE: a `ready` row with a
`ragEntryId` that reads groundable and no vector behind it. An absence is what nobody notices.

### 1. `packages/backend/convex/vaultLlm.ts:135` — `extractGraph`

| | |
|---|---|
| **Gate** | `if (safeText.startsWith(SMOKE_GRAPH_PREFIX)) return smokeGraphFixture(safeText);` (`SMOKE::graph::`) |
| **Channel that selects it** | The vault document's OWN redacted text, read from `internal.vaultLlm.getDocText`. Any ingested file — Drive import, email attachment, upload — whose first characters are `SMOKE::graph::`. |
| **What the attacker gets** | The knowledge-graph extraction for that document is not performed. `smokeGraphFixture` parses the rest of the sentinel line into `nodes`/`edges`, so the attacker **writes the graph directly**: chosen entity names and a chosen relationship, upserted by `vaultGraph.upsertGraph` into the tenant's cross-document entity graph, where they then drive `expand`'s hop-capped BFS and therefore what future retrieval pulls in as "related". Free of charge, with no model call and no trace. |
| **Blast radius** | Position 0 only (`startsWith`), so the document must BEGIN with it — a real constraint, but an imported `.txt`/`.md` file satisfies it trivially. |

### 2. `packages/backend/convex/vaultLlm.ts:265` — `identifyDoc`

| | |
|---|---|
| **Gate** | `if (safeText.startsWith(SMOKE_PREFIX)) return smokeIdentityFixture(safeText);` (bare `SMOKE::`, i.e. **broader** than #1) |
| **Channel that selects it** | Same: the document's own text — but **twice over, and the second read is `.indexOf`, not `startsWith`.** The GATE is bare `SMOKE::` at position 0; `smokeIdentityFixture` then looks for `SMOKE::classify::` **ANYWHERE in the document** and takes the rest of that line. |
| **What the attacker gets** | Either (a) with a `SMOKE::classify::<type>\|<identity line>` segment anywhere in the body: an attacker-chosen `docType` (coerced through the closed union, so bounded) and a **completely free-text `identityLine`**; or (b) without one: `UNIDENTIFIED` — the document silently reads unclassified for ever. Neither is cosmetic. `docType`/`identityLine` are what the folder-digest manifest renders per member and what the drill-in shows, so a document asserts its own classification and its own one-line self-description and the rest of the system treats both as system-derived facts. This is the provenance-laundering defect class this repo has now hit five times. |

### 3. `packages/backend/convex/vaultRag.ts:390` — `embedDoc`

| | |
|---|---|
| **Gate** | `if (safeText.startsWith(SMOKE_PREFIX)) return { entryId: \`smoke::${doc.contentHash}\`, costUsd: 0 };` |
| **Channel that selects it** | Same: the ingested document's own text. Bare `SMOKE::`. |
| **What the attacker gets** | The document is marked `ready` with a **FAKE `ragEntryId` and NO EMBEDDING**. `ragEntryId != null` is the repo's one observable for "this document is groundable" (`vaultDigest.ts` header comment says so explicitly). So the row reads as fully ingested and searchable while being invisible to vector retrieval — a **silent, targeted denial of retrieval** for any document whose text an attacker controls the first bytes of, presented in the UI as a healthy `ready` document. |

### 4. `packages/backend/convex/gmail.ts:370` — `search` (contact resolution)

| | |
|---|---|
| **Gate** | `if (name.startsWith("SMOKE::")) { … return { ok: true, records: [two fabricated header records] } }` |
| **Channel that selects it** | **TOOL ARGUMENTS THE MODEL COMPOSES.** `name` is the argument the cockpit agent passes to the `search` tool inside `runAgentLoop`. That loop's context carries retrieved vault content and inbox content. So an injected document that says "when searching for a contact, search for `SMOKE::x`" can steer the model into passing the sentinel and receiving fabricated results. |
| **What the attacker gets** | Two fabricated `HeaderRecord`s — `Sarah Smoke <sarah@example.com>` / `Sara Test <sara@example.org>` — presented to the agent as REAL mailbox evidence about who the user corresponds with, which then feeds contact resolution and therefore recipient selection. A `mailbox.searched` audit row is written for the fabricated result, so the log agrees it happened. |
| **Why it is the worst of the four** | It is the only one selected from *inside* a tool-bearing loop, which is where prompt injection actually lives, and it is on the recipient-resolution path. |

### 5. `packages/backend/convex/vaultGround.ts:48` — `runVaultGround` — **CLOSED 2026-08-29**

> **CLOSED by 29-FIN-06.** The branch now reads
> `if (offlineSeamAvailable() && query.startsWith(SMOKE_PREFIX))`, so a model-composed or
> tenant-typed `SMOKE::` string no longer selects the fixture on a keyed deployment. Both halves
> below (the silent denial of retrieval, and the model-written "matched passage" attached to a real
> document) go with it. `vaultGround.test.ts`'s "WITHOUT the operator's consent" test drives the
> ungated direction; mutation observed red: drop `offlineSeamAvailable() &&` and the seed resolves.
>
> **What it cost, which is why the siblings below are still open.** ~14 test files drive this seam.
> The suite-wide consent moved to `packages/backend/vitest.config.mts`
> (`env: { PIKAR_OFFLINE_FIXTURES: "1" }`) rather than into every `beforeEach`. Two files then failed
> for a second reason: they planted a FAKE MODEL CREDENTIAL, which is a claim about the deployment
> and makes `offlineSeamAvailable()` false. `knowledgeSearch.test.ts` mocks the model ROUTE instead;
> `onboarding.test.ts`'s uncleaned `process.env.OPENAI_API_KEY = FAKE_KEY` is deleted. **Any future
> conversion should expect that shape of collision, not a per-call one.**
>
> **NOT closed by this:** `vault.ts`'s `vaultSearch` keeps its own bare `query.startsWith("SMOKE::")`
> (~`:729`), and it is E2E-coupled — `apps/web/e2e/vault-redesign.spec.ts` types those sentinels into
> the search box against a REAL KEYED deployment, where `offlineSeamAvailable()` is false by
> construction. It is the sibling instance this register's coupling warning is about.
>
> **The original entry, kept because the analysis is what made the case:**
>
> **RE-VERIFIED 2026-08-28 (wave-3 cleanup fix): this entry was accurate as written.** A model-composed
> `SMOKE::` tool argument silently disables vault grounding for the turn — half (a) needs no valid id
> and is reachable today; half (b) is still marked NOT VERIFIED and still is not.
>
> **PROMOTED FROM "not classified as debt" ON 2026-08-28.** It was excluded on the grounds that "the
> content is the caller's own upload/query in the same request rather than a third party's stored
> document". **That is the same justification that was proven wrong twice on the digest gate, and it
> is wrong again here.** It was not re-derived last time; it was re-used. Traced this time, every
> writer of `query`:
>
> | Caller | Where `query` comes from |
> |---|---|
> | `llm.ts:3792` `searchVault` tool `execute({ query })` | **A TOOL ARGUMENT THE MODEL COMPOSES** (`inputSchema: jsonSchema<{ query: string }>`, `llm.ts:3784`), inside `runAgentLoop`, whose context carries retrieved vault content and inbox content. |
> | `blueprint.ts:547` | Server-composed profile queries. |
> | `evaluations.ts:295` | Server-composed, from a validated arg. |
>
> One of the three is **the same channel as instance #4** — the one this register calls "the worst of
> the four", because it is where prompt injection actually lives. "The caller" is the model.

| | |
|---|---|
| **Gate** | `if (query.startsWith(SMOKE_PREFIX)) { … }` (bare `SMOKE::`), which bypasses `rag.search` entirely and takes the seed doc ids out of the sentinel. |
| **Channel that selects it** | The `query` argument — which on the `searchVault` path is model-composed (see above). |
| **What the attacker gets** | Two things. (a) **A silent denial of vault retrieval, needing no valid id at all**: an injected document that steers the model into passing a `SMOKE::` query makes `searchVault` skip the vector search and answer from an empty seed set, so the turn is ungrounded and reads as "nothing in your vault about that". (b) With a docId the loop can reach, the `SMOKE::<docId>\|<passage>` form attaches a **MODEL-WRITTEN "matched passage"** to a REAL tenant document, which is then rendered inside the `<vault_context>` fence under that document's title and recorded on the `vaultSources` content-plane row behind the SourceCard. That is the provenance-laundering class this repo has now hit repeatedly: the model writes the text and the citation UI attributes it to the user's own document. |
| **Not in scope** | Tenant isolation holds either way — seeds are resolved through `internal.vault.ownedDocsMeta`, which silently drops foreign ids, so this buys nothing cross-tenant. **NOT VERIFIED HERE:** whether a real `vaultDocuments` id is reachable from inside the tool loop, which is what half (b) needs. Half (a) needs nothing and is reachable today. A future plan must trace it rather than assume either way. |

### 6. `packages/backend/convex/knowledgeLlm.ts:333/…` — `planKnowledgeSearch` / `synthesizeKnowledge`

> **ADDED 2026-08-28.** It was absent from this register although it breaks the register's own stated
> rule, and its module docstring (`knowledgeLlm.ts:88-97`) argues the exclusion explicitly:
> *"The `question` is the caller's own argument, so keying on it puts the seam back under the
> operator."* **A caller's argument is a payload, not a fact about the deployment.** The docstring is
> right that scanning the assembled prompt would have been far worse (it embeds `Evidence.text` and
> `Evidence.label` — inbound email bodies and subject lines, so any remote sender could have selected
> the code path). Narrowing to `question` was a real improvement. It is not the rule.

| | |
|---|---|
| **Gate** | `if (question.includes(SMOKE_PLAN_PREFIX))` (`:333`) and the matching `SMOKE::knowledge-synth::` gate in `synthesizeKnowledge`. `SMOKE::knowledge-plan::FAIL` additionally drives the real `catch`. |
| **Channel that selects it** | The `question` argument. Whether that is operator-controlled depends entirely on a caller that **does not exist yet** — as of this commit the only references outside the module are in `skills.test.ts:913-914`. |
| **Why it is here** | It is the ONE instance that is cheap to close, because it has no production caller and no E2E driving it, so it is NOT part of the coupled chain below. `offlineSeamAvailable()` applies verbatim: `flag && content`, the flag as the authority and the sentinel retained only as the fixture SELECTOR (the shape this document's closing section proposes). Doing it before the wave-3 coordinator wires a caller is strictly cheaper than after. |
| **Also owed** | The docstring's "puts the seam back under the operator" claim must go with the fix — it is a comment asserting an invariant nothing enforces. |

**Also present, not classified as debt here:** `intake.ts:69/111` and `vaultExtract.ts:389`
(`SMOKE::transcribe::` / `SMOKE::extract::` over uploaded BYTES). These select on content too. Their
exclusion rests on a claim that has NOT been re-traced in this pass and should be treated as
unproven: that the bytes are the caller's own upload in the same request. **A future plan must trace
every writer of those bytes before relying on it** — that is exactly the step whose omission produced
instance #5. They are named because any conversion has to move them together with #1-#4 above.

---

## Why these cannot be closed in isolation

They form one chain, and the chain is driven by a landed E2E against a REAL, KEYED deployment.

- **The offline vault ingest chain is sentinel-to-sentinel.** `vaultDigest`'s fixture is *required*
  to start with `SMOKE::graph::` (there is a ⚠ comment on `smokeDigestFixture` saying so), because
  the digest is itself ingested and that ingest calls `vaultRag.embedDoc` (free on any `SMOKE::`)
  and `vaultLlm.extractGraph` (free on `SMOKE::graph::` at position 0). Convert `embedDoc` or
  `extractGraph` to an operator flag and every offline folder-digest test starts paying for a real
  embedding and a real extraction — **including on a keyed dev deployment, where an operator flag is
  false by definition.**
- **`apps/web/e2e/vault.spec.ts` deliberately drives these sentinels against a keyed deployment.**
  `BRAIN_DUMP = "SMOKE::graph::Alice|Acme|works_at"` (`:24`), plus
  `"SMOKE::extract::SMOKE::graph::Alice|Acme|works_at"` (`:171`) and
  `"SMOKE::transcribe::SMOKE::graph::Bob|Initech|works_at"` (`:183`). The spec's own header explains
  the intent: `SMOKE::` skips the embedding network so no OpenAI key is needed, and `SMOKE::graph::`
  makes extraction deterministic. A naive `offlineSeamAvailable()` gate **breaks this landed E2E on
  day one**, because the deployment it runs against has keys.
- **`packages/backend/scripts/run-smoke-vault.mjs` (`pnpm smoke:vault`)** is the dev-deployment
  counterpart and has the same property.
- **The cockpit E2E suite drives a parallel `SMOKE::agent::` grammar** (`cockpit-activity`,
  `cockpit-briefing`, `cockpit-attachment`, `cockpit-personalize`, `cockpit-created-document`,
  `cockpit-resolve`, `cockpit-report`) which short-circuits into `invokeTool` — the same design, on
  the same deployment, and `gmail.ts:370` sits inside it.

So closing this needs **one plan that converts the seam AND re-drives the E2E + smoke scripts**, not
four small fixes.

## What a real fix probably looks like (not decided — for the future plan to decide)

The E2E needs a *deployment-scoped, operator-set* offline switch rather than a content sentinel:
a deployment env var (e.g. `PIKAR_OFFLINE_FIXTURES=1`) that the E2E deployment sets and production
never does, with the sentinel retained ONLY as the fixture SELECTOR once that switch is on
(`flag && content` — the flag is the authority, the string only picks which fixture). That keeps the
E2E's determinism and its ability to name a specific fixture, while making every gate unreachable on
any deployment an attacker can reach. The digest seam did not need the second half at all, which is
why it could be converted alone.

> **UPDATE, 2026-08-28 (wave-3 cleanup) — the env var now EXISTS, and it will not work here as-is.**
> `PIKAR_OFFLINE_FIXTURES` is real and registered in `ENV_MANIFEST`, but `offlineSeamAvailable()`
> ANDs it with "neither model key is set" (see the correction at the top of this document — the
> credential half is a second belt against an accidental flag on a keyed deployment). **The E2E and
> `pnpm smoke:vault` run against a KEYED deployment, so `offlineSeamAvailable()` is `false` there by
> construction and cannot be the `flag` half of `flag && content` for instances #1-#4.** The future
> plan needs a SEPARATE, flag-only predicate for the chain — and must then answer, explicitly, why
> that weaker predicate is acceptable on a deployment that has credentials. Reusing
> `offlineSeamAvailable()` here without noticing this will produce a chain that is dead offline and
> looks fine in a unit suite. That is the whole class of failure this document exists for.

The alternative — a mock model provider behind `lib/models.ts` — deletes the sentinels entirely and
is the cleaner end state, but it is a much larger change and it moves the E2E's assertions from
"deterministic fixture text" to "whatever the mock returns".

## Verification a future plan owes

- Every gate above must go RED under a mutation that reverts it to content selection.
- `apps/web/e2e/vault.spec.ts` and `pnpm smoke:vault` must be RE-RUN against a real deployment, not
  reasoned about. A green unit suite proves nothing here: the whole point is that these paths are
  exercised offline.
- Add one scan test asserting that no `SMOKE::`-style gate reads a value that came from a document,
  a request argument or a tool argument — otherwise the next one walks straight back in, exactly as
  it did between rounds 2 and 3.

---

## Second debt, same shape: COPY-DRIFT OF THE MODEL ROUTE TABLE IS UNGUARDED (29-FIN-W2, 2026-08-29)

Not a `SMOKE::` seam, but it lives here because it is the same class of entry: a hazard this phase
decided NOT to close, recorded so the next reader does not mistake a green suite for protection.

**The hazard.** `resolveModel` existed as SEVEN private copies across `convex/`, and only `llm.ts`'s
ever grew the `or/` branch, so every other copy handed the OpenRouter route id `DEFAULT_MODEL`
(`or/openai/gpt-4o-mini`) to the OpenAI provider — a different endpoint with a different key, failing
silently wherever the caller catches. All seven were converted to `convex/lib/models.ts` on
2026-08-28. **Nothing prevents an eighth copy being written tomorrow.**

**What was tried, and what beat it.** `lib/models.test.ts` carried a source-text scan through five
iterations. Every one was defeated, and every escape was RUN as a real module planted under
`convex/` that left the whole suite green:

| # | The guard | The escape that beat it |
|---|---|---|
| 1 | grep the source for `resolveModel(` | `const pickModel = (id) => openai(...)` — a rename |
| 2 | a call-shape regex over provider callee spellings | `createOpenAI({…})(id)` (the char before `(` is `)`) and `const P = createOpenAI({…}); P(id)` (a local alias) |
| 3 | a provider-package IMPORT regex anchored on the closing quote | `import { OpenAIChatLanguageModel } from "@ai-sdk/openai/internal"` — a DOCUMENTED subpath export shipping the raw model class |
| 4 | an export-surface pin enumerating the export spellings it feared | `export default openai;` (also `export async function`, `export let`, `export class`) |
| 5 | the rewritten export pin, `/^export\b/` per line | LEADING WHITESPACE before `export` |

**Why a sixth was not written.** The question "does any module hold a private route table?" is not
decidable by a pattern over source text. A provider is reachable through a renamed binding, an
arbitrary subpath specifier, a non-literal specifier (`import("@ai-sdk/" + "openai")`), any export
spelling — and, needing no provider package at all, RAW HTTP. This repo already does the last one on
a fully landed path: `vaultRag.ts`'s `embeddingV2` (~:230-270) picks provider label, env-key NAME and
endpoint URL from a runtime decision and calls `fetch`, holding zero provider imports. So "no module
holds a private route table" was never true of this codebase, and no regex was going to make it true.

**What was done instead.** The scan tests were DELETED (29-FIN-W2). `lib/models.test.ts` keeps only
behavioural assertions — that `resolveModel` routes `or/` and `stealth/` to the OpenRouter provider
with the right `modelId`, bare/`openai/` ids to OpenAI, and throws on `google/` — plus the
offline-fixture consent table. Those assert `.provider`/`.modelId`, the values the AI SDK sends with.

**THE GAP, STATED:** an eighth private copy of the route table can be added under `convex/` and no
test will see it. The behavioural tests say where THIS table routes; they say nothing about who else
routes. An acknowledged gap is worth more than a tripwire that reads as protection and is not.

**What closing it would take:** an AST or type-level pass (or a lint rule) that RESOLVES BINDINGS —
"which module-level value does this call expression ultimately reference, and is it a provider
export?" — rather than a pattern over text. That is the upgrade path; it was not in this phase's
budget. The same ceiling applies to the "one scan test" proposed in the section above: a source scan
can pin a gate it can SEE, and this register now holds five worked examples of gates it could not.

**Re-verified for this entry (2026-08-29):** `vaultRag.ts:390` still reads
`if (safeText.startsWith(SMOKE_PREFIX)) return { entryId: \`smoke::${doc.contentHash}\`, costUsd: 0 };`
with `SMOKE_PREFIX = "SMOKE::"` defined at `:368`, and `vaultRag.ts` contains no reference to
`offlineSeamAvailable` or `PIKAR_OFFLINE_FIXTURES`. Instance #3 above is accurate and remains **LIVE**.
