# Phase 5: Knowledge Vault & GraphRAG - Research

**Researched:** 2026-07-14
**Domain:** Per-user GraphRAG — hybrid vector + graph retrieval over Convex, built on the installed `@convex-dev/rag@0.7.5`, `@convex-dev/workflow@0.4.4`, guardrails/rate-limiter, and a brand-matched vault UI.
**Confidence:** HIGH (RAG/workflow API verified against the pinned node_modules dts; UI verified against committed screenshots + globals.css; reuse patterns read from source)

<user_constraints>
## User Constraints (from CONTEXT.md)

These are LOCKED by `/gsd:discuss-phase`. The planner MUST honor them verbatim; research below fills in *how*, never *whether*.

### Locked Decisions

**Vector engine & storage**
- Reuse the installed `@convex-dev/rag@0.7.5` (registered in `convex.config.ts`, currently unused) for chunking, embedding storage, and vector + hybrid text search. Ponytail rung 5. Do NOT bump the pinned version (§6).
- `namespace = tenantId` → per-user isolation from the component's namespacing, reinforcing the `tenantQuery/tenantMutation/tenantAction` wrappers (VALT-03).
- Embedding model `text-embedding-3-small` @ 1536 dims (under Convex's 2048 cap).
- Separate tenant-scoped `vaultDocuments` metadata table (one row per brief/doc): `title, kind, category, source, mimeType, size, contentHash, status, createdAt` + a key back to the rag entry. Browse UI lists `vaultDocuments`; rag holds embedded chunks. Browse never touches vectors.
- Dedup by content hash on ingest (reuse `convex/lib/hash.ts` `contentHash`): identical `(tenantId, contentHash)` → skip re-embed/re-extract, point to existing item.
- Per-file size cap `VAULT_FILE_CAP_BYTES` const (mirror `PLAN_ATTACHMENT_CAP_BYTES`); reject oversize. NO per-tenant total quota this phase. `STORAGE USED` stat = running Σ of sizes (display only).

**Extraction & graph schema (VALT-02)**
- LLM `graph-extractor` registry skill (CLAUDE.md §5 — versioned skill row, no hardcoded prompt; 5-file mirror + `seedSkills` append). Emits typed entities + relationships as structured JSON; a vault module upserts them. Deterministic offline `SMOKE::` path for tests.
- Redact-then-extract: the extractor LLM call receives redacted `safeText` (`pii.scanText`, fail-closed) — never raw content.
- Graph tables (generic typed + cross-doc dedup):
  - `graphNodes: { tenantId, type, name, normalizedName, degree }` — index `by_tenant_normalized`.
  - `graphEdges: { tenantId, fromNodeId, toNodeId, rel, sourceDocId }` — indexes `by_tenant_fromNode` / `by_tenant_toNode`.
  - Same entity across docs dedupes to ONE node (upsert on `(tenantId, type, normalizedName)`). `degree` tracks edge count for orphan GC.

**Hybrid retrieval & grounding (VALT-03)**
- Hybrid = vector similarity + hop-capped graph traversal. Fusion is Claude's Discretion, leaning to vector-seed → graph-expand → merge/rank.
- Hop cap = 2, configurable const (`GRAPH_HOP_CAP = 2`).
- Grounding is a standalone tenant-scoped `vaultGround({query})` action, built + verified E2E in-lane. The cockpit/pipeline call-site is DEFERRED.

**Processing (async) & cost governance**
- Ingest orchestrated by `@convex-dev/workflow`: durable steps `store → embed → extract → ready` with per-step retry. Ingest mutation writes `vaultDocuments` row `status:'processing'` + stores text; workflow patches `status:'ready' | 'failed'`. `PROCESSED` stat = count(status = ready).
- Reuse existing guardrails + rate-limiter for vault ingest LLM calls: per-tenant `rateLimiter.limit` on ingest, `guardrails.preCall` gate before embed+extract, `priceUsage → recordSpend` after. Same budget ledger; kill switch stops ingest.

**PII & content storage governance**
- Raw content in the tenant-scoped vault content-plane (`vaultDocuments.text`) — the user's OWN private data, verbatim for preview/download. NOT the §4 honeypot.
- Extraction/embedding LLM calls receive redacted `safeText`; `audit`/`deadLetters`/graph payloads carry refs + hashes + counts ONLY.

**Vault UI (VALT-04) — match `brand-024242.png` / `brand-024258.png` 1:1**
- New route `apps/web/app/(app)/dashboard/vault` + Knowledge Vault nav item. Reuse `globals.css` tokens; no new component library.
- Layout: "Knowledge Vault" display headline; Refresh button (teal-600) + "Loading" pill; 4 stat tiles (TOTAL FILES, PROCESSED, STORAGE USED MB, CATEGORIES 6); 6 category tabs (My Uploads · Workspace Docs · Images · Videos · Google Docs · Brain Dumps; active = teal-600 pill); upload dropzone (dashed, cloud icon, "Click to upload or drag and drop", subtext Searchable/Storage-only); search bar "Search my uploads…" + `N ITEMS` count + grid/list toggle. Honest-zero empty states.
- Phase-5 wiring scope: wire TXT/Markdown/CSV + Brain Dumps (pasted text) fully through embed → graph-extract → retrieval NOW. PDF/DOCX/XLSX/PPTX/Images are accept-but-defer — stored + `pending extraction`; text arrives via `vaultIngestText` seam when Phase 4 lands.
- Categories auto-assigned at ingest (never manual): file upload → My Uploads; pasted text → Brain Dumps; agent/cockpit-generated → Workspace Docs; image/*·video/* → Images/Videos (deferred); Google → Google Docs (deferred). Single `category` field; tabs filter. Live: My Uploads, Brain Dumps, Workspace Docs.
- Search box = hybrid semantic + keyword (rag hybrid), scoped to active category tab. Same rag search primitive grounding uses.

**Viewing, download, delete**
- View = in-place modal preview + "Open in workspace" plain link to `/dashboard/workspace` (no Lane-A edits). NOT routed away by default.
- Detail panel: title + metadata + stored text + entities & relationships from THIS doc (chips from `graphNodes`/`graphEdges`) + Download action.
- Download original via short-lived tenant-guarded signed URL (the `attachmentUrls` bearer-capability pattern — never logged, §4).
- Delete cascades: remove `vaultDocuments` row + rag chunks + all `graphEdges` with `sourceDocId = doc`; nodes whose `degree` drops to 0 are garbage-collected; shared nodes survive.

**Agent ↔ vault**
- Agents READ only via `vaultGround({query})` — no "read all my files" surface.
- Agents WRITE via `vaultIngestText({text, source:'agent'})` → same workflow ingest → Workspace Docs, hash-dedup. Built + tested in-lane; cockpit tool wiring deferred.
- All `ready` items are groundable. No per-item "available to agent" toggle this phase.

### Claude's Discretion
- Hybrid-retrieval fusion algorithm details (lean vector-seed → graph-expand → merge).
- Re-embed on edit: lean immutable (edit = delete + re-add, reusing delete cascade + workflow ingest) unless the UI clearly needs inline Brain-Dump editing.
- Whether embedded text is `safeText` vs raw given the zero-retention LLM contract (default `safeText`).
- Empty / loading / failed-extraction visual states (honest zeros; `failed` badge + retry).
- Exact stat-tile icon glyphs, spacing, grid/list persistence.

### Deferred Ideas (OUT OF SCOPE)
- External sharing (share links / recipients / permissions / revocation).
- Binary + OCR extraction (PDF/DOCX/XLSX/PPTX + image OCR = Lane B / Phase 4); Phase 5 exposes the `vaultIngestText` seam.
- Cockpit/pipeline grounding call-site (Lane A).
- Per-tenant storage quota.
- Per-item "available to agent" toggle.
- In-place item editing / re-embed path (leaning immutable).
- Images/Videos/Google Docs categories (tabs shown, populate later).
- "Open in workspace" deep hand-off (Phase 5 only navigates).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALT-01 | Briefs/documents stored + embedded (text-embedding-3-small @1536) for vector retrieval | `rag.add()` inside a workflow action step embeds via `openai.embedding("text-embedding-3-small")` @1536; `vaultDocuments` metadata table + `ctx.storage` for original bytes; `contentHash` dedup via `rag.findEntryByContentHash` + a `by_tenant_contentHash` index (§Standard Stack, §Code Examples) |
| VALT-02 | Graphify-style entity/relationship extraction at ingestion → Convex `graphNodes`/`graphEdges` | `graph-extractor` skill (5-file mirror) + a **default-runtime** `generateObject` action; upsert-on-`normalizedName` mutation with `degree` bookkeeping; SMOKE:: offline path (§Architecture Patterns, §Pitfalls) |
| VALT-03 | Request grounding = hybrid retrieval (vector + hop-capped graph traversal), per-user scoped | `vaultGround` **action**: `rag.search({searchType:'hybrid'})` seeds → map to nodes → BFS ≤ `GRAPH_HOP_CAP` over `graphEdges` indexes → gather neighbor docs → merge/rank. Pure fusion/traversal logic in `@pikar/vault` (§Architecture Patterns) |
| VALT-04 | User can browse + search vault contents | New `/dashboard/vault` route matching the two screenshots; `vaultDocuments` list queries (cheap, no vectors) + the same `rag.search` for the search box; signed-URL download; delete-cascade (§Standard Stack, §Code Examples) |
</phase_requirements>

## Summary

The entire vector half of this phase is *already installed and registered* — `@convex-dev/rag@0.7.5` is in `convex.config.ts` (`app.use(rag)`) and completely unused. Its public API (verified against the pinned `node_modules` `.d.ts`) gives us chunking, `text-embedding-3-small`@1536 embedding, per-`namespace` isolation, hybrid (RRF) search, content-hash dedup, and cascade delete out of the box. The correct move is a thin adapter around it, not a hand-rolled vector store. The graph half (`graphNodes`/`graphEdges`, hop-capped traversal, cross-doc dedup, orphan GC) is bespoke but small — pure-TS domain logic in a new `@pikar/vault` package with `convex/vault*.ts` as thin orchestration (§1). Ingestion is a `@convex-dev/workflow` durable pipeline mirroring `deliverApprovedPlan` (store→embed→extract→ready), governed by the existing `guardrails.preCall` + `rateLimiter` + `recordSpend` triad.

The single sharpest architectural decision the planner must get right: **`rag.add`, `rag.search`, and `rag.delete` all require an *action* context** (they embed/fetch OpenAI), while `rag.addAsync`, `rag.deleteAsync`, `list`, `getEntry`, and `findEntryByContentHash` run in mutations/queries. This maps cleanly onto the locked design: the ingest mutation writes the `vaultDocuments` row + stores bytes, then a workflow **action** step calls `rag.add`; `vaultGround` is an **action** (search is action-only); the browse list is a cheap **query** over `vaultDocuments`. The second sharpest: the `graph-extractor` LLM call needs the AI SDK, but `llm.ts` is the codebase's *only* `"use node"` module and explicitly warns a second node module re-triggers a TS circular-inference cliff — and Lane C may not touch `llm.ts`. The recommendation is a **new default-runtime (V8, NOT `"use node"`) `convex/vaultLlm.ts`** using `generateObject` from `ai` + `openai` from `@ai-sdk/openai`, which sidesteps the cliff entirely (it is node-module-specific).

The UI is a faithful re-skin using only `globals.css` tokens and the existing hand-rolled card/tab idioms (no component library) — the two screenshots are pixel-precise references. Offline tests exercise pure domain logic (`@pikar/vault` traversal/fusion/normalize) + the graph upsert mutations via `convex-test`; the RAG embed/search path (which hits OpenAI) is deterministic-bypassed by a `SMOKE::` seam and covered live via a smoke script.

**Primary recommendation:** Build a thin `@pikar/vault` + `convex/vault*.ts` adapter over the installed `rag@0.7.5`; ingest via a `store→embed→extract→ready` workflow; call `rag.add`/`rag.search`/`rag.delete` only from action contexts; put the graph-extractor in a new *V8* `vaultLlm.ts` (not `"use node"`); scope everything by `namespace = tenantId` through the tenant wrappers; match the two screenshots with `globals.css` tokens.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@convex-dev/rag` | 0.7.5 (pinned) | Chunking, embedding storage, vector + hybrid search, dedup, cascade delete | Already installed + registered; purpose-built for exactly VALT-01/03/04; ponytail rung 5 |
| `@convex-dev/workflow` | 0.4.4 (pinned) | Durable `store→embed→extract→ready` ingest with per-step retry | Already used in `deliverApprovedPlan`; the codebase's blessed async orchestration |
| `@ai-sdk/openai` | 4.0.11 | `openai.embedding("text-embedding-3-small")` for RAG; `openai(model)` for the extractor | Already the project's model adapter (`llm.ts`); OPENAI_API_KEY already in the deployment env |
| `ai` | 7.0.20 | `generateObject` (structured graph-extractor JSON) | Already used in `llm.ts` (`generateObject`, `jsonSchema`) |
| `@convex-dev/rate-limiter` | 0.3.2 | Per-tenant ingest spike protection + daily spend window | Reused verbatim from `guardrails.ts` |
| `@pikar/pii` | workspace | `scanText` fail-closed redaction → `safeText` before any LLM call | The §4 redact-then-write choke point |
| `@pikar/cost` | workspace | `priceUsage` after embed/extract → `recordSpend`; `CHEAP_MODEL`/`DEFAULT_MODEL` | Same budget ledger as the rest of the pipeline |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex-helpers` | 0.1.120 | `customQuery/customMutation/customAction` (already wrapped in `lib/functions.ts`) | Every vault read/write goes through `tenantQuery/tenantMutation/tenantAction` |
| `convex` `ctx.storage` | 1.42.1 | Original file bytes (download plane) + signed URLs | Store uploaded bytes; `getUrl` for download (mirror `plans.ts attachmentUrls`) |
| `@convex-dev/workpool` | 0.4.7 (test devDep) | convex-test registration of the workflow component | Already the pattern in `cockpit.test.ts` |

### New workspace package
- **`@pikar/vault`** (new pure-TS package under `packages/`) — domain logic: `normalizeName`, hop-capped BFS traversal, vector-seed→graph-expand→merge/rank fusion, `VAULT_FILE_CAP_BYTES`, `GRAPH_HOP_CAP`, category-assignment rules, MIME→searchable/storage-only classification. Zero Convex imports so it is unit-testable without a backend (§1).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@convex-dev/rag` | Hand-rolled `defineTable(...).vectorIndex(...)` + manual `ctx.vectorSearch` | Rejected by CONTEXT (locked) — and it would re-implement chunking, dedup, hybrid RRF, cascade delete that rag ships. Do NOT hand-roll. |
| `rag.add` (sync) in a workflow action step | `rag.addAsync` + `defineChunkerAction` + `defineOnComplete` | `addAsync` is elegant for very large files but hides embedding behind the component's own workpool — the CONTEXT wants an *explicit* `@convex-dev/workflow` pipeline mirroring `deliverApprovedPlan` for per-step retry + status patching + spend recording. Prefer sync `rag.add` inside `step.runAction` (returns `entryId` + `usage` for `recordSpend`). |
| A new `"use node"` extractor module | New **V8** `vaultLlm.ts` (default runtime) | A second `"use node"` module risks the documented TS circular-inference cliff; the AI SDK's `generateObject` runs fine in a V8 action (llm.ts is node only for `pdf-lib` + `node:crypto`). |

**Installation:** No new backend dependencies (everything is already in `packages/backend/package.json`). Only the new `@pikar/vault` workspace package needs wiring (`workspace:*`) into `@pikar/backend` and the web app as needed. Do NOT run `npm install` for rag/workflow — they are present and pinned.

## Architecture Patterns

### Recommended structure
```
packages/
├── vault/                         # NEW pure-TS domain package (@pikar/vault)
│   └── src/
│       ├── normalize.ts           # normalizeName (lowercase/trim/collapse ws)
│       ├── traversal.ts           # hop-capped BFS over an edge adjacency (≤ GRAPH_HOP_CAP)
│       ├── fusion.ts              # vector-seed → graph-expand → merge/dedupe/rank
│       ├── categories.ts          # source+mimeType → category; searchable vs storage-only
│       ├── constants.ts           # VAULT_FILE_CAP_BYTES, GRAPH_HOP_CAP
│       └── index.ts
└── backend/convex/
    ├── vault.ts                   # tenant adapters: ingest mutations, browse queries, download, delete-cascade
    ├── vaultIngest.ts             # @convex-dev/workflow define() (store→embed→extract→ready) + steps
    ├── vaultLlm.ts                # NEW default-runtime (V8) action: graph-extractor generateObject
    ├── vaultRag.ts                # the `new RAG(components.rag, {...})` instance + thin add/search/delete action steps
    └── vaultGraph.ts              # graphNodes/graphEdges upsert + traversal query helpers (thin over @pikar/vault)
```
(Exact file split is the planner's call; the point is: **domain logic in `@pikar/vault`, thin Convex adapters** per §1, and keep the RAG instance construction in one module.)

### Pattern 1: The RAG instance (one construction site)
**What:** Construct `new RAG(components.rag, {...})` once; every vault module imports it.
**When:** Always — matches how `index.ts` constructs `workflow`/`retrier` once.
```ts
// Source: @convex-dev/rag@0.7.5 dist/client/index.d.ts (verified) + README
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { components } from "./_generated/api";

export const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536, // MUST match the model output; under Convex's 2048 cap
});
```

### Pattern 2: Ingest = a workflow mirroring `deliverApprovedPlan`
**What:** A public `tenantMutation` writes the `vaultDocuments` row (`status:'processing'`) + stores raw bytes/text, then `workflow.start(internal.vaultIngest.ingestDoc, {...})`. The workflow runs durable steps with per-step retry and patches terminal status.
**When:** Every ingest path (file upload, Brain-Dump paste, `vaultIngestText` agent/seam).
```ts
// Mirrors deliverApprovedPlan.ts (verified source). Steps run in retryable action/mutation seams.
export const ingestDoc = workflow.define({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string(), correlationId: v.string() },
  handler: async (step, { vaultDocId, tenantId, correlationId }): Promise<null> => {
    // preCall gate BEFORE any model spend (kill switch / daily budget) — returns, never throws
    const gate = await step.runMutation(internal.guardrails.preCall, {});
    if (!gate.ok) { await step.runMutation(internal.vault.markFailed, { vaultDocId, reason: gate.reason }); return null; }
    // embed: rag.add needs an ACTION ctx → step.runAction
    const embed = await step.runAction(internal.vaultRag.embedDoc, { vaultDocId, tenantId });
    // extract: default-runtime generateObject action → graph JSON, then upsert mutation
    const graph = await step.runAction(internal.vaultLlm.extractGraph, { vaultDocId, tenantId });
    await step.runMutation(internal.vaultGraph.upsertGraph, { tenantId, vaultDocId, ...graph });
    await step.runMutation(internal.guardrails.recordSpend, { costUsd: embed.costUsd + graph.costUsd });
    await step.runMutation(internal.vault.markReady, { vaultDocId, ragEntryId: embed.entryId });
    return null;
  },
});
```
**Note:** `step.runAction` inside a workflow (NOT `retrier.run`) — a workflow handler has no scheduler ctx (documented in `deliverApprovedPlan.ts`). Workpool default retries apply.

### Pattern 3: Embed step (action) with content-hash dedup
```ts
// rag.add requires CtxWith<"runMutation"> which is satisfied by ActionCtx (it embeds → fetch).
export const embedDoc = internalAction({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId, tenantId }) => {
    const doc = await ctx.runQuery(internal.vault.getDoc, { vaultDocId }); // {text, contentHash, title}
    // Dedup precheck (query ctx via runQuery): identical (namespace,key,contentHash) → skip embed
    const existing = await ctx.runQuery(internal.vaultRag.findByHash, {
      namespace: tenantId, key: doc.contentHash, contentHash: doc.contentHash,
    });
    if (existing) return { entryId: existing.entryId, costUsd: 0 };
    const safeText = /* pii.scanText(doc.text) upstream default (see Discretion) */ doc.text;
    const { entryId, usage } = await rag.add(ctx, {
      namespace: tenantId,               // per-user isolation (VALT-03)
      text: safeText,                    // auto-chunked by defaultChunker (100–1000 chars)
      key: doc.contentHash,              // stable key = dedup handle
      contentHash: doc.contentHash,      // component-level dedup
      title: doc.title,
      metadata: { vaultDocId },          // link rag entry ↔ metadata row
    });
    return { entryId, costUsd: priceUsage("text-embedding-3-small", usage) };
  },
});
```

### Pattern 4: `vaultGround` — hybrid vector + hop-capped graph (action)
**What:** `rag.search` (hybrid) seeds top-K chunks → map seed entries to their `graphNodes` → BFS ≤ `GRAPH_HOP_CAP` over `graphEdges` → collect neighbor `sourceDocId`s → merge with vector-seed docs → dedupe + rank → one context block.
**When:** `vaultGround({query})` (VALT-03) and re-used by the UI search box (scoped to a category).
```ts
export const vaultGround = tenantAction({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<{ context: string; docIds: Id<"vaultDocuments">[] }> => {
    const { results, entries } = await rag.search(ctx, {
      namespace: ctx.tenantId,          // per-user scope
      query,
      limit: 8,
      searchType: "hybrid",             // RRF vector + full-text (0.7.5)
      vectorScoreThreshold: 0.2,        // tune; drops weak matches
    });
    const seedDocIds = entries.map((e) => e.metadata?.vaultDocId).filter(Boolean);
    // graph-expand: pure @pikar/vault BFS over edges fetched by index (≤ GRAPH_HOP_CAP hops)
    const neighborDocIds = await ctx.runQuery(internal.vaultGraph.expand, {
      tenantId: ctx.tenantId, seedDocIds, hopCap: GRAPH_HOP_CAP,
    });
    // merge/dedupe/rank in @pikar/vault (vector score first, graph proximity as tiebreak)
    return fuse(results, seedDocIds, neighborDocIds);
  },
});
```

### Pattern 5: Graph upsert with cross-doc dedup + degree bookkeeping (VALT-02)
```ts
// Upsert on (tenantId, type, normalizedName) via by_tenant_normalized. Same entity across docs → ONE node.
async function upsertNode(ctx, tenantId, type, name) {
  const normalizedName = normalizeName(name);              // @pikar/vault
  const found = await ctx.db.query("graphNodes")
    .withIndex("by_tenant_normalized", (q) => q.eq("tenantId", tenantId).eq("normalizedName", normalizedName))
    .filter((q) => q.eq(q.field("type"), type)).first();
  if (found) return found._id;
  return ctx.db.insert("graphNodes", { tenantId, type, name, normalizedName, degree: 0 });
}
// On each new edge: patch both endpoints' degree += 1. On delete: degree -= 1; degree===0 → delete node (orphan GC).
```

### Pattern 6: Signed-URL download (mirror `plans.ts attachmentUrls`)
```ts
// The URL is a bearer capability → ONLY returned from a tenant-guarded query, NEVER logged (§4).
export const vaultDownloadUrl = tenantQuery({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }) => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return null; // never leak another tenant's URL
    return doc.storageId ? await ctx.storage.getUrl(doc.storageId) : null;
  },
});
```

### Pattern 7: Delete cascade + orphan GC
```ts
export const deleteVaultDoc = tenantMutation({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }) => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return;
    // 1) rag chunks: deleteAsync works in a MUTATION (background workpool)
    if (doc.ragEntryId) await rag.deleteAsync(ctx, { entryId: doc.ragEntryId });
    // 2) edges with sourceDocId = this doc → collect endpoints, delete edges
    const edges = await ctx.db.query("graphEdges")
      .withIndex("by_tenant_source", (q) => q.eq("tenantId", ctx.tenantId).eq("sourceDocId", vaultDocId)).collect();
    for (const e of edges) {
      await ctx.db.delete(e._id);
      for (const nid of [e.fromNodeId, e.toNodeId]) {
        const n = await ctx.db.get(nid);
        if (!n) continue;
        const degree = n.degree - 1;
        if (degree <= 0) await ctx.db.delete(nid);           // orphan GC
        else await ctx.db.patch(nid, { degree });
      }
    }
    // 3) storage bytes + metadata row
    if (doc.storageId) await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(vaultDocId);
  },
});
```
**Note:** an edge index keyed on `sourceDocId` (`by_tenant_source`) is needed for the cascade in addition to the `by_tenant_fromNode`/`by_tenant_toNode` traversal indexes.

### Anti-Patterns to Avoid
- **Calling `rag.add`/`rag.search`/`rag.delete` from a mutation/query.** They need an action ctx (embedding/fetch). Use `addAsync`/`deleteAsync` in mutations, `add`/`search`/`delete` in actions.
- **A second `"use node"` module.** Documented circular-inference cliff (`llm.ts`). Use a V8 action for the extractor.
- **Hand-rolling a vector index.** rag ships chunking/embedding/hybrid/dedup/cascade.
- **Storing raw text in graph/audit/deadLetter payloads.** §4 — graph payloads carry refs/ids only; raw text lives ONLY in `vaultDocuments.text` (content plane) and the rag chunk store.
- **Manual raw `query`/`mutation`/`action` imports** in vault feature files (§2 / biome ban) — go through `lib/functions.ts` wrappers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chunking text | A paragraph splitter | `rag.add({text})` / `defaultChunker` | Ships 100–1000-char soft-limit chunker; battle-tested boundaries |
| Embedding + vector index | `defineTable().vectorIndex()` + `ctx.vectorSearch` | `rag.add` / `rag.search` | Component owns dim-matching, namespacing, storage, model-id binding |
| Hybrid keyword+vector rank | Custom score blending | `searchType:'hybrid'` (RRF) + `textWeight`/`vectorWeight` | Reciprocal Rank Fusion built in; `hybridRank` util also exported |
| Content dedup | Ad-hoc hash table | `rag.findEntryByContentHash` + `key`/`contentHash` on `add` | Component-level replace-or-skip semantics |
| Chunk cascade delete | Manual chunk sweep | `rag.deleteAsync({entryId})` | Background workpool deletes entry + all chunks |
| Durable multi-step ingest with retry | `ctx.scheduler` chains | `@convex-dev/workflow` `define()` | Per-step retry + durability, already the house pattern |
| Cost/kill-switch gating | New guard path | `guardrails.preCall` / `recordSpend` / `rateLimiter` | Same budget ledger; kill switch stops ingest for free |
| SHA-256 content hash | New hasher | `lib/hash.ts contentHash` | One implementation, many callers (rung 2) |
| Signed download URL | New storage query | `plans.ts attachmentUrls` pattern | Tenant-guarded bearer-capability, never-logged (§4) |

**Key insight:** ~80% of VALT-01/03/04 is configuration of an already-installed component. The genuinely new code is the graph layer (tables + upsert + BFS + GC), the extractor skill, the ingest workflow wiring, and the UI — all small and thin.

## Common Pitfalls

### Pitfall 1: Action-vs-mutation for RAG calls
**What goes wrong:** `rag.add`/`search`/`delete` typecheck-fail or crash if called from a mutation/query (they need `CtxWith<"runMutation">`/`"runAction"` = an ActionCtx that can fetch OpenAI).
**How to avoid:** Embed/search/sync-delete only inside **action** steps (`step.runAction` in the workflow; `tenantAction` for `vaultGround`). Use `addAsync`/`deleteAsync` when you must stay in a mutation. Browse `list`/`getEntry`/`findEntryByContentHash` are query-safe.
**Warning signs:** TS error "ctx not assignable to CtxWith"; runtime "fetch is not available".

### Pitfall 2: Embedding dimension cap / mismatch
**What goes wrong:** `embeddingDimension` must equal the model output (1536) AND stay ≤ Convex's 2048 vector-index cap. A mismatch silently fails to match entries (rag only searches entries whose `modelId` + dimension + `filterNames` match the instance).
**How to avoid:** Hard-code `embeddingDimension: 1536` with `openai.embedding("text-embedding-3-small")`; never change one without the other. If you ever switch models, entries embedded under the old model become unsearchable until re-embedded.

### Pitfall 3: The `"use node"` circular-inference cliff (extractor home)
**What goes wrong:** Adding a second `"use node"` module (e.g. a `vaultLlm.ts` with `"use node"`) re-triggers the TS `internal`-graph circular-inference blow-up documented in `llm.ts` (02-06). Lane C also may NOT touch `llm.ts`.
**How to avoid:** Put the extractor in a **default-runtime (V8)** `vaultLlm.ts` — `generateObject` + `@ai-sdk/openai` run in V8 (llm.ts is node only for `pdf-lib` + `node:crypto`). If any handler still hits the inference cliff, annotate explicit `Promise<...>` return types on the internalActions (the 02-06/§96 mitigation) rather than switching to node.
**Warning signs:** `tsc` hangs or "Type instantiation is excessively deep"; a `"use node"` directive appearing in a vault file.

### Pitfall 4: convex-test cannot embed (offline) — SMOKE seam required
**What goes wrong:** `rag.add`/`search` hit OpenAI; offline `convex-test` has no network → tests hang/fail. Also the rag + workflow components must be registered in convex-test to run at all.
**How to avoid:** Route the embed/search/extract behind a `SMOKE::` sentinel (mirror `llm.ts parseSmoke`) that returns deterministic fixtures with NO model call. Unit-test the *domain* logic (`@pikar/vault` traversal/fusion/normalize) purely, and the *graph upsert/GC/cascade* mutations via `convex-test`. Register the workflow component like `cockpit.test.ts` (`t.registerComponent("workflow", ...)` + `"workflow/workpool"`); register the rag component (`t.registerComponent("rag", ragSchema, ragModules)` importing from `node_modules/@convex-dev/rag/src/component/**`) only for pathways that don't embed. Cover the real embed/search path in a **live smoke script** (mirror `scripts/run-smoke-*.mjs`).
**Warning signs:** a vault test making a real network call; a hanging vitest run.

### Pitfall 5: Workpool test devDep already pinned
**Note (not a bug):** `@convex-dev/workpool@0.4.7` is already a test-only devDep (the version `@convex-dev/workflow@0.4.4` resolves). Reuse it for convex-test workflow registration — do NOT add another. Also the known pre-existing red `convex/audit.test.ts` (auditCounts unregistered) is NOT a regression — don't chase it.

### Pitfall 6: Biome raw-import ban (§2)
**What goes wrong:** Importing `query`/`mutation`/`action` from `_generated/server` in a vault feature file trips the biome `noRestrictedImports` rule + `importGuard.test.ts`.
**How to avoid:** Import `tenantQuery/tenantMutation/tenantAction` from `lib/functions.ts`. `internalMutation`/`internalQuery`/`internalAction` are NOT banned (guardrails/telemetry precedent) — use them for workflow steps and the extractor.

### Pitfall 7: Playbook watch.json registration (§9)
**What goes wrong:** New code under `packages/vault/` + `convex/vault*.ts` + the vault route with no playbook coverage → the Stop hook (`check-playbooks.mjs`) blocks the turn.
**How to avoid:** Create `docs/playbooks/vault.md` from `TEMPLATE.md` and register its watched prefixes in `docs/playbooks/watch.json` (`packages/vault`, `packages/backend/convex/vault*`, the graph modules, and `apps/web/app/(app)/dashboard/vault`). Bump `Last verified` in the same phase. The `graph-extractor` skill sources are already covered by the skill-registry watch prefixes (verify, don't duplicate).

### Pitfall 8: Optional-field schema growth + append-only singletons (Lane C boundary)
**What goes wrong:** Reordering/reformatting `schema.ts` or `skills.ts` breaks the append-only merge discipline other lanes depend on.
**How to avoid:** Add `vaultDocuments`/`graphNodes`/`graphEdges` as NEW tables in your own block; append the `graph-extractor` seed to `seedSkills` without touching other rows; new tables + optional fields, no migration.

### Pitfall 9: PII boundary is asymmetric (§4 vs content plane)
**What goes wrong:** Over-redacting the download/preview (breaks the user's own verbatim content) OR under-redacting the extractor/audit (leaks PII).
**How to avoid:** Raw text lives ONLY in `vaultDocuments.text` (content plane, user's own data) + the rag chunk store. Everything that leaves for an LLM (extractor) or a log (audit/deadLetter/graph payload) gets `safeText`/refs-only. Default the embedded text to `safeText` too (per Discretion + the zero-retention LLM contract).

## Code Examples

### Graph-extractor: structured JSON via `generateObject` (V8 action, mirrors `draftCockpit`)
```ts
// convex/vaultLlm.ts — NO "use node". Loads the skill (§5), redact-then-extract, SMOKE:: offline.
import { generateObject, jsonSchema } from "ai";
import { openai } from "@ai-sdk/openai";
export const extractGraph = internalAction({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId, tenantId }): Promise<{ nodes: {type:string;name:string}[]; edges: {from:string;to:string;rel:string}[]; costUsd: number }> => {
    const skill = await ctx.runQuery(internal.skills.getActiveSkill, { name: GRAPH_EXTRACTOR_SKILL });
    const doc = await ctx.runQuery(internal.vault.getDoc, { vaultDocId });
    const scan = scanText(doc.text);
    if (!scan.ok) throw new Error("pii_scan_failed"); // fail closed
    if (isSmoke(scan.value.safeText)) return smokeGraphFixture(scan.value.safeText); // deterministic, no model
    const { object, usage } = await generateObject({
      model: openai(DEFAULT_MODEL), system: skill.body, prompt: scan.value.safeText,
      schema: jsonSchema<{ nodes: {type:string;name:string}[]; edges: {from:string;to:string;rel:string}[] }>({ /* ... */ }),
    });
    return { ...object, costUsd: priceUsage(DEFAULT_MODEL, usage) };
  },
});
```

### The `graph-extractor` skill (5-file mirror — mirror `document-drafter`)
Five coordinated edits (verified pattern): (1) canonical `packages/contracts/skills/graph-extractor.md`; (2) byte-identical derived `packages/contracts/src/skills/graphExtractor.ts` (`export const graphExtractorSkillBody = "..."`); (3) `GRAPH_EXTRACTOR_SKILL = "graph-extractor"` name const in `packages/contracts/src/skill.ts`; (4) an appended seed row in `convex/skills.ts seedSkills`; (5) a drift `test.each` row asserting `.md` ≡ `.ts`. `seedSkills` publishes-on-change (new version + activate) automatically.

### Browse list (cheap query, no vectors — VALT-04)
```ts
export const listVaultDocs = tenantQuery({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category }) => {
    let q = ctx.db.query("vaultDocuments").withIndex("by_tenant", (i) => i.eq("tenantId", ctx.tenantId));
    const rows = await q.collect();
    return category ? rows.filter((r) => r.category === category) : rows; // tabs filter one `category` field
  },
});
// Stats: TOTAL FILES = rows.length; PROCESSED = rows.filter(status==='ready'); STORAGE USED = Σ size; CATEGORIES = 6 (const).
```

### UI wiring (match screenshots, tokens only)
- Route: `apps/web/app/(app)/dashboard/vault/page.tsx` + subcomponents (StatTile, CategoryTabs, Dropzone, SearchBar, DocGrid/DocList, PreviewModal, DetailPanel).
- Tokens (from `globals.css`, verified): `--teal-600 #009689` (active tab pill, Refresh, "Click to upload" link, Send-style CTAs), `--teal-900`, `--canvas #f8fafc`, `--card #fff`, `--ink`/`--ink-soft`, `--rule #d8dbe0`. Stat-tile icon badges = rounded-square solid-fill tiles (teal/green/blue/purple per screenshot brand-024258). "Loading" pill = small dark pill top-right (BRAND §5). Reuse the cockpit card idioms (`cards.tsx`) + no component library.
- Upload: `ctx.storage.generateUploadUrl()` (client POST bytes) → `vaultUpload` mutation records `vaultDocuments` + `storageId` + `status:'processing'` + `workflow.start`. TXT/MD/CSV read text client- or server-side and feed the workflow; PDF/DOCX/XLSX/PPTX/Images store bytes + `status:'pending extraction'` (no embed) awaiting the `vaultIngestText(docId, extractedText)` seam.
- Search box calls the same `rag.search` primitive (`searchType:'hybrid'`) scoped to the active category via a metadata filter or a post-filter on `metadata.vaultDocId`'s category.

