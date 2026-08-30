---
phase: 29-unified-knowledge-and-routines
plan: 03
subsystem: knowledge-adapters
tags: [knowledge-search, gmail, hubspot, crm, toolless-firewall, prompt-injection, tenant-isolation, mutation-testing]

# Dependency graph
requires:
  - phase: 29-01
    provides: "KNOWLEDGE_SOURCES / KnowledgeSourceState / Evidence / SEARCH_CAPS / authorityFor / validateSourceRef / clampSearchPlan — the contracts these adapters terminate in"
  - phase: 03-cockpit
    provides: "gmail.ts — freshAccessToken (the one non-throwing token root), pickPlainText, toHeaderRecord, the inboxFixtures seam"
  - phase: 28-05
    provides: "convex/hubspot.ts readHubSpotDataset + @pikar/revenue Projection<HubSpotRow> — the LANDED toolless CRM read. This is the fact that changed the plan: 29-01 recorded crm-facts as not_landed and it no longer is."
provides:
  - "packages/backend/convex/knowledgeExternalSources.ts — readInboxKnowledge, readCrmKnowledge, EXTERNAL_KNOWLEDGE_READERS, unavailableResult/answeredResult, CRM_UNAVAILABLE_REASON"
  - "packages/backend/convex/gmail.ts — escapeGmailQuery + knowledgeQuery, a fifth GET-only read verb separate from the contact resolver"
  - "packages/core/src/knowledgeSearch.ts — KNOWLEDGE_ADAPTERS (the search plane's own landedness determination) and the searchable-term planner boundary"
affects: [29-04 toolless llm, 29-06 coordinator, 29-08 pinned rerun]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider-query escaping NEUTRALIZES operator characters to spaces rather than dropping the token — every word the planner wrote survives, no operator it could have built does"
    - "A landedness registry stores a MODULE PATH + VERB, not a boolean, so a pure package's claim is falsifiable by a test that can read files"
    - "Two planes may answer different questions about the same source and disagree; the disagreement is pinned in both directions rather than smoothed away"
    - "Evidence text COMPOSED IN CODE from structured provider fields, so there is no vendor free text to redact"
    - "unavailableResult is the ONLY constructor of an unreachable state and always carries zero rows — the honesty rule made structural rather than reviewed"

key-files:
  created:
    - packages/backend/convex/knowledgeExternalSources.ts
    - packages/backend/convex/knowledgeExternalSources.test.ts
    - .planning/phases/29-unified-knowledge-and-routines/deferred-items.md
  modified:
    - packages/backend/convex/gmail.ts
    - packages/backend/convex/gmail.test.ts
    - packages/core/src/knowledgeSearch.ts
    - packages/core/src/knowledgeSearch.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/watch.json

key-decisions:
  - "crm-facts is now SEARCHABLE and still has NO pack read tool. The search plane got its own landedness registry (KNOWLEDGE_ADAPTERS) instead of deriving from MISSING_PACK_SOURCES; moving crm-facts to REACHABLE_PACK_SOURCES was rejected because it would silently reverse owner decision A."
  - "The Gmail knowledge read returns NO sender at all — strictly tighter than the landed BODY-scoped firewall, which admits senders and subjects to the tool loop today."
  - "The knowledge adapters write to NO governance plane at all (no audit, telemetry, dead letter or agentSteps). The one refs-only knowledge.searched event is the 29-06 coordinator's."
  - "A query with no letter or digit is refused at the PLANNER boundary (clampSearchPlan empty_query), so the adapters' fail-closed guards are unreachable in the product rather than load-bearing."
  - "A backtick was removed from GMAIL_OPERATOR_CHARS: it carries no Gmail query meaning and it blinded skills.test.ts's hardcoded-prompt scan for the whole file."
  - "No new UNAVAILABLE_REASON was added. The one genuinely unnamed state (an unbuildable query) was closed at the planner boundary instead, which cost one line and no schema-vocabulary change."

