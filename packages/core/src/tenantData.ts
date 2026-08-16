export type TenantTableCategory =
  | "tenant_owned"
  | "tenant_credential"
  | "global"
  | "audit_immutable"
  /**
   * BETA-01 admission rows: personal data that is NOT tenant data.
   *
   * A fifth category rather than reusing `global`, because `global` asserts "contains no tenant
   * data" and every consumer reports it with that meaning — `betaWaitlist` holds the requester's
   * own email address, so filing it under `global` would make the export manifest's omission
   * reason false. These rows are keyed by EMAIL and deliberately precede any tenant, so neither
   * deletion scope (`identity` by users._id, `tenant_index` by tenantId) can address them; they
   * are excluded from `deletableTables()` by construction, like `audit_immutable`.
   *
   * OPEN, AND DELIBERATELY NOT DECIDED HERE — see docs/playbooks/beta-admission.md: whether tenant
   * erasure should also remove the erased person's admission rows. It is a real Art. 17 question
   * (the email survives erasure today), but tenant deletion is Phase 22.1's owned, irreversible
   * surface and widening it from an admission plan would be an out-of-scope edit to a destructive
   * path. Recorded for the owner, not resolved.
   */
  | "admission_plane";

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
  betaWaitlist: "admission_plane",
  betaInvites: "admission_plane",
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
  const tables = Object.entries(TENANT_TABLE_CLASSIFICATION)
    .filter(([, category]) => category === "tenant_owned" || category === "tenant_credential")
    .map(([table]) => table as DeletableTenantTable);
  // The authenticated users row is the resumability boundary: deleting it last keeps every prior
  // bounded continuation authorizable without introducing a deletion-job table.
  return [...tables.filter((table) => table !== "users"), "users"];
}

export const exportableTables = deletableTables;

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

/** Scope values are capability inventories; expose only token lengths, never the capability text. */
export function summarizeTenantCredential(row: {
  updatedAt?: unknown;
  scope?: unknown;
}): TenantCredentialSummary {
  return {
    connected: true,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
    scopeHalves:
      typeof row.scope === "string"
        ? row.scope
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((scopeHalf) => scopeHalf.length)
        : [],
  };
}

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

export type TenantExportCursor = {
  tableIndex: number;
  cursor: string | null;
  rowsExported: number;
  /** Rows taken from the CURRENT table; resets to 0 whenever `tableIndex` advances. */
  tableRows: number;
  /**
   * Sticky. The client overwrites `limits` with every page it receives, so a table truncated
   * early in the walk has to carry that fact forward or it is absent from the final envelope.
   */
  truncated: boolean;
  generatedAt: string;
};

export type TenantDataExportPage = {
  header: TenantExportHeader;
  table: { name: DeletableTenantTable; rows: readonly unknown[] };
  omitted: Readonly<Record<string, string>>;
  nextCursor: TenantExportCursor | null;
  limits: TenantDataExport["limits"];
};

export type TenantDeletionCursor = {
  tableIndex: number;
};
