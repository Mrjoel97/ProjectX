/** Read budgets apply to rows returned, including duplicate edges across adjacency reads. */
export const GRAPH_READ_LIMITS = {
  seeds: 8,
  hops: 2,
  nodes: 128,
  rows: 1024,
  perRead: 64,
  documents: 64,
} as const;

export type TraversalEdge = { from: string; to: string; document: string };
export type GraphReader = {
  source(document: string, limit: number): Promise<TraversalEdge[]>;
  adjacent(node: string, direction: "from" | "to", limit: number): Promise<TraversalEdge[]>;
};

/** Indexed, bounded BFS. As in bfsNeighbors, seed nodes are excluded from neighbor resolution. */
export async function expandBounded(reader: GraphReader, seeds: string[], requestedHops: number) {
  const limits = GRAPH_READ_LIMITS;
  const allSeeds = new Set(seeds);
  const documents = new Set<string>();
  const seedNodes = new Set<string>();
  const visited = new Set<string>();
  let rowsRead = 0;
  let truncated = allSeeds.size > limits.seeds || requestedHops > limits.hops;
  const hops = Number.isFinite(requestedHops)
    ? Math.max(0, Math.min(limits.hops, Math.floor(requestedHops)))
    : 0;
  const read = async (fetch: (limit: number) => Promise<TraversalEdge[]>) => {
    const limit = Math.min(limits.perRead, limits.rows - rowsRead);
    if (limit <= 0) {
      truncated = true;
      return [];
    }
    const edges = await fetch(limit);
    rowsRead += edges.length;
    // Conservative: a full page may have more rows. Never read an unbounded sentinel page.
    if (edges.length === limit) truncated = true;
    return edges;
  };
  const visit = (node: string) => {
    if (visited.has(node)) return false;
    if (visited.size >= limits.nodes) {
      truncated = true;
      return false;
    }
    visited.add(node);
    return true;
  };
  if (hops > 0) {
    for (const document of [...allSeeds].slice(0, limits.seeds)) {
      for (const edge of await read((limit) => reader.source(document, limit))) {
        for (const node of [edge.from, edge.to]) {
          if (visit(node)) seedNodes.add(node);
        }
      }
    }
  }
  let frontier = [...seedNodes];
  // Read the final frontier too: the original algorithm resolves documents touching hop-N nodes.
  for (let hop = 0; hop <= hops && frontier.length; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const direction of ["from", "to"] as const) {
        for (const edge of await read((limit) => reader.adjacent(node, direction, limit))) {
          if (!seedNodes.has(node) && !allSeeds.has(edge.document)) {
            if (documents.size < limits.documents) documents.add(edge.document);
            else if (!documents.has(edge.document)) truncated = true;
          }
          const neighbor = edge.from === node ? edge.to : edge.from;
          if (hop < hops && visit(neighbor)) next.push(neighbor);
        }
      }
      if (rowsRead >= limits.rows) break;
    }
    if (rowsRead >= limits.rows) break;
    frontier = next;
  }
  return { docIds: [...documents], truncated, rowsRead, nodesVisited: visited.size };
}
