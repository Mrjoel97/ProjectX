export type { VaultCategory, VaultSource } from "./categories";
export { categoryFor, isSearchable, VAULT_CATEGORIES } from "./categories";
export { GRAPH_HOP_CAP, VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } from "./constants";
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
// NOTE: ./officeText is deliberately NOT re-exported here (V8-bundle hygiene — import it via
// the subpath `@pikar/vault/officeText` from "use node" modules only).
export { normalizeName } from "./normalize";
// sniff.ts IS re-exported here: unlike officeText.ts it is dep-free (no fflate, no node:*), so a
// V8-runtime module may import it from the barrel safely.
export type { Container, ExtractRail } from "./sniff";
export { ole2Kind, resolveRail, sniffContainer } from "./sniff";
export { bfsNeighbors } from "./traversal";
