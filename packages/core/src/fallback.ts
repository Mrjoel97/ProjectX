/**
 * GRDL-05 — pure AI-SDK error classifier (domain tier, CLAUDE.md §1).
 *
 * Splits provider/transient/model-quality failures (retry on a different model)
 * from our own bugs and config errors (rethrow → dead-letter). Uses the SDK's
 * static `.isInstance` guards, which survive duplicate `ai` package instances —
 * never `instanceof`. NEVER reads or returns error message text (CLAUDE.md §4).
 */
import { APICallError, NoObjectGeneratedError, RetryError } from "ai";

/**
 * A TRANSPORT-200 THAT IS REALLY A 5xx — the gateway shape, and why `isRetryable` alone is not enough.
 *
 * **MEASURED 2026-08-25.** OpenRouter reports UPSTREAM provider failures inside an HTTP **200** body
 * (`{"error": {"code": 503, "message": "The service is currently unavailable"}}`) rather than as a 5xx
 * status. `@openrouter/ai-sdk-provider` faithfully throws `APICallError` with `statusCode: 200`, and
 * the SDK's default rule — retryable iff 408/409/429/>=500 — then computes `isRetryable: false`. So a
 * plainly transient outage was classified as "our bug, do not retry", the cross-vendor fallback never
 * fired, and a workflow pack died instead of rolling over to Gemini. **Verified by absence: not one
 * `llm.fallback` audit row exists for any of those failures.**
 *
 * The real status is carried STRUCTURALLY in the body, so this reads a NUMBER and never message text
 * (CLAUDE.md §4, and the promise at the top of this file). Two shapes are accepted because providers
 * differ on whether `data` is the error object or the envelope containing it.
 *
 * CONSERVATIVE ON PURPOSE, in both directions:
 *  • It only ever WIDENS — it is consulted after `isRetryable` is already false, so it cannot make a
 *    genuinely retryable error non-retryable.
 *  • It applies the SAME 408/409/429/>=500 rule rather than "any error in a body", so a body-delivered
 *    400 (`reasoning: {enabled:false}` returns exactly that) still fails closed to the dead-letter
 *    queue. Rolling a config error over to a second vendor would burn a second call and hide the fix.
 *  • A NON-NUMERIC code (`"insufficient_quota"`) is NOT retryable. Guessing from an unknown string is
 *    how a billing failure becomes an infinite cross-vendor retry.
 */
const bodyDeliveredRetryable = (e: APICallError): boolean => {
  // Only for transport-level success. A real 4xx/5xx status is already classified correctly above,
  // and second-guessing it here would let a body code override the transport.
  if (e.statusCode !== 200) return false;
  const data = e.data as { code?: unknown; error?: { code?: unknown } } | null | undefined;
  const raw = data?.error?.code ?? data?.code;
  // `Number("")` is 0 and `Number(null)` is 0, so both are screened out before the numeric test.
  if (typeof raw !== "number" && typeof raw !== "string") return false;
  if (typeof raw === "string" && raw.trim() === "") return false;
  const code = Number(raw);
  if (!Number.isFinite(code)) return false;
  return code === 408 || code === 409 || code === 429 || code >= 500;
};

export function isFallbackEligible(e: unknown): boolean {
  // SDK exhausted its internal retries — unwrap and re-classify the real cause.
  if (RetryError.isInstance(e)) return isFallbackEligible(e.lastError);
  // Provider signalled retryable (429/5xx/timeout) vs a 4xx we must fix ourselves.
  if (APICallError.isInstance(e)) return e.isRetryable || bodyDeliveredRetryable(e);
  // Model produced unparsable/schema-invalid output — a different model is the fix.
  if (NoObjectGeneratedError.isInstance(e)) return true;
  // Timeout/abort pass-through (DOMException or fetch AbortError). MEDIUM-confidence
  // shape from research — match on name for both variants.
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  // Everything else (our bugs, LoadAPIKeyError, non-Error values) → rethrow → DLQ.
  return false;
}
