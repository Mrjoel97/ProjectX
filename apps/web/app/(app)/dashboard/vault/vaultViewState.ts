export type VaultListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; visibleCount: number; totalCount: number };

export type VaultSearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "error"; query: string; message: string }
  | { kind: "complete"; query: string; resultCount: number };

export type VaultContentState =
  | { kind: "initial-loading" }
  | { kind: "list-error"; message: string }
  | { kind: "search-loading"; query: string }
  | { kind: "search-error"; query: string; message: string }
  | { kind: "root-empty" }
  | { kind: "category-empty" }
  | { kind: "folder-empty" }
  | { kind: "no-results"; query: string }
  | { kind: "ready"; count: number };

export type VaultIngestState =
  | { kind: "healthy" }
  | { kind: "partial"; processingCount: number; failedCount: number };

export type VaultDigestState = { kind: "current" } | { kind: "stale"; unincorporatedCount: number };

export type VaultViewState = {
  content: VaultContentState;
  ingest: VaultIngestState;
  digest: VaultDigestState;
};

export type VaultViewStateInput = {
  scope: "root" | "folder";
  list: VaultListState;
  search: VaultSearchState;
  processingCount?: number;
  failedCount?: number;
  unincorporatedCount?: number;
};

/**
 * The browse state is deliberately split into three independent axes. A stale digest and failed
 * members can coexist with a populated list; collapsing everything into one priority-ordered enum
 * would hide whichever warning happened to lose that ordering contest.
 */
export function deriveVaultViewState(input: VaultViewStateInput): VaultViewState {
  const processingCount = input.processingCount ?? 0;
  const failedCount = input.failedCount ?? 0;
  const unincorporatedCount = input.unincorporatedCount ?? 0;

  const ingest: VaultIngestState =
    processingCount > 0 || failedCount > 0
      ? { kind: "partial", processingCount, failedCount }
      : { kind: "healthy" };
  const digest: VaultDigestState =
    unincorporatedCount > 0 ? { kind: "stale", unincorporatedCount } : { kind: "current" };

  if (input.list.kind === "loading") {
    return { content: { kind: "initial-loading" }, ingest, digest };
  }
  if (input.list.kind === "error") {
    return { content: { kind: "list-error", message: input.list.message }, ingest, digest };
  }

  if (input.search.kind === "loading") {
    return {
      content: { kind: "search-loading", query: input.search.query },
      ingest,
      digest,
    };
  }
  if (input.search.kind === "error") {
    return {
      content: {
        kind: "search-error",
        query: input.search.query,
        message: input.search.message,
      },
      ingest,
      digest,
    };
  }
  if (input.search.kind === "complete" && input.search.resultCount === 0) {
    return {
      content: { kind: "no-results", query: input.search.query },
      ingest,
      digest,
    };
  }

  if (input.scope === "folder" && input.list.visibleCount === 0) {
    return { content: { kind: "folder-empty" }, ingest, digest };
  }
  if (input.list.visibleCount === 0) {
    return {
      content: { kind: input.list.totalCount === 0 ? "root-empty" : "category-empty" },
      ingest,
      digest,
    };
  }

  return { content: { kind: "ready", count: input.list.visibleCount }, ingest, digest };
}