patterns-established:
  - "A bidirectional landedness tripwire: a source declared landed must have a module+verb on disk, and a reader must not exist for a source still called not_landed."
  - "Injected-instruction fixtures assert the payload IS carried into evidence text and IS ABSENT from all four governance tables — refusing to read hostile content would just make the product blind."

requirements-completed: []

# Metrics
duration: 60min
completed: 2026-08-28
---

# Phase 29 Plan 03: External Knowledge Adapters (Gmail + the landed CRM) Summary

**Gmail and the now-landed HubSpot CRM are readable as bounded, tenant-scoped, honestly-unavailable knowledge evidence — and the search plane stopped borrowing the workflow-pack plane's answer to a question the two planes do not share.**

## Performance

- **Duration:** ~60 min (2026-08-28T00:17Z → 01:17Z)
- **Tasks:** 2 of 2
- **Commits:** 2 task commits + this summary
- **Files:** 3 created, 9 modified

## Task commits

1. **Task 1 — the metadata-first Gmail knowledge query** — `783cf13`
2. **Task 2 — the landed CRM read + the search plane's own landedness** — `24d9c82`

## What was built

### Task 1 — `gmail.knowledgeQuery` and the inbox adapter

A **fifth GET-only read verb** in `gmail.ts`, deliberately separate from `search`. `search` resolves
a contact: it asks `from:/to:` about a name and never fetches a body. `knowledgeQuery` asks a
free-text business question and exists to fetch bodies, because a body is what the toolless
synthesis reads. Merging them would give the contact resolver a standing reason to hydrate bodies
it has never needed.

- **`escapeGmailQuery` is the security boundary.** Every character that carries Gmail
  search-operator meaning (`:` — which is what makes `from:`, `label:`, `has:`, `in:`, `is:`
  operators at all — plus quotes, brackets, angle brackets, backslash, CR/LF/TAB) is **neutralized
  to a space, not dropped with its token**, so every word the planner wrote survives and no
  operator it could have built does. A leading `-`/`+` is stripped per token (Gmail's
  exclude/require prefixes — a phrase starting with a dash would silently invert the search) and
  bare uppercase `OR`/`AND` are dropped. URL encoding does not protect this boundary: Gmail decodes
  `q` before parsing operators, the same trap `escapeDriveQueryLiteral` exists for.
- **Bounds:** 25 ids listed (`maxResults`), 5 bodies hydrated, each truncated to
  `SEARCH_CAPS.evidenceTextCharCap` (1500). Listing wide and reading narrow is what makes it
  "metadata first" rather than "download the mailbox".
- **Never throws on a governed state:** `not_connected` / `reauth` come back as data. It DOES throw
  on a query that escapes to nothing, because listing on an empty `q` returns arbitrary recent mail
  — an answer about messages nobody asked about — and no governed state truthfully describes "we
  could not build a query".
- **No audit row**, unlike `search` (`mailbox.searched`) and `listInbox` (`mailbox.listed`).
- **No sender field exists** on the returned shape.
- The `inboxFixtures` seam is checked **before** the token, and the fixture path **filters on the
  escaped terms** — a seam that answered every question with the whole fixture would make every
  offline assertion built on it vacuous.

`knowledgeExternalSources.readInboxKnowledge` maps that read into `@pikar/core`'s contract:
`unavailableResult` is the only constructor of an unreachable state and always returns zero rows
with it; `answeredResult` is `partial` whenever a further provider page, the hydration cap, a
truncated body or a dropped malformed ref lost coverage.

### Task 2 — the CRM, and the landedness question

**`readCrmKnowledge`** adapts the landed `hubspot.readHubSpotDataset`:

- Probes `production` then `sandbox` — a sandbox grant is a different row, and an unconnected
  environment costs no network call because `ensureHubSpotAccessToken` answers from the row lookup.
