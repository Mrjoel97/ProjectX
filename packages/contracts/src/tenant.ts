// Shared tenant contract, consumed via `@pikar/contracts/tenant`.
//
// Every tenant-owned table carries `tenantId: v.string()` and a leading-tenantId
// index. This module is the single source of truth for the field name and the
// branded id type so schema, wrappers, and domain code cannot drift.

import type { Brand } from "./index";

/** Branded tenant identifier. For the beta, this equals the authenticated userId. */
export type TenantId = Brand<string, "TenantId">;

/** The canonical column name for the tenant scope on every owned table. */
export const TENANT_FIELD = "tenantId" as const;

/** Narrow an arbitrary string (e.g. identity.subject) to a TenantId. */
export function asTenantId(subject: string): TenantId {
  return subject as TenantId;
}
