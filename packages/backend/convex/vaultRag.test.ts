// @vitest-environment node
//
// The embedding adapter's PURE half (VALT / 2026-08-07 provider swap). Offline and free: everything
// asserted here is arithmetic or request shape, so no key and no network.
//
// WHY THIS FILE EXISTS AT ALL. The vault swapped `text-embedding-3-small` (OpenAI) for
// `gemini-embedding-001` because the OpenAI balance is $0 and the Gemini free tier is not. Two of
// the three differences between those providers FAIL SILENTLY — no error, no log, just quietly worse
// retrieval — which is exactly the class this repo keeps getting bitten by, so they are pinned here.

import { expect, test } from "vitest";
import {
  buildGeminiEmbedRequest,
  buildOpenAIEmbedRequest,
  EMBEDDING_DIM,
  embedBackoffMs,
  embeddingContentHash,
  isRetriableEmbedStatus,
  l2Normalize,
} from "./vaultRag";

// ── 1. NORMALISATION — the silent one ────────────────────────────────────────
//
// MEASURED against the live API 2026-08-07: `gemini-embedding-001` at the FULL 3072 dims returns a
// unit vector (L2 = 1.000000), but at `outputDimensionality: 1536` it returns L2 ≈ 0.6976. Google's
// Matryoshka truncation drops the tail of the vector and does NOT re-scale what is left.
//
// Cosine similarity is scale-invariant, so an UNNORMALISED vector is not obviously broken — it is
// subtly broken: ranking degrades and nothing errors. OpenAI returned unit vectors, so nothing in
// the vault ever had to think about this.
//
// MUTATION that turns this RED: return `values` unchanged from the adapter instead of normalising.
test("l2Normalize returns a unit vector (Gemini @1536 arrives at L2≈0.6976, NOT 1)", () => {
  // A vector whose norm is deliberately not 1, matching the shape of the real defect.
  const raw = [0.6, 0.8, 0.0]; // L2 = 1.0 exactly … scaled below to mimic truncation
  const truncated = raw.map((x) => x * 0.6976);
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

  expect(norm(truncated)).toBeCloseTo(0.6976, 4); // the measured pre-state
  expect(norm(l2Normalize(truncated))).toBeCloseTo(1, 10); // the post-state we depend on
});

test("l2Normalize preserves DIRECTION — it may only rescale", () => {
  const v: [number, number, number] = [3, -4, 12];
  const [u0, u1, u2] = l2Normalize(v) as [number, number, number];
  // Every component scales by the same factor, so ratios are untouched. If normalisation ever
  // reordered or clipped components it would silently change what each chunk MEANS.
  expect(u0 / u1).toBeCloseTo(v[0] / v[1], 10);
  expect(u2 / u0).toBeCloseTo(v[2] / v[0], 10);
  expect([u0, u1, u2].every((x, i) => Math.sign(x) === Math.sign(v[i] ?? 0))).toBe(true);
});

test("l2Normalize leaves a zero vector alone instead of emitting NaN", () => {
  // A zero vector has no direction to preserve. Dividing by its norm yields NaN, and a NaN vector
  // poisons every downstream cosine comparison rather than merely being useless.
  expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
});

// ── 2. REQUEST SHAPE — the dimension is load-bearing ─────────────────────────
//
// `EMBEDDING_DIM` must reach the API as `outputDimensionality`. Omit it and Gemini returns 3072
// floats into a Convex vector index declared at 1536 — a hard failure, but only at ingest time on a
// real deployment, which is the worst place to discover it.
test("buildGeminiEmbedRequest pins the model and the 1536 outputDimensionality on EVERY item", () => {
  const req = buildGeminiEmbedRequest(["alpha", "beta"]);
  expect(req.requests).toHaveLength(2);
  for (const r of req.requests) {
    expect(r.model).toBe("models/gemini-embedding-001");
    expect(r.outputDimensionality).toBe(EMBEDDING_DIM);
  }
  expect(EMBEDDING_DIM).toBe(1536); // ≤ Convex's 2048 vector-index cap (Pitfall 2)
  expect(req.requests.map((r) => r.content.parts[0]?.text)).toEqual(["alpha", "beta"]);
});

