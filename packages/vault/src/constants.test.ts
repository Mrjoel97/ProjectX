// The graph-extraction input cap + the vault read bound. Pure — no convex-test, no fixtures.
import { describe, expect, test } from "vitest";
import {
  capClassifyText,
  capGraphText,
  DOC_CLASSIFY_CHAR_CAP,
  GRAPH_EXTRACT_CHAR_CAP,
  VAULT_GRID_PAGE,
  VAULT_GRID_READ_BUDGET_BYTES,
  VAULT_INGEST_PARALLELISM,
} from "./constants";
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

// 15.3-08 (VALT-12). Same reasoning as the graph<extract assertion above, one rung down: the
// classifier only has to answer "what IS this", which lives in the first page, so its slice must
// stay strictly UNDER the extractor's. Invert it and the cheap call has quietly become the
// expensive one — on a call that runs for every document on every ingest path.
describe("DOC_CLASSIFY_CHAR_CAP", () => {
  test("is strictly below the graph cap (or the cheap call is the expensive one)", () => {
    expect(DOC_CLASSIFY_CHAR_CAP).toBeLessThan(GRAPH_EXTRACT_CHAR_CAP);
  });
});

describe("capClassifyText", () => {
  test("returns text under the cap unchanged", () => {
    expect(capClassifyText("abc")).toBe("abc");
  });

  test("slices text over the cap down to the cap", () => {
    expect(capClassifyText("x".repeat(DOC_CLASSIFY_CHAR_CAP + 1))).toHaveLength(
      DOC_CLASSIFY_CHAR_CAP,
    );
  });

  test("does not slice text EXACTLY at the cap (boundary)", () => {
    const exact = "x".repeat(DOC_CLASSIFY_CHAR_CAP);
    expect(capClassifyText(exact)).toBe(exact);
  });

  test("empty text stays empty", () => {
    expect(capClassifyText("")).toBe("");
  });
});

// The 15.3-02 read bound. Again the RELATIONSHIP is the point: a vaultDocuments row carries up to
// VAULT_EXTRACT_CHAR_CAP chars of `text`, Convex has no projection, and the per-transaction read
// cap is 16 MiB. So the byte budget must leave room for at least one max-size row to land on top
// of it, and it must be the bound that bites first on large documents — a row cap alone would let
// VAULT_GRID_PAGE × VAULT_EXTRACT_CHAR_CAP (~80 MB) through, which IS the defect this replaced.
describe("the vault read bound", () => {
  const READ_CAP_BYTES = 16 * 1024 * 1024;

  test("the byte budget plus one max-size row still fits the 16 MiB transaction read cap", () => {
    expect(VAULT_GRID_READ_BUDGET_BYTES + VAULT_EXTRACT_CHAR_CAP).toBeLessThan(READ_CAP_BYTES);
  });

  test("a row cap alone would NOT bound the read — which is why the byte budget exists", () => {
    expect(VAULT_GRID_PAGE * VAULT_EXTRACT_CHAR_CAP).toBeGreaterThan(READ_CAP_BYTES);
  });
});

// 15.3-04 / 15.3-CONTEXT "Scheduled-job concurrency, resolved 2026-08-03". The number itself is a
// tuning choice; the BOUND is not. The smallest deployment scheduled-job concurrency class Convex
// offers is 8, and a pool wider than its deployment's class cannot actually run that wide — it
// just re-queues behind the class, which is the starvation the named pool exists to remove.
describe("VAULT_INGEST_PARALLELISM", () => {
  const SMALLEST_DEPLOYMENT_CONCURRENCY_CLASS = 8;

  test("is strictly below the smallest deployment concurrency class (8 on S16)", () => {
    expect(VAULT_INGEST_PARALLELISM).toBeLessThan(SMALLEST_DEPLOYMENT_CONCURRENCY_CLASS);
  });

  test("is at least 1 — a pool of 0 would never dispatch a folder", () => {
    expect(VAULT_INGEST_PARALLELISM).toBeGreaterThanOrEqual(1);
  });
});
