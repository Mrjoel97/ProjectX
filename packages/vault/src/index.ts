export { GRAPH_HOP_CAP, VAULT_FILE_CAP_BYTES } from "./constants";
export { normalizeName } from "./normalize";
export { categoryFor, isSearchable, VAULT_CATEGORIES } from "./categories";
export type { VaultCategory, VaultSource } from "./categories";
export { bfsNeighbors } from "./traversal";
export { fuse } from "./fusion";
export type { FusionResult, VectorHit } from "./fusion";
