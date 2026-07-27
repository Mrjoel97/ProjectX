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

/**
 * Chars of document text sent to the graph extractor. ~120k chars ≈ 30k tokens, well inside the
 * 128k window even for token-dense content (tab-joined spreadsheet rows tokenize far worse than
 * prose) and leaving room for the schema + system prompt. Before this cap, extractGraph was the
 * ONE uncapped model call in the repo: VAULT_EXTRACT_CHAR_CAP lets 400k chars be STORED, and all
 * of it was SENT. That relationship (graph cap strictly below extraction cap) is asserted in
 * constants.test.ts — invert it and this constant is dead code.
 *
 * ponytail: a HEAD SLICE, not chunk-wise fan-out — entities that appear only in the tail of a very
 * long document are missed, and nothing persists a "graph truncated" flag (no schema change this
 * phase). Deliberate: a 254k-char row is observed working today, so this is a guard against the
 * cliff, not a recall improvement. Upgrade path: chunk-wise extraction with node/edge union across
 * chunks, deferred until entity recall is observed to suffer.
 */
export const GRAPH_EXTRACT_CHAR_CAP = 120_000;

/** Head-slice a graph-extraction prompt to GRAPH_EXTRACT_CHAR_CAP. */
export function capGraphText(text: string): string {
  return text.length > GRAPH_EXTRACT_CHAR_CAP ? text.slice(0, GRAPH_EXTRACT_CHAR_CAP) : text;
}
