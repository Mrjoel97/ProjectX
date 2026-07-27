// The graph-extraction input cap. Pure — no convex-test, no fixtures.
import { describe, expect, test } from "vitest";
import { capGraphText, GRAPH_EXTRACT_CHAR_CAP } from "./constants";
import { VAULT_EXTRACT_CHAR_CAP } from "./extractKind";

describe("GRAPH_EXTRACT_CHAR_CAP", () => {
  test("is 120_000", () => {
    expect(GRAPH_EXTRACT_CHAR_CAP).toBe(120_000);
  });

  // The RELATIONSHIP is the point, not either number. The extraction cap bounds what is STORED;
  // the graph cap bounds what is SENT. If someone lowers the extraction cap below the graph cap,
  // the graph cap becomes dead code — this assertion is what says so.
  test("is strictly below the extraction cap (or the graph cap is dead code)", () => {
    expect(GRAPH_EXTRACT_CHAR_CAP).toBeLessThan(VAULT_EXTRACT_CHAR_CAP);
  });
});

describe("capGraphText", () => {
  test("returns text under the cap unchanged", () => {
    expect(capGraphText("abc")).toBe("abc");
  });

  test("slices text over the cap down to the cap", () => {
    expect(capGraphText("x".repeat(GRAPH_EXTRACT_CHAR_CAP + 1))).toHaveLength(
      GRAPH_EXTRACT_CHAR_CAP,
    );
  });

  test("does not slice text EXACTLY at the cap (boundary)", () => {
    const exact = "x".repeat(GRAPH_EXTRACT_CHAR_CAP);
    expect(capGraphText(exact)).toBe(exact);
    expect(capGraphText(exact)).toHaveLength(GRAPH_EXTRACT_CHAR_CAP);
  });

  test("empty text stays empty", () => {
    expect(capGraphText("")).toBe("");
  });
});
