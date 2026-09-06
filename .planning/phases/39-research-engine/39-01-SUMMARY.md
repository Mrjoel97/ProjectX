---
phase: 39-research-engine
plan: 01
status: complete
completed: 2026-09-06
commits: [see the phase-close commit — feat(39-01)]
requirements-completed: [RSCH-01]
requirements-pending: []
---

# 39-01 — The research specialist reads the pages it cites

**Measured before (2026-09-06, tree `23351ff`).** Research was Tavily `/search` at `basic` depth, five
snippets per query above a 0.55 relevance floor, twelve steps, a 180 s clock; no page was ever read —
"the entire evidence base for any claim is search-result snippets" (08-21 audit R1). Findings landed as
one `vaultDocuments` row with a `retrievedAt` stamp and a footer that said the search "was executed by
the model provider" — a sentence false since the Tavily move. The reuse window (`FINDINGS_REUSE_MS`, 24 h)
lived in dispatch.ts and nothing on the card said when a finding had gone stale.

**What changed.**
- **`readPage({ url, focus })`** on the research record (`buildWebResearchTool`, llm.ts). The record
  owns a `Set` of every URL `webResearch` parsed this run; `readPage` refuses any other URL BEFORE any
  network call — the model never names a host, it picks from what the provider returned, so an injected
  page cannot steer the specialist anywhere (the D1 property survives). It POSTs Tavily `/extract`
  (`basic`, markdown, `query: focus` for the top-ranked chunks, `chunks_per_source: 3`), caps
  `PAGE_READS_PER_RUN = 6` and `PAGE_READ_CHARS = 6000`, scans `focus` before egress, and returns a note
  on a missing key / HTTP error / `failed_results` / cap — never a throw. `parseExtractResult` is exported
  and unit-tested.
- **Fee:** `WEB_PAGE_READ_USD_TAVILY` = a fifth of the search proxy (1 credit per 5 URLs) via
  `pageReadFeeUsd()`; `runAgentLoop` adds `pageReads × fee` to the same `web_search_fee` row, per call.
- **Grant:** `RESEARCH_TOOLS` = `webResearch, readPage, declareUnsupported` (ADR-007; the body teaches
  it). **Packs did not get it:** a pack body must teach every tool it holds and a pack body edit mints
  three candidates behind the pack gate — pinned by a test that expects no pack to be granted `readPage`.
  The record still BUILDS it for research-bearing packs; their `toolNames` filter withholds it.
- **Trace + labels:** `agentSteps.tool` literal `readPage`; card verbs "Reading a page… / Read the page";
  the profile anatomy label "reading the pages it cites".
- **Staleness:** `RESEARCH_STALE_AFTER_MS` (core, 24 h) is the reuse window in dispatch AND the memo card's
  stamp — `Retrieved 6 Sep 2026 — may be out of date` past it (words, not colour; amber stays the gate's).
- **Footer:** `LIMITS_FOOTER` now says what is true — the system chose and ran the queries and read the
  pages it cites; a search provider chose the candidates, an extractor chose the excerpt, no source was
  audited; a snippet-only claim rests on a result, not a page. `research.test.ts` asserts the new
  sentence and the absence of the old.
- **Skill v4** (`research-specialist.md` → regenerated constant): three tools; a "Read before you cite"
  section (read the two or three pages the findings stand on; **page-read** vs **snippet-only** on every
  claim, orthogonal to corroborated/single-sourced); the limit section rewritten; output item 3 carries
  the new label.
- **Snapshot literals** (Phase 38's net): the research route's `built` + `modelSees` and the three
  research-bearing packs' `built` sets gain `readPage` — the one intended key-set change; every other
  class held.

**Verified.**
- Unit: backend `cockpitTools` 157/157 (four new readPage tests: refuses an un-returned URL with fetch
  never called; reads a returned one and sends `focus` as the rerank query; caps the count and reports a
  failed extraction as a note; `parseExtractResult` caps at 6k and surfaces the provider's reason),
  `toolRegistrySnapshot` 23/23, `research` / `dispatch` / `traceParity` / `skills` / `llmRedaction` /
  `dispatchGuard` green (601 across the eight files); core `specialists` + `workflowPacks` 96/96;
  contracts 122/122 (the `.md`/`.ts` byte identity); cost 95/95; web 47/49 (the two jsdom artifacts);
  backend `tsc` 0 errors; `pnpm lint --diagnostic-level=error` exit 0 after biome's import ordering.
  Backend full shards: see the close commit's note below.
- **The eval gate, live on the local deployment** (keys + `TAVILY_API_KEY` present): `seedSkills`
  published research-specialist **v10** (the v4 body; local active was v8); `pnpm eval:golden --skill
  research-specialist@10` → **46/46 passed, $0.80** ($0.40 exec + $0.41 specialist), `research-specialist@10
  ×7` executed, evidence recorded on v10; `activateSkill` → v10 ACTIVE locally. The first attempt aborted
  at `vaultSmoke:seedCorpus` with a 1 s mutation timeout because it started during the watcher's push —
  environment, not a defect; the rerun after the push was clean.
- **`readPage` fired for real:** the eval tenant's `agentSteps` show `readPage: 20` beside
  `webResearch: 47` across the seven research runs (`dispatchResearch: 8`, `declareUnsupported: 3`) —
  the model reads two to three pages per run, as the body asks.

**Deliberately not done (owner decisions).** The per-claim findings store (`recordFinding` → `claims[]`,
the ledger seed), the research-model bake-off, `include_domains` / `time_range` knobs, pack grants
(next pack-body revision through the pack gate), production activation of v10 (owner's G19 step:
`seedSkills` + `pnpm eval:golden --skill research-specialist@<v>` + `activateSkill` against prod — the
version number differs per deployment).

## Owner steps

- **Production:** after the deploy, `seedSkills` on prod publishes the v4 body as a candidate; run the gate
  there (`pnpm eval:golden --skill research-specialist@<prod candidate version>`) and `activateSkill`.
  Until then prod research runs the old body against the new tool set — the tool is present, the body
  simply never asks for it.
- Confirm `TAVILY_API_KEY` on prod has `/extract` credit headroom (basic: 1 credit per 5 pages).
