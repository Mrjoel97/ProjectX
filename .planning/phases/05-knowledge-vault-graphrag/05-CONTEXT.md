# Phase 5: Knowledge Vault & GraphRAG - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Lane:** C (knowledge-vault) — see `.planning/PARALLELIZATION.md`

<domain>
## Phase Boundary

Deliver a per-user **Knowledge Vault** with **GraphRAG** grounding. Briefs/documents are
stored, embedded, and entity/relationship-extracted at ingestion; requests can be grounded
via **hybrid vector + hop-capped graph retrieval** scoped to the requesting user; and the
user can **browse, preview, search, and download** their own vault contents through the
committed UI in `docs/design/brand/brand-024242.png` / `brand-024258.png`.

Requirements: **VALT-01** (store + embed for vector retrieval), **VALT-02** (extract
entities/relationships → Convex `graphNodes`/`graphEdges`), **VALT-03** (hybrid retrieval,
per-user scoped), **VALT-04** (browse + search vault contents).

**Lane C builds this ENGINE independently now.** The intake→vault wiring (Phase 4 extraction
output) and the cockpit/pipeline grounding call-site (Lane A) are deliberately deferred — see
Deferred Ideas. Lane C edits ONLY: new `packages/*`, new `convex/vault*.ts` +
`graphNodes`/`graphEdges` modules, a new `apps/web/.../dashboard/vault` route + new components,
and additive appends to the shared singletons (`schema.ts`, `skills.ts`, `STATE.md`/`ROADMAP.md`).
It must NOT touch `cockpit.ts`, `llm.ts` cockpit tools, or intake services.
</domain>

<decisions>
## Implementation Decisions

### Vector engine & storage
- **Reuse the installed `@convex-dev/rag@0.7.5` component** (registered in `convex.config.ts`,
  currently unused) for chunking, embedding storage, and vector + hybrid text search.
  Ponytail rung 5 (already-installed dependency). Do NOT bump the pinned version (§6).
- **`namespace = tenantId`** → per-user isolation comes from the component's namespacing,
  reinforcing the `tenantQuery/tenantMutation/tenantAction` wrapper isolation (VALT-03).
