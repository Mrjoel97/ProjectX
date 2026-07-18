export type { VaultCategory, VaultSource } from "./categories";
export { categoryFor, isSearchable, VAULT_CATEGORIES } from "./categories";
export { GRAPH_HOP_CAP, VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } from "./constants";
export type { ExtractionKind } from "./extractKind";
export {
  extractionKindFor,
  MIN_CHARS_PER_PAGE,
  TRANSCRIBABLE_CONTAINER_MIME,
  VAULT_EXTRACT_CHAR_CAP,
  VAULT_EXTRACT_PAGE_CAP,
} from "./extractKind";
export type { FusionResult, VectorHit } from "./fusion";
export { fuse } from "./fusion";
// NOTE: ./officeText is deliberately NOT re-exported here (V8-bundle hygiene — import it via
// the subpath `@pikar/vault/officeText` from "use node" modules only).
export { normalizeName } from "./normalize";
export { bfsNeighbors } from "./traversal";
