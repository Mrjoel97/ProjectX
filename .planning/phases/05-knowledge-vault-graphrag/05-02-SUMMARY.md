---
phase: 05-knowledge-vault-graphrag
plan: 02
subsystem: database
tags: [convex, rag, embeddings, graphrag, skill-registry, schema]

# Dependency graph
requires:
  - phase: 05-01
    provides: "@pikar/vault pure package (normalize/categories/traversal/fusion/constants) + vault.md playbook"
provides:
  - "vaultDocuments / graphNodes / graphEdges schema tables with dedup + BFS-traversal + delete-cascade indexes"
  - "the single vault RAG instance (vaultRag.ts) bound to text-embedding-3-small@1536"
  - "@pikar/vault wired as a backend dependency"
  - "graph-extractor registry skill (5-file mirror) — structured {nodes,edges} extraction, fails closed, no hardcoded prompt"
affects: [05-03, 05-04, 05-05, 05-06, vaultIngest, vaultGraph, vaultGround, vaultLlm]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single RAG construction site (mirrors index.ts workflow/retrier) imported by every vault module"
    - "5-file skill registry mirror for graph-extractor (canonical .md + derived .ts + name const + seed row + drift test)"
    - "ConstructorParameters-derived type to absorb the ai@6/ai@7 EmbeddingModel skew without a version-pinned import"

key-files:
  created:
    - packages/backend/convex/vaultRag.ts
    - packages/contracts/skills/graph-extractor.md
    - packages/contracts/src/skills/graphExtractor.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/package.json
    - packages/contracts/src/skill.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - docs/playbooks/vault.md
    - docs/playbooks/skill-registry.md

key-decisions:
  - "Derive RAG's expected EmbeddingModel via ConstructorParameters<typeof RAG> rather than importing from ai — the backend's ai@7 and rag-bundled ai@6 declare incompatible EmbeddingModel types (same skew llm.ts absorbs for LanguageModel)"
  - "graph-extractor emits a fixed type set (person/org/project/place/topic/other) with edge endpoints referencing emitted node names — extract-only-never-invent, no raw addresses echoed"

patterns-established:
  - "Vault plane schema is an append-only block: new tables + optional fields, no migration, existing tables untouched (Lane-C append discipline)"

requirements-completed: [VALT-01, VALT-02]

# Metrics
duration: 9min
completed: 2026-07-14
---

# Phase 5 Plan 02: Vault Schema + RAG Instance + Graph-Extractor Skill Summary

**Three GraphRAG schema tables (vaultDocuments/graphNodes/graphEdges) with dedup/BFS/cascade indexes, the single text-embedding-3-small@1536 RAG construction site, and the graph-extractor registry skill via the 5-file mirror.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-14T15:39:34Z
- **Completed:** 2026-07-14T15:48:12Z
- **Tasks:** 3
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments
- `vaultDocuments` (by_tenant browse, by_tenant_contentHash dedup), `graphNodes` (by_tenant_normalized upsert/dedup), `graphEdges` (by_tenant_fromNode/toNode BFS + by_tenant_source delete-cascade) — the six indexes every Plan 03–06 adapter needs, added as an append-only block with existing tables untouched.
- `vaultRag.ts` constructs the ONE `rag` instance at `text-embedding-3-small`@1536 (Pitfall 2 satisfied — dimension equals model output and is under the Convex 2048 cap); `@pikar/vault` wired as a backend dependency.
- `graph-extractor` skill lands via the canonical 5-file registry mirror: emits structured `{ nodes:[{type,name}], edges:[{from,to,rel}] }`, fails closed when unseeded, no hardcoded prompt in convex source (§5). skills.test.ts stays green (13/13) with the new drift row.

## Task Commits

1. **Task 1: Add vaultDocuments + graphNodes + graphEdges tables** - `585f7db` (feat)
2. **Task 2: Construct the single RAG instance + wire @pikar/vault dep** - `8eea316` (feat)
3. **Task 3: graph-extractor skill via the 5-file registry mirror** - `cad7ada` (feat)

