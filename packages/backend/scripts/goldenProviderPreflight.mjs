import { writeSync } from "node:fs";

export const PREFLIGHT_PASSED_LINE =
  "[eval:golden] provider preflight PASSED (secret-safe; no budget opened)";
export const PREFLIGHT_REFUSAL_REASONS = Object.freeze([
  "openrouter_key_missing_or_invalid",
  "tavily_key_missing_or_invalid",
  "openrouter_billing_attestation_invalid",
  "tavily_billing_attestation_invalid",
  "tavily_credit_attestation_invalid",
  "backend_unavailable",
  "transport_error",
  "readiness_response_invalid",
]);
const PREFLIGHT_REFUSAL_REASON_SET = new Set(PREFLIGHT_REFUSAL_REASONS);

export function preflightRefusedLine(reason) {
  if (!PREFLIGHT_REFUSAL_REASON_SET.has(reason))
    throw new Error("PREFLIGHT_REFUSAL_REASON_INVALID");
  return `[eval:golden] provider preflight REFUSED reason=${reason} (secret-safe; no budget opened)`;
}

export class ProviderPreflightRefusal extends Error {
  constructor(reason) {
    if (!PREFLIGHT_REFUSAL_REASON_SET.has(reason))
      throw new Error("PREFLIGHT_REFUSAL_REASON_INVALID");
    super("GOLDEN_PROVIDER_PREFLIGHT_REFUSED");
    this.name = "ProviderPreflightRefusal";
    this.reason = reason;
  }
}

/**
 * Standalone preflight owns its terminal line and exit code. Backend/CLI errors are deliberately
 * not interpolated: deployment stderr can contain configuration details, while callers need only
 * the fail-closed verdict before deciding whether a paid run is allowed.
 */
export function runStandaloneProviderPreflight({
  check,
  // Synchronous writes are intentional: the caller immediately uses `process.exit(code)`, whose
  // forced termination may truncate asynchronous console output when stdout/stderr are pipes.
  stdout = (line) => writeSync(1, `${line}\n`),
  stderr = (line) => writeSync(2, `${line}\n`),
}) {
  try {
    check();
    stdout(PREFLIGHT_PASSED_LINE);
    return 0;
  } catch (error) {
    // Unknown errors are a transport failure, never printable diagnostic material. In particular,
    // do not echo Error.message: Convex/CLI failures may contain deployment URLs or config values.
    const reason = error instanceof ProviderPreflightRefusal ? error.reason : "transport_error";
    stderr(preflightRefusedLine(reason));
    return 2;
  }
}
