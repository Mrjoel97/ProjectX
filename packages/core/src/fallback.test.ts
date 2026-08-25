import { APICallError, NoObjectGeneratedError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { isFallbackEligible } from "./fallback";

const apiError = (isRetryable: boolean, statusCode: number): APICallError =>
  new APICallError({
    message: "x",
    url: "https://gateway.example/chat",
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });

// Real instance — response/usage/finishReason are irrelevant to the marker check.
const noObjectError = (): NoObjectGeneratedError =>
  new NoObjectGeneratedError({
    text: "not json",
  } as ConstructorParameters<typeof NoObjectGeneratedError>[0]);

/** The gateway shape: HTTP 200, the real status inside the body. `data` is the error OBJECT here,
 *  which is what @openrouter/ai-sdk-provider passes. */
const bodyError = (code: unknown): APICallError =>
  new APICallError({
    message: "x",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 200,
    isRetryable: false,
    data: { code, message: "x" },
  });

/** The same thing when a provider hands back the whole envelope instead of the inner error. */
const envelopeError = (code: unknown): APICallError =>
  new APICallError({
    message: "x",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 200,
    isRetryable: false,
    data: { error: { code, message: "x" } },
  });

describe("isFallbackEligible", () => {
  it("retryable APICallError (429/5xx) → true", () => {
    expect(isFallbackEligible(apiError(true, 429))).toBe(true);
  });

  it("non-retryable APICallError (4xx config) → false", () => {
    expect(isFallbackEligible(apiError(false, 400))).toBe(false);
  });

  it("NoObjectGeneratedError (bad model output) → true", () => {
    expect(isFallbackEligible(noObjectError())).toBe(true);
  });

  it("RetryError unwraps lastError: retryable inner → true", () => {
    const e = new RetryError({
      message: "exhausted",
      reason: "maxRetriesExceeded",
      errors: [apiError(true, 503)],
    });
    expect(isFallbackEligible(e)).toBe(true);
  });

  it("RetryError unwraps lastError: non-retryable inner → false", () => {
    const e = new RetryError({
      message: "exhausted",
      reason: "errorNotRetryable",
      errors: [apiError(false, 401)],
    });
    expect(isFallbackEligible(e)).toBe(false);
  });

  it('DOMException named "TimeoutError" → true', () => {
    expect(isFallbackEligible(new DOMException("timed out", "TimeoutError"))).toBe(true);
  });

  it('error named "AbortError" → true', () => {
    expect(isFallbackEligible({ name: "AbortError", message: "aborted" })).toBe(true);
  });

  it("plain Error (our bug / config) → false (rethrow → DLQ)", () => {
    expect(isFallbackEligible(new Error("unknown_route"))).toBe(false);
  });

  it("non-Error values → false", () => {
    expect(isFallbackEligible("boom")).toBe(false);
    expect(isFallbackEligible(undefined)).toBe(false);
    expect(isFallbackEligible(null)).toBe(false);
  });

  // ── HTTP 200 carrying a real upstream status (the OpenRouter gateway shape) ──
  //
  // This is the bug that killed workflow packs on 2026-08-25: a 503 delivered inside a 200 was
  // classified non-retryable, so the Gemini fallback never fired. Every case below is a NUMBER read
  // from the body — no message text is ever consulted.
  describe("a transport-200 that carries the real status in its body", () => {
    it("503 in the body → true (the outage that started this)", () => {
      expect(isFallbackEligible(bodyError(503))).toBe(true);
    });

    it("the same, when data is the envelope rather than the error object → true", () => {
      expect(isFallbackEligible(envelopeError(502))).toBe(true);
    });

    it("429 in the body → true", () => {
      expect(isFallbackEligible(bodyError(429))).toBe(true);
    });

    it('a NUMERIC STRING code ("503") → true — providers are inconsistent about the type', () => {
      expect(isFallbackEligible(bodyError("503"))).toBe(true);
    });

    // The other half of the contract, and the more important half: this must NOT become
    // "any error in a body is retryable".
    it("400 in the body → false — a config error must still dead-letter, not burn a second vendor", () => {
      expect(isFallbackEligible(bodyError(400))).toBe(false);
    });

    it("401 in the body → false", () => {
      expect(isFallbackEligible(bodyError(401))).toBe(false);
    });

    it('a non-numeric code ("insufficient_quota") → false — never guess from an unknown string', () => {
      expect(isFallbackEligible(bodyError("insufficient_quota"))).toBe(false);
    });

    it("no code at all → false", () => {
      expect(isFallbackEligible(bodyError(undefined))).toBe(false);
    });

    it("null and empty-string codes → false (Number() turns both into 0)", () => {
      expect(isFallbackEligible(bodyError(null))).toBe(false);
      expect(isFallbackEligible(bodyError(""))).toBe(false);
    });

    it("a body code can never DEMOTE a real transport status", () => {
      // A genuine 503 stays retryable even though its body says 400.
      const real503 = new APICallError({
        message: "x",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
        data: { code: 400, message: "x" },
      });
      expect(isFallbackEligible(real503)).toBe(true);
    });

    // THE GUARD ON `statusCode === 200`, which nothing else covers: a body code must never PROMOTE
    // a genuine transport failure. Without this the helper would turn a real 400 (our bug) into a
    // cross-vendor retry the moment its body happened to carry a 5xx-shaped code. Found by mutation
    // testing — deleting the guard left every other assertion green.
    it("a body code can never PROMOTE a real 4xx — the transport status wins", () => {
      const real400 = new APICallError({
        message: "x",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 400,
        isRetryable: false,
        data: { code: 503, message: "x" },
      });
      expect(isFallbackEligible(real400)).toBe(false);
    });
    it("wrapped in a RetryError, it still unwraps and rolls over", () => {
      const e = new RetryError({
        message: "exhausted",
        reason: "maxRetriesExceeded",
        errors: [bodyError(503)],
      });
      expect(isFallbackEligible(e)).toBe(true);
    });
  });
});
