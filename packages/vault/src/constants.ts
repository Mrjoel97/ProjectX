/** The per-file vault upload ceiling: 8 MiB (mirrors core's PLAN_ATTACHMENT_CAP_BYTES). */
export const VAULT_FILE_CAP_BYTES = 8 * 1024 * 1024;

/** Hop cap for GraphRAG neighbor expansion — captures indirect context without exploding. */
export const GRAPH_HOP_CAP = 2;
