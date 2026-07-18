/** The per-file vault upload ceiling for documents/images: 100 MiB. */
export const VAULT_FILE_CAP_BYTES = 100 * 1024 * 1024;

/**
 * The per-file ceiling for VIDEO uploads: 25 MB (decimal, strictly under the transcription
 * API's hard 25 MB limit — see vaultTranscribe.ts). A video is the one kind whose size ceiling
 * is bounded by a downstream service, not our own storage — so it caps lower than documents.
 */
export const VAULT_VIDEO_CAP_BYTES = 25 * 1000 * 1000;

/** Hop cap for GraphRAG neighbor expansion — captures indirect context without exploding. */
export const GRAPH_HOP_CAP = 2;