- The credential layer's closed reason set is mapped through a **closed record** onto the search
  plane's enum (`revoked` → `reauth`), with an unrecognised value failing closed to
  `provider_error`. The provider's own `because` / `missing` strings are **never forwarded** — that
  field reaches a stored row (CLAUDE.md §4).
- **Evidence text is composed in code** from ids, opaque stage keys, timestamps and a money figure.
  `HUBSPOT_DEAL_PROPERTIES` never asks HubSpot for `dealname`, a name, an email or a phone, so
  there is no vendor free text to leak *even when the provider volunteers one* — the test plants a
  prompt injection in `dealname` and proves it cannot appear.
- An unrecorded amount is **unknown, never zero**.
- The planner's query is **deliberately not forwarded**: `HUBSPOT_READ_PATHS` has no search
  endpoint (CRM Search carries its own rate limit and its own decision, 28-05), so a CRM knowledge
  read is a 90-day windowed list of the 8 most recently updated deals, and the synthesis model
  filters them.

**The landedness question (this plan owned it).** `NOT_LANDED_SOURCES` was derived from
`MISSING_PACK_SOURCES`, which conflated two different questions:

| plane | question | `crm-facts` | `support-desk` |
|---|---|---|---|
| pack | is there an agent-reachable read **TOOL**? | **no**, by binding owner decision A (2026-08-23) | no |
| search | is there a landed **toolless adapter**? | **yes**, since Phase 28's `hubspot.ts` merged | no |

The fix is a search-plane-owned registry, `KNOWLEDGE_ADAPTERS`, mapping each source to the module
and verb that reads it (or `null`). `NOT_LANDED_SOURCES` derives from that. It stores a **module
path and a verb rather than a boolean**, because a boolean would be a claim with nothing to check
it — `knowledgeExternalSources.test.ts` reads those paths off disk and fails if a source is
declared landed with no module or no exported verb behind it, and fails the other way if a reader
lands for a source still called `not_landed`.

**`crm-facts` was NOT moved into `REACHABLE_PACK_SOURCES`** — that would silently reverse the owner
decision and tell every workflow pack a CRM tool exists. `support-desk` stays not-landed on both
planes. The disagreement is pinned in both directions by tests in both packages, with the mutation
for each recorded below.

`clampSearchPlan` also now refuses a query with no letter or digit as `empty_query`. That is what
keeps `knowledgeQuery`'s fail-closed throw unreachable through the product path rather than
load-bearing.

## Verification — the CORRECTED commands, with real output

The plan's two gate commands are **no-ops as written** and were not run that way.
`pnpm --filter @pikar/backend test -- <filters>` swallows the `--` so no filter reaches vitest;
`node scripts/check-playbooks.mjs` run bare hangs on stdin and signals failure by PRINTING.

| Command | Result | Baseline (post-merge) |
|---|---|---|
| `cd packages/backend && pnpm vitest run` | **109 files / 2905 passed, 1 failed** — `convex/env.test.ts` only, the KNOWN imported red | 107 / 2829, same 1 failure. +2 files = mine and 29-02's; +76 tests = my 45 and 29-02's 31 |
| `cd packages/backend && pnpm vitest run gmail knowledgeExternalSources` | **2 files / 87 passed** (57 + 30) | new: +15 gmail, +30 adapter |
| `cd packages/backend && pnpm vitest run schema knowledgeExternalSources gmail skills llmRedaction isolation` | **7 files / 372 passed** | Task 2's gate, corrected |
| `cd packages/backend && pnpm typecheck` | **clean** | was RED before this plan — see deviation 1 |
| `cd packages/core && pnpm vitest run` | **45 files / 1422 passed** | 45 / 1419 (+3 = exactly this plan) |
| `cd packages/core && pnpm vitest run knowledgeSearch workflowPacks` | **134 passed** | 131 before |
| `cd packages/core && pnpm typecheck` | clean | — |
| `cd packages/contracts && pnpm vitest run` | 6 / 93 passed | 6 / 93 — unchanged |
| `cd packages/revenue && pnpm vitest run` | 6 / 226 passed | 6 / 226 — unchanged |
| all four `pnpm typecheck` | clean | — |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **empty stdout on the DIRTY tree = PASSED** (exit code not read) | — |
| `npx biome check` on the 8 changed files | `No fixes applied`, 9 warnings — all `noNonNullAssertion` at `gmail.test.ts:250-626`, i.e. the PRE-EXISTING half of the file, none in my additions | — |
| `git diff --stat HEAD -- "*.ts"` after each commit | **empty** — the HEAD tree is the tree every gate ran against | — |

