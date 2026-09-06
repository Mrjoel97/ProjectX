# Track C step 11 — research engine (G4), Document Canvas (G5), durable runs + batches (G6, G10) — RESEARCH

- **Measured**: 2026-09-06, tree `23351ff` (main, Phase 38 closed)
- **Trigger**: merged rev-5 audit §5, Track C step 11: "Research engine (G4); Document Canvas (G5); durable
  runs + fan-out and batches under one plan-row ADR (G6, G10)". Prior detail: the 08-21 consistency audit
  (`.planning/design/consistency-audit-2026-08-21.md` §"Documents in their true form", §R1–R3, gap register
  G4/G5/G6/G10 and its suggested sequence) and the 08-24 service note (§3 Research, §5 missing data).
- **Status**: research only — no code. This note covers the whole step; §5 proposes how it splits into
  phases and what the first one (Phase 39) is. Owner decisions at the end.

## 1. Step 11 is three phases, not one

| Item | What the audit asks | Size (08-21 register) | Breaks a frozen thing? |
|---|---|---|---|
| G4 research engine | page reading, findings store with `observedAt` + staleness, model pin review | Medium | No — new tool + a field |
| G5 Document Canvas | inline PDF, sheet grids, Office fidelity ADR, `.xlsx` generation | Medium + one ADR | No — a card branch + a writer |
| G6 durable runs + fan-out · G10 batches + content queue | Workflow-component specialist runs, ≤5 parallel workers at depth 1, `deliverables[]` + `publishAt` | Large + the shared plan-row ADR | **Yes** — `plans.by_thread` is `.unique()` (schema frozen since 16-01) and one-plan-per-thread is enforced at plans.ts `:185/:277/:554/:621`, cockpit.ts `:337` and the schema |

The 08-21 register already ordered them: G5 and G4 "in either order", then G10 and G6 "linked — both break
the one plan row per thread constraint, so the parent/child plan-row schema ADR is written once and
shared", and both after the reliability phase (25.1, done). Rev 5 kept that order. **Recommendation: G4
→ G5 → the plan-row ADR as its own short decision phase → G6+G10.** G4 first because the 08-24 note
calls research the one *capability* every later workflow calls, and the reason rev 5 gave for deferring
it ("a better research engine feeding a system with no initiative is a better memo") lapsed when Goal
Engine v0 shipped (Phase 34).

## 2. G4 — what research is today (measured)

- **Search:** `webResearch` (llm.ts:435) POSTs Tavily `/search` with `search_depth: "basic"`,
  `max_results: 5` (`WEB_RESULTS_PER_SEARCH`), no `include_raw_content`; `parseWebResults` drops results
  under `WEB_RESULT_MIN_SCORE = 0.55`; each result is `{url, title, snippet}` (`WebResult`, :317). The
  query is redaction-scanned before egress (fail closed), the key's absence and HTTP errors return
  `results: []` with a note so the verdict stays honest. Fee: `WEB_SEARCH_CALL_USD_TAVILY = 0.01` per call
  (`packages/cost/src/cost.ts:350`), drawn against the research rail.
