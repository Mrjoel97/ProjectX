import { describe, expect, it } from "vitest";
import { GRAPH_HOP_CAP } from "./constants";
import { bfsNeighbors } from "./traversal";

const adj = (entries: [string, string[]][]): Map<string, string[]> => new Map(entries);

describe("bfsNeighbors — hop-capped BFS over graph edges (VALT-03)", () => {
  it("returns neighbors within hopCap and excludes the seeds themselves", () => {
    // A -> B -> C -> D  (a chain)
    const g = adj([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["D"]],
    ]);
    const out = bfsNeighbors(g, ["A"], 2);
    expect(out.sort()).toEqual(["B", "C"]);
    expect(out).not.toContain("A"); // seed excluded
    expect(out).not.toContain("D"); // 3 hops away, past the cap
  });

  it("never explodes past the cap (a node hopCap+1 away is absent)", () => {
    const g = adj([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["D"]],
      ["D", ["E"]],
    ]);
    expect(bfsNeighbors(g, ["A"], GRAPH_HOP_CAP)).not.toContain("D");
    expect(bfsNeighbors(g, ["A"], GRAPH_HOP_CAP)).toContain("C");
  });

  it("terminates on cycles (visited-set guarded)", () => {
    const g = adj([
      ["A", ["B"]],
      ["B", ["A", "C"]],
      ["C", ["A"]],
    ]);
    const out = bfsNeighbors(g, ["A"], 2);
    expect(out.sort()).toEqual(["B", "C"]);
  });

  it("returns [] for empty seeds", () => {
    expect(bfsNeighbors(adj([["A", ["B"]]]), [], 2)).toEqual([]);
  });

  it("handles seeds with no adjacency entry", () => {
    expect(bfsNeighbors(adj([]), ["X"], 2)).toEqual([]);
  });
});
