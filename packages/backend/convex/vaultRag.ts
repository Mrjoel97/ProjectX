// The SINGLE RAG instance construction site for the knowledge vault.
//
// Every vault module (ingest, ground, delete-cascade) imports THIS `rag` — it is
// constructed exactly once, mirroring how `index.ts` constructs `workflow`/`retrier`
// once. Pinned to `gemini-embedding-001` @ 1536 dims: the dimension MUST equal the
// model output AND stay under Convex's 2048 vector-index cap (Pitfall 2) — never change
// one without the other, or entries silently stop matching. Plans 04/05 append the
// embed/search action steps here.
//
// PROVIDER SWAPPED 2026-08-07: `text-embedding-3-small` (OpenAI) → `gemini-embedding-001`.
// WHY: the OpenAI balance is $0 (`credit_balance_exhausted` on chat AND embeddings, verified
// directly), and THIS FILE was the last OpenAI dependency in the cockpit turn — every vault-touching
// turn and every golden-gate run died here, before case one, regardless of which chat model was
// pinned. Gemini embeddings are free-tier eligible on the key the deployment already holds, so the
// swap is what makes the whole test loop cost $0.
//
// The dimension did NOT change (1536 both sides), so the Convex vector index and the schema are
// untouched. What DID change is subtler and is pinned in `vaultRag.test.ts` — read that file before
// editing this one.

