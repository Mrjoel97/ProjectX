import { describe, expect, test } from "vitest";
import { expandBounded, GRAPH_READ_LIMITS, type TraversalEdge } from "./boundedTraversal";

function reader(edges: TraversalEdge[]) {
  return {
    source: async (doc: string, limit: number) =>
      edges.filter((e) => e.document === doc).slice(0, limit),
    adjacent: async (node: string, direction: "from" | "to", limit: number) =>
      edges.filter((e) => e[direction] === node).slice(0, limit),
  };
}

describe("bounded graph expansion", () => {
  test("preserves chain semantics, including documents touching the last frontier", async () => {
    const edges = ["AB", "BC", "CD", "DE", "EF"].map((s, i) => ({
      from: s.charAt(0),
      to: s.charAt(1),
      document: String(i),
    }));
    const result = await expandBounded(reader(edges), ["0"], 2);
    expect(result.docIds.sort()).toEqual(["1", "2", "3"]);
    expect(result.truncated).toBe(false);
    expect((await expandBounded(reader(edges), ["0"], 0)).docIds).toEqual([]);
  });

  test("bounds a high-degree cyclic graph and reports incomplete traversal", async () => {
    const edges = Array.from({ length: 10000 }, (_, i) => ({
      from: "A",
      to: String(i % 200),
      document: String(i),
    }));
    const result = await expandBounded(reader(edges), ["0"], 100);
    expect(result.truncated).toBe(true);
    expect(result.rowsRead).toBeLessThanOrEqual(GRAPH_READ_LIMITS.rows);
    expect(result.nodesVisited).toBeLessThanOrEqual(GRAPH_READ_LIMITS.nodes);
    expect(result.docIds.length).toBeLessThanOrEqual(GRAPH_READ_LIMITS.documents);
    expect(result.docIds).not.toContain("0");
  });

  test("unrelated corpus growth does not increase reads", async () => {
    const seed = { from: "A", to: "B", document: "seed" };
    const near = { from: "B", to: "C", document: "near" };
    const baseline = await expandBounded(reader([seed, near]), ["seed"], 2);
    const unrelated = Array.from({ length: 10000 }, (_, i) => ({
      from: `x${i}`,
      to: `y${i}`,
      document: `d${i}`,
    }));
    expect(await expandBounded(reader([seed, near, ...unrelated]), ["seed"], 2)).toEqual(baseline);
  });
});
