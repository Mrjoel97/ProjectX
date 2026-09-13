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
  auditExportQueue: "global", // Export delivery state: audit refs only, no content.
  requests: "tenant_owned",
  plans: "tenant_owned",
  researchControls: "tenant_owned", // Mutable request allowance; native export/erasure and eval cleanup use by_tenant.
  briefings: "tenant_owned",
  calendarViews: "tenant_owned",
  vaultSources: "tenant_owned",
  evaluations: "tenant_owned",
  agenda: "tenant_owned", // 34-01 (ADR-033): the weekly review's gap lifecycle
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
  // Phase 40 (DOC-01): a workbook's capped grid, one row per spreadsheet document. Cell text, so
  // it is tenant data in the fullest sense — it exports and deletes with its document.
  vaultSheets: "tenant_owned",
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
  funnels: "tenant_owned", // Link/source/counters belong in export and erasure, never immutable audit.
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
  /**
   * Phase 28.1 — Pikar's OWN Stripe delivery log. `global`, and the reason is not "it has no
   * tenantId" but something sharper: erasing it on a tenant deletion would let a REDELIVERED
   * event for that tenant re-apply, because the row is the only record that the event was
   * already seen. It holds ids, types and counts only (CLAUDE.md §4) — no tenant content and
   * no personal data — so `global`'s "contains no tenant data" claim stays literally true.
   */
  billingStripeEvents: "global",
  /**
   * Phase 28.1 (28.1-05) — the tenant ↔ Stripe-customer mapping. `tenant_owned`, and the two
   * categories it is NOT are the interesting part.
   *
   * NOT `tenant_credential`, unlike `connectorConnections` next door. That category is for the
   * tenant's GRANT: `gmailTokens` holds a refresh token, `connectorConnections` holds AES-256-GCM
   * ciphertext. `stripeCustomerId` is a `cus_…` — an identifier that grants nothing without the
   * merchant's own API key, which lives in the deployment env and not in any row. Filing it as a
   * credential would also SUMMARISE it out of the export (`summarizeTenantCredential` replaces the
   * row with `{connected, updatedAt, scopeHalves}`), deleting from the tenant's own data export
   * the single fact they would actually want from it.
   *
   * NOT `audit_immutable`, unlike `deadLetters` and `billingStripeEvents`. This is MUTABLE mapping
   * state — a subscription status moves — not an append-only log, and the erasure obligation runs
   * the other way: it is the ONLY row joining a person to a live merchant record, so an erasure
   * that left it behind would leave that link standing forever.
   *
   * Being deletable is load-bearing for a later billing arm of the deletion walk: it must cancel
   * the subscription BEFORE the page loop reaches this table, because the loop deletes the row
   * holding the id it needs.
   */
  billingCustomers: "tenant_owned",
  /**
   * Phase 28.1 (28.1-06) — the BOOK OF RECORD for Pikar's own merchant revenue, and its coverage
   * companion. `audit_immutable`, and the neighbour that is NOT is the argument.
   *
   * `spendEvents` next door is `tenant_owned` because it records what PIKAR SPENT ON that tenant —
   * usage facts about them, which they may export and whose deletion costs Pikar only a number it
   * chose to keep. `billingEvents` records the opposite direction: what the tenant PAID PIKAR. That
   * is Pikar's own accounting record of its own revenue, and a tenant erasure that rewrote it would
   * let a customer delete Pikar's books. Financial records are also exactly the case the erasure
   * right carves out for a retention obligation, so the honest posture is that this table is
   * outside the erasure walk BY CONSTRUCTION rather than by an `if` somebody can move.
   *
   * The tenant is not deprived by the export omission: their own invoices, receipts and payment
   * history are served by Stripe's hosted Customer Portal, which 28.1-04 already opens for them.
   * This table is the merchant side of the same transaction, not a second copy of theirs.
   *
   * `billingCoverage` takes the same category because it is only meaningful WITH the events. If
   * erasure removed the coverage row and could not remove the events, the ledger would report
   * "unknown coverage" over rows that are sitting right there; if a later movement then re-opened
   * coverage, every window before the new start would silently become unknown. Deleting together
   * or never is the only coherent pair, and `billingEvents` cannot be deleted.
   *
   * THE TWO OBLIGATIONS THIS CATEGORY CARRIES (identical to `workflowPackEvents` above, and not
   * optional):
   *   1. The writer must be INSERT-ONLY (CLAUDE.md §3). `convex/billingLedger.ts` is the only one,
   *      and `billingLedger.test.ts` scans its source for `patch`/`replace`/`delete`.
   *   2. Nothing here may ever become personal data. It holds ids, code-owned tokens, an ISO 4217
   *      code and integer minor units — a description or line-item text added later would put
   *      customer content beyond the reach of every erasure request this deployment can honour.
   */
  billingEvents: "audit_immutable",
  billingCoverage: "audit_immutable",
  /**
   * Phase 28.1 (28.1-06) — bank-transfer money we HOLD that is attached to nothing yet.
   *
   * `tenant_owned`, deliberately NOT joining the two above, and there are two independent reasons.
   * It is MUTABLE observational state (a re-observed cash balance updates the amount), so it fails
   * `audit_immutable`'s insert-only obligation on its face. And the money it describes is still the
   * CUSTOMER'S — Stripe may return it to their bank at 75 days — so it is a fact about their money
   * that belongs in their export, and an erasure that left it behind would strand a row pointing at
   * a live Stripe customer for a person who no longer exists here, which is the same orphaned-link
   * problem `billingCustomers` is deletable to avoid.
   */
  billingUnapplied: "tenant_owned",
  /**
   * Phase 28.1 (28.1-07) — the invoice CLAIM row: the guard that makes one billing period produce
   * exactly one invoice. `tenant_owned`, and the neighbour it does NOT join is `billingEvents`.
   *
   * NOT `audit_immutable`, and the reason is the first of that category's two obligations rather
   * than a judgement call: the writer must be INSERT-ONLY (CLAUDE.md §3), and this row EXISTS to
   * be patched — `pending → claimed → posted|failed` is the whole mechanism. A table whose status
   * machine is three `ctx.db.patch` calls cannot honestly claim an append-only category, exactly
   * the argument that put `billingUnapplied` here rather than beside the ledger.
   *
   * The "a customer must not be able to erase Pikar's own books" argument that made `billingEvents`
   * immutable does not reach this table, and the difference is where the MONEY is recorded. What
   * was actually collected is a `billingEvents` row, written from the webhook, append-only and
   * outside the erasure walk. This row is the SCHEDULING artifact that produced the document; its
   * financial outcome survives its deletion. Pikar's books are not made erasable by making the
   * claim erasable.
   *
   * Being deletable is also coherent with what the claim protects. It guards against a SECOND
   * invoice for the same period, and `postInvoice` cannot post at all without a `billingCustomers`
   * row — which is `tenant_owned` and is deleted by the same walk. A tenant whose periods are gone
   * is a tenant that can no longer be invoiced, so there is nothing left for the guard to guard.
   *
   * And the export half is the tenant's own bill: `hostedInvoiceUrl`, the line items they were
   * charged for, the amount and the currency. Omitting that from a data export while including
   * `billingUnapplied` would be an incoherent pair.
   */
  billingPeriods: "tenant_owned",
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