import { RAG } from "@convex-dev/rag";
import { priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// TWO EMBEDDING PROVIDERS, SELECTED BY ONE CONSTANT — the same shape `resolveModel` (llm.ts) uses
// to route chat, reused here rather than invented. Flipping providers is a one-line change to
// `EMBEDDING_MODEL`, and `embeddingContentHash` below turns that flip into an automatic re-embed.
//
// WHY BOTH EXIST. OpenAI was the original; it was swapped to Gemini on 2026-08-07 while the OpenAI
// balance was $0, and swapped back on 2026-08-08 when it was funded. Neither is dead code: this is a
// live A/B, because the 2026-08-08 gate failed `citesVaultDoc` on fixtures 29/30/31 — the seeded
// vault needle stopped reaching the specialist's memo — in the OpenAI-model + GEMINI-embeddings
// combination that had never run before. The needle is a meaningless token (`evalgrd`), and a
// meaningless token is exactly where two embedding models diverge most, so which provider embeds the
// corpus is a measurable question, not a preference. Keep both until the fixtures answer it.
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
/** The ACTIVE provider. One line — everything below routes off it.
 *
 *  **BACK ON GEMINI 2026-08-24, and this time the reason is a trial, not an outage.** The dev OpenAI
 *  key is exhausted again (`credit_balance_exhausted`), which made `vaultSmoke:seedCorpus` — the one
 *  step of an eval run that embeds — the last paid dependency in a gate the ox-alpha trial otherwise
 *  makes free. Gemini embeddings are free-tier eligible on the key the deployment already holds.
 *
 *  **THE OPEN A/B FROM 2026-08-08 IS NOW THE POINT, NOT A SIDE EFFECT.** That day's gate failed
 *  `citesVaultDoc` on fixtures 29/30/31 in the OpenAI-model + Gemini-embeddings pairing: the seeded
 *  needle (`evalgrd`, a meaningless token, which is exactly where two embedding models diverge most)
 *  stopped reaching the specialist's memo. This flip pairs Gemini embeddings with a THIRD chat model,
 *  so 29/30/31 are the fixtures that answer whether that was a retrieval fault or a model-pairing
 *  one. Read them as the embedding verdict, not only as the ox-alpha verdict.
 *
 *  `embeddingContentHash` folds this name into every key, so the flip re-embeds the corpus
 *  automatically — there is no migration to run and no stale-vector window. */
const EMBEDDING_MODEL: string = GEMINI_EMBEDDING_MODEL;
export const EMBEDDING_DIM = 1536; // MUST equal the model output AND stay ≤ Convex's 2048 cap (Pitfall 2)

const usingGemini = (): boolean => EMBEDDING_MODEL === GEMINI_EMBEDDING_MODEL;

// Per-request input caps, and they differ by 20x. Google refuses 101+ with
// `BatchEmbedContentsRequest.requests: at most 100 requests can be in one batch` (measured
// 2026-08-07); OpenAI's cap is 2048. The RAG component READS this to size its batches, so
// overstating it turns a large ingest into a 400 rather than into slower progress — which is why it
// has to move WITH the provider rather than being pinned to the smaller of the two.
const MAX_EMBEDDINGS_PER_CALL = usingGemini() ? 100 : 2048;

/**
 * Scale a vector to unit length. Pure; exported for the offline test.
 *
 * **REQUIRED for Gemini, a NO-OP for OpenAI** — applied unconditionally because a no-op costs one
 * pass over 1536 floats and a missing normalisation costs silent retrieval decay. Measured
 * 2026-08-07: `gemini-embedding-001` returns a unit vector at its native 3072 dims (L2 = 1.000000)
 * but L2 ≈ 0.6976 at `outputDimensionality: 1536` — Matryoshka truncation drops the tail and does
 * not re-scale what remains. OpenAI's embeddings are already unit length.
 *
 * A zero vector is returned unchanged: it has no direction to preserve, and dividing by its norm
 * would emit NaN into the index, poisoning every later comparison instead of merely being useless.
 */
export const l2Normalize = (values: number[]): number[] => {
  let sumSquares = 0;
  for (const x of values) sumSquares += x * x;
  const norm = Math.sqrt(sumSquares);
  return norm === 0 ? values : values.map((x) => x / norm);
};

/** Gemini's `batchEmbedContents` payload. Pure; exported so the test can assert the shape with no
 *  key. `outputDimensionality` is load-bearing — omit it and Gemini returns 3072 floats into a
 *  vector index declared at 1536, which fails only at ingest time on a real deployment. */
export const buildGeminiEmbedRequest = (values: string[]) => ({
  requests: values.map((text) => ({
    model: `models/${GEMINI_EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIM,
  })),
});

/** OpenAI's `/v1/embeddings` payload. `dimensions` is the same load-bearing field under a different
 *  name — text-embedding-3-small is 1536 natively, but passing it explicitly keeps the width pinned
 *  to EMBEDDING_DIM rather than to a default that could move. */
export const buildOpenAIEmbedRequest = (values: string[]) => ({
  model: OPENAI_EMBEDDING_MODEL,
  input: values,
  dimensions: EMBEDDING_DIM,
});

/**
 * The dedup identity for a piece of vault text, SCOPED TO THE EMBEDDING MODEL.
 *
 * `rag.add` REPLACES an entry with the same `key` but DEDUPLICATES on `contentHash` (its own
 * contract). The document text does not change when the PROVIDER does — so a bare text hash makes
 * every already-embedded document look up-to-date and it keeps a vector from the OTHER model
 * forever, invisible to searches run against the new one because the two live in different embedding
 * spaces. There is no error in that world, only worse answers.
 *
 * Scoping the hash to the model makes a provider change invalidate dedup automatically — for both
 * directions of this A/B and every future swap — while leaving same-model dedup (the thing that
 * saves real money on re-ingest) exactly as it was. The `key` stays the bare content hash, so the
 * re-embed REPLACES the stale entry in place instead of orphaning it.
 */
/**
 * Is this embedding-API status worth retrying? Pure; exported for the offline test.
 *
 * 429 and 5xx ONLY. A 400/401/403 is a REQUEST or CREDENTIAL fault — retrying cannot fix it and
 * just burns the deployment's time before failing identically. Getting this set wrong in either
 * direction is expensive: too narrow and a rate limit kills an ingest, too wide and a bad key
 * retries five times on every chunk.
 */
export const isRetriableEmbedStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * The delay the SERVER asked for, in seconds, or NaN when it did not ask. Pure; exported for the
 * offline test.
 *
 * **Google does not send a `Retry-After` HEADER.** It puts `google.rpc.RetryInfo` in the JSON BODY
 * (`{"retryDelay": "56s"}`), so a header-only reader sees nothing and falls back to guessing —
 * which is what made the first two retry ceilings fail: the server was naming the exact wait and we
 * were ignoring it, then re-colliding because `embedMany` fires concurrent batches that re-consume
 * the window the moment it opens. OpenAI DOES use the header, so both are read.
 */
export const parseRetryAfterSeconds = (body: string, header: string | null): number => {
  const fromHeader = Number(header);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  try {
    const details = (JSON.parse(body) as { error?: { details?: unknown[] } }).error?.details ?? [];
    for (const d of details) {
      const delay = (d as { retryDelay?: unknown }).retryDelay;
      if (typeof delay === "string") {
        const seconds = Number(delay.replace(/s$/, ""));
        if (Number.isFinite(seconds) && seconds > 0) return seconds;
      }
    }
  } catch {
    // A non-JSON error body is normal (proxies, gateways). Fall through to the exponential guess.
  }
  return Number.NaN;
};

/**
 * How long to wait before retry `attempt`. Pure; exported for the offline test.
 *
 * Honours the provider's own `Retry-After` when it sends one — it knows its window better than a
 * guess — capped so a hostile or absurd value cannot park an action for minutes. Otherwise
 * exponential with jitter, so parallel callers that collided once do not re-collide in lockstep.
 */
export const embedBackoffMs = (attempt: number, retryAfterSeconds: number, jitter = 0): number =>
  Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(retryAfterSeconds * 1000, 90_000)
    : Math.min(2 ** attempt * 500, 30_000) + Math.floor(jitter * 250);

export const embeddingContentHash = (contentHash: string): string =>
  `${EMBEDDING_MODEL}:${contentHash}`;

// ponytail: `@convex-dev/rag@0.7.5` bundles ai@6, whose `embedMany` accepts ONLY an
// EmbeddingModelV2 (`specificationVersion: "v2"`). The backend's `@ai-sdk/*@4` providers
// (paired with ai@7, which llm.ts needs) produce a spec-"v4" model that ai@6 REJECTS at
// runtime — `AI_UnsupportedModelVersionError`. A prior `openai.embedding(...) as unknown as`
// cast silenced only the compile error; the runtime object was still v4 and every ingest
// embed threw. This adapter implements the tiny v2 contract ai@6 checks by calling the
// provider's REST API directly, decoupling RAG from the provider-major skew (no new dep, no §6
// bump). Drop when the pinned RAG realigns to ai@7.
const embeddingV2 = {
  specificationVersion: "v2" as const,
  provider: usingGemini() ? "google.embedding" : "openai.embedding",
  modelId: EMBEDDING_MODEL,
  maxEmbeddingsPerCall: MAX_EMBEDDINGS_PER_CALL,
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
    const gemini = usingGemini();
    const apiKey = gemini ? process.env.GOOGLE_GENERATIVE_AI_API_KEY : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        `vault: ${gemini ? "GOOGLE_GENERATIVE_AI_API_KEY" : "OPENAI_API_KEY"} unset for embeddings`,
      );
    }
    // Narrowed BEFORE the closure below. The `if (!apiKey) throw` above narrows `apiKey` in this
    // scope, but that narrowing does not reach inside `fetchOnce` — TypeScript cannot know when a
    // hoisted function runs, so it widens back to `string | undefined` there.
    const key: string = apiKey;
    const url = gemini
      ? `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`
      : "https://api.openai.com/v1/embeddings";
    // RETRY ON RATE LIMIT, because the provider WILL rate-limit and a hard throw here loses the
    // whole ingest. Measured on production 2026-08-27: a burst of vault seeds returned
    // `embeddings API 429` on contact and every caller failed outright. That is not an eval-harness
    // quirk — a user importing a batch of documents drives the SAME path, so without this the vault
    // silently stops accepting work whenever someone ingests more than a trickle.
    //
    // 429 and 5xx only. A 400/401/403 is a REQUEST or CREDENTIAL fault: retrying cannot fix it,
    // and retrying a bad key just burns the deployment's time before failing identically.
    // Honours `Retry-After` when the provider sends one — it knows its own window better than a
    // guess does — and otherwise backs off exponentially with jitter so parallel callers do not
    // re-collide in lockstep.
    // SIX ATTEMPTS AT A 30s CEILING, so the retries can outlast a WHOLE per-minute window:
    // 1+2+4+8+16+30 ≈ 61s. The first version capped at 8s over 5 attempts (~23s total) and STILL
    // failed every time — measured against production, where the rate limit is per-minute and a
    // window that has not rolled over yet returns 429 to every one of those attempts. A backoff
    // that cannot span the limiter's window is not a retry, it is a slower failure.
    const MAX_ATTEMPTS = 6;
    let res!: Response;
    let lastBody: string | undefined;
    for (let attempt = 1; ; attempt++) {
      res = await fetchOnce();
      if (res.ok || !isRetriableEmbedStatus(res.status) || attempt === MAX_ATTEMPTS) break;
      // Read the body ONCE and keep it: a Response body can only be consumed a single time, and the
      // final throw below needs the same text this parse reads.
      lastBody = await res.text();
      const asked = parseRetryAfterSeconds(lastBody, res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, embedBackoffMs(attempt, asked, Math.random())));
    }

    async function fetchOnce() {
      return await fetch(url, {
        method: "POST",
        // `...headers` FIRST: the auth and content-type below are TRANSPORT-level and must win over
        // anything the caller injects. With the spread last, a caller-supplied auth key — including
        // present-but-undefined — silently replaces or blanks our key, and the call 401s from a line
        // that reads as though it set the auth header. `headers` is the optional bag from the
        // @convex-dev/rag `doEmbed` contract, so nothing populates it today; this is the same
        // spread-after-explicit shape that cost a paid eval fixture at dispatch.ts (5460a81).
        headers: {
          ...headers,
          "Content-Type": "application/json",
          ...(gemini ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` }),
        },
        body: JSON.stringify(
          gemini ? buildGeminiEmbedRequest(values) : buildOpenAIEmbedRequest(values),
        ),
        signal: abortSignal,
      });
    }
    if (!res.ok)
      throw new Error(`vault: embeddings API ${res.status} ${lastBody ?? (await res.text())}`);
    const json = (await res.json()) as {
      embeddings?: Array<{ values: number[] }>;
      data?: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    const embeddings = gemini
      ? (json.embeddings ?? []).map((e) => e.values)
      : (json.data ?? []).map((d) => d.embedding);
    // FAIL CLOSED on a length mismatch. The component pairs these positionally with the chunks it
    // sent, so a short or reordered response would attach the WRONG vector to a chunk — a silent
    // corruption of the index that no later query could distinguish from bad retrieval.
    if (embeddings.length !== values.length) {
      throw new Error(
        `vault: embeddings API returned ${embeddings.length} vectors for ${values.length} inputs`,
      );
    }
    return {
      embeddings: embeddings.map(l2Normalize),
      // Google's `batchEmbedContents` reports NO usage at all (measured: the response carries only
      // `embeddings`); OpenAI reports `prompt_tokens`. Reporting whatever the provider gives is
      // honest rather than invented — and it costs nothing downstream, because `priceUsage` has no
      // row for embeddings either way (see the note at the call site in embedDoc).
      usage: { tokens: json.usage?.prompt_tokens ?? 0 },
    };
  },
};

// The two provider majors (ai@6 in RAG, ai@7 in the backend) declare structurally-divergent
// `EmbeddingModel` types, so the cast is still needed to satisfy the constructor — but unlike
// before, the object BEHIND it now genuinely implements the v2 contract ai@6 enforces at runtime.
type RagEmbeddingModel = ConstructorParameters<typeof RAG>[1]["textEmbeddingModel"];

export const rag = new RAG(components.rag, {
  textEmbeddingModel: embeddingV2 as unknown as RagEmbeddingModel,
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
    // The hash is MODEL-SCOPED (see `embeddingContentHash`) — a document embedded by the previous
    // provider does NOT match here, so it re-embeds rather than keeping a vector from a different
    // embedding space. `key` stays the bare content hash, so that re-embed REPLACES the stale entry
    // in place (`rag.add`: "if you provide a key, it will replace an existing entry with the same
    // key") instead of leaving an orphan to pollute future searches.
    const contentHash = embeddingContentHash(doc.contentHash);
    const existing = await rag.findEntryByContentHash(ctx, {
      namespace: tenantId,
      key: doc.contentHash,
      contentHash,
    });
    if (existing) return { entryId: existing.entryId, costUsd: 0 };

    const { entryId, usage } = await rag.add(ctx, {
      namespace: tenantId,
      text: safeText,
      key: doc.contentHash,
      contentHash,
      title: doc.title,
      metadata: { vaultDocId },
    });
    // ponytail: gemini-embedding-001 is not in @pikar/cost PRICING (it is free-tier eligible, and
    // billed embeddings are ~$0.02/MTok — negligible vs the graph-extract call that dominates
    // ingest spend), so priceUsage returns 0 here. It would report 0 regardless today: Google's
    // batchEmbedContents returns no usage, so `usage.tokens` is 0. Add a pricing row AND a token
    // count together if embedding spend ever becomes material — one without the other is the silent
    // under-draw that packages/cost/src/cost.ts exists to prevent.
    const priced = priceUsage(EMBEDDING_MODEL, { inputTokens: usage.tokens });
    return { entryId, costUsd: priced.ok ? priced.value : 0 };
  },
});
