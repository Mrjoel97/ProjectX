// The SINGLE RAG instance construction site for the knowledge vault.
//
// Every vault module (ingest, ground, delete-cascade) imports THIS `rag` — it is
// constructed exactly once, mirroring how `index.ts` constructs `workflow`/`retrier`
// once. Pinned to `text-embedding-3-small` @ 1536 dims: the dimension MUST equal the
// model output AND stay under Convex's 2048 vector-index cap (Pitfall 2) — never change
// one without the other, or entries silently stop matching. Plans 04/05 append the
// embed/search action steps here.

import { openai } from "@ai-sdk/openai";
import { RAG } from "@convex-dev/rag";
import { priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// ponytail: the exact `EmbeddingModel` RAG's constructor expects. Derived from RAG
// itself (not imported from "ai") so it tracks the ai@6 that `@convex-dev/rag` bundles,
// independent of the backend's own ai@7 — the two provider majors declare incompatible
// `EmbeddingModel` types even though the runtime shape is identical. Same skew the
// LanguageModel casts in llm.ts absorb; drop when the pinned versions realign (§6).
type RagEmbeddingModel = ConstructorParameters<typeof RAG>[1]["textEmbeddingModel"];

export const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small") as unknown as RagEmbeddingModel,
  embeddingDimension: 1536, // MUST equal the model output AND be ≤ Convex's 2048 cap (Pitfall 2)
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
    if (safeText.startsWith(SMOKE_PREFIX)) return { entryId: `smoke::${doc.contentHash}`, costUsd: 0 };

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
