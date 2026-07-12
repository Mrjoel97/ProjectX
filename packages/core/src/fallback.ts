/**
 * GRDL-05 — pure AI-SDK error classifier (domain tier, CLAUDE.md §1).
 *
 * Splits provider/transient/model-quality failures (retry on a different model)
 * from our own bugs and config errors (rethrow → dead-letter). Uses the SDK's
 * static `.isInstance` guards, which survive duplicate `ai` package instances —
 * never `instanceof`. NEVER reads or returns error message text (CLAUDE.md §4).
 */
import { APICallError, NoObjectGeneratedError, RetryError } from "ai";

export function isFallbackEligible(e: unknown): boolean {
  // SDK exhausted its internal retries — unwrap and re-classify the real cause.
  if (RetryError.isInstance(e)) return isFallbackEligible(e.lastError);
  // Provider signalled retryable (429/5xx/timeout) vs a 4xx we must fix ourselves.
  if (APICallError.isInstance(e)) return e.isRetryable;
  // Model produced unparsable/schema-invalid output — a different model is the fix.
  if (NoObjectGeneratedError.isInstance(e)) return true;
  // Timeout/abort pass-through (DOMException or fetch AbortError). MEDIUM-confidence
  // shape from research — match on name for both variants.
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  // Everything else (our bugs, LoadAPIKeyError, non-Error values) → rethrow → DLQ.
  return false;
}