/**
 * WHERE THE BYTES ARE — every field in `schema.ts` that holds an `_id("_storage")`, by table.
 *
 * THE DEFECT THIS EXISTS TO CLOSE (found 2026-09-08). `deleteTenantDataPage`'s walk was
 * `.take()` + `ctx.db.delete(row._id)` and nothing else: a case-insensitive grep of
 * `tenantDelete.ts` for "storage" returned ZERO. So erasure deleted the ROWS that point at a
 * user's files and left the FILES — and because the pointers went first, those bytes became
 * unreachable AND unremovable by any product path. Worse than a leak. Meanwhile
 * `DataControls.tsx` promised erasure removes "vault documents … generated media", and
 * `tenantExport.ts` (also zero) could not hand them over either: the export promised a copy and
 * omitted the files while the delete promised removal and kept them, failing in OPPOSITE
 * directions.
 *
 * A DECLARATIVE MAP, not seven branches at the delete site, for the reason the classification
 * registry above exists: the dangerous edit is an OMITTED table, which no compiler, linter or
 * behaviour test can see. `storageFieldDrift` (isolation.test.ts) parses `schema.ts` and asserts
 * every `v.id("_storage")` occurrence is covered here, so a new table carrying bytes cannot land
 * without either an entry or a deliberate exemption.
 *
 * `attachments[].storageId` is a PATH, not a field: plan attachments are an inline array of
 * objects (`schema.ts` `plans.attachments`), and the bytes hide one level down. A map that only
 * understood top-level fields would silently miss them — which is the single largest class of
 * generated file in the product.
 */
