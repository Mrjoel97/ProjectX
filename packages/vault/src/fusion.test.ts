import { describe, expect, it } from "vitest";
import { fuse } from "./fusion";

describe("fuse — vector-seed + graph-expand merge/dedupe/rank (VALT-03)", () => {
  it("orders vector-seed docs before graph-only neighbors, deduped once each", () => {
    const { docIds } = fuse(
      [
        { docId: "d1", score: 0.9 },
        { docId: "d3", score: 0.5 },
      ],
      ["d1", "d3"],
      ["d3", "d5", "d7"], // d3 is also a vector seed → must not repeat
    );
    expect(docIds).toEqual(["d1", "d3", "d5", "d7"]);
  });

  it("ranks vector seeds by score desc (deterministic)", () => {
    const { docIds } = fuse(
      [
        { docId: "d2", score: 0.3 },
        { docId: "d1", score: 0.8 },
      ],
      ["d2", "d1"],
      [],
    );
    expect(docIds).toEqual(["d1", "d2"]);
  });

  it("breaks score ties deterministically by docId", () => {
    const { docIds } = fuse(
      [
        { docId: "b", score: 0.5 },
        { docId: "a", score: 0.5 },
      ],
      ["b", "a"],
      [],
    );
    expect(docIds).toEqual(["a", "b"]);
  });

  it("returns a context list parallel to docIds", () => {
    const res = fuse([{ docId: "d1", score: 0.9 }], ["d1"], ["d2"]);
    expect(res.docIds).toEqual(["d1", "d2"]);
    expect(res.context).toEqual(["d1", "d2"]);
  });

  it("empty inputs → empty result", () => {
    expect(fuse([], [], [])).toEqual({ context: [], docIds: [] });
  });
});
