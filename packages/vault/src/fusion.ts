/** A scored vector-search hit mapped to its source doc. */
export interface VectorHit {
  docId: string;
  score: number;
}

/** The fused grounding result: an ordered, deduped doc-id list + a parallel context list. */
export interface FusionResult {
  /** Ordered doc ids the `vaultGround` action will hydrate with chunk text. */
  docIds: string[];
  /**
   * Parallel-to-docIds context list. ponytail: a thin identity join for now — the
   * Convex `vaultGround` action supplies real chunk text (upgrade path: swap this
   * for the joined chunk strings without changing the ranking above).
   */
  context: string[];
}

/**
 * Merge vector-seed docs with graph-expanded neighbor docs into one deterministic,
 * deduped, ranked list (VALT-03 hybrid retrieval): vector seeds first (score desc,
 * docId asc tiebreak), then graph-only neighbors in their proximity order. A doc that
 * is both a vector seed and a graph neighbor is listed ONCE (in its vector position).
 *
 * @param vectorResults   scored vector hits (the seeds)
 * @param seedDocIds      doc ids already represented by the vector seeds (dedup guard)
 * @param neighborDocIds  graph-expanded neighbor doc ids, closest-first
 */
export function fuse(
  vectorResults: VectorHit[],
  seedDocIds: string[],
  neighborDocIds: string[],
): FusionResult {
  const seen = new Set<string>();
  const docIds: string[] = [];

  const ranked = [...vectorResults].sort(
    (a, b) => b.score - a.score || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0),
  );
  for (const hit of ranked) {
    if (seen.has(hit.docId)) continue;
    seen.add(hit.docId);
    docIds.push(hit.docId);
  }
  // seedDocIds are already covered by the vector hits; fold them in defensively so a
  // caller-supplied seed never resurfaces as a "graph-only" neighbor below.
  for (const id of seedDocIds) seen.add(id);

  for (const id of neighborDocIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    docIds.push(id);
  }

  return { docIds, context: [...docIds] };
}