export const STORAGE_ID_FIELDS = {
  plans: ["renderStorageId", "sidecarStorageId", "attachments[].storageId"],
  attachments: ["storageId"],
  intakeArtifacts: ["storageId"],
  vaultDocuments: ["storageId"],
  funnels: ["storageId"], // Fixed artifact bytes can outlive a changed/deleted Vault reference.
  mediaJobs: ["assetStorageId"],
} as const satisfies Record<string, readonly string[]>;

export type StorageBearingTable = keyof typeof STORAGE_ID_FIELDS;

/**
 * Every storage id reachable from ONE row, as plain strings. Pure and Convex-free (§1), so the
 * path walk is unit-testable without a database.
 *
 * Absent, null and non-string values are DROPPED rather than returned: every field but two is
 * `v.optional`, a half-written row is reachable in practice, and handing `undefined` to
 * `ctx.storage.delete` would throw inside the erasure walk — turning a missing attachment into a
 * user who cannot delete their account.
 */
export function storageIdsIn(table: string, row: Record<string, unknown>): string[] {
  const paths = (STORAGE_ID_FIELDS as Record<string, readonly string[] | undefined>)[table];
  if (paths === undefined) return [];
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "string" && v.length > 0) out.push(v);
  };
  for (const path of paths) {
    const split = path.indexOf("[].");
    if (split === -1) {
      push(row[path]);
      continue;
    }
    // `indexOf`/`slice` rather than destructuring `split("[].")`: under
    // `noUncheckedIndexedAccess` both halves type as `string | undefined`, and the cast that
    // silences that is exactly the lie this function exists to avoid.
    const head = path.slice(0, split);
    const tail = path.slice(split + 3);
    const arr = row[head];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item !== null && typeof item === "object") push((item as Record<string, unknown>)[tail]);
    }
  }
  return out;
}

export const exportableTables = deletableTables;

export const TENANT_EXPORT_SCHEMA_VERSION = 1;
export const AUDIT_ARCHIVE_STATEMENT =
  "references, identifiers, hashes, and counts only — never the content of your messages, and no directly identifying data.";

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

/**
 * A FILE THE TENANT OWNS, handed over as a time-limited download link.
 *
 * THE GAP THIS CLOSES: until 2026-09-08 the export was rows-only — a grep of `tenantExport.ts` for
 * "storage" returned ZERO — while the erasure surface said “Download your data first if you want a
 * copy.” It was false for the two things a user would most want back: their documents and their
 * generated media. The delete had the mirror-image defect and was fixed in 44-01; this is the other
 * half, and the two are one promise.
 *
 * `url` is NULLABLE and that is a real state, not a placeholder: a row can carry a `storageId`
 * whose blob is already gone (a failed render, a half-written intake). A null says so instead of
 * pretending, and the export stays well-formed.
 *
 * THE LINK EXPIRES. `ctx.storage.getUrl` mints a time-limited signed URL, so an export JSON kept
 * for a week hands over links that no longer resolve. That is disclosed on the surface rather than
 * hidden — fetch the files when you take the export.
 */
export type TenantExportFile = {
  table: string;
  rowId: string;
  storageId: string;
  url: string | null;
};

export type TenantDataExportPage = {
  header: TenantExportHeader;
  table: { name: DeletableTenantTable; rows: readonly unknown[] };
  /** The stored files reachable from THIS page's rows, via `STORAGE_ID_FIELDS`. One list per page,
   *  not one per row, so the shape of the rows themselves is unchanged. */
  files: readonly TenantExportFile[];
  omitted: Readonly<Record<string, string>>;
  nextCursor: TenantExportCursor | null;
  limits: TenantDataExport["limits"];
};

export type TenantDeletionCursor = {
  tableIndex: number;
};