**Per-file, as required:** `convex/env.test.ts` is the only failure and it is the documented
imported red (`quickbooksAuth.ts` reads three `QUICKBOOKS_*` names `ENV_MANIFEST` does not
classify; 28-06 is mid-plan). `convex/media.test.ts` failed once inside a full run and once in
isolation, then passed **266/266 three consecutive times** in isolation — a second load-flaky file
beside `vaultDigest.test.ts`, logged to `deferred-items.md`, untouched by this plan.

## Mutations applied, observed RED, reverted — 24 of 25

Each was applied to the implementation, the suite was run, the failure was observed, and the file
was restored. `git diff --stat` was clean after each batch.

### Task 1 — Gmail (7)

| ID | Mutation | Result |
|---|---|---|
| M1 | the operator-neutralization `.replace` removed, so `from:`/`label:` reach Gmail | RED (5) |
| M2 | the empty-query throw replaced by an empty SUCCESS | RED (1) |
| M3 | hydration widened from the body cap to the whole list | RED (2) |
| M4 | per-body truncation removed | RED (2) |
| M5 | `nextPageToken` ignored, so a further page is silently dropped | RED (2) |
| M6 | the fixture filter made total, so the seam answers every question with every message | RED (1) |
| M12 | the list cap raised 25 → 500 | RED (1) |

### Task 1 — the inbox adapter (6)

| ID | Mutation | Result |
|---|---|---|
| M7 | `unavailableResult` rewritten as `{status:"available", returned:0}` | RED (3) |
| M8 | the partial state forced to `null`, so a lossy read reports a full one | RED (4) |
| M8b | only the hydration cap counts as loss; a further page and a truncated body stop counting | RED (2) |
| M9 | the `validateSourceRef` guard removed, so a content-shaped "ref" is stored | RED (1) |
| M10 | authority hardcoded to `tenant_owned` instead of the code-owned table | RED (1) |
| M11 | a reader added for `support-desk`, which has no adapter | RED (1) |

### Task 2 — the two planes and the planner boundary (5)

| ID | Mutation | Result |
|---|---|---|
| C1 | `NOT_LANDED_SOURCES` hand-written back to `["crm-facts","support-desk"]` | RED (4) |
| C2 | derived from `MISSING_PACK_SOURCES` again — the conflation restored | RED (4) |
| C3 | `KNOWLEDGE_ADAPTERS["crm-facts"]` nulled while `hubspot.ts` exists | RED (3) |
| C4 | the searchable-term guard relaxed to "any character" | RED (1) |
| C5 | `crm-facts` deleted from `MISSING_PACK_SOURCES` — owner decision A reversed | RED (2) |

### Task 2 — the CRM adapter (7)

| ID | Mutation | Result |
|---|---|---|
| B1 | `support-desk` declared landed at `convex/zendesk.ts`, which does not exist | RED (3) |
| B2 | the `crm-facts` verb renamed to one `hubspot.ts` does not export | RED (1) |
| B3 | the credential layer's raw `revoked` forwarded onto the stored enum | RED (1) |
| B4 | the per-source evidence cap removed | RED (1) |
| B5 | an unknown money figure rendered as `0.00 USD` | RED (1) |
| B9 | the CRM partial state forced to `null` | RED (2) |
| B11 | the sandbox probe dropped, so a sandbox-connected tenant reads as unconnected | RED (1) |