### `vaultIngestText` seam (Phase-4 + agent write path)
```ts
// Single ingest entrypoint reused by paste, the agent write path, and (later) Phase-4 extractors.
export const vaultIngestText = tenantMutation({
  args: { text: v.string(), title: v.optional(v.string()), source: v.optional(v.string()), docId: v.optional(v.id("vaultDocuments")) },
  handler: async (ctx, { text, title, source, docId }) => {
    const contentHash = await sha(text); // lib/hash
    // hash dedup: (tenantId, contentHash) already present → return existing, skip workflow
    // else insert vaultDocuments{status:'processing', category: categoryFor(source, mime)} + workflow.start(ingestDoc)
    // docId set (Phase-4 late text arrival) → patch text + flip status:'processing' + start workflow
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `maxSteps` on the AI SDK loop | `stopWhen: stepCountIs(n)` | ai@7 | Not directly used here (no agent loop in vault), but note if the extractor ever loops |
| Manual `ctx.vectorSearch` + `defineTable().vectorIndex()` | `@convex-dev/rag` component | rag 0.x | The blessed, namespaced, dedup-aware path |
| `rag.delete` in a mutation | `rag.deleteAsync` in a mutation (0.7.x) | rag 0.7 | `delete(mutation)` is `@deprecated`; use `deleteAsync` in mutations, `delete` in actions |

**Deprecated/outdated:**
- `rag.delete(ctx: mutation)` — deprecated; use `deleteAsync` in mutations.
- Specifying both `chunks` and `text` on `add` — deprecated; provide exactly one.

## Open Questions

1. **Category-scoped hybrid search filter.** The search box is scoped to the active category tab. rag `filters` are OR'd metadata matches — need to insert entries with a `filterValues: [{name:'category', value}]` (declared via `filterNames` on the RAG constructor) to filter server-side, OR post-filter results by joining `metadata.vaultDocId` → `vaultDocuments.category`.
   - What we know: `filterNames`/`filterValues` exist; filters are OR'd.
   - What's unclear: whether server-side filtering is worth the `filterNames` coupling vs a cheap post-filter.
   - Recommendation: start with a **post-filter** (simplest, one `category` field on `vaultDocuments`); add `filterValues` only if result volume makes post-filtering lossy. Planner decides.

2. **Where `pii.scanText` runs for embedded text.** Discretion defaults to `safeText`. But the search box query is user-typed and needs to match embedded content — if chunks are redacted, queries over PII terms won't match.
   - Recommendation: embed `safeText` (privacy default), accept that redacted-entity search is lossy for the beta; document it. Preview/download always show raw `vaultDocuments.text`.

3. **Chunk-level graph mapping granularity.** `vaultGround` maps seed *entries* (docs) to graph nodes. Finer chunk→node mapping is possible but unneeded at hop-cap 2.
   - Recommendation: map at the **doc** level (`metadata.vaultDocId`) — matches the `sourceDocId` edge model.

## Validation Architecture

*(nyquist_validation is `true` in `.planning/config.json` → this section is REQUIRED.)*

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` ^3.2.7 + `convex-test` 0.0.54 (backend); pure vitest (`@pikar/vault`); Playwright 1.61.1 (web E2E) |
| Config file | `packages/backend/vitest.config.*` (existing); web `playwright.config.ts` (existing) |
| Quick run command | `pnpm --filter @pikar/vault test` (pure domain) / `pnpm --filter @pikar/backend test` (convex-test) |
| Full suite command | `pnpm test` + the new `pnpm --filter @pikar/backend smoke:vault` (live) + `pnpm --filter @pikar/web test` (Playwright) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VALT-01 | `vaultUpload` writes `vaultDocuments{status:processing}` + storage + starts ingest workflow; hash-dedup skips re-embed | unit (convex-test) | `pnpm --filter @pikar/backend test vault` | ❌ Wave 0 |
| VALT-01 | Real embed via `rag.add` (text-embedding-3-small@1536) → entry searchable | live smoke | `pnpm --filter @pikar/backend smoke:vault` | ❌ Wave 0 |
| VALT-02 | `extractGraph` SMOKE:: fixture → `upsertGraph` dedupes same entity across 2 docs to ONE node; degree bookkeeping | unit (convex-test) | `pnpm --filter @pikar/backend test vaultGraph` | ❌ Wave 0 |
| VALT-02 | `normalizeName`, BFS traversal, orphan-GC-on-delete are correct | unit (pure) | `pnpm --filter @pikar/vault test` | ❌ Wave 0 |
| VALT-03 | `vaultGround` SMOKE:: path: vector-seed → graph-expand ≤2 → merge; tenant-scoped (cross-tenant returns nothing) | unit (convex-test) + pure fusion | `pnpm --filter @pikar/backend test vaultGround` | ❌ Wave 0 |
| VALT-03 | Live hybrid retrieval returns a real merged context for a seeded corpus | live smoke | `pnpm --filter @pikar/backend smoke:vault` | ❌ Wave 0 |
| VALT-04 | Vault route renders 4 stat tiles + 6 tabs + dropzone + search + grid/list; honest-zero empty state; upload→processing→ready reactive; delete cascades | E2E (Playwright, SMOKE:: ingest) | `pnpm --filter @pikar/web test vault` | ❌ Wave 0 |
| VALT-04 | Signed-URL download is tenant-guarded (cross-tenant → null) | unit (convex-test) | `pnpm --filter @pikar/backend test vault` | ❌ Wave 0 |
| §4 | graph/audit/deadLetter payloads carry NO raw text; only `vaultDocuments.text` + rag chunks hold raw | static scan (mirror `llmRedaction.test.ts`) | `pnpm --filter @pikar/backend test vaultRedaction` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @pikar/vault test` (fast, pure) + the touched `convex-test` file.
- **Per wave merge:** `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/web typecheck`.
- **Phase gate:** full `pnpm test` green + `smoke:vault` (live embed/search/ground on a dev deployment) + Playwright vault spec, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/vault/` package scaffold + `src/*.test.ts` (normalize, traversal, fusion, categories) — VALT-02/03
- [ ] `convex/vault.test.ts` — ingest/dedup/download-guard/delete-cascade (register workflow + rag components) — VALT-01/04
- [ ] `convex/vaultGraph.test.ts` — upsert dedup + degree + orphan GC — VALT-02
- [ ] `convex/vaultGround.test.ts` — SMOKE:: hybrid fusion + tenant scope — VALT-03
- [ ] `convex/vaultRedaction.test.ts` — §4 static scan of vault modules
- [ ] `apps/web/.../vault.spec.ts` — Playwright E2E over a SMOKE:: ingest — VALT-04
- [ ] `scripts/run-smoke-vault.mjs` + `smoke:vault` package script — live embed/search/ground gate
- [ ] `SMOKE::` seam in the extractor + embed/search paths (deterministic offline fixtures)
- [ ] No framework install needed (vitest/convex-test/Playwright/workpool devDep all present)