## Files Created/Modified
- `packages/backend/convex/schema.ts` - appended the three vault tables + six indexes
- `packages/backend/convex/vaultRag.ts` - the single RAG(components.rag, ...) construction site
- `packages/backend/package.json` - `@pikar/vault: workspace:*` dependency
- `packages/contracts/skills/graph-extractor.md` - canonical extractor prompt (registry source of truth)
- `packages/contracts/src/skills/graphExtractor.ts` - byte-identical derived `graphExtractorSkillBody`
- `packages/contracts/src/skill.ts` - `GRAPH_EXTRACTOR_SKILL` name const
- `packages/backend/convex/skills.ts` - appended the seedSkills row
- `packages/backend/convex/skills.test.ts` - added the graph-extractor drift `test.each` row
- `docs/playbooks/vault.md` - Last verified → 05-02
- `docs/playbooks/skill-registry.md` - Current skills += graph-extractor; Last verified → 05-02

## Decisions Made
- **EmbeddingModel type skew:** `@convex-dev/rag@0.7.5` bundles `ai@6.0.221` while the backend uses `ai@7.0.20`; the two majors declare incompatible `EmbeddingModel` types even though the runtime shape is identical. Rather than importing a version-pinned type, the expected type is derived from the class itself (`ConstructorParameters<typeof RAG>[1]["textEmbeddingModel"]`) so it tracks whatever `rag` bundles. Mirrors the `as unknown as LanguageModel` casts already in llm.ts.
- **Extractor output contract:** fixed type set (person/org/project/place/topic/other), edge endpoints must reference emitted node names, extract-only-never-invent, no raw addresses/secrets echoed (redact-then-extract, §4).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AI-SDK EmbeddingModel version skew blocked the RAG construction typecheck**
- **Found during:** Task 2 (Construct the single RAG instance)
- **Issue:** `openai.embedding("text-embedding-3-small")` (from `@ai-sdk/openai@4.0.11`) is typed as `EmbeddingModelV4`, and the backend's own `ai@7` `EmbeddingModel` still did not match `@convex-dev/rag`'s expected type — rag internally resolves `ai@6.0.221`, whose `EmbeddingModel` is a distinct, incompatible declaration. `tsc` errored on the `textEmbeddingModel` assignment.
- **Fix:** Derived the exact expected type from RAG (`ConstructorParameters<typeof RAG>[1]["textEmbeddingModel"]`) and cast via `as unknown as` — no version-pinned import, tracks the rag-bundled provider. Documented with a `ponytail:` comment naming the ceiling (drop when the pinned versions realign, do NOT bump, §6).
- **Files modified:** packages/backend/convex/vaultRag.ts
- **Verification:** `tsc --noEmit` reports no source-file errors.
- **Committed in:** `8eea316` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The cast is required for the plan's own verification (typecheck) to pass and is consistent with the codebase's existing AI-SDK-skew handling. No scope creep.

## Issues Encountered
- The `pnpm --filter @pikar/backend typecheck` command surfaces ~15 pre-existing `.test.ts` errors (`import.meta.glob` typing gap + `noUncheckedIndexedAccess` narrows) documented in STATE.md as long-standing noise. Verified via a source-file-only filter (`tsc --noEmit | grep -v .test.ts`) that no source errors were introduced. Out of scope (SCOPE BOUNDARY).

## User Setup Required
None - no external service configuration required. (The seeded graph-extractor skill reaches a live deployment through the existing `seedSkills` path — `convex dev --run skills:seedSkills` locally, `npm run seed` in prod.)

## Next Phase Readiness
- The shared contracts Plans 03–06 import are in place: the three tables + their indexes, the single `rag` instance, and the seeded/tested `graph-extractor` skill.
- No blockers. Plans 04/05 append the embed/search action steps to vaultRag.ts; the graph extractor call lives in a DEFAULT-runtime `vaultLlm.ts` (per vault.md invariant), consuming `graphExtractorSkillBody` via the registry.

---
*Phase: 05-knowledge-vault-graphrag*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: packages/backend/convex/vaultRag.ts
- FOUND: packages/contracts/skills/graph-extractor.md
- FOUND: packages/contracts/src/skills/graphExtractor.ts
- FOUND: .planning/phases/05-knowledge-vault-graphrag/05-02-SUMMARY.md
- FOUND commits: 585f7db, 8eea316, cad7ada
