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
});
