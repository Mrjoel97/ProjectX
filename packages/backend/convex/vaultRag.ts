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
import { components } from "./_generated/api";

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
