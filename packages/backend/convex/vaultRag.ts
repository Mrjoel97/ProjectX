// The SINGLE RAG instance construction site for the knowledge vault.
//
// Every vault module (ingest, ground, delete-cascade) imports THIS `rag` — it is
// constructed exactly once, mirroring how `index.ts` constructs `workflow`/`retrier`
// once. Pinned to `text-embedding-3-small` @ 1536 dims: the dimension MUST equal the
// model output AND stay under Convex's 2048 vector-index cap (Pitfall 2) — never change
// one without the other, or entries silently stop matching. Plans 04/05 append the
// embed/search action steps here.

import { RAG } from "@convex-dev/rag";
import { priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536; // MUST equal the model output AND stay ≤ Convex's 2048 cap (Pitfall 2)

// ponytail: `@convex-dev/rag@0.7.5` bundles ai@6, whose `embedMany` accepts ONLY an
// EmbeddingModelV2 (`specificationVersion: "v2"`). The backend's `@ai-sdk/openai@4`
// (paired with ai@7, which llm.ts needs) produces a spec-"v4" model that ai@6 REJECTS at
// runtime — `AI_UnsupportedModelVersionError`. A prior `openai.embedding(...) as unknown as`
// cast silenced only the compile error; the runtime object was still v4 and every ingest
// embed threw. This ~25-line adapter implements the tiny v2 contract ai@6 checks by calling
// OpenAI's embeddings REST API directly, decoupling RAG from the provider-major skew (no new
// dep, no §6 bump). Drop when the pinned RAG realigns to ai@7.
const openaiEmbeddingV2 = {
  specificationVersion: "v2" as const,
  provider: "openai.embedding",
  modelId: EMBEDDING_MODEL,
  maxEmbeddingsPerCall: 2048, // OpenAI's per-request input cap
  supportsParallelCalls: true,
  async doEmbed({
    values,
    abortSignal,
    headers,
  }: {
    values: string[];
    abortSignal?: AbortSignal;
    headers?: Record<string, string | undefined>;
  }): Promise<{ embeddings: number[][]; usage: { tokens: number } }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("vault: OPENAI_API_KEY unset for embeddings");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      // `...headers` FIRST: these two are TRANSPORT-level and must win over anything the caller
      // injects. With the spread last, a caller-supplied `Authorization` key — including
      // present-but-undefined — silently replaces or blanks our key, and the call 401s from a line
      // that reads as though it set the auth header. `headers` is the optional bag from the
      // @convex-dev/rag `doEmbed` contract, so nothing populates it today; this is the same
      // spread-after-explicit shape that cost a paid eval fixture at dispatch.ts (5460a81).
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: values, dimensions: EMBEDDING_DIM }),
      signal: abortSignal,
    });
    if (!res.ok) throw new Error(`vault: embeddings API ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    return {
      embeddings: json.data.map((d) => d.embedding),
      usage: { tokens: json.usage?.prompt_tokens ?? 0 },
    };
  },
};

// The two provider majors (ai@6 in RAG, ai@7 in the backend) declare structurally-divergent
// `EmbeddingModel` types, so the cast is still needed to satisfy the constructor — but unlike
// before, the object BEHIND it now genuinely implements the v2 contract ai@6 enforces at runtime.
type RagEmbeddingModel = ConstructorParameters<typeof RAG>[1]["textEmbeddingModel"];

export const rag = new RAG(components.rag, {
  textEmbeddingModel: openaiEmbeddingV2 as unknown as RagEmbeddingModel,
  embeddingDimension: EMBEDDING_DIM,
});

// ── The ingest embed step (Plan 04) ──────────────────────────────────────────
// The offline seam (Pitfall 4): a `SMOKE::`-prefixed doc never touches the embedding network, so
// convex-test / the vault smoke gate drive ingest deterministically without an OPENAI_API_KEY. The
// sentinel carries no PII, so it survives scanText verbatim.
const SMOKE_PREFIX = "SMOKE::";

/**
 * Embed a vault document's REDACTED text as the ingest workflow's embed step (VALT-01).
 *
 * An ACTION ctx (rag.add needs runMutation; Pitfall 1). Reads the doc via `internal.vault.getDoc`,
 * scans it FAIL-CLOSED (§4/Open-Q2 — the vault embeds the Discretion-default safeText; the raw
 * `doc.text` stays in vaultDocuments for preview/download only), then hash-dedups: an existing
 * (namespace=tenantId, key=contentHash) entry SKIPS re-embed (costUsd 0). Returns the rag entryId
 * + the priced embedding spend for the workflow's recordSpend.
 */
export const embedDoc = internalAction({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (ctx, { vaultDocId, tenantId }): Promise<{ entryId: string; costUsd: number }> => {
    const doc = await ctx.runQuery(internal.vault.getDoc, { vaultDocId, tenantId });

    // Redact BEFORE embedding (§4). Fail CLOSED so raw text can never reach the embedding model.
    const scan = scanText(doc.text);
    if (!scan.ok) throw new Error("vault: embed scan failed");
    const safeText = scan.value.safeText;

    // Offline deterministic path: NO network call, a fixed fake entryId keyed to the content hash.
    if (safeText.startsWith(SMOKE_PREFIX))
      return { entryId: `smoke::${doc.contentHash}`, costUsd: 0 };

    // Dedup precheck (query-safe): a second ingest of identical content reuses the existing entry.
    const existing = await rag.findEntryByContentHash(ctx, {
      namespace: tenantId,
      key: doc.contentHash,
      contentHash: doc.contentHash,
    });
    if (existing) return { entryId: existing.entryId, costUsd: 0 };

    const { entryId, usage } = await rag.add(ctx, {
      namespace: tenantId,
      text: safeText,
      key: doc.contentHash,
      contentHash: doc.contentHash,
      title: doc.title,
      metadata: { vaultDocId },
    });
    // ponytail: text-embedding-3-small is not in @pikar/cost PRICING (embeddings are ~$0.02/MTok —
    // negligible vs the graph-extract call that dominates ingest spend), so priceUsage returns 0
    // here. Add a pricing row if embedding spend ever becomes material.
    const priced = priceUsage("text-embedding-3-small", { inputTokens: usage.tokens });
    return { entryId, costUsd: priced.ok ? priced.value : 0 };
  },
});