## Sources

### Primary (HIGH confidence)
- `packages/backend/node_modules/@convex-dev/rag/dist/client/index.d.ts` @ 0.7.5 — exact `RAG` constructor, `add`/`addAsync`/`search`/`generateText`/`list`/`getEntry`/`findEntryByContentHash`/`getOrCreateNamespace`/`delete`/`deleteAsync`/`deleteByKey`/`defineOnComplete`/`defineChunkerAction` signatures; `SearchOptions` (`searchType` vector/text/hybrid, `vectorScoreThreshold`, `chunkContext`, `textWeight`/`vectorWeight`, `filters`); `CtxWith` action/mutation/query requirements.
- `packages/backend/convex/convex.config.ts` — `app.use(rag)` already registered.
- `packages/backend/convex/{deliverApprovedPlan,index,guardrails,plans,llm,skills}.ts`, `lib/{functions,hash}.ts` — verified reuse patterns (workflow steps, tenant wrappers, preCall/recordSpend/rateLimiter, attachmentUrls signed URL, 5-file skill mirror, generateObject/jsonSchema, `"use node"` cliff note).
- `packages/backend/convex/cockpit.test.ts` — convex-test component registration pattern.
- `docs/design/BRAND.md` + `docs/design/brand/brand-024242.png` + `brand-024258.png` + `apps/web/app/globals.css` — UI ground truth + tokens.
- `.planning/{PARALLELIZATION,STATE,REQUIREMENTS}.md`, `05-CONTEXT.md`, `.planning/config.json`.

### Secondary (MEDIUM confidence)
- `get-convex/rag` README (GitHub `main`) — usage examples (`generateText`, `hybridRank`, `defaultChunker`, `defineOnComplete`); cross-checked against the pinned dts (a few names, e.g. `RAG` construction options, matched exactly).

### Tertiary (LOW confidence)
- None material — all load-bearing claims verified against the pinned `node_modules` types or repo source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — RAG/workflow APIs read from pinned `node_modules`; all reuse deps already present.
- Architecture: HIGH — patterns mirror verified existing modules (`deliverApprovedPlan`, `plans.attachmentUrls`, the 5-file skill mirror, guardrails triad).
- Pitfalls: HIGH — action-vs-mutation, dim cap, node cliff, convex-test embedding, biome ban, watch.json all grounded in source/CLAUDE.md/STATE.md.
- UI: HIGH — screenshots + `globals.css` tokens are committed ground truth.
- Open questions: MEDIUM — category-filter strategy + embed-safeText tradeoff are genuine design choices left to the planner.

**Research date:** 2026-07-14
**Valid until:** ~2026-08-14 (stable — versions are pinned pre-1.0; re-verify only if a component is bumped, which §6 forbids casually).
