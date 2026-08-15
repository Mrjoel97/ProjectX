export type TenantTableCategory =
  | "tenant_owned"
  | "tenant_credential"
  | "global"
  | "audit_immutable";

/**
 * The schema's export/deletion policy in one reviewable place. Keep this as data: adapters iterate
 * it and the source-level drift test makes an unclassified schema addition fail closed.
 */
export const TENANT_TABLE_CLASSIFICATION = {
  users: "tenant_owned",
  audit: "audit_immutable",
  // The DLQ shares the refs-only compliance plane and is never user-content export/deletion data.
  deadLetters: "audit_immutable",
  // Deployment-wide versioned prompt registry; tenants own only tenantSkills overlays.
  skills: "global",
  tenantSkills: "tenant_owned",
  savedPrompts: "tenant_owned",
  // Workflow-engine correlation bookkeeping has no tenant key and is not tenant content.
  pendingTimeouts: "global",
  // Singleton WORM cursor bookkeeping belongs to the deployment, not a tenant.
  exportCursors: "global",
  requests: "tenant_owned",
  plans: "tenant_owned",
  briefings: "tenant_owned",
  calendarViews: "tenant_owned",
  vaultSources: "tenant_owned",
  evaluations: "tenant_owned",
  agentSteps: "tenant_owned",
  calendarFixtures: "tenant_owned",
  calendarEvents: "tenant_owned",
  inboxFixtures: "tenant_owned",
  attachments: "tenant_owned",
  telemetry: "tenant_owned",
  notifications: "tenant_owned",
  gmailTokens: "tenant_credential",
  microsoftCalendarTokens: "tenant_credential",
  // One deployment-wide guardrail row; tenant spend remains in spendEvents/spendCoverage.
  guardrailConfig: "global",
  demoItems: "tenant_owned",
  intakeArtifacts: "tenant_owned",
  vaultDocuments: "tenant_owned",
  vaultFolders: "tenant_owned",
  graphNodes: "tenant_owned",
  graphEdges: "tenant_owned",
  voiceSessions: "tenant_owned",
  feedback: "tenant_owned",
  // One deployment-wide optimizer switch/threshold row; it contains no tenant data.
  optimizerConfig: "global",
  tenantProfiles: "tenant_owned",
  goals: "tenant_owned",
  spendEvents: "tenant_owned",
  spendCoverage: "tenant_owned",
  mediaJobs: "tenant_owned",
  contacts: "tenant_owned",
  followUps: "tenant_owned",
  suppressions: "tenant_owned",
  financeInputs: "tenant_owned",
  proposals: "tenant_owned",
} as const satisfies Readonly<Record<string, TenantTableCategory>>;

export type ClassifiedTenantTable = keyof typeof TENANT_TABLE_CLASSIFICATION;
export type DeletableTenantTable = {
  [Table in ClassifiedTenantTable]: (typeof TENANT_TABLE_CLASSIFICATION)[Table] extends
    | "tenant_owned"
    | "tenant_credential"
    ? Table
    : never;
}[ClassifiedTenantTable];

/** The auth `users` row is owned by exact id; every other tenant/deletable table uses tenantId. */
export function tenantTableScope(table: DeletableTenantTable): "identity" | "tenant_index" {
  return table === "users" ? "identity" : "tenant_index";
}

/** The only table source future deletion code is allowed to consume. */
export function deletableTables(): readonly DeletableTenantTable[] {
  return Object.entries(TENANT_TABLE_CLASSIFICATION)
    .filter(([, category]) => category === "tenant_owned" || category === "tenant_credential")
    .map(([table]) => table as DeletableTenantTable);
}

export const TENANT_EXPORT_SCHEMA_VERSION = 1;
export const AUDIT_ARCHIVE_STATEMENT =
  "references, identifiers, hashes, and counts only — never the content of your messages, and no personal data.";

export type TenantExportHeader = {
  schemaVersion: typeof TENANT_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  tenantId: string;
  auditArchive: typeof AUDIT_ARCHIVE_STATEMENT;
};

export type TenantCredentialSummary = {
  connected: boolean;
  updatedAt: number | null;
  scopeHalves: readonly number[];
};

export type TenantDataExport = {
  header: TenantExportHeader;
  tables: Readonly<Record<string, readonly unknown[]>>;
  omitted: Readonly<Record<string, string>>;
  limits: {
    pageSize: number;
    totalRows: number;
    truncated: boolean;
  };
};