- **Loop:** `RESEARCH_MAX_STEPS = 12`, `RESEARCH_CALL_TIMEOUT_MS = 180_000` (llm.ts:160/:197); the
  research specialist's grant is exactly `webResearch` + `declareUnsupported` (ADR-007, `specialists.ts`).
  The skill body (`research-specialist.md` v3) demands decomposition, several angles, per-claim citations
  and the insufficient-evidence declaration — a good spec applied to thin material (08-21 R1: "the entire
  evidence base for any claim is search-result snippets").
- **The findings store already exists, as one vault document:** `research.persistFindings` writes ONE
  `vaultDocuments` row per run (`kind: "web_research"`, `retrievedAt` stored and queryable,
  `researchQuestionHash`, `sourceThreadId/PlanId`), with a provenance header (retrieval date, sources
  list), the code-decided `researchFindingsFence` verdict, and a refs-only `research.persisted` audit row
  carrying `evidenceVerdict`, `webSearchCalls`, `declaredUnsupported`. `recentFindingsForQuestion` (33.2)
  is already a staleness read (question hash within `sinceMs`). research.ts records "NO `researchRuns` /
  `researchFindings` table" as a deliberate non-decision "to revisit with a plan" — the 08-24 note names
  this as that plan's seed.
- **Two lines are now stale in the stored document:** `LIMITS_FOOTER` says "the search was executed by
  the model provider, not by this system: we cannot pin or choose which sources were consulted". Since
  the Tavily move the system DOES issue the search and DOES see every result; what remains true is that
  no page is read. The footer must be rewritten by whichever plan changes the depth, or it lies in the
  other direction.
- **Card:** R2/R3 (sources withheld from the card, raw markdown) were closed in 25.1-05 (sources block on
  the memo card). Not re-verified live here.

### What Tavily offers (verified against docs.tavily.com, 2026-09-06)

- `/search`: `search_depth` basic (1 credit) / advanced (2 credits, multiple semantic snippets per URL);
  `include_raw_content: "markdown" | "text"` returns the cleaned page in the search response;
  `chunks_per_source` 1–3 × 500 chars; `max_results` 0–20; `include_domains` (≤300) / `exclude_domains`
  (≤150) with `filter`/`boost` mode; `time_range` day/week/month/year and `start_date`/`end_date`.
- `/extract`: up to 20 URLs per call, `extract_depth` basic (1 credit per 5 successful URLs) / advanced
  (2 credits per 5, tables + embedded content), `format` markdown/text, `query` re-ranks to the top chunks
  (joined by `[...]`), `chunks_per_source` 1–5, `timeout` 1–60 s, `failed_results[]` with reasons.

### G4 design (the lazy version that fixes the felt ceiling)

1. **A second tool, `readPage({ url, focus })`** on the research grant, backed by `/extract` at `basic`
   depth with `query: focus` so the tool returns the top-ranked chunks (a hard char cap, ~6k) rather
   than whole pages riding `inputTokens` on every later step. **Structural containment:** the tool
   accepts ONLY a URL that appeared in THIS run's `webResearch` results (the closure keeps the set) —
   the model can never be steered to an arbitrary host by an injected page (the D1 property survives:
   our backend fetches only what the search returned), and `failed_results` come back as a note, never a
   throw. Page count per run capped (constant, ~6); the `focus` string is redaction-scanned like the
   query. Fee: a second `cost.ts` constant (`WEB_EXTRACT_URL_USD`, 0.2 credit ≈ $0.002 per page at the
   listed rate — confirm the tenant's plan) recorded through the same `searchFeeUsd` seam so the rail
   sees it. `agentSteps.tool` gains the `readPage` literal (the swallowed-step trap, cockpitTools.test.ts
   :2062) and the snapshot test gains the key for the research route + the four research-bearing packs.
   *Alternative rejected:* `include_raw_content` on every search — pays page tokens for all five results
   whether or not the model wanted them; the tool lets the model choose which two or three to read.
2. **`observedAt` + staleness, surfaced:** `vaultDocuments.retrievedAt` already is the stamp; add ONE
   constant `RESEARCH_STALE_AFTER_MS` in `@pikar/core` used by `recentFindingsForQuestion` (replacing the
   caller-supplied `sinceMs`) and by the memo/source card ("retrieved N days ago", amber past the
   constant). No new table.
3. **Skill body v4** (registry publish path, eval gate): read before you cite — a claim that matters gets
   its page read, not its snippet; cite the page you read. Bake-off not required for a body bump; the
   golden set (`eval-cases`) research fixtures (22.1 set) re-run as the gate.
4. **Rewrite `LIMITS_FOOTER`** to the new truth: the system chose the queries, saw every result and read
   the pages it cites; pages not read are marked as snippet-only.

**Deferred inside G4 (owner decision 2):** a per-claim findings store — provenance-tagged claims
(`{text, sourceUrl, observedAt, confidence, actor: "agent", origin: "observed"}`, the `FigureClaim`
shape generalised as the 08-24 note asks) recorded through a label-only tool (`recordFinding`, the
`declareUnsupported` precedent: the call is the signal, the DISPATCHER persists) onto the research row
as `claims[]`. It is the Business Ledger's seed (08-21 G13 "living documents rendered from
provenance-tagged claims") and the provenance-laundering guard applies in full: a stored claim is the
agent's observation, never the owner's word. Worth doing, but it is a second plan with its own
consumers (the ledger, Phase 12-style citation gating) that do not exist yet — YAGNI until one does.

**Also deferred:** the "model pin review" (a research bake-off on the production path, ADR-032's
method) — costs live eval money while G19 activations are still owed; `include_domains` / `time_range`
knobs — quality levers with no measured need.

**Size:** ~2 days: tool + containment test (URL-not-from-search refused, failed_results as note, cap),
cost constant + rail test, snapshot/literal updates, skill v4 through the gate, footer + playbook
(agent-runtime.md, the research section of cockpit.md), `research.test.ts`. Requirement: none minted
today; G4 is "KNOW-01 adjacent" — propose `RSCH-01 Research reads the pages it cites` in REQUIREMENTS so
the closure rule has a row.

## 3. G5 — Document Canvas (measured)

- The workspace "canvas" is `MediaCanvas.tsx` and answers "No image or reel in this thread yet" for any
  document; PDF renders only in the vault modal's iframe; HTML has a sandboxed preview; Markdown uses the
  home-grown `MarkdownDocument.tsx` (120 lines: headings, lists, tables, bold — no links/images/code);
  XLSX is parsed by SheetJS in `@pikar/vault` and dumped as tab-separated text; DOCX/PPTX flatten to text.
  The SheetJS writer is installed (`xlsx@0.20.3` in backend and vault) and unused for output.
- The 08-21 audit's three cheap-first steps stand: (1) PDF inline in the canvas/output card via the
  existing signed-URL + iframe; (2) sheet grids from the parsed workbook + real `.xlsx` deliverables via
  the installed writer; (3) DOCX/PPTX honestly — PDF twin at creation, extracted text + original download
  for uploads, recorded in an **Office-fidelity ADR**. The panel protocol (`growth-surfaces…md` §2) makes
  step 1 "one branch in one card"; no new table (documents already have `vaultDocuments` rows keyed by
  `sourceThreadId`). BRAND.md read before any of it. Requirement: none exists → mint `DOC-01`.
- Size: 3–5 days across two plans + the ADR. Researched in its own phase (40) when its turn comes.

## 4. G6 + G10 — durable runs, fan-out, batches (measured)

- Durability today: `WorkflowManager` is used by five modules (`cockpit.ts` deliverApprovedPlan — the
  sole send site, `requests.ts`, `vaultIngest.ts`, `smoke.ts`, `index.ts`); 40 `scheduler.runAfter/runAt`
  sites across 15 files carry everything else (media, digest, review, notifications, drive, voice…). A
  specialist run is one `internalAction` under a 45 s / 90 s (media) / 180 s (research) clock; `MAX_DEPTH
  = 1`, one worker per dispatch, an `envelopeCents` budget derived at the root.
- One-plan-per-thread: `plans.by_thread` `.unique()` at five sites in plans.ts (the two `stage*Plan`
  mutations REFUSE a second row and say the fix is "more than one plan row per thread"), the first-turn
  "single plans row" in cockpit.ts, and the schema. G10's `deliverables[]` and G6's fan-out children both
  need the parent/child (or batch-grouped rows) decision — **one ADR, written once, before either phase's
  code**, exactly as the 08-21 register said.
- Size: the ADR is a day of design; G6 and G10 are each a multi-week phase touching the approval gate,
  pricing rails, the activity trace and the cards. Highest blast radius in the corpus; last in the step.

## 5. Proposed split

| Phase | Scope | Gate to start |
|---|---|---|
| **39 Research engine** (this note's §2) | `readPage` on the research grant, staleness constant, skill v4, footer, `RSCH-01` | owner decisions below |
| 40 Document Canvas | steps 1–2 + the Office-fidelity ADR (step 3) | 39 closed; its own research + BRAND read |
| 41 Plan-row ADR | parent/child vs batch-grouped rows; the migration shape for `by_thread` | 40 closed (or in parallel as a docs-only phase) |
| 42 Durable runs + fan-out (G6) · 43 Batches + queue (G10) | on the ADR | 41 accepted |

## 6. Owner decisions

1. **Order:** G4 → G5 → plan-row ADR → G6/G10 (recommended), or G5 first, or the ADR first.
2. **G4 scope:** `readPage` + staleness + skill v4 (recommended), or that plus the per-claim findings
   store (`recordFinding` → `claims[]`, the ledger seed), or `readPage` alone.
3. **Research model bake-off** (ADR-032 method, live eval spend): out of Phase 39 (recommended) or in.
