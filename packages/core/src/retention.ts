/**
 * OPSG-03 WORM export — the PURE serialization + key/retention math.
 *
 * The Convex adapter (convex/worm.ts, "use node") reads audit rows past the export
 * cursor and PutObjects them to S3 with COMPLIANCE-mode Object Lock. Everything that
 * can be decided without Convex or the AWS SDK lives here (CLAUDE.md §1) so it is
 * unit-testable — workflows/actions do NOT run under convex-test.
 *
 * The one non-obvious contract: serialization is DETERMINISTIC (keys sorted, recursively)
 * so re-exporting a frozen batch produces a byte-identical body and content-addressed key.
 * S3 Object Lock preserves versions: retries can add identical versions, never overwrite
 * a retained version. Readers can deduplicate by audit row id.
 */

/** Recursively key-sort so a value's JSON is stable regardless of source key order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * One JSON object per line, newline-terminated (NDJSON), with stable (sorted) key order.
 * Empty input → "" (nothing to PutObject; legacy scan metadata may still advance).
 */
export function serializeAuditNdjson(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  return rows.map((row) => `${JSON.stringify(sortKeys(row))}\n`).join("");
}

/**
 * The S3 object key for one export window: `audit/YYYY-MM-DD/{sinceTs}-{maxTs}.ndjson`.
 * The date prefix is the UTC calendar day of `maxTs` (the window's newest row) so a window
 * that crosses midnight files under the day it ends — one deterministic key per window.
 */
export function wormObjectKey(sinceTs: number, maxTs: number): string {
  const day = new Date(maxTs).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `audit/${day}/${sinceTs}-${maxTs}.ndjson`;
}

/**
 * Default Object Lock retention period. 7 years is the common financial/audit-compliance
 * floor; the actual period is set at PutObject time from this.
 * ponytail: fixed 7y default — lift to a per-tenant/regulatory policy if retention rules diverge.
 */
export const RETENTION_MS = 7 * 365 * 24 * 60 * 60 * 1000;

/** The retain-until instant for an object written at `nowMs` (now + RETENTION_MS). Pure. */
export function retainUntilDate(nowMs: number): Date {
  return new Date(nowMs + RETENTION_MS);
}
