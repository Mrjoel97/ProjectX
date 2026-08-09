export type { VaultCategory, VaultSource } from "./categories";
export { categoryFor, isSearchable, VAULT_CATEGORIES } from "./categories";
export {
  capGraphText,
  capMB,
  EXTRACTION_WATCHDOG_MS,
  GRAPH_EXTRACT_CHAR_CAP,
  GRAPH_HOP_CAP,
  VAULT_FILE_CAP_BYTES,
  VAULT_FOLDER_MEMBER_BATCH,
  VAULT_GRID_PAGE,
  VAULT_GRID_READ_BUDGET_BYTES,
  VAULT_INGEST_PARALLELISM,
  VAULT_VIDEO_CAP_BYTES,
} from "./constants";
export type { ExtractionKind, SchedulingRail } from "./extractKind";
export {
  extractionKindFor,
  MIN_CHARS_PER_PAGE,
  schedulingRailFor,
  TRANSCRIBABLE_CONTAINER_MIME,
  VAULT_EXTRACT_CHAR_CAP,
  VAULT_EXTRACT_PAGE_CAP,
} from "./extractKind";
export type { FusionResult, VectorHit } from "./fusion";
export { fuse } from "./fusion";
// Dep-free at runtime apart from @pikar/cost (itself pure TS), so a V8-runtime Convex module may
// import the estimator from this barrel — which `guardrails.ts` does.
export type { EstimateInput, FileEstimate, FolderEstimate } from "./ingestEstimate";
export { clampRefundCents, EMBED_USD_PER_MTOK, estimateFolderCents } from "./ingestEstimate";
// NOTE: ./officeText is deliberately NOT re-exported here (V8-bundle hygiene — import it via
// the subpath `@pikar/vault/officeText` from "use node" modules only). The SAME RULE, and for a
// much bigger number, applies to ./xlsText: SheetJS is ~1 MB and must enter ONLY the one node
// action that parses legacy workbooks, so import it via `@pikar/vault/xlsText`. Adding either of
// them here drags the dependency into every module that touches this barrel.
export { normalizeName } from "./normalize";
// rawText.ts is dep-free (no fflate, no node:*) and therefore barrel-safe, same rule as sniff.ts.
// `oleText` is what makes SC#3's legacy DOC/PPT half true with ZERO new dependencies — which is
// why the SheetJS spike (plan 15.2-07) can fail without taking the rest of SC#3 with it.
export { markupText, oleText, rtfText } from "./rawText";
// sniff.ts IS re-exported here: unlike officeText.ts it is dep-free (no fflate, no node:*), so a
// V8-runtime module may import it from the barrel safely.
export type { Container, ExtractRail } from "./sniff";
export { ole2Kind, resolveRail, sniffContainer } from "./sniff";
export { bfsNeighbors } from "./traversal";
