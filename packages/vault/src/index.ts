export { GRAPH_HOP_CAP, VAULT_FILE_CAP_BYTES } from "./constants";
export {
  extractionKindFor,
  MIN_CHARS_PER_PAGE,
  TRANSCRIBABLE_CONTAINER_MIME,
  VAULT_EXTRACT_CHAR_CAP,
  VAULT_EXTRACT_PAGE_CAP,
} from "./extractKind";
export type { ExtractionKind } from "./extractKind";
// NOTE: ./officeText is deliberately NOT re-exported here (V8-bundle hygiene — import it via
// the subpath `@pikar/vault/officeText` from "use node" modules only).
export { normalizeName } from "./normalize";
export { categoryFor, isSearchable, VAULT_CATEGORIES } from "./categories";
export type { VaultCategory, VaultSource } from "./categories";
export { bfsNeighbors } from "./traversal";
export { fuse } from "./fusion";
export type { FusionResult, VectorHit } from "./fusion";
