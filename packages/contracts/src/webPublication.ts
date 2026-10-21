import type { AuditHash, AuditPayload, AuditRef } from "./audit";

/** Closed refs-only receipt shape for Phase 48 publication attempts. */
export type PublicationAuditPayload = AuditPayload & {
  readonly action: "publish" | "update" | "unpublish" | "rollback";
  readonly status: "pending" | "published" | "failed" | "rolled_back" | "unpublished";
  readonly projectId: AuditRef;
  readonly version?: number;
  readonly contentHash?: AuditHash;
  readonly previousVersion?: number;
  readonly resultingVersion?: number;
  readonly failure?: "not_approved" | "stale_revision" | "render_failed" | "unavailable";
  readonly actor: AuditRef;
  readonly revision: number;
};
