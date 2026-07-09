// Framework-agnostic tenant context shape. The Convex tenant wrapper
// (packages/backend/convex/lib/functions.ts) injects a value of this shape
// into every scoped handler's ctx. Kept in pure TS so domain logic in
// packages/* can depend on tenant scoping without importing Convex.

/** The tenant scope injected into every tenant-owned query/mutation. */
export interface TenantCtx {
  /** Stable tenant identifier. For the beta, tenantId === authenticated userId. */
  readonly tenantId: string;
}

/** Thrown-message sentinel used by the wrapper when no identity is present. */
export const UNAUTHENTICATED = "UNAUTHENTICATED" as const;