// The same load-bearing field under a different name. OpenAI calls it `dimensions`, and pinning it
// explicitly keeps the width tied to EMBEDDING_DIM rather than to a provider default that could
// move under us — the failure would be 3072 floats into a 1536 index, at ingest time, in prod.
test("buildOpenAIEmbedRequest pins the model and the 1536 `dimensions`", () => {
  const req = buildOpenAIEmbedRequest(["alpha", "beta"]);
  expect(req.model).toBe("text-embedding-3-small");
  expect(req.dimensions).toBe(EMBEDDING_DIM);
  // Batched in ONE request, unlike Gemini's per-item `requests` array — the two providers differ in
  // shape here, which is why each has its own builder rather than one with a flag.
  expect(req.input).toEqual(["alpha", "beta"]);
});

// ── 3. DEDUP IDENTITY — what makes the provider swap safe ────────────────────
//
// `rag.add` REPLACES an entry with the same `key` but DEDUPLICATES on `contentHash`. The document
// text did not change when the provider did, so a bare text hash would make every existing document
// look already-embedded and it would keep its OpenAI vector forever — silently unsearchable against
// new Gemini vectors, because the two live in different embedding spaces.
//
// Scoping the hash to the model means a provider change invalidates dedup automatically, for this
// swap and every future one.
test("embeddingContentHash scopes dedup to the MODEL, so a provider swap re-embeds", () => {
  const sha = "abc123";
  // Asserts the SHAPE, not which provider is pinned today — the point is that the identity moves
  // with the model, in BOTH directions of the OpenAI/Gemini A/B.
  expect(embeddingContentHash(sha)).toMatch(/^(text-embedding-3-small|gemini-embedding-001):/);
  expect(embeddingContentHash(sha)).toContain(sha);
  // The whole point: same text, different model ⇒ different dedup identity.
  expect(embeddingContentHash(sha)).not.toBe(sha);
});

// A burst of vault seeds against production returned `embeddings API 429` on contact and every
// caller failed outright. The same path serves a user importing documents, so the retry is the
// difference between a slow ingest and a failed one.
test("retries a rate limit and a server fault, and NOTHING else", () => {
  expect(isRetriableEmbedStatus(429)).toBe(true);
  expect(isRetriableEmbedStatus(500)).toBe(true);
  expect(isRetriableEmbedStatus(503)).toBe(true);
  // A credential or request fault cannot be fixed by asking again.
  expect(isRetriableEmbedStatus(400)).toBe(false);
  expect(isRetriableEmbedStatus(401)).toBe(false);
  expect(isRetriableEmbedStatus(403)).toBe(false);
  expect(isRetriableEmbedStatus(404)).toBe(false);
});

test("prefers the provider's Retry-After, but will not be parked by an absurd one", () => {
  expect(embedBackoffMs(1, 3)).toBe(3000);
  // 10 minutes from a hostile or broken header must not hold the action open.
  expect(embedBackoffMs(1, 600)).toBe(30_000);
});

test("backs off exponentially, with a ceiling, when no header is given", () => {
  const noHeader = Number.NaN;
  expect(embedBackoffMs(1, noHeader)).toBe(1000);
  expect(embedBackoffMs(2, noHeader)).toBe(2000);
  expect(embedBackoffMs(3, noHeader)).toBe(4000);
  // Ceiling holds however many attempts have failed.
  // Ceiling is 30s, NOT 8s: the limiter is per-minute, so a backoff that tops out below the
  // window just fails more slowly. Six attempts at this curve span ~61s.
  expect(embedBackoffMs(5, noHeader)).toBe(16_000);
  expect(embedBackoffMs(9, noHeader)).toBe(30_000);
});

test("adds jitter so parallel callers do not re-collide in lockstep", () => {
  const noHeader = Number.NaN;
  expect(embedBackoffMs(1, noHeader, 0)).toBe(1000);
  expect(embedBackoffMs(1, noHeader, 0.999)).toBe(1249);
});