- Embedding model **`text-embedding-3-small` @ 1536 dims** (under Convex's 2048 cap, per roadmap).
- **Separate `vaultDocuments` metadata table** (tenant-scoped): one row per brief/doc —
  `title, kind, category, source, mimeType, size, contentHash, status, createdAt` + a key back
  to the rag entry. The browse UI lists `vaultDocuments`; rag holds the embedded chunks. Metadata
  queries stay cheap; browse never touches vectors.
- **Dedup by content hash** on ingest (reuse `convex/lib/hash.ts` `contentHash`): identical
  `(tenantId, contentHash)` → skip re-embed/re-extract, point to the existing item. No duplicate
  vectors or duplicate graph edges.
- **Per-file size cap** — a `VAULT_FILE_CAP_BYTES` const (mirror the `PLAN_ATTACHMENT_CAP_BYTES`
  pattern); reject oversize uploads to protect ingest. **No per-tenant total quota this phase**
  (single-owner beta). `STORAGE USED` stat = running Σ of sizes (display only).

### Extraction & graph schema (VALT-02)
- **LLM `graph-extractor` registry skill** (CLAUDE.md §5 — versioned skill row, no hardcoded
  prompt; 5-file mirror + `seedSkills` append). At ingestion it emits typed entities +
  relationships as structured JSON; a vault module upserts them. Deterministic offline `SMOKE::`
  path for tests (no model call).
- **Redact-then-extract:** the extractor LLM call receives **redacted `safeText`** (`pii.scanText`,
  fail-closed) — never raw content.
- **Graph tables (generic typed + cross-doc dedup):**
  - `graphNodes: { tenantId, type, name, normalizedName, degree }` — index `by_tenant_normalized`
    for upsert/dedup.
  - `graphEdges: { tenantId, fromNodeId, toNodeId, rel, sourceDocId }` — indexes
    `by_tenant_fromNode` / `by_tenant_toNode` for traversal.
  - **Same entity across docs dedupes to ONE node** (upsert on `(tenantId, type, normalizedName)`),
    so the graph actually connects documents — the payoff of GraphRAG. `degree` tracks edge count
    for orphan GC.

### Hybrid retrieval & grounding (VALT-03)
- **Hybrid = vector similarity + hop-capped graph traversal.** Fusion strategy is **Claude's
  Discretion**, leaning to the canonical **vector-seed → graph-expand → merge/rank**: rag search
  finds top-K seed chunks → map to graph nodes → hop-capped neighbor expansion → gather neighbor
  source docs → merge + dedupe + rank into one grounding context block.
- **Hop cap = 2, as a configurable const** (`GRAPH_HOP_CAP = 2`). Captures indirect context
  (Acme → Project X → deadline) without exploding.
- **Grounding is a standalone, tenant-scoped `vaultGround({query})` action** built + verified
  **E2E in-lane** this phase (query → vector+graph → merged context). The actual cockpit/pipeline
  **call-site is DEFERRED** to a later integration phase (wiring it now would edit Lane-A files).

### Processing (async) & cost governance
- **Ingest orchestrated by `@convex-dev/workflow`** (already used in `deliverApprovedPlan`):
  durable steps `store → embed → extract → ready` with per-step retry. The ingest mutation writes
  the `vaultDocuments` row as `status:'processing'` + stores text, then the workflow runs and
  patches `status:'ready' | 'failed'`. UI shows per-item status reactively; `PROCESSED` stat =
  count(status = ready).
- **Reuse the existing guardrails + rate-limiter** for vault ingest LLM calls: per-tenant
  `rateLimiter.limit` on ingest (bulk-spike protection), `guardrails.preCall` gate (kill switch /
  budget) before embed+extract, `priceUsage → recordSpend` after. Vault spend lands in the same
  budget ledger; the kill switch stops ingest. No new guardrail path.

### PII & content storage governance
- **Raw content lives in the tenant-scoped vault content-plane** (`vaultDocuments.text`) — it is
  the user's OWN private data, needed verbatim for preview/download. This is NOT the §4 honeypot.
- **Redaction applies where §4 actually targets:** extraction/embedding LLM calls receive redacted
  `safeText`; `audit`/`deadLetters`/graph payloads carry **refs + hashes + counts ONLY** — never
  raw content. Embeddings are vectors, not raw text.

### Vault UI (VALT-04) — match `brand-024242.png` / `brand-024258.png` 1:1
- **New route `apps/web/.../dashboard/vault`** ("Knowledge Vault") + the **Knowledge Vault nav
  item** (already listed in the BRAND nav rail). Reuse `globals.css` tokens (BRAND §2); no new
  component library.
- **Layout matches the screenshots:** large "Knowledge Vault" display headline, a **Refresh**
  button (teal-600) + "Loading" status pill; **4 stat tiles** (`TOTAL FILES`, `PROCESSED`,
  `STORAGE USED` MB, `CATEGORIES 6` — uppercase label + big value + rounded icon badge per BRAND
  §5); **6 category tabs** (My Uploads · Workspace Docs · Images · Videos · Google Docs · Brain
  Dumps; active = teal-600 pill); **upload dropzone** (dashed rect, cloud icon in soft-teal circle,
  "Click to upload or drag and drop", subtext `Searchable: PDF, DOCX, XLSX, CSV, TXT, Markdown` /
  `Storage-only: Images, Videos (not embedded)`); **search bar** "Search my uploads…" + `N ITEMS`
  count + **grid/list view toggle**. Honest-zero empty states.
- **Phase-5 wiring scope:** wire **TXT / Markdown / CSV uploads + Brain Dumps (pasted text)**
  fully through embed → graph-extract → retrieval NOW. **PDF/DOCX/XLSX/PPTX/Images are
  accept-but-defer** — stored + shown with a `pending extraction` status; their text arrives via
  the `vaultIngestText` seam when Phase 4 lands (see Extraction-boundary contract).
- **Categories auto-assigned at ingest** (never manual): file upload → My Uploads; pasted text →
  Brain Dumps; agent/cockpit-generated → Workspace Docs; `image/*`/`video/*` → Images/Videos
  (deferred); Google → Google Docs (deferred). Stored as a single `category` field; tabs filter it.
  **Live this phase:** My Uploads, Brain Dumps, Workspace Docs. **Shown but populate later:**
  Images, Videos, Google Docs.
- **Search box = hybrid semantic + keyword** (rag ships hybrid text+vector), scoped to the active
  category tab. Same rag search primitive that grounding uses (one surface, two callers).

### Viewing, download, delete
- **View = in-place modal preview** popping over the vault page (image viewer / inline video
  player / rendered text-PDF-doc), Esc/X to close — plus an **"Open in workspace"** button that
  navigates to the existing `/dashboard/workspace` route (a plain link only — no Lane-A file edits;
  deeper hand-off deferred). NOT routed away by default.
- **Detail panel shows:** title + metadata (kind, source, size, added, status) + the **stored
  text** + the **entities & relationships extracted from THIS doc** (chips/list from
  `graphNodes`/`graphEdges`) — surfaces VALT-02 in the UI + a Download action.
- **Download original** to the user's computer via a short-lived **tenant-guarded signed URL**
  (the `attachmentUrls` bearer-capability pattern — never logged, §4), offered in the preview modal
  + the item `⋮` menu.
- **Delete cascades:** remove the `vaultDocuments` row + its rag chunks + all `graphEdges` with
  `sourceDocId = doc`; nodes whose `degree` drops to 0 are **garbage-collected** (orphan GC); nodes
  still shared with other docs survive.

### Agent ↔ vault interaction (users AND agents share one substrate)
- **Agents READ only via grounding:** `vaultGround({query})` → governed, hop-capped, tenant-scoped
  context. There is **no "read all my files" surface** for agents (prevents PII leak + context
  blowout).
- **Agents WRITE via `vaultIngestText({text, source:'agent'})`** → routes a generated brief through
  the SAME workflow ingest (PII scan → embed → graph-extract → **Workspace Docs** category, hash-
  dedup). Built + tested **in-lane** now; the cockpit tool wiring is deferred to integration.
- **All `ready` items are groundable** (vault is private per tenant). **No per-item "available to
  agent" toggle this phase** (deferred).

### Claude's Discretion
- Hybrid-retrieval fusion algorithm details (lean vector-seed → graph-expand → merge).
- **Re-embed on edit:** lean **immutable** (edit = delete + re-add, reusing the delete cascade +
  workflow ingest — zero new re-embed code) unless the UI clearly needs inline Brain-Dump editing.
- Whether the embedded text is `safeText` vs raw given the zero-retention LLM contract (default
  `safeText`, per the redact-for-LLM decision).
- Empty / loading / failed-extraction visual states (honest zeros per BRAND; a `failed` badge +
  retry affordance).
- Exact stat-tile icon glyphs, spacing, and grid/list persistence.
</decisions>

<specifics>
## Specific Ideas

- **The committed brand is the source of truth** — `docs/design/BRAND.md` + the 14 screenshots in
  `docs/design/brand/`. The two vault screens are **`brand-024242.png`** and **`brand-024258.png`**
  (URL `pikar-ai.com/dashboard/vault`). Match them 1:1 for layout, hierarchy, and component look
  before inventing patterns (CLAUDE.md §10 / BRAND §8). Use `globals.css` CSS variables; never
  hardcode a hex a token covers.
- **Voice (BRAND §1):** executive, outcome-first, honest. Vault copy stays calm and plain.
- **Extraction-boundary contract (record explicitly):** plain-text formats (TXT/MD/CSV) + pasted
  Brain Dumps are chunked/embedded/graph-extracted by Phase 5. Binary formats (PDF/DOCX/XLSX/PPTX)
  and image-slide OCR are **Lane B / Phase 4** work — Phase 5 stores the file + marks it
  `pending extraction` + exposes `vaultIngestText(docId, extractedText)`; when Phase 4's
  extractors/OCR land they call that seam and the item becomes searchable through the identical
  pipeline (no rework). The screenshot's `Searchable:` list is the *eventual* set.
- **Reuse first (ponytail):** `@convex-dev/rag` (vector+hybrid), `@convex-dev/workflow` (ingest),
  `@convex-dev/rate-limiter` + `guardrails` + `packages/cost` (governance), `lib/hash.ts` (dedup),
  `pii.scanText` (redaction), the `attachmentUrls` signed-URL pattern (download), the cockpit card
  idioms + teal tokens (UI).
</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`@convex-dev/rag@0.7.5`** — installed + registered (`convex.config.ts`), **entirely unused**.
  The vector + hybrid-search engine for VALT-01/03/04. `namespace = tenantId`.
- **`@convex-dev/workflow@0.4.4`** — used in `deliverApprovedPlan`; the ingest orchestration model.
- **`convex/lib/functions.ts`** — `tenantQuery/tenantMutation/tenantAction` inject `tenantId`
  (= userId, single-owner beta). All vault reads/writes go through these (isolation linchpin, §2).
- **`convex/lib/hash.ts`** — `contentHash` for dedup.
- **`convex/guardrails.ts`** — `preCall` (kill switch/budget gate), `recordSpend`; `packages/cost`
  `priceUsage`. `@convex-dev/rate-limiter` for per-tenant ingest limits.
- **`packages/pii` `scanText`** — fail-closed redaction → `safeText` before any LLM call.
- **`convex/plans.ts` `attachmentUrls`** — the tenant-guarded `storage.getUrl` signed-URL /
  bearer-capability pattern to copy for vault download.
- **`convex/skills.ts` `seedSkills`** + the 5-file skill mirror — the pattern for the new
  `graph-extractor` skill (append-only; don't touch other lanes' rows).
- **BRAND tokens** in `apps/web/app/globals.css`; cockpit card/`SplitPane` idioms to match.

### Established Patterns
- **Domain logic in `packages/*`; `convex/` thin adapters** (§1) — put embedding/hybrid-retrieval/
  graph-traversal domain logic in new pure-TS `packages/*` (e.g. `@pikar/vault`), keep
  `convex/vault*.ts` as thin orchestration.
- **Skill-registry prompts** (§5) — the extractor prompt is a versioned skill, not source.
- **Redact-then-write** (§4) — PII scan precedes any LLM call + any audit write.
- **Optional-field schema growth** (no migration) — new tables + optional fields, as prior phases.
- **`SMOKE::` offline test path** — deterministic ingest/extract/ground for `convex-test`
  (no live backend), mirroring cockpit smoke ops.
- **Playbook + `watch.json`** (§9) — a new `vault` playbook must register its watched path
  prefixes (new `packages/*` + `convex/vault*` + graph modules + vault route).

### Integration Points
- **New route** `apps/web/app/(app)/dashboard/vault/` + a Knowledge Vault nav entry (new files only).
- **Shared singletons (append-only, region-scoped):** `schema.ts` (vaultDocuments/graphNodes/
  graphEdges tables in a new block), `skills.ts` (`graph-extractor` seed row appended),
  `STATE.md`/`ROADMAP.md` (Phase 5 ticks).
- **Deferred cross-lane seams:** `vaultGround` call-site (cockpit/pipeline — Lane A) and
  `vaultIngestText(docId, extractedText)` caller (Phase 4 extractors — Lane B).
</code_context>

<deferred>
## Deferred Ideas

- **External sharing** — user→other-people share links / recipients, permissions, revocation,
  external auth. A whole new capability → its own future phase. v1 vault is private per-tenant.
- **Binary + OCR extraction** — PDF/DOCX/XLSX/PPTX parsing + image-slide OCR = Lane B / Phase 4;
  Phase 5 stores + exposes the `vaultIngestText` seam.
- **Cockpit/pipeline grounding call-site** — wiring `vaultGround` into the live request pipeline
  edits Lane-A files; deferred to an integration phase.
- **Per-tenant storage quota** — deferred to the multi-tenant / billing milestone.
- **Per-item "available to agent" toggle** — all ready items groundable for now.
- **In-place item editing / re-embed path** — leaning immutable (delete + re-add) this phase.
- **Images/Videos/Google Docs categories** — tabs shown, populate when their sources land.
- **"Open in workspace" deep hand-off** — Phase 5 only navigates to the existing route.
</deferred>

---

*Phase: 05-knowledge-vault-graphrag*
*Context gathered: 2026-07-14*
