import { describe, expect, test } from "vitest";
import { deriveVaultViewState, type VaultViewStateInput } from "./vaultViewState";

const ready = (overrides: Partial<VaultViewStateInput> = {}): VaultViewStateInput => ({
  scope: "root",
  list: { kind: "ready", visibleCount: 3, totalCount: 3 },
  search: { kind: "idle" },
  ...overrides,
});

describe("deriveVaultViewState", () => {
  test.each([
    ["initial loading", ready({ list: { kind: "loading" } }), "initial-loading"],
    [
      "list error",
      ready({ list: { kind: "error", message: "The vault could not be read." } }),
      "list-error",
    ],
    [
      "search loading",
      ready({ search: { kind: "loading", query: "invoice" } }),
      "search-loading",
    ],
    [
      "search error",
      ready({ search: { kind: "error", query: "invoice", message: "Search failed." } }),
      "search-error",
    ],
    [
      "root empty",
      ready({ list: { kind: "ready", visibleCount: 0, totalCount: 0 } }),
      "root-empty",
    ],
    [
      "category empty",
      ready({ list: { kind: "ready", visibleCount: 0, totalCount: 4 } }),
      "category-empty",
    ],
    [
      "folder empty",
      ready({ scope: "folder", list: { kind: "ready", visibleCount: 0, totalCount: 0 } }),
      "folder-empty",
    ],
    [
      "no results",
      ready({ search: { kind: "complete", query: "invoice", resultCount: 0 } }),
      "no-results",
    ],
    ["content", ready(), "ready"],
  ] as const)("classifies %s", (_label, input, kind) => {
    expect(deriveVaultViewState(input).content.kind).toBe(kind);
  });

  test("keeps partial ingest structurally separate from content", () => {
    expect(deriveVaultViewState(ready({ processingCount: 2, failedCount: 1 })).ingest).toEqual({
      kind: "partial",
      processingCount: 2,
      failedCount: 1,
    });
  });

  test("keeps stale digest structurally separate from content and partial ingest", () => {
    expect(
      deriveVaultViewState(
        ready({ scope: "folder", processingCount: 1, unincorporatedCount: 3 }),
      ),
    ).toMatchObject({
      content: { kind: "ready" },
      ingest: { kind: "partial" },
      digest: { kind: "stale", unincorporatedCount: 3 },
    });
  });

  test("an error cannot mutate into the empty-result shape", () => {
    const error = deriveVaultViewState(
      ready({ list: { kind: "error", message: "The vault could not be read." } }),
    );
    const empty = deriveVaultViewState(
      ready({ list: { kind: "ready", visibleCount: 0, totalCount: 0 } }),
    );

    expect(error.content).toEqual({
      kind: "list-error",
      message: "The vault could not be read.",
    });
    expect(error.content).not.toEqual(empty.content);
  });
});