### The one that was NOT a mutation, recorded rather than counted

My first `M8` prepended a `false ? … :` arm to the partial-reason chain, which **preserved the
original chain** and left the suite 13/13 green. That is a no-op edit, not a surviving mutation —
it proves nothing about the tests. It was replaced by the real `M8` (force `lost` to `null`) and
`M8b`, both of which went RED. Recorded because a mutation that does not change behaviour reported
as "green" is exactly how a mutation battery lies about its own coverage.

### One assertion with NO red mutation behind it, stated plainly

**"THE PLANNER'S QUERY NEVER REACHES A HUBSPOT REQUEST"** could not be turned red by any mutation I
could construct, because `readHubSpotDataset` has no parameter that would carry a query and adding
one is a typecheck error. It is a tripwire against a future change, not proven coverage of a
current risk. It is non-vacuous in one respect only: it asserts at least one provider call happened
before scanning the calls.

## Deviations from the plan

### Auto-fixed

**1. [Rule 3 — blocking] `pnpm typecheck` was RED in `packages/backend` before this plan.**
`quickbooksAuth.ts` exists on this branch but was never added to the generated
`convex/_generated/api.d.ts`, so `quickbooks.test.ts` failed with 20 `TS2339` errors. I could not
report a green typecheck without either fixing it or reporting it red. Fixed by adding the two
lines codegen would produce (a generated file; a real `convex dev` run regenerates both). My own
module needed the same registration, and 29-02's `knowledgeVaultDrive` entry was already present in
the working tree. **Commit `783cf13`.**

**2. [Rule 1 — bug] A backtick in `GMAIL_OPERATOR_CHARS` blinded a §5 guard for the whole of
`gmail.ts`.** `skills.test.ts`'s "no long inline prompt string literals" scan went from 0 offenders
to 3, the longest a 1714-char span. Its string matcher is a regex, not a tokenizer, so a lone
backtick in source opens a template-literal span it cannot close and everything after it goes
unscanned for a hardcoded prompt. A backtick carries no Gmail query meaning, so neutralizing it
bought nothing. Removed, with the reason in a JSDoc block and in `cockpit.md`. The scan's own header
already records this bug class for `//` and for apostrophes; this is the third instance and the
first from the source side rather than from prose. **Commit `24d9c82`.**

**3. [Rule 2 — correctness] `packages/backend/convex/schema.ts` carried a claim my change
falsified.** Its `knowledgeSource` doc comment said `crm-facts` and `support-desk` "have NO landed
adapter". Comment-only edit; `schema.ts` is under `watch._unassigned`, so no playbook bump was
required. Out of the plan's declared `files_modified` and recorded here for that reason.

### Judgement calls beyond the plan text

**4. No new `UNAVAILABLE_REASON` was added.** An escaped query that empties out has no honest name
in the closed set — `unplanned` would misattribute it to the planner, `provider_error` would blame
HubSpot/Google. Adding `unsearchable_query` was the honest option and would have flowed into the
schema for free (the enums are derived), but it would also have forced an edit to
`schema.test.ts:811`'s `[6, 2]` length literal — a 29-01 file two other live plans run against.
Instead the state was closed at the **planner boundary** (`clampSearchPlan` refuses a query with no
letter or digit as `empty_query`, reusing an existing reason) and the adapter's guard became a
fail-closed throw that is unreachable through the product. One line, no vocabulary change, no
cross-plan file touched.

**5. The CRM read is `deals` only.** `owners` and `dealPipelines` are configuration, `contacts` and
`companies` carry only timestamps — none answers a business question. Recorded as a `ponytail:`
ceiling with the upgrade path.

**6. `workflowPacks.ts` was NOT edited**, although the addendum permits it. The divergence is
documented at the site that diverges (`KNOWLEDGE_ADAPTERS`) and pinned by tests in both packages.
Editing it for a cross-reference comment would have forced a `docs/playbooks/workflow-packs.md`
"Last verified" bump — certifying a diff for a subsystem I did not otherwise change.

