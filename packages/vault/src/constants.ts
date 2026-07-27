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

/**
 * How long a doc may stay non-terminal (`pending_extraction`/`extracting`) after its attempt was
 * scheduled before a watchdog calls it stalled. 15 min is comfortably above the worst legitimate
 * run — the 480 s per-call ceiling plus Convex's 10-minute node-action limit bound any single
 * honest attempt — so it can never kill live work.
 */
export const EXTRACTION_WATCHDOG_MS = 15 * 60_000;
