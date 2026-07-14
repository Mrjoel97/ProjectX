/**
 * Hop-capped breadth-first traversal over an in-memory graph adjacency.
 *
 * Given `adjacency` (node id -> outbound neighbor node ids), returns every node id
 * reachable within `hopCap` hops of any seed, EXCLUDING the seeds themselves. Cycles
 * terminate via a visited set. The Convex `vaultGraph.expand` query builds `adjacency`
 * from `graphEdges` and calls this; there are zero Convex imports here (CLAUDE.md §1).
 *
 * @param adjacency  node id -> its outbound neighbor node ids
 * @param seeds      starting node ids (the vector-hit nodes)
 * @param hopCap     max hops from a seed (e.g. GRAPH_HOP_CAP = 2)
 * @returns          unique neighbor node ids within the cap, seeds excluded, BFS order
 */
export function bfsNeighbors(
  adjacency: Map<string, string[]>,
  seeds: string[],
  hopCap: number,
): string[] {
  if (seeds.length === 0 || hopCap < 1) return [];
  const visited = new Set(seeds);
  const result: string[] = [];
  let frontier = [...seeds];

  for (let hop = 0; hop < hopCap && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        result.push(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return result;
}