**7. The inbox adapter returns no sender.** Stated as a `ponytail:` ceiling: an answer cannot say
"Sarah said X". This is deliberately **tighter** than the landed BODY-scoped firewall, which admits
sender display names and subject lines into today's tool-bearing briefing loop. That boundary is
named in `gmail.ts`, in `knowledgeExternalSources.ts`, in both playbooks and here — it was not
papered over and it was not widened.

## Changes another plan owns, left undone

- **Nothing calls these adapters.** `EXTERNAL_KNOWLEDGE_READERS` exists and is scanned, but the
  coordinator that would run the readers under `Promise.allSettled`, merge with 29-02's vault/drive
  adapter, write the `knowledgeSearches` row and emit the one refs-only `knowledge.searched` event
  is **plan 29-06's**. Until it lands, no user can reach any of this.
- **29-04 owns the toolless synthesis.** These adapters return `Evidence` whose `text` is untrusted
  content destined for a toolless call that does not exist yet. 29-04 must put it in
  `convex/knowledgeLlm.ts` (not `llm.ts` — see the addendum's correction) and must extend
  `llmRedaction.test.ts`, which I may run but not edit; I did not edit it.
- **`clampEvidence` is not called by these adapters.** They pre-fit their output to `SEARCH_CAPS`,
  but the admission boundary is the coordinator's to cross once, over the merged evidence from all
  sources — calling it per-source would report a per-source cap as a whole-run one.
- **`groundedSourceProps` has no non-vault renderer.** A CRM ref now genuinely reaches `nonVault`;
  the UI affordance is a later plan's (invariant 21 of the playbook).

## Honest limits of what was proven

- **Nothing ran against a live deployment.** No `convex dev`, no `convex run`, no Gmail, no HubSpot,
  no OpenAI, $0 spent. Every number above came from `convex-test` with a stubbed `fetch`.
- **The `not_connected` → `sandbox` probe was proven with a real consent flow**, but a tenant
  connected to BOTH environments reading production first is asserted only by construction (the
  ordered constant), not by a test.
- **Top-8 CRM selection ORDER (most recently updated) has no test.** Only the count and the
  `partial` state are asserted. A mutation removing the sort would survive.
- **`escapeGmailQuery` is not a Gmail-query parser.** It is a character-class neutralizer; it
  guarantees no operator character survives, not that the resulting phrase ranks well.
- **`docs/playbooks/production-beta.md`'s pending bump is PRE-EXISTING and was not touched.** The
  playbook gate did not name it during this session (its baseline is this session's HEAD, and
  `lib/env.ts` was unchanged within it). Bumping a "Last verified" line certifies a diff I did not
  read.
- **STATE.md and ROADMAP.md were NOT updated.** This ran in the shared Phase-29 worktree beside two
  concurrent plans; `.planning/STATE.md` is another lane's live surface. The orchestrator should
  advance it once the branch merges.

## Self-Check: PASSED

- `packages/backend/convex/knowledgeExternalSources.ts` — FOUND
- `packages/backend/convex/knowledgeExternalSources.test.ts` — FOUND
- `.planning/phases/29-unified-knowledge-and-routines/deferred-items.md` — FOUND
- commits `783cf13` and `24d9c82` — FOUND in `git log`
- `git show --stat` on each commit lists ONLY this plan's files; nothing belonging to 29-02 or
  29-04 was staged (`_generated/api.d.ts` is the one shared generated file, and it carries 29-02's
  entry because it was already in the working tree when I regenerated my own).
- `git diff --stat HEAD -- "*.ts"` after both commits: **empty**.
- Every file named in the plan's `files_modified` was touched: `knowledgeExternalSources.ts`,
  `knowledgeExternalSources.test.ts`, `gmail.ts`, `gmail.test.ts`, `docs/playbooks/cockpit.md`.
