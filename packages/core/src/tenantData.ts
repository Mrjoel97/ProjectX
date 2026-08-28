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
  /**
   * Phase-27 workflow-pack outcome events (PACK-02). Refs, enums and counts only — no prompt, no
   * generated prose, no customer name, no financial value (CLAUDE.md §4, enforced by the table
   * having nowhere to put any of them).
   *
   * OWNER DECISION 2026-08-23: `audit_immutable`, NOT `tenant_owned`. These rows are the pilot's
   * only record of whether the pack model worked, and under `tenant_owned` one tenant's erasure
   * silently rewrote the denominator of every measure computed from them. They now sit on the same
   * plane as `audit` and `deadLetters`: same refs-only shape, same immutability, same exclusion
   * from both the deletion walk and the export walk BY CONSTRUCTION rather than by an `if`.
   *
   * TWO OBLIGATIONS TRAVEL WITH THAT CATEGORY, and they are not optional:
   *   1. The writer must be INSERT-ONLY (CLAUDE.md §3). A `patch`/`replace`/`delete` on this table
   *      would make the category a lie. 27-03 owns the module; `docs/playbooks/workflow-packs.md`
   *      carries the invariant.
   *   2. Nothing here may ever become personal data. `audit_immutable` is what the privacy policy
   *      describes as holding "references, identifiers, hashes, and counts only" — a text field
   *      added to this table later would put user content beyond the reach of an erasure request.
   *
   * The export omission reason is the generic `audit_immutable` one ("refs-only audit/compliance
   * operational records are not tenant content"), which is accurate for this shape.
   */
  workflowPackEvents: "audit_immutable",
  /**
   * Phase-29 unified-search results (KNOW-01). `tenant_owned`, NOT `audit_immutable`.
   *
   * The distinction from `workflowPackEvents` directly above is content, not convention: a pack
   * event is refs/enums/counts with nowhere to put prose, while a `knowledgeSearches` row holds the
   * user's own QUESTION, the ANSWER they were shown, and the TITLES of their own documents. That is
   * tenant content by every definition this file uses, so it exports in full and it deletes.
   *
   * Nothing here is the measurement plane. The refs-only search telemetry a reviewer needs is
   * `redactedSearchEvent` in `@pikar/core/knowledgeSearch` — counts and closed enums, landed
   * separately — precisely so erasing a tenant cannot rewrite the denominator of a measure while
   * their prose still goes away. `by_tenant` is the deletion index.
   */
  knowledgeSearches: "tenant_owned",
  /**
   * Phase-28 connector rails (28-03).
   *
   * `connectorConnections` is `tenant_credential` for the same reason `gmailTokens` is: it holds
   * the tenant's grant. The material at rest is AES-256-GCM ciphertext, which changes the blast
   * radius of a leaked backup but changes NOTHING about erasure — the row still rides the normal
   * deletion walk, and the category is what puts it there.
   *
   * A DISCONNECT is not an erasure and does not delete the row. It clears the two ciphertext
   * fields and keeps the metadata, because for three of the four providers Pikar cannot revoke
   * upstream (Stripe Apps has no documented platform revoke, PayPal documents none at all,
   * HubSpot's cascade to access tokens is unproven) and the surviving `revocation` record is the
   * only place the honest answer lives. Erasure, unlike disconnect, removes the row entirely.
   *
   * `connectorOAuthStates` is `tenant_credential` rather than `tenant_owned`: it is auth-flow
   * material, not tenant content, and an export that dumped in-flight OAuth state hashes to a
   * user would be handing out the wrong thing.
   *
   * `contactProviderRefs` is ordinary tenant content — provider ids joined to Phase 19 contacts —
   * so it exports and deletes with the rest of the CRM.
   *
   * `providerGates` is `global` and has NO `tenantId` column: it is the deployment's per-provider
   * lane status. A tenant cannot own it, and a tenant erasure must not remove it.
   */
  connectorConnections: "tenant_credential",
  connectorOAuthStates: "tenant_credential",
  contactProviderRefs: "tenant_owned",
  providerGates: "global",
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
