export type TenantTableCategory =
  | "tenant_owned"
  | "tenant_credential"
  | "global"
  | "audit_immutable";

/** Populated only after the schema-drift test has proved its own RED state. */
export const TENANT_TABLE_CLASSIFICATION = {} as const satisfies Readonly<
  Partial<Record<string, TenantTableCategory>>
>;
