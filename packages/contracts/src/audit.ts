// payload MUST be redaction-safe; never raw content — Pitfall 4.
//
// audit.payload carries ONLY refs, hashes, ids, counts, and flags — never raw
// user content or PII. Redaction happens BEFORE the write (redact-then-write is a
// workflow-step ordering contract). The audit log must never become a PII
// honeypot. The type below encodes that: only safe scalar/id-list values are
// permitted, so a raw content string keyed off a random field is the caller's
// mistake, but nested arbitrary objects (a common PII-leak vector) are not
// representable.

/** A stable reference/id (e.g. a document id, correlation id, model name). */
export type AuditRef = string;

/** A content hash (e.g. "sha256:...") — a fingerprint, never the content. */
export type AuditHash = string;

/** Values permitted in a redaction-safe audit payload. */
export type AuditPayloadValue =
  | AuditRef
  | AuditHash
  | number
  | boolean
  | null
  | readonly string[];

/**
 * Redaction-safe audit payload: a flat map of refs / hashes / ids / counts /
 * flags. No nested objects and no free-form content fields — keep it to metadata.
 */
export interface AuditPayload {
  readonly [key: string]: AuditPayloadValue | undefined;
}
